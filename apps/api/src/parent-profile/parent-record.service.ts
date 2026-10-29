import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { invalidCountryMessage, isGeoForeignKeyViolation } from '../geo/countries';
import { locationOf, parseLocationPatch } from '../geo/location';
import { contactKeyHash } from '../new-students/contact-key';
import { e164ForKey } from '../new-students/intake-input';
import { suggestedCountryFromPhone } from './parent-phone-directory';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import type { Actor } from '../platform/types';
import type { BillingAccess } from '../platform/pd012-policy';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { AvatarService } from '../communication/profile/avatar.service';
import { signAvatar } from '../communication/profile/avatar-urls';
import { billingAccessOf, familyInScopeSql, ownsFamily, reachesFamily, salesEditsFamily } from '../billing/billing-access';
import { ActorKind } from '../communication/contracts/vocab';
import { dashboardTile, type DashboardTile } from '../dashboard/dashboard-tile';

const NAME_MAX = 120;
const SEARCH_LIMIT = 200;
/** PD-44: the Parents list's subscription filters (chat.learner_access.state). */
const ACCESS_FILTERS: readonly string[] = ['locked', 'grace'];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Scope = NonNullable<BillingAccess['scope']>;
type Admin = { actor: Actor; scope: Scope; canEdit: boolean; editOwnedOnly: boolean };

/**
 * PD-17: the Parent Profile -- the administration's page about one parent.
 *
 * WHO. The Instalment Payments rule, exactly (billingAccessOf): the super admin
 * and the Operations Manager every parent, an Operations supervisor (or
 * coverage) the parents of families they reach (PD-8), the Sales department
 * every parent -- Sales to record payments. PD-42: a Sales account edits the
 * contact record of the families it owns only, and while the Sales switch is
 * 'own' a Sales member reads only those. Anyone else -- a teacher, a parent, the Teachers
 * department -- is refused with
 * PARENT_PROFILE_DENIED BEFORE any parent is looked up, so the answer says
 * nothing about which ids exist. A parent outside the caller's reach is the
 * same 404 as one that does not exist.
 *
 * WHAT. The parent's name and photo (chat.contact -- the same name and photo
 * every chat surface shows, so an edit here is an edit everywhere), the family's
 * country (chat.family.country_code, shared with Stories targeting) and, PD-45,
 * its first-level subdivision (always the country's) and who set them, the number
 * of children, and the administration's own record in chat.parent_file: phone,
 * e-mail, emirate / governorate and an internal note the parent never sees.
 * Money is BillingService's (`/families/:id/billing`), under the same rule.
 *
 * G-07. chat.parent_file is named only in src/parent-profile
 * (parent-file-confinement.spec.ts). Nothing here is reachable from a message,
 * conversation, call, notification or realtime path, and the audit trail lists
 * which fields changed, never the phone or e-mail themselves.
 */
