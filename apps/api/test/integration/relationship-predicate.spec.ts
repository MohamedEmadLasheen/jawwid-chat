/**
 * PD-6 — the authorized teacher<->parent relationship predicate, at BOTH
 * layers, against the real migrated database.
 *
 * Two enforcement points answer this question independently:
 *
 *   PrismaRelationshipService.teacherParentAuthorized()  the application's answer
 *   chat.teacher_parent_authorized(uuid, uuid)           the database's answer
 *
 * Independent is the point. If the service simply called the SQL function there
 * would be one implementation wearing two hats, and a bug in it would be a bug
 * in both. So every case below is asserted against BOTH, and a third assertion
 * requires them to agree. A divergence is a failure even when both answers look
 * individually defensible — the two layers disagreeing about who may speak to
 * whom is exactly the state this design exists to prevent.
 *
 * The database's own structural suite is db/tests/relationship_predicate.sql,
 * which proves the SQL half with this process out of the picture entirely.
 *
 * The last describe block goes further: it drives the real services end to end
 * to prove the WIRING -- that ConversationService, MessageService and
 * CallService each actually resolve the relationship and pass it to the policy.
 * A policy that decides correctly on a fact it never receives is not a rule
 * anybody is enforcing.
 */
import { randomUUID } from "node:crypto";
import { PrismaRelationshipService } from "@platform/relationship.service";
import { CommErrorCode } from "@platform/errors";
import { buildGraph, withAssignmentGate } from "./harness";
import {
  parent as parentActor,
  teacher as teacherActor,
} from "../support/fixtures";

jest.setTimeout(60_000);

const g = buildGraph();
const relationships = new PrismaRelationshipService(g.prisma);

const ORG_A = "00000000-0000-0000-0000-000000000001";
const ORG_B = randomUUID();

interface World {
  adminA: string;
  familyOne: string;
  familyTwo: string;
  teacherAssigned: string;
  teacherSecond: string;
  teacherUnrelated: string;
  teacherInactive: string;
  teacherLeft: string;
  parentOk: string;
  parentInactive: string;
  parentNoMessage: string;
  parentOtherFamily: string;
  learnerOne: string;
  teacherB: string;
  parentB: string;
}

let w: World;

/** The database's own answer, reached directly. */
async function sqlSays(
  teacherId: string | null,
  contactId: string | null,
): Promise<boolean> {
  const rows = await g.prisma.$queryRawUnsafe<Array<{ ok: boolean }>>(
    "select chat.teacher_parent_authorized($1::uuid, $2::uuid) as ok",
    teacherId,
    contactId,
  );
  return rows[0].ok;
}

/**
 * Asserts both layers, and that they agree.
 *
 * Takes the expectation explicitly rather than comparing the two answers alone:
 * two layers that are wrong in the same way still agree.
 */
async function expectBothLayers(
  teacherId: string | null,
  contactId: string | null,
  expected: boolean,
): Promise<void> {
  const app =
    teacherId && contactId
      ? await relationships.teacherParentAuthorized(teacherId, contactId)
      : await relationships.teacherParentAuthorized(
          teacherId as string,
          contactId as string,
        );
  const db = await sqlSays(teacherId, contactId);

  expect({ layer: "application", authorized: app }).toEqual({
    layer: "application",
    authorized: expected,
  });
  expect({ layer: "database", authorized: db }).toEqual({
    layer: "database",
    authorized: expected,
  });
  expect({ application: app, database: db }).toEqual({
    application: expected,
    database: expected,
  });
}

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await g.prisma.$disconnect();
});

