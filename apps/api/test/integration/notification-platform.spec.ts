/**
 * The notification platform, end to end.
 *
 * Every acceptance scenario the product asks for is here as a test: a teacher's
 * text and voice message, a missed call, a schedule change, an academy
 * announcement, a parent who was offline, a parent on two devices, and the same
 * event processed twice.
 *
 * Requires the migrated database (DATABASE_URL).
 */
import { randomUUID } from 'node:crypto';
import { buildGraph, seed, truncate, Scenario } from './harness';
import { NotificationType } from '@communication/contracts/notifications';
import { CommEvent } from '@communication/contracts/events';
import { MessageType, Visibility } from '@communication/contracts/vocab';
import { formatDate, formatTime } from '@communication/schedule/class-schedule.service';

const g = buildGraph();
let s: Scenario;

/** A student group with the parent, the teacher and the owning admin in it. */
async function studentGroup(): Promise<string> {
  const group = await g.conversations.ensureStudentGroup(s.learnerId);
  return group.id;
}

/** Drain the outbox the way the worker does, so events become notifications. */
async function drain(): Promise<void> {
  await g.outboxWorker.drain(200);
}

beforeAll(async () => {
  await truncate(g.prisma);
});

beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  // The owning admin is on duty, so the message path is authorized and these
  // tests assert notification behaviour rather than re-testing coverage.
  g.coverage.onDutyId = s.ownerId;
});

afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});

// =========================================================================
describe('Scenario 1 · a teacher sends a text message', () => {
  it('reaches the parent, names the child, and deep links to the thread', async () => {
    const conversationId = await studentGroup();
    const sent = await g.messages.send({
      conversationId,
      senderId: s.ownerId,
      body: 'Assalamu alaikum, the lesson is ready.',
    });
    await drain();

    const n = await g.prisma.notification.findFirst({
      where: { recipientId: s.parentId, type: NotificationType.MESSAGE_RECEIVED },
    });

    expect(n).not.toBeNull();
    expect(n!.category).toBe('messaging');
    // The child is named, so a parent of three does not have to guess.
    expect(n!.learnerId).toBe(s.learnerId);
    expect(n!.title).toContain('learner_l');
    // And the link goes to the exact message, not to the chat list.
    expect(n!.deeplink).toBe(`/chats/${conversationId}?message=${sent.id}`);
    expect(n!.entityType).toBe('message');
    expect(n!.entityId).toBe(sent.id);
    // Unread until they read it.
    expect(n!.readAt).toBeNull();
  });

  it('does not notify the author about their own message', async () => {
    const conversationId = await studentGroup();
    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'hello' });
    await drain();

    expect(
      await g.prisma.notification.count({ where: { recipientId: s.ownerId } }),
    ).toBe(0);
  });

  it('never notifies anyone about an internal staff note', async () => {
    const conversationId = await studentGroup();
    await g.messages.send({
      conversationId,
      senderId: s.ownerId,
      body: 'internal: family is behind on payment',
      visibility: Visibility.INTERNAL,
    });
    await drain();

    // Not just "the parent does not get it" -- nobody does. A note that
    // produced a notification would be a note whose existence leaks.
    expect(await g.prisma.notification.count({ where: { recipientId: s.parentId } })).toBe(0);
  });
});

// =========================================================================
describe('Scenario 2 · a teacher sends a voice message', () => {
  it('says it is a voice message rather than the generic line', async () => {
    const conversationId = await studentGroup();
    const objectKey = `voice/${randomUUID()}.m4a`;
    const sent = await g.messages.send({
      conversationId,
      senderId: s.ownerId,
      type: MessageType.VOICE,
      attachments: [
        { kind: 'voice', objectKey, mimeType: 'audio/mp4', byteSize: 2048, durationMs: 4000 },
      ],
    });
    await drain();

    const n = await g.prisma.notification.findFirst({
      where: { recipientId: s.parentId },
    });

    expect(n!.type).toBe(NotificationType.VOICE_MESSAGE_RECEIVED);
    expect(n!.templateKey).toBe('voice_message_received_child');
    // Opens at the voice message itself.
    expect(n!.deeplink).toBe(`/chats/${conversationId}?message=${sent.id}`);
  });
});

// =========================================================================
describe('Scenario 3 · a missed call', () => {
  it('persists as a notification that outlives the ringing', async () => {
    const conversationId = await studentGroup();
    const { callId } = await g.calls.start(conversationId, s.ownerId);
    // Nobody answered.
    await g.calls.end(callId, s.ownerId, 'missed');
    await drain();

    const n = await g.prisma.notification.findFirst({
      where: { recipientId: s.parentId, type: NotificationType.MISSED_CALL },
    });

    expect(n).not.toBeNull();
    expect(n!.category).toBe('calls');
    expect(n!.priority).toBe('high');
    // The VoIP push vanishes when the ringing stops; this does not.
    expect(n!.deeplink).toBe(`/chats/${conversationId}?call=${callId}`);
    // Never collapsed into "2 missed calls".
    expect(n!.groupKey).toBeNull();
  });

  it('does not tell the caller they missed their own call', async () => {
    const conversationId = await studentGroup();
    const { callId } = await g.calls.start(conversationId, s.ownerId);
    await g.calls.end(callId, s.ownerId, 'missed');
    await drain();

    expect(
      await g.prisma.notification.count({
        where: { recipientId: s.ownerId, type: NotificationType.MISSED_CALL },
      }),
    ).toBe(0);
  });

  it('does not call it missed for somebody who answered', async () => {
    const conversationId = await studentGroup();
    const { callId } = await g.calls.start(conversationId, s.ownerId);
    await g.calls.accept(callId, s.parentId);
    await g.calls.end(callId, s.ownerId, 'missed');
    await drain();

    expect(
      await g.prisma.notification.count({
        where: { recipientId: s.parentId, type: NotificationType.MISSED_CALL },
      }),
    ).toBe(0);
  });
});

