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
  Future<void> restore() async {
    final stored = await _tokens.read();
    if (stored == null) {
      state = const AuthSignedOut();
      return;
    }

    try {
      final principal = await _repository.currentUser();
      _adopt(principal);
      state = AuthAuthenticated(principal);
    } on AppError catch (error) {
      if (error.terminatesSession || error.code == AuthFailures.roleNotSupported) {
        await _endSession(AuthSignedOut.reasonFor(error));
      } else {
        // A network failure at launch is not a sign-out. Keep the stored session and let
        // the user retry, rather than throwing away a working login because the café wifi
        // was down (§51).
        state = const AuthSignedOut();
      }
    }
  }

  Future<void> signIn({required String username, required String password}) async {
    state = const AuthSigningIn();

    try {
      final session = await _repository.signIn(
        username: username,
        password: password,
      );
      await _tokens.write(session);

      final principal = await _repository.currentUser();
      _adopt(principal);
      state = AuthAuthenticated(principal);
    } on AppError catch (error) {
      // Never log the attempted credentials, and never echo the raw server body.
      _logger.warn('sign-in failed', data: {'kind': error.kind.name});
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

  Future<void> signOut() async {
    try {
      await _repository.signOut();
    } on AppError catch (error) {
      // A failed sign-out call must not strand the user signed in locally.
      _logger.warn('sign-out call failed', data: {'kind': error.kind.name});
    }
    await _endSession(SignedOutReason.none);
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
  Future<void> _clearSessionArtifacts() async {
    await _revocationWatch?.cancel();
    _revocationWatch = null;

    await _tokens.clear();
    await _clearLocalData();
    await _onSessionCleared?.call();
  }
}
