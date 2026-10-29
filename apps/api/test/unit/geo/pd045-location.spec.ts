/**
 * PD-45 PR-2: the reference data the pickers read (GET /geo/...) and the one
 * rule every writer of a family's location applies (plan §3.3): a
 * subdivision is always one of its country's, and changing the country drops a
 * subdivision that is not the new country's. Pure.
 */
import { countryList, locationOf, parseLocation, parseLocationPatch, subdivisionsOf } from '../../../src/geo/location';
import { suggestedCountryFromPhone } from '../../../src/parent-profile/parent-phone-directory';

const PINNED = ['EG', 'SA', 'AE', 'KW', 'QA', 'BH', 'OM', 'JO'];

describe('PD-45: the country list', () => {
  const list = countryList();

  it('is every country of the dataset, each with its names, its field label and whether it has subdivisions', () => {
    expect(list.countries.length).toBeGreaterThanOrEqual(245);
    expect(list.countries.find((c) => c.code === 'EG')).toEqual({
      code: 'EG', en: 'Egypt', ar: 'مصر', label: { en: 'Governorate', ar: 'المحافظة' }, hasSubdivisions: true, pinned: 0,
    });
    expect(list.countries.find((c) => c.code === 'FR')).toMatchObject({ label: { en: 'Region', ar: 'المنطقة' }, pinned: null });
    expect(list.countries.some((c) => !c.hasSubdivisions)).toBe(true);
  });

  it('pins Egypt, then the Gulf, then Jordan (owner Q3); the client sorts the rest by name in its language', () => {
    expect(list.countries.filter((c) => c.pinned !== null).sort((a, b) => a.pinned! - b.pinned!).map((c) => c.code)).toEqual(PINNED);
  });

  it('names its version, so a client caches it until the dataset changes', () => {
    expect(list.version).toMatch(/^cldr-49\+overlay-[0-9a-f]{12}$/);
  });
});

describe('PD-45: a country\'s subdivisions', () => {
  it('are its first-level ones, with the label of its field', () => {
    const eg = subdivisionsOf('eg')!;
    expect(eg.country).toBe('EG');
    expect(eg.label).toEqual({ en: 'Governorate', ar: 'المحافظة' });
    expect(eg.subdivisions).toHaveLength(27);
    expect(eg.subdivisions).toContainEqual({ code: 'EG-GZ', en: 'Giza', ar: 'الجيزة' });
  });

  it('are null for a code that is not a country of the list', () => {
    expect(subdivisionsOf('UK')).toBeNull();
    expect(subdivisionsOf('ZZ')).toBeNull();
    expect(subdivisionsOf('')).toBeNull();
  });
});

describe('PD-45: what a family\'s location reads as', () => {
  it('names the country and the subdivision in both languages, with the field\'s label', () => {
    expect(locationOf('EG', 'EG-GZ')).toEqual({
      country: { code: 'EG', en: 'Egypt', ar: 'مصر' },
      subdivision: { code: 'EG-GZ', en: 'Giza', ar: 'الجيزة' },
      label: { en: 'Governorate', ar: 'المحافظة' },
    });
    expect(locationOf('AE', null)).toMatchObject({ country: { code: 'AE' }, subdivision: null, label: { en: 'Emirate' } });
  });

  it('is null with no country, and keeps an unlisted legacy code readable (PR-5 cleans it)', () => {
    expect(locationOf(null, null)).toBeNull();
    expect(locationOf('UK', null)).toEqual({ country: { code: 'UK', en: 'UK', ar: 'UK' }, subdivision: null, label: { en: 'Region', ar: 'المنطقة' } });
  });
});