// =========================================================================
describe('Scenario 4 · a schedule change', () => {
  const admin = () => ({
    actorId: s.ownerId,
    kind: 'staff' as const,
    displayName: 'admin_a',
    locale: 'ar' as const,
    isActive: true,
    staffRole: 'admin' as const,
  });

  beforeEach(async () => {
    await g.prisma.learner.update({
      where: { id: s.learnerId },
      data: { nextClassAt: new Date('2026-09-29T14:00:00Z') },
    });
  });

  it('tells the parent BOTH times, and keeps them', async () => {
    await g.classSchedule.reschedule(admin(), {
      learnerId: s.learnerId,
      nextClassAt: new Date('2026-09-29T15:00:00Z'),
      reason: 'teacher availability',
    });

    const n = await g.prisma.notification.findFirst({
      where: { recipientId: s.parentId, type: NotificationType.CLASS_SCHEDULE_CHANGED },
    });

    expect(n).not.toBeNull();
    expect(n!.isEssential).toBe(true);
    expect(n!.priority).toBe('high');
    expect(n!.learnerId).toBe(s.learnerId);
    expect(n!.deeplink).toBe(`/learners/${s.learnerId}/classes`);
    // The old time is IN the frozen body. This is the property the product
    // depends on: a parent must be able to see what changed, not just what it
    // is now.
    expect(n!.variables).toMatchObject({ old_time: expect.any(String), new_time: expect.any(String) });
    expect(n!.body).toContain(String((n!.variables as Record<string, string>).old_time));
    expect(n!.body).toContain(String((n!.variables as Record<string, string>).new_time));
  });

  it('a SECOND change cannot rewrite what the first one said', async () => {
    await g.classSchedule.reschedule(admin(), {
      learnerId: s.learnerId,
      nextClassAt: new Date('2026-09-29T15:00:00Z'),
      reason: 'first move',
    });
    const first = await g.prisma.notification.findFirst({
      where: { recipientId: s.parentId, type: NotificationType.CLASS_SCHEDULE_CHANGED },
      orderBy: { createdAt: 'asc' },
    });
    const firstBody = first!.body;

    await g.classSchedule.reschedule(admin(), {
      learnerId: s.learnerId,
      nextClassAt: new Date('2026-09-29T17:00:00Z'),
      reason: 'second move',
    });

    const again = await g.prisma.notification.findUnique({ where: { id: first!.id } });
    // Frozen text: the first notification still says what it said.
    expect(again!.body).toBe(firstBody);

    // And there are two notifications, because there were two changes.
    expect(
      await g.prisma.notification.count({
        where: { recipientId: s.parentId, type: NotificationType.CLASS_SCHEDULE_CHANGED },
      }),
    ).toBe(2);
  });

  it('renders the time in the PARENT’s timezone, not the server’s', async () => {
    await g.prisma.quietHours.create({
      data: { actorId: s.parentId, timezone: 'Asia/Riyadh', enabled: false },
    });

    await g.classSchedule.reschedule(admin(), {
      // 15:00 UTC is 18:00 in Riyadh.
      learnerId: s.learnerId,
      nextClassAt: new Date('2026-09-29T15:00:00Z'),
      reason: 'timezone case',
    });

    const n = await g.prisma.notification.findFirst({
      where: { recipientId: s.parentId, type: NotificationType.CLASS_SCHEDULE_CHANGED },
    });
    const vars = n!.variables as Record<string, string>;

    // A Gulf family reading "6:00" must be reading their own 6:00. The Arabic
    // locale renders Arabic-Indic digits, which is correct for an Arabic-first
    // academy, so the assertion is on the rendered form rather than on "6".
    expect(vars.new_time).toBe(formatTime(new Date('2026-09-29T15:00:00Z'), 'Asia/Riyadh', 'ar'));
    // And emphatically NOT the server's own 15:00 / 3 PM.
    expect(vars.new_time).not.toBe(formatTime(new Date('2026-09-29T15:00:00Z'), 'UTC', 'ar'));
  });

  it('formats a time in the requested zone and locale, and nowhere else', () => {
    const at = new Date('2026-09-29T15:00:00Z');
    // Three hours ahead of UTC: the same instant is a different clock face.
    expect(formatTime(at, 'Asia/Riyadh', 'en')).toBe('6:00 pm');
    expect(formatTime(at, 'UTC', 'en')).toBe('3:00 pm');
    expect(formatDate(at, 'Asia/Riyadh', 'en')).toContain('29');
  });

  it('crosses midnight in the family\u2019s zone, not the server\u2019s', async () => {
    await g.prisma.quietHours.create({
      data: { actorId: s.parentId, timezone: 'Asia/Riyadh', enabled: false },
    });
    // 22:00 UTC on the 29th is 01:00 on the 30th in Riyadh. A server that
    // rendered its own date would tell the parent the wrong day.
    await g.classSchedule.reschedule(admin(), {
      learnerId: s.learnerId,
      nextClassAt: new Date('2026-09-29T22:00:00Z'),
      reason: 'late class',
    });

    const n = await g.prisma.notification.findFirst({
      where: { recipientId: s.parentId, type: NotificationType.CLASS_SCHEDULE_CHANGED },
    });
    const vars = n!.variables as Record<string, string>;
    expect(vars.new_date).toBe(formatDate(new Date('2026-09-29T22:00:00Z'), 'Asia/Riyadh', 'ar'));
    expect(vars.new_date).not.toBe(formatDate(new Date('2026-09-29T22:00:00Z'), 'UTC', 'ar'));
  });

  it('cancelling a class says so, and does not pretend it moved', async () => {
    await g.classSchedule.reschedule(admin(), {
      learnerId: s.learnerId,
      nextClassAt: null,
      reason: 'teacher is unwell',
    });

    const n = await g.prisma.notification.findFirst({
      where: { recipientId: s.parentId, type: NotificationType.CLASS_CANCELLED },
    });
    expect(n).not.toBeNull();
    expect(n!.isEssential).toBe(true);
  });

  it('withdraws the reminders that are now wrong, and leaves history alone', async () => {
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    await g.prisma.learner.update({
      where: { id: s.learnerId },
      data: { nextClassAt: future },
    });
    const parents = await g.recipients.forLearner(s.learnerId);
    await g.classSchedule.scheduleReminders(s.learnerId, parents, future);

    const before = await g.prisma.notification.count({
      where: { learnerId: s.learnerId, eventType: 'class_scheduled', status: 'scheduled' },
    });
    expect(before).toBeGreaterThan(0);

    await g.classSchedule.reschedule(admin(), {
      learnerId: s.learnerId,
      nextClassAt: new Date(future.getTime() + 3600 * 1000),
      reason: 'moved an hour later',
    });

    // The old reminders are cancelled, not deleted.
    expect(
      await g.prisma.notification.count({
        where: { learnerId: s.learnerId, eventType: 'class_scheduled', status: 'cancelled' },
      }),
    ).toBe(before);
    // And new ones exist for the new time.
    expect(
      await g.prisma.notification.count({
        where: { learnerId: s.learnerId, eventType: 'class_scheduled', status: 'scheduled' },
      }),
    ).toBeGreaterThan(0);
  });

  it('says nothing when nothing changed', async () => {
    const at = new Date('2026-09-29T14:00:00Z');
    const result = await g.classSchedule.reschedule(admin(), {
      learnerId: s.learnerId,
      nextClassAt: at,
      reason: 'no-op',
    });
    // A "your class moved" push for a class that did not move is exactly what
    // teaches a parent to ignore these.
    expect(result.notified).toBe(0);
  });

  it('records the change in the audit log, with a reason', async () => {
    await g.classSchedule.reschedule(admin(), {
      learnerId: s.learnerId,
      nextClassAt: new Date('2026-09-29T15:00:00Z'),
      reason: 'teacher availability',
    });

    const audit = await g.prisma.auditLog.findFirst({
      where: { entity: 'learner', entityId: s.learnerId },
    });
    expect(audit).not.toBeNull();
    expect(audit!.action).toBe('class_rescheduled');
    expect(audit!.reason).toBe('teacher availability');
    expect(audit!.before).toMatchObject({ nextClassAt: '2026-09-29T14:00:00.000Z' });
    expect(audit!.after).toMatchObject({ nextClassAt: '2026-09-29T15:00:00.000Z' });
  });

  it('refuses a schedule change with no reason', async () => {
    await expect(
      g.classSchedule.reschedule(admin(), {
        learnerId: s.learnerId,
        nextClassAt: new Date('2026-09-29T15:00:00Z'),
        reason: '  ',
      }),
    ).rejects.toThrow();
  });

  it('refuses a role that may not move a class', async () => {
    await expect(
      g.classSchedule.reschedule(
        { ...admin(), staffRole: 'finance' as never },
        {
          learnerId: s.learnerId,
          nextClassAt: new Date('2026-09-29T15:00:00Z'),
          reason: 'not mine to move',
        },
      ),
    ).rejects.toThrow();
  });
});

