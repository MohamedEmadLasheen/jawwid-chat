/**
 * Answering a call is an authorization decision, not a state flip.
 *
 * THE DEFECT THIS SUITE EXISTS FOR. `accept` and `decline` used to run
 * `requireLiveParticipant` -- "does this actor's id appear in
 * call_participant?" -- and nothing else. No conversation membership, no
 * communication matrix, no PD-6 relationship, no `left_at`, no check that the
 * call had not already ended. Starting a call successfully meant it could be
 * answered later by anyone recorded on it, whatever had changed since.
 *
 * No media leaked: `issueToken` ran the full chain and refused. What broke was
 * the RECORD. A revoked parent could flip the call to ACTIVE and stamp
 * `answered_at`, and `end()` would then write `outcome = 'answered'` for a call
 * they could never have joined. History said a conversation happened that could
 * not have happened.
 *
 * So these assert two properties together, and neither is sufficient alone:
 *   1. the action is refused;
 *   2. the record is unchanged -- no joined_at, no answered_at, no status
 *      transition, no event.
 *
 * A refusal that still wrote `answered_at` would pass a test that only checked
 * the throw.
 */
import { randomUUID } from 'node:crypto';
import { CommErrorCode } from '@platform/errors';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;

/** The whole record of a call, for before/after comparison. */
async function snapshot(callId: string) {
  const call = await g.prisma.call.findUnique({ where: { id: callId } });
  const participants = await g.prisma.callParticipant.findMany({
    where: { callId },
    orderBy: { actorId: 'asc' },
  });
  return {
    status: call?.status,
    answeredAt: call?.answeredAt ?? null,
    endedAt: call?.endedAt ?? null,
    outcome: call?.outcome ?? null,
    participants: participants.map((p) => ({
      actorId: p.actorId,
      joinedAt: p.joinedAt ?? null,
      leftAt: p.leftAt ?? null,
    })),
  };
}

const callEvents = async (callId: string) => {
  const rows = await g.prisma.outboxEvent.findMany({ orderBy: { createdAt: 'asc' } });
  return rows
    .filter((r) => (r.payload as { callId?: string })?.callId === callId)
    .map((r) => r.type);
};

/** The authorized direct parent <-> teacher channel the harness seeds. */
async function directCall() {
  const conv = await g.conversations.getOrCreateDirect(s.parentId, s.teacherId);
  const { callId } = await g.calls.start(conv.id, s.teacherId);
  return { conversationId: conv.id, callId };
}

const revokeRelationship = () =>
  g.prisma.learner.update({
    where: { id: s.learnerId },
    data: { teacherId: s.unrelatedTeacherId },
  });

beforeAll(async () => { await g.prisma.$connect(); });
afterAll(async () => { await g.prisma.$disconnect(); });
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
});

// -------------------------------------------------------------------------
describe('accept — the happy path still works', () => {
  it('an authorized participant answers: RINGING becomes ACTIVE and answered_at is stamped', async () => {
    const { callId } = await directCall();

    await g.calls.accept(callId, s.parentId);

    const after = await snapshot(callId);
    expect(after.status).toBe('active');
    expect(after.answeredAt).toBeInstanceOf(Date);
    expect(after.participants.find((p) => p.actorId === s.parentId)?.joinedAt).toBeInstanceOf(Date);
    // Phase 10 renamed this: an HTTP accept emits call.accepted, never
    // call.participant_joined, which means media presence.
    expect(await callEvents(callId)).toContain('call.accepted');
  });

  it('answering twice is a retry, not an error, and does not move answered_at', async () => {
    const { callId } = await directCall();

    await g.calls.accept(callId, s.parentId);
    const first = await snapshot(callId);

    await expect(g.calls.accept(callId, s.parentId)).resolves.toBeUndefined();
    const second = await snapshot(callId);

    expect(second).toEqual(first);
    // And no second join event: the retry did nothing to record.
    expect((await callEvents(callId)).filter((t) => t === 'call.accepted')).toHaveLength(1);
  });

  it('declining works, and declining again is refused rather than silently repeated', async () => {
    // Deliberately NOT idempotent-success, unlike accept. Accepting twice is a
    // retry by someone still on the call; declining twice is acting on a call
    // you already left, and authorizeJoin refuses that for the same reason it
    // refuses any other non-participant. The client treats the code as
    // terminal, which is correct: the call IS declined.
    const { callId } = await directCall();

    await g.calls.decline(callId, s.parentId);
    const first = await snapshot(callId);
    expect(first.participants.find((p) => p.actorId === s.parentId)?.leftAt).toBeInstanceOf(Date);

    await expect(g.calls.decline(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.CALL_PARTICIPANT_LEFT,
    });
    expect(await snapshot(callId)).toEqual(first);
    expect((await callEvents(callId)).filter((t) => t === 'call.declined')).toHaveLength(1);
  });
});