beforeEach(async () => {
  // This spec builds its own world rather than using harness seed(): PD-6 needs
  // shapes the shared fixture has no reason to carry (a second organization, a
  // contact without can_message, an offboarded teacher).
  await g.prisma.$executeRawUnsafe(`
    truncate chat.message_receipt, chat.message_reaction, chat.message_attachment,
             chat.message_hidden_for, chat.message_approval, chat.call_participant,
             chat.call, chat.notification, chat.outbox_event,
             chat.conversation_participant_state, chat.conversation_member,
             chat.message, chat.conversation, chat.learner,
             chat.contact, chat.family, chat.staff, chat.teacher,
             chat.event_log, chat.audit_log
    restart identity cascade`);

  w = {
    adminA: randomUUID(),
    familyOne: randomUUID(),
    familyTwo: randomUUID(),
    teacherAssigned: randomUUID(),
    teacherSecond: randomUUID(),
    teacherUnrelated: randomUUID(),
    teacherInactive: randomUUID(),
    teacherLeft: randomUUID(),
    parentOk: randomUUID(),
    parentInactive: randomUUID(),
    parentNoMessage: randomUUID(),
    parentOtherFamily: randomUUID(),
    learnerOne: randomUUID(),
    teacherB: randomUUID(),
    parentB: randomUUID(),
  };

  const adminB = randomUUID();
  const familyB = randomUUID();

  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name)
     values ('${ORG_B}'::uuid, 'other-academy-${ORG_B.slice(0, 8)}', 'Other Academy')
     on conflict (id) do nothing`,
  );

  // Synthetic names only (QA gate G-16).
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, organization_id, name, role) values
       ('${w.adminA}'::uuid, '${ORG_A}'::uuid, 'admin_a', 'admin'),
       ('${adminB}'::uuid,   '${ORG_B}'::uuid, 'admin_b', 'admin')`,
  );

  await g.prisma.$executeRawUnsafe(
    `insert into chat.teacher (id, organization_id, name, is_active, left_at) values
       ('${w.teacherAssigned}'::uuid,  '${ORG_A}'::uuid, 'teacher_assigned',  true,  null),
       ('${w.teacherSecond}'::uuid,    '${ORG_A}'::uuid, 'teacher_second',    true,  null),
       ('${w.teacherUnrelated}'::uuid, '${ORG_A}'::uuid, 'teacher_unrelated', true,  null),
       ('${w.teacherInactive}'::uuid,  '${ORG_A}'::uuid, 'teacher_inactive',  false, null),
       ('${w.teacherLeft}'::uuid,      '${ORG_A}'::uuid, 'teacher_left',      true,  now()),
       ('${w.teacherB}'::uuid,         '${ORG_B}'::uuid, 'teacher_b',         true,  null)`,
  );

  await g.prisma.$executeRawUnsafe(
    `insert into chat.family (id, organization_id, display_name, owner_id) values
       ('${w.familyOne}'::uuid, '${ORG_A}'::uuid, 'family_one', '${w.adminA}'::uuid),
       ('${w.familyTwo}'::uuid, '${ORG_A}'::uuid, 'family_two', '${w.adminA}'::uuid),
       ('${familyB}'::uuid,     '${ORG_B}'::uuid, 'family_b',   '${adminB}'::uuid)`,
  );

  await g.prisma.$executeRawUnsafe(
    `insert into chat.contact (id, organization_id, family_id, name, role_preset,
                               can_message, can_view_progress, can_manage_schedule,
                               can_manage_billing, can_manage_contacts, can_cancel,
                               is_active) values
       ('${w.parentOk}'::uuid,          '${ORG_A}'::uuid, '${w.familyOne}'::uuid, 'parent_ok',
        'primary_guardian',   true,  true, true, true, true, true, true),
       ('${w.parentInactive}'::uuid,    '${ORG_A}'::uuid, '${w.familyOne}'::uuid, 'parent_inactive',
        'authorized_contact', true,  true, true, true, true, true, false),
       ('${w.parentNoMessage}'::uuid,   '${ORG_A}'::uuid, '${w.familyOne}'::uuid, 'parent_no_message',
        'authorized_contact', false, true, true, true, true, true, true),
       ('${w.parentOtherFamily}'::uuid, '${ORG_A}'::uuid, '${w.familyTwo}'::uuid, 'parent_other_family',
        'primary_guardian',   true,  true, true, true, true, true, true),
       ('${w.parentB}'::uuid,           '${ORG_B}'::uuid, '${familyB}'::uuid,     'parent_b',
        'primary_guardian',   true,  true, true, true, true, true, true)`,
  );

  // The learner rows carry teacher_id, which only assignment ingestion may
  // write. These fixtures stand in for it and open the same gate.
  await withAssignmentGate(
    g.prisma,
    `insert into chat.learner (id, organization_id, family_id, name, teacher_id) values
       ('${w.learnerOne}'::uuid, '${ORG_A}'::uuid, '${w.familyOne}'::uuid, 'learner_one',   '${w.teacherAssigned}'::uuid),
       ('${randomUUID()}'::uuid, '${ORG_A}'::uuid, '${w.familyOne}'::uuid, 'learner_two',   '${w.teacherSecond}'::uuid),
       ('${randomUUID()}'::uuid, '${ORG_A}'::uuid, '${w.familyOne}'::uuid, 'learner_three', null),
       ('${randomUUID()}'::uuid, '${ORG_A}'::uuid, '${w.familyTwo}'::uuid, 'learner_four',  '${w.teacherInactive}'::uuid),
       ('${randomUUID()}'::uuid, '${ORG_A}'::uuid, '${w.familyTwo}'::uuid, 'learner_five',  '${w.teacherLeft}'::uuid),
       ('${randomUUID()}'::uuid, '${ORG_B}'::uuid, '${familyB}'::uuid,     'learner_b',     '${w.teacherB}'::uuid)`,
  );
});

