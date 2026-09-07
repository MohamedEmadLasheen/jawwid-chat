/**
 * PROTECTED (docs/qa/protected-tests.tsv) -- RT-001 / NF-08 closed by design.
 *
 * SUPERSEDES test/unit/auth/identity-seam.spec.ts, which pinned the CONTAINMENT
 * of the header-identity seam: a build that read `x-actor-id` was refused
 * outside local/test/ci. Phase 1 removed the seam, so that containment has
 * nothing left to contain and the state it guarded is now unrepresentable.
 *
 * This suite is the stronger replacement. Rather than proving the seam cannot
 * be DEPLOYED, it proves the seam does not EXIST -- no source file reads a
 * client-supplied identity -- and that authentication refuses to start
 * unconfigured, which is the way a forgeable-token build could otherwise come
 * back.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertAuthSecretsConfigured,
  AuthSecretsMissing,
  MINIMUM_SECRET_LENGTH,
} from '@platform/auth/startup';

const SRC = join(__dirname, '..', '..', '..', 'src');

/**
 * Every occurrence of a pattern in EXECUTABLE source under src/.
 *
 * Comment lines are excluded on purpose. The removal of the seam is documented
 * where it used to live -- that prose is the record of why these files look the
 * way they do, and a test that forbade naming the defect would delete its own
 * explanation.
 */
function grep(pattern: string): string[] {
  let out: string;
  try {
    out = execFileSync('grep', ['-rn', '--include=*.ts', pattern, SRC], { encoding: 'utf8' });
  } catch {
    // grep exits 1 when there is no match, which is the passing case.
    return [];
  }
  return out
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .filter((line) => {
      const code = line.slice(line.indexOf(':', line.indexOf(':') + 1) + 1).trim();
      return !code.startsWith('//') && !code.startsWith('*') && !code.startsWith('/*');
    });
}

describe('the client can no longer name its own identity', () => {
  it('no source file reads the x-actor-id header', () => {
    expect(grep('x-actor-id')).toEqual([]);
  });

  it('no source file reads handshake.auth.actorId', () => {
    expect(grep('handshake.auth?.actorId')).toEqual([]);
    expect(grep('auth\\.actorId')).toEqual([]);
  });

  it('the WebSocket handshake authenticates a token, exactly as HTTP does', () => {
    const gateway = readFileSync(
      join(SRC, 'communication', 'realtime', 'realtime.gateway.ts'),
      'utf8',
    );
    expect(gateway).toContain('handshake.auth?.token');
    expect(gateway).toContain('this.auth.authenticate(token)');
  });

  it('the authentication guard is registered globally, so routes are protected by default', () => {
    const module = readFileSync(join(SRC, 'platform', 'auth', 'auth.module.ts'), 'utf8');
    expect(module).toContain('APP_GUARD');
    expect(module).toContain('AuthGuard');
  });
});

describe('authentication refuses to start unconfigured', () => {
  const good = {
    JWT_ACCESS_SECRET: 'a'.repeat(MINIMUM_SECRET_LENGTH),
    JWT_REFRESH_SECRET: 'b'.repeat(MINIMUM_SECRET_LENGTH),
  };

  it('accepts two distinct, long enough secrets', () => {
    expect(() => assertAuthSecretsConfigured({ ...good })).not.toThrow();
  });

  it('refuses a missing secret', () => {
    expect(() => assertAuthSecretsConfigured({ JWT_ACCESS_SECRET: good.JWT_ACCESS_SECRET })).toThrow(
      AuthSecretsMissing,
    );
    expect(() => assertAuthSecretsConfigured({})).toThrow(AuthSecretsMissing);
  });

  it('refuses a secret shorter than the minimum', () => {
    expect(() =>
      assertAuthSecretsConfigured({ ...good, JWT_ACCESS_SECRET: 'short' }),
    ).toThrow(AuthSecretsMissing);
  });

  it('refuses reusing one secret for both purposes', () => {
    expect(() =>
      assertAuthSecretsConfigured({
        JWT_ACCESS_SECRET: good.JWT_ACCESS_SECRET,
        JWT_REFRESH_SECRET: good.JWT_ACCESS_SECRET,
      }),
    ).toThrow(AuthSecretsMissing);
  });

  it('names every problem it found, not merely the first', () => {
    try {
      assertAuthSecretsConfigured({ JWT_ACCESS_SECRET: 'x' });
      throw new Error('expected a refusal');
    } catch (e) {
      expect(e).toBeInstanceOf(AuthSecretsMissing);
      expect((e as AuthSecretsMissing).problems).toHaveLength(2);
    }
  });
});
