import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/features/billing/domain/money_format.dart';
import 'package:jawwid_chat/shared/models/parent_billing.dart';

/// Every amount the API sends or stores is in minor units of the API's own scale
/// (apps/api/src/billing/money.ts minorDigits: Node Intl). The app must read and
/// write amounts in the SAME scale, or it shows and sends them 10x or 100x off.
/// test/fixtures/currency_minor_digits.json is that scale for every ISO 4217 code;
/// the API checks itself against the same file
/// (apps/api/test/unit/billing/currency-digits-fixture.spec.ts).
/// How formatMoney writes an amount in English: the code, a no-break space, the number.
String money(String code, String number) => '$code\u00A0$number';

void main() {
  final fixture = jsonDecode(File('test/fixtures/currency_minor_digits.json').readAsStringSync()) as Map<String, Object?>;
  final digits = (fixture['digits'] as Map<String, Object?>).map((k, v) => MapEntry(k, v as int));

  test('the fixture is the full ISO list it claims to be', () {
    expect(digits.length, greaterThanOrEqualTo(150));
    for (final c in ['USD', 'AED', 'JPY', 'KWD', 'PKR', 'TND', 'IQD']) {
      expect(digits.containsKey(c), isTrue, reason: c);
    }
  });

  test('minorDigits agrees with the API for every ISO 4217 currency, in any letter case', () {
    final wrong = <String>[];
    for (final e in digits.entries) {
      if (minorDigits(e.key) != e.value) wrong.add('${e.key}: app ${minorDigits(e.key)}, API ${e.value}');
      if (minorDigits(e.key.toLowerCase()) != e.value) wrong.add('${e.key.toLowerCase()} (lower case)');
    }
    expect(wrong, isEmpty);
  });

  test('a code the list does not know is two decimals, as the API answers it', () {
    expect(minorDigits('XYZ'), 2);
  });

  group('amounts in the currencies the old table got wrong', () {
    test('PKR (no decimals at the API): shown, prefilled and read back as the API stores it', () {
      expect(formatMoney(250000, 'PKR', 'en'), money('PKR', '250,000'));
      expect(plainAmount(250000, 'PKR'), '250000');
      expect(parseAmountMinor('250000', 'PKR'), 250000);
      expect(parseAmountMinor('2,500', 'PKR'), 2500);
      // No fractions of a rupee at this scale: the API would read 2500.00 as 250000 rupees.
      expect(parseAmountMinor('2500.00', 'PKR'), isNull);
    });

    test('IQD, IDR, UGX, KRW: no decimals', () {
      for (final c in ['IQD', 'IDR', 'UGX', 'KRW']) {
        expect(formatMoney(1500, c, 'en'), money(c, '1,500'), reason: c);
        expect(parseAmountMinor('1500', c), 1500, reason: c);
      }
    });

    test('TND and LYD: three decimals, like KWD', () {
      expect(formatMoney(12345, 'TND', 'en'), money('TND', '12.345'));
      expect(parseAmountMinor('12.345', 'TND'), 12345);
      expect(plainAmount(12345, 'LYD'), '12.345');
    });

    test('unchanged: AED, USD, KWD, BHD, OMR, JOD, JPY', () {
      expect(formatMoney(125050, 'AED', 'en'), money('AED', '1,250.50'));
      expect(formatMoney(5, 'USD', 'en'), money('USD', '0.05'));
      for (final c in ['KWD', 'BHD', 'OMR', 'JOD']) {
        expect(formatMoney(125050, c, 'en'), money(c, '125.050'), reason: c);
      }
      expect(formatMoney(125050, 'JPY', 'en'), money('JPY', '125,050'));
    });
  });
}
