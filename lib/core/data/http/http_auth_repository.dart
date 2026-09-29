import '../../../shared/models/auth.dart';
import '../../../shared/models/user_role.dart';
import '../../errors/app_error.dart';
import '../../network/api_client.dart';
import '../../network/device_descriptor.dart';
import '../../network/http_stack.dart';
import '../repositories.dart';
import '../wire/wire_vocab.dart';

/// `AuthRepository` over the published authentication contract.
///
/// Routes consumed (`apps/api/src/platform/auth/auth.controller.ts`):
///
/// | Method | Path | Guard | Transport |
/// |---|---|---|---|
/// | POST | `/auth/login` | `@Public()` | [AuthTransport] |
/// | POST | `/auth/refresh` | `@Public()` | [AuthTransport] |
/// | GET | `/me` | bearer | [ApiClient] |
/// | POST | `/auth/logout` | bearer | [ApiClient] |
///
/// ## Why two transports
///
/// The split is the backend's own `@Public()` line, drawn on this side. The two public
/// routes go over [AuthTransport], which has no 401-refresh interceptor, so neither can
/// provoke the refresh machinery — a 401 from `/auth/refresh` that re-entered
/// `ApiClient._refreshOnce()` would await the very future already awaiting it.
///
/// The two protected routes go over the shared [ApiClient] precisely *because* it refreshes.
/// `GET /me` is the request `AuthController.restore()` makes on every cold start, and after
/// fifteen minutes in the background the access token is expired — without the standard
/// refresh-and-replay, every reopening of the app would sign the user out while holding a
/// perfectly good refresh token.
///
/// ## What this does not do
///
/// It does not own tokens. It never reads or writes secure storage, never decides when to
/// refresh, and never holds the refresh token between calls: it performs the exchange when
/// [StoredTokenProvider] asks and returns the result. That is the single-token-authority
/// rule, and the reason for it is that refresh rotation makes a second refresher
/// account-fatal, not merely wasteful.
class HttpAuthRepository implements AuthRepository {
  HttpAuthRepository({
    required AuthTransport transport,
    required ApiClient Function() protected,
    required DeviceDescriptor device,
  })  : _transport = transport,
        _protected = protected,
        _device = device;

  final AuthTransport _transport;

  /// Deferred, because the client this returns is built with the token provider that is
  /// built with this repository. Resolved at call time, by which point the knot is tied.
  final ApiClient Function() _protected;

  final DeviceDescriptor _device;

  @override
  Future<AuthSession> signIn({
    required String username,
    required String password,
  }) async {
    final description = await _device.describe();

    final response = await _transport.post<Map<String, Object?>>(
      '/auth/login',
      data: {
        'username': username,
        'password': password,
        // Optional to the server, and omitted rather than faked when this build cannot
        // describe itself. A wrong platform string is silently dropped by `AuthService`,
        // which would cost the user the device row they later read their sessions from.
        if (description != null) 'device': description.toWire(),
      },
    );

    return _session(response.data);
  }

  @override
  Future<AuthSession> refresh(String refreshToken) async {
    // The response carries a NEW refresh token; the presented one is retired server-side as
    // it is used. Persisting the replacement is StoredTokenProvider's job, in one place, so
    // that there is never a moment where two live tokens exist on this device.
    final response = await _transport.post<Map<String, Object?>>(
      '/auth/refresh',
      data: {'refreshToken': refreshToken},
    );

    return _session(response.data);
  }

  @override
  Future<AuthUser> currentUser() async {
    final response = await _protected().get<Map<String, Object?>>('/me');
    final body = response.data;
    if (body == null) {
      throw const AppError(
        AppErrorKind.server,
        debugDetail: 'GET /me returned an empty body',
      );
    }
    return principalFrom(body);
  }

  @override
  Future<void> signOut() async {
    // Best effort, by contract with AuthController: the local session is cleared either way.
    // Throwing here would strand a user signed in on their own device because a network they
    // are not on failed to answer.
    try {
      await _protected().post<Map<String, Object?>>('/auth/logout');
    } on AppError {
      // Nothing to add. The caller logs the classification; the raw detail never travels.
    }
  }

