/**
 * THE CALL LIFECYCLE, RECONCILED AGAINST REAL MEDIA EVENTS (W6).
 *
 * W6 changed one thing and hardened two. What it changed:
 *
 *   decline() used to mark the participant and leave the CALL ringing. The
 *   ring-timeout sweep collected it seconds later and wrote
 *   `outcome = 'missed'` -- so a call the callee had explicitly REFUSED was
 *   recorded as one they never saw, `notifyMissedCall` then pushed a
 *   "missed call" to the person who had just declined it, and the `declined`
 *   outcome the schema defines was unreachable from the decline endpoint.
 *   A decline is now the terminal transition itself.
 *
 * What it hardened: `end()` gained a terminal guard and now derives the outcome
 * from LOCKED state, so nothing can overwrite an ending that already happened.
 *
 * WHAT IT DELIBERATELY DID NOT CHANGE, and these are asserted here precisely
 * because they are the tempting changes:
 *
 *   * an accepted call with no media join is still ANSWERED. Accepting is the
 *     user's act; a device that never reached the room does not retract it.
 *   * media leave does not end a call, and never turns answered into missed.
 *   * duration is still measured from `answered_at`, never `media_joined_at`.
 *   * an ACTIVE call has no timeout. The sweep is for ringing calls only.
 *
 * WHAT IS REAL HERE: the database, the migration chain, the real CallService,
 * the real MediaPresenceService, real transactions and real row locks. The
 * concurrency cases race genuine transactions against genuine Postgres, because
 * database atomicity is the property under test and a mock cannot demonstrate
 * it. `MediaPresenceService` is driven directly -- webhook signature
 * verification is W5's suite, and re-proving it here would test the verifier
 * twice and the lifecycle once.
 *
 * WHAT IT DOES NOT PROVE: that LiveKit Cloud delivers these webhooks. No real
 * webhook has ever reached this system. Unchanged from the W5 closeout, and W6
 * verifies nothing about it.
 */
import { CommErrorCode } from '@platform/errors';
import { CommEvent } from '@communication/contracts/events';
import { MediaPresenceService } from '@communication/calls/media-presence.service';
import { OutboxService } from '@communication/outbox/outbox.service';
import { Scenario, buildGraph, seed, truncate } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;
let presence: MediaPresenceService;
let ringTimeoutSeconds: number;

/** The whole lifecycle record, application plane and media plane together. */
async function snapshot(callId: string) {
  const call = await g.prisma.call.findUnique({ where: { id: callId } });
  const participants = await g.prisma.callParticipant.findMany({
    where: { callId },
    orderBy: { actorId: 'asc' },
  });
  return {
    status: call?.status,
    outcome: call?.outcome ?? null,
    answeredAt: call?.answeredAt ?? null,
    endedAt: call?.endedAt ?? null,
    durationSeconds: call?.durationSeconds ?? null,
    participants: participants.map((p) => ({
      actorId: p.actorId,
      joinedAt: p.joinedAt ?? null,
      leftAt: p.leftAt ?? null,
      mediaJoinedAt: p.mediaJoinedAt ?? null,
      mediaLeftAt: p.mediaLeftAt ?? null,
    })),
  };
}

const eventsFor = async (callId: string) => {
  const rows = await g.prisma.outboxEvent.findMany({ orderBy: { createdAt: 'asc' } });
  return rows
    .filter((r) => (r.payload as { callId?: string })?.callId === callId)
    .map((r) => r.type);
};

const countOf = async (callId: string, type: string) =>
  (await eventsFor(callId)).filter((t) => t === type).length;

/** An authorized teacher <-> parent direct call, ringing. Two participants. */
async function directCall() {
  const conv = await g.conversations.getOrCreateDirect(s.parentId, s.teacherId);
  const { callId, roomName } = await g.calls.start(conv.id, s.teacherId);
  return { conversationId: conv.id, callId, roomName };
}

/** A Student Group call started by the family's admin. FOUR participants. */
async function groupCall() {
  const group = await g.conversations.ensureStudentGroup(s.learnerId);
  const { callId, roomName } = await g.calls.start(group.id, s.ownerId);
  return { conversationId: group.id, callId, roomName };
}

