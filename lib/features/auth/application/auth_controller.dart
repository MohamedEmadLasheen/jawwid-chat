import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/data/repositories.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/logging/redacting_logger.dart';
import '../../../core/storage/secure_token_store.dart';
import '../../../shared/models/auth.dart';
import '../../../shared/models/legal.dart';
import '../../legal/application/legal_wire.dart';
import '../domain/auth_state.dart';
import 'pending_sign_out.dart';
import 'session_termination.dart';

/// Owns the session for the whole app.
///
/// Everything that ends a session funnels through [_endSession], so there is exactly one
/// place responsible for clearing sensitive local state — which is what §7 asks for
/// ("detect authentication failure, clear sensitive local state, return to login, and do not
/// continue showing protected data").
class AuthController extends Notifier<AuthState> {
  AuthController({
    required AuthRepository repository,
    required TokenStore tokens,
    required Future<void> Function() clearLocalData,
    void Function(AuthUser principal)? onPrincipal,
    Future<void> Function()? onSessionCleared,
    SessionTermination? termination,
    LegalWire? legal,
    PendingSignOutRetrier? pendingSignOut,
    RedactingLogger logger = const RedactingLogger(),
  })  : _repository = repository,
        _legalWire = legal,
        _pendingSignOut = pendingSignOut,
        _tokens = tokens,
        _clearLocalData = clearLocalData,
        _onPrincipal = onPrincipal,
        _onSessionCleared = onSessionCleared,
        _termination = termination,
        _logger = logger;

  final AuthRepository _repository;
  final TokenStore _tokens;

  /// Drops cached conversations, messages, and drafts. Injected rather than imported so the
  /// auth feature does not reach into the storage layer directly.
  final Future<void> Function() _clearLocalData;

  /// Announces the authenticated principal to the layers that need it but must not depend on
  /// Riverpod — the transport decides message ownership by actor id and approval policy by
  /// role, and had neither until this existed.
  final void Function(AuthUser principal)? _onPrincipal;

  /// The other half: whatever [_onPrincipal] told, forget. Called from the one cleanup path,
  /// so a stale identity cannot outlive the session that produced it.
  final Future<void> Function()? _onSessionCleared;

  /// The wire from the transport. Bound in [build] so a terminal refusal seen by `ApiClient`
  /// on any background request ends the session here, rather than only clearing the actor id
  /// and leaving a revoked user looking at a protected screen until they restart.
  final SessionTermination? _termination;

  /// PD-58: the wire from the transport for the Terms of Use -- a token pair's `legal` block
  /// and every 403 `COMM.TERMS_NOT_ACCEPTED`. Bound in [build], like [_termination].
  final LegalWire? _legalWire;

  /// LR-46 follow-up: a sign-out the server never heard (offline) is kept here and retried,
  /// so the server session -- and the device's push binding (#537) -- does not outlive it.
  /// Null where there is nothing to keep it in (the PD-28 browser, the fixture build).
  final PendingSignOutRetrier? _pendingSignOut;

  /// The refresh token [_endServerSession] just handed to [_pendingSignOut], until the local
  /// clear that follows it has run. Never logged.
  String? _recordedPending;

  /// The identity refresh a TERMS_NOT_ACCEPTED refusal asked for, while it is out.
  Future<void>? _termsCheck;

  /// At most ONE more refresh, queued behind [_termsCheck] by a refusal that arrived while it
  /// was out: that refusal may be newer than the answer already on its way.
  Future<void>? _termsQueued;

  /// PD-58: bumped by every [adoptLegal]. A `/me` that was sent before the latest adopted
  /// block answers about an older moment, so its `legal` is not taken (B1): it can neither
  /// bring back a gate an acceptance just lifted, nor lift one a newer answer raised.
  int _legalSeq = 0;

  final RedactingLogger _logger;

  StreamSubscription<void>? _revocationWatch;

  /// Guards the destructive path against a burst of terminal signals — ten requests can each
  /// receive `AUTH.SESSION_REVOKED` from one revocation, and they must produce one clean
  /// signed-out state between them, not ten.
  bool _ending = false;

  @override
  AuthState build() {
    _termination?.bind(onSessionEnded);
    _legalWire?.bind(report: adoptLegal, refused: onTermsNotAccepted);
    ref.onDispose(() {
      _termination?.unbind(onSessionEnded);
      _legalWire?.unbind(adoptLegal);
      _revocationWatch?.cancel();
      unawaited(_pendingSignOut?.dispose());
    });
    // App start: retry any sign-out left pending by an earlier run, and again whenever
    // connectivity returns. Never awaited -- it must not hold the splash.
    _pendingSignOut?.start();
    return const AuthUnknown();
  }

