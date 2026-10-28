import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import type { Actor } from '../platform/types';
import type { BillingAccess } from '../platform/pd012-policy';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { AvatarService } from '../communication/profile/avatar.service';
import { signAvatar } from '../communication/profile/avatar-urls';
import { billingAccessOf, ownsFamily, reachesFamily } from '../billing/billing-access';

const NAME_MAX = 120;
const SEARCH_LIMIT = 200;
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
 * country (chat.family.country_code, shared with Stories targeting), the number
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

  /** The parents this staff member may open, by name. `q` narrows by name. */
  async list(actorId: string, q?: string) {
    const { actor, scope } = await this.requireAdmin(actorId);
    const search = typeof q === 'string' ? q.trim().slice(0, 80) : '';
    const reach = scope === 'reach';
    const owned = scope === 'owned';
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; name: string; avatar_object_key: string | null; family_id: string; family_name: string; children: number }>
    >`
      SELECT c.id, c.name, c.avatar_object_key, f.id AS family_id, f.display_name AS family_name,
             (SELECT count(*)::int FROM chat.learner l WHERE l.family_id = f.id) AS children
        FROM chat.contact c
        JOIN chat.family f ON f.id = c.family_id
       WHERE c.organization_id = ${actor.organizationId as string}::uuid
         AND c.is_active
         AND (${search} = '' OR c.name ILIKE '%' || ${search} || '%' OR f.display_name ILIKE '%' || ${search} || '%')
         AND (${!reach} OR chat.staff_reaches_family(${actor.actorId}::uuid, f.id) IS NOT NULL)
         AND (${!owned} OR chat.staff_owns_family(${actor.actorId}::uuid, f.id))
       ORDER BY c.name, c.id
       LIMIT ${SEARCH_LIMIT}`;
    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        avatarUrl: signAvatar('contact', r.id, 'profile', actor.actorId, r.avatar_object_key),
        family: { id: r.family_id, name: r.family_name },
        childrenCount: r.children,
      })),
      truncated: rows.length === SEARCH_LIMIT,
    };
  }

  async detail(actorId: string, contactId: string) {
    const { actor, scope, canEdit, editOwnedOnly } = await this.requireAdmin(actorId);
    const contact = await this.requireContact(actor, scope, contactId);
    // PD-42: a Sales account edits only the families it owns.
    const editable = canEdit && (!editOwnedOnly || (await ownsFamily(this.prisma, actor, contact.familyId)));
    return this.present(actor, contact.id, editable);
  }

  // ---------------------------------------------------------------- write

  /**
   * Partial: an absent field is left alone; null clears it (the name cannot be
   * cleared). { name, phone, email, countryCode, region, adminNote }
   */
  async update(actorId: string, contactId: string, body: Record<string, unknown>) {
    const { actor, contact } = await this.requireEditableContact(actorId, contactId);

    const name = 'name' in body ? requireName(body.name) : undefined;
    const file: { adminOnlyParentPhone?: string | null; adminOnlyParentEmail?: string | null; region?: string | null; adminNote?: string | null } = {};
    if ('phone' in body) file.adminOnlyParentPhone = optionalPhone(body.phone);
    if ('email' in body) file.adminOnlyParentEmail = optionalEmail(body.email);
    if ('region' in body) file.region = optionalText('region', body.region, 80);
    if ('adminNote' in body) file.adminNote = optionalText('adminNote', body.adminNote, 1000);
    let countryCode: string | null | undefined;
    if ('countryCode' in body) {
      const c = body.countryCode === null ? null : String(body.countryCode).trim().toUpperCase();
      if (c !== null && !/^[A-Z]{2}$/.test(c)) throw invalid('countryCode: ISO 3166-1 alpha-2, e.g. AE, or null');
      countryCode = c;
    }

    const before = await this.prisma.parentFile.findUnique({ where: { contactId: contact.id } });
    const changed: string[] = [];
    if (name !== undefined && name !== contact.name) changed.push('name');
    for (const [key, value] of Object.entries(file) as Array<[keyof typeof file, string | null]>) {
      if ((before?.[key] ?? null) !== value) changed.push(FIELD_NAME[key]);
    }
    if (countryCode !== undefined && countryCode !== contact.countryCode) changed.push('countryCode');
    if (changed.length === 0) return this.present(actor, contact.id, true);

    await this.prisma.$transaction(async (tx) => {
      await this.conversations.assertActorLive(tx, actor);
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
      if (countryCode !== undefined && countryCode !== contact.countryCode) {
        // The one country column, shared with Stories targeting (20261017120000).
        await tx.family.update({
          where: { id: contact.familyId },
          data: { countryCode, segmentSource: 'admin', segmentUpdatedAt: new Date() },
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
      include: { family: { select: { id: true, displayName: true, countryCode: true } } },
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
        region: file?.region ?? null,
      },
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
    if (admin.editOwnedOnly && !(await ownsFamily(this.prisma, admin.actor, contact.familyId))) {
      throw new CommError(CommErrorCode.PARENT_PROFILE_DENIED, 'a parent\'s contact record is edited by the family\'s own supervisor');
    }
    return { actor: admin.actor, contact };
  }

  private async findContact(actor: Actor, scope: Scope, contactId: string) {
    if (!isUuid(contactId)) return null;
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId.toLowerCase(), organizationId: actor.organizationId as string },
      select: { id: true, name: true, familyId: true, organizationId: true, family: { select: { countryCode: true } } },
    });
    if (!contact) return null;
    if (scope === 'reach' && !(await reachesFamily(this.prisma, actor, contact.familyId))) return null;
    if (scope === 'owned' && !(await ownsFamily(this.prisma, actor, contact.familyId))) return null;
    return { ...contact, countryCode: contact.family.countryCode };
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