/** Age a call past the ring deadline using the database's own clock. */
async function pastDeadline(callId: string) {
  await g.prisma.$executeRawUnsafe(
    `update chat.call
        set started_at = now() - make_interval(secs => ${ringTimeoutSeconds + 5})
      where id = '${callId}'::uuid`,
  );
}

/** Move `answered_at` into the past, to measure a duration without waiting. */
async function backdateAnswer(callId: string, seconds: number) {
  await g.prisma.$executeRawUnsafe(
    `update chat.call
        set answered_at = now() - make_interval(secs => ${seconds})
      where id = '${callId}'::uuid`,
  );
}

beforeAll(async () => {
  await g.prisma.$connect();
  ringTimeoutSeconds = await g.config.get('call.ring_timeout_seconds');
});
afterAll(async () => {
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  g.config.invalidate();
  presence = new MediaPresenceService(g.prisma, new OutboxService());
});

// =========================================================================
// 1. DECLINE IS TERMINAL  (locked decision 4)
// =========================================================================
describe('1. decline is the terminal transition', () => {
  it('1a. decline produces ended/declined immediately, with no sweep involved', async () => {
    const { callId } = await directCall();

    await g.calls.decline(callId, s.parentId);

    const after = await snapshot(callId);
    expect(after.status).toBe('ended');
    expect(after.outcome).toBe('declined');
    expect(after.endedAt).toBeInstanceOf(Date);
    // Refusing is not answering.
    expect(after.answeredAt).toBeNull();
    expect(after.durationSeconds).toBe(0);
    expect(after.participants.every((p) => p.joinedAt === null)).toBe(true);

    // AND NOTHING IS FABRICATED. The decliner left; the caller, who was still
    // ringing, did not, and a call becoming terminal is not evidence that they
    // did. An ended call may carry a participant whose `left_at` is null --
    // terminal state is `call.status`, which is what every guard checks.
    const decliner = after.participants.find((p) => p.actorId === s.parentId)!;
    const caller = after.participants.find((p) => p.actorId === s.teacherId)!;
    expect(decliner.leftAt).toBeInstanceOf(Date);
    expect(caller.leftAt).toBeNull();
  });

  it('1b. the ring timeout can never convert a declined call into missed', async () => {
    const { callId } = await directCall();
    await g.calls.decline(callId, s.parentId);
    const declined = await snapshot(callId);

    // Age it well past the deadline and sweep repeatedly, as many workers do.
    await pastDeadline(callId);
    for (let i = 0; i < 5; i += 1) {
      expect(await g.calls.expireRingingCalls()).toBe(0);
    }

    expect(await snapshot(callId)).toEqual(declined);
    expect((await snapshot(callId)).outcome).toBe('declined');
  });

  it('1c. the decline outcome reaches the outbox exactly once, as declined', async () => {
    const { conversationId, callId } = await directCall();

    await g.calls.decline(callId, s.parentId);

    expect(await countOf(callId, CommEvent.CALL_DECLINED)).toBe(1);
    expect(await countOf(callId, CommEvent.CALL_ENDED)).toBe(1);

    const ended = await g.prisma.outboxEvent.findMany({
      where: { type: CommEvent.CALL_ENDED },
    });
    const payloads = ended
      .map((r) => r.payload as Record<string, unknown>)
      .filter((p) => p.callId === callId);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toEqual({
      callId,
      conversationId,
      outcome: 'declined',
      durationSeconds: 0,
    });
  });

  it('1d. a declined call produces NO missed-call notification', async () => {
    // The concrete consequence of the old behaviour: the sweep relabelled the
    // refusal `missed`, and notifyMissedCall then pushed a missed-call alert to
    // the participant who had just declined. `declined` is filtered out.
    const { callId } = await directCall();
    await g.calls.decline(callId, s.parentId);
    await pastDeadline(callId);
    await g.calls.expireRingingCalls();

    const ended = (
      await g.prisma.outboxEvent.findMany({ where: { type: CommEvent.CALL_ENDED } })
    )
      .map((r) => r.payload as Record<string, unknown>)
      .filter((p) => p.callId === callId);
    expect(ended).toHaveLength(1);
    expect(ended[0].outcome).toBe('declined');
    expect(ended.some((p) => p.outcome === 'missed')).toBe(false);
  });

  it('1e. a duplicate decline changes nothing and announces nothing', async () => {
    const { callId } = await directCall();
    await g.calls.decline(callId, s.parentId);
    const first = await snapshot(callId);
    const eventCount = (await eventsFor(callId)).length;

    for (let i = 0; i < 3; i += 1) {
      await expect(g.calls.decline(callId, s.parentId)).rejects.toMatchObject({
        code: CommErrorCode.CALL_ALREADY_ENDED,
      });
    }

    expect(await snapshot(callId)).toEqual(first);
    expect((await eventsFor(callId)).length).toBe(eventCount);
  });

  it('1f. the other party declining is terminal too, not only the callee', async () => {
    // The initiator is a live participant of their own ringing call, so they can
    // reach decline. Withdrawing leaves nobody to answer, so it is terminal by
    // the same rule.
    const { callId } = await directCall();

    await g.calls.decline(callId, s.teacherId);

    const after = await snapshot(callId);
    expect(after.status).toBe('ended');
    expect(after.outcome).toBe('declined');
  });
});

