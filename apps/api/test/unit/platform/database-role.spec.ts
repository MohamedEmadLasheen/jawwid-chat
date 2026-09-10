import {
  currentDatabaseRole,
  datasourceUrlForRole,
  declareDatabaseRole,
  resetDatabaseRole,
  WorkerDatabaseUrlMissing,
} from '@platform/database-role';
import {
  assertRuntimeRoleAcceptable,
  assertWorkerRuntimeRole,
  WorkerRuntimeRoleWrong,
  type RuntimeRoleReport,
} from '@platform/auth/startup';

/**
 * C-1 and C-2: the worker connects as chat_service, the API as chat_app, and
 * neither can become the other by accident.
 *
 * The defect these cover was silent by construction: a worker on chat_app
 * claims outbox rows, reads nothing it needs to route them, marks every event
 * published and delivers none -- with no error anywhere. Every assertion below
 * is about making one of the steps toward that state impossible.
 */

const APP_URL = 'postgres://chat_app:x@localhost:5432/db';
const SERVICE_URL = 'postgres://chat_service:x@localhost:5432/db';

const report = (over: Partial<RuntimeRoleReport> = {}): RuntimeRoleReport => ({
  role_name: 'chat_service',
  is_superuser: false,
  bypasses_rls: true,
  owns_schema: false,
  can_create_in_schema: false,
  ...over,
});

afterEach(() => resetDatabaseRole());

describe('C-1 datasource selection', () => {
  it('defaults to the API role, which is the RLS-enforced one', () => {
    // The default matters more than it looks: anything that has not declared
    // itself -- a script, a test, a future entrypoint -- must get the
    // least-privileged connection, never the one that ignores every policy.
    expect(currentDatabaseRole()).toBe('api');
  });

  it('gives the API no override, so schema.prisma DATABASE_URL stands', () => {
    expect(datasourceUrlForRole('api', { DATABASE_URL: APP_URL })).toBeUndefined();
  });

  it('gives the worker DATABASE_SERVICE_URL', () => {
    expect(datasourceUrlForRole('worker', { DATABASE_SERVICE_URL: SERVICE_URL })).toBe(
      SERVICE_URL,
    );
  });

  // Test 3. The whole point of C-1.
  it('THROWS for a worker with no DATABASE_SERVICE_URL, even when DATABASE_URL is set', () => {
    expect(() => datasourceUrlForRole('worker', { DATABASE_URL: APP_URL })).toThrow(
      WorkerDatabaseUrlMissing,
    );
  });

  it('treats a blank DATABASE_SERVICE_URL as missing', () => {
    // A secret store that renders an empty value produces a present-but-blank
    // variable, and '' is not a connection string.
    for (const blank of ['', '   ', '\t\n']) {
      expect(() =>
        datasourceUrlForRole('worker', { DATABASE_SERVICE_URL: blank, DATABASE_URL: APP_URL }),
      ).toThrow(WorkerDatabaseUrlMissing);
    }
  });

  // Test 4.
  it('with both variables set, the worker uses the service URL and ignores DATABASE_URL', () => {
    const url = datasourceUrlForRole('worker', {
      DATABASE_URL: APP_URL,
      DATABASE_SERVICE_URL: SERVICE_URL,
    });
    expect(url).toBe(SERVICE_URL);
    expect(url).not.toBe(APP_URL);
  });

  // Test 5. The dangerous direction: an API that received the service URL.
  it('with both variables set, an undeclared process stays on DATABASE_URL', () => {
    // Presence of DATABASE_SERVICE_URL must never be what selects the role --
    // one shared env file would otherwise hand the API a BYPASSRLS connection
    // and turn a delivery bug into an authorization bug.
    expect(
      datasourceUrlForRole(undefined, {
        DATABASE_URL: APP_URL,
        DATABASE_SERVICE_URL: SERVICE_URL,
      }),
    ).toBeUndefined();
  });

  it('declareDatabaseRole is what switches the resolution', () => {
    expect(datasourceUrlForRole(undefined, { DATABASE_SERVICE_URL: SERVICE_URL })).toBeUndefined();
    declareDatabaseRole('worker');
    expect(currentDatabaseRole()).toBe('worker');
    expect(datasourceUrlForRole(undefined, { DATABASE_SERVICE_URL: SERVICE_URL })).toBe(
      SERVICE_URL,
    );
  });
});

describe('C-2 worker runtime role assertion', () => {
  // Test 7.
  it('accepts chat_service with BYPASSRLS', () => {
    expect(() => assertWorkerRuntimeRole(report())).not.toThrow();
  });

  // Test 6. A DATABASE_SERVICE_URL pointed at chat_app connects perfectly.
  // Only asking the database catches it.
  it('REFUSES chat_app', () => {
    expect(() =>
      assertWorkerRuntimeRole(report({ role_name: 'chat_app', bypasses_rls: false })),
    ).toThrow(WorkerRuntimeRoleWrong);
  });

  it('refuses every other role, including ones that would technically work', () => {
    // service_role, postgres and a managed-Postgres admin all bypass RLS, so a
    // check on bypasses_rls alone would admit them and hand the worker far more
    // than it needs.
    for (const role_name of ['service_role', 'postgres', 'doadmin', 'authenticated']) {
      expect(() =>
        assertWorkerRuntimeRole(report({ role_name, bypasses_rls: true, is_superuser: true })),
      ).toThrow(WorkerRuntimeRoleWrong);
    }
  });

  it('refuses a chat_service whose BYPASSRLS was revoked', () => {
    // The right name on a role that cannot bypass RLS reintroduces the original
    // defect wearing the correct label.
    expect(() => assertWorkerRuntimeRole(report({ bypasses_rls: false }))).toThrow(
      WorkerRuntimeRoleWrong,
    );
  });

  it('refuses an unknown role rather than reading a field off undefined', () => {
    expect(() => assertWorkerRuntimeRole(undefined)).toThrow(WorkerRuntimeRoleWrong);
  });

  it('names no connection string in its message', () => {
    // The message is read from logs; a DSN carries a password.
    const message = new WorkerRuntimeRoleWrong(report({ role_name: 'chat_app' })).message;
    expect(message).toContain('chat_app');
    expect(message).toContain('chat_service');
    expect(message).not.toMatch(/postgres:\/\//);
  });
});

describe('the two assertions stay opposites', () => {
  it('the API check rejects the role the worker requires', () => {
    // If these two were ever merged into one parameterised function, a caller
    // could get the parameter backwards and the mistake would be silent. This
    // test exists to document that they are deliberately inverse.
    const env = { APP_ENV: 'production' };
    expect(() => assertRuntimeRoleAcceptable(report(), env)).toThrow();
    expect(() => assertWorkerRuntimeRole(report())).not.toThrow();
  });

  it('the worker check rejects the role the API requires', () => {
    const chatApp = report({ role_name: 'chat_app', bypasses_rls: false });
    expect(() => assertRuntimeRoleAcceptable(chatApp, { APP_ENV: 'production' })).not.toThrow();
    expect(() => assertWorkerRuntimeRole(chatApp)).toThrow();
  });
});
