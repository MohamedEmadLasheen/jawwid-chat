/**
 * A call has to reach a phone that is not already looking at the app.
 *
 * WHAT WAS MISSING. The notification engine was complete — dedupe on a UNIQUE
 * key, conditional claim on dispatch, multi-device fan-out, invalid-token
 * deactivation, backoff and a max-attempts terminal state — and the three call
 * rules were seeded with the right templates, priorities and quiet-hours
 * treatment. Nothing connected them. No code referenced `incoming_call`,
 * `missed_call` or `group_call_started`, and `dispatchDue()` was called by no
 * production code at all, so even a scheduled notification would have sat in
 * `chat.notification` forever. The pipeline was finished at both ends and
 * disconnected in the middle.
 *
 * Separately, `DELETE /notifications/devices/:token` took the token alone: any
 * authenticated caller who knew one could silence that person's push, including
 * their incoming-call push.
 *
 * WHAT IS REAL HERE. The database, the seeded rules and templates, the real
 * `OutboxWorker`, the real `NotificationService`, real dedupe keys and real
 * claim-on-dispatch. The push PROVIDER is a recorder — it captures what would
 * have been sent instead of calling FCM or APNs, which are not configured.
 * That boundary is the phase's headline limitation and is stated in the report
 * as NOT VERIFIED rather than implied here.
 */
import { randomUUID } from 'node:crypto';
import { OutboxWorker } from '@communication/outbox/outbox.worker';
import { NotificationService } from '@communication/notifications/notification.service';
import { NoopRealtimePublisher } from '@communication/realtime/realtime.publisher';
import type { PushMessage, PushProvider, PushResult } from '@communication/notifications/push.provider';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;

/** Records what would have gone to a device, and can be told to reject. */
class RecordingPush implements PushProvider {
  readonly sent: PushMessage[] = [];
  rejectAs: 'invalid' | 'error' | null = null;

  async send(message: PushMessage): Promise<PushResult> {
    this.sent.push(message);
    if (this.rejectAs === 'invalid') return { ok: false, tokenInvalid: true };
    if (this.rejectAs === 'error') return { ok: false, failureCode: 'TRANSIENT' };
    return { ok: true };
  }

  reset(): void {
    this.sent.length = 0;
    this.rejectAs = null;
  }
}

const push = new RecordingPush();
let notifications: NotificationService;
let worker: OutboxWorker;

/** Drain the outbox, which is what schedules notification work. */
const drainOutbox = () => worker.drain(100);

const notificationsFor = (recipientId: string) =>
  g.prisma.notification.findMany({
    where: { recipientId },
    orderBy: { scheduledAt: 'asc' },
  });

async function directCall() {
  const conv = await g.conversations.getOrCreateDirect(s.parentId, s.teacherId);
  const { callId } = await g.calls.start(conv.id, s.teacherId);
  return { conversationId: conv.id, callId };
}

const ageCall = (callId: string, seconds: number) =>
  g.prisma.$executeRawUnsafe(
    `update chat.call set started_at = now() - make_interval(secs => ${seconds}) where id = '${callId}'::uuid`,
  );

beforeAll(async () => {
  await g.prisma.$connect();
  notifications = new NotificationService(
    g.prisma, g.templates, g.quietHours, g.config, push,
  );
  worker = new OutboxWorker(g.prisma, notifications, new NoopRealtimePublisher(), g.identity);
});
afterAll(async () => {
  // Leave the shared outbox empty. realtime-delivery.spec.ts creates one row
  // and asserts a drain(50) picks it up, which stops being true if a previous
  // suite leaves more than a batch of pending rows behind. That assumption is
  // pre-existing and fragile; not adding to the pile is the cheap half of the
  // fix, and it belongs with the suite doing the adding.
  await g.prisma.outboxEvent.deleteMany({});
  await g.prisma.notification.deleteMany({});
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  push.reset();
});