// =========================================================================
// 2. MULTI-PARTICIPANT CALLS  (no group exception; participant state intact)
// =========================================================================
describe('2. a decline on a multi-party call corrupts nobody else\'s row', () => {
  /**
   * THERE IS NO GROUP EXCEPTION, and these do not assert one. The locked
   * transition applies uniformly -- a decline ends the call whoever declines and
   * however many participants there are. A W6 draft made it conditional on two
   * parties remaining live; that was an inference, it was rejected, and it is
   * gone. What is asserted here is only that the uniform rule leaves the other
   * participants' rows exactly as it found them.
   */
  it('2a. a four-party call ends as declined, and only the decliner is marked', async () => {
    const { callId } = await groupCall();
    const before = await snapshot(callId);
    expect(before.participants).toHaveLength(4);

    await g.calls.decline(callId, s.parentId);

    const after = await snapshot(callId);
    expect(after.status).toBe('ended');
    expect(after.outcome).toBe('declined');
    expect(after.answeredAt).toBeNull();

    const decliner = after.participants.find((p) => p.actorId === s.parentId)!;
    expect(decliner.leftAt).toBeInstanceOf(Date);

    // The other three did not answer and did not leave. Every column stays as it
    // was, including both media columns -- a lifecycle transition must not write
    // presence facts nothing observed.
    for (const other of after.participants.filter((p) => p.actorId !== s.parentId)) {
      expect(other.leftAt).toBeNull();
      expect(other.joinedAt).toBeNull();
      expect(other.mediaJoinedAt).toBeNull();
      expect(other.mediaLeftAt).toBeNull();
    }
    // And their rows are byte-for-byte what they were before the decline.
    expect(after.participants.filter((p) => p.actorId !== s.parentId)).toEqual(
      before.participants.filter((p) => p.actorId !== s.parentId),
    );
  });

  it('2b. one refusal, one ending: the other parties cannot decline it again', async () => {
    const { callId } = await groupCall();
    await g.calls.decline(callId, s.parentId);
    const declined = await snapshot(callId);

    // The call is terminal, so every other party's decline is refused and writes
    // nothing -- no second `left_at`, no second event.
    for (const actorId of [s.otherParentId, s.teacherId, s.ownerId]) {
      await expect(g.calls.decline(callId, actorId)).rejects.toMatchObject({
        code: CommErrorCode.CALL_ALREADY_ENDED,
      });
    }

    expect(await snapshot(callId)).toEqual(declined);
    expect(await countOf(callId, CommEvent.CALL_DECLINED)).toBe(1);
    expect(await countOf(callId, CommEvent.CALL_ENDED)).toBe(1);
  });

  it('2c. nor can another party ANSWER a call that was refused', async () => {
    const { callId } = await groupCall();
    await g.calls.decline(callId, s.parentId);
    const declined = await snapshot(callId);

    await expect(g.calls.accept(callId, s.teacherId)).rejects.toMatchObject({
      code: CommErrorCode.CALL_ALREADY_ENDED,
    });

    expect(await snapshot(callId)).toEqual(declined);
    expect(await countOf(callId, CommEvent.CALL_ACCEPTED)).toBe(0);
  });

  it('2d. a four-party call that is ENDED leaves every non-decliner untouched', async () => {
    // The companion to 2a for the other terminal writer: `end()` DOES stamp every
    // open participant, and that existing rule is untouched by W6. Asserted so
    // the asymmetry between the two paths is recorded on purpose rather than
    // discovered later.
    const { callId } = await groupCall();

    await g.calls.end(callId, s.ownerId);

    const after = await snapshot(callId);
    expect(after.status).toBe('ended');
    expect(after.outcome).toBe('missed');
    expect(after.participants.every((p) => p.leftAt !== null)).toBe(true);
    expect(after.participants.every((p) => p.joinedAt === null)).toBe(true);
  });
});