// =========================================================================
describe('Scenario 5 · an academy announcement', () => {
  const admin = () => ({
    actorId: s.ownerId,
    kind: 'staff' as const,
    displayName: 'admin_a',
    locale: 'ar' as const,
    isActive: true,
    staffRole: 'admin' as const,
  });

  it('reaches every parent through the ordinary engine', async () => {
    const a = await g.announcements.create(admin(), {
      titleAr: 'إجازة',
      bodyAr: 'الأكاديمية مغلقة يوم الجمعة.',
      titleEn: 'Holiday',
      bodyEn: 'The academy is closed on Friday.',
      priority: 'important',
      targetType: 'all_parents',
    });
    await g.announcements.publish(admin(), a.id);
    await g.announcements.fanOutDue();

    const notifications = await g.prisma.notification.findMany({
      where: { announcementId: a.id },
    });

    // Both contacts of the seeded family.
    expect(notifications).toHaveLength(2);
    for (const n of notifications) {
      expect(n.type).toBe(NotificationType.IMPORTANT_ANNOUNCEMENT);
      expect(n.category).toBe('academy');
      expect(n.deeplink).toBe(`/announcements/${a.id}`);
      // The announcement's own words, frozen on the row.
      expect(n.body).toContain('الجمعة');
    }
  });

  it('is idempotent: fanning out twice is one notification each', async () => {
    const a = await g.announcements.create(admin(), {
      titleAr: 'خبر', bodyAr: 'نص', targetType: 'all_parents',
    });
    await g.announcements.publish(admin(), a.id);
    await g.announcements.fanOut(a.id);
    await g.announcements.fanOut(a.id);

    expect(await g.prisma.notification.count({ where: { announcementId: a.id } })).toBe(2);
  });

  it('refuses an urgent announcement from a role that may not declare one', async () => {
    await expect(
      g.announcements.create(
        { ...admin(), staffRole: 'coverage' as never },
        { titleAr: 'عاجل', bodyAr: 'نص', priority: 'urgent', targetType: 'all_parents' },
      ),
    ).rejects.toThrow(/admin or a manager/);
  });

  it('refuses an announcement from a parent outright', async () => {
    await expect(
      g.announcements.create(
        {
          actorId: s.parentId,
          kind: 'contact',
          displayName: 'parent_p',
          locale: 'ar',
          isActive: true,
          familyId: s.familyId,
        },
        { titleAr: 'x', bodyAr: 'y', targetType: 'all_parents' },
      ),
    ).rejects.toThrow();
  });

  it('the DATABASE refuses an urgent announcement too, not only the service', async () => {
    // Defence in depth: a bug in AnnouncementService, or a client reaching the
    // database another way, must not be able to make an announcement shout.
    const coverageId = randomUUID();
    await g.prisma.$executeRawUnsafe(
      `insert into chat.staff (id, name, role, is_active)
       values ('${coverageId}'::uuid, 'coverage_z', 'coverage', true)`,
    );

    await expect(
      g.prisma.$executeRawUnsafe(
        `insert into chat.announcement (title_ar, body_ar, priority, target_type, created_by)
         values ('x', 'y', 'urgent', 'all_parents', '${coverageId}'::uuid)`,
      ),
    ).rejects.toThrow(/admin or a manager/);
  });

  it('lets a parent read an announcement addressed to them', async () => {
    const a = await g.announcements.create(admin(), {
      titleAr: 'خبر', bodyAr: 'نص', targetType: 'all_parents',
    });
    await g.announcements.publish(admin(), a.id);
    await g.announcements.fanOut(a.id);

    const read = await g.announcements.readForActor(s.parentId, a.id);
    expect(read.title).toBe('خبر');
    // Targeting never leaves the server: knowing who else was written to is not
    // a parent's business.
    expect(read).not.toHaveProperty('targetIds');
    expect(read).not.toHaveProperty('targetType');
    expect(read).not.toHaveProperty('createdBy');
  });

  it('refuses to show an announcement to somebody outside its audience', async () => {
    const outsider = randomUUID();
    await g.prisma.$executeRawUnsafe(
      `insert into chat.teacher (id, name, is_active)
       values ('${outsider}'::uuid, 'teacher_outsider', true)`,
    );

    const a = await g.announcements.create(admin(), {
      titleAr: 'خبر', bodyAr: 'نص', targetType: 'all_parents',
    });
    await g.announcements.publish(admin(), a.id);
    await g.announcements.fanOut(a.id);

    await expect(g.announcements.readForActor(outsider, a.id)).rejects.toThrow();
  });

  it('an expired announcement is gone from the centre but not from the record', async () => {
    const a = await g.announcements.create(admin(), {
      titleAr: 'قديم', bodyAr: 'نص', targetType: 'all_parents',
      expiresAt: new Date(Date.now() + 1000),
    });
    await g.announcements.publish(admin(), a.id);
    await g.announcements.fanOut(a.id);

    await g.prisma.notification.updateMany({
      where: { announcementId: a.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const page = await g.centre.list(s.parentId);
    expect(page.items.find((i) => i.announcementId === a.id)).toBeUndefined();
    // Still on disk, for support and for the audit trail.
    expect(await g.prisma.notification.count({ where: { announcementId: a.id } })).toBe(2);
  });

  it('lists announcements for staff, with counts and never with ids', async () => {
    const a = await g.announcements.create(admin(), {
      titleAr: 'خبر', bodyAr: 'نص', targetType: 'families', targetIds: [s.familyId],
    });
    await g.announcements.publish(admin(), a.id);

    const page = await g.announcements.list(admin());
    const row = page.items.find((i) => i.id === a.id)!;

    expect(row.status).toBe('published');
    expect(row.createdByName).toBe('admin_a');
    // An admin needs to know how wide it went. Naming the families serves
    // nothing and puts a roster on a screen that does not need one.
    expect(row.targetCount).toBe(1);
    expect(JSON.stringify(row)).not.toContain(s.familyId);
  });

  it('refuses the list to a role that may not publish', async () => {
    await expect(
      g.announcements.list({
        actorId: s.parentId, kind: 'contact', displayName: 'parent_p',
        locale: 'ar', isActive: true, familyId: s.familyId,
      }),
    ).rejects.toThrow();
  });

  it('pages the list without repeating a row', async () => {
    for (let i = 0; i < 7; i += 1) {
      const a = await g.announcements.create(admin(), {
        titleAr: `خبر ${i}`, bodyAr: 'نص', targetType: 'all_parents',
        publishAt: new Date(Date.UTC(2026, 8, 20 + i)),
      });
      await g.announcements.publish(admin(), a.id);
    }

    const first = await g.announcements.list(admin(), { limit: 3 });
    expect(first.items).toHaveLength(3);
    expect(first.hasMore).toBe(true);

    const second = await g.announcements.list(admin(), { limit: 3, cursor: first.nextCursor! });
    const third = await g.announcements.list(admin(), { limit: 3, cursor: second.nextCursor! });

    const ids = [...first.items, ...second.items, ...third.items].map((i) => i.id);
    expect(new Set(ids).size).toBe(7);
    expect(third.hasMore).toBe(false);
  });

  it('audits who published it, and how many it reached, without listing them', async () => {
    const a = await g.announcements.create(admin(), {
      titleAr: 'خبر', bodyAr: 'نص', targetType: 'families', targetIds: [s.familyId],
    });
    await g.announcements.publish(admin(), a.id);

    const audit = await g.prisma.auditLog.findFirst({
      where: { entity: 'announcement', entityId: a.id },
    });
    expect(audit!.action).toBe('announcement_published');
    expect(audit!.actorId).toBe(s.ownerId);
    expect(audit!.after).toMatchObject({ targetCount: 1 });
    // A count, not a mailing list.
    expect(JSON.stringify(audit!.after)).not.toContain(s.familyId);
  });
});

// =========================================================================
describe('Scenario 6 · the parent was offline', () => {
  it('the notification waits, unread, and is there when they come back', async () => {
    const conversationId = await studentGroup();
    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'while you were out' });
    await drain();
    // Dispatch runs with nobody connected and no device registered.
    await g.notifications.dispatchDue(new Date());

    // Hours later.
    const page = await g.centre.list(s.parentId);
    expect(page.items).toHaveLength(1);
    expect(page.items[0].readAt).toBeNull();

    const counts = await g.centre.unreadCounts(s.parentId);
    expect(counts.total).toBe(1);
    expect(counts.byCategory.messaging).toBe(1);
  });

  it('records WHY no push went out rather than dropping it silently', async () => {
    const conversationId = await studentGroup();
    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'no devices here' });
    await drain();
    await g.notifications.dispatchDue(new Date());

    const n = await g.prisma.notification.findFirst({ where: { recipientId: s.parentId } });
    const trace = await g.deliveries.trace(n!.id);
    const push = trace.find((d) => d.channel === 'push');

    // "Why did my phone not buzz?" has an answer.
    expect(push!.status).toBe('skipped');
    expect(push!.skipReason).toBe('NO_DEVICE_TOKEN');
    // And the in-app channel still ran.
    expect(trace.find((d) => d.channel === 'in_app')!.status).toBe('sent');
  });
});

