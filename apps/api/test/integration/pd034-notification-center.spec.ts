/**
 * PD-34 P1: the Notification Center and the pipeline under it, on a real
 * database. Synthetic people only.
 *
 *   1. reminders become Center entries, keyed like their deliveries, so a
 *      producer moved onto the pipeline converges with what its old code wrote
 *   2. the reason gone -> delivery and entry withdrawn (every cancel path,
 *      SQL included, through the trigger); a lifecycle re-emit revives
 *   3. messages: one entry per chat with a growing count, coalesced pushes,
 *      reading withdraws the waiting push and reads the entry
 *   4. preferences, locked categories, rate limit, default quiet hours,
 *      lock-screen names
 *   5. scope: a person reads and changes only their own; tenant refusal
 *   6. adoption of legacy rows; announcement to the person's own room
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError } from '@platform/errors';
import { CommEvent } from '@communication/contracts/events';
import { NotificationPipeline } from '@communication/notifications/notification-pipeline.service';
import { ReminderService } from '@communication/notifications/reminder.service';
import { LessonService, cancelReminders } from '../../src/lessons/lesson.service';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
const audit = new PrismaAuditService();
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);

const told: Array<{ users: string[]; event: string; payload: unknown }> = [];
const recording = {
  toThread: async () => undefined,
  toUsers: async (users: string[], event: string, payload: unknown) => {
    told.push({ users, event, payload });
  },
};
const pipeline = new NotificationPipeline(g.prisma, g.notifications, g.quietHours, g.config, g.identity, recording as never);

const MIN = 60_000;
const HOUR = 60 * MIN;
let s: Scenario;
let tsupId: string;

async function actor(id: string) {
  const a = await g.identity.resolveActor(id);
  if (!a) throw new Error(`no actor ${id}`);
  return a;
}

async function refusal(p: Promise<unknown>): Promise<number> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.status;
    throw e;
  }
  throw new Error('expected a refusal');
}

async function setConfig(key: string, value: unknown) {
  await g.prisma.config.upsert({ where: { key }, create: { key, value: value as object }, update: { value: value as object } });
  g.config.invalidate();
}

/** A lesson-like reminder emitted straight through the pipeline, visible now. */
async function lessonReminder(recipientId: string, opts: { at?: Date; subject?: string; rule?: string } = {}) {
  const subject = opts.subject ?? randomUUID();
  const rule = opts.rule ?? 'lesson_parent_t30m';
  return pipeline.emit({
    dedupeKey: ReminderService.dedupeKey(rule, subject, recipientId),
    ruleKey: rule,
    templateKey: 'lesson_reminder_soon',
    eventType: 'lesson_scheduled',
    recipientId,
    priority: 'critical',
    respectQuietHours: false,
    subject: { type: 'lesson', id: subject },
    refs: { lessonId: subject, learnerId: s.learnerId },
    variables: { startsAt: new Date(Date.now() + 30 * MIN).toISOString(), child: 'learner_m' },
    scheduledAt: opts.at ?? new Date(Date.now() - 1000),
  });
}

async function directWithParent(): Promise<string> {
  return (await g.conversations.getOrCreateDirect(s.parentId, s.ownerId)).id;
}

const messageAt = (conversationId: string, seq: number, now: Date, recipientId = s.parentId, muted = false) =>
  pipeline.messagePublished({ conversationId, messageId: randomUUID(), seq: BigInt(seq), recipientId, locale: 'en', muted, now });

const deliveriesTo = (recipientId: string, conversationId: string) =>
  g.prisma.notification.findMany({ where: { recipientId, conversationId, eventType: 'message_published' }, orderBy: { createdAt: 'asc' } });

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.config where key like 'notification.%'`);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.config where key like 'notification.%'`);
  // Default quiet hours are exercised in section 4 on fixed clocks; elsewhere
  // they would make a run at night defer what these cases assert is "now".
  await setConfig('notification.quiet_hours.default_enabled', false);
  told.length = 0;
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
});

