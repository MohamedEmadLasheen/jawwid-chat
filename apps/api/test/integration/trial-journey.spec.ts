/**
 * The student trial journey (owner decisions 2026-10-20).
 *
 *   1. the trial group: one per teacher, for good; the teacher and the
 *      Teacher Supervisors are permanent; Sales supervisors join and leave as
 *      they choose, and that never touches a trial's record
 *   2. the "+ -> Trial" card's three options: no-show (either supervisor),
 *      subscribed with the form, not subscribed with a reason (Sales)
 *   3. privacy: the group gets one short sentence; the form, the prices and the
 *      reason never reach a message, a card or an event
 *   4. the New Students page shows the form, recorded in Chat
 *   5. corrections: one outcome per trial, history kept, counted once
 *   6. statistics: a monthly partition per teacher, from Chat's records only
 *   7. Core no longer confirms anything
 *
 * Synthetic fixtures only (QA gate G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { CoreIngestService } from '../../src/core-boundary/core-ingest.service';
import { LessonService } from '../../src/lessons/lesson.service';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { StatsService } from '../../src/lessons/stats.service';
import { TrialGroupService } from '../../src/lessons/trial-group.service';
import { TrialService } from '../../src/lessons/trial.service';
import { NewStudentsService } from '../../src/new-students/new-students.service';
import { NewStudentEnrolmentService } from '../../src/new-students/enrolment.service';
import { CardPoster } from '../../src/supervision/card-poster';
import { buildGraph, seed, truncate, Scenario } from './harness';

const g = buildGraph();
const audit = new PrismaAuditService();
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);
const cards = new CardPoster(g.conversations, g.outbox, audit);
const groups = new TrialGroupService(g.prisma, g.authz, g.conversations, g.outbox, cards, g.config, audit);
const trials = new TrialService(g.prisma, g.conversations, lessons, scheduling, audit, groups, new NewStudentsService(g.prisma));
// PD-16: the page is NewStudentEnrolmentService's (filtered per viewer).
const enrolment = new NewStudentEnrolmentService(g.prisma, g.authz, g.conversations, new NewStudentsService(g.prisma), lessons, scheduling, audit);
const stats = new StatsService(g.prisma, g.conversations, lessons, scheduling, g.config);

const MIN = 60_000;
const HOUR = 60 * MIN;
const PHONE = '+99 000 111 222';
const EMAIL = 'parent_j@example.test';

let s: Scenario;
let tsupId: string;
let salesId: string;
let sales2Id: string;
let prospectId: string;

/** JSON of anything Prisma returns (sequence numbers are BigInt). */
function json(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

async function department(kind: string, staffIds: string[]) {
  const [{ id }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name) values ($1, $1) returning id::text as id`, kind,
  );
  for (const staffId of staffIds) {
    await g.prisma.$executeRawUnsafe(
      `insert into chat.department_member (staff_id, organization_id, department_id, position)
       values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
      staffId, id,
    );
  }
}

async function pastTrial(startsAt: Date, teacherId = s.teacherId): Promise<string> {
  const l = await g.prisma.lesson.create({
    data: {
      organizationId: (await g.prisma.teacher.findUniqueOrThrow({ where: { id: teacherId } })).organizationId,
      kind: 'trial', prospectId, teacherId, startsAt, endsAt: new Date(startsAt.getTime() + 30 * MIN),
      createdByKind: 'staff', createdBy: salesId,
    },
  });
  return l.id;
}

function form(over: Record<string, unknown> = {}) {
  return {
    parent: { name: 'parent_j', email: EMAIL, phone: PHONE },
    children: [
      { name: 'child_j1', age: 8, course: 'course_j', teacherId: s.teacherId, packagePrice: 1234.5, lessonPrice: 154.25,
        schedule: [{ weekday: 4, time: '18:30' }, { weekday: 1, time: '17:00' }] },
      { name: 'child_j2', age: 11, course: 'course_k', teacherId: s.unrelatedTeacherId, packagePrice: 999, lessonPrice: 125,
        schedule: [{ weekday: 6, time: '10:00' }] },
    ],
    payment: { currency: 'egp', method: 'invoice' },
    ...over,
  };
}

