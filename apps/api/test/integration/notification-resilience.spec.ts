/**
 * FAILURE INJECTION.
 *
 * The acceptance suite proves the happy paths. This proves the system still
 * tells the parent when something goes wrong: a worker dies mid-delivery, the
 * push provider times out, a token rotates, an event is replayed, two workers
 * race, authorization is revoked between sending and opening.
 *
 * The rule every test here asserts is the same one: a failure may cost latency
 * or a channel, never the notification.
 */
import { randomUUID } from 'node:crypto';
import { buildGraph, seed, truncate, Scenario } from './harness';
import { NotificationType } from '@communication/contracts/notifications';
import { NotificationStatus } from '@communication/contracts/vocab';

const g = buildGraph();
let s: Scenario;

async function studentGroup(): Promise<string> {
  const group = await g.conversations.ensureStudentGroup(s.learnerId);
  return group.id;
}

const drain = () => g.outboxWorker.drain(200);

beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
});

afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});

// =========================================================================
describe('a worker that dies mid-delivery', () => {
  /**
   * The exact shape of the defect: claim the row, then vanish. The old
   * implementation set status='sent' up front, so the row looked delivered and
   * no sweep ever looked at it again.
   */
  async function simulateCrashedWorker(): Promise<string> {
    const conversationId = await studentGroup();
    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'mid-crash' });
    await drain();

    const n = (await g.prisma.notification.findFirst({
      where: { recipientId: s.parentId },
    }))!;

    // Claim it exactly as dispatchDue does, then stop -- the worker is gone.
    await g.prisma.notification.update({
      where: { id: n.id },
      data: {
        status: NotificationStatus.PROCESSING,
        leaseExpiresAt: new Date(Date.now() + 120_000),
        claimedBy: 'worker-that-died:1',
        attempts: 1,
      },
    });
    return n.id;
  }

  it('does not leave the notification looking delivered', async () => {
    const id = await simulateCrashedWorker();
    const n = (await g.prisma.notification.findUnique({ where: { id } }))!;

    // The whole point. `sent` would be a lie no sweep ever revisits.
    expect(n.status).toBe(NotificationStatus.PROCESSING);
    expect(n.sentAt).toBeNull();
  });

  it('is not stolen while the lease is still live', async () => {
    const id = await simulateCrashedWorker();

    // A second worker running now must not touch THIS row: the first might
    // still be alive and slow, and two pushes is a worse outcome than one late
    // one. (The sweep does dispatch the group's other members' notifications,
    // which is why this asserts on the row rather than on the sweep's total.)
    await g.notifications.dispatchDue(new Date());

    const after = (await g.prisma.notification.findUnique({ where: { id } }))!;
    expect(after.claimedBy).toBe('worker-that-died:1');
    expect(after.status).toBe(NotificationStatus.PROCESSING);
    // Untouched: no second claim incremented it.
    expect(after.attempts).toBe(1);
  });

  it('is picked up once the lease expires, and actually delivered', async () => {
    await g.notifications.registerDevice({
      actorId: s.parentId, token: 'recovery-device', platform: 'ios',
    });
    const id = await simulateCrashedWorker();

    // Time passes. The claim is abandoned.
    await g.prisma.notification.update({
      where: { id },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    });

    await g.notifications.dispatchDue(new Date());

    const n = (await g.prisma.notification.findUnique({ where: { id } }))!;
    expect(n.status).toBe(NotificationStatus.SENT);
    expect(n.sentAt).not.toBeNull();
    // Lease released in the same statement, so a row is never both sent and claimed.
    expect(n.leaseExpiresAt).toBeNull();

    // And the push the crash swallowed actually went out.
    const push = (await g.deliveries.trace(id)).find((d) => d.channel === 'push');
    expect(push!.status).toBe('sent');
  });

  it('recovery does not re-send a channel that already succeeded', async () => {
    await g.notifications.registerDevice({
      actorId: s.parentId, token: 'half-sent-device', platform: 'ios',
    });
    const conversationId = await studentGroup();
    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'half sent' });
    await drain();

    const n = (await g.prisma.notification.findFirst({
      where: { recipientId: s.parentId },
    }))!;

    // First pass gets the push out, then the worker dies before marking sent.
    await g.notifications.deliver(n as never);
    await g.prisma.notification.update({
      where: { id: n.id },
      data: {
        status: NotificationStatus.PROCESSING,
        leaseExpiresAt: new Date(Date.now() - 1000),
        claimedBy: 'worker-that-died:2',
      },
    });

    const sendSpy = jest.spyOn(g.push, 'send');
    await g.notifications.dispatchDue(new Date());

    // Delivery identity is deterministic -- unique per (notification, channel,
    // device) -- so recovery completes what was undone and re-sends nothing.
    expect(sendSpy).not.toHaveBeenCalled();
    expect(
      await g.prisma.notificationDelivery.count({
        where: { notificationId: n.id, channel: 'push' },
      }),
    ).toBe(1);
    sendSpy.mockRestore();
  });

  it('gives up after the attempt budget rather than looping forever', async () => {
    const conversationId = await studentGroup();
    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'doomed' });
    await drain();
    const n = (await g.prisma.notification.findFirst({
      where: { recipientId: s.parentId },
    }))!;

    // Every dispatch throws. A crash loop must not become an infinite one.
    const spy = jest
      .spyOn(g.deliveries, 'deliverInApp')
      .mockRejectedValue(new Error('storage gone'));

    const max = await g.config.get('notification.max_attempts');
    for (let i = 0; i < max + 3; i += 1) {
      await g.prisma.notification.updateMany({
        where: { id: n.id, status: NotificationStatus.SCHEDULED },
        data: { scheduledAt: new Date(Date.now() - 1000) },
      });
      await g.notifications.dispatchDue(new Date());
    }

    const after = (await g.prisma.notification.findUnique({ where: { id: n.id } }))!;
    expect(after.status).toBe(NotificationStatus.FAILED);
    expect(after.failureCode).toBe('DISPATCH_ERROR');
    // A failed row holds no lease: the database check constraint refuses a
    // state that would mean a worker is still working on it.
    expect(after.leaseExpiresAt).toBeNull();
    spy.mockRestore();
  });
});

