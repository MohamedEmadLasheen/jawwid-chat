import { StaffRole } from '@prisma/client';

/**
 * PLATFORM SEAM - AI #1 OWNS THIS CONTRACT.
 *
 * The communication engine never reads the user tables directly. It asks
 * IdentityService for an Actor and reasons only about what is on this object.
 *
 * PRIVACY: Actor deliberately has no phone number, email, or address field.
 * Phone numbers are not part of communication identity (they are not even
 * columns on the Contact shell). A phone number therefore cannot leak through
 * a message, thread payload, realtime event, or notification, because the
 * communication engine has no code path that can obtain one.
 */
export type ActorKind = 'STAFF' | 'CONTACT' | 'SYSTEM';

export interface Actor {
  /** Stable id used across threads, receipts, reactions and device tokens. */
  userId: string;
  kind: ActorKind;
  displayName: string;
  locale: 'AR' | 'EN';
  /** Present when kind = STAFF. */
  staffRole?: StaffRole;
  /** Present when kind = CONTACT. */
  contactId?: string;
  /** Family this contact belongs to. Staff are not bound to one family. */
  familyId?: string;
  /** Contact capability flag from the brief's section 2 presets. */
  canMessage?: boolean;
  isActive: boolean;
}

export const SYSTEM_ACTOR: Actor = {
  userId: 'system',
  kind: 'SYSTEM',
  displayName: 'Jawwid',
  locale: 'AR',
  isActive: true,
};

/**
 * Staff roles allowed to communicate with families at all.
 *
 * Brief section 2: finance / technical / academic staff "See and complete tasks
 * assigned to them only. NEVER MESSAGE FAMILIES."
 *
 * This is the constitutional rule the AI #2 brief calls "no direct
 * teacher <-> parent communication", expressed the way the authoritative
 * product brief expresses it. ACADEMIC (teaching) staff are excluded here, so
 * a teacher cannot message a family through any channel.
 */
export const FAMILY_FACING_ROLES: ReadonlySet<StaffRole> = new Set<StaffRole>([
  StaffRole.ADMIN,
  StaffRole.COVERAGE,
  StaffRole.MANAGER,
]);

export function isFamilyFacing(role: StaffRole | undefined): boolean {
  return role !== undefined && FAMILY_FACING_ROLES.has(role);
}
