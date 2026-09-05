/// The closed set of failures the UI knows how to talk about.
///
/// Mapping every transport/HTTP detail down to this taxonomy is what lets §55 ("every major
/// screen needs loading / empty / error / retry") and §37 ("give understandable error
/// messages, do not expose internal technical stack traces") both hold.
enum AppErrorKind {
  /// No usable connectivity, or the request never reached the server.
  network,

  /// The server took too long.
  timeout,

  /// Not authenticated, or the access token is no longer valid.
  unauthenticated,

  /// The session was revoked from another device or by an administrator.
  sessionRevoked,

  /// The account has been disabled. Distinct from [unauthenticated] because the user must
  /// not be invited to simply try again.
  accountDisabled,

  /// The backend refused the action on policy grounds — for example a teacher attempting a
  /// 1:1 with a parent. Never retried, never worked around.
  forbidden,

  /// The target no longer exists, or was archived/deleted.
  notFound,

  /// The request was malformed or rejected by validation.
  validation,

  /// Too many requests.
  rateLimited,

  /// The server failed.
  server,

  /// Anything not otherwise classified.
  unknown,
}

/// A failure that is safe to show to a user.
///
/// [debugDetail] is intentionally kept out of anything user-visible and out of logs that
/// could contain tokens or message bodies (§56).
class AppError implements Exception {
  const AppError(
    this.kind, {
    this.code,
    this.debugDetail,
  });

  final AppErrorKind kind;

  /// Stable machine-readable code from the backend, when it supplies one. Used to pick a
  /// specific message; never displayed raw.
  final String? code;

  final String? debugDetail;

  /// Whether retrying the very same request could plausibly succeed.
  ///
  /// Note this describes the *error*, not the request: a non-idempotent request must not be
  /// auto-retried even when this is true, unless it carries an idempotency key (§48).
  bool get isTransient => switch (kind) {
        AppErrorKind.network ||
        AppErrorKind.timeout ||
        AppErrorKind.rateLimited ||
        AppErrorKind.server =>
          true,
        _ => false,
      };

  /// Whether this error means the local session is finished and the user must be returned
  /// to login with sensitive state cleared (§7).
  bool get terminatesSession => switch (kind) {
        AppErrorKind.unauthenticated ||
        AppErrorKind.sessionRevoked ||
        AppErrorKind.accountDisabled =>
          true,
        _ => false,
      };

  @override
  String toString() => 'AppError(${kind.name}${code == null ? '' : ', $code'})';
}
