/**
 * WHAT A PREFERENCE ACTUALLY MEANS.
 *
 * A mute is the most consequential control in the app: it is the one a parent
 * reaches for when the academy is being noisy, and the one that must NOT be
 * able to silence "your child's class was cancelled". Every edge of it is here
 * -- what it suppresses, what it cannot suppress, what it does to history, when
 * it takes effect, and what happens when it changes while a notification is
 * already queued.
 *
 * Requires the migrated database (DATABASE_URL).
 */
import { buildGraph, seed, truncate, Scenario } from './harness';
import { NotificationType } from '@communication/contracts/notifications';
import { NotificationStatus } from '@communication/contracts/vocab';

const g = buildGraph();
let s: Scenario;

const drain = () => g.outboxWorker.drain(200);

async function studentGroup(): Promise<string> {
  return (await g.conversations.ensureStudentGroup(s.learnerId)).id;
}

async function pushRowFor(notificationId: string) {
  return g.prisma.notificationDelivery.findFirst({
    where: { notificationId, channel: 'push' },
  });
}

/** One ordinary message notification, delivered. */
async function messageNotification(body = 'hello') {
  const conversationId = await studentGroup();
  await g.messages.send({ conversationId, senderId: s.ownerId, body });
  await drain();
  const n = (await g.prisma.notification.findFirst({
    where: { recipientId: s.parentId, type: NotificationType.MESSAGE_RECEIVED },
    orderBy: { createdAt: 'desc' },
  }))!;
  return n;
}

beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  await g.notifications.registerDevice({
    actorId: s.parentId,
    token: 'preference-device',
    platform: 'android',
  });
});

afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});

// =========================================================================
describe('a mute silences the phone and nothing else', () => {
  it('the notification still exists, and still counts', async () => {
    await g.preferences.set(s.parentId, 'messaging', false);
    const n = await messageNotification();
    await g.notifications.dispatchDue(new Date());

    // This is the line the whole design turns on. A preference is about the
    // PHONE BUZZING, not about whether the parent is told. Erasing history
    // because somebody muted a category would mean the mute quietly deletes
    // things they never saw.
    expect(n.id).toBeDefined();
    expect((await g.centre.unreadCounts(s.parentId)).total).toBe(1);
    expect((await g.centre.list(s.parentId)).items.map((i) => i.id)).toContain(n.id);
  });

  it('the push is recorded as skipped, with the reason, not simply absent', async () => {
    await g.preferences.set(s.parentId, 'messaging', false);
    const n = await messageNotification();
    await g.notifications.dispatchDue(new Date());

    const push = await pushRowFor(n.id);
    // "Why did my phone not buzz?" has to have an answer, and PREFERENCE_OFF is
    // a different answer from NO_DEVICE_TOKEN or RECIPIENT_ACTIVE.
    expect(push!.status).toBe('skipped');
    expect(push!.skipReason).toBe('PREFERENCE_OFF');
  });

  it('the in-app channel is untouched', async () => {
    await g.preferences.set(s.parentId, 'messaging', false);
    const n = await messageNotification();
    await g.notifications.dispatchDue(new Date());

    const inApp = (await g.deliveries.trace(n.id)).find((d) => d.channel === 'in_app');
    expect(inApp!.status).toBe('sent');
    // And the notification reached a terminal state, rather than being stuck
    // because its only channel was muted.
    expect(
      (await g.prisma.notification.findUnique({ where: { id: n.id } }))!.status,
    ).toBe(NotificationStatus.SENT);
  });

  it('every other category keeps pushing', async () => {
    await g.preferences.set(s.parentId, 'messaging', false);

    // A call is not a message. Muting one category must not be a quiet way of
    // muting the app.
    const conversationId = await studentGroup();
    const { callId } = await g.calls.start(conversationId, s.ownerId);
    await g.calls.end(callId, s.ownerId, 'missed');
    await drain();
    await g.notifications.dispatchDue(new Date());

    const missed = (await g.prisma.notification.findFirst({
      where: { recipientId: s.parentId, type: NotificationType.MISSED_CALL },
    }))!;
    expect((await pushRowFor(missed.id))!.status).toBe('sent');
  });
});

