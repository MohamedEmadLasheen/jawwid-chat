import 'dart:async';

import '../../../shared/models/auth.dart';
import '../../../shared/models/user_role.dart';
import '../../errors/app_error.dart';
import '../../network/api_client.dart';
import '../repositories.dart';

/// `AuthRepository` over the Phase 1 authentication contract.
///
/// This replaces the `UnavailableAuthRepository` placeholder, which existed
/// because there was no contract to implement. There is now: Phase 1 shipped
/// `apps/api/src/platform/auth/auth.controller.ts`, and the five things this
/// client needs are all there.
///
/// | Method | Path | Notes |
/// |---|---|---|
/// | POST | `/auth/login` | `{subject, password, device}` → tokens + actor |
/// | POST | `/auth/refresh` | `{refreshToken}` → tokens + actor |
/// | POST | `/auth/logout` | ends THIS device's session only |
/// | GET | `/me` | the server-asserted principal |
/// | GET | `/me/sessions` | this account's devices |
/// | DELETE | `/me/sessions/:id` | revoke one, scoped to me by the server |
///
/// ## Two things this deliberately does not do
///
/// **It does not infer the role.** `/me` returns `kind` (`contact` / `teacher`
/// / `staff`) and the app maps it. A `staff` principal maps to no [UserRole],
/// and signing in as one fails here with a specific error rather than being
/// quietly treated as a parent — the mobile app is the family and teacher
/// client, and an admin belongs in the console.
///
/// **It does not persist anything.** [AuthController] owns the session and the
/// token store; this is transport.
class HttpAuthRepository implements AuthRepository {
  HttpAuthRepository({required ApiClient client, required DeviceDescriptor device})
      : _client = client,
        _device = device;

  final ApiClient _client;

  /// Identifies this installation so the backend's device registry and the
  /// "log out that phone" flow have something to name.
  final DeviceDescriptor _device;

  /// Emits when a caller observes that the backend has ended this session.
  ///
  /// The signal comes from the transport, not from a poll: `ApiClient` calls
  /// `TokenProvider.onSessionEnded` the moment a refresh fails or a replayed
  /// request is rejected again, and bootstrap routes that here. Polling `/me`
  /// on a timer would be slower, noisier, and still miss the window.
  final _revoked = StreamController<void>.broadcast();

  @override
  Stream<void> get sessionRevoked => _revoked.stream;

  /// Called by the transport when the session is over.
  void notifyRevoked() {
    if (!_revoked.isClosed) _revoked.add(null);
  }

  void dispose() => _revoked.close();

  @override
  Future<AuthSession> signIn({
    required String username,
    required String password,
  }) async {
    final response = await _client.post<Map<String, Object?>>(
      '/auth/login',
      // `subject`, not `email`: chat.account holds no contact channel by design
      // (BR-2), so the login identifier is an opaque subject. Sending an e-mail
      // address here would be sending a field the server has nowhere to put.
      data: {
        'subject': username,
        'password': password,
        'device': _device.toJson(),
      },
    );
    return _sessionFrom(response.data);
  }

  @override
  Future<AuthSession> refresh(String refreshToken) async {
    final response = await _client.post<Map<String, Object?>>(
      '/auth/refresh',
      data: {'refreshToken': refreshToken, 'device': _device.toJson()},
    );
    return _sessionFrom(response.data);
  }

  @override
  Future<AuthUser> currentUser() async {
    final response = await _client.get<Map<String, Object?>>('/me');
    return _userFrom(response.data);
  }

  @override
  Future<void> signOut() async {
    try {
      await _client.post<Map<String, Object?>>('/auth/logout');
    } on AppError catch (error) {
      // Sign-out must not fail: the local session is cleared regardless, and
      // throwing would strand a user signed in on their own device. An already
      // invalid session is the expected case here, not an error.
      if (!error.terminatesSession) rethrow;
    }
  }

