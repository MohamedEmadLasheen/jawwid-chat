/**
 * PD-59 · chat.sales_prospect_ids is owner-aware, at the database (migration 20261121120000).
 *
 * Direct SQL on the real migration chain: the function, the two functions derived from it
 * (chat.sales_teacher_ids, chat.may_record_teacher_row) and the real insert guard of the teacher-records
 * rows (chat.guard_teacher_supervision_entry), so the database agrees with the application ownership rules
 * (TeacherScopeService.salesRowsOf). Synthetic fixtures only (QA gate G-16).
 *
 *   representative A owns prospect P_A (teacher_c); representative B owns P_B (teacher_d) and P_B2
 *   (teacher_c, the SAME teacher, so only ownership tells them apart); P_N has no owner; the manager owns none.
 *
 *   - a representative: only their own prospects; the manager: all; Operations, Teachers, nobody else: none
 *   - the teachers derive from the same rule (a rep is not told another rep's teacher)
 *   - may_record_teacher_row: own prospect true, another's false, unowned false (representative); true (manager)
 *   - the real insert guard refuses a representative's complaint about another's prospect and admits their own
 *   - the window and the organization are unchanged rules
 */
import { randomUUID } from 'node:crypto';
import { buildGraph, seed, truncate, Scenario } from './harness';

const g = buildGraph();
jest.setTimeout(120_000);
const HOUR = 3_600_000;

let s: Scenario;
let orgId: string;
let repA: string;
let repB: string;
let manager: string;
let tsup: string;
let superId: string;
let pA: string; // owned by A, teacher_c
let pB: string; // owned by B, teacher_d
let pB2: string; // owned by B, teacher_c
let pN: string; // no owner, teacher_c
let pOld: string; // owned by A, teacher_c, a lesson outside the window
let slot = 0;

const sqlIds = async (q: string, ...p: unknown[]) =>
  (await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(q, ...p)).map((r) => r.id).sort();

const prospectIds = (staff: string) => sqlIds(`select x::text as id from chat.sales_prospect_ids($1::uuid, now()) x`, staff);
const teacherIds = (staff: string) => sqlIds(`select x::text as id from chat.sales_teacher_ids($1::uuid, now()) x`, staff);
const mayRecord = async (staff: string, teacher: string, prospect: string) =>
  (await g.prisma.$queryRawUnsafe<Array<{ ok: boolean }>>(
    `select chat.may_record_teacher_row($1::uuid, $2::uuid, null, $3::uuid, $4::uuid, now()) as ok`, staff, teacher, prospect, orgId,
  ))[0]!.ok;

