import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { AppConfigService } from '../platform/app-config.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { TeacherFileService } from './teacher-file.service';

/**
 * RQA-F1: a teacher's lesson reports, month by month, on the Teacher File --
 * read-only.
 *
 * The stats tile's own rule, never a second one (chat.teacher_report_timeliness,
 * StatsService.detail's `reports`): the month is [first day, next first day) in
 * `stats.zone` on the lesson's start; a REPORT is a live lesson_report on a held
 * lesson (trials too); ON TIME is submitted within `stats.report_grace_hours`
 * of the lesson's end, LATE after it. So `counts.reports` and `counts.onTime`
 * equal the tile's for the same month.
 *
 * Beside them, and never in the tile's figures: an ended lesson with no outcome
 * is PENDING inside LessonService's close window (`lesson.escalation_after_minutes`,
 * the awaiting_close phase) and MISSING past it (the overdue phase -- PD-47's
 * lesson_report task). Other outcomes owe no report and are not listed.
 *
 * Access is the Teacher File's: its gate (`canView`), then the caller's
 * teacher scope (requireTeacher) -- teacher-level, as the tile's is.
 */
export const REPORT_STATUSES = ['on_time', 'late', 'pending', 'missing'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const LESSON_REPORTS_PAGE = 50;

const invalid = (why: string) => new CommError(CommErrorCode.VALIDATION, why, 400);

interface Row {
  id: string;
  kind: string;
  starts_at: Date;
  ends_at: Date;
  day: string;
  status: ReportStatus;
  learner_id: string | null;
  learner_name: string | null;
  family_id: string | null;
  prospect_name: string | null;
  report_id: string | null;
  lesson_number: number | null;
  lesson_total: number | null;
  covered: string | null;
  covered_topics: string[] | null;
  next_tasks: string[] | null;
  homework: string | null;
  rating: number | null;
  note: string | null;
  submitted_at: Date | null;
  updated_at: Date | null;
  version: number | null;
  entered_by_kind: string | null;
  entered_by: string | null;
  entered_by_name: string | null;
}

@Injectable()
export class TeacherLessonReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: TeacherFileService,
    private readonly config: AppConfigService,
  ) {}

  async list(actorId: string, teacherId: string, query: { month?: string; status?: string; cursor?: string }) {
    const { actor } = await this.files.gate(actorId, (a) => a.canView);
    const teacher = await this.files.requireTeacher(actor, teacherId);
    if (query.month !== undefined && !MONTH_RE.test(query.month)) throw invalid('month: YYYY-MM');
    if (query.status !== undefined && !(REPORT_STATUSES as readonly string[]).includes(query.status)) {
      throw invalid('status: on_time, late, pending or missing');
    }
    const after = query.cursor !== undefined ? decodeCursor(query.cursor) : null;

    const zone = String(await this.config.get('stats.zone'));
    const grace = Number(await this.config.get('stats.report_grace_hours'));
    const closeMinutes = Number(await this.config.get('lesson.escalation_after_minutes'));
    const org = actor.organizationId as string;

    // One classification, read by both the counts and the page.
    const classified = Prisma.sql`
      WITH m AS (
        SELECT coalesce(${query.month ?? null}::text || '-01', to_char((now() AT TIME ZONE ${zone})::date, 'YYYY-MM') || '-01')::date AS first_day
      ), w AS (
        SELECT to_char(first_day, 'YYYY-MM') AS month,
               (first_day::timestamp AT TIME ZONE ${zone}) AS "from",
               ((first_day + interval '1 month')::timestamp AT TIME ZONE ${zone}) AS "to"
          FROM m
      ), c AS (
        SELECT l.*, r.lesson_id AS report_id,
               CASE
                 WHEN l.outcome = 'held' AND r.lesson_id IS NOT NULL THEN
                   CASE WHEN r.submitted_at <= l.ends_at + make_interval(hours => ${grace}::int) THEN 'on_time' ELSE 'late' END
                 WHEN l.outcome IS NULL AND l.ends_at <= now() THEN
                   CASE WHEN now() < l.ends_at + make_interval(mins => ${closeMinutes}::int) THEN 'pending' ELSE 'missing' END
               END AS status
          FROM chat.lesson l
          CROSS JOIN w
          LEFT JOIN chat.lesson_report r ON r.lesson_id = l.id AND r.deleted_at IS NULL
         WHERE l.organization_id = ${org}::uuid AND l.teacher_id = ${teacher.id}::uuid
           AND l.starts_at >= w."from" AND l.starts_at < w."to"
      )`;

    const [counts] = await this.prisma.$queryRaw<Array<{ month: string; on_time: number; late: number; pending: number; missing: number }>>`
      ${classified}
      SELECT (SELECT month FROM w) AS month,
             count(*) FILTER (WHERE status = 'on_time')::int AS on_time,
             count(*) FILTER (WHERE status = 'late')::int AS late,
             count(*) FILTER (WHERE status = 'pending')::int AS pending,
             count(*) FILTER (WHERE status = 'missing')::int AS missing
        FROM c`;

    const rows = await this.prisma.$queryRaw<Row[]>`
      ${classified}
      SELECT c.id::text AS id, c.kind, c.starts_at, c.ends_at,
             to_char(c.starts_at AT TIME ZONE ${zone}, 'YYYY-MM-DD') AS day,
             c.status, c.learner_id::text AS learner_id, ln.name AS learner_name, ln.family_id::text AS family_id,
             p.display_name AS prospect_name,
             r.lesson_id::text AS report_id, r.lesson_number, r.lesson_total, r.covered, r.covered_topics, r.next_tasks,
             r.homework, r.rating, r.note, r.submitted_at, r.updated_at, r.version,
             r.entered_by_kind, r.entered_by::text AS entered_by,
             coalesce(st.name, te.name) AS entered_by_name
        FROM c
        LEFT JOIN chat.learner ln ON ln.id = c.learner_id
        LEFT JOIN chat.trial_prospect p ON p.id = c.prospect_id
        LEFT JOIN chat.lesson_report r ON r.lesson_id = c.report_id
        LEFT JOIN chat.staff st ON r.entered_by_kind = 'staff' AND st.id = r.entered_by
        LEFT JOIN chat.teacher te ON r.entered_by_kind = 'teacher' AND te.id = r.entered_by
       WHERE c.status IS NOT NULL
         AND (${query.status ?? null}::text IS NULL OR c.status = ${query.status ?? null}::text)
         AND (${after?.startsAt ?? null}::timestamptz IS NULL
              OR (c.starts_at, c.id) < (${after?.startsAt ?? null}::timestamptz, ${after?.id ?? null}::uuid))
       ORDER BY c.starts_at DESC, c.id DESC
       LIMIT ${LESSON_REPORTS_PAGE + 1}`;

    const page = rows.slice(0, LESSON_REPORTS_PAGE);
    const last = page[page.length - 1];
    return {
      teacherId: teacher.id,
      month: counts!.month,
      zone,
      // The tile's figures (reports, onTime) and the two it never counts.
      counts: {
        reports: counts!.on_time + counts!.late,
        onTime: counts!.on_time,
        late: counts!.late,
        pending: counts!.pending,
        missing: counts!.missing,
      },
      lessons: page.map((r) => this.dto(r, grace)),
      nextCursor: rows.length > LESSON_REPORTS_PAGE && last ? encodeCursor(last.starts_at, last.id) : null,
    };
  }

  private dto(r: Row, graceHours: number) {
    const delayMinutes = r.submitted_at
      ? Math.max(0, Math.round((r.submitted_at.getTime() - r.ends_at.getTime()) / 60_000))
      : null;
    return {
      id: r.id,
      kind: r.kind,
      startsAt: r.starts_at.toISOString(),
      endsAt: r.ends_at.toISOString(),
      /** The lesson's day in the academy's zone: the Schedule's day view opens on it. */
      day: r.day,
      status: r.status,
      learner: r.learner_id ? { id: r.learner_id, name: r.learner_name, familyId: r.family_id } : null,
      /** A trial is named by its prospect, never by its form (G-07). */
      prospectName: r.learner_id ? null : r.prospect_name,
      report: r.report_id
        ? {
            lessonNumber: r.lesson_number,
            lessonTotal: r.lesson_total,
            covered: r.covered,
            coveredTopics: r.covered_topics ?? [],
            nextTasks: r.next_tasks ?? [],
            homework: r.homework,
            rating: r.rating,
            // Staff-only, as the lesson's own staff view shows it.
            note: r.note,
            submittedAt: r.submitted_at!.toISOString(),
            updatedAt: r.updated_at!.toISOString(),
            version: r.version,
            enteredBy: r.entered_by ? { kind: r.entered_by_kind, id: r.entered_by, name: r.entered_by_name } : null,
            delayMinutes,
            graceHours,
          }
        : null,
    };
  }
}

function encodeCursor(startsAt: Date, id: string): string {
  return Buffer.from(`${startsAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { startsAt: string; id: string } {
  const [startsAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!startsAt || !id || Number.isNaN(Date.parse(startsAt)) || !UUID_RE.test(id)) throw invalid('cursor: not one this list gave');
  return { startsAt, id };
}
