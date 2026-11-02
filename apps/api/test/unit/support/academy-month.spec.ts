/**
 * The month helpers the stats integration specs rely on. Pinned to the days
 * that broke them: the last day of a month (twice, including the last minutes
 * in Cairo, which is already the next month in UTC+2 terms), a 31-day month
 * before February, and a leap day.
 */
import { ACADEMY_ZONE, monthOf, monthsOf, sumCounts } from '../../support/academy-month';

const DAY = 86_400_000;

/** The month after YYYY-MM. */
function next(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** A lesson now and every day for `days` more days (like the materializer's horizon). */
function daily(days: number): number[] {
  return Array.from({ length: days + 1 }, (_, i) => Date.now() + i * DAY);
}

describe('academy months', () => {
  afterEach(() => jest.useRealTimers());

  it.each([
    ['2026-10-31T04:33:00Z', '2026-10', ['2026-10', '2026-11', '2026-12']],
    ['2027-01-31T10:00:00Z', '2027-01', ['2027-01', '2027-02', '2027-03']],
    ['2028-02-29T10:00:00Z', '2028-02', ['2028-02', '2028-03', '2028-04']],
    ['2026-10-31T21:59:00Z', '2026-10', ['2026-10', '2026-11', '2026-12']],
  ])('at %s no month is skipped', (now, current, lessonMonths) => {
    jest.useFakeTimers({ now: new Date(now) });
    expect(monthOf(Date.now())).toBe(current);

    const months = monthsOf(daily(35));
    expect(months).toEqual(lessonMonths);
    for (let i = 1; i < months.length; i++) expect(months[i]).toBe(next(months[i - 1]!));
  });

  it('the formula the specs used skipped the month in between', () => {
    jest.useFakeTimers({ now: new Date('2026-10-31T04:33:00Z') });
    const old = [monthOf(Date.now()), monthOf(Date.now() + 31 * DAY)];
    expect(old).toEqual(['2026-10', '2026-12']);
    expect(monthsOf(daily(35))).toContain('2026-11');
  });

  it("months are the academy's (Cairo), not UTC: 23:59 on the 31st is October, 00:59 is November", () => {
    expect(ACADEMY_ZONE).toBe('Africa/Cairo');
    expect(monthOf('2026-10-31T21:59:00Z')).toBe('2026-10');
    expect(monthOf('2026-10-31T22:59:00Z')).toBe('2026-11');
    expect(new Date('2026-10-31T22:59:00Z').toISOString().slice(0, 7)).toBe('2026-10');
  });

  it('a make-up 28 h ahead on the 31st falls in the next month, so "this month" alone misses it', () => {
    jest.useFakeTimers({ now: new Date('2026-10-31T04:33:00Z') });
    expect(monthOf(Date.now() + 28 * 3_600_000)).not.toBe(monthOf(Date.now()));
    expect(monthsOf([Date.now() - 3 * 3_600_000, Date.now() + 28 * 3_600_000])).toEqual(['2026-10', '2026-11']);
  });

  it('sumCounts adds every numeric field, nested ones too', () => {
    const a = { conducted: 1, makeups: { completed: 0, scheduled: 1, total: 1 }, label: 'x' };
    const b = { conducted: 1, makeups: { completed: 1, scheduled: 0, total: 1 }, label: 'y' };
    expect(sumCounts([a, b])).toEqual({ conducted: 2, makeups: { completed: 1, scheduled: 1, total: 2 }, label: 'x' });
    expect(sumCounts([a])).toBe(a);
  });
});
