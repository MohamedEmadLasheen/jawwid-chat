import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/features/auth/presentation/password_reset_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';

/// PD-21 on the client: a parent or teacher finishes a password reset with the one-time code
/// the academy handed over and a password of their own. The server's answers are stubbed;
/// what is held here is that the screen sends exactly what the API takes, refuses locally
/// what it would refuse, shows a refusal in plain words, and hands the credentials back to
/// sign in normally.
void main() {
  Widget app(Widget home, _RecordingReset repo, {Locale locale = const Locale('en')}) {
    return ProviderScope(
      overrides: [passwordResetRepositoryProvider.overrideWithValue(repo)],
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

  testWidgets('login, code and a new password; nothing is sent until they agree; success hands them back', (tester) async {
    final repo = _RecordingReset();
    PasswordResetResult? result;
    await tester.pumpWidget(app(
      Builder(
        builder: (context) => Scaffold(
          body: TextButton(
            onPressed: () async => result = await PasswordResetScreen.open(context, initialUsername: 'teacher@example.test'),
            child: const Text('open'),
          ),
        ),
      ),
      repo,
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    // The login typed on the sign-in screen is carried over.
    expect(find.text('teacher@example.test'), findsOneWidget);

    await tester.enterText(find.byKey(const ValueKey('reset-code')), '4829');
    await tester.enterText(find.byKey(const ValueKey('reset-password')), 'abc');
    await tester.tap(find.byKey(const ValueKey('reset-submit')));
    await tester.pump();
    expect(find.text('Use at least 4 characters.'), findsOneWidget);
    expect(repo.completed, isEmpty);

    await tester.enterText(find.byKey(const ValueKey('reset-code')), '482913');
    await tester.enterText(find.byKey(const ValueKey('reset-password')), 'long-password-1');
    await tester.enterText(find.byKey(const ValueKey('reset-confirm')), 'different-password');
    await tester.tap(find.byKey(const ValueKey('reset-submit')));
    await tester.pump();
    expect(find.text('The passwords do not match.'), findsOneWidget);
    expect(repo.completed, isEmpty);

    await tester.enterText(find.byKey(const ValueKey('reset-confirm')), 'long-password-1');
    await tester.tap(find.byKey(const ValueKey('reset-submit')));
    await tester.pumpAndSettle();
    expect(repo.completed, ['teacher@example.test 482913 long-password-1']);
    expect(result, (username: 'teacher@example.test', password: 'long-password-1'));
  });

  // Owner decision 2026-10-27: a password may be as short as 4 characters, for every account.
  testWidgets('3 characters are refused locally; 4 are sent', (tester) async {
    final repo = _RecordingReset();
    await tester.pumpWidget(app(const PasswordResetScreen(), repo));
    await tester.enterText(find.byKey(const ValueKey('reset-username')), 'teacher@example.test');
    await tester.enterText(find.byKey(const ValueKey('reset-code')), '482913');
    await tester.enterText(find.byKey(const ValueKey('reset-password')), 'abc');
    await tester.enterText(find.byKey(const ValueKey('reset-confirm')), 'abc');
    await tester.tap(find.byKey(const ValueKey('reset-submit')));
    await tester.pump();
    expect(find.text('Use at least 4 characters.'), findsOneWidget);
    expect(repo.completed, isEmpty);

    await tester.enterText(find.byKey(const ValueKey('reset-password')), '1234');
    await tester.enterText(find.byKey(const ValueKey('reset-confirm')), '1234');
    await tester.tap(find.byKey(const ValueKey('reset-submit')));
    await tester.pumpAndSettle();
    expect(find.text('Use at least 4 characters.'), findsNothing);
    expect(repo.completed, ['teacher@example.test 482913 1234']);
  });

  testWidgets('the Arabic text says 4 too', (tester) async {
    await tester.pumpWidget(app(const PasswordResetScreen(), _RecordingReset(), locale: const Locale('ar')));
    await tester.enterText(find.byKey(const ValueKey('reset-password')), 'abc');
    await tester.tap(find.byKey(const ValueKey('reset-submit')));
    await tester.pump();
    expect(find.text('استخدم 4 أحرف على الأقل.'), findsOneWidget);
  });

  testWidgets('a code the server refuses says so plainly, in Arabic too', (tester) async {
    final repo = _RecordingReset(refuseWith: 'AUTH.RESET_CODE_INVALID');
    await tester.pumpWidget(app(const PasswordResetScreen(), repo, locale: const Locale('ar')));
    await tester.enterText(find.byKey(const ValueKey('reset-username')), 'parent@example.test');
    await tester.enterText(find.byKey(const ValueKey('reset-code')), '000000');
    await tester.enterText(find.byKey(const ValueKey('reset-password')), 'long-password-1');
    await tester.enterText(find.byKey(const ValueKey('reset-confirm')), 'long-password-1');
    await tester.tap(find.byKey(const ValueKey('reset-submit')));
    await tester.pumpAndSettle();
    expect(find.text('هذا الرمز غير صالح أو منتهي أو مستخدم من قبل. اطلب رمزًا جديدًا من الأكاديمية.'), findsOneWidget);
  });
}

class _RecordingReset implements PasswordResetRepository {
  _RecordingReset({this.refuseWith});

  final String? refuseWith;
  final completed = <String>[];

  @override
  Future<void> complete({required String username, required String code, required String password}) async {
    if (refuseWith != null) throw AppError(AppErrorKind.unauthenticated, code: refuseWith);
    completed.add('$username $code $password');
  }
}
