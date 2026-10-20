/**
 * PD-11 T4 (part 1) -- trial lessons.
 *
 *   1. prospects: Sales records them; nobody else does
 *   2. booking: only into the teacher's real free time; a trial takes the
 *      teacher's time like any lesson, and the lesson pages never see it
 *   3. attendance: the teacher's fact (the Teachers department may record an absence)
 *   4. the outcome: subscribed / not subscribed are Sales'; a teacher never
 *      sees why a prospect did not subscribe (the rest of the outcome rules,
 *      corrections and New Students: trial-journey.spec.ts)
 *   6. statistics: a trial has its own block and is never a student's lesson
 *   7. the database refuses what the service would never write
 *
 * Synthetic fixtures only (QA gate G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { LessonService } from '../../src/lessons/lesson.service';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { StatsService } from '../../src/lessons/stats.service';
import { CardPoster } from '../../src/supervision/card-poster';
import { TrialService } from '../../src/lessons/trial.service';
import { TrialGroupService } from '../../src/lessons/trial-group.service';
import { NewStudentsService } from '../../src/new-students/new-students.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

const g = buildGraph();
const audit = new PrismaAuditService();
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);
const cards = new CardPoster(g.conversations, g.outbox, audit);
const groups = new TrialGroupService(g.prisma, g.authz, g.conversations, g.outbox, cards, g.config, audit);
const trials = new TrialService(g.prisma, g.conversations, lessons, scheduling, audit, groups, new NewStudentsService(g.prisma));
const stats = new StatsService(g.prisma, g.conversations, lessons, scheduling, g.config);

const TZ = 'Africa/Cairo';
const MIN = 60_000;
const HOUR = 60 * MIN;

let s: Scenario;
let tsupId: string;
let salesId: string;
let prospectId: string;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

async function department(kind: string, staffId: string) {
  const [{ id }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name) values ($1, $1) returning id::text as id`, kind,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.department_member (staff_id, organization_id, department_id, position)
     values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
    staffId, id,
  );
}

/** teacher_c works every day, all day. */
async function openAllWeek() {
  await scheduling.setAvailability(tsupId, s.teacherId, {
    timezone: TZ,
    windows: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '00:00', end: '24:00' })),
  });
}

/** A trial already in the past, written as the service would have booked it. */
async function pastTrial(startsAt: Date, minutes = 30, teacherId = s.teacherId): Promise<string> {
  const l = await g.prisma.lesson.create({
    data: {
      organizationId: (await g.prisma.teacher.findUniqueOrThrow({ where: { id: teacherId } })).organizationId,
      kind: 'trial',
      prospectId,
      teacherId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + minutes * MIN),
      createdByKind: 'staff',
      createdBy: salesId,
    },
  });
  return l.id;
}

/** A synthetic subscription form (G-16). */
function form(teacherId = s.teacherId) {
  return {
    parent: { name: 'parent_q', email: 'parent_q@example.test', phone: '+99 000 000 000' },
    children: [{ name: 'child_q', age: 9, course: 'course_q', teacherId, packagePrice: 1200, lessonPrice: 150, schedule: [{ weekday: 1, time: '17:00' }] }],
    payment: { currency: 'EGP', method: 'bank_transfer' },
  };
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
  g.coverage.onDutyId = s.ownerId;
  tsupId = randomUUID();
  salesId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tsup_a', 'admin', true), ($2::uuid, 'sales_a', 'admin', true)`,
    tsupId, salesId,
  );
  await department('teachers', tsupId);
  await department('sales', salesId);
  prospectId = (await trials.createProspect(salesId, { displayName: 'prospect_q', level: 'beginner' })).id;
});

describe('1. prospects', () => {
  it('Sales records a prospect; the Teachers department reads them; a teacher and Operations do neither', async () => {
    expect(await code(trials.createProspect(tsupId, { displayName: 'x' }))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(trials.createProspect(s.ownerId, { displayName: 'x' }))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(trials.createProspect(s.teacherId, { displayName: 'x' }))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(trials.createProspect(salesId, {}))).toBe(CommErrorCode.VALIDATION);

    expect((await trials.prospects(tsupId)).prospects.map((p) => p.id)).toEqual([prospectId]);
    expect(await code(trials.prospects(s.teacherId))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(trials.prospects(s.parentId))).toBe(CommErrorCode.LESSON_DENIED);
  });
});

