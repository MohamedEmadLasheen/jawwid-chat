/**
 * SUPERVISOR SCOPING -- the critical Phase 1 requirement.
 *
 * "A supervisor can only access families within their current authorized
 * scope", and when a family moves, the previous supervisor loses access
 * immediately and the new one gains it.
 *
 * Scoping is asserted on every surface it has to hold on, not only on
 * canRead(): conversations, messages, search, moderation, calls, notifications
 * and the family list. Solving canRead alone is explicitly not the finish line.
 */
import { randomUUID } from 'node:crypto';
import { buildGraph, seed, truncate, Scenario } from './harness';
import { CommErrorCode } from '@platform/errors';
import { ALL_FAMILIES } from '@platform/scope.service';

const g = buildGraph();
let s: Scenario;

/** A second family, supervised by the OTHER admin. Zainab and Dina, in effect. */
let otherFamilyId: string;
let otherParentId: string;
let otherConversationId: string;

const actorOf = async (id: string) => (await g.identity.resolveActor(id))!;

async function seedSecondFamily(): Promise<void> {
  otherFamilyId = randomUUID();
  otherParentId = randomUUID();
  const account = randomUUID();

  await g.prisma.$executeRawUnsafe(
    `insert into chat.account (id, subject, kind, status)
     values ('${account}'::uuid, 'subject_${otherParentId}', 'family', 'active')`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.family (id, display_name, owner_id, language)
     values ('${otherFamilyId}'::uuid, 'family_zeta', '${s.otherAdminId}'::uuid, 'ar')`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.contact (id, account_id, family_id, name, role_preset, can_message, is_active)
     values ('${otherParentId}'::uuid, '${account}'::uuid, '${otherFamilyId}'::uuid,
             'parent_z', 'primary_guardian', true, true)`,
  );
  const conv = await g.conversations.getOrCreateDirect(s.otherAdminId, otherParentId);
  otherConversationId = conv.id;
}

beforeEach(async () => {
  // The pinned coverage engine outlives a truncate, so it is reset here: a
  // staff id left over from the previous scenario points at a row that no
  // longer exists.
  g.coverage.onDutyId = null;
  await truncate(g.prisma);
  s = await seed(g.prisma);
  await seedSecondFamily();
});

afterAll(async () => {
  await g.prisma.$disconnect();
});

// -------------------------------------------------------------------------
describe('the scope matrix', () => {
  it('an admin sees the families assigned to them, and no others', async () => {
    const owner = await actorOf(s.ownerId);
    const other = await actorOf(s.otherAdminId);

    expect(await g.scope.visibleFamilies(owner)).toEqual([s.familyId]);
    expect(await g.scope.visibleFamilies(other)).toEqual([otherFamilyId]);
  });

  it('a manager sees the whole organization, which is still ONE organization', async () => {
    expect(await g.scope.visibleFamilies(await actorOf(s.managerId))).toBe(ALL_FAMILIES);
  });

  it('a parent sees exactly their own family', async () => {
    expect(await g.scope.visibleFamilies(await actorOf(s.parentId))).toEqual([s.familyId]);
  });

  it('a teacher sees the families of the learners they teach', async () => {
    expect(await g.scope.visibleFamilies(await actorOf(s.teacherId))).toEqual([s.familyId]);
  });

  it('a coverage admin sees only what an active temporary assignment gives them', async () => {
    await g.prisma.staff.update({
      where: { id: s.otherAdminId },
      data: { role: 'coverage_admin' },
    });
    const cover = await actorOf(s.otherAdminId);
    expect(await g.scope.visibleFamilies(cover)).toEqual([otherFamilyId]);

    await g.prisma.$executeRawUnsafe(
      `insert into chat.family_assignment (family_id, staff_id, kind, ends_at, reason)
       values ('${s.familyId}'::uuid, '${s.otherAdminId}'::uuid, 'temporary',
               now() + interval '1 day', 'holiday cover')`,
    );
    const covered = await g.scope.visibleFamilies(cover);
    expect([...(covered as readonly string[])].sort()).toEqual(
      [s.familyId, otherFamilyId].sort(),
    );
  });

  it('an EXPIRED temporary assignment grants nothing -- expiry is a fact about time', async () => {
    await g.prisma.$executeRawUnsafe(
      `insert into chat.family_assignment (family_id, staff_id, kind, starts_at, ends_at, reason)
       values ('${s.familyId}'::uuid, '${s.otherAdminId}'::uuid, 'temporary',
               now() - interval '2 days', now() - interval '1 day', 'expired cover')`,
    );
    // No sweep has run; the window alone decides.
    expect(await g.scope.visibleFamilies(await actorOf(s.otherAdminId))).toEqual([otherFamilyId]);
  });

  it('a departmental staff member has no family scope at all', async () => {
    await g.prisma.staff.update({
      where: { id: s.otherAdminId },
      data: { department: 'finance' },
    });
    expect(await g.scope.visibleFamilies(await actorOf(s.otherAdminId))).toEqual([]);
  });
});

