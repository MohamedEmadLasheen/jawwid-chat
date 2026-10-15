/**
 * C3/C4 + PD-7 -- every message, attachment, approval, call and receipt path
 * enforces the SAME effective policy as the conversation list and the
 * conversation read, attacked by direct resource id on a real database with
 * two organizations.
 *
 *   PD-7 (2026-10-14)   no NEW direct teacher<->parent conversation or call, by
 *                       any route; a PD-6-era one is readable history and
 *                       accepts nothing new (message, upload, reaction, call).
 *   C0 Decision 5       a staff member holds a 1:1 only with a family in their
 *                       charge (owner admin, on duty, or a manager).
 *   C0 Decision 6       approvals stay inside the organization and the
 *                       moderation scope, before the 200-row cap.
 *   scoped read (C1)    organization first (another tenant reads as missing),
 *                       then role (super_admin and department staff never by
 *                       role), then staff scope.
 *
 * Every refusal is checked for leaving the database as it was.
 */
import { randomUUID } from 'node:crypto';
import { CommError, CommErrorCode } from '@platform/errors';
import { MessageController } from '@communication/api/message.controller';
import { NotificationController } from '@communication/api/notification.controller';
import {
  buildGraph,
  existingDirect,
  legacyTeacherParentDirect,
  seed,
  truncate,
  Scenario,
} from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
const ORG_SLUG_PREFIX = 'advp-';
let s: Scenario;

/** Organization B, and actors of organization A outside the scenario. */
let b: { orgId: string; managerId: string; adminId: string; familyId: string; contactId: string; direct: string };
let x: { superAdminId: string };
/** Organization A rows under attack. */
let a: { direct: string; group: string; legacy: string; message: string; legacyMessage: string };

async function refusal(p: Promise<unknown>): Promise<CommError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e;
    throw e;
  }
  throw new Error('expected a refusal, but the operation succeeded');
}

/** Row counts of everything an operation in this file could write. */
async function footprint() {
  const [conversations, members, messages, approvals, reactions, calls, receiptsRead] = await Promise.all([
    g.prisma.conversation.count(),
    g.prisma.conversationMember.count(),
    g.prisma.message.count(),
    g.prisma.messageApproval.count({ where: { decision: { not: 'pending' } } }),
    g.prisma.messageReaction.count(),
    g.prisma.call.count(),
    g.prisma.messageReceipt.count({ where: { state: { not: 'sent' } } }),
  ]);
  return { conversations, members, messages, approvals, reactions, calls, receiptsRead };
}

beforeAll(async () => {
  await g.prisma.$connect();
});

afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like '${ORG_SLUG_PREFIX}%'`);
  await g.prisma.$disconnect();
});

beforeEach(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like '${ORG_SLUG_PREFIX}%'`);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;

  x = { superAdminId: randomUUID() };
  await g.prisma.$transaction([
    g.prisma.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`),
    g.prisma.$executeRawUnsafe(
      `insert into chat.staff (id, name, role, is_active) values ('${x.superAdminId}'::uuid, 'super_s', 'super_admin', true)`,
    ),
  ]);

  b = {
    orgId: randomUUID(),
    managerId: randomUUID(),
    adminId: randomUUID(),
    familyId: randomUUID(),
    contactId: randomUUID(),
    direct: '',
  };
  const o = `'${b.orgId}'::uuid`;
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values (${o}, '${ORG_SLUG_PREFIX}${b.orgId.slice(0, 8)}', 'org_b')`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active, organization_id) values
       ('${b.managerId}'::uuid, 'manager_b', 'manager', true, ${o}),
       ('${b.adminId}'::uuid, 'admin_b', 'admin', true, ${o})`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.family (id, display_name, owner_id, language, organization_id)
     values ('${b.familyId}'::uuid, 'family_b', '${b.adminId}'::uuid, 'ar', ${o})`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active, organization_id)
     values ('${b.contactId}'::uuid, '${b.familyId}'::uuid, 'parent_b', 'primary_guardian', true, true, ${o})`,
  );
  // The real creation path: admin_b owns family_b, so Decision 5 admits it.
  b.direct = (await g.conversations.getOrCreateDirect(b.contactId, b.adminId)).id;

  const direct = (await g.conversations.getOrCreateDirect(s.parentId, s.ownerId)).id;
  const group = (await g.conversations.ensureStudentGroup(s.learnerId)).id;
  const legacy = await legacyTeacherParentDirect(g.prisma, s.teacherId, s.parentId, s.familyId);
  const message = (await g.messages.send({ conversationId: direct, senderId: s.parentId, body: 'hello' })).id;
  // A message the PD-6 window left in the legacy conversation, written as the
  // fixture writes the conversation itself (the PD-7 message guard refuses it).
  const legacyMessage = await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local session_replication_role = replica`);
    const m = await tx.message.create({
      data: { conversationId: legacy, authorType: 'teacher', authorId: s.teacherId, body: 'pd6-era', visibility: 'customer' },
    });
    await tx.messageReceipt.create({ data: { messageId: m.id, actorId: s.parentId, state: 'sent' } });
    return m.id;
  });
  a = { direct, group, legacy, message, legacyMessage };
});