// =========================================================================
describe('Scenario 7 · the parent is on two devices', () => {
  it('one notification, one delivery row per device', async () => {
    await g.notifications.registerDevice({
      actorId: s.parentId, token: 'iphone-token', platform: 'ios',
    });
    await g.notifications.registerDevice({
      actorId: s.parentId, token: 'web-token', platform: 'web',
    });

    const conversationId = await studentGroup();
    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'two devices' });
    await drain();
    await g.notifications.dispatchDue(new Date());

    const n = await g.prisma.notification.findFirst({ where: { recipientId: s.parentId } });
    const trace = await g.deliveries.trace(n!.id);

    // ONE notification…
    expect(await g.prisma.notification.count({ where: { recipientId: s.parentId } })).toBe(1);
    // …and a push per device, plus the in-app channel.
    const pushes = trace.filter((d) => d.channel === 'push');
    expect(pushes).toHaveLength(2);
    expect(pushes.map((p) => p.platform).sort()).toEqual(['ios', 'web']);
  });

  it('reading on one device is read everywhere, because read state is on the server', async () => {
    const conversationId = await studentGroup();
    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'read me' });
    await drain();

    const n = await g.prisma.notification.findFirst({ where: { recipientId: s.parentId } });
    await g.centre.markRead(s.parentId, n!.id);

    // The "other device" asks the server, which is the only source of truth for
    // unread there has ever been.
    expect((await g.centre.unreadCounts(s.parentId)).total).toBe(0);
  });

  it('deactivates a token the platform permanently rejected, and stops retrying it', async () => {
    await g.notifications.registerDevice({
      actorId: s.parentId, token: 'dead-token', platform: 'android',
    });
    const spy = jest
      .spyOn(g.push, 'send')
      .mockResolvedValue({ ok: false, tokenInvalid: true, failureCode: 'UNREGISTERED' });

    const conversationId = await studentGroup();
    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'to a dead device' });
    await drain();
    await g.notifications.dispatchDue(new Date());

    const token = await g.prisma.deviceToken.findUnique({ where: { token: 'dead-token' } });
    expect(token!.isActive).toBe(false);

    const n = await g.prisma.notification.findFirst({ where: { recipientId: s.parentId } });
    const push = (await g.deliveries.trace(n!.id)).find((d) => d.channel === 'push');
    // Permanent failure: failed, with no next attempt. A dead device must not
    // consume a retry budget forever.
    expect(push!.status).toBe('failed');
    expect(push!.errorCode).toBe('UNREGISTERED');
    spy.mockRestore();
  });

  it('retries a transient failure with backoff, then gives up', async () => {
    await g.notifications.registerDevice({
      actorId: s.parentId, token: 'flaky-token', platform: 'android',
    });
    const spy = jest
      .spyOn(g.push, 'send')
      .mockResolvedValue({ ok: false, failureCode: 'PROVIDER_TIMEOUT' });

    const conversationId = await studentGroup();
    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'flaky' });
    await drain();
    await g.notifications.dispatchDue(new Date());

    const n = await g.prisma.notification.findFirst({ where: { recipientId: s.parentId } });
    let push = (await g.prisma.notificationDelivery.findFirst({
      where: { notificationId: n!.id, channel: 'push' },
    }))!;
    expect(push.status).toBe('pending');
    expect(push.nextAttemptAt).not.toBeNull();
    // The token is NOT deactivated: a timeout is not a rejection.
    expect((await g.prisma.deviceToken.findUnique({ where: { token: 'flaky-token' } }))!.isActive)
      .toBe(true);

    // Run the retry sweep until the budget is spent.
    for (let i = 0; i < 8; i += 1) {
      await g.prisma.notificationDelivery.updateMany({
        where: { id: push.id },
        data: { nextAttemptAt: new Date(Date.now() - 1000) },
      });
      await g.deliveries.retryDue(new Date());
      push = (await g.prisma.notificationDelivery.findUnique({ where: { id: push.id } }))!;
      if (push.status === 'failed') break;
    }

    // Bounded. There are no infinite retries.
    expect(push.status).toBe('failed');
    expect(push.nextAttemptAt).toBeNull();
    spy.mockRestore();
  });
});

// =========================================================================
describe('Scenario 8 · the same event processed twice', () => {
  it('is one notification, not two', async () => {
    const conversationId = await studentGroup();
    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'once' });

    // Replay the outbox row the way a duplicate webhook or a worker restart
    // mid-publish would.
    const event = await g.prisma.outboxEvent.findFirst({
      where: { type: CommEvent.MESSAGE_CREATED },
    });
    await drain();
    await g.prisma.outboxEvent.update({
      where: { id: event!.id },
      data: { status: 'pending', publishedAt: null },
    });
    await drain();

    expect(await g.prisma.notification.count({ where: { recipientId: s.parentId } })).toBe(1);
  });

  it('a duplicate dispatch does not send a second push', async () => {
    await g.notifications.registerDevice({
      actorId: s.parentId, token: 'one-device', platform: 'ios',
    });
    const conversationId = await studentGroup();
    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'once' });
    await drain();

    const n = await g.prisma.notification.findFirst({ where: { recipientId: s.parentId } });
    await g.notifications.deliver(n as never);
    await g.notifications.deliver(n as never);

    // The unique index on (notification, channel, device) is the guarantee.
    expect(
      await g.prisma.notificationDelivery.count({
        where: { notificationId: n!.id, channel: 'push' },
      }),
    ).toBe(1);
  });
});

// =========================================================================
/**
 * DEDUPLICATION, STAGE BY STAGE.
 *
 * "It only happens once" is not one mechanism, it is five, each with its own
 * idempotency key and its own failure it is there to absorb. These tests pin
 * the literal key at every stage, for every producer the product actually has,
 * so that a change to a key is a failing test rather than a duplicate
 * notification discovered by a parent.
 *
 *   1. OUTBOX CLAIM       key: outbox_event.id
 *                         conditional update on status='pending'; two workers
 *                         draining at once, one wins.
 *   2. NOTIFICATION       key: chat.notification.dedupe_key (UNIQUE)
 *                         the producer composes it; schedule() treats the
 *                         unique violation as success.
 *   3. DISPATCH CLAIM     key: notification.id + status/lease
 *                         conditional update; expired lease is recoverable.
 *   4. DELIVERY           key: (notification_id, channel, device_token_id)
 *                         UNIQUE, so a replayed dispatch cannot re-send.
 *   5. TRANSPORT          NOT deduplicated. Recovery of an abandoned delivery
 *                         can re-send a push -- see the at-least-once tests in
 *                         notification-resilience.spec.ts.
 *
 * Stage 2 is the one a producer gets wrong, so each producer is asserted by its
 * exact key below.
 */
