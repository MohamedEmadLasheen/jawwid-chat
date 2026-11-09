import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/features/auth/application/auth_controller.dart';
import 'package:jawwid_chat/features/auth/application/pending_sign_out.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
import 'package:jawwid_chat/shared/models/auth.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// A repository that says whether its sign-out reached the server, and serves the two calls a
/// pending sign-out is retried with. Every call is written to [log] in order.
class _Repo implements AuthRepository, SignOutReporting, SignOutServer {
  final log = <String>[];

  SignOutOutcome outcome = SignOutOutcome.ended;

  /// Null is a 2xx.
  AppError? logoutError;

  /// When set, `logoutWith` waits on it: a hung network.
  Future<void>? logoutHangs;

  @override
  Stream<void> get sessionRevoked => const Stream<void>.empty();

  @override
  Future<AuthSession> signIn({required String username, required String password, bool remember = false}) async {
    log.add('login');
    return AuthSession(
      accessToken: 'access-new',
      refreshToken: 'refresh-new',
      accessTokenExpiresAt: DateTime.utc(2030),
    );
  }

  /// When set, `/me` refuses with it.
  AppError? currentUserError;

  @override
  Future<AuthUser> currentUser() async {
    final error = currentUserError;
    if (error != null) throw error;
    return const AuthUser(id: 'u1', displayName: 'ولي أمر', role: UserRole.parent);
  }

  @override
  Future<AuthSession> refresh(String refreshToken) async {
    log.add('refresh');
    throw const AppError(AppErrorKind.sessionRevoked);
  }

  @override
  Future<void> signOut() async => signOutReporting();

  @override
  Future<SignOutOutcome> signOutReporting() async {
    log.add('sign-out');
    return outcome;
  }

  @override
  Future<void> logoutWith(String accessToken) async {
    log.add('logout $accessToken');
    final hang = logoutHangs;
    if (hang != null) await hang;
    final error = logoutError;
    if (error != null) throw error;
  }
}

/// A keychain that refuses to delete the live session.
class _StuckTokens extends InMemoryTokenStore {
  @override
  Future<void> clear() async => throw StateError('keychain refused the delete');
}

class _NoTimer implements Timer {
  @override
  void cancel() {}

  @override
  bool get isActive => false;

  @override
  int get tick => 0;
}

