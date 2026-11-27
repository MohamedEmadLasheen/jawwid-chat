import { LOCALE_TAG, useI18n } from '@/core/i18n/I18nProvider'

/**
 * Calendar dates (YYYY-MM-DD) and months (YYYY-MM) shown as that same day or
 * month in every time zone. The shared `date()` formatter reads an instant in
 * local time, which moves a date-only value to the previous day west of UTC.
 */
export function useCalendarDate() {
  const { locale } = useI18n()
  // Arabic reads the month's name (1 سبتمبر 2025), never a numeric date.
  const fmt = new Intl.DateTimeFormat(LOCALE_TAG[locale], locale === 'ar' ? { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' } : { dateStyle: 'medium', timeZone: 'UTC' })
  const monthFmt = new Intl.DateTimeFormat(LOCALE_TAG[locale], { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return {
    day: (ymd: string) => fmt.format(new Date(`${ymd}T00:00:00Z`)),
    month: (ym: string) => monthFmt.format(new Date(`${ym}-01T00:00:00Z`)),
  }
}