  /// Read any stored session on launch and establish the real state.
  ///
  /// A stored token is *not* taken as proof of a valid session: the principal is fetched
  /// from the backend, so a token revoked while the app was closed fails here rather than
  /// letting protected screens render.
  ///
  /// It always settles. The router holds the app on the splash for as long as the state is
  /// [AuthUnknown], so a restore that threw instead of settling would leave the app on a
  /// spinner until it was killed -- which is what an unreadable keychain or an undecodable
  /// `/me` used to do.
  ///
  /// Also the retry from [AuthUnreachable]; concurrent calls share one attempt.
  Future<void> restore() =>
      _restoring ??= _restore().whenComplete(() => _restoring = null);

  Future<void>? _restoring;

  Future<void> _restore() async {
    if (state is AuthUnreachable) state = const AuthUnreachable(retrying: true);

    final AuthSession? stored;
    try {
      stored = await _tokens.read();
    } catch (error) {
      // The keychain or keystore refused to answer: an Android keystore key lost to a backup
      // restore onto another device, a corrupted entry. There is no session this device can
      // use, and nothing a retry would change. Clear what can be cleared and start over.
      _logger.warn('stored session unreadable', data: {'type': error.runtimeType.toString()});
      await _endSession(SignedOutReason.none);
      if (state is! AuthSignedOut) state = const AuthSignedOut();
      return;
    }

    if (stored == null) {
      state = const AuthSignedOut();
      return;
    }

    try {
      final principal = await _repository.currentUser();
      _adopt(principal);
      state = AuthAuthenticated(principal);
    } on AppError catch (error) {
      if (AuthFailures.refusesPrincipal(error.code)) {
        // The tokens are good -- only this app cannot act as the principal -- so the
        // server session is ended too, not orphaned for thirty days.
        await _logoutBestEffort();
        await _endSession(AuthSignedOut.reasonFor(error));
      } else if (error.terminatesSession) {
        await _endSession(AuthSignedOut.reasonFor(error));
      } else if (state is AuthSignedOut) {
        // The transport already ended the session while this was in flight; its reason
        // is the one to show.
      } else if (error.isTransient) {
        // A network failure at launch is not a sign-out. Keep the stored session and let
        // the user retry, rather than throwing away a working login because the café wifi
        // was down (§51).
        state = AuthUnreachable(error: error);
      } else {
        state = const AuthSignedOut();
      }
    } catch (error) {
      // Not an AppError: a response that did not decode, a mapper that met something new.
      // That is a defect, not a verdict on the session, and it must not strand the app on the
      // splash. Signed out with the tokens kept is the same place a non-transient refusal
      // lands.
      _logger.warn('restore failed', data: {'type': error.runtimeType.toString()});
      if (state is! AuthSignedOut) state = const AuthSignedOut();
    }
  }

  Future<void> signIn({required String username, required String password, bool remember = false}) async {
    state = const AuthSigningIn();

    // A previous account's sign-out still pending on this device goes first, so its session
    // (and push binding) is ended before the new one exists. Best effort, bounded, never
    // throws: it can delay a sign-in by a few seconds at most and never prevent one.
    await _pendingSignOut?.flushBeforeSignIn();

    try {
      final session = await _repository.signIn(
        username: username,
        password: password,
        remember: remember,
      );
      await _tokens.write(session);

      final fetched = await _repository.currentUser();
      // PD-58: `/me` and the token pair carry the same block; the pair's stands in only
      // when `/me` has none.
      final principal = fetched.legal == null && session.legal != null ? fetched.withLegal(session.legal) : fetched;
      _adopt(principal);
      state = AuthAuthenticated(principal);
    } catch (thrown) {
      // Anything, not only an AppError: a keychain that refuses the write is just as able to
      // leave this state at AuthSigningIn -- a sign-in button spinning forever -- as a refusal.
      final error = thrown is AppError
          ? thrown
          : AppError(AppErrorKind.unknown, debugDetail: thrown.runtimeType.toString());
      // Never log the attempted credentials, and never echo the raw server body.
      _logger.warn('sign-in failed', data: {'kind': error.kind.name});
      // A principal the app cannot act as was still issued a real session (tokens are
      // already stored): end it on the server before the tokens are forgotten.
      if (AuthFailures.refusesPrincipal(error.code)) await _logoutBestEffort();
      // The same teardown a session ending performs, not just the tokens. A failed sign-in
      // must not be able to leave a principal adopted by the transport or a revocation watch
      // running: the router makes that unreachable today, and a controller whose safety
      // depends on which screen happens to call it is not a controller anybody can reuse.
      await _clearSessionArtifacts();
      state = AuthSignedOut(
        reason: AuthSignedOut.reasonFor(error),
        error: error,
      );
    }
  }

