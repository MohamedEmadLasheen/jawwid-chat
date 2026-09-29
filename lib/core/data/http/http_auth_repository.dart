import 'package:dio/dio.dart';

import '../../../shared/models/auth.dart';
import '../../../shared/models/user_role.dart';
import '../../errors/app_error.dart';
import '../../network/api_client.dart';
import '../../network/api_config.dart';
import '../../network/error_mapper.dart';
import '../repositories.dart';

/// The real authentication adapter (W8-W0).
///
/// It replaces [UnavailableAuthRepository], whose comment — *"No authentication
/// endpoints exist in apps/api"* — stopped being true when `auth.controller.ts`
/// landed. The server has published four of the five routes that class asked
/// for, and this speaks to exactly those:
///
/// ```
///   POST /auth/login     -> TokenPairDto
///   POST /auth/refresh   -> TokenPairDto
///   GET  /me             -> ActorDto
///   POST /auth/logout    -> { ok: true }
/// ```
///
/// The fifth — a device/session registry — was never built, so [devices],
/// [revokeDevice] and [sessionRevoked] stay unsupported and say so. See the
/// note above each.
///
/// ## TWO TRANSPORTS, AND WHY THAT IS NOT A SECOND AUTH STACK
///
/// Login and refresh CANNOT travel on the authenticated [ApiClient], and this
/// is not a preference:
///
/// * The client's error interceptor turns any 401 into "refresh once, then
///   retry". A **wrong password** is a 401, so a failed sign-in would trigger a
///   token refresh and — finding no session — call `onSessionEnded`, ending a
///   session the user was still trying to create.
/// * Worse, `POST /auth/refresh` returning 401 (an expired refresh token) would
///   re-enter the interceptor, which single-flights refreshes and would hand
///   back the very future it is already inside. That is a **deadlock**, not a
///   slow path.
///
/// So the two `@Public()` routes use a bare [Dio] carrying no credential and no
/// interceptor. There is still exactly ONE refresh mechanism —
/// `StoredTokenProvider`, single-flighted in `ApiClient` — and this transport
/// has no part in it: it cannot refresh, because it is what refreshing calls.
///
/// `GET /me` and `POST /auth/logout` deliberately DO use the authenticated
/// client, so a launch with an expired access token refreshes and retries
/// rather than signing the user out. `AppError.unauthenticated` terminates a
/// session, so sending `/me` down the bare transport would log people out every
/// time their access token aged past its expiry while the app was closed.
///
/// ## The construction cycle, and how it is broken
///
/// `StoredTokenProvider` needs an `AuthRepository`; the `ApiClient` needs the
/// token provider; this needs the client. [authenticatedClient] is a callback
/// rather than an instance so the composition root can close the loop after all
/// three exist. It is read per call, never cached.
class HttpAuthRepository implements AuthRepository {
  HttpAuthRepository({
    required ApiConfig config,
    required ApiClient Function() authenticatedClient,
    Dio? publicTransport,
  })  : _authed = authenticatedClient,
        _public = publicTransport ?? _bareTransport(config);

  final ApiClient Function() _authed;

  /// No `Authorization` header, no refresh interceptor. See the class comment.
  final Dio _public;

  /// Built to the same shape `buildApiClient` uses, minus every interceptor.
  static Dio _bareTransport(ApiConfig config) => Dio(
        BaseOptions(
          baseUrl: config.baseUrl,
          connectTimeout: config.connectTimeout,
          receiveTimeout: config.receiveTimeout,
          sendTimeout: config.sendTimeout,
          contentType: Headers.jsonContentType,
          responseType: ResponseType.json,
          validateStatus: (status) =>
              status != null && status >= 200 && status < 300,
        ),
      );

  @override
  Future<AuthSession> signIn({
    required String username,
    required String password,
  }) async {
    final data = await _publicPost('/auth/login', {
      'username': username,
      'password': password,
    });
    return _session(data, 'login');
  }

  @override
  Future<AuthSession> refresh(String refreshToken) async {
    final data = await _publicPost('/auth/refresh', {
      'refreshToken': refreshToken,
    });
    return _session(data, 'refresh');
  }

  @override
  Future<AuthUser> currentUser() async {
    final response = await _authed().get<Map<String, Object?>>('/me');
    return _user(_require(response.data, 'me'));
  }

  @override
  Future<void> signOut() async {
    await _authed().post<Map<String, Object?>>('/auth/logout');
  }

  // ------------------------------------------------------- not on the server