void main() {
  // Fixed instants, never relative to the real date.
  final t0 = DateTime.utc(2026, 11, 9, 12);

  late _Repo repo;
  late InMemoryTokenStore tokens;
  late InMemoryPendingSignOutStore pending;
  late PendingSignOutRetrier retrier;
  late int clearCalls;
  late ProviderContainer container;
  late NotifierProvider<AuthController, AuthState> provider;

  setUp(() {
    repo = _Repo();
    tokens = InMemoryTokenStore();
    pending = InMemoryPendingSignOutStore();
    clearCalls = 0;
    retrier = PendingSignOutRetrier(
      store: pending,
      server: repo,
      clock: () => t0,
      timer: (_, __) => _NoTimer(),
      signInWait: const Duration(milliseconds: 50),
    );
    provider = NotifierProvider<AuthController, AuthState>(
      () => AuthController(
        repository: repo,
        tokens: tokens,
        clearLocalData: () async => clearCalls++,
        pendingSignOut: retrier,
      ),
    );
    container = ProviderContainer();
  });

  tearDown(() => container.dispose());

  AuthController controller() => container.read(provider.notifier);

  Future<void> signedIn() async {
    await controller().signIn(username: 'parent', password: 'secret');
    expect(container.read(provider), isA<AuthAuthenticated>());
    repo.log.clear();
  }

  test('an offline sign-out signs out locally AND leaves the session pending', () async {
    await signedIn();
    repo.outcome = SignOutOutcome.unreached;

    await controller().signOut();

    expect(container.read(provider), isA<AuthSignedOut>());
    expect(await tokens.read(), isNull, reason: 'the live session store is cleared as before');
    expect(clearCalls, greaterThan(0));
    final entry = (await pending.read()).single;
    expect(entry.session.refreshToken, 'refresh-new');
  });

  test('an online sign-out leaves nothing pending', () async {
    await signedIn();
    repo.outcome = SignOutOutcome.ended;

    await controller().signOut();

    expect(container.read(provider), isA<AuthSignedOut>());
    expect(await pending.read(), isEmpty);
  });

  test('a session the server already ended leaves nothing pending', () async {
    await signedIn();

    await controller().signOut(serverAlreadyEnded: true);

    expect(await pending.read(), isEmpty);
    expect(repo.log, isEmpty);
  });

  test('a new sign-in flushes a pending sign-out FIRST', () async {
    // Not yet due, so the app-start flush leaves it for the sign-in.
    await pending.write([
      PendingSignOut(
        session: AuthSession(
          accessToken: 'access-old',
          refreshToken: 'refresh-old',
          accessTokenExpiresAt: t0.add(const Duration(minutes: 10)),
        ),
        createdAt: t0,
        attempts: 1,
        notBefore: t0.add(const Duration(minutes: 1)),
      ),
    ]);

    await controller().signIn(username: 'parent', password: 'secret');

    expect(repo.log.take(2), ['logout access-old', 'login']);
    expect(await pending.read(), isEmpty);
    expect(container.read(provider), isA<AuthAuthenticated>());
  });

  test('a failing flush never blocks the sign-in', () async {
    await pending.write([
      PendingSignOut(
        session: AuthSession(
          accessToken: 'access-old',
          refreshToken: 'refresh-old',
          accessTokenExpiresAt: t0.add(const Duration(minutes: 10)),
        ),
        createdAt: t0,
        attempts: 1,
        notBefore: t0.add(const Duration(minutes: 1)),
      ),
    ]);
    repo.logoutError = const AppError(AppErrorKind.network, code: AppError.connectFailed);

    await controller().signIn(username: 'parent', password: 'secret');

    expect(container.read(provider), isA<AuthAuthenticated>());
    final kept = (await pending.read()).single;
    expect(kept.attempts, 1, reason: 'offline: not counted toward the ceiling');
    expect(kept.offlineFailures, 1);
  });

  test('a token clear that fails withdraws the pending entry: one holder per refresh token', () async {
    tokens = _StuckTokens();
    await signedIn();
    repo.outcome = SignOutOutcome.unreached;

    await controller().signOut();

    expect(container.read(provider), isA<AuthSignedOut>());
    expect((await tokens.read())!.refreshToken, 'refresh-new', reason: 'the keychain refused the delete');
    expect(await pending.read(), isEmpty, reason: 'the live store keeps it; the retrier must not refresh it too');
  });

  test('a principal refused at sign-in, server unreached: its session is left pending', () async {
    repo.currentUserError = const AppError(AppErrorKind.forbidden, code: AuthFailures.roleNotSupported);
    repo.outcome = SignOutOutcome.unreached;

    await controller().signIn(username: 'staff', password: 'secret');

    expect(container.read(provider), isA<AuthSignedOut>());
    expect(await tokens.read(), isNull);
    expect((await pending.read()).single.session.refreshToken, 'refresh-new');
  });

  test('a principal refused at restore, server unreached: its session is left pending', () async {
    await tokens.write(AuthSession(
      accessToken: 'access-stored',
      refreshToken: 'refresh-stored',
      accessTokenExpiresAt: t0.add(const Duration(minutes: 10)),
    ));
    repo.currentUserError = const AppError(AppErrorKind.forbidden, code: AuthFailures.usesAdminWeb);
    repo.outcome = SignOutOutcome.unreached;

    await controller().restore();

    expect(container.read(provider), isA<AuthSignedOut>());
    expect(await tokens.read(), isNull);
    expect((await pending.read()).single.session.refreshToken, 'refresh-stored');
  });

  test('a hung flush never blocks the sign-in beyond its bound', () async {
    final hung = Completer<void>();
    repo.logoutHangs = hung.future;
    await pending.write([
      PendingSignOut(
        session: AuthSession(
          accessToken: 'access-old',
          refreshToken: 'refresh-old',
          accessTokenExpiresAt: t0.add(const Duration(minutes: 10)),
        ),
        createdAt: t0,
        attempts: 1,
        notBefore: t0.add(const Duration(minutes: 1)),
      ),
    ]);

    await controller().signIn(username: 'parent', password: 'secret');

    expect(container.read(provider), isA<AuthAuthenticated>());
    hung.complete();
  });
}
