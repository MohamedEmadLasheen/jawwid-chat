/**
 * The one password-length rule for every account: parents, teachers, staff and
 * the super admin.
 *
 * OWNER DECISION, 2026-10-27: "The account password does not have to be at
 * least 8 characters long. It should be allowed to start from 4 characters."
 * Asked about scope, the owner chose ALL accounts, although staff-only 8+ was
 * recommended. This replaces the earlier 8 (parent sign-up, password reset) and
 * 12 (super-admin bootstrap). Do not raise it for one role without a new
 * decision.
 *
 * Nothing else about passwords changed: Argon2id hashing, the login rate limiter
 * and lockout, and the 128 maximum all stand. There is no common-password or
 * breach list, so a 4-character PIN such as 1234 is accepted.
 *
 * The Admin Web (`apps/admin-web/src/features/auth/passwordPolicy.ts`) and the
 * Flutter app (`lib/features/auth/password_policy.dart`) mirror this number.
 */
export const PASSWORD_MIN_LENGTH = 4;
export const PASSWORD_MAX_LENGTH = 128;

/** True when `password` is within the length every account's password must have. */
export function isPasswordLengthAcceptable(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH;
}
