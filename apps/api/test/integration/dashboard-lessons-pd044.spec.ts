/**
 * PD-44 PR-3 -- the Dashboard's Lessons section, GET /dashboard/lessons
 * (docs/product/pd044-manager-dashboard-plan.md §3.3, §6).
 *
 *   parity    every tile equals what the page it links to shows the same
 *             person at the same instant:
 *               lessons.today_*        GET /calendar?from=<today>&to=<tomorrow>
 *                                      (CalendarService.calendar), its lessons
 *                                      whose outcome the viewer may see, by outcome
 *               lessons.needs_outcome  GET /lessons/needs-action: overdue + awaitingClose
 *               lessons.rulings_open   GET /lessons/needs-action: rulings
 *   scope     the calendar's own scope (academy, a strict Teachers supervisor's
 *             teachers, an Operations supervisor's own children); the outcome
 *             queue only for the Teachers department and the super admin
 *   absent    a tile outside the caller's basis is left out, never sent as 0
 *   tenant    another organization's super admin counts nothing of this one
 *   bounded   the statements one request runs do not grow with the lessons (N+1)
 *
 * Synthetic fixtures only (G-16). Days are the academy's; a lesson's outcome
 * is written as data (triggers off for that statement), as pd038's suite does.
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { TeacherScopeService } from '@platform/teacher-scope';
import { LessonService } from '../../src/lessons/lesson.service';
import { CalendarService } from '../../src/calendar/calendar.service';
import type { DashboardTile } from '../../src/dashboard/dashboard-tile';
import { buildGraph, seed, truncate, Scenario } from './harness';
import { statementCounter } from './statement-counter';

const counter = statementCounter();

const g = buildGraph(undefined, counter.prisma);
const audit = new PrismaAuditService();
const scope = new TeacherScopeService(g.prisma);
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit, undefined, undefined, scope);
const calendar = new CalendarService(g.prisma, g.conversations, lessons, g.config);

jest.setTimeout(120_000);

const TZ = 'Africa/Cairo';
const TODAY_KEYS = [
  'lessons.today_upcoming',
  'lessons.today_unreported',
  'lessons.today_held',
  'lessons.today_student_absent',
  'lessons.today_teacher_absent',
  'lessons.today_cancelled',
] as const;
const QUEUE_KEYS = ['lessons.needs_outcome', 'lessons.rulings_open'] as const;

let s: Scenario;
let tmgr: string;
let tsup: string;
let sa: string;
let sa2: string;
let finance: string;
let org2: string;
/** A child of teacher_c supervised by admin_b, the seed's other Operations supervisor. */
let learnerN: string;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  throw new Error('expected a refusal, got success');
}

const tileOf = (tiles: DashboardTile[], key: string) => tiles.find((t) => t.key === key);
const keys = (tiles: DashboardTile[]) => tiles.map((t) => t.key).sort();

const counted = counter.counted;

/** Today and tomorrow on the academy's calendar (the calendar's own window). */
async function day(offset = 0): Promise<string> {
  const [{ d }] = await g.prisma.$queryRawUnsafe<Array<{ d: string }>>(
    `select to_char((now() at time zone '${TZ}')::date + $1::int, 'YYYY-MM-DD') as d`, offset,
  );
  return d;
}

