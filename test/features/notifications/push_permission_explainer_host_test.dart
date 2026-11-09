/// LR-11 (explain-first), the screen half: the explanation appears in the signed-in app
/// before the permission is asked for, Continue leads to exactly one native `start`, Not
/// now (or System Back) to none, and it waits its turn behind the other first-run
/// dialogs. Tokens are registered (native `register`) whatever happens here.
///
/// The registrar-and-memory half (snooze, already continued, second account) is
/// `test/core/push/push_permission_explainer_test.dart`.
library;

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/shells/app_shell.dart';
import 'package:jawwid_chat/core/push/push_permission_explainer.dart';
import 'package:jawwid_chat/core/push/push_registration.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/app_lock/application/app_lock_controller.dart';
import 'package:jawwid_chat/features/app_lock/presentation/app_lock_gate.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
import 'package:jawwid_chat/features/conversations/application/conversations_controller.dart';
import 'package:jawwid_chat/features/legal/application/legal_gate_state.dart';
import 'package:jawwid_chat/features/notifications/presentation/push_permission_explainer_host.dart';
import 'package:jawwid_chat/features/settings/data/parent_notice_repository.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/auth.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import '../../core/push/push_registration_test.dart' as h;

/// The app lock with nothing to say, unless a test sets it.
class _QuietLock extends AppLockController {
  @override
  AppLockState build() => const AppLockState();

  void set(AppLockState next) => state = next;
}

/// Whether the Terms of Use gate (PD-58) is up, set by a test.
class _Flag extends Notifier<bool> {
  @override
  bool build() => false;

  void set(bool value) => state = value;
}

final _legalUp = NotifierProvider<_Flag, bool>(_Flag.new);

/// Marks the lesson-audio notice busy in ITS first post-frame callback, exactly when
/// `LessonAudioNoticeGate` does (a child of the host, so its callback runs after one the
/// host registered in the same frame).
class _BusyAfterFirstFrame extends ConsumerStatefulWidget {
  const _BusyAfterFirstFrame();

  @override
  ConsumerState<_BusyAfterFirstFrame> createState() => _BusyAfterFirstFrameState();
}

class _BusyAfterFirstFrameState extends ConsumerState<_BusyAfterFirstFrame> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback(
      (_) => ref.read(lessonAudioNoticeBusyProvider.notifier).set(true),
    );
  }

  @override
  Widget build(BuildContext context) => const Text('home');
}

