// PD-56 (store compliance, Apple 5.1.1(v)): a parent or a teacher deletes their own account
// from Settings. The screen says what goes and what stays, asks for the password and then
// once more; on success the server has ended every session, so the app signs out locally
// without calling /auth/logout.
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/features/auth/application/auth_controller.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
import 'package:jawwid_chat/features/settings/presentation/delete_account_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

class _Deletions implements AccountDeletionRepository {
  final calls = <String>[];
  Object? error;

  @override
  Future<void> deleteAccount({required String password}) async {
    calls.add(password);
    if (error != null) throw error!;
  }
}

/// Records how the screen signs out.
class _Auth extends AuthController {
  _Auth(this.signOuts)
      : super(
          repository: FakeAuthRepository(backend: FakeBackend(role: UserRole.parent), tokens: InMemoryTokenStore()),
          tokens: InMemoryTokenStore(),
          clearLocalData: () async {},
        );

  final List<bool> signOuts;

  @override
  AuthState build() => const AuthSignedOut();

  @override
  Future<void> signOut({bool serverAlreadyEnded = false}) async => signOuts.add(serverAlreadyEnded);
}

void main() {
  late _Deletions repo;
  late List<bool> signOuts;

  setUp(() {
    repo = _Deletions();
    signOuts = [];
  });

  Future<L10n> open(WidgetTester tester, {UserRole role = UserRole.parent, Locale locale = const Locale('en')}) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [
        accountDeletionRepositoryProvider.overrideWithValue(repo),
        currentRoleProvider.overrideWithValue(role),
        authControllerProvider.overrideWith(() => _Auth(signOuts)),
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
        home: const DeleteAccountScreen(),
      ),
    ));
    await tester.pumpAndSettle();
    return L10n.delegate.load(locale);
  }

  Future<void> submit(WidgetTester tester, String password, {bool confirm = true}) async {
    await tester.enterText(find.byKey(const ValueKey('delete-account-password')), password);
    await tester.ensureVisible(find.byKey(const ValueKey('delete-account-submit')));
    await tester.tap(find.byKey(const ValueKey('delete-account-submit')));
    await tester.pumpAndSettle();
    if (password.isEmpty) return;
    await tester.tap(find.byKey(ValueKey(confirm ? 'delete-account-confirm' : 'delete-account-cancel')));
    await tester.pumpAndSettle();
  }

  testWidgets('says what goes and what stays -- a parent\'s children, a teacher\'s students', (tester) async {
    final l10n = await open(tester);
    expect(find.text(l10n.deleteAccountGoes), findsOneWidget);
    expect(find.text(l10n.deleteAccountKeptParent), findsOneWidget);

    await open(tester, role: UserRole.teacher);
    expect(find.text(l10n.deleteAccountKeptTeacher), findsOneWidget);
  });

  testWidgets('the password, then "Delete" once more: deleted, and signed out without calling the server', (tester) async {
    final l10n = await open(tester);
    await submit(tester, 'my-password');
    expect(repo.calls, ['my-password']);
    expect(signOuts, [true]);
    expect(find.text(l10n.deleteAccountDone), findsOneWidget);
  });

  testWidgets('no password: asked for, nothing sent; Cancel in the dialog: nothing sent', (tester) async {
    final l10n = await open(tester);
    await submit(tester, '');
    expect(find.text(l10n.changePasswordCurrentRequired), findsOneWidget);
    await submit(tester, 'my-password', confirm: false);
    expect(repo.calls, isEmpty);
    expect(signOuts, isEmpty);
  });

  testWidgets('a wrong password says so, stays signed in, and the screen stays', (tester) async {
    final l10n = await open(tester);
    repo.error = const AppError(AppErrorKind.invalidCredentials, code: 'AUTH.INVALID_CREDENTIALS');
    await submit(tester, 'wrong');
    expect(find.text(l10n.deleteAccountWrongPassword), findsOneWidget);
    expect(signOuts, isEmpty);
    expect(find.byType(DeleteAccountScreen), findsOneWidget);
  });

  testWidgets('too many tries and a locked account read as "too many"; anything else as "try again"', (tester) async {
    final l10n = await open(tester);
    repo.error = const AppError(AppErrorKind.rateLimited, code: 'COMMON.RATE_LIMITED');
    await submit(tester, 'x');
    expect(find.text(l10n.signupTooMany), findsOneWidget);
    repo.error = const AppError(AppErrorKind.network);
    await submit(tester, 'x');
    expect(find.text(l10n.deleteAccountFailed), findsOneWidget);
    expect(signOuts, isEmpty);
  });

  testWidgets('reads in Arabic', (tester) async {
    await open(tester, locale: const Locale('ar'));
    expect(find.text('حذف الحساب'), findsWidgets);
    expect(find.text('حذف حسابي'), findsOneWidget);
  });
}
