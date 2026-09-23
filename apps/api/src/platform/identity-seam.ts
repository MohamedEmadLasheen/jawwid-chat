/**
 * The self-asserted-identity seam — CLOSED, on both halves.
 *
 * HISTORY. Phase 0 resolved the caller from `x-actor-id` on HTTP and
 * `handshake.auth.actorId` on the WebSocket, and contained both by refusing to
 * start outside `local | test | ci` (red-team RT-001 / NF-08).
 *
 * PR-B closed the HTTP half: the global AuthenticatedGuard verifies a bearer
 * token and writes `request.actor`, and `@ActorId()` reads nothing else.
 *
 * PHASE 8 (2026-09-23) CLOSED THE WEBSOCKET HALF. `realtime.gateway.ts`
 * `handleConnection` now takes a token from the handshake and verifies it with
 * `AuthService.authenticate()` — the same method the HTTP guard uses, not a
 * second verifier — and `handshake.auth.actorId` is read nowhere.
 *
 * WHAT WENT WITH IT. `assertHandshakeIdentitySeamAllowed()`,
 * `IdentitySeamRefused`, `SEAM_ALLOWED_ENVIRONMENTS` and
 * `HANDSHAKE_IDENTITY_SEAM` are deleted, and `main.ts` no longer calls the
 * guard. The guard existed to keep a build whose sockets were unauthenticated
 * out of production; that build no longer exists, and leaving the check would
 * only assert something that is now structurally true.
 *
 * WHAT STAYS, AND WHY. `HEADER_IDENTITY_SEAM` remains a named constant with no
 * reader. It is the tripwire: `test/unit/auth/identity-seam.spec.ts`
 * (docs/qa/protected-tests.tsv) asserts that no source file reads it, so
 * reintroducing header identity means deleting a symbol a protected test is
 * watching rather than quietly adding a line.
 *
 * Protected by test/unit/auth/identity-seam.spec.ts.
 */

/**
 * CLOSED by PR-B. Kept as a named constant so the protected test can assert
 * that nothing reads it, and so a future reintroduction has to delete a symbol
 * that a test is watching.
 */
export const HEADER_IDENTITY_SEAM = 'x-actor-id';

/**
 * CLOSED by Phase 8. Kept for the same reason as the header above: the
 * protected test asserts that no source file reads this handshake field, and a
 * constant with a watcher is harder to reintroduce than a bare string.
 *
 * Deliberately NOT spelled as the dotted path any more — the tripwire greps for
 * the code shape, and a constant containing it would match itself.
 */
export const HANDSHAKE_IDENTITY_FIELD = 'actorId';