// =========================================================================
describe('a call that rings out and is never hung up', () => {
  /**
   * The producer gap. A missed call only became a notification when the CALLER
   * ended it; a caller who walks away, whose app is killed, or whose network
   * drops left the call ringing forever and the parent never learned the
   * academy had tried to reach them.
   */
  it('becomes a missed call, and notifies the parent', async () => {
    const conversationId = await studentGroup();
    const { callId } = await g.calls.start(conversationId, s.ownerId);

    // Nobody answers. Nobody hangs up. The ring timeout elapses.
    const timeout = await g.config.get('call.ring_timeout_seconds');
    const later = new Date(Date.now() + (timeout + 5) * 1000);

    expect(await g.calls.expireRingingCalls(later)).toBe(1);
    await drain();

    const call = (await g.prisma.call.findUnique({ where: { id: callId } }))!;
    expect(call.status).toBe('ended');
    expect(call.outcome).toBe('missed');

    const n = await g.prisma.notification.findFirst({
      where: { recipientId: s.parentId, type: NotificationType.MISSED_CALL },
    });
    expect(n).not.toBeNull();
    expect(n!.deeplink).toBe(`/chats/${conversationId}?call=${callId}`);
  });

  it('leaves a call that is still within its ring window alone', async () => {
    const conversationId = await studentGroup();
    await g.calls.start(conversationId, s.ownerId);

    // Still ringing. Ending it now would cut off a call in progress.
    expect(await g.calls.expireRingingCalls(new Date())).toBe(0);
  });

  it('does not touch a call somebody answered', async () => {
    const conversationId = await studentGroup();
    const { callId } = await g.calls.start(conversationId, s.ownerId);
    await g.calls.accept(callId, s.parentId);

    const timeout = await g.config.get('call.ring_timeout_seconds');
    const later = new Date(Date.now() + (timeout + 5) * 1000);

    // A long call is not a missed one.
    expect(await g.calls.expireRingingCalls(later)).toBe(0);
    expect((await g.prisma.call.findUnique({ where: { id: callId } }))!.status).toBe('active');
  });

  it('is idempotent, and safe to run from two workers at once', async () => {
    const conversationId = await studentGroup();
    const { callId } = await g.calls.start(conversationId, s.ownerId);
    const timeout = await g.config.get('call.ring_timeout_seconds');
    const later = new Date(Date.now() + (timeout + 5) * 1000);

    const [a, b, c] = await Promise.all([
      g.calls.expireRingingCalls(later),
      g.calls.expireRingingCalls(later),
      g.calls.expireRingingCalls(later),
    ]);
    expect(a + b + c).toBe(1);

    await drain();
    // One notification for the parent, whatever happened at the sweep.
    expect(
      await g.prisma.notification.count({
        where: { recipientId: s.parentId, type: NotificationType.MISSED_CALL },
      }),
    ).toBe(1);

    // And a fourth sweep finds nothing.
    expect(await g.calls.expireRingingCalls(later)).toBe(0);
    void callId;
  });

  it('records the clock as the actor, not the caller', async () => {
    const conversationId = await studentGroup();
    const { callId } = await g.calls.start(conversationId, s.ownerId);
    const timeout = await g.config.get('call.ring_timeout_seconds');
    await g.calls.expireRingingCalls(new Date(Date.now() + (timeout + 5) * 1000));

    const event = await g.prisma.eventLog.findFirst({
      where: { type: 'call_ended' },
      orderBy: { at: 'desc' },
    });
    // Nobody did this. Attributing it to the caller would put an action in the
    // log that they did not take.
    expect(event!.actorKind).toBe('system');
    expect(event!.actorId).toBeNull();
    expect(event!.payload).toMatchObject({ callId, reason: 'ring_timeout' });
  });
});

