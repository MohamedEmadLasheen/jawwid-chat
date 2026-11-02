/**
 * PD-46 PR-3a (CHATSCHED-002): a lesson card is history, never rewritten --
 * and the chat can say where the lesson stands now.
 *
 * GET conversations/:id/lesson-now answers, for each lesson a time-announcing
 * card in the conversation is about, the end of its move chain: its time and a
 * plain status (upcoming / held / missed / cancelled), nothing about who or why.
 *
 * Synthetic fixtures only (QA gate G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError } from '@platform/errors';
import { LessonService } from '../../src/lessons/lesson.service';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(120_000);

const g = buildGraph();
const audit = new PrismaAuditService();
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);

const TZ = 'Africa/Cairo';
const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

let s: Scenario;
let tsupId: string;
let groupId: string;

async function addAt(ms: number, learnerId = s.learnerId) {
  return lessons.schedule(tsupId, { learnerId, startsAt: at(ms), endsAt: at(ms + 30 * MIN) });
}
/** Move by staff to a free time `afterMs` past the lesson's own start. */
async function moveLater(lessonId: string, startsAt: string) {
  const offer = await scheduling.moveSlots(tsupId, lessonId);
  const to = offer.slots.find((x) => new Date(x).getTime() >= new Date(startsAt).getTime() + HOUR);
  expect(to).toBeDefined();
  return scheduling.moveLesson(tsupId, lessonId, { startsAt: to });
}

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
  await scheduling.setAvailability(tsupId, s.teacherId, {
    timezone: TZ,
    windows: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '00:00', end: '24:00' })),
  });
}, TRUNCATING_HOOK_MS);

describe('CHATSCHED-002: where a carded lesson stands now', () => {
  it('a lesson moved twice: every card of it points at the last time, upcoming', async () => {
    const added = await addAt(26 * HOUR);
    const once = await moveLater(added.id, added.startsAt);
    const twice = await moveLater(once.id, once.startsAt);

    const now = await lessons.lessonNow(s.parentId, groupId);
    const byLesson = new Map(now.lessons.map((l) => [l.lessonId, l]));
    // The added card's lesson, and the first move's -- both end where the second move did.
    for (const id of [added.id, once.id]) {
      expect(byLesson.get(id)).toMatchObject({ currentLessonId: twice.id, startsAt: twice.startsAt, status: 'upcoming' });
    }
    expect(byLesson.get(twice.id)).toMatchObject({ currentLessonId: twice.id, startsAt: twice.startsAt, status: 'upcoming' });
  });

  it('a moved lesson later cancelled reads cancelled -- no reason, no recorder', async () => {
    const added = await addAt(26 * HOUR);
    const moved = await moveLater(added.id, added.startsAt);
    await lessons.cancel(tsupId, moved.id, { reason: 'public holiday' });

    const now = await lessons.lessonNow(s.parentId, groupId);
    const entry = now.lessons.find((l) => l.lessonId === added.id);
    expect(entry).toEqual({ lessonId: added.id, currentLessonId: moved.id, startsAt: moved.startsAt, endsAt: moved.endsAt, status: 'cancelled' });
  });

  it('answers only for this conversation\'s cards, and only to someone who may read it', async () => {
    const mine = await addAt(30 * HOUR);
    // Another family's child of the same teacher, in its own group.
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
    const theirs = await g.conversations.ensureStudentGroup(learnerId, s.ownerId);
    const other = await addAt(34 * HOUR, learnerId);

    const now = await lessons.lessonNow(s.parentId, groupId);
    expect(now.lessons.map((l) => l.lessonId)).toEqual([mine.id]);
    expect((await lessons.lessonNow(contactId, theirs.id)).lessons.map((l) => l.lessonId)).toEqual([other.id]);
    // The other family's parent may not read this family's group.
    const refused = await lessons.lessonNow(contactId, groupId).then(() => null, (e: unknown) => e);
    expect(refused).toBeInstanceOf(CommError);
  });
});