void main() {
  final t0 = DateTime.utc(2026, 3, 10, 12);

  late h.FakeTokens tokens;
  late h.ScriptedAuth auth;
  late FakePushExplainerStore store;
  late ProviderContainer container;
  late _QuietLock lock;

  /// The signed-in app as the router renders it: the host in a page of the root
  /// navigator, optionally under the app lock gate as `app.dart` puts it.
  Widget app({
    Key? key,
    Locale locale = const Locale('en'),
    Widget? home,
    bool withLockGate = false,
  }) =>
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          key: key,
          locale: locale,
          theme: JawwidTheme.light(isArabic: locale.languageCode == 'ar'),
          supportedLocales: JawwidApp.supportedLocales,
          localizationsDelegates: const [
            L10n.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          builder: withLockGate ? (context, child) => AppLockGate(child: child!) : null,
          home: home ?? const PushPermissionExplainerHost(child: Scaffold(body: Text('home'))),
        ),
      );

  Future<void> pump(
    WidgetTester tester, {
    FakePushExplainerStore? initialStore,
    Locale locale = const Locale('en'),
    bool noticeBusy = false,
    bool legalUp = false,
    AppLockState? lockState,
    Widget? home,
    bool withLockGate = false,
    bool registerFirst = false,
  }) async {
    tokens = h.FakeTokens();
    auth = h.ScriptedAuth(
      const AuthAuthenticated(
        AuthUser(id: 'account_1', displayName: 'a', role: UserRole.parent),
      ),
    );
    store = initialStore ?? FakePushExplainerStore();
    container = ProviderContainer(overrides: [
      authControllerProvider.overrideWith(() => auth),
      pushTokensProvider.overrideWithValue(tokens),
      pushRegistrationApiProvider.overrideWithValue(h.RecordingApi()),
      pushExplainerStoreProvider.overrideWithValue(store),
      pushExplainerClockProvider.overrideWithValue(() => t0),
      appLockControllerProvider.overrideWith(() => lock = _QuietLock()),
      legalGateShownProvider.overrideWith((ref) => ref.watch(_legalUp)),
      // AppShell's unread badge, without a conversation list behind it.
      totalUnreadProvider.overrideWithValue(0),
    ]);
    addTearDown(container.dispose);
    addTearDown(tokens.close);
    container.read(authControllerProvider);
    container.read(appLockControllerProvider);
    if (lockState != null) lock.set(lockState);
    if (noticeBusy) container.read(lessonAudioNoticeBusyProvider.notifier).set(true);
    if (legalUp) container.read(_legalUp.notifier).set(true);

    if (registerFirst) {
      // The session's registrar is already waiting when the shell first mounts.
      startPushRegistration(container);
      await tester.pump();
      expect(container.read(pushExplainerProvider), PushExplainerPhase.waiting);
    }
    await tester.pumpWidget(app(locale: locale, home: home, withLockGate: withLockGate));
    // What `main` does: registration follows the signed-in session.
    if (!registerFirst) startPushRegistration(container);
    await tester.pumpAndSettle();
  }

  final dialog = find.byType(PushPermissionExplainerDialog);
  final continueButton = find.byKey(const ValueKey('push-explainer-continue'));
  final lockOffer = find.byKey(const ValueKey('app-lock-offer'));

  testWidgets('first sign-in: the explanation is on screen, tokens are registered, and the '
      'permission is not yet asked', (tester) async {
    await pump(tester);

    expect(dialog, findsOneWidget);
    expect(find.text('Turn on notifications'), findsOneWidget);
    expect(find.text('Jawwid uses notifications for class reminders, messages, and calls.'), findsOneWidget);
    expect(find.text('So messages and calls appear while the app is closed.'), findsOneWidget);
    expect(tokens.registers, 1);
    expect(tokens.starts, 0);
  });

  testWidgets('Arabic first: the explanation in Arabic', (tester) async {
    await pump(tester, locale: const Locale('ar'));

    expect(find.text('فعّل الإشعارات'), findsOneWidget);
    expect(find.text('لتظهر الرسائل والمكالمات والتطبيق مغلق.'), findsOneWidget);
    expect(find.text('متابعة'), findsOneWidget);
    expect(find.text('ليس الآن'), findsOneWidget);
  });

  testWidgets('Continue: the dialog closes and start is called exactly once', (tester) async {
    await pump(tester);

    await tester.tap(continueButton);
    await tester.pumpAndSettle();

    expect(dialog, findsNothing);
    expect(tokens.starts, 1);
    expect(tokens.registers, 1);
    expect(store.hasContinued, isTrue);

    // Nothing brings it back in this session.
    await tester.pumpAndSettle();
    expect(dialog, findsNothing);
    expect(tokens.starts, 1);
  });

  testWidgets('Not now: the dialog closes, start is not called, the answer is kept',
      (tester) async {
    await pump(tester);

    await tester.tap(find.byKey(const ValueKey('push-explainer-not-now')));
    await tester.pumpAndSettle();

    expect(dialog, findsNothing);
    expect(tokens.starts, 0);
    expect(tokens.registers, 1, reason: 'tokens are registered whatever the answer');
    expect(store.hasContinued, isFalse);
    expect(store.lastDeclined, t0);
  });

  testWidgets('System Back on the explanation is Not now', (tester) async {
    await pump(tester);
    expect(dialog, findsOneWidget);

    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();

    expect(dialog, findsNothing);
    expect(tokens.starts, 0);
    expect(store.lastDeclined, t0);
    expect(container.read(pushExplainerProvider), PushExplainerPhase.idle);
  });

  testWidgets('already continued on this device: never shown, start called', (tester) async {
    await pump(tester, initialStore: FakePushExplainerStore(hasContinued: true));

    expect(dialog, findsNothing);
    expect(tokens.starts, 1);
  });

  testWidgets('waits for the Terms of Use gate, then shows', (tester) async {
    await pump(tester, legalUp: true);
    expect(dialog, findsNothing);
    expect(tokens.starts, 0);

    container.read(_legalUp.notifier).set(false);
    await tester.pumpAndSettle();
    expect(dialog, findsOneWidget);
  });

  testWidgets('waits for the lesson-audio notice, then shows', (tester) async {
    await pump(tester, noticeBusy: true);
    expect(dialog, findsNothing);
    expect(tokens.starts, 0);

    container.read(lessonAudioNoticeBusyProvider.notifier).set(false);
    await tester.pumpAndSettle();
    expect(dialog, findsOneWidget);
  });

  testWidgets('a fresh mount does not open over a notice that marks itself busy after its '
      'first frame', (tester) async {
    await pump(
      tester,
      registerFirst: true,
      home: const PushPermissionExplainerHost(child: Scaffold(body: _BusyAfterFirstFrame())),
    );
    expect(container.read(lessonAudioNoticeBusyProvider), isTrue);
    expect(dialog, findsNothing);

    container.read(lessonAudioNoticeBusyProvider.notifier).set(false);
    await tester.pumpAndSettle();
    expect(dialog, findsOneWidget);
  });

  testWidgets('waits while the app-lock offer is up, then shows', (tester) async {
    await pump(tester, lockState: const AppLockState(actorId: 'account_1', offerVisible: true));
    expect(dialog, findsNothing);

    lock.set(const AppLockState(actorId: 'account_1'));
    await tester.pumpAndSettle();
    expect(dialog, findsOneWidget);
  });

  testWidgets('an app-lock offer decided while the explanation is up waits for its answer',
      (tester) async {
    await pump(tester, withLockGate: true);
    expect(dialog, findsOneWidget);

    // The lock settings were read after the explanation opened.
    lock.set(const AppLockState(actorId: 'account_1', offerVisible: true));
    await tester.pumpAndSettle();
    expect(lockOffer, findsNothing);
    expect(dialog, findsOneWidget);

    await tester.tap(continueButton);
    await tester.pumpAndSettle();
    expect(dialog, findsNothing);
    expect(lockOffer, findsOneWidget);
  });

  testWidgets('one dialog, however often the host rebuilds', (tester) async {
    await pump(tester);
    expect(dialog, findsOneWidget);

    container.read(lessonAudioNoticeBusyProvider.notifier).set(true);
    await tester.pumpAndSettle();
    container.read(lessonAudioNoticeBusyProvider.notifier).set(false);
    await tester.pumpAndSettle();

    expect(dialog, findsOneWidget);
  });

  testWidgets('signed out with the explanation open: it closes unanswered, and the next '
      'signed-in shell asks again', (tester) async {
    await pump(tester);
    expect(dialog, findsOneWidget);

    // The session ends and the signed-in app goes (the router's sign-in screen).
    auth.endSession();
    await tester.pumpWidget(app(key: const ValueKey('signed-out'), home: const Text('sign in')));
    await tester.pumpAndSettle();

    expect(dialog, findsNothing);
    expect(container.read(pushExplainerProvider), PushExplainerPhase.waiting);
    expect(store.lastDeclined, isNull, reason: 'a sign-out is not an answer');
    expect(store.hasContinued, isFalse);
    expect(tokens.starts, 0);

    auth.authenticate('account_2');
    await tester.pumpWidget(app(key: const ValueKey('signed-in-again')));
    await tester.pumpAndSettle();
    expect(dialog, findsOneWidget);

    await tester.tap(continueButton);
    await tester.pumpAndSettle();
    expect(tokens.starts, 1, reason: 'only the live session asks');
  });

  testWidgets('mounted in the real AppShell: shown over the signed-in tabs', (tester) async {
    await pump(
      tester,
      home: AppShell(
        role: UserRole.teacher,
        currentRoute: '/chats',
        onDestinationSelected: (_) {},
        child: const Text('home'),
      ),
    );

    expect(find.text('home'), findsOneWidget);
    expect(dialog, findsOneWidget);
    expect(tokens.starts, 0);

    await tester.tap(continueButton);
    await tester.pumpAndSettle();
    expect(tokens.starts, 1);
  });
}
