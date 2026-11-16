/// How many decimals each currency's minor unit has, in Jawwid Chat's scale: the
/// scale every amount the API sends and stores uses (apps/api/src/billing/money.ts
/// minorDigits, Node Intl / CLDR). Only the currencies that are NOT two decimals are
/// listed; every other code is two.
///
/// This must equal test/fixtures/currency_minor_digits.json, which the API is also
/// tested against (test/shared/currency_digits_test.dart and
/// apps/api/test/unit/billing/currency-digits-fixture.spec.ts). Do not edit by hand
/// without changing the fixture: a wrong entry shows and sends amounts 10x or 100x off.
library;

/// No decimals: an amount is whole units (`250000` PKR is 250,000 rupees).
const Set<String> zeroDecimalCurrencies = {
  'AFN', 'ALL', 'BIF', 'CLP', 'COP', 'DJF', 'GNF', 'HUF', 'IDR', 'IQD', 'IRR', 'ISK', 'JPY', 'KMF',
  'KPW', 'KRW', 'LAK', 'LBP', 'MGA', 'MMK', 'PKR', 'PYG', 'RWF', 'SLL', 'SOS', 'SYP', 'UGX', 'VND',
  'VUV', 'XAF', 'XOF', 'XPF', 'YER',
};

/// Three decimals (fils, baisa, millimes): `12345` KWD is 12.345.
const Set<String> threeDecimalCurrencies = {
  'BHD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND',
};
