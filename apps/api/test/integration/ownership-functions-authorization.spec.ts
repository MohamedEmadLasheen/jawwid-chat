/**
 * Ownership functions -- who may transfer, offboard and assign, and who the
 * audit trail says did it.
 *
 * Before 20261014090000 the three functions authorized with
 * `coalesce(p_actor_id, chat.current_staff_id())`: naming a manager was enough.
 * They were executable by every role, and chat.family.owner_id could also be
 * changed directly by any request-role caller who set
 * chat.transferring_ownership for themselves. 20261014090100 then repaired the
 * event write that made both functions fail on every path.
 *
 * Request-role statements run AS chat_app (asserted) -- over a real login when
 * DATABASE_APP_URL is set -- inside transactions that are always rolled back.
 * Server-side statements run on the owner connection, which is the path the API
 * uses. Each refusal is also checked to have changed NOTHING: family owner,
 * staff state, audit log and event log.
 *
 * Synthetic fixtures only (QA gate G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(90_000);

const g = buildGraph();
const ORG = '00000000-0000-0000-0000-000000000001';
const APP_URL = process.env.DATABASE_APP_URL;
const app = APP_URL ? new PrismaClient({ datasourceUrl: APP_URL }) : null;

const SUBJECT = { admin: 'own_admin_a@example.test', manager: 'own_manager_c@example.test' };

interface World extends Scenario {
  inactiveManagerId: string;
  foreignManagerId: string;
  foreignOrg: string;
}
let w: World;

type Tx = Pick<PrismaClient, '$queryRawUnsafe' | '$executeRawUnsafe'>;
const ROLLBACK = new Error('rollback');

async function asStaff<T>(subject: string, fn: (tx: Tx) => Promise<T>, opts: { forceSetRole?: boolean } = {}): Promise<T> {
  let out: T | undefined;
  const useApp = app && !opts.forceSetRole;
  const client = useApp ? app! : g.prisma;
  await client
    .$transaction(async (tx) => {
      if (!useApp) await tx.$executeRawUnsafe(`set local role chat_app`);
      await tx.$executeRawUnsafe(`select set_config('chat.actor_subject', $1, true)`, subject);
      await tx.$executeRawUnsafe(`select set_config('chat.actor_organization', $1, true)`, ORG);
      const [who] = await tx.$queryRawUnsafe<Array<{ u: string }>>(`select current_user::text as u`);
      expect(who.u).toBe('chat_app');
      out = await fn(tx);
      throw ROLLBACK;
    })
    .catch((e: unknown) => {
      if (e !== ROLLBACK) throw e;
    });
  return out as T;
}

/** The outcome of one statement: rows, or the database's refusal text. */
async function run(tx: Tx, sql: string): Promise<number | string> {
  try {
    return await tx.$executeRawUnsafe(sql);
  } catch (e) {
    return String((e as Error).message);
  }
}
const asRequest = (subject: string, sql: string) => asStaff(subject, (tx) => run(tx, sql));
async function asServer(sql: string): Promise<number | string> {
  return run(g.prisma, sql);
}

interface Snapshot {
  owner: string;
  adminActive: boolean;
  audit: number;
  events: number;
}
async function snapshot(): Promise<Snapshot> {
  const [row] = await g.prisma.$queryRawUnsafe<Array<Snapshot>>(`
    select (select owner_id::text from chat.family where id = '${w.familyId}'::uuid) as owner,
           (select is_active from chat.staff where id = '${w.ownerId}'::uuid) as "adminActive",
           (select count(*)::int from chat.audit_log) as audit,
           (select count(*)::int from chat.event_log) as events`);
  return row;
}

const transfer = (actor: string | null, to = w.otherAdminId) =>
  `select chat.transfer_ownership('${w.familyId}'::uuid, '${to}'::uuid, 'rebalance', ${actor ? `'${actor}'::uuid` : 'null'})`;
