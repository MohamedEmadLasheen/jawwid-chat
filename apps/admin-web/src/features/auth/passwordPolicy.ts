/**
 * Owner decision, 2026-10-27: a password may be as short as 4 characters, for
 * every account (it was 8). Mirrors PASSWORD_MIN_LENGTH in
 * apps/api/src/platform/auth/password-policy.ts; the server enforces it too.
 */
export const PASSWORD_MIN_LENGTH = 4
