/**
 * PD-22: time zones, pure helpers. No database, no clock.
 *
 * The rule every caller follows: a moment is stored as an instant, and turned
 * into words only for ONE reader, in that reader's zone. Text that several
 * people read (a card in a group) names the zone it was written in.
 */

/** The academy's zone when nothing better is known (ADR-010). */
export const ACADEMY_ZONE = 'Africa/Cairo';

/** "Region/City" (and "Region/Country/City"), or UTC. Offsets like "+03:00" are not zones. */
const ZONE_SHAPE = /^(?:UTC|[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){1,2})$/;

/**
 * The IANA name as the phone spelled it, with its letter case fixed
 * ("asia/kuwait" -> "Asia/Kuwait"), or null when it is not a zone. A current
 * name is kept even where Node's ICU would answer with an older alias (it
 * resolves "Asia/Kolkata" to "Asia/Calcutta"): the phone, the app and Postgres
 * all know the current one. The database re-checks against pg_timezone_names
 * (chat.guard_actor_time_zone).
 */
export function canonicalZone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > 64 || !ZONE_SHAPE.test(value)) return null;
  try {
    const resolved = new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
    return resolved.toLowerCase() === value.toLowerCase() ? resolved : value;
  } catch {
    return null;
  }
}

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
  UTC: 'UTC',
};

/** "Cairo" / "القاهرة" -- the city of a zone, for a label like "17:00 Cairo time". */
export function zoneCity(zone: string, lang: 'ar' | 'en'): string {
  if (lang === 'ar' && CITY_AR[zone]) return CITY_AR[zone]!;
  const last = zone.split('/').pop() ?? zone;
  return last.replace(/_/g, ' ');
}

/** "Cairo time" / "بتوقيت القاهرة". */
export function zoneLabel(zone: string, lang: 'ar' | 'en'): string {
  return lang === 'ar' ? `بتوقيت ${zoneCity(zone, 'ar')}` : `${zoneCity(zone, 'en')} time`;
}

/** "17:00" / "٥:٠٠ م" -- the clock time of an instant in a zone. */
export function clockIn(at: Date, zone: string, lang: 'ar' | 'en'): string {
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
}

/**
 * "Friday 23 October, 17:00 (Cairo time)" -- a moment written into text that more
 * than one person reads. It always names its zone, so nobody in another country
 * takes it for their own clock. Clients that know the card draw `startsAt` in
 * the reader's zone instead.
 */
export function whenWithZone(at: Date, zone: string, lang: 'ar' | 'en'): string {
  const text = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-GB', {
    timeZone: zone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
  return `${text} (${zoneLabel(zone, lang)})`;
}

/** The zone's offset from UTC at an instant, in minutes (Cairo in summer: +180). */
function offsetMinutes(at: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** The local calendar date of an instant in a zone. */
function localDay(at: Date, zone: string): { y: number; m: number; d: number } {
  const shifted = new Date(at.getTime() + offsetMinutes(at, zone) * 60_000);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
}

/**
 * The instant of a wall-clock time in a zone. Two passes, so a date on either
 * side of a daylight-saving change gets that date's own offset -- the same
 * answer as Postgres `(date + time) AT TIME ZONE zone`.
 */
export function wallClockToInstant(y: number, m: number, d: number, minuteOfDay: number, zone: string): Date {
  const naive = Date.UTC(y, m - 1, d, 0, minuteOfDay);
  let at = new Date(naive - offsetMinutes(new Date(naive), zone) * 60_000);
  at = new Date(naive - offsetMinutes(at, zone) * 60_000);
  return at;
}

/**
 * The next start of a weekly slot ("Monday 17:00 in Africa/Cairo") at or after
 * `now`. A reader in another zone sees THIS instant in their own zone -- which
 * may be another weekday (Cairo 23:30 Monday is 00:30 Tuesday in Riyadh), so a
 * client never converts the bare "HH:MM" by itself.
 */
export function nextWeeklyStart(isoWeekday: number, minuteOfDay: number, zone: string, now: Date = new Date()): Date {
  const today = localDay(now, zone);
  for (let ahead = 0; ahead <= 7; ahead += 1) {
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d + ahead));
    const dow = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
    if (dow !== isoWeekday) continue;
    const at = wallClockToInstant(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), minuteOfDay, zone);
    if (at.getTime() >= now.getTime()) return at;
  }
  // Unreachable for a weekday in 1..7: day 7 is today's weekday a week on.
  throw new RangeError(`isoWeekday ${isoWeekday} is not 1..7`);
}

/** "Sunday 1 November" / "الأحد ١ نوفمبر" -- the local date of an instant in a zone. */
export function dayIn(at: Date, zone: string, lang: 'ar' | 'en'): string {
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-GB', {
    timeZone: zone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(at);
}

/** "2026-10-29" -- the local calendar date of an instant in a zone. */
export function localDate(at: Date, zone: string): string {
  const { y, m, d } = localDay(at, zone);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** "4 17:00" -- ISO weekday and clock of an instant in a zone: what a reader calls "the time" of a weekly lesson. */
function weekClock(at: Date, zone: string): string {
  const shifted = new Date(at.getTime() + offsetMinutes(at, zone) * 60_000);
  const dow = shifted.getUTCDay() === 0 ? 7 : shifted.getUTCDay();
  return `${dow} ${shifted.toISOString().slice(11, 16)}`;
}

/**
 * Four consecutive starts of a weekly slot, from about a week before `now`: the
 * last start before now is always among them, and so are the next two. Each is
 * the slot's wall clock in ITS zone on its own date, so a clock change in that
 * zone moves nothing there (and two starts across it are 7 days +-1 hour apart,
 * which is why the window opens 8 days back, not 7).
 */
export function weeklyStartsAround(isoWeekday: number, minuteOfDay: number, zone: string, now: Date): Date[] {
  const starts = [nextWeeklyStart(isoWeekday, minuteOfDay, zone, new Date(now.getTime() - 8 * 86_400_000))];
  while (starts.length < 4) {
    starts.push(nextWeeklyStart(isoWeekday, minuteOfDay, zone, new Date(starts[starts.length - 1]!.getTime() + 1)));
  }
  return starts;
}

/**
 * PD-22 daylight-saving warning: of consecutive weekly starts, each one a
 * reader in `readerZone` sees at another weekday or clock time than the start
 * before it -- the first lesson at the new local time. Empty when the reader's
 * clock and the slot's zone moved together (or neither moved).
 */
export function readerClockShifts(starts: readonly Date[], readerZone: string): Date[] {
  const shifts: Date[] = [];
  for (let i = 1; i < starts.length; i += 1) {
    if (weekClock(starts[i - 1]!, readerZone) !== weekClock(starts[i]!, readerZone)) shifts.push(starts[i]!);
  }
  return shifts;
}