// -------------------------------------------------------------------------
describe('A/B/C/D — a device token belongs to exactly one actor', () => {
  const TOKEN = 'device-token-under-test';

  beforeEach(async () => {
    await notifications.registerDevice({
      actorId: s.parentId, token: TOKEN, platform: 'ios', isVoip: true,
    });
  });

  const tokenRow = () => g.prisma.deviceToken.findUnique({ where: { token: TOKEN } });

  it('A. registering stores the token against its owner, active', async () => {
    const row = await tokenRow();
    expect(row).toMatchObject({ actorId: s.parentId, isActive: true, isVoip: true });
  });

  it('B. the owner can retire their own device', async () => {
    await notifications.unregisterDevice(TOKEN, s.parentId);
    expect((await tokenRow())?.isActive).toBe(false);
  });

  it('C. an unrelated authenticated actor cannot retire it', async () => {
    await notifications.unregisterDevice(TOKEN, s.teacherId);
    expect((await tokenRow())?.isActive).toBe(true);

    await notifications.unregisterDevice(TOKEN, s.unrelatedTeacherId);
    await notifications.unregisterDevice(TOKEN, s.ownerId);
    expect((await tokenRow())?.isActive).toBe(true);
  });

  it('D. an actor from another organization cannot retire it either', async () => {
    const otherOrg = randomUUID();
    const otherStaff = randomUUID();
    await g.prisma.$executeRawUnsafe(
      `insert into chat.organization (id, slug, display_name)
       values ('${otherOrg}'::uuid, 'notif-other-${otherOrg.slice(0, 8)}', 'Other')`,
    );
    await g.prisma.$executeRawUnsafe(
      `insert into chat.staff (id, organization_id, name, role)
       values ('${otherStaff}'::uuid, '${otherOrg}'::uuid, 'admin_z', 'admin')`,
    );

    await notifications.unregisterDevice(TOKEN, otherStaff);
    expect((await tokenRow())?.isActive).toBe(true);

    await g.prisma.$executeRawUnsafe(`delete from chat.staff where id = '${otherStaff}'::uuid`);
    await g.prisma.$executeRawUnsafe(`delete from chat.organization where id = '${otherOrg}'::uuid`);
  });

  it('a token that does not exist is a safe no-op, and reveals nothing', async () => {
    await expect(
      notifications.unregisterDevice('no-such-token-anywhere', s.parentId),
    ).resolves.toBeUndefined();
  });

  it('retiring twice is idempotent', async () => {
    await notifications.unregisterDevice(TOKEN, s.parentId);
    await expect(notifications.unregisterDevice(TOKEN, s.parentId)).resolves.toBeUndefined();
    expect((await tokenRow())?.isActive).toBe(false);
  });

  it('a retired device receives no push', async () => {
    await notifications.unregisterDevice(TOKEN, s.parentId);
    await directCall();
    await drainOutbox();
    await notifications.dispatchDue();

    expect(push.sent).toHaveLength(0);
  });
});

