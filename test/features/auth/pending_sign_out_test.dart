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

  /// When set, a refresh waits on it before answering: a request in flight.
  Future<void>? refreshGate;

  /// Called as the refresh is sent, before it answers: what the store held at that moment.
  Future<void> Function()? onRefreshSent;

  @override
  Future<void> logoutWith(String accessToken) async {
    calls.add('logout $accessToken');
    final reply = logoutReplies.isEmpty ? null : logoutReplies.removeAt(0);
    if (reply != null) throw reply;
  }

  @override
  Future<AuthSession> refresh(String refreshToken) async {
    calls.add('refresh $refreshToken');
    await onRefreshSent?.call();
    final gate = refreshGate;
    if (gate != null) await gate;
    final reply = refreshReplies.removeAt(0);
    if (reply is AppError) throw reply;
    return reply as AuthSession;
  }
}

/// A keychain that refuses some writes: [refuses] decides from the list about to be written.
class _RefusingStore implements PendingSignOutStore {
  final _inner = InMemoryPendingSignOutStore();

  bool Function(List<PendingSignOut> entries) refuses = (_) => false;

  @override
  Future<List<PendingSignOut>> read() => _inner.read();

  @override
  Future<void> write(List<PendingSignOut> entries) async {
    if (refuses(entries)) throw StateError('keychain refused the write');
    await _inner.write(entries);
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
  late PendingSignOutStore store;
  late List<_FakeTimer> timers;
  late StreamController<void> reconnected;

  PendingSignOutRetrier retrier({int maxAttempts = 5, TokenStore? liveTokens}) => PendingSignOutRetrier(
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
        liveTokens: liveTokens,
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
    test('kept with backoff; attempts that reached the server are counted; dropped at the ceiling', () async {
      // A 5xx: the server was reached, so each one uses up an attempt.
      server.logoutReplies.addAll(List.filled(10, const AppError(AppErrorKind.server)));
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
      expect(kept.attempts, 1, reason: 'a request that never left the phone does not use the entry up');
      expect(kept.offlineFailures, 1);
      expect(kept.session.refreshToken, 'refresh-a');
      expect(kept.refreshStartedAt, isNull, reason: 'never reached the server: safe to refresh again');

      server.refreshReplies.add(session('b', live: true));
      await r.flush(force: true);
      expect(server.calls, ['refresh refresh-a', 'refresh refresh-a', 'logout access-b']);
      expect(await store.read(), isEmpty);
    });

    test('ten and more offline failures never abandon the entry: the age limit is the backstop', () async {
      server.logoutReplies.addAll(List.filled(12, _offline));
      final r = retrier(maxAttempts: 8);
      // An access token that outlives the test, so every attempt is the same logout.
      await r.add(AuthSession(
        accessToken: 'access-a',
        refreshToken: 'refresh-a',
        accessTokenExpiresAt: t0.add(const Duration(days: 60)),
      ));

      for (var i = 0; i < 12; i++) {
        now = (await store.read()).single.notBefore!;
        await r.flush();
      }

      expect(server.calls, hasLength(12));
      final kept = (await store.read()).single;
      expect(kept.attempts, 1);
      expect(kept.offlineFailures, 12);
      expect(kept.notBefore!.difference(now), const Duration(hours: 1), reason: 'the backoff is capped');

      now = t0.add(const Duration(days: 30));
      await r.flush(force: true);
      expect(server.calls, hasLength(12), reason: 'dropped by age, unsent');
      expect(await store.read(), isEmpty);
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

  group('a refresh is presented at most once, across crashes and keychain failures', () {
    test('the marker is persisted BEFORE the refresh is sent', () async {
      final seen = <DateTime?>[];
      server.onRefreshSent = () async => seen.add((await store.read()).single.refreshStartedAt);
      server.refreshReplies.add(session('b', live: true));
      server.logoutReplies.add(_offline);
      final r = retrier();
      await r.add(session('a', live: false));

      await r.flush(force: true);

      expect(seen, [t0]);
      final kept = (await store.read()).single;
      expect(kept.session.refreshToken, 'refresh-b');
      expect(kept.refreshStartedAt, isNull, reason: 'the successor has never been presented');
    });

    test('a marker the keychain refuses to write: no refresh is sent', () async {
      final refusing = _RefusingStore();
      store = refusing;
      final r = retrier();
      await r.add(session('a', live: false));
      refusing.refuses = (entries) => entries.any((e) => e.refreshStartedAt != null);

      await r.flush(force: true);

      expect(server.calls, isEmpty);
      final kept = (await store.read()).single;
      expect(kept.session.refreshToken, 'refresh-a');
      expect(kept.refreshStartedAt, isNull);
    });

    test('the app dies after the refresh was sent: on restart the token is never presented again', () async {
      // What the keychain holds after a kill between the refresh and saving its answer.
      await store.write([
        PendingSignOut(
          session: session('a', live: false),
          createdAt: t0,
          attempts: 1,
          refreshStartedAt: t0,
        ),
      ]);

      final atStart = retrier()..start();
      await _settle();

      expect(server.calls, isEmpty, reason: 'expired access token, refresh already spent: dropped');
      expect(await store.read(), isEmpty);
      await atStart.dispose();
    });

    test('a marked entry whose access token is still valid is logged out with it, never refreshed', () async {
      await store.write([
        PendingSignOut(session: session('a', live: true), createdAt: t0, attempts: 1, refreshStartedAt: t0),
      ]);
      // Refused as expired: the answer a refresh would normally be asked for.
      server.logoutReplies.add(const AppError(AppErrorKind.unauthenticated));

      await retrier().flush(force: true);

      expect(server.calls, ['logout access-a']);
      expect(await store.read(), isEmpty);
    });

    test('the refresh answered but the successor could not be saved: the old token is never presented again',
        () async {
      final refusing = _RefusingStore();
      store = refusing;
      final r = retrier();
      await r.add(session('a', live: false));
      refusing.refuses = (entries) => entries.any((e) => e.session.refreshToken == 'refresh-b');
      server.refreshReplies.add(session('b', live: true));
      server.logoutReplies.add(_offline);

      await r.flush(force: true);
      expect(server.calls, ['refresh refresh-a', 'logout access-b']);
      final kept = (await store.read()).single;
      expect(kept.session.refreshToken, 'refresh-a');
      expect(kept.refreshStartedAt, isNotNull);

      await r.flush(force: true);
      expect(server.calls, ['refresh refresh-a', 'logout access-b'], reason: 'refresh-a is never sent twice');
      expect(await store.read(), isEmpty);
    });

    test('the successor could not be saved but its logout lands: nothing is left behind', () async {
      final refusing = _RefusingStore();
      store = refusing;
      final r = retrier();
      await r.add(session('a', live: false));
      refusing.refuses = (entries) => entries.any((e) => e.session.refreshToken == 'refresh-b');
      server.refreshReplies.add(session('b', live: true));

      await r.flush(force: true);

      expect(server.calls, ['refresh refresh-a', 'logout access-b']);
      expect(await store.read(), isEmpty);
    });
  });

  group('the live session is never touched', () {
    test("an entry holding the live store's refresh token is dropped unsent", () async {
      final live = InMemoryTokenStore();
      await live.write(session('a', live: false));
      final r = retrier(liveTokens: live);
      await r.add(session('a', live: false));

      await r.flush(force: true);

      expect(server.calls, isEmpty);
      expect(await store.read(), isEmpty);
      expect((await live.read())!.refreshToken, 'refresh-a', reason: 'the live session is left alone');
    });

    test('an entry for another session is still sent', () async {
      final live = InMemoryTokenStore();
      await live.write(session('other', live: true));
      final r = retrier(liveTokens: live);
      await r.add(session('a', live: true));

      await r.flush(force: true);

      expect(server.calls, ['logout access-a']);
    });
  });

  group('concurrent flushes send one refresh', () {
    test('app start and connectivity at once', () async {
      final gate = Completer<void>();
      server.refreshGate = gate.future;
      server.refreshReplies.add(session('b', live: true));
      await store.write([PendingSignOut(session: session('a', live: false), createdAt: t0, attempts: 1)]);

      final r = retrier()..start();
      reconnected.add(null);
      unawaited(r.flush());
      await _settle();
      gate.complete();
      await _settle();

      expect(server.calls.where((c) => c.startsWith('refresh')), ['refresh refresh-a']);
      expect(server.calls, ['refresh refresh-a', 'logout access-b']);
      expect(await store.read(), isEmpty);
      await r.dispose();
    });

    test('the backoff timer firing while a forced flush is out', () async {
      final gate = Completer<void>();
      server.refreshGate = gate.future;
      server.refreshReplies.add(session('b', live: true));
      final r = retrier();
      await r.add(session('a', live: false));

      final forced = r.flushBeforeSignIn();
      await _settle();
      now = (await store.read()).single.notBefore!;
      timers.last.callback();
      unawaited(r.flush(force: true));
      await _settle();
      gate.complete();
      await forced;
      await _settle();

      expect(server.calls.where((c) => c.startsWith('refresh')), ['refresh refresh-a']);
      expect(await store.read(), isEmpty);
    });
  });

  test('a retrier started again after dispose listens again', () async {
    final r = retrier()..start();
    await _settle();
    await r.dispose();
    r.start();
    await _settle();

    // Recorded after the app-start flush, so only the reconnect listener can send it.
    await r.add(session('a', live: true));
    now = (await store.read()).single.notBefore!;
    reconnected.add(null);
    await _settle();

    expect(server.calls, ['logout access-a']);
    await r.dispose();
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

  test('the refresh marker and the offline count survive the keychain round trip', () {
    final entry = PendingSignOut(
      session: session('a', live: false),
      createdAt: t0,
      attempts: 2,
      offlineFailures: 3,
      refreshStartedAt: t0.add(const Duration(seconds: 5)),
    );

    final back = PendingSignOut.fromJson(entry.toJson())!;

    expect(back.refreshStartedAt, t0.add(const Duration(seconds: 5)));
    expect(back.offlineFailures, 3);
    expect(back.attempts, 2);
  });

  test('a marker that cannot be read drops the entry rather than reading as "never refreshed"', () {
    final json = PendingSignOut(session: session('a', live: false), createdAt: t0, attempts: 1).toJson()
      ..['refreshStartedAt'] = 'not a date';

    expect(PendingSignOut.fromJson(json), isNull);
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
