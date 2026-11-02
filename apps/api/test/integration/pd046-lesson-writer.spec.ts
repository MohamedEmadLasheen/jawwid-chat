/**
 * PD-46 PR-2 (plan §3.1, §3.4): every lesson write goes through LessonWriter
 * and is announced in its own transaction; cards are once-only.
 *
 *   - the writers of §1.1 announce what they change, in the same transaction:
 *     nothing they write reaches the safety net (chat.lesson_change_unannounced)
 *     except weekly materialization, which is meant to (one schedule.refreshed);
 *   - a raw change in the same transaction as a writer call is still swept:
 *     the writer takes back only the lessons it announced;
 *   - CHATSCHED-001: a lesson added outside the weekly times posts a
 *     `lesson_scheduled` card in the family's group;
 *   - a keyed card is posted once, however often it is asked for;
 *   - CHATSCHED-012: a lesson whose teacher is not in the family's group (an
 *     old teacher closing their remaining lessons) still posts its card there.
 *
 * Synthetic fixtures only (QA gate G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommEvent } from '@communication/contracts/events';
import { LessonService } from '../../src/lessons/lesson.service';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { LifecycleService } from '../../src/lessons/lifecycle.service';
import { SupervisionConversationService } from '../../src/supervision/supervision-conversation.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(120_000);

const g = buildGraph();
const audit = new PrismaAuditService();
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);
const supervisionChats = new SupervisionConversationService(g.prisma, g.authz, g.conversations, g.outbox, audit);
const lifecycle = new LifecycleService(g.prisma, g.conversations, lessons, scheduling, g.outbox, g.config, audit, supervisionChats);

const TZ = 'Africa/Cairo';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

let s: Scenario;
let tsupId: string;

/** Lessons changed outside a writer (weekly materialization excepted, which is expected there). */
const unannouncedByHand = () => g.prisma.lessonChangeUnannounced.findMany({ where: { fromSlot: false } });
const changedEvents = async (lessonId: string) =>
  (await g.prisma.outboxEvent.findMany({ where: { type: CommEvent.LESSON_CHANGED }, orderBy: { createdAt: 'asc' } }))
    .map((e) => e.payload as { lessonId: string; change: string; revision: number })
    .filter((p) => p.lessonId === lessonId);
const cardsIn = (conversationId: string) =>
  g.prisma.message.findMany({ where: { conversationId, type: 'card' }, include: { card: true }, orderBy: { seq: 'asc' } });

beforeAll(async () => {
  await g.prisma.$connect();
});
const TRUNCATING_HOOK_MS = 60_000;
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
}, TRUNCATING_HOOK_MS);
beforeEach(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.config where key like 'lesson.%'`);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
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
  await scheduling.setAvailability(tsupId, s.teacherId, {
    timezone: TZ,
    windows: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '00:00', end: '24:00' })),
  });
  await g.prisma.lessonChangeUnannounced.deleteMany({});
  await g.prisma.outboxEvent.deleteMany({});
}, TRUNCATING_HOOK_MS);

describe('the writers announce their own changes', () => {
  it('add, move and cancel: each is announced in its transaction, and the safety net stays empty', async () => {
    const groupId = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;
    const added = await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(3 * DAY), endsAt: at(3 * DAY + HOUR / 2) });
    expect((await changedEvents(added.id)).map((e) => e.change)).toEqual(['created']);

    const offer = await scheduling.moveSlots(s.ownerId, added.id);
    const moved = await scheduling.moveLesson(s.ownerId, added.id, { startsAt: offer.slots[20] });
    expect((await changedEvents(added.id)).map((e) => e.change)).toEqual(['created', 'moved']);
    expect((await changedEvents(moved.id)).map((e) => e.change)).toEqual(['moved']);

    await lessons.cancel(tsupId, moved.id, { reason: 'public holiday' });
    expect((await changedEvents(moved.id)).map((e) => e.change)).toEqual(['moved', 'cancelled']);

    expect(await unannouncedByHand()).toEqual([]);
    expect((await cardsIn(groupId)).map((m) => m.card?.kind)).toEqual(expect.arrayContaining(['lesson_scheduled', 'lesson_moved', 'lesson_cancelled']));
  });

  it('a pause suspends the lessons in its window and announces each as paused', async () => {
    await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    const a = (await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(2 * DAY), endsAt: at(2 * DAY + HOUR / 2) })).id;
    const b = (await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(3 * DAY), endsAt: at(3 * DAY + HOUR / 2) })).id;
    const [{ d: back }] = await g.prisma.$queryRawUnsafe<Array<{ d: string }>>(
      `select to_char((now() at time zone '${TZ}')::date + 6, 'YYYY-MM-DD') as d`,
    );
    await lifecycle.suspend(s.ownerId, s.learnerId, { kind: 'temporary', reason: 'travel', returnOn: back });
    for (const id of [a, b]) expect((await changedEvents(id)).map((e) => e.change)).toEqual(['created', 'paused']);
    expect(await unannouncedByHand()).toEqual([]);
  });

  it('a raw change beside a writer call in one transaction is still swept: the writer takes back only its own', async () => {
    const mine = (await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(3 * DAY), endsAt: at(3 * DAY + HOUR / 2) })).id;
    const other = (await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(4 * DAY), endsAt: at(4 * DAY + HOUR / 2) })).id;
    await g.prisma.$transaction(async (tx) => {
      await lessons.writer.update(tx, 'moved', mine, { startsAt: new Date(Date.now() + 5 * DAY), endsAt: new Date(Date.now() + 5 * DAY + HOUR / 2) });
      await tx.$executeRawUnsafe(`update chat.lesson set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour' where id = $1::uuid`, other);
    });
    expect((await unannouncedByHand()).map((r) => r.lessonId)).toEqual([other]);
  });
});

