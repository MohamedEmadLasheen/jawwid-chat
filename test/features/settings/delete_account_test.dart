// PD-56 (store compliance, Apple 5.1.1(v)): a parent or a teacher deletes their own account
// from Settings. The screen says what goes and what stays, asks for the password and then
// once more; on success the server has ended every session, so the app signs out locally
// without calling /auth/logout. O-3: a teacher with lessons, students or payroll open requests
// deletion instead -- confirmed with the deadline date, then a status card with Cancel request.
// Fixed instants only.
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

final _asked = DateTime.utc(2026, 11, 7, 10);
final _deadline = DateTime.utc(2026, 12, 7, 10);
AccountDeletionRequest _req({String state = 'pending'}) =>
    AccountDeletionRequest(id: 'r-1', state: state, requestedAt: _asked, deadlineAt: _deadline);

class _Deletions implements AccountDeletionRepository {
  final calls = <String>[];
  Object? error;

  /// What the server says before the teacher chooses; null: the status call fails.
  AccountDeletionStatus? status_;

  /// Set: deleting records this request instead (a teacher with work open).
  AccountDeletionRequest? request;
  int cancels = 0;
  Object? cancelError;

  @override
  Future<AccountDeletionOutcome> deleteAccount({required String password}) async {
    calls.add(password);
    if (error != null) throw error!;
    final r = request;
    return r == null ? const AccountDeletionOutcome.deleted() : AccountDeletionOutcome.requested(r);
  }

  @override
  Future<AccountDeletionStatus> status() async {
    final s = status_;
    if (s == null) throw const AppError(AppErrorKind.network);
    return s;
  }

  @override
  Future<AccountDeletionRequest> cancelRequest() async {
    cancels += 1;
    if (cancelError != null) throw cancelError!;
    return _req(state: 'cancelled');
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

  testWidgets('a teacher with work open: "Request account deletion", the deadline in the confirmation, then the status card', (tester) async {
    repo.status_ = AccountDeletionStatus(immediate: false, deadlineIfRequested: _deadline);
    repo.request = _req();
    final l10n = await open(tester, role: UserRole.teacher);
    expect(find.text(l10n.deleteAccountRequestIntro), findsOneWidget);
    expect(find.widgetWithText(FilledButton, l10n.deleteAccountRequestAction), findsOneWidget);
    // A request is not "deleted now": what goes, goes with the account, within 30 days.
    expect(find.text(l10n.deleteAccountGoesOnRequest), findsOneWidget);
    expect(find.text(l10n.deleteAccountGoes), findsNothing);

    await tester.enterText(find.byKey(const ValueKey('delete-account-password')), 'my-password');
    await tester.ensureVisible(find.byKey(const ValueKey('delete-account-submit')));
    await tester.tap(find.byKey(const ValueKey('delete-account-submit')));
    await tester.pumpAndSettle();
    expect(find.text(l10n.deleteAccountRequestConfirm('December 7, 2026')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('delete-account-confirm')));
    await tester.pumpAndSettle();

    expect(repo.calls, ['my-password']);
    expect(signOuts, isEmpty);
    expect(find.byKey(const ValueKey('delete-account-request-card')), findsOneWidget);
    expect(find.text(l10n.deleteAccountRequestStatus('November 7, 2026', 'December 7, 2026')), findsOneWidget);
    expect(find.text(l10n.deleteAccountRequested), findsOneWidget);
    expect(find.byKey(const ValueKey('delete-account-password')), findsNothing);
  });

  testWidgets('a pending request is shown on opening; Cancel request asks once, then cancels', (tester) async {
    repo.status_ = AccountDeletionStatus(immediate: false, deadlineIfRequested: _deadline, request: _req());
    final l10n = await open(tester, role: UserRole.teacher);
    expect(find.text(l10n.deleteAccountRequestStatus('November 7, 2026', 'December 7, 2026')), findsOneWidget);

    // "Keep the request": nothing sent.
    await tester.tap(find.byKey(const ValueKey('delete-account-request-cancel')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('delete-account-request-keep')));
    await tester.pumpAndSettle();
    expect(repo.cancels, 0);

    repo.status_ = AccountDeletionStatus(immediate: false, deadlineIfRequested: _deadline, request: _req(state: 'cancelled'));
    await tester.tap(find.byKey(const ValueKey('delete-account-request-cancel')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('delete-account-request-cancel-confirm')));
    await tester.pumpAndSettle();
    expect(repo.cancels, 1);
    expect(find.text(l10n.deleteAccountRequestCancelled), findsOneWidget);
    // Back to the form: a cancelled request is not shown as pending.
    expect(find.byKey(const ValueKey('delete-account-request-card')), findsNothing);
    expect(find.widgetWithText(FilledButton, l10n.deleteAccountRequestAction), findsOneWidget);
    expect(signOuts, isEmpty);
  });

  testWidgets('a teacher with nothing open is deleted at once, as before', (tester) async {
    repo.status_ = AccountDeletionStatus(immediate: true, deadlineIfRequested: _deadline);
    final l10n = await open(tester, role: UserRole.teacher);
    expect(find.text(l10n.deleteAccountRequestIntro), findsNothing);
    expect(find.text(l10n.deleteAccountGoes), findsOneWidget);
    expect(find.text(l10n.deleteAccountGoesOnRequest), findsNothing);
    await submit(tester, 'my-password');
    expect(repo.calls, ['my-password']);
    expect(signOuts, [true]);
  });

  testWidgets('the status in Arabic, and the teacher\'s kept line names no period', (tester) async {
    repo.status_ = AccountDeletionStatus(immediate: false, deadlineIfRequested: _deadline, request: _req());
    final l10n = await open(tester, role: UserRole.teacher, locale: const Locale('ar'));
    expect(find.text('طُلب حذف الحساب'), findsOneWidget);
    expect(find.textContaining('وسيُحذف حسابك في موعد أقصاه'), findsOneWidget);
    expect(find.text('إلغاء الطلب'), findsOneWidget);
    // DEV-CONFIRM #31: the erasure states 7 years only for payments, invoices, receipts and the audit log.
    expect(l10n.deleteAccountKeptTeacher, isNot(contains('7')));
    expect((await L10n.delegate.load(const Locale('en'))).deleteAccountKeptTeacher, isNot(contains('7 years')));
  });

  testWidgets('in Arabic, a teacher\'s request form never says «يُحذف فورًا»', (tester) async {
    repo.status_ = AccountDeletionStatus(immediate: false, deadlineIfRequested: _deadline);
    final l10n = await open(tester, role: UserRole.teacher, locale: const Locale('ar'));
    expect(find.text(l10n.deleteAccountGoesOnRequest), findsOneWidget);
    expect(find.textContaining('يُحذف فورًا'), findsNothing);
    expect(l10n.deleteAccountGoesOnRequest, contains('30'));
    final en = await L10n.delegate.load(const Locale('en'));
    expect(en.deleteAccountGoesOnRequest, isNot(contains('Deleted now')));
    expect(en.deleteAccountGoesOnRequest, contains('30 days'));
  });

  testWidgets('reads in Arabic', (tester) async {
    await open(tester, locale: const Locale('ar'));
    expect(find.text('حذف الحساب'), findsWidgets);
    expect(find.text('حذف حسابي'), findsOneWidget);
  });
}
