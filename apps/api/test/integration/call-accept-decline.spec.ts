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
 *
 * RE-VERSIONED 2026-10-14 BY PD-7. The direct call used here was the PD-6
 * teacher<->parent channel, and "revoked" meant the relationship. PD-7 restores
 * BR-1, so that channel cannot be opened any more: the call is now the PRD §9
 * "1:1 call Parent<->Admin" with the family's owner as the caller, and a
 * revocation is the parent losing `can_message` (or the admin going off duty).
 * BR-1 itself is asserted on a call that was already ringing in a PD-6-era
 * teacher<->parent conversation when the rule changed: it can be ended, never
 * answered or declined.
 */
import { randomUUID } from "node:crypto";
import { CommErrorCode } from "@platform/errors";
import {
  Scenario,
  buildGraph,
  legacyTeacherParentCall,
  legacyTeacherParentDirect,
  seed,
  truncate,
} from "./harness";

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;

/** The whole record of a call, for before/after comparison. */
async function snapshot(callId: string) {
  const call = await g.prisma.call.findUnique({ where: { id: callId } });
  const participants = await g.prisma.callParticipant.findMany({
    where: { callId },
    orderBy: { actorId: "asc" },
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
  const rows = await g.prisma.outboxEvent.findMany({
    orderBy: { createdAt: "asc" },
  });
  return rows
    .filter((r) => (r.payload as { callId?: string })?.callId === callId)
    .map((r) => r.type);
};

/** The Parent <-> Admin 1:1 (the family's owner, on duty), the admin calling. */
async function directCall() {
  const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
  const { callId } = await g.calls.start(conv.id, s.ownerId);
  return { conversationId: conv.id, callId };
}

/** The parent loses the capability to message, and therefore to call. */
const revokeParent = () =>
  g.prisma.contact.update({
    where: { id: s.parentId },
    data: { canMessage: false },
  });

/** A call already ringing in a PD-6-era teacher <-> parent conversation. */
async function legacyCall() {
  const conversationId = await legacyTeacherParentDirect(
    g.prisma, s.teacherId, s.parentId, s.familyId,
  );
  const callId = await legacyTeacherParentCall(
    g.prisma, conversationId, s.teacherId,
    { teacherId: s.teacherId, parentId: s.parentId }, s.familyId,
  );
  return { conversationId, callId };
}

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
});

// -------------------------------------------------------------------------
describe("accept — the happy path still works", () => {
  it("an authorized participant answers: RINGING becomes ACTIVE and answered_at is stamped", async () => {
    const { callId } = await directCall();

    await g.calls.accept(callId, s.parentId);

    const after = await snapshot(callId);
    expect(after.status).toBe("active");
    expect(after.answeredAt).toBeInstanceOf(Date);
    expect(
      after.participants.find((p) => p.actorId === s.parentId)?.joinedAt,
    ).toBeInstanceOf(Date);
    // Phase 10 renamed this: an HTTP accept emits call.accepted, never
    // call.participant_joined, which means media presence.
    expect(await callEvents(callId)).toContain("call.accepted");
  });

  it("answering twice is a retry, not an error, and does not move answered_at", async () => {
    const { callId } = await directCall();

    await g.calls.accept(callId, s.parentId);
    const first = await snapshot(callId);

    await expect(g.calls.accept(callId, s.parentId)).resolves.toBeUndefined();
    const second = await snapshot(callId);

    expect(second).toEqual(first);
    // And no second join event: the retry did nothing to record.
    expect(
      (await callEvents(callId)).filter((t) => t === "call.accepted"),
    ).toHaveLength(1);
  });

  it("declining ENDS the call as declined, and declining again changes nothing", async () => {
    // CHANGED BY W6. Declining used to mark only the participant and leave the
    // call ringing for the timeout sweep to record as `missed`. A refusal is now
    // the terminal transition itself, so history says what happened.
    //
    // Still deliberately NOT idempotent-success, unlike accept: the second
    // decline is refused. What matters -- and is asserted -- is that it changes
    // nothing and announces nothing, which is the property the client relies on.
    const { callId } = await directCall();

    await g.calls.decline(callId, s.parentId);
    const first = await snapshot(callId);

    expect(first.status).toBe("ended");
    expect(first.outcome).toBe("declined");
    // Refusing is not answering: no answer time, and no participant marked as
    // having joined.
    expect(first.answeredAt).toBeNull();
    expect(first.participants.every((p) => p.joinedAt === null)).toBe(true);
    // Only the decliner is marked as having left. The caller was still ringing;
    // they did not leave, and a call becoming terminal is not evidence that they
    // did. Terminal state lives in `call.status`, not in a fabricated departure.
    expect(
      first.participants.find((p) => p.actorId === s.parentId)?.leftAt,
    ).toBeInstanceOf(Date);
    expect(
      first.participants.find((p) => p.actorId === s.ownerId)?.leftAt,
    ).toBeNull();

    await expect(g.calls.decline(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.CALL_ALREADY_ENDED,
    });
    expect(await snapshot(callId)).toEqual(first);

    const events = await callEvents(callId);
    expect(events.filter((t) => t === "call.declined")).toHaveLength(1);
    // The same terminal event every other ending produces, exactly once, so a
    // client follows one ending.
    expect(events.filter((t) => t === "call.ended")).toHaveLength(1);
  });
});

