import { describe, expect, it } from 'vitest'
import { academyWallClockToIso, clockIn, familyTime, isoToAcademyWallClock, zoneLabel } from './academyTime'

// PD-22. Egypt observes daylight saving; the Gulf does not.
describe('academy time', () => {
  it('reads a typed Cairo wall clock with that date\'s own offset', () => {
    expect(academyWallClockToIso('2026-07-06', '17:00')).toBe('2026-07-06T14:00:00.000Z')
    expect(academyWallClockToIso('2026-12-07', '17:00')).toBe('2026-12-07T15:00:00.000Z')
    expect(academyWallClockToIso('2026-12-07', '5pm')).toBeNull()
  })

  it('turns an instant back into the Cairo wall clock, whatever the browser zone', () => {
    expect(isoToAcademyWallClock('2026-12-07T21:30:00.000Z')).toEqual({ date: '2026-12-07', time: '23:30' })
  })

  it('shows the family\'s time only when it differs, with the weekday when that differs too', () => {
    // 15:00 UTC in December: 17:00 Cairo, 18:00 Kuwait.
    expect(familyTime('2026-12-10T15:00:00Z', 'Asia/Kuwait', 'en')).toBe('18:00 Kuwait time')
    // In July Cairo is UTC+3 like Kuwait: nothing to add.
    expect(familyTime('2026-07-09T15:00:00Z', 'Asia/Kuwait', 'en')).toBeNull()
    expect(familyTime('2026-12-10T15:00:00Z', 'Africa/Cairo', 'en')).toBeNull()
    expect(familyTime('2026-12-10T15:00:00Z', null, 'en')).toBeNull()
    // Monday 23:30 Cairo is Tuesday 00:30 in Riyadh.
    expect(familyTime('2026-12-07T21:30:00Z', 'Asia/Riyadh', 'en')).toBe('Tue 00:30 Riyadh time')
  })

  it('names zones in both languages', () => {
    expect(zoneLabel('Africa/Cairo', 'en')).toBe('Cairo time')
    expect(zoneLabel('Africa/Cairo', 'ar')).toBe('بتوقيت القاهرة')
    expect(clockIn('2026-12-10T15:00:00Z', 'Africa/Cairo', 'en')).toBe('17:00')
  })
})
