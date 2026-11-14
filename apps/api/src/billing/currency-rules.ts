import { CommError, CommErrorCode } from '../platform/errors';
import { minorDigits } from './money';

/**
 * S5: the currency rules a CARD payment must meet before Stripe is asked. Pure.
 * Every rule below is in exactly one of three classes (Stripe pages read
 * 2026-11-14; copies with sha256 in the S5 session report).
 *
 * CONFIRMED Stripe requirements (quoted from Stripe's own pages; enforced):
 *  - https://docs.stripe.com/currencies, "Supported presentment currencies":
 *    "Stripe users in the selected country can process charges in the
 *    following list of currencies ... This list of currencies applies to card
 *    payments." STRIPE_CARD_CURRENCIES is the union over the 45 account
 *    countries in the page's data (the account's country is not recorded in
 *    this repository). BHD, JOD, KWD, OMR and TND are listed for AE only.
 *  - same page: "Currencies are two-decimal currencies unless otherwise
 *    specified." Zero-decimal: "the charge and the amount are the same,
 *    without requiring multiplication" (16 codes). Special cases: ISK and UGX
 *    are represented "as a two-decimal value, where the decimal amount is
 *    always 00".
 *  - https://support.stripe.com/questions/which-payments-methods-and-products-are-available-in-the-uae:
 *    "We also support charges in the following three-decimal currencies:
 *    Bahraini dinar (BHD), Jordanian dinar (JOD), Kuwaiti dinar (KWD), Omani
 *    rial (OMR), Tunisian dinar (TND)".
 *  - docs.stripe.com/currencies, "Minimum and maximum charge amounts": the
 *    31-row minimum table, and "12 digits for most card payments, for a
 *    maximum of 999,999,999,999 in minor units".
 *  - Consequence enforced here: Chat stores amounts in `minorDigits(currency)`
 *    (Intl/CLDR); where that differs from Stripe's `amount` (13 currencies:
 *    AFN ALL COP HUF IDR ISK LAK LBP MMK PKR SOS UGX YER) the stored number
 *    sent unchanged would charge 1/100 of what is owed, so card is refused for
 *    them (bank transfer only) until the gateway converts amounts both ways.
 *
 * CONSERVATIVE Chat restriction (not on Stripe's official pages; enforced on
 * purpose, and labelled so):
 *  - three-decimal amounts must end in 0 (a multiple of 10 in Chat's and
 *    Stripe's minor unit). Several third-party Stripe integrations document
 *    that Stripe rejects e.g. KWD 29005; Stripe's current pages say nothing.
 *    If Stripe does reject it, refusing first gives the parent the same
 *    answer (pay by bank transfer) without a Stripe error; if it does not,
 *    the cost is that card is refused for amounts whose last fils digit is
 *    not 0 (whole-dinar fees are unaffected) -- bank transfer still works.
 *    Remove THREE_DECIMAL_MULTIPLE's check if Stripe confirms otherwise.
 *
 * UNVERIFIED and NOT enforced (Stripe's own refusal is the backstop; open()
 * answers 503 "pay by bank transfer", Stripe's text never reaches a parent):
 *  - a minimum for a currency without a row (SAR, EGP, KWD, QAR, TRY, ...);
 *  - "Charges requiring conversion into your account's default settlement
 *    currency must meet the equivalent minimum of the settlement currency"
 *    (CONFIRMED text, but Chat knows neither the settlement currency nor the
 *    rate);
 *  - the per-network maxima ("9 digits for American Express in most
 *    currencies", "10 digits for ... Cartes Bancaires"): the card network is
 *    unknown until the parent pays on Stripe's page.
 *
 * Bank transfers, cash and every row that already exists are untouched by
 * these rules: they apply to opening a card payment only.
 */

/** docs.stripe.com/currencies, the zero-decimal list. */
export const STRIPE_ZERO_DECIMAL: ReadonlySet<string> = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

/** Zero-decimal in name, two-decimal in Stripe's API ("Special cases"). */
const STRIPE_TWO_DECIMAL_REPRESENTED: ReadonlySet<string> = new Set(['ISK', 'UGX']);

/** support.stripe.com (UAE): the three-decimal currencies. */
export const STRIPE_THREE_DECIMAL: ReadonlySet<string> = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);

/** docs.stripe.com/currencies, supported presentment currencies: the union over account countries. */
export const STRIPE_CARD_CURRENCIES: ReadonlySet<string> = new Set(
  (
    'AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BHD BIF BMD BND BOB BRL BSD BWP BYN BZD CAD CDF CHF ' +
    'CLP CNY COP CRC CVE CZK DJF DKK DOP DZD EGP ETB EUR FJD FKP GBP GEL GIP GMD GNF GTQ GYD HKD HNL HTG HUF ' +
    'IDR ILS INR ISK JMD JOD JPY KES KGS KHR KMF KRW KWD KYD KZT LAK LBP LKR LRD LSL MAD MDL MGA MKD MMK MNT ' +
    'MOP MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF ' +
    'SAR SBD SCR SEK SGD SHP SLE SOS SRD STD SZL THB TJS TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VND VUV ' +
    'WST XAF XCD XCG XOF XPF YER ZAR ZMW'
  ).split(' '),
);

