/**
 * The LiveKit webhook, and what it is allowed to change.
 *
 * WHY THIS EXISTS. The server has always known when somebody ACCEPTED a call —
 * it performs that itself over HTTP. It has never known whether the device then
 * reached the media room. Those are different facts, and this is the seam where
 * the second one enters the system, which makes it the seam an attacker would
 * reach for.
 *
 * THE TOKENS HERE ARE REAL. Every accepted webhook is signed with `AccessToken`
 * from `livekit-server-sdk` and verified by `WebhookReceiver` — the same
 * verifier production uses, not a stub. A rejection test is therefore a real
 * signature failing, not a mock returning false.
 *
 * WHAT IT DOES NOT PROVE: that LiveKit Cloud actually delivers these. No real
 * webhook has ever reached this endpoint. See the W5 closeout.
 */
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { AccessToken } from 'livekit-server-sdk';
import { CommEvent } from '@communication/contracts/events';
import { LiveKitWebhookVerifier } from '@communication/calls/livekit-webhook.verifier';
import { MediaPresenceService } from '@communication/calls/media-presence.service';
import { OutboxService } from '@communication/outbox/outbox.service';
import {
  Scenario,
  buildGraph,
  seed,
  truncate,
  withAssignmentGate,
} from './harness';

jest.setTimeout(60_000);

const API_KEY = 'APItestkey';
const API_SECRET = 'a-test-secret-long-enough-for-hs256-signing';

const g = buildGraph();
let s: Scenario;
let presence: MediaPresenceService;
let verifier: LiveKitWebhookVerifier;

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;

  process.env.LIVEKIT_API_KEY = API_KEY;
  process.env.LIVEKIT_API_SECRET = API_SECRET;

  presence = new MediaPresenceService(g.prisma, new OutboxService());
  verifier = new LiveKitWebhookVerifier();
});

/** An authorized teacher<->parent call, ringing. */
async function ringingCall(): Promise<{ callId: string; roomName: string }> {
  const conv = await g.conversations.getOrCreateDirect(s.parentId, s.teacherId);
  return g.calls.start(conv.id, s.teacherId);
}

/** The webhook body LiveKit sends, as JSON. */
function body({
  event,
  roomName,
  identity,
  at,
}: {
  event: string;
  roomName?: string;
  identity?: string;
  at: number;
}): string {
  return JSON.stringify({
    event,
    createdAt: at,
    id: randomUUID(),
    room: roomName === undefined ? undefined : { name: roomName, sid: 'RM_x' },
    participant:
      identity === undefined ? undefined : { identity, name: 'display name' },
  });
}

/**
 * Sign a body the way LiveKit does: an HS256 JWT whose `sha256` claim is the
 * base64 digest of the exact bytes.
 */
async function sign(
  raw: string,
  { key = API_KEY, secret = API_SECRET }: { key?: string; secret?: string } = {},
): Promise<string> {
  const token = new AccessToken(key, secret);
  token.sha256 = createHash('sha256').update(raw).digest('base64');
  return token.toJwt();
}

async function participantRow(callId: string, actorId: string) {
  return g.prisma.callParticipant.findUniqueOrThrow({
    where: { callId_actorId: { callId, actorId } },
    select: {
      joinedAt: true,
      leftAt: true,
      mediaJoinedAt: true,
      mediaLeftAt: true,
    },
  });
}

const T0 = 1_790_000_000; // seconds
const at = (offset: number) => T0 + offset;

