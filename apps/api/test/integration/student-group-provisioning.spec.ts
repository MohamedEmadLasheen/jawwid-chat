/**
 * Student Group provisioning, against the real migrated database.
 *
 * The unit spec (test/unit/authorization/student-group-provisioning.spec.ts)
 * proves the decisions and their ORDER over a stub. This one proves the same
 * refusals hold with real identity resolution, real organization columns and a
 * real second tenant -- and that a refused call leaves every table it could
 * have written exactly as it found it.
 */
import { randomUUID } from 'node:crypto';
import { CommError, CommErrorCode } from '@platform/errors';
import { buildGraph, seed, truncate, Scenario, supervise } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;

/** Staff and a learner in a SECOND organization, built per test. Its slug is
 *  prefixed `sgp-` so cleanup removes only the organizations this spec made. */
let otherOrg: {
  orgId: string;
  staffId: string;
  otherAdminId: string;
  familyId: string;
  contactId: string;
  learnerId: string;
};
let coverageId: string;
let financeId: string;
let inactiveAdminId: string;

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(
    `delete from chat.organization where slug like 'sgp-%'`,
  );
  await g.prisma.$disconnect();
});

beforeEach(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(
    `delete from chat.organization where slug like 'sgp-%'`,
  );
  s = await seed(g.prisma);

  coverageId = randomUUID();
  financeId = randomUUID();
  inactiveAdminId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active, left_at) values
       ('${coverageId}'::uuid, 'coverage_d', 'coverage', true, null),
       ('${financeId}'::uuid, 'finance_e', 'finance', true, null),
       ('${inactiveAdminId}'::uuid, 'admin_f', 'admin', false, now())`,
  );

  otherOrg = {
    orgId: randomUUID(),
    staffId: randomUUID(),
    otherAdminId: randomUUID(),
    familyId: randomUUID(),
    contactId: randomUUID(),
    learnerId: randomUUID(),
  };
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name)
     values ('${otherOrg.orgId}'::uuid, 'sgp-${otherOrg.orgId.slice(0, 8)}', 'other_org')`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active, organization_id) values
       ('${otherOrg.staffId}'::uuid, 'admin_z', 'admin', true, '${otherOrg.orgId}'::uuid),
       ('${otherOrg.otherAdminId}'::uuid, 'admin_w', 'admin', true, '${otherOrg.orgId}'::uuid)`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.family (id, display_name, owner_id, language, organization_id)
     values ('${otherOrg.familyId}'::uuid, 'family_z', '${otherOrg.staffId}'::uuid, 'ar', '${otherOrg.orgId}'::uuid)`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active, organization_id)
     values ('${otherOrg.contactId}'::uuid, '${otherOrg.familyId}'::uuid, 'parent_z',
             'primary_guardian', true, true, '${otherOrg.orgId}'::uuid)`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.learner (id, family_id, name, organization_id)
     values ('${otherOrg.learnerId}'::uuid, '${otherOrg.familyId}'::uuid, 'learner_z', '${otherOrg.orgId}'::uuid)`,
  );
  // PD-8: admin_z supervises the other tenant's child; admin_w is in charge of nothing.
  await supervise(g.prisma, otherOrg.staffId, [otherOrg.learnerId]);
});

const DEFAULT_ORG = '00000000-0000-0000-0000-000000000001';

/** The tenant of a group and of every message in it, read back from the database. */
async function tenancyOf(conversationId: string) {
  const conv = await g.prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
  const messageOrgs = await g.prisma.message.findMany({
    where: { conversationId },
    select: { organizationId: true },
  });
  return { conversation: conv.organizationId, messages: [...new Set(messageOrgs.map((m) => m.organizationId))] };
}

