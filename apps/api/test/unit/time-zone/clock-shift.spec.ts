import { clockIn, dayIn, localDate, readerClockShifts, weeklyStartsAround } from '../../../src/platform/time-zone';

/**
 * PD-22 daylight-saving warning. Egypt's summer time ends at the END of the last
 * Thursday of October (2026-10-29: Thursday is still UTC+3, Friday is UTC+2) and
 * starts on the last Friday of April. The Gulf has no summer time; London changes
 * on another date (2026-10-25). Weekly lessons stay anchored in the teacher's zone.
 */
const CAIRO = 'Africa/Cairo';
const iso = (dates: Date[]) => dates.map((d) => d.toISOString());

describe('weeklyStartsAround', () => {
  it('gives four starts from a week before now, each at the slot\'s own wall clock', () => {
    // Friday 17:00 Cairo, seen on Thursday 22 October 2026.
    expect(iso(weeklyStartsAround(5, 17 * 60, CAIRO, new Date('2026-10-22T12:00:00Z')))).toEqual([
      '2026-10-16T14:00:00.000Z',
      '2026-10-23T14:00:00.000Z',
      '2026-10-30T15:00:00.000Z', // the first Friday in winter time
      '2026-11-06T15:00:00.000Z',
    ]);
  });

  it('keeps Thursday 29 October in summer time: the change is at the end of that day', () => {
    expect(iso(weeklyStartsAround(4, 17 * 60, CAIRO, new Date('2026-10-27T12:00:00Z')))).toEqual([
      '2026-10-22T14:00:00.000Z',
      '2026-10-29T14:00:00.000Z',
      '2026-11-05T15:00:00.000Z',
      '2026-11-12T15:00:00.000Z',
    ]);
  });
});

describe('weeklyStartsAround, an hour before the first lesson at the new time', () => {
  it('still holds the pair across the change, though the two are 7 days and 1 hour apart', () => {
    const starts = weeklyStartsAround(5, 17 * 60, CAIRO, new Date('2026-10-30T14:30:00Z'));
    expect(iso(readerClockShifts(starts, 'Asia/Kuwait'))).toEqual(['2026-10-30T15:00:00.000Z']);
  });
});

describe('readerClockShifts', () => {
  const friday = weeklyStartsAround(5, 17 * 60, CAIRO, new Date('2026-10-22T12:00:00Z'));

  it('a parent in Kuwait: the Friday lesson moves from 17:00 to 18:00 on 30 October', () => {
    const shifts = readerClockShifts(friday, 'Asia/Kuwait');
    expect(iso(shifts)).toEqual(['2026-10-30T15:00:00.000Z']);
    expect(clockIn(friday[1]!, 'Asia/Kuwait', 'en')).toBe('17:00');
    expect(clockIn(friday[3]!, 'Asia/Kuwait', 'en')).toBe('18:00');
    expect(clockIn(shifts[0]!, 'Asia/Kuwait', 'en')).toBe('18:00');
    expect(dayIn(shifts[0]!, 'Asia/Kuwait', 'en')).toBe('Friday 30 October');
  });

  it('a parent in Cairo, like the teacher, sees nothing move', () => {
    expect(readerClockShifts(friday, CAIRO)).toEqual([]);
  });

  it('a parent in London sees two moves: their own change (25 Oct), then Egypt\'s (29 Oct)', () => {
    const monday = weeklyStartsAround(1, 17 * 60, CAIRO, new Date('2026-10-22T12:00:00Z'));
    // London 15:00 (BST) -> 14:00 (GMT) -> 15:00.
    expect(monday.map((at) => clockIn(at, 'Europe/London', 'en'))).toEqual(['15:00', '14:00', '15:00', '15:00']);
    expect(iso(readerClockShifts(monday, 'Europe/London'))).toEqual(['2026-10-26T14:00:00.000Z', '2026-11-02T15:00:00.000Z']);
  });

  it('counts a move to another weekday: Wednesday 23:30 Cairo becomes Thursday 00:30 in Riyadh', () => {
    const late = weeklyStartsAround(3, 23 * 60 + 30, CAIRO, new Date('2026-10-27T12:00:00Z'));
    const shifts = readerClockShifts(late, 'Asia/Riyadh');
    expect(iso(shifts)).toEqual(['2026-11-04T21:30:00.000Z']);
    expect(dayIn(shifts[0]!, 'Asia/Riyadh', 'en')).toBe('Thursday 5 November');
    expect(clockIn(shifts[0]!, 'Asia/Riyadh', 'en')).toBe('00:30');
  });

  it('Thursday 29 October 23:30 Cairo happens twice (24:00 -> 23:00); it is read as winter time, as Postgres does', () => {
    const late = weeklyStartsAround(4, 23 * 60 + 30, CAIRO, new Date('2026-10-27T12:00:00Z'));
    expect(iso(late).slice(0, 2)).toEqual(['2026-10-22T20:30:00.000Z', '2026-10-29T21:30:00.000Z']);
    expect(iso(readerClockShifts(late, 'Asia/Riyadh'))).toEqual(['2026-10-29T21:30:00.000Z']);
  });

  it('a teacher in a zone without summer time: the Cairo parent is the one who moves', () => {
    const riyadh = weeklyStartsAround(5, 17 * 60, 'Asia/Riyadh', new Date('2026-10-22T12:00:00Z'));
    expect(readerClockShifts(riyadh, 'Asia/Riyadh')).toEqual([]);
    expect(iso(readerClockShifts(riyadh, CAIRO))).toEqual(['2026-10-30T14:00:00.000Z']); // 17:00 -> 16:00 Cairo
  });

  it('in April it moves back: Friday 30 April 2027 is the first lesson in summer time', () => {
    const april = weeklyStartsAround(5, 17 * 60, CAIRO, new Date('2027-04-26T12:00:00Z'));
    const shifts = readerClockShifts(april, 'Asia/Kuwait');
    expect(iso(shifts)).toEqual(['2027-04-30T14:00:00.000Z']);
    expect(clockIn(shifts[0]!, 'Asia/Kuwait', 'en')).toBe('17:00'); // was 18:00 all winter
  });

  it('nothing moves in a week without a change', () => {
    const december = weeklyStartsAround(5, 17 * 60, CAIRO, new Date('2026-12-02T12:00:00Z'));
    expect(readerClockShifts(december, 'Asia/Kuwait')).toEqual([]);
    expect(readerClockShifts(december, 'Europe/London')).toEqual([]);
  });
});

describe('localDate and dayIn', () => {
  it('is the calendar date in the zone, not in UTC', () => {
    expect(localDate(new Date('2026-11-05T21:30:00Z'), 'Asia/Riyadh')).toBe('2026-11-06');
    expect(localDate(new Date('2026-11-05T21:30:00Z'), CAIRO)).toBe('2026-11-05');
    expect(dayIn(new Date('2026-10-30T15:00:00Z'), 'Asia/Kuwait', 'ar')).toContain('أكتوبر');
  });
});
