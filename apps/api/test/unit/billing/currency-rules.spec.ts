/**
 * S5: the currency rules a card payment must meet before Stripe is asked, and
 * the ISO 4217 check every new amount's currency meets. Pure. The tables are
 * Stripe's own (docs.stripe.com/currencies, read 2026-11-14); see
 * src/billing/currency-rules.ts for the quotes.
 */
import { CommError, CommErrorCode } from '@platform/errors';
import {
  STRIPE_CARD_CURRENCIES,
  STRIPE_CARD_MAX_MINOR,
  cardRefusal,
  isIsoCurrency,
  stripeApiDigits,
  stripeMinimumMinor,
} from '../../../src/billing/currency-rules';
import { requireCurrency } from '../../../src/billing/validate';

describe('ISO 4217: every new amount names a real currency', () => {
  it.each(['AED', 'EGP', 'SAR', 'USD', 'EUR', 'GBP', 'KWD', 'JPY', 'IQD', 'SYP'])('%s is a currency', (c) => {
    expect(isIsoCurrency(c)).toBe(true);
    expect(requireCurrency(c)).toBe(c);
  });

  it.each(['XYZ', 'ABC', 'QQQ', 'AAA'])('%s is refused (three letters, but no currency)', (c) => {
    expect(isIsoCurrency(c)).toBe(false);
    expect(() => requireCurrency(c)).toThrow(CommError);
    try {
      requireCurrency(c);
    } catch (e) {
      expect((e as CommError).code).toBe(CommErrorCode.VALIDATION);
      expect((e as CommError).status).toBe(400);
    }
  });

  it('still upper-cases and trims what it accepts', () => {
    expect(requireCurrency(' aed ')).toBe('AED');
  });
});

describe('Stripe API digits', () => {
  it('zero-decimal currencies take the amount as it is', () => {
    for (const c of ['JPY', 'KRW', 'VND', 'XOF', 'CLP']) expect(stripeApiDigits(c)).toBe(0);
  });
  it('ISK and UGX are sent as two-decimal values (Stripe\'s special cases)', () => {
    expect(stripeApiDigits('ISK')).toBe(2);
    expect(stripeApiDigits('UGX')).toBe(2);
  });
  it('the three-decimal currencies', () => {
    for (const c of ['BHD', 'JOD', 'KWD', 'OMR', 'TND']) expect(stripeApiDigits(c)).toBe(3);
  });
  it('every other currency is two-decimal', () => {
    for (const c of ['AED', 'USD', 'EGP', 'SAR', 'GBP', 'PKR', 'IDR']) expect(stripeApiDigits(c)).toBe(2);
  });
  it('a currency Stripe does not take for cards has none', () => {
    for (const c of ['IQD', 'SYP', 'LYD', 'SDG', 'XYZ']) expect(stripeApiDigits(c)).toBeNull();
  });
});

describe('Stripe minimum charge amounts (verified table only)', () => {
  it.each([
    ['USD', 50], ['AED', 200], ['EUR', 50], ['GBP', 30], ['JPY', 50], ['KRW', 50],
    ['MYR', 200], ['MXN', 1000], ['THB', 1000], ['HKD', 400], ['CZK', 1500],
  ])('%s: %d minor units', (c, minor) => {
    expect(stripeMinimumMinor(c as string)).toBe(minor);
  });
  it('no row on Stripe\'s page, no invented minimum', () => {
    for (const c of ['SAR', 'EGP', 'KWD', 'QAR', 'TRY']) expect(stripeMinimumMinor(c)).toBeNull();
  });
});

describe('cardRefusal: what Chat refuses before asking Stripe', () => {
  it('allows ordinary card amounts', () => {
    expect(cardRefusal('AED', 120000)).toBeNull();
    expect(cardRefusal('USD', 50)).toBeNull();
    expect(cardRefusal('JPY', 50)).toBeNull();
    expect(cardRefusal('EGP', 1)).toBeNull(); // no verified minimum: Stripe decides
    expect(cardRefusal('KWD', 12345)).toBeNull(); // the divisible-by-10 rule is not verified, so not enforced
  });

  it('refuses a currency Stripe does not accept for cards (bank transfer only)', () => {
    expect(cardRefusal('IQD', 100000)).toEqual({ reason: 'CARD_CURRENCY_UNSUPPORTED', currency: 'IQD' });
    expect(cardRefusal('XYZ', 100000)).toEqual({ reason: 'CARD_CURRENCY_UNSUPPORTED', currency: 'XYZ' });
  });

  it('refuses a currency whose minor unit Chat counts differently from Stripe (a charge 100x too small)', () => {
    // Chat stores these in whole units (Intl/CLDR: 0 digits); Stripe expects hundredths.
    for (const c of ['PKR', 'IDR', 'HUF', 'ISK', 'UGX', 'LBP', 'YER', 'COP']) {
      expect(cardRefusal(c, 100000)).toEqual({ reason: 'CARD_CURRENCY_PRECISION', currency: c });
    }
  });

  it('refuses less than Stripe\'s minimum for the currency', () => {
    expect(cardRefusal('AED', 199)).toEqual({ reason: 'CARD_AMOUNT_BELOW_MINIMUM', currency: 'AED', minimumMinor: 200 });
    expect(cardRefusal('USD', 49)).toEqual({ reason: 'CARD_AMOUNT_BELOW_MINIMUM', currency: 'USD', minimumMinor: 50 });
    expect(cardRefusal('JPY', 49)).toEqual({ reason: 'CARD_AMOUNT_BELOW_MINIMUM', currency: 'JPY', minimumMinor: 50 });
  });

  it('refuses a 1-minor-unit card charge wherever a minimum is known', () => {
    expect(cardRefusal('AED', 1)?.reason).toBe('CARD_AMOUNT_BELOW_MINIMUM');
    expect(cardRefusal('USD', 1)?.reason).toBe('CARD_AMOUNT_BELOW_MINIMUM');
  });

  it('refuses nothing or less', () => {
    expect(cardRefusal('AED', 0)?.reason).toBe('CARD_AMOUNT_BELOW_MINIMUM');
    expect(cardRefusal('EGP', 0)?.reason).toBe('CARD_AMOUNT_BELOW_MINIMUM');
  });

  it('refuses more than 12 digits (card networks\' general limit)', () => {
    expect(STRIPE_CARD_MAX_MINOR).toBe(999_999_999_999);
    expect(cardRefusal('AED', 999_999_999_999)).toBeNull();
    expect(cardRefusal('AED', 1_000_000_000_000)).toEqual({ reason: 'CARD_AMOUNT_ABOVE_MAXIMUM', currency: 'AED', maximumMinor: 999_999_999_999 });
  });

  it('the allow-list is Stripe\'s card presentment list (139 codes, all upper case)', () => {
    expect(STRIPE_CARD_CURRENCIES.size).toBe(139);
    for (const c of ['AED', 'SAR', 'EGP', 'USD', 'EUR', 'GBP', 'QAR', 'TRY', 'BHD', 'KWD', 'OMR', 'JOD', 'TND']) {
      expect(STRIPE_CARD_CURRENCIES.has(c)).toBe(true);
    }
  });
});