// -------------------------------------------------------------------------
describe('accept — authorization is re-run, and a refusal leaves no trace', () => {
  it('a revoked PD-6 relationship cannot answer: no ACTIVE, no answered_at, no event', async () => {
    const { callId } = await directCall();
    const before = await snapshot(callId);
    expect(before.status).toBe('ringing');

    await revokeRelationship();

    await expect(g.calls.accept(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.TEACHER_PARENT_NOT_AUTHORIZED,
    });

    // The whole record, not just the status.
    expect(await snapshot(callId)).toEqual(before);
    expect(await callEvents(callId)).toEqual(['call.incoming']);
  });

  it('the reverse direction: teacher starts, relationship revoked, parent cannot answer', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.teacherId, s.parentId);
    const { callId } = await g.calls.start(conv.id, s.parentId);
    const before = await snapshot(callId);

    await revokeRelationship();

    await expect(g.calls.accept(callId, s.teacherId)).rejects.toMatchObject({
      code: CommErrorCode.TEACHER_PARENT_NOT_AUTHORIZED,
    });
    expect(await snapshot(callId)).toEqual(before);
  });

  it('a revoked relationship cannot decline either', async () => {
    const { callId } = await directCall();
    const before = await snapshot(callId);

    await revokeRelationship();

    await expect(g.calls.decline(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.TEACHER_PARENT_NOT_AUTHORIZED,
    });
    expect(await snapshot(callId)).toEqual(before);
  });

  it('and the media token is refused for the same call, as it always was', async () => {
    // The control: token issuance already behaved correctly, which is why the
    // accept defect leaked no audio. Asserted so a future change cannot quietly
    // make accept strict and the token path loose.
    const { callId } = await directCall();
    await revokeRelationship();

    await expect(g.calls.issueToken(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.TEACHER_PARENT_NOT_AUTHORIZED,
    });
  });

  it('a deactivated actor cannot answer', async () => {
    const { callId } = await directCall();
    const before = await snapshot(callId);

    await g.prisma.contact.update({ where: { id: s.parentId }, data: { isActive: false } });

    await expect(g.calls.accept(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.ACTOR_INACTIVE,
    });
    expect(await snapshot(callId)).toEqual(before);
  });

  it('an actor removed from the conversation cannot answer, though the participant row remains', async () => {
    const { conversationId, callId } = await directCall();
    const before = await snapshot(callId);

    await g.prisma.conversationMember.updateMany({
      where: { conversationId, actorId: s.parentId },
      data: { leftAt: new Date() },
    });

    await expect(g.calls.accept(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.NOT_CONVERSATION_MEMBER,
    });
    expect(await snapshot(callId)).toEqual(before);
  });
});

// -------------------------------------------------------------------------
describe('unrelated actors', () => {
  it('an actor who is not a participant cannot accept, however well they know the id', async () => {
    const { callId } = await directCall();
    const before = await snapshot(callId);

    await expect(g.calls.accept(callId, s.unrelatedTeacherId)).rejects.toMatchObject({
      code: CommErrorCode.CALL_NOT_A_PARTICIPANT,
    });
    expect(await snapshot(callId)).toEqual(before);
  });

  it('...and cannot decline either: a call id is not a capability', async () => {
    const { callId } = await directCall();
    const before = await snapshot(callId);

    await expect(g.calls.decline(callId, s.unrelatedTeacherId)).rejects.toMatchObject({
      code: CommErrorCode.CALL_NOT_A_PARTICIPANT,
    });
    expect(await snapshot(callId)).toEqual(before);
  });

  it('an unknown call id is a 404, not a leak of whether it exists elsewhere', async () => {
    await expect(g.calls.accept(randomUUID(), s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.CALL_NOT_FOUND,
    });
  });
});

// -------------------------------------------------------------------------
describe('state transitions that must not happen', () => {
  it('DECLINED → ACTIVE: a participant who declined cannot then answer', async () => {
    const { callId } = await directCall();
    await g.calls.decline(callId, s.parentId);
    const afterDecline = await snapshot(callId);

    await expect(g.calls.accept(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.CALL_PARTICIPANT_LEFT,
    });
    expect(await snapshot(callId)).toEqual(afterDecline);
  });

  it('a call every other participant declined cannot be answered by the initiator', async () => {
    const { callId } = await directCall();
    await g.calls.decline(callId, s.parentId);

    await expect(g.calls.accept(callId, s.teacherId)).rejects.toMatchObject({
      code: CommErrorCode.CALL_ALREADY_DECLINED,
    });
    const after = await snapshot(callId);
    expect(after.status).toBe('ringing');
    expect(after.answeredAt).toBeNull();
  });

  it('ENDED → ACTIVE: an ended call cannot be answered, and nothing is written', async () => {
    const { callId } = await directCall();
    await g.calls.end(callId, s.teacherId);
    const afterEnd = await snapshot(callId);
    expect(afterEnd.status).toBe('ended');

    await expect(g.calls.accept(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.CALL_ALREADY_ENDED,
    });

    // No joined_at, no answered_at, no resurrection.
    expect(await snapshot(callId)).toEqual(afterEnd);
  });

  it('ENDED → DECLINED: an ended call cannot be declined', async () => {
    const { callId } = await directCall();
    await g.calls.end(callId, s.teacherId);
    const afterEnd = await snapshot(callId);

    await expect(g.calls.decline(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.CALL_ALREADY_ENDED,
    });
    expect(await snapshot(callId)).toEqual(afterEnd);
  });

  it('ACTIVE → DECLINED: an answered call is left by ending it, not by declining it', async () => {
    const { callId } = await directCall();
    await g.calls.accept(callId, s.parentId);
    const afterAccept = await snapshot(callId);

    await expect(g.calls.decline(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.CALL_NOT_RINGING,
    });
    expect(await snapshot(callId)).toEqual(afterAccept);
  });

  it('a participant who left cannot decline', async () => {
    const { callId } = await directCall();
    await g.prisma.callParticipant.updateMany({
      where: { callId, actorId: s.parentId },
      data: { leftAt: new Date() },
    });

    const before = await snapshot(callId);
    await expect(g.calls.decline(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.CALL_PARTICIPANT_LEFT,
    });
    expect(await snapshot(callId)).toEqual(before);
  });
});

