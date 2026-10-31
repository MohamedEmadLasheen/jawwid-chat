/**
 * Calendar months in the academy's zone, for specs that read StatsService by
 * month. A spec must ask for the months its lessons actually fall in -- never
 * "this month" or "today + N days", which on the last day(s) of a month name
 * the wrong month or skip one (2026-10-31 + 31 days is 2026-12-01, so
 * November was never read).
 */

/** stats.zone's default (AppConfigService), the zone StatsService.period() uses. */
export const ACADEMY_ZONE = 'Africa/Cairo';

/** The YYYY-MM an instant falls in, in `zone`. */
export function monthOf(instant: Date | string | number, zone = ACADEMY_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit' }).format(new Date(instant));
}

/** Every distinct month the instants fall in, oldest first. */
export function monthsOf(instants: Iterable<Date | string | number>, zone = ACADEMY_ZONE): string[] {
  return [...new Set([...instants].map((i) => monthOf(i, zone)))].sort();
}

/** Field-by-field sum of numeric summaries (nested objects too), for a figure spread over months. */
export function sumCounts<T>(parts: T[]): T {
  const add = (a: unknown, b: unknown): unknown => {
    if (typeof a === 'number' && typeof b === 'number') return a + b;
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      return Object.fromEntries(Object.keys(a).map((k) => [k, add((a as any)[k], (b as any)[k])]));
    }
    return a;
  };
  if (parts.length === 0) throw new Error('sumCounts: nothing to sum');
  return parts.slice(1).reduce((acc, p) => add(acc, p) as T, parts[0]!);
}
