/**
 * PROTECTED (docs/qa/protected-tests.tsv).
 *
 * The fail-closed gate on the runtime database connection.
 *
 * Every row-level security policy in this schema is inert for a connection that
 * owns the schema, is a superuser, may create objects in it, or carries
 * BYPASSRLS. That is not a degraded mode -- it is the second authorization
 * layer switched off, silently, with every document still describing it as a
 * control. It is exactly the state Phase 1 shipped in and the closure pass
 * exists to make impossible.
 *
 * So the process refuses to start on one, and this suite pins each of the four
 * ways a connection can be too privileged. A test that only checked the happy
 * path would pass on a build that had lost the check entirely.
 */
import {
  assertRuntimeRoleAcceptable,
  isLeastPrivileged,
  OWNER_CONNECTION_ALLOWED_ENVIRONMENTS,
  RuntimeRoleTooPrivileged,
  type RuntimeRoleReport,
} from '@platform/auth/startup';

const leastPrivileged: RuntimeRoleReport = {
  role_name: 'chat_app',
  is_superuser: false,
  bypasses_rls: false,
  owns_schema: false,
  can_create_in_schema: false,
};

/** The four ways a connection can be too privileged, one at a time. */
const unsafe: Array<[string, RuntimeRoleReport]> = [
  ['a superuser', { ...leastPrivileged, role_name: 'postgres', is_superuser: true }],
  ['a BYPASSRLS role', { ...leastPrivileged, role_name: 'chat_service', bypasses_rls: true }],
  ['the schema owner', { ...leastPrivileged, role_name: 'jawwid', owns_schema: true }],
  ['a role that may CREATE in the schema', { ...leastPrivileged, can_create_in_schema: true }],
];

describe('the runtime role gate', () => {
  it('accepts a least-privileged connection', () => {
    expect(isLeastPrivileged(leastPrivileged)).toBe(true);
    expect(() =>
      assertRuntimeRoleAcceptable(leastPrivileged, { APP_ENV: 'production' }),
    ).not.toThrow();
  });

  it.each(unsafe)('refuses %s in production', (_label, report) => {
    expect(isLeastPrivileged(report)).toBe(false);
    expect(() => assertRuntimeRoleAcceptable(report, { APP_ENV: 'production' })).toThrow(
      RuntimeRoleTooPrivileged,
    );
  });

  it.each(unsafe)('refuses %s in staging too', (_label, report) => {
    expect(() => assertRuntimeRoleAcceptable(report, { APP_ENV: 'staging' })).toThrow(
      RuntimeRoleTooPrivileged,
    );
  });

  it('refuses a connection that is over-privileged in more than one way, and names each', () => {
    const owner: RuntimeRoleReport = {
      role_name: 'postgres',
      is_superuser: true,
      bypasses_rls: true,
      owns_schema: true,
      can_create_in_schema: true,
    };
    try {
      assertRuntimeRoleAcceptable(owner, { APP_ENV: 'production' });
      throw new Error('expected a refusal');
    } catch (e) {
      expect(e).toBeInstanceOf(RuntimeRoleTooPrivileged);
      const message = (e as Error).message;
      expect(message).toContain('superuser');
      expect(message).toContain('bypasses row-level security');
      expect(message).toContain('owns the chat schema');
      // and it names the fix, because an operator reading a boot failure at
      // 3am should not have to find the document that explains it
      expect(message).toContain('chat_app');
      expect(message).toContain('DATABASE_SERVICE_URL');
    }
  });

  it('refuses an unknown environment, rather than treating it as development', () => {
    for (const appEnv of ['Production', 'PROD', 'preview', 'demo', 'uat', '']) {
      expect(() =>
        assertRuntimeRoleAcceptable(unsafe[0][1], { APP_ENV: appEnv }),
      ).toThrow(RuntimeRoleTooPrivileged);
    }
  });

  it('tolerates an owner connection ONLY in local, test and ci', () => {
    // Deliberate: migrations, `prisma db push` and the fixtures need DDL, and a
    // developer's laptop is not the threat model. The allow-list is the whole
    // of the exception, and widening it is a security decision.
    expect([...OWNER_CONNECTION_ALLOWED_ENVIRONMENTS].sort()).toEqual(['ci', 'local', 'test']);
    for (const appEnv of OWNER_CONNECTION_ALLOWED_ENVIRONMENTS) {
      for (const [, report] of unsafe) {
        expect(() => assertRuntimeRoleAcceptable(report, { APP_ENV: appEnv })).not.toThrow();
      }
    }
  });

  it('treats a missing APP_ENV as local, matching readBuildInfo()', () => {
    expect(() => assertRuntimeRoleAcceptable(unsafe[0][1], {})).not.toThrow();
  });
});
