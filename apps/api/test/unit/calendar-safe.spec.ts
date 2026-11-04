import { leaveFromToday, offsetInOneYear, plusDays } from '../integration/calendar-safe';

/**
 * The integration fixtures' dates hold on every day: each day of 2026-2028
 * (a leap year included) is taken as "today", and every window the specs
 * ask for is checked against the calendar rule it must keep.
 */
const days: string[] = [];
for (let d = '2026-01-01'; d <= '2028-12-31'; d = plusDays(d, 1)) days.push(d);

/** Every (from, before, after) the integration specs ask offsetInOneYear for. */
const WINDOWS: Array<[number, number, number]> = [
  [30, 0, 1], // pd026-operations-access: a two-day leave a month out
  [40, 0, 1],
  [50, 0, 1],
  [29, 0, 3], // the leave around a lesson 30 days out (day - 1 .. day + 2)
];

describe('calendar-safe fixture dates', () => {
  it('covers the boundary days the specs broke on', () => {
    for (const d of ['2026-11-01', '2026-11-11', '2026-11-30', '2026-12-01', '2026-12-31', '2028-02-29']) expect(days).toContain(d);
  });

  it('offsetInOneYear: the window lies in one calendar year, as near as possible to what was asked', () => {
    for (const today of days) {
      for (const [from, before, after] of WINDOWS) {
        const n = offsetInOneYear(today, from, before, after);
        expect(n).toBeGreaterThanOrEqual(from);
        expect(n - from).toBeLessThanOrEqual(after - before); // moves only past the boundary
        const first = plusDays(today, n + before);
        const last = plusDays(today, n + after);
        expect([today, from, first.slice(0, 4)]).toEqual([today, from, last.slice(0, 4)]);
        if (plusDays(today, from + before).slice(0, 4) === plusDays(today, from + after).slice(0, 4)) expect(n).toBe(from);
      }
    }
  });

  it('two windows asked 10 days apart never land on the same days', () => {
    for (const today of days) {
      const a = offsetInOneYear(today, 40, 0, 1);
      const b = offsetInOneYear(today, 50, 0, 1);
      expect(b - a).toBeGreaterThanOrEqual(2);
    }
  });

  it('leaveFromToday: starts today, never crosses 31 December, and says how many days it covers', () => {
    for (const today of days) {
      for (const want of [1, 2, 3, 5]) {
        const l = leaveFromToday(today, want);
        expect(l.firstDay).toBe(today);
        expect(l.lastDay.slice(0, 4)).toBe(today.slice(0, 4));
        expect(l.lastDay >= today).toBe(true);
        expect(l.days).toBe(Math.min(want, l.days));
        expect(plusDays(today, l.days - 1)).toBe(l.lastDay);
        if (plusDays(today, want - 1).slice(0, 4) === today.slice(0, 4)) expect(l.days).toBe(want);
      }
    }
  });
});
