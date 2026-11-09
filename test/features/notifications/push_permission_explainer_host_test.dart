/// LR-11 (explain-first), the screen half: the explanation appears in the signed-in app
/// before the platform is asked, Continue leads to exactly one native `start`, Not now to
/// none, and it waits its turn behind the other first-run dialogs.
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
import 'package:jawwid_chat/core/push/push_permission_explainer.dart';
import 'package:jawwid_chat/core/push/push_registration.dart';
import 'package:jawwid_chat/features/app_lock/application/app_lock_controller.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
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

void main() {
  final t0 = DateTime.utc(2026, 3, 10, 12);

  late h.FakeTokens tokens;
  late h.ScriptedAuth auth;
  late FakePushExplainerStore store;
  late ProviderContainer container;
  late _QuietLock lock;

  Future<void> pump(
    WidgetTester tester, {
    FakePushExplainerStore? initialStore,
    Locale locale = const Locale('en'),
    bool noticeBusy = false,
    AppLockState? lockState,
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
    ]);
    addTearDown(container.dispose);
    addTearDown(tokens.close);
    container.read(authControllerProvider);
    container.read(appLockControllerProvider);
    if (lockState != null) lock.set(lockState);
    if (noticeBusy) container.read(lessonAudioNoticeBusyProvider.notifier).set(true);

    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        locale: locale,
        supportedLocales: JawwidApp.supportedLocales,
        localizationsDelegates: const [
          L10n.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        home: const PushPermissionExplainerHost(child: Scaffold(body: Text('home'))),
      ),
    ));
    // What `main` does: registration follows the signed-in session.
    startPushRegistration(container);
    await tester.pumpAndSettle();
  }

  final dialog = find.byType(PushPermissionExplainerDialog);

  testWidgets('first sign-in: the explanation is on screen and the platform not yet asked',
      (tester) async {
    await pump(tester);

    expect(dialog, findsOneWidget);
    expect(find.text('Turn on notifications'), findsOneWidget);
    expect(find.text('Jawwid uses notifications for class reminders, messages, and calls.'), findsOneWidget);
    expect(find.text('Calls need notifications to ring when the app is closed.'), findsOneWidget);
    expect(tokens.starts, 0);
  });

  testWidgets('Arabic first: the explanation in Arabic', (tester) async {
    await pump(tester, locale: const Locale('ar'));

    expect(find.text('فعّل الإشعارات'), findsOneWidget);
    expect(find.text('متابعة'), findsOneWidget);
    expect(find.text('ليس الآن'), findsOneWidget);
  });

  testWidgets('Continue: the dialog closes and start is called exactly once', (tester) async {
    await pump(tester);

    await tester.tap(find.byKey(const ValueKey('push-explainer-continue')));
    await tester.pumpAndSettle();

    expect(dialog, findsNothing);
    expect(tokens.starts, 1);
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
    expect(store.hasContinued, isFalse);
    expect(store.lastDeclined, t0);
  });

  testWidgets('already continued on this device: never shown, start called', (tester) async {
    await pump(tester, initialStore: FakePushExplainerStore(hasContinued: true));

    expect(dialog, findsNothing);
    expect(tokens.starts, 1);
  });

  testWidgets('waits for the lesson-audio notice, then shows', (tester) async {
    await pump(tester, noticeBusy: true);
    expect(dialog, findsNothing);
    expect(tokens.starts, 0);

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

  testWidgets('one dialog, however often the host rebuilds', (tester) async {
    await pump(tester);
    expect(dialog, findsOneWidget);

    container.read(lessonAudioNoticeBusyProvider.notifier).set(true);
    await tester.pumpAndSettle();
    container.read(lessonAudioNoticeBusyProvider.notifier).set(false);
    await tester.pumpAndSettle();

    expect(dialog, findsOneWidget);
  });
}