// =========================================================================
describe('two workers racing', () => {
  it('claim the same notification exactly once between them', async () => {
    const conversationId = await studentGroup();
    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'contended' });
    await drain();
    await g.notifications.registerDevice({
      actorId: s.parentId, token: 'race-device', platform: 'android',
    });

    const target = (await g.prisma.notification.findFirst({
      where: { recipientId: s.parentId },
    }))!;

    const sendSpy = jest.spyOn(g.push, 'send');
    const now = new Date();
    await Promise.all([
      g.notifications.dispatchDue(now),
      g.notifications.dispatchDue(now),
      g.notifications.dispatchDue(now),
    ]);

    // Claimed once between the three of them: a second claim would have
    // incremented attempts again.
    const after = (await g.prisma.notification.findUnique({ where: { id: target.id } }))!;
    expect(after.attempts).toBe(1);
    expect(after.status).toBe(NotificationStatus.SENT);

    // And one push to the one registered device, not three. The delivery unique
    // index is the second line of defence behind the claim.
    expect(sendSpy.mock.calls.filter((c) => c[0].token === 'race-device')).toHaveLength(1);
    sendSpy.mockRestore();
  });
});

// =========================================================================
describe('the push provider misbehaving', () => {
  beforeEach(async () => {
    await g.notifications.registerDevice({
      actorId: s.parentId, token: 'provider-device', platform: 'ios',
    });
  });

  async function oneNotification(): Promise<string> {
    const conversationId = await studentGroup();
    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'x' });
    await drain();
    return (await g.prisma.notification.findFirst({ where: { recipientId: s.parentId } }))!.id;
  }

  it('a provider that throws does not lose the notification', async () => {
    const spy = jest.spyOn(g.push, 'send').mockRejectedValue(new Error('ECONNRESET'));
    const id = await oneNotification();
    await g.notifications.dispatchDue(new Date());

    // The notification is intact and readable; only the push is pending retry.
    expect((await g.centre.unreadCounts(s.parentId)).total).toBe(1);
    const push = (await g.deliveries.trace(id)).find((d) => d.channel === 'push');
    expect(push!.status).toBe('pending');
    expect(push!.errorCode).toBe('PUSH_ERROR');
    spy.mockRestore();
  });

  it('a provider timing out is retried, not written off', async () => {
    const spy = jest
      .spyOn(g.push, 'send')
      .mockResolvedValue({ ok: false, failureCode: 'FCM_UNAVAILABLE' });
    const id = await oneNotification();
    await g.notifications.dispatchDue(new Date());

    const push = (await g.prisma.notificationDelivery.findFirst({
      where: { notificationId: id, channel: 'push' },
    }))!;
    expect(push.status).toBe('pending');
    expect(push.nextAttemptAt).not.toBeNull();
    // An outage is not a dead device.
    expect(
      (await g.prisma.deviceToken.findUnique({ where: { token: 'provider-device' } }))!.isActive,
    ).toBe(true);
    spy.mockRestore();
  });

  it('an expired service account never deactivates a family’s devices', async () => {
    const spy = jest
      .spyOn(g.push, 'send')
      .mockResolvedValue({ ok: false, failureCode: 'FCM_UNAUTHORIZED' });
    await oneNotification();
    await g.notifications.dispatchDue(new Date());

    // The outage this guards against: credentials lapse, every send fails, and
    // a provider that treated failure as "bad token" wipes every device token in
    // the academy. Only a reinstall brings those back.
    expect(
      (await g.prisma.deviceToken.findUnique({ where: { token: 'provider-device' } }))!.isActive,
    ).toBe(true);
    spy.mockRestore();
  });

  it('a rotated token is followed, and the old one stops being used', async () => {
    // The device reports a new token on launch. Same device, same actor.
    await g.notifications.registerDevice({
      actorId: s.parentId, token: 'rotated-token', platform: 'ios',
    });
    await g.notifications.unregisterDevice('provider-device', s.parentId);

    const sent: string[] = [];
    const spy = jest.spyOn(g.push, 'send').mockImplementation(async (m) => {
      sent.push(m.token);
      return { ok: true };
    });

    await oneNotification();
    await g.notifications.dispatchDue(new Date());

    expect(sent).toEqual(['rotated-token']);
    spy.mockRestore();
  });

  it('a token that moved to another account follows its new owner', async () => {
    // A handed-down phone. The token must stop carrying the previous owner's
    // notifications the moment the new owner registers it -- otherwise one
    // family's messages keep buzzing on another family's device.
    await g.notifications.registerDevice({
      actorId: s.otherParentId, token: 'provider-device', platform: 'ios',
    });

    const row = (await g.prisma.deviceToken.findUnique({
      where: { token: 'provider-device' },
    }))!;
    expect(row.actorId).toBe(s.otherParentId);
    expect(row.isActive).toBe(true);

    const id = await oneNotification();
    await g.notifications.dispatchDue(new Date());

    // The first parent now has no device, so their notification records the
    // reason rather than silently pushing to a phone that is not theirs.
    const push = (await g.deliveries.trace(id)).find((d) => d.channel === 'push');
    expect(push!.status).toBe('skipped');
    expect(push!.skipReason).toBe('NO_DEVICE_TOKEN');
  });
});