// ===========================================================================
describe('PD-7: no new direct teacher<->parent channel, by any route', () => {
  it('neither side can open one, and nothing is written', async () => {
    const before = await footprint();
    for (const [from, to] of [[s.teacherId, s.parentId], [s.parentId, s.teacherId]]) {
      const e = await refusal(g.conversations.getOrCreateDirect(from, to));
      expect([e.code, e.status]).toEqual([CommErrorCode.BR1_TEACHER_PARENT_DIRECT, 403]);
    }
    expect(await footprint()).toEqual(before);
  });

  it('the existing PD-6-era conversation is NOT handed back by get-or-create', async () => {
    // canOpenDirect runs before the existing-row lookup.
    const e = await refusal(g.conversations.getOrCreateDirect(s.parentId, s.teacherId));
    expect(e.code).toBe(CommErrorCode.BR1_TEACHER_PARENT_DIRECT);
  });

  it('a teacher cannot be added to the parent\'s direct conversation with an admin (direct membership is immutable)', async () => {
    const before = await footprint();
    await expect(
      g.conversations.setMembership(a.direct, s.ownerId, { actorId: s.teacherId, actorKind: 'teacher', memberRole: 'teacher' }, 'add', 'x'),
    ).rejects.toBeInstanceOf(CommError);
    expect(await footprint()).toEqual(before);
  });
});

// ===========================================================================
describe('PD-7: a PD-6-era direct teacher<->parent conversation is read-only history', () => {
  it('both members still read it: listed, opened, its messages listed', async () => {
    for (const actorId of [s.teacherId, s.parentId]) {
      expect((await g.conversations.listForActor(actorId)).map((c) => c.id)).toContain(a.legacy);
      await expect(g.conversations.readWithMembers(a.legacy, actorId)).resolves.toBeDefined();
      const page = await g.messages.list({ conversationId: a.legacy, actorId });
      expect(page.messages.map((m) => m.id)).toEqual([a.legacyMessage]);
    }
  });

  it('nothing new gets in from either side: no message, upload, reaction or call -- and nothing is written', async () => {
    const before = await footprint();
    for (const actorId of [s.teacherId, s.parentId]) {
      const attempts: Array<() => Promise<unknown>> = [
        () => g.messages.send({ conversationId: a.legacy, senderId: actorId, body: 'still here?' }),
        () => g.attachments.authorizeUpload({
          actorId, conversationId: a.legacy, kind: 'voice', mimeType: 'audio/mp4', byteSize: 1024,
        }),
        () => g.messages.react(a.legacyMessage, actorId, '👍'),
        () => g.calls.start(a.legacy, actorId),
      ];
      for (const attempt of attempts) {
        expect((await refusal(attempt())).code).toBe(CommErrorCode.BR1_TEACHER_PARENT_DIRECT);
      }
      const capability = await g.calls.callCapability(a.legacy, actorId);
      expect(capability).toEqual({ canCall: false, code: CommErrorCode.BR1_TEACHER_PARENT_DIRECT });
    }
    expect(await footprint()).toEqual(before);
  });

  it('the reader\'s own state still works: read cursor and hiding a message', async () => {
    await g.messages.markReadUpTo(a.legacy, s.parentId, '999');
    await g.messages.deleteForMe(a.legacyMessage, s.parentId);
    expect(await g.prisma.messageHiddenFor.count({ where: { messageId: a.legacyMessage } })).toBe(1);
  });
});