// =========================================================================
// 3. ACCEPTED WITHOUT MEDIA  (locked decisions 1, 2, 5)
// =========================================================================
describe('3. an accepted call is answered, media or no media', () => {
  it('3a. accepted and never joined: still ACTIVE, and still ANSWERED when ended', async () => {
    const { callId } = await directCall();
    await g.calls.accept(callId, s.parentId);

    const active = await snapshot(callId);
    expect(active.status).toBe('active');
    // No media presence has ever been observed.
    expect(active.participants.every((p) => p.mediaJoinedAt === null)).toBe(true);

    await g.calls.end(callId, s.teacherId);

    const after = await snapshot(callId);
    expect(after.outcome).toBe('answered');
    // Deliberately NOT `missed`: HTTP accept is the user's acceptance of the
    // call, and a missing media join does not retract it. Locked decision 1.
    expect(after.answeredAt).toBeInstanceOf(Date);
  });

  it('3b. an ACTIVE call has no deadline: the ring timeout cannot reach it', async () => {
    // Locked decision 2. The sweep matches `status = 'ringing'` only, so an
    // accepted call with no media is not swept however old it is. This is a
    // carry-forward risk, asserted so the behaviour is recorded rather than
    // assumed: nothing here ends a stale ACTIVE call except an explicit end.
    const { callId } = await directCall();
    await g.calls.accept(callId, s.parentId);
    await pastDeadline(callId);
    const active = await snapshot(callId);

    for (let i = 0; i < 3; i += 1) {
      expect(await g.calls.expireRingingCalls()).toBe(0);
    }

    expect(await snapshot(callId)).toEqual(active);
    expect(active.status).toBe('active');
  });

  it('3c. duration comes from answered_at, NOT from media_joined_at', async () => {
    // Locked decision 5, as its worked example: accepted at 10:00, media joined
    // at 10:03, ended at 10:10 => ten minutes.
    const { callId, roomName } = await directCall();
    await g.calls.accept(callId, s.parentId);

    await backdateAnswer(callId, 600); // answered ten minutes ago
    const mediaJoin = new Date(Date.now() - 420_000); // joined seven minutes ago
    expect(await presence.participantJoined({
      roomName,
      identity: s.parentId,
      at: mediaJoin,
    })).toBe('reconciled');

    await g.calls.end(callId, s.teacherId);

    const after = await snapshot(callId);
    expect(after.outcome).toBe('answered');
    // ~600s from the answer, not ~420s from the media join.
    expect(after.durationSeconds).toBeGreaterThanOrEqual(598);
    expect(after.durationSeconds).toBeLessThanOrEqual(605);
  });
});

