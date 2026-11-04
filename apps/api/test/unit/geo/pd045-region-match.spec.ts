/**
 * PD-45 PR-5 (plan §6.3, §10): the old free-text region is read as a
 * subdivision only when it is exactly, and uniquely, one of the country's.
 * Pure; synthetic text only.
 */
import dataset from '../../../src/geo/dataset.json';
import { matchRegion, normaliseRegionText } from '../../../src/geo/region-match';
import { planFamily, type FamilyLocationSource } from '../../../src/parent-profile/family-location-backfill';

const matched = (code: string) => ({ outcome: 'matched', code });

describe('PD-45 backfill: normalising a region text', () => {
  it('folds case, diacritics, tatweel, the hamza forms, alef maqsura and ta marbuta, and punctuation', () => {
    expect(normaliseRegionText('  Dubayy,  ')).toBe('dubayy');
    expect(normaliseRegionText('Rēzekne')).toBe('rezekne');
    expect(normaliseRegionText('الإسكـندرية')).toBe('الاسكندريه');
    expect(normaliseRegionText('الجِيزَة')).toBe('الجيزه');
    expect(normaliseRegionText('Kafr el-Sheikh')).toBe('kafr el sheikh');
  });
});

describe('PD-45 backfill: an exact, unique match', () => {
  it('reads the Arabic and the English name, however it is cased or pointed', () => {
    for (const text of ['الجيزة', 'الجيزه', 'جيزة', 'Giza', 'GIZA', '  giza ']) {
      expect({ text, m: matchRegion('EG', text) }).toEqual({ text, m: matched('EG-GZ') });
    }
    expect(matchRegion('EG', 'الإسكندرية')).toEqual(matched('EG-ALX'));
    expect(matchRegion('EG', 'اسكندريه')).toEqual(matched('EG-ALX'));
    expect(matchRegion('EG', 'Kafr El Sheikh')).toEqual(matched('EG-KFS'));
    expect(matchRegion('SA', 'مكة المكرمة')).toEqual(matched('SA-02'));
  });

  it('drops the type word the field label already carries', () => {
    expect(matchRegion('EG', 'محافظة الجيزة')).toEqual(matched('EG-GZ'));
    expect(matchRegion('EG', 'Giza Governorate')).toEqual(matched('EG-GZ'));
    expect(matchRegion('AE', 'إمارة دبي')).toEqual(matched('AE-DU'));
    expect(matchRegion('AE', 'Emirate of Dubai')).toEqual(matched('AE-DU'));
    expect(matchRegion('SA', 'منطقة الرياض')).toEqual(matched('SA-01'));
    expect(matchRegion('US', 'State of Washington')).toMatchObject({ outcome: 'matched' });
  });

  it('prefers a name that is a subdivision\'s own, whole, over a looser reading', () => {
    // "Buenos Aires" and "Buenos Aires Province" are two subdivisions of Argentina.
    expect(matchRegion('AR', 'Buenos Aires')).toEqual(matched('AR-C'));
    expect(matchRegion('AR', 'Buenos Aires Province')).toEqual(matched('AR-B'));
  });

  it('is always against the family\'s own country', () => {
    expect(matchRegion('AE', 'Giza')).toEqual({ outcome: 'unmatched' });
    expect(matchRegion('EG', 'Dubai')).toEqual({ outcome: 'unmatched' });
  });
});

