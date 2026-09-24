/**
 * The call lifecycle, as a client actually receives it.
 *
 * THE DEFECT. `CALL_PARTICIPANT_JOINED` (from accept) and `CALL_DECLINED` were
 * enqueued as `{ callId, actorId }` with no `conversationId`. The outbox
 * worker's `default` branch routes by conversation, so both fell through it and
 * were discarded — while the outbox row was marked `published`. The caller's
 * screen could never leave "Calling…", because the server never told it
 * anything had happened. `CALL_ACCEPTED` and `CALL_PARTICIPANT_LEFT` were
 * declared in the vocabulary and emitted by nothing at all.
 *
 * WHAT IS REAL HERE. The database, the services, the transactional outbox and
 * `OutboxWorker.drain()` — the same code path the worker process runs. The
 * RealtimePublisher is a recorder: it captures `(room, event, payload)` instead
 * of reaching socket.io. That is the seam the architecture already defines
 * (`RealtimePublisher` is a port; `NoopRealtimePublisher` is its test double),
 * so recording at it tests the routing decision, which is where the defect was.
 *
 * NOT covered, and not implied: the socket.io wire. Whether a subscribed socket
 * receives what was emitted into its room is Phase 8's boundary and is still
 * faked there. Room MEMBERSHIP — who is allowed into `conversation:<id>` — is
 * proven in realtime-authentication.spec.ts against the real
 * AuthorizationService.
 */
import { randomUUID } from 'node:crypto';
import { CommErrorCode } from '@platform/errors';
import { OutboxWorker } from '@communication/outbox/outbox.worker';
import { NotificationService } from '@communication/notifications/notification.service';
import { CommEvent, room } from '@communication/contracts/events';
import type { RealtimePublisher } from '@communication/realtime/realtime.publisher';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;

interface Delivery {
  room: string;
  event: string;
  payload: Record<string, unknown>;
}

/** Records what the worker decided to send, and where. */
class RecordingPublisher implements RealtimePublisher {
  readonly deliveries: Delivery[] = [];

  async toThread(threadId: string, event: string, payload: unknown): Promise<void> {
    this.deliveries.push({
      room: room.conversation(threadId),
      event,
      payload: payload as Record<string, unknown>,
    });
  }

  async toUsers(actorIds: string[], event: string, payload: unknown): Promise<void> {
    for (const id of actorIds) {
      this.deliveries.push({
        room: room.actor(id),
        event,
        payload: payload as Record<string, unknown>,
      });
    }
  }

  reset(): void {
    this.deliveries.length = 0;
  }

  /** Every delivery for one call, in order. */
  forCall(callId: string): Delivery[] {
    return this.deliveries.filter((d) => d.payload?.callId === callId);
  }
}

const published = new RecordingPublisher();
let worker: OutboxWorker;

/** Drains the outbox exactly as the worker process does, and returns deliveries. */
async function drain(): Promise<Delivery[]> {
  published.reset();
  await worker.drain(100);
  return published.deliveries;
}

async function directCall() {
  const conv = await g.conversations.getOrCreateDirect(s.parentId, s.teacherId);
  const { callId } = await g.calls.start(conv.id, s.teacherId);
  return { conversationId: conv.id, callId };
}

beforeAll(async () => {
  await g.prisma.$connect();
  // The real worker, the real notification service, a recording publisher.
  worker = new OutboxWorker(
    g.prisma,
    new NotificationService(
      g.prisma, g.templates, g.quietHours, g.config,
      { send: async () => ({ ok: true }) },
    ) as unknown as NotificationService,
    published,
    g.identity,
  );
});
afterAll(async () => { await g.prisma.$disconnect(); });
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  published.reset();
});