// ===========================================================================
describe('1. reminders become Center entries, keyed like their deliveries', () => {
  it('the lesson sweep writes one entry per delivery, same key, with the child and the lesson to open', async () => {
    const id = (await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: new Date(Date.now() + 3 * HOUR).toISOString(), endsAt: new Date(Date.now() + 3.5 * HOUR).toISOString() })).id;
    await scheduling.scheduleDueReminders();
    const deliveries = await g.prisma.notification.findMany({ where: { dedupeKey: { contains: `:${id}:` } } });
    const items = await g.prisma.notificationItem.findMany({ where: { subjectId: id } });
    expect(deliveries.length).toBeGreaterThan(0);
    expect(items.map((i) => i.dedupeKey).sort()).toEqual(deliveries.map((d) => d.dedupeKey).sort());
    for (const d of deliveries) expect(d.itemId).toBe(items.find((i) => i.dedupeKey === d.dedupeKey)?.id);
    const parentItem = items.find((i) => i.recipientId === s.parentId)!;
    // lesson_parent_t30m is seeded at normal priority (20261018140000), exempt from quiet hours.
    expect(parentItem).toMatchObject({ category: 'lesson', severity: 'normal', subjectType: 'lesson', pushState: 'scheduled' });
    expect(parentItem.action).toEqual({ kind: 'view_lesson', lessonId: id, learnerId: s.learnerId });
    // Shown at its moment, not when it was planned.
    expect(parentItem.visibleAt.getTime()).toBeGreaterThan(Date.now());
    expect((await g.inbox.list(await actor(s.parentId), {})).entries).toEqual([]);
    // The lock screen keeps the generic template; the name is the Center's.
    const parentPush = deliveries.find((d) => d.recipientId === s.parentId)!;
    expect(parentPush.templateKey).toBe('lesson_reminder_soon');
  });

  it('a delivery the old code already scheduled converges: no second push, and it is linked to the entry', async () => {
    const subject = randomUUID();
    const key = ReminderService.dedupeKey('lesson_parent_t30m', subject, s.parentId);
    const legacy = await g.notifications.schedule({
      dedupeKey: key, ruleKey: 'lesson_parent_t30m', templateKey: 'lesson_reminder_soon', eventType: 'lesson_scheduled',
      recipientId: s.parentId, scheduledAt: new Date(Date.now() + HOUR), respectQuietHours: false,
    });
    const itemId = await lessonReminder(s.parentId, { subject, at: new Date(Date.now() + HOUR) });
    expect(await g.prisma.notification.count({ where: { dedupeKey: key } })).toBe(1);
    expect((await g.prisma.notification.findUniqueOrThrow({ where: { id: legacy! } })).itemId).toBe(itemId);
    // And emitting again is the same entry.
    expect(await lessonReminder(s.parentId, { subject, at: new Date(Date.now() + HOUR) })).toBe(itemId);
    expect(await g.prisma.notificationItem.count({ where: { dedupeKey: key } })).toBe(1);
  });

  it('the Center renders the child and the time in the READER\'s zone; the push template names nobody', async () => {
    await g.prisma.actorTimeZone.create({ data: { actorId: s.parentId, organizationId: (await actor(s.parentId)).organizationId!, timeZone: 'Asia/Dubai' } });
    await lessonReminder(s.parentId);
    const { entries } = await g.inbox.list(await actor(s.parentId), {});
    expect(entries).toHaveLength(1);
    expect(entries[0].body).toContain('learner_m');
    expect(entries[0].body).not.toMatch(/\{\w+\}/);
    expect(entries[0]).toMatchObject({ category: 'lesson', read: false, action: { kind: 'view_lesson' } });
  });
});

