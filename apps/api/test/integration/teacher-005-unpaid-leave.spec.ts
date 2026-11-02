/**
 * TEACHER-005 (owner decision, 2026-11-01): leave beyond the allowance is
 * allowed -- with a warning, to the teacher and the approver, that N days will
 * be unpaid. On approval the excess is recorded as unpaid, per request; the
 * balance never goes below 0. The Teacher File and payroll show "Unpaid leave:
 * N days". No pay formula: nothing is deducted automatically.
 *
 *   warn      the request's card (seen by the teacher and the Teachers
 *             department) and the request as staff read it carry unpaidDays
 *   approve   the request's days fill what the balance has left, in date
 *             order; the rest are unpaid days (teacher_day_off.unpaid)
 *   balance   counts paid days only, so it ends at 0, never below
 *   cancel    days returned go back as they were: an unpaid day returned is
 *             no longer unpaid leave
 *   payroll   the month's unpaid leave days, next to the pay summary
 *
 * Dates are fixed in next year, so no fixture crosses a calendar boundary.
 * Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { TeacherScopeService } from '@platform/teacher-scope';
import { LessonService } from '../../src/lessons/lesson.service';
import { SupervisionConversationService } from '../../src/supervision/supervision-conversation.service';
import { CardPoster } from '../../src/supervision/card-poster';
import { LeaveService } from '../../src/leave/leave.service';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { TrialService } from '../../src/lessons/trial.service';
import { NewStudentsService } from '../../src/new-students/new-students.service';
import { TrialGroupService } from '../../src/lessons/trial-group.service';
import { TeacherFileService } from '../../src/teacher-file/teacher-file.service';
import { TeacherPayrollService } from '../../src/teacher-file/teacher-payroll.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

const g = buildGraph();
const audit = new PrismaAuditService();
const scope = new TeacherScopeService(g.prisma);
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const supervision = new SupervisionConversationService(g.prisma, g.authz, g.conversations, g.outbox, audit, scope);
const cards = new CardPoster(g.conversations, g.outbox, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);
const groups = new TrialGroupService(g.prisma, g.authz, g.conversations, g.outbox, cards, g.config, audit);
const trials = new TrialService(g.prisma, g.conversations, lessons, scheduling, audit, groups, new NewStudentsService(g.prisma));
const leave = new LeaveService(g.prisma, g.conversations, supervision, cards, lessons, audit, trials);
const files = new TeacherFileService(g.prisma, g.authz, g.conversations, audit, scope);
const payroll = new TeacherPayrollService(g.prisma, files, audit);

jest.setTimeout(120_000);

const NEXT_YEAR = new Date().getUTCFullYear() + 1;
const day = (mmdd: string) => `${NEXT_YEAR}-${mmdd}`;

let s: Scenario;
let tsupId: string;
let tmgrId: string;
let superId: string;

const allowance = (days: number) => leave.setAllowance(tmgrId, s.teacherId, { year: NEXT_YEAR, days });
const balance = () => leave.balanceOf(g.prisma, s.teacherId, NEXT_YEAR);
async function requested(first: string, last: string) {
  return (await leave.request(s.teacherId, { firstDay: day(first), lastDay: day(last), reason: 'family' })).request;
}
/** The request's card, as the teacher and the Teachers department read it in the supervision chat. */
async function requestCard(requestId: string) {
  const row = await g.prisma.teacherLeaveRequest.findUniqueOrThrow({ where: { id: requestId } });
  const message = await g.prisma.message.findUniqueOrThrow({ where: { id: row.requestMessageId! }, include: { card: true } });
  return { payload: message.card?.payload as Record<string, unknown>, body: message.body ?? '' };
}
const asStaff = async (requestId: string) => (await leave.list(tsupId, { state: 'requested' })).requests.find((r) => r.id === requestId);
const unpaidDaysOf = async (requestId: string) =>
  (await g.prisma.teacherDayOff.findMany({ where: { leaveRequestId: requestId, unpaid: true }, orderBy: { day: 'asc' } })).map((d) =>
    d.day.toISOString().slice(0, 10),
  );

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
  [tsupId, tmgrId, superId] = [randomUUID(), randomUUID(), randomUUID()];
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tsup_u', 'admin', true), ($2::uuid, 'tmgr_u', 'manager', true)`,
    tsupId, tmgrId,
  );
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    await tx.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'root_u', 'super_admin', true)`, superId);
  });
  const [{ id: dept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name, manager_id) values ('teachers', 'teachers', $1::uuid) returning id::text as id`, tmgrId,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.department_member (staff_id, organization_id, department_id, position)
     values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
    tsupId, dept,
  );
});