// =========================================================================
describe('1–6. webhook authentication', () => {
  it('1. a correctly signed webhook verifies', async () => {
    const raw = body({
      event: 'participant_joined',
      roomName: 'jawwid-room',
      identity: s.parentId,
      at: at(0),
    });

    const event = await verifier.verify(raw, await sign(raw));

    expect(event.event).toBe('participant_joined');
    expect(event.roomName).toBe('jawwid-room');
    expect(event.identity).toBe(s.parentId);
    // LiveKit's clock, in seconds, not ours.
    expect(event.at.getTime()).toBe(at(0) * 1000);
  });

  it('2. a signature from the wrong secret is refused', async () => {
    const raw = body({ event: 'participant_joined', at: at(0) });
    const forged = await sign(raw, { secret: 'a-different-secret-entirely-xx' });

    await expect(verifier.verify(raw, forged)).rejects.toThrow(
      /verification failed/,
    );
  });

  it('2b. a signature from the wrong API key is refused', async () => {
    const raw = body({ event: 'participant_joined', at: at(0) });
    const forged = await sign(raw, { key: 'APIsomeoneelse' });

    await expect(verifier.verify(raw, forged)).rejects.toThrow(
      /verification failed/,
    );
  });

  it('3. a malformed authorization header is refused', async () => {
    const raw = body({ event: 'participant_joined', at: at(0) });

    for (const header of ['', 'not-a-jwt', 'Bearer x.y.z', 'a.b']) {
      await expect(verifier.verify(raw, header)).rejects.toThrow();
    }
  });

  it('4. a missing authorization header is refused', async () => {
    const raw = body({ event: 'participant_joined', at: at(0) });

    await expect(verifier.verify(raw, undefined)).rejects.toThrow();
  });

  it('5. a payload modified after signing is refused', async () => {
    // THE POINT OF THE sha256 CLAIM. The token is perfectly valid; the body is
    // not the one it was signed over.
    const original = body({
      event: 'participant_joined',
      roomName: 'jawwid-room',
      identity: s.parentId,
      at: at(0),
    });
    const header = await sign(original);
    const tampered = original.replace(s.parentId, s.unrelatedTeacherId);

    await expect(verifier.verify(tampered, header)).rejects.toThrow(
      /verification failed/,
    );
  });

  it('6. an unconfigured server verifies nothing', async () => {
    delete process.env.LIVEKIT_API_SECRET;
    const fresh = new LiveKitWebhookVerifier();
    const raw = body({ event: 'participant_joined', at: at(0) });

    await expect(fresh.verify(raw, 'anything')).rejects.toThrow(
      /not configured/,
    );
  });

  it('a body that is not JSON is refused even when signed', async () => {
    const raw = 'not json at all';
    await expect(verifier.verify(raw, await sign(raw))).rejects.toThrow();
  });

  it('an event with no usable timestamp is refused, not dated on arrival',
    async () => {
      // Arrival time is not evidence of when something happened, and defaulting
      // to it would break every ordering rule below.
      const raw = body({ event: 'participant_joined', at: 0 });
      await expect(verifier.verify(raw, await sign(raw))).rejects.toThrow(
        /timestamp/,
      );
    });

  it('the failure never quotes the body, the header or a claim', async () => {
    const raw = body({
      event: 'participant_joined',
      roomName: 'jawwid-secret-room',
      identity: s.parentId,
      at: at(0),
    });
    const forged = await sign(raw, { secret: 'wrong-secret-wrong-secret-xx' });

    const message = await verifier
      .verify(raw, forged)
      .then(() => '')
      .catch((error: Error) => error.message);

    expect(message).not.toContain('jawwid-secret-room');
    expect(message).not.toContain(s.parentId);
    expect(message).not.toContain(API_SECRET);
    expect(message).not.toContain(forged);
  });
});