// -------------------------------------------------------------------------
describe("PD-6 predicate — the authorized relationship", () => {
  it("1. authorized parent + assigned teacher → TRUE", async () => {
    await expectBothLayers(w.teacherAssigned, w.parentOk, true);
  });

  it("2. authorized teacher + assigned parent → TRUE (the same fact, asked from the teacher side)", async () => {
    // Direction is not a property of the relationship. pairingAuthorized()
    // exists so a call site never has to work out which actor is the teacher,
    // and it must answer identically whichever order it receives them in.
    const t = teacherActor(w.teacherAssigned);
    const p = parentActor(w.parentOk, w.familyOne);

    await expect(relationships.pairingAuthorized(t, p)).resolves.toBe(true);
    await expect(relationships.pairingAuthorized(p, t)).resolves.toBe(true);
  });

  it("10. a family with several learners, the teacher assigned to only one of them → TRUE", async () => {
    await expectBothLayers(w.teacherSecond, w.parentOk, true);
  });

  it("duplicate relationships do not change the answer: a second learner with the same teacher is still one TRUE", async () => {
    const before = await relationships.teacherParentAuthorized(
      w.teacherAssigned,
      w.parentOk,
    );

    await withAssignmentGate(
      g.prisma,
      `insert into chat.learner (id, organization_id, family_id, name, teacher_id)
       values ('${randomUUID()}'::uuid, '${ORG_A}'::uuid, '${w.familyOne}'::uuid,
               'learner_duplicate', '${w.teacherAssigned}'::uuid)`,
    );

    const after = await relationships.teacherParentAuthorized(
      w.teacherAssigned,
      w.parentOk,
    );
    expect({ before, after }).toEqual({ before: true, after: true });
    await expectBothLayers(w.teacherAssigned, w.parentOk, true);
  });
});

