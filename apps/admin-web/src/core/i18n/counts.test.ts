import { describe, expect, it } from 'vitest'
import { DAYS, HOURS, LESSONS, STEPS, TRIALS, countLabel, durationLabel } from './counts'

/** RQA-F2 / RQA-F8: Arabic nouns agree with their number; a long wait reads in days and hours. */
const ar = new Intl.NumberFormat('ar-EG-u-nu-latn')
const n = (x: number) => ar.format(x)

describe('countLabel', () => {
  it('Arabic: one, two, three-to-ten, eleven-and-more, zero and fractions', () => {
    expect(countLabel(1, n(1), LESSONS, 'ar')).toBe('حصة واحدة')
    expect(countLabel(2, n(2), LESSONS, 'ar')).toBe('حصتان')
    expect(countLabel(3, n(3), LESSONS, 'ar')).toBe('3 حصص')
    expect(countLabel(10, n(10), LESSONS, 'ar')).toBe('10 حصص')
    expect(countLabel(11, n(11), LESSONS, 'ar')).toBe('11 حصة')
    expect(countLabel(0, n(0), LESSONS, 'ar')).toBe('0 حصة')
    expect(countLabel(2.5, n(2.5), HOURS, 'ar')).toBe('2.5 ساعة')
    expect(countLabel(5, n(5), HOURS, 'ar')).toBe('5 ساعات')
    expect(countLabel(4, n(4), TRIALS, 'ar')).toBe('4 حصص تجريبية')
    expect(countLabel(2, n(2), STEPS, 'ar')).toBe('خطوتان')
    expect(countLabel(12, n(12), DAYS, 'ar')).toBe('12 يومًا')
  })

  it('English: singular for one, plural otherwise', () => {
    expect(countLabel(1, '1', LESSONS, 'en')).toBe('1 lesson')
    expect(countLabel(3, '3', LESSONS, 'en')).toBe('3 lessons')
    expect(countLabel(3, '3', STEPS, 'en')).toBe('3 steps')
  })
})

describe('durationLabel', () => {
  it('reads 5,506 minutes as days and hours, and short waits in minutes or hours', () => {
    const en = (x: number) => String(x)
    expect(durationLabel(5506, en, 'en')).toBe('3 days 19 h')
    expect(durationLabel(45, en, 'en')).toBe('45 min')
    expect(durationLabel(200, en, 'en')).toBe('3 h 20 min')
    expect(durationLabel(120, en, 'en')).toBe('2 h')
    expect(durationLabel(1440, en, 'en')).toBe('1 day')
    expect(durationLabel(5506, n, 'ar')).toBe('3 أيام و19 ساعة')
    expect(durationLabel(60, n, 'ar')).toBe('ساعة واحدة')
  })
})