/** A lesson today at an academy wall-clock minute, for a learner of `teacherId`. */
async function lessonToday(learnerId: string, teacherId: string, minute: number, length = 30): Promise<string> {
  const [{ id }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.lesson (organization_id, learner_id, teacher_id, kind, starts_at, ends_at, created_by, created_by_kind)
     values (chat.default_organization_id(), $1::uuid, $2::uuid, 'regular',
             ((now() at time zone '${TZ}')::date::timestamp + make_interval(mins => $3::int)) at time zone '${TZ}',
             ((now() at time zone '${TZ}')::date::timestamp + make_interval(mins => $3::int + $4::int)) at time zone '${TZ}',
             $5::uuid, 'staff')
     returning id::text as id`,
    learnerId, teacherId, minute, length, tsup,
  );
  return id;
}

/** An outcome written as data: the guards forbid most outcomes before a lesson ends, and the fixture is the point. */
async function outcome(lessonId: string, value: string) {
  await g.prisma.$transaction([
    g.prisma.$executeRawUnsafe(`set local session_replication_role = replica`),
    g.prisma.$executeRawUnsafe(
      // A student apology says when it came (lesson_apology_has_a_timing): this one, late.
      `update chat.lesson set outcome = $2, outcome_by_kind = 'staff', outcome_by = $3::uuid, outcome_at = now(), outcome_note = 'fixture',
              apology_timing = case when $2 = 'student_apology' then 'after_start' end
        where id = $1::uuid`,
      lessonId, value, tsup,
    ),
  ]);
}

/**
 * A late apology waiting for the Teachers department's ruling, on an absence
 * (guard_lesson_ruling: only an absence, only from its start to 48 hours on).
 * Written as data, triggers off for this one statement, so the fixture does
 * not depend on the hour the suite runs at.
 */
async function openRuling(lessonId: string) {
  await g.prisma.$transaction([
    g.prisma.$executeRawUnsafe(`set local session_replication_role = replica`),
    g.prisma.$executeRawUnsafe(
      `insert into chat.lesson_ruling (organization_id, lesson_id, kind, opened_by_kind, opened_by, reason)
       values (chat.default_organization_id(), $1::uuid, 'late_apology', 'contact', $2::uuid, 'the family apologised late')`,
      lessonId, s.parentId,
    ),
  ]);
}

/**
 * What the Schedule page shows this person for today, classified as the tiles
 * are: lessons whose outcome the viewer may see (not anonymous), not moved,
 * not paused.
 */
async function calendarToday(actorId: string): Promise<Record<(typeof TODAY_KEYS)[number], number>> {
  const view = await calendar.calendar(actorId, { from: await day(0), to: await day(1) });
  const now = Date.now();
  const out = Object.fromEntries(TODAY_KEYS.map((k) => [k, 0])) as Record<(typeof TODAY_KEYS)[number], number>;
  for (const l of view.lessons as Array<{ anonymous?: boolean; outcome?: string | null; status: string; startsAt: string }>) {
    if (l.anonymous || l.status === 'moved' || l.status === 'paused') continue;
    const o = l.outcome ?? null;
    if (o === null) out[Date.parse(l.startsAt) > now ? 'lessons.today_upcoming' : 'lessons.today_unreported'] += 1;
    else if (o === 'held') out['lessons.today_held'] += 1;
    else if (o === 'student_no_show') out['lessons.today_student_absent'] += 1;
    else if (o === 'teacher_no_show') out['lessons.today_teacher_absent'] += 1;
    else if (o === 'student_apology' || o === 'teacher_apology' || o === 'admin_cancelled') out['lessons.today_cancelled'] += 1;
  }
  return out;
}

/** Every tile against the pages it links to; the outcome queue only where it applies. */
async function expectParity(actorId: string, queue: boolean) {
  const tiles = await calendar.dashboardCounts(actorId);
  const page = await calendarToday(actorId);
  for (const k of TODAY_KEYS) expect({ actorId, k, n: tileOf(tiles, k)?.count }).toEqual({ actorId, k, n: page[k] });
  if (queue) {
    const q = await lessons.needsAction(actorId);
    expect(tileOf(tiles, 'lessons.needs_outcome')?.count).toBe(q.overdue.length + q.awaitingClose.length);
    expect(tileOf(tiles, 'lessons.rulings_open')?.count).toBe(q.rulings.length);
  } else {
    for (const k of QUEUE_KEYS) expect(tileOf(tiles, k)).toBeUndefined();
  }
}

const strict = (on: boolean) =>
  g.prisma.$executeRaw`UPDATE chat.config SET value = ${JSON.stringify(on)}::jsonb WHERE key = 'teacher_supervisor.strict_scope'`;

// ---------------------------------------------------------------------------

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await strict(false);
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd044l-%'`).catch(() => undefined);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd044l-%'`).catch(() => undefined);
  await strict(false);
  s = await seed(g.prisma);
  [tmgr, tsup, sa, sa2, finance, org2, learnerN] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await g.prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active) values
       ($1::uuid, 'tmgr_l', 'manager', true), ($2::uuid, 'tsup_l', 'admin', true), ($3::uuid, 'fin_l', 'finance', true)`,
    tmgr, tsup, finance,
  );
  await g.prisma.$executeRawUnsafe(`insert into chat.organization (id, slug, display_name) values ($1::uuid, $2, 'org_two')`, org2, `pd044l-${org2.slice(0, 8)}`);
  await g.prisma.$transaction([
    g.prisma.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`),
    g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'sa_l', 'super_admin', true)`, sa),
    g.prisma.$executeRawUnsafe(
      `insert into chat.staff (id, name, role, is_active, organization_id) values ($1::uuid, 'sa_two_l', 'super_admin', true, $2::uuid)`, sa2, org2,
    ),
  ]);
  const [{ id: dept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name, manager_id) values ('teachers', 'teachers', $1::uuid) returning id::text as id`, tmgr,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.department_member (staff_id, organization_id, department_id, position) values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
    tsup, dept,
  );
  // tsup supervises teacher_c only; teacher_d (newTeacherId) is someone else's under strict scope.
  await g.prisma.$executeRawUnsafe(
    `insert into chat.teacher_supervisor_assignment (teacher_id, organization_id, supervisor_id) values ($1::uuid, chat.default_organization_id(), $2::uuid)`,
    s.teacherId, tsup,
  );
  await g.prisma.$transaction([
    g.prisma.$executeRawUnsafe(`select set_config('chat.syncing_assignment', 'on', true)`),
    g.prisma.$executeRawUnsafe(
      `insert into chat.learner (id, family_id, name, teacher_id) values ($1::uuid, $2::uuid, 'learner_n', $3::uuid)`,
      learnerN, s.familyId, s.teacherId,
    ),
  ]);
  await g.prisma.$executeRawUnsafe(
    `insert into chat.learner_supervision (learner_id, organization_id, supervisor_id, assigned_by) values ($1::uuid, chat.default_organization_id(), $2::uuid, $3::uuid)`,
    learnerN, s.otherAdminId, s.managerId,
  );
});

