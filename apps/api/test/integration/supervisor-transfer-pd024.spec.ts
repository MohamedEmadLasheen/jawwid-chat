/**
 * PD-24 -- changing a group's supervisor, end to end on the PD-8 synthetic
 * organization (src/cli/org-chat-seed.ts).
 *
 *   1. who: the super admin and the Operations Manager; nobody else, and a
 *      refused transfer changes nothing
 *   2. a group moves: the SAME conversation, every earlier message and member
 *      kept, the old supervisor's seat ended and the new one's added; both
 *      children move; the parent's 1:1 is the same conversation with the new
 *      supervisor in it; billing and the family's owner follow; the previous
 *      supervisor reads none of it and no longer reaches the family
 *   3. the unit: moving one child of a shared group moves the whole group --
 *      no group is split, nothing is recreated
 *   4. a split family: the parent's 1:1 passes when the old supervisor has no
 *      child of the family left -- unless the parent already has one with the
 *      new supervisor, in which case nothing is duplicated
 *
 * Synthetic people only (G-20).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { hashPassword } from '@platform/auth/password';
import { CommError, CommErrorCode } from '@platform/errors';
import { BillingService } from '../../src/billing/billing.service';
import { OrgStructureService } from '../../src/org/org-structure.service';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';

jest.setTimeout(300_000);

const PASSWORD = 'pd24-transfer-spec-password-1';
const DOMAIN = 'pd24transfer.qa.jawwid.test';

const g = buildGraph();
const audit = new PrismaAuditService();
const org = new OrgStructureService(g.prisma, g.authz, g.conversations, audit);
const billing = new BillingService(g.prisma, g.conversations, audit);

let m: SeedManifest;
let orgId: string;

type Family = SeedManifest['families'][number];

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

const listed = async (actorId: string) => new Set((await g.conversations.listForActor(actorId)).map((c) => c.id));
const access = async (staffId: string, conversationId: string) =>
  (await g.prisma.$queryRaw<Array<{ a: string | null }>>`SELECT chat.staff_conversation_access(${staffId}::uuid, ${conversationId}::uuid) AS a`)[0]?.a ?? null;
const reaches = async (staffId: string, familyId: string) =>
  (await g.prisma.$queryRaw<Array<{ a: string | null }>>`SELECT chat.staff_reaches_family(${staffId}::uuid, ${familyId}::uuid) AS a`)[0]?.a ?? null;
const seated = async (conversationId: string, kind: string) =>
  (await g.prisma.conversationMember.findMany({ where: { conversationId, actorKind: kind, leftAt: null } })).map((x) => x.actorId).sort();
const messagesOf = (conversationId: string) =>
  g.prisma.message.findMany({ where: { conversationId }, orderBy: { seq: 'asc' }, select: { id: true, body: true, type: true } });
const supervisorOf = async (learnerId: string) =>
  (await g.prisma.learnerSupervision.findUniqueOrThrow({ where: { learnerId } })).supervisorId;

/** Families of `kids` children all with ONE supervisor, in one group. */
const sameSupervisorFamilies = (kids: number) =>
  m.families.filter((f) => f.children.length === kids && new Set(f.children.map((c) => c.supervisorId)).size === 1);
/** Two children, two supervisors, two groups, two 1:1s. */
const splitFamilies = () =>
  m.families.filter((f) => f.children.length === 2 && f.children[0]!.supervisorId !== f.children[1]!.supervisorId);
const otherSupervisor = (...not: string[]) => m.supervisors.find((s) => !not.includes(s.id))!.id;

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd24-%'`);
  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd24-${orgId.slice(0, 8)}', 'PD-24 QA academy')`,
  );
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    const account = await tx.account.create({
      data: { organizationId: orgId, subject: `owner@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true },
    });
    await tx.staff.create({
      data: { organizationId: orgId, name: 'QA Organization Owner', role: 'super_admin', isActive: true, accountId: account.id },
    });
  });
  m = await seedOrgChat(g.prisma, {
    organizationId: orgId,
    emailDomain: DOMAIN,
    password: PASSWORD,
    passwordHash: await hashPassword(PASSWORD),
  });
});

afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd24-%'`);
  await g.prisma.$disconnect();
});

