/**
 * PHASE 5 -- the voice-call lifecycle, end to end and server-authoritative.
 *
 * The properties under test are the ones that were NOT true before Phase 5:
 * an invalid transition is refused, a duplicate transition is absorbed without
 * corrupting the record, and a call nobody answered becomes a missed call
 * because the SERVER noticed -- not because a client reported it.
 */
import { PrismaService } from '@platform/prisma.service';
import { CommErrorCode } from '@platform/errors';
import { buildGraph, seed, truncate, Scenario } from './harness';
import {
  CallMode,
  CallOutcome,
  CallParticipantState,
  CallStatus,
  CallType,
} from '@communication/contracts/vocab';

const prisma = new PrismaService();
const g = buildGraph();
let s: Scenario;

const actorOf = async (id: string) => (await g.identity.resolveActor(id))!;

/** The family's 1:1 thread: admin_a and the parent. */
async function directThread(): Promise<string> {
  const conv = await g.conversations.getOrCreateDirect(s.ownerId, s.parentId);
  return conv.id;
}

beforeEach(async () => {
  await truncate(prisma);
  s = await seed(prisma);
  // on_duty() is AI #1's engine; pinning it keeps these tests asserting the
  // CALL lifecycle rather than the coverage roster.
  g.coverage.onDutyId = s.ownerId;
  process.env.LIVEKIT_API_KEY = 'test-key';
  process.env.LIVEKIT_API_SECRET = 'test-secret-at-least-32-characters-long';
});
afterAll(async () => {
  await truncate(prisma);
  await prisma.$disconnect();
});

