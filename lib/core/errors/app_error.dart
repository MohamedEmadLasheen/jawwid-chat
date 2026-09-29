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

  /// Not authenticated, or the access token is no longer valid. This is the ONE auth
  /// failure a refresh can answer; every other one below is terminal.
  unauthenticated,

  /// The username and password did not match. Distinct from [unauthenticated] because it is
  /// a *login* failure, not a session failure: there is no session to refresh and none to
  /// end, so treating it as [unauthenticated] made a mistyped password spend a refresh and
  /// emit a session-ended event for a session that never existed.
  invalidCredentials,

  /// The session was revoked from another device or by an administrator.
  sessionRevoked,

  /// The account has been disabled. Distinct from [unauthenticated] because the user must
  /// not be invited to simply try again.
  accountDisabled,

  /// The account is temporarily locked after repeated failed attempts. Distinct from
  /// [accountDisabled] (which an administrator must undo) and from [invalidCredentials]
  /// (which the user can simply correct): this one ends by itself, and saying so is the only
  /// truthful thing to tell someone who is locked out.
  accountLocked,

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
  const AppError(this.kind, {this.code, this.debugDetail, this.retryAfter});

  final AppErrorKind kind;

  /// Stable machine-readable code from the backend, when it supplies one. Used to pick a
  /// specific message; never displayed raw.
  final String? code;

  final String? debugDetail;

  /// How long the server asked the caller to wait, from the `Retry-After` header. Present
  /// only on [AppErrorKind.rateLimited]. The backend puts this in a header rather than the
  /// body on purpose -- a per-account countdown in a response body would leak which accounts
  /// are under attack -- so it would be lost entirely if it were not carried here.
  final Duration? retryAfter;

  /// Whether retrying the very same request could plausibly succeed.
  ///
  /// Note this describes the *error*, not the request: a non-idempotent request must not be
  /// auto-retried even when this is true, unless it carries an idempotency key (§48).
  bool get isTransient => switch (kind) {
    AppErrorKind.network ||
    AppErrorKind.timeout ||
    AppErrorKind.rateLimited ||
    AppErrorKind.server => true,
    _ => false,
  };

  /// Whether this error means the local session is finished and the user must be returned
  /// to login with sensitive state cleared (§7).
  /// Note [AppErrorKind.invalidCredentials] is deliberately absent: a failed sign-in is not
  /// a session ending, and treating it as one clears whatever session the user still had.
  bool get terminatesSession => switch (kind) {
    AppErrorKind.unauthenticated ||
    AppErrorKind.sessionRevoked ||
    AppErrorKind.accountDisabled ||
    AppErrorKind.accountLocked => true,
    _ => false,
  };

  /// Whether a token refresh could plausibly answer this failure.
  ///
  /// Only [AppErrorKind.unauthenticated] qualifies. A revoked session, a disabled account
  /// and a locked account will each refuse the refresh identically, and presenting a refresh
  /// token to answer them is how a client burns its last credential for nothing -- worse,
  /// the backend rotates refresh tokens and treats a replayed one as theft.
  bool get isRefreshable => kind == AppErrorKind.unauthenticated;

  @override
  String toString() => 'AppError(${kind.name}${code == null ? '' : ', $code'})';
}
