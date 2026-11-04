/**
 * PD-45 PR-2b (plan §7): the time zone a location implies, as a READ-ONLY
 * estimate for staff where no zone exists, and the mismatch hint when a
 * parent's app clock disagrees with it. A location never writes a zone (PD-22).
 */
import { estimatedZoneOf, sameClock } from '../../../src/geo/zones';
import { suggestedCallingCode } from '../../../src/parent-profile/parent-phone-directory';

describe('PD-45 §7: the zone a country implies', () => {
  it.each([
    ['EG', 'Africa/Cairo'],
    ['SA', 'Asia/Riyadh'],
    ['AE', 'Asia/Dubai'],
    ['KW', 'Asia/Kuwait'],
    ['QA', 'Asia/Qatar'],
    ['BH', 'Asia/Bahrain'],
    ['OM', 'Asia/Muscat'],
    ['JO', 'Asia/Amman'],
  ])('%s has one zone: %s', (country, zone) => {
    expect(estimatedZoneOf(country)).toBe(zone);
  });

  it('gives nothing for a country with several zones, an unknown one, or none', () => {
    for (const country of ['US', 'CA', 'AU', 'RU', 'BR', 'ZZ', '', null]) expect(estimatedZoneOf(country)).toBeNull();
  });

  it('every zone it names is a real IANA zone', () => {
    for (const c of ['EG', 'SA', 'AE', 'KW', 'QA', 'BH', 'OM', 'JO', 'GB', 'TR']) {
      expect(() => new Intl.DateTimeFormat('en', { timeZone: estimatedZoneOf(c)! })).not.toThrow();
    }
  });
});

describe('PD-45 §7: the mismatch hint compares clocks, not names', () => {
  // A fixed instant in January: never a day, month or year boundary that matters (UTC+2 vs +4).
  const at = new Date('2027-01-15T12:00:00Z');

  it('two zones with the same offset agree (Dubai and Muscat), so a UAE family on Muscat time is no mismatch', () => {
    expect(sameClock('Asia/Dubai', 'Asia/Muscat', at)).toBe(true);
    expect(sameClock('Asia/Dubai', 'Asia/Dubai', at)).toBe(true);
  });

  it('different offsets disagree (Cairo and Dubai)', () => {
    expect(sameClock('Africa/Cairo', 'Asia/Dubai', at)).toBe(false);
  });

  it('a zone the runtime does not know never raises a hint', () => {
    expect(sameClock('Mars/Olympus', 'Asia/Dubai', at)).toBe(true);
  });
});

describe('PD-45 §5.3: the calling code behind the staff chip', () => {
  it('is the prefix of an international number, never the number', () => {
    expect(suggestedCallingCode('+971 50 123 4567')).toBe('971');
    expect(suggestedCallingCode('00966 50 123 4567')).toBe('966');
  });

  it('gives nothing for a local number, nothing, or an unreadable one', () => {
    for (const text of ['050 123 4567', '', null, '+999 123']) expect(suggestedCallingCode(text)).toBeNull();
  });
});
