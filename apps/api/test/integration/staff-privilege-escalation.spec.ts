/**
 * chat.staff privilege escalation -- the database layer, exercised AS THE
 * REQUEST ROLE (chat_app), not as the owner.
 *
 * Before 20261013160000, `grant update on chat.staff to authenticated` (all
 * columns) plus the row-only policy `staff_managed_by_manager` let any staff
 * member make themselves `manager` and then rewrite other staff members' roles.
 * A test that runs as the owner proves nothing about that: the owner bypasses
 * RLS and holds every privilege. Every statement below therefore runs with
 * `current_user = chat_app` (asserted) and a staff subject set, inside a
 * transaction that is always rolled back.
 *
 * Connection: when DATABASE_APP_URL is set the suite logs in AS chat_app (a
 * real login); otherwise it uses `set local role chat_app` from the owner
 * connection, which switches to exactly chat_app's privileges and RLS.
 *
 * Synthetic fixtures only (QA gate G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { StaffProfileService } from '../../src/staff-profile/staff-profile.service';
import { StaffWorkloadService } from '../../src/staff-profile/staff-workload.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(90_000);

const g = buildGraph();
const ORG = '00000000-0000-0000-0000-000000000001';
const APP_URL = process.env.DATABASE_APP_URL;
const app = APP_URL ? new PrismaClient({ datasourceUrl: APP_URL }) : null;
const profiles = new StaffProfileService(g.prisma, g.authz, new StaffWorkloadService(g.prisma), g.storage);

interface World extends Scenario {
  superAdminId: string;
}
let w: World;

const SUBJECT = {
  admin: 'esc_admin_a@example.test',
  otherAdmin: 'esc_admin_b@example.test',
  manager: 'esc_manager_c@example.test',
  superAdmin: 'esc_owner_s@example.test',
};

type Tx = Pick<PrismaClient, '$queryRawUnsafe' | '$executeRawUnsafe'>;
const ROLLBACK = new Error('rollback');

/** Run `fn` as chat_app with `subject` as the authenticated staff member; always rolled back. */
async function asStaff<T>(subject: string, fn: (tx: Tx) => Promise<T>, opts: { forceSetRole?: boolean } = {}): Promise<T> {
  let out: T | undefined;
  const useApp = app !== null && !opts.forceSetRole;
  const client = useApp ? app! : g.prisma;
  await client
    .$transaction(async (tx) => {
      if (!useApp) await tx.$executeRawUnsafe(`set local role chat_app`);
      await tx.$executeRawUnsafe(`select set_config('chat.actor_subject', $1, true)`, subject);
      await tx.$executeRawUnsafe(`select set_config('chat.actor_organization', $1, true)`, ORG);
      const [who] = await tx.$queryRawUnsafe<Array<{ u: string; bypass: boolean }>>(
        `select current_user::text as u, (select rolbypassrls from pg_roles where rolname = current_user) as bypass`,
      );
      expect(who).toEqual({ u: 'chat_app', bypass: false });
      out = await fn(tx);
      throw ROLLBACK;
    })
    .catch((e: unknown) => {
      if (e !== ROLLBACK) throw e;
    });
  return out as T;
}

/** The statement's outcome as chat_app: rows affected, or the refusal. */
async function attempt(subject: string, sql: string): Promise<number | 'permission denied' | string> {
  return asStaff(subject, async (tx) => {
    try {
      return await tx.$executeRawUnsafe(sql);
    } catch (e) {
      const message = String((e as Error).message);
      return /permission denied/i.test(message) ? 'permission denied' : message;
    }
  });
}

const roleOf = async (id: string) =>
  (await g.prisma.staff.findUniqueOrThrow({ where: { id }, select: { role: true } })).role;