// ===========================================================================
describe('2. the reason gone: withdrawn; a lifecycle re-emit: revived', () => {
  it('a lesson apology cancels the delivery and the entry with it (trigger)', async () => {
    const id = (await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: new Date(Date.now() + 3 * HOUR).toISOString(), endsAt: new Date(Date.now() + 3.5 * HOUR).toISOString() })).id;
    await scheduling.scheduleDueReminders();
    await lessons.apology(s.parentId, id, { reason: 'travel' });
    const items = await g.prisma.notificationItem.findMany({ where: { subjectId: id } });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.cancelledAt !== null)).toBe(true);
  });

  it('a SQL-side cancel (as chat.transfer_learner does) withdraws the entry too', async () => {
    const subject = randomUUID();
    const itemId = await lessonReminder(s.parentId, { subject, at: new Date(Date.now() + HOUR) });
    await g.prisma.$executeRawUnsafe(
      `update chat.notification set status = 'cancelled' where status = 'scheduled' and dedupe_key like '%:' || $1 || ':%'`, subject,
    );
    expect((await g.prisma.notificationItem.findUniqueOrThrow({ where: { id: itemId! } })).cancelReason).toBe('delivery_cancelled');
  });

  it('a lesson whose reminders were cleared by the lifecycle and swept again gets them back (the transfer case)', async () => {
    const id = (await lessons.schedule(tsupId, { learnerId: s.learnerId, startsAt: new Date(Date.now() + 3 * HOUR).toISOString(), endsAt: new Date(Date.now() + 3.5 * HOUR).toISOString() })).id;
    await scheduling.scheduleDueReminders();
    await g.prisma.$transaction(async (tx) => {
      await cancelReminders(tx, id);
      await tx.lesson.update({ where: { id }, data: { remindersScheduledAt: null } });
    });
    expect(await g.prisma.notification.count({ where: { dedupeKey: { contains: `:${id}:` }, status: 'scheduled' } })).toBe(0);
    await scheduling.scheduleDueReminders();
    const live = await g.prisma.notification.findMany({ where: { dedupeKey: { contains: `:${id}:` }, status: 'scheduled' } });
    expect(live.length).toBeGreaterThan(0);
    const items = await g.prisma.notificationItem.findMany({ where: { subjectId: id } });
    expect(items.every((i) => i.cancelledAt === null)).toBe(true);
  });

  it('a recipient taken out of service is NOT revived', async () => {
    const subject = randomUUID();
    const itemId = await lessonReminder(s.parentId, { subject, at: new Date(Date.now() + HOUR) });
    await g.prisma.notification.updateMany({ where: { itemId: itemId! }, data: { status: 'cancelled', failureCode: 'RECIPIENT_INACTIVE' } });
    await lessonReminder(s.parentId, { subject, at: new Date(Date.now() + HOUR) });
    expect((await g.prisma.notificationItem.findUniqueOrThrow({ where: { id: itemId! } })).cancelledAt).not.toBeNull();
    expect(await g.prisma.notification.count({ where: { itemId: itemId!, status: 'scheduled' } })).toBe(0);
  });

  it('payment reminders are entries under payments, and paying cancels what was not yet shown', async () => {
    const instalment = randomUUID();
    await g.reminders.scheduleForEvent('payment_due', {
      subjectId: instalment,
      anchorAt: new Date(Date.now() + 10 * 86_400_000),
      recipients: [{ actorId: s.parentId, role: 'parent', locale: 'en' }],
      familyId: s.familyId,
      variables: { amount: '200.00', currency: 'AED', due_date: '2026-11-05' },
      subjectType: 'instalment',
      refs: { instalmentId: instalment, familyId: s.familyId },
      skipPast: true,
    });
    const items = await g.prisma.notificationItem.findMany({ where: { subjectId: instalment } });
    expect(items).toHaveLength(5);
    expect(items.every((i) => i.category === 'payment')).toBe(true);
    // v2: no amount on the lock screen.
    const push = await g.notifications['templates'].render('payment_reminder', 'en', { amount: '200.00', currency: 'AED', due_date: '2026-11-05' });
    expect(push!.body).not.toContain('200.00');
    await g.reminders.cancelForSubject(instalment);
    expect(await g.prisma.notificationItem.count({ where: { subjectId: instalment, cancelledAt: null } })).toBe(0);
  });
});

