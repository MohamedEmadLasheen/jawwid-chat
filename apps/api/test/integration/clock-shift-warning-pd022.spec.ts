/**
 * PD-22 daylight-saving warning, on a real database.
 *
 * A weekly lesson is anchored in the teacher's zone (Cairo). On 2026-10-29 Egypt
 * leaves summer time at the end of Thursday; Kuwait has none. A Kuwait parent's
 * Friday 17:00 Cairo lesson is 17:00 their time on 23 October and 18:00 on
 * 30 October, so they are told, once, three days before -- and a Cairo parent,
 * a parent with no known zone, and a slot that only begins after the change
 * are not. A warning that stops holding is cancelled before it is sent, and
 * revived if it holds again.
 *
 * Synthetic fixtures only (QA gate G-16).
 */
import { PrismaAuditService } from '@platform/audit.service';
import { NotificationService } from '@communication/notifications/notification.service';
import type { PushProvider } from '@communication/notifications/push.provider';
import { LessonService } from '../../src/lessons/lesson.service';
import { CLOCK_SHIFT_EVENT, SchedulingService } from '../../src/lessons/scheduling.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

const g = buildGraph();
const audit = new PrismaAuditService();
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);

/** Thursday 22 October 2026, 15:00 in Cairo: a week before the change. */
const NOW = new Date('2026-10-22T12:00:00Z');
/** Friday 30 October 2026, 17:00 Cairo (UTC+2 from that day): the first lesson at the new Kuwait time. */
const FIRST_NEW = '2026-10-30T15:00:00.000Z';

let s: Scenario;
let orgId: string;
let slotId: string;

