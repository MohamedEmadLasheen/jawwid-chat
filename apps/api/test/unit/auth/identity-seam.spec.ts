/**
 * PROTECTED (docs/qa/protected-tests.tsv) -- RT-001 containment.
 *
 * RE-VERSIONED 2026-09-23 (Phase 8). BOTH SEAMS ARE NOW CLOSED.
 *
 * Phase 0 had two self-asserted-identity seams: `x-actor-id` on HTTP and
 * `handshake.auth.actorId` on the WebSocket. Both were contained by refusing to
 * start outside `local | test | ci`, and that refusal is what this file used to
 * pin.
 *
 * PR-B closed the HTTP half. Phase 8 closed the WebSocket half: the gateway
 * verifies a handshake token with `AuthService.authenticate()` -- the same
 * method the HTTP guard uses -- and reads no client-supplied actor id. With
 * nothing left to contain, the boot guard was deleted along with the seam.
 *
 * The environment assertions are therefore GONE, not weakened: the thing they
 * asserted (a dangerous build must not start in production) is now structurally
 * unreachable, and a test that pins a deleted guard pins nothing. They are
 * replaced by assertions that the seams themselves cannot come back, which is
 * strictly more than the old file proved -- it watched one seam, this watches
 * two, plus the absence of the guard.
 *
 * What this suite pins now:
 *   1. no source file reads the `x-actor-id` header;
 *   2. no source file reads a client-supplied actor id from the handshake;
 *   3. `request.actor` has exactly one writer, the guard;
 *   4. the socket's identity comes from AuthService.authenticate() and nothing else;
 *   5. both seam names survive as watched constants, so a reintroduction has to
 *      delete a symbol a protected test is looking at.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HANDSHAKE_IDENTITY_FIELD, HEADER_IDENTITY_SEAM } from '@platform/identity-seam';

const SRC = join(__dirname, '..', '..', '..', 'src');

describe('RT-001: both identity seams are closed', () => {
  /** Every .ts file under src/, so a reintroduction anywhere is caught. */
  function sourceFiles(dir: string): string[] {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
    return readdirSync(dir).flatMap((entry: string) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return path.endsWith('.ts') ? [path] : [];
    });
  }

  it('no source file outside identity-seam.ts reads the header', () => {
    // The seam module keeps the NAME as a constant so this test has something
    // to watch; what must not exist is a READ of it.
    const offenders = sourceFiles(SRC)
      .filter((path) => !path.endsWith('identity-seam.ts'))
      .filter((path) => {
        const source = readFileSync(path, 'utf8');
        // A read looks like headers['x-actor-id'] or headers["x-actor-id"],
        // however it is spaced. A mention in a comment is not a read.
        return /headers\s*\[\s*['"]x-actor-id['"]\s*\]/i.test(source);
      });

    expect(offenders).toEqual([]);
  });

  it('the actor decorator reads request.actor, which only the guard writes', () => {
    const source = readFileSync(join(SRC, 'communication', 'api', 'actor.decorator.ts'), 'utf8');
    expect(source).toMatch(/request\.actor/);
    expect(source).not.toMatch(/headers\s*\[\s*['"]x-actor-id['"]/i);
  });

  it('the guard is the only writer of request.actor', () => {
    const writers = sourceFiles(SRC).filter((path) => {
      const source = readFileSync(path, 'utf8');
      return /\brequest\.actor\s*=/.test(source);
    });

    expect(writers.map((p) => p.slice(SRC.length + 1))).toEqual([
      join('platform', 'auth', 'auth.guard.ts'),
    ]);
  });

  it('the header constant is still exported, so a reintroduction has to delete a watched symbol', () => {
    expect(HEADER_IDENTITY_SEAM).toBe('x-actor-id');
  });

  // ---- the WebSocket half, closed in Phase 8 ----------------------------

  it('no source file reads a client-supplied actor id from the handshake', () => {
    // The old gateway line was `client.handshake.auth?.actorId`. Any spelling
    // that reaches for an actor id on the handshake is a reintroduction.
    const offenders = sourceFiles(SRC).filter((path) => {
      const source = readFileSync(path, 'utf8');
      return /handshake[\s\S]{0,40}?\bauth\b[^\n]{0,20}?\.?\s*\[?\s*['"]?actorId/.test(
        source.replace(/^\s*(\*|\/\/).*$/gm, ''), // strip comment lines: prose is not a read
      );
    });

    expect(offenders.map((p) => p.slice(SRC.length + 1))).toEqual([]);
  });

  it('the gateway takes its identity from AuthService.authenticate and nothing else', () => {
    const gateway = readFileSync(
      join(SRC, 'communication', 'realtime', 'realtime.gateway.ts'),
      'utf8',
    );
    expect(gateway).toMatch(/this\.auth\.authenticate\(/);
    // The actor room is named from the verified actor, never from the handshake.
    expect(gateway).toMatch(/room\.actor\(authenticated\.actor\.actorId\)/);
  });

  it('the handshake field name survives as a watched constant', () => {
    expect(HANDSHAKE_IDENTITY_FIELD).toBe('actorId');
  });

  it('the boot guard is gone, and main.ts no longer calls it', () => {
    // The guard existed to keep an unauthenticated-socket build out of
    // production. That build cannot be produced any more, so the guard was
    // deleted rather than left asserting something structurally true.
    // Matched on the DECLARATION, not on any mention: the module's own history
    // note names the deleted symbols, and prose recording what was removed is
    // the opposite of a reintroduction.
    const seam = readFileSync(join(SRC, 'platform', 'identity-seam.ts'), 'utf8');
    expect(seam).not.toMatch(/export\s+(function|const)\s+assertHandshakeIdentitySeamAllowed/);
    expect(seam).not.toMatch(/export\s+(const|class)\s+SEAM_ALLOWED_ENVIRONMENTS/);
    expect(seam).not.toMatch(/export\s+class\s+IdentitySeamRefused/);

    // main.ts must not CALL it. Again a call, not a mention.
    const main = readFileSync(join(SRC, 'main.ts'), 'utf8')
      .replace(/^\s*(\*|\/\/).*$/gm, '');
    expect(main).not.toMatch(/assertHandshakeIdentitySeamAllowed\s*\(/);
  });
});