// ===========================================================================
describe('3. messages: one entry per chat, coalesced pushes, read withdraws', () => {
  it('the first message pushes now; the next ones join the entry and the waiting push', async () => {
    const conv = await directWithParent();
    const now = new Date();
    await messageAt(conv, 1, now);
    await messageAt(conv, 2, new Date(now.getTime() + 1000));
    await messageAt(conv, 3, new Date(now.getTime() + 2000));
    const items = await g.prisma.notificationItem.findMany({ where: { recipientId: s.parentId, groupKey: `conversation:${conv}` } });
    expect(items).toHaveLength(1);
    expect(items[0].itemCount).toBe(3);
    const pushes = await deliveriesTo(s.parentId, conv);
    expect(pushes).toHaveLength(1);
    expect(pushes[0].scheduledAt.getTime()).toBe(now.getTime());
  });

  it('a replayed message is not counted twice', async () => {
    const conv = await directWithParent();
    const now = new Date();
    const messageId = randomUUID();
    const once = () => pipeline.messagePublished({ conversationId: conv, messageId, seq: BigInt(1), recipientId: s.parentId, locale: 'en', muted: false, now });
    await once();
    await once();
    const item = await g.prisma.notificationItem.findFirstOrThrow({ where: { recipientId: s.parentId, groupKey: `conversation:${conv}` } });
    expect(item.itemCount).toBe(1);
    expect(await deliveriesTo(s.parentId, conv)).toHaveLength(1);
  });

  it('after a push went out, the next message waits for the window and goes as one trailing push', async () => {
    const conv = await directWithParent();
    const t0 = new Date();
    await messageAt(conv, 1, t0);
    await g.prisma.notification.updateMany({ where: { recipientId: s.parentId, conversationId: conv }, data: { status: 'sent', sentAt: t0 } });
    await messageAt(conv, 2, new Date(t0.getTime() + 5000));
    await messageAt(conv, 3, new Date(t0.getTime() + 6000));
    const pushes = await deliveriesTo(s.parentId, conv);
    expect(pushes).toHaveLength(2);
    expect(pushes[1].scheduledAt.getTime()).toBe(t0.getTime() + 60_000);
  });

  it('reading the chat withdraws the waiting push, reads the entry and tells the reader\'s other devices', async () => {
    const conv = await directWithParent();
    const t0 = new Date();
    await messageAt(conv, 1, t0);
    await g.prisma.notification.updateMany({ where: { recipientId: s.parentId, conversationId: conv }, data: { status: 'sent', sentAt: t0 } });
    await messageAt(conv, 2, new Date(t0.getTime() + 5000));
    await pipeline.conversationRead(conv, s.parentId, BigInt(2));
    const pushes = await deliveriesTo(s.parentId, conv);
    expect(pushes[1]).toMatchObject({ status: 'cancelled', failureCode: 'READ' });
    const item = await g.prisma.notificationItem.findFirstOrThrow({ where: { recipientId: s.parentId, groupKey: `conversation:${conv}` } });
    expect(item.readAt).not.toBeNull();
    // READ withdraws the push, not the entry.
    expect(item.cancelledAt).toBeNull();
    expect(told.some((t) => t.event === CommEvent.CONVERSATION_READ && t.users.join() === s.parentId)).toBe(true);
    expect(told.some((t) => t.event === CommEvent.INBOX_CHANGED && t.users.join() === s.parentId)).toBe(true);
  });

  it('MessageService.markReadUpTo (the read endpoint) does the same', async () => {
    const conv = await directWithParent();
    const sent = await g.messages.send({ conversationId: conv, senderId: s.ownerId, body: 'hello', clientMessageId: randomUUID() });
    await g.outboxWorker.drain();
    expect(await g.prisma.notificationItem.count({ where: { recipientId: s.parentId, readAt: null } })).toBe(1);
    await g.messages.markReadUpTo(conv, s.parentId, String(sent.seq));
    expect(await g.prisma.notificationItem.count({ where: { recipientId: s.parentId, readAt: null } })).toBe(0);
  });

  it('someone reading the chat right now is pushed late, so reading it cancels the push', async () => {
    const conv = await directWithParent();
    const now = new Date();
    await g.prisma.conversationParticipantState.upsert({
      where: { conversationId_actorId: { conversationId: conv, actorId: s.parentId } },
      create: { conversationId: conv, actorId: s.parentId, lastReadSeq: BigInt(4) },
      update: { lastReadSeq: BigInt(4) },
    });
    await messageAt(conv, 5, now);
    const [push] = await deliveriesTo(s.parentId, conv);
    expect(push.scheduledAt.getTime()).toBe(now.getTime() + 20_000);
  });

  it('a muted chat still counts in the Center but is not pushed', async () => {
    const conv = await directWithParent();
    await messageAt(conv, 1, new Date(), s.parentId, true);
    const item = await g.prisma.notificationItem.findFirstOrThrow({ where: { recipientId: s.parentId, groupKey: `conversation:${conv}` } });
    expect(item.pushState).toBe('muted');
    expect(await deliveriesTo(s.parentId, conv)).toHaveLength(0);
  });

  it('muting the chat withdraws a push already waiting for it; the entry stays (PD-37)', async () => {
    const conv = await directWithParent();
    const t0 = new Date();
    await messageAt(conv, 1, t0);
    await g.prisma.notification.updateMany({ where: { recipientId: s.parentId, conversationId: conv }, data: { status: 'sent', sentAt: t0 } });
    await messageAt(conv, 2, new Date(t0.getTime() + 5000));
    await g.conversations.setPreferences(conv, s.parentId, { mutedUntil: new Date(Date.now() + HOUR) });
    const pushes = await deliveriesTo(s.parentId, conv);
    expect(pushes[1]).toMatchObject({ status: 'cancelled', failureCode: 'MUTED' });
    const item = await g.prisma.notificationItem.findFirstOrThrow({ where: { recipientId: s.parentId, groupKey: `conversation:${conv}` } });
    expect(item.cancelledAt).toBeNull();
  });

  it('the outbox worker drives it end to end for a real message', async () => {
    const conv = await directWithParent();
    await g.messages.send({ conversationId: conv, senderId: s.ownerId, body: 'hello', clientMessageId: randomUUID() });
    await g.outboxWorker.drain();
    expect(await g.prisma.notificationItem.count({ where: { recipientId: s.parentId, groupKey: `conversation:${conv}` } })).toBe(1);
    const pushes = await deliveriesTo(s.parentId, conv);
    expect(pushes).toHaveLength(1);
    expect(pushes[0].dedupeKey).toMatch(/^new_message:[0-9a-f-]{36}:/);
  });
});

