import { describe, expect, it } from 'vitest'
import type { CalendarDay, CalendarLesson } from './api'
import { clashes, findIssues, laneMap } from './issues'
import { hourRange } from './Timeline'

/**
 * Third pass: what needs a person, read from the lessons on screen. The server
 * has no conflict flag, so a double booking is found here: two live lessons of
 * one teacher whose times overlap. Synthetic people only.
 */

// Saturday 28 Nov 2026: Cairo is UTC+2.
const D = '2026-11-28'
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number]
  return new Date(Date.UTC(2026, 10, 28, h - 2, m)).toISOString()
}
let n = 0
const lesson = (teacherId: string, from: string, to: string, over: Partial<CalendarLesson> = {}): CalendarLesson =>
  ({
    id: `l-${++n}`, teacherId, startsAt: at(from), endsAt: at(to), kind: 'regular', status: 'active', colorKey: null, matches: true,
    outsideShift: false, learner: { id: `k-${n}`, name: `Child ${n}` }, prospect: null, outcome: null, suspendedFor: null, movedFrom: null,
    ...over,
  }) as CalendarLesson
const day = (teacherId: string, over: Partial<CalendarDay> = {}): CalendarDay => ({
  teacherId, day: D, shift: [[at('13:00'), at('21:00')]], work: [], leave: [], empty: [], free: [], ...over,
})

describe('a double booking', () => {
  it('is two live lessons of one teacher that overlap; back to back is not one', () => {
    const a = lesson('t-1', '18:00', '18:30')
    const b = lesson('t-1', '18:00', '19:00')
    const c = lesson('t-1', '19:00', '19:30')
    const groups = clashes([c, b, a])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.map((l) => l.id).sort()).toEqual([a.id, b.id].sort())
  })

  it('a lesson moved away, paused or called off cannot clash', () => {
    const a = lesson('t-1', '18:00', '18:30')
    expect(clashes([a, lesson('t-1', '18:00', '18:30', { status: 'moved' })])).toHaveLength(0)
    expect(clashes([a, lesson('t-1', '18:00', '18:30', { status: 'paused' })])).toHaveLength(0)
    expect(clashes([a, lesson('t-1', '18:00', '18:30', { outcome: 'admin_cancelled' })])).toHaveLength(0)
  })

  it('draws the clashing pair in half-height lanes and keeps every other lesson full height', () => {
    const a = lesson('t-1', '18:00', '18:30')
    const b = lesson('t-1', '18:15', '19:00')
    const c = lesson('t-1', '20:00', '20:30')
    const lanes = laneMap([a, b, c])
    expect(lanes.get(a.id)).toEqual({ lane: 0, of: 2 })
    expect(lanes.get(b.id)).toEqual({ lane: 1, of: 2 })
    expect(lanes.get(c.id)).toEqual({ lane: 0, of: 1 })
  })
})

describe('the attention list', () => {
  it('reads clash, absence, payment, outside -- each from the loaded window only', () => {
    const clashA = lesson('t-1', '18:00', '18:30')
    const clashB = lesson('t-1', '18:00', '19:00')
    const inLeave1 = lesson('t-2', '18:00', '18:30')
    const inLeave2 = lesson('t-2', '19:00', '19:30')
    const held = lesson('t-3', '17:00', '17:30', { suspendedFor: 'payment' })
    const late1 = lesson('t-3', '21:00', '21:30', { outsideShift: true })
    const late2 = lesson('t-3', '21:30', '22:00', { outsideShift: true })
    const found = findIssues({
      days: [day('t-1'), day('t-2', { leave: [[at('13:00'), at('21:00')]] }), day('t-3')],
      lessons: [late2, held, inLeave2, clashB, late1, inLeave1, clashA],
    })
    expect(found.issues.map((i) => i.kind)).toEqual(['conflict', 'absent', 'payment', 'outside'])
    expect(found.issues[1]!.lessons.map((l) => l.id)).toEqual([inLeave1.id, inLeave2.id])
    // A teacher's lessons outside working hours are one item, earliest first.
    expect(found.issues[3]!.lessons.map((l) => l.id)).toEqual([late1.id, late2.id])
    expect(found.clashing).toEqual(new Set([clashA.id, clashB.id]))
    expect(found.uncovered).toEqual(new Set([inLeave1.id, inLeave2.id]))
    expect(found.absent.has(`t-2|${D}`)).toBe(true)
    expect([...(found.byCell.get(`t-3|${D}`) ?? [])].sort()).toEqual(['outside', 'payment'])
  })

  it('leave with no lesson in it asks nothing; another supervisor\'s child is never named but still clashes', () => {
    const anon = { ...lesson('t-1', '18:00', '18:30'), anonymous: true } as unknown as CalendarLesson
    const mine = lesson('t-1', '18:15', '18:45')
    const found = findIssues({ days: [day('t-1'), day('t-2', { leave: [[at('13:00'), at('21:00')]] })], lessons: [anon, mine] })
    expect(found.issues.map((i) => i.kind)).toEqual(['conflict'])
    expect(found.absent.size).toBe(0)
  })
})

describe('the day\'s hours', () => {
  it('run from the earliest working hour to the latest end plus half an hour, and never clip a lesson', () => {
    expect(hourRange([day('t-1'), day('t-2', { shift: [], work: [[at('12:30'), at('20:00')]] })], [])).toEqual({ lo: 12 * 60, hi: 21 * 60 + 30 })
    expect(hourRange([day('t-1')], [lesson('t-1', '22:00', '22:30', { outsideShift: true })])).toEqual({ lo: 13 * 60, hi: 23 * 60 })
  })
})