// -------------------------------------------------------------------------
describe('concurrency — one winner, no torn state', () => {
  /**
   * These race real transactions against the real database. The call row is
   * taken with SELECT ... FOR UPDATE, so the second transaction blocks until
   * the first commits and then sees committed state rather than the state it
   * read before starting. Without the lock both would read RINGING and both
   * would believe they made the transition.
   */
  it('two simultaneous accepts produce one answered_at and one event', async () => {
    const { callId } = await directCall();

    const results = await Promise.allSettled([
      g.calls.accept(callId, s.parentId),
      g.calls.accept(callId, s.parentId),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    const after = await snapshot(callId);
    expect(after.status).toBe('active');
    expect(
      (await callEvents(callId)).filter((t) => t === 'call.accepted'),
    ).toHaveLength(1);
  });

  it('accept racing decline settles on exactly one of them', async () => {
    const { callId } = await directCall();

    await Promise.allSettled([
      g.calls.accept(callId, s.parentId),
      g.calls.decline(callId, s.parentId),
    ]);

    const after = await snapshot(callId);
    const mine = after.participants.find((p) => p.actorId === s.parentId)!;

    // Exactly one of the two outcomes, never both: a participant cannot have
    // answered and refused the same call.
    const answered = mine.joinedAt !== null && after.status === 'active';
    const declined = mine.leftAt !== null;
    expect(answered !== declined).toBe(true);
  });

  it('accept racing end never leaves the call ACTIVE after it ended', async () => {
    const { callId } = await directCall();

    await Promise.allSettled([
      g.calls.accept(callId, s.parentId),
      g.calls.end(callId, s.teacherId),
    ]);

    const after = await snapshot(callId);
    // Whoever won, the terminal state is terminal. A stale read could have
    // written ACTIVE over ENDED; the lock is what stops it.
    if (after.endedAt !== null) expect(after.status).toBe('ended');
  });

  it('two simultaneous declines record one leave time', async () => {
    const { callId } = await directCall();

    await Promise.allSettled([
      g.calls.decline(callId, s.parentId),
      g.calls.decline(callId, s.parentId),
    ]);

    expect((await callEvents(callId)).filter((t) => t === 'call.declined')).toHaveLength(1);
  });
});

// -------------------------------------------------------------------------
describe('history correctness — the point of the whole phase', () => {
  it('a call nobody could answer is never recorded as answered', async () => {
    const { callId } = await directCall();
    await revokeRelationship();

    await expect(g.calls.accept(callId, s.parentId)).rejects.toThrow();

    // The caller gives up and hangs up. Under the old behaviour the accept
    // above would have succeeded, answered_at would be set, and this would
    // record `answered` -- a conversation that never happened.
    await g.calls.end(callId, s.teacherId);

    const after = await snapshot(callId);
    expect(after.outcome).toBe('missed');
    expect(after.answeredAt).toBeNull();
    expect(after.participants.every((p) => p.joinedAt === null)).toBe(true);
  });

  it('duration is still measured from the real answer when one happened', async () => {
    const { callId } = await directCall();
    await g.calls.accept(callId, s.parentId);
    await g.calls.end(callId, s.teacherId);

    const after = await snapshot(callId);
    expect(after.outcome).toBe('answered');
    expect(after.answeredAt).toBeInstanceOf(Date);
  });

  it('ending still works after the relationship is revoked — no call is stranded', async () => {
    // The deliberate asymmetry: joining re-runs authorization, ending does not.
    // If a revoked relationship could block `end`, a call would sit ACTIVE
    // forever, which is a worse failure than the one this phase fixes.
    const { callId } = await directCall();
    await g.calls.accept(callId, s.parentId);

    await revokeRelationship();

    await expect(g.calls.end(callId, s.teacherId)).resolves.toBeUndefined();
    expect((await snapshot(callId)).status).toBe('ended');
  });
});
