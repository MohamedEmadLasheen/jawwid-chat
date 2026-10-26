import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { academyDayRange } from './academyTime'
import { academyDateTime, toDateInput, toTimeInput } from '@/features/calls-page/model'

/**
 * PD-22: Admin Web reads and writes the ACADEMY's clock (Cairo), never the
 * browser's. These run with the process pinned to Los Angeles -- ten hours
 * behind Cairo in November, so its midnight and its "17:00" are other moments.
 */
const original = process.env.TZ
beforeAll(() => {
  process.env.TZ = 'America/Los_Angeles'
})
afterAll(() => {
  process.env.TZ = original
})

describe('Admin Web uses the academy clock, whatever the browser zone', () => {
  it('the zone is really pinned (the control)', () => {
    // 23:30 UTC is 15:30 in Los Angeles: a browser-local reading would see 15.
    expect(new Date('2026-11-05T23:30:00Z').getHours()).toBe(15)
  })

  it('a date range starts at Cairo midnight, not the browser\'s (Teacher File)', () => {
    // 23:30 UTC on 5 Nov is already 01:30 on 6 Nov in Cairo (UTC+2 after 29 Oct).
    const r = academyDayRange(14, new Date('2026-11-05T23:30:00Z'))
    expect(r.from).toBe('2026-11-05T22:00:00.000Z')
    expect(r.to).toBe('2026-11-19T22:00:00.000Z')
  })

  it('a range across Egypt\'s clock change is still whole Cairo days', () => {
    // 28 Oct 2026 Cairo is UTC+3; from 30 Oct, UTC+2.
    const r = academyDayRange(3, new Date('2026-10-28T10:00:00Z'))
    expect(r.from).toBe('2026-10-27T21:00:00.000Z')
    expect(r.to).toBe('2026-10-30T22:00:00.000Z')
  })

  it('a call typed as 6 Nov 17:00 is 17:00 Cairo time (Calls dialog)', () => {
    expect(academyDateTime('2026-11-06', '17:00')?.toISOString()).toBe('2026-11-06T15:00:00.000Z')
    expect(academyDateTime('6/11', '17:00')).toBeNull()
  })

  it('the dialog\'s inputs show an instant on the Cairo clock', () => {
    const at = new Date('2026-11-05T23:30:00Z')
    expect(toDateInput(at)).toBe('2026-11-06')
    expect(toTimeInput(at)).toBe('01:30')
    // What is shown round-trips to the same instant.
    expect(academyDateTime(toDateInput(at), toTimeInput(at))?.toISOString()).toBe(at.toISOString())
  })
})
