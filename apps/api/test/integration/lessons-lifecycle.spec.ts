/**
 * PD-11 T3 -- transfers, suspensions and the Teacher Supervision section.
 *
 *   1. a transfer moves the child, the group, the history and the future
 *      lessons in one step; the old teacher loses access; only the Teachers
 *      department may do it
 *   2. a temporary pause suspends the lessons in its window, warns before the
 *      return, and resumes by itself
 *   3. a permanent stop ends the regular times and is listed with its reason
 *   4. the supervision timeline is the Teachers department's; the bonus ticket
 *      reaches the teacher's supervision chat and Core
 *
 * Synthetic fixtures only (QA gate G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { LessonService } from '../../src/lessons/lesson.service';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { LifecycleService } from '../../src/lessons/lifecycle.service';
import { SupervisionService } from '../../src/lessons/supervision.service';
import { SupervisionConversationService } from '../../src/supervision/supervision-conversation.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

const g = buildGraph();
const audit = new PrismaAuditService();
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);
const supervisionChats = new SupervisionConversationService(g.prisma, g.authz, g.conversations, g.outbox, audit);
const lifecycle = new LifecycleService(g.prisma, g.conversations, lessons, scheduling, g.outbox, g.config, audit, supervisionChats);
const supervision = new SupervisionService(g.prisma, g.conversations, lessons, g.outbox, supervisionChats, audit);

const TZ = 'Africa/Cairo';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

let s: Scenario;
let groupId: string;
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

async function localDate(days: number): Promise<string> {
  const [{ d }] = await g.prisma.$queryRawUnsafe<Array<{ d: string }>>(
    `select to_char((now() at time zone '${TZ}')::date + ${days}, 'YYYY-MM-DD') as d`,
  );
  return d;
}

async function weekdayIn(days: number): Promise<number> {
  const [{ d }] = await g.prisma.$queryRawUnsafe<Array<{ d: number }>>(
    `select extract(isodow from (now() at time zone '${TZ}')::date + ${days})::int as d`,
  );
  return d;
}

async function openAllWeek(teacherId: string) {
  await scheduling.setAvailability(tsupId, teacherId, {
    timezone: TZ,
    windows: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '00:00', end: '24:00' })),
  });
}

async function cards(conversationId = groupId) {
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
  groupId = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;
  tsupId = randomUUID();
  await g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tsup_a', 'admin', true)`, tsupId);
  const [{ id: dept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name) values ('teachers', 'teachers') returning id::text as id`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.department_member (staff_id, organization_id, department_id, position)
     values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
    tsupId, dept,
  );
});

describe('1. transfers', () => {
  it('moves the child, the group, the history and the future lessons in one step', async () => {
    await openAllWeek(s.teacherId);
    await openAllWeek(s.newTeacherId);
    const wd = await weekdayIn(2);
    await scheduling.setSchedule(tsupId, s.learnerId, { slots: [{ weekday: wd, start: '18:00', durationMinutes: 30 }] });
    // A published message (the supervisor's; a parent's would wait for approval).
    const earlier = await g.messages.send({ conversationId: groupId, senderId: s.ownerId, body: 'history before the transfer', clientMessageId: randomUUID() });
    expect(earlier.moderation).toBe('published');
    // teacher_d is busy at one of learner_l's one-off lessons: that one cannot follow.
    const clash = (await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(3 * DAY), endsAt: at(3 * DAY + HOUR / 2) })).id;
    await lessons.schedule(tsupId, { learnerId: s.secondLearnerId, startsAt: at(3 * DAY), endsAt: at(3 * DAY + HOUR / 2) });

    expect(await code(lifecycle.transfer(s.ownerId, s.learnerId, { toTeacherId: s.newTeacherId, reason: 'schedule_fit' })))
      .toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(lifecycle.transfer(tsupId, s.learnerId, { toTeacherId: s.newTeacherId, reason: 'because' })))
      .toBe(CommErrorCode.VALIDATION);

    const out = await lifecycle.transfer(tsupId, s.learnerId, {
      toTeacherId: s.newTeacherId, reason: 'schedule_fit', note: 'internal', handoverNote: 'strong in tajweed, weak in revision',
    });
    expect(out.scheduleKept).toBe(true);
    expect(out.lessonsRescheduled).toBe(1);
    expect(out.lessonsMoved).toBeGreaterThanOrEqual(4);

    expect((await g.prisma.learner.findUniqueOrThrow({ where: { id: s.learnerId } })).teacherId).toBe(s.newTeacherId);
    const members = await g.prisma.conversationMember.findMany({ where: { conversationId: groupId, actorKind: 'teacher' } });
    expect(members.find((m) => m.actorId === s.teacherId)?.leftAt).not.toBeNull();
    expect(members.find((m) => m.actorId === s.newTeacherId && m.leftAt === null)).toBeDefined();
    // The new teacher reads the whole history; the old one reads nothing.
    const page = await g.messages.list({ conversationId: groupId, actorId: s.newTeacherId });
    expect(page.messages.some((m) => m.body === 'history before the transfer')).toBe(true);
    await expect(g.messages.list({ conversationId: groupId, actorId: s.teacherId })).rejects.toBeInstanceOf(CommError);

    expect((await g.prisma.lesson.findUniqueOrThrow({ where: { id: clash } })).outcome).toBe('rescheduled');
    const open = await g.prisma.lesson.findMany({ where: { learnerId: s.learnerId, outcome: null, startsAt: { gt: new Date() } } });
    expect(open.every((l) => l.teacherId === s.newTeacherId)).toBe(true);
    const slots = await g.prisma.learnerScheduleSlot.findMany({ where: { learnerId: s.learnerId, validTo: null } });
    expect(slots.map((x) => x.teacherId)).toEqual([s.newTeacherId]);

    // The family is told who teaches now; the new teacher gets the handover in their supervision chat.
    expect((await cards()).map((c) => c.card?.kind)).toEqual(['learner_transferred']);
    expect((await cards()).at(0)?.card?.payload).not.toHaveProperty('reason');
    // PD-12 (reconciled 2026-10-19): the ONE supervision conversation per teacher.
    const supervisionConv = await g.prisma.conversation.findFirstOrThrow({
      where: { type: 'teacher_supervision', supervisedTeacherId: s.newTeacherId, archivedAt: null },
    });
    const handover = (await cards(supervisionConv.id)).find((c) => c.card?.kind === 'learner_handover');
    expect(handover?.card?.payload).toMatchObject({ handoverNote: 'strong in tajweed, weak in revision' });
    expect(await g.prisma.outboxEvent.count({ where: { type: 'learner.transferred' } })).toBe(1);

    const forNew = await lifecycle.transfers(s.newTeacherId, s.learnerId);
    expect(forNew.transfers[0]).toMatchObject({ handoverNote: 'strong in tajweed, weak in revision' });
    expect(forNew.transfers[0]).not.toHaveProperty('reason');
    expect(await code(lifecycle.transfers(s.teacherId, s.learnerId))).toBe(CommErrorCode.LESSON_NOT_FOUND);
  });

  it('the database refuses a transfer by someone outside the Teachers department, and a transfer to the same teacher', async () => {
    await expect(g.prisma.$queryRawUnsafe(
      `select * from chat.transfer_learner($1::uuid, $2::uuid, 'other', null, null, $3::uuid)`,
      s.learnerId, s.newTeacherId, s.ownerId,
    )).rejects.toThrow(/only the Teachers department/);
    await expect(g.prisma.$queryRawUnsafe(
      `select * from chat.transfer_learner($1::uuid, $2::uuid, 'other', null, null, $3::uuid)`,
      s.learnerId, s.teacherId, tsupId,
    )).rejects.toThrow(/already has this teacher/);
  });
});

describe('2. a temporary pause', () => {
  it('suspends the lessons in its window, is listed, and resumes when ended', async () => {
    await openAllWeek(s.teacherId);
    await scheduling.setSchedule(tsupId, s.learnerId, {
      slots: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '18:00', durationMinutes: 30 })),
    });
    const today = await localDate(0);
    const back = await localDate(5);

    expect(await code(lifecycle.suspend(s.teacherId, s.learnerId, { kind: 'temporary', reason: 'travel', returnOn: back })))
      .toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(lifecycle.suspend(s.ownerId, s.learnerId, { kind: 'temporary', reason: 'travel' })))
      .toBe(CommErrorCode.VALIDATION);
    // The child's own Operations supervisor may record it.
    const pause = await lifecycle.suspend(s.ownerId, s.learnerId, { kind: 'temporary', reason: 'travel', returnOn: back });
    expect(pause).toMatchObject({ kind: 'temporary', startsOn: today, returnOn: back, status: 'active' });
    expect(await code(lifecycle.suspend(tsupId, s.learnerId, { kind: 'permanent', reason: 'finished' })))
      .toBe(CommErrorCode.LESSON_STATE);

    const inWindow = await g.prisma.$queryRawUnsafe<Array<{ outcome: string | null }>>(
      `select outcome from chat.lesson where learner_id = $1::uuid and starts_at > now()
          and (starts_at at time zone '${TZ}')::date < $2::date`,
      s.learnerId, back,
    );
    expect(inWindow.length).toBeGreaterThan(0);
    expect(inWindow.every((l) => l.outcome === 'suspended')).toBe(true);
    // The materializer does not bring them back, and lessons after the return stay on.
    expect(await scheduling.materialize()).toBe(0);
    const after = await g.prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `select count(*) as n from chat.lesson where learner_id = $1::uuid and outcome is null
          and (starts_at at time zone '${TZ}')::date >= $2::date`,
      s.learnerId, back,
    );
    expect(Number(after[0].n)).toBeGreaterThan(0);

    expect((await lifecycle.list(tsupId, { kind: 'temporary' })).suspensions.map((x) => x.id)).toEqual([pause.id]);
    expect((await lifecycle.list(s.otherAdminId, { kind: 'temporary' })).suspensions).toEqual([]);
    expect((await cards()).map((c) => c.card?.kind)).toEqual(['learner_suspended']);

    await lifecycle.end(tsupId, pause.id);
    const resumed = await g.prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `select count(*) as n from chat.lesson where learner_id = $1::uuid and outcome is null and starts_at > now()
          and (starts_at at time zone '${TZ}')::date < $2::date`,
      s.learnerId, back,
    );
    expect(Number(resumed[0].n)).toBeGreaterThan(0);
    expect((await cards()).map((c) => c.card?.kind)).toEqual(['learner_suspended', 'learner_resumed']);
    const core = await g.prisma.outboxEvent.findMany({ where: { type: 'learner.enrollment_changed' } });
    expect(core.map((e) => (e.payload as { status: string }).status).sort()).toEqual(['paused', 'resumed']);
  });

  it('warns once before the return, and ends by itself on the day', async () => {
    const soon = await lifecycle.suspend(tsupId, s.learnerId, { kind: 'temporary', reason: 'exams', returnOn: await localDate(2) });
    const first = await lifecycle.sweep();
    expect(first.noticed).toBe(1);
    expect((await lifecycle.sweep()).noticed).toBe(0);
    expect((await cards()).map((c) => c.card?.kind)).toEqual(['learner_suspended', 'learner_return_soon']);
    expect((await lessons.needsAction(tsupId)).returningSoon.map((r) => r.suspensionId)).toEqual([soon.id]);

    // A pause that reached its return date (written as it would stand after the days passed).
    await g.prisma.$executeRawUnsafe(`update chat.learner_suspension set status = status where id = $1::uuid`, soon.id);
    await g.prisma.$executeRawUnsafe(
      `insert into chat.learner_suspension (organization_id, learner_id, kind, reason_code, starts_on, return_on, created_by)
       values (chat.default_organization_id(), $1::uuid, 'temporary', 'holiday', $2::date, $3::date, $4::uuid)`,
      s.secondLearnerId, await localDate(-5), await localDate(0), tsupId,
    );
    const second = await lifecycle.sweep();
    expect(second.resumed).toBe(1);
    expect(await g.prisma.learnerSuspension.count({ where: { learnerId: s.secondLearnerId, status: 'ended' } })).toBe(1);
  });

  it("the team's list and the worker's sweep agree on the pause's own today, whatever the UTC date", async () => {
    // They used to disagree: the needs-action list compared against the database's
    // UTC current_date, the sweep against the teacher's local date. Pick a zone whose
    // date differs from UTC's right now, so this runs the disagreement at any hour:
    // far ahead (UTC+14) from 11:00 UTC, far behind (UTC-11) before it.
    const [{ hour }] = await g.prisma.$queryRawUnsafe<Array<{ hour: number }>>(
      `select extract(hour from now() at time zone 'UTC')::int as hour`,
    );
    const ahead = hour >= 11;
    const zone = ahead ? 'Pacific/Kiritimati' : 'Pacific/Pago_Pago';
    await scheduling.setAvailability(tsupId, s.teacherId, {
      timezone: zone,
      windows: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '00:00', end: '24:00' })),
    });
    const days = Number(await g.config.get('lesson.return_notice_days'));
    // Ahead: due back exactly at the edge of the notice window locally -- noticed.
    // Behind: one day past the edge locally, but inside it by the UTC date -- not yet.
    const offset = ahead ? days : days + 1;
    const [{ id }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `insert into chat.learner_suspension (organization_id, learner_id, kind, reason_code, starts_on, return_on, created_by)
       values (chat.default_organization_id(), $1::uuid, 'temporary', 'exams',
               (now() at time zone $2)::date, (now() at time zone $2)::date + $3::int, $4::uuid)
       returning id::text as id`,
      s.learnerId, zone, offset, tsupId,
    );

    const listed = (await lessons.needsAction(tsupId)).returningSoon.map((r) => r.suspensionId);
    const noticed = (await lifecycle.sweep()).noticed;
    expect(listed).toEqual(ahead ? [id] : []);
    expect(noticed).toBe(ahead ? 1 : 0);
  });
});

describe('3. a permanent stop', () => {
  it('ends the regular times, suspends every future lesson, and is listed with its reason', async () => {
    await openAllWeek(s.teacherId);
    await scheduling.setSchedule(tsupId, s.learnerId, { slots: [{ weekday: await weekdayIn(3), start: '18:00', durationMinutes: 30 }] });
    const stop = await lifecycle.suspend(tsupId, s.learnerId, { kind: 'permanent', reason: 'financial', note: 'will return next term' });
    expect(stop.returnOn).toBeNull();
    expect(await g.prisma.learnerScheduleSlot.count({ where: { learnerId: s.learnerId, validTo: null } })).toBe(0);
    expect(await g.prisma.lesson.count({ where: { learnerId: s.learnerId, outcome: null, startsAt: { gt: new Date() } } })).toBe(0);
    const listed = await lifecycle.list(tsupId, { kind: 'permanent' });
    expect(listed.suspensions).toEqual([expect.objectContaining({ id: stop.id, reason: 'financial', packageBalance: null })]);
    const core = await g.prisma.outboxEvent.findMany({ where: { type: 'learner.enrollment_changed' } });
    expect(core.map((e) => (e.payload as { status: string }).status)).toEqual(['left']);
  });
});

describe('4. Teacher Supervision', () => {
  it('belongs to the Teachers department; the bonus reaches the teacher\'s supervision chat and Core', async () => {
    expect(await code(supervision.timeline(s.teacherId, s.teacherId))).toBe(CommErrorCode.LESSON_DENIED);
    expect(await code(supervision.timeline(s.ownerId, s.teacherId))).toBe(CommErrorCode.LESSON_DENIED);

    await supervision.addEntry(tsupId, s.teacherId, { kind: 'complaint', body: 'late twice this week' });
    expect(await code(supervision.addEntry(tsupId, s.teacherId, { kind: 'monthly_comment', body: 'good month' })))
      .toBe(CommErrorCode.VALIDATION);
    await supervision.addEntry(tsupId, s.teacherId, { kind: 'monthly_comment', body: 'good month', period: '2026-10' });
    const id = (await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(2 * DAY), endsAt: at(2 * DAY + HOUR / 2) })).id;
    await lessons.teacherApology(s.teacherId, id, { reason: 'ill' });

    const bonus = await supervision.bonus(tsupId, s.teacherId, { reason: 'every report on time in October' });
    const conv = await g.prisma.conversation.findUniqueOrThrow({ where: { id: bonus.conversationId } });
    expect([conv.type, conv.supervisedTeacherId]).toEqual(['teacher_supervision', s.teacherId]);
    const card = (await cards(bonus.conversationId)).find((c) => c.card?.kind === 'teacher_bonus');
    expect(card?.card?.payload).toMatchObject({ reason: 'every report on time in October' });
    expect(card?.authorType).toBe('staff');
    expect(await g.prisma.outboxEvent.count({ where: { type: 'teacher.bonus_recorded' } })).toBe(1);
    // The teacher reads the bonus card in their chat.
    const seen = await g.messages.list({ conversationId: bonus.conversationId, actorId: s.teacherId });
    expect(seen.messages.some((m) => m.card?.kind === 'teacher_bonus')).toBe(true);

    const t = await supervision.timeline(tsupId, s.teacherId);
    expect(t.items.map((i) => i.type).sort()).toEqual(['bonus', 'complaint', 'monthly_comment', 'teacher_apology']);
    // Every item has an id, and what a person recorded carries their name.
    expect(t.items.every((i) => typeof i.id === 'string')).toBe(true);
    expect(t.items.find((i) => i.type === 'bonus')).toMatchObject({ byName: 'tsup_a' });

    await expect(g.prisma.$executeRawUnsafe(
      `insert into chat.teacher_supervision_entry (organization_id, teacher_id, kind, body, created_by)
       values (chat.default_organization_id(), $1::uuid, 'note', 'x', $2::uuid)`,
      s.teacherId, s.ownerId,
    )).rejects.toThrow(/own Teachers department/);
  });
});
