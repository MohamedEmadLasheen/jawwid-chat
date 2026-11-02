// TEACHER-023: a signed-in account changes its own password (any role; the teacher web
// portal too), and the sign-in screen tells a teacher or staff member plainly that the
// forgot-password way back is for parents -- theirs is a reset code from a supervisor.
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/features/auth/application/auth_controller.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
import 'package:jawwid_chat/features/auth/presentation/sign_in_screen.dart';
import 'package:jawwid_chat/features/settings/presentation/change_password_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

class _Changes implements PasswordChangeRepository {
  final calls = <(String, String)>[];
  Object? error;

  @override
  Future<void> change({required String currentPassword, required String newPassword}) async {
    calls.add((currentPassword, newPassword));
    if (error != null) throw error!;
  }
}

class _SignedOut extends AuthController {
  _SignedOut()
      : super(
          repository: FakeAuthRepository(backend: FakeBackend(role: UserRole.teacher), tokens: InMemoryTokenStore()),
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
        home: home,
      ),
    );

void main() {
  late _Changes repo;

  setUp(() => repo = _Changes());

  /// Settings opens the screen over a page, as the router does.
  Future<L10n> open(WidgetTester tester) async {
    await tester.pumpWidget(_app(
      [passwordChangeRepositoryProvider.overrideWithValue(repo)],
      Builder(
        builder: (context) => Scaffold(
          body: TextButton(
            onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const ChangePasswordScreen())),
            child: const Text('open'),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    return L10n.delegate.load(const Locale('en'));
  }

  Future<void> fill(WidgetTester tester, String current, String next, String confirm) async {
    await tester.enterText(find.byKey(const ValueKey('change-password-current')), current);
    await tester.enterText(find.byKey(const ValueKey('change-password-new')), next);
    await tester.enterText(find.byKey(const ValueKey('change-password-confirm')), confirm);
    await tester.tap(find.byKey(const ValueKey('change-password-submit')));
    await tester.pumpAndSettle();
  }

  testWidgets('the current password and a new one: changed, the screen closes, and it says the other devices are out', (tester) async {
    final l10n = await open(tester);
    await fill(tester, 'old-pass', 'new-pass', 'new-pass');
    expect(repo.calls, [('old-pass', 'new-pass')]);
    expect(find.byType(ChangePasswordScreen), findsNothing);
    expect(find.text(l10n.changePasswordDone), findsOneWidget);
  });

  testWidgets('a wrong current password says so and stays', (tester) async {
    final l10n = await open(tester);
    repo.error = const AppError(AppErrorKind.invalidCredentials, code: 'AUTH.INVALID_CREDENTIALS');
    await fill(tester, 'wrong', 'new-pass', 'new-pass');
    expect(find.text(l10n.changePasswordWrongCurrent), findsOneWidget);
    expect(find.byType(ChangePasswordScreen), findsOneWidget);
  });

  testWidgets('an empty current password says it is required -- not that it is wrong -- and nothing is sent', (tester) async {
    final l10n = await open(tester);
    await fill(tester, '', 'new-pass', 'new-pass');
    expect(find.text(l10n.changePasswordCurrentRequired), findsOneWidget);
    expect(find.text(l10n.changePasswordWrongCurrent), findsNothing);
    expect(repo.calls, isEmpty);
  });

  testWidgets('the same password again is refused with its own message', (tester) async {
    final l10n = await open(tester);
    repo.error = const AppError(AppErrorKind.validation, code: 'AUTH.PASSWORD_UNCHANGED');
    await fill(tester, 'old-pass', 'old-pass', 'old-pass');
    expect(find.text(l10n.changePasswordUnchanged), findsOneWidget);
    expect(find.byType(ChangePasswordScreen), findsOneWidget);
  });

  testWidgets('too short, or two different new passwords: nothing is sent', (tester) async {
    final l10n = await open(tester);
    await fill(tester, 'old-pass', 'abc', 'abc');
    expect(find.text(l10n.signupPasswordTooShort), findsOneWidget);
    await fill(tester, 'old-pass', 'new-pass', 'other-pass');
    expect(find.text(l10n.signupPasswordsDiffer), findsOneWidget);
    expect(repo.calls, isEmpty);
  });

  testWidgets('too many guesses is said plainly', (tester) async {
    final l10n = await open(tester);
    repo.error = const AppError(AppErrorKind.rateLimited, code: 'COMMON.RATE_LIMITED');
    await fill(tester, 'guess', 'new-pass', 'new-pass');
    expect(find.text(l10n.signupTooMany), findsOneWidget);
  });

  for (final locale in const [Locale('en'), Locale('ar')]) {
    testWidgets('sign-in: the recovery link is the parents\'; a teacher or staff member is pointed to a supervisor (${locale.languageCode})', (tester) async {
      await tester.pumpWidget(_app([
        authControllerProvider.overrideWith(_SignedOut.new),
        tokenStoreProvider.overrideWithValue(InMemoryTokenStore()),
      ], const SignInScreen(), locale: locale));
      await tester.pump();
      final l10n = await L10n.delegate.load(locale);
      expect(find.text(l10n.recoveryOpen), findsOneWidget);
      expect(find.text(l10n.signInStaffResetHint), findsOneWidget);
      expect(l10n.changePasswordTitle, isNotEmpty);
      expect(l10n.changePasswordDone, isNotEmpty);
    });
  }
}
