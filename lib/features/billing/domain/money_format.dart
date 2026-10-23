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

/// An amount as a parent would type it: no code, no grouping, the currency's decimals
/// (`125050` AED is "1250.50"). Used to prefill an amount field.
String plainAmount(int amountMinor, String currency) {
  final digits = minorDigits(currency);
  if (digits == 0) return '$amountMinor';
  final s = amountMinor.abs().toString().padLeft(digits + 1, '0');
  final sign = amountMinor < 0 ? '-' : '';
  return '$sign${s.substring(0, s.length - digits)}.${s.substring(s.length - digits)}';
}

/// What a parent typed, in [currency]'s minor units; null when it is not a positive
/// amount with at most the currency's decimals. Exact -- never through a double, so
/// "1250.10" is 125010 and not 125009.
///
/// Arabic-Indic digits and the Arabic decimal mark are read as typed on an Arabic
/// keyboard; commas and the Arabic thousands mark are taken as grouping.
int? parseAmountMinor(String input, String currency) {
  const arabicIndic = '٠١٢٣٤٥٦٧٨٩';
  const easternArabic = '۰۱۲۳۴۵۶۷۸۹';
  final b = StringBuffer();
  for (final ch in input.trim().split('')) {
    final a = arabicIndic.indexOf(ch);
    final e = easternArabic.indexOf(ch);
    if (a >= 0) {
      b.write(a);
    } else if (e >= 0) {
      b.write(e);
    } else if (ch == '٫') {
      b.write('.');
    } else if (ch == ',' || ch == '٬' || ch == ' ') {
      continue;
    } else {
      b.write(ch);
    }
  }
  final digits = minorDigits(currency);
  final m = RegExp(r'^(\d+)(?:\.(\d*))?$').firstMatch(b.toString());
  if (m == null) return null;
  final fraction = m[2] ?? '';
  if (fraction.length > digits) return null;
  final minor = int.tryParse('${m[1]}${fraction.padRight(digits, '0')}');
  return minor == null || minor <= 0 ? null : minor;
}