// =========================================================================
describe('what a mute cannot do', () => {
  it('a non-optional category is refused, with an error a client can render', async () => {
    // `approvals` and `account` are the two rows with is_optional = false. A
    // parent may silence class reminders -- that is a volume choice -- but not
    // the decision on a message a teacher wrote about their child.
    await expect(g.preferences.set(s.parentId, 'approvals', false)).rejects.toThrow(
      /essential and cannot be muted/,
    );
  });

  it('the database refuses it too, so an API bypass changes nothing', async () => {
    // The service check produces the message; the trigger is the backstop. A
    // client that found another way in still cannot silence an approval.
    await expect(
      g.prisma.notificationPreference.create({
        data: { actorId: s.parentId, category: 'approvals', pushEnabled: false },
      }),
    ).rejects.toBeDefined();
  });

  it('an essential TYPE pushes even inside a muted category',
    async () => {
      // Every category a parent is allowed to mute, including `classes`.
      for (const category of ['messaging', 'calls', 'classes', 'academy', 'billing']) {
        await g.preferences.set(s.parentId, category, false);
      }

      await g.prisma.learner.update({
        where: { id: s.learnerId },
        data: { nextClassAt: new Date('2026-09-29T14:00:00Z') },
      });
      await g.classSchedule.reschedule(
        {
          actorId: s.ownerId, kind: 'staff', displayName: 'admin_a',
          locale: 'ar', isActive: true, staffRole: 'admin',
        },
        { learnerId: s.learnerId, nextClassAt: null, reason: 'teacher is unwell' },
      );
      await g.notifications.dispatchDue(new Date());

      const cancelled = (await g.prisma.notification.findFirst({
        where: { recipientId: s.parentId, type: NotificationType.CLASS_CANCELLED },
      }))!;
      expect(cancelled.isEssential).toBe(true);
      expect((await pushRowFor(cancelled.id))!.status).toBe('sent');
    });

  it('a category nobody has heard of is refused rather than stored', async () => {
    await expect(
      g.preferences.set(s.parentId, 'marketing', false),
    ).rejects.toThrow(/unknown notification category/);
  });

  it('one parent’s mute is not the other parent’s', async () => {
    await g.preferences.set(s.parentId, 'messaging', false);
    const conversationId = await studentGroup();
    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'both parents' });
    await drain();
    await g.notifications.dispatchDue(new Date());

    const theirs = (await g.prisma.notification.findFirst({
      where: { recipientId: s.otherParentId },
    }))!;
    // They registered no device, so the honest record is NO_DEVICE_TOKEN --
    // what matters is that it is not PREFERENCE_OFF, which would mean one
    // parent's setting reached across the family.
    expect((await pushRowFor(theirs.id))!.skipReason).not.toBe('PREFERENCE_OFF');
  });
});

// =========================================================================
describe('when a change takes effect', () => {
  it('a mute applies to the next notification, not the last one', async () => {
    const before = await messageNotification('before the mute');
    await g.notifications.dispatchDue(new Date());
    expect((await pushRowFor(before.id))!.status).toBe('sent');

    await g.preferences.set(s.parentId, 'messaging', false);
    // The first notification is cleared first, so the second is not merely
    // GROUPED behind it. Grouping and muting are different reasons, and this
    // test is about the mute.
    await g.prisma.notification.deleteMany({ where: { recipientId: s.parentId } });
    const conversationId = await studentGroup();
    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'after' });
    await drain();
    await g.notifications.dispatchDue(new Date());

    const after = (await g.prisma.notification.findFirst({
      where: { recipientId: s.parentId },
    }))!;
    expect((await pushRowFor(after.id))!.skipReason).toBe('PREFERENCE_OFF');
  });

  it('unmuting applies to the next one too', async () => {
    await g.preferences.set(s.parentId, 'messaging', false);
    const muted = await messageNotification('while muted');
    await g.notifications.dispatchDue(new Date());
    expect((await pushRowFor(muted.id))!.skipReason).toBe('PREFERENCE_OFF');

    await g.preferences.set(s.parentId, 'messaging', true);
    await g.prisma.notification.deleteMany({ where: { recipientId: s.parentId } });
    const conversationId = await studentGroup();
    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'unmuted' });
    await drain();
    await g.notifications.dispatchDue(new Date());

    const unmuted = (await g.prisma.notification.findFirst({
      where: { recipientId: s.parentId },
    }))!;
    expect((await pushRowFor(unmuted.id))!.status).toBe('sent');
  });

  it('setting the same value twice changes nothing', async () => {
    await g.preferences.set(s.parentId, 'messaging', false);
    await g.preferences.set(s.parentId, 'messaging', false);

    expect(
      await g.prisma.notificationPreference.count({
        where: { actorId: s.parentId, category: 'messaging' },
      }),
    ).toBe(1);
  });

  it('a fresh parent is opted IN: absence of a row is not absence of consent',
    async () => {
      const n = await messageNotification();
      await g.notifications.dispatchDue(new Date());

      expect(
        await g.prisma.notificationPreference.count({ where: { actorId: s.parentId } }),
      ).toBe(0);
      expect((await pushRowFor(n.id))!.status).toBe('sent');
    });
});

