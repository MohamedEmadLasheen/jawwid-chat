import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/data/wire/wire_vocab.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/legal/legal_links.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/app_lock/application/app_lock_call_bypass.dart';
import 'package:jawwid_chat/features/app_lock/application/app_lock_controller.dart';
import 'package:jawwid_chat/features/app_lock/data/app_lock_authenticator.dart';
import 'package:jawwid_chat/features/app_lock/data/app_lock_store.dart';
import 'package:jawwid_chat/features/app_lock/domain/app_lock_settings.dart';
import 'package:jawwid_chat/features/auth/application/auth_controller.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
import 'package:jawwid_chat/features/legal/application/legal_gate_state.dart';
import 'package:jawwid_chat/features/legal/application/legal_wire.dart';
import 'package:jawwid_chat/features/settings/data/parent_notice_repository.dart';
import 'package:jawwid_chat/features/settings/presentation/delete_account_screen.dart';
import 'package:jawwid_chat/features/settings/presentation/lesson_audio_notice_gate.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/auth.dart';
import 'package:jawwid_chat/shared/models/legal.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import '../app_lock/app_lock_fakes.dart';

/// PD-58 (ENG-11): the Terms of Use gate in the app (and the teacher web portal).
///
/// What is held here (developer guide §1.4 B, §1.5; roadmap §7.5-§7.6):
///  * no `legal` block (the API before ENG-10) and `accepted` show nothing;
///  * `required` covers the whole app with one row per document -- its title, an Open link
///    to the URL for the current language, an unticked box -- and Agree only once every box
///    is ticked; Sign out, Delete account and the Privacy Policy are on it too;
///  * `unavailable` is a notice, never "accepted";
///  * Agree sends exactly the required set, with the client and the app's language;
///  * each refusal is handled as the contract says, and a 403 TERMS_NOT_ACCEPTED from any
///    route brings the gate back through ONE path;
///  * the app lock stays on top of it, and it holds back the app-lock offer.
void main() {
  late L10n en;
  late L10n ar;
  setUpAll(() async {
    en = await L10n.delegate.load(const Locale('en'));
    ar = await L10n.delegate.load(const Locale('ar'));
  });

  const termsDoc = LegalDocument(
    documentKey: 'terms_family',
    version: '2026-12-01',
    urlAr: 'https://legal.example.test/ar/terms',
    urlEn: 'https://legal.example.test/en/terms',
  );
  const conductDoc = LegalDocument(
    documentKey: 'code_of_conduct',
    version: '2026-12-01',
    urlAr: 'https://legal.example.test/ar/conduct',
    urlEn: 'https://legal.example.test/en/conduct',
  );
  const conductV2 = LegalDocument(
    documentKey: 'code_of_conduct',
    version: '2027-01-15',
    urlAr: 'https://legal.example.test/ar/conduct-2',
    urlEn: 'https://legal.example.test/en/conduct-2',
  );
  const requiredBoth = LegalStatus(state: LegalState.required, required: [termsDoc, conductDoc]);
  const unavailable = LegalStatus(state: LegalState.unavailable, unavailable: ['terms_family']);

  late _ScriptedAuth auth;
  late _FakeLegal legalRepo;
  late ProviderContainer container;
  late List<Uri> opened;
  late LegalWire wire;

  const home = 'protected conversation';
  var homeTaps = 0;

  Future<void> pump(
    WidgetTester tester, {
    LegalStatus? legal,
    bool noLegal = false,
    UserRole role = UserRole.parent,
    Locale locale = const Locale('en'),
    Map<String, AppLockSettings>? lockPrefs,
    bool passwordSignIn = false,
    ParentNoticeRepository? notices,
    bool lessonAudioGate = false,
  }) async {
    homeTaps = 0;
    opened = [];
    wire = LegalWire();
    auth = _ScriptedAuth(AuthUser(id: 'u1', displayName: 'Umm Yusuf', role: role, legal: noLegal ? null : legal));
    legalRepo = _FakeLegal();
    final tokens = InMemoryTokenStore();
    if (!passwordSignIn) {
      await tokens.write(AuthSession(
        accessToken: 'a',
        refreshToken: 'r',
        accessTokenExpiresAt: DateTime.now().add(const Duration(hours: 1)),
      ));
    }
    container = ProviderContainer(overrides: [
      tokenStoreProvider.overrideWithValue(tokens),
      authRepositoryProvider.overrideWithValue(auth),
      authControllerProvider.overrideWith(
        () => AuthController(repository: auth, tokens: tokens, clearLocalData: () async {}, legal: wire),
      ),
      legalRepositoryProvider.overrideWithValue(legalRepo),
      legalLinksProvider.overrideWithValue(
        const LegalLinks(privacyPolicy: 'https://site.example.test/{lang}/privacy', terms: ''),
      ),
      legalLinkOpenerProvider.overrideWithValue((uri) async {
        opened.add(uri);
        return true;
      }),
      appLockCallBypassProvider.overrideWithValue(false),
      appLockAuthenticatorProvider.overrideWithValue(FakeAuthenticator()),
      appLockStoreProvider.overrideWithValue(InMemoryAppLockStore(lockPrefs)),
      appLockClockProvider.overrideWithValue(TestClock().call),
      if (notices != null) parentNoticeRepositoryProvider.overrideWithValue(notices),
    ]);
    addTearDown(container.dispose);
    if (passwordSignIn) {
      // The app lock is offered after a PASSWORD sign-in only, never after a restore.
      container.listen(appLockControllerProvider, (_, _) {});
      await container.read(authControllerProvider.notifier).signIn(username: 'u', password: 'p');
    } else {
      await container.read(authControllerProvider.notifier).restore();
    }
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        locale: locale,
        theme: JawwidTheme.light(isArabic: locale.languageCode == 'ar'),
        supportedLocales: JawwidApp.supportedLocales,
        localizationsDelegates: const [
          L10n.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        // Exactly the composition app.dart uses.
        builder: (context, child) => JawwidApp.sessionGates(child!),
        home: lessonAudioGate
            ? LessonAudioNoticeGate(child: Scaffold(body: Center(child: TextButton(onPressed: () => homeTaps++, child: const Text(home)))))
            : Scaffold(body: Center(child: TextButton(onPressed: () => homeTaps++, child: const Text(home)))),
      ),
    ));
    await tester.pumpAndSettle();
  }

  Finder gate() => find.byKey(const ValueKey('legal-gate'));
  Finder tick(String key) => find.byKey(ValueKey('legal-tick-$key'));
  Finder agree() => find.byKey(const ValueKey('legal-agree'));
  bool agreeEnabled(WidgetTester tester) => tester.widget<FilledButton>(agree()).onPressed != null;
  bool ticked(WidgetTester tester, String key) => tester.widget<CheckboxListTile>(tick(key)).value ?? false;
  bool homeReachable() => find.text(home).hitTestable().evaluate().isNotEmpty;

  Future<void> tap(WidgetTester tester, Finder finder) async {
    await tester.ensureVisible(finder);
    await tester.pumpAndSettle();
    await tester.tap(finder);
    await tester.pumpAndSettle();
  }

  Future<void> tickAll(WidgetTester tester) async {
    await tap(tester, tick('terms_family'));
    await tap(tester, tick('code_of_conduct'));
  }

  group('states', () {
    testWidgets('no legal block at all (the API before ENG-10): no gate', (tester) async {
      await pump(tester, noLegal: true);
      expect(gate(), findsNothing);
      expect(find.byKey(const ValueKey('legal-unavailable')), findsNothing);
      expect(homeReachable(), isTrue);
      expect(container.read(legalGateShownProvider), isFalse);
    });

    testWidgets('accepted: no gate', (tester) async {
      await pump(tester, legal: LegalStatus.acceptedStatus);
      expect(gate(), findsNothing);
      expect(homeReachable(), isTrue);
    });

    testWidgets('required: the gate covers the app; nothing beneath can be tapped', (tester) async {
      await pump(tester, legal: requiredBoth);
      expect(gate(), findsOneWidget);
      expect(container.read(legalGateShownProvider), isTrue);
      expect(homeReachable(), isFalse);
      await tester.tap(find.text(home), warnIfMissed: false);
      expect(homeTaps, 0);
    });

    testWidgets('unavailable: a notice, never the app, never a way to "agree"; Try again re-asks', (tester) async {
      await pump(tester, legal: unavailable);
      expect(find.byKey(const ValueKey('legal-unavailable')), findsOneWidget);
      expect(find.text(en.legalUnavailableTitle), findsOneWidget);
      expect(agree(), findsNothing);
      expect(find.byType(CheckboxListTile), findsNothing);
      expect(homeReachable(), isFalse);

      legalRepo.reload = LegalStatus.acceptedStatus;
      await tap(tester, find.byKey(const ValueKey('legal-unavailable-retry')));
      expect(legalRepo.currentCalls, 1);
      expect(find.byKey(const ValueKey('legal-unavailable')), findsNothing);
      expect(homeReachable(), isTrue);
    });
  });

  group('the gate', () {
    testWidgets('one row per required document: its title, Open, and an unticked box', (tester) async {
      await pump(tester, legal: requiredBoth);
      expect(find.text(en.legalDocTermsTitle), findsOneWidget);
      expect(find.text(en.legalDocCodeOfConductTitle), findsOneWidget);
      expect(find.text(en.legalAgreeTerms), findsOneWidget);
      expect(find.text(en.legalAgreeCodeOfConduct), findsOneWidget);
      expect(find.byKey(const ValueKey('legal-open-terms_family')), findsOneWidget);
      expect(find.byKey(const ValueKey('legal-open-code_of_conduct')), findsOneWidget);
      expect(ticked(tester, 'terms_family'), isFalse, reason: 'never pre-ticked');
      expect(ticked(tester, 'code_of_conduct'), isFalse, reason: 'never pre-ticked');
    });

    testWidgets('Agree stays disabled until every box is ticked', (tester) async {
      await pump(tester, legal: requiredBoth);
      expect(agreeEnabled(tester), isFalse);
      await tap(tester, tick('terms_family'));
      expect(agreeEnabled(tester), isFalse);
      await tap(tester, tick('code_of_conduct'));
      expect(agreeEnabled(tester), isTrue);
      await tap(tester, tick('terms_family'));
      expect(agreeEnabled(tester), isFalse, reason: 'unticking one disables it again');
    });

    testWidgets('Open goes to the server URL for the current language (English)', (tester) async {
      await pump(tester, legal: requiredBoth);
      await tap(tester, find.byKey(const ValueKey('legal-open-terms_family')));
      await tap(tester, find.byKey(const ValueKey('legal-open-code_of_conduct')));
      expect(opened, [Uri.parse(termsDoc.urlEn), Uri.parse(conductDoc.urlEn)]);
    });

    testWidgets('Agree sends exactly the required set, the client and the language; the gate goes', (tester) async {
      await pump(tester, legal: requiredBoth);
      legalRepo.acceptAnswer = LegalStatus.acceptedStatus;
      await tickAll(tester);
      await tap(tester, agree());

      expect(legalRepo.accepted, hasLength(1));
      final call = legalRepo.accepted.single;
      expect(call.documents.map((d) => d.toAcceptance()), [
        {'documentKey': 'terms_family', 'version': '2026-12-01'},
        {'documentKey': 'code_of_conduct', 'version': '2026-12-01'},
      ]);
      // The test host reports Android; the web build sends web_portal (legal_test.dart).
      expect(call.client, 'android');
      expect(call.locale, 'en');
      expect(gate(), findsNothing);
      expect(homeReachable(), isTrue);
      expect(container.read(authControllerProvider).user?.legal?.state, LegalState.accepted);
    });

    testWidgets('an answer that still requires something keeps the gate, unticked', (tester) async {
      await pump(tester, legal: requiredBoth);
      legalRepo.acceptAnswer = const LegalStatus(state: LegalState.required, required: [conductV2]);
      await tickAll(tester);
      await tap(tester, agree());
      expect(gate(), findsOneWidget);
      expect(find.byKey(const ValueKey('legal-tick-terms_family')), findsNothing);
      expect(ticked(tester, 'code_of_conduct'), isFalse);
      expect(agreeEnabled(tester), isFalse);
    });

    testWidgets('Privacy Policy, Sign out and Delete account are on the gate', (tester) async {
      await pump(tester, legal: requiredBoth);
      await tap(tester, find.byKey(const ValueKey('legal-privacy')));
      expect(opened, [Uri.parse('https://site.example.test/en/privacy')]);

      await tap(tester, find.byKey(const ValueKey('legal-delete-account')));
      expect(find.byType(DeleteAccountScreen), findsOneWidget);
      await tester.pageBack();
      await tester.pumpAndSettle();

      await tap(tester, find.byKey(const ValueKey('legal-sign-out')));
      await tap(tester, find.descendant(of: find.byType(AlertDialog), matching: find.text(en.signOutAction)));
      expect(auth.signOuts, 1);
      expect(container.read(authControllerProvider), isA<AuthSignedOut>());
      expect(gate(), findsNothing);
    });

    testWidgets('a Sales (staff) account is not offered Delete account, as in Settings', (tester) async {
      await pump(tester, legal: requiredBoth, role: UserRole.sales);
      expect(gate(), findsOneWidget);
      expect(find.byKey(const ValueKey('legal-delete-account')), findsNothing);
      expect(find.byKey(const ValueKey('legal-sign-out')), findsOneWidget);
    });
  });

  group('refusals', () {
    testWidgets('409 LEGAL_VERSION_STALE: reload, ask again from unticked boxes', (tester) async {
      await pump(tester, legal: requiredBoth);
      legalRepo.acceptError = const AppError(AppErrorKind.unknown, code: WireErrors.legalVersionStale);
      legalRepo.reload = const LegalStatus(state: LegalState.required, required: [termsDoc, conductV2]);
      await tickAll(tester);
      await tap(tester, agree());

      expect(legalRepo.accepted, hasLength(1));
      expect(legalRepo.currentCalls, 1);
      expect(find.text(en.legalGateChanged), findsOneWidget);
      expect(ticked(tester, 'terms_family'), isFalse);
      expect(ticked(tester, 'code_of_conduct'), isFalse);
      expect(agreeEnabled(tester), isFalse);

      // Now the new version is what is sent.
      legalRepo
        ..acceptError = null
        ..acceptAnswer = LegalStatus.acceptedStatus;
      await tickAll(tester);
      await tap(tester, agree());
      expect(legalRepo.accepted.last.documents.last.version, '2027-01-15');
      expect(gate(), findsNothing);
    });

    testWidgets('400 LEGAL_WRONG_DOCUMENTS: reload, never re-sent by itself', (tester) async {
      await pump(tester, legal: requiredBoth);
      legalRepo.acceptError = const AppError(AppErrorKind.validation, code: WireErrors.legalWrongDocuments);
      legalRepo.reload = requiredBoth;
      await tickAll(tester);
      await tap(tester, agree());
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();

      expect(legalRepo.accepted, hasLength(1), reason: 'never retried unchanged');
      expect(legalRepo.currentCalls, 1);
      expect(find.text(en.legalGateChanged), findsOneWidget);
      expect(agreeEnabled(tester), isFalse);
      expect(gate(), findsOneWidget);
    });

    testWidgets('403 SUPPORT_SESSION_FORBIDDEN: says a support session cannot accept for the person', (tester) async {
      await pump(tester, legal: requiredBoth);
      legalRepo.acceptError = const AppError(AppErrorKind.forbidden, code: WireErrors.supportSessionForbidden);
      await tickAll(tester);
      await tap(tester, agree());
      expect(find.text(en.legalGateSupportSession), findsOneWidget);
      expect(gate(), findsOneWidget);
      expect(container.read(authControllerProvider), isA<AuthAuthenticated>(), reason: 'not a sign-out');
    });

    testWidgets('503 LEGAL_NOT_CONFIGURED: a generic failure; the gate stays', (tester) async {
      await pump(tester, legal: requiredBoth);
      legalRepo.acceptError = const AppError(AppErrorKind.server, code: WireErrors.legalNotConfigured);
      await tickAll(tester);
      await tap(tester, agree());
      expect(find.text(en.legalGateFailed), findsOneWidget);
      expect(gate(), findsOneWidget);
      expect(homeReachable(), isFalse);
    });

    testWidgets('a network failure: a generic failure; the ticks are kept for another try', (tester) async {
      await pump(tester, legal: requiredBoth);
      legalRepo.acceptError = const AppError(AppErrorKind.network);
      await tickAll(tester);
      await tap(tester, agree());
      expect(find.text(en.legalGateFailed), findsOneWidget);
      expect(agreeEnabled(tester), isTrue);
    });
  });

  group('403 COMM.TERMS_NOT_ACCEPTED from any route', () {
    testWidgets('refreshes the identity and shows the gate, through one path', (tester) async {
      await pump(tester, legal: LegalStatus.acceptedStatus);
      expect(gate(), findsNothing);
      final before = auth.meCalls;

      auth.user = auth.user.withLegal(requiredBoth);
      const refusal = AppError(AppErrorKind.forbidden, code: WireErrors.termsNotAccepted);
      // A burst: three screens refused at once ask /me once.
      wire.refused(refusal);
      wire.refused(refusal);
      wire.refused(refusal);
      await tester.pumpAndSettle();

      expect(auth.meCalls, before + 1);
      expect(gate(), findsOneWidget);
      expect(homeReachable(), isFalse);
    });

    testWidgets('its detail shows the gate at once, even before /me answers', (tester) async {
      await pump(tester, legal: LegalStatus.acceptedStatus);
      final answer = Completer<AuthUser>();
      auth.pending = answer;
      wire.refused(const AppError(AppErrorKind.forbidden, code: WireErrors.termsNotAccepted, detail: {
        'required': [
          {
            'documentKey': 'code_of_conduct',
            'version': '2027-01-15',
            'urlAr': 'https://legal.example.test/ar/conduct-2',
            'urlEn': 'https://legal.example.test/en/conduct-2',
          },
        ],
      }));
      await tester.pumpAndSettle();
      expect(gate(), findsOneWidget);
      expect(find.byKey(const ValueKey('legal-tick-code_of_conduct')), findsOneWidget);

      answer.complete(auth.user.withLegal(const LegalStatus(state: LegalState.required, required: [conductV2])));
      await tester.pumpAndSettle();
      expect(gate(), findsOneWidget);
    });

    testWidgets('a refresh carrying a legal block updates the gate', (tester) async {
      await pump(tester, legal: LegalStatus.acceptedStatus);
      wire.report(requiredBoth);
      await tester.pumpAndSettle();
      expect(gate(), findsOneWidget);
      wire.report(LegalStatus.acceptedStatus);
      await tester.pumpAndSettle();
      expect(gate(), findsNothing);
    });

    testWidgets('a later /me without a legal block does not lift a gate', (tester) async {
      await pump(tester, legal: requiredBoth);
      auth.user = auth.user.withLegal(null);
      await container.read(authControllerProvider.notifier).refreshIdentity();
      await tester.pumpAndSettle();
      expect(gate(), findsOneWidget);
    });
  });

  group('with the app lock', () {
    const on = AppLockSettings(enabled: true, offerAnswered: true);

    testWidgets('a locked app shows the lock, not the gate: nothing of it is readable', (tester) async {
      final semantics = tester.ensureSemantics();
      await pump(tester, legal: requiredBoth, lockPrefs: {'u1': on});
      expect(find.byKey(const ValueKey('app-lock-screen')), findsOneWidget);
      expect(find.bySemanticsLabel(en.legalAgreeTerms), findsNothing);
      expect(find.bySemanticsLabel(RegExp(en.legalDocTermsTitle)), findsNothing);
      expect(find.byKey(const ValueKey('app-lock-sign-out')).hitTestable(), findsOneWidget,
          reason: 'the lock screen, and its sign-out, stay reachable over the gate');
      semantics.dispose();
    });

    testWidgets('the app-lock offer waits while the gate is up, then comes', (tester) async {
      await pump(tester, legal: requiredBoth, lockPrefs: const {}, passwordSignIn: true);
      // A parent with no lock preference yet is offered the lock after a password sign-in.
      expect(container.read(appLockControllerProvider).offerVisible, isTrue);
      expect(find.byKey(const ValueKey('app-lock-offer')), findsNothing);

      legalRepo.acceptAnswer = LegalStatus.acceptedStatus;
      await tickAll(tester);
      await tap(tester, agree());
      expect(gate(), findsNothing);
      expect(find.byKey(const ValueKey('app-lock-offer')), findsOneWidget);
    });
  });

  group('the lesson-audio notice (PD-48)', () {
    testWidgets('waits while the gate is up, and comes once the terms are accepted', (tester) async {
      final notices = _Notices();
      await pump(tester, legal: requiredBoth, notices: notices, lessonAudioGate: true);
      expect(find.byType(LessonAudioNoticeDialog), findsNothing);
      expect(notices.asked, 0, reason: 'not even asked while the gate is up');

      legalRepo.acceptAnswer = LegalStatus.acceptedStatus;
      await tickAll(tester);
      await tap(tester, agree());
      expect(gate(), findsNothing);
      expect(notices.asked, 1);
      expect(find.byType(LessonAudioNoticeDialog), findsOneWidget);
    });
  });

  group('Arabic', () {
    testWidgets('right-to-left, Arabic labels, the Arabic URL, the ar locale; screen-reader labels', (tester) async {
      final semantics = tester.ensureSemantics();
      await pump(tester, legal: requiredBoth, locale: const Locale('ar'));

      expect(Directionality.of(tester.element(agree())), TextDirection.rtl);
      expect(find.text(ar.legalAgreeTerms), findsOneWidget);
      expect(find.text(ar.legalAgreeCodeOfConduct), findsOneWidget);
      expect(find.text(ar.legalGateAgree), findsOneWidget);

      // Each box is announced with its own label, unticked.
      expect(
        tester.getSemantics(find.bySemanticsLabel(ar.legalAgreeTerms)),
        isSemantics(label: ar.legalAgreeTerms, hasCheckedState: true, isChecked: false),
      );
      expect(find.bySemanticsLabel(ar.legalGateOpenDocument(ar.legalDocTermsTitle)), findsOneWidget);

      await tap(tester, find.byKey(const ValueKey('legal-open-terms_family')));
      expect(opened, [Uri.parse(termsDoc.urlAr)]);

      legalRepo.acceptAnswer = LegalStatus.acceptedStatus;
      await tickAll(tester);
      await tap(tester, agree());
      expect(legalRepo.accepted.single.locale, 'ar');
      semantics.dispose();
    });
  });
}

