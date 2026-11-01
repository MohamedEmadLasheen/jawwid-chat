/**
 * CHATSCHED-013 (owner-approved 2026-10-31): a call that drops is not left
 * "active" for ever, nor ended at once.
 *
 *   1. an unexpected media departure that leaves fewer than two connected
 *      interrupts the call; the server waits the grace (60 s);
 *   2. a rejoin within it resumes the SAME call;
 *   3. otherwise the sweep ends it ...
 *   4. ... as `connection_lost`, told to every participant (and pushed on 1:1);
 *   5. the duration is connected time: the gap is not counted;
 *   6. a hang-up stays a hang-up.
 *
 * Group calls: one member's drop with two still connected does not interrupt
 * the call; that member is out after the grace. A decline is unchanged.
 *
 * Media presence is driven with LiveKit's own event times, so "60 s ago" is an
 * event time, not a sleep.
 */
import { CommEvent } from '@communication/contracts/events';
import { MediaPresenceService } from '@communication/calls/media-presence.service';
import { OutboxService } from '@communication/outbox/outbox.service';
import { OutboxWorker } from '@communication/outbox/outbox.worker';
import { NoopRealtimePublisher } from '@communication/realtime/realtime.publisher';
import { NotificationService } from '@communication/notifications/notification.service';
import { Scenario, buildGraph, seed, truncate } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;
let presence: MediaPresenceService;
let grace: number;

const ago = (seconds: number) => new Date(Date.now() - seconds * 1000);

async function row(callId: string) {
  const [c] = await g.prisma.$queryRaw<
    Array<{ status: string; outcome: string | null; end_reason: string | null; duration_seconds: number | null; interrupted_at: Date | null }>
  >`select status, outcome, end_reason, duration_seconds, interrupted_at from chat.call where id = ${callId}::uuid`;
  return c!;
}

const events = async (callId: string) =>
  (await g.prisma.outboxEvent.findMany({ orderBy: { createdAt: 'asc' } }))
    .filter((r) => (r.payload as { callId?: string })?.callId === callId)
    .map((r) => ({ type: r.type, payload: r.payload as Record<string, unknown> }));

async function connectedDirectCall(connectedSecondsAgo: number) {
  const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
  const { callId, roomName } = await g.calls.start(conv.id, s.ownerId);
  await g.calls.accept(callId, s.parentId);
  for (const id of [s.ownerId, s.parentId]) {
    await presence.participantJoined({ roomName, identity: id, at: ago(connectedSecondsAgo) });
  }
  return { conversationId: conv.id, callId, roomName };
}

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await g.prisma.outboxEvent.deleteMany({});
  await g.prisma.notification.deleteMany({});
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  g.config.invalidate();
  grace = await g.config.get('call.reconnect_grace_seconds');
  presence = new MediaPresenceService(g.prisma, new OutboxService(), g.config);
});

describe('a drop, then a rejoin within the grace', () => {
  it('resumes the same call, and its duration leaves the gap out', async () => {
    expect(grace).toBe(60);
    const { callId, roomName } = await connectedDirectCall(300);
    // Connected 300 s ago; dropped 200 s ago (100 s connected); back 150 s ago.
    await presence.participantLeft({ roomName, identity: s.parentId, at: ago(200) });
    expect((await row(callId)).interrupted_at).toBeInstanceOf(Date);
    const interrupted = (await events(callId)).find((e) => e.type === CommEvent.CALL_INTERRUPTED)!;
    expect(new Date(interrupted.payload.until as string).getTime() - ago(200).getTime()).toBeLessThan(61_000);

    await presence.participantJoined({ roomName, identity: s.parentId, at: ago(150) });
    const back = await row(callId);
    expect([back.status, back.interrupted_at]).toEqual(['active', null]);
    expect((await events(callId)).map((e) => e.type)).toContain(CommEvent.CALL_RESUMED);

    // The sweep finds nothing to end.
    expect(await g.calls.endInterruptedCalls()).toBe(0);

    await g.calls.end(callId, s.ownerId);
    const ended = await row(callId);
    expect([ended.status, ended.outcome, ended.end_reason]).toEqual(['ended', 'answered', 'hung_up']);
    // 100 s before the drop + ~150 s since the rejoin (plus the test's own run
    // time); not the 300 s since the answer.
    expect(ended.duration_seconds).toBeGreaterThanOrEqual(248);
    expect(ended.duration_seconds).toBeLessThanOrEqual(265);
  });
});

