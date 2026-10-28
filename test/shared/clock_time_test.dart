import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:intl/intl.dart';
import 'package:jawwid_chat/shared/utils/clock_time.dart';

/// One set of digits per screen. In Arabic, a lesson card read "4:00 م" (Latin, from
/// `MaterialLocalizations.formatTimeOfDay`) while the chat beside it read "١٤:٢٦"
/// (Arabic-Indic, from intl's DateFormat). Times now come from [formatClockTime], which
/// writes them the way [DateFormat] writes the dates next to them.
void main() {
  setUpAll(() async => initializeDateFormatting());

  Future<String> clock(WidgetTester tester, String language, TimeOfDay time, {bool h24 = false}) async {
    late String out;
    await tester.pumpWidget(
      Localizations(
        locale: Locale(language),
        delegates: const [GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate],
        child: Builder(builder: (context) {
          out = formatClockTime(context, time, alwaysUse24HourFormat: h24);
          return const SizedBox.shrink();
        }),
      ),
    );
    return out;
  }

  const four = TimeOfDay(hour: 16, minute: 0);

  Future<String> inLocale(WidgetTester tester, String language, String Function(BuildContext) read) async {
    late String out;
    await tester.pumpWidget(
      Localizations(
        locale: Locale(language),
        delegates: const [GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate],
        child: Builder(builder: (context) {
          out = read(context);
          return const SizedBox.shrink();
        }),
      ),
    );
    return out;
  }

  testWidgets('Arabic writes a time in Arabic-Indic digits, like its dates', (tester) async {
    expect(await clock(tester, 'ar', four), '٤:٠٠ م');
    expect(await clock(tester, 'ar', const TimeOfDay(hour: 14, minute: 26), h24: true), '١٤:٢٦');
    // The same digits as the chat timestamp and the date on the same card.
    expect(await clock(tester, 'ar', const TimeOfDay(hour: 14, minute: 26), h24: true),
        DateFormat.Hm('ar').format(DateTime(2026, 10, 27, 14, 26)));
  });

  testWidgets('English is unchanged: the 12-hour clock with Latin digits', (tester) async {
    expect(await clock(tester, 'en', four), '4:00 PM');
    expect(await clock(tester, 'en', four, h24: true), '16:00');
  });

  test('no screen formats a time through MaterialLocalizations (it writes Latin digits in Arabic)', () {
    final offenders = <String>[];
    for (final file in Directory('lib').listSync(recursive: true).whereType<File>()) {
      if (!file.path.endsWith('.dart')) continue;
      final lines = file.readAsLinesSync();
      for (var i = 0; i < lines.length; i++) {
        final line = lines[i];
        if (line.contains('.formatTimeOfDay(') && !line.trimLeft().startsWith('///')) {
          offenders.add('${file.path}:${i + 1}');
        }
      }
    }
    expect(offenders, isEmpty, reason: 'use formatClockTime (lib/shared/utils/clock_time.dart):\n${offenders.join('\n')}');
  });

  // Owner, 2026-10-28: the Schedule reads on a 12-hour clock everywhere, the
  // calendar's hour axis included.
  testWidgets('an hour on an axis: short, 12-hour, the locale\'s digits', (tester) async {
    expect(await inLocale(tester, 'en', (c) => formatClockHour(c, 13)), '1 PM');
    expect(await inLocale(tester, 'en', (c) => formatClockHour(c, 0)), '12 AM');
    expect(await inLocale(tester, 'en', (c) => formatClockHour(c, 24)), '12 AM');
    expect(await inLocale(tester, 'ar', (c) => formatClockHour(c, 13)), '١ م');
  });

  testWidgets('a wall-clock "HH:MM" from the server reads the same way; anything else as sent', (tester) async {
    expect(await inLocale(tester, 'en', (c) => formatWallClock(c, '17:00')), '5:00 PM');
    expect(await inLocale(tester, 'ar', (c) => formatWallClock(c, '09:30')), '٩:٣٠ ص');
    expect(await inLocale(tester, 'en', (c) => formatWallClock(c, 'soon')), 'soon');
  });

  test('no lesson or schedule screen writes a 24-hour time', () {
    final offenders = <String>[];
    for (final file in Directory('lib/features/lessons').listSync(recursive: true).whereType<File>()) {
      if (!file.path.endsWith('.dart')) continue;
      final lines = file.readAsLinesSync();
      for (var i = 0; i < lines.length; i++) {
        final line = lines[i];
        if (line.trimLeft().startsWith('//')) continue;
        if (line.contains('alwaysUse24HourFormat: true') || line.contains('DateFormat.Hm(') || line.contains('DateFormat.H(')) {
          offenders.add('${file.path}:${i + 1}');
        }
      }
    }
    expect(offenders, isEmpty, reason: 'the Schedule is 12-hour (formatClockTime / formatClockHour):\n${offenders.join('\n')}');
  });
}
