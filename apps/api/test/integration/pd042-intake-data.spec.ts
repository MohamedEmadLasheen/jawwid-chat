/**
 * PD-42 PR-1 -- the database half of entering families by hand (the migration
 * from Jawwid Core), and PD-30-amendment-carried-over.
 *
 *   1. an intake enrolment: written by the family's own supervisor, one
 *      new_family row per family, idempotent by its id, the parent account set once
 *   2. a supervisor places children only on themself
 *   3. the Sales owner: a Sales member, changed by the Sales manager, never removed
 *   4. one family per parent: the contact keys
 *   5. "their own family" and the Sales switch
 *   6. the carried-over package: the five conditions, the managers, completed
 *      above the total (F1), grace given once, the plan length (F3)
 *   7. the permission key
 *
 * Every refusal is the database's own: these statements are what a legacy
 * writer, or anyone with SQL access, would run. Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { LessonService } from '../../src/lessons/lesson.service';
import { lessonPosition } from '../../src/billing/subscription-reads';
import { buildGraph, seed, truncate, type Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, new PrismaAuditService());
const MIN = 60_000;

let s: Scenario;
let salesId: string;
let otherSalesId: string;
let salesManagerId: string;
let superId: string;
let tsupId: string;

const sql = (q: string, ...args: unknown[]) => g.prisma.$executeRawUnsafe(q, ...args);
async function one<T>(q: string, ...args: unknown[]): Promise<T> {
  const rows = await g.prisma.$queryRawUnsafe<T[]>(q, ...args);
  return rows[0]!;
}

async function staff(id: string, name: string, role: string) {
  await sql(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, $2, $3, true)`, id, name, role);
}

async function department(kind: string, managerId: string | null, members: string[]) {
  const { id } = await one<{ id: string }>(
    `insert into chat.department (kind, display_name, manager_id) values ($1, $1, $2::uuid) returning id::text as id`, kind, managerId,
  );
  for (const m of members) {
    await sql(
      `insert into chat.department_member (staff_id, organization_id, department_id, position)
       values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`, m, id,
    );
  }
  return id;
}

interface Intake { familyId: string; contactId: string; learnerId: string; enrolmentId: string }

/**
 * A family entered by `by`, the way PR-2's intake will write it: the family
 * (owned by its entrant), the parent, the child, then -- for an Operations
 * supervisor -- their own supervision, or -- for a Sales member -- their
 * ownership, and the intake enrolment.
 */
async function intake(by: string, as: 'operations' | 'sales', opts: { teacherId?: string | null; enrolmentId?: string } = {}): Promise<Intake> {
  const enrolmentId = opts.enrolmentId ?? randomUUID();
  return g.prisma.$transaction(async (tx) => {
    const q = <T>(text: string, ...args: unknown[]) => tx.$queryRawUnsafe<T[]>(text, ...args).then((r) => r[0]!);
    const { id: familyId } = await q<{ id: string }>(
      `insert into chat.family (display_name, owner_id, language) values ('family_i', $1::uuid, 'ar') returning id::text as id`, by,
    );
    const { id: contactId } = await q<{ id: string }>(
      `insert into chat.contact (family_id, name, role_preset, can_message, is_active)
       values ($1::uuid, 'parent_i', 'primary_guardian', true, true) returning id::text as id`, familyId,
    );
    if (as === 'sales') {
      await tx.$executeRawUnsafe(
        `insert into chat.family_sales_owner (family_id, organization_id, staff_id, assigned_by)
         values ($1::uuid, chat.default_organization_id(), $2::uuid, $2::uuid)`, familyId, by,
      );
    }
    const teacher = opts.teacherId === undefined ? s.teacherId : opts.teacherId;
    const { id: learnerId } = await q<{ id: string }>(
      `select chat.enrol_learner($1::uuid, 'child_i', $2::uuid, $3::uuid)::text as id`, familyId, teacher, by,
    );
    if (as === 'operations') {
      await tx.$executeRawUnsafe(
        `insert into chat.learner_supervision (learner_id, organization_id, supervisor_id, assigned_by)
         values ($1::uuid, chat.default_organization_id(), $2::uuid, $2::uuid)`, learnerId, by,
      );
    }
    await tx.$executeRawUnsafe(
      `insert into chat.student_enrolment (id, organization_id, family_id, contact_id, learner_ids, origin, kind, assigned_by)
       values ($1::uuid, chat.default_organization_id(), $2::uuid, $3::uuid, array[$4::uuid], 'intake', 'new_family', $5::uuid)`,
      enrolmentId, familyId, contactId, learnerId, by,
    );
    return { familyId, contactId, learnerId, enrolmentId };
  });
}