@Injectable()
export class ParentRecordService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly avatars: AvatarService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  /** A parent's photo on their profile is seen by whoever may open the profile, re-decided per request. */
  onModuleInit(): void {
    this.avatars.registerProfileReader('contact', async (viewer, contactId) => {
      const scope = await this.scopeOf(viewer);
      if (!scope) return false;
      return (await this.findContact(viewer, scope, contactId)) !== null;
    });
  }

  // ---------------------------------------------------------------- read

  /**
   * The parents this staff member may open, by name. `q` narrows by name;
   * PD-45 `location=missing` to the families with no country, a code that is
   * not a country of the list, or a country with subdivisions and none chosen --
   * the list staff complete (plan §6.1 a). Each row carries its location only
   * when asked (`with=location`, or that filter): the Sales app's Payments tab
   * reads this list and does not need it (data minimisation).
   *
   * PD-44 `access=locked|grace`: only the parents of a family with a child in
   * that PD-30 state, computed now (chat.compute_learner_access, as
   * enforcement computes it), never read from the chat.learner_access row a
   * sweep may not have refreshed yet: an instalment overdue at midnight
   * shows at once. One statement; EXISTS stops at the family's first match.
   */
  async list(actorId: string, q?: string, location?: string, withFields?: string, accessFilter?: string) {
    const { actor, scope } = await this.requireAdmin(actorId);
    if (location !== undefined && location !== '' && location !== 'missing') throw invalid('location: missing, or leave it out');
    if (withFields !== undefined && withFields !== '' && withFields !== 'location') throw invalid('with: location, or leave it out');
    const missing = location === 'missing';
    const withLocation = missing || withFields === 'location';
    const search = typeof q === 'string' ? q.trim().slice(0, 80) : '';
    const state = accessFilter === undefined || accessFilter === '' ? null : accessFilter;
    if (state !== null && !ACCESS_FILTERS.includes(state)) throw invalid('access: locked or grace, or leave it out');
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string; name: string; avatar_object_key: string | null; family_id: string; family_name: string; children: number;
        country_code: string | null; subdivision_code: string | null;
      }>
    >`
      SELECT c.id, c.name, c.avatar_object_key, f.id AS family_id, f.display_name AS family_name,
             (SELECT count(*)::int FROM chat.learner l WHERE l.family_id = f.id) AS children,
             f.country_code, f.subdivision_code
        FROM chat.contact c
        JOIN chat.family f ON f.id = c.family_id
       WHERE ${this.listWhere(actor, scope, search)}
         AND (${state}::text IS NULL OR EXISTS (
               SELECT 1 FROM chat.learner l CROSS JOIN LATERAL chat.compute_learner_access(l.id) a
                WHERE l.family_id = f.id AND a.state = ${state}::text))
         AND (${!missing} OR f.country_code IS NULL
              -- an old code that is not a country of the list (the "other" box, before PD-45)
              OR NOT EXISTS (SELECT 1 FROM chat.geo_country gc WHERE gc.code = f.country_code AND gc.retired_at IS NULL)
              OR (f.subdivision_code IS NULL
                  AND EXISTS (SELECT 1 FROM chat.geo_subdivision gs
                               WHERE gs.country_code = f.country_code AND gs.retired_at IS NULL)))
       ORDER BY c.name, c.id
       LIMIT ${SEARCH_LIMIT}`;
    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        avatarUrl: signAvatar('contact', r.id, 'profile', actor.actorId, r.avatar_object_key),
        family: { id: r.family_id, name: r.family_name },
        childrenCount: r.children,
        ...(withLocation ? { location: { countryCode: r.country_code, subdivisionCode: r.subdivision_code } } : {}),
      })),
      truncated: rows.length === SEARCH_LIMIT,
    };
  }

  /** The rows the Parents list may show this viewer: one rule for the list and its Dashboard count. */
  private listWhere(actor: Actor, scope: Scope, search: string): Prisma.Sql {
    return Prisma.sql`c.organization_id = ${actor.organizationId as string}::uuid
         AND c.is_active
         AND (${search} = '' OR c.name ILIKE '%' || ${search} || '%' OR f.display_name ILIKE '%' || ${search} || '%')
         AND ${familyInScopeSql(actor.actorId, scope, Prisma.sql`f.id`)}`;
  }

  /**
   * PD-44: the Dashboard's tiles for the Parents list's subscription filters
   * -- what `list(?access=locked|grace)` shows, counted in one statement over
   * the same rows (listWhere), each child's state computed once, now (as
   * `list` and enforcement compute it), and capped at the list's SEARCH_LIMIT:
   *
   *   parents.locked   parents of a family with a child whose subscription is locked
   *   parents.grace    ... a child in the grace period
   *
   * Staff who open no Parent Profile get no tile; non-staff are refused.
   */
  async dashboardCounts(actorId: string): Promise<DashboardTile[]> {
    const actor = await this.conversations.requireActor(actorId);
    if (actor.kind !== ActorKind.STAFF) {
      throw new CommError(CommErrorCode.PARENT_PROFILE_DENIED, 'parent profiles are the administration\'s');
    }
    const scope = (await billingAccessOf(this.prisma, actor)).scope;
    if (!scope) return [];
    const [r] = await this.prisma.$queryRaw<Array<{ locked: number; grace: number }>>`
      WITH shown AS (
        SELECT f.id AS family_id
          FROM chat.contact c
          JOIN chat.family f ON f.id = c.family_id
         WHERE ${this.listWhere(actor, scope, '')}
      ), states AS (
        SELECT l.family_id, bool_or(a.state = 'locked') AS locked, bool_or(a.state = 'grace') AS grace
          FROM chat.learner l
         CROSS JOIN LATERAL chat.compute_learner_access(l.id) a
         WHERE l.family_id IN (SELECT family_id FROM shown)
         GROUP BY l.family_id
      )
      SELECT count(*) FILTER (WHERE s.locked)::int AS locked,
             count(*) FILTER (WHERE s.grace)::int AS grace
        FROM shown
        JOIN states s ON s.family_id = shown.family_id`;
    const tile = (key: string, n: number) => dashboardTile(key, Math.min(n, SEARCH_LIMIT), null, n > SEARCH_LIMIT);
    return [tile('parents.locked', r?.locked ?? 0), tile('parents.grace', r?.grace ?? 0)];
  }

  async detail(actorId: string, contactId: string) {
    const { actor, scope, canEdit, editOwnedOnly } = await this.requireAdmin(actorId);
    const contact = await this.requireContact(actor, scope, contactId);
    // PD-42: a Sales account edits only the families it owns.
    const editable = canEdit && (!editOwnedOnly || (await salesEditsFamily(this.prisma, actor, contact.familyId)));
    return this.present(actor, contact.id, editable);
  }

  // ---------------------------------------------------------------- write

  /**
   * Partial: an absent field is left alone; null clears it (the name cannot be
   * cleared). { name, phone, email, countryCode, subdivisionCode, region, adminNote }
   */
  async update(actorId: string, contactId: string, body: Record<string, unknown>) {
    const { actor, contact } = await this.requireEditableContact(actorId, contactId);

    const name = 'name' in body ? requireName(body.name) : undefined;
    const file: { adminOnlyParentPhone?: string | null; adminOnlyParentEmail?: string | null; region?: string | null; adminNote?: string | null } = {};
    if ('phone' in body) file.adminOnlyParentPhone = optionalPhone(body.phone);
    if ('email' in body) file.adminOnlyParentEmail = optionalEmail(body.email);
    if ('region' in body) file.region = optionalText('region', body.region, 80);
    if ('adminNote' in body) file.adminNote = optionalText('adminNote', body.adminNote, 1000);
    // PD-45: one of the list (chat.geo_country), and a subdivision always the
    // country's. Checked here to answer early; decided again below, on the row
    // as it is locked, so two edits at once never read a stale country.
    const hasLocation = 'countryCode' in body || 'subdivisionCode' in body;
    parseLocationPatch(body, { countryCode: contact.countryCode, subdivisionCode: contact.subdivisionCode });

    const before = await this.prisma.parentFile.findUnique({ where: { contactId: contact.id } });
    const changed: string[] = [];
    if (name !== undefined && name !== contact.name) changed.push('name');
    for (const [key, value] of Object.entries(file) as Array<[keyof typeof file, string | null]>) {
      if ((before?.[key] ?? null) !== value) changed.push(FIELD_NAME[key]);
    }
    if (changed.length === 0 && !hasLocation) return this.present(actor, contact.id, true);

    await this.prisma.$transaction(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
      // PD-42 S3: the edit names its staff member, for the Sales-scope guards on
      // chat.contact and chat.family (which carry no actor column).
      await tx.$executeRaw`SELECT set_config('chat.acting_staff_id', ${actor.actorId}, true)`;
      // Review of #294: the family's location as it is NOW, held until commit.
      const [locked] = await tx.$queryRaw<Array<{ country_code: string | null; subdivision_code: string | null }>>`
        SELECT country_code, subdivision_code FROM chat.family WHERE id = ${contact.familyId}::uuid FOR UPDATE`;
      const current = { countryCode: locked?.country_code ?? null, subdivisionCode: locked?.subdivision_code ?? null };
      const location = parseLocationPatch(body, current);
      const countryChanged = location !== undefined && location.countryCode !== current.countryCode;
      const subdivisionChanged = location !== undefined && location.subdivisionCode !== current.subdivisionCode;
      if (countryChanged) changed.push('countryCode');
      if (subdivisionChanged) changed.push('subdivisionCode');
      if (changed.length === 0) return;
      // A request that CLEARS the country reads the number in no country (review of #296).
      const country = location ? location.countryCode : current.countryCode;

      if (name !== undefined && name !== contact.name) {
        await tx.contact.update({ where: { id: contact.id }, data: { name } });
      }
      if (Object.keys(file).length > 0) {
        await tx.parentFile.upsert({
          where: { contactId: contact.id },
          create: { contactId: contact.id, organizationId: contact.organizationId, ...file, updatedBy: actor.actorId },
          update: { ...file, updatedBy: actor.actorId },
        });
      }
      // PD-42 S1 (review of #294): a changed number is keyed, read in the family's
      // (new) country; one another family holds refuses the edit. An international
      // number reads the same in every country, so it is recorded; a LOCAL one
      // reads by the country, so it is a re-keyed reading that a corrected
      // country replaces (review of #296).
      if (changed.includes('phone') && file.adminOnlyParentPhone) {
        await keyPhoneReading(tx, {
          familyId: contact.familyId, organizationId: contact.organizationId, phone: file.adminOnlyParentPhone,
          country, actorId: actor.actorId, source: isInternational(file.adminOnlyParentPhone) ? 'record' : 'rekey',
        });
      }
      if (location !== undefined && (countryChanged || subdivisionChanged)) {
        // PD-45 §9: the country decides how a stored local number reads.
        if (countryChanged) await rekeyPhonesForCountry(tx, contact.familyId, contact.organizationId, location.countryCode, actor.actorId);
        const now = new Date();
        await tx.family.update({
          where: { id: contact.familyId },
          data: {
            countryCode: location.countryCode,
            subdivisionCode: location.subdivisionCode,
            locationSource: 'staff',
            locationUpdatedBy: actor.actorId,
            locationUpdatedAt: now,
            // The one country column, shared with Stories targeting (20261017120000).
            ...(countryChanged ? { segmentSource: 'admin', segmentUpdatedAt: now } : {}),
          },
        }).catch((e: unknown) => {
          // PD-45 safety net: the database's own list refused it.
          throw isGeoForeignKeyViolation(e) ? invalid(invalidCountryMessage('countryCode')) : e;
        });
      }
      await this.audit.audit(tx, {
        actorId: actor.actorId,
        action: 'parent_profile.updated',
        entity: 'contact',
        entityId: contact.id,
        // A rename keeps its names (as the parent's own rename does); every other
        // field is listed by NAME only -- a phone or e-mail never enters the log.
        before: changed.includes('name') ? { name: contact.name } : undefined,
        after: { fields: changed, ...(changed.includes('name') ? { name } : {}) },
        reason: 'edited on the Parent Profile',
      });
    });
    return this.present(actor, contact.id, true);
  }

  async authorizePhotoUpload(actorId: string, contactId: string, body: Record<string, unknown>) {
    const { actor, contact } = await this.requireEditableContact(actorId, contactId);
    return this.avatars.authorizeUploadForContact(actor, contact.id, body);
  }

  async commitPhoto(actorId: string, contactId: string, body: Record<string, unknown>) {
    const { actor, contact } = await this.requireEditableContact(actorId, contactId);
    return this.avatars.commitForContact(actor, contact.id, body);
  }

  async removePhoto(actorId: string, contactId: string) {
    const { actor, contact } = await this.requireEditableContact(actorId, contactId);
    return this.avatars.removeForContact(actor, contact.id);
  }

  // ---------------------------------------------------------------- internals

  private async present(actor: Actor, contactId: string, canEdit: boolean) {
    const contact = await this.prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
      include: {
        family: {
          select: { id: true, displayName: true, countryCode: true, subdivisionCode: true, locationSource: true, locationUpdatedAt: true },
        },
      },
    });
    const [file, children] = await Promise.all([
      this.prisma.parentFile.findUnique({ where: { contactId } }),
      this.prisma.learner.findMany({
        where: { familyId: contact.familyId, organizationId: contact.organizationId },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, avatarObjectKey: true },
      }),
    ]);
    return {
      id: contact.id,
      name: contact.name,
      relationship: contact.relationship,
      isActive: contact.isActive,
      avatarUrl: signAvatar('contact', contact.id, 'profile', actor.actorId, contact.avatarObjectKey),
      family: { id: contact.family.id, name: contact.family.displayName },
      contact: {
        phone: file?.adminOnlyParentPhone ?? null,
        email: file?.adminOnlyParentEmail ?? null,
        countryCode: contact.family.countryCode,
        // PD-45: the subdivision, the names of both, and who set them (Q6: staff see a parent's own answer).
        subdivisionCode: contact.family.subdivisionCode,
        location: locationOf(contact.family.countryCode, contact.family.subdivisionCode),
        locationSource: contact.family.locationSource,
        locationUpdatedAt: contact.family.locationUpdatedAt?.toISOString() ?? null,
        // Free text from before PD-45, shown as "Old note" until PR-5's backfill matches it.
        region: file?.region ?? null,
      },
      // PD-45 §6.2: a suggestion while the family has no country; only the code leaves this module (G-07).
      suggestedCountryCode: contact.family.countryCode ? null : suggestedCountryFromPhone(file?.adminOnlyParentPhone ?? null),
      adminNote: file?.adminNote ?? null,
      childrenCount: children.length,
      children: children.map((c) => ({
        id: c.id,
        name: c.name,
        // Seen through the Student Profile's own rule; a viewer it refuses gets initials.
        avatarUrl: signAvatar('learner', c.id, 'profile', actor.actorId, c.avatarObjectKey),
      })),
      updatedAt: file?.updatedAt.toISOString() ?? null,
      // Sales reads; Operations and the super admin edit (PD-17). The server refuses the rest anyway.
      access: { canEdit },
    };
  }

  private async scopeOf(actor: Actor): Promise<Scope | null> {
    return (await billingAccessOf(this.prisma, actor)).scope;
  }

  private async requireAdmin(actorId: string): Promise<Admin> {
    const actor = await this.conversations.requireActor(actorId);
    const access = await billingAccessOf(this.prisma, actor);
    if (!access.scope) {
      throw new CommError(CommErrorCode.PARENT_PROFILE_DENIED, 'parent profiles are the administration\'s');
    }
    return { actor, scope: access.scope, canEdit: access.canEditParent, editOwnedOnly: access.editOwnedOnly === true };
  }

  /** PD-17: the contact record is the Operations department's -- and, PD-42, a Sales owner's for the families they own. */
  private async requireEditor(actorId: string): Promise<Admin> {
    const admin = await this.requireAdmin(actorId);
    if (!admin.canEdit) {
      throw new CommError(CommErrorCode.PARENT_PROFILE_DENIED, 'a parent\'s contact record is edited by the Operations department');
    }
    return admin;
  }

  /** The contact, if this editor may change it: in scope, and (PD-42) their own family when they edit only those. */
  private async requireEditableContact(actorId: string, contactId: string) {
    const admin = await this.requireEditor(actorId);
    const contact = await this.requireContact(admin.actor, admin.scope, contactId);
    if (admin.editOwnedOnly && !(await salesEditsFamily(this.prisma, admin.actor, contact.familyId))) {
      throw new CommError(CommErrorCode.PARENT_PROFILE_DENIED, 'a parent\'s contact record is edited by the family\'s own supervisor');
    }
    return { actor: admin.actor, contact };
  }

  private async findContact(actor: Actor, scope: Scope, contactId: string) {
    if (!isUuid(contactId)) return null;
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId.toLowerCase(), organizationId: actor.organizationId as string },
      select: { id: true, name: true, familyId: true, organizationId: true, family: { select: { countryCode: true, subdivisionCode: true } } },
    });
    if (!contact) return null;
    if (scope === 'reach' && !(await reachesFamily(this.prisma, actor, contact.familyId))) return null;
    if (scope === 'owned' && !(await ownsFamily(this.prisma, actor, contact.familyId))) return null;
    return { ...contact, countryCode: contact.family.countryCode, subdivisionCode: contact.family.subdivisionCode };
  }

  private async requireContact(actor: Actor, scope: Scope, contactId: string) {
    const contact = await this.findContact(actor, scope, contactId);
    if (!contact) throw new CommError(CommErrorCode.PARENT_PROFILE_NOT_FOUND, 'parent not found');
    return contact;
  }
}