const offboard = (actor: string | null, to: string | null = w.otherAdminId) =>
  `select * from chat.offboard_staff('${w.ownerId}'::uuid, 'left the academy', ${to ? `'${to}'::uuid` : 'null'}, ${actor ? `'${actor}'::uuid` : 'null'})`;

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
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like 'own\\_%@example.test'`);
  for (const [staffId, subject] of [[s.ownerId, SUBJECT.admin], [s.managerId, SUBJECT.manager]] as const) {
    const accountId = randomUUID();
    await g.prisma.$executeRawUnsafe(`insert into chat.account (id, subject, kind) values ('${accountId}'::uuid, '${subject}', 'staff')`);
    await g.prisma.$executeRawUnsafe(`update chat.staff set account_id = '${accountId}'::uuid where id = '${staffId}'::uuid`);
  }
  const inactiveManagerId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active, left_at) values ('${inactiveManagerId}'::uuid, 'manager_gone', 'manager', false, now())`,
  );
  const foreignOrg = randomUUID();
  const foreignManagerId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${foreignOrg}'::uuid, 'own-${foreignOrg.slice(0, 8)}', 'Other')`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, organization_id, name, role) values ('${foreignManagerId}'::uuid, '${foreignOrg}'::uuid, 'manager_x', 'manager')`,
  );
  w = { ...s, inactiveManagerId, foreignManagerId, foreignOrg };
});
// Remove ONLY the organization this test created; other suites may leave rows
// in organizations of their own, and those are not ours to delete.
afterEach(async () => {
  if (!w?.foreignOrg) return;
  await g.prisma.$executeRawUnsafe(`delete from chat.staff where organization_id = '${w.foreignOrg}'::uuid`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where id = '${w.foreignOrg}'::uuid`);
});

// ===========================================================================
describe('the execution boundary', () => {
  it('anon, authenticated and chat_app cannot execute any ownership or audit function', async () => {
    const rows = await g.prisma.$queryRawUnsafe<Array<{ r: string; f: string; can: boolean }>>(`
      select r, f, has_function_privilege(r, f, 'EXECUTE') as can
        from unnest(array['anon', 'authenticated', 'chat_app']) r
        cross join unnest(array[
          'chat.transfer_ownership(uuid, uuid, text, uuid)',
          'chat.offboard_staff(uuid, text, uuid, uuid)',
          'chat.assign_family_owner(text, uuid, text, uuid)',
          'chat.write_audit(uuid, text, text, uuid, text, jsonb, jsonb)',
          'chat.log_event(text, uuid, text, uuid, jsonb)']) f`);
    expect(rows.filter((x) => x.can)).toEqual([]);
    expect(rows).toHaveLength(15);
  });

  it('every SECURITY DEFINER function in this chain pins its search_path', async () => {
    const rows = await g.prisma.$queryRawUnsafe<Array<{ proname: string; pinned: boolean }>>(`
      select p.proname::text, exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%') as pinned
        from pg_proc p
       where p.pronamespace = 'chat'::regnamespace and p.prosecdef
         and p.proname in ('write_audit', 'log_event', 'current_staff_id', 'current_staff_role', 'current_organization_id')`);
    expect(rows.filter((r) => !r.pinned)).toEqual([]);
    expect(rows).toHaveLength(5);
  });

  it('the request role cannot write chat.family.owner_id, even with chat.transferring_ownership set', async () => {
    const before = await snapshot();
    const out = await asStaff(SUBJECT.admin, async (tx) => {
      await tx.$executeRawUnsafe(`select set_config('chat.transferring_ownership', 'on', true)`);
      return run(tx, `update chat.family set owner_id = chat.current_staff_id() where id = '${w.familyId}'::uuid`);
    });
    expect(String(out)).toMatch(/permission denied/);
    expect(await snapshot()).toEqual(before);
  });

  it('the request role keeps its other family columns', async () => {
    expect(
      await asRequest(SUBJECT.admin, `update chat.family set language = 'en', display_name = 'family_x2' where id = '${w.familyId}'::uuid`),
    ).toBe(1);
  });

  it('the chat.staff column restriction from 20261013160000 still holds', async () => {
    expect(String(await asRequest(SUBJECT.admin, `update chat.staff set role = 'manager' where id = chat.current_staff_id()`))).toMatch(
      /permission denied/,
    );
  });
});

// ===========================================================================
describe('ownership transfer', () => {
  it('an admin cannot transfer by claiming to be a manager (request role)', async () => {
    const before = await snapshot();
    expect(String(await asRequest(SUBJECT.admin, transfer(w.managerId)))).toMatch(/permission denied for function transfer_ownership/);
    expect(await snapshot()).toEqual(before);
  });

  it('nor can a real manager call it on the request role: the path is server-side', async () => {
    expect(String(await asRequest(SUBJECT.manager, transfer(w.managerId)))).toMatch(/permission denied for function/);
  });

  it('nobody on the request role can forge audit or event rows directly', async () => {
    const before = await snapshot();
    expect(
      String(await asRequest(SUBJECT.admin, `select chat.write_audit('${w.managerId}'::uuid, 'forged', 'family', '${w.familyId}'::uuid, 'x')`)),
    ).toMatch(/permission denied/);
    expect(
      String(await asRequest(SUBJECT.admin, `select chat.log_event('ownership_transferred', null, 'staff', '${w.managerId}'::uuid, '{}'::jsonb)`)),
    ).toMatch(/permission denied/);
    expect(await snapshot()).toEqual(before);
  });

  it('defence in depth: even if a request-path grant is re-added, p_actor_id cannot name someone else', async () => {
    // Grant, switch to chat_app and attempt -- all inside ONE owner transaction
    // that is rolled back, so the grant never exists outside this test.
    const outcomes = await asStaff(
      SUBJECT.admin,
      async (tx) => {
        await tx.$executeRawUnsafe(`reset role`);
        await tx.$executeRawUnsafe(`grant execute on function chat.transfer_ownership(uuid, uuid, text, uuid) to chat_app`);
        await tx.$executeRawUnsafe(`set local role chat_app`);
        await tx.$executeRawUnsafe(`savepoint a`);
        const spoof = await run(tx, transfer(w.managerId));
        await tx.$executeRawUnsafe(`rollback to savepoint a`);
        const own = await run(tx, transfer(null));
        return { spoof, own };
      },
      { forceSetRole: true },
    );
    expect(String(outcomes.spoof)).toMatch(/p_actor_id may not name another staff member/);
    expect(String(outcomes.own)).toMatch(/only an active manager or the super admin of this organization may transfer ownership/);
  });

  it('server-side: an active manager completes the transfer, and the trail names that manager', async () => {
    const before = await snapshot();
    expect(await asServer(transfer(w.managerId))).toBe(1);
    const after = await snapshot();
    expect(after.owner).toBe(w.otherAdminId);
    const audit = await g.prisma.auditLog.findFirstOrThrow({ where: { action: 'ownership_transferred', entityId: w.familyId } });
    expect(audit.actorId).toBe(w.managerId);
    const [event] = await g.prisma.$queryRawUnsafe<Array<{ actor_id: string; actor_type: string; family_id: string }>>(
      `select actor_id::text, actor_type, family_id::text from chat.event_log where type = 'ownership_transferred' order by id desc limit 1`,
    );
    expect(event).toEqual({ actor_id: w.managerId, actor_type: 'staff', family_id: w.familyId });
    expect(after.audit).toBe(before.audit + 1);
    expect(after.events).toBe(before.events + 1);
  });

  it('server-side: a non-manager, a missing, an inactive or a foreign-tenant actor is refused, changing nothing', async () => {
    const before = await snapshot();
    expect(String(await asServer(transfer(w.ownerId)))).toMatch(/only an active manager/);
    expect(String(await asServer(transfer(null)))).toMatch(/must name the authenticated actor/);
    expect(String(await asServer(transfer(w.inactiveManagerId)))).toMatch(/only an active manager/);
    expect(String(await asServer(transfer(w.foreignManagerId)))).toMatch(/only an active manager or the super admin of this organization/);
    expect(await snapshot()).toEqual(before);
  });
});

// ===========================================================================
// The approved policy (20261014110000):
//   families.assign (transfer, assign)      manager or super_admin
//   transfer_staff_families (offboarding 1)  manager or super_admin
//   deactivate_staff (offboarding 2)         super_admin only; never the owner, never self
//   offboard_staff (both, one transaction)   super_admin only
async function makeSuperAdmin(): Promise<string> {
  const id = randomUUID();
  await g.prisma.$transaction([
    g.prisma.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`),
    g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role) values ('${id}'::uuid, 'owner_s', 'super_admin')`),
  ]);
  return id;
}
const moveFamilies = (actor: string, staff = w.ownerId, to: string | null = w.otherAdminId) =>
  `select * from chat.transfer_staff_families('${staff}'::uuid, 'left the team', ${to ? `'${to}'::uuid` : 'null'}, '${actor}'::uuid)`;
const deactivate = (actor: string, staff: string) => `select chat.deactivate_staff('${staff}'::uuid, 'left', '${actor}'::uuid)`;

describe('staff offboarding', () => {
  it('an admin cannot offboard, move families or deactivate by naming a manager (request role)', async () => {
    const before = await snapshot();
    expect(String(await asRequest(SUBJECT.admin, offboard(w.managerId)))).toMatch(/permission denied for function offboard_staff/);
    expect(String(await asRequest(SUBJECT.admin, moveFamilies(w.managerId)))).toMatch(/permission denied for function transfer_staff_families/);
    expect(String(await asRequest(SUBJECT.admin, deactivate(w.managerId, w.otherAdminId)))).toMatch(/permission denied for function deactivate_staff/);
    expect(await snapshot()).toEqual(before);
  });

  it('a manager moves a report\'s families (offboarding, part 1) but cannot deactivate the account', async () => {
    const rows = await g.prisma.$queryRawUnsafe<Array<{ family_id: string; new_owner_id: string }>>(moveFamilies(w.managerId));
    expect(rows).toEqual([{ family_id: w.familyId, new_owner_id: w.otherAdminId }]);
    const after = await snapshot();
    expect(after).toMatchObject({ owner: w.otherAdminId, adminActive: true });
    const before = await snapshot();
    expect(String(await asServer(deactivate(w.managerId, w.ownerId)))).toMatch(/only the super admin of this organization may deactivate/);
    expect(String(await asServer(offboard(w.managerId)))).toMatch(/only the super admin of this organization may offboard/);
    expect(await snapshot()).toEqual(before);
  });

  it('the super admin offboards in one transaction: families move, the account is deactivated, the trail names them', async () => {
    const sa = await makeSuperAdmin();
    const before = await snapshot();
    const rows = await g.prisma.$queryRawUnsafe<Array<{ family_id: string; new_owner_id: string }>>(offboard(sa));
    expect(rows).toEqual([{ family_id: w.familyId, new_owner_id: w.otherAdminId }]);
    expect(await snapshot()).toMatchObject({ owner: w.otherAdminId, adminActive: false });
    const actions = (await g.prisma.auditLog.findMany({ where: { actorId: sa }, orderBy: { id: 'asc' } })).map((a) => a.action);
    expect(actions).toEqual(['ownership_transferred', 'staff_families_transferred', 'staff_deactivated', 'staff_offboarded']);
    const events = await g.prisma.$queryRawUnsafe<Array<{ actor_id: string }>>(
      `select actor_id::text from chat.event_log where type = 'ownership_transferred' order by id`,
    );
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.actor_id === sa)).toBe(true);
    expect((await snapshot()).audit).toBe(before.audit + 4);
  });

  it('the super admin deactivates a manager with no families; never the owner, never themselves', async () => {
    const sa = await makeSuperAdmin();
    expect(await asServer(deactivate(sa, w.managerId))).toBe(1);
    expect((await g.prisma.staff.findUniqueOrThrow({ where: { id: w.managerId } })).isActive).toBe(false);
    expect(String(await asServer(deactivate(sa, sa)))).toMatch(/super admin cannot be deactivated, and nobody deactivates themselves/);
    expect((await g.prisma.staff.findUniqueOrThrow({ where: { id: sa } })).isActive).toBe(true);
  });

  it('deactivation still refuses a family owner (guard_staff_deactivation), changing nothing', async () => {
    const sa = await makeSuperAdmin();
    const before = await snapshot();
    expect(String(await asServer(deactivate(sa, w.ownerId)))).toMatch(/still the primary owner/);
    expect(await snapshot()).toEqual(before);
  });

  it('a manager cannot move another manager\'s or the super admin\'s families; the super admin can', async () => {
    const otherManager = randomUUID();
    await g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role) values ('${otherManager}'::uuid, 'manager_d', 'manager')`);
    const sa = await makeSuperAdmin();
    for (const target of [otherManager, sa]) {
      expect(String(await asServer(moveFamilies(w.managerId, target)))).toMatch(/cannot move another manager's or the super admin's families/);
    }
    expect(await asServer(moveFamilies(sa, otherManager))).toBe(0); // owns none; allowed, nothing to move
  });

  it('a failure part-way leaves no partial state: the target owner is ineligible', async () => {
    const sa = await makeSuperAdmin();
    const before = await snapshot();
    expect(String(await asServer(offboard(sa, w.inactiveManagerId)))).toMatch(/must be an active admin or coverage admin/);
    expect(await snapshot()).toEqual(before);
  });

  it('a family owner cannot simply be deactivated by a direct write either', async () => {
    await expect(
      g.prisma.staff.update({ where: { id: w.ownerId }, data: { isActive: false, leftAt: new Date() } }),
    ).rejects.toThrow(/still the primary owner/);
  });
});