async function groupId(teacherId = s.teacherId) {
  return (await trials.openGroup(tsupId, teacherId)).conversationId;
}

async function seats(conversationId: string) {
  const rows = await g.prisma.conversationMember.findMany({ where: { conversationId, leftAt: null } });
  return rows.map((m) => m.actorId).sort();
}

async function cardsIn(conversationId: string) {
  return g.prisma.message.findMany({ where: { conversationId, type: 'card' }, include: { card: true }, orderBy: { seq: 'asc' } });
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
  sales2Id = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active)
     values ($1::uuid, 'tsup_j', 'admin', true), ($2::uuid, 'sales_j', 'admin', true), ($3::uuid, 'sales_k', 'admin', true)`,
    tsupId, salesId, sales2Id,
  );
  await department('teachers', [tsupId]);
  await department('sales', [salesId, sales2Id]);
  prospectId = (await trials.createProspect(salesId, { displayName: 'prospect_j' })).id;
});

describe('1. the trial group', () => {
  it('is one per teacher: the teacher and the Teacher Supervisors sit in it for good', async () => {
    const id = await groupId();
    expect(await seats(id)).toEqual([s.teacherId, tsupId].sort());
    // Opening it again -- from either department, or the teacher -- is the same group.
    expect((await trials.openGroup(salesId, s.teacherId)).conversationId).toBe(id);
    expect((await trials.openOwnGroup(s.teacherId)).conversationId).toBe(id);
    expect(await g.prisma.conversation.count({ where: { type: 'trial_group', trialTeacherId: s.teacherId } })).toBe(1);

    // Permanent members cannot leave.
    expect(await code(trials.leaveGroup(tsupId, id))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(trials.leaveGroup(s.teacherId, id))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(trials.joinGroup(tsupId, id))).toBe(CommErrorCode.LESSON_DENIED);
  });

  it('every Sales supervisor joins and leaves by choice; the group and its trials stay as they are', async () => {
    const id = await groupId();
    const trial = await pastTrial(new Date(Date.now() - 2 * HOUR));

    let ctx = await trials.groupContext(salesId, id);
    expect(ctx.membership).toEqual({ isMember: false, permanent: false, canJoin: true, canLeave: false });

    ctx = await trials.joinGroup(salesId, id);
    expect(ctx.membership).toMatchObject({ isMember: true, canJoin: false, canLeave: true });
    await trials.joinGroup(salesId, id); // twice is one seat
    await trials.joinGroup(sales2Id, id);
    expect(await seats(id)).toEqual([s.teacherId, tsupId, salesId, sales2Id].sort());

    // A booking re-syncs the permanent seats and leaves Sales' choices alone.
    await trials.openGroup(tsupId, s.teacherId);
    expect(await seats(id)).toEqual([s.teacherId, tsupId, salesId, sales2Id].sort());

    await trials.outcome(salesId, trial, { result: 'no_show' });
    await trials.leaveGroup(salesId, id);
    await trials.leaveGroup(salesId, id); // leaving twice is a no-op
    expect(await seats(id)).toEqual([s.teacherId, tsupId, sales2Id].sort());

    // The outcome is the trial's, not the member's.
    expect((await trials.get(tsupId, trial)).outcome).toBe('no_show');
    // Still findable, so they can rejoin for the next trial.
    expect((await trials.groupContext(salesId, id)).membership.canJoin).toBe(true);
    await trials.joinGroup(salesId, id);
    expect((await trials.groupContext(salesId, id)).conversationId).toBe(id);

    const events = await g.prisma.outboxEvent.findMany({ where: { type: 'conversation.membership_changed' } });
    expect(events.length).toBeGreaterThanOrEqual(4);
  });

  it('only Sales joins by choice; someone who left Sales loses the seat at the next sync', async () => {
    const id = await groupId();
    expect(await code(trials.joinGroup(s.ownerId, id))).toBe(CommErrorCode.LESSON_DENIED); // Operations
    expect(await code(trials.joinGroup(s.teacherId, id))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(trials.joinGroup(salesId, randomUUID()))).toBe(CommErrorCode.LESSON_NOT_FOUND);

    await trials.joinGroup(sales2Id, id);
    await g.prisma.$executeRawUnsafe(`delete from chat.department_member where staff_id = $1::uuid`, sales2Id);
    await trials.openGroup(tsupId, s.teacherId);
    expect(await seats(id)).toEqual([s.teacherId, tsupId].sort());
  });
});

describe('2. the "+ -> Trial" card', () => {
  it('lists the teacher\'s trials awaiting an outcome first, each by student and time, with what the caller may do', async () => {
    const id = await groupId();
    const older = await pastTrial(new Date(Date.now() - 5 * HOUR));
    const newer = await pastTrial(new Date(Date.now() - 2 * HOUR));
    const done = await pastTrial(new Date(Date.now() - 3 * HOUR));
    await pastTrial(new Date(Date.now() + 20 * HOUR)); // not started: not offered
    await pastTrial(new Date(Date.now() - 2 * HOUR), s.unrelatedTeacherId); // another teacher's
    await trials.outcome(tsupId, done, { result: 'no_show' });

    const ctx = await trials.groupContext(salesId, id);
    expect(ctx.teacher).toMatchObject({ id: s.teacherId });
    expect(ctx.can).toEqual({ noShow: true, decide: true, correct: true });
    expect(ctx.trials.map((t) => [t.id, t.outcome])).toEqual([[older, 'awaiting'], [newer, 'awaiting'], [done, 'no_show']]);
    expect(ctx.trials[0]).toMatchObject({ prospect: { displayName: 'prospect_j' }, durationMinutes: 30 });

    expect((await trials.groupContext(tsupId, id)).can).toEqual({ noShow: true, decide: false, correct: false });
    expect(await code(trials.groupContext(s.teacherId, id))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(trials.groupContext(s.ownerId, id))).toBe(CommErrorCode.LESSON_DENIED);
  });

  it('option 1: either supervisor records a no-show, once, after the start', async () => {
    const future = await pastTrial(new Date(Date.now() + 20 * HOUR));
    expect(await code(trials.outcome(tsupId, future, { result: 'no_show' }))).toBe(CommErrorCode.LESSON_STATE);
    const a = await pastTrial(new Date(Date.now() - 2 * HOUR));
    const b = await pastTrial(new Date(Date.now() - 3 * HOUR));
    expect(await code(trials.outcome(s.teacherId, a, { result: 'no_show' }))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await trials.outcome(tsupId, a, { result: 'no_show' })).toMatchObject({ attendance: 'no_show', outcome: 'no_show' });
    expect(await trials.outcome(salesId, b, { result: 'no_show' })).toMatchObject({ outcome: 'no_show' });
    expect(await code(trials.outcome(salesId, a, { result: 'no_show' }))).toBe(CommErrorCode.LESSON_STATE);

    // A trial the teacher reported attended is not a no-show without a correction.
    const c = await pastTrial(new Date(Date.now() - 4 * HOUR));
    await trials.attendance(s.teacherId, c, { attended: true, covered: 'x' });
    expect(await code(trials.outcome(tsupId, c, { result: 'no_show' }))).toBe(CommErrorCode.LESSON_STATE);
  });

  it('option 2: Sales records the subscription with the form, and the trial is attended', async () => {
    const id = await pastTrial(new Date(Date.now() - 2 * HOUR));
    expect(await code(trials.outcome(salesId, id, { result: 'subscribed' }))).toBe(CommErrorCode.VALIDATION);
    const bad: Array<Record<string, unknown>> = [
      { parent: { name: 'p', phone: 'call me' } },
      { parent: { name: 'p', phone: PHONE, email: 'nope' } },
      { children: [] },
      { children: [{ ...form().children[0], age: 1 }] },
      { children: [{ ...form().children[0], teacherId: randomUUID() }] },
      { children: [{ ...form().children[0], packagePrice: -1 }] },
      { children: [{ ...form().children[0], lessonPrice: 1.234 }] },
      { children: [{ ...form().children[0], schedule: [{ weekday: 8, time: '10:00' }] }] },
      { children: [{ ...form().children[0], schedule: [{ weekday: 1, time: '25:00' }] }] },
      { children: [{ ...form().children[0], schedule: [{ weekday: 1, time: '10:00' }, { weekday: 1, time: '10:00' }] }] },
      { payment: { currency: 'EURO', method: 'invoice' } },
      { payment: { currency: 'EGP', method: 'cash' } },
    ];
    for (const over of bad) {
      expect({ over, code: await code(trials.outcome(salesId, id, { result: 'subscribed', subscription: form(over) })) })
        .toEqual({ over, code: CommErrorCode.VALIDATION });
    }
    expect(await g.prisma.trialOutcome.count()).toBe(0);

    const t = await trials.outcome(salesId, id, { result: 'subscribed', subscription: form() });
    expect(t).toMatchObject({ attendance: 'attended', outcome: 'subscribed' });
    expect(await code(trials.outcome(salesId, id, { result: 'not_subscribed', reason: 'price' }))).toBe(CommErrorCode.LESSON_STATE);
  });

  it('option 3: Sales records why the student did not subscribe; "other" needs the details', async () => {
    const id = await pastTrial(new Date(Date.now() - 2 * HOUR));
    expect(await code(trials.outcome(tsupId, id, { result: 'not_subscribed', reason: 'price' }))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(trials.outcome(salesId, id, { result: 'not_subscribed', reason: 'other' }))).toBe(CommErrorCode.VALIDATION);
    const t = await trials.outcome(salesId, id, { result: 'not_subscribed', reason: 'other', note: 'moving abroad' });
    expect(t).toMatchObject({ outcome: 'not_subscribed', outcomeDetail: { reason: 'other', note: 'moving abroad' } });
    const outcome = await g.prisma.trialOutcome.findUniqueOrThrow({ where: { lessonId: id } });
    expect(outcome).toMatchObject({ result: 'not_subscribed', reasonCode: 'other', note: 'moving abroad', recordedBy: salesId });
  });
});

describe('3. privacy: the group gets one short sentence', () => {
  it('no form detail, price, contact or reason reaches a message, a card or an event', async () => {
    const conv = await groupId();
    const sub = await pastTrial(new Date(Date.now() - 2 * HOUR));
    const not = await pastTrial(new Date(Date.now() - 3 * HOUR));
    const absent = await pastTrial(new Date(Date.now() - 4 * HOUR));
    await trials.outcome(salesId, sub, { result: 'subscribed', subscription: form() });
    await trials.outcome(salesId, not, { result: 'not_subscribed', reason: 'price', note: 'budget_j' });
    await trials.outcome(tsupId, absent, { result: 'no_show' });

    const posted = await cardsIn(conv);
    expect(posted.map((m) => [m.card?.kind, (m.card?.payload as { result?: string }).result])).toEqual([
      ['trial_decision', 'subscribed'], ['trial_decision', 'not_subscribed'], ['trial_no_show', 'no_show'],
    ]);
    // Arabic is the default language: the sentence, then which trial it is.
    expect((posted[0].body ?? '').split('\n')[0]).toBe('🎉 اشترك الطالب.');
    expect((posted[1].body ?? '').split('\n')[0]).toBe('ℹ️ لم يشترك الطالب.');
    expect((posted[2].body ?? '').split('\n')[0]).toBe('⚠️ لم يحضر الطالب الحصة التجريبية.');
    for (const m of posted) expect(m.body ?? '').toContain('prospect_j');

    const form_ = [PHONE, EMAIL, 'parent_j', 'child_j1', 'course_j', '1234.5', '154.25', 'EGP', 'invoice'];
    const reason = ['budget_j', 'price'];
    const messages = await g.prisma.message.findMany({ where: { conversationId: conv }, include: { card: true } });
    const events = await g.prisma.outboxEvent.findMany();
    const chat = json({ messages, events });
    for (const secret of [...form_, ...reason]) expect({ secret, leaked: chat.includes(secret) }).toEqual({ secret, leaked: false });
    // The audit trail records who decided what (the reason code included), never the form.
    const audits = json(await g.prisma.auditLog.findMany());
    for (const secret of form_) expect({ secret, inAudit: audits.includes(secret) }).toEqual({ secret, inAudit: false });

    // Nothing is sent to Core any more.
    expect(events.map((e) => e.type)).not.toContain('trial.converted');
  });

  it('the request role cannot read the form, its history, or the statistics function', async () => {
    const id = await pastTrial(new Date(Date.now() - 2 * HOUR));
    await trials.outcome(salesId, id, { result: 'subscribed', subscription: form() });
    for (const sql of [
      'select * from chat.trial_subscription',
      'select * from chat.trial_outcome_revision',
      `select * from chat.teacher_trial_stats(chat.default_organization_id(), now() - interval '1 day', now())`,
    ]) {
      await expect(g.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('set local role chat_app');
        await tx.$queryRawUnsafe(sql);
      })).rejects.toThrow(/permission denied/);
    }
  });
});

describe('4. the New Students page', () => {
  it('shows each subscription as Sales recorded it, to the Operations manager and Sales only', async () => {
    const id = await pastTrial(new Date(Date.now() - 2 * HOUR));
    await trials.outcome(salesId, id, { result: 'subscribed', subscription: form() });

    const page = await enrolment.page(s.managerId); // the Operations manager
    expect(page.students).toEqual([
      expect.objectContaining({
        trialId: id,
        prospectName: 'prospect_j',
        trialTeacher: expect.objectContaining({ id: s.teacherId }),
        recordedBy: { id: salesId, name: 'sales_j' },
        parent: { name: 'parent_j', email: EMAIL, phone: PHONE },
        payment: { currency: 'EGP', method: 'invoice' },
        children: [
          expect.objectContaining({
            name: 'child_j1', age: 8, course: 'course_j', teacher: expect.objectContaining({ id: s.teacherId }),
            packagePrice: 1234.5, lessonPrice: 154.25,
            schedule: [{ weekday: 1, time: '17:00' }, { weekday: 4, time: '18:30' }],
          }),
          expect.objectContaining({ name: 'child_j2', teacher: expect.objectContaining({ id: s.unrelatedTeacherId }) }),
        ],
      }),
    ]);
    expect((await enrolment.page(salesId)).students).toHaveLength(1);
    // PD-16: an Operations supervisor sees only the students assigned to them.
    expect((await enrolment.page(s.ownerId)).students).toHaveLength(0);
    expect(await code(enrolment.page(tsupId))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(enrolment.page(s.teacherId))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(enrolment.page(s.parentId))).toBe(CommErrorCode.LESSON_DENIED);
  });

  it('Sales edits the form in place; still one row, nothing posted', async () => {
    const conv = await groupId();
    const id = await pastTrial(new Date(Date.now() - 2 * HOUR));
    await trials.outcome(salesId, id, { result: 'subscribed', subscription: form() });
    const before = (await cardsIn(conv)).length;
    expect(await code(trials.updateSubscription(tsupId, id, { subscription: form() }))).toBe(CommErrorCode.LESSON_DENIED);
    const updated = await trials.updateSubscription(sales2Id, id, { subscription: form({ payment: { currency: 'USD', method: 'bank_transfer' } }) });
    expect(updated).toMatchObject({ payment: { currency: 'USD', method: 'bank_transfer' } });
    expect(updated?.updatedAt).not.toBeNull();
    expect((await enrolment.page(salesId)).students).toHaveLength(1);
    expect((await cardsIn(conv)).length).toBe(before);
  });
});

describe('5. corrections', () => {
  it('Sales corrects with a reason; the trial keeps one outcome; history is kept; the form follows', async () => {
    const conv = await groupId();
    const id = await pastTrial(new Date(Date.now() - 2 * HOUR));
    await trials.outcome(salesId, id, { result: 'subscribed', subscription: form() });

    expect(await code(trials.correct(tsupId, id, { result: 'not_subscribed', reason: 'price', why: 'x' }))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(trials.correct(salesId, id, { result: 'not_subscribed', reason: 'price' }))).toBe(CommErrorCode.VALIDATION);
    expect(await code(trials.correct(salesId, id, { result: 'subscribed', subscription: form(), why: 'x' }))).toBe(CommErrorCode.LESSON_STATE);

    // subscribed -> not subscribed: the form leaves New Students, and is kept.
    let t = await trials.correct(salesId, id, { result: 'not_subscribed', reason: 'chose_other', why: 'the family cancelled the next day' });
    expect(t).toMatchObject({ outcome: 'not_subscribed', outcomeDetail: { reason: 'chose_other' } });
    expect(t.outcomeDetail?.correctedAt).not.toBeNull();
    expect((await enrolment.page(salesId)).students).toEqual([]);

    // -> no-show: the attendance follows.
    t = await trials.correct(sales2Id, id, { result: 'no_show', why: 'the teacher confirmed nobody joined' });
    expect(t).toMatchObject({ attendance: 'no_show', outcome: 'no_show' });

    // -> subscribed again, with a fresh form: the same row comes back.
    t = await trials.correct(salesId, id, { result: 'subscribed', subscription: form({ payment: { currency: 'SAR', method: 'invoice' } }), why: 'the family came back' });
    expect(t).toMatchObject({ attendance: 'attended', outcome: 'subscribed' });
    const page = await enrolment.page(salesId);
    expect(page.students.map((x) => [x.trialId, x.payment.currency])).toEqual([[id, 'SAR']]);

    expect(await g.prisma.trialOutcome.count({ where: { lessonId: id } })).toBe(1);
    const history = await g.prisma.trialOutcomeRevision.findMany({ where: { lessonId: id }, orderBy: { correctedAt: 'asc' } });
    expect(history.map((h) => [h.previousResult, h.result, h.correctedBy])).toEqual([
      ['subscribed', 'not_subscribed', salesId],
      ['not_subscribed', 'no_show', sales2Id],
      ['no_show', 'subscribed', salesId],
    ]);
    expect(history[0].why).toBe('the family cancelled the next day');

    // The group reads the new result only.
    const corrections = (await cardsIn(conv)).filter((m) => m.card?.kind === 'trial_correction');
    expect(corrections.map((m) => (m.card?.payload as { result: string }).result)).toEqual(['not_subscribed', 'no_show', 'subscribed']);
    expect(json(corrections)).not.toMatch(/cancelled the next day|chose_other|SAR/);
  });

  it('a teacher\'s own no-show can be corrected into a decision', async () => {
    const id = await pastTrial(new Date(Date.now() - 2 * HOUR));
    await trials.attendance(s.teacherId, id, { attended: false });
    expect(await code(trials.correct(salesId, id, { result: 'no_show', why: 'x' }))).toBe(CommErrorCode.LESSON_STATE);
    const t = await trials.correct(salesId, id, { result: 'not_subscribed', reason: 'schedule', why: 'joined late from another link' });
    expect(t).toMatchObject({ attendance: 'attended', outcome: 'not_subscribed' });
  });

  it('nothing to correct before an outcome; the database refuses a correction outside the service', async () => {
    const id = await pastTrial(new Date(Date.now() - 2 * HOUR));
    expect(await code(trials.correct(salesId, id, { result: 'no_show', why: 'x' }))).toBe(CommErrorCode.LESSON_STATE);
    await trials.outcome(salesId, id, { result: 'not_subscribed', reason: 'price' });
    await expect(g.prisma.trialOutcome.update({ where: { lessonId: id }, data: { result: 'no_show', reasonCode: null, correctedBy: salesId } }))
      .rejects.toThrow(/only by a correction/);
    // Even inside a correction, the attendance must agree.
    await expect(g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`select set_config('chat.correcting_trial', 'on', true), set_config('chat.trial_correction_reason', 'x', true)`);
      await tx.trialOutcome.update({ where: { lessonId: id }, data: { result: 'no_show', reasonCode: null, correctedBy: salesId } });
    })).rejects.toThrow(/agrees with its attendance/);
    // A correction must say why.
    await expect(g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`select set_config('chat.correcting_trial', 'on', true)`);
      await tx.trialOutcome.update({ where: { lessonId: id }, data: { reasonCode: 'schedule', correctedBy: salesId } });
    })).rejects.toThrow(/says why/);
    // History is never written or changed by hand; a form is never deleted.
    await expect(g.prisma.$executeRawUnsafe(
      `insert into chat.trial_outcome_revision (lesson_id, organization_id, previous_result, result, why, corrected_by)
       values ($1::uuid, chat.default_organization_id(), 'a', 'b', 'c', $2::uuid)`, id, salesId,
    )).rejects.toThrow(/never changed/);
    // A trial's attendance is never moved outside a correction.
    await expect(g.prisma.lesson.update({ where: { id }, data: { outcome: 'student_no_show' } })).rejects.toThrow(/written once/);
  });
});

describe('6. statistics', () => {
  it('each trial once, by its current outcome, per month; corrections move it, never double it', async () => {
    const day = (d: number) => new Date(Date.UTC(2026, 8, d, 15));
    const a = await pastTrial(day(2));
    const b = await pastTrial(day(3));
    const c = await pastTrial(day(4));
    const d = await pastTrial(day(5));
    const e = await pastTrial(day(6));
    await pastTrial(day(7)); // nothing recorded
    const cancelled = await pastTrial(new Date(Date.now() + 40 * HOUR));
    await trials.cancel(salesId, cancelled, { reason: 'x' });
    await pastTrial(day(8), s.unrelatedTeacherId); // another teacher
    await pastTrial(new Date(Date.UTC(2026, 9, 1, 15))); // next month

    await trials.outcome(salesId, a, { result: 'subscribed', subscription: form() });
    await trials.outcome(salesId, b, { result: 'subscribed', subscription: form() });
    await trials.outcome(salesId, c, { result: 'not_subscribed', reason: 'price' });
    await trials.outcome(tsupId, d, { result: 'no_show' });
    await trials.attendance(s.teacherId, e, { attended: true, covered: 'x' }); // attended, no decision yet

    const month = async () => (await stats.teacher(tsupId, s.teacherId, '2026-09')).trials;
    expect(await month()).toEqual({
      total: 6, conducted: 4, subscribed: 2, notSubscribed: 1, noShow: 1, awaiting: 2, upcoming: 0, cancelled: 0, conversionRate: 0.667,
    });

    await trials.correct(salesId, b, { result: 'not_subscribed', reason: 'schedule', why: 'cancelled' });
    expect(await month()).toMatchObject({ total: 6, subscribed: 1, notSubscribed: 2, conversionRate: 0.333 });
    await trials.correct(salesId, d, { result: 'subscribed', subscription: form(), why: 'they did join' });
    expect(await month()).toMatchObject({ total: 6, conducted: 5, subscribed: 2, noShow: 0 });

    // The teachers list carries the same numbers.
    const row = (await stats.teachers(tsupId, '2026-09')).teachers.find((t) => t.teacher.id === s.teacherId)!;
    expect(row.trials).toEqual(await month());
    const other = (await stats.teachers(tsupId, '2026-09')).teachers.find((t) => t.teacher.id === s.unrelatedTeacherId)!;
    expect(other.trials).toMatchObject({ total: 1, awaiting: 1 });
  });
});

describe('7. Core no longer confirms anything', () => {
  it('a subscription.created delivery is recorded and changes no trial', async () => {
    const id = await pastTrial(new Date(Date.now() - 2 * HOUR));
    await trials.outcome(salesId, id, { result: 'subscribed', subscription: form() });
    const before = await stats.teacher(tsupId, s.teacherId);
    const ingest = new CoreIngestService(g.prisma);
    const outcome = await ingest.recordAndApply({
      externalEventId: `evt-${randomUUID()}`,
      eventType: 'subscription.created',
      payload: { core_subscription_id: 'core-sub-j', chat_trial_id: id, core_child_id: 'core-child-j' },
    });
    expect(outcome).toEqual({ status: 'not_applicable', detail: 'trial outcomes are recorded in Chat' });
    const row = await g.prisma.trialOutcome.findUniqueOrThrow({ where: { lessonId: id } });
    expect(row).toMatchObject({ result: 'subscribed', confirmedAt: null, coreSubscriptionRef: null });
    expect((await stats.teacher(tsupId, s.teacherId)).trials).toEqual(before.trials);
    const fns = await g.prisma.$queryRawUnsafe<Array<{ n: string }>>(
      `select proname as n from pg_proc where proname in ('confirm_trial_conversion', 'confirm_trial_subscription')`,
    );
    expect(fns).toEqual([]);
  });
});