// -------------------------------------------------------------------------
describe('the lifecycle a client can follow', () => {
  it('1/2. starting a call delivers call.incoming to the conversation room', async () => {
    const { conversationId, callId } = await directCall();

    const deliveries = await drain();
    const incoming = deliveries.filter((d) => d.event === CommEvent.CALL_INCOMING);

    expect(incoming).toHaveLength(1);
    expect(incoming[0].room).toBe(room.conversation(conversationId));
    expect(incoming[0].payload).toEqual({
      callId,
      conversationId,
      type: 'direct',
      initiatorId: s.teacherId,
      initiatorName: expect.any(String),
    });
  });

  it('3/4. accepting delivers call.accepted — the event that used to be dropped', async () => {
    const { conversationId, callId } = await directCall();
    await drain(); // clear the incoming event

    await g.calls.accept(callId, s.parentId);
    const deliveries = await drain();

    const accepted = deliveries.filter((d) => d.event === CommEvent.CALL_ACCEPTED);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].room).toBe(room.conversation(conversationId));
    expect(accepted[0].payload).toEqual({
      callId,
      conversationId,
      actorId: s.parentId,
    });
  });

  it('5/6. declining delivers call.declined — likewise', async () => {
    const { conversationId, callId } = await directCall();
    await drain();

    await g.calls.decline(callId, s.parentId);
    const deliveries = await drain();

    const declined = deliveries.filter((d) => d.event === CommEvent.CALL_DECLINED);
    expect(declined).toHaveLength(1);
    expect(declined[0].room).toBe(room.conversation(conversationId));
    expect(declined[0].payload).toEqual({
      callId,
      conversationId,
      actorId: s.parentId,
    });
  });

  it('9. ending delivers call.ended with the outcome', async () => {
    const { conversationId, callId } = await directCall();
    await g.calls.accept(callId, s.parentId);
    await drain();

    await g.calls.end(callId, s.teacherId);
    const deliveries = await drain();

    const ended = deliveries.filter((d) => d.event === CommEvent.CALL_ENDED);
    expect(ended).toHaveLength(1);
    expect(ended[0].room).toBe(room.conversation(conversationId));
    expect(ended[0].payload).toMatchObject({
      callId,
      conversationId,
      outcome: 'answered',
    });
  });

  it('the full answered call is a complete, ordered, routable sequence', async () => {
    const { conversationId, callId } = await directCall();
    await g.calls.accept(callId, s.parentId);
    await g.calls.end(callId, s.teacherId);

    const deliveries = await drain();
    const sequence = deliveries.filter((d) => d.payload?.callId === callId);

    expect(sequence.map((d) => d.event)).toEqual([
      CommEvent.CALL_INCOMING,
      CommEvent.CALL_ACCEPTED,
      CommEvent.CALL_ENDED,
    ]);
    // Every one of them routable, and to the same room.
    expect(new Set(sequence.map((d) => d.room))).toEqual(
      new Set([room.conversation(conversationId)]),
    );
  });

  it('the declined call is a complete sequence too', async () => {
    const { callId } = await directCall();
    await g.calls.decline(callId, s.parentId);
    await g.calls.end(callId, s.teacherId);

    const sequence = (await drain()).filter((d) => d.payload?.callId === callId);
    expect(sequence.map((d) => d.event)).toEqual([
      CommEvent.CALL_INCOMING,
      CommEvent.CALL_DECLINED,
      CommEvent.CALL_ENDED,
    ]);
  });
});