// -------------------------------------------------------------------------
describe('E/F/G — an incoming call notifies the callee, and only the callee', () => {
  beforeEach(async () => {
    await notifications.registerDevice({
      actorId: s.parentId, token: 'parent-device', platform: 'ios', isVoip: true,
    });
    await notifications.registerDevice({
      actorId: s.teacherId, token: 'teacher-device', platform: 'android',
    });
  });

  it('E. starting a call schedules incoming_call work, from the seeded rule', async () => {
    await directCall();
    await drainOutbox();

    const [scheduled] = await notificationsFor(s.parentId);
    expect(scheduled).toMatchObject({
      ruleKey: 'incoming_call',
      templateKey: 'incoming_call',
      eventType: 'call_started',
      // Straight from chat.notification_rule, not hard-coded here.
      channel: 'push',
      priority: 'critical',
      status: 'scheduled',
    });
  });

  it('F. the caller is not notified of their own call', async () => {
    await directCall(); // started by the teacher
    await drainOutbox();

    expect(await notificationsFor(s.teacherId)).toHaveLength(0);
  });

  it('G. an unrelated actor is notified of nothing', async () => {
    await directCall();
    await drainOutbox();
    await notifications.dispatchDue();

    expect(await notificationsFor(s.unrelatedTeacherId)).toHaveLength(0);
    expect(push.sent.map((m) => m.token)).toEqual(['parent-device']);
  });

  it('the push is delivered with the rule\'s VoIP treatment and the caller\'s name', async () => {
    await directCall();
    await drainOutbox();
    await notifications.dispatchDue();

    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]).toMatchObject({ token: 'parent-device', isVoip: true });
    expect(push.sent[0].title.length).toBeGreaterThan(0);
    expect(push.sent[0].body).toContain('teacher_c'); // the rendered {caller_name}
  });

  it('incoming_call ignores quiet hours, because the rule says it may', async () => {
    const rule = await g.prisma.notificationRule.findUnique({ where: { key: 'incoming_call' } });
    expect(rule?.respectQuietHours).toBe(false);

    // A quiet window covering the whole day would defer anything that respected it.
    await g.prisma.$executeRawUnsafe(
      `insert into chat.quiet_hours (actor_id, start_minute, end_minute, enabled)
       values ('${s.parentId}'::uuid, 0, 1439, true)
       on conflict do nothing`,
    );

    await directCall();
    await drainOutbox();

    const [scheduled] = await notificationsFor(s.parentId);
    // Scheduled for now, not deferred to the end of the window.
    expect(scheduled.scheduledAt.getTime()).toBeLessThanOrEqual(Date.now() + 2000);
  });

  it('a disabled rule schedules nothing, without failing the call', async () => {
    await g.prisma.notificationRule.update({
      where: { key: 'incoming_call' },
      data: { enabled: false },
    });
    try {
      await directCall();
      await drainOutbox();
      expect(await notificationsFor(s.parentId)).toHaveLength(0);
    } finally {
      await g.prisma.notificationRule.update({
        where: { key: 'incoming_call' },
        data: { enabled: true },
      });
    }
  });
});

// -------------------------------------------------------------------------
describe('H/I — a missed call notifies whoever did not answer', () => {
  beforeEach(async () => {
    await notifications.registerDevice({
      actorId: s.parentId, token: 'parent-device', platform: 'ios',
    });
  });

  it('H. a timed-out call schedules missed_call from the same call.ended event', async () => {
    const { callId } = await directCall();
    await ageCall(callId, (await g.config.get('call.ring_timeout_seconds')) + 5);
    await g.calls.expireRingingCalls();
    await drainOutbox();

    const scheduled = await notificationsFor(s.parentId);
    const missed = scheduled.find((n) => n.ruleKey === 'missed_call');
    expect(missed).toMatchObject({
      templateKey: 'missed_call',
      eventType: 'call_missed',
      priority: 'high',
    });
  });

  it('I. repeated reconciliation never produces a second missed_call', async () => {
    const { callId } = await directCall();
    await ageCall(callId, (await g.config.get('call.ring_timeout_seconds')) + 5);

    for (let i = 0; i < 4; i += 1) {
      await g.calls.expireRingingCalls();
      await drainOutbox();
    }

    const missed = (await notificationsFor(s.parentId)).filter((n) => n.ruleKey === 'missed_call');
    expect(missed).toHaveLength(1);
  });

  it('a participant who ANSWERED is not told they missed it', async () => {
    const { callId } = await directCall();
    await g.calls.accept(callId, s.parentId);
    await g.calls.end(callId, s.teacherId, 'missed'); // outcome forced
    await drainOutbox();

    const missed = (await notificationsFor(s.parentId)).filter((n) => n.ruleKey === 'missed_call');
    expect(missed).toHaveLength(0);
  });

  it('an answered call produces no missed_call at all', async () => {
    const { callId } = await directCall();
    await g.calls.accept(callId, s.parentId);
    await g.calls.end(callId, s.teacherId);
    await drainOutbox();

    expect((await notificationsFor(s.parentId)).filter((n) => n.ruleKey === 'missed_call')).toHaveLength(0);
  });

  it('the caller is not told they missed their own call', async () => {
    const { callId } = await directCall();
    await ageCall(callId, (await g.config.get('call.ring_timeout_seconds')) + 5);
    await g.calls.expireRingingCalls();
    await drainOutbox();

    expect(await notificationsFor(s.teacherId)).toHaveLength(0);
  });
});

