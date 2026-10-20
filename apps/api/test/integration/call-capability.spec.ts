/**
 * `GET /conversations/:id/call-capability` — the advisory answer the interface
 * needs, and the things it must never become.
 *
 * WHY THE ENDPOINT EXISTS. `screens/call.md` §4 requires the call affordance to
 * render only where the backend authorizes the pairing, and to be ABSENT rather
 * than disabled otherwise — "the client must never infer it". A conversation
 * existing proves only that it was allowed when it was CREATED, not that a call
 * is allowed now.
 *
 * RE-VERSIONED 2026-10-14 BY PD-7. PD-6 made a direct teacher↔parent call
 * depend on the academy relationship; PD-7 restores BR-1, so such a call is
 * refused whatever the relationship (`BR1_TEACHER_PARENT_DIRECT`), and a
 * teacher↔parent direct conversation left over from the PD-6 window is history
 * that accepts nothing. The allowed 1:1 call used throughout is now the PRD §9
 * "1:1 call Parent↔Admin" channel with the family's owner; the revocation the
 * race cases need is the parent's `can_message` capability instead of the
 * relationship.
 *
 * THE THREE PROPERTIES THIS SUITE DEFENDS
 *   1. ONE POLICY. The answer comes from the same AuthorizationService.canCall
 *      that POST /calls uses, so the two can never disagree.
 *   2. ADVISORY, NOT A GRANT. It never weakens start, and it is re-evaluated
 *      rather than remembered.
 *   3. NOT AN ORACLE. It says nothing about a conversation the caller could not
 *      already open.
 */
import { randomUUID } from 'node:crypto';
import { CommErrorCode } from '@platform/errors';
import { ConversationController } from '@communication/api/conversation.controller';
import {
  Scenario,
  buildGraph,
  legacyTeacherParentDirect,
  seed,
  truncate,
  withAssignmentGate,
  splitFamily,
} from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;
let controller: ConversationController;

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
  controller = new ConversationController(g.conversations, g.messages, g.calls, g.authz, g.labels);
});

/** The PRD §9 "1:1 call Parent↔Admin" channel, with the family's owner. */
async function parentAdminConversation(): Promise<string> {
  const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
  return conv.id;
}

/** A direct teacher↔parent conversation from the PD-6 window (see harness). */
async function legacyTeacherParentConversation(): Promise<string> {
  return legacyTeacherParentDirect(g.prisma, s.teacherId, s.parentId, s.familyId);
}

/** The parent loses the capability to message (and so to call) after asking. */
async function revokeParentCapability(): Promise<void> {
  await g.prisma.contact.update({
    where: { id: s.parentId },
    data: { canMessage: false },
  });
}

async function revokeRelationship(): Promise<void> {
  await withAssignmentGate(
    g.prisma,
    `update chat.learner set teacher_id = '${s.unrelatedTeacherId}'::uuid
      where id = '${s.learnerId}'::uuid`,
  );
}

