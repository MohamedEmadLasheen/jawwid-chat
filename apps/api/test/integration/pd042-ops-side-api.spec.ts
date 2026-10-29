/**
 * PD-42 PR-3 -- the Operations side and the rest.
 *
 *   1. "Needs an Operations supervisor": a Sales-entered family waits; its
 *      Sales owner may suggest a name (D1); only the Operations manager (or
 *      the super admin) places it, once, and family.owner_id follows
 *   2. New Students lists the families entered by hand, to whoever owns them
 *   3. a child added to a family with a live group joins it (the group's
 *      supervisor, or once the Operations manager places the child)
 *   4. the Sales owner, changed by the Sales manager or the super admin only
 *   5. the family as the profiles read it: sign-in, owners, what the viewer may do
 *   6. the carried-over package as the Student Profile reads it
 *   7. the verification report (S3, D2): every family has an Operations
 *      supervisor or a Sales owner, read-only
 *
 * Synthetic fixtures only (G-16). Fresh e-mails per test: accounts outlive truncate.
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { LessonService } from '../../src/lessons/lesson.service';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { FamilyIntakeService } from '../../src/new-students/intake.service';
import { ownershipReport } from '../../src/new-students/ownership-report';
import { buildGraph, seed, truncate, type Scenario } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';

jest.setTimeout(60_000);

const g = buildGraph();
const audit = new PrismaAuditService();
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);
const intake = new FamilyIntakeService(g.prisma, g.conversations, lessons, scheduling, audit);

let s: Scenario;
let salesA: string;
let salesB: string;
let salesManager: string;
let superId: string;
let tsupId: string;
let n = 0;

const sql = (q: string, ...args: unknown[]) => g.prisma.$executeRawUnsafe(q, ...args);

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

/** Every phone and e-mail this file's fixtures typed, to prove no answer carries one (G-07). */
const typed: string[] = [];

function phone(): string {
  n += 1;
  const value = `010${String(20_000_000 + n).slice(-8)}`;
  typed.push(value);
  return value;
}

function email(): string {
  const value = `pd42_${randomUUID().slice(0, 8)}@example.test`;
  typed.push(value);
  return value;
}

/**
 * No phone or e-mail a fixture typed appears in `value`. Ids are taken out
 * first: a pattern such as 010 and eight digits matches inside a random uuid
 * (G-19 run 40735626384: ...-010259547393), so the check names the exact
 * values, never a shape.
 */
function expectNoContact(value: unknown) {
  const text = withoutIds(value);
  for (const t of typed) expect(text).not.toContain(t);
}

function withoutIds(value: unknown): string {
  return JSON.stringify(value).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>');
}

function form(over: Record<string, unknown> = {}) {
  return {
    intakeId: randomUUID(),
    parent: { name: 'parent_o', phone: phone() },
    children: [{ name: 'child_o', teacherId: s.teacherId }],
    ...over,
  };
}

async function staff(id: string, name: string, role: string) {
  await sql(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, $2, $3, true)`, id, name, role);
}

async function department(kind: string, managerId: string | null, members: string[]) {
  const [{ id }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name, manager_id) values ($1, $1, $2::uuid) returning id::text as id`, kind, managerId,
  );
  for (const m of members) {
    await sql(
      `insert into chat.department_member (staff_id, organization_id, department_id, position)
       values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`, m, id,
    );
  }
}

const entry = async (viewer: string, familyId: string) =>
  (await intake.entered(viewer)).families.find((f) => f.familyId === familyId);

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await sql(`delete from chat.config where key in ('sales.family_scope', 'intake.contact_keys_ready')`);
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await sql(`delete from chat.config where key = 'sales.family_scope'`);
  await sql(`insert into chat.config (key, value) values ('intake.contact_keys_ready', 'true'::jsonb)
             on conflict (key) do update set value = excluded.value`);
  await truncate(g.prisma);
  s = await seed(g.prisma);
  salesA = randomUUID();
  salesB = randomUUID();
  salesManager = randomUUID();
  superId = randomUUID();
  tsupId = randomUUID();
  await staff(salesA, 'sales_a', 'admin');
  await staff(salesB, 'sales_b', 'admin');
  await staff(salesManager, 'sales_m', 'manager');
  await staff(tsupId, 'tsup_t', 'admin');
  await g.prisma.$transaction([
    g.prisma.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`),
    g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'super_s', 'super_admin', true)`, superId),
  ]);
  await department('sales', salesManager, [salesA, salesB]);
  await department('teachers', null, [tsupId]);
});

