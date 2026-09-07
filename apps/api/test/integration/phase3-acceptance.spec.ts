/**
 * THE PHASE 3 ACCEPTANCE SCENARIO -- the whole workflow, in order, as one test.
 *
 *   Create Family -> Ahmed -> Omar -> assign Islam -> assign Zainab
 *   -> create Group -> add Ahmed -> add Islam -> Islam leaves -> assign Mahmoud
 *   -> transfer Zainab -> Dina -> VIP + Renewal -> deactivate Omar
 *   -> close Group -> archive Group -> create replacement Group
 *
 * Then every final assertion the requirement lists, including the ones that
 * matter most: that Zainab holds nothing afterwards, and that Phase 2 messaging
 * still works.
 */
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@platform/prisma.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

const prisma = new PrismaService();
const g = buildGraph();
let s: Scenario;

const actorOf = async (id: string) => (await g.identity.resolveActor(id))!;

beforeEach(async () => {
  await truncate(prisma);
  s = await seed(prisma);
});
afterAll(async () => {
  await truncate(prisma);
  await prisma.$disconnect();
});

it('runs the full Jawwid administrative workflow and lands correctly', async () => {
  const manager = await actorOf(s.managerId);

  // Cast: Zainab is the seeded owner, Dina the other admin, Islam and Mahmoud
  // the two teachers.
  const ZAINAB = s.ownerId;
  const DINA = s.otherAdminId;
  const ISLAM = s.teacherId;
  const MAHMOUD = s.newTeacherId;

  // ---- create the family, supervised by Zainab -----------------------------
  const family = await g.families.createFamily(manager, {
    displayName: 'family_acceptance',
    supervisorId: ZAINAB,
  });

  // ---- two children --------------------------------------------------------
  const ahmed = await g.learners.create(manager, family.id, { name: 'Ahmed' });
  const omar = await g.learners.create(manager, family.id, { name: 'Omar' });

  // ---- Ahmed is taught by Islam -------------------------------------------
  await g.learners.assignTeacher(manager, ahmed.id, ISLAM, 'initial assignment');

  // ---- a group: Ahmed, taught by Islam ------------------------------------
  const groupA = await g.groups.create(manager, { name: 'Group A', ownerId: ZAINAB });
  await g.groups.addMember(manager, groupA.id, ahmed.id);
  await g.groups.addTeacher(manager, groupA.id, ISLAM);

  // ---- Islam leaves; Mahmoud takes over, in both places -------------------
  await g.groups.removeTeacher(manager, groupA.id, ISLAM, 'Islam left');
  await g.groups.addTeacher(manager, groupA.id, MAHMOUD);
  await g.learners.assignTeacher(manager, ahmed.id, MAHMOUD, 'Islam left');

  // ---- the family moves from Zainab to Dina -------------------------------
  await g.families.assignSupervisor(manager, family.id, DINA, 'portfolio rebalance');

  // ---- labels --------------------------------------------------------------
  const vip = await g.labels.create(manager, { name: 'VIP' });
  const renewal = await g.labels.create(manager, { name: 'Renewal' });
  await g.labels.addFamilies(manager, vip.id, [family.id]);
  await g.labels.addFamilies(manager, renewal.id, [family.id]);

  // ---- Omar leaves ---------------------------------------------------------
  await g.learners.deactivate(manager, omar.id, 'left the academy');

  // ---- the group is wound up and replaced ---------------------------------
  await g.groups.close(manager, groupA.id, 'term ended');
  await g.groups.archive(manager, groupA.id, 'archived at term end');
  const groupB = await g.groups.createReplacement(manager, groupA.id, 'Group B', 'new term');

  // =========================================================================
  // FINAL STATE
  // =========================================================================

  // -- Ahmed's current teacher is Mahmoud; Islam is history -----------------
  const teaching = await g.learners.teacherHistory(manager, ahmed.id);
  const currentTeacher = teaching.filter((t) => t.isCurrent);
  expect(currentTeacher).toHaveLength(1);
  expect(currentTeacher[0].teacherId).toBe(MAHMOUD);

  const islamRow = teaching.find((t) => t.teacherId === ISLAM)!;
  expect(islamRow.isCurrent).toBe(false);
  expect(islamRow.endedAt).not.toBeNull();

  // -- Dina supervises; Zainab is historical --------------------------------
  const assignments = await g.families.assignments(manager, family.id);
  const liveSupervisors = assignments.filter((a) => a.endedAt === null);
  expect(liveSupervisors).toHaveLength(1);
  expect(liveSupervisors[0].staffId).toBe(DINA);
  expect(assignments.find((a) => a.staffId === ZAINAB)!.endedAt).not.toBeNull();

  // -- Zainab holds NOTHING now ---------------------------------------------
  const zainab = await actorOf(ZAINAB);
  const dina = await actorOf(DINA);
  expect(await g.scope.canAccessFamily(zainab, family.id)).toBe(false);
  expect(await g.scope.canAccessFamily(dina, family.id)).toBe(true);
  await expect(g.families.get(zainab, family.id)).rejects.toBeDefined();
  await expect(g.families.get(dina, family.id)).resolves.toMatchObject({ id: family.id });

  // ...including in the conversation LIST, not merely on open.
  const ahmedGroupConv = await prisma.conversation.findFirst({
    where: { learnerId: ahmed.id, type: 'student_group' },
  });
  if (ahmedGroupConv) {
    const zainabList = (await g.conversations.listForActor(ZAINAB)).map((c) => c.id);
    expect(zainabList).not.toContain(ahmedGroupConv.id);
  }

  // -- labels ----------------------------------------------------------------
  const labels = (await g.labels.forFamily(manager, family.id)).map((l) => l.name);
  expect(labels).toEqual(['Renewal', 'VIP']);
  const both = await g.families.list(manager, undefined, 50, [vip.id, renewal.id]);
  expect(both.map((f) => f.id)).toEqual([family.id]);

  // -- Omar is inactive, Ahmed is not ---------------------------------------
  const learners = await g.learners.listForFamily(manager, family.id);
  expect(learners.find((l) => l.id === omar.id)!.isActive).toBe(false);
  expect(learners.find((l) => l.id === ahmed.id)!.isActive).toBe(true);
  // Omar was not deleted.
  expect(await prisma.learner.count({ where: { id: omar.id } })).toBe(1);

  // -- the archived group ----------------------------------------------------
  const archived = await g.groups.get(manager, groupA.id);
  expect(archived.id).toBe(groupA.id);           // id unchanged
  expect(archived.state).toBe('archived');
  expect(archived.replacedByGroupId).toBe(groupB.id);

  // still queryable, with its history
  expect(await g.groups.members(manager, groupA.id)).toHaveLength(1);
  const groupTeachers = await g.groups.teachers(manager, groupA.id);
  expect(groupTeachers.map((t) => t.teacherId).sort()).toEqual([ISLAM, MAHMOUD].sort());
  expect(groupTeachers.find((t) => t.teacherId === ISLAM)!.isCurrent).toBe(false);
  expect((await g.groups.history(manager, groupA.id)).length).toBeGreaterThan(0);

  // and immutable
  await expect(g.groups.rename(manager, groupA.id, 'nope')).rejects.toBeDefined();

  // -- the replacement is a NEW entity --------------------------------------
  expect(groupB.id).not.toBe(groupA.id);
  expect(groupB.state).toBe('active');
  expect(await g.groups.members(manager, groupB.id)).toHaveLength(0);

  // -- the family itself -----------------------------------------------------
  const finalFamily = await g.families.get(manager, family.id);
  expect(finalFamily.state).toBe('onboarding');
  expect(finalFamily.supervisorId).toBe(DINA);

  // =========================================================================
  // PHASE 2 IS UNBROKEN -- Dina can still hold a conversation with the family
  // =========================================================================
  const direct = await prisma.conversation.findFirst({
    where: { familyId: family.id, type: 'direct' },
  });
  const conversation =
    direct ??
    (await prisma.conversation.create({
      data: {
        type: 'direct',
        familyId: family.id,
        directKey: `family:${family.id}`,
        title: 'Jawwid',
      },
    }));
  const contact = await prisma.contact.create({
    data: {
      familyId: family.id,
      name: 'parent_acc',
      rolePreset: 'primary_guardian',
      canMessage: true,
      canViewProgress: true,
      canManageSchedule: true,
      canManageBilling: true,
      canManageContacts: true,
      canCancel: true,
    },
  });
  await prisma.conversationMember.createMany({
    data: [
      { conversationId: conversation.id, actorKind: 'contact', actorId: contact.id, memberRole: 'parent' },
      { conversationId: conversation.id, actorKind: 'staff', actorId: DINA, memberRole: 'admin' },
    ],
  });

  // Dina is a plain `admin`, and Phase 1's coverage engine still requires an
  // on-duty window before an admin may write to a family (recorded in the Phase
  // 2 report as unchanged behaviour). Pinning it here exercises the messaging
  // path as the product actually runs it; Phase 3 changes nothing about it.
  g.coverage.onDutyId = DINA;

  const sent = await g.messages.send({
    senderId: DINA,
    conversationId: conversation.id,
    body: 'Welcome to the new term.',
    clientMessageId: randomUUID(),
  });
  expect(sent.id).toBeDefined();

  // The current supervisor can read it; the former one cannot.
  await expect(g.conversations.rowForActor(conversation.id, DINA)).resolves.toBeDefined();
  await expect(g.conversations.rowForActor(conversation.id, ZAINAB)).rejects.toBeDefined();
});
