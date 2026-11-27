import { isoToAcademyWallClock } from '@/core/time/academyTime'
import type { CalendarDay, CalendarLesson, CalendarWindow, Interval } from './api'
import { notTaught } from './copy'

/**
 * What needs a person on the loaded days, read from the lessons and intervals
 * the server sent -- nothing is fetched or counted anew. The server has no
 * conflict flag: a double booking is two lessons of one teacher whose times
 * overlap, found here among the lessons on screen only.
 *
 *   conflict  two (or more) lessons of one teacher overlap
 *   absent    a teacher's leave covers lessons that are still booked
 *   payment   a lesson is suspended until the family pays
 *   outside   lessons booked outside the teacher's working hours
 *
 * A lesson that will not be taught (moved away, paused, cancelled, excused)
 * can neither clash nor need a substitute.
 */

export type IssueKind = 'conflict' | 'absent' | 'payment' | 'outside'

export interface Issue {
  kind: IssueKind
  key: string
  teacherId: string
  day: string
  /** The lessons the issue is about, earliest first. */
  lessons: CalendarLesson[]
}

/** The order the attention list reads in: what breaks a lesson first. */
export const ISSUE_ORDER: readonly IssueKind[] = ['conflict', 'absent', 'payment', 'outside']

const dayCache = new Map<string, string>()
/** A lesson's academy day (memoized: thousands of lessons in a month). */
export function dayOfLesson(l: { startsAt: string }): string {
  let d = dayCache.get(l.startsAt)
  if (!d) {
    d = isoToAcademyWallClock(l.startsAt).date
    dayCache.set(l.startsAt, d)
  }
  return d
}

/** Minutes between two instants. */
export const minutesBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 60_000

/** Total minutes of a list of intervals. */
export const minutesOf = (list: Interval[] | undefined) => (list ?? []).reduce((n, [a, b]) => n + minutesBetween(a, b), 0)

/** A lesson that takes the teacher's time: not moved away, not paused, not called off. */
export function isLive(l: CalendarLesson): boolean {
  return l.status !== 'moved' && l.status !== 'paused' && !notTaught(l)
}

const overlaps = (a: { startsAt: string; endsAt: string }, b: { startsAt: string; endsAt: string }) =>
  Date.parse(a.startsAt) < Date.parse(b.endsAt) && Date.parse(b.startsAt) < Date.parse(a.endsAt)

const inAny = (l: CalendarLesson, list: Interval[]) => list.some(([a, b]) => overlaps(l, { startsAt: a, endsAt: b }))

/** Groups of a teacher-day's live lessons that overlap one another (each group has two or more). */
export function clashes(lessons: CalendarLesson[]): CalendarLesson[][] {
  const live = lessons.filter(isLive).sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  const groups: CalendarLesson[][] = []
  let group: CalendarLesson[] = []
  let end = ''
  for (const l of live) {
    if (group.length > 0 && l.startsAt < end) {
      group.push(l)
      if (l.endsAt > end) end = l.endsAt
    } else {
      if (group.length > 1) groups.push(group)
      group = [l]
      end = l.endsAt
    }
  }
  if (group.length > 1) groups.push(group)
  return groups
}

/**
 * Sub-lanes inside one teacher-day: lessons that overlap share the row's height
 * (two clashing lessons sit in half-height lanes); every other lesson keeps the
 * full height.
 */
export function laneMap(lessons: CalendarLesson[]): Map<string, { lane: number; of: number }> {
  const sorted = [...lessons].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.endsAt.localeCompare(b.endsAt))
  const out = new Map<string, { lane: number; of: number }>()
  let cluster: Array<{ id: string; lane: number }> = []
  let ends: string[] = []
  let clusterEnd = ''
  const close = () => {
    const of = Math.max(1, ends.length)
    for (const c of cluster) out.set(c.id, { lane: c.lane, of })
    cluster = []
    ends = []
  }
  for (const l of sorted) {
    if (cluster.length > 0 && l.startsAt >= clusterEnd) close()
    let lane = ends.findIndex((e) => e <= l.startsAt)
    if (lane === -1) lane = ends.length
    ends[lane] = l.endsAt
    cluster.push({ id: l.id, lane })
    if (cluster.length === 1 || l.endsAt > clusterEnd) clusterEnd = l.endsAt
  }
  close()
  return out
}

