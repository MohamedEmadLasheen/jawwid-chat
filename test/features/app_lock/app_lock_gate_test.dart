import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/app_lock/application/app_lock_controller.dart';
import 'package:jawwid_chat/features/app_lock/data/app_lock_store.dart';
import 'package:jawwid_chat/features/app_lock/domain/app_lock_settings.dart';
import 'package:jawwid_chat/features/app_lock/presentation/app_lock_gate.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import 'app_lock_fakes.dart';

/// PD-23: the gate over the app -- what is on screen, and what can be reached.
void main() {
  late LockWorld world;
  late ProviderContainer container;
  late L10n en;

  setUpAll(() async => en = await L10n.delegate.load(const Locale('en')));

  const on = AppLockSettings(enabled: true, offerAnswered: true);
  const protected = 'protected conversation';

  Future<void> pumpGate(
    WidgetTester tester, {
    UserRole role = UserRole.parent,
    bool storedSession = true,
    Map<String, AppLockSettings>? prefs,
    FakeAuthenticator? authenticator,
  }) async {
    world = LockWorld(
      role: role,
      storedSession: storedSession,
      store: InMemoryAppLockStore(prefs),
      authenticator: authenticator,
    );
    container = ProviderContainer(overrides: world.overrides());
    addTearDown(() {
      container.dispose();
      world.dispose();
    });

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          locale: const Locale('en'),
          theme: JawwidTheme.light(isArabic: false),
          supportedLocales: JawwidApp.supportedLocales,
          localizationsDelegates: const [
            L10n.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          // Exactly where app.dart puts it: over everything the navigator renders.
          builder: (context, child) => AppLockGate(child: child!),
          home: const Scaffold(body: Center(child: Text(protected))),
        ),
      ),
    );
  }

  Future<void> coldStart(WidgetTester tester) async {
    await container.read(authControllerProvider.notifier).restore();
    await tester.pumpAndSettle();
  }

  Finder lockScreen() => find.byKey(const ValueKey('app-lock-screen'));

  /// Whether the protected text could be tapped -- i.e. nothing lies over it.
  bool reachable(WidgetTester tester) =>
      find.text(protected).hitTestable().evaluate().isNotEmpty;

  testWidgets('cold start with the lock on: the lock screen, which prompts once by itself',
      (tester) async {
    await pumpGate(tester, prefs: {'u_parent': on});
    await coldStart(tester);

    expect(lockScreen(), findsOneWidget);
    expect(reachable(tester), isFalse);
    expect(world.authenticator.prompts, 1, reason: 'one automatic prompt, not a loop');
    expect(world.authenticator.reasons.single, en.appLockReason);
  });

  testWidgets('cold start with the lock off: straight to the app', (tester) async {
    await pumpGate(tester);
    await coldStart(tester);

    expect(lockScreen(), findsNothing);
    expect(reachable(tester), isTrue);
    expect(world.authenticator.prompts, 0);
  });

  testWidgets('a failed unlock keeps the lock; Unlock re-prompts and opens it',
      (tester) async {
    await pumpGate(tester, prefs: {'u_parent': on});
    await coldStart(tester); // the automatic prompt fails (fallback false)

    expect(lockScreen(), findsOneWidget);
    expect(find.text(en.appLockFailed), findsOneWidget);
    expect(reachable(tester), isFalse);

    world.authenticator.willAnswer(true);
    await tester.tap(find.byKey(const ValueKey('app-lock-unlock')));
    await tester.pumpAndSettle();

    expect(world.authenticator.prompts, 2);
    expect(lockScreen(), findsNothing);
    expect(reachable(tester), isTrue);
  });

  testWidgets('Sign out on the lock screen goes through AuthController.signOut',
      (tester) async {
    await pumpGate(tester, prefs: {'u_parent': on});
    await coldStart(tester);

    await tester.tap(find.byKey(const ValueKey('app-lock-sign-out')));
    await tester.pumpAndSettle();
    // Confirmed in the lock screen's own dialog.
    await tester.tap(find.descendant(
      of: find.byType(AlertDialog),
      matching: find.text(en.signOutAction),
    ));
    await tester.pumpAndSettle();

    expect(world.auth!.signOuts, [false], reason: 'the one sign-out path, server logout included');
    expect(container.read(authControllerProvider), isA<AuthSignedOut>());
    expect(lockScreen(), findsNothing);
    expect(world.store.stored['u_parent'], on, reason: 'the preference survives sign-out');
  });

  testWidgets('returning after the timeout locks; the app switcher sees the cover',
      (tester) async {
    await pumpGate(tester, prefs: {'u_parent': on}, storedSession: false);
    await container.read(authControllerProvider.notifier).signIn(username: 'u', password: 'p');
    await tester.pumpAndSettle();
    expect(reachable(tester), isTrue);

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    await tester.pump();
    expect(find.byKey(const ValueKey('app-lock-privacy-cover')), findsOneWidget);
    expect(reachable(tester), isFalse);

    tester.binding
      ..handleAppLifecycleStateChanged(AppLifecycleState.hidden)
      ..handleAppLifecycleStateChanged(AppLifecycleState.paused);
    world.clock.advance(const Duration(minutes: 5));
    tester.binding
      ..handleAppLifecycleStateChanged(AppLifecycleState.hidden)
      ..handleAppLifecycleStateChanged(AppLifecycleState.inactive)
      ..handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('app-lock-privacy-cover')), findsNothing);
    expect(lockScreen(), findsOneWidget);
    expect(reachable(tester), isFalse);
  });

  testWidgets('parent: the one-time offer after sign-in; "Not now" is final',
      (tester) async {
    await pumpGate(tester, storedSession: false);
    await container.read(authControllerProvider.notifier).signIn(username: 'u', password: 'p');
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('app-lock-offer')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('app-lock-offer-decline')));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('app-lock-offer')), findsNothing);
    expect(world.store.stored['u_parent']?.offerAnswered, isTrue);
    expect(container.read(appLockControllerProvider).settings.enabled, isFalse);
    expect(reachable(tester), isTrue);
  });

  testWidgets('staff: no offer -- the lock is simply on', (tester) async {
    await pumpGate(tester, role: UserRole.sales, storedSession: false);
    await container.read(authControllerProvider.notifier).signIn(username: 'u', password: 'p');
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('app-lock-offer')), findsNothing);
    expect(container.read(appLockControllerProvider).settings.enabled, isTrue);
    // Just signed in with a password: not locked now.
    expect(lockScreen(), findsNothing);
  });
}