// -------------------------------------------------------------------------
describe('reassignment changes access immediately', () => {
  it('the previous supervisor loses the family and the new one gains it, on the next call', async () => {
    const before = await g.conversations.getOrCreateDirect(s.ownerId, s.parentId);

    expect(await g.scope.canAccessFamily(await actorOf(s.ownerId), s.familyId)).toBe(true);
    expect(await g.scope.canAccessFamily(await actorOf(s.otherAdminId), s.familyId)).toBe(false);

    await g.families.assignSupervisor(
      await actorOf(s.managerId),
      s.familyId,
      s.otherAdminId,
      'the family moved',
    );

    // No cache to invalidate, no session to wait out: the very next read differs.
    expect(await g.scope.canAccessFamily(await actorOf(s.ownerId), s.familyId)).toBe(false);
    expect(await g.scope.canAccessFamily(await actorOf(s.otherAdminId), s.familyId)).toBe(true);

    await expect(
      g.messages.list({ conversationId: before.id, actorId: s.ownerId }),
    ).rejects.toMatchObject({ code: CommErrorCode.OUT_OF_SCOPE });
    await expect(
      g.messages.list({ conversationId: before.id, actorId: s.otherAdminId }),
    ).resolves.toBeTruthy();
  });

  it('leaves exactly one live primary assignment and records the reason', async () => {
    await g.families.assignSupervisor(
      await actorOf(s.managerId),
      s.familyId,
      s.otherAdminId,
      'the family moved',
    );
    const live = await g.prisma.familyAssignment.findMany({
      where: { familyId: s.familyId, kind: 'primary', endedAt: null },
    });
    expect(live).toHaveLength(1);
    expect(live[0].staffId).toBe(s.otherAdminId);

    const ended = await g.prisma.familyAssignment.findMany({
      where: { familyId: s.familyId, kind: 'primary', endedAt: { not: null } },
    });
    expect(ended[0].endedReason).toBe('the family moved');

    const audit = await g.prisma.auditLog.findMany({
      where: { entity: 'family', entityId: s.familyId, action: 'ownership_transferred' },
    });
    expect(audit[0]?.reason).toBe('the family moved');
  });

  it('mirrors the assignment onto family.owner_id, so older readers stay correct', async () => {
    await g.families.assignSupervisor(
      await actorOf(s.managerId),
      s.familyId,
      s.otherAdminId,
      'the family moved',
    );
    const family = await g.prisma.family.findUnique({ where: { id: s.familyId } });
    expect(family!.ownerId).toBe(s.otherAdminId);
  });

  it('refuses a reassignment from somebody without families.assign', async () => {
    await expect(
      g.families.assignSupervisor(await actorOf(s.ownerId), s.familyId, s.otherAdminId, 'nope'),
    ).rejects.toMatchObject({ code: CommErrorCode.PERMISSION_DENIED });
  });

  it('refuses a reassignment with no reason', async () => {
    await expect(
      g.families.assignSupervisor(await actorOf(s.managerId), s.familyId, s.otherAdminId, '  '),
    ).rejects.toMatchObject({ code: CommErrorCode.APPROVAL_REASON_REQUIRED });
  });

  it('refuses to assign a family to a departmental staff member', async () => {
    await g.prisma.staff.update({ where: { id: s.otherAdminId }, data: { department: 'finance' } });
    await expect(
      g.families.assignSupervisor(await actorOf(s.managerId), s.familyId, s.otherAdminId, 'no'),
    ).rejects.toThrow(/active admin or coverage admin/);
  });
});