describe('2. booking', () => {
  it('offers only the teacher\'s free times, books one, and that time is then taken', async () => {
    // No working hours: nothing to offer, nothing to book.
    expect((await trials.slots(salesId, s.teacherId)).slots).toEqual([]);
    await openAllWeek();
    const { slots } = await trials.slots(salesId, s.teacherId, '30');
    expect(slots.length).toBeGreaterThan(0);
    const at = slots[5];

    // A time that is not offered is refused, not squeezed in.
    const offGrid = new Date(new Date(at).getTime() + 7 * MIN).toISOString();
    expect(await code(trials.book(salesId, { prospectId, teacherId: s.teacherId, startsAt: offGrid }))).toBe(CommErrorCode.LESSON_STATE);

    const t = await trials.book(salesId, { prospectId, teacherId: s.teacherId, startsAt: at });
    expect(t).toMatchObject({ teacher: { id: s.teacherId }, prospect: { displayName: 'prospect_q' }, durationMinutes: 30, attendance: 'upcoming', outcome: 'upcoming' });
    expect((await trials.slots(salesId, s.teacherId, '30')).slots).not.toContain(at);

    // The trial holds the teacher's time against a student's lesson too.
    expect(await code(lessons.schedule(tsupId, {
      learnerId: s.learnerId, startsAt: at, endsAt: new Date(new Date(at).getTime() + 30 * MIN).toISOString(),
    }))).toBe(CommErrorCode.LESSON_TEACHER_BUSY);

    // The Teachers department may book; a teacher may not; an unknown prospect is unknown.
    expect(await code(trials.book(s.teacherId, { prospectId, teacherId: s.teacherId, startsAt: slots[9] }))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(trials.book(salesId, { prospectId: randomUUID(), teacherId: s.teacherId, startsAt: slots[9] }))).toBe(CommErrorCode.LESSON_NOT_FOUND);
    await trials.book(tsupId, { prospectId, teacherId: s.teacherId, startsAt: slots[9] });
  });

  it('the lesson pages never see a trial', async () => {
    const id = await pastTrial(new Date(Date.now() - 2 * HOUR));
    expect(await code(lessons.get(tsupId, id))).toBe(CommErrorCode.LESSON_NOT_FOUND);
    expect(await code(lessons.report(s.teacherId, id, { covered: 'x' }))).toBe(CommErrorCode.LESSON_NOT_FOUND);
    const listed = await lessons.list(tsupId, { teacherId: s.teacherId });
    expect(listed.lessons.map((l: { id: string }) => l.id)).not.toContain(id);
    const needs = await lessons.needsAction(tsupId);
    expect(JSON.stringify(needs)).not.toContain(id);
  });

  it('a teacher lists their own trials; Sales and the department list all; a parent none', async () => {
    const mine = await pastTrial(new Date(Date.now() - 2 * HOUR));
    const theirs = await pastTrial(new Date(Date.now() - 2 * HOUR), 30, s.unrelatedTeacherId);
    expect((await trials.list(s.teacherId, {})).trials.map((t) => t.id)).toEqual([mine]);
    expect((await trials.list(salesId, {})).trials.map((t) => t.id).sort()).toEqual([mine, theirs].sort());
    expect((await trials.list(tsupId, { teacherId: s.unrelatedTeacherId })).trials.map((t) => t.id)).toEqual([theirs]);
    expect(await code(trials.list(s.parentId, {}))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(trials.get(s.teacherId, theirs))).toBe(CommErrorCode.LESSON_NOT_FOUND);
  });
});

