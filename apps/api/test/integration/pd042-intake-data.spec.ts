/**
 * PD-42 PR-1 -- the database half of entering families by hand (the migration
 * from Jawwid Core), and PD-30-amendment-carried-over.
 *
 *   1. an intake enrolment: written by the family's own supervisor, listing
 *      only the children it creates (never an existing one), one new_family
 *      row per family, with a contact key, idempotent by its id, the parent
 *      account set once
 *   2. who places a child on a supervisor
 *   3. the Sales owner: set by the Sales manager; a Sales member owns only the
 *      family they are entering; never removed
 *   4. one family per parent: the contact keys
 *   5. "their own family" (not a covering backup) and the Sales switch
 *   6. the carried-over package: the five conditions, the managers, completed
 *      above the total (F1), grace given once, voids, the plan length (F3)
 *   7. the permission key
 *
 * Every refusal is the database's own: these statements are what a legacy
 * writer, or anyone with SQL access, would run. Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { LessonService } from '../../src/lessons/lesson.service';
import { lessonPosition } from '../../src/billing/subscription-reads';
import { contactKeyHash } from '../../src/new-students/contact-key';
import { activateBackup, buildGraph, seed, truncate, type Scenario } from './harness';

process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';

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
 * A family entered by `by`, the way PR-2's intake will write it, in one
 * transaction: the family (chat.create_intake_family), the parent, -- for a
 * Sales member -- their ownership, the parent's contact key, the child, --
 * for an Operations supervisor -- their own supervision, and the intake
 * enrolment (which records who entered the child).
 */