  /// The one sign-out path.
  ///
  /// [serverAlreadyEnded] is for a session the server has ALREADY ended at this user's own
  /// request -- PD-23's "sign out" of this device from Devices & sessions. `/auth/logout`
  /// would then be refused as revoked, and that refusal would arrive here as a
  /// "your session was revoked" sign-out the user did not need to be told about. Everything
  /// local is cleared exactly as for any other sign-out.
  Future<void> signOut({bool serverAlreadyEnded = false}) async {
    if (serverAlreadyEnded) {
      await _endSession(SignedOutReason.none);
      return;
    }
    await _endServerSession('sign-out call failed');
    await _endSession(SignedOutReason.none);
  }

  /// `POST /auth/logout` for the session about to be cleared locally. Never throws and never
  /// blocks the local sign-out. When the server gave no verdict (offline, a 5xx), the session
  /// is handed to [_pendingSignOut] BEFORE the tokens are cleared, to be ended later.
  Future<void> _endServerSession(String failureLog) async {
    _recordedPending = null;
    var outcome = SignOutOutcome.ended;
    try {
      final repository = _repository;
      if (repository is SignOutReporting) {
        outcome = await repository.signOutReporting();
      } else {
        await repository.signOut();
      }
    } catch (error) {
      // A failed sign-out call must not strand the user signed in locally -- whatever it
      // threw.
      _logger.warn(failureLog, data: {
        'kind': error is AppError ? error.kind.name : error.runtimeType.toString(),
      });
      if (error is AppError && error.isTransient) outcome = SignOutOutcome.unreached;
    }

    final pending = _pendingSignOut;
    if (outcome != SignOutOutcome.unreached || pending == null) return;
    try {
      // Read AFTER the call: an expired access token was renewed (rotated) on the way, and
      // only the successor is still worth anything.
      final session = await _tokens.read();
      if (session != null) {
        await pending.add(session);
        _recordedPending = session.refreshToken;
      }
    } catch (error) {
      _logger.warn('pending sign-out not recorded', data: {'type': error.runtimeType.toString()});
    }
  }

  /// Re-read the authenticated principal from the backend.
  ///
  /// Exists because the teacher can now rename themselves, and the name every
  /// other screen renders comes from THIS state. Without a re-read, Settings and
  /// every participant list would keep showing the old name until the app
  /// restarted.
  ///
  /// Deliberately not a mutation: it asks the server who the user is and adopts
  /// the answer. Nothing here is told what the new name is, so this cannot
  /// publish a name the server did not store. A failure leaves the session
  /// alone -- a flaky network must not sign anyone out -- except for a terminal
  /// refusal, which is a session ending and goes down the one path for that.
  Future<void> refreshIdentity() async {
    if (state is! AuthAuthenticated) return;
    final seq = _legalSeq;

    try {
      final fetched = await _repository.currentUser();
      // PD-58: the block now held stands when this answer has none (it says nothing new, so
      // it never lifts a gate already standing) and when a newer block was adopted while this
      // request was out (the answer is stale, B1). Fail closed both ways.
      final known = state.user?.legal;
      final stale = _legalSeq != seq;
      final principal = (fetched.legal == null || stale) && known != null ? fetched.withLegal(known) : fetched;
      // A sign-out while this was in flight wins: the answer was about a session now over.
      if (state is! AuthAuthenticated || state.user?.id != principal.id) return;
      state = AuthAuthenticated(principal);
      _onPrincipal?.call(principal);
    } on AppError catch (error) {
      if (error.terminatesSession) {
        await _endSession(AuthSignedOut.reasonFor(error));
      } else {
        _logger.warn('identity refresh failed', data: {'kind': error.kind.name});
      }
    }
  }

  /// PD-58: what the server now says this account must accept -- from `GET /me/legal`, the
  /// accept answer, or a token pair. Replaces the principal's block; nothing else changes.
  /// Ignored when nobody is signed in. An unchanged block (every token refresh carries one)
  /// leaves the state alone, so nothing that watches the session rebuilds -- but it still
  /// counts as the newest answer for [refreshIdentity].
  void adoptLegal(LegalStatus legal) {
    final current = state;
    if (current is! AuthAuthenticated) return;
    _legalSeq++;
    if (current.principal.legal == legal) return;
    state = AuthAuthenticated(current.principal.withLegal(legal));
  }

