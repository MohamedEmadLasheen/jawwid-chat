/**
 * chat.learner.teacher_id -- the academy's assignment, Chat's read model.
 *
 * Before 20261014100000 the request role could INSERT/UPDATE teacher_id, and
 * the guard honoured chat.syncing_assignment, which any connection can set for
 * itself: an admin on chat_app could re-point a learner to another teacher, and
 * the PD-6 predicate would then authorize that teacher to message and call the
 * family privately. Now the column is not writable by the request role at all,
 * and the gate opens only for a server-side caller (assignment ingestion).
 *
 * Request-role statements run AS chat_app (asserted; a real login when
 * DATABASE_APP_URL is set) inside transactions that are always rolled back.
 * Server-side statements run on the owner connection, exactly as the fixtures'
 * withAssignmentGate stands in for ingestion. Synthetic data only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { buildGraph, seed, truncate, Scenario, withAssignmentGate } from './harness';

jest.setTimeout(90_000);

const g = buildGraph();
const ORG = '00000000-0000-0000-0000-000000000001';
const APP_URL = process.env.DATABASE_APP_URL;
const app = APP_URL ? new PrismaClient({ datasourceUrl: APP_URL }) : null;
const SUBJECT = {
  admin: 'lrn_admin_a@example.test',
  manager: 'lrn_manager_c@example.test',
  superAdmin: 'lrn_owner_s@example.test',
  inactive: 'lrn_gone@example.test',
  foreign: 'lrn_foreign@example.test',
};

type Tx = Pick<PrismaClient, '$queryRawUnsafe' | '$executeRawUnsafe'>;
const ROLLBACK = new Error('rollback');
let w: Scenario & { otherOrg: string; foreignFamily: string };

async function asStaff<T>(subject: string, fn: (tx: Tx) => Promise<T>, opts: { forceSetRole?: boolean } = {}): Promise<T> {
  let out: T | undefined;
  const useApp = app !== null && !opts.forceSetRole;
  await (useApp ? app! : g.prisma)
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
async function run(tx: Tx, sql: string): Promise<number | string> {
  try {
    return await tx.$executeRawUnsafe(sql);
  } catch (e) {
    return String((e as Error).message);
  }
}
const teacherOf = async (learnerId: string) =>
  (await g.prisma.learner.findUniqueOrThrow({ where: { id: learnerId }, select: { teacherId: true } })).teacherId;
const authorized = async (teacherId: string, contactId: string) =>
  (await g.prisma.$queryRawUnsafe<Array<{ ok: boolean }>>(
    `select chat.teacher_parent_authorized('${teacherId}'::uuid, '${contactId}'::uuid) as ok`,
  ))[0].ok;

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
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like 'lrn\\_%@example.test'`);
  for (const [staffId, subject] of [[s.ownerId, SUBJECT.admin], [s.managerId, SUBJECT.manager]] as const) {
    const id = randomUUID();
    await g.prisma.$executeRawUnsafe(`insert into chat.account (id, subject, kind) values ('${id}'::uuid, '${subject}', 'staff')`);
    await g.prisma.$executeRawUnsafe(`update chat.staff set account_id = '${id}'::uuid where id = '${staffId}'::uuid`);
  }
  const superAccount = randomUUID();
  await g.prisma.$executeRawUnsafe(`insert into chat.account (id, subject, kind) values ('${superAccount}'::uuid, '${SUBJECT.superAdmin}', 'staff')`);
  await g.prisma.$transaction([
    g.prisma.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`),
    g.prisma.$executeRawUnsafe(`insert into chat.staff (name, role, account_id) values ('owner_s', 'super_admin', '${superAccount}'::uuid)`),
  ]);
  // A second tenant, for the cross-organization case.
  const otherOrg = randomUUID();
  const foreignOwner = randomUUID();
  const foreignFamily = randomUUID();
  await g.prisma.$executeRawUnsafe(`insert into chat.organization (id, slug, display_name) values ('${otherOrg}'::uuid, 'lrn-${otherOrg.slice(0, 8)}', 'Other')`);
  const foreignAccount = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.account (id, organization_id, subject, kind) values ('${foreignAccount}'::uuid, '${otherOrg}'::uuid, '${SUBJECT.foreign}', 'staff')`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, organization_id, name, role, account_id) values ('${foreignOwner}'::uuid, '${otherOrg}'::uuid, 'admin_x', 'manager', '${foreignAccount}'::uuid)`,
  );
  const goneAccount = randomUUID();
  await g.prisma.$executeRawUnsafe(`insert into chat.account (id, subject, kind) values ('${goneAccount}'::uuid, '${SUBJECT.inactive}', 'staff')`);
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (name, role, account_id, is_active, left_at) values ('manager_gone', 'manager', '${goneAccount}'::uuid, false, now())`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.family (id, organization_id, display_name, owner_id) values ('${foreignFamily}'::uuid, '${otherOrg}'::uuid, 'family_o', '${foreignOwner}'::uuid)`,
  );
  w = { ...s, otherOrg, foreignFamily };
});
afterEach(async () => {
  if (!w?.otherOrg) return;
  await g.prisma.$executeRawUnsafe(`delete from chat.family where organization_id = '${w.otherOrg}'::uuid`);
  await g.prisma.$executeRawUnsafe(`delete from chat.staff where organization_id = '${w.otherOrg}'::uuid`);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where organization_id = '${w.otherOrg}'::uuid`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where id = '${w.otherOrg}'::uuid`);
});

describe('the request role cannot write a teacher assignment', () => {
  const reassign = () => `update chat.learner set teacher_id = '${w.unrelatedTeacherId}'::uuid where id = '${w.learnerId}'::uuid`;

  it('no request-role grant covers teacher_id, for UPDATE or INSERT', async () => {
    const rows = await g.prisma.$queryRawUnsafe<Array<{ r: string; upd: boolean; ins: boolean; other_upd: boolean }>>(`
      select r, has_column_privilege(r, 'chat.learner', 'teacher_id', 'UPDATE') as upd,
                has_column_privilege(r, 'chat.learner', 'teacher_id', 'INSERT') as ins,
                has_column_privilege(r, 'chat.learner', 'level', 'UPDATE') as other_upd
        from unnest(array['anon', 'authenticated', 'chat_app']) r order by r`);
    expect(rows).toEqual([
      { r: 'anon', upd: false, ins: false, other_upd: false },
      { r: 'authenticated', upd: false, ins: false, other_upd: true },
      { r: 'chat_app', upd: false, ins: false, other_upd: true },
    ]);
  });

  it('an admin, a manager, the super admin, an inactive manager and another tenant\'s manager are all refused -- with or without the gate', async () => {
    for (const subject of [SUBJECT.admin, SUBJECT.manager, SUBJECT.superAdmin, SUBJECT.inactive, SUBJECT.foreign]) {
      for (const gate of [false, true]) {
        const out = await asStaff(subject, async (tx) => {
          if (gate) await tx.$executeRawUnsafe(`select set_config('chat.syncing_assignment', 'on', true)`);
          return run(tx, reassign());
        });
        expect(String(out)).toMatch(/permission denied/);
      }
    }
    expect(await teacherOf(w.learnerId)).toBe(w.teacherId);
    expect(await authorized(w.unrelatedTeacherId, w.parentId)).toBe(false);
  });

  it('a learner cannot be created with an assignment on the request role', async () => {
    const out = await asStaff(SUBJECT.admin, async (tx) => {
      await tx.$executeRawUnsafe(`select set_config('chat.syncing_assignment', 'on', true)`);
      return run(tx, `insert into chat.learner (family_id, name, teacher_id) values ('${w.familyId}'::uuid, 'learner_z', '${w.unrelatedTeacherId}'::uuid)`);
    });
    expect(String(out)).toMatch(/permission denied/);
    expect(await g.prisma.learner.count({ where: { teacherId: w.unrelatedTeacherId } })).toBe(0);
  });

  it('other learner columns keep working on the request role', async () => {
    expect(await asStaff(SUBJECT.admin, (tx) => run(tx, `update chat.learner set level = 'B1' where id = '${w.learnerId}'::uuid`))).toBe(1);
  });

  it('defence in depth: even with a column grant re-added, the gate is not honoured for a request role', async () => {
    const out = await asStaff(
      SUBJECT.admin,
      async (tx) => {
        await tx.$executeRawUnsafe(`reset role`);
        await tx.$executeRawUnsafe(`grant update (teacher_id) on chat.learner to chat_app`);
        await tx.$executeRawUnsafe(`set local role chat_app`);
        await tx.$executeRawUnsafe(`select set_config('chat.syncing_assignment', 'on', true)`);
        return run(tx, reassign());
      },
      { forceSetRole: true },
    );
    expect(String(out)).toMatch(/owned by the academy assignment system/);
  });

  it('the same holds for the ownership gate: chat.transferring_ownership opens nothing for a request role', async () => {
    const out = await asStaff(
      SUBJECT.manager,
      async (tx) => {
        await tx.$executeRawUnsafe(`reset role`);
        await tx.$executeRawUnsafe(`grant update (owner_id) on chat.family to chat_app`);
        await tx.$executeRawUnsafe(`set local role chat_app`);
        await tx.$executeRawUnsafe(`select set_config('chat.transferring_ownership', 'on', true)`);
        return run(tx, `update chat.family set owner_id = '${w.otherAdminId}'::uuid where id = '${w.familyId}'::uuid`);
      },
      { forceSetRole: true },
    );
    expect(String(out)).toMatch(/changes only through chat.transfer_ownership/);
  });
});

describe('server-side assignment ingestion keeps working', () => {
  it('re-points a learner through the gate on the owner connection, and PD-6 follows it', async () => {
    expect(await authorized(w.teacherId, w.parentId)).toBe(true);
    await withAssignmentGate(g.prisma, `update chat.learner set teacher_id = '${w.unrelatedTeacherId}'::uuid where id = '${w.learnerId}'::uuid`);
    expect(await teacherOf(w.learnerId)).toBe(w.unrelatedTeacherId);
    expect(await authorized(w.unrelatedTeacherId, w.parentId)).toBe(true);
  });

  it('without the gate, even the owner connection is refused, and nothing changes', async () => {
    await expect(
      g.prisma.$executeRawUnsafe(`update chat.learner set teacher_id = '${w.unrelatedTeacherId}'::uuid where id = '${w.learnerId}'::uuid`),
    ).rejects.toThrow(/owned by the academy assignment system/);
    expect(await teacherOf(w.learnerId)).toBe(w.teacherId);
  });

  it('tenant isolation still holds: a learner cannot join another organization\'s family', async () => {
    await expect(
      withAssignmentGate(g.prisma, `insert into chat.learner (family_id, name, teacher_id) values ('${w.foreignFamily}'::uuid, 'learner_x', '${w.teacherId}'::uuid)`),
    ).rejects.toThrow(/cross-organization reference/);
  });
});