/** Every table a provisioning call writes to, counted. */
async function footprint(): Promise<Record<string, number>> {
  const rows = await g.prisma.$queryRawUnsafe<{ t: string; n: number }[]>(`
    select 'conversation' t, count(*)::int n from chat.conversation
    union all select 'conversation_member', count(*)::int from chat.conversation_member
    union all select 'message', count(*)::int from chat.message
    union all select 'event_log', count(*)::int from chat.event_log
    union all select 'outbox_event', count(*)::int from chat.outbox_event
    union all select 'audit_log', count(*)::int from chat.audit_log`);
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

describe('POST /conversations/student-group (ensureStudentGroup)', () => {
  it('refuses a parent -- for another family, for their own child, and for an unknown id, identically', async () => {
    const before = await footprint();
    const own = await refusal(g.conversations.ensureStudentGroup(s.learnerId, s.parentId));
    const foreign = await refusal(g.conversations.ensureStudentGroup(otherOrg.learnerId, s.parentId));
    const unknown = await refusal(g.conversations.ensureStudentGroup(randomUUID(), s.parentId));

    for (const e of [own, foreign, unknown]) {
      expect([e.code, e.status, e.message]).toEqual([own.code, own.status, own.message]);
    }
    expect(own.code).toBe(CommErrorCode.CANNOT_PROVISION_STUDENT_GROUP);
    expect(own.status).toBe(403);
    expect(await footprint()).toEqual(before);
  });

  it('refuses a teacher, including the learner\'s own teacher', async () => {
    const before = await footprint();
    const e = await refusal(g.conversations.ensureStudentGroup(s.learnerId, s.teacherId));
    expect([e.code, e.status]).toEqual([CommErrorCode.CANNOT_PROVISION_STUDENT_GROUP, 403]);
    expect(await footprint()).toEqual(before);
  });

  it('refuses department staff and an inactive admin', async () => {
    const before = await footprint();
    const finance = await refusal(g.conversations.ensureStudentGroup(s.learnerId, financeId));
    const inactive = await refusal(g.conversations.ensureStudentGroup(s.learnerId, inactiveAdminId));
    expect(finance.code).toBe(CommErrorCode.CANNOT_PROVISION_STUDENT_GROUP);
    expect(inactive.code).toBe(CommErrorCode.ACTOR_INACTIVE);
    expect(await footprint()).toEqual(before);
  });

  it('refuses an admin who does not own the family', async () => {
    const before = await footprint();
    const e = await refusal(g.conversations.ensureStudentGroup(s.learnerId, s.otherAdminId));
    expect([e.code, e.status]).toEqual([CommErrorCode.CANNOT_PROVISION_STUDENT_GROUP, 403]);
    expect(await footprint()).toEqual(before);
  });

  it('refuses a coverage admin who does not own the family (being on duty is not scope)', async () => {
    g.coverage.onDutyId = coverageId; // even when on duty for this family
    const before = await footprint();
    const e = await refusal(g.conversations.ensureStudentGroup(s.learnerId, coverageId));
    expect([e.code, e.status]).toEqual([CommErrorCode.CANNOT_PROVISION_STUDENT_GROUP, 403]);
    expect(await footprint()).toEqual(before);
  });

  it("answers another organization's learner exactly as an unknown learner, even to a manager", async () => {
    const before = await footprint();
    const crossTenant = await refusal(g.conversations.ensureStudentGroup(otherOrg.learnerId, s.managerId));
    const unknown = await refusal(g.conversations.ensureStudentGroup(randomUUID(), s.managerId));
    expect([crossTenant.code, crossTenant.status]).toEqual([CommErrorCode.CONVERSATION_NOT_FOUND, 404]);
    expect([unknown.code, unknown.status, unknown.message]).toEqual([
      crossTenant.code,
      crossTenant.status,
      crossTenant.message,
    ]);
    expect(await footprint()).toEqual(before);
  });

  it("lets the family's owner create the group, with the expected members", async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    const members = await g.prisma.conversationMember.findMany({
      where: { conversationId: group.id, leftAt: null },
    });
    expect(new Set(members.map((m) => m.actorId))).toEqual(
      new Set([s.parentId, s.otherParentId, s.ownerId, s.teacherId]),
    );
  });

  it('lets a manager of the same organization create the group, and returns it again idempotently', async () => {
    const first = await g.conversations.ensureStudentGroup(s.learnerId, s.managerId);
    const again = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    expect(again.id).toBe(first.id);
  });

  // RT-030 (Student Group half) acceptance test. It was skipped while
  // ensureStudentGroup created the conversation (and its system message)
  // without `organizationId`, so both took the seeded default organization and
  // the cross-organization triggers refused any learner of another tenant.
  // RT-030's direct-conversation half (getOrCreateDirect) is still OPEN.
  it('the other organization\'s own supervisor may provision its own learner (RT-030)', async () => {
    const group = await g.conversations.ensureStudentGroup(otherOrg.learnerId, otherOrg.staffId);
    expect(group.learnerId).toBe(otherOrg.learnerId);

    // The group and its `group.created` system message are in the LEARNER's
    // organization, not the seeded default.
    expect(await tenancyOf(group.id)).toEqual({ conversation: otherOrg.orgId, messages: [otherOrg.orgId] });
    const created = await g.prisma.message.findFirstOrThrow({ where: { conversationId: group.id, type: 'system' } });
    expect(JSON.parse(created.body ?? '{}').kind).toBe('group.created');

    // Members are derived from that tenant's own rows, exactly as for the default one.
    const members = await g.prisma.conversationMember.findMany({ where: { conversationId: group.id, leftAt: null } });
    expect(new Set(members.map((m) => m.actorId))).toEqual(new Set([otherOrg.contactId, otherOrg.staffId]));

    // Idempotent in that tenant too.
    const again = await g.conversations.ensureStudentGroup(otherOrg.learnerId, otherOrg.staffId);
    expect(again.id).toBe(group.id);
  });

  it('PD-8: a child NOBODY supervises gets no group -- 409 LEARNER_UNSUPERVISED for everyone, the super admin included, and nothing is written', async () => {
    await g.prisma.learnerSupervision.delete({ where: { learnerId: s.learnerId } });
    const superId = randomUUID();
    await g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
      await tx.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ('${superId}'::uuid, 'super_s', 'super_admin', true)`);
    });
    const before = await footprint();
    for (const by of [s.ownerId, s.managerId, superId, undefined]) {
      const e = await refusal(g.conversations.ensureStudentGroup(s.learnerId, by));
      expect([e.code, e.status]).toEqual([CommErrorCode.LEARNER_UNSUPERVISED, 409]);
    }
    expect(await footprint()).toEqual(before);
  });

  it('RT-030 regression: a default-organization group still lands in the default organization', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    expect(await tenancyOf(group.id)).toEqual({ conversation: DEFAULT_ORG, messages: [DEFAULT_ORG] });
  });

  it("RT-030: inside the other organization, an admin who does not own the family is still refused, without writes", async () => {
    const before = await footprint();
    const e = await refusal(g.conversations.ensureStudentGroup(otherOrg.learnerId, otherOrg.otherAdminId));
    expect([e.code, e.status]).toEqual([CommErrorCode.CANNOT_PROVISION_STUDENT_GROUP, 403]);
    expect(await footprint()).toEqual(before);
  });

  it("RT-030: the default organization's owner and manager still cannot reach the other tenant's learner", async () => {
    const before = await footprint();
    for (const by of [s.ownerId, s.managerId]) {
      const e = await refusal(g.conversations.ensureStudentGroup(otherOrg.learnerId, by));
      expect([e.code, e.status]).toEqual([CommErrorCode.CONVERSATION_NOT_FOUND, 404]);
    }
    expect(await footprint()).toEqual(before);
  });
});

describe('POST /conversations/student-group/:learnerId/sync (syncStudentGroup)', () => {
  it('refuses a parent and a teacher, and changes no membership', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    const before = await footprint();
    const parent = await refusal(g.conversations.syncStudentGroup(s.learnerId, s.parentId));
    const teacher = await refusal(g.conversations.syncStudentGroup(s.learnerId, s.teacherId));
    expect(parent.code).toBe(CommErrorCode.CANNOT_PROVISION_STUDENT_GROUP);
    expect(teacher.code).toBe(CommErrorCode.CANNOT_PROVISION_STUDENT_GROUP);
    expect(await footprint()).toEqual(before);
    expect(group.id).toBeDefined();
  });

  it('refuses an admin who does not own the family', async () => {
    await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    const before = await footprint();
    const e = await refusal(g.conversations.syncStudentGroup(s.learnerId, s.otherAdminId));
    expect([e.code, e.status]).toEqual([CommErrorCode.CANNOT_PROVISION_STUDENT_GROUP, 403]);
    expect(await footprint()).toEqual(before);
  });

  it("answers another organization's learner with null, as for an unknown learner", async () => {
    // Created through the real service, in the other tenant (RT-030, Student Group half).
    await g.conversations.ensureStudentGroup(otherOrg.learnerId, otherOrg.staffId);
    const before = await footprint();
    await expect(g.conversations.syncStudentGroup(otherOrg.learnerId, s.managerId)).resolves.toBeNull();
    await expect(g.conversations.syncStudentGroup(randomUUID(), s.managerId)).resolves.toBeNull();
    expect(await footprint()).toEqual(before);
  });

  it("RT-030: the other organization's owner reconciles its own group; the system message stays in that tenant", async () => {
    const group = await g.conversations.ensureStudentGroup(otherOrg.learnerId, otherOrg.staffId);
    await g.prisma.conversationMember.updateMany({
      where: { conversationId: group.id, actorId: otherOrg.contactId },
      data: { leftAt: new Date() },
    });
    await g.conversations.syncStudentGroup(otherOrg.learnerId, otherOrg.staffId);
    expect(await g.conversations.membershipOf(group.id, otherOrg.contactId)).not.toBeNull();
    const kinds = (await g.prisma.message.findMany({ where: { conversationId: group.id }, orderBy: { seq: 'asc' } }))
      .map((m) => JSON.parse(m.body ?? '{}').kind);
    expect(kinds).toEqual(['group.created', 'group.membership_changed']);
    expect(await tenancyOf(group.id)).toEqual({ conversation: otherOrg.orgId, messages: [otherOrg.orgId] });
  });

  it('RT-030: archiving the other organization\'s group (internal path) writes its system message in that tenant', async () => {
    const group = await g.conversations.ensureStudentGroup(otherOrg.learnerId, otherOrg.staffId);
    await g.conversations.archiveStudentGroup(otherOrg.learnerId, 'learner left');
    const archived = await g.prisma.conversation.findUniqueOrThrow({ where: { id: group.id } });
    expect(archived.archivedAt).not.toBeNull();
    expect(await tenancyOf(group.id)).toEqual({ conversation: otherOrg.orgId, messages: [otherOrg.orgId] });
  });

  it("lets the family's owner reconcile a drifted group", async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    await g.prisma.conversationMember.updateMany({
      where: { conversationId: group.id, actorId: s.otherParentId },
      data: { leftAt: new Date() },
    });
    await g.conversations.syncStudentGroup(s.learnerId, s.ownerId);
    const live = await g.prisma.conversationMember.findFirst({
      where: { conversationId: group.id, actorId: s.otherParentId, leftAt: null },
    });
    expect(live).not.toBeNull();
  });
});