describe('3. attendance', () => {
  it('the teacher reports an attended trial; nobody else writes the report; it closes once', async () => {
    const id = await pastTrial(new Date(Date.now() - 2 * HOUR));
    expect(await code(trials.attendance(salesId, id, { attended: true, covered: 'x' }))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(trials.attendance(tsupId, id, { attended: true, covered: 'x' }))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(trials.attendance(s.unrelatedTeacherId, id, { attended: true, covered: 'x' }))).toBe(CommErrorCode.LESSON_NOT_FOUND);
    expect(await code(trials.attendance(s.teacherId, id, { attended: true }))).toBe(CommErrorCode.VALIDATION);

    const t = await trials.attendance(s.teacherId, id, { attended: true, covered: 'letters 1-5', rating: 4, note: 'keen' });
    expect(t).toMatchObject({ attendance: 'attended', report: { covered: 'letters 1-5', rating: 4 }, outcome: 'awaiting' });
    expect(await code(trials.attendance(s.teacherId, id, { attended: false }))).toBe(CommErrorCode.LESSON_STATE);
    const events = await g.prisma.outboxEvent.findMany({ where: { type: 'lesson.closed' } });
    expect(events.map((e) => (e.payload as { learnerId: unknown }).learnerId)).toEqual([null]);
  });

  it('not before the start; the Teachers department may record an absence; Sales may not', async () => {
    await openAllWeek();
    const { slots } = await trials.slots(salesId, s.teacherId);
    const future = await trials.book(salesId, { prospectId, teacherId: s.teacherId, startsAt: slots[0] });
    expect(await code(trials.attendance(s.teacherId, future.id, { attended: true, covered: 'x' }))).toBe(CommErrorCode.LESSON_STATE);

    const id = await pastTrial(new Date(Date.now() - 2 * HOUR));
    expect(await code(trials.attendance(salesId, id, { attended: false }))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await trials.attendance(tsupId, id, { attended: false, note: 'no answer' })).toMatchObject({ attendance: 'no_show', outcome: 'no_show' });
  });

  it('Sales or the department cancels an open trial with a reason; a teacher cannot', async () => {
    const id = await pastTrial(new Date(Date.now() + 30 * HOUR));
    expect(await code(trials.cancel(s.teacherId, id, { reason: 'x' }))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(trials.cancel(salesId, id, {}))).toBe(CommErrorCode.VALIDATION);
    expect(await trials.cancel(salesId, id, { reason: 'prospect asked' })).toMatchObject({ attendance: 'admin_cancelled' });
    expect(await code(trials.cancel(tsupId, id, { reason: 'again' }))).toBe(CommErrorCode.LESSON_STATE);
  });
});

describe('4. the outcome', () => {
  it('Sales only, once; not subscribed needs a reason the teacher never sees', async () => {
    const id = await pastTrial(new Date(Date.now() - 2 * HOUR));
    await trials.attendance(s.teacherId, id, { attended: true, covered: 'x' });

    expect(await code(trials.outcome(tsupId, id, { result: 'subscribed', subscription: form() }))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(trials.outcome(s.teacherId, id, { result: 'subscribed', subscription: form() }))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(trials.outcome(salesId, id, { result: 'not_subscribed' }))).toBe(CommErrorCode.VALIDATION);
    expect(await code(trials.outcome(salesId, id, { result: 'maybe' }))).toBe(CommErrorCode.VALIDATION);

    const t = await trials.outcome(salesId, id, { result: 'not_subscribed', reason: 'price', note: 'too expensive for now' });
    expect(t).toMatchObject({ outcome: 'not_subscribed', outcomeDetail: { reason: 'price', note: 'too expensive for now' } });
    expect(await code(trials.outcome(salesId, id, { result: 'subscribed', subscription: form() }))).toBe(CommErrorCode.LESSON_STATE);

    const seen = await trials.get(s.teacherId, id);
    expect(seen.outcome).toBe('not_subscribed');
    expect(seen).not.toHaveProperty('outcomeDetail');
  });

  it('a teacher\'s no-show is the outcome; a decision on it is a correction', async () => {
    const id = await pastTrial(new Date(Date.now() - 2 * HOUR));
    await trials.attendance(s.teacherId, id, { attended: false });
    expect(await code(trials.outcome(salesId, id, { result: 'subscribed', subscription: form() }))).toBe(CommErrorCode.LESSON_STATE);
    expect(await code(trials.outcome(tsupId, id, { result: 'no_show' }))).toBe(CommErrorCode.LESSON_STATE);
  });
});

describe('6. statistics', () => {
  it('a trial has its own block, counts in the workload, and never as a student\'s lesson', async () => {
    const day = (d: number, h: number) => new Date(Date.UTC(2026, 8, d, h));
    const a = await pastTrial(day(10, 15));
    const b = await pastTrial(day(11, 15));
    const c = await pastTrial(day(12, 15));
    await pastTrial(day(13, 15)); // nobody recorded it
    await trials.attendance(s.teacherId, a, { attended: true, covered: 'x' });
    await trials.attendance(s.teacherId, b, { attended: true, covered: 'y' });
    await trials.attendance(s.teacherId, c, { attended: false });
    await trials.outcome(salesId, a, { result: 'subscribed', subscription: form() });
    await trials.outcome(salesId, b, { result: 'not_subscribed', reason: 'not_ready' });

    const d = await stats.teacher(tsupId, s.teacherId, '2026-09');
    expect(d.trials).toEqual({
      total: 4, conducted: 2, subscribed: 1, notSubscribed: 1, noShow: 1, awaiting: 1, upcoming: 0, cancelled: 0, conversionRate: 0.5,
    });
    expect(d.categories.every((cat) => cat.lessons === 0)).toBe(true);
    expect(d.rates.attendance).toBeNull();
    expect(d.workload.scheduledMinutes).toBe(120);

    const row = (await stats.teachers(tsupId, '2026-09')).teachers.find((t) => t.teacher.id === s.teacherId)!;
    expect(row.held.lessons).toBe(0);
    expect(row.unreported.lessons).toBe(0);
    expect(row.trials).toMatchObject({ total: 4, subscribed: 1, notSubscribed: 1, noShow: 1, awaiting: 1 });
  });

  it('access tells the Admin Web who is Sales and who is Operations', async () => {
    expect(await stats.access(salesId)).toEqual({ lessonManager: false, sales: true, operations: false });
    expect(await stats.access(s.ownerId)).toEqual({ lessonManager: false, sales: false, operations: true });
    expect(await stats.access(tsupId)).toEqual({ lessonManager: true, sales: false, operations: false });
    expect(await stats.access(s.teacherId)).toEqual({ lessonManager: false, sales: false, operations: false });
  });
});

