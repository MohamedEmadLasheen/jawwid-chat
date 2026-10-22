import {
  canonicalZone,
  clockIn,
  nextWeeklyStart,
  wallClockToInstant,
  whenWithZone,
  zoneLabel,
} from '../../../src/platform/time-zone';

/**
 * PD-22. Egypt observes daylight saving (UTC+3 in summer, +2 in winter since
 * 2023); the Gulf does not. These fixtures cross that line on purpose.
 */
describe('canonicalZone', () => {
  it('accepts IANA names and canonicalises letter case', () => {
    expect(canonicalZone('Asia/Kuwait')).toBe('Asia/Kuwait');
    expect(canonicalZone('asia/kuwait')).toBe('Asia/Kuwait');
    expect(canonicalZone(' Africa/Cairo ')).toBe('Africa/Cairo');
    expect(canonicalZone('America/Argentina/Buenos_Aires')).toBe('America/Argentina/Buenos_Aires');
    expect(canonicalZone('UTC')).toBe('UTC');
  });

  it('keeps a current name that Node\'s ICU would answer with an old alias', () => {
    expect(canonicalZone('Asia/Kolkata')).toBe('Asia/Kolkata');
  });

  it('refuses offsets, unknown names and non-strings', () => {
    for (const bad of ['+03:00', 'GMT+3', 'Mars/Olympus', '', 'Cairo', 42, null, undefined, 'A/'.repeat(40)]) {
      expect(canonicalZone(bad)).toBeNull();
    }
  });
});

describe('wallClockToInstant', () => {
  it('uses the offset of the date itself on both sides of Egypt\'s clock change', () => {
    // 17:00 Cairo in July (UTC+3) and in December (UTC+2).
    expect(wallClockToInstant(2026, 7, 6, 17 * 60, 'Africa/Cairo').toISOString()).toBe('2026-07-06T14:00:00.000Z');
    expect(wallClockToInstant(2026, 12, 7, 17 * 60, 'Africa/Cairo').toISOString()).toBe('2026-12-07T15:00:00.000Z');
  });

  it('is fixed for a zone without daylight saving', () => {
    expect(wallClockToInstant(2026, 7, 6, 18 * 60, 'Asia/Kuwait').toISOString()).toBe('2026-07-06T15:00:00.000Z');
    expect(wallClockToInstant(2026, 12, 7, 18 * 60, 'Asia/Kuwait').toISOString()).toBe('2026-12-07T15:00:00.000Z');
  });
});

describe('nextWeeklyStart', () => {
  // Thursday 2026-10-22 12:00 UTC.
  const now = new Date('2026-10-22T12:00:00Z');

  it('finds the next occurrence in the slot\'s own zone', () => {
    // Monday 17:00 Cairo -> Monday 2026-10-26. Egypt's summer time ends on the
    // last Thursday of October (2026-10-29), so the 26th is still UTC+3.
    expect(nextWeeklyStart(1, 17 * 60, 'Africa/Cairo', now).toISOString()).toBe('2026-10-26T14:00:00.000Z');
  });

  it('a family in Kuwait sees the same lesson move by an hour when Egypt changes its clocks', () => {
    const before = nextWeeklyStart(1, 17 * 60, 'Africa/Cairo', now);
    const after = nextWeeklyStart(1, 17 * 60, 'Africa/Cairo', new Date('2026-10-30T00:00:00Z'));
    expect(clockIn(before, 'Africa/Cairo', 'en')).toBe('17:00');
    expect(clockIn(after, 'Africa/Cairo', 'en')).toBe('17:00');
    expect(clockIn(before, 'Asia/Kuwait', 'en')).toBe('17:00');
    expect(clockIn(after, 'Asia/Kuwait', 'en')).toBe('18:00');
  });

  it('today counts while its time is still ahead, else a week on', () => {
    // Thursday 15:30 Cairo (12:30 UTC) is still ahead at 12:00 UTC.
    expect(nextWeeklyStart(4, 15 * 60 + 30, 'Africa/Cairo', now).toISOString()).toBe('2026-10-22T12:30:00.000Z');
    // Thursday 14:00 Cairo (11:00 UTC) has passed: next Thursday. Egypt's clocks
    // go back at the END of that Thursday, so it is still summer time.
    expect(nextWeeklyStart(4, 14 * 60, 'Africa/Cairo', now).toISOString()).toBe('2026-10-29T11:00:00.000Z');
    // The Thursday after is winter time.
    expect(nextWeeklyStart(4, 14 * 60, 'Africa/Cairo', new Date('2026-10-30T00:00:00Z')).toISOString()).toBe('2026-11-05T12:00:00.000Z');
  });

  it('a late Cairo lesson falls on the next weekday in Riyadh in winter', () => {
    // Monday 23:30 Cairo in winter (UTC+2) is 00:30 Tuesday in Riyadh (UTC+3).
    const at = nextWeeklyStart(1, 23 * 60 + 30, 'Africa/Cairo', new Date('2026-12-01T00:00:00Z'));
    expect(at.toISOString()).toBe('2026-12-07T21:30:00.000Z');
    expect(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', weekday: 'long' }).format(at)).toBe('Tuesday');
  });
});

describe('text read by more than one person names its zone', () => {
  const at = new Date('2026-10-23T14:00:00Z');

  it('in English and Arabic', () => {
    expect(whenWithZone(at, 'Africa/Cairo', 'en')).toBe('Friday 23 October at 17:00 (Cairo time)');
    expect(whenWithZone(at, 'Africa/Cairo', 'ar')).toContain('(بتوقيت القاهرة)');
  });

  it('labels zones it has no Arabic name for by their city', () => {
    expect(zoneLabel('America/Los_Angeles', 'en')).toBe('Los Angeles time');
    expect(zoneLabel('America/Los_Angeles', 'ar')).toBe('بتوقيت Los Angeles');
  });
});
