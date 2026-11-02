/**
 * RQA-F1 -- a teacher's lesson reports on the Teacher File
 * (GET /teacher-files/:teacherId/lesson-reports), read-only.
 *
 *   the tile's rule  counts.reports and counts.onTime equal StatsService's
 *                    `reports` for the same viewer, teacher and month; late is
 *                    the rest of them. Pending and missing (ended, no outcome,
 *                    inside / past the close window) are counted apart.
 *   not listed       outcomes that owe no report (absence, cancellation),
 *                    and lessons not yet over
 *   content          the report's fields, the staff-only note, who entered it
 *   paging           newest first, pages of LESSON_REPORTS_PAGE, disjoint and
 *                    complete; the counts never change with the page or filter
 *   access           the Teacher File's own gate: whoever the file refuses,
 *                    this refuses alike
 *
 * Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { LessonService } from '../../src/lessons/lesson.service';
import { SchedulingService } from '../../src/lessons/scheduling.service';
import { StatsService } from '../../src/lessons/stats.service';
import { TeacherFileService } from '../../src/teacher-file/teacher-file.service';
import { LESSON_REPORTS_PAGE, TeacherLessonReportsService } from '../../src/teacher-file/teacher-lesson-reports.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(180_000);

const g = buildGraph();
const audit = new PrismaAuditService();
const lessons = new LessonService(g.prisma, g.authz, g.conversations, g.outbox, g.config, audit);
const scheduling = new SchedulingService(g.prisma, g.authz, g.conversations, lessons, g.outbox, g.config, g.reminders, audit);
const stats = new StatsService(g.prisma, g.conversations, lessons, scheduling, g.config);
const files = new TeacherFileService(g.prisma, g.authz, g.conversations, audit);
const reports = new TeacherLessonReportsService(g.prisma, files, g.config);

const TZ = 'Africa/Cairo';
const MIN = 60_000;
const HOUR = 60 * MIN;

let s: Scenario;
let tsupId: string;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
  return 'allowed';
}

async function monthOf(at: Date): Promise<string> {
  const [{ m }] = await g.prisma.$queryRawUnsafe<Array<{ m: string }>>(
    `select to_char($1::timestamptz at time zone '${TZ}', 'YYYY-MM') as m`, at,
  );
  return m;
}

/** A lesson for learner_l at a fixed instant, `minutes` long. */
async function lessonAt(startsAt: Date, minutes = 30): Promise<string> {
  return (await lessons.schedule(tsupId, {
    learnerId: s.learnerId,
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + minutes * MIN).toISOString(),
  })).id;
}

/** Every row of a month, page by page. */
async function allPages(month: string, status?: string) {
  const seen: Array<{ id: string; status: string; startsAt: string }> = [];
  const counts: unknown[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i += 1) {
    const page = await reports.list(tsupId, s.teacherId, { month, status, cursor });
    counts.push(page.counts);
    seen.push(...page.lessons.map((l) => ({ id: l.id, status: l.status, startsAt: l.startsAt })));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return { seen, counts };
}

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
  tsupId = randomUUID();
  await g.prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'tsup_a', 'admin', true)`, tsupId);
  const [{ id: dept }] = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `insert into chat.department (kind, display_name) values ('teachers', 'teachers') returning id::text as id`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.department_member (staff_id, organization_id, department_id, position)
     values ($1::uuid, chat.default_organization_id(), $2::uuid, 'supervisor')`,
    tsupId, dept,
  );
});

