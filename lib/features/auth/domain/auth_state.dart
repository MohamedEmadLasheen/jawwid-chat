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

  /// The account is temporarily locked after repeated failed attempts. It unlocks by itself,
  /// which is the one thing that makes it different from [accountDisabled] to the person
  /// standing in front of the screen.
  accountLocked,

  /// The credentials were correct, but this principal is not one the mobile app can act as
  /// (staff, system, or a kind this build does not recognise). Telling the user to check
  /// their password would send them round a loop they cannot exit.
  roleNotSupported,

  /// PD-40 (plan §8): a department specialist with no chat access. Its account works in Admin
  /// Web, and the sign-in screen says that, instead of "this account cannot sign in".
  usesAdminWeb,
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

  /// [AppErrorKind.invalidCredentials] maps to [SignedOutReason.sessionExpired] on purpose,
  /// and the screen tells the two apart by whether [error] is set: a *reason* arrives with no
  /// error, a failed *attempt* arrives with one. That distinction already existed and is
  /// already tested; adding a fifth reason to say the same thing would leave two ways to
  /// express one state.
  static SignedOutReason reasonFor(AppError error) {
    // Checked ahead of the kind: the *kind* of a refused principal is an ordinary
    // `forbidden`, and only the code says which forbidden thing happened.
    if (error.code == AuthFailures.roleNotSupported) {
      return SignedOutReason.roleNotSupported;
    }
    if (error.code == AuthFailures.usesAdminWeb) {
      return SignedOutReason.usesAdminWeb;
    }
    return switch (error.kind) {
      AppErrorKind.accountDisabled => SignedOutReason.accountDisabled,
      AppErrorKind.accountLocked => SignedOutReason.accountLocked,
      AppErrorKind.sessionRevoked => SignedOutReason.sessionRevoked,
      AppErrorKind.unauthenticated ||
      AppErrorKind.invalidCredentials => SignedOutReason.sessionExpired,
      _ => SignedOutReason.none,
    };
  }
}

/// A session is stored, but the server could not be reached to confirm it at launch.
///
/// Deliberately NOT [AuthSignedOut]: the tokens are kept, and nothing here says the session
/// is over. Before this state existed an offline launch landed on the sign-in screen looking
/// exactly like a sign-out, with no way back but typing the password again -- and the stored
/// session, still perfectly valid, sitting unused behind it.
///
/// It is not authenticated either, so the router keeps every protected screen out of reach
/// until the backend has vouched for the principal (§7).
class AuthUnreachable extends AuthState {
  const AuthUnreachable({this.retrying = false, this.error});

  /// A retry is in flight; the screen shows progress instead of a second button.
  final bool retrying;

  /// What the last attempt ran into, for the message. Always a transient kind.
  final AppError? error;
}

class AuthSigningIn extends AuthState {
  const AuthSigningIn();
}

class AuthAuthenticated extends AuthState {
  const AuthAuthenticated(this.principal);

  final AuthUser principal;
}