// -------------------------------------------------------------------------
describe("accept — authorization is re-run, and a refusal leaves no trace", () => {
  it("a revoked parent cannot answer: no ACTIVE, no answered_at, no event", async () => {
    const { callId } = await directCall();
    const before = await snapshot(callId);
    expect(before.status).toBe("ringing");

    await revokeParent();

    await expect(g.calls.accept(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.CONTACT_CANNOT_MESSAGE,
    });

    // The whole record, not just the status.
    expect(await snapshot(callId)).toEqual(before);
    expect(await callEvents(callId)).toEqual(["call.incoming"]);
  });

  it("the reverse direction: parent starts, admin goes off duty, admin cannot answer", async () => {
    const conv = await g.conversations.getOrCreateDirect(
      s.ownerId,
      s.parentId,
    );
    const { callId } = await g.calls.start(conv.id, s.parentId);
    const before = await snapshot(callId);

    // Coverage moves to the other admin. The owner still READS the family's
    // conversations (staff scope), but may no longer act in them.
    g.coverage.onDutyId = s.otherAdminId;

    await expect(g.calls.accept(callId, s.ownerId)).rejects.toMatchObject({
      code: CommErrorCode.NOT_ON_DUTY,
    });
    expect(await snapshot(callId)).toEqual(before);
  });

  it("a revoked parent cannot decline either", async () => {
    const { callId } = await directCall();
    const before = await snapshot(callId);

    await revokeParent();

    await expect(g.calls.decline(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.CONTACT_CANNOT_MESSAGE,
    });
    expect(await snapshot(callId)).toEqual(before);
  });

  it("and the media token is refused for the same call, as it always was", async () => {
    // The control: token issuance already behaved correctly, which is why the
    // accept defect leaked no audio. Asserted so a future change cannot quietly
    // make accept strict and the token path loose.
    const { callId } = await directCall();
    await revokeParent();

    await expect(g.calls.issueToken(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.CONTACT_CANNOT_MESSAGE,
    });
  });

  it("PD-7: a teacher<->parent call ringing when BR-1 was restored cannot be answered, from either side", async () => {
    // PD-6 let the teacher ring the parent directly. Re-running authorization
    // on accept is exactly what makes PD-7 reach a call that was already
    // ringing: the relationship still holds, and neither side may answer.
    const { callId } = await legacyCall();
    const before = await snapshot(callId);
    expect(before.status).toBe("ringing");

    await expect(g.calls.accept(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.BR1_TEACHER_PARENT_DIRECT,
    });
    await expect(g.calls.accept(callId, s.teacherId)).rejects.toMatchObject({
      code: CommErrorCode.BR1_TEACHER_PARENT_DIRECT,
    });
    await expect(g.calls.decline(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.BR1_TEACHER_PARENT_DIRECT,
    });
    await expect(g.calls.issueToken(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.BR1_TEACHER_PARENT_DIRECT,
    });

    expect(await snapshot(callId)).toEqual(before);
    expect(await callEvents(callId)).toEqual([]);
  });

  it("a deactivated actor cannot answer", async () => {
    const { callId } = await directCall();
    const before = await snapshot(callId);

    await g.prisma.contact.update({
      where: { id: s.parentId },
      data: { isActive: false },
    });

    await expect(g.calls.accept(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.ACTOR_INACTIVE,
    });
    expect(await snapshot(callId)).toEqual(before);
  });

  it("an actor removed from the conversation cannot answer, though the participant row remains", async () => {
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
describe("unrelated actors", () => {
  it("an actor who is not a participant cannot accept, however well they know the id", async () => {
    const { callId } = await directCall();
    const before = await snapshot(callId);

    await expect(
      g.calls.accept(callId, s.unrelatedTeacherId),
    ).rejects.toMatchObject({
      code: CommErrorCode.CALL_NOT_A_PARTICIPANT,
    });
    expect(await snapshot(callId)).toEqual(before);
  });

  it("...and cannot decline either: a call id is not a capability", async () => {
    const { callId } = await directCall();
    const before = await snapshot(callId);

    await expect(
      g.calls.decline(callId, s.unrelatedTeacherId),
    ).rejects.toMatchObject({
      code: CommErrorCode.CALL_NOT_A_PARTICIPANT,
    });
    expect(await snapshot(callId)).toEqual(before);
  });

  it("an unknown call id is a 404, not a leak of whether it exists elsewhere", async () => {
    await expect(
      g.calls.accept(randomUUID(), s.parentId),
    ).rejects.toMatchObject({
      code: CommErrorCode.CALL_NOT_FOUND,
    });
  });
});

// -------------------------------------------------------------------------
describe("state transitions that must not happen", () => {
  it("DECLINED → ACTIVE: a participant who declined cannot then answer", async () => {
    const { callId } = await directCall();
    await g.calls.decline(callId, s.parentId);
    const afterDecline = await snapshot(callId);
    expect(afterDecline.status).toBe("ended");

    // CALL_ALREADY_ENDED since W6, where it used to be CALL_PARTICIPANT_LEFT:
    // the decline made the call terminal, so the terminal check answers first.
    // The property under test is unchanged -- a declined call cannot become
    // active, and the attempt writes nothing.
    await expect(g.calls.accept(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.CALL_ALREADY_ENDED,
    });
    expect(await snapshot(callId)).toEqual(afterDecline);
  });

  it("a call every other participant declined cannot be answered by the initiator", async () => {
    const { callId } = await directCall();
    await g.calls.decline(callId, s.parentId);

    // The property is the same and the state is now honest about it. This used
    // to be CALL_ALREADY_DECLINED against a call still sitting in `ringing`:
    // accept already knew the call was dead, but the record did not say so
    // until a sweep relabelled it `missed`. The refusal now comes from the
    // terminal state itself.
    await expect(g.calls.accept(callId, s.ownerId)).rejects.toMatchObject({
      code: CommErrorCode.CALL_ALREADY_ENDED,
    });
    const after = await snapshot(callId);
    expect(after.status).toBe("ended");
    expect(after.outcome).toBe("declined");
    expect(after.answeredAt).toBeNull();
  });

  it("ENDED → ACTIVE: an ended call cannot be answered, and nothing is written", async () => {
    const { callId } = await directCall();
    await g.calls.end(callId, s.ownerId);
    const afterEnd = await snapshot(callId);
    expect(afterEnd.status).toBe("ended");

    await expect(g.calls.accept(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.CALL_ALREADY_ENDED,
    });

    // No joined_at, no answered_at, no resurrection.
    expect(await snapshot(callId)).toEqual(afterEnd);
  });

  it("ENDED → DECLINED: an ended call cannot be declined", async () => {
    const { callId } = await directCall();
    await g.calls.end(callId, s.ownerId);
    const afterEnd = await snapshot(callId);

    await expect(g.calls.decline(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.CALL_ALREADY_ENDED,
    });
    expect(await snapshot(callId)).toEqual(afterEnd);
  });

  it("ACTIVE → DECLINED: an answered call is left by ending it, not by declining it", async () => {
    const { callId } = await directCall();
    await g.calls.accept(callId, s.parentId);
    const afterAccept = await snapshot(callId);

    await expect(g.calls.decline(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.CALL_NOT_RINGING,
    });
    expect(await snapshot(callId)).toEqual(afterAccept);
  });

  it("a participant who left cannot decline", async () => {
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
describe("concurrency — one winner, no torn state", () => {
  /**
   * These race real transactions against the real database. The call row is
   * taken with SELECT ... FOR UPDATE, so the second transaction blocks until
   * the first commits and then sees committed state rather than the state it
   * read before starting. Without the lock both would read RINGING and both
   * would believe they made the transition.
   */
  it("two simultaneous accepts produce one answered_at and one event", async () => {
    const { callId } = await directCall();

    const results = await Promise.allSettled([
      g.calls.accept(callId, s.parentId),
      g.calls.accept(callId, s.parentId),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const after = await snapshot(callId);
    expect(after.status).toBe("active");
    expect(
      (await callEvents(callId)).filter((t) => t === "call.accepted"),
    ).toHaveLength(1);
  });

  it("accept racing decline settles on exactly one of them", async () => {
    const { callId } = await directCall();

    await Promise.allSettled([
      g.calls.accept(callId, s.parentId),
      g.calls.decline(callId, s.parentId),
    ]);

    const after = await snapshot(callId);
    const mine = after.participants.find((p) => p.actorId === s.parentId)!;

    // Exactly one of the two outcomes, never both: a participant cannot have
    // answered and refused the same call.
    const answered = mine.joinedAt !== null && after.status === "active";
    const declined = mine.leftAt !== null;
    expect(answered !== declined).toBe(true);
  });

  it("accept racing end never leaves the call ACTIVE after it ended", async () => {
    const { callId } = await directCall();

    await Promise.allSettled([
      g.calls.accept(callId, s.parentId),
      g.calls.end(callId, s.ownerId),
    ]);

    const after = await snapshot(callId);
    // Whoever won, the terminal state is terminal. A stale read could have
    // written ACTIVE over ENDED; the lock is what stops it.
    if (after.endedAt !== null) expect(after.status).toBe("ended");
  });

  it("two simultaneous declines record one leave time", async () => {
    const { callId } = await directCall();

    await Promise.allSettled([
      g.calls.decline(callId, s.parentId),
      g.calls.decline(callId, s.parentId),
    ]);

    expect(
      (await callEvents(callId)).filter((t) => t === "call.declined"),
    ).toHaveLength(1);
  });
});

// -------------------------------------------------------------------------
describe("history correctness — the point of the whole phase", () => {
  it("a call nobody could answer is never recorded as answered", async () => {
    const { callId } = await directCall();
    await revokeParent();

    await expect(g.calls.accept(callId, s.parentId)).rejects.toThrow();

    // The caller gives up and hangs up. Under the old behaviour the accept
    // above would have succeeded, answered_at would be set, and this would
    // record `answered` -- a conversation that never happened.
    await g.calls.end(callId, s.ownerId);

    const after = await snapshot(callId);
    expect(after.outcome).toBe("missed");
    expect(after.answeredAt).toBeNull();
    expect(after.participants.every((p) => p.joinedAt === null)).toBe(true);
  });

  it("duration is still measured from the real answer when one happened", async () => {
    const { callId } = await directCall();
    await g.calls.accept(callId, s.parentId);
    await g.calls.end(callId, s.ownerId);

    const after = await snapshot(callId);
    expect(after.outcome).toBe("answered");
    expect(after.answeredAt).toBeInstanceOf(Date);
  });

  it("ending still works after the parent is revoked — no call is stranded", async () => {
    // The deliberate asymmetry: joining re-runs authorization, ending does not.
    // If a revocation could block `end`, a call would sit ACTIVE forever,
    // which is a worse failure than the one this phase fixes.
    const { callId } = await directCall();
    await g.calls.accept(callId, s.parentId);

    await revokeParent();

    await expect(g.calls.end(callId, s.ownerId)).resolves.toBeUndefined();
    expect((await snapshot(callId)).status).toBe("ended");
  });

  it("PD-7: a teacher<->parent call ringing when BR-1 was restored can still be ended", async () => {
    // The same asymmetry across the policy change. BR-1 refuses the answer;
    // it must not strand the call. The database refuses a teacher<->parent
    // participant set on INSERT only, so the lifecycle UPDATE goes through.
    const { callId } = await legacyCall();

    await expect(g.calls.end(callId, s.teacherId)).resolves.toBeUndefined();
    const after = await snapshot(callId);
    expect(after.status).toBe("ended");
    expect(after.outcome).toBe("missed");
    expect(after.answeredAt).toBeNull();
  });
});