export interface Findings {
  issues: Issue[]
  /** Lessons drawn with the conflict outline. */
  clashing: Set<string>
  /** Lessons inside their teacher's leave: drawn as ghosts that need a substitute. */
  uncovered: Set<string>
  /** Teachers whose lane is hatched as absent on a day: `${teacherId}|${day}`. */
  absent: Set<string>
  /** Every issue kind on a teacher-day, for the week board's marks: `${teacherId}|${day}`. */
  byCell: Map<string, Set<IssueKind>>
}

/** Every issue on the loaded window, in the order the attention list reads. */
export function findIssues(data: Pick<CalendarWindow, 'days' | 'lessons'>): Findings {
  const byTeacherDay = new Map<string, CalendarLesson[]>()
  for (const l of data.lessons) {
    const k = `${l.teacherId}|${dayOfLesson(l)}`
    const list = byTeacherDay.get(k)
    if (list) list.push(l)
    else byTeacherDay.set(k, [l])
  }
  const intervals = new Map<string, CalendarDay>(data.days.map((d) => [`${d.teacherId}|${d.day}`, d]))
  const issues: Issue[] = []
  const clashing = new Set<string>()
  const uncovered = new Set<string>()
  const absent = new Set<string>()
  const byCell = new Map<string, Set<IssueKind>>()
  const outsideByTeacher = new Map<string, CalendarLesson[]>()
  const mark = (k: string, kind: IssueKind) => {
    const set = byCell.get(k) ?? new Set<IssueKind>()
    set.add(kind)
    byCell.set(k, set)
  }

  for (const [k, lessons] of byTeacherDay) {
    const [teacherId, day] = k.split('|') as [string, string]
    for (const group of clashes(lessons)) {
      for (const l of group) clashing.add(l.id)
      issues.push({ kind: 'conflict', key: `conflict|${k}|${group[0]!.id}`, teacherId, day, lessons: group })
      mark(k, 'conflict')
    }
    const leave = intervals.get(k)?.leave ?? []
    if (leave.length > 0) {
      const inLeave = lessons.filter((l) => isLive(l) && inAny(l, leave)).sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      if (inLeave.length > 0) {
        for (const l of inLeave) uncovered.add(l.id)
        absent.add(k)
        issues.push({ kind: 'absent', key: `absent|${k}`, teacherId, day, lessons: inLeave })
        mark(k, 'absent')
      }
    }
    for (const l of lessons) {
      if (!l.anonymous && l.suspendedFor === 'payment' && l.status !== 'moved') {
        issues.push({ kind: 'payment', key: `payment|${l.id}`, teacherId, day, lessons: [l] })
        mark(k, 'payment')
      }
    }
    const outside = lessons.filter((l) => l.outsideShift && isLive(l))
    if (outside.length > 0) {
      // One item per teacher for the whole window: a week of late lessons is one fact, not seven.
      const same = outsideByTeacher.get(teacherId)
      if (same) same.push(...outside)
      else outsideByTeacher.set(teacherId, [...outside])
      mark(k, 'outside')
    }
  }
  for (const [teacherId, list] of outsideByTeacher) {
    list.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    issues.push({ kind: 'outside', key: `outside|${teacherId}`, teacherId, day: dayOfLesson(list[0]!), lessons: list })
  }

  issues.sort(
    (a, b) =>
      ISSUE_ORDER.indexOf(a.kind) - ISSUE_ORDER.indexOf(b.kind) ||
      a.day.localeCompare(b.day) ||
      a.lessons[0]!.startsAt.localeCompare(b.lessons[0]!.startsAt),
  )
  return { issues, clashing, uncovered, absent, byCell }
}
