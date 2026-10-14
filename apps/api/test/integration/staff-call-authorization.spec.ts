/**
 * STAFF ON THE CALL PATH -- the regression suite for Admin Portal voice calls.
 *
 * Admin Web will call through the SAME `CallService` the apps use. Before a
 * browser client is allowed to reach it, three defects in how that service
 * treats a STAFF actor have to be closed, and this file is where each one is
 * reproduced against the real migrated database and then held closed:
 *
 *   D1  PHANTOM INITIATOR (PD-A). `canCall(INITIATE)` for staff is `canSend`,
 *       which does not require membership for a manager, an on-duty admin in a
 *       family conversation, or any family-facing staff in a family-less group.
 *       `start()` takes the participant set from conversation membership, so
 *       such a caller rang everybody and was not on the call -- no token, no
 *       hang-up. PD-A: the caller must be a participant, or nothing is created.
 *
 *   D2  RUNG BUT UNABLE TO ANSWER (PD-B). `authorizeJoin` re-ran `canSend`, so
 *       a staff participant who was rung was refused `NOT_ON_DUTY` on accept,
 *       decline and token the moment they were off shift. PD-B: answering is
 *       decided by the participant record, the actor's active status, live
 *       membership and the organization -- not by the on-duty rule that governs
 *       initiating. An unrelated on-duty admin still may not answer.
 *
 *   D3  ORGANIZATION ISOLATION. Neither `canSend` nor `CallService` compares
 *       organizations, and `chat.call` has no same-organization trigger. A
 *       call is refused across organizations exactly as a nonexistent one is
 *       (`CONVERSATION_NOT_FOUND` / `CALL_NOT_FOUND`, the RT-030 convention), and
 *       every row the call writes is filed under the conversation's
 *       organization.
 *
 * WHAT MUST NOT MOVE. Parent and teacher behaviour is pinned by the existing
 * call suites, which this file does not touch. The cases here marked
 * "unchanged" pin staff behaviour that is already correct, so a fix for D1-D3
 * cannot quietly widen or narrow it.
 *
 * Fixtures for the second organization are written in SQL with their
 * `organization_id` stated, so this suite does not depend on RT-030's
 * attribution fix having landed in `ConversationService`.
 */
import { randomUUID } from 'node:crypto';
import { CommError, CommErrorCode } from '@platform/errors';
import { ConversationController } from '@communication/api/conversation.controller';
import { OutboxWorker } from '@communication/outbox/outbox.worker';
import { NotificationService } from '@communication/notifications/notification.service';
import { room } from '@communication/contracts/events';
import type { RealtimePublisher } from '@communication/realtime/realtime.publisher';
import { buildGraph, seed, truncate, withAssignmentGate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
const controller = new ConversationController(g.conversations, g.messages, g.calls);
let s: Scenario;

const DEFAULT_ORG = '00000000-0000-0000-0000-000000000001';
const ORG_SLUG_PREFIX = 'advc-';

/** Staff beyond the shared seed: a coverage-role admin and the three roles
 *  that never take part in family communication. */
let x: { coverageId: string; financeId: string; technicalId: string; academicId: string };

/** A complete second organization, written with its organization_id stated. */
let b: {
  orgId: string;
  adminId: string;
  managerId: string;
  familyId: string;
  contactId: string;
  teacherId: string;
  learnerId: string;
  directId: string;
};

interface Delivery {
  room: string;
  event: string;
  payload: Record<string, unknown>;
}

/** Records where the worker sent each event. */
class RecordingPublisher implements RealtimePublisher {
  readonly deliveries: Delivery[] = [];
  async toThread(threadId: string, event: string, payload: unknown): Promise<void> {
    this.deliveries.push({ room: room.conversation(threadId), event, payload: payload as Record<string, unknown> });
  }
  async toUsers(actorIds: string[], event: string, payload: unknown): Promise<void> {
    for (const id of actorIds) {
      this.deliveries.push({ room: room.actor(id), event, payload: payload as Record<string, unknown> });
    }
  }
}

const published = new RecordingPublisher();
const worker = new OutboxWorker(
  g.prisma,
  new NotificationService(g.prisma, g.templates, g.quietHours, g.config, {
    send: async () => ({ ok: true }),
  }) as unknown as NotificationService,
  published,
  g.identity,
);

async function refusal(p: Promise<unknown>): Promise<CommError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e;
    throw e;
  }
  throw new Error('expected a refusal, but the operation succeeded');
}