async function today(): Promise<string> {
  return (await one<{ d: string }>(`select chat.pd030_today()::text as d`)).d;
}

/** A carried-over package, as the intake writes it. */
function carryOver(learnerId: string, by: string, total: number, completed: number, extra: { startsOn?: string; planMonths?: number | null; over?: string | null } = {}) {
  return (async () => sql(
    `insert into chat.learner_subscription (learner_id, organization_id, family_id, plan_months, lessons_included,
       lessons_used_before, over_confirmed_by, starts_on, source, created_by)
     select l.id, l.organization_id, l.family_id, $5, $3, $4, $6::uuid, coalesce($7::date, chat.pd030_today()), 'carried_over', $2::uuid
       from chat.learner l where l.id = $1::uuid`,
    learnerId, by, total, completed, extra.planMonths === undefined ? 3 : extra.planMonths, extra.over ?? null, extra.startsOn ?? null,
  ))();
}

async function voidCarriedOver(learnerId: string, by: string) {
  await sql(
    `update chat.learner_subscription set voided_at = now(), voided_by = $2::uuid, void_reason = 'entered by mistake'
      where learner_id = $1::uuid and source = 'carried_over' and voided_at is null`, learnerId, by,
  );
}

async function access(learnerId: string) {
  return g.prisma.learnerAccess.findUniqueOrThrow({ where: { learnerId } });
}

/** Backdate an intake: a fixture of time passing (the guard stamps assigned_at itself). */
async function enteredDaysAgo(enrolmentId: string, days: number) {
  await g.prisma.$transaction([
    g.prisma.$executeRawUnsafe(`set local session_replication_role = replica`),
    g.prisma.$executeRawUnsafe(
      `update chat.student_enrolment set assigned_at = now() - make_interval(days => $2) where id = $1::uuid`, enrolmentId, days,
    ),
  ]);
}

/**
 * A lesson of the child that took place today (academy date) and was used:
 * the teacher recorded that the student did not attend (PD-30 counts it).
 */
let lessonsMade = 0;
async function usedLesson(learnerId: string) {
  lessonsMade += 1;
  const { since } = await one<{ since: number }>(
    `select extract(epoch from (now() at time zone chat.pd030_zone()) - (chat.pd030_today())::timestamp)::int as since`,
  );
  // Inside today, never two lessons of one teacher at once.
  const back = Math.min(since - 60, 40 * 60) - lessonsMade * 4 * 60;
  if (back < 60) throw new Error('too close to the academy\'s midnight to place a lesson today; rerun');
  const startsAt = new Date(Date.now() - back * 1000);
  const dto = await lessons.schedule(tsupId, { learnerId, startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 3 * MIN).toISOString() });
  await lessons.absence(s.teacherId, dto.id, {});
}

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await sql(`delete from chat.config where key = 'sales.family_scope'`);
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await sql(`delete from chat.config where key = 'sales.family_scope'`);
  await truncate(g.prisma);
  s = await seed(g.prisma);
  salesId = randomUUID();
  otherSalesId = randomUUID();
  salesManagerId = randomUUID();
  superId = randomUUID();
  tsupId = randomUUID();
  await staff(salesId, 'sales_a', 'admin');
  await staff(otherSalesId, 'sales_b', 'admin');
  await staff(salesManagerId, 'sales_m', 'manager');
  await staff(superId, 'super_s', 'super_admin');
  await staff(tsupId, 'tsup_t', 'admin');
  await department('sales', salesManagerId, [salesId, otherSalesId]);
  await department('teachers', null, [tsupId]);
  lessonsMade = 0;
});

