import { localDate, wallClockToInstant } from '../platform/time-zone';

/**
 * PD-29 amendment: "this week" on a child's page is the academy's week,
 * SATURDAY to Friday, in the academy's time zone (config `schedule.timezone`,
 * Africa/Cairo by default) -- the same week for every family, wherever they
 * live. Returns the instant the current week began: Saturday 00:00 there.
 */
export function academyWeekStart(now: Date, zone: string): Date {
  const [y, m, d] = localDate(now, zone).split('-').map(Number) as [number, number, number];
  const today = new Date(Date.UTC(y, m - 1, d));
  const sinceSaturday = (today.getUTCDay() + 1) % 7; // Sat 0, Sun 1, ... Fri 6
  const start = new Date(Date.UTC(y, m - 1, d - sinceSaturday));
  return wallClockToInstant(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate(), 0, zone);
}
