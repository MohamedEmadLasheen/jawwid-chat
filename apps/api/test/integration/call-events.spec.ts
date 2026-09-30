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
import { randomUUID } from "node:crypto";
import { CommErrorCode } from "@platform/errors";
import { OutboxWorker } from "@communication/outbox/outbox.worker";
import { NotificationService } from "@communication/notifications/notification.service";
import { CommEvent, room } from "@communication/contracts/events";
import type { RealtimePublisher } from "@communication/realtime/realtime.publisher";
import {
  Scenario,
  buildGraph,
  seed,
  truncate,
  withAssignmentGate,
} from "./harness";

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

  async toThread(
    threadId: string,
    event: string,
    payload: unknown,
  ): Promise<void> {
    this.deliveries.push({
      room: room.conversation(threadId),
      event,
      payload: payload as Record<string, unknown>,
    });
  }

  async toUsers(
    actorIds: string[],
    event: string,
    payload: unknown,
  ): Promise<void> {
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

/**
 * The rooms one event reached, asserting no actor was reached TWICE.
 *
 * This is what replaced `toHaveLength(1)` in the idempotency tests. One outbox
 * row now produces one delivery per participant, so a raw count no longer says
 * anything about duplication -- and the set check is stronger than the count
 * ever was: a length of 1 could never have caught the same actor being
 * delivered to twice, and this does.
 */
function roomsOf(deliveries: Delivery[], event: string): Set<string> {
  const rooms = deliveries.filter((d) => d.event === event).map((d) => d.room);
  expect(new Set(rooms).size).toBe(rooms.length);
  return new Set(rooms);
}

/** The actor rooms a direct call's participants are reached in. */
function directCallRooms(): Set<string> {
  return new Set([room.actor(s.parentId), room.actor(s.teacherId)]);
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
    new NotificationService(g.prisma, g.templates, g.quietHours, g.config, {
      send: async () => ({ ok: true }),
    }) as unknown as NotificationService,
    published,
    g.identity,
  );
});
afterAll(async () => {
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  published.reset();
});