/**
 * PD-16 → PD-17: at Assign, the phone and e-mail Sales typed become the new
 * parent's file, and the payment method and currency the family's billing.
 * Called by NewStudentEnrolmentService inside its own transaction, so a family
 * is never created without them.
 */
export async function seedFromEnrolment(
  tx: Prisma.TransactionClient,
  input: {
    contactId: string;
    familyId: string;
    organizationId: string;
    actorId: string;
    phone: string | null;
    email: string | null;
    paymentMethod: string | null;
    currency: string | null;
  },
): Promise<void> {
  await tx.parentFile.create({
    data: {
      contactId: input.contactId,
      organizationId: input.organizationId,
      adminOnlyParentPhone: input.phone?.trim() || null,
      adminOnlyParentEmail: input.email?.trim().toLowerCase() || null,
      updatedBy: input.actorId,
    },
  });
  await tx.familyBilling.create({
    data: {
      familyId: input.familyId,
      organizationId: input.organizationId,
      paymentMethod: input.paymentMethod,
      currency: input.currency,
      updatedBy: input.actorId,
    },
  });
}

/**
 * PD-42: a parent entered by hand without an e-mail is given one later ("Set
 * sign-in e-mail"). The parent file keeps it as the e-mail on record when it
 * had none; an e-mail already on record is left as it is (it is the
 * administration's, edited on the profile). Inside the caller's transaction.
 */