/** docs.stripe.com/currencies, minimum charge amounts, in major units exactly as the page lists them. */
const STRIPE_MINIMUM_MAJOR: Readonly<Record<string, string>> = {
  USD: '0.50', AED: '2.00', ARS: '0.50', AUD: '0.50', BRL: '0.50', CAD: '0.50', CHF: '0.50', COP: '0.50',
  CZK: '15.00', DKK: '2.50', EUR: '0.50', GBP: '0.30', HKD: '4.00', HUF: '175.00', IDR: '0.50', ILS: '0.50',
  INR: '0.50', JPY: '50', KRW: '50', MXN: '10', MYR: '2.00', NOK: '3.00', NZD: '0.50', PHP: '0.50',
  PLN: '2.00', RON: '2.00', RUB: '0.50', SEK: '3.00', SGD: '0.50', THB: '10', ZAR: '0.50',
};

/** "12 digits for most card payments, for a maximum of 999,999,999,999 in minor units". */
export const STRIPE_CARD_MAX_MINOR = 999_999_999_999;

/** CONSERVATIVE (see the header): a three-decimal card amount is a multiple of this. */
export const THREE_DECIMAL_MULTIPLE = 10;

let iso: ReadonlySet<string> | null = null;

/** A real ISO 4217 code, as the runtime's ICU knows them. */
export function isIsoCurrency(code: string): boolean {
  iso ??= new Set(Intl.supportedValuesOf('currency'));
  return iso.has(code);
}

/** How many decimals Stripe's `amount` has for a card currency; null when Stripe takes no card in it. */
export function stripeApiDigits(currency: string): number | null {
  if (!STRIPE_CARD_CURRENCIES.has(currency)) return null;
  if (STRIPE_TWO_DECIMAL_REPRESENTED.has(currency)) return 2;
  if (STRIPE_ZERO_DECIMAL.has(currency)) return 0;
  if (STRIPE_THREE_DECIMAL.has(currency)) return 3;
  return 2;
}

/** Stripe's minimum in its API minor units; null where the page has no row (no invented value). */
export function stripeMinimumMinor(currency: string): number | null {
  const major = STRIPE_MINIMUM_MAJOR[currency];
  const digits = stripeApiDigits(currency);
  if (major === undefined || digits === null) return null;
  const [whole, frac = ''] = major.split('.');
  return Number(whole) * 10 ** digits + Number(frac.padEnd(digits, '0').slice(0, digits) || '0');
}

export type CardRefusal =
  | { reason: 'CARD_CURRENCY_UNSUPPORTED'; currency: string }
  | { reason: 'CARD_CURRENCY_PRECISION'; currency: string }
  | { reason: 'CARD_AMOUNT_BELOW_MINIMUM'; currency: string; minimumMinor: number }
  | { reason: 'CARD_AMOUNT_ABOVE_MAXIMUM'; currency: string; maximumMinor: number }
  | { reason: 'CARD_AMOUNT_THREE_DECIMAL_ROUNDING'; currency: string; multipleOf: number };

/** Why a card charge of `amountMinor` (Chat's minor units) in `currency` cannot be asked of Stripe; null if it can. */
export function cardRefusal(currency: string, amountMinor: number): CardRefusal | null {
  const byCurrency = cardCurrencyRefusal(currency);
  if (byCurrency) return byCurrency;
  const minimum = stripeMinimumMinor(currency) ?? 1;
  if (amountMinor < minimum) return { reason: 'CARD_AMOUNT_BELOW_MINIMUM', currency, minimumMinor: minimum };
  if (amountMinor > STRIPE_CARD_MAX_MINOR) return { reason: 'CARD_AMOUNT_ABOVE_MAXIMUM', currency, maximumMinor: STRIPE_CARD_MAX_MINOR };
  // CONSERVATIVE Chat restriction, not a CONFIRMED Stripe rule (see the header).
  if (STRIPE_THREE_DECIMAL.has(currency) && amountMinor % THREE_DECIMAL_MULTIPLE !== 0) {
    return { reason: 'CARD_AMOUNT_THREE_DECIMAL_ROUNDING', currency, multipleOf: THREE_DECIMAL_MULTIPLE };
  }
  return null;
}

/** The currency half of cardRefusal: whatever the amount, no card in this currency. */
export function cardCurrencyRefusal(currency: string): CardRefusal | null {
  const digits = stripeApiDigits(currency);
  if (digits === null) return { reason: 'CARD_CURRENCY_UNSUPPORTED', currency };
  if (minorDigits(currency) !== digits) return { reason: 'CARD_CURRENCY_PRECISION', currency };
  return null;
}

/**
 * A refusal as the API answers it: 503 COMM.PAYMENTS_UNAVAILABLE, the code
 * every client already reads as "card payment is not possible; pay by bank
 * transfer" (the app's pay sheet, the link page). `detail` says why.
 */
export function cardRefusalError(refusal: CardRefusal): CommError {
  const message =
    refusal.reason === 'CARD_AMOUNT_BELOW_MINIMUM'
      ? 'this amount is below the smallest card payment; pay by bank transfer'
      : refusal.reason === 'CARD_AMOUNT_ABOVE_MAXIMUM'
        ? 'this amount is above the largest card payment; pay by bank transfer'
        : refusal.reason === 'CARD_AMOUNT_THREE_DECIMAL_ROUNDING'
          ? 'this amount cannot be paid by card in this currency; pay by bank transfer'
          : 'card payment is not available in this currency; pay by bank transfer';
  return new CommError(CommErrorCode.PAYMENTS_UNAVAILABLE, message, 503, { ...refusal });
}