describe('the month\'s lessons and their reports', () => {
  it('a past month: the tile\'s reports (all late, written weeks after), a missing one, and nothing that owes no report', async () => {
    const day = (d: number, h: number) => new Date(Date.UTC(2026, 8, d, h));
    const reported = await lessonAt(day(2, 15));
    await lessons.report(s.teacherId, reported, { covered: 'Surat al-Fatiha', homework: 'revise ayat 1-3', note: 'staff only' });
    await lessons.report(s.teacherId, await lessonAt(day(3, 15)), { covered: 'b' });
    await lessons.absence(s.teacherId, await lessonAt(day(5, 15)), {});
    await lessons.cancel(tsupId, await lessonAt(day(7, 15)), { reason: 'holiday' });
    const neverClosed = await lessonAt(day(8, 15));

    const out = await reports.list(tsupId, s.teacherId, { month: '2026-09' });
    const tile = (await stats.teacher(tsupId, s.teacherId, '2026-09')).reports;
    expect({ reports: out.counts.reports, onTime: out.counts.onTime }).toEqual({ reports: tile.reports, onTime: tile.onTime });
    expect(out.counts).toEqual({ reports: 2, onTime: 0, late: 2, pending: 0, missing: 1 });
    expect(out.month).toBe('2026-09');
    // Newest first; the absence and the cancellation owe no report.
    expect(out.lessons.map((l) => [l.id, l.status])).toEqual([
      [neverClosed, 'missing'],
      [expect.any(String), 'late'],
      [reported, 'late'],
    ]);
    const row = out.lessons.find((l) => l.id === reported)!;
    expect(row).toMatchObject({
      kind: expect.any(String),
      day: '2026-09-02',
      learner: { id: s.learnerId, name: expect.any(String), familyId: s.familyId },
      prospectName: null,
      report: {
        covered: 'Surat al-Fatiha', homework: 'revise ayat 1-3', note: 'staff only',
        enteredBy: { kind: 'teacher', id: s.teacherId, name: expect.any(String) },
        version: 1, graceHours: 24,
      },
    });
    expect(row.report!.delayMinutes).toBeGreaterThan(24 * 60);
    expect(out.lessons.find((l) => l.id === neverClosed)!.report).toBeNull();
  });

  it('this month: a report within the grace is on time, an ended lesson inside the close window is pending -- the tile agrees', async () => {
    const start = new Date(Date.now() - 2 * HOUR);
    await lessons.report(s.teacherId, await lessonAt(start), { covered: 'x' });
    const open = await lessonAt(new Date(Date.now() - 90 * MIN));
    await lessonAt(new Date(Date.now() + 3 * HOUR)); // not over: not listed
    const month = await monthOf(start);
    const out = await reports.list(tsupId, s.teacherId, { month });
    const tile = (await stats.teacher(tsupId, s.teacherId, month)).reports;
    expect({ reports: out.counts.reports, onTime: out.counts.onTime }).toEqual({ reports: tile.reports, onTime: tile.onTime });
    if (month === (await monthOf(new Date(Date.now() - 90 * MIN)))) {
      expect(out.counts).toMatchObject({ onTime: 1, late: 0, pending: 1, missing: 0 });
      expect(out.lessons.find((l) => l.id === open)!.status).toBe('pending');
    }
    // No month given: the academy's current month.
    expect((await reports.list(tsupId, s.teacherId, {})).month).toBe(await monthOf(new Date()));
  });

  it('pages newest first, disjoint and complete; the counts never move with the page or the filter', async () => {
    const day = (d: number, h: number, m: number) => new Date(Date.UTC(2026, 8, d, h, m));
    const ids: string[] = [];
    for (let i = 0; i < LESSON_REPORTS_PAGE + 3; i += 1) ids.push(await lessonAt(day(1 + (i % 28), 6 + Math.floor(i / 28) * 3, 0)));
    await lessons.report(s.teacherId, ids[0]!, { covered: 'one' });

    const { seen, counts } = await allPages('2026-09');
    expect(counts.length).toBe(2);
    expect(new Set(seen.map((r) => r.id)).size).toBe(ids.length);
    expect([...seen.map((r) => r.id)].sort()).toEqual([...ids].sort());
    const starts = seen.map((r) => r.startsAt);
    expect(starts).toEqual([...starts].sort().reverse());
    for (const c of counts) expect(c).toEqual({ reports: 1, onTime: 0, late: 1, pending: 0, missing: LESSON_REPORTS_PAGE + 2 });

    const late = await allPages('2026-09', 'late');
    expect(late.seen.map((r) => r.id)).toEqual([ids[0]]);
    expect(late.counts[0]).toEqual(counts[0]);
  });
});

describe('who may read them', () => {
  it('whoever the Teacher File refuses, this refuses alike; a parent and a teacher never read them', async () => {
    for (const who of [tsupId, s.ownerId, s.managerId, s.parentId, s.teacherId]) {
      const file = await code(files.detail(who, s.teacherId));
      const list = await code(reports.list(who, s.teacherId, { month: '2026-09' }));
      expect({ who, list }).toEqual({ who, list: file });
    }
    expect(await code(reports.list(tsupId, s.teacherId, {}))).toBe('allowed');
    expect(await code(reports.list(s.parentId, s.teacherId, {}))).not.toBe('allowed');
    expect(await code(reports.list(s.teacherId, s.teacherId, {}))).not.toBe('allowed');
  });

  it('a teacher outside the organization, or no teacher at all, is not found', async () => {
    expect(await code(reports.list(tsupId, randomUUID(), {}))).toBe(CommErrorCode.TEACHER_FILE_NOT_FOUND);
    expect(await code(reports.list(tsupId, 'not-a-uuid', {}))).toBe(CommErrorCode.TEACHER_FILE_NOT_FOUND);
  });

  it('refuses a malformed month, status or cursor', async () => {
    expect(await code(reports.list(tsupId, s.teacherId, { month: '2026-13' }))).toBe(CommErrorCode.VALIDATION);
    expect(await code(reports.list(tsupId, s.teacherId, { status: 'excused' }))).toBe(CommErrorCode.VALIDATION);
    expect(await code(reports.list(tsupId, s.teacherId, { cursor: 'bm90IGEgY3Vyc29y' }))).toBe(CommErrorCode.VALIDATION);
  });
});
