import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/features/auth/application/auth_controller.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
import 'package:jawwid_chat/features/auth/presentation/sign_in_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/auth.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// Signed out because the account is a department specialist (PD-40 plan §8).
class _SentToAdminWeb extends AuthController {
  _SentToAdminWeb()
      : super(
          repository: FakeAuthRepository(backend: FakeBackend(role: UserRole.parent), tokens: InMemoryTokenStore()),
          tokens: InMemoryTokenStore(),
          clearLocalData: _noop,
        );

  static Future<void> _noop() async {}

  @override
  AuthState build() => const AuthSignedOut(
        reason: SignedOutReason.usesAdminWeb,
        error: AppError(AppErrorKind.forbidden, code: AuthFailures.usesAdminWeb),
      );
}

/// PD-40: a staff account whose /me says `specialist` without `chat.use` is never adopted
/// (so no shell, and none of its requests); the sign-in screen says, plainly, that it uses
/// Admin Web, and offers the one thing left to do here: another account.
void main() {
  Future<void> pump(WidgetTester tester, {Locale locale = const Locale('en')}) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authControllerProvider.overrideWith(_SentToAdminWeb.new),
          tokenStoreProvider.overrideWithValue(InMemoryTokenStore()),
        ],
        child: MaterialApp(
          locale: locale,
          supportedLocales: const [Locale('ar'), Locale('en')],
          localizationsDelegates: const [
            L10n.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          home: const SignInScreen(),
        ),
      ),
    );
    await tester.pump();
  }

  testWidgets('says "This account uses Admin Web" in place of the form', (tester) async {
    await pump(tester);

    expect(find.byKey(const ValueKey('admin-web-only')), findsOneWidget);
    expect(find.text('This account uses Admin Web'), findsOneWidget);
    expect(find.textContaining('in a browser'), findsOneWidget);
    expect(find.byType(TextFormField), findsNothing);
  });

  testWidgets('"Use another account" brings the sign-in form back', (tester) async {
    await pump(tester);

    await tester.tap(find.byKey(const ValueKey('admin-web-only-another-account')));
    await tester.pump();

    expect(find.byKey(const ValueKey('admin-web-only')), findsNothing);
    expect(find.byType(TextFormField), findsWidgets);
  });

  testWidgets('in Arabic', (tester) async {
    await pump(tester, locale: const Locale('ar'));

    expect(find.text('هذا الحساب يستخدم لوحة التحكم (Admin Web)'), findsOneWidget);
    expect(find.text('استخدام حساب آخر'), findsOneWidget);
  });
}