describe('CHATSCHED-001: a lesson added outside the weekly times', () => {
  it('posts one lesson_scheduled card in the family\'s group, with its time', async () => {
    const groupId = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;
    const before = (await cardsIn(groupId)).length;
    const startsAt = at(3 * DAY);
    const added = await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt, endsAt: at(3 * DAY + HOUR / 2) });
    const cards = (await cardsIn(groupId)).slice(before);
    expect(cards).toHaveLength(1);
    expect(cards[0].card).toMatchObject({ kind: 'lesson_scheduled', lessonId: added.id, idempotencyKey: `lesson:${added.id}:0:created` });
    expect((cards[0].card?.payload as { startsAt: string }).startsAt).toBe(startsAt);
  });
});

describe('a keyed card is posted once', () => {
  it('the same key posted again answers the first card', async () => {
    const groupId = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;
    const added = await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(3 * DAY), endsAt: at(3 * DAY + HOUR / 2) });
    const { organizationId } = await g.prisma.lesson.findUniqueOrThrow({ where: { id: added.id }, select: { organizationId: true } });
    const subject = { id: added.id, learnerId: s.learnerId, organizationId, teacherId: s.teacherId };
    const key = `lesson:${added.id}:0:created`;
    const before = (await cardsIn(groupId)).length;
    const again = await g.prisma.$transaction((tx) =>
      lessons.postCard(tx, subject, null, 'lesson_scheduled', { learnerName: 'x' }, 'en', { idempotencyKey: key }));
    expect((await cardsIn(groupId)).length).toBe(before);
    const first = await g.prisma.messageCard.findUniqueOrThrow({ where: { idempotencyKey: key } });
    expect(again).toBe(first.messageId);
  });
});

describe('CHATSCHED-012: which family group a lesson\'s card may go to', () => {
  /** A second family, with its own child taught by the same teacher, and its own family group. */
  async function otherFamily(): Promise<{ learnerId: string; groupId: string }> {
    const [familyId, contactId, learnerId] = [randomUUID(), randomUUID(), randomUUID()];
    await g.prisma.$executeRawUnsafe(`insert into chat.family (id, display_name, owner_id, language) values ($1::uuid, 'family_y', $2::uuid, 'ar')`, familyId, s.ownerId);
    await g.prisma.$executeRawUnsafe(
      `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active) values ($1::uuid, $2::uuid, 'parent_y', 'primary_guardian', true, true)`,
      contactId, familyId,
    );
    await g.prisma.$transaction([
      g.prisma.$executeRawUnsafe(`select set_config('chat.syncing_assignment', 'on', true)`),
      g.prisma.$executeRawUnsafe(`insert into chat.learner (id, family_id, name, teacher_id) values ($1::uuid, $2::uuid, 'learner_y', $3::uuid)`, learnerId, familyId, s.teacherId),
    ]);
    await g.prisma.$executeRawUnsafe(
      `insert into chat.learner_supervision (learner_id, organization_id, supervisor_id, assigned_by) values ($1::uuid, chat.default_organization_id(), $2::uuid, $3::uuid)`,
      learnerId, s.ownerId, s.managerId,
    );
    const conv = await g.conversations.createFamilyGroup(s.ownerId, { learnerIds: [learnerId], contactIds: [contactId], teacherIds: [s.teacherId] });
    return { learnerId, groupId: conv.id };
  }

  it('a group the lesson\'s teacher has LEFT still gets the card (the old teacher closing what remains)', async () => {
    const conv = await g.conversations.createFamilyGroup(s.ownerId, { learnerIds: [s.learnerId], contactIds: [s.parentId], teacherIds: [s.teacherId] });
    await g.prisma.$executeRawUnsafe(`update chat.conversation_member set left_at = now() where conversation_id = $1::uuid and actor_id = $2::uuid`, conv.id, s.teacherId);
    const added = await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(3 * DAY), endsAt: at(3 * DAY + HOUR / 2) });
    expect((await cardsIn(conv.id)).map((m) => [m.card?.kind, m.card?.lessonId])).toContainEqual(['lesson_scheduled', added.id]);
  });

  it('a group only a SIBLING\'s teacher was let into gets no card of this child', async () => {
    const siblings = await g.conversations.createFamilyGroup(s.ownerId, {
      learnerIds: [s.learnerId, s.secondLearnerId], contactIds: [s.parentId], teacherIds: [s.newTeacherId],
    });
    const added = await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(3 * DAY), endsAt: at(3 * DAY + HOUR / 2) });
    expect((await cardsIn(siblings.id)).filter((m) => m.card?.lessonId === added.id)).toEqual([]);
  });

  it('another family\'s group never gets it, even with the same teacher in it', async () => {
    await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    const other = await otherFamily();
    const added = await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: at(3 * DAY), endsAt: at(3 * DAY + HOUR / 2) });
    expect((await cardsIn(other.groupId)).filter((m) => m.card?.lessonId === added.id)).toEqual([]);
  });
});
