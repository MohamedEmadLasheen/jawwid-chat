import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clock12In, hour12Label, wallClock12 } from './academyTime'

/**
 * The Schedule reads every time on a 12-hour clock (owner, 2026-10-28): "5:00 PM",
 * Arabic "٥:٠٠ م". One shared formatter, on the academy's clock (PD-22) -- the
 * browser here is pinned to Los Angeles, so a browser-local reading would differ.
 */
const original = process.env.TZ
beforeAll(() => {
  process.env.TZ = 'America/Los_Angeles'
})
afterAll(() => {
  process.env.TZ = original
})

describe('the 12-hour clock', () => {
  it('an instant on the academy clock, in English and Arabic', () => {
    // 15:00 UTC on 26 Oct is 18:00 in Cairo (UTC+3 until the 29th).
    expect(clock12In('2026-10-26T15:00:00Z', 'Africa/Cairo', 'en')).toBe('6:00 PM')
    expect(clock12In('2026-10-26T15:00:00Z', 'Africa/Cairo', 'ar')).toBe('٦:٠٠ م')
    expect(clock12In('2026-10-26T06:30:00Z', 'Africa/Cairo', 'en')).toBe('9:30 AM')
    expect(clock12In('2026-10-26T06:30:00Z', 'Africa/Cairo', 'ar')).toBe('٩:٣٠ ص')
  })

  it('midnight and noon are 12, never 0', () => {
    expect(clock12In('2026-10-25T21:00:00Z', 'Africa/Cairo', 'en')).toBe('12:00 AM')
    expect(clock12In('2026-10-26T09:00:00Z', 'Africa/Cairo', 'en')).toBe('12:00 PM')
  })

  it('an hour of the day for an axis: short, and 24 is the next midnight', () => {
    expect(hour12Label(0, 'en')).toBe('12 AM')
    expect(hour12Label(13, 'en')).toBe('1 PM')
    expect(hour12Label(24, 'en')).toBe('12 AM')
    expect(hour12Label(13, 'ar')).toBe('١ م')
  })

  it('a wall-clock "HH:MM" (a shift window, a filter) reads the same way', () => {
    expect(wallClock12('17:00', 'en')).toBe('5:00 PM')
    expect(wallClock12('12:30', 'ar')).toBe('١٢:٣٠ م')
    expect(wallClock12('24:00', 'en')).toBe('12:00 AM')
    expect(wallClock12('bad', 'en')).toBe('bad')
  })
})
