import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:intl/intl.dart';
import 'package:jawwid_chat/shared/utils/clock_time.dart';

/// RQA-F3 / DD-09 (docs/design/decisions.md): Western digits 0-9 in both locales.
/// An Arabic screen mixed Latin counts ("22 حصة") with Arabic-Indic dates ("٢٩ أكتوبر").
/// The policy is set once at startup (useWesternDigits) and in the test config; this
/// guards that every Arabic date, time and number reads 0-9.
void main() {
  setUpAll(() async => initializeDateFormatting());

  final arabicIndic = RegExp('[٠-٩۰-۹]');

  test("intl's Arabic dates and numbers write 0-9", () {
    final when = DateTime(2026, 10, 29, 17, 5);
    expect(DateFormat.yMMMMd('ar').format(when), isNot(contains(arabicIndic)));
    expect(DateFormat.jm('ar').format(when), contains('5:05'));
    expect(NumberFormat.decimalPattern('ar').format(1234), isNot(contains(arabicIndic)));
  });

  testWidgets("MaterialLocalizations' Arabic dates and the app's clock times write 0-9", (tester) async {
    late String date;
    late String clock;
    await tester.pumpWidget(
      Localizations(
        locale: const Locale('ar'),
        delegates: const [GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate],
        child: Builder(builder: (context) {
          date = MaterialLocalizations.of(context).formatMediumDate(DateTime(2026, 10, 29));
          clock = formatClockTime(context, const TimeOfDay(hour: 16, minute: 0));
          return const SizedBox.shrink();
        }),
      ),
    );
    expect(date, contains('29'));
    expect(date, isNot(contains(arabicIndic)));
    expect(clock, contains('4:00'));
    expect(clock, isNot(contains(arabicIndic)));
  });
}