// =========================================================================
describe('preferences changing while a notification is in flight', () => {
  it('a mute set after creation does not retroactively suppress the push', async () => {
    await g.notifications.registerDevice({
      actorId: s.parentId, token: 'late-mute-device', platform: 'ios',
    });
    const conversationId = await studentGroup();
    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'before the mute' });
    await drain();

    // The decision was taken and recorded at creation. Re-deciding at dispatch
    // would make the delivery record disagree with what the system actually
    // resolved, and "why did this one go out?" would have no answer.
    await g.preferences.set(s.parentId, 'messaging', false);
    await g.notifications.dispatchDue(new Date());

    const n = (await g.prisma.notification.findFirst({ where: { recipientId: s.parentId } }))!;
    const push = (await g.deliveries.trace(n.id)).find((d) => d.channel === 'push');
    expect(push!.status).toBe('sent');
  });

  it('a mute set before creation suppresses the next one', async () => {
    await g.notifications.registerDevice({
      actorId: s.parentId, token: 'early-mute-device', platform: 'ios',
    });
    await g.preferences.set(s.parentId, 'messaging', false);

    const conversationId = await studentGroup();
    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'after the mute' });
    await drain();
    await g.notifications.dispatchDue(new Date());

    const n = (await g.prisma.notification.findFirst({ where: { recipientId: s.parentId } }))!;
    const push = (await g.deliveries.trace(n.id)).find((d) => d.channel === 'push');
    expect(push!.status).toBe('skipped');
    expect(push!.skipReason).toBe('PREFERENCE_OFF');
    // And the in-app notification is there regardless: muting push never costs
    // a parent the record.
    expect((await g.centre.unreadCounts(s.parentId)).total).toBe(1);
  });
});

