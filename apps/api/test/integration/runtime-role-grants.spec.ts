/**
 * The shape of the API's runtime database identity.
 *
 * `chat_app` exists so the API does not have to connect as the database owner.
 * An owner connection bypasses row-level security and can drop the schema it
 * serves, so "which privileges does the runtime role hold" is a security
 * property, not a configuration detail -- and a privilege set that nobody
 * asserts is one that grows. The failure mode is specific and familiar: someone
 * hits a permission error, reaches for `grant all on all tables in schema chat`,
 * and the role silently becomes owner-shaped again. That change would pass code
 * review; it does not pass this file.
 *
 * These assertions are about the ROLE, not about any row, so they say nothing
 * about whether the API can currently run as it -- it cannot, because the RLS
 * policies admit no family member and nothing sets the per-request actor
 * context they read. That remains open and is recorded as a P0.
 */
import { PrismaService } from '@platform/prisma.service';

jest.setTimeout(60_000);

const prisma = new PrismaService();

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function privilegesOf(role: string): Promise<Map<string, Set<string>>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string; privilege_type: string }>>(
    `select table_name, privilege_type
       from information_schema.role_table_grants
      where table_schema = 'chat' and grantee = $1`,
    role,
  );
  const byTable = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = byTable.get(row.table_name) ?? new Set<string>();
    set.add(row.privilege_type);
    byTable.set(row.table_name, set);
  }
  return byTable;
}

describe('chat_app is a least-privileged runtime identity', () => {
  it('is not a superuser and cannot bypass row-level security', async () => {
    // BYPASSRLS is the attribute that would make every policy written for this
    // schema decorative. It is an attribute, not a grant, so no GRANT statement
    // can confer it by accident -- but an `alter role` could.
    const [role] = await prisma.$queryRawUnsafe<
      Array<{ rolsuper: boolean; rolbypassrls: boolean; rolcreatedb: boolean; rolcreaterole: boolean }>
    >(`select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
         from pg_roles where rolname = 'chat_app'`);

    expect(role).toBeDefined();
    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);
    expect(role.rolcreatedb).toBe(false);
    expect(role.rolcreaterole).toBe(false);
  });

  it('owns nothing in the schema it serves', async () => {
    // An owner is exempt from its own table's policies, so ownership would
    // reintroduce the very problem the role exists to remove.
    const [row] = await prisma.$queryRawUnsafe<Array<{ owned: bigint }>>(
      `select count(*) as owned
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'chat' and c.relowner = (select oid from pg_roles where rolname = 'chat_app')`,
    );

    expect(Number(row.owned)).toBe(0);
  });

  it('can read the account table, which is what forced the owner connection', async () => {
    // The original defect, asserted directly: chat.account had no grant to any
    // role, so the first statement of every login failed for any non-owner.
    const grants = await privilegesOf('chat_app');

    expect(grants.get('account')).toContain('SELECT');
    expect(grants.get('account_credential')).toContain('SELECT');
    expect(grants.get('session')).toContain('INSERT');
  });

  it('holds no TRUNCATE, REFERENCES or TRIGGER anywhere', async () => {
    const grants = await privilegesOf('chat_app');
    const offenders: string[] = [];

    for (const [table, privileges] of grants) {
      for (const p of ['TRUNCATE', 'REFERENCES', 'TRIGGER']) {
        if (privileges.has(p)) offenders.push(`${table}:${p}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('holds DELETE on exactly one table, and it is the one with no tombstone', async () => {
    // Everything else in this product is retracted rather than removed, so a
    // DELETE privilege beyond this is either dead or dangerous.
    const grants = await privilegesOf('chat_app');
    const deletable = [...grants.entries()]
      .filter(([, privileges]) => privileges.has('DELETE'))
      .map(([table]) => table)
      .sort();

    expect(deletable).toEqual(['message_reaction']);
  });

  it('cannot amend the append-only logs', async () => {
    const grants = await privilegesOf('chat_app');

    for (const log of ['event_log', 'audit_log']) {
      expect(grants.get(log)).toContain('INSERT');
      expect(grants.get(log)?.has('UPDATE') ?? false).toBe(false);
      expect(grants.get(log)?.has('DELETE') ?? false).toBe(false);
    }
  });

  it('cannot write a principal: staff, teachers, contacts and learners are read-only',
    async () => {
      // These are the academy's records. A chat request has no business editing
      // one, and the family tables are also the ones whose rows decide access.
      const grants = await privilegesOf('chat_app');

      for (const table of ['staff', 'teacher', 'contact', 'family', 'learner', 'organization']) {
        expect([...(grants.get(table) ?? [])].sort()).toEqual(['SELECT']);
      }
    });

  it('cannot reach the tables the API never uses', async () => {
    const grants = await privilegesOf('chat_app');

    for (const table of [
      'task',
      'subscription',
      'family_note',
      'family_state_cache',
      'core_event',
      'core_parent_inbox',
      'sync_state',
      'handoff',
      'schema_migrations',
    ]) {
      expect(grants.has(table)).toBe(false);
    }
  });

  it('is not granted blanket access: the privilege count stays close to the need',
    async () => {
      // A ceiling rather than an exact number, so adding one column-level need
      // does not fail the build, but `grant all on all tables` -- which on this
      // schema is more than three hundred privileges -- does.
      const grants = await privilegesOf('chat_app');
      const total = [...grants.values()].reduce((n, set) => n + set.size, 0);

      expect(total).toBeLessThanOrEqual(120);
      expect(grants.size).toBeLessThanOrEqual(45);
    });
});

describe('chat_service remains the system identity, and stays separate', () => {
  it('bypasses RLS, which is precisely why it is not the request path', async () => {
    const [role] = await prisma.$queryRawUnsafe<Array<{ rolbypassrls: boolean }>>(
      `select rolbypassrls from pg_roles where rolname = 'chat_service'`,
    );

    expect(role.rolbypassrls).toBe(true);
  });
});