// -------------------------------------------------------------------------
describe('scoping applies to every surface', () => {
  it('CONVERSATIONS: the list contains only in-scope conversations', async () => {
    await g.conversations.getOrCreateDirect(s.ownerId, s.parentId);

    const mine = await g.conversations.listForActor(s.ownerId);
    expect(mine.map((c) => c.familyId)).toEqual([s.familyId]);
    expect(mine.map((c) => c.id)).not.toContain(otherConversationId);

    const theirs = await g.conversations.listForActor(s.otherAdminId);
    expect(theirs.map((c) => c.familyId)).toEqual([otherFamilyId]);

    const managerSees = await g.conversations.listForActor(s.managerId);
    expect(managerSees.length).toBeGreaterThanOrEqual(2);
  });

  it('CONVERSATIONS: reading one by id out of scope is NOT FOUND, not FORBIDDEN', async () => {
    await expect(
      g.conversations.requireForActor(otherConversationId, s.ownerId),
    ).rejects.toMatchObject({ code: CommErrorCode.CONVERSATION_NOT_FOUND });
  });

  it('MESSAGES: cannot be listed, sent, or read outside scope', async () => {
    await expect(
      g.messages.list({ conversationId: otherConversationId, actorId: s.ownerId }),
    ).rejects.toMatchObject({ code: CommErrorCode.OUT_OF_SCOPE });

    await expect(
      g.messages.send({
        conversationId: otherConversationId,
        senderId: s.ownerId,
        body: 'reaching into another supervisor\'s family',
      }),
    ).rejects.toMatchObject({ code: CommErrorCode.OUT_OF_SCOPE });

    await expect(
      g.messages.markReadUpTo(otherConversationId, s.ownerId, '1'),
    ).rejects.toMatchObject({ code: CommErrorCode.OUT_OF_SCOPE });
  });

  it('SEARCH: is not a second authorization path', async () => {
    const owner = await actorOf(s.ownerId);

    // The out-of-scope family exists and matches the term exactly.
    expect(await g.families.list(owner, 'family_zeta')).toEqual([]);
    // And it is indistinguishable from a family that does not exist at all.
    expect(await g.families.list(owner, 'no_such_family_anywhere')).toEqual([]);
    // The in-scope family is still findable, so the filter works at all.
    expect((await g.families.list(owner, 'family_x')).map((f) => f.id)).toEqual([s.familyId]);
  });

  it('MODERATION: the pending queue contains nothing from another supervisor\'s family', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId);
    // Phase 6: a group holds only what the scanner flags, so the body carries a
    // phone number. That is a better fixture than the old inert one -- it is
    // the case the queue exists for, and it needs no configuration change.
    await g.messages.send({
      conversationId: group.id,
      senderId: s.teacherId,
      body: 'call me on +201012345678',
    });

    const ownerQueue = await g.approvals.listPending(s.ownerId);
    expect(ownerQueue.length).toBeGreaterThan(0);

    // The other admin supervises a different family, so the queue is empty --
    // it used to return every pending approval in the system (red-team A-2).
    expect(await g.approvals.listPending(s.otherAdminId)).toEqual([]);
    // Naming the conversation explicitly does not widen it either.
    expect(await g.approvals.listPending(s.otherAdminId, group.id)).toEqual([]);
  });

  it('CALLS: history and token minting respect the same boundary', async () => {
    await expect(
      g.calls.history(otherConversationId, s.ownerId),
    ).rejects.toMatchObject({ code: CommErrorCode.OUT_OF_SCOPE });

    const conv = await g.conversations.getOrCreateDirect(s.ownerId, s.parentId);
    // Starting a call still needs the ordinary send permission, which for a
    // supervisor means being on duty. Scope is the thing under test here.
    g.coverage.onDutyId = s.ownerId;
    const call = await g.calls.start(conv.id, s.ownerId);
    // Refused on the participant set, which is the stricter of the two checks
    // for this path: the other admin is not merely out of scope, they were
    // never invited. Both are enforced; this one answers first.
    await expect(g.calls.issueToken(call.callId, s.otherAdminId)).rejects.toMatchObject({
      code: CommErrorCode.CALL_NOT_A_PARTICIPANT,
    });
  });

  it('NOTIFICATIONS: a notification is addressed to one actor and answers to nobody else', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.ownerId, s.parentId);
    await g.messages.send({ conversationId: conv.id, senderId: s.parentId, body: 'hello' });

    const created = await g.prisma.notification.create({
      data: {
        dedupeKey: `test-${randomUUID()}`,
        templateKey: 'message.new',
        eventType: 'message.created',
        recipientId: s.ownerId,
        familyId: s.familyId,
        conversationId: conv.id,
        scheduledAt: new Date(),
        status: 'sent',
      },
    });

    // Another actor marking it delivered changes nothing: the recipient is part
    // of the WHERE clause, so ids cannot be probed for state changes.
    await g.notifications.markDelivered(created.id, s.otherAdminId);
    expect((await g.prisma.notification.findUnique({ where: { id: created.id } }))!.status).toBe(
      'sent',
    );

    await g.notifications.markDelivered(created.id, s.ownerId);
    expect((await g.prisma.notification.findUnique({ where: { id: created.id } }))!.status).toBe(
      'delivered',
    );
  });

  it('DASHBOARD-STYLE COUNTS: derived from the scoped query, not from a raw count', async () => {
    await g.conversations.getOrCreateDirect(s.ownerId, s.parentId);

    const ownerCount = (await g.conversations.listForActor(s.ownerId)).length;
    const totalCount = await g.prisma.conversation.count();
    expect(totalCount).toBeGreaterThan(ownerCount);

    const ownerFamilies = await g.families.list(await actorOf(s.ownerId));
    expect(ownerFamilies).toHaveLength(1);
    expect((await g.families.list(await actorOf(s.managerId))).length).toBeGreaterThanOrEqual(2);
  });
});