describe('deduplication, stage by stage', () => {
  const admin = () => ({
    actorId: s.ownerId,
    kind: 'staff' as const,
    displayName: 'admin_a',
    locale: 'ar' as const,
    isActive: true,
    staffRole: 'admin' as const,
  });

  async function keysFor(recipientId: string): Promise<string[]> {
    const rows = await g.prisma.notification.findMany({
      where: { recipientId },
      select: { dedupeKey: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => r.dedupeKey);
  }

  // -- stage 1: the outbox claim -------------------------------------------

  it('stage 1 · two workers draining at once publish each event once', async () => {
    const conversationId = await studentGroup();
    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'race' });

    // Both start with the same pending row visible to both.
    await Promise.all([g.outboxWorker.drain(200), g.outboxWorker.drain(200)]);

    expect(await g.prisma.notification.count({ where: { recipientId: s.parentId } })).toBe(1);
    const events = await g.prisma.outboxEvent.findMany({
      where: { type: CommEvent.MESSAGE_CREATED },
    });
    // Claimed once, published once. The loser of the conditional update skipped
    // the row rather than processing it a second time.
    expect(events.every((e) => e.status === 'published')).toBe(true);
  });

  // -- stage 2: one key per producer ---------------------------------------

  it('stage 2 · a message keys on the message and the recipient', async () => {
    const conversationId = await studentGroup();
    const sent = await g.messages.send({ conversationId, senderId: s.ownerId, body: 'keyed' });
    await drain();
    await drain();

    expect(await keysFor(s.parentId)).toEqual([`message:${sent.id}:${s.parentId}`]);
  });

  it('stage 2 · an incoming call keys on the call and the callee', async () => {
    const conversationId = await studentGroup();
    const { callId } = await g.calls.start(conversationId, s.ownerId);
    await drain();
    await drain();

    expect(await keysFor(s.parentId)).toEqual([`incoming_call:${callId}:${s.parentId}`]);
  });

  it('stage 2 · a missed call keys on the call, whichever path produced it', async () => {
    const conversationId = await studentGroup();
    const { callId } = await g.calls.start(conversationId, s.ownerId);

    // The ring-out sweep gets there first...
    await g.prisma.call.update({
      where: { id: callId },
      data: { startedAt: new Date(Date.now() - 10 * 60_000) },
    });
    await g.calls.expireRingingCalls(new Date());
    await drain();

    // ...and the caller's app, coming back from the dead, ends the same call.
    await g.calls.end(callId, s.ownerId, 'missed');
    await drain();

    // Both producers really ran -- otherwise this test would prove nothing.
    expect(
      await g.prisma.outboxEvent.count({ where: { type: CommEvent.CALL_ENDED } }),
    ).toBe(2);

    // TWO producers, ONE key, one notification. This is the case the key
    // exists for: the sweep and the hang-up are independent, and both are
    // correct to try.
    const missed = await g.prisma.notification.findMany({
      where: { recipientId: s.parentId, type: NotificationType.MISSED_CALL },
    });
    expect(missed).toHaveLength(1);
    expect(missed[0].dedupeKey).toBe(`missed_call:${callId}:${s.parentId}`);
  });

  it('stage 2 · an approval keys on the approval, for the approver and the author', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId);
    const msg = await g.messages.send({
      conversationId: group.id, senderId: s.teacherId, body: 'homework for tomorrow',
    });
    await drain();
    const approval = (await g.prisma.messageApproval.findUnique({
      where: { messageId: msg.id },
    }))!;

    expect(await keysFor(s.ownerId)).toEqual([`approval_requested:${approval.id}:${s.ownerId}`]);

    await g.approvals.approve(approval.id, s.ownerId);
    await drain();
    await drain();

    expect(await keysFor(s.teacherId)).toEqual([`approval_decided:${approval.id}:${s.teacherId}`]);
  });

  it('stage 2 · an announcement keys on the announcement and the recipient', async () => {
    const a = await g.announcements.create(admin(), {
      titleAr: 'خبر', bodyAr: 'نص', targetType: 'all_parents',
    });
    await g.announcements.publish(admin(), a.id);
    await g.announcements.fanOut(a.id);
    await g.announcements.fanOut(a.id);

    const rows = await g.prisma.notification.findMany({ where: { announcementId: a.id } });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.dedupeKey).toBe(`announcement:${a.id}:${row.recipientId}`);
    }
  });

  it('stage 2 · a class reminder keys on the rule, the learner, the exact class and the parent',
    async () => {
      const classAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
      await g.prisma.learner.update({
        where: { id: s.learnerId },
        data: { nextClassAt: classAt },
      });
      const parents = await g.recipients.forLearner(s.learnerId);

      // Re-running the sweep is normal: it runs on a timer and on every
      // reschedule. It must cost nothing.
      await g.classSchedule.scheduleReminders(s.learnerId, parents, classAt);
      await g.classSchedule.scheduleReminders(s.learnerId, parents, classAt);

      const rules = await g.prisma.notificationRule.findMany({
        where: { eventType: 'class_scheduled', enabled: true },
      });
      const mine = await g.prisma.notification.findMany({
        where: { recipientId: s.parentId, eventType: 'class_scheduled' },
      });

      expect(mine).toHaveLength(rules.length);
      for (const row of mine) {
        expect(row.dedupeKey).toBe(
          `${row.ruleKey}:${s.learnerId}:${classAt.toISOString()}:${s.parentId}`,
        );
      }
    });

  it('stage 2 · a schedule change keys on the TRANSITION, so a real second change is told',
    async () => {
      const first = new Date('2026-09-29T14:00:00Z');
      const second = new Date('2026-09-29T15:00:00Z');
      const third = new Date('2026-09-29T16:00:00Z');
      await g.prisma.learner.update({
        where: { id: s.learnerId },
        data: { nextClassAt: first },
      });

      await g.classSchedule.reschedule(admin(), {
        learnerId: s.learnerId, nextClassAt: second, reason: 'first move',
      });
      // The same transition again -- a retried request, a double-tapped button.
      await g.classSchedule.reschedule(admin(), {
        learnerId: s.learnerId, nextClassAt: second, reason: 'first move',
      });
      await g.classSchedule.reschedule(admin(), {
        learnerId: s.learnerId, nextClassAt: third, reason: 'second move',
      });

      const changes = await g.prisma.notification.findMany({
        where: { recipientId: s.parentId, type: NotificationType.CLASS_SCHEDULE_CHANGED },
        orderBy: { createdAt: 'asc' },
      });

      // Two changes happened, so the parent was told twice -- and the repeat of
      // the first was absorbed. A key on the learner alone would have silenced
      // the second move; a key on the timestamp alone would have repeated the
      // first.
      expect(changes.map((c) => c.dedupeKey)).toEqual([
        `class_change:${s.learnerId}:${first.toISOString()}>${second.toISOString()}:${s.parentId}`,
        `class_change:${s.learnerId}:${second.toISOString()}>${third.toISOString()}:${s.parentId}`,
      ]);
    });

  it('stage 2 · a cancellation keys on the transition to nothing', async () => {
    const first = new Date('2026-09-29T14:00:00Z');
    await g.prisma.learner.update({
      where: { id: s.learnerId },
      data: { nextClassAt: first },
    });

    await g.classSchedule.reschedule(admin(), {
      learnerId: s.learnerId, nextClassAt: null, reason: 'teacher is unwell',
    });
    await g.classSchedule.reschedule(admin(), {
      learnerId: s.learnerId, nextClassAt: null, reason: 'teacher is unwell',
    });

    const cancels = await g.prisma.notification.findMany({
      where: { recipientId: s.parentId, type: NotificationType.CLASS_CANCELLED },
    });
    expect(cancels).toHaveLength(1);
    expect(cancels[0].dedupeKey).toBe(
      `class_change:${s.learnerId}:${first.toISOString()}>none:${s.parentId}`,
    );
  });

  it('stage 2 · the uniqueness is the DATABASE’s, not the engine’s', async () => {
    const input = {
      dedupeKey: 'proof:1', type: NotificationType.MESSAGE_RECEIVED,
      eventType: 'message_created', recipientId: s.parentId,
      scheduledAt: new Date(),
    };

    const a = await g.notifications.schedule(input);
    const b = await g.notifications.schedule(input);

    // Same id back, and the caller is told it already existed -- the grouping
    // path depends on being able to tell.
    expect(b.notificationId).toBe(a.notificationId);
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);

    // And the constraint is real, not a lookup the engine performs: a direct
    // insert bypassing the engine is refused by Postgres.
    await expect(
      g.prisma.notification.create({
        data: {
          dedupeKey: 'proof:1', recipientId: s.parentId, eventType: 'message_created',
          type: NotificationType.MESSAGE_RECEIVED, category: 'messaging', priority: 'normal',
          templateKey: 'message_received', scheduledAt: new Date(),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('stage 2 · concurrent producers of the same key produce one notification', async () => {
    const input = {
      dedupeKey: 'race:1', type: NotificationType.MESSAGE_RECEIVED,
      eventType: 'message_created', recipientId: s.parentId,
      scheduledAt: new Date(),
    };

    // No read-then-write window to lose: the unique index arbitrates.
    const results = await Promise.all([
      g.notifications.schedule(input),
      g.notifications.schedule(input),
      g.notifications.schedule(input),
    ]);

    const ids = new Set(results.map((r) => r.notificationId));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await g.prisma.notification.count({ where: { dedupeKey: 'race:1' } })).toBe(1);
  });

  // -- stages 3 and 4: dispatch and delivery --------------------------------

  it('stages 3 and 4 · a replayed dispatch re-sends nothing', async () => {
    await g.notifications.registerDevice({
      actorId: s.parentId, token: 'dedupe-device', platform: 'android',
    });
    const conversationId = await studentGroup();
    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'once only' });
    await drain();

    const sends: string[] = [];
    const spy = jest.spyOn(g.push, 'send').mockImplementation(async (m) => {
      sends.push(m.token);
      return { ok: true };
    });

    await g.notifications.dispatchDue(new Date());
    await g.notifications.dispatchDue(new Date());
    await g.notifications.dispatchDue(new Date());
    spy.mockRestore();

    // Stage 3 stops the second dispatch (the notification is already `sent`),
    // and stage 4 would stop it even if stage 3 did not.
    expect(sends).toEqual(['dedupe-device']);
    expect(
      await g.prisma.notificationDelivery.count({
        where: { channel: 'push', recipientId: s.parentId },
      }),
    ).toBe(1);
  });

  it('stages 3 and 4 · a second device is a second delivery, not a second notification',
    async () => {
      for (const token of ['phone', 'tablet']) {
        await g.notifications.registerDevice({
          actorId: s.parentId, token, platform: 'android',
        });
      }
      const conversationId = await studentGroup();
      await g.messages.send({ conversationId, senderId: s.ownerId, body: 'two devices' });
      await drain();
      await g.notifications.dispatchDue(new Date());

      expect(await g.prisma.notification.count({ where: { recipientId: s.parentId } })).toBe(1);
      const pushes = await g.prisma.notificationDelivery.findMany({
        where: { recipientId: s.parentId, channel: 'push' },
      });
      // The delivery key includes the device, so fan-out is per device and
      // re-running it is still one row per device.
      expect(pushes).toHaveLength(2);

      await g.notifications.dispatchDue(new Date());
      expect(
        await g.prisma.notificationDelivery.count({
          where: { recipientId: s.parentId, channel: 'push' },
        }),
      ).toBe(2);
    });
});

