/**
 * PD-45 PR-1 (review of #204): the two writers of chat.family.country_code --
 * the Parent Profile and Stories' audience data -- accepted any two letters.
 * The new foreign key to chat.geo_country turns a code that is not a country
 * (UK, ZZ, or one ISO only reserves: AC, CP, CQ, DG, EA, IC, TA) into a 500,
 * so both now ask the dataset first and answer 400. Pure.
 */
import { invalidCountryMessage, isGeoForeignKeyViolation, listedCountry } from '../../../src/geo/countries';

describe('PD-45: a country is one of the list', () => {
  it('takes an ISO 3166-1 code in any case, trimmed, and answers it upper case', () => {
    expect(listedCountry('eg')).toBe('EG');
    expect(listedCountry(' AE ')).toBe('AE');
    expect(listedCountry('XK')).toBe('XK');
  });

  it.each(['UK', 'ZZ', 'AC', 'CP', 'CQ', 'DG', 'EA', 'IC', 'TA', 'EU', 'UN', 'UAE', 'E', '', '12'])(
    'refuses %p, which is not a country of the list',
    (code) => {
      expect(listedCountry(code)).toBeNull();
    },
  );

  it('refuses what is not text', () => {
    for (const v of [null, undefined, 20, {}, ['EG']]) expect(listedCountry(v)).toBeNull();
  });

  it('recognises the database refusing a code its list lacks (the 400 safety net), and nothing else', () => {
    expect(isGeoForeignKeyViolation({ code: 'P2003', meta: { field_name: 'family_country_listed (index)' } })).toBe(true);
    expect(isGeoForeignKeyViolation({ code: '23503', message: 'violates foreign key constraint "family_subdivision_in_country"' })).toBe(true);
    expect(isGeoForeignKeyViolation({ code: 'P2003', meta: { field_name: 'family_owner_id_fkey (index)' } })).toBe(false);
    expect(isGeoForeignKeyViolation({ code: 'P2002', meta: { field_name: 'family_country_listed' } })).toBe(false);
    expect(isGeoForeignKeyViolation(null)).toBe(false);
  });

  it('says what to send instead, naming the field and the commonest slip (UK is GB)', () => {
    expect(invalidCountryMessage('countryCode')).toMatch(/^countryCode: /);
    expect(invalidCountryMessage('countryCode')).toMatch(/GB/);
  });
});