export async function recordSignInEmail(
  tx: Prisma.TransactionClient,
  input: { contactId: string; email: string; actorId: string },
): Promise<void> {
  await tx.parentFile.updateMany({
    where: { contactId: input.contactId, adminOnlyParentEmail: null },
    data: { adminOnlyParentEmail: input.email.trim().toLowerCase(), updatedBy: input.actorId },
  });
}

/**
 * PD-45 §9 (PD-42 S1; review of #294): a family's country decides how a stored
 * LOCAL number reads ("050 765 3333" is +971... in the UAE, +20... in Egypt).
 * When the country changes, the family's earlier re-keyed readings are
 * replaced -- a country chosen by mistake leaves nothing behind -- and each
 * active parent's number is keyed as the new country reads it. A reading
 * another family holds refuses the change. Recorded keys (intake, Assign, the
 * backfill, a changed number) are never touched. The caller holds the family's
 * row lock. Inside the caller's transaction.
 */
export async function rekeyPhonesForCountry(
  tx: Prisma.TransactionClient,
  familyId: string,
  organizationId: string,
  country: string | null,
  actorId: string,
): Promise<void> {
  // The guard lets a 'rekey' key go only while this setting names its family (20261030050000).
  await tx.$executeRaw`SELECT set_config('chat.rekeying_family', ${familyId}, true)`;
  await tx.$executeRaw`DELETE FROM chat.family_contact_key WHERE family_id = ${familyId}::uuid AND source = 'rekey'`;
  await tx.$executeRaw`SELECT set_config('chat.rekeying_family', '', true)`;
  const files = await tx.$queryRaw<Array<{ phone: string }>>`
    SELECT pf.phone
      FROM chat.parent_file pf
      JOIN chat.contact c ON c.id = pf.contact_id AND c.is_active
     WHERE c.family_id = ${familyId}::uuid AND pf.phone IS NOT NULL`;
  for (const f of files) {
    await keyPhoneReading(tx, { familyId, organizationId, phone: f.phone, country, actorId, source: 'rekey' });
  }
}

