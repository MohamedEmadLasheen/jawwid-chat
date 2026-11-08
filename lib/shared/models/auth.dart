import 'legal.dart';
import 'user_role.dart';

/// Failures the *client* decides, as opposed to the `AUTH.*` codes the backend sends.
///
/// They live here, beside the models they refuse to build, so that the domain and the
/// presentation layer can both name them without either importing the HTTP repository.
abstract final class AuthFailures {
  /// The credentials were good, but this principal cannot use the mobile app.
  ///
  /// `ActorDto.kind` is one of `contact | staff | teacher | system`, and [UserRole] models
  /// `parent | teacher | sales`. Of staff, only the Sales department may (PD-20); every
  /// other staff member belongs in the Jawwid console. An unrecognised kind lands here too:
  /// failing closed on a value this build has never heard of is the only safe direction,
  /// since the alternative is to guess a role and hand someone a screen.
  static const roleNotSupported = 'auth_role_not_supported';

  /// PD-40 (plan §8): a department `specialist` whose `/me` holds no `chat.use`. It works in
  /// Admin Web only; every chat request would be refused, so it is told so, by name, instead
  /// of the generic [roleNotSupported].
  static const usesAdminWeb = 'auth_uses_admin_web';

  /// A principal this app refuses after a good sign-in -- a session was issued, so it is
  /// ended on the server before the tokens are forgotten.
  static bool refusesPrincipal(String? code) => code == roleNotSupported || code == usesAdminWeb;

  /// A build with no session registry wired (PD-23's `GET /me/sessions` family). The client
  /// says so rather than fabricating a list of devices.
  static const sessionsNotSupported = 'auth_sessions_not_supported';
}

/// Tokens for the current session. Held in secure storage only; never written to the
/// ordinary preference store, never logged, and never persisted alongside cached content.
class AuthSession {
  const AuthSession({
    required this.accessToken,
    required this.refreshToken,
    required this.accessTokenExpiresAt,
    this.remembered,
    this.legal,
  });

  final String accessToken;
  final String refreshToken;
  final DateTime accessTokenExpiresAt;

  /// PD-23 `session.remembered`, as a LOGIN answered it: "keep me signed in" is in effect.
  /// Null for a refresh, which never changes where the session is kept. Only the PD-28
  /// browser store reads it (localStorage when true, sessionStorage otherwise); the phone
  /// keeps every session in the Keychain / Keystore.
  final bool? remembered;

  /// PD-58: the token pair's `legal` block (login, refresh, password change), when the
  /// server sent one. Never stored with the tokens: it is the server's answer of the moment.
  final LegalStatus? legal;

  /// Treat the token as expired slightly early so a request does not race the expiry.
  bool isExpired(DateTime now, {Duration skew = const Duration(seconds: 30)}) =>
      !now.isBefore(accessTokenExpiresAt.subtract(skew));

  /// Never include token material in diagnostics.
  @override
  String toString() => 'AuthSession(expiresAt: $accessTokenExpiresAt)';
}

/// The authenticated principal, as asserted by the backend.
///
/// Note there is no phone number field, by design — §5 makes it unrenderable, so the client
/// does not model it at all and cannot leak what it never holds.
class AuthUser {
  const AuthUser({
    required this.id,
    required this.displayName,
    required this.role,
    this.avatarUrl,
    this.locale,
    this.timeZone,
    this.isSuperAdmin = false,
    this.legal,
  });

  final String id;
  final String displayName;
  final UserRole role;
  final String? avatarUrl;

  /// BCP-47 tag, when the backend holds a preference for this user.
  final String? locale;

  /// IANA zone. Cairo is the product default when absent (§46).
  final String? timeZone;

  /// PD-20 amendment: the organization's super admin, signed in with the Sales tabs.
  /// Only ever true together with [UserRole.sales].
  final bool isSuperAdmin;

  /// PD-58: what this account must still accept (`GET /me`'s `legal`). Null when the server
  /// sends no block at all -- the API before ENG-10 -- and then no gate is shown.
  final LegalStatus? legal;

  /// The same principal with another [legal] block; everything else unchanged.
  AuthUser withLegal(LegalStatus? legal) => AuthUser(
        id: id,
        displayName: displayName,
        role: role,
        avatarUrl: avatarUrl,
        locale: locale,
        timeZone: timeZone,
        isSuperAdmin: isSuperAdmin,
        legal: legal,
      );

  bool get isParent => role == UserRole.parent;
  bool get isTeacher => role == UserRole.teacher;
  bool get isSales => role == UserRole.sales;

  @override
  String toString() => 'AuthUser(${role.name})';
}
