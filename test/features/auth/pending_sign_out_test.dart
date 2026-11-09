import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/features/auth/application/pending_sign_out.dart';
import 'package:jawwid_chat/shared/models/auth.dart';

/// The two server calls a pending sign-out is retried with, scripted.
class _Server implements SignOutServer {
  final calls = <String>[];

  /// Consumed in order; null is a 2xx. Empty means 2xx.
  final logoutReplies = <AppError?>[];

  /// Consumed in order: an [AuthSession] is a 2xx, an [AppError] a refusal.
  final refreshReplies = <Object>[];

  @override
  Future<void> logoutWith(String accessToken) async {
    calls.add('logout $accessToken');
    final reply = logoutReplies.isEmpty ? null : logoutReplies.removeAt(0);
    if (reply != null) throw reply;
  }

  @override
  Future<AuthSession> refresh(String refreshToken) async {
    calls.add('refresh $refreshToken');
    final reply = refreshReplies.removeAt(0);
    if (reply is AppError) throw reply;
    return reply as AuthSession;
  }
}

class _FakeTimer implements Timer {
  _FakeTimer(this.duration, this.callback);

  final Duration duration;
  final void Function() callback;
  bool cancelled = false;

  @override
  void cancel() => cancelled = true;

  @override
  bool get isActive => !cancelled;

  @override
  int get tick => 0;
}

const _offline = AppError(AppErrorKind.network, code: AppError.connectFailed);