/**
 * Key one number as `country` reads it, for `familyId`. Nothing when it cannot
 * be read as one number, or the family already holds it; PARENT_EXISTS, naming
 * no family, when another family does.
 */
async function keyPhoneReading(
  tx: Prisma.TransactionClient,
  input: { familyId: string; organizationId: string; phone: string; country: string | null; actorId: string; source: 'record' | 'rekey' },
): Promise<void> {
  const reading = e164ForKey(input.phone, input.country);
  if (!reading || reading === 'ambiguous') return;
  const keyHash = contactKeyHash('phone', reading);
  const [held] = await tx.$queryRaw<Array<{ family_id: string }>>`
    SELECT family_id::text FROM chat.family_contact_key
     WHERE organization_id = ${input.organizationId}::uuid AND key_hash = ${keyHash}`;
  if (held?.family_id === input.familyId) return;
  const taken = () => new CommError(CommErrorCode.PARENT_EXISTS, 'this number is another family\'s; ask your manager', 409);
  if (held) throw taken();
  await tx.$executeRaw`
    INSERT INTO chat.family_contact_key (organization_id, key_hash, family_id, kind, source, created_by)
    VALUES (${input.organizationId}::uuid, ${keyHash}, ${input.familyId}::uuid, 'phone', ${input.source}, ${input.actorId}::uuid)`
    .catch((e: unknown) => {
      // Two staff keying the same number at once: the guard (or the primary key) answers for the second.
      const text = `${String((e as { message?: unknown })?.message ?? '')} ${String((e as { code?: unknown })?.code ?? '')}`;
      if (/already in Chat|23505|P2002/.test(text)) throw taken();
      throw e;
    });
}