// -------------------------------------------------------------------------
describe("PD-6 predicate — no relationship", () => {
  it("3. parent + unrelated teacher → FALSE", async () => {
    await expectBothLayers(w.teacherUnrelated, w.parentOk, false);
  });

  it("4. teacher + unrelated parent → FALSE", async () => {
    await expectBothLayers(w.teacherAssigned, w.parentOtherFamily, false);
  });

  it("11. the family has learners, but none assigned to this teacher → FALSE", async () => {
    // Stated separately from case 3 because the failure it guards is different:
    // "this family has children" must never be read as "this family is
    // connected to the teaching staff".
    const learners = await g.prisma.learner.count({
      where: { familyId: w.familyOne },
    });
    expect(learners).toBeGreaterThan(1);
    await expectBothLayers(w.teacherUnrelated, w.parentOk, false);
  });

  it("a learner with no teacher assigned authorizes nobody", async () => {
    const orphan = await g.prisma.learner.findFirst({
      where: { familyId: w.familyOne, teacherId: null },
    });
    expect(orphan).not.toBeNull();
    await expectBothLayers(w.teacherUnrelated, w.parentOk, false);
  });

  it("a pairing that is not one teacher and one contact is not a teacher/parent pairing", async () => {
    const t1 = teacherActor(w.teacherAssigned);
    const t2 = teacherActor(w.teacherSecond);
    const p1 = parentActor(w.parentOk, w.familyOne);
    const p2 = parentActor(w.parentNoMessage, w.familyOne);

    await expect(relationships.pairingAuthorized(t1, t2)).resolves.toBe(false);
    await expect(relationships.pairingAuthorized(p1, p2)).resolves.toBe(false);
  });
});

// -------------------------------------------------------------------------
describe("PD-6 predicate — each party must be live", () => {
  it("5. inactive contact → FALSE", async () => {
    await expectBothLayers(w.teacherAssigned, w.parentInactive, false);
  });

  it("6. contact.can_message = false → FALSE", async () => {
    await expectBothLayers(w.teacherAssigned, w.parentNoMessage, false);
  });

  it("7. inactive teacher → FALSE, even though genuinely assigned to that family", async () => {
    const link = await g.prisma.learner.findFirst({
      where: { familyId: w.familyTwo, teacherId: w.teacherInactive },
    });
    expect(link).not.toBeNull(); // the relationship exists; only liveness fails
    await expectBothLayers(w.teacherInactive, w.parentOtherFamily, false);
  });

  it("8. teacher with left_at populated → FALSE, even with is_active still true", async () => {
    const t = await g.prisma.teacher.findUnique({
      where: { id: w.teacherLeft },
    });
    expect({ isActive: t?.isActive, hasLeft: t?.leftAt !== null }).toEqual({
      isActive: true,
      hasLeft: true,
    });
    await expectBothLayers(w.teacherLeft, w.parentOtherFamily, false);
  });
});

// -------------------------------------------------------------------------
describe("PD-6 predicate — tenant isolation", () => {
  it("control: organization B's own chain is authorized within B", async () => {
    await expectBothLayers(w.teacherB, w.parentB, true);
  });

  it("9. cross-organization: org A teacher + org B parent → FALSE", async () => {
    await expectBothLayers(w.teacherAssigned, w.parentB, false);
  });

  it("9b. cross-organization, the other direction: org B teacher + org A parent → FALSE", async () => {
    await expectBothLayers(w.teacherB, w.parentOk, false);
  });

  it("cross-tenant data cannot satisfy the predicate even through a learner row", async () => {
    // Attempt to bridge the tenants with a learner in org A pointing at org B's
    // teacher. chat.enforce_same_organization() may refuse the row outright; if
    // it does not, the predicate must still refuse the relationship.
    let bridged = true;
    try {
      // The assignment gate is opened deliberately: this case is about TENANCY.
      // Left closed, chat.guard_learner_assignment_change() refuses the row
      // first and the test would pass without ever reaching the boundary it
      // exists to prove.
      await withAssignmentGate(
        g.prisma,
        `insert into chat.learner (id, organization_id, family_id, name, teacher_id)
         values ('${randomUUID()}'::uuid, '${ORG_A}'::uuid, '${w.familyOne}'::uuid,
                 'learner_bridge', '${w.teacherB}'::uuid)`,
      );
    } catch {
      bridged = false; // the database refused the row itself
    }

    await expectBothLayers(w.teacherB, w.parentOk, false);
    // Recorded rather than asserted either way: both outcomes are safe, and
    // which one happens is a property of the tenancy triggers, not of PD-6.
    expect(typeof bridged).toBe("boolean");
  });
});