/** Every trace a started call leaves. A refused start must leave none. */
async function callFootprint(): Promise<{ calls: number; participants: number; callEvents: number }> {
  const [calls, participants, callEvents] = await Promise.all([
    g.prisma.call.count(),
    g.prisma.callParticipant.count(),
    g.prisma.outboxEvent.count({ where: { type: { startsWith: 'call.' } } }),
  ]);
  return { calls, participants, callEvents };
}

async function expectNoCallCreated(p: Promise<unknown>, code: string): Promise<void> {
  const before = await callFootprint();
  const e = await refusal(p);
  expect(e.code).toBe(code);
  expect(await callFootprint()).toEqual(before);
}

/** A family-less class group with a teacher and the owning admin. */
async function classGroupWithoutFamily(): Promise<string> {
  const id = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.conversation (id, type, state, family_id) values ('${id}'::uuid, 'class_group', 'open', null)`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role) values
       ('${id}'::uuid, 'teacher', '${s.teacherId}'::uuid, 'teacher'),
       ('${id}'::uuid, 'staff', '${s.ownerId}'::uuid, 'admin')`,
  );
  return id;
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
  published.deliveries.length = 0;

  x = {
    coverageId: randomUUID(),
    financeId: randomUUID(),
    technicalId: randomUUID(),
    academicId: randomUUID(),
  };
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values
       ('${x.coverageId}'::uuid, 'coverage_k', 'coverage', true),
       ('${x.financeId}'::uuid, 'finance_f', 'finance', true),
       ('${x.technicalId}'::uuid, 'technical_t', 'technical', true),
       ('${x.academicId}'::uuid, 'academic_a', 'academic', true)`,
  );

  b = {
    orgId: randomUUID(),
    adminId: randomUUID(),
    managerId: randomUUID(),
    familyId: randomUUID(),
    contactId: randomUUID(),
    teacherId: randomUUID(),
    learnerId: randomUUID(),
    directId: randomUUID(),
  };
  const o = `'${b.orgId}'::uuid`;
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values (${o}, '${ORG_SLUG_PREFIX}${b.orgId.slice(0, 8)}', 'org_b')`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active, organization_id) values
       ('${b.adminId}'::uuid, 'admin_b1', 'admin', true, ${o}),
       ('${b.managerId}'::uuid, 'manager_b1', 'manager', true, ${o})`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.teacher (id, name, is_active, organization_id) values ('${b.teacherId}'::uuid, 'teacher_b1', true, ${o})`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.family (id, display_name, owner_id, language, organization_id)
     values ('${b.familyId}'::uuid, 'family_b', '${b.adminId}'::uuid, 'ar', ${o})`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active, organization_id)
     values ('${b.contactId}'::uuid, '${b.familyId}'::uuid, 'parent_b1', 'primary_guardian', true, true, ${o})`,
  );
  await withAssignmentGate(
    g.prisma,
    `insert into chat.learner (id, family_id, name, teacher_id, organization_id)
     values ('${b.learnerId}'::uuid, '${b.familyId}'::uuid, 'learner_b1', '${b.teacherId}'::uuid, ${o})`,
  );
  // Parent <-> Admin direct conversation inside organization B.
  const directKey = [b.contactId, b.adminId].sort().join(':');
  await g.prisma.$executeRawUnsafe(
    `insert into chat.conversation (id, type, family_id, direct_key, organization_id)
     values ('${b.directId}'::uuid, 'direct', '${b.familyId}'::uuid, '${directKey}', ${o})`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role) values
       ('${b.directId}'::uuid, 'contact', '${b.contactId}'::uuid, 'parent'),
       ('${b.directId}'::uuid, 'staff', '${b.adminId}'::uuid, 'admin')`,
  );
});

// ===========================================================================
describe('authorized staff calls (positive controls, unchanged)', () => {
  it('an on-duty member admin starts a call to a parent; the parent answers; the admin gets a token', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    const { callId, roomName } = await g.calls.start(conv.id, s.ownerId);

    const participants = await g.prisma.callParticipant.findMany({ where: { callId } });
    expect(participants.map((p) => p.actorId).sort()).toEqual([s.parentId, s.ownerId].sort());

    await g.calls.accept(callId, s.parentId);
    const token = await g.calls.issueToken(callId, s.ownerId);
    const claims = JSON.parse(Buffer.from(token.token.split('.')[1], 'base64').toString());
    expect(claims.sub).toBe(s.ownerId);
    expect(claims.video.room).toBe(roomName);
  });

  it('a parent calls their on-duty admin; the admin answers and gets a token', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    const { callId } = await g.calls.start(conv.id, s.parentId);

    await g.calls.accept(callId, s.ownerId);
    const call = await g.prisma.call.findUniqueOrThrow({ where: { id: callId } });
    expect(call.status).toBe('active');
    expect((await g.calls.issueToken(callId, s.ownerId)).roomName).toBe(call.roomName);
  });

  it('a teacher calls the admin in a Teacher<->Admin channel; the admin answers and gets a token', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.teacherId, s.ownerId);
    const { callId } = await g.calls.start(conv.id, s.teacherId);

    await g.calls.accept(callId, s.ownerId);
    expect((await g.calls.issueToken(callId, s.ownerId)).roomName).toBeDefined();
  });

  it('a manager who IS a member starts a call; the parent answers', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.managerId);
    const { callId } = await g.calls.start(conv.id, s.managerId);

    await g.calls.accept(callId, s.parentId);
    expect((await g.calls.issueToken(callId, s.managerId)).roomName).toBeDefined();
  });

  it('the staff initiator can hang up their own call', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    const { callId } = await g.calls.start(conv.id, s.ownerId);
    await g.calls.end(callId, s.ownerId);
    expect((await g.prisma.call.findUniqueOrThrow({ where: { id: callId } })).outcome).toBe('missed');
  });
});

// ===========================================================================
describe('D1 / PD-A: a caller who would not be on the call cannot create it', () => {
  it('[D1] a manager who is not a member cannot start a call in a parent<->admin conversation', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    await expectNoCallCreated(g.calls.start(conv.id, s.managerId), CommErrorCode.NOT_CONVERSATION_MEMBER);
  });

  it('[D1] an on-duty coverage admin who is not a member cannot start a call in a parent<->admin conversation', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    g.coverage.onDutyId = x.coverageId;
    await expectNoCallCreated(g.calls.start(conv.id, x.coverageId), CommErrorCode.NOT_CONVERSATION_MEMBER);
  });

  it('[D1] an on-duty admin who is not a member cannot start a Student Group call', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId);
    g.coverage.onDutyId = s.otherAdminId;
    await expectNoCallCreated(g.calls.start(group.id, s.otherAdminId), CommErrorCode.NOT_CONVERSATION_MEMBER);
  });

  it('[D1] a non-member admin cannot start a call in a family-less class group', async () => {
    const groupId = await classGroupWithoutFamily();
    await expectNoCallCreated(g.calls.start(groupId, s.otherAdminId), CommErrorCode.NOT_CONVERSATION_MEMBER);
  });

  it('[D1] an on-duty owner who has LEFT the parent<->admin conversation cannot start a call in it', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    await g.prisma.conversationMember.updateMany({
      where: { conversationId: conv.id, actorId: s.ownerId },
      data: { leftAt: new Date() },
    });
    await expectNoCallCreated(g.calls.start(conv.id, s.ownerId), CommErrorCode.NOT_CONVERSATION_MEMBER);
  });

  it('[D1] the advisory capability agrees: a non-member manager is told no, with the same code', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    expect(await controller.callCapability(s.managerId, conv.id)).toEqual({
      canCall: false,
      code: CommErrorCode.NOT_CONVERSATION_MEMBER,
    });
  });

  it('unchanged: an off-duty owner admin still may not START a call (initiation keeps the on-duty rule)', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    g.coverage.onDutyId = x.coverageId;
    await expectNoCallCreated(g.calls.start(conv.id, s.ownerId), CommErrorCode.NOT_ON_DUTY);
  });
});

// ===========================================================================
describe('D2 / PD-B: a staff participant who was rung can answer', () => {
  /** Parent rings the owner while somebody else is on duty for the family. */
  async function parentRingsOffDutyOwner(): Promise<string> {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    g.coverage.onDutyId = x.coverageId;
    const { callId } = await g.calls.start(conv.id, s.parentId);
    return callId;
  }

  it('[D2] an off-duty owner who was rung can accept', async () => {
    const callId = await parentRingsOffDutyOwner();
    await g.calls.accept(callId, s.ownerId);
    const call = await g.prisma.call.findUniqueOrThrow({ where: { id: callId } });
    expect(call.status).toBe('active');
    expect(call.answeredAt).not.toBeNull();
  });

  it('[D2] an off-duty owner who was rung gets a media token for the call room, as themselves', async () => {
    const callId = await parentRingsOffDutyOwner();
    const token = await g.calls.issueToken(callId, s.ownerId);
    const claims = JSON.parse(Buffer.from(token.token.split('.')[1], 'base64').toString());
    expect(claims.sub).toBe(s.ownerId);
    const call = await g.prisma.call.findUniqueOrThrow({ where: { id: callId } });
    expect(claims.video.room).toBe(call.roomName);
  });

  it('[D2] an off-duty owner who was rung can decline, and the call ends declined', async () => {
    const callId = await parentRingsOffDutyOwner();
    await g.calls.decline(callId, s.ownerId);
    const call = await g.prisma.call.findUniqueOrThrow({ where: { id: callId } });
    expect(call.status).toBe('ended');
    expect(call.outcome).toBe('declined');
  });

  it('[D2] an off-duty admin member of a Student Group can answer a teacher-started group call', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId);
    g.coverage.onDutyId = x.coverageId;
    const { callId } = await g.calls.start(group.id, s.teacherId);
    await g.calls.accept(callId, s.ownerId);
    expect((await g.prisma.call.findUniqueOrThrow({ where: { id: callId } })).status).toBe('active');
  });

  it('[D2] a staff participant removed from the conversation after being rung cannot answer', async () => {
    const callId = await parentRingsOffDutyOwner();
    g.coverage.onDutyId = s.ownerId; // on duty, so only membership can refuse
    const call = await g.prisma.call.findUniqueOrThrow({ where: { id: callId } });
    await g.prisma.conversationMember.updateMany({
      where: { conversationId: call.conversationId, actorId: s.ownerId },
      data: { leftAt: new Date() },
    });
    expect((await refusal(g.calls.accept(callId, s.ownerId))).code).toBe(CommErrorCode.NOT_CONVERSATION_MEMBER);
    expect((await refusal(g.calls.issueToken(callId, s.ownerId))).code).toBe(CommErrorCode.NOT_CONVERSATION_MEMBER);
  });

  it('unchanged: the unrelated ON-DUTY admin cannot answer a call that rang someone else', async () => {
    const callId = await parentRingsOffDutyOwner();
    expect((await refusal(g.calls.accept(callId, x.coverageId))).code).toBe(CommErrorCode.CALL_NOT_A_PARTICIPANT);
    expect((await refusal(g.calls.issueToken(callId, x.coverageId))).code).toBe(CommErrorCode.CALL_NOT_A_PARTICIPANT);
    expect((await refusal(g.calls.decline(callId, x.coverageId))).code).toBe(CommErrorCode.CALL_NOT_A_PARTICIPANT);
  });

  it('unchanged: a deactivated staff participant cannot answer', async () => {
    // The manager, not the owner: the database refuses to deactivate a family's
    // primary owner without offboarding, which is a separate, correct guard.
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.managerId);
    const { callId } = await g.calls.start(conv.id, s.parentId);
    await g.prisma.$executeRawUnsafe(
      `update chat.staff set is_active = false, left_at = now() where id = '${s.managerId}'::uuid`,
    );
    expect((await refusal(g.calls.accept(callId, s.managerId))).code).toBe(CommErrorCode.ACTOR_INACTIVE);
    expect((await refusal(g.calls.issueToken(callId, s.managerId))).code).toBe(CommErrorCode.ACTOR_INACTIVE);
  });

  it('unchanged: a staff participant who declined cannot then obtain a token', async () => {
    const callId = await parentRingsOffDutyOwner();
    g.coverage.onDutyId = s.ownerId;
    await g.calls.decline(callId, s.ownerId);
    expect((await refusal(g.calls.issueToken(callId, s.ownerId))).code).toBe(CommErrorCode.CALL_ALREADY_ENDED);
  });
});

// ===========================================================================
describe('roles that never take part in family communication (unchanged)', () => {
  it.each([
    ['finance', () => x.financeId],
    ['technical', () => x.technicalId],
    ['academic', () => x.academicId],
  ])('%s staff can neither start nor join a call', async (_role, id) => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    await expectNoCallCreated(g.calls.start(conv.id, id()), CommErrorCode.ROLE_CANNOT_MESSAGE_FAMILY);

    const { callId } = await g.calls.start(conv.id, s.ownerId);
    expect((await refusal(g.calls.issueToken(callId, id()))).code).toBe(CommErrorCode.CALL_NOT_A_PARTICIPANT);
    expect((await refusal(g.calls.accept(callId, id()))).code).toBe(CommErrorCode.CALL_NOT_A_PARTICIPANT);
  });
});

// ===========================================================================
describe('D3: organization isolation across the call lifecycle', () => {
  /** A live Student Group call in organization A, started by its owner. */
  async function orgACall(): Promise<{ callId: string; conversationId: string }> {
    const group = await g.conversations.ensureStudentGroup(s.learnerId);
    const { callId } = await g.calls.start(group.id, s.ownerId);
    return { callId, conversationId: group.id };
  }

  it('[D3] a manager of organization B cannot start a call in an organization A conversation', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    await expectNoCallCreated(g.calls.start(conv.id, b.managerId), CommErrorCode.CONVERSATION_NOT_FOUND);
  });

  it('[D3] the capability answers a cross-organization probe exactly like a missing conversation', async () => {
    const conv = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    expect((await refusal(controller.callCapability(b.managerId, conv.id))).code).toBe(
      CommErrorCode.CONVERSATION_NOT_FOUND,
    );
  });

  it('[D3] a manager of organization B cannot read an organization A conversation call history', async () => {
    const { conversationId } = await orgACall();
    expect((await refusal(g.calls.history(conversationId, b.managerId))).code).toBe(
      CommErrorCode.CONVERSATION_NOT_FOUND,
    );
  });

  it("[D3] account call history never includes another organization's calls", async () => {
    const { callId: aCall } = await orgACall();
    g.coverage.onDutyId = b.adminId;
    const { callId: bCall } = await g.calls.start(b.directId, b.adminId);

    const forB = (await g.calls.historyForActor(b.managerId)).items.map((r) => r.id);
    expect(forB).toContain(bCall);
    expect(forB).not.toContain(aCall);

    const forA = (await g.calls.historyForActor(s.managerId)).items.map((r) => r.id);
    expect(forA).toContain(aCall);
    expect(forA).not.toContain(bCall);
  });

  it("[D3] another organization's call is indistinguishable from a missing one: token, accept, decline, end", async () => {
    const { callId } = await orgACall();
    const ops = [
      () => g.calls.issueToken(callId, b.managerId),
      () => g.calls.accept(callId, b.managerId),
      () => g.calls.decline(callId, b.managerId),
      () => g.calls.end(callId, b.managerId),
    ];
    for (const op of ops) {
      expect((await refusal(op())).code).toBe(CommErrorCode.CALL_NOT_FOUND);
    }
    expect((await g.prisma.call.findUniqueOrThrow({ where: { id: callId } })).status).toBe('ringing');
  });

  it('[D3] even a participant row in another organization grants nothing (defence in depth)', async () => {
    const { callId } = await orgACall();
    // No API path writes this row; it stands for corrupted or hand-written data.
    await g.prisma.$executeRawUnsafe(
      `insert into chat.call_participant (call_id, actor_id, actor_kind)
       values ('${callId}'::uuid, '${b.managerId}'::uuid, 'staff')`,
    );
    const ops = [
      () => g.calls.issueToken(callId, b.managerId),
      () => g.calls.accept(callId, b.managerId),
      () => g.calls.decline(callId, b.managerId),
    ];
    for (const op of ops) {
      expect((await refusal(op())).code).toBe(CommErrorCode.CALL_NOT_FOUND);
    }
    expect((await g.prisma.call.findUniqueOrThrow({ where: { id: callId } })).status).toBe('ringing');
  });

  it("[D3] a call is filed under its conversation's organization", async () => {
    g.coverage.onDutyId = b.adminId;
    const { callId } = await g.calls.start(b.directId, b.adminId);
    expect((await g.prisma.call.findUniqueOrThrow({ where: { id: callId } })).organizationId).toBe(b.orgId);

    g.coverage.onDutyId = s.ownerId; // organization A's owner is the one on duty for A's call
    const { callId: aCall } = await orgACall();
    expect((await g.prisma.call.findUniqueOrThrow({ where: { id: aCall } })).organizationId).toBe(DEFAULT_ORG);
  });

  it("[D3] call notifications are filed under the call's organization", async () => {
    g.coverage.onDutyId = b.adminId;
    const { callId } = await g.calls.start(b.directId, b.adminId);
    await g.calls.end(callId, b.adminId); // missed: incoming + missed notifications for the parent
    await worker.drain(100);

    const rows = await g.prisma.notification.findMany({ where: { conversationId: b.directId } });
    expect(rows.length).toBeGreaterThan(0);
    for (const n of rows) expect(n.organizationId).toBe(b.orgId);
  });

  it('unchanged: call events reach only the call participants, one actor room each', async () => {
    g.coverage.onDutyId = b.adminId;
    const { callId } = await g.calls.start(b.directId, b.adminId);
    await worker.drain(100);

    const incoming = published.deliveries.filter((d) => d.event === 'call.incoming' && d.payload.callId === callId);
    expect(new Set(incoming.map((d) => d.room))).toEqual(
      new Set([room.actor(b.contactId), room.actor(b.adminId)]),
    );
  });
});