Future<void> _settle() async {
  for (var i = 0; i < 20; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

void main() {
  // A fixed instant: nothing here is relative to the real date.
  final t0 = DateTime.utc(2026, 11, 9, 12);

  late DateTime now;
  late _Server server;
  late InMemoryPendingSignOutStore store;
  late List<_FakeTimer> timers;
  late StreamController<void> reconnected;

  PendingSignOutRetrier retrier({int maxAttempts = 5}) => PendingSignOutRetrier(
        store: store,
        server: server,
        reconnected: reconnected.stream,
        clock: () => now,
        timer: (duration, callback) {
          final timer = _FakeTimer(duration, callback);
          timers.add(timer);
          return timer;
        },
        maxAttempts: maxAttempts,
      );

  AuthSession session(String tag, {required bool live}) => AuthSession(
        accessToken: 'access-$tag',
        refreshToken: 'refresh-$tag',
        accessTokenExpiresAt: live ? t0.add(const Duration(minutes: 10)) : t0.subtract(const Duration(minutes: 1)),
      );

  setUp(() {
    now = t0;
    server = _Server();
    store = InMemoryPendingSignOutStore();
    timers = [];
    reconnected = StreamController<void>.broadcast();
  });

  tearDown(() => reconnected.close());

  group('a 2xx or a 401 ends it', () {
    test('a still-valid access token logs out directly, and a 2xx clears the entry', () async {
      final r = retrier();
      await r.add(session('a', live: true));
      expect(await store.read(), hasLength(1));

      await r.flush(force: true);

      expect(server.calls, ['logout access-a']);
      expect(await store.read(), isEmpty);
    });

    test('a 401 from logout (the session is already over) clears it without a refresh', () async {
      server.logoutReplies.add(const AppError(AppErrorKind.sessionRevoked));
      final r = retrier();
      await r.add(session('a', live: true));

      await r.flush(force: true);

      expect(server.calls, ['logout access-a']);
      expect(await store.read(), isEmpty);
    });

    test('an expired access token: one refresh, the successor is logged out, entry cleared', () async {
      server.refreshReplies.add(session('b', live: true));
      final r = retrier();
      await r.add(session('a', live: false));

      await r.flush(force: true);

      expect(server.calls, ['refresh refresh-a', 'logout access-b']);
      expect(await store.read(), isEmpty);
    });

    test('a refresh answered 401 means the session is dead: cleared, no logout', () async {
      server.refreshReplies.add(const AppError(AppErrorKind.sessionRevoked));
      final r = retrier();
      await r.add(session('a', live: false));

      await r.flush(force: true);

      expect(server.calls, ['refresh refresh-a']);
      expect(await store.read(), isEmpty);
    });

    test('a generic 401 on a live-looking access token is answered by the refresh', () async {
      server.logoutReplies.add(const AppError(AppErrorKind.unauthenticated));
      server.refreshReplies.add(const AppError(AppErrorKind.unauthenticated));
      final r = retrier();
      await r.add(session('a', live: true));

      await r.flush(force: true);

      expect(server.calls, ['logout access-a', 'refresh refresh-a']);
      expect(await store.read(), isEmpty);
    });
  });

  group('a transport failure keeps it, bounded', () {
    test('kept with backoff; attempts are counted; dropped at the ceiling', () async {
      server.logoutReplies.addAll(List.filled(10, _offline));
      final r = retrier(maxAttempts: 3);

      // The failed sign-out itself is attempt 1.
      await r.add(session('a', live: true));
      final first = (await store.read()).single;
      expect(first.attempts, 1);
      expect(first.notBefore!.isAfter(now), isTrue);
      expect(timers.last.duration, PendingSignOutRetrier.defaultBaseDelay);

      // Not yet due: an unforced flush sends nothing.
      await r.flush();
      expect(server.calls, isEmpty);

      now = first.notBefore!;
      await r.flush();
      expect(server.calls, ['logout access-a']);
      final second = (await store.read()).single;
      expect(second.attempts, 2);
      expect(
        second.notBefore!.difference(now),
        PendingSignOutRetrier.defaultBaseDelay * 2,
        reason: 'exponential backoff',
      );

      now = second.notBefore!;
      await r.flush();
      expect(server.calls, ['logout access-a', 'logout access-a']);
      expect(await store.read(), isEmpty, reason: 'maxAttempts reached: given up, not retried forever');
    });

    test('a refresh that never reached the server is kept', () async {
      server.refreshReplies.add(_offline);
      final r = retrier();
      await r.add(session('a', live: false));

      await r.flush(force: true);

      expect(server.calls, ['refresh refresh-a']);
      final kept = (await store.read()).single;
      expect(kept.attempts, 2);
      expect(kept.session.refreshToken, 'refresh-a');
    });

    test('a refresh that MAY have reached the server is never presented again', () async {
      // A read timeout: the server may have rotated the token and the answer been lost.
      // Presenting a rotated token is read as theft and revokes every session on the account.
      server.refreshReplies.add(const AppError(AppErrorKind.timeout));
      final r = retrier();
      await r.add(session('a', live: false));

      await r.flush(force: true);

      expect(server.calls, ['refresh refresh-a']);
      expect(await store.read(), isEmpty);
    });

    test('after a refresh, a failed logout keeps the SUCCESSOR, never the retired token', () async {
      server.refreshReplies.add(session('b', live: true));
      server.logoutReplies.add(_offline);
      final r = retrier();
      await r.add(session('a', live: false));

      await r.flush(force: true);

      final kept = (await store.read()).single;
      expect(kept.session.refreshToken, 'refresh-b');

      await r.flush(force: true);
      expect(server.calls, ['refresh refresh-a', 'logout access-b', 'logout access-b']);
      expect(await store.read(), isEmpty);
    });

    test('an entry older than a session can live is dropped without a request', () async {
      final r = retrier();
      await r.add(session('a', live: true));

      now = t0.add(const Duration(days: 31));
      await r.flush(force: true);

      expect(server.calls, isEmpty);
      expect(await store.read(), isEmpty);
    });
  });

  group('when it is retried', () {
    test('at app start: a fresh retrier over the same store flushes what is due', () async {
      await retrier().add(session('a', live: true));
      // Past the backoff, still inside the access token's lifetime.
      now = t0.add(const Duration(minutes: 1));

      final atStart = retrier()..start();
      await _settle();

      expect(server.calls, ['logout access-a']);
      expect(await store.read(), isEmpty);
      await atStart.dispose();
    });

    test('when connectivity returns', () async {
      final r = retrier()..start();
      server.logoutReplies.add(_offline);
      await r.add(session('a', live: true));
      await r.flush(force: true);
      expect(await store.read(), hasLength(1));

      now = (await store.read()).single.notBefore!;
      reconnected.add(null);
      await _settle();

      expect(server.calls, ['logout access-a', 'logout access-a']);
      expect(await store.read(), isEmpty);
      await r.dispose();
    });

    test('when the backoff timer fires', () async {
      final r = retrier();
      await r.add(session('a', live: true));

      now = (await store.read()).single.notBefore!;
      timers.last.callback();
      await _settle();

      expect(server.calls, ['logout access-a']);
      expect(await store.read(), isEmpty);
    });

    test('before a new sign-in, even when not yet due, and it never throws', () async {
      server.logoutReplies.add(_offline);
      final r = retrier();
      await r.add(session('a', live: true));

      await expectLater(r.flushBeforeSignIn(), completes);

      expect(server.calls, ['logout access-a']);
    });

    test('a sign-in never waits on a hung flush beyond its bound', () async {
      final hung = Completer<void>();
      final r = PendingSignOutRetrier(
        store: store,
        server: _HungServer(hung.future),
        clock: () => now,
        timer: (d, c) => _FakeTimer(d, c),
        signInWait: const Duration(milliseconds: 20),
      );
      await r.add(session('a', live: true));

      await expectLater(r.flushBeforeSignIn(), completes);
      hung.complete();
    });
  });

  test('a pending entry never prints a token', () {
    final entry = PendingSignOut(
      session: session('secret', live: true),
      createdAt: t0,
      attempts: 1,
    );
    expect(entry.toString(), isNot(contains('access-secret')));
    expect(entry.toString(), isNot(contains('refresh-secret')));
  });

  test('two sign-outs both stay pending, neither overwrites the other', () async {
    final r = retrier();
    await r.add(session('a', live: true));
    await r.add(session('b', live: true));

    await r.flush(force: true);

    expect(server.calls, ['logout access-a', 'logout access-b']);
    expect(await store.read(), isEmpty);
  });
}

class _HungServer implements SignOutServer {
  _HungServer(this._until);

  final Future<void> _until;

  @override
  Future<void> logoutWith(String accessToken) => _until;

  @override
  Future<AuthSession> refresh(String refreshToken) => throw UnimplementedError();
}
