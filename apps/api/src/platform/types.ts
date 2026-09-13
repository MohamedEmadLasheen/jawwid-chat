import { ActorKind, FAMILY_FACING_STAFF_ROLES, Locale, StaffRole } from '../communication/contracts/vocab';

/**
 * PLATFORM SEAM - AI #1 OWNS THIS CONTRACT.
 *
 * The communication engine never reads identity tables directly. It asks
 * IdentityService for an Actor and reasons only about what is on this object.
 *
 * PRIVACY: Actor deliberately has no phone, email or address field, and the
 * chat schema has no such column. A phone number therefore cannot leak through
 * a message, conversation payload, call payload, notification or realtime
 * event, because no code path in this engine can obtain one.
 */
export interface Actor {
  /** Opaque id: chat.staff.id, chat.contact.id, or a teacher id. */
  actorId: string;
  kind: ActorKind;
  displayName: string;
  locale: Locale;
  isActive: boolean;

  /** Present when kind = staff. */
  staffRole?: StaffRole;
  /** Present when kind = contact. */
  familyId?: string;
  /** chat.contact.can_message capability flag. */
  canMessage?: boolean;

  /**
   * The principal's organization (PR-B). Set by IdentityService from the
   * principal row, never from a request field, so it cannot be used to cross a
   * tenant boundary. Optional because SYSTEM_ACTOR belongs to no organization.
   */
  organizationId?: string;
}

export const SYSTEM_ACTOR: Actor = {
  actorId: '00000000-0000-0000-0000-000000000000',
  kind: 'system',
  displayName: 'Jawwid',
  locale: 'ar',
  isActive: true,
};

export function isFamilyFacingStaff(actor: Actor): boolean {
  return actor.kind === 'staff' && FAMILY_FACING_STAFF_ROLES.has(actor.staffRole ?? '');
}
