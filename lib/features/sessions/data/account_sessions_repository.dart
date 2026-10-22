import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/app_error.dart';
import '../../../core/network/api_client.dart';
import '../../../shared/models/auth.dart';
import '../domain/account_session.dart';

/// PD-23: the signed-in account's own sessions ("Devices & sessions").
///
/// Every call is authenticated and goes over the app's ONE [ApiClient] -- the one that
/// refreshes through the one `StoredTokenProvider`. Never `AuthTransport`, and never a
/// second token provider: refresh rotation makes a second refresher on this device an
/// account-wide sign-out (docs/mobile/http-integration.md §4).
abstract interface class AccountSessionsRepository {
  /// `GET /me/sessions`, current first then most recently used.
  Future<List<AccountSession>> list();

  /// `POST /me/sessions/{id}/revoke`. Revoking the CURRENT session ends this device's
  /// sign-in; the caller is responsible for ending the session locally afterwards.
  Future<void> revoke(String sessionId);

  /// `POST /me/sessions/revoke-others`. Returns how many sessions the server ended.
  Future<int> revokeOthers();
}

/// The build with no session registry. Fails loudly rather than inventing a list: a
/// fabricated list of devices is worse than none, because a user would act on it.
class NoAccountSessionsRepository implements AccountSessionsRepository {
  const NoAccountSessionsRepository();

  static const _unavailable = AppError(
    AppErrorKind.notFound,
    code: AuthFailures.sessionsNotSupported,
    debugDetail: 'No session registry is wired into this build.',
  );

  @override
  Future<List<AccountSession>> list() async => throw _unavailable;

  @override
  Future<void> revoke(String sessionId) async => throw _unavailable;

  @override
  Future<int> revokeOthers() async => throw _unavailable;
}

/// Registered by both composition roots: HTTP for a real build, the in-memory fake for the
/// fixture build. The default refuses.
final accountSessionsRepositoryProvider = Provider<AccountSessionsRepository>(
  (ref) => const NoAccountSessionsRepository(),
);

/// Over the published PD-23 routes.
class HttpAccountSessionsRepository implements AccountSessionsRepository {
  HttpAccountSessionsRepository({required ApiClient client}) : _client = client;

  final ApiClient _client;

  @override
  Future<List<AccountSession>> list() async {
    final body = (await _client.get<Map<String, Object?>>('/me/sessions')).data;
    final rows = body?['sessions'];
    if (rows is! List) {
      throw const AppError(
        AppErrorKind.server,
        debugDetail: 'GET /me/sessions carried no sessions list',
      );
    }
    return orderSessions([
      for (final raw in rows)
        if (raw is Map) ?sessionFrom(raw),
    ]);
  }

  @override
  Future<void> revoke(String sessionId) async {
    await _client.post<Map<String, Object?>>(
      '/me/sessions/${Uri.encodeComponent(sessionId)}/revoke',
    );
  }

  @override
  Future<int> revokeOthers() async {
    final body =
        (await _client.post<Map<String, Object?>>('/me/sessions/revoke-others')).data;
    final revoked = body?['revoked'];
    return revoked is num ? revoked.toInt() : 0;
  }

  /// `SessionDto` -> [AccountSession]. A row without an id or a parseable sign-in or
  /// expiry instant is dropped rather than shown with an invented value.
  static AccountSession? sessionFrom(Map<Object?, Object?> raw) {
    String? text(Object? v) => v is String && v.trim().isNotEmpty ? v : null;
    DateTime? instant(Object? v) => v is String ? DateTime.tryParse(v)?.toLocal() : null;

    final id = text(raw['id']);
    final signedInAt = instant(raw['signedInAt']);
    final expiresAt = instant(raw['expiresAt']);
    if (id == null || signedInAt == null || expiresAt == null) return null;

    return AccountSession(
      id: id,
      current: raw['current'] == true,
      platform: SessionPlatform.tryParse(raw['platform']),
      deviceName: text(raw['deviceName']),
      appVersion: text(raw['appVersion']),
      signedInAt: signedInAt,
      lastSeenAt: instant(raw['lastSeenAt']),
      expiresAt: expiresAt,
      remembered: raw['remembered'] == true,
    );
  }
}

/// In memory, for the fixture build and for tests. Behaves like the server: revoking an
/// unknown id is a 404, and revoke-others leaves only the current session.
class FakeAccountSessionsRepository implements AccountSessionsRepository {
  FakeAccountSessionsRepository({List<AccountSession>? sessions})
      : _sessions = sessions ?? _seed();

  final List<AccountSession> _sessions;

  /// Every id passed to [revoke], in order. For tests.
  final List<String> revoked = [];
  int revokeOthersCalls = 0;

  @override
  Future<List<AccountSession>> list() async => orderSessions(_sessions);

  @override
  Future<void> revoke(String sessionId) async {
    revoked.add(sessionId);
    final before = _sessions.length;
    _sessions.removeWhere((s) => s.id == sessionId);
    if (_sessions.length == before) {
      throw const AppError(AppErrorKind.notFound, code: 'COMM.SESSION_NOT_FOUND');
    }
  }

  @override
  Future<int> revokeOthers() async {
    revokeOthersCalls++;
    final before = _sessions.length;
    _sessions.removeWhere((s) => !s.current);
    return before - _sessions.length;
  }

  static List<AccountSession> _seed() {
    final now = DateTime.now();
    return [
      AccountSession(
        id: 'session-this',
        current: true,
        platform: SessionPlatform.ios,
        deviceName: 'iPhone',
        signedInAt: now.subtract(const Duration(days: 3)),
        lastSeenAt: now,
        expiresAt: now.add(const Duration(days: 27)),
      ),
      AccountSession(
        id: 'session-android',
        current: false,
        platform: SessionPlatform.android,
        signedInAt: now.subtract(const Duration(days: 12)),
        lastSeenAt: now.subtract(const Duration(hours: 5)),
        expiresAt: now.add(const Duration(days: 18)),
      ),
      AccountSession(
        id: 'session-web',
        current: false,
        platform: SessionPlatform.web,
        signedInAt: now.subtract(const Duration(days: 20)),
        lastSeenAt: now.subtract(const Duration(days: 9)),
        expiresAt: now.add(const Duration(days: 10)),
      ),
    ];
  }
}
