/**
 * Conversation membership authorization, against the real migrated database.
 *
 * The unit spec proves the decisions; this one proves a refused request leaves
 * conversation_member, audit_log and outbox_event exactly as it found them, that
 * legitimate changes still work, and that parents and teachers keep messaging.
 */
import { randomUUID } from 'node:crypto';
import { CommError, CommErrorCode } from '@platform/errors';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;
let coverageId: string;
let financeId: string;
let otherFamilyContactId: string;
let other: { orgId: string; staffId: string; familyId: string; conversationId: string };

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'mba-%'`);
  await g.prisma.$disconnect();
});

beforeEach(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'mba-%'`);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;

  coverageId = randomUUID();
  financeId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values
       ('${coverageId}'::uuid, 'coverage_d', 'coverage', true),
       ('${financeId}'::uuid, 'finance_e', 'finance', true)`,
  );

  // A second family in the SAME organization, owned by the same admin, so that
  // "a contact of another family" is tested without a tenant boundary in play.
  const familyY = randomUUID();
  otherFamilyContactId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.family (id, display_name, owner_id, language)
     values ('${familyY}'::uuid, 'family_y', '${s.ownerId}'::uuid, 'ar')`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active)
     values ('${otherFamilyContactId}'::uuid, '${familyY}'::uuid, 'parent_y', 'primary_guardian', true, true)`,
  );

  // A second ORGANIZATION with its own staff, family and a group conversation.
  // The conversation is seeded in SQL so this spec depends only on membership
  // code, not on provisioning.
  other = { orgId: randomUUID(), staffId: randomUUID(), familyId: randomUUID(), conversationId: randomUUID() };
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name)
     values ('${other.orgId}'::uuid, 'mba-${other.orgId.slice(0, 8)}', 'other_org')`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active, organization_id)
     values ('${other.staffId}'::uuid, 'admin_z', 'admin', true, '${other.orgId}'::uuid)`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.family (id, display_name, owner_id, language, organization_id)
     values ('${other.familyId}'::uuid, 'family_z', '${other.staffId}'::uuid, 'ar', '${other.orgId}'::uuid)`,
  );
  const otherLearner = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.learner (id, family_id, name, organization_id)
     values ('${otherLearner}'::uuid, '${other.familyId}'::uuid, 'learner_z', '${other.orgId}'::uuid)`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.conversation (id, type, family_id, learner_id, title, organization_id)
     values ('${other.conversationId}'::uuid, 'student_group', '${other.familyId}'::uuid,
             '${otherLearner}'::uuid, 'z group', '${other.orgId}'::uuid)`,
  );
});

/** Every table a membership change writes to, counted. */
async function footprint(): Promise<Record<string, number>> {
  const rows = await g.prisma.$queryRawUnsafe<{ t: string; n: number }[]>(`
    select 'members' t, count(*)::int n from chat.conversation_member
    union all select 'live_members', count(*)::int from chat.conversation_member where left_at is null
    union all select 'audit', count(*)::int from chat.audit_log
    union all select 'outbox', count(*)::int from chat.outbox_event`);
  return Object.fromEntries(rows.map((r) => [r.t, r.n]));
}

async function refusal(p: Promise<unknown>): Promise<CommError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e;
    throw e;
  }
  throw new Error('expected a refusal, but the call succeeded');
}

const add = (convId: string, by: string, actorId: string, actorKind: string, memberRole: string, reason = 'test') =>
  g.conversations.setMembership(convId, by, { actorId, actorKind, memberRole }, 'add', reason);
const remove = (convId: string, by: string, actorId: string, reason = 'test') =>
  g.conversations.setMembership(convId, by, { actorId, actorKind: 'staff', memberRole: 'admin' }, 'remove', reason);

const studentGroup = () => g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

describe('the direct-conversation takeover is closed', () => {
  it('nobody may remove the other side of a Teacher<->Admin direct, or add themselves to it', async () => {
    const direct = await g.conversations.getOrCreateDirect(s.teacherId, s.ownerId);
    const before = await footprint();
    for (const by of [coverageId, s.otherAdminId, s.managerId, s.ownerId]) {
      const r1 = await refusal(remove(direct.id, by, s.ownerId));
      const r2 = await refusal(add(direct.id, by, by, 'staff', 'admin'));
      expect([r1.code, r1.status]).toEqual([CommErrorCode.CANNOT_MANAGE_MEMBERSHIP, 403]);
      expect([r2.code, r2.status]).toEqual([CommErrorCode.CANNOT_MANAGE_MEMBERSHIP, 403]);
    }
    expect(await footprint()).toEqual(before);
  });

  it("nobody may change a family's Parent<->Admin direct", async () => {
    const direct = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    const before = await footprint();
    const e = await refusal(remove(direct.id, s.managerId, s.parentId));
    expect(e.code).toBe(CommErrorCode.CANNOT_MANAGE_MEMBERSHIP);
    expect(await footprint()).toEqual(before);
  });
});