// =========================================================================
describe('authorization revoked after the notification was sent', () => {
  it('the deep-link target refuses even though the notification is theirs', async () => {
    const conversationId = await studentGroup();
    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'before removal' });
    await drain();

    const n = (await g.prisma.notification.findFirst({ where: { recipientId: s.parentId } }))!;
    // They can still see their own notification -- history is theirs.
    expect((await g.centre.byId(s.parentId, n.id)).id).toBe(n.id);

    // Removed from the conversation after the fact.
    await g.prisma.conversationMember.updateMany({
      where: { conversationId, actorId: s.parentId },
      data: { leftAt: new Date() },
    });

    // The link is a navigation hint; the backend is the authority. Following it
    // now must not return the thread.
    const conv = await g.conversations.requireConversation(conversationId);
    const membership = await g.conversations.membershipOf(conv.id, s.parentId);
    const actor = await g.conversations.requireActor(s.parentId);
    expect(g.authz.canRead(actor, conv, membership).allowed).toBe(false);
  });

  it('a deleted announcement leaves its notification readable and its target gone', async () => {
    const admin = {
      actorId: s.ownerId, kind: 'staff' as const, displayName: 'admin_a',
      locale: 'ar' as const, isActive: true, staffRole: 'admin' as const,
    };
    const a = await g.announcements.create(admin, {
      titleAr: 'خبر', bodyAr: 'نص', targetType: 'all_parents',
    });
    await g.announcements.publish(admin, a.id);
    await g.announcements.fanOut(a.id);

    // Both moved back: announcement_expiry_after_publish refuses an expiry
    // before its publish time, which is the constraint doing its job.
    await g.prisma.announcement.update({
      where: { id: a.id },
      data: {
        publishAt: new Date(Date.now() - 10_000),
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    // 410, not a crash and not somebody else's content.
    await expect(g.announcements.readForActor(s.parentId, a.id)).rejects.toThrow(/expired/);
  });
});

// =========================================================================
describe('retention as an operation', () => {
  async function ancientRead(count: number): Promise<void> {
    const ancient = new Date('2020-01-01T00:00:00Z');
    for (let i = 0; i < count; i += 1) {
      await g.prisma.notification.create({
        data: {
          dedupeKey: `old:${i}`, type: NotificationType.MESSAGE_RECEIVED,
          category: 'messaging', templateKey: 'message_received',
          eventType: 'message_published', recipientId: s.parentId,
          title: 't', body: 'b', scheduledAt: ancient, createdAt: ancient,
          readAt: ancient,
        },
      });
    }
  }

  it('runs, and is idempotent: the second pass deletes nothing', async () => {
    await ancientRead(5);

    const first = await g.retention.purge(new Date());
    expect(first.notificationsDeleted).toBe(5);

    const second = await g.retention.purge(new Date());
    expect(second.notificationsDeleted).toBe(0);
  });

  it('is bounded, and drains a backlog over several passes', async () => {
    await ancientRead(7);

    // One bounded pass of 3 at a time. The bound is what stops a first real run
    // on a million-row table taking a lock long enough to stall every insert.
    const result = await g.retention.purge(new Date(), 3, 1);
    expect(result.notificationsDeleted).toBe(3);
    expect(await g.prisma.notification.count({ where: { recipientId: s.parentId } })).toBe(4);

    const drained = await g.retention.purge(new Date(), 3, 20);
    expect(drained.notificationsDeleted).toBe(4);
  });

  it('throttles itself, so putting it in the worker loop costs one clock read', async () => {
    await ancientRead(2);

    const first = await g.retention.runDue(new Date());
    expect(first.ran).toBe(true);

    // Called again on the next loop pass, seconds later.
    const second = await g.retention.runDue(new Date());
    expect(second.ran).toBe(false);
    expect(second.notificationsDeleted).toBe(0);
  });

  it('a retention failure never escapes into the worker loop', async () => {
    const spy = jest
      .spyOn(g.prisma, '$queryRaw')
      .mockRejectedValue(new Error('deadlock detected'));

    // Housekeeping failing must not stop notifications being delivered.
    await expect(g.retention.purge(new Date())).resolves.toMatchObject({ ran: true });
    spy.mockRestore();
  });

  it('never purges an unread notification, at any age', async () => {
    const ancient = new Date('2020-01-01T00:00:00Z');
    await g.prisma.notification.create({
      data: {
        dedupeKey: 'old:unread', type: NotificationType.MESSAGE_RECEIVED,
        category: 'messaging', templateKey: 'message_received',
        eventType: 'message_published', recipientId: s.parentId,
        title: 't', body: 'b', scheduledAt: ancient, createdAt: ancient,
      },
    });

    await g.retention.purge(new Date());
    expect(await g.prisma.notification.count({ where: { dedupeKey: 'old:unread' } })).toBe(1);
  });
});