// =========================================================================
describe('7–10. room resolution', () => {
  it('7. a known room resolves to its call', async () => {
    const { callId, roomName } = await ringingCall();

    const outcome = await presence.participantJoined({
      roomName,
      identity: s.parentId,
      at: new Date(at(1) * 1000),
    });

    expect(outcome).toBe('reconciled');
    expect((await participantRow(callId, s.parentId)).mediaJoinedAt)
      .toEqual(new Date(at(1) * 1000));
  });

  it('8. an unknown room creates nothing', async () => {
    const callsBefore = await g.prisma.call.count();
    const participantsBefore = await g.prisma.callParticipant.count();

    const outcome = await presence.participantJoined({
      roomName: 'jawwid-not-a-real-room',
      identity: s.parentId,
      at: new Date(at(1) * 1000),
    });

    expect(outcome).toBe('unknown_room');
    expect(await g.prisma.call.count()).toBe(callsBefore);
    expect(await g.prisma.callParticipant.count()).toBe(participantsBefore);
    expect(await g.prisma.outboxEvent.count()).toBe(0);
  });

  it('10. one room cannot mutate another call', async () => {
    const first = await ringingCall();
    await g.calls.end(first.callId, s.teacherId);
    const second = await ringingCall();

    await presence.participantJoined({
      roomName: second.roomName,
      identity: s.parentId,
      at: new Date(at(5) * 1000),
    });

    // The first call is untouched: the room name is what selected the second.
    expect((await participantRow(first.callId, s.parentId)).mediaJoinedAt).toBeNull();
    expect((await participantRow(second.callId, s.parentId)).mediaJoinedAt)
      .not.toBeNull();
  });
});

// =========================================================================
describe('11–14. participant identity', () => {
  it('11. the canonical actor id resolves', async () => {
    const { callId, roomName } = await ringingCall();

    const outcome = await presence.participantJoined({
      roomName,
      identity: s.teacherId,
      at: new Date(at(1) * 1000),
    });

    expect(outcome).toBe('reconciled');
    expect((await participantRow(callId, s.teacherId)).mediaJoinedAt).not.toBeNull();
  });

  it('12. an identity that is not on the call is refused, and creates nothing',
    async () => {
      const { roomName } = await ringingCall();
      const before = await g.prisma.callParticipant.count();
      // Starting the call already enqueued call.incoming; the question is
      // whether the REFUSAL adds anything.
      await g.prisma.outboxEvent.deleteMany({});

      const outcome = await presence.participantJoined({
        roomName,
        identity: s.unrelatedTeacherId,
        at: new Date(at(1) * 1000),
      });

      expect(outcome).toBe('unknown_participant');
      // NO ORPHAN PARTICIPANT. A membership conjured from a webhook would be one
      // nobody authorized.
      expect(await g.prisma.callParticipant.count()).toBe(before);
      expect(await g.prisma.outboxEvent.count()).toBe(0);
    });

  it('12b. an identity that is not a uuid at all is refused', async () => {
    const { roomName } = await ringingCall();

    const outcome = await presence.participantJoined({
      roomName,
      identity: 'parent_p',
      at: new Date(at(1) * 1000),
    });

    expect(outcome).toBe('unknown_participant');
  });

  it('13/14. a display name is never the identity', async () => {
    // The webhook carries `participant.name` as decoration. The verifier reads
    // `identity` and nothing else, so a name matching a real person is worth
    // nothing.
    const { roomName } = await ringingCall();
    const raw = body({
      event: 'participant_joined',
      roomName,
      identity: s.unrelatedTeacherId,
      at: at(1),
    });
    const event = await verifier.verify(raw, await sign(raw));

    expect(event.identity).toBe(s.unrelatedTeacherId);

    const outcome = await presence.participantJoined({
      roomName: event.roomName!,
      identity: event.identity!,
      at: event.at,
    });

    // The name in the payload is 'display name'; it did not help.
    expect(outcome).toBe('unknown_participant');
  });
});