// =========================================================================
// 4. MEDIA LEAVE IS NOT AN ENDING  (locked decision 3)
// =========================================================================
describe('4. media presence never moves the lifecycle', () => {
  it('4a. a participant leaving the room does not end an ACTIVE call', async () => {
    const { callId, roomName } = await directCall();
    await g.calls.accept(callId, s.parentId);
    await presence.participantJoined({ roomName, identity: s.parentId, at: new Date() });

    expect(await presence.participantLeft({
      roomName,
      identity: s.parentId,
      at: new Date(),
    })).toBe('reconciled');

    const after = await snapshot(callId);
    expect(after.status).toBe('active');
    expect(after.outcome).toBeNull();
    expect(after.endedAt).toBeNull();
    // The media fact was recorded; the lifecycle was not touched.
    const mine = after.participants.find((p) => p.actorId === s.parentId)!;
    expect(mine.mediaLeftAt).toBeInstanceOf(Date);
    expect(mine.leftAt).toBeNull();
  });

  it('4b. an answered call is never reread as missed because media disappeared', async () => {
    const { callId, roomName } = await directCall();
    await g.calls.accept(callId, s.parentId);
    await presence.participantJoined({ roomName, identity: s.parentId, at: new Date() });
    await presence.participantLeft({ roomName, identity: s.parentId, at: new Date() });

    await g.calls.end(callId, s.teacherId);

    expect((await snapshot(callId)).outcome).toBe('answered');
  });

  it('4c. an empty room is not an ending: BOTH parties leaving still leaves it ACTIVE', async () => {
    const { callId, roomName } = await directCall();
    await g.calls.accept(callId, s.parentId);
    for (const id of [s.parentId, s.teacherId]) {
      await presence.participantJoined({ roomName, identity: id, at: new Date() });
      await presence.participantLeft({ roomName, identity: id, at: new Date() });
    }

    expect((await snapshot(callId)).status).toBe('active');
    expect(await countOf(callId, CommEvent.CALL_ENDED)).toBe(0);
  });

  it('4d. media presence on a RINGING call does not answer it', async () => {
    // A device that reaches the room without the HTTP accept has not accepted
    // anything: media join is not application acceptance.
    const { callId, roomName } = await directCall();

    expect(await presence.participantJoined({
      roomName,
      identity: s.parentId,
      at: new Date(),
    })).toBe('reconciled');

    const after = await snapshot(callId);
    expect(after.status).toBe('ringing');
    expect(after.answeredAt).toBeNull();
    expect(after.participants.every((p) => p.joinedAt === null)).toBe(true);
    expect(await countOf(callId, CommEvent.CALL_ACCEPTED)).toBe(0);
  });
});

