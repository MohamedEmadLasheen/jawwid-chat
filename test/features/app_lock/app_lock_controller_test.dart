import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/features/app_lock/application/app_lock_controller.dart';
import 'package:jawwid_chat/features/app_lock/data/app_lock_store.dart';
import 'package:jawwid_chat/features/app_lock/domain/app_lock_settings.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import 'app_lock_fakes.dart';

/// PD-23 app lock, at the controller: when it locks, when it does not, and whose
/// preference decides.
void main() {
  late LockWorld world;
  late ProviderContainer container;

  void start({
    UserRole role = UserRole.parent,
    bool storedSession = false,
    Map<String, AppLockSettings>? prefs,
    bool available = true,
  }) {
    world = LockWorld(
      role: role,
      storedSession: storedSession,
      store: InMemoryAppLockStore(prefs),
      authenticator: FakeAuthenticator(available: available),
    );
    container = world.container();
  }

  tearDown(() {
    container.dispose();
    world.dispose();
  });

  AppLockState lock() => container.read(appLockControllerProvider);
  AppLockController controller() => container.read(appLockControllerProvider.notifier);

  Future<void> coldStart() async {
    await container.read(authControllerProvider.notifier).restore();
    await pumpEventQueue();
  }

  Future<void> signIn() async {
    await container.read(authControllerProvider.notifier).signIn(username: 'u', password: 'p');
    await pumpEventQueue();
  }

  void background(Duration away) {
    controller()
      ..onLifecycle(AppLifecycleState.inactive)
      ..onLifecycle(AppLifecycleState.hidden)
      ..onLifecycle(AppLifecycleState.paused);
    world.clock.advance(away);
    controller()
      ..onLifecycle(AppLifecycleState.hidden)
      ..onLifecycle(AppLifecycleState.inactive)
      ..onLifecycle(AppLifecycleState.resumed);
  }

  const on = AppLockSettings(enabled: true, offerAnswered: true);

  group('cold start', () {
    test('a restored session with the lock on is locked', () async {
      start(storedSession: true, prefs: {'u_parent': on});
      await coldStart();

      expect(container.read(authControllerProvider), isA<AuthAuthenticated>());
      expect(lock().phase, AppLockPhase.locked);
    });

    test('a restored session with the lock off is not', () async {
      start(storedSession: true);
      await coldStart();

      expect(lock().phase, AppLockPhase.unlocked);
    });

    test('covers (pending) from the moment the session is restored', () async {
      start(storedSession: true, prefs: {'u_parent': on});
      final seen = <(Type, AppLockPhase)>[];
      container.listen<AuthState>(authControllerProvider, (_, next) {
        // Read synchronously as the auth state changes: the lock must already cover by
        // then, before any frame could render a protected route.
        seen.add((next.runtimeType, lock().phase));
      });
      await coldStart();

      expect(seen.last, (AuthAuthenticated, AppLockPhase.pending));
      expect(lock().phase, AppLockPhase.locked);
    });

    test('enabled on a device that can no longer authenticate does not lock anyone out',
        () async {
      start(storedSession: true, prefs: {'u_parent': on}, available: false);
      await coldStart();

      expect(lock().phase, AppLockPhase.unlocked);
    });

    test('a password sign-in is never locked, even with the lock on', () async {
      start(prefs: {'u_parent': on});
      await signIn();

      expect(lock().phase, AppLockPhase.unlocked);
      expect(lock().settings.enabled, isTrue);
    });
  });

  group('background timeout (injectable clock)', () {
    test('away for less than the timeout: no lock', () async {
      start(prefs: {'u_parent': on}); // default: after 1 minute
      await signIn();

      background(const Duration(seconds: 59));
      expect(lock().phase, AppLockPhase.unlocked);
    });

    test('away for longer than the timeout: locked', () async {
      start(prefs: {'u_parent': on});
      await signIn();

      background(const Duration(minutes: 1, seconds: 1));
      expect(lock().phase, AppLockPhase.locked);
    });

    test('each timeout is honoured', () async {
      for (final (timeout, under, over) in [
        (AppLockTimeout.immediately, null, const Duration(milliseconds: 1)),
        (AppLockTimeout.fifteenMinutes, const Duration(minutes: 14), const Duration(minutes: 16)),
        (AppLockTimeout.oneHour, const Duration(minutes: 59), const Duration(minutes: 61)),
      ]) {
        start(prefs: {'u_parent': on.copyWith(timeout: timeout)});
        await signIn();
        if (under != null) {
          background(under);
          expect(lock().phase, AppLockPhase.unlocked, reason: '${timeout.wire} under');
        }
        background(over);
        expect(lock().phase, AppLockPhase.locked, reason: '${timeout.wire} over');
        container.dispose();
        world.dispose();
      }
      start(); // for tearDown
    });

    test('inactive alone (a notification shade) never locks, but covers', () async {
      start(prefs: {'u_parent': on.copyWith(timeout: AppLockTimeout.immediately)});
      await signIn();

      controller().onLifecycle(AppLifecycleState.inactive);
      expect(lock().obscured, isTrue, reason: 'the app-switcher snapshot is covered');
      world.clock.advance(const Duration(hours: 2));
      controller().onLifecycle(AppLifecycleState.resumed);

      expect(lock().phase, AppLockPhase.unlocked);
      expect(lock().obscured, isFalse);
    });

    test('the lock off: no cover, no lock', () async {
      start();
      await signIn();

      controller().onLifecycle(AppLifecycleState.inactive);
      expect(lock().obscured, isFalse);
      background(const Duration(hours: 3));
      expect(lock().phase, AppLockPhase.unlocked);
    });

    test('the system prompt pausing the app does not re-lock what it just unlocked',
        () async {
      start(
        storedSession: true,
        prefs: {'u_parent': on.copyWith(timeout: AppLockTimeout.immediately)},
      );
      await coldStart();
      expect(lock().phase, AppLockPhase.locked);

      // Android's device-credential screen is another activity: Flutter sees a pause.
      world.authenticator
        ..willAnswer(true)
        ..duringPrompt = () {
          controller()
            ..onLifecycle(AppLifecycleState.inactive)
            ..onLifecycle(AppLifecycleState.hidden)
            ..onLifecycle(AppLifecycleState.paused);
          world.clock.advance(const Duration(seconds: 20));
        };
      await controller().unlock(reason: 'r');
      world.authenticator.duringPrompt = null;
      controller()
        ..onLifecycle(AppLifecycleState.hidden)
        ..onLifecycle(AppLifecycleState.inactive)
        ..onLifecycle(AppLifecycleState.resumed);

      expect(lock().phase, AppLockPhase.unlocked);
    });
  });

  group('unlock', () {
    test('a failed attempt keeps the lock and says so; a good one opens it', () async {
      start(storedSession: true, prefs: {'u_parent': on});
      await coldStart();

      world.authenticator.willAnswer(false);
      await controller().unlock(reason: 'r');
      expect(lock().phase, AppLockPhase.locked);
      expect(lock().lastAttemptFailed, isTrue);

      world.authenticator.willAnswer(true);
      await controller().unlock(reason: 'r');
      expect(lock().phase, AppLockPhase.unlocked);
      expect(world.authenticator.prompts, 2);
    });
  });

  group('defaults', () {
    test('staff: ON by default, recorded, and never offered', () async {
      start(role: UserRole.sales);
      await signIn();

      expect(lock().settings.enabled, isTrue);
      expect(lock().offerVisible, isFalse);
      expect(world.store.stored['u_sales']?.enabled, isTrue);
      expect(world.store.stored['u_sales']?.offerAnswered, isTrue);
    });

    test('staff on a device with no biometrics and no passcode: silently not applied',
        () async {
      start(role: UserRole.sales, available: false);
      await signIn();

      expect(lock().settings.enabled, isFalse);
      expect(lock().offerVisible, isFalse);
      expect(world.store.stored, isEmpty, reason: 'nothing is recorded for later');
    });

    test('staff who turned it off stay off', () async {
      start(
        role: UserRole.sales,
        storedSession: true,
        prefs: {'u_sales': const AppLockSettings(enabled: false, offerAnswered: true)},
      );
      await coldStart();

      expect(lock().settings.enabled, isFalse);
      expect(lock().phase, AppLockPhase.unlocked);
    });

    test('staff restored for the first time since this shipped: on, and locked', () async {
      start(role: UserRole.sales, storedSession: true);
      await coldStart();

      expect(lock().settings.enabled, isTrue);
      expect(lock().phase, AppLockPhase.locked);
    });

    test('parent: opt-in, offered once after the first sign-in, never again', () async {
      start();
      await signIn();

      expect(lock().settings.enabled, isFalse);
      expect(lock().offerVisible, isTrue);

      await controller().answerOffer(accept: false, reason: 'r');
      expect(lock().offerVisible, isFalse);
      expect(world.store.stored['u_parent']?.offerAnswered, isTrue);
      expect(world.store.stored['u_parent']?.enabled, isFalse);

      await container.read(authControllerProvider.notifier).signOut();
      await signIn();
      expect(lock().offerVisible, isFalse, reason: 'answered once is answered');
    });

    test('teacher: accepting the offer turns it on only after the device check', () async {
      start(role: UserRole.teacher);
      await signIn();
      expect(lock().offerVisible, isTrue);

      world.authenticator.willAnswer(true);
      await controller().answerOffer(accept: true, reason: 'r');

      expect(lock().settings.enabled, isTrue);
      expect(world.store.stored['u_teacher'], const AppLockSettings(enabled: true, offerAnswered: true));
      expect(world.authenticator.prompts, 1);
    });

    test('no offer on a restored session, and none when the device cannot authenticate',
        () async {
      start(storedSession: true);
      await coldStart();
      expect(lock().offerVisible, isFalse);

      container.dispose();
      world.dispose();
      start(available: false);
      await signIn();
      expect(lock().offerVisible, isFalse);
    });
  });

  group('settings', () {
    test('turning it on needs a successful prompt', () async {
      start();
      await signIn();

      world.authenticator.willAnswer(false);
      expect(await controller().setEnabled(true, reason: 'r'), isFalse);
      expect(lock().settings.enabled, isFalse);

      world.authenticator.willAnswer(true);
      expect(await controller().setEnabled(true, reason: 'r'), isTrue);
      expect(lock().settings.enabled, isTrue);
      expect(world.store.stored['u_parent']?.enabled, isTrue);
    });

    test('the timeout is stored per account', () async {
      start(prefs: {'u_parent': on});
      await signIn();

      await controller().setTimeout(AppLockTimeout.oneHour);
      expect(world.store.stored['u_parent']?.timeout, AppLockTimeout.oneHour);
    });

    test('signing out keeps every account\'s preference', () async {
      start(prefs: {
        'u_parent': on,
        'someone_else': const AppLockSettings(enabled: true, timeout: AppLockTimeout.oneHour),
      });
      await signIn();

      await container.read(authControllerProvider.notifier).signOut();
      await pumpEventQueue();

      expect(lock().actorId, isNull);
      expect(lock().covered, isFalse);
      expect(world.store.stored.keys, containsAll(['u_parent', 'someone_else']));
      expect(world.store.stored['u_parent'], on);
    });
  });
}