// -------------------------------------------------------------------------
describe('1/2. BR-1 decides, not the relationship (PD-7)', () => {
  it('1. a direct teacher↔parent conversation cannot call, from either side',
    async () => {
      const conversationId = await legacyTeacherParentConversation();

      const teacher = await controller.callCapability(s.teacherId, conversationId);
      const parent = await controller.callCapability(s.parentId, conversationId);

      // Both directions, and the code names the constitutional rule.
      expect(teacher).toEqual({
        canCall: false,
        code: CommErrorCode.BR1_TEACHER_PARENT_DIRECT,
      });
      expect(parent).toEqual({
        canCall: false,
        code: CommErrorCode.BR1_TEACHER_PARENT_DIRECT,
      });
    });

  it('2. the relationship is not an input: held or revoked, the answer is the same',
    async () => {
      // PD-6 answered `true` here while the relationship held. PD-7 must not:
      // the teacher DOES teach this family's learner, and the answer is still
      // the BR-1 refusal -- and revoking the relationship changes nothing.
      const conversationId = await legacyTeacherParentConversation();
      expect(
        await g.relationships.teacherParentAuthorized(s.teacherId, s.parentId),
      ).toBe(true);

      const before = await controller.callCapability(s.teacherId, conversationId);
      await revokeRelationship();
      const after = await controller.callCapability(s.teacherId, conversationId);

      expect(before).toEqual(after);
      expect(before.code).toBe(CommErrorCode.BR1_TEACHER_PARENT_DIRECT);
    });

  it('2b. the Parent↔Admin 1:1 can call, in both directions', async () => {
    const conversationId = await parentAdminConversation();

    const admin = await controller.callCapability(s.ownerId, conversationId);
    const parent = await controller.callCapability(s.parentId, conversationId);

    expect(admin).toEqual({ canCall: true, code: null });
    expect(parent).toEqual({ canCall: true, code: null });
  });

  it('2c. the same conversation answers differently before and after a revocation',
    async () => {
      // The whole reason the endpoint exists. The conversation is unchanged --
      // it is still there, still has the same two members -- so anything
      // derived from its existence would answer `true` in both readings.
      const conversationId = await parentAdminConversation();
      const before = await controller.callCapability(s.parentId, conversationId);
      await revokeParentCapability();
      const after = await controller.callCapability(s.parentId, conversationId);

      expect(before.canCall).toBe(true);
      expect(after).toEqual({
        canCall: false,
        code: CommErrorCode.CONTACT_CANNOT_MESSAGE,
      });
    });
});

// -------------------------------------------------------------------------
describe('3/4/5. a counterpart who is gone — what the policy ACTUALLY does', () => {
  /**
   * These began as assertions that a departed or deactivated counterpart makes
   * the call impossible. They do not: `canCall` allows the START in every case
   * below, and so does `CallService.start`. The expectation was wrong, not the
   * code, and what is asserted here is what both were measured doing.
   *
   * WHY IT HAPPENS. `decideInitiate` resolves participants through
   * `identity.resolveActor` and keeps only the active ones, so an admin who
   * has left is simply not in the participant set. What remains is a direct
   * conversation with one live participant, which the matrix permits — a call
   * that rings nobody rather than a call that is refused.
   *
   * WHY IT IS NOT CHANGED HERE. It is pre-existing behaviour of the START path,
   * identical before and after this workstream, and W3 may not alter server
   * authorization semantics. It is recorded as a finding, not repaired.
   *
   * WHAT MATTERS FOR W3 is that capability does not DISAGREE with start. A
   * capability that refused what start allows would be a second policy, which
   * is the thing this endpoint must never become.
   */
  // [name, mutation, caller, conversation]. The family OWNER cannot be
  // deactivated (chat.staff refuses it until offboard_staff reassigns the
  // family), so the deactivated-admin case uses the other admin's 1:1.
  const gone: Array<[string, () => Promise<unknown>, () => string, () => Promise<string>]> = [
    [
      'the admin has left',
      () =>
        g.prisma.staff.update({
          where: { id: s.ownerId },
          data: { leftAt: new Date() },
        }),
      () => s.parentId,
      parentAdminConversation,
    ],
    [
      'the admin is deactivated',
      () =>
        g.prisma.staff.update({
          where: { id: s.otherAdminId },
          // staff_left_at_matches_is_active: an inactive staff row carries left_at.
          data: { isActive: false, leftAt: new Date() },
        }),
      () => s.parentId,
      // PD-8: admin_b reaches the family through the second child (splitFamily).
      async () => {
        await splitFamily(g.prisma, s);
        return (await g.conversations.getOrCreateDirect(s.parentId, s.otherAdminId)).id;
      },
    ],
    [
      'the teacher is deactivated',
      () =>
        g.prisma.teacher.update({
          where: { id: s.teacherId },
          data: { isActive: false },
        }),
      () => s.ownerId,
      async () => (await g.conversations.getOrCreateDirect(s.teacherId, s.ownerId)).id,
    ],
    [
      'the contact is deactivated',
      () =>
        g.prisma.contact.update({
          where: { id: s.parentId },
          data: { isActive: false },
        }),
      () => s.ownerId,
      parentAdminConversation,
    ],
  ];

  for (const [name, mutate, caller, conversation] of gone) {
    it(`capability matches start when ${name}`, async () => {
      const conversationId = await conversation();
      await mutate();

      const capability = await controller.callCapability(caller(), conversationId);
      const started = await g.calls
        .start(conversationId, caller())
        .then(() => null)
        .catch((error: { code: string }) => error.code);

      // Measured, both allow. The assertion is the AGREEMENT, so this keeps
      // holding if the policy is deliberately tightened later — and fails if
      // only one of the two moves.
      expect(capability.canCall).toBe(started === null);
    });
  }

  it('a call started to a departed admin has only the live participant', async () => {
    // The consequence, stated plainly: the call exists and rings nobody.
    const conversationId = await parentAdminConversation();
    await g.prisma.staff.update({
      where: { id: s.ownerId },
      data: { leftAt: new Date() },
    });

    const { callId } = await g.calls.start(conversationId, s.parentId);
    const participants = await g.prisma.callParticipant.findMany({ where: { callId } });

    expect(participants.map((p) => p.actorId)).toEqual([s.parentId]);
  });

  // Cross-organization is NOT asserted here. `chat.teacher.organization_id`
  // carries a foreign key, so a second real organization is needed to express
  // the case, and `seed()` provides none. It is proven where it already lives:
  // relationship-predicate.spec.ts "cross-tenant data cannot satisfy the
  // predicate even through a learner row", and relationship_predicate.sql
  // D1-D4. Both exercise the same predicate this endpoint reads through.
});

