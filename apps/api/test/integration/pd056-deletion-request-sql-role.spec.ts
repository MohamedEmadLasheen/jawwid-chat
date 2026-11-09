/**
 * PD-56 · O-3 · LR-46 P3-5 (defence in depth): who may complete a teacher's
 * account deletion request is decided by the DATABASE too, not only by
 * TeacherDeletionRequestController (@Requires('teachers.offboard') and PD-43's
 * decideTeacherOnboarding().canOffboard).
 *
 * chat.complete_account_deletion_request(request, staff, 'staff') used to check
 * only that the staff member was live and of the request's organization: any
 * server-side caller naming a Teachers supervisor, the Operations manager or the
 * Sales manager erased the teacher. Now it requires what the controller and
 * chat.offboard_teacher require: teachers.offboard (PD-40) held by the super
 * admin, or by a manager who runs the Teachers department. Fail closed.
 *
 *   1. a Teachers supervisor, the Operations manager, the Sales manager and an
 *      Operations supervisor are refused; nothing is written
 *   2. the Teachers manager completes it
 *   3. the super admin completes it
 *   4. the deadline path (no staff) is unchanged by the check
 *   5. no request role may EXECUTE the function at all
 *
 * Direct SQL as the server's own connection (the API's role). Fixed instants
 * only: a lesson ahead is in 2099. Synthetic people (G-20).
 */
import { randomUUID } from 'node:crypto';
import { hashPassword } from '@platform/auth/password';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';

jest.setTimeout(300_000);

const PASSWORD = 'lr46-sql-role-password-1';
const DOMAIN = 'lr46sqlrole.qa.jawwid.test';
const SLUG = 'lr46role-';
/** A lesson that is always ahead. */
const AHEAD = new Date('2099-01-05T10:00:00Z');
const REFUSED = /only the Teachers manager or the super admin closes and deletes a teacher/;

const g = buildGraph();
let m: SeedManifest;
let orgId: string;

async function cleanUp() {
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}' or organization_id in (select id from chat.organization where slug like '${SLUG}%')`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like '${SLUG}%'`);
}

/** A teacher with a lesson ahead (so the deletion is a request), and their pending request. */
async function pendingRequest(tag: string): Promise<{ teacherId: string; accountId: string; requestId: string }> {
  const account = await g.prisma.account.create({
    data: { organizationId: orgId, subject: `teacher.${tag}@${DOMAIN}`, kind: 'teacher', status: 'active', isActive: true },
  });
  const teacher = await g.prisma.teacher.create({ data: { organizationId: orgId, name: `teacher_${tag}`, accountId: account.id, isActive: true } });
  const prospect = await g.prisma.trialProspect.create({ data: { organizationId: orgId, displayName: 'QA Prospect', createdBy: m.superAdmin.id } });
  await g.prisma.lesson.create({
    data: {
      organizationId: orgId, kind: 'trial', prospectId: prospect.id, teacherId: teacher.id,
      startsAt: AHEAD, endsAt: new Date(AHEAD.getTime() + 1_800_000), createdByKind: 'staff', createdBy: m.superAdmin.id,
    },
  });
  const [row] = await g.prisma.$queryRawUnsafe<Array<{ r: { id: string; state: string } }>>(
    `select chat.request_account_deletion($1::uuid) as r`, account.id,
  );
  expect(row!.r.state).toBe('pending');
  return { teacherId: teacher.id, accountId: account.id, requestId: row!.r.id };
}

const complete = (requestId: string, staffId: string | null, via: 'staff' | 'deadline' = 'staff') =>
  g.prisma.$queryRawUnsafe<Array<{ r: { requestId: string; alreadyErased: boolean } }>>(
    `select chat.complete_account_deletion_request($1::uuid, $2::uuid, $3) as r`, requestId, staffId, via,
  );
const stateOf = async (requestId: string) =>
  (await g.prisma.$queryRawUnsafe<Array<{ state: string; completed_by: string | null }>>(
    `select state, completed_by::text from chat.account_deletion_request where id = $1::uuid`, requestId,
  ))[0]!;

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await cleanUp();
  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, '${SLUG}${orgId.slice(0, 8)}', 'LR-46 QA academy')`,
  );
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    const account = await tx.account.create({ data: { organizationId: orgId, subject: `owner@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true } });
    await tx.staff.create({ data: { organizationId: orgId, name: 'QA Organization Owner', role: 'super_admin', isActive: true, accountId: account.id } });
  });
  m = await seedOrgChat(g.prisma, { organizationId: orgId, emailDomain: DOMAIN, password: PASSWORD, passwordHash: await hashPassword(PASSWORD), messages: false });
});

afterAll(async () => {
  await truncate(g.prisma);
  await cleanUp();
  await g.prisma.$disconnect();
});

describe('LR-46 P3-5: the database decides who completes a deletion request', () => {
  it('1. live staff of the academy without the offboarding role are refused, and nothing is written', async () => {
    const t = await pendingRequest('refused');
    for (const staff of [m.teacherSupervisors[0]!, m.operationsManager, m.salesManager, m.supervisors[0]!]) {
      await expect(complete(t.requestId, staff.id)).rejects.toThrow(REFUSED);
    }
    expect(await stateOf(t.requestId)).toEqual({ state: 'pending', completed_by: null });
    expect(await g.prisma.teacher.findUniqueOrThrow({ where: { id: t.teacherId } })).toMatchObject({ name: 'teacher_refused', isActive: true });
    const account = await g.prisma.account.findUniqueOrThrow({ where: { id: t.accountId } });
    expect(account.subject.startsWith('erased:')).toBe(false);
  });

  it('2. the Teachers manager completes it', async () => {
    const t = await pendingRequest('manager');
    const [row] = await complete(t.requestId, m.teachersManager.id);
    expect(row!.r).toMatchObject({ requestId: t.requestId, alreadyErased: false });
    expect(await stateOf(t.requestId)).toEqual({ state: 'completed', completed_by: m.teachersManager.id });
    expect(await g.prisma.teacher.findUniqueOrThrow({ where: { id: t.teacherId } })).toMatchObject({ name: 'Deleted user', isActive: false });
  });

  it('3. the super admin completes it', async () => {
    const t = await pendingRequest('owner');
    await complete(t.requestId, m.superAdmin.id);
    expect(await stateOf(t.requestId)).toEqual({ state: 'completed', completed_by: m.superAdmin.id });
  });

  it('4. the deadline path names no staff and is not touched by the role check', async () => {
    const t = await pendingRequest('deadline');
    // Not due: refused for that reason, never for a role.
    await expect(complete(t.requestId, null, 'deadline')).rejects.toThrow(/not due yet/);
    // Staff via the deadline, or no staff via staff: refused as before.
    await expect(complete(t.requestId, m.teachersManager.id, 'deadline')).rejects.toThrow(/completed by staff or at its deadline/);
    await expect(complete(t.requestId, null, 'staff')).rejects.toThrow(/completed by staff or at its deadline/);
    expect((await stateOf(t.requestId)).state).toBe('pending');
  });

  it('5. no request role may execute it', async () => {
    for (const role of ['chat_app', 'authenticated', 'anon']) {
      const [{ exists }] = await g.prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(`select exists (select 1 from pg_roles where rolname = $1) as exists`, role);
      if (!exists) continue;
      const [{ can }] = await g.prisma.$queryRawUnsafe<Array<{ can: boolean }>>(
        `select has_function_privilege($1, 'chat.complete_account_deletion_request(uuid, uuid, text)', 'EXECUTE') as can`, role,
      );
      expect({ role, can }).toEqual({ role, can: false });
    }
  });
});
