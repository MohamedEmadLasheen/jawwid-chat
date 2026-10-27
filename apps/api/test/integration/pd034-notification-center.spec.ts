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
  await truncateCenter();
  await g.prisma.$executeRawUnsafe(`delete from chat.config where key like 'notification.%'`);
  await g.prisma.$disconnect();
});
// PD-34's own tables: cleared here, not by the shared truncate() every suite runs.
const truncateCenter = () =>
  g.prisma.$executeRawUnsafe(
    `truncate chat.notification_item, chat.notification_preference, chat.notification_settings, chat.quiet_hours cascade`,
  );

beforeEach(async () => {
  await truncate(g.prisma);
  await truncateCenter();
  await g.prisma.$executeRawUnsafe(`delete from chat.config where key like 'notification.%'`);
  // Default quiet hours and the chat cap are exercised in sections 4 and 4b on
  // fixed clocks; elsewhere they would make a run at night (or a busy case)
  // defer what these cases assert is "now".
  await setConfig('notification.quiet_hours.default_enabled', false);
  await setConfig('notification.chat.quiet_hours.default_enabled', false);
  await setConfig('notification.chat.pushes_per_hour', 0);
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

  it('MessageService.markReadUpTo (the read endpoint) does the same, through the outbox', async () => {
    const conv = await directWithParent();
    const sent = await g.messages.send({ conversationId: conv, senderId: s.ownerId, body: 'hello', clientMessageId: randomUUID() });
    await g.outboxWorker.drain();
    expect(await g.prisma.notificationItem.count({ where: { recipientId: s.parentId, readAt: null } })).toBe(1);
    await g.messages.markReadUpTo(conv, s.parentId, String(sent.seq));
    // The read is an outbox event (conversation.read); the worker applies it.
    expect(await g.prisma.outboxEvent.count({ where: { type: 'conversation.read' } })).toBe(1);
    await g.outboxWorker.drain();
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
describe('3b. review of #133: deferred pushes, reads, races, cost', () => {
  it('P1: removing a member withdraws the chat push still waiting for them (trigger)', async () => {
    const group = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;
    const t0 = new Date();
    await messageAt(group, 1, t0);
    await g.prisma.notification.updateMany({ where: { recipientId: s.parentId, conversationId: group }, data: { status: 'sent', sentAt: t0 } });
    await messageAt(group, 2, new Date(t0.getTime() + 5000));
    expect((await deliveriesTo(s.parentId, group))[1]!.status).toBe('scheduled');
    await g.conversations.setMembership(group, s.ownerId, { actorId: s.parentId, actorKind: 'contact', memberRole: 'parent' }, 'remove', 'pd034');
    expect((await deliveriesTo(s.parentId, group))[1]).toMatchObject({ status: 'cancelled', failureCode: 'AUDIENCE' });
  });

  it('P1: just before sending, a chat push for someone outside the audience is dropped; a member\'s stays', async () => {
    const conv = await directWithParent();
    const due = new Date(Date.now() - 1000);
    const mk = (recipientId: string) => g.prisma.notification.create({
      data: {
        dedupeKey: `new_message:${randomUUID()}:${recipientId}`, ruleKey: 'new_message', templateKey: 'new_message',
        eventType: 'message_published', recipientId, conversationId: conv, scheduledAt: due,
      },
    });
    const outsider = await mk(s.otherParentId);
    const member = await mk(s.parentId);
    expect(await pipeline.guardDueMessages()).toBe(1);
    expect(await g.prisma.notification.findUniqueOrThrow({ where: { id: outsider.id } })).toMatchObject({ status: 'cancelled', failureCode: 'AUDIENCE' });
    expect((await g.prisma.notification.findUniqueOrThrow({ where: { id: member.id } })).status).toBe('scheduled');
  });

  it('P2-1: a read of N leaves what stands for N+1; a read of N+1 takes it', async () => {
    const conv = await directWithParent();
    const t0 = new Date();
    await messageAt(conv, 1, t0);
    await g.prisma.notification.updateMany({ where: { recipientId: s.parentId, conversationId: conv }, data: { status: 'sent', sentAt: t0 } });
    await messageAt(conv, 2, new Date(t0.getTime() + 5000));
    const item = () => g.prisma.notificationItem.findFirstOrThrow({ where: { recipientId: s.parentId, groupKey: `conversation:${conv}` } });
    await pipeline.conversationRead(conv, s.parentId, BigInt(1));
    expect((await deliveriesTo(s.parentId, conv))[1]!.status).toBe('scheduled');
    expect((await item()).readAt).toBeNull();
    await pipeline.conversationRead(conv, s.parentId, BigInt(2));
    expect((await deliveriesTo(s.parentId, conv))[1]).toMatchObject({ status: 'cancelled', failureCode: 'READ' });
    expect((await item()).readAt).not.toBeNull();
  });

  it('P2-2: five messages fanned out at once converge on one entry (count 5) and one push', async () => {
    const conv = await directWithParent();
    const now = new Date();
    await Promise.all([1, 2, 3, 4, 5].map((n) => messageAt(conv, n, now)));
    const items = await g.prisma.notificationItem.findMany({ where: { recipientId: s.parentId, groupKey: `conversation:${conv}` } });
    expect(items).toHaveLength(1);
    expect(items[0]!.itemCount).toBe(5);
    expect(await deliveriesTo(s.parentId, conv)).toHaveLength(1);
  });

  it('P2-3: a fan-out resolves its whole audience in one batch, not one lookup per member', async () => {
    let single = 0;
    let batches = 0;
    const counting = new Proxy(g.identity, {
      get(target, prop, receiver) {
        if (prop === 'resolveActor') return (...a: unknown[]) => { single += 1; return (target.resolveActor as (...x: unknown[]) => unknown)(...a); };
        if (prop === 'resolveActors') return (...a: unknown[]) => { batches += 1; return (target.resolveActors as (...x: unknown[]) => unknown)(...a); };
        return Reflect.get(target, prop, receiver);
      },
    });
    const counted = new NotificationPipeline(g.prisma, g.notifications, g.quietHours, g.config, counting, recording as never);
    const group = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;
    await counted.messagePublishedMany({
      conversationId: group, messageId: randomUUID(), seq: BigInt(1), now: new Date(),
      recipients: [s.parentId, s.otherParentId, s.teacherId].map((actorId) => ({ actorId, muted: false })),
    });
    expect(single).toBe(0);
    expect(batches).toBe(1);
    expect(await g.prisma.notificationItem.count({ where: { groupKey: `conversation:${group}` } })).toBeGreaterThanOrEqual(2);
  });

  it('DECIDED (owner 2026-10-27): with no settings at all, chat pushes take quiet hours and the cap of 6', async () => {
    await g.prisma.$executeRawUnsafe(`delete from chat.config where key like 'notification.%'`);
    g.config.invalidate();
    expect(await g.config.get('notification.chat.quiet_hours.default_enabled')).toBe(true);
    expect(await g.config.get('notification.chat.pushes_per_hour')).toBe(6);
    // ...and the generic default that lessons and payments read stays off.
    expect(await g.config.get('notification.quiet_hours.default_enabled')).toBe(false);
    await g.prisma.actorTimeZone.create({ data: { actorId: s.parentId, organizationId: (await actor(s.parentId)).organizationId!, timeZone: 'UTC' } });
    const night = new Date('2030-01-10T23:00:00Z');
    const conv = await directWithParent();
    await messageAt(conv, 1, night);
    expect((await deliveriesTo(s.parentId, conv))[0]!.scheduledAt.toISOString()).toBe('2030-01-11T08:00:00.000Z');
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

  it('past the chat cap nothing is dropped: the excess is held into a summary; a reminder is untouched', async () => {
    await setConfig('notification.chat.pushes_per_hour', 2);
    const now = new Date();
    for (const learner of [s.learnerId, s.secondLearnerId]) {
      await messageAt((await g.conversations.ensureStudentGroup(learner, s.ownerId)).id, 1, now);
    }
    const conv = await directWithParent();
    await messageAt(conv, 1, now);
    const item = await g.prisma.notificationItem.findFirstOrThrow({ where: { recipientId: s.parentId, groupKey: `conversation:${conv}` } });
    expect(item.pushState).toBe('scheduled');
    const [held] = await deliveriesTo(s.parentId, conv);
    expect(held!.variables).toMatchObject({ held: true, capSummary: true });
    expect(held!.scheduledAt.getTime()).toBeGreaterThan(now.getTime());
    const itemId = await lessonReminder(s.parentId);
    expect((await g.prisma.notificationItem.findUniqueOrThrow({ where: { id: itemId! } })).pushState).toBe('scheduled');
  });

  it('default quiet hours (22:00-08:00 local) defer a chat push at night; the person\'s own setting wins', async () => {
    await setConfig('notification.chat.quiet_hours.default_enabled', true);
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
describe('4b. the chat push policy (owner, 2026-10-27): quiet hours ON, 6 an hour, the rest held into one summary', () => {
  const T = new Date('2030-01-10T12:00:00Z'); // midday UTC: outside quiet hours
  const min = (m: number) => new Date(T.getTime() + m * 60_000);
  let chats: string[];

  /** A chat push already sent to the parent `minutesAgo` before T. */
  const sentPush = (conversationId: string, minutesAgo: number, extra: Record<string, unknown> = {}) =>
    g.prisma.notification.create({
      data: {
        dedupeKey: `new_message:${randomUUID()}:${s.parentId}`, ruleKey: 'new_message', templateKey: 'new_message',
        eventType: 'message_published', recipientId: s.parentId, conversationId, status: 'sent',
        scheduledAt: min(-minutesAgo), sentAt: min(-minutesAgo), variables: { lastSeq: '1', ...extra },
      },
    });
  const chatPushes = () => g.prisma.notification.findMany({
    where: { recipientId: s.parentId, eventType: 'message_published', status: 'scheduled' }, orderBy: { createdAt: 'asc' },
  });

  beforeEach(async () => {
    await setConfig('notification.chat.quiet_hours.default_enabled', true);
    await setConfig('notification.chat.pushes_per_hour', 6);
    await g.prisma.actorTimeZone.create({ data: { actorId: s.parentId, organizationId: (await actor(s.parentId)).organizationId!, timeZone: 'UTC' } });
    chats = [
      await directWithParent(),
      (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id,
      (await g.conversations.ensureStudentGroup(s.secondLearnerId, s.ownerId)).id,
    ];
  });

  it('the 6th push in the hour goes; the 7th is held until the oldest ages out; the 8th and 9th join it', async () => {
    for (const [i, ago] of [50, 40, 30, 20, 10].entries()) await sentPush(chats[i % 3]!, ago);
    await messageAt(chats[0]!, 2, T); // the 6th
    expect((await chatPushes()).map((p) => p.scheduledAt.toISOString())).toEqual([T.toISOString()]);
    await messageAt(chats[1]!, 2, min(1)); // the 7th
    await messageAt(chats[2]!, 2, min(2));
    await messageAt(chats[1]!, 3, min(3));
    const pending = await chatPushes();
    expect(pending).toHaveLength(2);
    const held = pending[1]!;
    // The oldest counted push (50 min before T) leaves the hour at T+10.
    expect(held.scheduledAt.toISOString()).toBe(min(10).toISOString());
    expect(held.variables).toMatchObject({ held: true, capSummary: true, count: 3 });
    expect(held.templateKey).toBe('new_messages_summary');
    // Every message is still in the Center.
    for (const c of chats) expect(await g.prisma.notificationItem.count({ where: { recipientId: s.parentId, groupKey: `conversation:${c}` } })).toBe(1);
  });

  it('a summary the cap produced does not count toward the cap (no endless chain of summaries)', async () => {
    // Four counted pushes in the hour, and a summary the cap sent 5 minutes ago.
    for (const ago of [40, 30, 20, 10]) await sentPush(chats[0]!, ago);
    await sentPush(chats[1]!, 5, { held: true, capSummary: true, chats: {}, count: 4 });
    // With a cap of 5, counting the summary would make this the 6th and hold it.
    await setConfig('notification.chat.pushes_per_hour', 5);
    await messageAt(chats[2]!, 2, T);
    const [p] = await chatPushes();
    expect(p!.scheduledAt.toISOString()).toBe(T.toISOString());
    expect(p!.variables).not.toHaveProperty('held');
  });

  it('quiet start and end: 21:59 goes, 22:00 and 07:59 wait for 08:00, 08:00 goes', async () => {
    const at = (iso: string, chat: string, seq: number) => messageAt(chat, seq, new Date(iso));
    await at('2030-01-10T21:59:00Z', chats[0]!, 1);
    expect((await chatPushes())[0]!.scheduledAt.toISOString()).toBe('2030-01-10T21:59:00.000Z');
    await g.prisma.notification.updateMany({ where: { recipientId: s.parentId }, data: { status: 'sent', sentAt: new Date('2030-01-10T21:59:00Z') } });
    await at('2030-01-10T22:00:00Z', chats[1]!, 1);
    await at('2030-01-11T07:59:00Z', chats[2]!, 1);
    const [held] = await chatPushes();
    expect(held!.scheduledAt.toISOString()).toBe('2030-01-11T08:00:00.000Z');
    expect(held!.variables).toMatchObject({ held: true, count: 2 });
    await g.prisma.notification.updateMany({ where: { recipientId: s.parentId }, data: { status: 'sent', sentAt: new Date('2030-01-11T08:00:00Z') } });
    await at('2030-01-11T09:00:00Z', chats[0]!, 2);
    expect((await chatPushes())[0]!.scheduledAt.toISOString()).toBe('2030-01-11T09:00:00.000Z');
  });

  it('overnight messages in two chats are ONE push at 08:00, not a burst', async () => {
    await messageAt(chats[0]!, 1, new Date('2030-01-10T23:00:00Z'));
    await messageAt(chats[1]!, 1, new Date('2030-01-10T23:30:00Z'));
    await messageAt(chats[0]!, 2, new Date('2030-01-11T01:00:00Z'));
    const pending = await chatPushes();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.scheduledAt.toISOString()).toBe('2030-01-11T08:00:00.000Z');
    expect(pending[0]!.variables).toMatchObject({ held: true, count: 3 });
    expect(pending[0]!.templateKey).toBe('new_messages_summary');
  });

  it('a DST night (Cairo, 29 Oct 2026) still waits until 08:00 local', async () => {
    await g.prisma.actorTimeZone.update({ where: { actorId: s.parentId }, data: { timeZone: 'Africa/Cairo' } });
    await messageAt(chats[0]!, 1, new Date('2026-10-29T20:30:00Z')); // 23:30 Cairo, UTC+3
    expect((await chatPushes())[0]!.scheduledAt.toISOString()).toBe('2026-10-30T06:00:00.000Z'); // 08:00, UTC+2
  });

  it('a zone with no row is the academy\'s', async () => {
    await g.prisma.actorTimeZone.delete({ where: { actorId: s.parentId } });
    await messageAt(chats[0]!, 1, new Date('2030-01-10T21:00:00Z')); // 23:00 Cairo (UTC+2 in January)
    expect((await chatPushes())[0]!.scheduledAt.toISOString()).toBe('2030-01-11T06:00:00.000Z');
  });

  it('a person who turned quiet hours OFF is pushed at night', async () => {
    await g.inbox.setSettings(await actor(s.parentId), { quietHours: { enabled: false, startMinute: 1320, endMinute: 480 } });
    await messageAt(chats[0]!, 1, new Date('2030-01-10T23:00:00Z'));
    expect((await chatPushes())[0]!.scheduledAt.toISOString()).toBe('2030-01-10T23:00:00.000Z');
  });

  it('a read before the summary takes out what it covers; reading everything withdraws it', async () => {
    await messageAt(chats[0]!, 1, new Date('2030-01-10T23:00:00Z'));
    await messageAt(chats[1]!, 4, new Date('2030-01-10T23:10:00Z'));
    await pipeline.conversationRead(chats[1]!, s.parentId, BigInt(3)); // before message 4: covers nothing held
    expect((await chatPushes())[0]!.variables).toMatchObject({ count: 2 });
    await pipeline.conversationRead(chats[0]!, s.parentId, BigInt(1));
    const [left] = await chatPushes();
    expect(left!.variables).toMatchObject({ count: 1 });
    expect(left!.templateKey).toBe('new_message');
    await pipeline.conversationRead(chats[1]!, s.parentId, BigInt(4));
    expect(await chatPushes()).toHaveLength(0);
    expect(await g.prisma.notification.count({ where: { recipientId: s.parentId, failureCode: 'READ' } })).toBe(1);
  });

  it('two workers at the cap edge: one push goes, ONE summary holds the rest', async () => {
    for (const [i, ago] of [50, 40, 30, 20, 10].entries()) await sentPush(chats[i % 3]!, ago);
    // Three chats at once: whichever is decided first is the 6th and goes; the
    // other two, decided after it under the per-person lock, share ONE summary.
    await Promise.all([messageAt(chats[0]!, 2, T), messageAt(chats[1]!, 2, T), messageAt(chats[2]!, 2, T)]);
    const pending = await chatPushes();
    expect(pending).toHaveLength(2);
    const held = pending.filter((p) => (p.variables as Record<string, unknown>).held === true);
    expect(held).toHaveLength(1);
    expect(held[0]!.variables).toMatchObject({ count: 2, capSummary: true });
  });

  it('a held push stands for several chats: leaving one keeps the others; the send-time check trims it', async () => {
    await messageAt(chats[1]!, 1, new Date('2030-01-10T23:00:00Z'));
    await messageAt(chats[0]!, 1, new Date('2030-01-10T23:05:00Z'));
    await g.conversations.setMembership(chats[1]!, s.ownerId, { actorId: s.parentId, actorKind: 'contact', memberRole: 'parent' }, 'remove', 'pd034');
    expect(await chatPushes()).toHaveLength(1);
    await pipeline.guardDueMessages(new Date('2030-01-11T08:00:00Z'));
    const [trimmed] = await chatPushes();
    expect(trimmed!.variables).toMatchObject({ count: 1 });
    expect(Object.keys((trimmed!.variables as { chats: object }).chats)).toEqual([chats[0]]);
  });

  it('a mention is never capped or summarised, but takes quiet hours; a person who turned them off is pushed', async () => {
    for (const ago of [50, 40, 30, 20, 10, 5]) await sentPush(chats[0]!, ago);
    const mention = (at: Date) => pipeline.mentionPublished({ ruleKey: 'mention', recipientId: s.parentId, dedupeKey: `mention:${randomUUID()}:${s.parentId}`, conversationId: chats[1]!, now: at });
    const day = await g.prisma.notification.findUniqueOrThrow({ where: { id: (await mention(T))! } });
    expect(day.scheduledAt.toISOString()).toBe(T.toISOString());
    const night = await g.prisma.notification.findUniqueOrThrow({ where: { id: (await mention(new Date('2030-01-10T23:00:00Z')))! } });
    expect(night.scheduledAt.toISOString()).toBe('2030-01-11T08:00:00.000Z');
    await g.inbox.setSettings(await actor(s.parentId), { quietHours: { enabled: false, startMinute: 1320, endMinute: 480 } });
    const off = await g.prisma.notification.findUniqueOrThrow({ where: { id: (await mention(new Date('2030-01-11T23:00:00Z')))! } });
    expect(off.scheduledAt.toISOString()).toBe('2030-01-11T23:00:00.000Z');
  });

  it('out of scope, unchanged: lesson and payment reminders, a call, a story at night and past the chat cap', async () => {
    for (const ago of [50, 40, 30, 20, 10, 5]) await sentPush(chats[0]!, ago);
    const night = new Date('2030-01-10T23:00:00Z');
    // A lesson reminder that respects quiet hours: only the person's OWN window applies, never the chat default.
    const lessonItem = await pipeline.emit({
      dedupeKey: ReminderService.dedupeKey('lesson_parent_t24h', randomUUID(), s.parentId), ruleKey: 'lesson_parent_t24h',
      templateKey: 'lesson_reminder_tomorrow', eventType: 'lesson_scheduled', recipientId: s.parentId, respectQuietHours: true,
      variables: { startsAt: night.toISOString(), child: 'learner_m' }, scheduledAt: night,
    });
    const paymentItem = await pipeline.emit({
      dedupeKey: ReminderService.dedupeKey('payment_d0', randomUUID(), s.parentId), ruleKey: 'payment_d0',
      templateKey: 'payment_reminder', eventType: 'payment_due', recipientId: s.parentId, priority: 'high', respectQuietHours: true,
      variables: { amount: '1', currency: 'AED', due_date: '2030-01-11' }, scheduledAt: night,
    });
    for (const id of [lessonItem, paymentItem]) {
      const [d] = await g.prisma.notification.findMany({ where: { itemId: id! } });
      expect(d!.scheduledAt.toISOString()).toBe(night.toISOString());
    }
    // A call push (W8-W1, frozen) and a story push, through NotificationService as before.
    const call = await g.notifications.scheduleByRule('incoming_call', { recipientId: s.parentId, dedupeKey: `incoming_call:${randomUUID()}:${s.parentId}`, conversationId: chats[0], now: night });
    const story = await g.notifications.schedule({ dedupeKey: `story_published:${randomUUID()}:${s.parentId}`, ruleKey: 'story_published', templateKey: 'story_published', eventType: 'story_published', recipientId: s.parentId, scheduledAt: night });
    for (const id of [call, story]) {
      expect((await g.prisma.notification.findUniqueOrThrow({ where: { id: id! } })).scheduledAt.toISOString()).toBe(night.toISOString());
    }
    // None of them was folded into a held chat summary.
    expect(await g.prisma.notification.count({ where: { recipientId: s.parentId, status: 'scheduled', variables: { path: ['held'], equals: true } } })).toBe(0);
  });

  it('a silent line (a PD-33 cover or PD-35 seat announcement) is seen, never pushed', async () => {
    await g.prisma.$transaction((tx) => g.outbox.enqueue(tx, 'message.created' as never, {
      conversationId: chats[0], messageId: randomUUID(), seq: '1', authorKind: 'system', visibility: 'customer', silent: true,
    } as never));
    await g.outboxWorker.drain();
    expect(await g.prisma.notification.count({ where: { recipientId: s.parentId } })).toBe(0);
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

  it('P2-5: an entry about a conversation the reader can no longer read is withdrawn on read, from the list and the counts', async () => {
    const group = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;
    const direct = await directWithParent();
    await messageAt(group, 1, new Date());
    await messageAt(direct, 1, new Date());
    // The pushes went out, so nothing is waiting for the leave trigger to withdraw.
    await g.prisma.notification.updateMany({ where: { recipientId: s.parentId }, data: { status: 'sent', sentAt: new Date() } });
    await g.conversations.setMembership(group, s.ownerId, { actorId: s.parentId, actorKind: 'contact', memberRole: 'parent' }, 'remove', 'pd034');
    const parent = await actor(s.parentId);

    const counts = await g.inbox.counts(parent);
    expect(counts.unread).toBe(1);
    const { entries } = await g.inbox.list(parent, {});
    expect(entries.map((e) => e.refs.conversationId)).toEqual([direct]);
    const gone = await g.prisma.notificationItem.findFirstOrThrow({ where: { recipientId: s.parentId, groupKey: `conversation:${group}` } });
    expect(gone).toMatchObject({ cancelReason: 'access_lost' });
    expect(gone.cancelledAt).not.toBeNull();
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