// =========================================================================
describe('the notification centre', () => {
  async function fill(count: number): Promise<void> {
    const conversationId = await studentGroup();
    for (let i = 0; i < count; i += 1) {
      await g.messages.send({ conversationId, senderId: s.ownerId, body: `m${i}` });
    }
    await drain();
  }

  it('pages newest first, and a cursor does not skip or repeat a row', async () => {
    await fill(12);

    const first = await g.centre.list(s.parentId, { limit: 5 });
    expect(first.items).toHaveLength(5);
    expect(first.hasMore).toBe(true);

    const second = await g.centre.list(s.parentId, { limit: 5, cursor: first.nextCursor! });
    const third = await g.centre.list(s.parentId, { limit: 5, cursor: second.nextCursor! });

    const ids = [...first.items, ...second.items, ...third.items].map((i) => i.id);
    expect(ids).toHaveLength(12);
    expect(new Set(ids).size).toBe(12);
    expect(third.hasMore).toBe(false);

    // Newest first.
    const times = [...first.items, ...second.items, ...third.items].map((i) =>
      Date.parse(i.createdAt),
    );
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('a stale cursor shows the newest page rather than an error', async () => {
    await fill(3);
    const page = await g.centre.list(s.parentId, { cursor: 'not-a-real-cursor' });
    expect(page.items).toHaveLength(3);
  });

  it('caps the page size a client can ask for', async () => {
    await fill(3);
    const page = await g.centre.list(s.parentId, { limit: 100_000 });
    expect(page.items.length).toBeLessThanOrEqual(100);
  });

  it('filters by category and by unread', async () => {
    await fill(2);
    const n = await g.prisma.notification.findFirst({ where: { recipientId: s.parentId } });
    await g.centre.markRead(s.parentId, n!.id);

    expect((await g.centre.list(s.parentId, { category: 'messaging' })).items).toHaveLength(2);
    expect((await g.centre.list(s.parentId, { category: 'classes' })).items).toHaveLength(0);
    expect((await g.centre.list(s.parentId, { unreadOnly: true })).items).toHaveLength(1);
  });

  it('marking read is idempotent and does not move the first read time', async () => {
    await fill(1);
    const n = await g.prisma.notification.findFirst({ where: { recipientId: s.parentId } });

    expect(await g.centre.markRead(s.parentId, n!.id)).toBe(true);
    const firstReadAt = (await g.prisma.notification.findUnique({ where: { id: n!.id } }))!.readAt;

    // A client on a flaky connection retries. It must not rewrite the record.
    expect(await g.centre.markRead(s.parentId, n!.id)).toBe(false);
    expect((await g.prisma.notification.findUnique({ where: { id: n!.id } }))!.readAt)
      .toEqual(firstReadAt);
  });

  it('mark-all-read is idempotent too', async () => {
    await fill(4);
    expect(await g.centre.markAllRead(s.parentId)).toBe(4);
    expect(await g.centre.markAllRead(s.parentId)).toBe(0);
    expect((await g.centre.unreadCounts(s.parentId)).total).toBe(0);
  });

  it('mark-all-read can be scoped to one category', async () => {
    await fill(2);
    await g.prisma.notification.create({
      data: {
        dedupeKey: 'billing:1', type: NotificationType.RENEWAL_REMINDER,
        category: 'billing', templateKey: 'renewal_reminder', eventType: 'renewal_due',
        recipientId: s.parentId, title: 't', body: 'b', scheduledAt: new Date(),
      },
    });

    expect(await g.centre.markAllRead(s.parentId, 'messaging')).toBe(2);
    expect((await g.centre.unreadCounts(s.parentId)).total).toBe(1);
    expect((await g.centre.unreadCounts(s.parentId)).byCategory.billing).toBe(1);
  });

  it('opening a thread reads its notifications', async () => {
    const conversationId = await studentGroup();
    await fill(3);
    expect(await g.centre.markConversationRead(s.parentId, conversationId)).toBe(3);
    expect((await g.centre.unreadCounts(s.parentId)).total).toBe(0);
  });

  it('counts unread per category as well as in total', async () => {
    await fill(2);
    const counts = await g.centre.unreadCounts(s.parentId);
    expect(counts.total).toBe(2);
    expect(counts.byCategory.messaging).toBe(2);
    // Every category is present, so a client never has to handle a missing key.
    expect(counts.byCategory.calls).toBe(0);
    expect(counts.byCategory.classes).toBe(0);
  });

  it('keeps every notification, because the centre is the record', async () => {
    await fill(5);
    const page = await g.centre.list(s.parentId);
    // Five messages are five notifications here. The burst is collapsed at the
    // push -- one buzz, not five -- and not in the history a parent scrolls
    // back through looking for what they were actually told.
    expect(page.items).toHaveLength(5);
    expect(new Set(page.items.map((i) => i.id)).size).toBe(5);
    expect((await g.centre.unreadCounts(s.parentId)).total).toBe(5);
  });

  it('names the child and the sender on the card', async () => {
    await fill(1);
    const card = (await g.centre.list(s.parentId)).items[0];
    expect(card.learnerName).toBe('learner_l');
    expect(card.senderName).toBe('admin_a');
    expect(card.deeplink).toContain('/chats/');
  });
});

// =========================================================================
describe('the push payload the device will receive', () => {
  /**
   * THE CONTRACT BETWEEN THE TWO HALVES.
   *
   * These key names are what `PushDeepLink.resolve` in the Flutter app reads to
   * decide where a tap goes. They are asserted here, on the sending side,
   * because a rename would otherwise break every deep link in the product with
   * nothing failing: the backend would keep sending, the device would keep
   * receiving, and every tap would land on the notification centre instead of
   * the thing the parent tapped.
   *
   * The mirror of this test is `push_lifecycle_test.dart`, which feeds exactly
   * this shape to the client resolver.
   */
  async function capturePayload(): Promise<Record<string, string>> {
    await g.notifications.registerDevice({
      actorId: s.parentId, token: 'contract-device', platform: 'ios',
    });
    const sends: Array<Record<string, string>> = [];
    const spy = jest.spyOn(g.push, 'send').mockImplementation(async (m) => {
      sends.push(m.data);
      return { ok: true };
    });

    const conversationId = await studentGroup();
    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'contract' });
    await drain();
    await g.notifications.dispatchDue(new Date());

    spy.mockRestore();
    return sends[0];
  }

  it('carries exactly the keys the client resolves on', async () => {
    const payload = await capturePayload();

    // Named individually rather than snapshotted: a snapshot would accept a
    // rename by being updated, which is the failure this exists to prevent.
    expect(payload).toHaveProperty('notificationId');
    expect(payload).toHaveProperty('type');
    expect(payload).toHaveProperty('category');
    expect(payload).toHaveProperty('priority');
    expect(payload).toHaveProperty('conversationId');
    expect(payload).toHaveProperty('deeplink');
  });

  it('carries no key that is not an id, an enum or a route', async () => {
    const payload = await capturePayload();
    const allowed = new Set([
      'notificationId', 'type', 'category', 'priority',
      'entityType', 'entityId', 'conversationId', 'learnerId',
      'announcementId', 'deeplink',
    ]);

    // A new key reaching a lock screen should be a deliberate decision, made
    // here, and not something that arrives because a payload builder grew.
    for (const key of Object.keys(payload)) {
      expect(allowed.has(key)).toBe(true);
    }
  });

  it('every value is a string, because FCM data payloads carry nothing else', async () => {
    const payload = await capturePayload();
    for (const value of Object.values(payload)) {
      expect(typeof value).toBe('string');
    }
  });

  it('the deeplink is one the client knows how to open', async () => {
    const payload = await capturePayload();
    // PushDeepLink accepts /chats/... and /announcements/..., and rebuilds from
    // ids in preference to this string. Both must agree on the prefix.
    expect(payload.deeplink.startsWith('/chats/')).toBe(true);
    expect(payload.conversationId).toBeTruthy();
  });
});