// ===========================================================================
describe('C0 Decision 5: a staff member opens a 1:1 only with a family in their charge', () => {
  it('an admin with no charge of the family cannot open one, from either side, and nothing is written', async () => {
    const before = await footprint();
    for (const [from, to] of [[s.otherAdminId, s.parentId], [s.parentId, s.otherAdminId]]) {
      const e = await refusal(g.conversations.getOrCreateDirect(from, to));
      expect([e.code, e.status]).toEqual([CommErrorCode.NOT_CONVERSATION_MEMBER, 403]);
    }
    expect(await footprint()).toEqual(before);
  });

  it('the owner, a manager, and an admin on duty for the family can', async () => {
    await expect(g.conversations.getOrCreateDirect(s.ownerId, s.otherParentId)).resolves.toBeDefined();
    await expect(g.conversations.getOrCreateDirect(s.managerId, s.otherParentId)).resolves.toBeDefined();
    g.coverage.onDutyId = s.otherAdminId;
    await expect(g.conversations.getOrCreateDirect(s.otherAdminId, s.otherParentId)).resolves.toBeDefined();
  });

  it('a super_admin cannot, by role', async () => {
    const e = await refusal(g.conversations.getOrCreateDirect(x.superAdminId, s.parentId));
    expect(e.code).toBe(CommErrorCode.ROLE_CANNOT_MESSAGE_FAMILY);
  });
});

// ===========================================================================
describe('an admin of the SAME organization with no charge of the family, by direct id', () => {
  it('reads nothing: detail, preferences, messages, unread, call history, call capability, approval history', async () => {
    const attempts: Array<() => Promise<unknown>> = [
      () => g.conversations.readWithMembers(a.direct, s.otherAdminId),
      () => g.conversations.setPreferences(a.direct, s.otherAdminId, { pinned: true }),
      () => g.messages.list({ conversationId: a.direct, actorId: s.otherAdminId }),
      () => g.messages.unreadCount(a.direct, s.otherAdminId),
      () => g.messages.markReadUpTo(a.direct, s.otherAdminId, '1'),
      () => g.calls.history(a.direct, s.otherAdminId),
      () => g.calls.callCapability(a.direct, s.otherAdminId),
      () => g.approvals.history(a.direct, s.otherAdminId),
      () => g.messages.react(a.message, s.otherAdminId, '👍'),
      () => g.messages.deleteForMe(a.message, s.otherAdminId),
    ];
    const before = await footprint();
    for (const attempt of attempts) {
      expect((await refusal(attempt())).code).toBe(CommErrorCode.NOT_CONVERSATION_MEMBER);
    }
    expect(await footprint()).toEqual(before);
  });

  it('writes nothing: an internal note and an internal upload are refused (they used to need only a family-facing role)', async () => {
    const before = await footprint();
    const note = await refusal(
      g.messages.send({ conversationId: a.direct, senderId: s.otherAdminId, body: 'note', visibility: 'internal' }),
    );
    expect(note.code).toBe(CommErrorCode.NOT_CONVERSATION_MEMBER);
    const upload = await refusal(
      g.attachments.authorizeUpload({
        actorId: s.otherAdminId, conversationId: a.direct, kind: 'image', mimeType: 'image/jpeg', byteSize: 10, visibility: 'internal',
      }),
    );
    expect(upload.code).toBe(CommErrorCode.NOT_CONVERSATION_MEMBER);
    // A customer message keeps canSend's own refusal (asked first).
    const reply = await refusal(g.messages.send({ conversationId: a.direct, senderId: s.otherAdminId, body: 'hi' }));
    expect(reply.code).toBe(CommErrorCode.NOT_ON_DUTY);
    expect(await footprint()).toEqual(before);
  });

  it('positive control: the owner, on duty, does all of it', async () => {
    await expect(g.messages.list({ conversationId: a.direct, actorId: s.ownerId })).resolves.toBeDefined();
    await expect(
      g.messages.send({ conversationId: a.direct, senderId: s.ownerId, body: 'note', visibility: 'internal' }),
    ).resolves.toBeDefined();
    await expect(g.messages.unreadCount(a.direct, s.ownerId)).resolves.toBe(1);
    await expect(g.calls.history(a.direct, s.ownerId)).resolves.toEqual([]);
  });
});