describe('1. an intake enrolment', () => {
  it('an Operations supervisor enters their own family: origin intake, no account yet, the child supervised by them', async () => {
    const f = await intake(s.ownerId, 'operations');
    const e = await g.prisma.studentEnrolment.findUniqueOrThrow({ where: { id: f.enrolmentId } });
    expect(e).toMatchObject({ origin: 'intake', kind: 'new_family', lessonId: null, accountId: null, assignedBy: s.ownerId });
    expect(await g.prisma.learnerSupervision.findUnique({ where: { learnerId: f.learnerId } })).toMatchObject({ supervisorId: s.ownerId });
  });

  it('a Sales member enters a family: they own it, and nobody supervises it yet', async () => {
    const f = await intake(salesId, 'sales');
    expect(await g.prisma.familySalesOwner.findUnique({ where: { familyId: f.familyId } })).toMatchObject({ staffId: salesId, assignedBy: salesId });
    expect(await g.prisma.learnerSupervision.findUnique({ where: { learnerId: f.learnerId } })).toBeNull();
  });

  it('a family is entered once: a second new_family row is refused in words', async () => {
    const f = await intake(s.ownerId, 'operations');
    await expect(sql(
      `insert into chat.student_enrolment (organization_id, family_id, contact_id, learner_ids, origin, kind, assigned_by)
       values (chat.default_organization_id(), $1::uuid, $2::uuid, array[$3::uuid], 'intake', 'new_family', $4::uuid)`,
      f.familyId, f.contactId, f.learnerId, s.ownerId,
    )).rejects.toThrow(/already entered/);
  });

  it('a replay with the same id creates nothing (S1: the intake id is the enrolment id)', async () => {
    const f = await intake(s.ownerId, 'operations');
    const replay = await sql(
      `insert into chat.student_enrolment (id, organization_id, family_id, contact_id, learner_ids, origin, kind, assigned_by)
       values ($1::uuid, chat.default_organization_id(), $2::uuid, $3::uuid, array[$4::uuid], 'intake', 'new_family', $5::uuid)
       on conflict (id) do nothing`,
      f.enrolmentId, f.familyId, f.contactId, f.learnerId, s.ownerId,
    );
    expect(replay).toBe(0);
    expect(await g.prisma.studentEnrolment.count({ where: { familyId: f.familyId } })).toBe(1);
  });

  it('nobody else enters a child into a family that is not theirs; a Teachers-department member enters nothing', async () => {
    // family_x is admin_a's (seed); admin_b is an Operations supervisor without it.
    await expect(sql(`select chat.enrol_learner($1::uuid, 'child_x', $2::uuid, $3::uuid)`, s.familyId, s.teacherId, s.otherAdminId))
      .rejects.toThrow(/family's own supervisor/);
    await expect(sql(
      `insert into chat.student_enrolment (organization_id, family_id, contact_id, learner_ids, origin, kind, assigned_by)
       values (chat.default_organization_id(), $1::uuid, $2::uuid, array[$3::uuid], 'intake', 'added_children', $4::uuid)`,
      s.familyId, s.parentId, s.learnerId, s.otherAdminId,
    )).rejects.toThrow(/entered by its own Sales or Operations supervisor/);
    await expect(sql(
      `insert into chat.student_enrolment (organization_id, family_id, contact_id, learner_ids, origin, kind, assigned_by)
       values (chat.default_organization_id(), $1::uuid, $2::uuid, array[$3::uuid], 'intake', 'added_children', $4::uuid)`,
      s.familyId, s.parentId, s.learnerId, tsupId,
    )).rejects.toThrow(/entered by its own Sales or Operations supervisor/);
    // ...while the family's own supervisor adds children to it.
    await sql(
      `insert into chat.student_enrolment (organization_id, family_id, contact_id, learner_ids, origin, kind, assigned_by)
       values (chat.default_organization_id(), $1::uuid, $2::uuid, array[$3::uuid], 'intake', 'added_children', $4::uuid)`,
      s.familyId, s.parentId, s.learnerId, s.ownerId,
    );
  });

  it('a child may be entered without a teacher yet', async () => {
    const f = await intake(s.ownerId, 'operations', { teacherId: null });
    expect(await g.prisma.learner.findUniqueOrThrow({ where: { id: f.learnerId } })).toMatchObject({ teacherId: null });
  });

  it('the parent account is set once, and must be the parent\'s own; nothing else changes', async () => {
    const f = await intake(s.ownerId, 'operations');
    const { id: accountId } = await one<{ id: string }>(
      `insert into chat.account (subject, kind, status, is_active) values ($1, 'family', 'active', true) returning id::text as id`,
      `pd42-${randomUUID()}@qa.jawwid.test`,
    );
    await expect(sql(`update chat.student_enrolment set account_id = $2::uuid where id = $1::uuid`, f.enrolmentId, accountId))
      .rejects.toThrow(/parent's own/);
    await sql(`update chat.contact set account_id = $2::uuid where id = $1::uuid`, f.contactId, accountId);
    await sql(`update chat.student_enrolment set account_id = $2::uuid where id = $1::uuid`, f.enrolmentId, accountId);
    await expect(sql(`update chat.student_enrolment set account_id = null where id = $1::uuid`, f.enrolmentId))
      .rejects.toThrow(/set once/);
    await expect(sql(`update chat.student_enrolment set assigned_by = $2::uuid where id = $1::uuid`, f.enrolmentId, s.managerId))
      .rejects.toThrow(/only the family's group, or a missing parent account/);
  });

  it('an intake names no trial, and a trial enrolment always does', async () => {
    const f = await intake(s.ownerId, 'operations');
    await expect(sql(`update chat.student_enrolment set lesson_id = gen_random_uuid() where id = $1::uuid`, f.enrolmentId))
      .rejects.toThrow();
    await expect(sql(
      `insert into chat.student_enrolment (organization_id, family_id, contact_id, learner_ids, origin, kind, assigned_by)
       values (chat.default_organization_id(), $1::uuid, $2::uuid, array[$3::uuid], 'trial', 'added_children', $4::uuid)`,
      s.familyId, s.parentId, s.learnerId, s.managerId,
    )).rejects.toThrow(/names a live subscription form/);
  });
});

describe('2. a supervisor places children only on themself', () => {
  it('admin_a cannot place family_x\'s child on admin_b; the Operations manager can; on themself is fine', async () => {
    await expect(sql(
      `update chat.learner_supervision set supervisor_id = $2::uuid, assigned_by = $3::uuid where learner_id = $1::uuid`,
      s.learnerId, s.otherAdminId, s.ownerId,
    )).rejects.toThrow(/places children only on themself/);
    await sql(
      `update chat.learner_supervision set supervisor_id = $2::uuid, assigned_by = $3::uuid where learner_id = $1::uuid`,
      s.secondLearnerId, s.ownerId, s.ownerId,
    );
    await sql(`delete from chat.conversation_learner where learner_id = $1::uuid`, s.learnerId);
    await sql(
      `update chat.learner_supervision set supervisor_id = $2::uuid, assigned_by = $3::uuid where learner_id = $1::uuid`,
      s.learnerId, s.otherAdminId, s.managerId,
    );
  });
});

describe('3. the Sales owner', () => {
  it('is a live Sales member; only the Sales manager (or the super admin) changes it; it is never removed', async () => {
    const f = await intake(salesId, 'sales');
    await expect(sql(`update chat.family_sales_owner set staff_id = $2::uuid, assigned_by = $2::uuid where family_id = $1::uuid`, f.familyId, s.ownerId))
      .rejects.toThrow(/live member of the Sales department/);
    await expect(sql(`update chat.family_sales_owner set staff_id = $2::uuid, assigned_by = $3::uuid where family_id = $1::uuid`, f.familyId, otherSalesId, salesId))
      .rejects.toThrow(/changed by the Sales manager or the super admin/);
    await sql(`update chat.family_sales_owner set staff_id = $2::uuid, assigned_by = $3::uuid where family_id = $1::uuid`, f.familyId, otherSalesId, salesManagerId);
    await sql(`update chat.family_sales_owner set staff_id = $2::uuid, assigned_by = $3::uuid where family_id = $1::uuid`, f.familyId, salesId, superId);
    await expect(sql(`delete from chat.family_sales_owner where family_id = $1::uuid`, f.familyId)).rejects.toThrow(/never removed/);
  });

  it('a Sales member cannot make someone else the owner of a family on entering it', async () => {
    await expect(sql(
      `insert into chat.family_sales_owner (family_id, organization_id, staff_id, assigned_by)
       values ($1::uuid, chat.default_organization_id(), $2::uuid, $3::uuid)`, s.familyId, otherSalesId, salesId,
    )).rejects.toThrow(/changed by the Sales manager or the super admin/);
  });
});

describe('4. one family per parent', () => {
  const key = (n: number) => n.toString(16).padStart(64, '0');

  it('a second family with the same key is refused in words; a malformed key never lands', async () => {
    const a = await intake(s.ownerId, 'operations');
    const b = await intake(salesId, 'sales');
    await sql(`insert into chat.family_contact_key (key_hash, organization_id, family_id, kind) values ($1, chat.default_organization_id(), $2::uuid, 'phone')`, key(1), a.familyId);
    await expect(sql(`insert into chat.family_contact_key (key_hash, organization_id, family_id, kind) values ($1, chat.default_organization_id(), $2::uuid, 'phone')`, key(1), b.familyId))
      .rejects.toThrow(/already in Chat/);
    await expect(sql(`insert into chat.family_contact_key (key_hash, organization_id, family_id, kind) values ('+20 100 000 0000', chat.default_organization_id(), $1::uuid, 'phone')`, b.familyId))
      .rejects.toThrow();
    await expect(sql(`update chat.family_contact_key set family_id = $2::uuid where key_hash = $1`, key(1), b.familyId))
      .rejects.toThrow(/never changes/);
  });
});

describe('5. their own family, and the Sales switch', () => {
  it('owners and managers own it; another Sales member handles it only while the switch is "all"', async () => {
    const f = await intake(salesId, 'sales');
    const owns = async (who: string) => (await one<{ ok: boolean }>(`select chat.staff_owns_family($1::uuid, $2::uuid) as ok`, who, f.familyId)).ok;
    const handles = async (who: string) => (await one<{ ok: boolean }>(`select chat.staff_may_handle_family($1::uuid, $2::uuid) as ok`, who, f.familyId)).ok;
    expect(await owns(salesId)).toBe(true);
    expect(await owns(salesManagerId)).toBe(true);
    expect(await owns(s.managerId)).toBe(true);
    expect(await owns(superId)).toBe(true);
    expect(await owns(otherSalesId)).toBe(false);
    expect(await owns(s.ownerId)).toBe(false);
    expect(await owns(tsupId)).toBe(false);

    expect(await handles(otherSalesId)).toBe(true);
    await sql(`insert into chat.config (key, value) values ('sales.family_scope', to_jsonb('own'::text))`);
    expect(await handles(otherSalesId)).toBe(false);
    expect(await handles(salesId)).toBe(true);
    expect(await handles(salesManagerId)).toBe(true);
    expect(await handles(tsupId)).toBe(false);
  });
});

describe('6. the carried-over package (PD-30-amendment-carried-over)', () => {
  it('the supervisor who entered the child carries it over: 20 with 12 completed leaves 8, and "Lesson 13 of 20"', async () => {
    const f = await intake(s.ownerId, 'operations');
    await carryOver(f.learnerId, s.ownerId, 20, 12);
    expect(await access(f.learnerId)).toMatchObject({ state: 'open', balance: 8 });
    expect(await lessonPosition(g.prisma, f.learnerId)).toEqual({ n: 13, m: 20 });
    // Nothing that means money appears.
    expect(await g.prisma.paymentRequest.count({ where: { learnerId: f.learnerId } })).toBe(0);
    expect(await g.prisma.familyInstalment.count({ where: { familyId: f.familyId } })).toBe(0);
  });

  it('a lesson used in Chat counts against it: 7 left, "Lesson 14 of 20"', async () => {
    const f = await intake(s.ownerId, 'operations');
    await carryOver(f.learnerId, s.ownerId, 20, 12);
    await usedLesson(f.learnerId);
    expect(await access(f.learnerId)).toMatchObject({ balance: 7 });
    expect(await lessonPosition(g.prisma, f.learnerId)).toEqual({ n: 14, m: 20 });
  });

  it('a Sales member who entered the child carries it over too', async () => {
    const f = await intake(salesId, 'sales');
    await carryOver(f.learnerId, salesId, 24, 0, { planMonths: 3 });
    expect(await access(f.learnerId)).toMatchObject({ balance: 24 });
  });

  it('condition 1: a child not entered through the form is refused to a supervisor', async () => {
    await expect(carryOver(s.learnerId, s.ownerId, 20, 12)).rejects.toThrow(/supervisor who entered the child/);
  });

  it('condition 2: another supervisor, even one who handles the family, is refused', async () => {
    const f = await intake(s.ownerId, 'operations');
    await expect(carryOver(f.learnerId, s.otherAdminId, 20, 12)).rejects.toThrow(/supervisor who entered the child/);
    const g2 = await intake(salesId, 'sales');
    await expect(carryOver(g2.learnerId, otherSalesId, 20, 12)).rejects.toThrow(/supervisor who entered the child/);
  });

  it('condition 3: on day 15 the supervisor is refused; a manager may still', async () => {
    const f = await intake(s.ownerId, 'operations');
    const { d } = await one<{ d: string }>(`select (assigned_at at time zone chat.pd030_zone())::date::text as d from chat.student_enrolment where id = $1::uuid`, f.enrolmentId);
    await enteredDaysAgo(f.enrolmentId, 15);
    const { day } = await one<{ day: string }>(`select (assigned_at at time zone chat.pd030_zone())::date::text as day from chat.student_enrolment where id = $1::uuid`, f.enrolmentId);
    expect(day).not.toBe(d);
    await expect(carryOver(f.learnerId, s.ownerId, 20, 12, { startsOn: day })).rejects.toThrow(/within 14 days/);
    await carryOver(f.learnerId, s.managerId, 20, 12, { startsOn: day });
  });

  it('condition 4: never on top of another package -- for a manager too', async () => {
    const f = await intake(s.ownerId, 'operations');
    await sql(
      `insert into chat.learner_subscription (learner_id, organization_id, family_id, lessons_included, starts_on, source, created_by, note)
       select id, organization_id, family_id, 8, chat.pd030_today(), 'staff', $2::uuid, 'agreed with the owner' from chat.learner where id = $1::uuid`,
      f.learnerId, s.managerId,
    );
    await expect(carryOver(f.learnerId, s.ownerId, 20, 12)).rejects.toThrow(/no other package/);
    await expect(carryOver(f.learnerId, s.managerId, 20, 12)).rejects.toThrow(/no other package/);
  });

  it('condition 5: an entrant who no longer owns the family (moved to another supervisor) is refused', async () => {
    const f = await intake(s.ownerId, 'operations');
    await sql(
      `update chat.learner_supervision set supervisor_id = $2::uuid, assigned_by = $3::uuid where learner_id = $1::uuid`,
      f.learnerId, s.otherAdminId, s.managerId,
    );
    await expect(carryOver(f.learnerId, s.ownerId, 20, 12)).rejects.toThrow(/supervisor who entered the child/);
  });

  it('condition 5: an entrant who has left Sales holds no key and owns nothing any more', async () => {
    const f = await intake(salesId, 'sales');
    await sql(`delete from chat.department_member where staff_id = $1::uuid`, salesId);
    await expect(carryOver(f.learnerId, salesId, 20, 12)).rejects.toThrow(/supervisor who entered the child/);
  });

  it('the three managers outside the five conditions (a child already in Chat)', async () => {
    const t = await today();
    await carryOver(s.learnerId, s.managerId, 20, 12, { startsOn: t });
    await voidCarriedOver(s.learnerId, s.managerId);
    await carryOver(s.learnerId, salesManagerId, 20, 12, { startsOn: t });
    await voidCarriedOver(s.learnerId, salesManagerId);
    await carryOver(s.learnerId, superId, 20, 12, { startsOn: t });
  });

  it('it starts on the day the child was entered, never another', async () => {
    const f = await intake(s.ownerId, 'operations');
    const { d } = await one<{ d: string }>(`select (chat.pd030_today() - 1)::text as d`);
    await expect(carryOver(f.learnerId, s.ownerId, 20, 12, { startsOn: d })).rejects.toThrow(/starts on the day the child was entered/);
  });

  it('F1: completed above the total needs a manager\'s confirmation; then the grace is counted once (21 of 20 -> one left)', async () => {
    const f = await intake(s.ownerId, 'operations');
    await expect(carryOver(f.learnerId, s.ownerId, 20, 21)).rejects.toThrow(/learner_subscription_over_is_confirmed/);
    await expect(carryOver(f.learnerId, s.ownerId, 20, 21, { over: salesId })).rejects.toThrow(/confirmed by the super admin, the Operations Manager or the Sales Manager/);
    await expect(carryOver(f.learnerId, s.ownerId, 20, 12, { over: s.managerId })).rejects.toThrow(/learner_subscription_over_is_confirmed/);
    await carryOver(f.learnerId, s.ownerId, 20, 21, { over: s.managerId });
    expect(await access(f.learnerId)).toMatchObject({ state: 'grace', balance: -1, graceLeft: 1 });
    // Exactly as entered: nothing was clamped.
    expect(await g.prisma.learnerSubscription.findFirstOrThrow({ where: { learnerId: f.learnerId } }))
      .toMatchObject({ lessonsIncluded: 20, lessonsUsedBefore: 21, overConfirmedBy: s.managerId, planMonths: 3 });
  });

  it('grace is given once: a used-up package used its grace; a supervisor cannot re-add more lessons, a manager can', async () => {
    const f = await intake(s.ownerId, 'operations');
    await carryOver(f.learnerId, s.ownerId, 20, 20);
    expect(await access(f.learnerId)).toMatchObject({ state: 'grace', balance: 0, graceLeft: 2 });
    await usedLesson(f.learnerId);
    await usedLesson(f.learnerId);
    expect(await access(f.learnerId)).toMatchObject({ state: 'locked', balance: -2, graceLeft: 0 });

    await voidCarriedOver(f.learnerId, s.ownerId);
    await expect(carryOver(f.learnerId, s.ownerId, 20, 18)).rejects.toThrow(/supervisor who entered the child/);
    // The same numbers again change nothing.
    await carryOver(f.learnerId, s.ownerId, 20, 20);
    expect(await access(f.learnerId)).toMatchObject({ state: 'locked', balance: -2, graceLeft: 0 });
    // A manager may correct it upwards.
    await voidCarriedOver(f.learnerId, s.managerId);
    await carryOver(f.learnerId, s.managerId, 20, 18);
    // 20 - 18 - 2 used: the manager's correction leaves the package used up again, in grace.
    expect(await access(f.learnerId)).toMatchObject({ state: 'grace', balance: 0, graceLeft: 2 });
  });

  it('a re-add with fewer or the same lessons left needs no manager before any lesson is used', async () => {
    const f = await intake(s.ownerId, 'operations');
    await carryOver(f.learnerId, s.ownerId, 20, 12);
    await voidCarriedOver(f.learnerId, s.ownerId);
    await carryOver(f.learnerId, s.ownerId, 20, 10);
    expect(await access(f.learnerId)).toMatchObject({ balance: 10 });
  });

  it('F3: any plan length from 1 to 24 months for a carried-over package, and PD-30\'s set for every other source', async () => {
    const f = await intake(s.ownerId, 'operations');
    await carryOver(f.learnerId, s.ownerId, 16, 4, { planMonths: 2 });
    expect(await g.prisma.learnerSubscription.findFirstOrThrow({ where: { learnerId: f.learnerId } })).toMatchObject({ planMonths: 2 });
    await expect(sql(
      `insert into chat.learner_subscription (learner_id, organization_id, family_id, plan_months, lessons_included, starts_on, source, created_by, note)
       select id, organization_id, family_id, 2, 8, chat.pd030_today(), 'staff', $2::uuid, 'agreed' from chat.learner where id = $1::uuid`,
      s.learnerId, s.managerId,
    )).rejects.toThrow(/learner_subscription_plan_months_check/);
    const g2 = await intake(s.ownerId, 'operations');
    await expect(carryOver(g2.learnerId, s.ownerId, 16, 4, { planMonths: 25 })).rejects.toThrow(/learner_subscription_plan_months_check/);
  });

  it('a carried-over row never changes: void it and add another; lessons_used_before is the carried-over source\'s only', async () => {
    const f = await intake(s.ownerId, 'operations');
    await carryOver(f.learnerId, s.ownerId, 20, 12);
    await expect(sql(`update chat.learner_subscription set lessons_used_before = 2 where learner_id = $1::uuid`, f.learnerId))
      .rejects.toThrow(/never changes/);
    await expect(sql(
      `insert into chat.learner_subscription (learner_id, organization_id, family_id, lessons_included, lessons_used_before, starts_on, source, created_by, note)
       select id, organization_id, family_id, 8, 2, chat.pd030_today(), 'staff', $2::uuid, 'agreed' from chat.learner where id = $1::uuid`,
      s.learnerId, s.managerId,
    )).rejects.toThrow(/learner_subscription_used_before_is_carried_over/);
  });
});

describe('7. the permission key', () => {
  it('subscriptions.carry_over is in the catalogue and held by Operations and Sales supervisors and managers only', async () => {
    const has = async (who: string) => (await one<{ ok: boolean }>(`select chat.staff_has_permission($1::uuid, 'subscriptions.carry_over') as ok`, who)).ok;
    expect(await has(s.ownerId)).toBe(true);
    expect(await has(s.managerId)).toBe(true);
    expect(await has(salesId)).toBe(true);
    expect(await has(salesManagerId)).toBe(true);
    expect(await has(superId)).toBe(true);
    expect(await has(tsupId)).toBe(false);
    expect(await one<{ risk: string }>(`select risk from chat.permission where key = 'subscriptions.carry_over'`)).toEqual({ risk: 'finance' });
  });
});