describe('starting a call', () => {
  it('mints the room server-side and rings every member', async () => {
    const conversationId = await directThread();
    const started = await g.calls.start(conversationId, s.ownerId);

    expect(started.roomName).toContain(conversationId);
    expect(started.mode).toBe(CallMode.NORMAL);
    expect(started.type).toBe(CallType.DIRECT);
    // The invitation window is server-set, not client-declared.
    expect(new Date(started.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const call = await prisma.call.findUniqueOrThrow({
      where: { id: started.callId },
      include: { participants: true },
    });
    // `initiated` is never observable: the invitation is written in the same
    // transaction as the call.
    expect(call.status).toBe(CallStatus.RINGING);
    expect(call.participants.map((p) => p.actorId).sort()).toEqual(
      [s.ownerId, s.parentId].sort(),
    );
    expect(call.participants.every((p) => p.state === CallParticipantState.INVITED)).toBe(true);
  });

  it('refuses a caller who is not a member of the conversation', async () => {
    const conversationId = await directThread();
    // admin_b supervises no family here, so the thread is outside their scope.
    await expect(g.calls.start(conversationId, s.otherAdminId)).rejects.toMatchObject({
      code: expect.any(String),
    });
  });
});

describe('accept', () => {
  it('connects the call and records who joined', async () => {
    const conversationId = await directThread();
    const { callId } = await g.calls.start(conversationId, s.ownerId);

    const view = await g.calls.accept(callId, s.parentId);
    expect(view.status).toBe(CallStatus.ACTIVE);

    const participant = await prisma.callParticipant.findFirstOrThrow({
      where: { callId, actorId: s.parentId },
    });
    expect(participant.state).toBe(CallParticipantState.JOINED);
    expect(participant.joinedAt).not.toBeNull();
  });

  it('is idempotent -- a retried accept does not re-answer the call', async () => {
    const conversationId = await directThread();
    const { callId } = await g.calls.start(conversationId, s.ownerId);

    await g.calls.accept(callId, s.parentId);
    const first = await prisma.call.findUniqueOrThrow({ where: { id: callId } });

    await g.calls.accept(callId, s.parentId);
    const second = await prisma.call.findUniqueOrThrow({ where: { id: callId } });

    // The answer time is the FIRST answer, not the latest request.
    expect(second.answeredAt).toEqual(first.answeredAt);
    expect(second.status).toBe(CallStatus.ACTIVE);
  });

  it('REFUSES an accept after the call was declined', async () => {
    // The defect: the old code set ACTIVE unconditionally, resurrecting a call
    // the recipient had already refused.
    const conversationId = await directThread();
    const { callId } = await g.calls.start(conversationId, s.ownerId);

    await g.calls.decline(callId, s.parentId);
    await expect(g.calls.accept(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.CALL_INVALID_TRANSITION,
    });
  });

  it('refuses an accept from somebody who is not a participant', async () => {
    const conversationId = await directThread();
    const { callId } = await g.calls.start(conversationId, s.ownerId);

    await expect(g.calls.accept(callId, s.otherAdminId)).rejects.toMatchObject({
      code: CommErrorCode.CALL_NOT_A_PARTICIPANT,
    });
  });
});

describe('decline', () => {
  it('ends a 1:1 call and records the refusal distinctly from hanging up', async () => {
    const conversationId = await directThread();
    const { callId } = await g.calls.start(conversationId, s.ownerId);

    await g.calls.decline(callId, s.parentId);

    const call = await prisma.call.findUniqueOrThrow({ where: { id: callId } });
    expect(call.status).toBe(CallStatus.ENDED);
    expect(call.outcome).toBe(CallOutcome.DECLINED);

    const participant = await prisma.callParticipant.findFirstOrThrow({
      where: { callId, actorId: s.parentId },
    });
    // Not merely `leftAt`, which is what "joined then hung up" looks like.
    expect(participant.state).toBe(CallParticipantState.DECLINED);
    expect(participant.declinedAt).not.toBeNull();
  });

  it('declining twice does not corrupt the call', async () => {
    const conversationId = await directThread();
    const { callId } = await g.calls.start(conversationId, s.ownerId);

    await g.calls.decline(callId, s.parentId);
    const first = await prisma.call.findUniqueOrThrow({ where: { id: callId } });

    await g.calls.decline(callId, s.parentId);
    const second = await prisma.call.findUniqueOrThrow({ where: { id: callId } });

    expect(second.endedAt).toEqual(first.endedAt);
    expect(second.outcome).toBe(CallOutcome.DECLINED);
  });
});

describe('end', () => {
  it('records the duration of a call that was answered', async () => {
    const conversationId = await directThread();
    const { callId } = await g.calls.start(conversationId, s.ownerId);
    await g.calls.accept(callId, s.parentId);

    await g.calls.end(callId, s.ownerId);

    const call = await prisma.call.findUniqueOrThrow({ where: { id: callId } });
    expect(call.status).toBe(CallStatus.ENDED);
    expect(call.outcome).toBe(CallOutcome.ANSWERED);
    expect(call.durationSeconds).toBeGreaterThanOrEqual(0);
  });

  it('a retried end does NOT rewrite a finished call', async () => {
    // The defect this closes: `end` used to write endedAt, outcome and duration
    // unconditionally, so a client retrying a request whose response it never
    // saw silently rewrote the record of a call that finished days earlier.
    const conversationId = await directThread();
    const { callId } = await g.calls.start(conversationId, s.ownerId);
    await g.calls.accept(callId, s.parentId);
    await g.calls.end(callId, s.ownerId);

    const first = await prisma.call.findUniqueOrThrow({ where: { id: callId } });
    await g.calls.end(callId, s.ownerId);
    const second = await prisma.call.findUniqueOrThrow({ where: { id: callId } });

    expect(second.endedAt).toEqual(first.endedAt);
    expect(second.durationSeconds).toBe(first.durationSeconds);
    expect(second.outcome).toBe(first.outcome);
  });

  it('an unanswered call ended by its caller is CANCELLED, not answered', async () => {
    const conversationId = await directThread();
    const { callId } = await g.calls.start(conversationId, s.ownerId);

    await g.calls.end(callId, s.ownerId);

    const call = await prisma.call.findUniqueOrThrow({ where: { id: callId } });
    expect(call.outcome).toBe(CallOutcome.CANCELLED);
  });
});

describe('cancel', () => {
  it('only the initiator may cancel', async () => {
    const conversationId = await directThread();
    const { callId } = await g.calls.start(conversationId, s.ownerId);

    await expect(g.calls.cancel(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.CALL_NOT_INITIATOR,
    });
  });

  it('a cancelled call is not reported as missed', async () => {
    const conversationId = await directThread();
    const { callId } = await g.calls.start(conversationId, s.ownerId);

    await g.calls.cancel(callId, s.ownerId);

    const call = await prisma.call.findUniqueOrThrow({ where: { id: callId } });
    expect(call.outcome).toBe(CallOutcome.CANCELLED);
  });
});

describe('the missed-call sweep', () => {
  /** Push the invitation window into the past without touching the machine. */
  const expireInvitation = (callId: string) =>
    prisma.call.updateMany({
      where: { id: callId },
      data: { ringExpiresAt: new Date(Date.now() - 1000) },
    });

  it('marks a call nobody answered as missed, without any client saying so', async () => {
    const conversationId = await directThread();
    const { callId } = await g.calls.start(conversationId, s.ownerId);
    await expireInvitation(callId);

    expect(await g.calls.expireRingingCalls()).toBe(1);

    const call = await prisma.call.findUniqueOrThrow({
      where: { id: callId },
      include: { participants: true },
    });
    expect(call.status).toBe(CallStatus.ENDED);
    expect(call.outcome).toBe(CallOutcome.MISSED);
    expect(
      call.participants.find((p) => p.actorId === s.parentId)!.state,
    ).toBe(CallParticipantState.MISSED);
  });

  it('is idempotent -- running the sweep twice expires nothing the second time', async () => {
    const conversationId = await directThread();
    const { callId } = await g.calls.start(conversationId, s.ownerId);
    await expireInvitation(callId);

    expect(await g.calls.expireRingingCalls()).toBe(1);
    const first = await prisma.call.findUniqueOrThrow({ where: { id: callId } });

    expect(await g.calls.expireRingingCalls()).toBe(0);
    const second = await prisma.call.findUniqueOrThrow({ where: { id: callId } });
    expect(second.endedAt).toEqual(first.endedAt);
  });

  it('never expires a call that was answered', async () => {
    const conversationId = await directThread();
    const { callId } = await g.calls.start(conversationId, s.ownerId);
    await g.calls.accept(callId, s.parentId);
    await expireInvitation(callId);

    expect(await g.calls.expireRingingCalls()).toBe(0);
    const call = await prisma.call.findUniqueOrThrow({ where: { id: callId } });
    expect(call.status).toBe(CallStatus.ACTIVE);
  });

  it('refuses a media token for a call whose invitation has lapsed', async () => {
    const conversationId = await directThread();
    const { callId } = await g.calls.start(conversationId, s.ownerId);
    await expireInvitation(callId);

    await expect(g.calls.issueToken(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.CALL_EXPIRED,
    });
  });
});

describe('call history', () => {
  it('reports direction, status, outcome and participants', async () => {
    const conversationId = await directThread();
    const { callId } = await g.calls.start(conversationId, s.ownerId);
    await g.calls.accept(callId, s.parentId);
    await g.calls.end(callId, s.ownerId);

    const history = await g.calls.history(conversationId, s.parentId);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      id: callId,
      status: CallStatus.ENDED,
      outcome: CallOutcome.ANSWERED,
      initiatorId: s.ownerId,
      mode: CallMode.NORMAL,
    });
    expect(history[0].participants).toHaveLength(2);
  });

  it('carries no recording flag for a caller who may not know one exists', async () => {
    const conversationId = await directThread();
    const { callId } = await g.calls.start(conversationId, s.ownerId);
    await g.calls.end(callId, s.ownerId);

    const asParent = await g.calls.history(conversationId, s.parentId);
    expect(asParent[0].hasRecording).toBe(false);
    expect(asParent[0].id).toBe(callId);
  });
});

describe('the media token', () => {
  it('is scoped to the one room and refused for a non-participant', async () => {
    const conversationId = await directThread();
    const { callId, roomName } = await g.calls.start(conversationId, s.ownerId);

    const issued = await g.calls.issueToken(callId, s.parentId);
    expect(issued.roomName).toBe(roomName);
    // The room is inside the signed payload, so the token cannot be replayed
    // into another room.
    const claims = JSON.parse(
      Buffer.from(issued.token.split('.')[1], 'base64').toString('utf8'),
    );
    expect(claims.video.room).toBe(roomName);
    expect(claims.video.roomCreate).toBe(false);

    await expect(g.calls.issueToken(callId, s.otherAdminId)).rejects.toMatchObject({
      code: CommErrorCode.CALL_NOT_A_PARTICIPANT,
    });
  });

  it('refuses a token to somebody who already declined', async () => {
    const conversationId = await directThread();
    const { callId } = await g.calls.start(conversationId, s.ownerId);
    await g.calls.decline(callId, s.parentId);

    await expect(g.calls.issueToken(callId, s.parentId)).rejects.toMatchObject({
      code: expect.stringMatching(/CALL_(INVALID_TRANSITION|ALREADY_ENDED)/),
    });
  });
});