// -------------------------------------------------------------------------
describe("the lifecycle a client can follow", () => {
  it("1/2. starting a call delivers call.incoming to every participant's actor room", async () => {
    const { conversationId, callId } = await directCall();

    const deliveries = await drain();
    const incoming = deliveries.filter(
      (d) => d.event === CommEvent.CALL_INCOMING,
    );

    // ONE DELIVERY PER PARTICIPANT, and the rooms are theirs -- not the
    // conversation's. A client cannot subscribe to a call it does not yet know
    // exists, so the room that has to carry this is the one the gateway joined
    // from the authenticated actor.
    expect(incoming).toHaveLength(2);
    expect(new Set(incoming.map((d) => d.room))).toEqual(directCallRooms());
    expect(incoming[0].room).not.toBe(room.conversation(conversationId));
    expect(incoming[0].payload).toEqual({
      callId,
      conversationId,
      type: "direct",
      initiatorId: s.teacherId,
      initiatorName: expect.any(String),
    });
  });

  it("3/4. accepting delivers call.accepted — the event that used to be dropped", async () => {
    const { conversationId, callId } = await directCall();
    await drain(); // clear the incoming event

    await g.calls.accept(callId, s.parentId);
    const deliveries = await drain();

    const accepted = deliveries.filter(
      (d) => d.event === CommEvent.CALL_ACCEPTED,
    );
    // The CALLER needs this one most -- it is how they learn they were
    // answered -- so it reaches both participants, each in their own room.
    expect(accepted).toHaveLength(2);
    expect(new Set(accepted.map((d) => d.room))).toEqual(directCallRooms());
    expect(accepted[0].room).not.toBe(room.conversation(conversationId));
    expect(accepted[0].payload).toEqual({
      callId,
      conversationId,
      actorId: s.parentId,
    });
  });

  it("5/6. declining delivers call.declined — likewise", async () => {
    const { conversationId, callId } = await directCall();
    await drain();

    await g.calls.decline(callId, s.parentId);
    const deliveries = await drain();

    const declined = deliveries.filter(
      (d) => d.event === CommEvent.CALL_DECLINED,
    );
    expect(declined).toHaveLength(2);
    expect(new Set(declined.map((d) => d.room))).toEqual(directCallRooms());
    expect(declined[0].room).not.toBe(room.conversation(conversationId));
    expect(declined[0].payload).toEqual({
      callId,
      conversationId,
      actorId: s.parentId,
    });
  });

  it("9. ending delivers call.ended with the outcome", async () => {
    const { conversationId, callId } = await directCall();
    await g.calls.accept(callId, s.parentId);
    await drain();

    await g.calls.end(callId, s.teacherId);
    const deliveries = await drain();

    const ended = deliveries.filter((d) => d.event === CommEvent.CALL_ENDED);
    expect(ended).toHaveLength(2);
    expect(new Set(ended.map((d) => d.room))).toEqual(directCallRooms());
    expect(ended[0].room).not.toBe(room.conversation(conversationId));
    expect(ended[0].payload).toMatchObject({
      callId,
      conversationId,
      outcome: "answered",
    });
  });

  it("the full answered call is a complete, ordered, routable sequence", async () => {
    const { conversationId, callId } = await directCall();
    await g.calls.accept(callId, s.parentId);
    await g.calls.end(callId, s.teacherId);

    const deliveries = await drain();
    const sequence = deliveries.filter((d) => d.payload?.callId === callId);

    // Each event now lands once per participant, so the ORDER is asserted on
    // the distinct events rather than on the delivery count.
    const order: string[] = [];
    for (const d of sequence) {
      if (order[order.length - 1] !== d.event) order.push(d.event);
    }
    expect(order).toEqual([
      CommEvent.CALL_INCOMING,
      CommEvent.CALL_ACCEPTED,
      CommEvent.CALL_ENDED,
    ]);
    // Every one of them routable, and to the participants -- nobody else.
    expect(new Set(sequence.map((d) => d.room))).toEqual(directCallRooms());
    expect(sequence.every((d) => d.room !== room.conversation(conversationId)))
      .toBe(true);
  });

  it("the declined call is a complete sequence too", async () => {
    const { callId } = await directCall();
    await g.calls.decline(callId, s.parentId);
    // The caller's client hangs up after seeing the refusal. Since W6 the call
    // is already terminal, so this is a no-op and adds no second ending.
    await g.calls.end(callId, s.teacherId);

    const sequence = (await drain()).filter(
      (d) => d.payload?.callId === callId,
    );

    // `call.incoming` is its own transaction and is therefore strictly first.
    expect(sequence[0].event).toBe(CommEvent.CALL_INCOMING);
    // `call.declined` and `call.ended` are enqueued in ONE transaction, so they
    // share `created_at` and the outbox -- which drains `order by created_at` --
    // makes no promise about which of the two it publishes first. The guarantee
    // is that both are delivered, exactly once each, and nothing else is: one
    // says who refused, the other says the call is over, and no consumer needs
    // them ordered. Asserting an order here would be asserting a tie-break the
    // database does not owe us.
    expect([...new Set(sequence.map((d) => d.event))].sort()).toEqual(
      [CommEvent.CALL_INCOMING, CommEvent.CALL_DECLINED, CommEvent.CALL_ENDED].sort(),
    );
    // Three events, each reaching both participants exactly once.
    expect(sequence).toHaveLength(6);
    for (const event of [
      CommEvent.CALL_INCOMING,
      CommEvent.CALL_DECLINED,
      CommEvent.CALL_ENDED,
    ]) {
      expect(roomsOf(sequence, event)).toEqual(directCallRooms());
    }
  });
});