describe('PD-45: a change to a family\'s location', () => {
  const at = { countryCode: 'EG', subdivisionCode: 'EG-GZ' };

  it('is nothing when neither field is sent', () => {
    expect(parseLocationPatch({}, at)).toBeUndefined();
    expect(parseLocationPatch({ name: 'x' }, at)).toBeUndefined();
  });

  it('sets a country and its subdivision, in any case', () => {
    expect(parseLocationPatch({ countryCode: 'ae', subdivisionCode: 'ae-du' }, at)).toEqual({ countryCode: 'AE', subdivisionCode: 'AE-DU' });
  });

  it('keeps the subdivision when the country stays, and drops it when the country changes and none is sent', () => {
    expect(parseLocationPatch({ countryCode: 'EG' }, at)).toEqual({ countryCode: 'EG', subdivisionCode: 'EG-GZ' });
    expect(parseLocationPatch({ countryCode: 'AE' }, at)).toEqual({ countryCode: 'AE', subdivisionCode: null });
  });

  it('changes only the subdivision, within the family\'s country', () => {
    expect(parseLocationPatch({ subdivisionCode: 'EG-C' }, at)).toEqual({ countryCode: 'EG', subdivisionCode: 'EG-C' });
    expect(parseLocationPatch({ subdivisionCode: null }, at)).toEqual({ countryCode: 'EG', subdivisionCode: null });
  });

  it('clears both', () => {
    expect(parseLocationPatch({ countryCode: null }, at)).toEqual({ countryCode: null, subdivisionCode: null });
  });

  it.each([
    [{ countryCode: 'EG', subdivisionCode: 'AE-DU' }, /subdivisionCode: .*Egypt/],
    [{ subdivisionCode: 'AE-DU' }, /subdivisionCode: .*Egypt/],
    [{ countryCode: null, subdivisionCode: 'EG-GZ' }, /subdivisionCode: a subdivision needs a country/],
    [{ countryCode: 'UK' }, /countryCode: .*GB/],
    [{ countryCode: 'GB', subdivisionCode: 'GB-KEN' }, /subdivisionCode: /],
    [{ subdivisionCode: 7 }, /subdivisionCode: /],
  ])('refuses %j, saying why', (body, reason) => {
    expect(() => parseLocationPatch(body, at)).toThrow(reason);
  });

  it('refuses a subdivision on a family with no country', () => {
    expect(() => parseLocationPatch({ subdivisionCode: 'EG-GZ' }, { countryCode: null, subdivisionCode: null })).toThrow(/needs a country/);
  });
});

describe('PD-45: a whole location from a form (Sales\' form, the booking, the intake)', () => {
  it('is null when absent, and a listed country with, optionally, one of its subdivisions', () => {
    expect(parseLocation(undefined, 'parent.location')).toBeNull();
    expect(parseLocation(null, 'parent.location')).toBeNull();
    expect(parseLocation({ countryCode: 'eg' }, 'parent.location')).toEqual({ countryCode: 'EG', subdivisionCode: null });
    expect(parseLocation({ countryCode: 'eg', subdivisionCode: 'eg-gz' }, 'location')).toEqual({ countryCode: 'EG', subdivisionCode: 'EG-GZ' });
  });

  it.each([
    ['Egypt', /^parent\.location: /],
    [['EG'], /^parent\.location: /],
    [{ subdivisionCode: 'EG-GZ' }, /^parent\.location\.countryCode: required/],
    [{ countryCode: 'UK' }, /^parent\.location\.countryCode: .*GB/],
    [{ countryCode: 'EG', subdivisionCode: 'AE-DU' }, /^parent\.location\.subdivisionCode: /],
  ])('refuses %j, naming the field', (raw, reason) => {
    expect(() => parseLocation(raw, 'parent.location')).toThrow(reason);
  });
});

describe('PD-45: the country a phone suggests (staff see it; nobody saves it silently)', () => {
  it('reads the country of an international number', () => {
    expect(suggestedCountryFromPhone('+971 50 123 4567')).toBe('AE');
    expect(suggestedCountryFromPhone('00966 50 123 4567')).toBe('SA');
    expect(suggestedCountryFromPhone('+20 100 123 4567')).toBe('EG');
  });

  it('suggests nothing for a local number, a number it cannot place, or no number', () => {
    expect(suggestedCountryFromPhone('050 123 4567')).toBeNull();
    expect(suggestedCountryFromPhone('01001234567')).toBeNull();
    expect(suggestedCountryFromPhone('+999 123')).toBeNull();
    expect(suggestedCountryFromPhone(null)).toBeNull();
    expect(suggestedCountryFromPhone('')).toBeNull();
  });
});
