import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/data/repositories.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/logging/redacting_logger.dart';
import '../../../core/storage/secure_token_store.dart';
import '../../../shared/models/auth.dart';
import '../domain/auth_state.dart';
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
    RedactingLogger logger = const RedactingLogger(),
  })  : _repository = repository,
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

  final RedactingLogger _logger;

  StreamSubscription<void>? _revocationWatch;

  /// Guards the destructive path against a burst of terminal signals — ten requests can each
  /// receive `AUTH.SESSION_REVOKED` from one revocation, and they must produce one clean
  /// signed-out state between them, not ten.
  bool _ending = false;

  @override
  AuthState build() {
    _termination?.bind(onSessionEnded);
    ref.onDispose(() {
      _termination?.unbind(onSessionEnded);
      _revocationWatch?.cancel();
    });
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
      if (error.code == AuthFailures.roleNotSupported) {
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

    try {
      final session = await _repository.signIn(
        username: username,
        password: password,
        remember: remember,
      );
      await _tokens.write(session);

      final principal = await _repository.currentUser();
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
      if (error.code == AuthFailures.roleNotSupported) await _logoutBestEffort();
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
    try {
      await _repository.signOut();
    } catch (error) {
      // A failed sign-out call must not strand the user signed in locally -- whatever it
      // threw.
      _logger.warn('sign-out call failed', data: {
        'kind': error is AppError ? error.kind.name : error.runtimeType.toString(),
      });
    }
    await _endSession(SignedOutReason.none);
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

    try {
      final principal = await _repository.currentUser();
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

  /// `POST /auth/logout` for a session about to be dropped locally. Never throws and never
  /// blocks the sign-out: a session the client can no longer name expires on its own.
  Future<void> _logoutBestEffort() async {
    try {
      await _repository.signOut();
    } catch (error) {
      _logger.warn('logout of a refused session failed', data: {
        'kind': error is AppError ? error.kind.name : error.runtimeType.toString(),
      });
    }
  }

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

    for (final (step, run) in [
      ('tokens', _tokens.clear),
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