async function prospect(name: string, owner: string | null, teacher: string, hoursAgo: number): Promise<string> {
  const p = await g.prisma.trialProspect.create({
    data: { organizationId: orgId, displayName: name, createdBy: superId, ...(owner ? { ownerStaffId: owner } : {}) },
  });
  const start = Date.now() - hoursAgo * HOUR - (slot++ % 10) * 45 * 60_000;
  await g.prisma.lesson.create({
    data: {
      organizationId: orgId, kind: 'trial', prospectId: p.id, teacherId: teacher,
      startsAt: new Date(start), endsAt: new Date(start + 30 * 60_000), createdByKind: 'staff', createdBy: superId,
    },
  });
  return p.id;
}

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  slot = 0;
  s = await seed(g.prisma);
  orgId = (await g.prisma.teacher.findUniqueOrThrow({ where: { id: s.teacherId } })).organizationId;
  repA = randomUUID();
  repB = randomUUID();
  manager = randomUUID();
  tsup = randomUUID();
  superId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'rep_a', 'admin', true), ($2::uuid, 'rep_b', 'admin', true),
       ($3::uuid, 'sales_m', 'manager', true), ($4::uuid, 'tsup_a', 'admin', true)`,
    repA, repB, manager, tsup,
  );
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    await tx.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'root_c', 'super_admin', true)`, superId);
  });
  const dept = async (kind: string, managerId: string | null) =>
    (await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `insert into chat.department (kind, display_name, manager_id) values ($1, $1, $2::uuid) returning id::text as id`, kind, managerId,
    ))[0]!.id;
  const sales = await dept('sales', manager);
  const teachers = await dept('teachers', null);
  for (const [staff, department] of [[repA, sales], [repB, sales], [tsup, teachers]] as const) {
    await g.prisma.$executeRawUnsafe(
      `insert into chat.department_member (staff_id, organization_id, department_id, position) values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
      staff, department,
    );
  }
  pA = await prospect('p_a', repA, s.teacherId, 2);
  pB = await prospect('p_b', repB, s.newTeacherId, 2);
  pB2 = await prospect('p_b2', repB, s.teacherId, 3);
  pN = await prospect('p_n', null, s.teacherId, 4);
  pOld = await prospect('p_old', repA, s.teacherId, 24 * 40);
});

describe('PD-59: chat.sales_prospect_ids is owner-aware', () => {
  it('the three Sales bases are as the guards define them', async () => {
    const basis = async (id: string) => (await g.prisma.$queryRawUnsafe<Array<{ b: string | null }>>(`select chat.sales_basis($1::uuid) as b`, id))[0]!.b;
    expect([await basis(repA), await basis(repB), await basis(manager), await basis(tsup)]).toEqual(['member', 'member', 'manager', null]);
  });

  it('a representative reads their own prospects in the window and no other representative\'s, nor an unowned one', async () => {
    expect(await prospectIds(repA)).toEqual([pA]);
    expect(await prospectIds(repB)).toEqual([pB, pB2].sort());
  });

  it('the Sales manager is unchanged: every prospect with a lesson in the window', async () => {
    expect(await prospectIds(manager)).toEqual([pA, pB, pB2, pN].sort());
  });

  it('no Sales basis, none: the Teachers department, the super admin as a staff id, an unknown id', async () => {
    expect(await prospectIds(tsup)).toEqual([]);
    expect(await prospectIds(s.ownerId)).toEqual([]);
    expect(await prospectIds(randomUUID())).toEqual([]);
  });

  it('the window is unchanged: a lesson older than the PD-26 window is no one\'s, the manager\'s included', async () => {
    expect(await prospectIds(repA)).not.toContain(pOld);
    expect(await prospectIds(manager)).not.toContain(pOld);
  });

  it('chat.sales_teacher_ids derives from it: a representative is not given another representative\'s teacher', async () => {
    expect(await teacherIds(repA)).toEqual([s.teacherId]); // never teacher_d, who teaches only P_B
    expect(await teacherIds(repB)).toEqual([s.teacherId, s.newTeacherId].sort());
    expect(await teacherIds(manager)).toEqual([s.teacherId, s.newTeacherId].sort());
    expect(await teacherIds(tsup)).toEqual([]);
  });

  it('chat.may_record_teacher_row: own prospect true, another\'s false, unowned false; the manager true for all', async () => {
    expect(await mayRecord(repA, s.teacherId, pA)).toBe(true);
    expect(await mayRecord(repA, s.teacherId, pB2)).toBe(false); // the SAME teacher: ownership alone decides
    expect(await mayRecord(repA, s.newTeacherId, pB)).toBe(false);
    expect(await mayRecord(repA, s.teacherId, pN)).toBe(false);
    expect(await mayRecord(repB, s.teacherId, pB2)).toBe(true);
    expect(await mayRecord(repB, s.teacherId, pA)).toBe(false);
    for (const [teacher, p] of [[s.teacherId, pA], [s.newTeacherId, pB], [s.teacherId, pB2], [s.teacherId, pN]] as const) {
      expect({ p, ok: await mayRecord(manager, teacher, p) }).toEqual({ p, ok: true });
    }
    // The teacher must still have taught the trial (unchanged).
    expect(await mayRecord(repA, s.newTeacherId, pA)).toBe(false);
  });

  it('the real insert guard: a representative\'s complaint about another representative\'s prospect is refused, their own is admitted', async () => {
    const insert = (staff: string, prospectId: string) =>
      g.prisma.$executeRawUnsafe(
        `insert into chat.teacher_supervision_entry (organization_id, teacher_id, kind, body, created_by, trial_prospect_id)
         values ($1::uuid, $2::uuid, 'complaint', 'Late to the trial.', $3::uuid, $4::uuid)`,
        orgId, s.teacherId, staff, prospectId,
      );
    await expect(insert(repA, pB2)).rejects.toThrow(/42501.*a record about a trial is written by the Teachers department or Sales/s);
    await expect(insert(repA, pN)).rejects.toThrow(/42501.*a record about a trial is written by the Teachers department or Sales/s);
    await expect(insert(repA, pA)).resolves.toBe(1);
    await expect(insert(manager, pB2)).resolves.toBe(1);
    const rows = await g.prisma.$queryRawUnsafe<Array<{ created_by: string; trial_prospect_id: string }>>(
      `select created_by::text, trial_prospect_id::text from chat.teacher_supervision_entry order by created_at`,
    );
    expect(rows.map((r) => [r.created_by, r.trial_prospect_id])).toEqual([[repA, pA], [manager, pB2]]);
  });

  it('is a stable, search_path-pinned, non-definer SQL function with no public execute, as before', async () => {
    const [f] = await g.prisma.$queryRawUnsafe<Array<{ volatile: string; definer: boolean; config: string[] | null; lang: string; public_exec: boolean }>>(
      `select p.provolatile::text as volatile, p.prosecdef as definer, p.proconfig as config, l.lanname as lang,
              has_function_privilege('public', p.oid, 'execute') as public_exec
         from pg_proc p join pg_language l on l.oid = p.prolang
        where p.oid = 'chat.sales_prospect_ids(uuid, timestamptz)'::regprocedure`,
    );
    expect(f).toEqual({ volatile: 's', definer: false, config: ['search_path=chat, pg_temp'], lang: 'sql', public_exec: false });
  });
});