/** A number written with its country code (+... or 00...): it reads the same in every country. */
function isInternational(phone: string): boolean {
  return /^\s*(\+|00)/.test(phone);
}

const FIELD_NAME = {
  adminOnlyParentPhone: 'phone',
  adminOnlyParentEmail: 'email',
  region: 'region',
  adminNote: 'adminNote',
} as const;

function invalid(reason: string) {
  return new CommError(CommErrorCode.VALIDATION, reason, 400);
}

function requireName(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw invalid('name: a parent always has a name');
  if (value.trim().length > NAME_MAX) throw invalid(`name: at most ${NAME_MAX} characters`);
  return value.trim();
}

function optionalText(field: string, value: unknown, max: number): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw invalid(`${field}: text, or null`);
  const v = value.trim();
  if (v.length === 0) return null;
  if (v.length > max) throw invalid(`${field}: at most ${max} characters`);
  return v;
}

function optionalPhone(value: unknown): string | null {
  const v = optionalText('phone', value, 32);
  if (v !== null && (v.length < 5 || !/^[+0-9 ()-]+$/.test(v))) throw invalid('phone: digits, spaces, + ( ) -; 5 to 32 characters');
  return v;
}

function optionalEmail(value: unknown): string | null {
  const v = optionalText('email', value, 254);
  if (v !== null && !EMAIL_RE.test(v)) throw invalid('email: a valid e-mail address, or null');
  return v?.toLowerCase() ?? null;
}