// -------------------------------------------------------------------------
describe("PD-6 predicate — revocation is immediate", () => {
  it("12. reassigning learner.teacher_id revokes on the NEXT evaluation", async () => {
    await expectBothLayers(w.teacherAssigned, w.parentOk, true);

    await withAssignmentGate(
      g.prisma,
      `update chat.learner set teacher_id = '${w.teacherUnrelated}'::uuid
        where id = '${w.learnerOne}'::uuid`,
    );

    await expectBothLayers(w.teacherAssigned, w.parentOk, false);
    // And the teacher it moved to is authorized from that moment, with no other
    // change: nothing is cached in either direction.
    await expectBothLayers(w.teacherUnrelated, w.parentOk, true);
  });

  it("deactivating the contact revokes on the next evaluation", async () => {
    await expectBothLayers(w.teacherAssigned, w.parentOk, true);
    await g.prisma.contact.update({
      where: { id: w.parentOk },
      data: { isActive: false },
    });
    await expectBothLayers(w.teacherAssigned, w.parentOk, false);
  });

  it("withdrawing can_message revokes on the next evaluation", async () => {
    await expectBothLayers(w.teacherAssigned, w.parentOk, true);
    await g.prisma.contact.update({
      where: { id: w.parentOk },
      data: { canMessage: false },
    });
    await expectBothLayers(w.teacherAssigned, w.parentOk, false);
  });

  it("offboarding the teacher revokes on the next evaluation", async () => {
    await expectBothLayers(w.teacherAssigned, w.parentOk, true);
    await g.prisma.teacher.update({
      where: { id: w.teacherAssigned },
      data: { leftAt: new Date() },
    });
    await expectBothLayers(w.teacherAssigned, w.parentOk, false);
  });
});

// -------------------------------------------------------------------------
describe("PD-6 predicate — client-supplied ids are never evidence", () => {
  it("an id that matches no row authorizes nothing", async () => {
    await expectBothLayers(randomUUID(), randomUUID(), false);
    await expectBothLayers(randomUUID(), w.parentOk, false);
    await expectBothLayers(w.teacherAssigned, randomUUID(), false);
  });

  it("transposing the arguments does not manufacture a relationship", async () => {
    // The parameters are ids, not roles. A caller who puts a contact id in the
    // teacher position is not thereby describing a teacher.
    await expectBothLayers(w.parentOk, w.teacherAssigned, false);
  });

  it("a staff id in the teacher position is not a teacher", async () => {
    await expectBothLayers(w.adminA, w.parentOk, false);
  });

  it("malformed ids are denied, not raised: a denial must look like a denial", async () => {
    // Prisma raises on a non-uuid where the column is uuid. A 500 where a 403
    // belongs would leak the difference between "no such row" and "bad input",
    // and would turn a policy decision into an error page.
    await expect(relationships.teacherParentAuthorized("", "")).resolves.toBe(
      false,
    );
    await expect(
      relationships.teacherParentAuthorized("not-a-uuid", w.parentOk),
    ).resolves.toBe(false);
    await expect(
      relationships.teacherParentAuthorized(w.teacherAssigned, "not-a-uuid"),
    ).resolves.toBe(false);
    await expect(
      relationships.teacherParentAuthorized(
        `${w.teacherAssigned}' or '1'='1`,
        w.parentOk,
      ),
    ).resolves.toBe(false);
  });

  it("null and undefined ids are denied rather than raised", async () => {
    await expect(
      relationships.teacherParentAuthorized(
        null as unknown as string,
        w.parentOk,
      ),
    ).resolves.toBe(false);
    await expect(
      relationships.teacherParentAuthorized(
        w.teacherAssigned,
        undefined as unknown as string,
      ),
    ).resolves.toBe(false);
  });

  it("the database agrees: NULL arguments are false, never NULL", async () => {
    await expect(sqlSays(null, w.parentOk)).resolves.toBe(false);
    await expect(sqlSays(w.teacherAssigned, null)).resolves.toBe(false);
    await expect(sqlSays(null, null)).resolves.toBe(false);
  });
});