async function intake(
  by: string,
  as: 'operations' | 'sales',
  opts: { teacherId?: string | null; enrolmentId?: string; key?: boolean } = {},
): Promise<Intake> {
  const enrolmentId = opts.enrolmentId ?? randomUUID();
  return g.prisma.$transaction(async (tx) => {
    const q = <T>(text: string, ...args: unknown[]) => tx.$queryRawUnsafe<T[]>(text, ...args).then((r) => r[0]!);
    const { id: familyId } = await q<{ id: string }>(`select chat.create_intake_family('family_i', $1::uuid)::text as id`, by);
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
    if (opts.key !== false) {
      await tx.$executeRawUnsafe(
        `insert into chat.family_contact_key (organization_id, key_hash, family_id, kind, created_by)
         values (chat.default_organization_id(), $1, $2::uuid, 'phone', $3::uuid)`,
        contactKeyHash('phone', `+2010${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`), familyId, by,
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

/** A further child entered into a family that is `by`'s own: Add child (kind added_children). */
async function addChild(by: string, familyId: string, contactId: string): Promise<string> {
  return g.prisma.$transaction(async (tx) => {
    const [{ id }] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `select chat.enrol_learner($1::uuid, 'child_more', $2::uuid, $3::uuid)::text as id`, familyId, s.teacherId, by,
    );
    await tx.$executeRawUnsafe(
      `insert into chat.learner_supervision (learner_id, organization_id, supervisor_id, assigned_by)
       values ($1::uuid, chat.default_organization_id(), $2::uuid, $2::uuid)`, id, by,
    );
    await tx.$executeRawUnsafe(
      `insert into chat.student_enrolment (organization_id, family_id, contact_id, learner_ids, origin, kind, assigned_by)
       values (chat.default_organization_id(), $1::uuid, $2::uuid, array[$3::uuid], 'intake', 'added_children', $4::uuid)`,
      familyId, contactId, id, by,
    );
    return id;
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
      `update chat.student_enrolment set assigned_at = now() - make_interval(days => $2::int) where id = $1::uuid`, enrolmentId, days,
    ),
    g.prisma.$executeRawUnsafe(
      `update chat.learner_intake set entered_at = now() - make_interval(days => $2::int) where enrolment_id = $1::uuid`, enrolmentId, days,
    ),
  ]);
}

/**
 * The academy's zone (chat.config 'schedule.timezone', read by
 * chat.pd030_zone()) pinned for this file to one where it is about noon right
 * now, so "a lesson today" never depends on the hour CI runs at: with Cairo it
 * failed G-19 whenever a run fell in the first minutes after Cairo's midnight
 * (2026-10-28, ~21:00 UTC, on #251 and #252). Restored after the file.
 */
let zoneBefore: unknown = undefined;
async function pinAcademyNoon() {
  const offset = 12 - new Date().getUTCHours(); // -11 .. +12: local time is 12:00-12:59 there
  // Etc/GMT names count the other way: Etc/GMT-3 is UTC+3.
  const zone = offset === 0 ? 'Etc/GMT' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;
  await sql(
    `insert into chat.config (key, value) values ('schedule.timezone', to_jsonb($1::text))
     on conflict (key) do update set value = excluded.value`, zone,
  );
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
  // The zone is pinned to about noon (pinAcademyNoon): there is always room today.
  if (back < 60) throw new Error(`no room left today for lesson ${lessonsMade} (since midnight: ${since}s); the zone pin did not hold`);
  const startsAt = new Date(Date.now() - back * 1000);
  const dto = await lessons.schedule(tsupId, { learnerId, startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 3 * MIN).toISOString() });
  await lessons.absence(s.teacherId, dto.id, {});
}

beforeAll(async () => {
  await g.prisma.$connect();
  const row = await g.prisma.config.findUnique({ where: { key: 'schedule.timezone' } });
  zoneBefore = row ? row.value : null;
});
afterAll(async () => {
  await sql(`delete from chat.config where key = 'sales.family_scope'`);
  if (zoneBefore === null) {
    await sql(`delete from chat.config where key = 'schedule.timezone'`);
  } else if (zoneBefore !== undefined) {
    await sql(`update chat.config set value = $1::jsonb where key = 'schedule.timezone'`, JSON.stringify(zoneBefore));
  }
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await sql(`delete from chat.config where key = 'sales.family_scope'`);
  await truncate(g.prisma);
  await pinAcademyNoon();
  s = await seed(g.prisma);
  salesId = randomUUID();
  otherSalesId = randomUUID();
  salesManagerId = randomUUID();
  superId = randomUUID();
  tsupId = randomUUID();
  await staff(salesId, 'sales_a', 'admin');
  await staff(otherSalesId, 'sales_b', 'admin');
  await staff(salesManagerId, 'sales_m', 'manager');
  // super_admin exists only through the bootstrap gate (20261013120000).
  await g.prisma.$transaction([
    g.prisma.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`),
    g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'super_s', 'super_admin', true)`, superId),
  ]);
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
    // Who entered the child, recorded by the intake that created it (review P1-A).
    expect(await g.prisma.learnerIntake.findUnique({ where: { learnerId: f.learnerId } }))
      .toMatchObject({ enrolmentId: f.enrolmentId, enteredBy: s.ownerId, familyId: f.familyId });
  });

  it('a new family is entered with its parent\'s contact key', async () => {
    await expect(intake(s.ownerId, 'operations', { key: false })).rejects.toThrow(/entered with its parent's e-mail or number/);
  });

  it('who entered a child is written by its intake only, and never changes', async () => {
    const f = await intake(s.ownerId, 'operations');
    await expect(sql(
      `insert into chat.learner_intake (learner_id, organization_id, family_id, enrolment_id, entered_by, entered_at)
       values ($1::uuid, chat.default_organization_id(), $2::uuid, $3::uuid, $4::uuid, now())`,
      s.learnerId, s.familyId, f.enrolmentId, s.ownerId,
    )).rejects.toThrow(/recorded by their intake enrolment only/);
    await expect(sql(`update chat.learner_intake set entered_at = now() where learner_id = $1::uuid`, f.learnerId)).rejects.toThrow(/never changes/);
    await expect(sql(`delete from chat.learner_intake where learner_id = $1::uuid`, f.learnerId)).rejects.toThrow(/never removed/);
  });

  it('Add child: the family\'s own supervisor enters a further child into it', async () => {
    const f = await intake(s.ownerId, 'operations');
    const more = await addChild(s.ownerId, f.familyId, f.contactId);
    expect(await g.prisma.studentEnrolment.count({ where: { familyId: f.familyId } })).toBe(2);
    expect(await g.prisma.learnerIntake.findUnique({ where: { learnerId: more } })).toMatchObject({ enteredBy: s.ownerId });
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
    await expect(sql(`select chat.create_intake_family('family_t', $1::uuid)`, tsupId)).rejects.toThrow(/entered by a Sales or Operations supervisor/);
  });

  it('an existing child is never listed by an intake -- not even by the family\'s own supervisor (review P1-A)', async () => {
    // learner_l exists (seed: a family from Core / PD-16); admin_a supervises it.
    await expect(sql(
      `insert into chat.student_enrolment (organization_id, family_id, contact_id, learner_ids, origin, kind, assigned_by)
       values (chat.default_organization_id(), $1::uuid, $2::uuid, array[$3::uuid], 'intake', 'added_children', $4::uuid)`,
      s.familyId, s.parentId, s.learnerId, s.ownerId,
    )).rejects.toThrow(/existing child is never entered again/);
    // ...so no intake record exists for it, and a supervisor's carry-over is refused.
    expect(await g.prisma.learnerIntake.findUnique({ where: { learnerId: s.learnerId } })).toBeNull();
    await expect(carryOver(s.learnerId, s.ownerId, 20, 12, { startsOn: await today() })).rejects.toThrow(/supervisor who entered the child/);
    // A child entered by an earlier intake is not listed again either.
    const f = await intake(s.ownerId, 'operations');
    await expect(sql(
      `insert into chat.student_enrolment (organization_id, family_id, contact_id, learner_ids, origin, kind, assigned_by)
       values (chat.default_organization_id(), $1::uuid, $2::uuid, array[$3::uuid], 'intake', 'added_children', $4::uuid)`,
      f.familyId, f.contactId, f.learnerId, s.ownerId,
    )).rejects.toThrow(/existing child is never entered again/);
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

describe('2. who places a child on a supervisor', () => {
  it('only the Operations manager moves a child; a supervisor never takes an existing child, not even onto themself', async () => {
    await expect(sql(
      `update chat.learner_supervision set supervisor_id = $2::uuid, assigned_by = $3::uuid where learner_id = $1::uuid`,
      s.learnerId, s.otherAdminId, s.ownerId,
    )).rejects.toThrow(/anyone else is placed by the Operations manager/);
    await expect(sql(
      `update chat.learner_supervision set supervisor_id = $2::uuid, assigned_by = $2::uuid where learner_id = $1::uuid`,
      s.learnerId, s.otherAdminId,
    )).rejects.toThrow(/anyone else is placed by the Operations manager/);
    await sql(`delete from chat.conversation_learner where learner_id = $1::uuid`, s.learnerId);
    await sql(
      `update chat.learner_supervision set supervisor_id = $2::uuid, assigned_by = $3::uuid where learner_id = $1::uuid`,
      s.learnerId, s.otherAdminId, s.managerId,
    );
  });

  it('a supervision always names its assigner; a manager of another department is not the Operations manager', async () => {
    const teachersManager = randomUUID();
    await staff(teachersManager, 'tmgr_t', 'manager');
    await sql(`update chat.department set manager_id = $1::uuid where kind = 'teachers'`, teachersManager);
    await expect(sql(
      `update chat.learner_supervision set supervisor_id = $2::uuid, assigned_by = null where learner_id = $1::uuid`,
      s.learnerId, s.otherAdminId,
    )).rejects.toThrow(/names who assigned it/);
    await expect(sql(
      `update chat.learner_supervision set supervisor_id = $2::uuid, assigned_by = $3::uuid where learner_id = $1::uuid`,
      s.learnerId, s.otherAdminId, teachersManager,
    )).rejects.toThrow(/anyone else is placed by the Operations manager/);
  });

  it('the academy\'s own import opens chat.syncing_supervision for its statement only, names its source, and is audited', async () => {
    await sql(`delete from chat.conversation_learner where learner_id = $1::uuid`, s.learnerId);
    await expect(g.prisma.$transaction([
      g.prisma.$executeRawUnsafe(`select set_config('chat.syncing_supervision', 'on', true)`),
      g.prisma.$executeRawUnsafe(
        `update chat.learner_supervision set supervisor_id = $2::uuid, assigned_by = null where learner_id = $1::uuid`, s.learnerId, s.otherAdminId,
      ),
    ])).rejects.toThrow(/names its source/);
    await g.prisma.$transaction([
      g.prisma.$executeRawUnsafe(`select set_config('chat.syncing_supervision', 'on', true)`),
      g.prisma.$executeRawUnsafe(`select set_config('chat.syncing_supervision_source', 'pd042 spec: the import gate', true)`),
      g.prisma.$executeRawUnsafe(
        `update chat.learner_supervision set supervisor_id = $2::uuid, assigned_by = null where learner_id = $1::uuid`, s.learnerId, s.otherAdminId,
      ),
    ]);
    expect(await g.prisma.auditLog.findFirst({ where: { action: 'learner.supervision_imported', entityId: s.learnerId } }))
      .toMatchObject({ reason: 'academy import: pd042 spec: the import gate', before: { supervisorId: s.ownerId }, after: { supervisorId: s.otherAdminId, source: 'pd042 spec: the import gate' } });
    await expect(sql(
      `update chat.learner_supervision set supervisor_id = $2::uuid, assigned_by = null where learner_id = $1::uuid`, s.learnerId, s.ownerId,
    )).rejects.toThrow(/names who assigned it/);
  });
});

describe('3. the Sales owner', () => {
  it('is a live Sales member; only the Sales manager (or the super admin) changes it; it is never removed', async () => {
    const f = await intake(salesId, 'sales');
    await expect(sql(`update chat.family_sales_owner set staff_id = $2::uuid, assigned_by = $2::uuid where family_id = $1::uuid`, f.familyId, s.ownerId))
      .rejects.toThrow(/live member of the Sales department/);
    await expect(sql(`update chat.family_sales_owner set staff_id = $2::uuid, assigned_by = $3::uuid where family_id = $1::uuid`, f.familyId, otherSalesId, salesId))
      .rejects.toThrow(/set by the Sales manager or the super admin/);
    await sql(`update chat.family_sales_owner set staff_id = $2::uuid, assigned_by = $3::uuid where family_id = $1::uuid`, f.familyId, otherSalesId, salesManagerId);
    await sql(`update chat.family_sales_owner set staff_id = $2::uuid, assigned_by = $3::uuid where family_id = $1::uuid`, f.familyId, salesId, superId);
    await expect(sql(`delete from chat.family_sales_owner where family_id = $1::uuid`, f.familyId)).rejects.toThrow(/never removed/);
  });

  it('a Sales member never claims a family that already exists (a Core family), nor names someone else (review P1-B)', async () => {
    await expect(sql(
      `insert into chat.family_sales_owner (family_id, organization_id, staff_id, assigned_by)
       values ($1::uuid, chat.default_organization_id(), $2::uuid, $2::uuid)`, s.familyId, salesId,
    )).rejects.toThrow(/a Sales member owns only a family they are entering/);
    await expect(sql(
      `insert into chat.family_sales_owner (family_id, organization_id, staff_id, assigned_by)
       values ($1::uuid, chat.default_organization_id(), $2::uuid, $3::uuid)`, s.familyId, otherSalesId, salesId,
    )).rejects.toThrow(/set by the Sales manager or the super admin/);
    // The Sales manager may give the Core family its owner.
    await sql(
      `insert into chat.family_sales_owner (family_id, organization_id, staff_id, assigned_by)
       values ($1::uuid, chat.default_organization_id(), $2::uuid, $3::uuid)`, s.familyId, salesId, salesManagerId,
    );
  });
});

describe('4. one family per parent', () => {
  it('a second family with the same key is refused in words; a malformed key never lands; a key is never edited or removed', async () => {
    const a = await intake(s.ownerId, 'operations');
    const b = await intake(salesId, 'sales');
    const key = contactKeyHash('email', 'parent.same@example.test');
    await sql(`insert into chat.family_contact_key (organization_id, key_hash, family_id, kind) values (chat.default_organization_id(), $1, $2::uuid, 'email')`, key, a.familyId);
    await expect(sql(`insert into chat.family_contact_key (organization_id, key_hash, family_id, kind) values (chat.default_organization_id(), $1, $2::uuid, 'email')`, key, b.familyId))
      .rejects.toThrow(/already in Chat/);
    await expect(sql(`insert into chat.family_contact_key (organization_id, key_hash, family_id, kind) values (chat.default_organization_id(), 'parent.same@example.test', $1::uuid, 'email')`, b.familyId))
      .rejects.toThrow();
    await expect(sql(`update chat.family_contact_key set family_id = $2::uuid where key_hash = $1`, key, b.familyId)).rejects.toThrow(/never changes/);
    await expect(sql(`delete from chat.family_contact_key where key_hash = $1`, key)).rejects.toThrow(/never removed while its family exists/);
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

  it('the request role keeps every write: the guards run as their owner, and chat_app executes none of them (G-19 on #202)', async () => {
    const guards = await g.prisma.$queryRawUnsafe<Array<{ fn: string; definer: boolean; pinned: boolean; app: boolean }>>(`
      select p.proname::text as fn, p.prosecdef as definer,
             exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') as pinned,
             has_function_privilege('chat_app', p.oid, 'EXECUTE') as app
        from pg_trigger t join pg_proc p on p.oid = t.tgfoid
       where t.tgname = 'zz_pd042_sales_scope'
       order by 1`);
    expect(guards).toHaveLength(8);
    expect(guards.filter((x) => !x.definer || !x.pinned || x.app)).toEqual([]);
    const helpers = await g.prisma.$queryRawUnsafe<Array<{ app: boolean }>>(`
      select has_function_privilege('chat_app', f, 'EXECUTE') as app
        from unnest(array['chat.sales_scope_refuses(uuid, uuid)', 'chat.pd042_acting_staff()']) f`);
    expect(helpers.map((x) => x.app)).toEqual([false, false]);

    // An ordinary staff write on the request role, with the switch at 'own'
    // and nobody named as the acting Sales member: as before PD-42.
    await sql(`insert into chat.config (key, value) values ('sales.family_scope', to_jsonb('own'::text))`);
    const account = randomUUID();
    const subject = `pd042_app_${account.slice(0, 8)}@example.test`;
    await sql(`insert into chat.account (id, subject, kind) values ($1::uuid, $2, 'staff')`, account, subject);
    await sql(`update chat.staff set account_id = $1::uuid where id = $2::uuid`, account, s.ownerId);
    const ROLLBACK = new Error('rollback');
    let updated: number | string = 'not run';
    await g.prisma
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`set local role chat_app`);
        await tx.$executeRawUnsafe(`select set_config('chat.actor_subject', $1, true)`, subject);
        await tx.$executeRawUnsafe(`select set_config('chat.actor_organization', chat.default_organization_id()::text, true)`);
        updated = await tx
          .$executeRawUnsafe(`update chat.family set language = 'en' where id = $1::uuid`, s.familyId)
          .catch((e: Error) => e.message);
        throw ROLLBACK;
      })
      .catch((e: unknown) => {
        if (e !== ROLLBACK) throw e;
      });
    expect(updated).toBe(1);
  });

  it('a covering backup reaches the family but does not own it (review P2)', async () => {
    await activateBackup(g.prisma, s.ownerId, s.otherAdminId);
    expect((await one<{ basis: string | null }>(`select chat.staff_reaches_family($1::uuid, $2::uuid) as basis`, s.otherAdminId, s.familyId)).basis).toBe('backup');
    expect((await one<{ ok: boolean }>(`select chat.staff_owns_family($1::uuid, $2::uuid) as ok`, s.otherAdminId, s.familyId)).ok).toBe(false);
    expect((await one<{ ok: boolean }>(`select chat.staff_owns_family($1::uuid, $2::uuid) as ok`, s.ownerId, s.familyId)).ok).toBe(true);
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

  it('F1: completed above the total is a manager\'s own entry; then the grace is counted once (21 of 20 -> one left)', async () => {
    const f = await intake(s.ownerId, 'operations');
    // A supervisor cannot enter completed above the total -- unconfirmed, or naming a manager as the confirmer.
    await expect(carryOver(f.learnerId, s.ownerId, 20, 21)).rejects.toThrow(/entered and confirmed by the super admin/);
    await expect(carryOver(f.learnerId, s.ownerId, 20, 21, { over: s.managerId })).rejects.toThrow(/entered and confirmed by the super admin/);
    // A manager confirms only their own entry.
    await expect(carryOver(f.learnerId, s.managerId, 20, 21, { over: salesManagerId })).rejects.toThrow(/entered and confirmed by the super admin/);
    await expect(carryOver(f.learnerId, s.managerId, 20, 12, { over: s.managerId })).rejects.toThrow(/learner_subscription_over_is_confirmed/);
    await carryOver(f.learnerId, s.managerId, 20, 21, { over: s.managerId });
    expect(await access(f.learnerId)).toMatchObject({ state: 'grace', balance: -1, graceLeft: 1 });
    // Exactly as entered: nothing was clamped.
    expect(await g.prisma.learnerSubscription.findFirstOrThrow({ where: { learnerId: f.learnerId } }))
      .toMatchObject({ lessonsIncluded: 20, lessonsUsedBefore: 21, overConfirmedBy: s.managerId, planMonths: 3 });
  });

  it('voids: the entrant within the 14 days, or a manager; nobody else, and not the entrant after day 14 (review P2)', async () => {
    const f = await intake(s.ownerId, 'operations');
    await carryOver(f.learnerId, s.ownerId, 20, 20);
    await expect(voidCarriedOver(f.learnerId, s.otherAdminId)).rejects.toThrow(/corrected by the supervisor who entered it within 14 days/);
    await enteredDaysAgo(f.enrolmentId, 15);
    await expect(voidCarriedOver(f.learnerId, s.ownerId)).rejects.toThrow(/corrected by the supervisor who entered it within 14 days/);
    await voidCarriedOver(f.learnerId, s.managerId);
    expect(await g.prisma.learnerSubscription.findFirstOrThrow({ where: { learnerId: f.learnerId } }))
      .toMatchObject({ voidedBy: s.managerId, voidReason: 'entered by mistake' });
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