// ===========================================================================
describe('4. preferences, locked categories, rate limit, quiet hours, names', () => {
  it('a person who switched chats off gets the entry and no push; lessons cannot be switched off', async () => {
    const parent = await actor(s.parentId);
    await g.inbox.setSettings(parent, { categories: [{ category: 'conversation', push: false }] });
    const conv = await directWithParent();
    await messageAt(conv, 1, new Date());
    const item = await g.prisma.notificationItem.findFirstOrThrow({ where: { recipientId: s.parentId } });
    expect(item.pushState).toBe('opted_out');
    expect(await deliveriesTo(s.parentId, conv)).toHaveLength(0);
    expect(await refusal(g.inbox.setSettings(parent, { categories: [{ category: 'lesson', push: false }] }))).toBe(400);
    // A teacher has no payments to tune.
    expect(await refusal(g.inbox.setSettings(await actor(s.teacherId), { categories: [{ category: 'payment', push: false }] }))).toBe(400);
  });

  it('past the hourly cap a chat goes to the Center only; a critical reminder still pushes', async () => {
    await setConfig('notification.push_per_hour', 2);
    const now = new Date();
    for (const learner of [s.learnerId, s.secondLearnerId]) {
      await messageAt((await g.conversations.ensureStudentGroup(learner, s.ownerId)).id, 1, now);
    }
    const conv = await directWithParent();
    await messageAt(conv, 1, now);
    const item = await g.prisma.notificationItem.findFirstOrThrow({ where: { recipientId: s.parentId, groupKey: `conversation:${conv}` } });
    expect(item.pushState).toBe('rate_limited');
    const itemId = await lessonReminder(s.parentId);
    expect((await g.prisma.notificationItem.findUniqueOrThrow({ where: { id: itemId! } })).pushState).toBe('scheduled');
  });

  it('default quiet hours (22:00-08:00 local) defer a chat push at night; the person\'s own setting wins', async () => {
    await setConfig('notification.quiet_hours.default_enabled', true);
    await g.prisma.actorTimeZone.create({ data: { actorId: s.parentId, organizationId: (await actor(s.parentId)).organizationId!, timeZone: 'UTC' } });
    const conv = await directWithParent();
    const night = new Date('2030-01-10T23:00:00Z');
    await messageAt(conv, 1, night);
    const [push] = await deliveriesTo(s.parentId, conv);
    expect(push.scheduledAt.toISOString()).toBe('2030-01-11T08:00:00.000Z');

    await g.inbox.setSettings(await actor(s.parentId), { quietHours: { enabled: false, startMinute: 1320, endMinute: 480 } });
    const conv2 = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;
    await messageAt(conv2, 1, night);
    const [push2] = await deliveriesTo(s.parentId, conv2);
    expect(push2.scheduledAt.toISOString()).toBe(night.toISOString());
  });

  it('names on the lock screen only for someone who turned them on', async () => {
    await g.inbox.setSettings(await actor(s.parentId), { showPreviews: true });
    const itemId = await lessonReminder(s.parentId);
    const [push] = await g.prisma.notification.findMany({ where: { itemId: itemId! } });
    expect(push.templateKey).toBe('lesson_reminder_soon_named');
    const plain = await lessonReminder(s.otherParentId);
    const [push2] = await g.prisma.notification.findMany({ where: { itemId: plain! } });
    expect(push2.templateKey).toBe('lesson_reminder_soon');
  });

  it('settings read back, and null resets to the academy default', async () => {
    const parent = await actor(s.parentId);
    const set = await g.inbox.setSettings(parent, { quietHours: { enabled: true, startMinute: 1380, endMinute: 420 } });
    expect(set.quietHours).toEqual({ enabled: true, startMinute: 1380, endMinute: 420, isDefault: false });
    const reset = await g.inbox.setSettings(parent, { quietHours: null });
    expect(reset.quietHours.isDefault).toBe(true);
    expect(reset.categories.find((c) => c.category === 'lesson')).toEqual({ category: 'lesson', push: true, locked: true });
    expect(await refusal(g.inbox.setSettings(parent, { quietHours: { enabled: true, startMinute: 2000, endMinute: 1 } }))).toBe(400);
  });
});

