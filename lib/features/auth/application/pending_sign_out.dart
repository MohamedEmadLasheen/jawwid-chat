import 'dart:async';
import 'dart:math' as math;

import '../../../core/data/repositories.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/logging/redacting_logger.dart';
import '../../../core/storage/secure_token_store.dart';
import '../../../shared/models/auth.dart';

/// LR-46 follow-up: ends on the server a session the user signed out of while offline.
///
/// ## Why
///
/// A sign-out clears the device at once, server answer or not -- a person who pressed
/// "sign out" must never be left signed in. But a server that never heard the sign-out keeps
/// the session live for up to thirty days, and since #537 a device's push token is bound to
/// its session: the next account on the phone would get no notifications, and the previous
/// account's would keep arriving on it. So the minimum needed to finish the job -- the
/// session's tokens -- is kept in the Keychain / Keystore ([PendingSignOutStore]) and the
/// sign-out is retried: at app start ([start]), when connectivity returns, on a backoff
/// timer, and before any new sign-in ([flushBeforeSignIn]).
///
/// ## What ends it
///
/// * a 2xx from `POST /auth/logout`;
/// * a 401 (or any other refusal a retry would not change): the session is already over;
/// * [maxAttempts] failed attempts, or an entry older than a server session can live.
///
/// ## The refresh, and why it is careful
///
/// After fifteen minutes the stored access token has expired, and the logout needs a fresh
/// one: one `POST /auth/refresh` with the pending refresh token. That ROTATES, and presenting
/// a rotated token again is read by the API as theft and revokes every session on the
/// account. So: the successor is persisted BEFORE the logout is sent, and a refresh that may
/// have reached the server without an answer arriving (anything but [AppError.neverReachedServer])
/// is never presented again -- the entry is dropped instead. This session is never the live
/// one, and these calls go over the public transport, so the single refresh authority of the
/// live session (`StoredTokenProvider`) is untouched.
///
/// Never logs a token: entries print without them, and only error kinds are logged.
class PendingSignOutRetrier {
  PendingSignOutRetrier({
    required PendingSignOutStore store,
    required SignOutServer server,
    Stream<void>? reconnected,
    DateTime Function()? clock,
    Timer Function(Duration delay, void Function() callback)? timer,
    RedactingLogger logger = const RedactingLogger(),
    this.maxAttempts = 8,
    this.baseDelay = defaultBaseDelay,
    this.maxDelay = const Duration(hours: 1),
    this.maxAge = const Duration(days: 30),
    this.maxEntries = 5,
    this.signInWait = const Duration(seconds: 3),
  })  : _store = store,
        _server = server,
        _reconnected = reconnected,
        _clock = clock ?? DateTime.now,
        _timer = timer ?? Timer.new,
        _logger = logger;

  static const defaultBaseDelay = Duration(seconds: 30);

  final PendingSignOutStore _store;
  final SignOutServer _server;
  final Stream<void>? _reconnected;
  final DateTime Function() _clock;
  final Timer Function(Duration, void Function()) _timer;
  final RedactingLogger _logger;

  /// Attempts before giving up, the original sign-out included.
  final int maxAttempts;

  /// The delay after the first failure; it doubles after each, up to [maxDelay].
  final Duration baseDelay;
  final Duration maxDelay;

  /// Older than this, the server session has expired by itself: dropped unsent.
  final Duration maxAge;

  /// At most this many sessions are kept pending; the oldest goes first.
  final int maxEntries;

  /// The longest a sign-in waits on [flushBeforeSignIn].
  final Duration signInWait;

  StreamSubscription<void>? _reconnects;
  Timer? _due;
  Future<void>? _flushing;
  bool _started = false;

  /// Every read-modify-write of the store runs on this chain, so a sign-out recorded while a
  /// flush is out is never overwritten by it. Network calls are never made while holding it.
  Future<void> _lock = Future.value();

  /// App start: retries what is due now and whenever connectivity returns. Idempotent.
  void start() {
    if (_started) return;
    _started = true;
    // A connectivity source that errors (a platform without the plugin) only loses this
    // trigger; app start, the backoff timer and the next sign-in still retry.
    _reconnects = _reconnected?.listen((_) => unawaited(flush()), onError: (Object _) {});
    unawaited(flush());
  }

  Future<void> dispose() async {
    _due?.cancel();
    _due = null;
    await _reconnects?.cancel();
    _reconnects = null;
  }

  /// Records [session] as signed out locally but not on the server. The sign-out that just
  /// failed counts as the first attempt, so the next is due after [baseDelay]. Never throws.
  Future<void> add(AuthSession session) => _guard('record', () async {
        final now = _clock();
        final entry = PendingSignOut(session: session, createdAt: now, attempts: 1, notBefore: now.add(_delayAfter(1)));
        await _mutate((entries) {
          final kept = [
            for (final e in entries)
              if (e.session.refreshToken != session.refreshToken) e,
            entry,
          ];
          return kept.length > maxEntries ? kept.sublist(kept.length - maxEntries) : kept;
        });
        await _schedule();
      });

