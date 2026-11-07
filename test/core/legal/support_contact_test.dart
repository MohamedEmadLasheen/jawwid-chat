// P-5 (Apple 1.2 / 1.5): published contact information inside the app. "Contact support"
// opens the support e-mail, "Help and support" opens the support page. Both come from
// build-time defines (SUPPORT_EMAIL, SUPPORT_URL); a value that is unset or malformed hides
// its row, so a broken link is never shown.
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/legal/legal_links.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';

const _both = SupportContact(url: 'https://jawwid.example.org/{lang}/help', email: 'support@jawwid.example.org');
const _legal = LegalLinks(privacyPolicy: 'https://jawwid.example.org/{lang}/privacy', terms: 'https://jawwid.example.org/{lang}/terms');
const _none = SupportContact(url: '', email: '');

Widget _app(List<Override> overrides, Widget home, {Locale locale = const Locale('en')}) => ProviderScope(
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
        home: Scaffold(body: home),
      ),
    );

void main() {
  group('SupportContact', () {
    test('the page: {lang} becomes ar or en, https only', () {
      expect(_both.pageFor('ar').toString(), 'https://jawwid.example.org/ar/help');
      expect(_both.pageFor('fr').toString(), 'https://jawwid.example.org/en/help');
      for (final raw in ['', '   ', 'http://jawwid.example.org/help', 'javascript:alert(1)', 'https://']) {
        expect(SupportContact(url: raw, email: '').pageFor('en'), isNull, reason: raw);
      }
    });

    test('the e-mail: a plausible address becomes a mailto link; anything else is none', () {
      expect(_both.mailto, Uri(scheme: 'mailto', path: 'support@jawwid.example.org'));
      expect(_both.emailAddress, 'support@jawwid.example.org');
      expect(const SupportContact(url: '', email: '  support@jawwid.example.org ').emailAddress, 'support@jawwid.example.org');
      for (final raw in ['', ' ', 'support', 'support@', '@jawwid.example.org', 'a b@jawwid.example.org', 'support@jawwid', 'a@b@c.org', 'mailto:support@jawwid.example.org']) {
        final c = SupportContact(url: '', email: raw);
        expect(c.mailto, isNull, reason: raw);
        expect(c.emailAddress, isNull, reason: raw);
      }
    });
  });

  group('Settings tiles', () {
    testWidgets('both set: Help and support opens the page, Contact support opens the e-mail', (tester) async {
      final opened = <Uri>[];
      await tester.pumpWidget(_app([
        supportContactProvider.overrideWithValue(_both),
        legalLinkOpenerProvider.overrideWithValue((uri) async {
          opened.add(uri);
          return true;
        }),
      ], const SupportLinksTiles(), locale: const Locale('ar')));
      expect(find.text('المساعدة والدعم'), findsOneWidget);
      expect(find.text('تواصل مع الدعم'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('settings-support-help')));
      await tester.tap(find.byKey(const ValueKey('settings-support-email')));
      expect(opened.map((u) => u.toString()), ['https://jawwid.example.org/ar/help', 'mailto:support@jawwid.example.org']);
    });

    testWidgets('English wording', (tester) async {
      await tester.pumpWidget(_app([supportContactProvider.overrideWithValue(_both)], const SupportLinksTiles()));
      expect(find.text('Help and support'), findsOneWidget);
      expect(find.text('Contact support'), findsOneWidget);
    });

    testWidgets('nothing set: no rows at all', (tester) async {
      await tester.pumpWidget(_app([supportContactProvider.overrideWithValue(_none)], const SupportLinksTiles()));
      expect(find.byType(ListTile), findsNothing);
    });

    testWidgets('only the e-mail set: only Contact support; only the URL set: only Help and support', (tester) async {
      await tester.pumpWidget(_app([supportContactProvider.overrideWithValue(const SupportContact(url: '', email: 'support@jawwid.example.org'))], const SupportLinksTiles()));
      expect(find.byKey(const ValueKey('settings-support-email')), findsOneWidget);
      expect(find.byKey(const ValueKey('settings-support-help')), findsNothing);
      await tester.pumpWidget(_app([supportContactProvider.overrideWithValue(const SupportContact(url: 'https://jawwid.example.org/help', email: ''))], const SupportLinksTiles()));
      expect(find.byKey(const ValueKey('settings-support-email')), findsNothing);
      expect(find.byKey(const ValueKey('settings-support-help')), findsOneWidget);
    });

    testWidgets('malformed values show no row (never a broken one)', (tester) async {
      await tester.pumpWidget(_app([supportContactProvider.overrideWithValue(const SupportContact(url: 'http://x.example/help', email: 'not-an-email'))], const SupportLinksTiles()));
      expect(find.byType(ListTile), findsNothing);
    });
  });

  group('sign-in links row', () {
    testWidgets('the support links stand next to the privacy policy and the terms', (tester) async {
      final opened = <Uri>[];
      await tester.pumpWidget(_app([
        legalLinksProvider.overrideWithValue(_legal),
        supportContactProvider.overrideWithValue(_both),
        legalLinkOpenerProvider.overrideWithValue((uri) async {
          opened.add(uri);
          return true;
        }),
      ], const LegalLinksRow()));
      expect(find.byKey(const ValueKey('legal-privacy')), findsOneWidget);
      expect(find.byKey(const ValueKey('legal-terms')), findsOneWidget);
      expect(find.byKey(const ValueKey('legal-support-help')), findsOneWidget);
      expect(find.byKey(const ValueKey('legal-support-email')), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('legal-support-email')));
      expect(opened.single.toString(), 'mailto:support@jawwid.example.org');
    });

    testWidgets('support unset: the legal links stay, no support buttons', (tester) async {
      await tester.pumpWidget(_app([legalLinksProvider.overrideWithValue(_legal), supportContactProvider.overrideWithValue(_none)], const LegalLinksRow()));
      expect(find.byKey(const ValueKey('legal-privacy')), findsOneWidget);
      expect(find.byKey(const ValueKey('legal-support-help')), findsNothing);
      expect(find.byKey(const ValueKey('legal-support-email')), findsNothing);
    });

    testWidgets('only support set: the row shows just the support buttons', (tester) async {
      await tester.pumpWidget(_app([legalLinksProvider.overrideWithValue(const LegalLinks(privacyPolicy: '', terms: '')), supportContactProvider.overrideWithValue(_both)], const LegalLinksRow()));
      expect(find.byType(TextButton), findsNWidgets(2));
    });

    testWidgets('everything unset: nothing', (tester) async {
      await tester.pumpWidget(_app([legalLinksProvider.overrideWithValue(const LegalLinks(privacyPolicy: '', terms: '')), supportContactProvider.overrideWithValue(_none)], const LegalLinksRow()));
      expect(find.byType(TextButton), findsNothing);
    });
  });
}
