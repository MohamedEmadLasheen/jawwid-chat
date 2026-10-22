import 'dart:collection';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/features/app_lock/application/app_lock_call_bypass.dart';
import 'package:jawwid_chat/features/app_lock/application/app_lock_controller.dart';
import 'package:jawwid_chat/features/app_lock/data/app_lock_authenticator.dart';
import 'package:jawwid_chat/features/app_lock/data/app_lock_store.dart';
import 'package:jawwid_chat/features/auth/application/auth_controller.dart';
import 'package:jawwid_chat/shared/models/auth.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// The device's unlock, scripted. Never reaches `local_auth`.
class FakeAuthenticator implements AppLockAuthenticator {
  FakeAuthenticator({this.available = true, Iterable<bool> results = const []})
      : _results = Queue.of(results);

  bool available;

  /// Answers in order; once empty, [fallback].
  final Queue<bool> _results;
  bool fallback = false;

  int prompts = 0;
  final List<String> reasons = [];

  /// Called while the prompt is "on screen", so a test can deliver lifecycle events the
  /// system prompt itself causes.
  void Function()? duringPrompt;

  void willAnswer(bool result) => _results.add(result);

  @override
  Future<bool> isAvailable() async => available;

  @override
  Future<bool> authenticate({required String reason}) async {
    prompts++;
    reasons.add(reason);
    duringPrompt?.call();
    return _results.isEmpty ? fallback : _results.removeFirst();
  }
}

/// A controllable clock.
class TestClock {
  TestClock([DateTime? start]) : now = start ?? DateTime(2026, 10, 22, 9);

  DateTime now;

  void advance(Duration by) => now = now.add(by);

  DateTime call() => now;
}

/// The real [AuthController], recording sign-outs.
class SpyAuthController extends AuthController {
  SpyAuthController({required super.repository, required super.tokens})
      : super(clearLocalData: _noop);

  static Future<void> _noop() async {}

  final List<bool> signOuts = [];

  @override
  Future<void> signOut({bool serverAlreadyEnded = false}) {
    signOuts.add(serverAlreadyEnded);
    return super.signOut(serverAlreadyEnded: serverAlreadyEnded);
  }
}

/// One fixture world: a role, a token store, the real auth controller, and the app-lock
/// seams. [storedSession] puts a session in the keychain, so `restore()` is a cold start
/// that restores it.
class LockWorld {
  LockWorld({
    UserRole role = UserRole.parent,
    bool storedSession = false,
    FakeAuthenticator? authenticator,
    InMemoryAppLockStore? store,
    TestClock? clock,
  })  : backend = FakeBackend(role: role),
        tokens = InMemoryTokenStore(),
        authenticator = authenticator ?? FakeAuthenticator(),
        store = store ?? InMemoryAppLockStore(),
        clock = clock ?? TestClock() {
    repository = FakeAuthRepository(backend: backend, tokens: tokens);
    if (storedSession) {
      tokens.write(AuthSession(
        accessToken: 'a',
        refreshToken: 'r',
        accessTokenExpiresAt: DateTime.now().add(const Duration(hours: 1)),
      ));
    }
  }

  final FakeBackend backend;
  final InMemoryTokenStore tokens;
  final FakeAuthenticator authenticator;
  final InMemoryAppLockStore store;
  final TestClock clock;
  late final FakeAuthRepository repository;
  SpyAuthController? auth;

  String get actorId => backend.user.id;

  List<Override> overrides({bool callOnScreen = false}) => [
        tokenStoreProvider.overrideWithValue(tokens),
        authRepositoryProvider.overrideWithValue(repository),
        authControllerProvider.overrideWith(
          () => auth = SpyAuthController(repository: repository, tokens: tokens),
        ),
        appLockAuthenticatorProvider.overrideWithValue(authenticator),
        appLockStoreProvider.overrideWithValue(store),
        appLockClockProvider.overrideWithValue(clock.call),
        appLockCallBypassProvider.overrideWithValue(callOnScreen),
      ];

  ProviderContainer container() {
    final c = ProviderContainer(overrides: overrides());
    // The gate builds it in the app; a bare container must ask for it.
    c.listen(appLockControllerProvider, (_, _) {});
    return c;
  }

  void dispose() => backend.dispose();
}