describe('1. who may change a group\'s supervisor', () => {
  it('only the super admin and the Operations Manager; a refusal changes nothing', async () => {
    const f = sameSupervisorFamilies(3)[0]!;
    const group = f.groups[0]!;
    const to = otherSupervisor(group.supervisorId);
    const backupOfNobody = m.backups.find((b) => !m.backupLinks.some((l) => l.active && l.backupId === b.id)) ?? m.backups[0]!;
    for (const who of [m.salesManager, m.teachersManager, m.supervisors.find((s) => s.id === group.supervisorId)!, backupOfNobody, m.teacherSupervisors[0]!]) {
      expect({ who: who.name, code: await code(org.transferGroup(who.id, group.conversationId, { supervisorId: to, reason: 'probe' })) })
        .toEqual({ who: who.name, code: CommErrorCode.ORG_STRUCTURE_DENIED });
    }
    for (const c of f.children) expect(await supervisorOf(c.id)).toBe(group.supervisorId);
    expect(await seated(group.conversationId, 'staff')).toEqual([group.supervisorId]);
  });

  it('a reason is required, and the new supervisor must be an Operations primary supervisor', async () => {
    const f = sameSupervisorFamilies(3)[0]!;
    const group = f.groups[0]!;
    expect(await code(org.transferGroup(m.operationsManager.id, group.conversationId, { supervisorId: otherSupervisor(group.supervisorId) })))
      .toBe(CommErrorCode.VALIDATION);
    expect(await code(org.transferGroup(m.superAdmin.id, group.conversationId, { supervisorId: m.backups[0]!.id, reason: 'not a primary' })))
      .toBe(CommErrorCode.ORG_STRUCTURE_INVALID);
    expect(await code(org.transferGroup(m.superAdmin.id, f.directs[0]!.conversationId, { supervisorId: otherSupervisor(group.supervisorId), reason: 'a 1:1 has no children' })))
      .toBe(CommErrorCode.VALIDATION);
  });
});

