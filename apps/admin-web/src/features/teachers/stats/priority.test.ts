import { describe, expect, it } from 'vitest'
import type { TeacherRow } from '../api'
import { clausesOf, flagsOf, levelOf, matches, rank, totals } from './priority'
import { TEACHER_ATTENTION_THRESHOLDS as TH } from './thresholds'

/** The list's order: by need for intervention, from the server's numbers and the thresholds. Synthetic teachers only. */

const zero = { lessons: 0, minutes: 0 }
function row(id: string, o: { unrep?: number; noShow?: number; att?: number | null; onTime?: number | null; trials?: [number, number]; held?: number; active?: boolean; summary?: boolean }): TeacherRow {
  const held = o.held ?? 40
  return {
    teacher: { id, name: id, isActive: o.active ?? true },
    held: { lessons: held, minutes: held * 30 },
    scheduled: held ? { lessons: held + 2, minutes: (held + 2) * 30 } : zero,
    notHeld: { lessons: 2, minutes: 60 },
    unreported: { lessons: o.unrep ?? 0, minutes: (o.unrep ?? 0) * 30 },
    upcoming: held ? { lessons: 10, minutes: 300 } : zero,
    attendanceRate: o.att === undefined ? 0.95 : o.att,
    reportsOnTimeRate: o.onTime === undefined ? 0.95 : o.onTime,
    trials: { total: o.trials?.[1] ?? 0, conducted: 0, subscribed: o.trials?.[0] ?? 0, notSubscribed: 0, noShow: 0, awaiting: 0, upcoming: 0, cancelled: 0, conversionRate: null },
    summary:
      o.summary === false
        ? undefined
        : {
            totalScheduled: held, conducted: held, studentAttended: held, studentNoShow: 6,
            studentExcuses: { total: 4, beforeStart: 3, afterStart: 1 }, teacherExcuses: 1, teacherNoShow: o.noShow ?? 0, cancelled: 0,
            pending: { total: 0, upcoming: 0, awaitingReport: o.unrep ?? 0 }, completed: { regular: held, makeup: 0, total: held },
            makeups: { completed: 0, scheduled: 0, total: 0 },
          },
  }
}
const collator = new Intl.Collator('en')

describe('severity', () => {
  it('urgent: lessons without a report at the threshold, or any teacher no-show', () => {
    expect(levelOf(flagsOf(row('a', { unrep: TH.lateReportsUrgent }), TH))).toBe('urgent')
    expect(levelOf(flagsOf(row('a', { unrep: TH.lateReportsUrgent - 1 }), TH))).toBe('ok')
    expect(levelOf(flagsOf(row('a', { noShow: 1 }), TH))).toBe('urgent')
  })

  it('watch: student attendance or on-time reports below their thresholds; a missing rate is not a breach', () => {
    expect(levelOf(flagsOf(row('a', { att: TH.attendanceWatch - 0.01 }), TH))).toBe('watch')
    expect(levelOf(flagsOf(row('a', { att: TH.attendanceWatch }), TH))).toBe('ok')
    expect(levelOf(flagsOf(row('a', { onTime: TH.onTimeWatch - 0.01 }), TH))).toBe('watch')
    expect(levelOf(flagsOf(row('a', { att: null, onTime: null }), TH))).toBe('ok')
  })
})

describe('order', () => {
  it('urgent first (a no-show before a backlog), then watch (furthest below first), then on track by name', () => {
    const order = rank(
      [
        row('ok-b', {}),
        row('watch-near', { att: 0.84 }),
        row('late-5', { unrep: 5 }),
        row('ok-a', {}),
        row('noshow', { noShow: 1 }),
        row('watch-far', { att: 0.6 }),
        row('late-9', { unrep: 9 }),
      ],
      TH,
      collator,
    ).map((r) => r.row.teacher.id)
    expect(order).toEqual(['noshow', 'late-9', 'late-5', 'watch-far', 'watch-near', 'ok-a', 'ok-b'])
  })

  it('an inactive teacher on track comes after the active ones', () => {
    const order = rank([row('a', { active: false }), row('b', {})], TH, collator).map((r) => r.row.teacher.id)
    expect(order).toEqual(['b', 'a'])
  })
})

describe('the reason', () => {
  const reason = (r: TeacherRow) => {
    const f = flagsOf(r, TH)
    return clausesOf(r, f, levelOf(f)).map((c) => c.key)
  }
  it('says what the columns do not: a no-show, whether late reports are a habit or a recent backlog', () => {
    expect(reason(row('a', { noShow: 2, unrep: 4, onTime: 0.95 }))).toEqual(['noShow', 'lateRecent'])
    expect(reason(row('a', { unrep: 4, onTime: 0.5 }))).toEqual(['reportsLate', 'teacherExcuses'])
    expect(reason(row('a', { unrep: 4, onTime: null }))).toEqual(['lateNone', 'teacherExcuses'])
  })
  it('a low attendance names the students’ absences, or says it plainly without a month summary', () => {
    expect(reason(row('a', { att: 0.7 }))).toEqual(['absences', 'teacherExcuses'])
    expect(reason(row('a', { att: 0.7, summary: false }))).toEqual(['absencesUnknown'])
  })
  it('a row on track mentions its trials, or that it had no lessons', () => {
    expect(reason(row('a', { trials: [2, 3] }))).toEqual(['trials'])
    expect(reason(row('a', { held: 0 }))).toEqual(['noLessons'])
    expect(reason(row('a', {}))).toEqual([])
  })
})

describe('figures and filters', () => {
  it('sums the server numbers and filters by each figure', () => {
    const ranked = rank([row('a', { unrep: 4 }), row('b', { unrep: 1, att: 0.7 }), row('c', { noShow: 2 })], TH, collator)
    expect(totals(ranked)).toMatchObject({ teachers: 3, urgent: 2, lateLessons: 5, lateTeachers: 2, lowAttendance: 1, noShowLessons: 2, noShowTeachers: 1 })
    expect(ranked.filter((r) => matches(r, 'late')).map((r) => r.row.teacher.id)).toEqual(['a', 'b'])
    expect(ranked.filter((r) => matches(r, 'noshow')).map((r) => r.row.teacher.id)).toEqual(['c'])
  })
  it('without any month summary the no-show figure is unknown, not zero', () => {
    const ranked = rank([row('a', { summary: false })], TH, collator)
    expect(totals(ranked).noShowLessons).toBeNull()
  })
})