async function addSlot(learnerId: string, weekday: number, start: number, validFrom: string): Promise<string> {
  const [{ id }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.learner_schedule_slot
       (organization_id, learner_id, teacher_id, weekday, start_minute, duration_minutes, timezone, valid_from, created_by)
     values ($1::uuid, $2::uuid, $3::uuid, $4, $5, 30, 'Africa/Cairo', $6::date, $7::uuid)
     returning id::text as id`,
    orgId, learnerId, s.teacherId, weekday, start, validFrom, s.ownerId,
  );
  return id;
}

async function setZone(actorId: string, timeZone: string) {
  await g.prisma.actorTimeZone.upsert({
    where: { actorId },
    create: { actorId, organizationId: orgId, timeZone },
    update: { timeZone },
  });
}

const warnings = () =>
  g.prisma.notification.findMany({ where: { eventType: CLOCK_SHIFT_EVENT }, orderBy: { createdAt: 'asc' } });

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
  [{ id: orgId }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(`select chat.default_organization_id()::text as id`);
  // Friday 17:00 Cairo, since September.
  slotId = await addSlot(s.learnerId, 5, 17 * 60, '2026-09-01');
  await setZone(s.parentId, 'Asia/Kuwait');
  await setZone(s.otherParentId, 'Africa/Cairo');
});

describe('PD-22 daylight-saving warning', () => {
  it('tells the Kuwait parent once, three days before the first lesson at the new time', async () => {
    expect(await scheduling.scheduleClockShiftWarnings(NOW)).toBe(1);
    const [w, ...rest] = await warnings();
    expect(rest).toEqual([]);
    expect(w).toMatchObject({
      recipientId: s.parentId,
      status: 'scheduled',
      templateKey: 'lesson_clock_shift',
      ruleKey: 'lesson_clock_shift_parent',
      familyId: s.familyId,
      dedupeKey: `lesson_clock_shift_parent:${slotId}:2026-10-30:${s.parentId}`,
      variables: { startsAt: FIRST_NEW },
    });
    expect(w!.scheduledAt.toISOString()).toBe('2026-10-27T15:00:00.000Z');

    // The sweep runs hourly; a second look changes nothing.
    expect(await scheduling.scheduleClockShiftWarnings(new Date(NOW.getTime() + 3_600_000))).toBe(1);
    expect(await warnings()).toHaveLength(1);
  });

  it('the push says the day and the new time in the parent\'s zone, and names nobody', async () => {
    const bodies: string[] = [];
    const push: PushProvider = {
      send: async (msg) => {
        bodies.push(`${msg.title}|${msg.body}`);
        return { ok: true };
      },
    } as PushProvider;
    const notifications = new NotificationService(g.prisma, g.templates, g.quietHours, g.config, push);
    await g.prisma.deviceToken.create({ data: { organizationId: orgId, actorId: s.parentId, token: `pd22-dst-${slotId}`, platform: 'ios' } });

    await g.prisma.$executeRawUnsafe(`update chat.family set language = 'en' where id = $1::uuid`, s.familyId);
    await scheduling.scheduleClockShiftWarnings(NOW);
    expect(await notifications.dispatchDue(new Date('2026-10-27T15:00:01Z'))).toBe(1);
    expect(bodies).toEqual(['Jawwid|The clocks are changing: from Friday 30 October, the lesson starts at 18:00 your time.']);
    expect(bodies[0]).not.toMatch(/learner_l|parent_p|teacher_c/);

    const ar = await g.templates.render('lesson_clock_shift', 'ar', { day: 'الجمعة ٣٠ أكتوبر', time: '٦:٠٠ م' });
    expect(ar).toEqual({ title: 'جَوِّد', body: 'بسبب تغيير التوقيت، تبدأ الحصة ابتداءً من الجمعة ٣٠ أكتوبر الساعة ٦:٠٠ م بتوقيتك.' });
  });

  it('tells nobody whose local time does not move, or whose zone is unknown', async () => {
    await setZone(s.parentId, 'Africa/Cairo');
    expect(await scheduling.scheduleClockShiftWarnings(NOW)).toBe(0);
    await g.prisma.actorTimeZone.deleteMany({ where: { actorId: { in: [s.parentId, s.otherParentId] } } });
    expect(await scheduling.scheduleClockShiftWarnings(NOW)).toBe(0);
    expect(await warnings()).toEqual([]);
  });

  it('a weekly time that only begins after the change was never at the old time: no warning', async () => {
    await g.prisma.$executeRawUnsafe(`update chat.learner_schedule_slot set valid_to = valid_from where id = $1::uuid`, slotId);
    await addSlot(s.learnerId, 5, 17 * 60, '2026-10-30');
    expect(await scheduling.scheduleClockShiftWarnings(NOW)).toBe(0);
  });

  it('one warning per slot: two weekly times, two warnings; a second Kuwait parent, one each', async () => {
    await addSlot(s.learnerId, 1, 16 * 60, '2026-09-01'); // Monday 16:00 Cairo: moves on 2 November
    await setZone(s.otherParentId, 'Asia/Kuwait');
    expect(await scheduling.scheduleClockShiftWarnings(NOW)).toBe(4);
    expect(await scheduling.scheduleClockShiftWarnings(new Date('2026-10-28T12:00:00Z'))).toBe(4);
    expect(await warnings()).toHaveLength(4);
    const keys = (await warnings()).map((w) => w.dedupeKey.split(':').slice(2, 3)[0]).sort();
    expect(keys).toEqual(['2026-10-30', '2026-10-30', '2026-11-02', '2026-11-02']);
  });

  it('cancels a warning that stops holding, and revives it if it holds again', async () => {
    await scheduling.scheduleClockShiftWarnings(NOW);

    // The parent flew to Cairo: their lesson time no longer moves.
    await setZone(s.parentId, 'Africa/Cairo');
    expect(await scheduling.scheduleClockShiftWarnings(NOW)).toBe(0);
    expect((await warnings()).map((w) => [w.status, w.failureCode])).toEqual([['cancelled', 'CLOCK_SHIFT_GONE']]);

    // And back to Kuwait before the change: the same warning stands again.
    await setZone(s.parentId, 'Asia/Kuwait');
    expect(await scheduling.scheduleClockShiftWarnings(NOW)).toBe(1);
    expect((await warnings()).map((w) => [w.status, w.failureCode])).toEqual([['scheduled', null]]);

    // The regular time is replaced before the change: nothing is owed.
    await g.prisma.$executeRawUnsafe(`update chat.learner_schedule_slot set valid_to = '2026-10-24' where id = $1::uuid`, slotId);
    expect(await scheduling.scheduleClockShiftWarnings(NOW)).toBe(0);
    expect((await warnings()).map((w) => w.status)).toEqual(['cancelled']);
  });

  it('never revives a warning cancelled for another reason', async () => {
    await scheduling.scheduleClockShiftWarnings(NOW);
    await g.prisma.notification.updateMany({
      where: { eventType: CLOCK_SHIFT_EVENT },
      data: { status: 'cancelled', failureCode: 'RECIPIENT_INACTIVE' },
    });
    await scheduling.scheduleClockShiftWarnings(NOW);
    expect((await warnings()).map((w) => [w.status, w.failureCode])).toEqual([['cancelled', 'RECIPIENT_INACTIVE']]);
  });

  it('holds until the first lesson at the new time begins, and not after', async () => {
    await scheduling.scheduleClockShiftWarnings(NOW);
    // Half an hour before it (16:30 Cairo, 7 days and 1 hour after the last old-time lesson).
    expect(await scheduling.scheduleClockShiftWarnings(new Date('2026-10-30T14:30:00Z'))).toBe(1);
    expect((await warnings()).map((w) => w.status)).toEqual(['scheduled']);
    // It has begun: a warning not yet sent is now too late, and is cancelled.
    expect(await scheduling.scheduleClockShiftWarnings(new Date('2026-10-30T15:30:00Z'))).toBe(0);
    expect((await warnings()).map((w) => w.status)).toEqual(['cancelled']);
  });
});