  /// Tries every due entry once. [force] tries them even inside their backoff (a new sign-in).
  /// Single-flighted; never throws.
  Future<void> flush({bool force = false}) {
    final inFlight = _flushing;
    if (inFlight != null) {
      // A forced flush must still try what the running one skipped as not yet due.
      return force ? inFlight.then((_) => flush(force: true)) : inFlight;
    }
    final run = _guard('flush', () => _flush(force));
    _flushing = run;
    return run.whenComplete(() {
      if (identical(_flushing, run)) _flushing = null;
    });
  }

  /// Best effort before a new sign-in, and never blocking it beyond [signInWait].
  Future<void> flushBeforeSignIn() async {
    try {
      await flush(force: true).timeout(signInWait);
    } catch (error) {
      _logger.warn('pending sign-out not flushed before sign-in', data: {'type': error.runtimeType.toString()});
    }
  }

  Future<void> _flush(bool force) async {
    final entries = await _store.read();
    for (final entry in entries) {
      final now = _clock();
      if (now.difference(entry.createdAt) >= maxAge) {
        await _remove(entry);
        continue;
      }
      final notBefore = entry.notBefore;
      if (!force && notBefore != null && now.isBefore(notBefore)) continue;
      await _attempt(entry);
    }
    await _schedule();
  }

  Future<void> _attempt(PendingSignOut entry) async {
    final stored = entry.session;
    if (stored.accessToken.isNotEmpty && !stored.isExpired(_clock())) {
      switch (await _logout(stored.accessToken)) {
        case _Verdict.over:
          return _remove(entry);
        case _Verdict.unreached:
          return _failed(entry);
        case _Verdict.expired:
          break; // Answered by the refresh below.
      }
    }

    final AuthSession renewed;
    try {
      renewed = await _server.refresh(stored.refreshToken);
    } catch (error) {
      if (error is AppError && error.neverReachedServer) return _failed(entry);
      // A refusal (401: the session is over), or an answer that may have been lost after the
      // server rotated the token. Either way this token must not be presented again.
      _logger.info('pending sign-out ended by refresh answer', data: {'kind': _kindOf(error)});
      return _remove(entry);
    }

    // The successor first: from here the old refresh token is retired server-side.
    final successor = entry.copyWith(session: renewed);
    await _replace(entry, successor);

    switch (await _logout(renewed.accessToken)) {
      case _Verdict.over:
      case _Verdict.expired: // A token minted a moment ago refused as expired: nothing to fix.
        return _remove(successor);
      case _Verdict.unreached:
        return _failed(successor);
    }
  }

  Future<_Verdict> _logout(String accessToken) async {
    try {
      await _server.logoutWith(accessToken);
      return _Verdict.over;
    } on AppError catch (error) {
      if (error.isRefreshable) return _Verdict.expired;
      if (error.isTransient) return _Verdict.unreached;
      // Revoked, disabled, locked, forbidden, not found: the same answer every time.
      return _Verdict.over;
    } catch (error) {
      _logger.warn('pending sign-out logout failed', data: {'type': error.runtimeType.toString()});
      return _Verdict.unreached;
    }
  }

  Future<void> _failed(PendingSignOut entry) async {
    final attempts = entry.attempts + 1;
    if (attempts >= maxAttempts) {
      _logger.warn('pending sign-out abandoned', data: {'attempts': attempts});
      return _remove(entry);
    }
    await _replace(entry, entry.copyWith(attempts: attempts, notBefore: _clock().add(_delayAfter(attempts))));
  }

  /// baseDelay, 2x, 4x ... capped at [maxDelay].
  Duration _delayAfter(int attempts) {
    final factor = math.pow(2, math.max(0, attempts - 1)).toInt();
    final delay = baseDelay * factor;
    return delay > maxDelay ? maxDelay : delay;
  }

  Future<void> _remove(PendingSignOut entry) => _mutate((entries) => [
        for (final e in entries)
          if (e.session.refreshToken != entry.session.refreshToken) e,
      ]);

  Future<void> _replace(PendingSignOut old, PendingSignOut next) => _mutate((entries) => [
        for (final e in entries) e.session.refreshToken == old.session.refreshToken ? next : e,
      ]);

  Future<void> _mutate(List<PendingSignOut> Function(List<PendingSignOut> entries) change) {
    final done = _lock.then((_) async => _store.write(change(await _store.read())));
    _lock = done.catchError((Object _) {});
    return done;
  }

  /// One timer, for the earliest entry still waiting out its backoff.
  Future<void> _schedule() async {
    _due?.cancel();
    _due = null;
    final waiting = [
      for (final e in await _store.read())
        if (e.notBefore != null) e.notBefore!,
    ];
    if (waiting.isEmpty) return;
    final earliest = waiting.reduce((a, b) => a.isBefore(b) ? a : b);
    final delay = earliest.difference(_clock());
    _due = _timer(delay.isNegative ? Duration.zero : delay, () => unawaited(flush()));
  }

  Future<void> _guard(String step, Future<void> Function() run) async {
    try {
      await run();
    } catch (error) {
      // A keychain that refuses must not break a sign-out or a sign-in.
      _logger.warn('pending sign-out $step failed', data: {'type': error.runtimeType.toString()});
    }
  }

  static String _kindOf(Object error) => error is AppError ? error.kind.name : error.runtimeType.toString();
}

enum _Verdict {
  /// The session is over on the server (2xx, or an answer that says so).
  over,

  /// The access token was refused as expired: a refresh may answer it.
  expired,

  /// No verdict: try again later.
  unreached,
}
