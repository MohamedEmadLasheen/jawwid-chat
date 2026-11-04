import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/features/auth/presentation/parent_signup_screen.dart';
import 'package:jawwid_chat/features/settings/data/parent_notice_repository.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';

/// PD-16 on the client: a parent creates their account with the e-mail the academy has and
/// the code their supervisor relays. The server's answers are stubbed; what is held here is
/// that the screen sends exactly what the API takes, refuses locally what it would refuse,
/// shows a refusal in plain words, and hands the credentials back to sign in normally.
/// The form grew (PD-48): the button may sit below the fold, so it is scrolled into view first.
/// A field that just took text scrolls itself into view; that settles before the button is found.
Future<void> submit(WidgetTester tester) async {
  await tester.pumpAndSettle();
  await tester.ensureVisible(find.byKey(const ValueKey('signup-submit')));
  await tester.tap(find.byKey(const ValueKey('signup-submit')));
}

/// PD-48: the lesson-audio line, ticked before the account is finished -- from Phase 2
/// ([kLessonAudioNoticeLive]); until then there is no line to tick.
Future<void> tick(WidgetTester tester) async {
  if (!kLessonAudioNoticeLive) return;
  await tester.pumpAndSettle();
  await tester.ensureVisible(find.byKey(const ValueKey('signup-lesson-audio')));
  await tester.tap(find.byKey(const ValueKey('signup-lesson-audio')));
  await tester.pump();
}