  @override
  Future<List<DeviceSession>> devices() async {
    final response = await _client.get<Map<String, Object?>>('/me/sessions');
    final rows = (response.data?['sessions'] as List?) ?? const [];

    return [
      for (final row in rows)
        if (row is Map<String, Object?>)
          DeviceSession(
            id: (row['id'] as String?) ?? '',
            // A device the user can recognise. Never an internal id.
            label: (row['displayName'] as String?) ?? _platformLabel(row['platform']),
            platform: (row['platform'] as String?) ?? 'unknown',
            lastSeenAt:
                DateTime.tryParse((row['lastSeenAt'] ?? row['createdAt']) as String? ?? '')
                        ?.toLocal() ??
                    DateTime.now(),
            isCurrent: row['current'] == true,
          ),
    ];
  }

  @override
  Future<void> revokeDevice(String deviceId) async {
    // Scoped to this account by the SERVER: the account id is part of its
    // query, not a check after the fact, so naming somebody else's session
    // matches no row.
    await _client.delete<Map<String, Object?>>('/me/sessions/$deviceId');
  }

  // ------------------------------------------------------------------------

  static String _platformLabel(Object? platform) => switch (platform) {
        'ios' => 'iPhone',
        'android' => 'Android',
        'web' => 'Web',
        _ => 'Device',
      };

  AuthSession _sessionFrom(Map<String, Object?>? data) {
    final access = data?['accessToken'] as String?;
    final refreshToken = data?['refreshToken'] as String?;
    final expiresIn = (data?['expiresIn'] as num?)?.toInt();

    if (access == null || access.isEmpty || refreshToken == null || refreshToken.isEmpty) {
      throw const AppError(
        AppErrorKind.server,
        code: 'malformed_auth_response',
        debugDetail: 'login/refresh response carried no token pair',
      );
    }

    return AuthSession(
      accessToken: access,
      refreshToken: refreshToken,
      // The server sends a lifetime, not an instant, so the expiry cannot be
      // thrown off by a device clock that disagrees with the server's.
      accessTokenExpiresAt: DateTime.now().add(
        Duration(seconds: expiresIn ?? 900),
      ),
    );
  }

  AuthUser _userFrom(Map<String, Object?>? data) {
    final actorId = data?['actorId'] as String?;
    if (actorId == null || actorId.isEmpty) {
      throw const AppError(
        AppErrorKind.server,
        code: 'malformed_principal_response',
        debugDetail: '/me carried no actorId',
      );
    }

    final role = roleForActorKind(data?['kind'] as String?);
    if (role == null) {
      // A staff principal authenticating against the family/teacher app. The
      // credentials are valid, so this is not an authentication failure — it is
      // the wrong app, and saying so is more useful than a generic refusal.
      throw const AppError(
        AppErrorKind.forbidden,
        code: 'wrong_application_for_role',
        debugDetail: 'this principal is not a family contact or a teacher',
      );
    }

    return AuthUser(
      id: actorId,
      displayName: (data?['displayName'] as String?) ?? '',
      role: role,
      locale: data?['locale'] as String?,
    );
  }
}

/// Maps the backend's actor kind to the role this app can authenticate as.
///
/// Returns null for `staff` and `system`, which this client deliberately cannot
/// represent: [UserRole] has two values, and widening it so the family app
/// could hold an admin session would make every role-dependent branch in the
/// UI answerable for a case that must never reach it.
UserRole? roleForActorKind(String? kind) => switch (kind) {
      'contact' => UserRole.parent,
      'teacher' => UserRole.teacher,
      _ => null,
    };

/// What this installation tells the backend about itself.
///
/// Deliberately small: a stable per-install key, the platform, and a name the
/// user would recognise in a session list. No advertising identifier, no serial
/// number, nothing that identifies the hardware beyond what "which of my
/// devices is this?" requires.
class DeviceDescriptor {
  const DeviceDescriptor({
    required this.clientKey,
    required this.platform,
    this.appVersion,
    this.displayName,
  });

  final String clientKey;
  final String platform;
  final String? appVersion;
  final String? displayName;

  Map<String, Object?> toJson() => {
        'clientKey': clientKey,
        'platform': platform,
        if (appVersion != null) 'appVersion': appVersion,
        if (displayName != null) 'displayName': displayName,
      };
}
