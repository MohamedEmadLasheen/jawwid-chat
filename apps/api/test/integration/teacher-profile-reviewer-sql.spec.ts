/**
 * ADMIN-006 follow-up: the database's own answer to "may this caller review
 * teacher credentials?" -- chat.current_can_review_teacher_profile(), the
 * predicate the RLS policies on teacher_professional_profile and
 * teacher_profile_certificate read -- agrees with the API
 * (TeacherProfileService.reviewDecision): the super admin and the Teachers
 * department, never Sales or Operations, a teacher or a parent.
 *
 * Asked as each person, through a request role with their session identity,
 * as RLS asks it. Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { buildGraph, seed, truncate, Scenario } from './harness';

const g = buildGraph();
const ORG = '00000000-0000-0000-0000-000000000001';

let s: Scenario;
let people: Record<string, string>;
const accounts: string[] = [];
/** Logins bound at creation (the super admin's binding is the bootstrap procedure's alone). */
const bound = new Map<string, string>();

/** A login for `staffId`, so chat.current_staff_id() resolves it from the session subject. */
async function signIn(staffId: string): Promise<string> {
  if (bound.has(staffId)) return bound.get(staffId)!;
  const id = randomUUID();
  const subject = `rvw_${id.slice(0, 8)}@example.test`;
  await g.prisma.$executeRawUnsafe(`insert into chat.account (id, subject, kind) values ($1::uuid, $2, 'staff')`, id, subject);
  await g.prisma.$executeRawUnsafe(`update chat.staff set account_id = $1::uuid where id = $2::uuid`, id, staffId);
  accounts.push(id);
  return subject;
}

/** The predicate's answer for whoever holds `subject`, as a request role asks it. */
async function asks(subject: string): Promise<boolean> {
  return g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local role chat_app`);
    await tx.$executeRawUnsafe(`select set_config('chat.actor_subject', $1, true)`, subject);
    await tx.$executeRawUnsafe(`select set_config('chat.actor_organization', $1, true)`, ORG);
    const [row] = await tx.$queryRawUnsafe<Array<{ ok: boolean }>>(`select chat.current_can_review_teacher_profile() as ok`);
    return row!.ok;
  });
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
  s = await seed(g.prisma);
  const [tmgr, tsup, smgr, smem, superId] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active)
     values ($1::uuid, 'tmgr_r', 'manager', true), ($2::uuid, 'tsup_r', 'admin', true),
            ($3::uuid, 'smgr_r', 'manager', true), ($4::uuid, 'smem_r', 'admin', true)`,
    tmgr, tsup, smgr, smem,
  );
  const superAccount = randomUUID();
  const superSubject = `rvw_root_${superAccount.slice(0, 8)}@example.test`;
  await g.prisma.$executeRawUnsafe(`insert into chat.account (id, subject, kind) values ($1::uuid, $2, 'staff')`, superAccount, superSubject);
  accounts.push(superAccount);
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    await tx.$executeRawUnsafe(
      `insert into chat.staff (id, name, role, is_active, account_id) values ($1::uuid, 'root_r', 'super_admin', true, $2::uuid)`,
      superId, superAccount,
    );
  });
  bound.set(superId, superSubject);
  for (const [kind, manager, member] of [['teachers', tmgr, tsup], ['sales', smgr, smem]] as const) {
    const [{ id }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `insert into chat.department (kind, display_name, manager_id) values ($1, $1, $2::uuid) returning id::text as id`, kind, manager,
    );
    await g.prisma.$executeRawUnsafe(
      `insert into chat.department_member (staff_id, organization_id, department_id, position) values ($1::uuid, $2::uuid, $3::uuid, 'supervisor')`,
      member, ORG, id,
    );
  }
  people = {
    'super admin': superId,
    'Teachers manager': tmgr,
    'Teachers supervisor': tsup,
    'Operations manager': s.managerId,
    'Operations supervisor': s.ownerId,
    'Sales manager': smgr,
    'Sales member': smem,
  };
});
afterEach(async () => {
  // The super admin's row (and its binding) goes with the harness truncate; the others are unbound here.
  await g.prisma.$executeRawUnsafe(
    `update chat.staff set account_id = null where account_id = any($1::uuid[]) and role <> 'super_admin'`, accounts,
  );
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where id = any($1::uuid[])`, accounts);
  accounts.length = 0;
  bound.clear();
});

describe('chat.current_can_review_teacher_profile() agrees with the API', () => {
  it('the super admin and the Teachers department review; Sales and Operations do not', async () => {
    const answers: Record<string, boolean> = {};
    for (const [who, id] of Object.entries(people)) answers[who] = await asks(await signIn(id));
    expect(answers).toEqual({
      'super admin': true,
      'Teachers manager': true,
      'Teachers supervisor': true,
      'Operations manager': false,
      'Operations supervisor': false,
      'Sales manager': false,
      'Sales member': false,
    });
  });

  it('a Teachers supervisor who has left the department reviews no more', async () => {
    const subject = await signIn(people['Teachers supervisor']!);
    expect(await asks(subject)).toBe(true);
    await g.prisma.$executeRawUnsafe(`delete from chat.department_member where staff_id = $1::uuid`, people['Teachers supervisor']);
    expect(await asks(subject)).toBe(false);
  });

  it('nobody signed in reviews nothing', async () => {
    expect(await asks(`nobody_${randomUUID().slice(0, 8)}@example.test`)).toBe(false);
  });
});
