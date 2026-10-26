/**
 * PD-22: Admin Web shows every lesson and call time in the academy's zone, NAMED
 * ("17:00 Cairo time"), with the family's local time beside it when the family is
 * elsewhere ("· 18:00 Kuwait time"). A staff member's own browser zone is never
 * used: two supervisors in two countries must read the same clock.
 *
 * Times typed into a form (a make-up, a one-off lesson) are Cairo wall-clock times
 * too, converted to an instant here, so what is typed is what the teacher sees.
 */

export type TimeLocale = 'ar' | 'en'

/** The academy's zone (chat.config schedule.timezone, ADR-010). */
export const ACADEMY_ZONE = 'Africa/Cairo'

const CITY_AR: Record<string, string> = {
  'Africa/Cairo': 'القاهرة',
  'Asia/Riyadh': 'الرياض',
  'Asia/Kuwait': 'الكويت',
  'Asia/Dubai': 'دبي',
  'Asia/Qatar': 'الدوحة',
  'Asia/Bahrain': 'البحرين',
  'Asia/Muscat': 'مسقط',
  'Asia/Amman': 'عمّان',
  'Asia/Baghdad': 'بغداد',
  'Asia/Beirut': 'بيروت',
  'Asia/Damascus': 'دمشق',
  'Asia/Aden': 'عدن',
  'Africa/Khartoum': 'الخرطوم',
  'Africa/Tripoli': 'طرابلس',
  'Africa/Tunis': 'تونس',
  'Africa/Algiers': 'الجزائر',
  'Africa/Casablanca': 'الدار البيضاء',
  'Europe/London': 'لندن',
  'Europe/Istanbul': 'إسطنبول',
  'Europe/Berlin': 'برلين',
  'Europe/Paris': 'باريس',
  'America/New_York': 'نيويورك',
  'America/Toronto': 'تورونتو',
  'Australia/Sydney': 'سيدني',
}

const tag = (locale: TimeLocale) => (locale === 'ar' ? 'ar-EG' : 'en-GB')

/** "Cairo" / "القاهرة". */
export function zoneCity(zone: string, locale: TimeLocale): string {
  if (locale === 'ar' && CITY_AR[zone]) return CITY_AR[zone]!
  return (zone.split('/').pop() ?? zone).replace(/_/g, ' ')
}

/** "Cairo time" / "بتوقيت القاهرة". */
export function zoneLabel(zone: string, locale: TimeLocale): string {
  return locale === 'ar' ? `بتوقيت ${zoneCity(zone, 'ar')}` : `${zoneCity(zone, 'en')} time`
}

/** "17:00" -- the clock time of an instant in a zone. */
export function clockIn(iso: string, zone: string, locale: TimeLocale): string {
  return new Intl.DateTimeFormat(tag(locale), { timeZone: zone, hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

/** "Mon" / "الاثنين" -- the weekday of an instant in a zone. */
export function weekdayIn(iso: string, zone: string, locale: TimeLocale): string {
  return new Intl.DateTimeFormat(tag(locale), { timeZone: zone, weekday: 'short' }).format(new Date(iso))
}

function offsetMinutes(at: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at)
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0')
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'))
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000)
}

/**
 * The family's local time beside the academy's, or null when the family's zone
 * is unknown or reads the same clock at that moment: "Tue 00:30 Riyadh time".
 * The weekday is included only when it differs from the academy's.
 */
export function familyTime(iso: string, familyZone: string | null | undefined, locale: TimeLocale): string | null {
  if (!familyZone || familyZone === ACADEMY_ZONE) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  if (offsetMinutes(at, familyZone) === offsetMinutes(at, ACADEMY_ZONE)) return null
  const day = weekdayIn(iso, familyZone, locale)
  const sameDay = day === weekdayIn(iso, ACADEMY_ZONE, locale)
  return `${sameDay ? '' : `${day} `}${clockIn(iso, familyZone, locale)} ${zoneLabel(familyZone, locale)}`
}

/**
 * A wall-clock date and time typed in the academy's zone ("2026-10-25", "17:00")
 * as an ISO instant. Two passes, so each date gets its own daylight-saving offset.
 * Null for a malformed input.
 */
export function academyWallClockToIso(date: string, time: string, zone = ACADEMY_ZONE): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const t = /^(\d{2}):(\d{2})$/.exec(time)
  if (!d || !t) return null
  const naive = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]))
  let at = new Date(naive - offsetMinutes(new Date(naive), zone) * 60_000)
  at = new Date(naive - offsetMinutes(at, zone) * 60_000)
  return at.toISOString()
}

/** An instant as the academy's wall clock: { date: '2026-10-25', time: '17:00' }. */
export function isoToAcademyWallClock(iso: string, zone = ACADEMY_ZONE): { date: string; time: string } {
  const at = new Date(iso)
  const shifted = new Date(at.getTime() + offsetMinutes(at, zone) * 60_000).toISOString()
  return { date: shifted.slice(0, 10), time: shifted.slice(11, 16) }
}

/** "3 Nov" / "٣ نوفمبر" -- the calendar day of an instant in a zone. */
export function dayMonthIn(iso: string, zone: string, locale: TimeLocale): string {
  return new Intl.DateTimeFormat(tag(locale), { timeZone: zone, day: 'numeric', month: 'short' }).format(new Date(iso))
}

/** "Mon 27 Oct 17:00" -- an instant as one short line in a zone (PD-31 summaries). */
export function whenIn(iso: string, zone: string, locale: TimeLocale): string {
  return `${weekdayIn(iso, zone, locale)} ${dayMonthIn(iso, zone, locale)} ${clockIn(iso, zone, locale)}`
}

/** The ISO weekday (1 = Monday … 7 = Sunday) of an instant in a zone. */
export function isoWeekdayIn(iso: string, zone = ACADEMY_ZONE): number {
  const { date } = isoToAcademyWallClock(iso, zone)
  const d = new Date(`${date}T12:00:00Z`).getUTCDay()
  return d === 0 ? 7 : d
}