// ===========================================================================
describe('5. scope', () => {
  it('a person lists, counts, reads and acts on their own entries only', async () => {
    const mine = await lessonReminder(s.parentId);
    await lessonReminder(s.otherParentId);
    const parent = await actor(s.parentId);
    const other = await actor(s.otherParentId);
    const list = await g.inbox.list(parent, {});
    expect(list.entries.map((e) => e.id)).toEqual([mine]);
    expect(await refusal(g.inbox.acted(other, mine!))).toBe(404);
    expect(await refusal(g.inbox.acted(other, 'not-a-uuid'))).toBe(404);
    const read = await g.inbox.markRead(other, { ids: [mine] });
    expect(read.read).toBe(0);
    expect((await g.prisma.notificationItem.findUniqueOrThrow({ where: { id: mine! } })).readAt).toBeNull();
    const counts = await g.inbox.counts(parent);
    expect(counts).toMatchObject({ unread: 1, perTab: { lessons: 1, unread: 1 } });
    expect(counts.tabs).toContain('payments');
    expect((await g.inbox.counts(await actor(s.teacherId))).tabs).not.toContain('payments');
    await g.inbox.acted(parent, mine!);
    expect((await g.inbox.counts(parent)).unread).toBe(0);
  });

  it('tabs filter, and paging walks the list without repeats', async () => {
    for (let i = 0; i < 5; i += 1) await lessonReminder(s.parentId, { at: new Date(Date.now() - (i + 1) * 1000) });
    const parent = await actor(s.parentId);
    const first = await g.inbox.list(parent, { tab: 'lessons', limit: '2' });
    const second = await g.inbox.list(parent, { tab: 'lessons', limit: '2', before: first.next });
    expect(first.entries).toHaveLength(2);
    expect(second.entries).toHaveLength(2);
    expect(new Set([...first.entries, ...second.entries].map((e) => e.id)).size).toBe(4);
    expect((await g.inbox.list(parent, { tab: 'payments' })).entries).toEqual([]);
    expect(await refusal(g.inbox.list(parent, { tab: 'everything' }))).toBe(400);
  });

  it('an entry never crosses a tenant: a conversation of another organization writes nothing', async () => {
    const [{ id: org }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `insert into chat.organization (slug, display_name) values ('pd34-other', 'Other') returning id::text as id`,
    );
    const conv = await directWithParent();
    await g.prisma.$executeRawUnsafe(`alter table chat.conversation disable trigger user`);
    try {
      await g.prisma.$executeRawUnsafe(`update chat.conversation set organization_id = $1::uuid where id = $2::uuid`, org, conv);
    } finally {
      await g.prisma.$executeRawUnsafe(`alter table chat.conversation enable trigger user`);
    }
    await messageAt(conv, 1, new Date());
    expect(await g.prisma.notificationItem.count({ where: { recipientId: s.parentId } })).toBe(0);
  });
});