class _ScriptedAuth implements AuthRepository {
  _ScriptedAuth(this.user);

  AuthUser user;
  int meCalls = 0;
  int signOuts = 0;

  /// When set, the next /me waits for it.
  Completer<AuthUser>? pending;

  @override
  Future<AuthSession> signIn({required String username, required String password, bool remember = false}) async =>
      AuthSession(accessToken: 'a', refreshToken: 'r', accessTokenExpiresAt: DateTime.now().add(const Duration(hours: 1)));

  @override
  Future<AuthUser> currentUser() async {
    meCalls++;
    final wait = pending;
    if (wait != null) {
      pending = null;
      return wait.future;
    }
    return user;
  }

  @override
  Future<AuthSession> refresh(String refreshToken) => signIn(username: '', password: '');

  @override
  Future<void> signOut() async => signOuts++;

  @override
  Stream<void> get sessionRevoked => const Stream<void>.empty();
}

class _Notices implements ParentNoticeRepository {
  int asked = 0;

  @override
  Future<bool> needsLessonAudio() async {
    asked++;
    return true;
  }

  @override
  Future<void> acknowledgeLessonAudio() async {}
}

typedef _Acceptance = ({List<LegalDocument> documents, String client, String locale});

class _FakeLegal implements LegalRepository {
  LegalStatus reload = LegalStatus.acceptedStatus;
  int currentCalls = 0;
  LegalStatus acceptAnswer = LegalStatus.acceptedStatus;
  AppError? acceptError;
  final accepted = <_Acceptance>[];

  @override
  Future<LegalStatus> current() async {
    currentCalls++;
    return reload;
  }

  @override
  Future<LegalStatus> accept({required List<LegalDocument> documents, required String client, required String locale}) async {
    accepted.add((documents: List.of(documents), client: client, locale: locale));
    final error = acceptError;
    if (error != null) throw error;
    return acceptAnswer;
  }
}