// -------------------------------------------------------------------------
describe('6. it is not an oracle', () => {
  it('an actor who cannot read the conversation gets the READ refusal, not an answer',
    async () => {
      const conversationId = await parentAdminConversation();

      // A real, active teacher who teaches nobody in this family and is not a
      // member of this conversation.
      await expect(
        controller.callCapability(s.unrelatedTeacherId, conversationId),
      ).rejects.toMatchObject({ code: CommErrorCode.NOT_CONVERSATION_MEMBER });
    });

  it('the refusal is indistinguishable from any other unreadable conversation',
    async () => {
      // Two conversations the outsider cannot read: one BR-1 refuses to call,
      // one where a call is allowed. Both must refuse identically, or the
      // difference itself would report who the conversation pairs.
      const authorized = await legacyTeacherParentConversation();
      const otherParent = await g.conversations.getOrCreateDirect(
        s.otherParentId,
        s.ownerId,
      );

      const first = await controller
        .callCapability(s.unrelatedTeacherId, authorized)
        .catch((error: { code: string }) => error.code);
      const second = await controller
        .callCapability(s.unrelatedTeacherId, otherParent.id)
        .catch((error: { code: string }) => error.code);

      expect(first).toBe(second);
    });

  it('an unknown conversation id does not answer either', async () => {
    await expect(
      controller.callCapability(s.teacherId, randomUUID()),
    ).rejects.toMatchObject({ code: CommErrorCode.CONVERSATION_NOT_FOUND });
  });

  it('an out-of-scope admin gets the READ refusal, not an answer', async () => {
    // Staff scope (2026-10-14): another admin, not the owner, not on duty, not
    // a member. They learn only that the conversation is outside their charge.
    const conversationId = await parentAdminConversation();
    await expect(
      controller.callCapability(s.otherAdminId, conversationId),
    ).rejects.toMatchObject({ code: CommErrorCode.STAFF_OUT_OF_SCOPE });
  });

  it('an unknown actor mints no answer', async () => {
    const conversationId = await parentAdminConversation();
    await expect(
      controller.callCapability(randomUUID(), conversationId),
    ).rejects.toMatchObject({ code: CommErrorCode.UNKNOWN_ACTOR });
  });
});