// ===========================================================================
describe('6. legacy adoption and announcement', () => {
  it('a sent legacy row (missed call, story) becomes an entry once; a ringing call and a waiting row do not', async () => {
    const mk = (eventType: string, ruleKey: string | null, status: string, offset = -1000) => g.prisma.notification.create({
      data: {
        dedupeKey: `${ruleKey ?? eventType}:${randomUUID()}:${s.parentId}`, ruleKey, templateKey: ruleKey ?? eventType, eventType,
        recipientId: s.parentId, locale: 'en', status, scheduledAt: new Date(Date.now() + offset), sentAt: status === 'sent' ? new Date() : null,
      },
    });
    const missed = await mk('call_missed', 'missed_call', 'sent');
    const story = await mk('story_published', 'story_published', 'sent');
    await mk('call_started', 'incoming_call', 'sent');
    await mk('story_published', 'story_published', 'scheduled', HOUR);
    expect(await pipeline.adoptLegacy()).toBe(2);
    expect(await pipeline.adoptLegacy()).toBe(0);
    const items = await g.prisma.notificationItem.findMany({ where: { recipientId: s.parentId }, orderBy: { category: 'asc' } });
    expect(items.map((i) => i.category).sort()).toEqual(['announcement', 'call']);
    expect((await g.prisma.notification.findUniqueOrThrow({ where: { id: missed.id } })).itemId).not.toBeNull();
    expect((await g.prisma.notification.findUniqueOrThrow({ where: { id: story.id } })).itemId).not.toBeNull();
    const { entries } = await g.inbox.list(await actor(s.parentId), { tab: 'conversations' });
    expect(entries.map((e) => e.title)).toEqual(['Missed call']);
  });

  it('an entry that became visible is announced once, to its own person, with the unread count', async () => {
    await lessonReminder(s.parentId);
    await lessonReminder(s.otherParentId, { at: new Date(Date.now() + HOUR) });
    expect(await pipeline.announceDue()).toBe(1);
    expect(await pipeline.announceDue()).toBe(0);
    const inbox = told.filter((t) => t.event === CommEvent.INBOX_CHANGED);
    expect(inbox).toEqual([{ users: [s.parentId], event: CommEvent.INBOX_CHANGED, payload: { recipientId: s.parentId, unread: 1 } }]);
  });

  it('retention purges old sent deliveries and old entries, never a waiting delivery', async () => {
    const oldItem = await lessonReminder(s.parentId);
    await g.prisma.notificationItem.update({ where: { id: oldItem! }, data: { createdAt: new Date(Date.now() - 400 * 86_400_000) } });
    await g.prisma.notification.updateMany({ where: { itemId: oldItem! }, data: { status: 'sent', createdAt: new Date(Date.now() - 100 * 86_400_000) } });
    const waiting = await lessonReminder(s.parentId, { at: new Date(Date.now() + HOUR) });
    await g.prisma.notification.updateMany({ where: { itemId: waiting! }, data: { createdAt: new Date(Date.now() - 100 * 86_400_000) } });
    const purged = await pipeline.purge();
    expect(purged).toEqual({ deliveries: 1, items: 1 });
    expect(await g.prisma.notification.count({ where: { itemId: waiting! } })).toBe(1);
  });
});