// ===========================================================================
describe('authorization matrix on the server-side path', () => {
  async function withRole(role: string) {
    if (role === 'super_admin') return makeSuperAdmin();
    const id = randomUUID();
    await g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role) values ('${id}'::uuid, 'role_${role}', '${role}')`);
    return id;
  }
  const assign = (actor: string) =>
    `select chat.assign_family_owner(gen_random_uuid()::text, '${w.otherAdminId}'::uuid, 'x', '${actor}'::uuid)`;

  for (const role of ['admin', 'coverage', 'finance', 'technical', 'academic']) {
    it(`${role}: refused for every ownership and offboarding action, changing nothing`, async () => {
      const actor = await withRole(role);
      const before = await snapshot();
      expect(String(await asServer(transfer(actor)))).toMatch(/only an active manager or the super admin/);
      expect(String(await asServer(assign(actor)))).toMatch(/only an active manager or the super admin/);
      expect(String(await asServer(moveFamilies(actor)))).toMatch(/only an active manager or the super admin/);
      expect(String(await asServer(deactivate(actor, w.otherAdminId)))).toMatch(/only the super admin/);
      expect(String(await asServer(offboard(actor)))).toMatch(/only the super admin/);
      expect(await snapshot()).toEqual(before);
    });
  }

  for (const role of ['manager', 'super_admin']) {
    it(`${role}: families.assign is allowed -- transfer completes and assign passes authority`, async () => {
      const actor = role === 'manager' ? w.managerId : await withRole(role);
      expect(String(await asServer(assign(actor)))).toMatch(/no waiting Jawwid Core parent/);
      expect(await asServer(transfer(actor))).toBe(1);
      expect((await snapshot()).owner).toBe(w.otherAdminId);
      const audit = await g.prisma.auditLog.findFirstOrThrow({ where: { action: 'ownership_transferred', entityId: w.familyId } });
      expect(audit.actorId).toBe(actor);
    });
  }

  it('a foreign-tenant super admin or manager is refused', async () => {
    const before = await snapshot();
    expect(String(await asServer(transfer(w.foreignManagerId)))).toMatch(/of this organization/);
    expect(String(await asServer(deactivate(w.foreignManagerId, w.otherAdminId)))).toMatch(/only the super admin of this organization/);
    expect(await snapshot()).toEqual(before);
  });
});

// ===========================================================================
describe('family owner assignment', () => {
  it('cannot be spoofed on the request role, and the server path checks authority before anything else', async () => {
    expect(
      String(await asRequest(SUBJECT.admin, `select chat.assign_family_owner(gen_random_uuid()::text, '${w.otherAdminId}'::uuid, 'x', '${w.managerId}'::uuid)`)),
    ).toMatch(/permission denied for function assign_family_owner/);
    expect(
      String(await asServer(`select chat.assign_family_owner(gen_random_uuid()::text, '${w.otherAdminId}'::uuid, 'x', '${w.ownerId}'::uuid)`)),
    ).toMatch(/only an active manager/);
    // A real manager passes authority and reaches the next rule.
    expect(
      String(await asServer(`select chat.assign_family_owner(gen_random_uuid()::text, '${w.otherAdminId}'::uuid, 'x', '${w.managerId}'::uuid)`)),
    ).toMatch(/no waiting Jawwid Core parent/);
  });
});
