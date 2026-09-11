/**
 * PROTECTED (docs/qa/protected-tests.tsv) -- RT-001 containment.
 *
 * WHAT CHANGED IN PR-B, AND WHY THIS FILE STILL EXISTS.
 *
 * Phase 0 had two self-asserted-identity seams: `x-actor-id` on HTTP and
 * `handshake.auth.actorId` on the WebSocket. Both were contained by refusing to
 * start outside `local | test | ci`, and that refusal is what this file has
 * always pinned.
 *
 * PR-B closed the HTTP half: a verified bearer token is the only HTTP identity,
 * and the header is not read anywhere. The socket half is untouched -- the
 * gateway still takes `handshake.auth.actorId` at face value -- so the boot
 * guard NARROWS rather than disappears. Deleting it because "HTTP is fixed now"
 * would let a build whose sockets are still unauthenticated start in
 * production, which is worse than the state it was written for.
 *
 * So this suite now pins two things, and the second is new:
 *   1. the remaining (socket) seam still cannot start outside a local environment;
 *   2. the HTTP seam is genuinely closed -- no source file reads the header.
 *
 * The realtime PR deletes the guard, this file, and its registry line together,
 * when the handshake verifies a token.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertHandshakeIdentitySeamAllowed,
  HANDSHAKE_IDENTITY_SEAM,
  HEADER_IDENTITY_SEAM,
  IdentitySeamRefused,
  SEAM_ALLOWED_ENVIRONMENTS,
} from '@platform/identity-seam';

const SRC = join(__dirname, '..', '..', '..', 'src');

describe('RT-001 containment: the remaining seam never runs outside local', () => {
  it('refuses production', () => {
    expect(() => assertHandshakeIdentitySeamAllowed({ APP_ENV: 'production' })).toThrow(
      IdentitySeamRefused,
    );
  });

  it('refuses staging', () => {
    expect(() => assertHandshakeIdentitySeamAllowed({ APP_ENV: 'staging' })).toThrow(
      IdentitySeamRefused,
    );
  });

  it('refuses any environment that is not on the allow-list, whatever its casing', () => {
    for (const env of ['Production', 'PROD', 'prod', 'preview', 'demo', 'uat', ' ']) {
      expect(() => assertHandshakeIdentitySeamAllowed({ APP_ENV: env })).toThrow(
        IdentitySeamRefused,
      );
    }
  });

  it('allows exactly local, test and ci', () => {
    expect([...SEAM_ALLOWED_ENVIRONMENTS].sort()).toEqual(['ci', 'local', 'test']);
    for (const env of SEAM_ALLOWED_ENVIRONMENTS) {
      expect(() => assertHandshakeIdentitySeamAllowed({ APP_ENV: env })).not.toThrow();
    }
  });

  it('treats a missing APP_ENV as local, matching readBuildInfo()', () => {
    expect(() => assertHandshakeIdentitySeamAllowed({})).not.toThrow();
  });

  it('names the finding and the seam that is still open, so the operator knows why', () => {
    expect(() => assertHandshakeIdentitySeamAllowed({ APP_ENV: 'production' })).toThrow(
      /RT-001/,
    );
    expect(() => assertHandshakeIdentitySeamAllowed({ APP_ENV: 'production' })).toThrow(
      new RegExp(HANDSHAKE_IDENTITY_SEAM.replace(/\./g, '\\.')),
    );
  });
});

describe('the HTTP half is closed: nothing reads x-actor-id', () => {
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
});