describe('2. a group moves to another supervisor and nothing is lost', () => {
  let f: Family;
  let from: string;
  let to: string;
  let before: Awaited<ReturnType<typeof messagesOf>>;
  let directBefore: Awaited<ReturnType<typeof messagesOf>>;
  let teachersBefore: string[];
  let parentsBefore: string[];
  let result: Awaited<ReturnType<OrgStructureService['transferGroup']>>;

  beforeAll(async () => {
    f = sameSupervisorFamilies(2)[0]!;
    from = f.groups[0]!.supervisorId;
    to = otherSupervisor(from);
    await billing.setBillingSupervisor(m.operationsManager.id, f.id, { supervisorId: from, reason: 'family invoices' });
    before = await messagesOf(f.groups[0]!.conversationId);
    directBefore = await messagesOf(f.directs[0]!.conversationId);
    teachersBefore = await seated(f.groups[0]!.conversationId, 'teacher');
    parentsBefore = await seated(f.groups[0]!.conversationId, 'contact');
    expect(before.length).toBeGreaterThan(0);
    result = await org.transferGroup(m.operationsManager.id, f.groups[0]!.conversationId, { supervisorId: to, reason: 'supervisor on leave' });
  });

  it('reports what moved: both children, the group and the parent\'s 1:1', () => {
    expect(result.changed).toBe(true);
    expect(result.learners.map((l) => l.id).sort()).toEqual(f.children.map((c) => c.id).sort());
    expect(result.groups).toBe(1);
    expect(result.directChats).toBe(1);
  });

  it('the group is the same conversation: every earlier message kept, one system line added, the parent and teachers still in it', async () => {
    const after = await messagesOf(f.groups[0]!.conversationId);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after).toHaveLength(before.length + 1);
    expect(after.at(-1)!.type).toBe('system');
    expect(JSON.parse(after.at(-1)!.body!)).toEqual({ kind: 'group.supervisor_changed', supervisor: m.supervisors.find((s) => s.id === to)!.name });
    expect(await seated(f.groups[0]!.conversationId, 'staff')).toEqual([to]);
    expect(await seated(f.groups[0]!.conversationId, 'teacher')).toEqual(teachersBefore);
    expect(await seated(f.groups[0]!.conversationId, 'contact')).toEqual(parentsBefore);
    // The old seat is ended, not deleted: who was in the group, and when, stays on record.
    const old = await g.prisma.conversationMember.findFirst({ where: { conversationId: f.groups[0]!.conversationId, actorId: from } });
    expect(old?.leftAt).not.toBeNull();
    expect(await g.prisma.conversation.count({ where: { familyId: f.id, type: 'family_group' } })).toBe(f.groups.length);
  });

  it('the children are the new supervisor\'s, audited with the previous one and the reason', async () => {
    for (const c of f.children) {
      expect(await supervisorOf(c.id)).toBe(to);
      const row = await g.prisma.auditLog.findFirst({
        where: { action: 'learner.supervisor_reassigned', entityId: c.id },
        orderBy: { id: 'desc' },
      });
      expect(row).toMatchObject({ actorId: m.operationsManager.id, reason: 'supervisor on leave', before: { supervisorId: from } });
      expect((row!.after as { supervisorId: string }).supervisorId).toBe(to);
    }
  });

  it('the parent\'s 1:1 is the same conversation, its history kept, with the new supervisor in it', async () => {
    const direct = f.directs[0]!.conversationId;
    const after = await messagesOf(direct);
    expect(after.slice(0, directBefore.length)).toEqual(directBefore);
    expect(JSON.parse(after.at(-1)!.body!)).toMatchObject({ kind: 'direct.supervisor_changed' });
    expect(await seated(direct, 'staff')).toEqual([to]);
    expect(await seated(direct, 'contact')).toEqual([f.parent.id]);
    const conv = await g.prisma.conversation.findUniqueOrThrow({ where: { id: direct } });
    expect(conv.directKey).toBe([f.parent.id, to].sort().join(':'));
    // ...and opening "a direct with the new supervisor" finds it, rather than a new one.
    expect((await g.conversations.getOrCreateDirect(f.parent.id, to)).id).toBe(direct);
  });

  it('the new supervisor sees and reaches everything; the previous one sees and reaches none of it', async () => {
    const toSees = await listed(to);
    const fromSees = await listed(from);
    for (const id of [f.groups[0]!.conversationId, f.directs[0]!.conversationId]) {
      expect(toSees.has(id)).toBe(true);
      expect(fromSees.has(id)).toBe(false);
      expect(await access(to, id)).not.toBeNull();
      expect(await access(from, id)).toBeNull();
    }
    // Student and Parent Profiles, lessons and payments are read through the family reach.
    expect(await reaches(to, f.id)).not.toBeNull();
    expect(await reaches(from, f.id)).toBeNull();
    // The parent still has their group and their supervisor.
    expect(await listed(f.parent.id)).toEqual(new Set([f.groups[0]!.conversationId, f.directs[0]!.conversationId]));
  });

  it('the family\'s billing supervision and its owner (workload) pass to the new supervisor', async () => {
    expect((await g.prisma.familyBillingSupervision.findUniqueOrThrow({ where: { familyId: f.id } })).supervisorId).toBe(to);
    expect(await g.prisma.auditLog.findFirst({ where: { action: 'family.billing_supervisor_transferred', entityId: f.id } })).toMatchObject({
      before: { supervisorId: from },
      after: { supervisorId: to },
    });
    expect((await g.prisma.family.findUniqueOrThrow({ where: { id: f.id } })).ownerId).toBe(to);
  });

  it('moving it again to the same supervisor changes nothing', async () => {
    const again = await org.transferGroup(m.superAdmin.id, f.groups[0]!.conversationId, { supervisorId: to, reason: 'twice' });
    expect(again).toMatchObject({ changed: false, groups: 0, directChats: 0 });
  });
});

