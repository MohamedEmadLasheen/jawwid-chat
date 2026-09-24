/**
 * The BYPASSRLS preflight, against a real PostgreSQL.
 *
 * `20260910120200_chat_connection_roles.sql` grants BYPASSRLS unconditionally,
 * and `apply.sh` runs with ON_ERROR_STOP=1. On a provider that withholds the
 * privilege, that combination stops at the seventeenth migration with the
 * database partially applied. `scripts/db/preflight-role-capability.sh` runs
 * first and refuses the deployment before anything is touched.
 *
 * Both directions are exercised here, because a preflight that cannot fail is
 * worth nothing: a superuser (capable) and a CREATEROLE-but-not-superuser role
 * (the shape a restricted managed provider presents).
 *
 * This asserts OUR behaviour on a capability boundary PostgreSQL itself
 * enforces. It says nothing about which providers grant it — that remains an
 * external verification item, and no provider is named in the script or here.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

jest.setTimeout(60_000);

const DATABASE_URL = process.env.DATABASE_URL;
const SCRIPT = 'scripts/db/preflight-role-capability.sh';
const REPO_ROOT = `${__dirname}/../../../..`;

/** Runs the preflight with an explicit PSQL command. Returns {code, output}. */
function runPreflight(psql: string): { code: number; output: string } {
  try {
    const output = execFileSync('bash', [SCRIPT], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, PSQL: psql, DATABASE_URL: DATABASE_URL ?? '' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { code: 0, output };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const describeIfDb = DATABASE_URL ? describe : describe.skip;

/**
 * Raw SQL through psql, the way `schema-invariants.spec.ts` already does it.
 * `pg` is not a dependency of this project and this test is not a reason to
 * make it one.
 */
function sql(statement: string): string {
  return execFileSync('psql', [DATABASE_URL!, '-q', '-v', 'ON_ERROR_STOP=1', '-tAc', statement], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

describeIfDb('database role capability preflight', () => {
  const restricted = `preflight_restricted_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

  beforeAll(() => {
    // CREATEROLE but NOT superuser: enough to make roles, not enough to confer
    // BYPASSRLS. This is the shape a restricted managed provider presents.
    sql(`create role ${restricted} login createrole password 'preflight-probe'`);
  });

  afterAll(() => {
    sql(`drop role if exists ${restricted}`);
  });

  it('passes when the role can confer BYPASSRLS', () => {
    const { code, output } = runPreflight(`psql -v ON_ERROR_STOP=1 ${DATABASE_URL}`);
    expect(code).toBe(0);
    expect(output).toMatch(/BYPASSRLS can be granted/);
  });

  it('fails when the role cannot, and names the migration it blocks', () => {
    const url = new URL(DATABASE_URL!);
    url.username = restricted;
    url.password = 'preflight-probe';

    const { code, output } = runPreflight(`psql -v ON_ERROR_STOP=1 ${url.toString()}`);

    expect(code).toBe(1);
    expect(output).toMatch(/PREFLIGHT FAILED/);
    expect(output).toMatch(/20260910120200_chat_connection_roles\.sql/);
    // The operator needs to know it is a provider question, not a retry.
    expect(output).toMatch(/provider/i);
  });

  it('leaves no probe role behind, in either direction', () => {
    runPreflight(`psql -v ON_ERROR_STOP=1 ${DATABASE_URL}`);
    // The probe runs inside a transaction that is always rolled back.
    const leaked = sql(
      `select count(*) from pg_roles where rolname like 'jawwid_preflight_probe_%'`,
    );
    expect(leaked).toBe('0');
  });

  it('does not weaken the migration it guards', () => {
    // The preflight must not have made BYPASSRLS conditional. If this ever
    // fails, the security boundary in RLS-STRATEGY section 3 has moved.
    const migration = execFileSync(
      'cat',
      ['supabase/migrations/20260910120200_chat_connection_roles.sql'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    expect(migration).toMatch(/alter role chat_service bypassrls/);
    expect(migration).toMatch(/alter role chat_app\s+nobypassrls/);
  });
});