  /// PD-58: a 403 `COMM.TERMS_NOT_ACCEPTED` from any route. The refusal's own
  /// `detail.required` puts the gate up at once (fail closed, even if that refusal is old);
  /// then the identity is re-read, which is the answer that stands. A refusal arriving while
  /// a re-read is out queues one more after it -- at most one -- so a fresh `/me` always has
  /// the last word: a burst asks `/me` at most twice.
  Future<void> onTermsNotAccepted(AppError error) {
    if (state is! AuthAuthenticated) return Future.value();
    final detail = LegalDocument.listFromWire(error.detail?['required']);
    if (detail != null && detail.isNotEmpty) {
      adoptLegal(LegalStatus(state: LegalState.required, required: List.unmodifiable(detail)));
    }
    final inFlight = _termsCheck;
    if (inFlight == null) return _startTermsCheck();
    // Runs however the re-read ended -- an error included -- so the queue always clears.
    return _termsQueued ??= inFlight.catchError((Object _) {}).whenComplete(() => _termsQueued = null).then((_) => _startTermsCheck());
  }

  /// One re-read for the Terms of Use. It never fails to its caller: the refusal was the
  /// transport's (`LegalWire.refused` does not await it), so an error here -- even one that
  /// is not an [AppError], which [refreshIdentity] lets through -- would be uncaught.
  Future<void> _startTermsCheck() => _termsCheck = _termsReread().whenComplete(() => _termsCheck = null);

  Future<void> _termsReread() async {
    try {
      await refreshIdentity();
    } catch (error) {
      _logger.warn('terms re-read failed', data: {'type': error.runtimeType.toString()});
    }
  }

  /// `POST /auth/logout` for a session about to be dropped locally. Never throws and never
  /// blocks the sign-out: a session the client can no longer name expires on its own.
  Future<void> _logoutBestEffort() => _endServerSession('logout of a refused session failed');

  /// Called when any layer observes that the backend has ended this session.
  Future<void> onSessionEnded(AppError error) =>
      _endSession(AuthSignedOut.reasonFor(error));

  void _adopt(AuthUser principal) {
    _onPrincipal?.call(principal);
    _watchRevocation();
  }

  void _watchRevocation() {
    _revocationWatch?.cancel();
    _revocationWatch = _repository.sessionRevoked.listen((_) {
      unawaited(_endSession(SignedOutReason.sessionRevoked));
    });
  }

  /// Ends the session. The ONE authoritative path: every terminal outcome — a refusal seen
  /// by the transport, a revocation pushed from the backend, a failed restore, a deliberate
  /// sign-out — arrives here.
  ///
  /// Idempotent in both directions. Concurrent callers are absorbed by [_ending]; a later
  /// caller finding the session already over is dropped, which also means the FIRST reason
  /// wins. That is deliberate: if a revocation and a disabled-account refusal land together,
  /// the one that actually ended the session is the one the user should be told about.
  Future<void> _endSession(SignedOutReason reason) async {
    if (_ending || state is AuthSignedOut) return;
    _ending = true;

    try {
      await _clearSessionArtifacts();
      state = AuthSignedOut(reason: reason);
    } finally {
      _ending = false;
    }
  }

  /// Everything destructive, in one place, so no caller can perform half of it.
  ///
  /// Every step runs even when an earlier one throws, and none of them can stop the caller
  /// from reaching the signed-out state. A keychain that refuses the delete must not leave a
  /// revoked user looking at protected screens; the failure is logged instead.
  Future<void> _clearSessionArtifacts() async {
    // Fire-and-forget: dropping the reference is what stops the events, and awaiting a
    // cancel can block until the source stream closes.
    unawaited(_revocationWatch?.cancel());
    _revocationWatch = null;

    final recorded = _recordedPending;
    _recordedPending = null;
    try {
      await _tokens.clear();
    } catch (error) {
      _logger.warn('session cleanup step failed', data: {
        'step': 'tokens',
        'type': error.runtimeType.toString(),
      });
      // The live store still holds the session just recorded as pending. Two holders of one
      // refresh token -- the next launch's restore and the retrier -- would each refresh it,
      // and the second is a reuse that revokes every session on the account. The live store
      // keeps it; the pending entry goes.
      if (recorded != null) await _pendingSignOut?.withdraw(recorded);
    }

    for (final (step, run) in [
      ('local data', _clearLocalData),
      ('principal', _onSessionCleared ?? () async {}),
    ]) {
      try {
        await run();
      } catch (error) {
        _logger.warn('session cleanup step failed', data: {
          'step': step,
          'type': error.runtimeType.toString(),
        });
      }
    }
  }
}