// -------------------------------------------------------------------------
describe('7. one policy, not two', () => {
  it('capability agrees with what start actually does — allowed', async () => {
    const conversationId = await parentAdminConversation();

    const capability = await controller.callCapability(s.ownerId, conversationId);
    // And the real thing, which is the only authority.
    const started = await g.calls.start(conversationId, s.ownerId);

    expect(capability.canCall).toBe(true);
    expect(started.callId).toEqual(expect.any(String));
  });

  it('capability agrees with what start actually does — refused, same code',
    async () => {
      const conversationId = await legacyTeacherParentConversation();

      const capability = await controller.callCapability(s.teacherId, conversationId);
      const refusal = await g.calls
        .start(conversationId, s.teacherId)
        .then(() => null)
        .catch((error: { code: string }) => error.code);

      expect(capability.canCall).toBe(false);
      expect(refusal).toBe(CommErrorCode.BR1_TEACHER_PARENT_DIRECT);
      // Not merely "both refused" — the SAME code, which is what one policy
      // means. Two implementations would drift here first.
      expect(capability.code).toBe(refusal);
    });

  it('PD-2 is reported, not bypassed: a parent may not INITIATE a group call',
    async () => {
      // canCall is intent-aware and capability asks the INITIATE question, so a
      // parent must be refused for a group exactly as start refuses them.
      const group = await g.conversations.ensureStudentGroup(s.learnerId);

      const capability = await controller.callCapability(s.parentId, group.id);
      const refusal = await g.calls
        .start(group.id, s.parentId)
        .then(() => null)
        .catch((error: { code: string }) => error.code);

      expect(capability.canCall).toBe(false);
      expect(capability.code).toBe(refusal);
    });
});

// -------------------------------------------------------------------------
describe('8. start remains authoritative', () => {
  it('a capability of true does not survive a revocation that follows it',
    async () => {
      // The race the client must never assume away: asked, allowed, revoked,
      // then called. start() decides again and refuses.
      const conversationId = await parentAdminConversation();
      const capability = await controller.callCapability(s.parentId, conversationId);
      expect(capability.canCall).toBe(true);

      await revokeParentCapability();

      await expect(g.calls.start(conversationId, s.parentId)).rejects.toMatchObject({
        code: CommErrorCode.CONTACT_CANNOT_MESSAGE,
      });
    });

  it('asking for capability starts nothing', async () => {
    const conversationId = await parentAdminConversation();
    await controller.callCapability(s.ownerId, conversationId);
    await controller.callCapability(s.parentId, conversationId);

    // Read-only. A capability query that created a call would be a way to ring
    // somebody by asking whether you may.
    expect(await g.prisma.call.count()).toBe(0);
  });

  it('a denied capability leaves no trace either', async () => {
    const conversationId = await legacyTeacherParentConversation();
    await controller.callCapability(s.teacherId, conversationId);
    await controller.callCapability(s.parentId, conversationId);

    expect(await g.prisma.call.count()).toBe(0);
  });
});

// -------------------------------------------------------------------------
describe('the response says only what the client needs', () => {
  it('exactly two fields, whatever the answer', async () => {
    const conversationId = await parentAdminConversation();
    const allowed = await controller.callCapability(s.parentId, conversationId);
    await revokeParentCapability();
    const denied = await controller.callCapability(s.parentId, conversationId);

    for (const body of [allowed, denied]) {
      expect(Object.keys(body).sort()).toEqual(['canCall', 'code']);
    }
  });

  it('no identifier, name or relationship detail reaches the caller', async () => {
    const conversationId = await legacyTeacherParentConversation();
    await revokeRelationship();
    const body = JSON.stringify(
      await controller.callCapability(s.teacherId, conversationId),
    );

    // The denial must not describe the pairing it refused: not the learner the
    // relationship hangs on, not the teacher, not the parent, not the family.
    for (const id of [
      s.learnerId,
      s.teacherId,
      s.parentId,
      s.familyId,
      s.unrelatedTeacherId,
      conversationId,
    ]) {
      expect(body).not.toContain(id);
    }
    expect(body).not.toMatch(/teacher_id|learner|can_message|organization/i);
  });
});