// -------------------------------------------------------------------------
describe('IDOR: changing an id in a request never grants access', () => {
  it('GET /families/:id for another supervisor\'s family', async () => {
    await expect(g.families.get(await actorOf(s.ownerId), otherFamilyId)).rejects.toMatchObject({
      code: CommErrorCode.CONVERSATION_NOT_FOUND,
    });
  });

  it('a family id that does not exist is refused identically', async () => {
    const invented = randomUUID();
    const real = await g.families.get(await actorOf(s.ownerId), otherFamilyId).catch((e) => e);
    const fake = await g.families.get(await actorOf(s.ownerId), invented).catch((e) => e);
    expect(real.code).toBe(fake.code);
    expect(real.message).toBe(fake.message);
  });

  it('POST a message naming another family\'s conversation', async () => {
    await expect(
      g.messages.send({ conversationId: otherConversationId, senderId: s.ownerId, body: 'x' }),
    ).rejects.toMatchObject({ code: CommErrorCode.OUT_OF_SCOPE });
  });

  it('a parent cannot reach another family\'s conversation by naming it', async () => {
    await expect(
      g.messages.list({ conversationId: otherConversationId, actorId: s.parentId }),
    ).rejects.toMatchObject({ code: CommErrorCode.NOT_CONVERSATION_MEMBER });
  });

  it('a teacher cannot reach a family they do not teach', async () => {
    await expect(
      g.messages.list({ conversationId: otherConversationId, actorId: s.teacherId }),
    ).rejects.toMatchObject({ code: CommErrorCode.NOT_CONVERSATION_MEMBER });
  });

  it('a supervisor cannot open a 1:1 with a contact outside their scope', async () => {
    await expect(
      g.conversations.getOrCreateDirect(s.ownerId, otherParentId),
    ).rejects.toMatchObject({ code: CommErrorCode.OUT_OF_SCOPE });
  });

  it('membership of another family\'s group cannot be changed', async () => {
    await expect(
      g.conversations.setMembership(
        otherConversationId,
        s.ownerId,
        { actorId: s.ownerId, actorKind: 'staff', memberRole: 'admin' },
        'add',
        'attack',
      ),
    ).rejects.toMatchObject({ code: CommErrorCode.OUT_OF_SCOPE });
  });

  it('an approval belonging to another family cannot be decided', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId);
    const held = await g.messages.send({
      conversationId: group.id,
      senderId: s.teacherId,
      // Phase 6: flagged content, so the message is held and there is an
      // approval to attempt the IDOR against.
      body: 'call me on +201012345678',
    });
    const approval = await g.prisma.messageApproval.findUnique({
      where: { messageId: held.id },
    });
    await expect(g.approvals.approve(approval!.id, s.otherAdminId)).rejects.toMatchObject({
      code: CommErrorCode.OUT_OF_SCOPE,
    });
  });
});