describe('1. "Needs an Operations supervisor"', () => {
  it('a Sales-entered family waits; its owner suggests; only the Operations manager places it, once', async () => {
    const r = await intake.enter(salesA, form());
    expect(r.supervision).toBe('needs_operations_supervisor');
    expect(await entry(s.managerId, r.familyId)).toMatchObject({
      needsOperationsSupervisor: true, supervisor: null, salesOwner: { id: salesA }, enteredBy: { id: salesA }, kind: 'new_family',
    });

    // D1: the Sales owner suggests a name; nobody else does, and it is a suggestion only.
    expect(await code(intake.suggestSupervisor(salesB, r.familyId, { supervisorId: s.otherAdminId }))).toBe(CommErrorCode.INTAKE_NOT_FOUND);
    expect(await code(intake.suggestSupervisor(salesA, r.familyId, { supervisorId: salesB }))).toBe(CommErrorCode.INTAKE_INVALID);
    await intake.suggestSupervisor(salesA, r.familyId, { supervisorId: s.otherAdminId });
    expect(await entry(s.managerId, r.familyId)).toMatchObject({ suggestion: { id: s.otherAdminId }, needsOperationsSupervisor: true });
    expect(await g.prisma.learnerSupervision.count({ where: { learnerId: { in: r.learnerIds } } })).toBe(0);

    // Placing it is the Operations manager's (or the super admin's), and nobody else's.
    for (const who of [salesA, salesManager, s.ownerId]) {
      expect(await code(intake.assignOperationsSupervisor(who, r.familyId, { supervisorId: s.otherAdminId }))).toBe(CommErrorCode.INTAKE_DENIED);
    }
    expect(await code(intake.assignOperationsSupervisor(s.managerId, r.familyId, { supervisorId: salesB }))).toBe(CommErrorCode.INTAKE_INVALID);
    const placed = await intake.assignOperationsSupervisor(s.managerId, r.familyId, { supervisorId: s.otherAdminId });
    expect(placed).toMatchObject({ familyId: r.familyId, supervisorId: s.otherAdminId, learnerIds: r.learnerIds });

    expect(await g.prisma.learnerSupervision.findUniqueOrThrow({ where: { learnerId: r.learnerIds[0]! } }))
      .toMatchObject({ supervisorId: s.otherAdminId, assignedBy: s.managerId });
    expect((await g.prisma.family.findUniqueOrThrow({ where: { id: r.familyId } })).ownerId).toBe(s.otherAdminId);
    // S4: who placed the family on its supervisor, and when -- once for the family, once per child.
    expect(await g.prisma.auditLog.findFirstOrThrow({ where: { action: 'family.operations_supervisor_set', entityId: r.familyId } }))
      .toMatchObject({ actorId: s.managerId, after: expect.objectContaining({ supervisorId: s.otherAdminId, learnerIds: r.learnerIds }) });
    expect(await g.prisma.auditLog.count({ where: { action: 'learner.supervisor_assigned', entityId: { in: r.learnerIds } } })).toBe(1);
    expect(await entry(s.managerId, r.familyId)).toMatchObject({ needsOperationsSupervisor: false, supervisor: { id: s.otherAdminId } });
    // The Sales owner keeps the family; the new supervisor now reaches it.
    expect(await entry(salesA, r.familyId)).toBeDefined();
    expect(await entry(s.otherAdminId, r.familyId)).toBeDefined();

    // Once: moving it later is PD-24's transfer.
    expect(await code(intake.assignOperationsSupervisor(s.managerId, r.familyId, { supervisorId: s.ownerId }))).toBe(CommErrorCode.INTAKE_STATE);
    expect(await code(intake.suggestSupervisor(salesA, r.familyId, { supervisorId: s.ownerId }))).toBe(CommErrorCode.INTAKE_STATE);
  });

  it('the database refuses a suggestion by someone who does not own the family, or of someone who is not an Operations supervisor', async () => {
    const r = await intake.enter(salesA, form());
    const raw = (by: string, supervisor: string) => g.prisma.$executeRawUnsafe(
      `insert into chat.family_supervisor_suggestion (family_id, supervisor_id, suggested_by) values ($1::uuid, $2::uuid, $3::uuid)
       on conflict (family_id) do update set supervisor_id = excluded.supervisor_id, suggested_by = excluded.suggested_by`,
      r.familyId, supervisor, by,
    );
    await expect(raw(salesB, s.otherAdminId)).rejects.toThrow(/own|suggest/);
    await expect(raw(salesA, salesB)).rejects.toThrow(/Operations supervisor/);
    await raw(salesA, s.otherAdminId);
    expect(await g.prisma.familySupervisorSuggestion.findUniqueOrThrow({ where: { familyId: r.familyId } }))
      .toMatchObject({ supervisorId: s.otherAdminId, suggestedBy: salesA });
  });

  it('the super admin places it too; an unknown family is not found', async () => {
    const r = await intake.enter(salesA, form());
    expect(await code(intake.assignOperationsSupervisor(s.managerId, randomUUID(), { supervisorId: s.ownerId }))).toBe(CommErrorCode.INTAKE_NOT_FOUND);
    await intake.assignOperationsSupervisor(superId, r.familyId, { supervisorId: s.ownerId });
    expect((await g.prisma.family.findUniqueOrThrow({ where: { id: r.familyId } })).ownerId).toBe(s.ownerId);
  });

  it('a child added later to a supervised family goes to the family\'s supervisor, never to another', async () => {
    const r = await intake.enter(s.ownerId, form());
    // A Sales owner set by the Sales manager adds a child: it waits for its supervisor.
    await intake.changeSalesOwner(salesManager, r.familyId, { staffId: salesA, reason: 'renewals' });
    const added = await intake.addChildren(salesA, r.familyId, { intakeId: randomUUID(), children: [{ name: 'child_late' }] });
    expect(added.supervision).toBe('needs_operations_supervisor');
    expect(await entry(s.managerId, r.familyId)).toMatchObject({ needsOperationsSupervisor: true, supervisor: { id: s.ownerId } });
    // Siblings share their supervisor (PD-24 moves them together).
    expect(await code(intake.assignOperationsSupervisor(s.managerId, r.familyId, { supervisorId: s.otherAdminId }))).toBe(CommErrorCode.INTAKE_INVALID);
    await intake.assignOperationsSupervisor(s.managerId, r.familyId, { supervisorId: s.ownerId });
    expect(await g.prisma.learnerSupervision.findUniqueOrThrow({ where: { learnerId: added.learnerIds[0]! } }))
      .toMatchObject({ supervisorId: s.ownerId, assignedBy: s.managerId });
  });
});