beforeAll(async () => {
  await g.prisma.$connect();
  await app?.$connect();
});
afterAll(async () => {
  await app?.$disconnect();
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  const s = await seed(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like 'esc\\_%@example.test'`);
  const link = async (staffId: string, subject: string) => {
    const accountId = randomUUID();
    await g.prisma.$executeRawUnsafe(
      `insert into chat.account (id, subject, kind) values ('${accountId}'::uuid, '${subject}', 'staff')`,
    );
    await g.prisma.$executeRawUnsafe(`update chat.staff set account_id = '${accountId}'::uuid where id = '${staffId}'::uuid`);
  };
  await link(s.ownerId, SUBJECT.admin);
  await link(s.otherAdminId, SUBJECT.otherAdmin);
  await link(s.managerId, SUBJECT.manager);
  const superAdminId = randomUUID();
  const superAccount = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.account (id, subject, kind) values ('${superAccount}'::uuid, '${SUBJECT.superAdmin}', 'staff')`,
  );
  await g.prisma.$transaction([
    g.prisma.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`),
    g.prisma.$executeRawUnsafe(
      `insert into chat.staff (id, name, role, account_id) values ('${superAdminId}'::uuid, 'owner_s', 'super_admin', '${superAccount}'::uuid)`,
    ),
  ]);
  w = { ...s, superAdminId };
});

// ===========================================================================
describe('the effective privileges are what the migration says', () => {
  // 20261013160000 left presence and last_activity_at; 20261014100000 added the
  // two profile columns, each guarded by chat.guard_staff_request_writes.
  it('authenticated and chat_app may update presence, last_activity_at, name and avatar_object_key -- nothing else', async () => {
    const rows = await g.prisma.$queryRawUnsafe<Array<{ grantee: string; col: string; can: boolean }>>(`
      select r.grantee, a.attname::text as col, has_column_privilege(r.grantee, 'chat.staff', a.attname, 'UPDATE') as can
        from unnest(array['authenticated', 'chat_app']) as r(grantee)
        cross join pg_attribute a
       where a.attrelid = 'chat.staff'::regclass and a.attnum > 0 and not a.attisdropped`);
    const writable = rows.filter((r) => r.can).map((r) => `${r.grantee}.${r.col}`).sort();
    expect(writable).toEqual([
      'authenticated.avatar_object_key',
      'authenticated.last_activity_at',
      'authenticated.name',
      'authenticated.presence',
      'chat_app.avatar_object_key',
      'chat_app.last_activity_at',
      'chat_app.name',
      'chat_app.presence',
    ]);
    // A non-trivial control: the protected columns exist and the owner can still write them.
    expect(rows.some((r) => r.col === 'role')).toBe(true);
  });

  it('the row policies on chat.staff: the original three plus the super admin\'s profile-field policy', async () => {
    const policies = await g.prisma.$queryRawUnsafe<Array<{ policyname: string }>>(
      `select policyname::text from pg_policies where schemaname = 'chat' and tablename = 'staff' order by 1`,
    );
    expect(policies.map((p) => p.policyname)).toEqual([
      'staff_managed_by_manager',
      'staff_organization_isolation',
      'staff_profile_fields_by_super_admin',
      'staff_readable_by_staff',
    ]);
  });
});

// ===========================================================================
describe('an ordinary admin, as chat_app', () => {
  it('cannot promote themselves to manager', async () => {
    expect(await attempt(SUBJECT.admin, `update chat.staff set role = 'manager' where id = chat.current_staff_id()`)).toBe(
      'permission denied',
    );
    expect(await roleOf(w.ownerId)).toBe('admin');
  });

  it('cannot promote themselves to super admin', async () => {
    expect(await attempt(SUBJECT.admin, `update chat.staff set role = 'super_admin' where id = chat.current_staff_id()`)).toBe(
      'permission denied',
    );
    expect(await roleOf(w.ownerId)).toBe('admin');
  });

  it('cannot change their own status, login binding, tenant or capacity', async () => {
    for (const set of [
      `is_active = false`,
      `left_at = now()`,
      `account_id = null`,
      `organization_id = organization_id`,
      `capacity_override = 99`,
    ]) {
      expect(await attempt(SUBJECT.admin, `update chat.staff set ${set} where id = chat.current_staff_id()`)).toBe(
        'permission denied',
      );
    }
    const row = await g.prisma.staff.findUniqueOrThrow({ where: { id: w.ownerId } });
    expect(row).toMatchObject({ role: 'admin', isActive: true, name: 'admin_a', avatarObjectKey: null });
  });

  // Already refused before 20261013160000 (the request role cannot write
  // chat.account); kept as an invariant, and the staff half is now refused too.
  it('cannot re-bind a staff row to their login through chat.link_staff_account()', async () => {
    const out = await attempt(SUBJECT.admin, `select chat.link_staff_account('${w.managerId}'::uuid, '${SUBJECT.admin}')`);
    expect(out).toBe('permission denied');
  });

  it('still cannot read the manager-only audit log, before or after the attempt', async () => {
    await g.prisma.auditLog.create({ data: { action: 'probe', entity: 'staff', entityId: w.ownerId, reason: 'fixture' } });
    const visible = () =>
      asStaff(SUBJECT.admin, async (tx) =>
        Number((await tx.$queryRawUnsafe<Array<{ n: number }>>(`select count(*)::int as n from chat.audit_log`))[0].n),
      );
    expect(await visible()).toBe(0);
    // The attempt and the read in ONE transaction: before 20261013160000 the
    // self-promotion succeeded here and the same transaction then read the log.
    const afterAttempt = await asStaff(SUBJECT.admin, async (tx) => {
      await tx.$executeRawUnsafe(`savepoint escalate`);
      try {
        await tx.$executeRawUnsafe(`update chat.staff set role = 'manager' where id = chat.current_staff_id()`);
      } catch {
        await tx.$executeRawUnsafe(`rollback to savepoint escalate`);
      }
      return Number((await tx.$queryRawUnsafe<Array<{ n: number }>>(`select count(*)::int as n from chat.audit_log`))[0].n);
    });
    expect(afterAttempt).toBe(0);
    // Control: a real manager does see it, so 0 is a denial and not an empty table.
    expect(
      await asStaff(SUBJECT.manager, async (tx) =>
        Number((await tx.$queryRawUnsafe<Array<{ n: number }>>(`select count(*)::int as n from chat.audit_log`))[0].n),
      ),
    ).toBeGreaterThan(0);
  });
});

// ===========================================================================
describe('profile fields on the request role (20261014100000)', () => {
  const UUID = '44444444-4444-4444-8444-444444444444';
  const keyFor = (staffId: string) => `avatars/staff/${staffId}/${UUID}`;

  it('a staff member sets their own photo key, but only under their own prefix', async () => {
    expect(await attempt(SUBJECT.admin, `update chat.staff set avatar_object_key = '${keyFor(w.ownerId)}' where id = chat.current_staff_id()`)).toBe(1);
    for (const key of [keyFor(w.otherAdminId), 'avatars/staff/x/y', `conversations/${w.ownerId}/${UUID}`]) {
      expect(String(await attempt(SUBJECT.admin, `update chat.staff set avatar_object_key = '${key}' where id = chat.current_staff_id()`))).toMatch(
        /own prefix/,
      );
    }
  });

  it('nobody but the person or the super admin changes a photo: an admin cannot reach the row, a manager is refused', async () => {
    expect(await attempt(SUBJECT.admin, `update chat.staff set avatar_object_key = null where id = '${w.otherAdminId}'::uuid`)).toBe(0);
    expect(
      String(await attempt(SUBJECT.manager, `update chat.staff set avatar_object_key = '${keyFor(w.ownerId)}' where id = '${w.ownerId}'::uuid`)),
    ).toMatch(/only the staff member or the super admin/);
  });

  it('only the super admin renames, and only inside their organization', async () => {
    expect(String(await attempt(SUBJECT.admin, `update chat.staff set name = 'Jawwid Management' where id = chat.current_staff_id()`))).toMatch(
      /only the super admin/,
    );
    expect(String(await attempt(SUBJECT.manager, `update chat.staff set name = 'renamed' where id = '${w.ownerId}'::uuid`))).toMatch(
      /only the super admin/,
    );
    expect(await attempt(SUBJECT.superAdmin, `update chat.staff set name = 'admin_a2' where id = '${w.ownerId}'::uuid`)).toBe(1);
    expect(
      await attempt(SUBJECT.superAdmin, `update chat.staff set avatar_object_key = '${keyFor(w.ownerId)}' where id = '${w.ownerId}'::uuid`),
    ).toBe(1);
    // The organization isolation policy still bounds the super admin.
    const otherOrg = randomUUID();
    const foreign = randomUUID();
    await g.prisma.$executeRawUnsafe(`insert into chat.organization (id, slug, display_name) values ('${otherOrg}'::uuid, 'esc-${otherOrg.slice(0, 8)}', 'Other')`);
    await g.prisma.$executeRawUnsafe(`insert into chat.staff (id, organization_id, name, role) values ('${foreign}'::uuid, '${otherOrg}'::uuid, 'admin_x', 'admin')`);
    try {
      expect(await attempt(SUBJECT.superAdmin, `update chat.staff set name = 'taken' where id = '${foreign}'::uuid`)).toBe(0);
    } finally {
      await g.prisma.$executeRawUnsafe(`delete from chat.staff where id = '${foreign}'::uuid`);
      await g.prisma.$executeRawUnsafe(`delete from chat.organization where id = '${otherOrg}'::uuid`);
    }
  });

  it('the super admin still cannot change a role, status or login binding on the request role', async () => {
    for (const set of [`role = 'manager'`, `is_active = false`, `account_id = null`]) {
      expect(await attempt(SUBJECT.superAdmin, `update chat.staff set ${set} where id = '${w.ownerId}'::uuid`)).toBe('permission denied');
    }
  });

  it('the super_admin gate is honoured only for a server-side caller, even if a role grant were re-added', async () => {
    const out = await asStaff(SUBJECT.admin, async (tx) => {
      await tx.$executeRawUnsafe(`reset role`);
      await tx.$executeRawUnsafe(`grant update (role) on chat.staff to chat_app`);
      await tx.$executeRawUnsafe(`set local role chat_app`);
      await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
      try {
        return await tx.$executeRawUnsafe(`update chat.staff set role = 'super_admin' where id = chat.current_staff_id()`);
      } catch (e) {
        return String((e as Error).message);
      }
    }, { forceSetRole: true });
    expect(String(out)).toMatch(/only by the bootstrap procedure/);
  });
});

// ===========================================================================
describe('a manager, as chat_app', () => {
  it('cannot promote themselves, demote themselves, or change another staff member\'s role', async () => {
    for (const sql of [
      `update chat.staff set role = 'super_admin' where id = chat.current_staff_id()`,
      `update chat.staff set role = 'admin' where id = chat.current_staff_id()`,
      `update chat.staff set role = 'manager' where id = '${w.ownerId}'::uuid`,
      `update chat.staff set role = 'coverage' where id = '${w.otherAdminId}'::uuid`,
    ]) {
      expect(await attempt(SUBJECT.manager, sql)).toBe('permission denied');
    }
    expect([await roleOf(w.managerId), await roleOf(w.ownerId), await roleOf(w.otherAdminId)]).toEqual([
      'manager',
      'admin',
      'admin',
    ]);
  });

  it('cannot deactivate someone directly, nor through chat.offboard_staff() on the request role', async () => {
    expect(await attempt(SUBJECT.manager, `update chat.staff set is_active = false, left_at = now() where id = '${w.otherAdminId}'::uuid`)).toBe(
      'permission denied',
    );
    // offboard_staff is SECURITY INVOKER and trusts a caller-supplied actor; on the
    // request role it now stops at its chat.staff UPDATE (server-side path below).
    const out = await attempt(SUBJECT.manager, `select * from chat.offboard_staff('${w.otherAdminId}'::uuid, 'test', null, null)`);
    expect(out).toBe('permission denied');
    expect((await g.prisma.staff.findUniqueOrThrow({ where: { id: w.otherAdminId } })).isActive).toBe(true);
  });
});

// ===========================================================================
describe('legitimate operations keep working', () => {
  it('a staff member updates their own presence and activity time', async () => {
    expect(
      await attempt(SUBJECT.admin, `update chat.staff set presence = 'away', last_activity_at = now() where id = chat.current_staff_id()`),
    ).toBe(1);
  });

  it('the row policy still decides WHICH rows: an admin cannot touch another admin, a manager can', async () => {
    expect(await attempt(SUBJECT.admin, `update chat.staff set presence = 'away' where id = '${w.otherAdminId}'::uuid`)).toBe(0);
    expect(await attempt(SUBJECT.manager, `update chat.staff set presence = 'away' where id = '${w.otherAdminId}'::uuid`)).toBe(1);
  });

  it('a staff member edits their own profile row on the request role', async () => {
    await profiles.updateProfile((await g.identity.resolveActor(w.ownerId))!, 'me', { jobTitle: 'Supervisor' });
    expect(
      await attempt(SUBJECT.admin, `update chat.staff_profile set about = 'mine' where staff_id = chat.current_staff_id()`),
    ).toBe(1);
    expect(
      await attempt(SUBJECT.admin, `update chat.staff_profile set about = 'theirs' where staff_id = '${w.otherAdminId}'::uuid`),
    ).toBe(0);
  });

  it('server-side administrative paths (owner connection) are unaffected', async () => {
    // Profile management through the API service.
    const sa = (await g.identity.resolveActor(w.superAdminId))!;
    const renamed = await profiles.updateProfile(sa, w.otherAdminId, { displayName: 'admin_b2' });
    expect(renamed.displayName).toBe('admin_b2');
    // Deactivation on the owner connection still works (and still obeys the
    // offboarding invariant: admin_b owns no family). chat.offboard_staff() is
    // NOT used here: it is broken on every path, before and after this
    // migration -- it calls a six-argument chat.log_event() that no longer
    // exists (documented in docs/admin/staff-profiles.md).
    await g.prisma.staff.update({ where: { id: w.otherAdminId }, data: { isActive: false, leftAt: new Date() } });
    expect((await g.prisma.staff.findUniqueOrThrow({ where: { id: w.otherAdminId } })).isActive).toBe(false);
    // And a family owner still cannot be deactivated by anyone.
    await expect(
      g.prisma.staff.update({ where: { id: w.ownerId }, data: { isActive: false, leftAt: new Date() } }),
    ).rejects.toThrow(/still the primary owner/);
  });

  it('one super admin per organization, enforced by the database even through the bootstrap gate', async () => {
    await expect(
      g.prisma.$transaction([
        g.prisma.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`),
        g.prisma.$executeRawUnsafe(`insert into chat.staff (name, role) values ('second_owner', 'super_admin')`),
      ]),
    ).rejects.toThrow(/23505[\s\S]*Key \(organization_id\)/);
    const [idx] = await g.prisma.$queryRawUnsafe<Array<{ def: string }>>(
      `select pg_get_indexdef('chat.staff_one_super_admin_per_organization'::regclass) as def`,
    );
    expect(idx.def).toMatch(/UNIQUE INDEX .* \(organization_id\) WHERE \(role = 'super_admin'::text\)/);
    // Another organization may have its own owner.
    const otherOrg = randomUUID();
    await g.prisma.$executeRawUnsafe(`insert into chat.organization (id, slug, display_name) values ('${otherOrg}'::uuid, 'esc-${otherOrg.slice(0, 8)}', 'Other')`);
    try {
      await g.prisma.$transaction([
        g.prisma.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`),
        g.prisma.$executeRawUnsafe(`insert into chat.staff (organization_id, name, role) values ('${otherOrg}'::uuid, 'other_owner', 'super_admin')`),
      ]);
      expect(await g.prisma.staff.count({ where: { role: 'super_admin' } })).toBe(2);
    } finally {
      await g.prisma.$transaction([
        g.prisma.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`),
        g.prisma.$executeRawUnsafe(`delete from chat.staff where organization_id = '${otherOrg}'::uuid`),
      ]);
      await g.prisma.$executeRawUnsafe(`delete from chat.organization where id = '${otherOrg}'::uuid`);
    }
  });

  it('the super admin role is still guarded for every writer, the owner included', async () => {
    await expect(
      g.prisma.$executeRawUnsafe(`update chat.staff set role = 'super_admin' where id = '${w.managerId}'::uuid`),
    ).rejects.toThrow(/bootstrap procedure/);
  });
});
