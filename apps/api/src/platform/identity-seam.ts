/**
 * What is left of the self-asserted-identity seam, and the guard that keeps it
 * local.
 *
 * HISTORY. Phase 0 resolved the caller from `x-actor-id` on HTTP and
 * `handshake.auth.actorId` on the WebSocket, and contained both by refusing to
 * start outside `local | test | ci` (red-team RT-001 / NF-08).
 *
 * PR-B CLOSED THE HTTP HALF. `x-actor-id` is not read on any HTTP path: the
 * global AuthenticatedGuard verifies a bearer token and writes `request.actor`,
 * and `@ActorId()` reads nothing else. HTTP no longer gates the boot.
 *
 * THE SOCKET HALF IS STILL OPEN. `realtime.gateway.ts#handleConnection` still
 * takes `handshake.auth.actorId` at face value, so any caller who can reach the
 * socket can still name any active actor there. WebSocket authentication is a
 * separate, explicitly scoped piece of work (API-CONTRACT §4: the handshake
 * moves to `auth: { token }` verified by the same verifier as HTTP), and it is
 * NOT in PR-B.
 *
 * So this guard narrows rather than disappears. Deleting it because "HTTP is
 * fixed now" would let a build whose sockets are still unauthenticated start in
 * production, which is a worse outcome than the one it was written for. The
 * realtime PR deletes this file when it verifies the handshake token.
 *
 * Protected by test/unit/auth/identity-seam.spec.ts (docs/qa/protected-tests.tsv).
 */

/**
 * CLOSED by PR-B. Kept as a named constant so the protected test can assert
 * that nothing reads it, and so a future reintroduction has to delete a symbol
 * that a test is watching.
 */
export const HEADER_IDENTITY_SEAM = 'x-actor-id';

/** STILL OPEN. The gateway reads this; the realtime PR replaces it with a token. */
export const HANDSHAKE_IDENTITY_SEAM = 'handshake.auth.actorId';

/** Environments in which self-asserted identity is tolerated. */
export const SEAM_ALLOWED_ENVIRONMENTS: ReadonlySet<string> = new Set(['local', 'test', 'ci']);

export class IdentitySeamRefused extends Error {
  constructor(appEnv: string) {
    super(
      `refusing to start: WebSocket identity is still the ${HANDSHAKE_IDENTITY_SEAM} seam ` +
        `(RT-001), and APP_ENV='${appEnv}' is not a local environment ` +
        `(allowed: ${[...SEAM_ALLOWED_ENVIRONMENTS].join(', ')}). ` +
        'PR-B replaced the HTTP half -- the x-actor-id header is no longer read on any ' +
        'HTTP path -- but realtime.gateway.ts still trusts the handshake, so this build ' +
        'must not run where an untrusted network can reach it. The realtime PR verifies ' +
        'the handshake token and deletes this guard.',
    );
    this.name = 'IdentitySeamRefused';
  }
}

/**
 * Throws unless the remaining (WebSocket) identity seam is permitted in this
 * environment. A missing APP_ENV is treated as `local`, matching readBuildInfo().
 */
export function assertHandshakeIdentitySeamAllowed(env: NodeJS.ProcessEnv = process.env): void {
  const appEnv = (env.APP_ENV ?? 'local').trim().toLowerCase();
  if (!SEAM_ALLOWED_ENVIRONMENTS.has(appEnv)) {
    throw new IdentitySeamRefused(appEnv);
  }
}
