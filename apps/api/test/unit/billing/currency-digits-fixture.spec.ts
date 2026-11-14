/**
 * The scale of every stored amount (amountMinor) is minorDigits(currency):
 * Node Intl / CLDR (src/billing/money.ts). The Flutter app keeps its own copy of
 * that table (lib/shared/models/currency_digits.dart). Both are tested against
 * ONE file, test/fixtures/currency_minor_digits.json (repo root), so neither can
 * drift without a red test (B7: the app's old three-entry table showed PKR, IQD,
 * IDR, KRW... 100x too small and TND, LYD 10x too large).
 *
 * If THIS spec fails, Node's ICU changed a currency's digits: amounts already
 * stored in that currency would change meaning. Do not just regenerate the
 * fixture -- that is a data decision. To regenerate deliberately:
 *   node -e 'const d={};for(const c of Intl.supportedValuesOf("currency").sort())d[c]=new Intl.NumberFormat("en",{style:"currency",currency:c}).resolvedOptions().maximumFractionDigits;console.log(JSON.stringify(d,null,2))'
 * and update "digits" (and "_generatedWith") in the fixture, then the Flutter table.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { minorDigits } from '../../../src/billing/money';

const FIXTURE = join(__dirname, '..', '..', '..', '..', '..', 'test', 'fixtures', 'currency_minor_digits.json');
const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { digits: Record<string, number> };

describe('the shared currency digits fixture', () => {
  it('lists exactly the ISO 4217 codes this Node knows', () => {
    expect(Object.keys(fixture.digits).sort()).toEqual([...Intl.supportedValuesOf('currency')].sort());
  });

  it('every code has the digits the API stores amounts in (minorDigits)', () => {
    const wrong = Object.entries(fixture.digits)
      .filter(([c, d]) => minorDigits(c) !== d)
      .map(([c, d]) => `${c}: API ${minorDigits(c)}, fixture ${d}`);
    expect(wrong).toEqual([]);
  });

  it('pins the currencies the product touches and the ones the old app table got wrong', () => {
    expect(fixture.digits).toMatchObject({
      USD: 2, AED: 2, EGP: 2, SAR: 2, QAR: 2, EUR: 2, GBP: 2, CAD: 2, AUD: 2,
      KWD: 3, BHD: 3, OMR: 3, JOD: 3, TND: 3, LYD: 3,
      JPY: 0, IQD: 0, PKR: 0, IDR: 0, HUF: 0, COP: 0, ISK: 0, UGX: 0, LBP: 0, YER: 0,
      AFN: 0, ALL: 0, LAK: 0, MMK: 0, SOS: 0, KRW: 0,
    });
  });
});
