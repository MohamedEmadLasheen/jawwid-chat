/**
 * PD-46 PR-1 (docs/product/pd046-schedule-chat-integration-plan.md §3.2-3.4):
 * every lesson change is announced, once.
 *
 *   - chat.lesson.revision is bumped by the database on a change a reader sees,
 *     and only then;
 *   - a change made outside the writer lands in chat.lesson_change_unannounced
 *     (the safety net); one made by a transaction marked as the writer does not;
 *   - LessonEvents.record enqueues one keyed `lesson.changed` per lesson and
 *     revision -- a second record of the same change is a no-op;
 *   - the sweep announces what the writer did not: one `lesson.changed`
 *     (external) per lesson, and weekly materialization as ONE
 *     `schedule.refreshed`;
 *   - the worker fans `lesson.changed` out to the teacher, the staff whose
 *     calendar scope covers the lesson (decided at delivery) and the family's
 *     conversations -- and to nobody else.
 */
import { PrismaAuditService } from '@platform/audit.service';
import { OutboxWorker } from '@communication/outbox/outbox.worker';
import { CommEvent } from '@communication/contracts/events';
import { LessonService } from '../../src/lessons/lesson.service';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { LessonEvents } from '../../src/lessons/lesson-events';
import { CalendarService } from '../../src/calendar/calendar.service';
import { LessonAudienceService } from '../../src/calendar/lesson-audience.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(120_000);

const g = buildGraph();
const audit = new PrismaAuditService();
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);
const calendar = new CalendarService(g.prisma, g.conversations, lessons, g.config);
const events = new LessonEvents(g.prisma);

/** A realtime publisher that records what it was asked to deliver. */
const sent: Array<{ via: 'users' | 'thread'; to: string[]; event: string; payload: any }> = [];
const recording = {
  toUsers: async (ids: string[], event: string, payload: unknown) => void sent.push({ via: 'users', to: ids, event, payload }),
  toThread: async (id: string, event: string, payload: unknown) => void sent.push({ via: 'thread', to: [id], event, payload }),
  toThreadAudience: async () => undefined,
};
const worker = new OutboxWorker(g.prisma, g.notifications, recording as never, g.identity);
new LessonAudienceService(g.prisma, calendar, worker, g.identity).onModuleInit();

const HOUR = 3_600_000;
let s: Scenario;
let groupId: string;

/** A one-off lesson, written straight to the table: creation through the writer is PR-2's. */
async function lessonAt(offsetMs: number, learnerId = s.learnerId): Promise<string> {
  const l = await g.prisma.lesson.create({
    data: {
      learnerId,
      teacherId: s.teacherId,
      createdBy: s.ownerId,
      startsAt: new Date(Date.now() + offsetMs),
      endsAt: new Date(Date.now() + offsetMs + HOUR / 2),
    },
    select: { id: true },
  });
  return l.id;
}
const revisionOf = async (id: string) => Number((await g.prisma.lesson.findUniqueOrThrow({ where: { id }, select: { revision: true } })).revision);
const unannounced = (id: string) => g.prisma.lessonChangeUnannounced.findMany({ where: { lessonId: id }, orderBy: { revision: 'asc' } });
const keyed = (key: string) => g.prisma.outboxEvent.findMany({ where: { idempotencyKey: key } });
const pendingOf = (type: string) => g.prisma.outboxEvent.findMany({ where: { type, status: 'pending' }, orderBy: { createdAt: 'asc' } });

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  groupId = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;
  await g.prisma.lessonChangeUnannounced.deleteMany({});
  await g.prisma.outboxEvent.deleteMany({});
  sent.length = 0;
});