describe('3. the unit: a shared group is never split', () => {
  it('moving ONE child of a shared group moves every child of that group with it', async () => {
    const f = sameSupervisorFamilies(2)[1]!;
    const from = f.children[0]!.supervisorId;
    const to = otherSupervisor(from);
    const r = await org.transferLearners(m.superAdmin.id, [f.children[0]!.id], { supervisorId: to, reason: 'whole family' });
    expect(r.learners.map((l) => l.id).sort()).toEqual(f.children.map((c) => c.id).sort());
    for (const c of f.children) expect(await supervisorOf(c.id)).toBe(to);
    const anchors = await g.prisma.conversationLearner.findMany({ where: { conversationId: f.groups[0]!.conversationId } });
    expect(anchors.map((a) => a.learnerId).sort()).toEqual(f.children.map((c) => c.id).sort());
  });
});

describe('4. a family split between two supervisors', () => {
  it('the parent\'s 1:1 passes to a third supervisor once the old one has none of the family\'s children', async () => {
    const f = splitFamilies()[0]!;
    const [c0, c1] = f.children as [Family['children'][0], Family['children'][0]];
    const g0 = f.groups.find((x) => x.supervisorId === c0.supervisorId)!;
    const d0 = f.directs.find((x) => x.supervisorId === c0.supervisorId)!;
    const d1 = f.directs.find((x) => x.supervisorId === c1.supervisorId)!;
    const third = otherSupervisor(c0.supervisorId, c1.supervisorId);
    const r = await org.transferGroup(m.operationsManager.id, g0.conversationId, { supervisorId: third, reason: 'rebalancing' });
    expect(r).toMatchObject({ changed: true, groups: 1, directChats: 1 });
    expect(await seated(d0.conversationId, 'staff')).toEqual([third]);
    // The other supervisor's own 1:1 and child are untouched.
    expect(await seated(d1.conversationId, 'staff')).toEqual([c1.supervisorId]);
    expect(await supervisorOf(c1.id)).toBe(c1.supervisorId);
    expect(await reaches(c0.supervisorId, f.id)).toBeNull();
  });

  it('when the parent already has a 1:1 with the new supervisor, nothing is duplicated and the old one stays history', async () => {
    const f = splitFamilies()[1]!;
    const [c0, c1] = f.children as [Family['children'][0], Family['children'][0]];
    const g0 = f.groups.find((x) => x.supervisorId === c0.supervisorId)!;
    const d0 = f.directs.find((x) => x.supervisorId === c0.supervisorId)!;
    const d1 = f.directs.find((x) => x.supervisorId === c1.supervisorId)!;
    const directsBefore = await g.prisma.conversation.count({ where: { familyId: f.id, type: 'direct' } });
    const r = await org.transferGroup(m.operationsManager.id, g0.conversationId, { supervisorId: c1.supervisorId, reason: 'one supervisor per family' });
    expect(r).toMatchObject({ changed: true, groups: 1, directChats: 0 });
    expect(await g.prisma.conversation.count({ where: { familyId: f.id, type: 'direct' } })).toBe(directsBefore);
    // The old 1:1 keeps its rows but its staff member no longer reaches the family: nobody below the super admin reads it.
    expect(await seated(d0.conversationId, 'staff')).toEqual([c0.supervisorId]);
    expect(await access(c0.supervisorId, d0.conversationId)).toBeNull();
    expect(await access(c1.supervisorId, d1.conversationId)).not.toBeNull();
    // Both children now share one supervisor; the two groups stay two conversations.
    expect(await supervisorOf(c0.id)).toBe(c1.supervisorId);
    expect(await seated(g0.conversationId, 'staff')).toEqual([c1.supervisorId]);
  });
});