describe('7. the database', () => {
  it('a trial is for a prospect and never a learner; a lesson for a prospect is a trial', async () => {
    const base = {
      organizationId: (await g.prisma.teacher.findUniqueOrThrow({ where: { id: s.teacherId } })).organizationId,
      teacherId: s.teacherId,
      startsAt: new Date(Date.now() + 50 * HOUR),
      endsAt: new Date(Date.now() + 50 * HOUR + 30 * MIN),
      createdByKind: 'staff',
      createdBy: salesId,
    };
    await expect(g.prisma.lesson.create({ data: { ...base, kind: 'trial' } })).rejects.toThrow();
    await expect(g.prisma.lesson.create({ data: { ...base, kind: 'trial', prospectId, learnerId: s.learnerId } })).rejects.toThrow();
    await expect(g.prisma.lesson.create({ data: { ...base, kind: 'regular', prospectId } })).rejects.toThrow();
    // A teacher cannot book a trial for themselves.
    await expect(g.prisma.lesson.create({ data: { ...base, kind: 'trial', prospectId, createdByKind: 'teacher', createdBy: s.teacherId } })).rejects.toThrow();
  });

  it('a prospect is never re-linked by hand; an outcome changes only through a correction', async () => {
    await expect(g.prisma.trialProspect.update({ where: { id: prospectId }, data: { learnerId: s.learnerId } })).rejects.toThrow();
    await expect(g.prisma.trialProspect.delete({ where: { id: prospectId } })).rejects.toThrow();

    const id = await pastTrial(new Date(Date.now() - 2 * HOUR));
    // No decision for a trial nobody attended.
    await expect(g.prisma.trialOutcome.create({
      data: { lessonId: id, organizationId: (await g.prisma.lesson.findUniqueOrThrow({ where: { id } })).organizationId, result: 'subscribed', recordedBy: salesId },
    })).rejects.toThrow();
    await trials.attendance(s.teacherId, id, { attended: true, covered: 'x' });
    await trials.outcome(salesId, id, { result: 'subscribed', subscription: form() });
    await expect(g.prisma.trialOutcome.update({ where: { lessonId: id }, data: { result: 'not_subscribed', reasonCode: 'price' } })).rejects.toThrow();
    await expect(g.prisma.trialOutcome.update({ where: { lessonId: id }, data: { confirmedAt: new Date(), coreSubscriptionRef: 'forged' } })).rejects.toThrow();
  });
});


