/**
 * Fixture dates that hold on any day of the year.
 *
 * A fixture written as "today + N days" is a date bomb when what it builds may
 * not cross a calendar boundary: LeaveService refuses a leave across two
 * calendar years ("a leave request stays inside one calendar year"), and on
 * 2026-11-01 a two-day leave from today+60 crossed 31 December and turned
 * G-19 red on every PR. These helpers keep the spacing a test asks for, and
 * move or cut it only on the days it would cross. Proven for every day of
 * 2026-2028 by test/unit/calendar-safe.spec.ts.
 *
 * Days are ISO dates (YYYY-MM-DD), in UTC, as the specs' own plusDays.
 */

export function plusDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

const year = (day: string) => day.slice(0, 4);

/**
 * The first day offset at or after `from` whose window [offset + before,
 * offset + after] lies inside one calendar year. Usually `from` itself; near
 * the year's end, the first offset in the next year that fits.
 */
export function offsetInOneYear(today: string, from: number, before = 0, after = 0): number {
  for (let n = from; ; n += 1) {
    if (year(plusDays(today, n + before)) === year(plusDays(today, n + after))) return n;
  }
}

/**
 * A leave of `days` days starting today (a teacher away now), cut at
 * 31 December: a request never crosses a year. `days` is how many it covers.
 */
export function leaveFromToday(today: string, days: number): { firstDay: string; lastDay: string; days: number } {
  const wanted = plusDays(today, days - 1);
  const lastDay = year(wanted) === year(today) ? wanted : `${year(today)}-12-31`;
  const covered = Math.round((Date.parse(`${lastDay}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) + 1;
  return { firstDay: today, lastDay, days: covered };
}