// =========================================================================
// 5. TERMINAL IS TERMINAL
// =========================================================================
describe('5. nothing resurrects a terminal call', () => {
  it('5a. a delayed participant_joined cannot resurrect a DECLINED call', async () => {
    const { callId, roomName } = await directCall();
    await g.calls.decline(callId, s.parentId);
    const declined = await snapshot(callId);

    // The webhook LiveKit was always going to send, arriving after the refusal.
    expect(await presence.participantJoined({
      roomName,
      identity: s.parentId,
      at: new Date(),
    })).toBe('call_ended');

    const after = await snapshot(callId);
    expect(after.status).toBe('ended');
    expect(after.outcome).toBe('declined');
    expect(after.answeredAt).toBeNull();
    expect(after.endedAt).toEqual(declined.endedAt);
    // Recorded into history, and announced to nobody.
    const mine = after.participants.find((p) => p.actorId === s.parentId)!;
    expect(mine.mediaJoinedAt).toBeInstanceOf(Date);
    expect(await countOf(callId, CommEvent.CALL_PARTICIPANT_JOINED)).toBe(0);
  });

  it('5b. a delayed participant_left cannot mutate a call that already ENDED', async () => {
    const { callId, roomName } = await directCall();
    await g.calls.accept(callId, s.parentId);
    await presence.participantJoined({ roomName, identity: s.parentId, at: new Date() });
    await g.calls.end(callId, s.teacherId);
    const ended = await snapshot(callId);
    expect(ended.outcome).toBe('answered');

    expect(await presence.participantLeft({
      roomName,
      identity: s.parentId,
      at: new Date(),
    })).toBe('call_ended');

    const after = await snapshot(callId);
    expect(after.status).toBe('ended');
    expect(after.outcome).toBe('answered');
    expect(after.durationSeconds).toBe(ended.durationSeconds);
    expect(after.endedAt).toEqual(ended.endedAt);
    expect(await countOf(callId, CommEvent.CALL_PARTICIPANT_LEFT)).toBe(0);
  });

  it('5c. hanging up a DECLINED call does not relabel it missed', async () => {
    // The live path the terminal guard in end() exists for: the caller's client
    // sees the refusal and hangs up. Without the guard this rewrote `declined`
    // as `missed` -- the very outcome W6 removed -- and enqueued a second
    // `call.ended`.
    const { callId } = await directCall();
    await g.calls.decline(callId, s.parentId);
    const declined = await snapshot(callId);

    await expect(g.calls.end(callId, s.teacherId)).resolves.toBeUndefined();

    expect(await snapshot(callId)).toEqual(declined);
    expect(await countOf(callId, CommEvent.CALL_ENDED)).toBe(1);
  });

  it('5d. hanging up twice is a retry: one outcome, one duration, one event', async () => {
    const { callId } = await directCall();
    await g.calls.accept(callId, s.parentId);
    await backdateAnswer(callId, 30);
    await g.calls.end(callId, s.teacherId);
    const ended = await snapshot(callId);

    await g.calls.end(callId, s.parentId);
    await g.calls.end(callId, s.teacherId);

    expect(await snapshot(callId)).toEqual(ended);
    expect(ended.durationSeconds).toBeGreaterThanOrEqual(29);
    expect(await countOf(callId, CommEvent.CALL_ENDED)).toBe(1);
  });

  it('5e. hanging up an EXPIRED call does not relabel it either', async () => {
    const { callId } = await directCall();
    await pastDeadline(callId);
    expect(await g.calls.expireRingingCalls()).toBe(1);
    const missed = await snapshot(callId);

    await g.calls.end(callId, s.teacherId);

    expect(await snapshot(callId)).toEqual(missed);
    expect(missed.outcome).toBe('missed');
    expect(await countOf(callId, CommEvent.CALL_ENDED)).toBe(1);
  });
});