describe('out-of-scope and unauthorized callers are refused without writes', () => {
  it('a parent and a teacher are refused', async () => {
    const group = await studentGroup();
    const before = await footprint();
    for (const by of [s.parentId, s.teacherId]) {
      const e = await refusal(remove(group.id, by, s.ownerId));
      expect(e.code).toBe(CommErrorCode.CANNOT_MANAGE_MEMBERSHIP);
    }
    expect(await footprint()).toEqual(before);
  });

  it('department staff are refused', async () => {
    const group = await studentGroup();
    const before = await footprint();
    const e = await refusal(add(group.id, financeId, financeId, 'staff', 'admin'));
    expect(e.code).toBe(CommErrorCode.CANNOT_MANAGE_MEMBERSHIP);
    expect(await footprint()).toEqual(before);
  });

  it("an admin who does not own the family is refused, for adds and removals", async () => {
    const group = await studentGroup();
    const before = await footprint();
    const a = await refusal(add(group.id, s.otherAdminId, s.otherAdminId, 'staff', 'admin'));
    const r = await refusal(remove(group.id, s.otherAdminId, s.parentId));
    expect([a.code, a.status]).toEqual([CommErrorCode.CANNOT_MANAGE_MEMBERSHIP, 403]);
    expect([r.code, r.status]).toEqual([CommErrorCode.CANNOT_MANAGE_MEMBERSHIP, 403]);
    expect(await footprint()).toEqual(before);
  });

  it('a coverage admin who does not own the family is refused, even while on duty for it', async () => {
    const group = await studentGroup();
    g.coverage.onDutyId = coverageId;
    const before = await footprint();
    const e = await refusal(add(group.id, coverageId, coverageId, 'staff', 'observer'));
    expect(e.code).toBe(CommErrorCode.CANNOT_MANAGE_MEMBERSHIP);
    expect(await footprint()).toEqual(before);
  });

  it("another organization's conversation reads as not found, exactly like an unknown one", async () => {
    const before = await footprint();
    const cross = await refusal(add(other.conversationId, s.managerId, s.managerId, 'staff', 'admin'));
    const unknown = await refusal(add(randomUUID(), s.managerId, s.managerId, 'staff', 'admin'));
    expect([cross.code, cross.status]).toEqual([CommErrorCode.CONVERSATION_NOT_FOUND, 404]);
    expect([unknown.code, unknown.status]).toEqual([cross.code, cross.status]);
    expect(await footprint()).toEqual(before);
  });
});

describe('forged member details grant nothing', () => {
  async function refusedAdd(actorId: string, actorKind: string, memberRole: string) {
    const group = await studentGroup();
    const before = await footprint();
    const e = await refusal(add(group.id, s.ownerId, actorId, actorKind, memberRole));
    expect(await footprint()).toEqual(before);
    return e;
  }

  it('a non-existent staff id is refused (no phantom members)', async () => {
    const e = await refusedAdd(randomUUID(), 'staff', 'admin');
    expect([e.code, e.status]).toEqual([CommErrorCode.INVALID_PARTICIPANTS, 403]);
  });
  it('a contact of another family is refused', async () => {
    const e = await refusedAdd(otherFamilyContactId, 'contact', 'parent');
    expect(e.code).toBe(CommErrorCode.INVALID_PARTICIPANTS);
  });
  it("a teacher who does not teach this learner is refused", async () => {
    const e = await refusedAdd(s.unrelatedTeacherId, 'teacher', 'teacher');
    expect(e.code).toBe(CommErrorCode.INVALID_PARTICIPANTS);
  });
  it('a contact cannot be smuggled in as an admin', async () => {
    await refusedAdd(s.otherParentId, 'contact', 'admin');
  });
  it("a real staff id claimed as a 'contact' is refused (kind is checked against the row)", async () => {
    const e = await refusedAdd(coverageId, 'contact', 'parent');
    expect(e.code).toBe(CommErrorCode.INVALID_PARTICIPANTS);
  });
  it('department staff cannot be added', async () => {
    const e = await refusedAdd(financeId, 'staff', 'admin');
    expect(e.code).toBe(CommErrorCode.INVALID_PARTICIPANTS);
  });
  it("another organization's staff is refused exactly as an unknown id", async () => {
    const cross = await refusedAdd(other.staffId, 'staff', 'admin');
    const unknown = await refusedAdd(randomUUID(), 'staff', 'admin');
    expect([cross.code, cross.message]).toEqual([unknown.code, unknown.message]);
  });
});

describe('malformed requests are 400, not 500', () => {
  it('missing or blank reason, bad action, non-uuid ids, unknown kind', async () => {
    const group = await studentGroup();
    const before = await footprint();
    // Thunks, not promises: each call starts only when awaited, so a case that
    // throws cannot leave the others running into the next test.
    const cases: (() => Promise<unknown>)[] = [
      () => add(group.id, s.ownerId, coverageId, 'staff', 'observer', ''),
      () => add(group.id, s.ownerId, coverageId, 'staff', 'observer', '   '),
      () => g.conversations.setMembership(group.id, s.ownerId, { actorId: coverageId, actorKind: 'staff', memberRole: 'observer' }, 'evict' as 'add', 'x'),
      () => add(group.id, s.ownerId, 'not-a-uuid', 'staff', 'observer'),
      () => add('not-a-uuid', s.ownerId, coverageId, 'staff', 'observer'),
      () => add(group.id, s.ownerId, coverageId, 'robot', 'observer'),
    ];
    for (const c of cases) {
      const e = await refusal(c());
      expect([e.code, e.status]).toEqual([CommErrorCode.VALIDATION, 400]);
    }
    expect(await footprint()).toEqual(before);
  });
});

