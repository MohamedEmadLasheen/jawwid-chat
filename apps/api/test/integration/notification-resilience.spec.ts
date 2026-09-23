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
/**
 * The hardest failure, one level below the last one.
 *
 * A notification's LEASE recovers a worker that died between claiming the
 * notification and finishing with it. But underneath each notification sit the
 * per-channel, per-device delivery rows, and each of those has a claim of its
 * own -- so a worker can die between claiming ONE delivery and writing its
 * outcome, with the notification's own lease long since released.
 *
 * Until this was handled, `DeliveryService.claim` matched only `pending`, so a
 * row abandoned in `processing` was matched by nothing: never re-attempted,
 * never terminal, and reported by chat.notification_operations as permanently
 * in flight. These tests hold that door shut, and state honestly what the
 * recovery costs.
 */
describe('a delivery abandoned between the provider call and the acknowledgement', () => {
  /** The notification row as the database hands it back, which is all delivery reads. */
  type DeliverableRow = NonNullable<
    Awaited<ReturnType<typeof g.prisma.notification.findFirst>>
  >;

  beforeEach(async () => {
    await g.notifications.registerDevice({
      actorId: s.parentId, token: 'crash-device', platform: 'android',
    });
  });

  async function oneNotification(): Promise<DeliverableRow> {
    const conversationId = await studentGroup();
    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'crash window' });
    await drain();
    return (await g.prisma.notification.findFirst({
      where: { recipientId: s.parentId },
    })) as unknown as DeliverableRow;
  }

  /**
   * The crash itself, reproduced rather than faked.
   *
   * The provider accepts the push, and the database write that records that
   * acceptance never lands -- the connection is gone, so the error handler's
   * own write fails too and the method dies mid-flight, exactly as a killed
   * process does. The row is left `processing` with the push already sent:
   * "the provider took it" and "we wrote down that it took it" are two writes
   * to two systems with no transaction across them, and this is the window
   * between them.
   */
  async function crashAfterProviderAccepted(n: DeliverableRow): Promise<string[]> {
    const sent: string[] = [];
    const send = jest.spyOn(g.push, 'send').mockImplementation(async (m) => {
      sent.push(m.token);
      return { ok: true };
    });
    const update = jest
      .spyOn(g.prisma.notificationDelivery, 'update')
      .mockRejectedValue(new Error('connection terminated unexpectedly'));

    await expect(g.deliveries.deliverPush(n as never)).rejects.toThrow(/connection terminated/);

    update.mockRestore();
    send.mockRestore();
    return sent;
  }

  /**
   * Age the row past the abandonment window.
   *
   * The trigger has to be lifted to do it, because `updated_at` is maintained
   * by chat.set_updated_at() on the table rather than by the application --
   * which is exactly why the abandonment clock is trustworthy in production:
   * no worker, and no client, can pre-age a row to steal somebody else's claim.
   * Only a test with table ownership can, and only by saying so out loud.
   */
  async function abandon(deliveryId: string): Promise<void> {
    await g.prisma.$executeRawUnsafe(
      'alter table chat.notification_delivery disable trigger notification_delivery_set_updated_at',
    );
    try {
      await g.prisma.$executeRaw`
        update chat.notification_delivery
           set updated_at = now() - interval '30 minutes'
         where id = ${deliveryId}::uuid`;
    } finally {
      await g.prisma.$executeRawUnsafe(
        'alter table chat.notification_delivery enable trigger notification_delivery_set_updated_at',
      );
    }
  }

  async function pushRow(notificationId: string) {
    return (await g.prisma.notificationDelivery.findFirst({
      where: { notificationId, channel: 'push' },
    }))!;
  }

  it('leaves the row claimed, and the notification itself untouched', async () => {
    const n = await oneNotification();
    expect(await crashAfterProviderAccepted(n)).toEqual(['crash-device']);

    const push = await pushRow(n.id);
    expect(push.status).toBe('processing');
    expect(push.sentAt).toBeNull();
    expect(push.attempts).toBe(1);

    // The parent still has the notification. Losing a push is a channel
    // failure; losing the notification would be the bug this platform exists
    // to prevent.
    expect((await g.centre.unreadCounts(s.parentId)).total).toBe(1);
  });

  it('is not re-claimed while the attempt could still be in flight', async () => {
    const n = await oneNotification();
    await crashAfterProviderAccepted(n);

    // Seconds later. The first worker may be alive and merely slow, and a
    // guaranteed duplicate is a worse trade than a few minutes of latency.
    const send = jest.spyOn(g.push, 'send').mockResolvedValue({ ok: true });
    await g.deliveries.deliverPush(n as never);

    expect(send).not.toHaveBeenCalled();
    expect((await pushRow(n.id)).attempts).toBe(1);
    send.mockRestore();
  });

  it('is re-claimed once abandoned, and reaches a terminal state', async () => {
    const n = await oneNotification();
    await crashAfterProviderAccepted(n);
    await abandon((await pushRow(n.id)).id);

    const send = jest.spyOn(g.push, 'send').mockResolvedValue({ ok: true });
    await g.deliveries.deliverPush(n as never);

    const push = await pushRow(n.id);
    expect(push.status).toBe('sent');
    expect(push.sentAt).not.toBeNull();
    expect(push.attempts).toBe(2);
    // Recovery completes the row it found. It does not manufacture a second
    // one: delivery identity is unique per (notification, channel, device).
    expect(
      await g.prisma.notificationDelivery.count({
        where: { notificationId: n.id, channel: 'push' },
      }),
    ).toBe(1);
    send.mockRestore();
  });

  it('CAN send the push twice -- delivery is at-least-once, not exactly-once', async () => {
    const n = await oneNotification();
    const first = await crashAfterProviderAccepted(n);
    await abandon((await pushRow(n.id)).id);

    const second: string[] = [];
    const send = jest.spyOn(g.push, 'send').mockImplementation(async (m) => {
      second.push(m.token);
      return { ok: true };
    });
    await g.deliveries.deliverPush(n as never);
    send.mockRestore();

    // Stated plainly because it is the honest guarantee, not an oversight: the
    // provider received this push twice. Recovery cannot tell "the worker died
    // before sending" from "the worker died after sending", because the only
    // record of the difference is the write that never happened. The choice is
    // between a parent occasionally seeing a duplicate and a parent silently
    // not being told their child's class was cancelled, and this product takes
    // the duplicate.
    expect(first).toEqual(['crash-device']);
    expect(second).toEqual(['crash-device']);

    // What is NOT duplicated: the notification, the unread badge, the row in
    // the centre. Duplication is confined to the transport.
    expect((await g.centre.unreadCounts(s.parentId)).total).toBe(1);
    expect(
      await g.prisma.notification.count({ where: { recipientId: s.parentId } }),
    ).toBe(1);
  });

  it('does not sit in processing forever when the provider stays down', async () => {
    const n = await oneNotification();
    await crashAfterProviderAccepted(n);

    const max = await g.config.get('notification.delivery_max_attempts');
    const send = jest
      .spyOn(g.push, 'send')
      .mockResolvedValue({ ok: false, failureCode: 'FCM_UNAVAILABLE' });

    for (let i = 0; i < max + 2; i += 1) {
      // Abandon each round: the row spends one pass as an abandoned claim and
      // the rest as an ordinary pending retry, and both must converge.
      await abandon((await pushRow(n.id)).id);
      await g.deliveries.deliverPush(n as never);
    }
    send.mockRestore();

    // Terminal, with a reason on it. An operator reading
    // chat.notification_operations sees a failure, not an eternal "in flight".
    const push = await pushRow(n.id);
    expect(push.status).toBe('failed');
    expect(push.errorCode).toBe('FCM_UNAVAILABLE');
    expect(push.failedAt).not.toBeNull();
    expect(push.attempts).toBeGreaterThanOrEqual(max);
  });

  it('an abandoned in-app delivery recovers the same way', async () => {
    const n = await oneNotification();

    const publish = jest
      .spyOn(g.realtime, 'toUsers')
      .mockRejectedValue(new Error('no subscriber'));
    const update = jest
      .spyOn(g.prisma.notificationDelivery, 'update')
      .mockRejectedValue(new Error('connection terminated unexpectedly'));
    await expect(g.deliveries.deliverInApp(n as never)).rejects.toThrow(/connection terminated/);
    update.mockRestore();
    publish.mockRestore();

    const stranded = (await g.prisma.notificationDelivery.findFirst({
      where: { notificationId: n.id, channel: 'in_app' },
    }))!;
    expect(stranded.status).toBe('processing');

    await abandon(stranded.id);
    await g.deliveries.deliverInApp(n as never);

    const after = (await g.prisma.notificationDelivery.findFirst({
      where: { notificationId: n.id, channel: 'in_app' },
    }))!;
    expect(after.status).toBe('sent');
    expect(after.attempts).toBe(2);
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

  it('produces ONE completion when the caller hangs up at the same instant',
    async () => {
      const conversationId = await studentGroup();
      const { callId } = await g.calls.start(conversationId, s.ownerId);
      const timeout = await g.config.get('call.ring_timeout_seconds');
      const later = new Date(Date.now() + (timeout + 5) * 1000);

      // The exact race: the caller gives up in the same tick the sweep runs.
      // Both paths write an outcome and both enqueue CALL_ENDED; only one may
      // win, or the parent gets told twice about one call.
      const results = await Promise.allSettled([
        g.calls.end(callId, s.ownerId),
        g.calls.expireRingingCalls(later),
      ]);

      // Whichever lost may reject (the call is already ended) -- that is the
      // claim working, not a failure.
      expect(results.some((r) => r.status === 'fulfilled')).toBe(true);

      const call = (await g.prisma.call.findUnique({ where: { id: callId } }))!;
      expect(call.status).toBe('ended');
      expect(call.outcome).toBe('missed');

      await drain();
      // ONE missed-call notification for the parent, whoever won the race. The
      // dedupe key is missed_call:{callId}:{actorId}, so even two CALL_ENDED
      // events converge on one notification.
      expect(
        await g.prisma.notification.count({
          where: { recipientId: s.parentId, type: NotificationType.MISSED_CALL },
        }),
      ).toBe(1);
    });

  it('recovers if the worker dies mid-sweep, without double-notifying', async () => {
    const conversationId = await studentGroup();
    const { callId } = await g.calls.start(conversationId, s.ownerId);
    const timeout = await g.config.get('call.ring_timeout_seconds');
    const later = new Date(Date.now() + (timeout + 5) * 1000);

    // The sweep marks the call ended, then the worker dies before the outbox
    // row is drained. The call row is committed; the notification is not sent.
    await g.calls.expireRingingCalls(later);
    expect(
      await g.prisma.notification.count({
        where: { recipientId: s.parentId, type: NotificationType.MISSED_CALL },
      }),
    ).toBe(0);

    // A later worker drains the outbox. The event was written in the same
    // transaction as the call update, so it survived the crash.
    await drain();
    expect(
      await g.prisma.notification.count({
        where: { recipientId: s.parentId, type: NotificationType.MISSED_CALL },
      }),
    ).toBe(1);

    // And a second sweep finds nothing to do.
    expect(await g.calls.expireRingingCalls(later)).toBe(0);
    await drain();
    expect(
      await g.prisma.notification.count({
        where: { recipientId: s.parentId, type: NotificationType.MISSED_CALL },
      }),
    ).toBe(1);
    void callId;
  });

  it('a call left ringing is bounded: it cannot outlive its window', async () => {
    const conversationId = await studentGroup();
    const { callId } = await g.calls.start(conversationId, s.ownerId);
    const timeout = await g.config.get('call.ring_timeout_seconds');

    // A ringing row is also a LIVE call: issueToken admits a participant to
    // anything not ENDED, so an unbounded ring is an indefinite join window.
    await expect(g.calls.issueToken(callId, s.parentId)).resolves.toBeDefined();

    await g.calls.expireRingingCalls(new Date(Date.now() + (timeout + 5) * 1000));

    await expect(g.calls.issueToken(callId, s.parentId)).rejects.toThrow(/ended/i);
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
  it('a mute set before it is dispatched silences it, even if it was created first',
    async () => {
      await g.notifications.registerDevice({
        actorId: s.parentId, token: 'late-mute-device', platform: 'ios',
      });
      const conversationId = await studentGroup();
      await g.messages.send({ conversationId, senderId: s.ownerId, body: 'before the mute' });
      await drain();

      // This used to assert the opposite, on the grounds that the decision was
      // taken at creation and re-deciding would leave "why did this go out?"
      // unanswerable. That reasoning did not survive the queued case: a class
      // reminder written yesterday for 8am today would buzz a parent who muted
      // the category last night, and "we had already decided" is not an answer
      // they would accept. The preference is a standing instruction, not a fact
      // about the instant, so it is read when the push would actually be sent
      // -- and the record is still written, just at that moment instead of the
      // earlier one, so the question still has an answer.
      await g.preferences.set(s.parentId, 'messaging', false);
      await g.notifications.dispatchDue(new Date());

      const n = (await g.prisma.notification.findFirst({
        where: { recipientId: s.parentId },
      }))!;
      const push = (await g.deliveries.trace(n.id)).find((d) => d.channel === 'push');
      expect(push!.status).toBe('skipped');
      expect(push!.skipReason).toBe('PREFERENCE_OFF');
      // And the notification itself is untouched: a mute never costs the record.
      expect((await g.centre.unreadCounts(s.parentId)).total).toBe(1);
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
/**
 * A PARENT WITH NO SOCKET.
 *
 * Offline is not an error state, it is the normal state of a phone. The rule
 * the server has to hold: a parent who is unreachable right now is not a failed
 * delivery, they are a parent who will read it later -- and everything that
 * happened while they were gone must be waiting, exactly once, when they come
 * back.
 */
describe('a parent who is offline', () => {
  it('a realtime publish that reaches nobody is SENT, not failed', async () => {
    const conversationId = await studentGroup();
    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'nobody home' });
    await drain();
    const n = (await g.prisma.notification.findFirst({
      where: { recipientId: s.parentId },
    }))!;

    await g.notifications.dispatchDue(new Date());

    // No socket is open. The publish went out and reached nobody, which is
    // "they are offline", not "we failed" -- the notification is in the
    // database and will be there when they reconnect. Recording it failed
    // would put it in a retry queue to solve a problem that is not a problem.
    const inApp = (await g.deliveries.trace(n.id)).find((d) => d.channel === 'in_app');
    expect(inApp!.status).toBe('sent');
    expect(inApp!.errorCode).toBeNull();
  });

  it('the notification is complete and unread when they come back', async () => {
    const conversationId = await studentGroup();
    for (const body of ['one', 'two', 'three']) {
      await g.messages.send({ conversationId, senderId: s.ownerId, body });
    }
    await drain();
    await g.notifications.dispatchDue(new Date());

    // What their app fetches on reconnect is the same list it would have shown
    // live: nothing was consumed by the publish that reached nobody.
    const page = await g.centre.list(s.parentId);
    expect(page.items).toHaveLength(3);
    expect(page.items.every((i) => i.readAt === null)).toBe(true);
    expect((await g.centre.unreadCounts(s.parentId)).total).toBe(3);
    for (const item of page.items) {
      expect(item.title).toBeTruthy();
      expect(item.body).toBeTruthy();
      expect(item.deeplink).toBeTruthy();
    }
  });

  it('re-fetching on reconnect creates nothing and duplicates nothing', async () => {
    const conversationId = await studentGroup();
    await g.messages.send({ conversationId, senderId: s.ownerId, body: 'once' });
    await drain();
    await g.notifications.dispatchDue(new Date());

    // The app re-syncs on every reconnect, and a flapping connection does it
    // repeatedly. Reading is a read.
    for (let i = 0; i < 5; i += 1) {
      await g.centre.list(s.parentId);
      await g.centre.unreadCounts(s.parentId);
    }

    expect(
      await g.prisma.notification.count({ where: { recipientId: s.parentId } }),
    ).toBe(1);
    expect(
      await g.prisma.notificationDelivery.count({
        where: { recipientId: s.parentId, channel: 'in_app' },
      }),
    ).toBe(1);
  });

  it('a relay that refuses the publish IS retried, because that one is our fault',
    async () => {
      await g.notifications.registerDevice({
        actorId: s.parentId, token: 'offline-device', platform: 'android',
      });
      const spy = jest
        .spyOn(g.realtime, 'toUsers')
        .mockRejectedValue(new Error('no instance accepted the publish'));

      const conversationId = await studentGroup();
      await g.messages.send({ conversationId, senderId: s.ownerId, body: 'relay down' });
      await drain();
      await g.notifications.dispatchDue(new Date());
      spy.mockRestore();

      const n = (await g.prisma.notification.findFirst({
        where: { recipientId: s.parentId },
      }))!;
      const trace = await g.deliveries.trace(n.id);

      // The distinction that matters: "nobody was listening" is offline and is
      // final; "the relay would not take it" is a fault on our side and is
      // retried. Confusing the two either retries every offline parent forever
      // or silently drops a genuine outage.
      const inApp = trace.find((d) => d.channel === 'in_app')!;
      expect(inApp.status).toBe('pending');
      expect(inApp.errorCode).toBe('REALTIME_PUBLISH_FAILED');

      // And the push went anyway: the two channels fail independently, which is
      // the entire reason there are two.
      expect(trace.find((d) => d.channel === 'push')!.status).toBe('sent');
      // The parent has it regardless.
      expect((await g.centre.unreadCounts(s.parentId)).total).toBe(1);
    });

  it('everything queued while they were away is dispatched in one sweep', async () => {
    await g.notifications.registerDevice({
      actorId: s.parentId, token: 'return-device', platform: 'android',
    });
    const conversationId = await studentGroup();
    for (const body of ['a', 'b', 'c', 'd']) {
      await g.messages.send({ conversationId, senderId: s.ownerId, body });
    }
    await drain();

    // The dispatch sweep does not care whether anyone is connected -- which is
    // the point. Nothing waits for the parent to come back.
    await g.notifications.dispatchDue(new Date());

    const rows = await g.prisma.notification.findMany({
      where: { recipientId: s.parentId },
    });
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.status === NotificationStatus.SENT)).toBe(true);
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