// ---------------------------------------------------------------------------

describe('GET /dashboard/lessons -- today and the outcome queue', () => {
  let ids: Record<string, string>;
  beforeEach(async () => {
    // teacher_c (learner_l, admin_a's) through the day, one lesson per outcome;
    // teacher_d (learner_m, admin_a's); teacher_c again for learner_n (admin_b's).
    ids = {
      held: await lessonToday(s.learnerId, s.teacherId, 8 * 60),
      studentAbsent: await lessonToday(s.learnerId, s.teacherId, 9 * 60),
      teacherAbsent: await lessonToday(s.learnerId, s.teacherId, 10 * 60),
      cancelled: await lessonToday(s.learnerId, s.teacherId, 11 * 60),
      apology: await lessonToday(s.learnerId, s.teacherId, 12 * 60),
      paused: await lessonToday(s.learnerId, s.teacherId, 13 * 60),
      open1: await lessonToday(s.learnerId, s.teacherId, 14 * 60),
      open2: await lessonToday(s.secondLearnerId, s.newTeacherId, 15 * 60),
      others: await lessonToday(learnerN, s.teacherId, 16 * 60),
    };
    await outcome(ids.held!, 'held');
    await outcome(ids.studentAbsent!, 'student_no_show');
    await outcome(ids.teacherAbsent!, 'teacher_no_show');
    await outcome(ids.cancelled!, 'admin_cancelled');
    await outcome(ids.apology!, 'student_apology');
    await outcome(ids.paused!, 'suspended');
    await openRuling(ids.studentAbsent!);
  });

  it('equals the Schedule page and the Needs action queue for every persona', async () => {
    // [persona, gets the outcome queue]
    const personas: Array<[string, boolean]> = [
      [tmgr, true], // the Teachers Manager: academy, and the queue
      [tsup, true], // a Teachers supervisor: department-wide with the switch off
      [s.managerId, false], // the Operations Manager: academy, no queue
      [s.ownerId, false], // an Operations supervisor: their own children named
      [sa, true],
      [sa2, true],
    ];
    for (const [p, queue] of personas) await expectParity(p, queue);

    // Outcome-based tiles do not depend on the hour.
    const t = await calendar.dashboardCounts(tmgr);
    expect(tileOf(t, 'lessons.today_held')?.count).toBe(1);
    expect(tileOf(t, 'lessons.today_student_absent')?.count).toBe(1);
    expect(tileOf(t, 'lessons.today_teacher_absent')?.count).toBe(1);
    expect(tileOf(t, 'lessons.today_cancelled')?.count).toBe(2);
    expect(tileOf(t, 'lessons.rulings_open')?.count).toBe(1);
    // A paused lesson is in no tile.
    expect(TODAY_KEYS.reduce((n, k) => n + (tileOf(t, k)?.count ?? 0), 0)).toBe(8);
  });

  it('narrows to a strict Teachers supervisor\'s teachers, as the Schedule does', async () => {
    await strict(true);
    await expectParity(tsup, true);
    await expectParity(tmgr, true);
    const mine = await calendar.dashboardCounts(tsup);
    const all = await calendar.dashboardCounts(tmgr);
    const total = (tiles: DashboardTile[]) => TODAY_KEYS.reduce((n, k) => n + (tileOf(tiles, k)?.count ?? 0), 0);
    // teacher_d's lesson is not tsup's.
    expect(total(mine)).toBe(total(all) - 1);
  });

  it('counts for an Operations supervisor only the lessons the Schedule names to them', async () => {
    const own = await calendar.dashboardCounts(s.ownerId);
    const other = await calendar.dashboardCounts(s.otherAdminId);
    await expectParity(s.ownerId, false);
    await expectParity(s.otherAdminId, false);
    const total = (tiles: DashboardTile[]) => TODAY_KEYS.reduce((n, k) => n + (tileOf(tiles, k)?.count ?? 0), 0);
    // admin_b names only learner_n's lesson; admin_a names learner_l's six
    // (the paused one is in no tile) and learner_m's one, never learner_n's.
    expect(total(other)).toBe(1);
    expect(total(own)).toBe(7);
  });

  it('leaves the outcome queue out for anyone outside the Teachers department, and refuses nobody silently', async () => {
    expect(keys(await calendar.dashboardCounts(s.managerId))).toEqual([...TODAY_KEYS].sort());
    expect(keys(await calendar.dashboardCounts(tmgr))).toEqual([...TODAY_KEYS, ...QUEUE_KEYS].sort());
    // No schedule at all: no tiles (absent), not an error page of zeros.
    expect(await calendar.dashboardCounts(finance)).toEqual([]);
    expect(await code(calendar.dashboardCounts(s.parentId))).toBe(CommErrorCode.LESSON_DENIED);
    const other = await calendar.dashboardCounts(sa2);
    expect(other.every((t) => t.count === 0)).toBe(true);
  });

  it('runs the same number of statements for 9 lessons as for 30 (no N+1)', async () => {
    // The configuration cache (30 s) is emptied before each run, so both runs read it alike.
    g.config.invalidate();
    const small = await counted(() => calendar.dashboardCounts(tmgr));
    for (let i = 0; i < 21; i += 1) await lessonToday(s.secondLearnerId, s.newTeacherId, 17 * 60 + i * 20, 15);
    g.config.invalidate();
    const large = await counted(() => calendar.dashboardCounts(tmgr));
    await expectParity(tmgr, true);
    expect(large.n).toBe(small.n);
  });
});