describe('a drop with no rejoin', () => {
  it('is still live within the grace, then ends as connection_lost and says so to everyone', async () => {
    const { callId, roomName } = await connectedDirectCall(400);
    await presence.participantLeft({ roomName, identity: s.parentId, at: ago(30) });
    expect(await g.calls.endInterruptedCalls()).toBe(0);
    expect((await row(callId)).status).toBe('active');

    // The same drop, now past the grace.
    await g.prisma.$executeRaw`update chat.call set interrupted_at = now() - make_interval(secs => ${grace + 1}) where id = ${callId}::uuid`;
    expect(await g.calls.endInterruptedCalls()).toBe(1);
    const ended = await row(callId);
    expect([ended.status, ended.outcome, ended.end_reason]).toEqual(['ended', 'answered', 'connection_lost']);
    // Connected from 400 s ago until the drop 30 s ago: 370 s, not 400.
    expect(ended.duration_seconds).toBeGreaterThanOrEqual(368);
    expect(ended.duration_seconds).toBeLessThanOrEqual(372);

    const endedEvents = (await events(callId)).filter((e) => e.type === CommEvent.CALL_ENDED);
    expect(endedEvents).toHaveLength(1);
    expect(endedEvents[0]!.payload).toMatchObject({ outcome: 'answered', reason: 'connection_lost', durationSeconds: ended.duration_seconds });
    const left = await g.prisma.callParticipant.findMany({ where: { callId } });
    expect(left.every((p) => p.leftAt !== null)).toBe(true);

    // A second pass ends nothing again.
    expect(await g.calls.endInterruptedCalls()).toBe(0);
  });

  it('a 1:1 connection_lost is pushed to both people, once each', async () => {
    const worker = new OutboxWorker(
      g.prisma,
      new NotificationService(g.prisma, g.templates, g.quietHours, g.config, { send: async () => ({ ok: true }) } as never),
      new NoopRealtimePublisher(),
      g.identity,
    );
    const { callId, roomName } = await connectedDirectCall(100);
    await presence.participantLeft({ roomName, identity: s.parentId, at: ago(grace + 5) });
    await g.calls.endInterruptedCalls();
    await worker.drain(100);
    await worker.drain(100);
    const lost = await g.prisma.notification.findMany({ where: { ruleKey: 'call_connection_lost' } });
    expect(lost.map((n) => n.recipientId).sort()).toEqual([s.ownerId, s.parentId].sort());
  });
});

describe('a hang-up stays a hang-up', () => {
  it('ends at once as hung_up; no interruption, no connection_lost', async () => {
    const { callId, roomName } = await connectedDirectCall(120);
    await g.calls.end(callId, s.parentId);
    // The room empties after the hang-up: that is not a drop.
    await presence.participantLeft({ roomName, identity: s.parentId, at: new Date() });
    await presence.participantLeft({ roomName, identity: s.ownerId, at: new Date() });
    const ended = await row(callId);
    expect([ended.status, ended.end_reason, ended.interrupted_at]).toEqual(['ended', 'hung_up', null]);
    expect((await events(callId)).map((e) => e.type)).not.toContain(CommEvent.CALL_INTERRUPTED);
    expect((await events(callId)).find((e) => e.type === CommEvent.CALL_ENDED)!.payload.reason).toBe('hung_up');
  });

  it('a decline and a ring timeout carry their own reasons', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    const declined = await g.calls.start(conv.id, s.ownerId);
    await g.calls.decline(declined.callId, s.parentId);
    expect((await row(declined.callId)).end_reason).toBe('declined');

    const unanswered = await g.calls.start(conv.id, s.ownerId);
    const ring = await g.config.get('call.ring_timeout_seconds');
    await g.prisma.$executeRaw`update chat.call set started_at = now() - make_interval(secs => ${ring + 5}) where id = ${unanswered.callId}::uuid`;
    await g.calls.expireRingingCalls();
    expect((await row(unanswered.callId)).end_reason).toBe('ring_timeout');
  });
});

