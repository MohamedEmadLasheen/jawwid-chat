import { ActorKind, FAMILY_FACING_STAFF_ROLES, Locale, StaffRole } from '../communication/contracts/vocab';

/**
 * THE authenticated identity, resolved server-side once per request.
 *
 * The communication engine never reads identity tables directly. It asks
 * IdentityService for an Actor and reasons only about what is on this object.
 *
 * NOTHING ON THIS OBJECT COMES FROM THE CLIENT. The request carries a signed
 * access token and nothing else; actorId, kind, role, organizationId,
 * permissions and scope are all derived from the session and the database. A
 * client that sends a role, a tenant or an owner id is sending a field that is
 * read by no code path.
 *
 * PRIVACY: Actor deliberately has no phone, email or address field, and the
 * chat schema has no such column. A phone number therefore cannot leak through
 * a message, conversation payload, call payload, notification or realtime
 * event, because no code path in this engine can obtain one.
 */
export interface Actor {
  /** Opaque id: chat.staff.id, chat.contact.id, or chat.teacher.id. */
  actorId: string;
  kind: ActorKind;
  displayName: string;
  locale: Locale;
  isActive: boolean;

  /** The tenant. Set at authentication, never from a request field. */
  organizationId?: string;
  /** chat.account.id -- the login behind this actor. Absent for `system`. */
  accountId?: string;
  /** chat.session.id of the request that resolved this actor. */
  sessionId?: string;

  /** Present when kind = staff. */
  staffRole?: StaffRole;
  /** Present when kind = staff and the person is departmental (never family-facing). */
  department?: string | null;
  /** Present when kind = contact. */
  familyId?: string;
  /** chat.contact.can_message capability flag. */
  canMessage?: boolean;

  /**
   * Effective permission keys: role defaults with per-account ALLOW/DENY
   * overrides already applied (rbac/permissions.ts). Absent means "not
   * resolved", which every check treats as holding nothing.
   */
  permissions?: ReadonlySet<string>;
}

export const SYSTEM_ACTOR: Actor = {
  actorId: '00000000-0000-0000-0000-000000000000',
  kind: 'system',
  displayName: 'Jawwid',
  locale: 'ar',
  isActive: true,
};

/**
 * May this actor take part in family communication at all?
 *
 * Two conditions, both necessary: a family-facing staff ROLE, and no
 * DEPARTMENT. Departmental staff (finance, technical, academic) complete tasks
 * and never message families -- before Phase 1 that was expressed by giving
 * them a role of their own; it is now an attribute, and this is the single
 * place the distinction is made.
 *
 * Note what this does NOT decide: WHICH families. That is scope, and holding a
 * family-facing role grants none of it.
 */
export function isFamilyFacingStaff(actor: Actor): boolean {
  if (actor.kind !== 'staff') return false;
  if (actor.department) return false;
  return FAMILY_FACING_STAFF_ROLES.has(actor.staffRole ?? '');
}

/** Does this actor hold the permission key? Unresolved permissions hold nothing. */
export function actorHasPermission(actor: Actor, permission: string): boolean {
  if (!actor.isActive) return false;
  return actor.permissions?.has(permission) ?? false;
}