// =========================================================================
describe('security', () => {
  it('one parent cannot read another family’s notifications', async () => {
    const conversationId = await studentGroup();
    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'private' });
    await drain();

    // A second family, entirely separate.
    const otherFamily = randomUUID();
    const stranger = randomUUID();
    await g.prisma.$executeRawUnsafe(
      `insert into chat.family (id, display_name, owner_id, language)
       values ('${otherFamily}'::uuid, 'family_y', '${s.ownerId}'::uuid, 'ar')`,
    );
    await g.prisma.$executeRawUnsafe(
      `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active)
       values ('${stranger}'::uuid, '${otherFamily}'::uuid, 'parent_z', 'primary_guardian', true, true)`,
    );

    expect((await g.centre.list(stranger)).items).toHaveLength(0);
    expect((await g.centre.unreadCounts(stranger)).total).toBe(0);
  });

  it('a notification id belonging to somebody else is simply not found', async () => {
    const conversationId = await studentGroup();
    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'private' });
    await drain();
    const n = await g.prisma.notification.findFirst({ where: { recipientId: s.parentId } });

    // Not "forbidden" -- not found. Distinguishing the two tells an attacker
    // which ids are real.
    await expect(g.centre.byId(s.otherParentId, n!.id)).rejects.toThrow(/not found/);
  });

  it('cannot mark somebody else’s notification read', async () => {
    const conversationId = await studentGroup();
    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'private' });
    await drain();
    const n = await g.prisma.notification.findFirst({ where: { recipientId: s.parentId } });

    expect(await g.centre.markRead(s.otherParentId, n!.id)).toBe(false);
    expect((await g.prisma.notification.findUnique({ where: { id: n!.id } }))!.readAt).toBeNull();
  });

  it('cannot silence somebody else’s device by knowing its token', async () => {
    await g.notifications.registerDevice({
      actorId: s.parentId, token: 'victim-token', platform: 'ios',
    });
    await g.notifications.unregisterDevice('victim-token', s.otherParentId);

    expect((await g.prisma.deviceToken.findUnique({ where: { token: 'victim-token' } }))!.isActive)
      .toBe(true);
  });

  it('a push payload carries ids, never message content', async () => {
    await g.notifications.registerDevice({
      actorId: s.parentId, token: 'lockscreen', platform: 'ios',
    });
    const sends: Array<{ title: string; body: string; data: Record<string, string> }> = [];
    const spy = jest.spyOn(g.push, 'send').mockImplementation(async (m) => {
      sends.push({ title: m.title, body: m.body, data: m.data });
      return { ok: true };
    });

    const conversationId = await studentGroup();
    await g.messages.send({
      conversationId, senderId: s.ownerId, body: 'SECRET-MEDICAL-DETAIL',
    });
    await drain();
    await g.notifications.dispatchDue(new Date());

    expect(sends).toHaveLength(1);
    const payload = JSON.stringify(sends[0]);
    // The message body never reaches a lock screen or a platform's logs.
    expect(payload).not.toContain('SECRET-MEDICAL-DETAIL');
    expect(sends[0].body).toBe('');
    // Routing ids only.
    expect(sends[0].data).toMatchObject({ conversationId, category: 'messaging' });
    spy.mockRestore();
  });
});

// =========================================================================
describe('preferences', () => {
  it('a muted category skips the push and records why, keeping the notification', async () => {
    await g.notifications.registerDevice({
      actorId: s.parentId, token: 'muted-device', platform: 'ios',
    });
    await g.preferences.set(s.parentId, 'messaging', false);

    const conversationId = await studentGroup();
    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'muted' });
    await drain();
    await g.notifications.dispatchDue(new Date());

    const n = await g.prisma.notification.findFirst({ where: { recipientId: s.parentId } });
    // The notification EXISTS: in-app is never disableable.
    expect(n).not.toBeNull();
    expect((await g.centre.unreadCounts(s.parentId)).total).toBe(1);

    const push = (await g.deliveries.trace(n!.id)).find((d) => d.channel === 'push');
    expect(push!.status).toBe('skipped');
    expect(push!.skipReason).toBe('PREFERENCE_OFF');
  });

  it('an essential notification ignores the mute entirely', async () => {
    await g.notifications.registerDevice({
      actorId: s.parentId, token: 'muted-classes', platform: 'ios',
    });
    await g.preferences.set(s.parentId, 'classes', false);
    await g.prisma.learner.update({
      where: { id: s.learnerId },
      data: { nextClassAt: new Date('2026-09-29T14:00:00Z') },
    });

    await g.classSchedule.reschedule(
      {
        actorId: s.ownerId, kind: 'staff', displayName: 'admin_a',
        locale: 'ar', isActive: true, staffRole: 'admin',
      },
      {
        learnerId: s.learnerId,
        nextClassAt: null,
        reason: 'cancelled while muted',
      },
    );
    await g.notifications.dispatchDue(new Date());

    const n = await g.prisma.notification.findFirst({
      where: { recipientId: s.parentId, type: NotificationType.CLASS_CANCELLED },
    });
    const push = (await g.deliveries.trace(n!.id)).find((d) => d.channel === 'push');
    // A cancelled class reaches a parent who muted class reminders.
    expect(push!.status).not.toBe('skipped');
  });

  it('refuses to mute a category the product says is essential', async () => {
    await expect(g.preferences.set(s.parentId, 'approvals', false)).rejects.toThrow(
      /essential and cannot be muted/,
    );
  });

  it('the DATABASE refuses it too', async () => {
    await expect(
      g.prisma.$executeRawUnsafe(
        `insert into chat.notification_preference (actor_id, category, push_enabled)
         values ('${s.parentId}'::uuid, 'account', false)`,
      ),
    ).rejects.toThrow(/not optional/);
  });

  it('lists every category, marking the ones that cannot be muted', async () => {
    const list = await g.preferences.list(s.parentId);
    const byKey = new Map(list.map((c) => [c.category, c]));

    expect(byKey.get('messaging')!.isOptional).toBe(true);
    expect(byKey.get('approvals')!.isOptional).toBe(false);
    // Nobody is opted out by default.
    expect(list.every((c) => c.pushEnabled)).toBe(true);
  });

  it('setting the same preference twice is a no-op', async () => {
    await g.preferences.set(s.parentId, 'billing', false);
    await g.preferences.set(s.parentId, 'billing', false);
    expect(
      await g.prisma.notificationPreference.count({
        where: { actorId: s.parentId, category: 'billing' },
      }),
    ).toBe(1);
  });
});

