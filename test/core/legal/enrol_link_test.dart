// Apple 2.1 / 3.2 (App Review, 2026-11): the sign-in screen shows a member of the public how to
// become a family of the academy. "New to Jawwid? Enrol your child" opens the academy's public
// enrolment page in the browser. The URL is a build-time define (ENROL_URL, `{lang}` becomes ar
// or en, https only) with the public page as its default; anything else hides the link.
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/legal/legal_links.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';

Widget _app(List<Override> overrides, {Locale locale = const Locale('en')}) => ProviderScope(
      overrides: overrides,
      child: MaterialApp(
        locale: locale,
        supportedLocales: const [Locale('ar'), Locale('en')],
        localizationsDelegates: const [
          L10n.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        home: const Scaffold(body: EnrolLink()),
      ),
    );

void main() {
  group('EnrolPage', () {
    test('the default is the academy public enrolment page', () {
      expect(EnrolPage.defaultUrl, 'https://jawwid.com/enroll/');
      expect(const EnrolPage(url: EnrolPage.defaultUrl).pageFor('en').toString(), 'https://jawwid.com/enroll/');
    });

    test('{lang} becomes ar or en; https only', () {
      const page = EnrolPage(url: 'https://jawwid.example.org/{lang}/enrol');
      expect(page.pageFor('ar').toString(), 'https://jawwid.example.org/ar/enrol');
      expect(page.pageFor('fr').toString(), 'https://jawwid.example.org/en/enrol');
      for (final raw in ['', '  ', 'http://jawwid.example.org/enrol', 'javascript:alert(1)', 'https://']) {
        expect(EnrolPage(url: raw).pageFor('en'), isNull, reason: raw);
      }
    });
  });

  group('EnrolLink', () {
    testWidgets('English: the link opens the enrolment page in the browser', (tester) async {
      final opened = <Uri>[];
      await tester.pumpWidget(_app([
        enrolPageProvider.overrideWithValue(const EnrolPage(url: 'https://jawwid.example.org/{lang}/enrol')),
        legalLinkOpenerProvider.overrideWithValue((uri) async {
          opened.add(uri);
          return true;
        }),
      ]));
      expect(find.text('New to Jawwid? Enrol your child'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('enrol-open')));
      expect(opened.map((u) => u.toString()), ['https://jawwid.example.org/en/enrol']);
    });

    testWidgets('Arabic wording and Arabic page', (tester) async {
      final opened = <Uri>[];
      await tester.pumpWidget(_app([
        enrolPageProvider.overrideWithValue(const EnrolPage(url: 'https://jawwid.example.org/{lang}/enrol')),
        legalLinkOpenerProvider.overrideWithValue((uri) async {
          opened.add(uri);
          return true;
        }),
      ], locale: const Locale('ar')));
      expect(find.text('جديد في جوِّد؟ سجّل طفلك'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('enrol-open')));
      expect(opened.single.toString(), 'https://jawwid.example.org/ar/enrol');
    });

    testWidgets('unset or not https: no link at all', (tester) async {
      for (final raw in ['', 'http://jawwid.example.org/enrol']) {
        await tester.pumpWidget(_app([enrolPageProvider.overrideWithValue(EnrolPage(url: raw))]));
        expect(find.byKey(const ValueKey('enrol-open')), findsNothing, reason: raw);
      }
    });
  });
}