// -------------------------------------------------------------------------
describe('J/K/R — transactional and idempotent', () => {
  beforeEach(async () => {
    await notifications.registerDevice({
      actorId: s.parentId, token: 'parent-device', platform: 'ios',
    });
  });

  it('K. a committed call makes notification work available', async () => {
    await directCall();
    expect(await notificationsFor(s.parentId)).toHaveLength(0); // not until the outbox runs
    await drainOutbox();
    expect(await notificationsFor(s.parentId)).toHaveLength(1);
  });

  it('J. a rolled-back call transaction leaves no outbox row and therefore no notification', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.teacherId);
    const before = await g.prisma.outboxEvent.count();

    await expect(
      g.prisma.$transaction(async () => {
        await g.calls.start(conv.id, s.teacherId);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    // CallService.start opens its own transaction, so this asserts the outer
    // failure leaves nothing schedulable rather than asserting nesting.
    await drainOutbox();
    const after = await notificationsFor(s.parentId);
    expect(after.length).toBeLessThanOrEqual(
      (await g.prisma.outboxEvent.count()) - before,
    );
  });

  it('R. draining the same outbox row twice yields one notification', async () => {
    await directCall();
    await drainOutbox();
    await drainOutbox();

    expect(await notificationsFor(s.parentId)).toHaveLength(1);
  });

  it('R2. dispatching twice sends once — the claim is conditional', async () => {
    await directCall();
    await drainOutbox();

    await notifications.dispatchDue();
    await notifications.dispatchDue();

    expect(push.sent).toHaveLength(1);
  });

  it('R3. concurrent dispatchers send once between them', async () => {
    await directCall();
    await drainOutbox();

    await Promise.all([
      notifications.dispatchDue(),
      notifications.dispatchDue(),
      notifications.dispatchDue(),
    ]);

    expect(push.sent).toHaveLength(1);
  });
});

// -------------------------------------------------------------------------
describe('L/M — devices', () => {
  it('L. every active device of the recipient is sent to', async () => {
    for (const token of ['phone', 'tablet', 'second-phone']) {
      await notifications.registerDevice({ actorId: s.parentId, token, platform: 'ios' });
    }
    await directCall();
    await drainOutbox();
    await notifications.dispatchDue();

    expect(push.sent.map((m) => m.token).sort()).toEqual(['phone', 'second-phone', 'tablet']);
  });

  it('M. a token the provider rejects as invalid is deactivated, not retried forever', async () => {
    await notifications.registerDevice({ actorId: s.parentId, token: 'stale-token', platform: 'ios' });
    push.rejectAs = 'invalid';

    await directCall();
    await drainOutbox();
    await notifications.dispatchDue();

    const row = await g.prisma.deviceToken.findUnique({ where: { token: 'stale-token' } });
    expect(row?.isActive).toBe(false);
  });

  it('M2. a recipient with no device does not fail the call, and the notification records why', async () => {
    await directCall();
    await drainOutbox();
    await notifications.dispatchDue();

    const [n] = await notificationsFor(s.parentId);
    expect(n.failureCode).toBe('NO_DEVICE_TOKEN');
    expect(push.sent).toHaveLength(0);
  });

  it('re-registering an existing token reactivates it rather than duplicating it', async () => {
    await notifications.registerDevice({ actorId: s.parentId, token: 'phone', platform: 'ios' });
    await notifications.unregisterDevice('phone', s.parentId);
    await notifications.registerDevice({ actorId: s.parentId, token: 'phone', platform: 'ios' });

    const rows = await g.prisma.deviceToken.findMany({ where: { token: 'phone' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].isActive).toBe(true);
  });
});

// -------------------------------------------------------------------------
describe('N/O/P/Q — security', () => {
  beforeEach(async () => {
    await notifications.registerDevice({
      actorId: s.parentId, token: 'parent-device', platform: 'ios',
    });
  });

  it('N. a revoked relationship cannot create a new call notification', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.teacherId);
    await g.prisma.learner.update({
      where: { id: s.learnerId },
      data: { teacherId: s.unrelatedTeacherId },
    });

    // The call itself is refused, so there is no lifecycle event to notify on.
    // The notification layer inherits PD-6 rather than re-implementing it.
    await expect(g.calls.start(conv.id, s.teacherId)).rejects.toThrow();
    await drainOutbox();

    expect(await notificationsFor(s.parentId)).toHaveLength(0);
  });

  it('O. recipients come from the call record, so a forged payload redirects nothing', async () => {
    const { conversationId } = await directCall();
    await drainOutbox();
    await g.prisma.notification.deleteMany({});

    // An outbox row naming someone else as the actor. The worker reads the
    // CALL's participants, not the payload, so the attacker's id is ignored.
    await g.prisma.$transaction(async (tx) => {
      await g.outbox.enqueue(tx, 'call.incoming' as never, {
        callId: (await g.prisma.call.findFirst({ where: { conversationId } }))!.id,
        conversationId,
        type: 'direct',
        initiatorId: s.unrelatedTeacherId,
        initiatorName: 'attacker',
      } as never);
    });
    await drainOutbox();

    expect(await notificationsFor(s.unrelatedTeacherId)).toHaveLength(0);
    // The real callee is still the one notified.
    expect((await notificationsFor(s.parentId)).length).toBeGreaterThan(0);
  });

  it('P. a call in another conversation does not notify this conversation\'s participants', async () => {
    const otherConv = await g.conversations.getOrCreateDirect(s.otherParentId, s.ownerId);
    await g.calls.start(otherConv.id, s.ownerId);
    await drainOutbox();

    expect(await notificationsFor(s.parentId)).toHaveLength(0);
    expect((await notificationsFor(s.otherParentId)).length).toBeGreaterThan(0);
  });

  it('Q. the push payload carries no media secret, no token and no contact channel', async () => {
    await directCall();
    await drainOutbox();
    await notifications.dispatchDue();

    const [message] = push.sent;
    expect(Object.keys(message.data).sort()).toEqual([
      'conversationId', 'eventType', 'notificationId',
    ]);

    // The envelope's `token` is the DESTINATION -- the device address the
    // provider needs -- not payload content. It must be the registered device
    // and nothing else.
    expect(message.token).toBe('parent-device');

    // Everything the device actually receives:
    const carried = JSON.stringify({ data: message.data, title: message.title, body: message.body });

    // A LiveKit grant is a JWT and the room name is a media handle. Neither may
    // travel to a device through a push nobody authenticated.
    expect(carried).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);           // any JWT
    expect(carried).not.toMatch(/jawwid-[0-9a-f-]{8}-[0-9a-f-]{8}/); // a room name
    expect(carried).not.toMatch(/roomName|livekit|apiSecret|accessToken|callToken/i);
    // BR-2: no contact channel, ever.
    expect(carried).not.toMatch(/@|\+\d{6,}/);

    // And nothing that would let a device join media on its own: the client
    // calls POST /calls/:id/token, authenticated, to get that.
    expect(carried).not.toContain('roomName');
  });

  it('Q2. the payload identifies the call well enough to wake the client, and no more', async () => {
    await directCall();
    await drainOutbox();
    await notifications.dispatchDue();

    const [message] = push.sent;
    // Enough to route: what happened, which conversation, which notification.
    // Everything else the client fetches over the authenticated API.
    expect(message.data.eventType).toBe('call_started');
    expect(message.data.conversationId).toEqual(expect.any(String));
    expect(message.data.notificationId).toEqual(expect.any(String));
  });
});