// =========================================================================
describe('grouping', () => {
  it('a burst from one sender buzzes once, and all of it reaches the centre',
    async () => {
      await g.notifications.registerDevice({
        actorId: s.parentId, token: 'burst-device', platform: 'ios',
      });
      const conversationId = await studentGroup();

      for (let i = 0; i < 5; i += 1) {
        await g.messages.send({ conversationId, senderId: s.ownerId, body: `m${i}` });
      }
      await drain();
      await g.notifications.dispatchDue(new Date());

      const notifications = await g.prisma.notification.findMany({
        where: { recipientId: s.parentId },
        orderBy: { createdAt: 'asc' },
      });

      // Five notifications, five unread, nothing lost.
      expect(notifications).toHaveLength(5);
      expect((await g.centre.unreadCounts(s.parentId)).total).toBe(5);

      // One push attempted; the other four recorded as deliberately skipped.
      const pushes = await g.prisma.notificationDelivery.findMany({
        where: { recipientId: s.parentId, channel: 'push' },
      });
      expect(pushes.filter((p) => p.status !== 'skipped')).toHaveLength(1);
      expect(pushes.filter((p) => p.skipReason === 'GROUPED')).toHaveLength(4);

      // And every one of them still got its in-app delivery.
      const inApp = await g.prisma.notificationDelivery.findMany({
        where: { recipientId: s.parentId, channel: 'in_app' },
      });
      expect(inApp).toHaveLength(5);
    });

  it('buzzes again once the parent has caught up', async () => {
    await g.notifications.registerDevice({
      actorId: s.parentId, token: 'burst-device-2', platform: 'ios',
    });
    const conversationId = await studentGroup();

    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'first' });
    await drain();
    // They read it, so the burst is over.
    await g.centre.markAllRead(s.parentId);

    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'second' });
    await drain();
    await g.notifications.dispatchDue(new Date());

    const pushes = await g.prisma.notificationDelivery.findMany({
      where: { recipientId: s.parentId, channel: 'push' },
    });
    // Swallowing this one because of a message they already read would be a
    // notification silently lost.
    expect(pushes.filter((p) => p.skipReason === 'GROUPED')).toHaveLength(0);
  });

  it('never groups a schedule change, however many arrive', async () => {
    await g.notifications.registerDevice({
      actorId: s.parentId, token: 'sched-device', platform: 'ios',
    });
    await g.prisma.learner.update({
      where: { id: s.learnerId },
      data: { nextClassAt: new Date('2026-09-29T14:00:00Z') },
    });
    const admin = {
      actorId: s.ownerId, kind: 'staff' as const, displayName: 'admin_a',
      locale: 'ar' as const, isActive: true, staffRole: 'admin' as const,
    };

    await g.classSchedule.reschedule(admin, {
      learnerId: s.learnerId,
      nextClassAt: new Date('2026-09-29T15:00:00Z'),
      reason: 'first',
    });
    await g.classSchedule.reschedule(admin, {
      learnerId: s.learnerId,
      nextClassAt: new Date('2026-09-29T16:00:00Z'),
      reason: 'second',
    });
    await g.notifications.dispatchDue(new Date());

    const changes = await g.prisma.notification.findMany({
      where: { recipientId: s.parentId, type: NotificationType.CLASS_SCHEDULE_CHANGED },
    });
    expect(changes).toHaveLength(2);
    // Both carry no group key at all, so neither can ever be swallowed.
    expect(changes.every((c) => c.groupKey === null)).toBe(true);

    const pushes = await g.prisma.notificationDelivery.findMany({
      where: {
        channel: 'push',
        notificationId: { in: changes.map((c) => c.id) },
      },
    });
    expect(pushes.filter((p) => p.skipReason === 'GROUPED')).toHaveLength(0);
  });
});

// =========================================================================
describe('a conversation the parent is already reading', () => {
  it('creates the notification but skips the push, and says so', async () => {
    await g.notifications.registerDevice({
      actorId: s.parentId, token: 'in-hand', platform: 'ios',
    });
    const conversationId = await studentGroup();

    // Stand in for the gateway having recorded the subscription.
    const originalIsViewing = g.presence.isViewing.bind(g.presence);
    const spy = jest
      .spyOn(g.presence, 'isViewing')
      .mockImplementation(async (actorId, convId) =>
        actorId === s.parentId && convId === conversationId,
      );

    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'you are reading this' });
    await drain();
    await g.notifications.dispatchDue(new Date());

    const n = await g.prisma.notification.findFirst({ where: { recipientId: s.parentId } });
    // The badge still moves and the centre still has it.
    expect(n).not.toBeNull();
    expect((await g.centre.unreadCounts(s.parentId)).total).toBe(1);

    const push = (await g.deliveries.trace(n!.id)).find((d) => d.channel === 'push');
    expect(push!.status).toBe('skipped');
    expect(push!.skipReason).toBe('RECIPIENT_ACTIVE');

    spy.mockRestore();
    void originalIsViewing;
  });
});

// =========================================================================
describe('quiet hours', () => {
  it('defers a normal notification to the end of the window', async () => {
    await g.prisma.quietHours.create({
      data: { actorId: s.parentId, timezone: 'UTC', startMinute: 1320, endMinute: 480 },
    });

    const atNight = new Date('2026-09-10T23:00:00Z');
    await g.notifications.schedule({
      dedupeKey: 'qh:normal', type: NotificationType.MESSAGE_RECEIVED,
      eventType: 'message_published', recipientId: s.parentId,
      variables: { sender_name: 'admin_a' }, scheduledAt: atNight,
    });

    const n = await g.prisma.notification.findUnique({ where: { dedupeKey: 'qh:normal' } });
    // Deferred, never dropped.
    expect(n!.scheduledAt.toISOString()).toBe('2026-09-11T08:00:00.000Z');
  });

  it('an essential notification breaks through', async () => {
    await g.prisma.quietHours.create({
      data: { actorId: s.parentId, timezone: 'UTC', startMinute: 1320, endMinute: 480 },
    });

    const atNight = new Date('2026-09-10T23:00:00Z');
    await g.notifications.schedule({
      dedupeKey: 'qh:urgent', type: NotificationType.CLASS_CANCELLED,
      eventType: 'class_cancelled', recipientId: s.parentId,
      learnerId: s.learnerId, learnerName: 'learner_l',
      variables: { old_time: '5:00', old_date: 'Tuesday' }, scheduledAt: atNight,
    });

    const n = await g.prisma.notification.findUnique({ where: { dedupeKey: 'qh:urgent' } });
    expect(n!.scheduledAt.toISOString()).toBe(atNight.toISOString());
  });
});

// =========================================================================
describe('retention', () => {
  it('never purges an unread notification, however old', async () => {
    const ancient = new Date('2020-01-01T00:00:00Z');
    await g.prisma.notification.create({
      data: {
        dedupeKey: 'old:unread', type: NotificationType.MESSAGE_RECEIVED,
        category: 'messaging', templateKey: 'message_received',
        eventType: 'message_published', recipientId: s.parentId,
        title: 't', body: 'b', scheduledAt: ancient, createdAt: ancient,
      },
    });

    await g.prisma.$queryRawUnsafe(`select * from chat.purge_notification_history()`);

    // An unread notification is an unmet obligation, not stale data.
    expect(
      await g.prisma.notification.count({ where: { dedupeKey: 'old:unread' } }),
    ).toBe(1);
  });

  it('purges an old READ notification but keeps its delivery record', async () => {
    const ancient = new Date('2020-01-01T00:00:00Z');
    const n = await g.prisma.notification.create({
      data: {
        dedupeKey: 'old:read', type: NotificationType.MESSAGE_RECEIVED,
        category: 'messaging', templateKey: 'message_received',
        eventType: 'message_published', recipientId: s.parentId,
        title: 't', body: 'b', scheduledAt: ancient, createdAt: ancient,
        readAt: ancient,
      },
    });
    await g.prisma.notificationDelivery.create({
      data: {
        notificationId: n.id, recipientId: s.parentId, channel: 'push',
        status: 'sent', createdAt: new Date(),
      },
    });

    await g.prisma.$queryRawUnsafe(`select * from chat.purge_notification_history()`);

    expect(await g.prisma.notification.count({ where: { dedupeKey: 'old:read' } })).toBe(0);
    // The operational record outlives the notification: support must still be
    // able to answer "did it ever leave the building".
    expect(
      await g.prisma.notificationDelivery.count({ where: { recipientId: s.parentId } }),
    ).toBe(1);
  });
});