describe('8. the trial group (part 2)', () => {
  async function groupOf(teacherId: string) {
    return g.prisma.conversation.findFirstOrThrow({ where: { type: 'trial_group', trialTeacherId: teacherId, archivedAt: null } });
  }
  async function cardsIn(conversationId: string) {
    return g.prisma.message.findMany({ where: { conversationId, type: 'card' }, include: { card: true }, orderBy: { seq: 'asc' } });
  }

  it('booking opens the teacher\'s group with the teacher and the Teacher Supervisors, and every fact lands in it as a card', async () => {
    await openAllWeek();
    const { slots } = await trials.slots(salesId, s.teacherId);
    await trials.book(salesId, { prospectId, teacherId: s.teacherId, startsAt: slots[0] });
    const group = await groupOf(s.teacherId);
    const members = await g.prisma.conversationMember.findMany({ where: { conversationId: group.id, leftAt: null } });
    // Sales supervisors join by choice (trial-journey.spec.ts), never automatically.
    expect(members.map((m) => [m.actorKind, m.actorId]).sort()).toEqual([['staff', tsupId], ['teacher', s.teacherId]].sort());
    expect((await cardsIn(group.id)).map((m) => m.card?.kind)).toEqual(['trial_booked']);
    // Opening it again finds the same group.
    expect((await trials.openGroup(tsupId, s.teacherId)).conversationId).toBe(group.id);
    expect((await trials.openOwnGroup(s.teacherId)).conversationId).toBe(group.id);
    expect(await code(trials.openGroup(s.teacherId, s.teacherId))).toBe(CommErrorCode.LESSON_DENIED);

    const id = await pastTrial(new Date(Date.now() - 2 * HOUR));
    await trials.attendance(s.teacherId, id, { attended: true, covered: 'letters 1-5', rating: 5 });
    await trials.outcome(salesId, id, { result: 'not_subscribed', reason: 'price', note: 'family budget' });
    const cards = await cardsIn(group.id);
    expect(cards.map((m) => m.card?.kind)).toEqual(['trial_booked', 'trial_report', 'trial_decision']);
    const report = cards[1]!;
    expect(report.authorType).toBe('teacher');
    expect(report.card?.payload).toMatchObject({ trialId: id, prospectName: 'prospect_q', covered: 'letters 1-5', rating: 5 });
    // The teacher reads this group: the reason and Sales' note never reach it.
    const decision = cards[2]!;
    expect(decision.card?.payload).toMatchObject({ trialId: id, result: 'not_subscribed' });
    expect(JSON.stringify(decision.card?.payload)).not.toMatch(/price|budget/);
    expect(decision.body).not.toMatch(/price|budget|السعر/);
  });

  it('"+" offers the teacher a report for each started, unreported trial -- in their own group only', async () => {
    const due = await pastTrial(new Date(Date.now() - 2 * HOUR));
    await pastTrial(new Date(Date.now() + 30 * HOUR)); // not started
    const { conversationId } = await trials.openOwnGroup(s.teacherId);
    const offered = await trials.ticketsFor(s.teacherId, conversationId);
    expect(offered.tickets).toEqual([expect.objectContaining({ ticket: 'trial_report', trialId: due, prospectName: 'prospect_q', durationMinutes: 30 })]);
    expect((await trials.ticketsFor(salesId, conversationId)).tickets).toEqual([]);
    expect((await trials.ticketsFor(s.unrelatedTeacherId, conversationId)).tickets).toEqual([]);
    await trials.attendance(s.teacherId, due, { attended: false });
    expect((await trials.ticketsFor(s.teacherId, conversationId)).tickets).toEqual([]);
  });

  it('Sales and the Teachers department are parties; Operations and a family never are', async () => {
    const { conversationId } = await trials.openGroup(salesId, s.teacherId);
    const access = async (staffId: string) => {
      const [{ a }] = await g.prisma.$queryRawUnsafe<Array<{ a: string | null }>>(
        `select chat.staff_conversation_access($1::uuid, $2::uuid) as a`, staffId, conversationId,
      );
      return a;
    };
    expect(await access(salesId)).toBe('member');
    expect(await access(tsupId)).toBe('member');
    expect(await access(s.ownerId)).toBeNull(); // Operations
    const visible = async (staffId: string) =>
      (await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(`select chat.staff_visible_conversation_ids($1::uuid)::text as id`, staffId)).map((r) => r.id);
    expect(await visible(tsupId)).toContain(conversationId);
    expect(await visible(s.ownerId)).not.toContain(conversationId);

    // The row refuses anyone else as a member.
    await expect(g.prisma.conversationMember.create({
      data: { conversationId, actorId: s.parentId, actorKind: 'contact', memberRole: 'parent' },
    })).rejects.toThrow(/never admits a family contact/);
    await expect(g.prisma.conversationMember.create({
      data: { conversationId, actorId: s.ownerId, actorKind: 'staff', memberRole: 'admin' },
    })).rejects.toThrow(/Sales or the Teachers department/);
    await expect(g.prisma.conversationMember.create({
      data: { conversationId, actorId: s.unrelatedTeacherId, actorKind: 'teacher', memberRole: 'teacher' },
    })).rejects.toThrow(/only the teacher it belongs to/);
    // ...and a second live group for the same teacher.
    await expect(g.prisma.conversation.create({
      data: { type: 'trial_group', trialTeacherId: s.teacherId, title: 'x', teacherRequiresApproval: false, parentRequiresApproval: false },
    })).rejects.toThrow();
  });
});