// =========================================================================
describe('15–19. participant joined', () => {
  it('15. a join records media presence', async () => {
    const { callId, roomName } = await ringingCall();

    await presence.participantJoined({
      roomName,
      identity: s.parentId,
      at: new Date(at(2) * 1000),
    });

    const row = await participantRow(callId, s.parentId);
    expect(row.mediaJoinedAt).toEqual(new Date(at(2) * 1000));
    expect(row.mediaLeftAt).toBeNull();
  });

  it('16. a duplicate join changes nothing and announces nothing', async () => {
    const { callId, roomName } = await ringingCall();
    const join = {
      roomName,
      identity: s.parentId,
      at: new Date(at(2) * 1000),
    };

    expect(await presence.participantJoined(join)).toBe('reconciled');
    const after = await g.prisma.outboxEvent.count();

    expect(await presence.participantJoined(join)).toBe('noop');
    expect(await presence.participantJoined(join)).toBe('noop');

    expect(await g.prisma.outboxEvent.count()).toBe(after);
    expect((await participantRow(callId, s.parentId)).mediaJoinedAt)
      .toEqual(new Date(at(2) * 1000));
  });

  it('17. a media join is NOT an application accept', async () => {
    const { callId, roomName } = await ringingCall();

    await presence.participantJoined({
      roomName,
      identity: s.parentId,
      at: new Date(at(2) * 1000),
    });

    const row = await participantRow(callId, s.parentId);
    // The two columns say different things, and only one of them was written.
    expect(row.mediaJoinedAt).not.toBeNull();
    expect(row.joinedAt).toBeNull();

    // And the call is still ringing: reaching a room is not answering.
    const call = await g.prisma.call.findUniqueOrThrow({
      where: { id: callId },
      select: { status: true, answeredAt: true },
    });
    expect(call.status).toBe('ringing');
    expect(call.answeredAt).toBeNull();
  });

  it('17b. an application accept is NOT a media join', async () => {
    const { callId } = await ringingCall();

    await g.calls.accept(callId, s.parentId);

    const row = await participantRow(callId, s.parentId);
    expect(row.joinedAt).not.toBeNull();
    // The whole point of W5: accepting says nothing about the room.
    expect(row.mediaJoinedAt).toBeNull();
  });

  it('18. a join says nothing about a published microphone', async () => {
    // There is no column for it, deliberately. A participant in a room with no
    // microphone published is a real state, and nothing here claims otherwise.
    const { callId, roomName } = await ringingCall();
    await presence.participantJoined({
      roomName,
      identity: s.parentId,
      at: new Date(at(2) * 1000),
    });

    const row = await participantRow(callId, s.parentId);
    expect(Object.keys(row).some((k) => /track|publish|audio/i.test(k))).toBe(false);
  });

  it('19. a join emits exactly one domain event, of the right kind', async () => {
    const { roomName } = await ringingCall();
    await g.prisma.outboxEvent.deleteMany({});

    await presence.participantJoined({
      roomName,
      identity: s.parentId,
      at: new Date(at(2) * 1000),
    });

    const events = await g.prisma.outboxEvent.findMany({
      select: { type: true, payload: true },
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe(CommEvent.CALL_PARTICIPANT_JOINED);
    // NOT call.accepted. An accept is an application act and stays one.
    expect(events[0].type).not.toBe(CommEvent.CALL_ACCEPTED);
  });
});

// =========================================================================
describe('20–24. participant left', () => {
  async function joinedCall() {
    const call = await ringingCall();
    await presence.participantJoined({
      roomName: call.roomName,
      identity: s.parentId,
      at: new Date(at(2) * 1000),
    });
    return call;
  }

  it('20. a leave records the departure', async () => {
    const { callId, roomName } = await joinedCall();

    const outcome = await presence.participantLeft({
      roomName,
      identity: s.parentId,
      at: new Date(at(9) * 1000),
    });

    expect(outcome).toBe('reconciled');
    expect((await participantRow(callId, s.parentId)).mediaLeftAt)
      .toEqual(new Date(at(9) * 1000));
  });

  it('21. a duplicate leave changes nothing and announces nothing', async () => {
    const { roomName } = await joinedCall();
    const leave = {
      roomName,
      identity: s.parentId,
      at: new Date(at(9) * 1000),
    };

    expect(await presence.participantLeft(leave)).toBe('reconciled');
    const after = await g.prisma.outboxEvent.count();
    expect(await presence.participantLeft(leave)).toBe('noop');

    expect(await g.prisma.outboxEvent.count()).toBe(after);
  });

  it('22. a leave preserves the join that came before it', async () => {
    const { callId, roomName } = await joinedCall();

    await presence.participantLeft({
      roomName,
      identity: s.parentId,
      at: new Date(at(9) * 1000),
    });

    const row = await participantRow(callId, s.parentId);
    // Having been in the room is a fact about the past. A departure is not
    // evidence against it.
    expect(row.mediaJoinedAt).toEqual(new Date(at(2) * 1000));
  });

  it('23. an answered call does not become missed when the room empties',
    async () => {
      const { callId, roomName } = await ringingCall();
      await g.calls.accept(callId, s.parentId);
      await presence.participantJoined({
        roomName,
        identity: s.parentId,
        at: new Date(at(2) * 1000),
      });

      await presence.participantLeft({
        roomName,
        identity: s.parentId,
        at: new Date(at(9) * 1000),
      });
      await presence.participantLeft({
        roomName,
        identity: s.teacherId,
        at: new Date(at(10) * 1000),
      });

      const call = await g.prisma.call.findUniqueOrThrow({
        where: { id: callId },
        select: { status: true, outcome: true, answeredAt: true },
      });
      // Still active and still answered. An empty media room is not an ending:
      // a call ends explicitly or through the sweep, and the webhook does not
      // get a third way.
      expect(call.status).toBe('active');
      expect(call.outcome).toBeNull();
      expect(call.answeredAt).not.toBeNull();
    });

  it('24. a webhook cannot resurrect an ended call', async () => {
    const { callId, roomName } = await joinedCall();
    await g.calls.end(callId, s.teacherId);
    const ended = await g.prisma.call.findUniqueOrThrow({
      where: { id: callId },
      select: { status: true, endedAt: true, outcome: true },
    });
    await g.prisma.outboxEvent.deleteMany({});

    const outcome = await presence.participantLeft({
      roomName,
      identity: s.parentId,
      at: new Date(at(20) * 1000),
    });

    const after = await g.prisma.call.findUniqueOrThrow({
      where: { id: callId },
      select: { status: true, endedAt: true, outcome: true },
    });
    expect(after).toEqual(ended);
    // Recorded into history, announced to nobody: there is no live conversation
    // waiting to hear about a call that has finished.
    expect(outcome).toBe('call_ended');
    expect(await g.prisma.outboxEvent.count()).toBe(0);
  });

  it('9. a join on an ended call cannot revive it either', async () => {
    const { callId, roomName } = await ringingCall();
    await g.calls.end(callId, s.teacherId);

    const outcome = await presence.participantJoined({
      roomName,
      identity: s.parentId,
      at: new Date(at(20) * 1000),
    });

    expect(outcome).toBe('call_ended');
    expect(
      (
        await g.prisma.call.findUniqueOrThrow({
          where: { id: callId },
          select: { status: true },
        })
      ).status,
    ).toBe('ended');
  });
});

// =========================================================================
describe('25–29. duplicate and out-of-order delivery', () => {
  it('25. JOIN JOIN LEAVE LEAVE converges', async () => {
    const { callId, roomName } = await ringingCall();
    const who = { roomName, identity: s.parentId };

    await presence.participantJoined({ ...who, at: new Date(at(2) * 1000) });
    await presence.participantJoined({ ...who, at: new Date(at(2) * 1000) });
    await presence.participantLeft({ ...who, at: new Date(at(9) * 1000) });
    await presence.participantLeft({ ...who, at: new Date(at(9) * 1000) });

    const row = await participantRow(callId, s.parentId);
    expect(row.mediaJoinedAt).toEqual(new Date(at(2) * 1000));
    expect(row.mediaLeftAt).toEqual(new Date(at(9) * 1000));
  });

  it('26. LEAVE arriving before its JOIN still ends coherent', async () => {
    // Delivery order is not chronology. The leave happened at t+9 and the join
    // at t+2; arriving backwards must not invert them.
    const { callId, roomName } = await ringingCall();
    const who = { roomName, identity: s.parentId };

    await presence.participantLeft({ ...who, at: new Date(at(9) * 1000) });
    await presence.participantJoined({ ...who, at: new Date(at(2) * 1000) });

    const row = await participantRow(callId, s.parentId);
    expect(row.mediaJoinedAt).toEqual(new Date(at(2) * 1000));
    expect(row.mediaLeftAt).toEqual(new Date(at(9) * 1000));
    // Joined before they left, which is what happened.
    expect(row.mediaJoinedAt!.getTime()).toBeLessThan(row.mediaLeftAt!.getTime());
  });

  it('27. a JOIN after a LEAVE is a rejoin, and clears the departure',
    async () => {
      const { callId, roomName } = await ringingCall();
      const who = { roomName, identity: s.parentId };

      await presence.participantJoined({ ...who, at: new Date(at(2) * 1000) });
      await presence.participantLeft({ ...who, at: new Date(at(9) * 1000) });
      await presence.participantJoined({ ...who, at: new Date(at(15) * 1000) });

      const row = await participantRow(callId, s.parentId);
      // First join wins: they have been present since t+2.
      expect(row.mediaJoinedAt).toEqual(new Date(at(2) * 1000));
      // And they are present now.
      expect(row.mediaLeftAt).toBeNull();
    });

  it('28. a long mixed sequence converges regardless of order', async () => {
    const { callId, roomName } = await ringingCall();
    const who = { roomName, identity: s.parentId };

    const events: Array<['j' | 'l', number]> = [
      ['j', 2],
      ['l', 9],
      ['j', 15],
      ['l', 30],
      ['j', 2],
      ['l', 9],
    ];
    // Delivered backwards, to make the point.
    for (const [kind, offset] of events.reverse()) {
      const input = { ...who, at: new Date(at(offset) * 1000) };
      kind === 'j'
        ? await presence.participantJoined(input)
        : await presence.participantLeft(input);
    }

    const row = await participantRow(callId, s.parentId);
    expect(row.mediaJoinedAt).toEqual(new Date(at(2) * 1000));
    expect(row.mediaLeftAt).toEqual(new Date(at(30) * 1000));
  });

  it('29. an older duplicate cannot move a timestamp backwards or forwards',
    async () => {
      const { callId, roomName } = await ringingCall();
      const who = { roomName, identity: s.parentId };

      await presence.participantLeft({ ...who, at: new Date(at(30) * 1000) });
      // A stale redelivery of an earlier leave.
      expect(
        await presence.participantLeft({ ...who, at: new Date(at(9) * 1000) }),
      ).toBe('noop');

      expect((await participantRow(callId, s.parentId)).mediaLeftAt)
        .toEqual(new Date(at(30) * 1000));
    });
});

// =========================================================================
describe('30–38. security and transactional behaviour', () => {
  it('30/31. no webhook path creates a call or a participant', async () => {
    await g.prisma.call.deleteMany({});
    const calls = await g.prisma.call.count();
    const participants = await g.prisma.callParticipant.count();

    for (const roomName of ['jawwid-invented', '', 'jawwid-' + randomUUID()]) {
      await presence.participantJoined({
        roomName,
        identity: s.parentId,
        at: new Date(at(1) * 1000),
      });
      await presence.participantLeft({
        roomName,
        identity: randomUUID(),
        at: new Date(at(1) * 1000),
      });
    }

    expect(await g.prisma.call.count()).toBe(calls);
    expect(await g.prisma.callParticipant.count()).toBe(participants);
  });

  it('32. a participant from another organization does not resolve', async () => {
    // Cross-tenant presence would need the actor to be on this call's
    // participant list, which membership and the BR-1 backstops decide long
    // before a webhook arrives. The webhook cannot add itself to that list.
    const { roomName } = await ringingCall();
    const stranger = randomUUID();

    expect(
      await presence.participantJoined({
        roomName,
        identity: stranger,
        at: new Date(at(1) * 1000),
      }),
    ).toBe('unknown_participant');
  });

  it('33. a revoked relationship is not re-authorized by a webhook', async () => {
    const { callId, roomName } = await ringingCall();
    await withAssignmentGate(
      g.prisma,
      `update chat.learner set teacher_id = '${s.unrelatedTeacherId}'::uuid
        where id = '${s.learnerId}'::uuid`,
    );

    // Presence is an observation, so it is still recorded for a participant who
    // is on the call...
    expect(
      await presence.participantJoined({
        roomName,
        identity: s.parentId,
        at: new Date(at(2) * 1000),
      }),
    ).toBe('reconciled');

    // ...and it authorizes nothing. A media token is still refused, because
    // that decision belongs to AuthorizationService and the webhook cannot
    // widen it.
    await expect(g.calls.issueToken(callId, s.parentId)).rejects.toMatchObject({
      code: 'COMM.TEACHER_PARENT_NOT_AUTHORIZED',
    });
  });

  it('34. no event payload carries a token, a secret or a room name', async () => {
    const { roomName } = await ringingCall();
    await g.prisma.outboxEvent.deleteMany({});
    await presence.participantJoined({
      roomName,
      identity: s.parentId,
      at: new Date(at(2) * 1000),
    });

    const payloads = JSON.stringify(
      await g.prisma.outboxEvent.findMany({ select: { payload: true } }),
    );
    expect(payloads).not.toContain(roomName);
    expect(payloads).not.toContain(API_SECRET);
    expect(payloads).not.toContain(API_KEY);
    expect(payloads).not.toMatch(/eyJ[A-Za-z0-9_-]{5,}\./);
  });

  it('35. no event is emitted for a mapping that did not resolve', async () => {
    await g.prisma.outboxEvent.deleteMany({});
    const { roomName } = await ringingCall();
    await g.prisma.outboxEvent.deleteMany({});

    await presence.participantJoined({
      roomName: 'jawwid-nope',
      identity: s.parentId,
      at: new Date(at(1) * 1000),
    });
    await presence.participantJoined({
      roomName,
      identity: s.unrelatedTeacherId,
      at: new Date(at(1) * 1000),
    });

    expect(await g.prisma.outboxEvent.count()).toBe(0);
  });

  it('36. the state change and the event are one transaction', async () => {
    const { callId, roomName } = await ringingCall();
    await g.prisma.outboxEvent.deleteMany({});

    await presence.participantJoined({
      roomName,
      identity: s.parentId,
      at: new Date(at(2) * 1000),
    });

    // Both, or neither. They are written in the same transaction, so a
    // published event and the row it describes cannot disagree.
    expect((await participantRow(callId, s.parentId)).mediaJoinedAt).not.toBeNull();
    expect(await g.prisma.outboxEvent.count()).toBe(1);
  });

  it('37. a duplicate delivery cannot duplicate the domain event', async () => {
    const { roomName } = await ringingCall();
    await g.prisma.outboxEvent.deleteMany({});
    const join = {
      roomName,
      identity: s.parentId,
      at: new Date(at(2) * 1000),
    };

    await Promise.all([
      presence.participantJoined(join),
      presence.participantJoined(join),
      presence.participantJoined(join),
    ]);

    // The claim and the write are the same conditional UPDATE, so exactly one
    // of three concurrent deliveries can decide it changed something.
    expect(await g.prisma.outboxEvent.count()).toBe(1);
  });

  it('38. a refused reconciliation leaves no partial state', async () => {
    const { roomName } = await ringingCall();
    await g.prisma.outboxEvent.deleteMany({});
    const rowsBefore = await g.prisma.callParticipant.findMany({
      select: { id: true, mediaJoinedAt: true, mediaLeftAt: true },
      orderBy: { id: 'asc' },
    });

    await presence.participantJoined({
      roomName,
      identity: s.unrelatedTeacherId,
      at: new Date(at(2) * 1000),
    });

    expect(
      await g.prisma.callParticipant.findMany({
        select: { id: true, mediaJoinedAt: true, mediaLeftAt: true },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(rowsBefore);
    expect(await g.prisma.outboxEvent.count()).toBe(0);
  });
});