  @override
  Future<List<DeviceSession>> devices() async => throw _sessionsUnavailable;

  @override
  Future<void> revokeDevice(String deviceId) async => throw _sessionsUnavailable;

  /// `GET /me/sessions` and `DELETE /me/sessions/:id` are named in IDENTITY-MODEL §4 but are
  /// not published by the backend. Failing loudly is the honest answer: a fabricated list of
  /// devices is worse than no list, because a user would act on it.
  static const _sessionsUnavailable = AppError(
    AppErrorKind.notFound,
    code: AuthFailures.sessionsNotSupported,
    debugDetail: 'No session registry endpoint exists in the published contract.',
  );

  /// No server-push channel exists for revocation on this branch, so this never emits.
  ///
  /// Revocation is still enforced, and immediately: `AuthService.authenticate` re-reads the
  /// session row on every single request, so a revoked session fails the next call the app
  /// makes. What is missing is only *proactive* eviction of an app sitting idle, which the
  /// realtime workstream provides.
  @override
  Stream<void> get sessionRevoked => const Stream<void>.empty();

  /// `TokenPairDto` -> [AuthSession].
  static AuthSession _session(Map<String, Object?>? body) {
    final access = body?['accessToken'];
    final refresh = body?['refreshToken'];
    final expiresIn = body?['expiresIn'];

    if (access is! String || access.isEmpty || refresh is! String || refresh.isEmpty) {
      throw const AppError(
        AppErrorKind.server,
        debugDetail: 'auth response carried no usable token pair',
      );
    }

    // `expiresIn` is a DURATION IN SECONDS, not an instant. Reading it as an epoch would
    // put the expiry in 1970 and refresh on every single request; reading it as
    // milliseconds would put it fifteen minutes into an access token's past.
    final seconds = expiresIn is int
        ? expiresIn
        : expiresIn is num
            ? expiresIn.toInt()
            : null;
    if (seconds == null || seconds <= 0) {
      throw const AppError(
        AppErrorKind.server,
        debugDetail: 'auth response carried no usable expiresIn',
      );
    }

    return AuthSession(
      accessToken: access,
      refreshToken: refresh,
      accessTokenExpiresAt: DateTime.now().add(Duration(seconds: seconds)),
    );
  }

  /// `ActorDto` -> [AuthUser], including the role decision.
  ///
  /// Visible for testing: this is the mapping that decides who may hold a session on a
  /// phone, so it is exercised directly rather than only through a scripted login.
  static AuthUser principalFrom(Map<String, Object?> actor) {
    final id = actor['actorId'];
    if (id is! String || id.isEmpty) {
      throw const AppError(
        AppErrorKind.server,
        debugDetail: 'principal carried no actorId',
      );
    }

    final displayName = actor['displayName'];
    final locale = actor['locale'];

    return AuthUser(
      id: id,
      displayName: displayName is String ? displayName : '',
      role: roleFor(actor['kind']),
      locale: locale is String && locale.isNotEmpty ? locale : null,
    );
  }

  /// `ActorDto.kind` -> [UserRole].
  ///
  /// The server's vocabulary is `contact | staff | teacher | system`; this app models
  /// `parent | teacher` and says why: "a parent may see an admin in a group, but the app can
  /// never authenticate as one" (`user_role.dart`).
  ///
  /// **Fails closed.** `staff`, `system` and anything this build has not heard of are
  /// refused, never defaulted. Defaulting an unknown kind to `parent` would hand a screen —
  /// and a set of approval policies — to a principal nobody classified.
  static UserRole roleFor(Object? kind) => switch (kind) {
        Wire.actorContact => UserRole.parent,
        Wire.actorTeacher => UserRole.teacher,
        _ => throw AppError(
            AppErrorKind.forbidden,
            code: AuthFailures.roleNotSupported,
            debugDetail: 'actor kind "$kind" cannot hold a session in the mobile app',
          ),
      };
}