void main() {
  Widget app(Widget home, _RecordingSignup repo, {Locale locale = const Locale('en')}) {
    return ProviderScope(
      overrides: [parentSignupRepositoryProvider.overrideWithValue(repo)],
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

  testWidgets('e-mail, then the relayed code and a password; success hands the credentials back', (tester) async {
    final repo = _RecordingSignup();
    ParentSignupResult? result;
    await tester.pumpWidget(app(
      Builder(
        builder: (context) => Scaffold(
          body: TextButton(onPressed: () async => result = await ParentSignupScreen.open(context), child: const Text('open')),
        ),
      ),
      repo,
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const ValueKey('signup-email')), 'not-an-email');
    await submit(tester);
    await tester.pump();
    expect(find.text('Enter a valid e-mail address.'), findsOneWidget);
    expect(repo.requested, isEmpty);

    await tester.enterText(find.byKey(const ValueKey('signup-email')), ' parent@example.test ');
    await submit(tester);
    await tester.pumpAndSettle();
    expect(repo.requested, ['parent@example.test']);
    expect(find.textContaining('on WhatsApp'), findsOneWidget);

    await tester.enterText(find.byKey(const ValueKey('signup-code')), '482913');
    await tick(tester);
    await tester.enterText(find.byKey(const ValueKey('signup-password')), 'long-password-1');
    await tester.enterText(find.byKey(const ValueKey('signup-confirm')), 'different-password');
    await submit(tester);
    await tester.pump();
    expect(find.text('The passwords do not match.'), findsOneWidget);
    expect(repo.verified, isEmpty);

    await tester.enterText(find.byKey(const ValueKey('signup-confirm')), 'long-password-1');
    await submit(tester);
    await tester.pumpAndSettle();
    expect(repo.verified, ['parent@example.test 482913 long-password-1']);
    expect(result, (email: 'parent@example.test', password: 'long-password-1'));
  });

  // Owner decision 2026-10-27: a password may be as short as 4 characters, for every account.
  testWidgets('a 3-character password is refused locally; a 4-character one is sent', (tester) async {
    final repo = _RecordingSignup();
    await tester.pumpWidget(app(const ParentSignupScreen(), repo));
    await tester.enterText(find.byKey(const ValueKey('signup-email')), 'parent@example.test');
    await submit(tester);
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const ValueKey('signup-code')), '482913');
    await tick(tester);
    await tester.enterText(find.byKey(const ValueKey('signup-password')), 'abc');
    await tester.enterText(find.byKey(const ValueKey('signup-confirm')), 'abc');
    await submit(tester);
    await tester.pump();
    expect(find.text('Use at least 4 characters.'), findsOneWidget);
    expect(repo.verified, isEmpty);

    await tester.enterText(find.byKey(const ValueKey('signup-password')), '1234');
    await tester.enterText(find.byKey(const ValueKey('signup-confirm')), '1234');
    await submit(tester);
    await tester.pumpAndSettle();
    expect(repo.verified, ['parent@example.test 482913 1234']);
  });

  testWidgets('a code the server refuses says so plainly, in Arabic too, and a new code can be asked for', (tester) async {
    final repo = _RecordingSignup(refuseVerifyWith: 'AUTH.SIGNUP_CODE_INVALID');
    await tester.pumpWidget(app(const ParentSignupScreen(), repo, locale: const Locale('ar')));
    await tester.enterText(find.byKey(const ValueKey('signup-email')), 'parent@example.test');
    await submit(tester);
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('signup-code')), '000000');
    await tick(tester);
    await tester.enterText(find.byKey(const ValueKey('signup-password')), 'long-password-1');
    await tester.enterText(find.byKey(const ValueKey('signup-confirm')), 'long-password-1');
    await submit(tester);
    await tester.pumpAndSettle();
    expect(find.text('هذا الرمز غير صالح أو انتهت صلاحيته. اطلب رمزًا جديدًا.'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('signup-new-code')));
    await tester.pumpAndSettle();
    expect(repo.requested, hasLength(2));
  });

  // PD-16 amendment: after 10 wrong codes in 24 h the server answers 403
  // AUTH.SIGNUP_LOCKED. Asking for a new code would not help, so the screen sends the
  // parent to their supervisor instead of repeating the invalid-code text.
  for (final (locale, locked, invalid) in [
    (const Locale('en'), 'Too many wrong codes. Please contact your supervisor.',
        'That code is not valid or has expired. Ask for a new one.'),
    (const Locale('ar'), 'أدخلت رمزًا خاطئًا مرات كثيرة. تواصل مع المشرف.',
        'هذا الرمز غير صالح أو انتهت صلاحيته. اطلب رمزًا جديدًا.'),
  ]) {
    testWidgets('a locked sign-up says to contact the supervisor (${locale.languageCode})', (tester) async {
      final repo = _RecordingSignup(refuseVerifyWith: 'AUTH.SIGNUP_LOCKED', refuseKind: AppErrorKind.forbidden);
      await tester.pumpWidget(app(const ParentSignupScreen(), repo, locale: locale));
      await tester.enterText(find.byKey(const ValueKey('signup-email')), 'parent@example.test');
      await submit(tester);
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('signup-code')), '000000');
      await tick(tester);
      await tester.enterText(find.byKey(const ValueKey('signup-password')), 'long-password-1');
      await tester.enterText(find.byKey(const ValueKey('signup-confirm')), 'long-password-1');
      await submit(tester);
      await tester.pumpAndSettle();

      expect(find.text(locked), findsOneWidget);
      expect(find.text(invalid), findsNothing);
    });
  }

  // Phase 2 (owner 2026-11-03): the lessons are postponed, so sign-up shows no lesson-audio
  // line or link and sends no notice version -- the server then records no acknowledgement,
  // and the account is created all the same (apps/api/test/integration/
  // new-student-enrolment-pd016.spec.ts). The ticked flow returns with the switch; its tests
  // are in this file's history (PR #446).
  testWidgets('Phase 2: no lesson-audio line or link at any step; finishing sends no notice version', (tester) async {
    expect(kLessonAudioNoticeLive, isFalse);
    final repo = _RecordingSignup();
    await tester.pumpWidget(app(const ParentSignupScreen(), repo));
    void noLessonAudio() {
      expect(find.byKey(const ValueKey('signup-lesson-audio'), skipOffstage: false), findsNothing);
      expect(find.byKey(const ValueKey('signup-lesson-audio-about'), skipOffstage: false), findsNothing);
      expect(find.byType(CheckboxListTile, skipOffstage: false), findsNothing);
      expect(find.textContaining('lesson', skipOffstage: false), findsNothing);
    }

    noLessonAudio();
    await tester.enterText(find.byKey(const ValueKey('signup-email')), 'parent@example.test');
    await submit(tester);
    await tester.pumpAndSettle();
    noLessonAudio();
    await tester.enterText(find.byKey(const ValueKey('signup-code')), '482913');
    await tester.enterText(find.byKey(const ValueKey('signup-password')), 'long-password-1');
    await tester.enterText(find.byKey(const ValueKey('signup-confirm')), 'long-password-1');
    await submit(tester);
    await tester.pumpAndSettle();
    expect(repo.verified, ['parent@example.test 482913 long-password-1']);
    expect(repo.notices, [null]);
  });

  testWidgets('Phase 2: the Arabic sign-up has no lesson-audio text either', (tester) async {
    await tester.pumpWidget(app(const ParentSignupScreen(), _RecordingSignup(), locale: const Locale('ar')));
    await tester.enterText(find.byKey(const ValueKey('signup-email')), 'parent@example.test');
    await submit(tester);
    await tester.pumpAndSettle();
    expect(find.textContaining('صوت', skipOffstage: false), findsNothing);
    expect(find.textContaining('الدروس', skipOffstage: false), findsNothing);
  });
}

class _RecordingSignup implements ParentSignupRepository {
  _RecordingSignup({this.refuseVerifyWith, this.refuseKind = AppErrorKind.unauthenticated});

  final String? refuseVerifyWith;
  final AppErrorKind refuseKind;
  final requested = <String>[];
  final verified = <String>[];
  final notices = <int?>[];

  @override
  Future<void> requestCode(String email) async => requested.add(email.trim());

  @override
  Future<void> verify({required String email, required String code, required String password, int? lessonAudioNotice}) async {
    if (refuseVerifyWith != null) throw AppError(refuseKind, code: refuseVerifyWith);
    verified.add('$email $code $password');
    notices.add(lessonAudioNotice);
  }
}