// =========================================================================
/**
 * THE QUEUED CASE.
 *
 * A class reminder is written now and fires in 24 hours. Between those two
 * moments the parent can change their mind -- and "I muted this yesterday"
 * cannot be answered with "yes, but we had already decided to buzz you".
 *
 * So the rule is: THE PREFERENCE AT THE MOMENT OF DELIVERY DECIDES. For an
 * immediate notification the two moments are the same and nothing changes; for
 * a scheduled one, the later moment wins.
 */
describe('a preference changed while a notification is queued', () => {
  /** A notification that exists now and is not dispatchable until we say so. */
  async function queued(category: 'messaging' | 'academy'): Promise<string> {
    const type =
      category === 'messaging'
        ? NotificationType.MESSAGE_RECEIVED
        : NotificationType.ACADEMY_ANNOUNCEMENT;

    const { notificationId } = await g.notifications.schedule({
      dedupeKey: `queued:${category}`,
      type,
      eventType: 'queued_test',
      recipientId: s.parentId,
      scheduledAt: new Date(Date.now() + 60 * 60_000),
    });
    return notificationId;
  }

  /** Time passes; the notification comes due. */
  async function fire(notificationId: string): Promise<void> {
    await g.prisma.notification.update({
      where: { id: notificationId },
      data: { scheduledAt: new Date(Date.now() - 1000) },
    });
    await g.notifications.dispatchDue(new Date());
  }

  it('muting after it was queued still silences it', async () => {
    const id = await queued('messaging');
    expect(await pushRowFor(id)).toBeNull();

    await g.preferences.set(s.parentId, 'messaging', false);
    await fire(id);

    // The parent muted it before it ever buzzed. It must not buzz.
    const push = await pushRowFor(id);
    expect(push!.status).toBe('skipped');
    expect(push!.skipReason).toBe('PREFERENCE_OFF');
  });

  it('unmuting after it was queued lets it through', async () => {
    await g.preferences.set(s.parentId, 'messaging', false);
    const id = await queued('messaging');
    // NOTHING is decided at creation, in either direction: a queued
    // notification carries no push verdict at all until it is due.
    expect(await pushRowFor(id)).toBeNull();

    await g.preferences.set(s.parentId, 'messaging', true);
    await fire(id);

    // They turned it back on before it fired, so it fires.
    const push = await pushRowFor(id);
    expect(push!.status).toBe('sent');
    expect(push!.skipReason).toBeNull();
  });

  it('a queued notification the parent never touched behaves as before', async () => {
    const id = await queued('academy');
    await fire(id);

    expect((await pushRowFor(id))!.status).toBe('sent');
  });

  it('re-evaluation does not resurrect a skip that is not about preferences',
    async () => {
      const conversationId = await studentGroup();
      const presence = jest
        .spyOn(g.presence, 'isViewing')
        .mockResolvedValue(true as never);
      await g.messages.send({ conversationId, senderId: s.ownerId, body: 'watching' });
      await drain();
      presence.mockRestore();

      const n = (await g.prisma.notification.findFirst({
        where: { recipientId: s.parentId },
      }))!;
      expect((await pushRowFor(n.id))!.skipReason).toBe('RECIPIENT_ACTIVE');

      await g.notifications.dispatchDue(new Date());

      // RECIPIENT_ACTIVE describes the MOMENT THE MESSAGE ARRIVED -- the parent
      // was looking at the thread -- and that moment does not change later.
      // Only the preference is re-read at delivery, because only the preference
      // is a standing instruction rather than a fact about an instant.
      const push = await pushRowFor(n.id);
      expect(push!.status).toBe('skipped');
      expect(push!.skipReason).toBe('RECIPIENT_ACTIVE');
    });
});