// =========================================================================
// 6. RACES, AGAINST THE REAL DATABASE
// =========================================================================
describe('6. races settle on exactly one terminal outcome', () => {
  /**
   * No sleeps and no fake timers. Each of these starts two real transactions
   * against real Postgres and lets the row lock decide; the assertions accept
   * either winner and insist the record agrees with itself either way.
   */
  it('6a. accept vs timeout: active/answered or ended/missed, never a hybrid', async () => {
    const { callId } = await directCall();
    await pastDeadline(callId);

    const [accepted, expired] = await Promise.allSettled([
      g.calls.accept(callId, s.parentId),
      g.calls.expireRingingCalls(),
    ]);

    const after = await snapshot(callId);
    if (accepted.status === 'fulfilled' && after.status === 'active') {
      expect(after.answeredAt).toBeInstanceOf(Date);
      expect(expired.status === 'fulfilled' ? expired.value : -1).toBe(0);
      expect(await countOf(callId, CommEvent.CALL_ENDED)).toBe(0);
      // And ending it now records the answer, not a miss.
      await g.calls.end(callId, s.teacherId);
      expect((await snapshot(callId)).outcome).toBe('answered');
    } else {
      expect(after.status).toBe('ended');
      expect(after.outcome).toBe('missed');
      expect(after.answeredAt).toBeNull();
      expect(after.participants.every((p) => p.joinedAt === null)).toBe(true);
      expect(await countOf(callId, CommEvent.CALL_ENDED)).toBe(1);
    }
  });

  it('6b. decline vs timeout: one terminal label, and exactly one terminal event', async () => {
    const { callId } = await directCall();
    await pastDeadline(callId);

    await Promise.allSettled([
      g.calls.decline(callId, s.parentId),
      g.calls.expireRingingCalls(),
    ]);

    const after = await snapshot(callId);
    expect(after.status).toBe('ended');
    expect(['declined', 'missed']).toContain(after.outcome);
    expect(after.answeredAt).toBeNull();
    expect(after.durationSeconds).toBe(0);
    expect(await countOf(callId, CommEvent.CALL_ENDED)).toBe(1);
  });

  it('6c. two simultaneous declines: one refusal, one ending', async () => {
    const { callId } = await directCall();

    await Promise.allSettled([
      g.calls.decline(callId, s.parentId),
      g.calls.decline(callId, s.parentId),
    ]);

    expect(await countOf(callId, CommEvent.CALL_DECLINED)).toBe(1);
    expect(await countOf(callId, CommEvent.CALL_ENDED)).toBe(1);
    expect((await snapshot(callId)).outcome).toBe('declined');
  });

  it('6d. decline vs a simultaneous media join: declined, and never resurrected', async () => {
    const { callId, roomName } = await directCall();

    await Promise.allSettled([
      g.calls.decline(callId, s.parentId),
      presence.participantJoined({ roomName, identity: s.parentId, at: new Date() }),
    ]);

    const after = await snapshot(callId);
    expect(after.status).toBe('ended');
    expect(after.outcome).toBe('declined');
    expect(after.answeredAt).toBeNull();
    expect(after.participants.every((p) => p.joinedAt === null)).toBe(true);
  });

  it('6e. accept vs a simultaneous media join: answered, and the two facts stay separate', async () => {
    const { callId, roomName } = await directCall();

    await Promise.allSettled([
      g.calls.accept(callId, s.parentId),
      presence.participantJoined({ roomName, identity: s.parentId, at: new Date() }),
    ]);

    const after = await snapshot(callId);
    expect(after.status).toBe('active');
    const mine = after.participants.find((p) => p.actorId === s.parentId)!;
    // Whichever committed first, the application answer and the media presence
    // are recorded in their own columns and neither overwrote the other.
    expect(mine.joinedAt).toBeInstanceOf(Date);
    expect(mine.mediaJoinedAt).toBeInstanceOf(Date);
  });

  it('6f. media join vs end: the ending stands and the outcome is not media-derived', async () => {
    const { callId, roomName } = await directCall();
    await g.calls.accept(callId, s.parentId);

    await Promise.allSettled([
      presence.participantJoined({ roomName, identity: s.parentId, at: new Date() }),
      g.calls.end(callId, s.teacherId),
    ]);

    const after = await snapshot(callId);
    expect(after.status).toBe('ended');
    expect(after.outcome).toBe('answered');
    expect(await countOf(callId, CommEvent.CALL_ENDED)).toBe(1);
  });

  it('6g. media leave vs end: terminal state is not mutated by the departure', async () => {
    const { callId, roomName } = await directCall();
    await g.calls.accept(callId, s.parentId);
    await presence.participantJoined({ roomName, identity: s.parentId, at: new Date() });

    await Promise.allSettled([
      presence.participantLeft({ roomName, identity: s.parentId, at: new Date() }),
      g.calls.end(callId, s.teacherId),
    ]);

    const after = await snapshot(callId);
    expect(after.status).toBe('ended');
    expect(after.outcome).toBe('answered');
    expect(after.durationSeconds).not.toBeNull();
    expect(await countOf(callId, CommEvent.CALL_ENDED)).toBe(1);
  });

  it('6h. accept vs end: the outcome agrees with the state, whoever wins', async () => {
    // The lost update the locked read in end() closes: the outcome used to be
    // derived from a pre-lock read of answered_at, so an accept committing in
    // that window produced an ACTIVE-then-ENDED call recorded as `missed`.
    const { callId } = await directCall();

    await Promise.allSettled([
      g.calls.accept(callId, s.parentId),
      g.calls.end(callId, s.teacherId),
    ]);

    const after = await snapshot(callId);
    if (after.status === 'ended') {
      const answered = after.answeredAt !== null;
      expect(after.outcome).toBe(answered ? 'answered' : 'missed');
      expect(await countOf(callId, CommEvent.CALL_ENDED)).toBe(1);
    } else {
      expect(after.status).toBe('active');
    }
  });

  it('6j. an accept committing inside end\'s own window still records answered', async () => {
    // THE LOST UPDATE THE LOCKED READ CLOSES, forced open deterministically.
    //
    // `end()` reads the call, then opens a transaction and takes the row lock.
    // If an accept commits between those two points, a version that derived the
    // outcome from the FIRST read writes `missed` for a call whose `answered_at`
    // is set -- a conversation that happened, recorded as one that did not.
    //
    // Promise.allSettled cannot reliably hit that window, so this widens it
    // instead of guessing: the accept is run inside the first `$transaction`
    // call `end` makes, which is exactly after its read and before its lock.
    // No sleep and no fake timer -- a deterministic interleaving.
    const { callId } = await directCall();

    const real = g.prisma.$transaction.bind(g.prisma);
    const spy = jest
      .spyOn(g.prisma, '$transaction')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementationOnce(async (arg: any) => {
        await g.calls.accept(callId, s.parentId);
        return real(arg);
      });

    try {
      await g.calls.end(callId, s.teacherId);
    } finally {
      spy.mockRestore();
    }

    const after = await snapshot(callId);
    expect(after.status).toBe('ended');
    expect(after.answeredAt).toBeInstanceOf(Date);
    // Derived from the LOCKED read, so it agrees with the state it ended from.
    expect(after.outcome).toBe('answered');
    expect(after.durationSeconds).not.toBeNull();
  });

  it('6i. four concurrent ends produce one ending', async () => {
    const { callId } = await directCall();
    await g.calls.accept(callId, s.parentId);

    await Promise.allSettled(
      Array.from({ length: 4 }, () => g.calls.end(callId, s.teacherId)),
    );

    expect((await snapshot(callId)).outcome).toBe('answered');
    expect(await countOf(callId, CommEvent.CALL_ENDED)).toBe(1);
  });
});