// -------------------------------------------------------------------------
describe("7/8. media presence is not faked from an HTTP accept", () => {
  it("accept emits call.accepted and NOT call.participant_joined", async () => {
    const { callId } = await directCall();
    await drain();

    await g.calls.accept(callId, s.parentId);
    const events = (await drain()).map((d) => d.event);

    expect(events).toContain(CommEvent.CALL_ACCEPTED);
    // participant_joined would assert the device reached the LiveKit room.
    // Nothing here has observed that, and only the media server could.
    expect(events).not.toContain(CommEvent.CALL_PARTICIPANT_JOINED);
  });

  it("the media-presence events have exactly ONE emitter, and it is the webhook", () => {
    // A tripwire, so faking media presence from an HTTP call is a deliberate act
    // rather than a convenience.
    //
    // REWRITTEN 2026-09-27, because the old version had stopped guarding
    // anything. It asserted that NOTHING emitted these events -- true when it was
    // written, false since W5 built `MediaPresenceService` -- and it kept passing
    // only because it grepped for `enqueue(` on the SAME LINE as the constant,
    // and that call spans four lines. A tripwire that cannot see the emitter it
    // exists to watch is worse than no tripwire: it reads as evidence.
    //
    // The real contract, and what is asserted now: these events mean media
    // presence, so the only thing that may enqueue them is the thing that
    // observed it -- the LiveKit webhook's reconciliation. An HTTP accept emits
    // `call.accepted` instead. See API-CONTRACT §3.8/§3.9.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execSync } =
      require("node:child_process") as typeof import("node:child_process");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const root = `${__dirname}/../..`;

    const referencing = execSync(
      "grep -rl 'CommEvent.CALL_PARTICIPANT_JOINED\\|CommEvent.CALL_PARTICIPANT_LEFT' src || true",
      { cwd: root, encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean);
    // The set is non-empty, or the grep itself is what is broken.
    expect(referencing.length).toBeGreaterThan(0);

    // Referencing them is fine -- the outbox worker has to ROUTE them and
    // contracts/events.ts has to declare them. ENQUEUING them is the act.
    const emitters = referencing.filter((file) =>
      /\.enqueue\(/.test(readFileSync(`${root}/${file}`, "utf8")),
    );

    expect(emitters).toEqual([
      "src/communication/calls/media-presence.service.ts",
    ]);
  });
});

// -------------------------------------------------------------------------
describe("15/16/17. a refused action emits nothing", () => {
  const revoke = () =>
    withAssignmentGate(
      g.prisma,
      `update chat.learner set teacher_id = '${s.unrelatedTeacherId}'::uuid
        where id = '${s.learnerId}'::uuid`,
    );

  it("an unauthorized accept delivers no call.accepted", async () => {
    const { callId } = await directCall();
    await drain();
    await revoke();

    await expect(g.calls.accept(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.TEACHER_PARENT_NOT_AUTHORIZED,
    });

    expect(await drain()).toEqual([]);
  });

  it("an unauthorized decline delivers no call.declined", async () => {
    const { callId } = await directCall();
    await drain();
    await revoke();

    await expect(g.calls.decline(callId, s.parentId)).rejects.toThrow();
    expect(await drain()).toEqual([]);
  });

  it("an invalid transition delivers nothing: accepting an ended call", async () => {
    const { callId } = await directCall();
    await g.calls.end(callId, s.teacherId);
    await drain();

    await expect(g.calls.accept(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.CALL_ALREADY_ENDED,
    });
    expect(await drain()).toEqual([]);
  });

  it("an unrelated actor accepting delivers nothing", async () => {
    const { callId } = await directCall();
    await drain();

    await expect(
      g.calls.accept(callId, s.unrelatedTeacherId),
    ).rejects.toThrow();
    expect(await drain()).toEqual([]);
  });
});

// -------------------------------------------------------------------------
describe("13/14. transactional delivery", () => {
  it("a rolled-back transaction leaves no outbox row, so no event is ever deliverable", async () => {
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
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");

    expect(await g.prisma.outboxEvent.count()).toBe(before);
    expect(await drain()).toEqual([]);
  });

  it("a committed transaction makes the event deliverable, and only then", async () => {
    const { conversationId, callId } = await directCall();
    await drain();

    // Enqueued and committed by accept()'s own transaction.
    await g.calls.accept(callId, s.parentId);

    const pending = await g.prisma.outboxEvent.findMany({
      where: { status: "pending" },
    });
    expect(pending.some((r) => r.type === CommEvent.CALL_ACCEPTED)).toBe(true);

    const deliveries = await drain();
    expect(
      deliveries.some(
        (d) =>
          d.event === CommEvent.CALL_ACCEPTED &&
          d.room === room.actor(s.parentId),
      ),
    ).toBe(true);
  });
});

// -------------------------------------------------------------------------
describe("18. retry and idempotency", () => {
  it("a drained event is not delivered twice on the next drain", async () => {
    const { callId } = await directCall();
    await g.calls.accept(callId, s.parentId);

    const first = await drain();
    // Each participant reached exactly once -- `roomsOf` fails if any actor
    // appears twice, which is the duplication this test is about.
    expect(roomsOf(first, CommEvent.CALL_ACCEPTED)).toEqual(directCallRooms());

    // The row is claimed with a conditional update, so a second drain finds
    // nothing to publish.
    expect(await drain()).toEqual([]);
  });

  it("a failed publish returns the row to the queue and re-delivers it, once", async () => {
    const { callId } = await directCall();
    await g.calls.accept(callId, s.parentId);

    let attempts = 0;
    const flaky: RealtimePublisher = {
      toThread: async (threadId, event, payload) => {
        attempts += 1;
        if (attempts === 1) throw new Error("transient realtime failure");
        await published.toThread(threadId, event as string, payload);
      },
      // Call lifecycle events travel by toUsers now, so THIS is the method
      // that has to fail for the retry to be exercised at all. Forwarding it
      // (rather than discarding, as it did while call events went by
      // toThread) is what lets the re-delivery be observed.
      toUsers: async (actorIds, event, payload) => {
        attempts += 1;
        if (attempts === 1) throw new Error("transient realtime failure");
        await published.toUsers(actorIds, event as string, payload);
      },
    };
    const flakyWorker = new OutboxWorker(
      g.prisma,
      { schedule: async () => undefined } as unknown as NotificationService,
      flaky,
      g.identity,
    );

    published.reset();
    await flakyWorker.drain(100); // first attempt throws; row goes back to pending
    const failedRows = await g.prisma.outboxEvent.findMany({
      where: { status: "pending" },
    });
    expect(failedRows.length).toBeGreaterThan(0);

    // Backoff sets available_at in the future; bring it forward to retry now.
    await g.prisma.outboxEvent.updateMany({
      where: { status: "pending" },
      data: { availableAt: new Date(Date.now() - 1000) },
    });
    await flakyWorker.drain(100);

    // Delivered exactly once despite the failure, and the call state never moved.
    expect(
      roomsOf(published.deliveries, CommEvent.CALL_ACCEPTED),
    ).toEqual(directCallRooms());
    const call = await g.prisma.call.findUnique({ where: { id: callId } });
    expect(call?.status).toBe("active");
  });

  it("each outbox row carries a stable id, which is the event identity a consumer can dedupe on", async () => {
    const { callId } = await directCall();
    await g.calls.accept(callId, s.parentId);

    const rows = await g.prisma.outboxEvent.findMany();
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(
      true,
    );
  });

  it("one state transition enqueues one terminal event, however often it is retried", async () => {
    const { callId } = await directCall();

    // Accept twice (the second is an idempotent no-op) and end once.
    await g.calls.accept(callId, s.parentId);
    await g.calls.accept(callId, s.parentId);
    await g.calls.end(callId, s.teacherId);

    const sequence = (await drain()).filter(
      (d) => d.payload?.callId === callId,
    );
    // One transition, one event -- now read as "each participant once".
    expect(roomsOf(sequence, CommEvent.CALL_ACCEPTED)).toEqual(directCallRooms());
    expect(roomsOf(sequence, CommEvent.CALL_ENDED)).toEqual(directCallRooms());
  });
});

// -------------------------------------------------------------------------
describe("10/11/12. routing is the security boundary", () => {
  it("every call event goes to a participant's actor room and nowhere else", async () => {
    const { conversationId, callId } = await directCall();
    await g.calls.accept(callId, s.parentId);
    await g.calls.end(callId, s.teacherId);

    const sequence = (await drain()).filter(
      (d) => d.payload?.callId === callId,
    );

    expect(sequence.length).toBeGreaterThan(0);
    for (const delivery of sequence) {
      // A PARTICIPANT'S OWN ROOM, and the gateway joins that room from the
      // resolved actor -- so a forged handshake cannot land a socket in it.
      expect(directCallRooms().has(delivery.room)).toBe(true);
      // NEVER the conversation room. That room is every member who passed
      // canRead, which is a wider set than the call's participants.
      expect(delivery.room).not.toBe(room.conversation(conversationId));
      expect(delivery.room.startsWith("actor:")).toBe(true);
    }
  });

  it("a second call reaches ITS participants only, never the first call's", async () => {
    // The stronger form of the old cross-conversation check. The teacher is a
    // member of the first conversation and a participant of the first call;
    // they are neither for the second. Under conversation-room routing the
    // guarantee was "a different room"; under participant routing it is "a
    // different set of PEOPLE", which is the property that actually matters.
    const { callId: firstCall } = await directCall();
    const otherConv = await g.conversations.getOrCreateDirect(
      s.parentId,
      s.ownerId,
    );
    const { callId: otherCall } = await g.calls.start(otherConv.id, s.ownerId);

    const deliveries = await drain();
    const otherDeliveries = deliveries.filter(
      (d) => d.payload?.callId === otherCall,
    );
    const firstDeliveries = deliveries.filter(
      (d) => d.payload?.callId === firstCall,
    );

    expect(otherDeliveries.length).toBeGreaterThan(0);
    expect(new Set(otherDeliveries.map((d) => d.room))).toEqual(
      new Set([room.actor(s.parentId), room.actor(s.ownerId)]),
    );
    // The teacher is on the FIRST call and hears nothing of the second.
    expect(
      otherDeliveries.some((d) => d.room === room.actor(s.teacherId)),
    ).toBe(false);
    // And the owner, who is on the second, hears nothing of the first.
    expect(
      firstDeliveries.some((d) => d.room === room.actor(s.ownerId)),
    ).toBe(false);
  });

  it("a SILENT conversation member is not a participant and hears nothing", async () => {
    // The widening the old routing had. `conversation:<id>` is every member who
    // passed canRead; `CallService.start` excludes silent members from the
    // participant set. So a silent member used to be told about a call they
    // were not on and could not join. Now membership alone delivers nothing.
    const group = await g.conversations.ensureStudentGroup(
      s.learnerId,
      s.ownerId,
    );
    await g.prisma.conversationMember.updateMany({
      where: { conversationId: group.id, actorId: s.parentId },
      data: { isSilent: true },
    });

    const { callId } = await g.calls.start(group.id, s.ownerId);
    const deliveries = (await drain()).filter(
      (d) => d.payload?.callId === callId,
    );

    expect(deliveries.length).toBeGreaterThan(0);
    expect(
      deliveries.some((d) => d.room === room.actor(s.parentId)),
    ).toBe(false);
    // And the participant rows agree -- one derivation, not two.
    const participants = await g.prisma.callParticipant.findMany({
      where: { callId },
      select: { actorId: true },
    });
    expect(participants.map((p) => p.actorId)).not.toContain(s.parentId);
    expect(new Set(deliveries.map((d) => d.room))).toEqual(
      new Set(participants.map((p) => room.actor(p.actorId))),
    );
  });

  it("an actor outside the call receives nothing, however it is asked for",
    async () => {
      // Non-participants, each unrelated to this call in a different way.
      const { callId } = await directCall();
      await g.calls.accept(callId, s.parentId);
      await g.calls.end(callId, s.teacherId);

      const deliveries = (await drain()).filter(
        (d) => d.payload?.callId === callId,
      );

      for (const outsider of [
        s.otherParentId,
        s.unrelatedTeacherId,
        s.ownerId,
        s.otherAdminId,
      ]) {
        expect(
          deliveries.some((d) => d.room === room.actor(outsider)),
        ).toBe(false);
      }
    });

  it("the recipient set is the call's own rows, not the payload", async () => {
    // THE INVARIANT THIS WORKSTREAM EXISTS FOR. An outbox payload naming a
    // different conversation -- the shape a forged or replayed event would
    // take -- cannot redirect delivery, because the audience is read from
    // chat.call_participant for the call id and from nothing else.
    const { callId } = await directCall();
    const elsewhere = await g.conversations.getOrCreateDirect(
      s.parentId,
      s.ownerId,
    );
    await g.prisma.outboxEvent.updateMany({
      where: { type: CommEvent.CALL_INCOMING, status: "pending" },
      data: {
        payload: {
          callId,
          conversationId: elsewhere.id,
          type: "direct",
          initiatorId: s.otherAdminId,
          initiatorName: "forged",
        },
      },
    });

    const deliveries = (await drain()).filter(
      (d) => d.event === CommEvent.CALL_INCOMING,
    );

    // The forged conversationId and initiatorId changed NOTHING about who was
    // reached: still the two real participants, still their own actor rooms.
    expect(new Set(deliveries.map((d) => d.room))).toEqual(directCallRooms());
    expect(
      deliveries.some((d) => d.room === room.actor(s.otherAdminId)),
    ).toBe(false);
    expect(
      deliveries.some((d) => d.room === room.conversation(elsewhere.id)),
    ).toBe(false);
  });

  it("media presence still routes to the conversation, unchanged", async () => {
    // W8-W0b moved the four LIFECYCLE events only. participant_joined and
    // participant_left mean "LiveKit observed this", are only meaningful to a
    // client already in the call, and keep the routing they have always had.
    const { conversationId, callId } = await directCall();
    await drain();

    await g.prisma.outboxEvent.create({
      data: {
        type: CommEvent.CALL_PARTICIPANT_JOINED,
        payload: { callId, conversationId, actorId: s.parentId },
        status: "pending",
      },
    });

    const deliveries = (await drain()).filter(
      (d) => d.event === CommEvent.CALL_PARTICIPANT_JOINED,
    );

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].room).toBe(room.conversation(conversationId));
  });

  it("the payload carries only what a client needs, and no media handle", async () => {
    const { callId } = await directCall();
    const incoming = (await drain()).find(
      (d) => d.event === CommEvent.CALL_INCOMING,
    )!;

    // roomName is reachable only through POST /calls/:id/token, together with
    // the token that makes it usable.
    expect(incoming.payload).not.toHaveProperty("roomName");
    expect(Object.keys(incoming.payload).sort()).toEqual([
      "callId",
      "conversationId",
      "initiatorId",
      "initiatorName",
      "type",
    ]);
    // And no contact channel, ever (BR-2).
    const serialized = JSON.stringify(incoming.payload);
    expect(serialized).not.toMatch(/@|\+\d{6,}/);
  });

  it("every delivered call event is routable: none is missing its conversationId", async () => {
    // The regression guard for the whole defect. An event without a
    // conversationId is an event nobody receives.
    const { callId } = await directCall();
    await g.calls.accept(callId, s.parentId);
    await g.calls.end(callId, s.teacherId);

    const sequence = (await drain()).filter(
      (d) => d.payload?.callId === callId,
    );
    for (const delivery of sequence) {
      expect(delivery.payload.conversationId).toEqual(expect.any(String));
    }
  });
});
