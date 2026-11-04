import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import type { Actor } from '../platform/types';
import { invalidCountryMessage, isGeoForeignKeyViolation } from '../geo/countries';
import { ConversationService } from '../communication/conversations/conversation.service';
import { ActorKind } from '../communication/contracts/vocab';
import { parseMyLocation, presentMyLocation, type MyLocationView } from './my-location';
import { rekeyPhonesForCountry } from './parent-record.service';

type Me = { actor: Actor; contactId: string; familyId: string; organizationId: string };

/**
 * PD-45 PR-4 (plan §5.4, §6.1 b, §8): a parent's own family location, from the
 * app. `GET /me/location`, `PUT /me/location`, `POST /me/location/later`.
 *
 * WHOSE. Nothing here takes an owner id: the caller is the token, and the
 * family is the caller's own contact row's --
 *
 *     token -> actorId -> active contact with an active account -> its family
 *
 * so another family's location is not a request this API can express. Staff
 * are refused by `@NotForStaff()` and again here (PermissionGuard runs in
 * shadow mode for legacy tiers); a teacher, a contact without an account, and
 * one no longer active are refused here, all before any family is read.
 *
 * WHAT LEAVES. The family's two codes and their names, whether the one-time
 * prompt is due, and a country suggested from the caller's own number while the
 * family has none (§6.2) -- never the number. Lives in src/parent-profile
 * because that suggestion reads chat.parent_file (G-07,
 * parent-file-confinement.spec.ts), and the subdivision may be read only here
 * (family-location-confinement.spec.ts).
 *
 * NEVER in a push, a realtime event, an outbox row or the event log. The audit
 * names the changed FIELDS, never their values (as the Parent Profile's does).
 */
@Injectable()
export class MyLocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  async read(actorId: string): Promise<MyLocationView> {
    return this.view(await this.requireParent(actorId));
  }

  /**
   * Save the family's location: validated against the list, written with
   * location_source 'parent' and this contact as the writer, and the prompt
   * answered 'saved'. A country change re-keys the family's local numbers as
   * the staff edit does (§9); a number that becomes another family's refuses
   * the whole save (409). Saving the location as it already is changes nothing
   * but still answers the prompt.
   */
  async save(actorId: string, body: unknown): Promise<MyLocationView> {
    const me = await this.requireParent(actorId);
    const wanted = parseMyLocation(body);

    await this.prisma.$transaction(async (tx) => {
      await this.conversations.assertActorLive(tx, me.actor);
      // As the Parent Profile does (review of #294): decide on the row as it is now, held until commit.
      const [locked] = await tx.$queryRaw<Array<{ country_code: string | null; subdivision_code: string | null }>>`
        SELECT country_code, subdivision_code FROM chat.family WHERE id = ${me.familyId}::uuid FOR UPDATE`;
      const countryChanged = wanted.countryCode !== (locked?.country_code ?? null);
      const subdivisionChanged = wanted.subdivisionCode !== (locked?.subdivision_code ?? null);

      if (countryChanged || subdivisionChanged) {
        if (countryChanged) {
          // No staff member keys it: created_by stays null (chat.family_contact_key names staff only).
          await rekeyPhonesForCountry(tx, me.familyId, me.organizationId, wanted.countryCode, null).catch((e: unknown) => {
            if (e instanceof CommError && e.code === CommErrorCode.PARENT_EXISTS) {
              throw new CommError(CommErrorCode.PARENT_EXISTS, 'this location cannot be saved from the app; please contact the academy', 409);
            }
            throw e;
          });
        }
        await tx.family.update({
          where: { id: me.familyId },
          data: {
            countryCode: wanted.countryCode,
            subdivisionCode: wanted.subdivisionCode,
            locationSource: 'parent',
            locationUpdatedBy: me.contactId,
            locationUpdatedAt: new Date(),
          },
        }).catch((e: unknown) => {
          throw isGeoForeignKeyViolation(e) ? new CommError(CommErrorCode.VALIDATION, invalidCountryMessage('countryCode'), 400) : e;
        });
        await this.audit.audit(tx, {
          actorId: me.contactId,
          action: 'profile.location.changed',
          entity: 'family',
          entityId: me.familyId,
          // Which fields, never their values.
          after: { fields: [...(countryChanged ? ['countryCode'] : []), ...(subdivisionChanged ? ['subdivisionCode'] : [])] },
          reason: 'a parent set their family\'s location in the app',
        });
      }
      await tx.$executeRaw`
        INSERT INTO chat.contact_location_prompt (contact_id, outcome) VALUES (${me.contactId}::uuid, 'saved')
        ON CONFLICT (contact_id) DO UPDATE SET outcome = 'saved', answered_at = now()
         WHERE chat.contact_location_prompt.outcome <> 'saved'`;
    });
    return this.view(me);
  }

  /** "Later" (§6.1 b): the prompt is answered and never shown again, on any device. A first answer is kept. */
  async later(actorId: string): Promise<MyLocationView> {
    const me = await this.requireParent(actorId);
    await this.prisma.$executeRaw`
      INSERT INTO chat.contact_location_prompt (contact_id, outcome) VALUES (${me.contactId}::uuid, 'later')
      ON CONFLICT (contact_id) DO NOTHING`;
    return this.view(me);
  }

  // ---------------------------------------------------------------- internals

  private async view(me: Me): Promise<MyLocationView> {
    const [family, prompt, file] = await Promise.all([
      this.prisma.family.findUniqueOrThrow({ where: { id: me.familyId }, select: { countryCode: true, subdivisionCode: true } }),
      this.prisma.contactLocationPrompt.findUnique({ where: { contactId: me.contactId }, select: { contactId: true } }),
      this.prisma.parentFile.findUnique({ where: { contactId: me.contactId }, select: { adminOnlyParentPhone: true } }),
    ]);
    return presentMyLocation({
      countryCode: family.countryCode,
      subdivisionCode: family.subdivisionCode,
      answered: prompt !== null,
      phone: file?.adminOnlyParentPhone ?? null,
    });
  }

  /**
   * THE AUTHORIZATION BOUNDARY: the caller as an active family contact with an
   * active account, in their own organization. One refusal for every other
   * caller, before any family is read.
   */
  private async requireParent(actorId: string): Promise<Me> {
    const actor = await this.conversations.requireActor(actorId);
    const refuse = () => new CommError(CommErrorCode.PROFILE_NOT_AVAILABLE, 'only a family\'s own parent sets its location', 403);
    if (actor.kind !== ActorKind.CONTACT || !actor.isActive) throw refuse();
    const contact = await this.prisma.contact.findFirst({
      where: {
        id: actor.actorId,
        isActive: true,
        account: { is: { isActive: true } },
        ...(actor.organizationId ? { organizationId: actor.organizationId } : {}),
      },
      select: { id: true, familyId: true, organizationId: true },
    });
    if (!contact) throw refuse();
    return { actor, contactId: contact.id, familyId: contact.familyId, organizationId: contact.organizationId };
  }
}
