import 'user_role.dart';

/// Tokens for the current session. Held in secure storage only; never written to the
/// ordinary preference store, never logged, and never persisted alongside cached content.
class AuthSession {
  const AuthSession({
    required this.accessToken,
    required this.refreshToken,
    required this.accessTokenExpiresAt,
  });

  final String accessToken;
  final String refreshToken;
  final DateTime accessTokenExpiresAt;

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
  });

  final String id;
  final String displayName;
  final UserRole role;
  final String? avatarUrl;

  /// BCP-47 tag, when the backend holds a preference for this user.
  final String? locale;

  /// IANA zone. Cairo is the product default when absent (§46).
  final String? timeZone;

  bool get isParent => role == UserRole.parent;
  bool get isTeacher => role == UserRole.teacher;

  @override
  String toString() => 'AuthUser(${role.name})';
}