describe('legitimate membership changes still work', () => {
  it("the family's owner adds a staff observer: one member row, one audit row, one event", async () => {
    const group = await studentGroup();
    const before = await footprint();
    await add(group.id, s.ownerId, coverageId, 'staff', 'observer', 'covering the holidays');
    const after = await footprint();
    expect(after.live_members - before.live_members).toBe(1);
    expect(after.audit - before.audit).toBe(1);
    expect(after.outbox - before.outbox).toBe(1);
    const audit = await g.prisma.auditLog.findFirst({ where: { action: 'conversation.member_add' } });
    expect(audit?.reason).toBe('covering the holidays');
  });

  it("the family's owner removes a parent; the row records the TRUSTED role, not the client's", async () => {
    const group = await studentGroup();
    // The client calls the parent an 'admin'; the audit must say 'parent'.
    await g.conversations.setMembership(
      group.id, s.ownerId, { actorId: s.otherParentId, actorKind: 'staff', memberRole: 'admin' }, 'remove', 'left the family',
    );
    const live = await g.conversations.membershipOf(group.id, s.otherParentId);
    expect(live).toBeNull();
    const audit = await g.prisma.auditLog.findFirst({ where: { action: 'conversation.member_remove' } });
    expect(audit?.after).toEqual({ actorId: s.otherParentId, memberRole: 'parent' });
  });

  it('a manager may change membership in their organization', async () => {
    const group = await studentGroup();
    await add(group.id, s.managerId, coverageId, 'staff', 'observer');
    expect(await g.conversations.membershipOf(group.id, coverageId)).not.toBeNull();
  });

  it('a removed member can be re-added by the owner', async () => {
    const group = await studentGroup();
    await remove(group.id, s.ownerId, s.otherParentId);
    await add(group.id, s.ownerId, s.otherParentId, 'contact', 'parent');
    expect(await g.conversations.membershipOf(group.id, s.otherParentId)).not.toBeNull();
  });

  it('repeats are idempotent: re-adding the same member or removing a non-member writes nothing', async () => {
    const group = await studentGroup();
    await add(group.id, s.ownerId, coverageId, 'staff', 'observer');
    const before = await footprint();
    await add(group.id, s.ownerId, coverageId, 'staff', 'observer');
    await remove(group.id, s.ownerId, financeId);
    expect(await footprint()).toEqual(before);
  });

  it('re-adding an existing member in a DIFFERENT role is refused as invalid, not silently changed', async () => {
    const group = await studentGroup();
    await add(group.id, s.ownerId, coverageId, 'staff', 'observer');
    const before = await footprint();
    const e = await refusal(add(group.id, s.ownerId, coverageId, 'staff', 'admin'));
    expect([e.code, e.status]).toEqual([CommErrorCode.VALIDATION, 400]);
    expect(await footprint()).toEqual(before);
  });

  it('two concurrent identical adds produce exactly one member, one audit row and one event', async () => {
    const group = await studentGroup();
    const before = await footprint();
    await Promise.all([
      add(group.id, s.ownerId, coverageId, 'staff', 'observer'),
      add(group.id, s.managerId, coverageId, 'staff', 'observer'),
    ]);
    const after = await footprint();
    expect(after.live_members - before.live_members).toBe(1);
    expect(after.audit - before.audit).toBe(1);
    expect(after.outbox - before.outbox).toBe(1);
  });
});

describe('Parent and Teacher messaging is unchanged', () => {
  it('a parent and the owner still message in their direct conversation', async () => {
    const direct = await g.conversations.getOrCreateDirect(s.parentId, s.ownerId);
    const fromParent = await g.messages.send({ conversationId: direct.id, senderId: s.parentId, body: 'hello' });
    const fromAdmin = await g.messages.send({ conversationId: direct.id, senderId: s.ownerId, body: 'welcome' });
    expect(fromParent.moderation).toBe('published');
    expect(fromAdmin.moderation).toBe('published');
  });

  it("a teacher and a parent still post in the learner's group, held for approval as before", async () => {
    const group = await studentGroup();
    const t = await g.messages.send({ conversationId: group.id, senderId: s.teacherId, body: 'homework' });
    const p = await g.messages.send({ conversationId: group.id, senderId: s.parentId, body: 'thanks' });
    expect(t.moderation).toBe('pending');
    expect(p.moderation).toBe('pending');
  });

  it('a teacher and an authorized parent still open their PD-6 direct conversation', async () => {
    const direct = await g.conversations.getOrCreateDirect(s.teacherId, s.parentId);
    const m = await g.messages.send({ conversationId: direct.id, senderId: s.teacherId, body: 'about class' });
    expect(m.moderation).toBe('published');
  });
});
