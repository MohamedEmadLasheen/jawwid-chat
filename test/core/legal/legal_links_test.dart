// PD-56 (store compliance): the privacy policy and the terms of use, linked on sign-in,
// sign-up and Settings from build-time URLs. `{lang}` follows the reader's language; only
// https is offered; unset means no link.
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/legal/legal_links.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/features/auth/application/auth_controller.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
import 'package:jawwid_chat/features/auth/presentation/sign_in_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

const _both = LegalLinks(privacyPolicy: 'https://jawwid.example.org/{lang}/privacy', terms: 'https://jawwid.example.org/{lang}/terms');

class _SignedOut extends AuthController {
  _SignedOut()
      : super(
          repository: FakeAuthRepository(backend: FakeBackend(role: UserRole.parent), tokens: InMemoryTokenStore()),
          tokens: InMemoryTokenStore(),
          clearLocalData: () async {},
        );

  @override
  AuthState build() => const AuthSignedOut();
}

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
  group('LegalLinks', () {
    test('{lang} becomes ar or en; anything else reads as en', () {
      expect(_both.privacyPolicyFor('ar').toString(), 'https://jawwid.example.org/ar/privacy');
      expect(_both.termsFor('en').toString(), 'https://jawwid.example.org/en/terms');
      expect(_both.termsFor('fr').toString(), 'https://jawwid.example.org/en/terms');
    });

    test('unset, blank or not https: no link', () {
      for (final raw in ['', '   ', 'http://jawwid.example.org/privacy', 'javascript:alert(1)', 'https://']) {
        expect(LegalLinks(privacyPolicy: raw, terms: raw).privacyPolicyFor('en'), isNull, reason: raw);
      }
    });
  });

  testWidgets('the row opens the page in the reader\'s language', (tester) async {
    final opened = <Uri>[];
    await tester.pumpWidget(_app([
      legalLinksProvider.overrideWithValue(_both),
      legalLinkOpenerProvider.overrideWithValue((uri) async {
        opened.add(uri);
        return true;
      }),
    ], const LegalLinksRow(), locale: const Locale('ar')));
    expect(find.text('سياسة الخصوصية'), findsOneWidget);
    expect(find.text('شروط الاستخدام'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('legal-privacy')));
    await tester.tap(find.byKey(const ValueKey('legal-terms')));
    expect(opened.map((u) => u.toString()), ['https://jawwid.example.org/ar/privacy', 'https://jawwid.example.org/ar/terms']);
  });

  testWidgets('nothing set: no row and no Settings tiles', (tester) async {
    const none = LegalLinks(privacyPolicy: '', terms: '');
    await tester.pumpWidget(_app([legalLinksProvider.overrideWithValue(none)], const Column(children: [LegalLinksRow(), LegalLinksTiles()])));
    expect(find.byType(TextButton), findsNothing);
    expect(find.byType(ListTile), findsNothing);
  });

  testWidgets('Settings tiles: both, in English', (tester) async {
    await tester.pumpWidget(_app([legalLinksProvider.overrideWithValue(_both)], const LegalLinksTiles()));
    expect(find.byKey(const ValueKey('settings-legal-privacy')), findsOneWidget);
    expect(find.byKey(const ValueKey('settings-legal-terms')), findsOneWidget);
    expect(find.text('Privacy policy'), findsOneWidget);
    expect(find.text('Terms of use'), findsOneWidget);
  });

  testWidgets('the sign-in screen shows both links before anyone signs in', (tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    addTearDown(tester.view.reset);
    await tester.pumpWidget(_app([
      authControllerProvider.overrideWith(_SignedOut.new),
      tokenStoreProvider.overrideWithValue(InMemoryTokenStore()),
      legalLinksProvider.overrideWithValue(_both),
    ], const SignInScreen()));
    await tester.pump();
    expect(find.byKey(const ValueKey('legal-privacy')), findsOneWidget);
    expect(find.byKey(const ValueKey('legal-terms')), findsOneWidget);
  });
}