// ===========================================================================
describe('another organization, by direct id: every path answers "not found"', () => {
  it('its manager and admin get the 404 an unknown id gets, and nothing is written', async () => {
    const before = await footprint();
    for (const actorId of [b.managerId, b.adminId]) {
      const conversationLevel: Array<() => Promise<unknown>> = [
        () => g.conversations.readWithMembers(a.direct, actorId),
        () => g.messages.list({ conversationId: a.direct, actorId }),
        () => g.messages.unreadCount(a.direct, actorId),
        () => g.messages.send({ conversationId: a.direct, senderId: actorId, body: 'x', visibility: 'internal' }),
        () => g.attachments.authorizeUpload({
          actorId, conversationId: a.direct, kind: 'image', mimeType: 'image/jpeg', byteSize: 10, visibility: 'internal',
        }),
        () => g.calls.history(a.direct, actorId),
        () => g.approvals.history(a.direct, actorId),
      ];
      for (const attempt of conversationLevel) {
        const e = await refusal(attempt());
        expect([e.code, e.status]).toEqual([CommErrorCode.CONVERSATION_NOT_FOUND, 404]);
      }
      // A message id confirms nothing across the boundary: the same answer as
      // a random id, including for a manager's delete-for-everyone.
      const unknown = await refusal(g.messages.react(randomUUID(), actorId, '👍'));
      for (const attempt of [
        () => g.messages.react(a.message, actorId, '👍'),
        () => g.messages.deleteForEveryone(a.message, actorId, 'cross-tenant'),
      ]) {
        const e = await refusal(attempt());
        expect([e.code, e.status, e.message]).toEqual([unknown.code, unknown.status, unknown.message]);
      }
      expect(await g.messages.markDelivered([a.message], actorId)).toBe(0);
    }
    expect(await footprint()).toEqual(before);
    expect((await g.prisma.message.findUniqueOrThrow({ where: { id: a.message } })).deletedForAll).toBe(false);
  });
});

// ===========================================================================
describe('super_admin gains no family-facing access by role', () => {
  it('lists nothing, reads nothing, moderates nothing', async () => {
    for (const attempt of [
      () => g.conversations.listForActor(x.superAdminId),
      () => g.messages.list({ conversationId: a.direct, actorId: x.superAdminId }),
      () => g.calls.history(a.direct, x.superAdminId),
      () => g.messages.react(a.message, x.superAdminId, '👍'),
    ]) {
      expect((await refusal(attempt())).code).toBe(CommErrorCode.ROLE_CANNOT_MESSAGE_FAMILY);
    }
    expect((await refusal(g.approvals.listPending(x.superAdminId))).code).toBe(CommErrorCode.CANNOT_APPROVE);
  });
});

// ===========================================================================
describe('C0 Decision 6: the approval queue', () => {
  /** 205 held messages in organization B, all OLDER than organization A's one. */
  async function floodOrganizationB(): Promise<void> {
    await g.prisma.$executeRawUnsafe(
      `with m as (
         insert into chat.message (author_type, author_id, body, visibility, conversation_id, moderation, organization_id, created_at)
         select 'contact', '${b.contactId}'::uuid, 'held ' || i, 'customer', '${b.direct}'::uuid, 'pending', '${b.orgId}'::uuid,
                now() - interval '1 hour'
           from generate_series(1, 205) i
         returning id)
       insert into chat.message_approval (organization_id, message_id, conversation_id, requested_by, created_at)
       select '${b.orgId}'::uuid, id, '${b.direct}'::uuid, '${b.contactId}'::uuid, now() - interval '1 hour' from m`,
    );
  }

  async function heldInGroup(): Promise<{ messageId: string; approvalId: string }> {
    const m = await g.messages.send({ conversationId: a.group, senderId: s.parentId, body: 'please approve' });
    expect(m.moderation).toBe('pending');
    const approval = await g.prisma.messageApproval.findUniqueOrThrow({ where: { messageId: m.id } });
    return { messageId: m.id, approvalId: approval.id };
  }

  it('the organization is applied BEFORE the 200 cap: a flood of older foreign approvals cannot push our own out', async () => {
    await floodOrganizationB();
    const held = await heldInGroup();
    const managerA = await g.approvals.listPending(s.managerId);
    expect(managerA.map((r) => r.approvalId)).toEqual([held.approvalId]);
    const managerB = await g.approvals.listPending(b.managerId);
    expect(managerB).toHaveLength(200);
    expect(managerB.every((r) => r.conversationId === b.direct)).toBe(true);
  });

  it('within the organization, the active handler sees the queue; an admin handling nothing sees none of it', async () => {
    const held = await heldInGroup();
    expect((await g.approvals.listPending(s.ownerId)).map((r) => r.approvalId)).toEqual([held.approvalId]);
    expect(await g.approvals.listPending(s.otherAdminId)).toEqual([]);
    // ... and cannot decide it.
    expect((await refusal(g.approvals.approve(held.approvalId, s.otherAdminId))).code).toBe(CommErrorCode.CANNOT_APPROVE);
  });

  it('another organization cannot decide it: the 404 an unknown approval gets, and the approval stays pending', async () => {
    const held = await heldInGroup();
    const unknown = await refusal(g.approvals.approve(randomUUID(), b.managerId));
    for (const actorId of [b.managerId, b.adminId]) {
      for (const attempt of [
        () => g.approvals.approve(held.approvalId, actorId),
        () => g.approvals.reject(held.approvalId, actorId, 'cross-tenant'),
      ]) {
        const e = await refusal(attempt());
        expect([e.code, e.status, e.message]).toEqual([unknown.code, unknown.status, unknown.message]);
      }
    }
    expect((await g.prisma.messageApproval.findUniqueOrThrow({ where: { id: held.approvalId } })).decision).toBe('pending');
  });

  it('even when the organization-blind coverage engine names a FOREIGN admin as the handler', async () => {
    const held = await heldInGroup();
    g.coverage.onDutyId = b.adminId; // what chat.on_duty() can do with a global rule
    const e = await refusal(g.approvals.approve(held.approvalId, b.adminId));
    expect(e.status).toBe(404);
    expect(await g.approvals.listPending(b.adminId)).toEqual([]);
    expect((await g.prisma.messageApproval.findUniqueOrThrow({ where: { id: held.approvalId } })).decision).toBe('pending');
  });

  it('positive control: the active handler decides it', async () => {
    const held = await heldInGroup();
    await g.approvals.approve(held.approvalId, s.ownerId);
    expect((await g.prisma.messageApproval.findUniqueOrThrow({ where: { id: held.approvalId } })).decision).toBe('approved');
  });
});

