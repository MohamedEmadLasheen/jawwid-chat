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

  /// When set, the sign-out call throws it instead of answering [outcome].
  Object? signOutThrows;

  /// Null is a 2xx.
  AppError? logoutError;

  /// Consumed in order before [logoutError]: one reply per `logoutWith`, null a 2xx.
  final logoutReplies = <AppError?>[];

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
    final thrown = signOutThrows;
    if (thrown != null) throw thrown;
    return outcome;
  }

  @override
  Future<void> logoutWith(String accessToken) async {
    log.add('logout $accessToken');
    final hang = logoutHangs;
    if (hang != null) await hang;
    final error = logoutReplies.isNotEmpty ? logoutReplies.removeAt(0) : logoutError;
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
  late DateTime now;

  /// The backoff timers the retrier armed, newest last. Never fired unless a test does.
  late List<void Function()> armed;

  setUp(() {
    repo = _Repo();
    tokens = InMemoryTokenStore();
    pending = InMemoryPendingSignOutStore();
    clearCalls = 0;
    now = t0;
    armed = [];
    retrier = PendingSignOutRetrier(
      store: pending,
      server: repo,
      clock: () => now,
      timer: (_, callback) {
        armed.add(callback);
        return _NoTimer();
      },
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

  /// Lets the background retry (never awaited by a sign-in) run to the end.
  Future<void> settle() async {
    for (var i = 0; i < 30; i++) {
      await Future<void>.delayed(Duration.zero);
    }
  }

  PendingSignOut oldEntry() => PendingSignOut(
        session: AuthSession(
          accessToken: 'access-old',
          refreshToken: 'refresh-old',
          accessTokenExpiresAt: t0.add(const Duration(minutes: 10)),
        ),
        createdAt: t0,
        attempts: 1,
        // Not yet due, so the app-start flush leaves it for the sign-in.
        notBefore: t0.add(const Duration(minutes: 1)),
      );

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
    await settle();
    final kept = (await pending.read()).single;
    expect(kept.attempts, 1, reason: 'offline: not counted toward the ceiling');
    expect(kept.offlineFailures, 2, reason: 'tried before the sign-in and once more after it');
  });

  test('a sign-out that throws something other than an AppError leaves the session pending', () async {
    await signedIn();
    repo.signOutThrows = StateError('a response that did not decode');

    await controller().signOut();

    expect(container.read(provider), isA<AuthSignedOut>());
    expect(await tokens.read(), isNull);
    expect((await pending.read()).single.session.refreshToken, 'refresh-new');
  });

  test('a sign-out refused with a verdict leaves nothing pending', () async {
    await signedIn();
    repo.signOutThrows = const AppError(AppErrorKind.sessionRevoked);

    await controller().signOut();

    expect(container.read(provider), isA<AuthSignedOut>());
    expect(await pending.read(), isEmpty, reason: 'the server answered: the session is over');
  });

  test('a transient AppError thrown by the sign-out leaves the session pending', () async {
    await signedIn();
    repo.signOutThrows = const AppError(AppErrorKind.network, code: AppError.connectFailed);

    await controller().signOut();

    expect((await pending.read()).single.session.refreshToken, 'refresh-new');
  });

  test('a pending sign-out is tried before the new sign-in, then after it until it ends', () async {
    await pending.write([oldEntry()]);
    repo.logoutReplies.addAll([
      const AppError(AppErrorKind.network, code: AppError.connectFailed), // before the sign-in
      const AppError(AppErrorKind.server), // just after it
      // then a 2xx, on the backoff
    ]);

    await controller().signIn(username: 'parent', password: 'secret');

    expect(container.read(provider), isA<AuthAuthenticated>());
    expect(repo.log.indexOf('logout access-old'), lessThan(repo.log.indexOf('login')),
        reason: 'attempted before the new account exists');

    await settle();
    expect(repo.log.where((c) => c == 'logout access-old'), hasLength(2),
        reason: 'retried in the background once the sign-in reached the server');
    final kept = (await pending.read()).single;
    expect(kept.session.refreshToken, 'refresh-old');
    expect(armed, isNotEmpty, reason: 'the backoff keeps it going');

    now = kept.notBefore!;
    armed.last();
    await settle();

    expect(repo.log.where((c) => c == 'logout access-old'), hasLength(3));
    expect(await pending.read(), isEmpty);
    expect(container.read(provider), isA<AuthAuthenticated>(), reason: 'the new session is untouched');
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

  test('a hung pre-sign-in attempt: sign-in goes ahead, and the retry after it still ends the session', () async {
    final hung = Completer<void>();
    repo.logoutHangs = hung.future;
    await pending.write([oldEntry()]);
    // The hung attempt finally fails offline; the one queued behind it by the sign-in gets a 2xx.
    repo.logoutReplies.add(const AppError(AppErrorKind.network, code: AppError.connectFailed));

    // Awaited while the attempt is still hung: the sign-in is bounded, not blocked.
    await controller().signIn(username: 'parent', password: 'secret');

    expect(container.read(provider), isA<AuthAuthenticated>());
    expect(repo.log.first, 'logout access-old', reason: 'sent before the sign-in');
    expect(await pending.read(), hasLength(1), reason: 'not ended yet: the residual window');

    hung.complete();
    await settle();

    expect(repo.log.where((c) => c == 'logout access-old'), hasLength(2));
    expect(await pending.read(), isEmpty);
  });
}