// -------------------------------------------------------------------------
describe('7/8. media presence is not faked from an HTTP accept', () => {
  it('accept emits call.accepted and NOT call.participant_joined', async () => {
    const { callId } = await directCall();
    await drain();

    await g.calls.accept(callId, s.parentId);
    const events = (await drain()).map((d) => d.event);

    expect(events).toContain(CommEvent.CALL_ACCEPTED);
    // participant_joined would assert the device reached the LiveKit room.
    // Nothing here has observed that, and only the media server could.
    expect(events).not.toContain(CommEvent.CALL_PARTICIPANT_JOINED);
  });

  it('nothing in the API emits the media-presence events yet', () => {
    // A tripwire, so faking media presence from an HTTP call becomes a
    // deliberate act rather than a convenience. The emitter, when it exists,
    // will be a LiveKit webhook.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    const emitters = execSync(
      "grep -rn 'CALL_PARTICIPANT_JOINED\\|CALL_PARTICIPANT_LEFT' src || true",
      { cwd: `${__dirname}/../..`, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
      .filter((line) => /enqueue\(/.test(line));

    expect(emitters).toEqual([]);
  });
});

// -------------------------------------------------------------------------
describe('15/16/17. a refused action emits nothing', () => {
  const revoke = () =>
    g.prisma.learner.update({
      where: { id: s.learnerId },
      data: { teacherId: s.unrelatedTeacherId },
    });

  it('an unauthorized accept delivers no call.accepted', async () => {
    const { callId } = await directCall();
    await drain();
    await revoke();

    await expect(g.calls.accept(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.TEACHER_PARENT_NOT_AUTHORIZED,
    });

    expect(await drain()).toEqual([]);
  });

  it('an unauthorized decline delivers no call.declined', async () => {
    const { callId } = await directCall();
    await drain();
    await revoke();

    await expect(g.calls.decline(callId, s.parentId)).rejects.toThrow();
    expect(await drain()).toEqual([]);
  });

  it('an invalid transition delivers nothing: accepting an ended call', async () => {
    const { callId } = await directCall();
    await g.calls.end(callId, s.teacherId);
    await drain();

    await expect(g.calls.accept(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.CALL_ALREADY_ENDED,
    });
    expect(await drain()).toEqual([]);
  });

  it('an unrelated actor accepting delivers nothing', async () => {
    const { callId } = await directCall();
    await drain();

    await expect(g.calls.accept(callId, s.unrelatedTeacherId)).rejects.toThrow();
    expect(await drain()).toEqual([]);
  });
});

// -------------------------------------------------------------------------
describe('13/14. transactional delivery', () => {
  it('a rolled-back transaction leaves no outbox row, so no event is ever deliverable', async () => {
    const { conversationId } = await directCall();
    await drain();

    const before = await g.prisma.outboxEvent.count();

    await expect(
      g.prisma.$transaction(async (tx) => {
        await g.outbox.enqueue(tx, CommEvent.CALL_ACCEPTED, {
          callId: randomUUID(),
          conversationId,
          actorId: s.parentId,
        });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    expect(await g.prisma.outboxEvent.count()).toBe(before);
    expect(await drain()).toEqual([]);
  });

  it('a committed transaction makes the event deliverable, and only then', async () => {
    const { conversationId, callId } = await directCall();
    await drain();

    // Enqueued and committed by accept()'s own transaction.
    await g.calls.accept(callId, s.parentId);

    const pending = await g.prisma.outboxEvent.findMany({ where: { status: 'pending' } });
    expect(pending.some((r) => r.type === CommEvent.CALL_ACCEPTED)).toBe(true);

    const deliveries = await drain();
    expect(
      deliveries.some(
        (d) => d.event === CommEvent.CALL_ACCEPTED && d.room === room.conversation(conversationId),
      ),
    ).toBe(true);
  });
});

// -------------------------------------------------------------------------
describe('18. retry and idempotency', () => {
  it('a drained event is not delivered twice on the next drain', async () => {
    const { callId } = await directCall();
    await g.calls.accept(callId, s.parentId);

    const first = await drain();
    expect(first.filter((d) => d.event === CommEvent.CALL_ACCEPTED)).toHaveLength(1);

    // The row is claimed with a conditional update, so a second drain finds
    // nothing to publish.
    expect(await drain()).toEqual([]);
  });

  it('a failed publish returns the row to the queue and re-delivers it, once', async () => {
    const { callId } = await directCall();
    await g.calls.accept(callId, s.parentId);

    let attempts = 0;
    const flaky: RealtimePublisher = {
      toThread: async (threadId, event, payload) => {
        attempts += 1;
        if (attempts === 1) throw new Error('transient realtime failure');
        await published.toThread(threadId, event as string, payload);
      },
      toUsers: async () => undefined,
    };
    const flakyWorker = new OutboxWorker(
      g.prisma,
      { schedule: async () => undefined } as unknown as NotificationService,
      flaky,
      g.identity,
    );

    published.reset();
    await flakyWorker.drain(100);      // first attempt throws; row goes back to pending
    const failedRows = await g.prisma.outboxEvent.findMany({ where: { status: 'pending' } });
    expect(failedRows.length).toBeGreaterThan(0);

    // Backoff sets available_at in the future; bring it forward to retry now.
    await g.prisma.outboxEvent.updateMany({
      where: { status: 'pending' },
      data: { availableAt: new Date(Date.now() - 1000) },
    });
    await flakyWorker.drain(100);

    // Delivered exactly once despite the failure, and the call state never moved.
    expect(published.deliveries.filter((d) => d.event === CommEvent.CALL_ACCEPTED)).toHaveLength(1);
    const call = await g.prisma.call.findUnique({ where: { id: callId } });
    expect(call?.status).toBe('active');
  });

  it('each outbox row carries a stable id, which is the event identity a consumer can dedupe on', async () => {
    const { callId } = await directCall();
    await g.calls.accept(callId, s.parentId);

    const rows = await g.prisma.outboxEvent.findMany();
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
  });

  it('one state transition enqueues one terminal event, however often it is retried', async () => {
    const { callId } = await directCall();

    // Accept twice (the second is an idempotent no-op) and end once.
    await g.calls.accept(callId, s.parentId);
    await g.calls.accept(callId, s.parentId);
    await g.calls.end(callId, s.teacherId);

    const sequence = (await drain()).filter((d) => d.payload?.callId === callId);
    expect(sequence.filter((d) => d.event === CommEvent.CALL_ACCEPTED)).toHaveLength(1);
    expect(sequence.filter((d) => d.event === CommEvent.CALL_ENDED)).toHaveLength(1);
  });
});

// -------------------------------------------------------------------------
describe('10/11/12. routing is the security boundary', () => {
  it('every call event goes to the conversation room and nowhere else', async () => {
    const { conversationId, callId } = await directCall();
    await g.calls.accept(callId, s.parentId);
    await g.calls.end(callId, s.teacherId);

    const sequence = (await drain()).filter((d) => d.payload?.callId === callId);

    expect(sequence.length).toBeGreaterThan(0);
    for (const delivery of sequence) {
      expect(delivery.room).toBe(room.conversation(conversationId));
      // Never an actor room: a call event is addressed to the conversation, so
      // there is no per-actor fan-out that could be aimed at the wrong actor.
      expect(delivery.room.startsWith('actor:')).toBe(false);
    }
  });

  it('a second conversation\'s call never routes into the first one\'s room', async () => {
    const { conversationId: first } = await directCall();
    const otherConv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    const { callId: otherCall } = await g.calls.start(otherConv.id, s.ownerId);

    const deliveries = await drain();
    const otherDeliveries = deliveries.filter((d) => d.payload?.callId === otherCall);

    expect(otherDeliveries.length).toBeGreaterThan(0);
    for (const delivery of otherDeliveries) {
      expect(delivery.room).toBe(room.conversation(otherConv.id));
      expect(delivery.room).not.toBe(room.conversation(first));
    }
  });

  it('the payload carries only what a client needs, and no media handle', async () => {
    const { callId } = await directCall();
    const incoming = (await drain()).find((d) => d.event === CommEvent.CALL_INCOMING)!;

    // roomName is reachable only through POST /calls/:id/token, together with
    // the token that makes it usable.
    expect(incoming.payload).not.toHaveProperty('roomName');
    expect(Object.keys(incoming.payload).sort()).toEqual([
      'callId', 'conversationId', 'initiatorId', 'initiatorName', 'type',
    ]);
    // And no contact channel, ever (BR-2).
    const serialized = JSON.stringify(incoming.payload);
    expect(serialized).not.toMatch(/@|\+\d{6,}/);
  });

  it('every delivered call event is routable: none is missing its conversationId', async () => {
    // The regression guard for the whole defect. An event without a
    // conversationId is an event nobody receives.
    const { callId } = await directCall();
    await g.calls.accept(callId, s.parentId);
    await g.calls.end(callId, s.teacherId);

    const sequence = (await drain()).filter((d) => d.payload?.callId === callId);
    for (const delivery of sequence) {
      expect(delivery.payload.conversationId).toEqual(expect.any(String));
    }
  });
});