  /// UNSUPPORTED. `apps/api` publishes no session registry: there is no route
  /// that lists a user's sessions and none that revokes one.
  ///
  /// It throws rather than returning `[]`, because an empty list is a lie that
  /// renders as "you are signed in on no other devices" — the exact assurance a
  /// person would act on.
  @override
  Future<List<DeviceSession>> devices() async => throw _unsupported('devices');

  /// UNSUPPORTED, and the more dangerous of the two to fake: silently doing
  /// nothing would report a device successfully signed out while its session
  /// stayed live.
  @override
  Future<void> revokeDevice(String deviceId) async =>
      throw _unsupported('revokeDevice');

  /// UNSUPPORTED — and an empty stream rather than a throw, because a stream is
  /// listened to, not called, and an absent revocation signal is not a failure.
  ///
  /// `session.revoked` exists server-side only as an AUDIT event name
  /// (`auth.service.ts`), never as a realtime emission, so nothing can produce
  /// this. Revocation is still observed: the server answers a revoked session
  /// with 401, and `ApiClient` ends the session on it. What is missing is the
  /// push notice, not the enforcement.
  @override
  Stream<void> get sessionRevoked => const Stream<void>.empty();

  static AppError _unsupported(String what) => AppError(
        AppErrorKind.server,
        code: 'auth_session_registry_unavailable',
        debugDetail:
            'apps/api publishes no session registry, so $what has no endpoint. '
            'Only /auth/login, /auth/refresh, /auth/logout and /me exist.',
      );

  // ------------------------------------------------------------------ wiring

  /// A POST on the credential-free transport, mapped into the app's taxonomy.
  ///
  /// `ApiClient` maps errors in its own send path; this transport has no
  /// interceptor, so the mapping happens here — through the same [ErrorMapper],
  /// so a 401 here is the same `AppError` a 401 anywhere else produces.
  Future<Map<String, Object?>> _publicPost(
    String path,
    Map<String, Object?> body,
  ) async {
    final Response<Map<String, Object?>> response;
    try {
      response = await _public.post<Map<String, Object?>>(path, data: body);
    } catch (error) {
      throw ErrorMapper.map(error);
    }
    return _require(response.data, path);
  }

  /// `TokenPairDto` -> [AuthSession].
  ///
  /// `expiresIn` is a DURATION IN SECONDS, not an instant. It is resolved
  /// against the clock at the moment the response is read; `AuthSession` then
  /// treats the token as expired 30s early so a request does not race it.
  AuthSession _session(Map<String, Object?> data, String what) {
    final expiresIn = data['expiresIn'];
    if (expiresIn is! num) {
      throw AppError(
        AppErrorKind.server,
        code: 'malformed_$what',
        debugDetail: '$what response carried no numeric expiresIn',
      );
    }

    return AuthSession(
      accessToken: _string(data, 'accessToken', what),
      refreshToken: _string(data, 'refreshToken', what),
      accessTokenExpiresAt:
          DateTime.now().add(Duration(seconds: expiresIn.toInt())),
    );
  }

  /// `ActorDto` -> [AuthUser].
  ///
  /// THE ROLE IS THE SERVER'S WORD, and an unrecognised one is a refusal rather
  /// than a default. `UserRole` is `parent | teacher` because those are the only
  /// principals this app can BE; an admin or a system actor authenticating here
  /// would otherwise be silently rendered as a parent.
  ///
  /// `avatarUrl` and `timeZone` are absent from `ActorDto` and are left null —
  /// the product default for the latter is Cairo, applied where it is
  /// displayed, not invented here.
  AuthUser _user(Map<String, Object?> data) {
    final role = UserRole.tryParse(data['kind'] as String?);
    if (role == null) {
      throw const AppError(
        AppErrorKind.forbidden,
        code: 'unsupported_actor_kind',
        debugDetail:
            'the authenticated actor is not a parent or a teacher, which are '
            'the only principals this application can be',
      );
    }

    final locale = data['locale'];
    return AuthUser(
      id: _string(data, 'actorId', 'me'),
      displayName: _string(data, 'displayName', 'me'),
      role: role,
      locale: locale is String && locale.isNotEmpty ? locale : null,
    );
  }

  static Map<String, Object?> _require(Map<String, Object?>? data, String what) {
    if (data == null) {
      throw AppError(
        AppErrorKind.server,
        code: 'malformed_$what',
        debugDetail: '$what returned no body',
      );
    }
    return data;
  }

  static String _string(Map<String, Object?> data, String key, String what) {
    final value = data[key];
    if (value is! String || value.isEmpty) {
      throw AppError(
        AppErrorKind.server,
        code: 'malformed_$what',
        debugDetail: '$what response carried no $key',
      );
    }
    return value;
  }
}
