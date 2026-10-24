import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/features/auth/application/auth_controller.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
import 'package:jawwid_chat/features/auth/presentation/web_portal_gate.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/auth.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// Signed in as [user]; signing out ends in signed-out, as the real controller does.
class _SignedIn extends AuthController {
  _SignedIn(this._user)
      : super(
          repository: FakeAuthRepository(backend: FakeBackend(role: _user.role), tokens: InMemoryTokenStore()),
          tokens: InMemoryTokenStore(),
          clearLocalData: _noop,
        );

  final AuthUser _user;
  bool signedOut = false;

  static Future<void> _noop() async {}

  @override
  AuthState build() => AuthAuthenticated(_user);

  @override
  Future<void> signOut({bool serverAlreadyEnded = false}) async {
    signedOut = true;
    state = const AuthSignedOut();
  }
}

AuthUser user(UserRole role, {bool superAdmin = false}) =>
    AuthUser(id: 'u-${role.name}', displayName: 'Someone', role: role, isSuperAdmin: superAdmin);

/// PD-28: in a browser the app is the teacher portal; on a phone nothing changes.
void main() {
  group('webPortalRefuses', () {
    test('a teacher in a browser is let in', () {
      expect(webPortalRefuses(user(UserRole.teacher), isWeb: true), isFalse);
    });

    test('a parent and every staff seat are refused in a browser', () {
      expect(webPortalRefuses(user(UserRole.parent), isWeb: true), isTrue);
      expect(webPortalRefuses(user(UserRole.sales), isWeb: true), isTrue);
      expect(webPortalRefuses(user(UserRole.sales, superAdmin: true), isWeb: true), isTrue);
    });

    test('nobody signed in is not refused: the sign-in screen must show', () {
      expect(webPortalRefuses(null, isWeb: true), isFalse);
    });

    test('the phone builds are unchanged for every role', () {
      for (final role in UserRole.values) {
        expect(webPortalRefuses(user(role), isWeb: false), isFalse, reason: role.name);
      }
    });
  });

  group('WebPortalGate', () {
    Future<_SignedIn> pump(WidgetTester tester, AuthUser who, {required bool isWeb, Locale locale = const Locale('en')}) async {
      final controller = _SignedIn(who);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [authControllerProvider.overrideWith(() => controller)],
          child: MaterialApp(
            locale: locale,
            supportedLocales: const [Locale('ar'), Locale('en')],
            localizationsDelegates: const [
              L10n.delegate,
              GlobalMaterialLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
              GlobalCupertinoLocalizations.delegate,
            ],
            home: WebPortalGate(isWeb: isWeb, child: const Text('the app')),
          ),
        ),
      );
      await tester.pump();
      return controller;
    }

    testWidgets('a teacher in a browser sees the app', (tester) async {
      await pump(tester, user(UserRole.teacher), isWeb: true);

      expect(find.text('the app'), findsOneWidget);
      expect(find.byKey(const ValueKey('web-portal-refusal')), findsNothing);
    });

    testWidgets('a parent in a browser is told to use the phone app, and can sign out', (tester) async {
      final controller = await pump(tester, user(UserRole.parent), isWeb: true);

      expect(find.text('the app'), findsNothing);
      expect(find.text('The web portal is for teachers'), findsOneWidget);
      expect(find.text('Please use the Jawwid app on your phone.'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('web-portal-sign-out')));
      await tester.pump();

      expect(controller.signedOut, isTrue);
      // Signed out, the gate steps aside so the router can show the sign-in screen.
      expect(find.text('the app'), findsOneWidget);
    });

    testWidgets('a staff seat in a browser is pointed at Admin Web, in Arabic too', (tester) async {
      await pump(tester, user(UserRole.sales), isWeb: true, locale: const Locale('ar'));

      expect(find.text('بوابة الويب مخصّصة للمعلمين'), findsOneWidget);
      expect(find.textContaining('Admin Web'), findsOneWidget);
    });

    testWidgets('on a phone a parent sees the app as always', (tester) async {
      await pump(tester, user(UserRole.parent), isWeb: false);

      expect(find.text('the app'), findsOneWidget);
    });
  });
}