describe('1a. review of #214', () => {
  it('the Operations manager places a family only on a supervisor of their own department -- the academy\'s one; never another academy\'s', async () => {
    // One Operations department per academy (department_one_kind_per_organization): "their own department" is it.
    await expect(department('operations', null, [])).rejects.toThrow(/23505|unique|duplicate/i);
    const foreignOrg = randomUUID();
    const foreignSupervisor = randomUUID();
    await sql(`insert into chat.organization (id, slug, display_name) values ($1::uuid, $2, 'Other')`, foreignOrg, `pd42-${foreignOrg.slice(0, 8)}`);
    await sql(`insert into chat.staff (id, organization_id, name, role, is_active) values ($1::uuid, $2::uuid, 'ops_x', 'admin', true)`, foreignSupervisor, foreignOrg);
    const [{ id: foreignDept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `insert into chat.department (organization_id, kind, display_name) values ($1::uuid, 'operations', 'operations') returning id::text as id`, foreignOrg,
    );
    await sql(`insert into chat.department_member (staff_id, organization_id, department_id, position) values ($1::uuid, $2::uuid, $3::uuid, 'supervisor')`,
      foreignSupervisor, foreignOrg, foreignDept);
    try {
      const r = await intake.enter(salesA, form());
      const placeable = (await intake.family(s.managerId, r.familyId)).supervisorChoices.map((x) => x.id).sort();
      expect(placeable).toEqual([s.ownerId, s.otherAdminId].sort());
      expect((await intake.family(superId, r.familyId)).supervisorChoices.map((x) => x.id).sort()).toEqual(placeable);
      for (const who of [s.managerId, superId]) {
        expect(await code(intake.assignOperationsSupervisor(who, r.familyId, { supervisorId: foreignSupervisor }))).toBe(CommErrorCode.INTAKE_INVALID);
      }
    } finally {
      await sql(`delete from chat.department_member where organization_id = $1::uuid`, foreignOrg);
      await sql(`delete from chat.department where organization_id = $1::uuid`, foreignOrg);
      await sql(`delete from chat.staff where organization_id = $1::uuid`, foreignOrg);
      await sql(`delete from chat.organization where id = $1::uuid`, foreignOrg);
    }
  });

  it('only the family\'s Sales owner suggests a supervisor', async () => {
    const r = await intake.enter(salesA, form());
    expect((await intake.family(salesManager, r.familyId)).can.suggestSupervisor).toBe(false);
    expect((await entry(salesManager, r.familyId))!.canSuggestSupervisor).toBe(false);
    expect((await entry(salesA, r.familyId))!.canSuggestSupervisor).toBe(true);
    expect(await code(intake.suggestSupervisor(salesManager, r.familyId, { supervisorId: s.ownerId }))).toBe(CommErrorCode.INTAKE_DENIED);
    expect(await code(intake.suggestSupervisor(s.managerId, r.familyId, { supervisorId: s.ownerId }))).toBe(CommErrorCode.INTAKE_DENIED);
    await expect(g.prisma.$executeRawUnsafe(
      `insert into chat.family_supervisor_suggestion (family_id, supervisor_id, suggested_by) values ($1::uuid, $2::uuid, $3::uuid)`,
      r.familyId, s.ownerId, salesManager,
    )).rejects.toThrow(/Sales owner/);
    await intake.suggestSupervisor(salesA, r.familyId, { supervisorId: s.ownerId });
  });

  it('the sign-up code is shown only to whoever is responsible now', async () => {
    const withEmail = () => ({ parent: { name: 'parent_code', phone: phone(), email: email() } });
    const code6 = async (familyId: string) => {
      const contact = await g.prisma.contact.findFirstOrThrow({ where: { familyId } });
      await g.prisma.parentSignupCode.create({
        data: { organizationId: contact.organizationId, accountId: contact.accountId!, codeHash: 'a'.repeat(64), relayCode: '246810' },
      });
    };
    const shown = async (viewer: string, familyId: string) => {
      const e = await entry(viewer, familyId);
      return e?.parentSignup.state === 'code_waiting' ? (e.parentSignup as { code?: string | null }).code ?? null : 'no entry or no code';
    };
    // Supervised by its entrant: the supervisor, the Operations manager, the super admin -- not its Sales owner.
    const ops = await intake.enter(s.ownerId, form(withEmail()));
    await intake.changeSalesOwner(salesManager, ops.familyId, { staffId: salesA, reason: 'renewals' });
    await code6(ops.familyId);
    expect(await shown(s.ownerId, ops.familyId)).toBe('246810');
    expect(await shown(s.managerId, ops.familyId)).toBe('246810');
    expect(await shown(superId, ops.familyId)).toBe('246810');
    expect(await shown(salesA, ops.familyId)).toBeNull();
    expect(await shown(salesManager, ops.familyId)).toBeNull();
    // Waiting for its Operations supervisor: the Sales owner and the Sales manager relay it -- until it is placed.
    const sales = await intake.enter(salesA, form(withEmail()));
    await code6(sales.familyId);
    expect(await shown(salesA, sales.familyId)).toBe('246810');
    expect(await shown(salesManager, sales.familyId)).toBe('246810');
    expect(await shown(s.managerId, sales.familyId)).toBe('246810');
    await intake.assignOperationsSupervisor(s.managerId, sales.familyId, { supervisorId: s.otherAdminId });
    expect(await shown(salesA, sales.familyId)).toBeNull();
    expect(await shown(s.otherAdminId, sales.familyId)).toBe('246810');
  });

  it('the request roles have no privilege on the suggestion table', async () => {
    const rows = await g.prisma.$queryRawUnsafe<Array<{ r: string; p: string; can: boolean }>>(`
      select r, p, has_table_privilege(r, 'chat.family_supervisor_suggestion', p) as can
        from unnest(array['anon', 'authenticated', 'chat_app']) r
        cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p`);
    expect(rows).toHaveLength(12);
    expect(rows.filter((x) => x.can)).toEqual([]);
  });
});

describe('1b. a manager with nobody to enter a family for (QA on #202)', () => {
  it('the Sales manager of an empty Sales team is told so, and never owns a family themself', async () => {
    await sql(`delete from chat.department_member where staff_id = any($1::uuid[])`, [salesA, salesB]);
    expect(await intake.options(salesManager)).toMatchObject({ standing: 'sales_manager', ready: true, onBehalfOf: [], noTeam: true });
    const refused = await intake.enter(salesManager, form()).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(CommError);
    expect((refused as CommError).code).toBe(CommErrorCode.INTAKE_INVALID);
    expect((refused as CommError).message).toMatch(/add one first/);
    // Naming themself is not an answer: the supervisor owns the family, the manager only enters it.
    expect(await code(intake.enter(salesManager, form({ onBehalfOf: salesManager })))).toBe(CommErrorCode.INTAKE_INVALID);
    expect(await g.prisma.familySalesOwner.count()).toBe(0);
    // A team with people in it is not blocked; a supervisor never is.
    expect(await intake.options(s.managerId)).toMatchObject({ noTeam: false });
    expect(await intake.options(s.ownerId)).toMatchObject({ noTeam: false, onBehalfOf: [] });
  });
});

describe('2. New Students lists the families entered by hand', () => {
  it('to whoever owns them: the entrant, the Operations manager, the super admin; never to another supervisor', async () => {
    const mine = await intake.enter(s.ownerId, form({ parent: { name: 'parent_mine', phone: phone(), email: email() } }));
    const theirs = await intake.enter(salesA, form());

    const seen = await intake.entered(s.ownerId);
    expect(seen.families.map((f) => f.familyId)).toEqual([mine.familyId]);
    expect(seen.families[0]).toMatchObject({
      enrolmentId: mine.enrolmentId, kind: 'new_family', parentName: 'parent_mine', enteredBy: { id: s.ownerId, name: expect.any(String) },
      supervisor: { id: s.ownerId }, needsOperationsSupervisor: false, salesOwner: null,
      children: [{ id: mine.learnerIds[0], name: 'child_o' }],
      parentSignup: { state: 'not_started' },
    });
    expect(Date.parse(seen.families[0]!.enteredAt)).toBeGreaterThan(Date.now() - 60_000);

    expect((await intake.entered(salesA)).families.map((f) => f.familyId)).toEqual([theirs.familyId]);
    expect(await entry(salesA, theirs.familyId)).toMatchObject({ parentSignup: { state: 'no_email' } });
    expect((await intake.entered(salesB)).families).toEqual([]);
    expect((await intake.entered(s.otherAdminId)).families).toEqual([]);
    expect((await intake.entered(s.managerId)).families.map((f) => f.familyId).sort()).toEqual([mine.familyId, theirs.familyId].sort());
    expect((await intake.entered(superId)).families).toHaveLength(2);
    // The Sales manager: the families with a Sales owner.
    expect((await intake.entered(salesManager)).families.map((f) => f.familyId)).toEqual([theirs.familyId]);
    expect((await intake.entered(s.managerId)).canAssignSupervisor).toBe(true);
    expect((await intake.entered(salesA)).canAssignSupervisor).toBe(false);
    // Nobody outside Sales and Operations.
    expect(await code(intake.entered(tsupId))).toBe(CommErrorCode.INTAKE_DENIED);
    // No contact channel on the list (G-07).
    expectNoContact(await intake.entered(s.managerId));
  });

  it('added children are their own entry, beside the family\'s', async () => {
    const r = await intake.enter(s.ownerId, form());
    const added = await intake.addChildren(s.ownerId, r.familyId, { intakeId: randomUUID(), children: [{ name: 'child_more' }] });
    const kinds = (await intake.entered(s.ownerId)).families.map((f) => [f.kind, f.enrolmentId]);
    expect(kinds).toEqual(expect.arrayContaining([['new_family', r.enrolmentId], ['added_children', added.enrolmentId]]));
  });
});

describe('3. a child added to a family with a live group joins it', () => {
  it('added by the group\'s supervisor: anchored, their teacher seated, one system line, audited', async () => {
    const r = await intake.enter(s.ownerId, form());
    const contactId = r.contactId!;
    const group = await g.conversations.createFamilyGroup(s.ownerId, { learnerIds: r.learnerIds, contactIds: [contactId], teacherIds: [s.teacherId] });
    const before = await g.prisma.message.count({ where: { conversationId: group.id } });

    const added = await intake.addChildren(s.ownerId, r.familyId, {
      intakeId: randomUUID(), children: [{ name: 'child_sib', teacherId: s.newTeacherId }],
    });
    expect(added.group).toBe('joined');
    const child = added.learnerIds[0]!;
    expect(await g.prisma.conversationLearner.count({ where: { conversationId: group.id, learnerId: child } })).toBe(1);
    expect(await g.prisma.conversationMember.count({ where: { conversationId: group.id, actorId: s.newTeacherId, leftAt: null } })).toBe(1);
    const messages = await g.prisma.message.findMany({ where: { conversationId: group.id }, orderBy: { seq: 'asc' } });
    expect(messages).toHaveLength(before + 1);
    expect(JSON.parse(messages.at(-1)!.body!)).toEqual({ kind: 'group.learner_added', learner: 'child_sib' });
    expect(await g.prisma.auditLog.findFirstOrThrow({ where: { action: 'family_group.learners_added', entityId: group.id } }))
      .toMatchObject({ actorId: s.ownerId, after: expect.objectContaining({ learnerIds: [child], teacherIds: [s.newTeacherId] }) });
    expect((await g.prisma.studentEnrolment.findUniqueOrThrow({ where: { id: added.enrolmentId } })).groupConversationId).toBe(group.id);
  });

  it('a child waiting for its supervisor joins when the Operations manager places it', async () => {
    const r = await intake.enter(s.ownerId, form());
    const group = await g.conversations.createFamilyGroup(s.ownerId, { learnerIds: r.learnerIds, contactIds: [r.contactId!], teacherIds: [s.teacherId] });
    await intake.changeSalesOwner(salesManager, r.familyId, { staffId: salesA, reason: 'renewals' });
    const added = await intake.addChildren(salesA, r.familyId, { intakeId: randomUUID(), children: [{ name: 'child_wait', teacherId: s.teacherId }] });
    expect(added.group).toBe('none');
    expect(await g.prisma.conversationLearner.count({ where: { conversationId: group.id, learnerId: added.learnerIds[0]! } })).toBe(0);
    const placed = await intake.assignOperationsSupervisor(s.managerId, r.familyId, { supervisorId: s.ownerId });
    expect(placed.group).toBe('joined');
    expect(await g.prisma.conversationLearner.count({ where: { conversationId: group.id, learnerId: added.learnerIds[0]! } })).toBe(1);
  });

  it('no group yet: nothing to join', async () => {
    const r = await intake.enter(s.ownerId, form());
    const added = await intake.addChildren(s.ownerId, r.familyId, { intakeId: randomUUID(), children: [{ name: 'child_x' }] });
    expect(added.group).toBe('none');
  });

  it('a replayed Add child joins nothing twice', async () => {
    const r = await intake.enter(s.ownerId, form());
    const group = await g.conversations.createFamilyGroup(s.ownerId, { learnerIds: r.learnerIds, contactIds: [r.contactId!], teacherIds: [s.teacherId] });
    const body = { intakeId: randomUUID(), children: [{ name: 'child_r', teacherId: s.teacherId }] };
    await intake.addChildren(s.ownerId, r.familyId, body);
    const count = await g.prisma.message.count({ where: { conversationId: group.id } });
    const again = await intake.addChildren(s.ownerId, r.familyId, body);
    expect(again.replay).toBe(true);
    expect(await g.prisma.message.count({ where: { conversationId: group.id } })).toBe(count);
  });
});

describe('4. the Sales owner', () => {
  it('set and changed by the Sales manager (or the super admin) only, to a Sales member, audited from -> to', async () => {
    const r = await intake.enter(s.ownerId, form());
    for (const who of [salesA, s.managerId, s.ownerId]) {
      expect(await code(intake.changeSalesOwner(who, r.familyId, { staffId: salesA, reason: 'x' }))).toBe(CommErrorCode.INTAKE_DENIED);
    }
    expect(await code(intake.changeSalesOwner(salesManager, r.familyId, { staffId: s.ownerId, reason: 'x' }))).toBe(CommErrorCode.INTAKE_INVALID);
    expect(await code(intake.changeSalesOwner(salesManager, r.familyId, { staffId: salesA }))).toBe(CommErrorCode.INTAKE_INVALID);

    await intake.changeSalesOwner(salesManager, r.familyId, { staffId: salesA, reason: 'takes the renewals' });
    expect(await g.prisma.familySalesOwner.findUniqueOrThrow({ where: { familyId: r.familyId } }))
      .toMatchObject({ staffId: salesA, assignedBy: salesManager, reason: 'takes the renewals' });
    expect(await g.prisma.auditLog.findFirstOrThrow({ where: { action: 'family.sales_owner_set', entityId: r.familyId } }))
      .toMatchObject({ actorId: salesManager, after: expect.objectContaining({ salesOwnerId: salesA }) });

    await intake.changeSalesOwner(superId, r.familyId, { staffId: salesB, reason: 'salesA moved to another market' });
    expect((await g.prisma.familySalesOwner.findUniqueOrThrow({ where: { familyId: r.familyId } })).staffId).toBe(salesB);
    expect(await g.prisma.auditLog.findFirstOrThrow({ where: { action: 'family.sales_owner_changed', entityId: r.familyId } }))
      .toMatchObject({ actorId: superId, before: { salesOwnerId: salesA }, after: { salesOwnerId: salesB }, reason: 'salesA moved to another market' });
    // The same owner again changes nothing.
    expect(await code(intake.changeSalesOwner(salesManager, r.familyId, { staffId: salesB, reason: 'again' }))).toBe(CommErrorCode.INTAKE_STATE);
    expect(await code(intake.changeSalesOwner(salesManager, randomUUID(), { staffId: salesB, reason: 'x' }))).toBe(CommErrorCode.INTAKE_NOT_FOUND);
  });
});

describe('5. the family, as the profiles read it', () => {
  it('sign-in, owners and what the viewer may do; another supervisor\'s family is not found', async () => {
    const r = await intake.enter(salesA, form());
    expect(await intake.family(salesA, r.familyId)).toMatchObject({
      familyId: r.familyId, contactId: r.contactId, signIn: false, salesOwner: { id: salesA }, supervisor: null,
      needsOperationsSupervisor: true, suggestion: null,
      can: { setSignInEmail: true, addChild: true, suggestSupervisor: true, assignOperationsSupervisor: false, changeSalesOwner: false },
    });
    expect(await intake.family(salesManager, r.familyId)).toMatchObject({
      can: expect.objectContaining({ changeSalesOwner: true, assignOperationsSupervisor: false }),
      salesOwnerChoices: expect.arrayContaining([expect.objectContaining({ id: salesA }), expect.objectContaining({ id: salesB })]),
    });
    expect(await intake.family(s.managerId, r.familyId)).toMatchObject({
      can: expect.objectContaining({ assignOperationsSupervisor: true, changeSalesOwner: false }),
      supervisorChoices: expect.arrayContaining([expect.objectContaining({ id: s.ownerId })]),
    });
    expect(await code(intake.family(salesB, r.familyId))).toBe(CommErrorCode.INTAKE_NOT_FOUND);
    expect(await code(intake.family(s.ownerId, r.familyId))).toBe(CommErrorCode.INTAKE_NOT_FOUND);
    expect(await code(intake.family(tsupId, r.familyId))).toBe(CommErrorCode.INTAKE_DENIED);

    await intake.setSignInEmail(salesA, r.familyId, { email: email() });
    expect(await intake.family(salesA, r.familyId)).toMatchObject({ signIn: true, can: expect.objectContaining({ setSignInEmail: false }) });
  });
});

describe('6. the carried-over package, as the Student Profile reads it', () => {
  it('total, completed, remaining, plan; who may enter or correct it', async () => {
    const r = await intake.enter(s.ownerId, form({ children: [{ name: 'child_pkg', carriedOver: { total: 20, completed: 12, planMonths: 3 } }] }));
    const child = r.learnerIds[0]!;
    expect(await intake.carriedOverOf(s.ownerId, child)).toMatchObject({
      learnerId: child,
      package: { total: 20, completed: 12, remaining: 8, planMonths: 3, enteredBy: { id: s.ownerId } },
      access: { state: 'open', balance: 8 },
      can: { carryOver: false, correct: true },
    });
    expect(await intake.carriedOverOf(s.managerId, child)).toMatchObject({ can: { carryOver: false, correct: true } });
    expect(await code(intake.carriedOverOf(s.otherAdminId, child))).toBe(CommErrorCode.INTAKE_NOT_FOUND);

    await intake.voidCarryOver(s.ownerId, child, { reason: 'typed 20 for 24' });
    expect(await intake.carriedOverOf(s.ownerId, child)).toMatchObject({ package: null, can: { carryOver: true, correct: false } });
    // A child not entered by hand has nothing to carry over.
    expect(await intake.carriedOverOf(s.managerId, s.learnerId)).toMatchObject({ package: null, can: { carryOver: false } });
  });
});

describe('7. the verification report (S3, D2)', () => {
  it('every family with its Operations supervisor or Sales owner, counted per person; the rest listed', async () => {
    const supervised = await intake.enter(s.ownerId, form());
    const owned = await intake.enter(salesA, form());
    // A family with neither: in Chat from before PD-42 (an earlier import), no child supervised, no Sales owner.
    const [{ id: orphan }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `insert into chat.family (display_name, owner_id) values ('fam_orphan', $1::uuid) returning id::text as id`, s.ownerId,
    );

    const report = await ownershipReport(g.prisma);
    expect(report.ok).toBe(false);
    expect(report.unowned.map((u) => u.familyId)).toEqual([orphan]);
    const ops = report.operationsSupervisors.find((x) => x.staffId === s.ownerId)!;
    expect(ops.families).toBeGreaterThanOrEqual(2); // the seed's family and the one entered
    const sales = report.salesOwners.find((x) => x.staffId === salesA)!;
    expect(sales).toMatchObject({ families: 1 });
    expect(report.families).toBe(report.withOperationsSupervisor + report.salesOwnedOnly + report.unowned.length);
    expect(report.partlySupervised).toEqual([]);
    expect(supervised.familyId).not.toBe(owned.familyId);
    // Read-only: nothing it says carries a name of a parent, a phone or an e-mail.
    expectNoContact(report);
    expect(withoutIds(report)).not.toMatch(/parent_o|@/);
  });
});

describe('8. the family history (S4)', () => {
  it('who entered it, who owns it, who placed it, the package -- in order, each once; never a phone or an e-mail', async () => {
    const f = form({
      parent: { name: 'parent_h', phone: phone(), email: email() },
      children: [{ name: 'child_h', carriedOver: { total: 20, completed: 4 } }],
    });
    const r = await intake.enter(salesA, f);
    await intake.enter(salesA, f); // S1: a replay writes nothing, so it adds no line
    await intake.suggestSupervisor(salesA, r.familyId, { supervisorId: s.otherAdminId });
    await intake.assignOperationsSupervisor(s.managerId, r.familyId, { supervisorId: s.otherAdminId });
    await intake.changeSalesOwner(salesManager, r.familyId, { staffId: salesB, reason: 'salesA moved to another market' });
    await intake.voidCarryOver(s.managerId, r.learnerIds[0]!, { reason: 'typed 20 for 24' });

    const h = await intake.history(salesB, r.familyId);
    expect(h.entries.map((e) => e.action)).toEqual([
      'subscription.carried_over', 'family.entered', 'family.sales_owner_set', 'family.supervisor_suggested',
      'learner.supervisor_assigned', 'family.operations_supervisor_set', 'family.sales_owner_changed', 'subscription.voided',
    ]);
    const by = (action: string) => h.entries.find((e) => e.action === action)!;
    expect(by('family.entered')).toMatchObject({ actor: { id: salesA, name: 'sales_a' }, subject: { kind: 'family', id: r.familyId } });
    expect(by('subscription.carried_over')).toMatchObject({
      subject: { kind: 'learner', id: r.learnerIds[0], name: 'child_h' }, details: { total: 20, completed: 4, planMonths: null },
    });
    expect(by('family.operations_supervisor_set')).toMatchObject({ actor: { id: s.managerId }, details: { supervisor: { id: s.otherAdminId } } });
    expect(by('family.sales_owner_changed')).toMatchObject({
      actor: { id: salesManager, name: 'sales_m' },
      details: { from: { id: salesA, name: 'sales_a' }, to: { id: salesB, name: 'sales_b' } },
      reason: 'salesA moved to another market',
    });
    expect(by('subscription.voided')).toMatchObject({ actor: { id: s.managerId }, reason: 'typed 20 for 24' });
    for (let i = 1; i < h.entries.length; i += 1) {
      expect(Date.parse(h.entries[i]!.at)).toBeGreaterThanOrEqual(Date.parse(h.entries[i - 1]!.at));
    }
    expectNoContact(h);

    // Read by whoever owns the family now; anyone else does not find it.
    expect((await intake.history(s.otherAdminId, r.familyId)).entries).toHaveLength(8);
    expect((await intake.history(s.managerId, r.familyId)).entries).toHaveLength(8);
    expect(await code(intake.history(salesA, r.familyId))).toBe(CommErrorCode.INTAKE_NOT_FOUND);
    expect(await code(intake.history(s.ownerId, r.familyId))).toBe(CommErrorCode.INTAKE_NOT_FOUND);
    expect(await code(intake.history(tsupId, r.familyId))).toBe(CommErrorCode.INTAKE_DENIED);
  });

  it('a family from before PD-42 shows its own lines (a PD-16 enrolment), with no parent record needed', async () => {
    const h = await intake.history(s.managerId, s.familyId);
    expect(h.familyId).toBe(s.familyId);
    expect(Array.isArray(h.entries)).toBe(true);
  });
});