describe('chat.lesson.revision', () => {
  it('starts at 0, is bumped by a change a reader sees, and is the database\'s to give', async () => {
    const id = await lessonAt(5 * HOUR);
    expect(await revisionOf(id)).toBe(0);
    await g.prisma.$executeRawUnsafe(`update chat.lesson set starts_at = starts_at + interval '30 minutes', ends_at = ends_at + interval '30 minutes' where id = $1::uuid`, id);
    expect(await revisionOf(id)).toBe(1);
    // Bookkeeping a reader does not see: no new revision.
    await g.prisma.lesson.update({ where: { id }, data: { remindersScheduledAt: new Date() } });
    expect(await revisionOf(id)).toBe(1);
    // Nobody sets it by hand.
    await g.prisma.$executeRawUnsafe(`update chat.lesson set revision = 99 where id = $1::uuid`, id);
    expect(await revisionOf(id)).toBe(1);
  });
});

describe('the safety net: a change outside the writer is recorded, one inside it is not', () => {
  it('an unmarked insert and update are recorded with their revisions; a marked transaction records nothing', async () => {
    const id = await lessonAt(5 * HOUR); // LessonService.schedule does not use the writer yet (PR-2)
    expect((await unannounced(id)).map((r) => [Number(r.revision), r.op, r.fromSlot])).toEqual([[0, 'insert', false]]);

    await g.prisma.$executeRawUnsafe(`update chat.lesson set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour' where id = $1::uuid`, id);
    expect((await unannounced(id)).map((r) => Number(r.revision))).toEqual([0, 1]);

    await g.prisma.$transaction(async (tx) => {
      await LessonEvents.markWriter(tx);
      await tx.$executeRawUnsafe(`update chat.lesson set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour' where id = $1::uuid`, id);
    });
    expect(await revisionOf(id)).toBe(2);
    expect((await unannounced(id)).map((r) => Number(r.revision))).toEqual([0, 1]); // revision 2 announced by its writer
  });
});

describe('LessonEvents.record: one keyed signal per lesson, revision and change', () => {
  it('enqueues lesson.changed with the family\'s conversations, and a second record of the same change is a no-op', async () => {
    const id = await lessonAt(5 * HOUR);
    const first = await g.prisma.$transaction((tx) => events.record(tx, [id], 'created'));
    const again = await g.prisma.$transaction((tx) => events.record(tx, [id, id], 'created'));
    expect([first, again]).toEqual([1, 0]);
    const [row] = await keyed(`lesson:${id}:0:created`);
    expect(row!.type).toBe(CommEvent.LESSON_CHANGED);
    expect(row!.payload).toMatchObject({
      lessonId: id, revision: 0, change: 'created', teacherId: s.teacherId, learnerId: s.learnerId,
      previousStartsAt: null, conversationIds: [groupId],
    });
    // Another change of the same revision is another signal.
    expect(await g.prisma.$transaction((tx) => events.record(tx, [id], 'outcome'))).toBe(1);
  });

  it('a move names where the lesson was', async () => {
    // PD-31's shape, written directly: the old row closed `rescheduled`, the new one naming it.
    const from = await lessonAt(5 * HOUR);
    const to = await g.prisma.$transaction(async (tx) => {
      // One transaction, as the guard requires: moved away (outcome_at = now()), then continued.
      await tx.$executeRawUnsafe(
        `update chat.lesson set outcome = 'rescheduled', outcome_by_kind = 'staff', outcome_by = $2::uuid, outcome_at = now() where id = $1::uuid`,
        from, s.ownerId,
      );
      const created = await tx.lesson.create({
        data: {
          learnerId: s.learnerId, teacherId: s.teacherId, createdBy: s.ownerId, movedFrom: from,
          startsAt: new Date(Date.now() + 7 * HOUR), endsAt: new Date(Date.now() + 7 * HOUR + HOUR / 2),
        },
        select: { id: true },
      });
      await events.record(tx, [created.id], 'moved');
      return created;
    });
    const [row] = await keyed(`lesson:${to.id}:0:moved`);
    const fromStart = (await g.prisma.lesson.findUniqueOrThrow({ where: { id: from }, select: { startsAt: true } })).startsAt;
    expect((row!.payload as any).previousStartsAt).toBe(fromStart.toISOString());
  });
});