// ===========================================================================
describe('HTTP receipt routes follow the read policy', () => {
  const controller = () => new MessageController(g.messages, g.attachments);

  it('POST .../:messageId/delivered marks only while the actor may read, and only within the named conversation', async () => {
    const http = controller();
    // The owner holds a receipt for the parent's message.
    expect(await http.delivered(s.ownerId, a.group, a.message)).toEqual({ updated: 0 }); // wrong conversation
    expect(await http.delivered(s.ownerId, a.direct, a.message)).toEqual({ updated: 1 });

    // A reader who HOLDS a receipt but has lost access marks nothing: the
    // parent's receipt for a staff message in the group, after the parent left.
    const staffMessage = await g.messages.send({ conversationId: a.group, senderId: s.ownerId, body: 'for the group' });
    await g.prisma.conversationMember.updateMany({
      where: { conversationId: a.group, actorId: s.parentId },
      data: { leftAt: new Date() },
    });
    expect(await http.delivered(s.parentId, a.group, staffMessage.id)).toEqual({ updated: 0 });
    const receipt = await g.prisma.messageReceipt.findFirstOrThrow({
      where: { messageId: staffMessage.id, actorId: s.parentId },
    });
    expect(receipt.state).toBe('sent');
  });

  it('GET .../unread refuses a reader without access instead of answering with a count', async () => {
    const http = controller();
    expect((await refusal(http.unread(s.otherAdminId, a.direct))).code).toBe(CommErrorCode.NOT_CONVERSATION_MEMBER);
    expect((await refusal(http.unread(b.managerId, a.direct))).status).toBe(404);
    expect(await http.unread(s.ownerId, a.direct)).toEqual({ unread: 1 });
  });
});

// ===========================================================================
describe('HTTP notification receipts belong to their recipient', () => {
  it('POST /notifications/:id/delivered by anyone but the recipient changes nothing; the recipient\'s does', async () => {
    const n = await g.prisma.notification.create({
      data: {
        dedupeKey: `scope-${randomUUID()}`,
        templateKey: 'incoming_call',
        eventType: 'call.incoming',
        recipientId: s.parentId,
        status: 'sent',
        scheduledAt: new Date(),
        sentAt: new Date(),
      },
    });
    const http = new NotificationController(g.notifications);
    for (const actorId of [s.otherParentId, s.ownerId, b.managerId]) {
      await http.delivered(actorId, n.id);
      expect((await g.prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).status).toBe('sent');
    }
    await http.delivered(s.parentId, n.id);
    expect((await g.prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).status).toBe('delivered');
  });
});