describe('PD-45 backfill: everything else is left for staff', () => {
  it('does not match a part, a superset, a city, a district, a typo or an empty text', () => {
    for (const text of ['Cairo, Egypt', 'القاهرة الجديدة', '6th of October', 'السادس من أكتوبر', 'Gizah', 'Giz', 'Maadi', '', '   ', '--']) {
      expect({ text, m: matchRegion('EG', text) }).toEqual({ text, m: { outcome: 'unmatched' } });
    }
  });

  it('is ambiguous when the text is more than one subdivision of the country', () => {
    // Iran lists "Markazi" twice once the diacritic is folded.
    expect(matchRegion('IR', 'Markazi')).toEqual({ outcome: 'ambiguous' });
    // "Minsk Governorate" is the bare name of both Minsk and Minsk Region.
    expect(matchRegion('BY', 'Minsk Governorate')).toEqual({ outcome: 'ambiguous' });
  });

  it('never matches a country that is not on the list, or that has no subdivisions', () => {
    expect(matchRegion('UK', 'London')).toEqual({ outcome: 'unmatched' });
    expect(matchRegion('ZZ', 'Giza')).toEqual({ outcome: 'unmatched' });
    const bare = dataset.countries.find((c) => c.subdivisions.length === 0)!;
    expect(matchRegion(bare.code, 'Giza')).toEqual({ outcome: 'unmatched' });
  });

  it('reads every subdivision of the dataset back as itself, except the few whose names collide', () => {
    const wrong: string[] = [];
    let ambiguous = 0;
    for (const c of dataset.countries) {
      for (const s of c.subdivisions) {
        for (const name of [s.en, s.ar]) {
          const m = matchRegion(c.code, name);
          if (m.outcome === 'ambiguous') ambiguous += 1;
          else if (m.outcome !== 'matched' || m.code !== s.code) wrong.push(`${s.code}`);
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(ambiguous).toBeLessThanOrEqual(2); // IR-00 / IR-22 "Markazi"
  });
});

describe('PD-45 backfill: what is done with one family', () => {
  const fam = (over: Partial<FamilyLocationSource>): FamilyLocationSource => ({
    familyId: 'f1', countryCode: 'EG', subdivisionCode: null, locationSource: null, regions: ['Giza'], ...over,
  });

  it('writes an exact unique match for a family nobody set a location for', () => {
    expect(planFamily(fam({}))).toEqual({ kind: 'matched', countryCode: 'EG', subdivisionCode: 'EG-GZ' });
    expect(planFamily(fam({ regions: ['Giza', 'محافظة الجيزة'] }))).toMatchObject({ kind: 'matched', subdivisionCode: 'EG-GZ' });
  });

  it('puts a country that is not on the list on the report, whatever else the family holds', () => {
    for (const countryCode of ['UK', 'ZZ', 'eg', 'EGY', '']) {
      expect(planFamily(fam({ countryCode }))).toEqual({ kind: 'invalid-country' });
    }
    expect(planFamily(fam({ countryCode: 'UK', regions: [] }))).toEqual({ kind: 'invalid-country' });
    expect(planFamily(fam({ countryCode: 'UK', locationSource: 'staff', subdivisionCode: 'EG-GZ' }))).toEqual({ kind: 'invalid-country' });
  });

  it('never touches a location staff or the parent set, even a country alone, or one already backfilled', () => {
    for (const locationSource of ['staff', 'parent', 'backfill']) {
      expect(planFamily(fam({ locationSource }))).toEqual({ kind: 'already-set' });
    }
    expect(planFamily(fam({ subdivisionCode: 'EG-C', locationSource: 'parent' }))).toEqual({ kind: 'already-set' });
    expect(planFamily(fam({ subdivisionCode: 'EG-C' }))).toEqual({ kind: 'already-set' });
  });

  it('leaves no region, no country, an unreadable region and disagreeing regions to staff', () => {
    expect(planFamily(fam({ regions: [] }))).toEqual({ kind: 'no-region' });
    expect(planFamily(fam({ countryCode: null }))).toEqual({ kind: 'no-country' });
    expect(planFamily(fam({ countryCode: null, regions: [] }))).toEqual({ kind: 'no-region' });
    expect(planFamily(fam({ regions: ['Maadi'] }))).toEqual({ kind: 'unmatched' });
    expect(planFamily(fam({ regions: ['Giza', 'Maadi'] }))).toEqual({ kind: 'unmatched' });
    expect(planFamily(fam({ regions: ['Giza', 'Cairo'] }))).toEqual({ kind: 'ambiguous' });
    expect(planFamily(fam({ countryCode: 'IR', regions: ['Markazi'] }))).toEqual({ kind: 'ambiguous' });
  });
});