describe('the sweep announces what the writer did not', () => {
  it('a lesson changed outside the writer: ONE lesson.changed (external) at its current revision; the table empties', async () => {
    const id = await lessonAt(5 * HOUR);
    await g.prisma.$executeRawUnsafe(`update chat.lesson set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour' where id = $1::uuid`, id);
    const r = await events.announceUnannounced();
    expect(r).toEqual({ lessons: 1, refreshed: 0 });
    expect((await keyed(`lesson:${id}:1:external`)).length).toBe(1);
    expect(await g.prisma.lessonChangeUnannounced.count()).toBe(0);
    // Swept again: nothing new.
    expect(await events.announceUnannounced()).toEqual({ lessons: 0, refreshed: 0 });
  });

  it('weekly materialization is ONE schedule.refreshed for its teachers and learners, never a signal per lesson', async () => {
    for (let wd = 1; wd <= 7; wd++) {
      await g.prisma.$executeRawUnsafe(
        `insert into chat.learner_schedule_slot (organization_id, learner_id, teacher_id, weekday, start_minute, duration_minutes, timezone, valid_from, created_by)
         select organization_id, id, teacher_id, $2, 22 * 60, 30, 'Africa/Cairo', current_date + 1, $3::uuid from chat.learner where id = $1::uuid`,
        s.learnerId, wd, s.ownerId,
      );
    }
    const made = await scheduling.materialize();
    expect(made).toBeGreaterThan(7);
    const r = await events.announceUnannounced();
    expect(r.refreshed).toBe(1);
    expect(r.lessons).toBe(0);
    const [refresh, ...more] = await pendingOf(CommEvent.SCHEDULE_REFRESHED);
    expect(more).toHaveLength(0);
    expect(refresh!.payload).toMatchObject({ teacherIds: [s.teacherId], learnerIds: [s.learnerId] });
    expect(await pendingOf(CommEvent.LESSON_CHANGED)).toHaveLength(0);
  });
});

describe('the worker fans lesson.changed out to exactly who may see the lesson', () => {
  it('the teacher, the PD-8 supervisor and the Operations manager (actor rooms) and the family\'s group -- not another supervisor', async () => {
    const id = await lessonAt(5 * HOUR);
    await g.prisma.$transaction((tx) => events.record(tx, [id], 'created'));
    await worker.drain();
    const toUsers = sent.find((x) => x.via === 'users' && x.event === CommEvent.LESSON_CHANGED)!;
    expect(toUsers.to).toEqual(expect.arrayContaining([s.teacherId, s.ownerId, s.managerId]));
    expect(toUsers.to).not.toContain(s.otherAdminId);
    expect(toUsers.to).not.toContain(s.unrelatedTeacherId);
    expect(toUsers.payload).toMatchObject({ lessonId: id, change: 'created' });
    expect(sent.filter((x) => x.via === 'thread' && x.event === CommEvent.LESSON_CHANGED).map((x) => x.to[0])).toEqual([groupId]);
    expect(await g.prisma.outboxEvent.count({ where: { idempotencyKey: `lesson:${id}:0:created`, status: 'published' } })).toBe(1);
  });

  it('schedule.refreshed reaches the teacher and the staff in scope of the teacher or the learner', async () => {
    const { organizationId } = await g.prisma.learner.findUniqueOrThrow({ where: { id: s.learnerId }, select: { organizationId: true } });
    await g.prisma.outboxEvent.create({
      data: { type: CommEvent.SCHEDULE_REFRESHED, payload: { organizationId, teacherIds: [s.teacherId], learnerIds: [s.learnerId] } },
    });
    await worker.drain();
    const refresh = sent.find((x) => x.event === CommEvent.SCHEDULE_REFRESHED)!;
    expect(refresh.to).toEqual(expect.arrayContaining([s.teacherId, s.ownerId]));
    expect(refresh.to).not.toContain(s.otherAdminId);
  });
});

