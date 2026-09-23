/**
 * PROTECTED (docs/qa/protected-tests.tsv) -- RT-001 containment.
 *
 * WHAT THIS FILE PINNED, AND WHAT IT PINS NOW.
 *
 * Phase 0 had two self-asserted-identity seams: `x-actor-id` on HTTP and
 * `handshake.auth.actorId` on the WebSocket. Both were contained by a boot
 * guard that refused to start outside `local | test | ci`, and that refusal is
 * what this suite used to assert.
 *
 * PR-B closed the HTTP half. The realtime PR closed the socket half: the
 * handshake carries `auth: { token }` and is verified by the same
 * AuthService.authenticate() the global HTTP guard uses. With no seam left,
 * there is nothing for a boot guard to contain -- and the guard's absence is
 * what finally lets a realtime notification reach a parent in production, which
 * is the whole point of the feature it was blocking.
 *
 * So the assertions MOVE rather than disappear, and they get stronger. A boot
 * guard is a containment measure: it proves a build will not run somewhere
 * dangerous, not that the danger is gone. These assertions prove the danger is
 * gone -- that no source file reads either seam, that the gateway authenticates
 * through the one shared verifier, and that each identity is written in exactly
 * one place.
 *
 * Reintroducing either seam has to delete a symbol this suite watches, which is
 * precisely the tripwire JC-011 exists to trip.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  HANDSHAKE_CREDENTIAL,
  HANDSHAKE_IDENTITY_SEAM,
  HEADER_IDENTITY_SEAM,
} from '@platform/identity-seam';

const SRC = join(__dirname, '..', '..', '..', 'src');
const GATEWAY = join(SRC, 'communication', 'realtime', 'realtime.gateway.ts');

/** Every .ts file under src/, so a reintroduction anywhere is caught. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry: string) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

const outsideSeamModule = (): string[] =>
  sourceFiles(SRC).filter((path) => !path.endsWith('identity-seam.ts'));

describe('the HTTP half is closed: nothing reads x-actor-id', () => {
  it('no source file outside identity-seam.ts reads the header', () => {
    const offenders = outsideSeamModule().filter((path) => {
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
    const writers = sourceFiles(SRC).filter((path) =>
      /\brequest\.actor\s*=/.test(readFileSync(path, 'utf8')),
    );

    expect(writers.map((p) => p.slice(SRC.length + 1))).toEqual([
      join('platform', 'auth', 'auth.guard.ts'),
    ]);
  });

  it('the header constant is still exported, so a reintroduction deletes a watched symbol', () => {
    expect(HEADER_IDENTITY_SEAM).toBe('x-actor-id');
  });
});

describe('the socket half is closed: nothing reads handshake.auth.actorId', () => {
  it('no source file reads an actor id off the handshake', () => {
    // This is the seam itself: a client naming the actor it wishes to be.
    const offenders = outsideSeamModule().filter((path) =>
      /handshake[\s\S]{0,40}?\.auth\s*(\?\.)?\s*\.?\s*\[?\s*['"]?actorId/i.test(
        readFileSync(path, 'utf8'),
      ),
    );

    expect(offenders).toEqual([]);
  });

  it('the gateway authenticates the handshake through the shared verifier', () => {
    const gateway = readFileSync(GATEWAY, 'utf8');

    // The SAME verifier as HTTP. A socket-specific copy would be a second place
    // for "who is this caller" to be answered, and two answers drift.
    expect(gateway).toMatch(/this\.auth\.authenticate\(/);
    expect(gateway).toMatch(/handshake\.auth\?\.token/);
  });

  it('a handshake that does not authenticate is disconnected, not admitted', () => {
    const gateway = readFileSync(GATEWAY, 'utf8');
    // The refusal must be unconditional on the failure path: no default actor,
    // no anonymous socket, no "continue without an actor".
    expect(gateway).toMatch(/if\s*\(!authenticated\)\s*\{[\s\S]{0,400}?client\.disconnect\(true\)/);
  });

  it('the gateway never takes a credential from the query string', () => {
    // A token in a query string lands in access logs and proxy logs, where it
    // outlives the session it belongs to.
    const gateway = readFileSync(GATEWAY, 'utf8');
    expect(gateway).not.toMatch(/handshake\.query/);
  });

  it('handleConnection is the only writer of a socket actor', () => {
    const writers = sourceFiles(SRC).filter((path) =>
      /\bclient\.actor\s*=/.test(readFileSync(path, 'utf8')),
    );

    expect(writers.map((p) => p.slice(SRC.length + 1))).toEqual([
      join('communication', 'realtime', 'realtime.gateway.ts'),
    ]);
  });

  it('both seam constants are still exported, so a reintroduction deletes a watched symbol', () => {
    expect(HANDSHAKE_IDENTITY_SEAM).toBe('handshake.auth.actorId');
    expect(HANDSHAKE_CREDENTIAL).toBe('handshake.auth.token');
  });

  it('no boot guard remains, because there is no seam left to contain', () => {
    // Asserted rather than assumed: a guard that outlived its seam would keep
    // refusing to start in production for a reason that is no longer true, and
    // the feature it blocks -- realtime notification delivery -- is the one this
    // product cannot ship without.
    const main = readFileSync(join(SRC, 'main.ts'), 'utf8');
    expect(main).not.toMatch(/assertHandshakeIdentitySeamAllowed\s*\(/);
  });
});
