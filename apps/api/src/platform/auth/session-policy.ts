import { ActorKind, StaffRole } from '../../communication/contracts/vocab';
import type { Actor } from '../types';

/**
 * PD-23 (owner decision 2026-10-22): how long a session lives, by who holds it
 * and where.
 *
 *   idle      unused for this long -> the session ends. Every refresh moves it.
 *   absolute  this long after the PASSWORD was entered -> the session ends,
 *             however active. Counted from chat.session.authenticated_at,
 *             which rotation copies forward. null = no absolute limit.
 *
 * | who                         | where                     | idle | absolute |
 * |-----------------------------|---------------------------|------|----------|
 * | parent, teacher             | app                       | 30 d | none     |
 * | staff (not super admin)     | app                       | 14 d | 30 d     |
 * | staff (not super admin)     | Admin Web, kept signed in |  7 d | 30 d     |
 * | staff (not super admin)     | Admin Web, this tab only  | 12 h |  7 d     |
 * | super admin                 | anywhere                  | 12 h |  7 d     |
 *
 * The super admin is never "kept signed in": the strongest account gets the
 * shortest session until it has a second factor (passkeys, PD-23 phase B).
 *
 * Re-evaluated at EVERY refresh from the CURRENT principal, so a promotion to
 * super admin shortens a session at its next refresh instead of at its next
 * login. `client` and `remembered` are read back from the session row, never
 * restated by the client on refresh.
 *
 * JWT_REFRESH_TTL still caps the idle window (it is how a deployment or a test
 * shortens every session at once); it never lengthens one.
 */

const HOUR = 3600;
const DAY = 24 * HOUR;

export type SessionClient = 'app' | 'web';

export interface SessionPolicy {
  /** A stable name, for logs and tests. */
  readonly name: 'family_app' | 'staff_app' | 'staff_web_remembered' | 'staff_web' | 'super_admin';
  readonly idleSeconds: number;
  readonly absoluteSeconds: number | null;
  /** Whether "keep me signed in" is in effect -- the request, granted or not. */
  readonly remembered: boolean;
}

export const SESSION_POLICIES = {
  family_app: { name: 'family_app', idleSeconds: 30 * DAY, absoluteSeconds: null, remembered: false },
  staff_app: { name: 'staff_app', idleSeconds: 14 * DAY, absoluteSeconds: 30 * DAY, remembered: false },
  staff_web_remembered: { name: 'staff_web_remembered', idleSeconds: 7 * DAY, absoluteSeconds: 30 * DAY, remembered: true },
  staff_web: { name: 'staff_web', idleSeconds: 12 * HOUR, absoluteSeconds: 7 * DAY, remembered: false },
  super_admin: { name: 'super_admin', idleSeconds: 12 * HOUR, absoluteSeconds: 7 * DAY, remembered: false },
} as const satisfies Record<string, SessionPolicy>;

/** The device platform a login named, as a policy client. Unknown -> null. */
export function clientOfPlatform(platform: string | undefined): SessionClient | null {
  if (platform === 'web') return 'web';
  if (platform === 'ios' || platform === 'android') return 'app';
  return null;
}

/**
 * The policy for `actor` on `client`. `rememberRequested` is honoured only for
 * staff on the web, and never for the super admin.
 *
 * A staff login that names no platform gets the STRICTER staff policy (this
 * tab only): a missing field must never buy a longer session.
 */
export function sessionPolicyFor(
  actor: Pick<Actor, 'kind' | 'staffRole'>,
  client: SessionClient | null,
  rememberRequested: boolean,
): SessionPolicy {
  if (actor.kind !== ActorKind.STAFF) return SESSION_POLICIES.family_app;
  if (actor.staffRole === StaffRole.SUPER_ADMIN) return SESSION_POLICIES.super_admin;
  if (client === 'app') return SESSION_POLICIES.staff_app;
  if (client === 'web' && rememberRequested) return SESSION_POLICIES.staff_web_remembered;
  return SESSION_POLICIES.staff_web;
}

export interface SessionWindow {
  readonly expiresAt: Date;
  /** authenticated_at + absolute, or null when the policy has none. */
  readonly absoluteExpiresAt: Date | null;
}

/**
 * expires_at for a session issued NOW: the earlier of the idle window and the
 * absolute limit. The caller refuses to issue when this is not in the future.
 */
export function sessionWindow(
  policy: SessionPolicy,
  authenticatedAt: Date,
  now: Date,
  idleCapSeconds: number,
): SessionWindow {
  const idle = new Date(now.getTime() + Math.min(policy.idleSeconds, idleCapSeconds) * 1000);
  const absoluteExpiresAt =
    policy.absoluteSeconds === null ? null : new Date(authenticatedAt.getTime() + policy.absoluteSeconds * 1000);
  const expiresAt = absoluteExpiresAt && absoluteExpiresAt < idle ? absoluteExpiresAt : idle;
  return { expiresAt, absoluteExpiresAt };
}
