import 'dart:math' as math;

import 'package:intl/intl.dart';

import '../../../shared/models/parent_billing.dart';

/// An amount in [currency]'s minor units, for a reader in [locale]: `125050` AED is
/// "AED 1,250.50". The decimals come from the currency (three for KWD, none for JPY),
/// never from the locale, so a fils is never rounded away.
///
/// The ISO code stands in for the symbol on purpose. intl's own symbols for these
/// currencies are Latin abbreviations ("dh", "din") that read as typos in both
/// languages, and a family billed in two currencies must be able to tell them apart.
/// The locale still decides the grouping, the decimal mark and which side the code
/// goes on; the no-break space keeps code and number on one line.
String formatMoney(int amountMinor, String currency, String locale) {
  final code = currency.toUpperCase();
  final digits = minorDigits(code);
  final format = NumberFormat.currency(locale: locale, name: code, symbol: '$code ', decimalDigits: digits);
  return format.format(amountMinor / math.pow(10, digits)).trim();
}
