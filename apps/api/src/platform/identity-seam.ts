/**
 * The header-identity seam, and the guard that keeps it local.
 *
 * Until Phase 1 (Identity, Authentication & Authorization) lands, the API
 * resolves the caller from `x-actor-id` on HTTP and `handshake.auth.actorId`
 * on the WebSocket. That is a bring-up seam, not authentication: any caller can
 * name any active actor (red-team finding RT-001 / NF-08, the sole open P0).
 *
 * Phase 0 does not implement authentication. What it does is make the seam
 * impossible to deploy by accident: the process refuses to start unless
 * APP_ENV names an environment that is never reachable from an untrusted
 * network. Removing this guard, or adding an environment to the allow-list,
 * is a security decision and is protected by
 * test/unit/auth/identity-seam.spec.ts (docs/qa/protected-tests.tsv).
 *
 * Phase 1 deletes this file together with the seam it guards.
 */
export const HEADER_IDENTITY_SEAM = 'x-actor-id';
export const HANDSHAKE_IDENTITY_SEAM = 'handshake.auth.actorId';

/** Environments in which self-asserted identity is tolerated. */
export const SEAM_ALLOWED_ENVIRONMENTS: ReadonlySet<string> = new Set(['local', 'test', 'ci']);

export class IdentitySeamRefused extends Error {
  constructor(appEnv: string) {
    super(
      `refusing to start: identity is still the '${HEADER_IDENTITY_SEAM}' header / ` +
        `${HANDSHAKE_IDENTITY_SEAM} seam (RT-001), and APP_ENV='${appEnv}' is not a local ` +
        `environment (allowed: ${[...SEAM_ALLOWED_ENVIRONMENTS].join(', ')}). ` +
        'Phase 1 replaces the seam with verified credentials; until then this build ' +
        'must not run where an untrusted network can reach it.',
    );
    this.name = 'IdentitySeamRefused';
  }
}

/**
 * Throws unless the header-identity seam is permitted in this environment.
 * A missing APP_ENV is treated as `local`, matching readBuildInfo().
 */
export function assertHeaderIdentitySeamAllowed(env: NodeJS.ProcessEnv = process.env): void {
  const appEnv = (env.APP_ENV ?? 'local').trim().toLowerCase();
  if (!SEAM_ALLOWED_ENVIRONMENTS.has(appEnv)) {
    throw new IdentitySeamRefused(appEnv);
  }
}
