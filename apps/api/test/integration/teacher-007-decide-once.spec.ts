/**
 * TEACHER-007 (QA 2026-10-31): a double-clicked Approve posted two "Leave
 * approved" cards. A leave decision is now made once: the second of two
 * identical decisions -- at the same moment or just after -- changes nothing,
 * posts nothing, and answers with the decision already made. A different
 * decision on a decided request is still refused (409).
 *
 * Dates fixed in next year (no calendar-boundary fixture). Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { LessonService } from '../../src/lessons/lesson.service';
import { SupervisionConversationService } from '../../src/supervision/supervision-conversation.service';
import { CardPoster } from '../../src/supervision/card-poster';
import { LeaveService } from '../../src/leave/leave.service';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { TrialService } from '../../src/lessons/trial.service';
import { NewStudentsService } from '../../src/new-students/new-students.service';
import { TrialGroupService } from '../../src/lessons/trial-group.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

const g = buildGraph();
const audit = new PrismaAuditService();
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const supervision = new SupervisionConversationService(g.prisma, g.authz, g.conversations, g.outbox, audit);
const cards = new CardPoster(g.conversations, g.outbox, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);
const groups = new TrialGroupService(g.prisma, g.authz, g.conversations, g.outbox, cards, g.config, audit);
const trials = new TrialService(g.prisma, g.conversations, lessons, scheduling, audit, groups, new NewStudentsService(g.prisma));
const leave = new LeaveService(g.prisma, g.conversations, supervision, cards, lessons, audit, trials);

jest.setTimeout(120_000);

const NEXT_YEAR = new Date().getUTCFullYear() + 1;
const day = (mmdd: string) => `${NEXT_YEAR}-${mmdd}`;
let s: Scenario;
let tsupId: string;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}
const requested = async () => (await leave.request(s.teacherId, { firstDay: day('03-10'), lastDay: day('03-12'), reason: 'family' })).request;
async function cardsOf(kind: string) {
  return g.prisma.messageCard.count({ where: { kind } });
}
const audits = (action: string) => g.prisma.auditLog.count({ where: { action } });

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
  tsupId = randomUUID();
  const tmgr = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tsup_d', 'admin', true), ($2::uuid, 'tmgr_d', 'manager', true)`,
    tsupId, tmgr,
  );
  const [{ id }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name, manager_id) values ('teachers', 'teachers', $1::uuid) returning id::text as id`, tmgr,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.department_member (staff_id, organization_id, department_id, position)
     values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
    tsupId, id,
  );
});

describe('TEACHER-007: a leave decision is made once', () => {
  it('two approvals at the same moment: both answer approved, one card, one audit row, each day once', async () => {
    const r = await requested();
    const [a, b] = await Promise.all([leave.approve(tsupId, r.id, {}), leave.approve(tsupId, r.id, {})]);
    expect([a.request.state, b.request.state]).toEqual(['approved', 'approved']);
    expect(await cardsOf('leave_approved')).toBe(1);
    expect(await audits('teacher_leave.approved')).toBe(1);
    expect(await g.prisma.teacherDayOff.count({ where: { leaveRequestId: r.id } })).toBe(3);
  });

  it('a second approval just after: the same answer, nothing new', async () => {
    const r = await requested();
    await leave.approve(tsupId, r.id, {});
    const again = await leave.approve(tsupId, r.id, {});
    expect(again).toMatchObject({ request: { id: r.id, state: 'approved' }, cancelledLessons: 0, notCancelled: [] });
    expect(await cardsOf('leave_approved')).toBe(1);
    expect(await audits('teacher_leave.approved')).toBe(1);
  });

  it('two declines at once: one card; a different decision afterwards is still refused', async () => {
    const r = await requested();
    const [a, b] = await Promise.all([
      leave.decline(tsupId, r.id, { note: 'busy week' }),
      leave.decline(tsupId, r.id, { note: 'busy week' }),
    ]);
    expect([a.request.state, b.request.state]).toEqual(['declined', 'declined']);
    expect(await cardsOf('leave_declined')).toBe(1);
    expect(await code(leave.approve(tsupId, r.id, {}))).toBe(CommErrorCode.LEAVE_STATE);
  });

  it('an approval and a decline at once: exactly one wins; the other is refused, and one card is posted', async () => {
    const r = await requested();
    const outcomes = await Promise.all([
      leave.approve(tsupId, r.id, {}).then(() => 'approved', (e: CommError) => e.code),
      leave.decline(tsupId, r.id, { note: 'no' }).then(() => 'declined', (e: CommError) => e.code),
    ]);
    expect(outcomes.filter((o) => o === CommErrorCode.LEAVE_STATE)).toHaveLength(1);
    expect((await cardsOf('leave_approved')) + (await cardsOf('leave_declined'))).toBe(1);
  });
});
