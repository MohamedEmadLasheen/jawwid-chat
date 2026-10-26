import { describe, expect, it } from 'vitest'
import {
  academyToday,
  activeFilterCount,
  apiQuery,
  clearFilters,
  daysOf,
  minuteOfDay,
  parseViewState,
  rangeFor,
  step,
  toParams,
  weekStart,
} from './viewState'

/** PD-38: what the schedule shows, from and to the URL, on the academy's days. */

describe('the academy day', () => {
  it('is Cairo\'s, not the browser\'s: 23:30 UTC on the 25th is already the 26th in Cairo', () => {
    expect(academyToday(new Date('2026-10-25T23:30:00Z'))).toBe('2026-10-26')
  })

  it('places an instant on the Cairo clock of a day, clamped to that day', () => {
    // Before the clock change (29 Oct) Cairo is UTC+3; after it, UTC+2.
    expect(minuteOfDay('2026-10-26T09:00:00Z', '2026-10-26')).toBe(12 * 60)
    expect(minuteOfDay('2026-10-31T10:00:00Z', '2026-10-31')).toBe(12 * 60)
    expect(minuteOfDay('2026-10-26T21:00:00Z', '2026-10-26')).toBe(1440) // midnight: the next day
    expect(minuteOfDay('2026-10-25T20:00:00Z', '2026-10-26')).toBe(0)
  })
})

describe('ranges', () => {
  it('a week runs Saturday to Friday', () => {
    expect(weekStart('2026-10-24')).toBe('2026-10-24') // Saturday
    expect(weekStart('2026-10-25')).toBe('2026-10-24') // Sunday
    expect(weekStart('2026-10-30')).toBe('2026-10-24') // Friday
    expect(rangeFor('week', '2026-10-28')).toEqual({ from: '2026-10-24', to: '2026-10-31' })
  })

  it('a day and a month', () => {
    expect(rangeFor('day', '2026-10-31')).toEqual({ from: '2026-10-31', to: '2026-11-01' })
    expect(rangeFor('month', '2026-02-14')).toEqual({ from: '2026-02-01', to: '2026-03-01' })
    expect(daysOf('2026-02-27', '2026-03-02')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01'])
  })

  it('steps by the view', () => {
    expect(step('day', '2026-10-31', 1)).toBe('2026-11-01')
    expect(step('week', '2026-10-31', -1)).toBe('2026-10-24')
    expect(step('month', '2026-01-31', 1)).toBe('2026-02-01')
  })
})

describe('the URL', () => {
  it('defaults to this week, and reads every filter back', () => {
    const empty = parseViewState(new URLSearchParams(''), '2026-10-26')
    expect(empty).toMatchObject({ view: 'week', date: '2026-10-26', scalars: {} })
    expect(activeFilterCount(empty)).toBe(0)
    const s = parseViewState(
      new URLSearchParams('view=month&date=2026-10-05&teacherIds=t1,t2&supervisorIds=none&timeFrom=12:00&onlyMatching=false&view2=x'),
      '2026-10-26',
    )
    expect(s.view).toBe('month')
    expect(s.lists.teacherIds).toEqual(['t1', 't2'])
    expect(s.lists.supervisorIds).toEqual(['none'])
    expect(activeFilterCount(s)).toBe(3)
    expect(parseViewState(toParams(s), '2026-10-26')).toEqual(s)
  })

  it('a bad view or date falls back rather than failing', () => {
    expect(parseViewState(new URLSearchParams('view=year&date=26/10'), '2026-10-26')).toMatchObject({ view: 'week', date: '2026-10-26' })
  })

  it('asks the API for the view\'s days and exactly the filters set', () => {
    const s = parseViewState(new URLSearchParams('view=week&date=2026-10-28&categories=full_shift&emptyMinutesGte=120'), '2026-10-26')
    expect(apiQuery(s)).toEqual({ from: '2026-10-24', to: '2026-10-31', categories: 'full_shift', emptyMinutesGte: '120' })
    expect(apiQuery(clearFilters(s))).toEqual({ from: '2026-10-24', to: '2026-10-31' })
  })
})
