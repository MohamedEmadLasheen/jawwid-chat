import { useI18n } from '@/core/i18n/I18nProvider'
import { ACADEMY_ZONE } from '@/core/time/academyTime'

/**
 * When something happened, said the way a person says it, on the academy's
 * clock: "today at 9:56", "yesterday at 8:10", "24 November", and with the
 * year only when it is not this one. Western digits, month names in words.
 * No comma inside it, so it sits in a line of facts parted by commas.
 */
export function useWhen(): (iso: string, opts?: { start?: boolean }) => string {
  const { locale } = useI18n()
  const tag = locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB'
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: ACADEMY_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
  const clock = new Intl.DateTimeFormat(tag, { timeZone: ACADEMY_ZONE, hour: 'numeric', minute: '2-digit' })
  const day = useDay()
  const words = locale === 'ar' ? { today: 'اليوم', yesterday: 'أمس', at: ' ' } : { today: 'today', yesterday: 'yesterday', at: ' at ' }
  // A value that stands alone (`start`) begins with a capital in English: "Today at 9:56".
  const lead = (word: string, start?: boolean) => (start && locale === 'en' ? word[0]!.toUpperCase() + word.slice(1) : word)
  return (iso, opts) => {
    const at = new Date(iso)
    if (Number.isNaN(at.getTime())) return ''
    const now = Date.now()
    const key = dayKey.format(at)
    if (key === dayKey.format(now)) return `${lead(words.today, opts?.start)}${words.at}${clock.format(at)}`
    if (key === dayKey.format(now - 86_400_000)) return `${lead(words.yesterday, opts?.start)}${words.at}${clock.format(at)}`
    return day(iso)
  }
}

/** A clock time on the academy's clock, the way `useWhen` writes it ("9:47", "9:47 ص"). */
export function useClock(): (iso: string) => string {
  const { locale } = useI18n()
  const clock = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { timeZone: ACADEMY_ZONE, hour: 'numeric', minute: '2-digit' })
  return (iso) => clock.format(new Date(iso))
}

/** A day in words on the academy's clock ("4 December", "4 December 2025"): the year only when it is not this one. */
export function useDay(): (iso: string) => string {
  const { locale } = useI18n()
  const tag = locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB'
  const year = new Intl.DateTimeFormat('en-CA', { timeZone: ACADEMY_ZONE, year: 'numeric' })
  const sameYear = new Intl.DateTimeFormat(tag, { timeZone: ACADEMY_ZONE, day: 'numeric', month: 'long' })
  const otherYear = new Intl.DateTimeFormat(tag, { timeZone: ACADEMY_ZONE, day: 'numeric', month: 'long', year: 'numeric' })
  return (iso) => {
    const at = new Date(iso)
    if (Number.isNaN(at.getTime())) return ''
    return year.format(at) === year.format(Date.now()) ? sameYear.format(at) : otherYear.format(at)
  }
}