describe('TEACHER-005: leave beyond the allowance', () => {
  it('is allowed, with a warning to the teacher and the approver that N days will be unpaid', async () => {
    await allowance(2);
    const r = await requested('03-10', '03-12');
    const card = await requestCard(r.id);
    expect(card.payload).toMatchObject({ days: 3, balance: 2, unpaidDays: 1 });
    expect(card.body).toMatch(/1 day will be unpaid|يوم واحد بدون أجر/);
    expect(await asStaff(r.id)).toMatchObject({ unpaidDays: 1 });
  });

  it('on approval, the excess is unpaid -- the last days, in date order -- and the balance ends at 0, never below', async () => {
    await allowance(2);
    const r = await requested('03-10', '03-12');
    await leave.approve(tsupId, r.id, {});
    expect(await unpaidDaysOf(r.id)).toEqual([day('03-12')]);
    expect(await balance()).toMatchObject({ allowance: 2, used: 2, balance: 0 });
    const one = (await leave.teacherLeave(tsupId, s.teacherId, String(NEXT_YEAR))).requests.find((x) => x.id === r.id);
    expect(one).toMatchObject({ state: 'approved', unpaidDays: 1 });
  });

  it('with the balance already used up, every day of the next request is unpaid', async () => {
    await allowance(1);
    await leave.approve(tsupId, (await requested('02-02', '02-02')).id, {});
    const r = await requested('04-01', '04-03');
    expect((await requestCard(r.id)).payload).toMatchObject({ balance: 0, unpaidDays: 3 });
    await leave.approve(tsupId, r.id, {});
    expect(await unpaidDaysOf(r.id)).toEqual([day('04-01'), day('04-02'), day('04-03')]);
    expect((await balance()).balance).toBe(0);
  });

  it('within the allowance, nothing is unpaid and no warning is shown', async () => {
    await allowance(10);
    const r = await requested('03-10', '03-12');
    const card = await requestCard(r.id);
    expect(card.payload).toMatchObject({ unpaidDays: 0 });
    expect(card.body).not.toMatch(/unpaid|بدون أجر/);
    await leave.approve(tsupId, r.id, {});
    expect(await unpaidDaysOf(r.id)).toEqual([]);
    expect((await balance()).balance).toBe(7);
  });

  it('with no allowance set, nothing is called unpaid (there is nothing to exceed)', async () => {
    const r = await requested('03-10', '03-12');
    expect((await requestCard(r.id)).payload.unpaidDays ?? null).toBeNull();
    await leave.approve(tsupId, r.id, {});
    expect(await unpaidDaysOf(r.id)).toEqual([]);
  });

  it('cancelled before it starts, its unpaid days go with it -- reported apart from the paid days returned (#398 review)', async () => {
    await allowance(1);
    const r = await requested('05-04', '05-06');
    await leave.approve(tsupId, r.id, {});
    expect(await unpaidDaysOf(r.id)).toHaveLength(2);
    const out = await leave.cancel(tsupId, r.id, { note: 'plans changed' });
    expect(out).toMatchObject({ daysReturned: 1, unpaidDaysCancelled: 2 });
    expect(await unpaidDaysOf(r.id)).toEqual([]);
    expect((await balance()).balance).toBe(1);
  });

  it('the supervision overview reads the same balance: paid days only, never below 0 (#398 review)', async () => {
    await allowance(2);
    await leave.approve(tsupId, (await requested('03-10', '03-12')).id, {});
    const row = (await leave.overview(tsupId, String(NEXT_YEAR))).teachers.find((t) => t.id === s.teacherId);
    expect(row).toMatchObject({ allowance: 2, used: 2, balance: 0 });
  });

  it('two approvals for one teacher at once share the balance: it is spent once (#398 review)', async () => {
    await allowance(2);
    const a = await requested('06-01', '06-02');
    const b = await requested('06-08', '06-09');
    await Promise.all([leave.approve(tsupId, a.id, {}), leave.approve(tsupId, b.id, {})]);
    expect((await unpaidDaysOf(a.id)).length + (await unpaidDaysOf(b.id)).length).toBe(2);
    expect(await balance()).toMatchObject({ used: 2, balance: 0 });
  });

  it('payroll (PD-18) shows the month\'s unpaid leave days, and the pay is the same before and after: no formula', async () => {
    const organizationId = (await g.prisma.teacher.findUniqueOrThrow({ where: { id: s.teacherId } })).organizationId;
    await g.prisma.teacherPayTerms.create({
      data: {
        organizationId, teacherId: s.teacherId, effectiveMonth: new Date(`${NEXT_YEAR}-01-01T00:00:00Z`),
        salaryType: 'shift', currency: 'EGP', monthlyAmount: '9000', reason: 'contract', createdBy: tmgrId,
      },
    });
    const march = async () => (await payroll.finance(superId, s.teacherId, `${NEXT_YEAR}-03`)).summary.find((m) => m.month === `${NEXT_YEAR}-03`)!;
    const before = await march();
    expect(before).toMatchObject({ currency: 'EGP', unpaidLeaveDays: 0 });

    await allowance(1);
    const r = await requested('03-10', '03-12');
    await leave.approve(tsupId, r.id, {});
    const after = await march();
    expect(after.unpaidLeaveDays).toBe(2);
    // The money: base, deductions and net are exactly what they were. A deduction
    // for unpaid days, if wanted, is an adjustment a person records.
    expect({ base: after.base, deductions: after.deductions, net: after.net }).toEqual({ base: before.base, deductions: before.deductions, net: before.net });
    expect(after.net).not.toBeNull();
    expect((await payroll.finance(superId, s.teacherId, `${NEXT_YEAR}-03`)).adjustments).toEqual([]);
  });
});
