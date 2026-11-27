import type { TeacherRow } from '../api'
import type { TeacherAttentionThresholds } from './thresholds'

/**
 * The order of the teacher statistics list: by need for intervention, never
 * by performance. Pure functions of the server's numbers and the thresholds;
 * nothing here is counted, only compared.
 *
 *  - urgent: something a person can settle now (lessons without a report at or
 *    above the threshold, any teacher no-show this month);
 *  - watch: a trend (student attendance or on-time reports below their thresholds);
 *  - ok: on track.
 */
export type Level = 'urgent' | 'watch' | 'ok'

export interface Flags {
  /** Lessons the teacher missed without notice this month (0 when the server sent no summary). */
  noShow: number
  /** Lessons without a report at or above the urgent threshold. */
  late: boolean
  attendance: boolean
  onTime: boolean
}

/** What a row's reason sentence says, before it is put into words. */
export type Clause =
  | { key: 'noShow'; n: number }
  | { key: 'lateRecent' }
  | { key: 'lateHabit' }
  | { key: 'lateNone' }
  | { key: 'absences'; absent: number; excused: number }
  | { key: 'absencesUnknown' }
  | { key: 'reportsLate' }
  | { key: 'teacherExcuses'; n: number }
  | { key: 'noLessons' }

export interface Ranked {
  row: TeacherRow
  level: Level
  flags: Flags
  clauses: Clause[]
}

/** The header's figures; each one also filters the list. */
export type Filter = 'urgent' | 'late' | 'attendance' | 'noshow'
export const FILTERS: Filter[] = ['urgent', 'late', 'attendance', 'noshow']

export function flagsOf(row: TeacherRow, th: TeacherAttentionThresholds): Flags {
  return {
    noShow: row.summary?.teacherNoShow ?? 0,
    late: row.unreported.lessons >= th.lateReportsUrgent,
    attendance: row.attendanceRate !== null && row.attendanceRate < th.attendanceWatch,
    onTime: row.reportsOnTimeRate !== null && row.reportsOnTimeRate < th.onTimeWatch,
  }
}

export function levelOf(f: Flags): Level {
  if (f.noShow > 0 || f.late) return 'urgent'
  if (f.attendance || f.onTime) return 'watch'
  return 'ok'
}

/**
 * The reason a row is where it is, in what its columns do not say: a no-show,
 * whether late reports are a habit or a recent backlog, how the students'
 * absences break down. A row on track says nothing, unless it had no lessons.
 */
export function clausesOf(row: TeacherRow, f: Flags, level: Level): Clause[] {
  const out: Clause[] = []
  if (f.noShow > 0) out.push({ key: 'noShow', n: f.noShow })
  if (f.late) {
    // The backlog read against the month's habit (the on-time rate under the number).
    if (row.reportsOnTimeRate === null) out.push({ key: 'lateNone' })
    else if (f.onTime) out.push({ key: 'lateHabit' })
    else out.push({ key: 'lateRecent' })
  }
  if (f.attendance) {
    out.push(
      row.summary
        ? { key: 'absences', absent: row.summary.studentNoShow, excused: row.summary.studentExcuses.total }
        : { key: 'absencesUnknown' },
    )
  }
  if (f.onTime && !f.late) out.push({ key: 'reportsLate' })
  if (level !== 'ok') {
    const excuses = row.summary?.teacherExcuses ?? 0
    if (excuses > 0 && out.length < 2) out.push({ key: 'teacherExcuses', n: excuses })
    return out.slice(0, 2)
  }
  // On track needs no reason; only a month without lessons is worth a word.
  if (row.scheduled.lessons === 0 && row.held.lessons === 0 && row.upcoming.lessons === 0) return [{ key: 'noLessons' }]
  return []
}

const LEVEL_ORDER: Record<Level, number> = { urgent: 0, watch: 1, ok: 2 }

/** How far below its threshold a rate is (larger is further); 0 when it is not below. */
function shortfall(rate: number | null, threshold: number): number {
  return rate === null || rate >= threshold ? 0 : (threshold - rate) / threshold
}

export function rank(rows: TeacherRow[], th: TeacherAttentionThresholds, collator: Intl.Collator): Ranked[] {
  const ranked = rows.map((row) => {
    const flags = flagsOf(row, th)
    const level = levelOf(flags)
    return { row, level, flags, clauses: clausesOf(row, flags, level) }
  })
  return ranked.sort((a, b) => {
    if (a.level !== b.level) return LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]
    if (a.level === 'urgent') {
      // A lesson a family lost outweighs a report not yet written.
      if (a.flags.noShow !== b.flags.noShow) return b.flags.noShow - a.flags.noShow
      if (a.row.unreported.lessons !== b.row.unreported.lessons) return b.row.unreported.lessons - a.row.unreported.lessons
      // Then the weaker habit first, the same in either language.
      const oa = a.row.reportsOnTimeRate ?? 1
      const ob = b.row.reportsOnTimeRate ?? 1
      if (oa !== ob) return oa - ob
    } else if (a.level === 'watch') {
      const da = shortfall(a.row.attendanceRate, th.attendanceWatch) + shortfall(a.row.reportsOnTimeRate, th.onTimeWatch)
      const db = shortfall(b.row.attendanceRate, th.attendanceWatch) + shortfall(b.row.reportsOnTimeRate, th.onTimeWatch)
      if (da !== db) return db - da
    } else if (a.row.teacher.isActive !== b.row.teacher.isActive) {
      return a.row.teacher.isActive ? -1 : 1
    }
    return collator.compare(a.row.teacher.name, b.row.teacher.name)
  })
}

export function matches(r: Ranked, filter: Filter | null): boolean {
  switch (filter) {
    case null:
      return true
    case 'urgent':
      return r.level === 'urgent'
    case 'late':
      return r.row.unreported.lessons > 0
    case 'attendance':
      return r.flags.attendance
    case 'noshow':
      return r.flags.noShow > 0
  }
}

export function isFilter(value: string | null): value is Filter {
  return value !== null && (FILTERS as string[]).includes(value)
}

/** The header's figures, from the server's rows. Sums only; no rate is recomputed. */
export function totals(ranked: Ranked[]) {
  const withSummary = ranked.some((r) => r.row.summary !== undefined)
  return {
    teachers: ranked.length,
    urgent: ranked.filter((r) => r.level === 'urgent').length,
    lateLessons: ranked.reduce((n, r) => n + r.row.unreported.lessons, 0),
    lateTeachers: ranked.filter((r) => r.row.unreported.lessons > 0).length,
    lowAttendance: ranked.filter((r) => r.flags.attendance).length,
    noShowLessons: withSummary ? ranked.reduce((n, r) => n + r.flags.noShow, 0) : null,
    noShowTeachers: ranked.filter((r) => r.flags.noShow > 0).length,
  }
}
