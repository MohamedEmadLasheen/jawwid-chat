/**
 * The self-asserted-identity seams, and the proof that both are closed.
 *
 * HISTORY. Phase 0 resolved the caller from `x-actor-id` on HTTP and
 * `handshake.auth.actorId` on the WebSocket, and contained both by refusing to
 * start outside `local | test | ci` (red-team RT-001 / NF-08).
 *
 * PR-B CLOSED THE HTTP HALF. `x-actor-id` is not read on any HTTP path: the
 * global AuthenticatedGuard verifies a bearer token and writes `request.actor`,
 * and `@ActorId()` reads nothing else.
 *
 * THE REALTIME PR CLOSED THE SOCKET HALF. `realtime.gateway.ts#handleConnection`
 * verifies `handshake.auth.token` through the SAME AuthService.authenticate()
 * the HTTP guard uses -- one verifier, one definition of who a caller is. The
 * boot guard that used to live here is therefore gone, and with it the reason
 * this product could not deliver a realtime notification in production.
 *
 * WHY THIS FILE STILL EXISTS. Both seam names are kept as exported constants so
 * that test/unit/auth/identity-seam.spec.ts has something to watch: a
 * reintroduction has to delete a symbol a protected test is asserting on, which
 * is exactly the tripwire JC-011 says a deletion must trip.
 *
 * Protected by test/unit/auth/identity-seam.spec.ts (docs/qa/protected-tests.tsv).
 */

/** CLOSED by PR-B. Nothing reads it; the spec proves it across all of src/. */
export const HEADER_IDENTITY_SEAM = 'x-actor-id';

/** CLOSED by the realtime PR. The handshake carries a verified token instead. */
export const HANDSHAKE_IDENTITY_SEAM = 'handshake.auth.actorId';

/** The credential the handshake carries now. */
export const HANDSHAKE_CREDENTIAL = 'handshake.auth.token';