describe('group calls', () => {
  it('one member dropping while two stay connected does not interrupt the call; that member is out after the grace', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId);
    const { callId, roomName } = await g.calls.start(group.id, s.ownerId);
    const members = (await g.prisma.callParticipant.findMany({ where: { callId } })).map((p) => p.actorId);
    const others = members.filter((id) => id !== s.ownerId).slice(0, 2);
    for (const id of others) await g.calls.accept(callId, id);
    for (const id of [s.ownerId, ...others]) await presence.participantJoined({ roomName, identity: id, at: ago(200) });

    await presence.participantLeft({ roomName, identity: others[0]!, at: ago(grace + 10) });
    expect((await row(callId)).interrupted_at).toBeNull();
    expect((await events(callId)).map((e) => e.type)).not.toContain(CommEvent.CALL_INTERRUPTED);

    expect(await g.calls.endInterruptedCalls()).toBe(0);
    expect((await row(callId)).status).toBe('active');
    const dropped = await g.prisma.callParticipant.findUnique({ where: { callId_actorId: { callId, actorId: others[0]! } } });
    expect(dropped!.leftAt).toBeInstanceOf(Date);
    const stayed = await g.prisma.callParticipant.findUnique({ where: { callId_actorId: { callId, actorId: others[1]! } } });
    expect(stayed!.leftAt).toBeNull();
  });

  it('one decline still ends a ringing group call (owner decision), with reason declined', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId);
    const { callId } = await g.calls.start(group.id, s.ownerId);
    await g.calls.decline(callId, s.parentId);
    const ended = await row(callId);
    expect([ended.status, ended.outcome, ended.end_reason]).toEqual(['ended', 'declined', 'declined']);
  });
});

describe('the sweep and a rejoin at the same moment', () => {
  it('settle on exactly one outcome: resumed, or ended -- never both', async () => {
    for (let round = 0; round < 8; round++) {
      await truncate(g.prisma);
      s = await seed(g.prisma);
      g.coverage.onDutyId = s.ownerId;
      const { callId, roomName } = await connectedDirectCall(300);
      await presence.participantLeft({ roomName, identity: s.parentId, at: ago(grace + 2) });

      await Promise.all([g.calls.endInterruptedCalls(), presence.participantJoined({ roomName, identity: s.parentId, at: new Date() })]);

      const after = await row(callId);
      const types = (await events(callId)).map((e) => e.type);
      const resumed = types.filter((t) => t === CommEvent.CALL_RESUMED).length;
      const ended = types.filter((t) => t === CommEvent.CALL_ENDED).length;
      if (after.status === 'ended') {
        expect([after.end_reason, resumed, ended]).toEqual(['connection_lost', 0, 1]);
      } else {
        expect([after.status, after.interrupted_at, resumed, ended]).toEqual(['active', null, 1, 0]);
        // ... and a later sweep does not end it.
        expect(await g.calls.endInterruptedCalls()).toBe(0);
      }
    }
  });
});

describe('history', () => {
  it('both sides see the same connected duration and the reason', async () => {
    const { conversationId, callId, roomName } = await connectedDirectCall(250);
    await presence.participantLeft({ roomName, identity: s.parentId, at: ago(grace + 50) });
    await g.calls.endInterruptedCalls();
    const mine = (await g.calls.history(conversationId, s.ownerId)).find((c) => c.id === callId)!;
    const theirs = (await g.calls.history(conversationId, s.parentId)).find((c) => c.id === callId)!;
    expect(mine.durationSeconds).toBe(theirs.durationSeconds);
    expect(mine.durationSeconds).toBeGreaterThanOrEqual(138);
    expect(mine.durationSeconds).toBeLessThanOrEqual(142);
    expect([mine.endReason, theirs.endReason]).toEqual(['connection_lost', 'connection_lost']);
    const account = (await g.calls.historyForActor(s.parentId)).items.find((c) => c.id === callId)!;
    expect([account.durationSeconds, account.endReason]).toEqual([mine.durationSeconds, 'connection_lost']);
  });
});
