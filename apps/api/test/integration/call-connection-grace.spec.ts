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
 * the call, and that member may rejoin it while it is live, however long
 * after (review of #367). A decline is unchanged.
 *
 * Races (review of #367): the sweep against a rejoin, a hang-up and another
 * sweep; two rejoins; webhooks delivered out of order.
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
  it('one member dropping while two stay connected does not interrupt the call; they may rejoin the same call, even past the grace', async () => {
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
    expect(dropped!.leftAt).toBeNull();

    // Back, past the grace: the same call lets them in.
    await expect(g.calls.issueToken(callId, others[0]!)).resolves.toMatchObject({ roomName });
    expect(await presence.participantJoined({ roomName, identity: others[0]!, at: new Date() })).toBe('reconciled');
    const back = await g.prisma.callParticipant.findUnique({ where: { callId_actorId: { callId, actorId: others[0]! } } });
    expect([back!.leftAt, back!.mediaLeftAt]).toEqual([null, null]);
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

describe('webhooks out of order (review of #367)', () => {
  it('a departure delivered after the rejoin that followed it is ignored: no interruption, and the sweep never ends the call', async () => {
    const { callId, roomName } = await connectedDirectCall(300);
    // Dropped at -90 s, back at -80 s; LiveKit delivers the rejoin first.
    expect(await presence.participantJoined({ roomName, identity: s.parentId, at: ago(80) })).toBe('noop');
    expect(await presence.participantLeft({ roomName, identity: s.parentId, at: ago(90) })).toBe('noop');

    const after = await row(callId);
    expect([after.status, after.interrupted_at]).toEqual(['active', null]);
    expect((await events(callId)).map((e) => e.type)).not.toContain(CommEvent.CALL_INTERRUPTED);
    const parent = await g.prisma.callParticipant.findUnique({ where: { callId_actorId: { callId, actorId: s.parentId } } });
    expect(parent!.mediaLeftAt).toBeNull();
    expect(await g.calls.endInterruptedCalls()).toBe(0);

    // A real departure, newer than that rejoin, still counts.
    expect(await presence.participantLeft({ roomName, identity: s.parentId, at: ago(10) })).toBe('reconciled');
    expect((await row(callId)).interrupted_at).toBeInstanceOf(Date);
  });
});

describe('races (review of #367)', () => {
  /** A connected 1:1 call, dropped past the grace: due to be swept. */
  async function overdue() {
    const call = await connectedDirectCall(300);
    await presence.participantLeft({ roomName: call.roomName, identity: s.parentId, at: ago(grace + 2) });
    return call;
  }

  async function fresh() {
    await truncate(g.prisma);
    s = await seed(g.prisma);
    g.coverage.onDutyId = s.ownerId;
  }

  it('the sweep and a hang-up: one ending, with one reason, announced once', async () => {
    const reasons = new Set<string>();
    for (let round = 0; round < 8; round++) {
      await fresh();
      const { callId } = await overdue();
      const settled = await Promise.allSettled([g.calls.endInterruptedCalls(), g.calls.end(callId, s.ownerId)]);
      expect(settled.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
      const after = await row(callId);
      const ended = (await events(callId)).filter((e) => e.type === CommEvent.CALL_ENDED);
      expect(after.status).toBe('ended');
      expect(ended).toHaveLength(1);
      expect(ended[0]!.payload.reason).toBe(after.end_reason);
      reasons.add(after.end_reason!);
    }
    expect([...reasons].every((r) => r === 'connection_lost' || r === 'hung_up')).toBe(true);
  });

  it('two sweeps at once end the call once', async () => {
    for (let round = 0; round < 8; round++) {
      await fresh();
      const { callId } = await overdue();
      const counts = await Promise.all([g.calls.endInterruptedCalls(), g.calls.endInterruptedCalls()]);
      expect(counts[0]! + counts[1]!).toBe(1);
      expect((await events(callId)).filter((e) => e.type === CommEvent.CALL_ENDED)).toHaveLength(1);
    }
  });

  it('two rejoins at once resume the call once', async () => {
    for (let round = 0; round < 8; round++) {
      await fresh();
      const { callId, roomName } = await connectedDirectCall(300);
      await presence.participantLeft({ roomName, identity: s.parentId, at: ago(20) });
      const now = new Date();
      await Promise.all([
        presence.participantJoined({ roomName, identity: s.parentId, at: now }),
        presence.participantJoined({ roomName, identity: s.parentId, at: new Date(now.getTime() + 5) }),
      ]);
      const after = await row(callId);
      expect([after.status, after.interrupted_at]).toEqual(['active', null]);
      expect((await events(callId)).filter((e) => e.type === CommEvent.CALL_RESUMED)).toHaveLength(1);
    }
  });

  it('a hang-up while interrupted ends it as hung_up, with the connected time only; the sweep then has nothing', async () => {
    const { callId, roomName } = await connectedDirectCall(300);
    // Connected 300 s ago, dropped 100 s ago (200 s connected), and the other side hangs up in the grace.
    await presence.participantLeft({ roomName, identity: s.parentId, at: ago(100) });
    await g.prisma.$executeRaw`update chat.call set interrupted_at = now() - make_interval(secs => 10) where id = ${callId}::uuid`;
    await g.calls.end(callId, s.ownerId);
    const ended = await row(callId);
    expect([ended.status, ended.end_reason, ended.interrupted_at]).toEqual(['ended', 'hung_up', null]);
    expect(ended.duration_seconds).toBeGreaterThanOrEqual(198);
    expect(ended.duration_seconds).toBeLessThanOrEqual(202);
    expect(await g.calls.endInterruptedCalls()).toBe(0);
    expect((await events(callId)).filter((e) => e.type === CommEvent.CALL_ENDED)).toHaveLength(1);
  });
});

describe('duration (review of #367)', () => {
  it('a call that was connected for under a second is 0 s of connected time, not the time since the answer', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    const { callId, roomName } = await g.calls.start(conv.id, s.ownerId);
    await g.calls.accept(callId, s.parentId);
    await g.prisma.$executeRaw`update chat.call set answered_at = now() - make_interval(secs => 200) where id = ${callId}::uuid`;
    const joined = ago(150);
    for (const id of [s.ownerId, s.parentId]) await presence.participantJoined({ roomName, identity: id, at: joined });
    await presence.participantLeft({ roomName, identity: s.parentId, at: new Date(joined.getTime() + 400) });
    await g.prisma.$executeRaw`update chat.call set interrupted_at = now() - make_interval(secs => ${grace + 1}) where id = ${callId}::uuid`;
    expect(await g.calls.endInterruptedCalls()).toBe(1);
    expect((await row(callId)).duration_seconds).toBe(0);
  });
});

describe('a rejoin refused because the call is over (review 2 of #367)', () => {
  it('tells a participant HOW it ended -- a hang-up while they were away is a hang-up -- and a non-participant nothing more', async () => {
    const { callId } = await connectedDirectCall(120);
    await g.calls.end(callId, s.ownerId);
    const ended = await row(callId);
    await expect(g.calls.issueToken(callId, s.parentId)).rejects.toMatchObject({
      code: 'COMM.CALL_ALREADY_ENDED',
      detail: { endReason: 'hung_up', outcome: 'answered', durationSeconds: ended.duration_seconds },
    });
    const outsider = await g.calls.issueToken(callId, s.unrelatedTeacherId).catch((e: { detail?: unknown }) => e);
    expect((outsider as { detail?: unknown }).detail).toBeUndefined();
  });
});

describe('a client that gave up rejoining ends the call (review 2 of #367)', () => {
  it('as connection_lost -- never hung_up -- with the connected time only, the unknown drop closed at the client\'s cap', async () => {
    // Connected 300 s ago; this device dropped and the room's `left` never came.
    const { callId } = await connectedDirectCall(300);
    await g.calls.end(callId, s.parentId, { connectionLost: true });
    const ended = await row(callId);
    expect([ended.status, ended.outcome, ended.end_reason]).toEqual(['ended', 'answered', 'connection_lost']);
    // The client gives up (grace + 30) s after its drop: 300 - 90 = 210 connected.
    expect(ended.duration_seconds).toBeGreaterThanOrEqual(208);
    expect(ended.duration_seconds).toBeLessThanOrEqual(213);
    const endedEvents = (await events(callId)).filter((e) => e.type === CommEvent.CALL_ENDED);
    expect(endedEvents).toHaveLength(1);
    expect(endedEvents[0]!.payload).toMatchObject({ reason: 'connection_lost', durationSeconds: ended.duration_seconds });
  });

  it('a drop the server already saw keeps its own connected time', async () => {
    const { callId, roomName } = await connectedDirectCall(300);
    await presence.participantLeft({ roomName, identity: s.parentId, at: ago(200) });
    await g.calls.end(callId, s.parentId, { connectionLost: true });
    const ended = await row(callId);
    expect(ended.end_reason).toBe('connection_lost');
    expect(ended.duration_seconds).toBeGreaterThanOrEqual(99);
    expect(ended.duration_seconds).toBeLessThanOrEqual(101);
  });

  it('only from a participant of a live call: a ringing call refuses the reason, an ended one keeps its own', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    const ringing = await g.calls.start(conv.id, s.ownerId);
    await expect(g.calls.end(ringing.callId, s.ownerId, { connectionLost: true })).rejects.toMatchObject({ code: 'COMMON.VALIDATION' });
    expect((await row(ringing.callId)).status).toBe('ringing');
    await g.calls.end(ringing.callId, s.ownerId);

    const { callId } = await connectedDirectCall(60);
    await expect(g.calls.end(callId, s.unrelatedTeacherId, { connectionLost: true })).rejects.toBeTruthy();
    await g.calls.end(callId, s.ownerId);
    await g.calls.end(callId, s.parentId, { connectionLost: true });
    expect((await row(callId)).end_reason).toBe('hung_up');
    expect((await events(callId)).filter((e) => e.type === CommEvent.CALL_ENDED)).toHaveLength(1);
  });
});

describe('a call that never had two in the room (review 2 of #367)', () => {
  it('ended by the sweep: 0 s, never the grace', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    const { callId, roomName } = await g.calls.start(conv.id, s.ownerId);
    await g.calls.accept(callId, s.parentId);
    await g.prisma.$executeRaw`update chat.call set answered_at = now() - make_interval(secs => 200) where id = ${callId}::uuid`;
    // One side joined and left; the other never arrived.
    await presence.participantJoined({ roomName, identity: s.ownerId, at: ago(150) });
    await presence.participantLeft({ roomName, identity: s.ownerId, at: ago(140) });
    await g.prisma.$executeRaw`update chat.call set interrupted_at = now() - make_interval(secs => ${grace + 1}) where id = ${callId}::uuid`;
    expect(await g.calls.endInterruptedCalls()).toBe(1);
    expect(await row(callId)).toMatchObject({ end_reason: 'connection_lost', duration_seconds: 0, outcome: 'answered' });
  });

  it('hung up during the grace: timed from the answer only up to the drop', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    const { callId, roomName } = await g.calls.start(conv.id, s.ownerId);
    await g.calls.accept(callId, s.parentId);
    await g.prisma.$executeRaw`update chat.call set answered_at = now() - make_interval(secs => 100) where id = ${callId}::uuid`;
    await presence.participantJoined({ roomName, identity: s.ownerId, at: ago(90) });
    await presence.participantLeft({ roomName, identity: s.ownerId, at: ago(40) });
    await g.calls.end(callId, s.parentId);
    const ended = await row(callId);
    expect(ended.end_reason).toBe('hung_up');
    // answered 100 s ago, dropped 40 s ago: 60 s, not 100.
    expect(ended.duration_seconds).toBeGreaterThanOrEqual(59);
    expect(ended.duration_seconds).toBeLessThanOrEqual(62);
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