// -------------------------------------------------------------------------
describe("PD-6 — the authorization switch, end to end", () => {
  /**
   * RE-VERSIONED 2026-09-23. This block previously asserted that nothing
   * consumed the predicate and that the old BR-1 denials still stood. Phase 4
   * switched the decisions, so the assertions are inverted here deliberately,
   * in the same commit that made the switch.
   *
   * These go through the real services -- ConversationService, MessageService,
   * CallService -- not through AuthorizationService directly, because the thing
   * under test is the WIRING: that each call site actually resolves the
   * relationship and passes it in. A policy that decides correctly on a fact it
   * never receives is not an enforced rule.
   */
  const openChannel = () =>
    g.conversations.getOrCreateDirect(w.teacherAssigned, w.parentOk);

  const revokeRelationship = () =>
    withAssignmentGate(
      g.prisma,
      `update chat.learner set teacher_id = '${w.teacherUnrelated}'::uuid
        where id = '${w.learnerOne}'::uuid`,
    );

  it("1. authorized relationship → direct conversation is allowed, in both directions", async () => {
    const fromTeacher = await openChannel();
    const fromParent = await g.conversations.getOrCreateDirect(
      w.parentOk,
      w.teacherAssigned,
    );
    expect(fromTeacher.id).toBe(fromParent.id);
    expect(fromTeacher.type).toBe("direct");
  });

  it("1b. unauthorized relationship → direct conversation is denied, in both directions", async () => {
    await expect(
      g.conversations.getOrCreateDirect(w.teacherUnrelated, w.parentOk),
    ).rejects.toMatchObject({
      code: CommErrorCode.TEACHER_PARENT_NOT_AUTHORIZED,
    });
    await expect(
      g.conversations.getOrCreateDirect(w.parentOk, w.teacherUnrelated),
    ).rejects.toMatchObject({
      code: CommErrorCode.TEACHER_PARENT_NOT_AUTHORIZED,
    });
  });

  it("2. authorized relationship → messaging is allowed, both ways, published immediately", async () => {
    const conv = await openChannel();

    const fromTeacher = await g.messages.send({
      conversationId: conv.id,
      senderId: w.teacherAssigned,
      body: "assalamu alaykum",
    });
    const fromParent = await g.messages.send({
      conversationId: conv.id,
      senderId: w.parentOk,
      body: "wa alaykum assalam",
    });

    // PD-6: no admin approval on this channel. Both publish immediately (BR-6).
    expect(fromTeacher.moderation).toBe("published");
    expect(fromParent.moderation).toBe("published");
  });

  it("3. authorized relationship → a direct call is allowed, started from either side", async () => {
    const conv = await openChannel();

    const byTeacher = await g.calls.start(conv.id, w.teacherAssigned);
    expect(byTeacher.callId).toBeTruthy();
    // The room is server-minted and unguessable; the client never names one.
    expect(byTeacher.roomName).toMatch(new RegExp(`^jawwid-${conv.id}-`));
    await g.calls.end(byTeacher.callId, w.teacherAssigned);

    // PD-2 restricts a parent from starting a GROUP call. A direct call to an
    // authorized teacher is not a group call and is not restricted.
    const byParent = await g.calls.start(conv.id, w.parentOk);
    expect(byParent.callId).toBeTruthy();
    await g.calls.end(byParent.callId, w.parentOk);
  });

  it("3b. an authorized participant can obtain a media token", async () => {
    const conv = await openChannel();
    const { callId } = await g.calls.start(conv.id, w.teacherAssigned);

    const token = await g.calls.issueToken(callId, w.parentOk);
    expect(token.token.split(".")).toHaveLength(3);

    // The grant is scoped to this one room and nothing else.
    const claims = JSON.parse(
      Buffer.from(token.token.split(".")[1], "base64").toString(),
    );
    expect(claims.video.room).toBe(token.roomName);
    expect(claims.video.roomCreate).toBe(false);
  });

  it("4. relationship revoked → a NEW message is denied", async () => {
    const conv = await openChannel();
    await g.messages.send({
      conversationId: conv.id,
      senderId: w.teacherAssigned,
      body: "before",
    });

    await revokeRelationship();

    // Both directions close, not just the teacher's.
    await expect(
      g.messages.send({
        conversationId: conv.id,
        senderId: w.teacherAssigned,
        body: "after",
      }),
    ).rejects.toMatchObject({
      code: CommErrorCode.TEACHER_PARENT_NOT_AUTHORIZED,
    });
    await expect(
      g.messages.send({
        conversationId: conv.id,
        senderId: w.parentOk,
        body: "after",
      }),
    ).rejects.toMatchObject({
      code: CommErrorCode.TEACHER_PARENT_NOT_AUTHORIZED,
    });
  });

  it("5. relationship revoked → a NEW call is denied", async () => {
    const conv = await openChannel();
    await revokeRelationship();

    await expect(
      g.calls.start(conv.id, w.teacherAssigned),
    ).rejects.toMatchObject({
      code: CommErrorCode.TEACHER_PARENT_NOT_AUTHORIZED,
    });
    await expect(g.calls.start(conv.id, w.parentOk)).rejects.toMatchObject({
      code: CommErrorCode.TEACHER_PARENT_NOT_AUTHORIZED,
    });
  });

  it("6. relationship revoked MID-CALL → media token issuance is denied", async () => {
    // The case that matters most. The call was authorized when it was created,
    // and a token minted from that fact alone would keep the audio path open
    // for the life of the call. Tokens are short-lived precisely so that the
    // relationship is re-asked; this proves it actually is.
    const conv = await openChannel();
    const { callId } = await g.calls.start(conv.id, w.teacherAssigned);

    // It works while the relationship stands...
    await expect(g.calls.issueToken(callId, w.parentOk)).resolves.toMatchObject(
      {
        roomName: expect.any(String),
      },
    );

    await revokeRelationship();

    // ...and stops the moment it does not, for both parties.
    await expect(g.calls.issueToken(callId, w.parentOk)).rejects.toMatchObject({
      code: CommErrorCode.TEACHER_PARENT_NOT_AUTHORIZED,
    });
    await expect(
      g.calls.issueToken(callId, w.teacherAssigned),
    ).rejects.toMatchObject({
      code: CommErrorCode.TEACHER_PARENT_NOT_AUTHORIZED,
    });
  });

  it("6b. a call whose relationship was revoked can still be ENDED — no call is stranded", async () => {
    // The corollary of re-checking on the token path: revocation must not make
    // the call un-endable, or a revoked relationship would leave calls ACTIVE
    // forever. Ending is a lifecycle write, not a new authorization.
    const conv = await openChannel();
    const { callId } = await g.calls.start(conv.id, w.teacherAssigned);
    await g.calls.accept(callId, w.parentOk);

    await revokeRelationship();

    await expect(
      g.calls.end(callId, w.teacherAssigned),
    ).resolves.toBeUndefined();
    const call = await g.prisma.call.findUnique({ where: { id: callId } });
    expect(call?.status).toBe("ended");
  });

  it("7. revocation does not delete history: past messages and calls remain", async () => {
    const conv = await openChannel();
    const msg = await g.messages.send({
      conversationId: conv.id,
      senderId: w.teacherAssigned,
      body: "kept",
    });
    const { callId } = await g.calls.start(conv.id, w.teacherAssigned);
    await g.calls.end(callId, w.teacherAssigned);

    await revokeRelationship();

    // The rows survive untouched.
    expect(
      await g.prisma.message.findUnique({ where: { id: msg.id } }),
    ).not.toBeNull();
    expect(
      await g.prisma.call.findUnique({ where: { id: callId } }),
    ).not.toBeNull();
    expect(
      await g.prisma.conversation.findUnique({ where: { id: conv.id } }),
    ).not.toBeNull();

    // And reading is governed by the ordinary read rules, which PD-6 did not
    // touch: a member may still read the conversation they were part of.
    const history = await g.calls.history(conv.id, w.teacherAssigned);
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe(callId);
  });

  it("the channel survives revocation as a record, but not as a channel", async () => {
    // Both halves of the previous two tests stated together, because the pair
    // is the actual product requirement and each alone reads as a bug.
    const conv = await openChannel();
    await revokeRelationship();

    expect(
      await g.prisma.conversation.findUnique({ where: { id: conv.id } }),
    ).not.toBeNull();
    await expect(
      g.messages.send({
        conversationId: conv.id,
        senderId: w.teacherAssigned,
        body: "nope",
      }),
    ).rejects.toMatchObject({
      code: CommErrorCode.TEACHER_PARENT_NOT_AUTHORIZED,
    });
  });

  it("anti-bypass: an unauthorized teacher cannot reach an authorized pair's conversation", async () => {
    // A conversation id is not a capability. Holding one -- by guessing it, or
    // by having been in it once -- does not authorize an actor the relationship
    // does not cover.
    const conv = await openChannel();

    await expect(
      g.messages.send({
        conversationId: conv.id,
        senderId: w.teacherUnrelated,
        body: "intruder",
      }),
    ).rejects.toMatchObject({ code: CommErrorCode.NOT_CONVERSATION_MEMBER });

    await expect(
      g.calls.start(conv.id, w.teacherUnrelated),
    ).rejects.toMatchObject({
      code: CommErrorCode.NOT_CONVERSATION_MEMBER,
    });
  });

  it("readWithMembers returns the participant set a client needs to classify the channel", async () => {
    // PD-6 made the participant set load-bearing for the client: a `direct`
    // conversation may be Parent<->Admin, Teacher<->Admin or Parent<->Teacher,
    // and the type no longer says which. API-CONTRACT section 3.4 requires
    // GET /conversations/:id to carry members[]; this is the service behind it.
    const conv = await openChannel();

    const { members } = await g.conversations.readWithMembers(
      conv.id,
      w.parentOk,
    );
    const kinds = members.map((m) => m.actorKind).sort();

    expect(kinds).toEqual(["contact", "teacher"]);
    // actorKind, not memberRole, is what the client must classify on -- a
    // teacher can carry member_role 'admin' (RT-025 C5). Both are present, so
    // the client can read the right one.
    expect(members.every((m) => typeof m.actorKind === "string")).toBe(true);
  });

  it("readWithMembers refuses a non-member: a membership list is not public", async () => {
    // The endpoint that carries members[] used to lean on a preferences upsert
    // to throw for a non-member. That was true but incidental, and not a
    // property to rely on while widening what the endpoint returns.
    const conv = await openChannel();

    await expect(
      g.conversations.readWithMembers(conv.id, w.teacherUnrelated),
    ).rejects.toMatchObject({ code: CommErrorCode.NOT_CONVERSATION_MEMBER });
  });

  it("a Parent<->Admin direct reports a different participant set, so the client can tell them apart", async () => {
    const withAdmin = await g.conversations.getOrCreateDirect(
      w.parentOk,
      w.adminA,
    );
    const { members } = await g.conversations.readWithMembers(
      withAdmin.id,
      w.parentOk,
    );
    expect(members.map((m) => m.actorKind).sort()).toEqual([
      "contact",
      "staff",
    ]);
  });

  it("the deprecated BR1_TEACHER_PARENT_DIRECT code is raised by nothing in src/", () => {
    // PD-6 keeps the constant for shipped clients that treat it as terminal.
    // Nothing in the running system may still emit it.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execSync } =
      require("node:child_process") as typeof import("node:child_process");
    const hits = execSync("grep -rn 'BR1_TEACHER_PARENT_DIRECT' src || true", {
      cwd: `${__dirname}/../..`,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean)
      // The enum declaration itself is the one legitimate mention.
      .filter((line) => !line.startsWith("src/platform/errors.ts"));

    expect(hits).toEqual([]);
  });
});
