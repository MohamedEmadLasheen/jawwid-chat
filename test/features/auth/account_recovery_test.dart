import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/features/auth/presentation/account_recovery_screen.dart';
import 'package:jawwid_chat/features/auth/presentation/forgot_email_screen.dart';
import 'package:jawwid_chat/features/auth/presentation/forgot_password_screen.dart';
import 'package:jawwid_chat/features/auth/presentation/recovery_widgets.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';

/// PD-25 on the client: a parent gets back into their account from the sign-in screen.
/// The server's answers are stubbed; what is held here is that the hub offers only the ways
/// the server switched on, each flow sends exactly what the API takes and nothing before the
/// parent's input is complete, a refusal reads in plain words, "Send a new code" waits out
/// the server's resend gap, and the result goes back to sign in normally.
void main() {
  late _FakeRecovery recovery;
  late _FakeReset reset;

  setUp(() {
    recovery = _FakeRecovery();
    reset = _FakeReset();
  });

  Widget app(Widget home, {Locale locale = const Locale('en')}) {
    return ProviderScope(
      overrides: [
        accountRecoveryRepositoryProvider.overrideWithValue(recovery),
        passwordResetRepositoryProvider.overrideWithValue(reset),
      ],
      child: MaterialApp(
        locale: locale,
        supportedLocales: JawwidApp.supportedLocales,
        localizationsDelegates: const [
          L10n.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        home: home,
      ),
    );
  }

  /// A phone-sized screen (390 x 844), so the whole form is on screen as a parent sees it.
  void phone(WidgetTester tester) {
    tester.view.physicalSize = const Size(1170, 2532);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
  }

  /// A launcher that records what the opened screen hands back.
  Widget launcher(Future<RecoveryResult?> Function(BuildContext) open, void Function(RecoveryResult?) onResult) {
    return Builder(
      builder: (context) => Scaffold(
        body: TextButton(onPressed: () async => onResult(await open(context)), child: const Text('open')),
      ),
    );
  }

  group('the hub', () {
    testWidgets('offers only the ways the server switched on, and always the academy code', (tester) async {
      phone(tester);
      recovery.opts = const RecoveryOptions(email: true, whatsapp: false, codeMinutes: 10);
      await tester.pumpWidget(app(const AccountRecoveryScreen()));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('recovery-forgot-password')), findsOneWidget);
      expect(find.byKey(const ValueKey('recovery-forgot-email')), findsNothing);
      expect(find.byKey(const ValueKey('recovery-have-code')), findsOneWidget);
      expect(find.text('Still stuck? Your supervisor can send you a one-time reset code.'), findsOneWidget);
    });

    testWidgets('with nothing switched on -- or no server -- it points to the supervisor', (tester) async {
      phone(tester);
      recovery.optionsError = const AppError(AppErrorKind.network);
      await tester.pumpWidget(app(const AccountRecoveryScreen()));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('recovery-forgot-password')), findsNothing);
      expect(find.byKey(const ValueKey('recovery-forgot-email')), findsNothing);
      expect(find.byKey(const ValueKey('recovery-have-code')), findsOneWidget);
      expect(find.textContaining('ask your supervisor for a one-time reset code'), findsOneWidget);
    });

    testWidgets('a finished flow goes all the way back to the sign-in screen', (tester) async {
      phone(tester);
      RecoveryResult? result;
      await tester.pumpWidget(app(launcher((c) => AccountRecoveryScreen.open(c), (r) => result = r)));
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('recovery-forgot-email')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('forgot-email-phone')), '010 0555 0123');
      await tester.tap(find.byKey(const ValueKey('forgot-email-send')));
      await tester.pump();
      await tester.enterText(find.byKey(const ValueKey('forgot-email-code')), '482913');
      await tester.tap(find.byKey(const ValueKey('forgot-email-verify')));
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('forgot-email-sign-in')));
      await tester.pumpAndSettle();
      expect(result, (username: 'parent@example.test', password: null));
      expect(find.text('open'), findsOneWidget);
    });
  });

  group('forgot password (e-mail)', () {
    testWidgets('e-mail -> code + new password; nothing is sent until the input is complete', (tester) async {
      phone(tester);
      RecoveryResult? result;
      await tester.pumpWidget(app(launcher((c) => ForgotPasswordScreen.open(c, codeMinutes: 10), (r) => result = r)));
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      expect(find.text('Step 1 of 2'), findsOneWidget);

      await tester.enterText(find.byKey(const ValueKey('forgot-password-email')), 'not-an-email');
      await tester.tap(find.byKey(const ValueKey('forgot-password-submit')));
      await tester.pump();
      expect(find.text('Enter a valid e-mail address.'), findsOneWidget);
      expect(recovery.calls, isEmpty);

      await tester.enterText(find.byKey(const ValueKey('forgot-password-email')), ' Parent@Example.test ');
      await tester.tap(find.byKey(const ValueKey('forgot-password-submit')));
      await tester.pump();
      expect(recovery.calls, ['password Parent@Example.test']);
      expect(find.text('Step 2 of 2'), findsOneWidget);
      // Never "we found your account": the server does not say, and neither does the screen.
      expect(find.textContaining('If Parent@Example.test is a parent account'), findsOneWidget);
      expect(find.textContaining('10 minutes'), findsOneWidget);

      await tester.enterText(find.byKey(const ValueKey('forgot-password-code')), '4829');
      await tester.enterText(find.byKey(const ValueKey('forgot-password-password')), 'long-password-1');
      await tester.enterText(find.byKey(const ValueKey('forgot-password-confirm')), 'long-password-1');
      await tester.tap(find.byKey(const ValueKey('forgot-password-submit')));
      await tester.pump();
      expect(find.text('Enter the 6 digits of the code.'), findsOneWidget);
      expect(reset.completed, isEmpty);

      await tester.enterText(find.byKey(const ValueKey('forgot-password-code')), '482913');
      await tester.tap(find.byKey(const ValueKey('forgot-password-submit')));
      await tester.pumpAndSettle();
      expect(reset.completed, ['parent@example.test 482913 long-password-1']);
      expect(result, (username: 'parent@example.test', password: 'long-password-1'));
    });

    testWidgets('"Send a new code" waits out the server\'s resend gap, then sends again', (tester) async {
      phone(tester);
      await tester.pumpWidget(app(const ForgotPasswordScreen(initialEmail: 'parent@example.test')));
      await tester.tap(find.byKey(const ValueKey('forgot-password-submit')));
      await tester.pump();
      expect(recovery.calls, ['password parent@example.test']);

      Finder resend() => find.byKey(const ValueKey('recovery-resend'));
      expect(tester.widget<TextButton>(resend()).onPressed, isNull);
      expect(find.text('Send a new code in 60 s'), findsOneWidget);
      await tester.pump(const Duration(seconds: 30));
      expect(find.text('Send a new code in 30 s'), findsOneWidget);
      await tester.pump(const Duration(seconds: 30));
      expect(tester.widget<TextButton>(resend()).onPressed, isNotNull);

      await tester.tap(resend());
      await tester.pump();
      expect(recovery.calls, ['password parent@example.test', 'password parent@example.test']);
      expect(find.text('A new code is on its way. Only the newest code works.'), findsOneWidget);
      expect(tester.widget<TextButton>(resend()).onPressed, isNull);
      await tester.pump(const Duration(seconds: 61));
    });

    testWidgets('a refused code reads plainly, in Arabic too, and the parent can fix it', (tester) async {
      phone(tester);
      reset.refuseWith = 'AUTH.RESET_CODE_INVALID';
      await tester.pumpWidget(app(const ForgotPasswordScreen(initialEmail: 'parent@example.test'), locale: const Locale('ar')));
      await tester.tap(find.byKey(const ValueKey('forgot-password-submit')));
      await tester.pump();
      await tester.enterText(find.byKey(const ValueKey('forgot-password-code')), '000000');
      await tester.enterText(find.byKey(const ValueKey('forgot-password-password')), 'long-password-1');
      await tester.enterText(find.byKey(const ValueKey('forgot-password-confirm')), 'long-password-1');
      await tester.tap(find.byKey(const ValueKey('forgot-password-submit')));
      await tester.pump();
      expect(find.text('الرمز غير صحيح أو انتهت صلاحيته. تحقّق منه، أو اطلب رمزًا جديدًا.'), findsOneWidget);
      // Still on the code step: nothing typed is lost.
      expect(find.byKey(const ValueKey('forgot-password-code')), findsOneWidget);
      await tester.pump(const Duration(seconds: 61));
    });

    testWidgets('"Use a different e-mail" goes back to step 1', (tester) async {
      phone(tester);
      await tester.pumpWidget(app(const ForgotPasswordScreen(initialEmail: 'parent@example.test')));
      await tester.tap(find.byKey(const ValueKey('forgot-password-submit')));
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('forgot-password-change-email')));
      await tester.pump();
      expect(find.text('Step 1 of 2'), findsOneWidget);
      expect(find.byKey(const ValueKey('forgot-password-code')), findsNothing);
    });
  });

  group('forgot e-mail (WhatsApp)', () {
    testWidgets('phone -> code -> the sign-in e-mail; the same code then sets a password', (tester) async {
      phone(tester);
      RecoveryResult? result;
      await tester.pumpWidget(app(launcher((c) => ForgotEmailScreen.open(c), (r) => result = r)));
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('forgot-email-send')));
      await tester.pump();
      expect(find.text('Enter your phone number.'), findsOneWidget);
      expect(recovery.calls, isEmpty);

      await tester.enterText(find.byKey(const ValueKey('forgot-email-phone')), '+20 100 555 0123');
      await tester.tap(find.byKey(const ValueKey('forgot-email-send')));
      await tester.pump();
      expect(recovery.calls, ['email +20 100 555 0123']);
      expect(find.text('Step 2 of 3'), findsOneWidget);
      expect(find.textContaining('If this number is on file'), findsOneWidget);

      recovery.verifyRefusal = 'AUTH.RESET_CODE_INVALID';
      await tester.enterText(find.byKey(const ValueKey('forgot-email-code')), '111111');
      await tester.tap(find.byKey(const ValueKey('forgot-email-verify')));
      await tester.pump();
      expect(find.text('That code is wrong or has expired. Check it, or send a new one.'), findsOneWidget);

      recovery.verifyRefusal = null;
      await tester.enterText(find.byKey(const ValueKey('forgot-email-code')), '482913');
      await tester.tap(find.byKey(const ValueKey('forgot-email-verify')));
      await tester.pump();
      expect(recovery.calls.last, 'verify +20 100 555 0123 482913');
      expect(find.text('Step 3 of 3'), findsOneWidget);
      expect(find.text('Your sign-in e-mail is:'), findsOneWidget);
      expect(find.text('parent@example.test'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('forgot-email-new-password')));
      await tester.pump();
      await tester.enterText(find.byKey(const ValueKey('forgot-email-password')), 'long-password-1');
      await tester.enterText(find.byKey(const ValueKey('forgot-email-confirm')), 'long-password-2');
      await tester.tap(find.byKey(const ValueKey('forgot-email-set-password')));
      await tester.pump();
      expect(find.text('The passwords do not match.'), findsOneWidget);
      expect(reset.completed, isEmpty);

      await tester.enterText(find.byKey(const ValueKey('forgot-email-confirm')), 'long-password-1');
      await tester.tap(find.byKey(const ValueKey('forgot-email-set-password')));
      await tester.pumpAndSettle();
      expect(reset.completed, ['parent@example.test 482913 long-password-1']);
      expect(result, (username: 'parent@example.test', password: 'long-password-1'));
    });

    testWidgets('a phone with two accounts asks which one, and signs in with the choice', (tester) async {
      phone(tester);
      recovery.emails = ['first@example.test', 'second@example.test'];
      RecoveryResult? result;
      await tester.pumpWidget(app(launcher((c) => ForgotEmailScreen.open(c), (r) => result = r)));
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('forgot-email-phone')), '01005550123');
      await tester.tap(find.byKey(const ValueKey('forgot-email-send')));
      await tester.pump();
      await tester.enterText(find.byKey(const ValueKey('forgot-email-code')), '482913');
      await tester.tap(find.byKey(const ValueKey('forgot-email-verify')));
      await tester.pump();

      expect(find.text('This phone number belongs to more than one account. Choose the one you want:'), findsOneWidget);
      final signIn = find.byKey(const ValueKey('forgot-email-sign-in'));
      expect(tester.widget<FilledButton>(signIn).onPressed, isNull);

      await tester.tap(find.byKey(const ValueKey('forgot-email-choice-second@example.test')));
      await tester.pump();
      await tester.tap(signIn);
      await tester.pumpAndSettle();
      expect(result, (username: 'second@example.test', password: null));
    });

    testWidgets('lays out in Arabic without overflow', (tester) async {
      phone(tester);
      await tester.pumpWidget(app(const ForgotEmailScreen(), locale: const Locale('ar')));
      await tester.enterText(find.byKey(const ValueKey('forgot-email-phone')), '01005550123');
      await tester.tap(find.byKey(const ValueKey('forgot-email-send')));
      await tester.pump();
      expect(find.text('الخطوة 2 من 3'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pump(const Duration(seconds: 61));
    });
  });
}

class _FakeRecovery implements AccountRecoveryRepository {
  RecoveryOptions opts = const RecoveryOptions(email: true, whatsapp: true, codeMinutes: 10);
  AppError? optionsError;
  String? verifyRefusal;
  List<String> emails = const ['parent@example.test'];
  final calls = <String>[];

  @override
  Future<RecoveryOptions> options() async {
    if (optionsError != null) throw optionsError!;
    return opts;
  }

  @override
  Future<void> requestPasswordCode(String email) async => calls.add('password $email');

  @override
  Future<void> requestEmailCode(String phone) async => calls.add('email $phone');

  @override
  Future<List<String>> verifyEmailCode({required String phone, required String code}) async {
    if (verifyRefusal != null) throw AppError(AppErrorKind.unauthenticated, code: verifyRefusal);
    calls.add('verify $phone $code');
    return emails;
  }
}

class _FakeReset implements PasswordResetRepository {
  String? refuseWith;
  final completed = <String>[];

  @override
  Future<void> complete({required String username, required String code, required String password}) async {
    if (refuseWith != null) throw AppError(AppErrorKind.unauthenticated, code: refuseWith);
    completed.add('$username $code $password');
  }
}
