/**
 * S5: the currency rules a card payment must meet before Stripe is asked, and
 * the ISO 4217 check every new amount's currency meets. Pure. The tables are
 * Stripe's own (docs.stripe.com/currencies, read 2026-11-14); see
 * src/billing/currency-rules.ts for the quotes. Three classes, kept apart in
 * the describe names: CONFIRMED Stripe requirements, the CONSERVATIVE Chat
 * restriction (three-decimal amounts end in 0), and UNVERIFIED rules that are
 * deliberately not enforced (asserted as "allowed" where they would bite).
 */
import { CommError, CommErrorCode } from '@platform/errors';
import { minorDigits } from '../../../src/billing/money';
import {
  STRIPE_CARD_CURRENCIES,
  cardCurrencyRefusal,
  STRIPE_CARD_MAX_MINOR,
  STRIPE_ZERO_DECIMAL,
  cardRefusal,
  isIsoCurrency,
  stripeApiDigits,
  stripeMinimumMinor,
} from '../../../src/billing/currency-rules';
import { requireCurrency } from '../../../src/billing/validate';
import { checkoutCreateParams } from '../../../src/billing/stripe.gateway';

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
    expect(cardRefusal('KWD', 12340)).toBeNull();
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

/** The 13 card currencies whose minor unit Chat (Intl/CLDR) counts differently from Stripe's `amount`. */
const MISMATCHED = ['AFN', 'ALL', 'COP', 'HUF', 'IDR', 'ISK', 'LAK', 'LBP', 'MMK', 'PKR', 'SOS', 'UGX', 'YER'] as const;

describe('the 13 mismatched currencies (CONFIRMED Stripe two-decimal amount; Chat stores whole units)', () => {
  it.each(MISMATCHED)('%s: Stripe takes cards in it, two-decimal amount; Chat counts 0 decimals; card refused at any amount', (c) => {
    expect(STRIPE_CARD_CURRENCIES.has(c)).toBe(true);
    expect(stripeApiDigits(c)).toBe(2);
    expect(minorDigits(c)).toBe(0);
    expect(cardCurrencyRefusal(c)).toEqual({ reason: 'CARD_CURRENCY_PRECISION', currency: c });
    for (const amount of [1, 100, 1000, 100000, 250000, 999_999_999, 999_999_999_999]) { // C3 A2: precision wins over min/max
      expect(cardRefusal(c, amount)).toEqual({ reason: 'CARD_CURRENCY_PRECISION', currency: c });
    }
  });

  it('no other card currency is mismatched (the list is exactly 13)', () => {
    const found = [...STRIPE_CARD_CURRENCIES].filter((c) => cardCurrencyRefusal(c)?.reason === 'CARD_CURRENCY_PRECISION');
    // STD is on Stripe's list but obsolete in ISO 4217: creation refuses it (requireCurrency), so it never reaches a card.
    expect(found.filter((c) => c !== 'STD').sort()).toEqual([...MISMATCHED].sort());
  });

  it.each([
    ['USD', 5000], ['AED', 5000], ['JPY', 5000], ['KWD', 12340],
  ])('control %s: same scale both sides, an ordinary amount is a card payment', (c, amount) => {
    expect(minorDigits(c as string)).toBe(stripeApiDigits(c as string));
    expect(cardCurrencyRefusal(c as string)).toBeNull();
    expect(cardRefusal(c as string, amount as number)).toBeNull();
  });
});

describe('three-decimal currencies: CONSERVATIVE Chat restriction (last digit 0), not a CONFIRMED Stripe rule', () => {
  it.each(['BHD', 'JOD', 'KWD', 'OMR', 'TND'])('%s: 12345 refused (bank transfer only), 12340 and 10 allowed', (c) => {
    expect(cardRefusal(c, 12345)).toEqual({ reason: 'CARD_AMOUNT_THREE_DECIMAL_ROUNDING', currency: c, multipleOf: 10 });
    expect(cardRefusal(c, 1)).toEqual({ reason: 'CARD_AMOUNT_THREE_DECIMAL_ROUNDING', currency: c, multipleOf: 10 });
    expect(cardRefusal(c, 12340)).toBeNull();
    expect(cardRefusal(c, 10)).toBeNull();
  });

  it('applies to no two- or zero-decimal currency', () => {
    expect(cardRefusal('AED', 12345)).toBeNull();
    expect(cardRefusal('JPY', 12345)).toBeNull();
    expect(cardRefusal('EGP', 12345)).toBeNull();
  });
});

describe('C3 reconciliation (B4)', () => {
  it('A3: KWD 10.000 (whole dinars) is a card amount; KWD 0.001 is refused by the CONSERVATIVE rule, not by a minimum', () => {
    expect(cardRefusal('KWD', 1_000_000)).toBeNull();
    expect(stripeMinimumMinor('KWD')).toBeNull();
    expect(cardRefusal('KWD', 1)?.reason).toBe('CARD_AMOUNT_THREE_DECIMAL_ROUNDING');
  });

  it('A4: the guard itself is case-sensitive -- callers upper-case first (requireCurrency does)', () => {
    expect(cardCurrencyRefusal('pkr')).toEqual({ reason: 'CARD_CURRENCY_UNSUPPORTED', currency: 'pkr' });
    expect(cardCurrencyRefusal(requireCurrency('pkr'))).toEqual({ reason: 'CARD_CURRENCY_PRECISION', currency: 'PKR' });
  });

  it('A5 / UGX: Stripe lists it as zero-decimal AND as a two-decimal special case; Chat counts 0 -- card refused either way it is read (CONSERVATIVE)', () => {
    expect(STRIPE_ZERO_DECIMAL.has('UGX')).toBe(true);
    expect(stripeApiDigits('UGX')).toBe(2); // the Special cases entry wins in stripeApiDigits
    expect(minorDigits('UGX')).toBe(0);
    expect(cardRefusal('UGX', 500)).toEqual({ reason: 'CARD_CURRENCY_PRECISION', currency: 'UGX' });
  });

  it('A6: what Chat sends to Stripe -- lower-case currency, the stored integer unchanged (the seam a converter would change)', () => {
    const base = {
      requestId: '00000000-0000-4000-8000-000000000001', organizationId: '00000000-0000-4000-8000-000000000002',
      productName: 'x', description: null, successUrl: 'https://example.test/s', cancelUrl: 'https://example.test/c',
      expiresAt: new Date('2026-12-01T00:00:00Z'), locale: 'en' as const, idempotencyKey: 'k',
    };
    for (const [currency, amountMinor] of [['USD', 100000], ['PKR', 1000]] as const) {
      const price = checkoutCreateParams({ ...base, currency, amountMinor }).line_items![0]!.price_data!;
      expect(price).toMatchObject({ currency: currency.toLowerCase(), unit_amount: amountMinor });
    }
  });
});
