import '../../../core/errors/app_error.dart';
import '../../../shared/models/auth.dart';

/// Why the user is at the sign-in screen. Drives whether an explanatory message is shown
/// on arrival (§7, §9).
enum SignedOutReason {
  /// First launch, or an ordinary sign-out.
  none,

  /// The refresh token expired or was rejected.
  sessionExpired,

  /// Revoked from another device or by an administrator.
  sessionRevoked,

  /// The account was disabled server-side.
  accountDisabled,
}

/// The authentication state machine.
///
/// [AuthUnknown] is the state during launch, while the stored session is being read. Routing
/// must treat it as "decide nothing yet" rather than as signed out, or the app flashes the
/// login screen on every cold start.
sealed class AuthState {
  const AuthState();

  bool get isAuthenticated => this is AuthAuthenticated;

  AuthUser? get user => switch (this) {
        final AuthAuthenticated state => state.principal,
        _ => null,
      };
}

class AuthUnknown extends AuthState {
  const AuthUnknown();
}

class AuthSignedOut extends AuthState {
  const AuthSignedOut({this.reason = SignedOutReason.none, this.error});

  final SignedOutReason reason;

  /// Present when sign-in itself failed, as opposed to a session ending.
  final AppError? error;

  static SignedOutReason reasonFor(AppError error) => switch (error.kind) {
        AppErrorKind.accountDisabled => SignedOutReason.accountDisabled,
        AppErrorKind.sessionRevoked => SignedOutReason.sessionRevoked,
        AppErrorKind.unauthenticated => SignedOutReason.sessionExpired,
        _ => SignedOutReason.none,
      };
}

class AuthSigningIn extends AuthState {
  const AuthSigningIn();
}

class AuthAuthenticated extends AuthState {
  const AuthAuthenticated(this.principal);

  final AuthUser principal;
}