// =========================================================================
// 7. THE OUTCOME IS THE SERVER'S TO DECIDE
// =========================================================================
describe('7. no client names its own call history', () => {
  it('7a. the end endpoint takes no outcome from the request', async () => {
    // It used to: `body.outcome` went straight into the service, so a
    // participant could POST {"outcome":"answered"} for a call nobody answered,
    // or any other string and turn a check-constraint violation into a 500.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const source = readFileSync(
      `${__dirname}/../../src/communication/api/call.controller.ts`,
      'utf8',
    );
    const handler = source.slice(source.indexOf("@Post(':id/end')"));
    const body = handler.slice(0, handler.indexOf('\n  }'));
    expect(body).not.toMatch(/@Body/);
    expect(body).not.toMatch(/outcome/);
  });

  it('7b. the service itself exposes no outcome parameter', async () => {
    // A signature check, because the HTTP guard alone is not the contract: a
    // W6 draft kept `end(callId, actorId, outcome?)` alive for one test, which is
    // a production API that lies about the locked state machine. Two required
    // parameters, and no optional third -- `Function.length` counts required
    // parameters only, so an added `outcome?` would not change it; the source
    // check is what catches that.
    expect(g.calls.end).toHaveLength(2);

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const source = readFileSync(
      `${__dirname}/../../src/communication/calls/call.service.ts`,
      'utf8',
    );
    const sig = source.slice(source.indexOf('async end('));
    expect(sig.slice(0, sig.indexOf(')'))).toBe('async end(callId: string, actorId: string');
  });

  it('7c. and the three outcomes each have exactly one writer', async () => {
    // answered <- end() on an ACTIVE call
    const answered = await directCall();
    await g.calls.accept(answered.callId, s.parentId);
    await g.calls.end(answered.callId, s.teacherId);
    expect((await snapshot(answered.callId)).outcome).toBe('answered');

    // missed <- end() on a RINGING call, or the sweep
    const hungUp = await directCall();
    await g.calls.end(hungUp.callId, s.teacherId);
    expect((await snapshot(hungUp.callId)).outcome).toBe('missed');

    const swept = await directCall();
    await pastDeadline(swept.callId);
    await g.calls.expireRingingCalls();
    expect((await snapshot(swept.callId)).outcome).toBe('missed');

    // declined <- decline(), and nothing else
    const refused = await directCall();
    await g.calls.decline(refused.callId, s.parentId);
    expect((await snapshot(refused.callId)).outcome).toBe('declined');
  });
});
