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
/// | GET | `/lessons/access` | bearer | [ApiClient] (staff only: the department, PD-20) |
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
    required Future<String?> Function() currentAccessToken,
  })  : _transport = transport,
        _protected = protected,
        _device = device,
        _currentAccessToken = currentAccessToken;

  final AuthTransport _transport;

  /// Deferred, because the client this returns is built with the token provider that is
  /// built with this repository. Resolved at call time, by which point the knot is tied.
  final ApiClient Function() _protected;

  final DeviceDescriptor _device;

  /// Reads the access token the session currently holds. A READ, not ownership: this never
  /// writes one, never decides to renew one, and never holds one between calls. It exists so
  /// [signOut] can tell "the refresh authority renewed the session" from "it could not",
  /// which are the two outcomes that decide whether one more logout is worth sending.
  final Future<String?> Function() _currentAccessToken;

  /// Single-flights sign-out, so two taps -- or a tap racing a terminal refusal -- produce
  /// one logout flow rather than two.
  Future<void>? _signingOut;

  @override
  Future<AuthSession> signIn({
    required String username,
    required String password,
    bool remember = false,
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
        // PD-23, sent only when asked: the server honours it on the web alone.
        if (remember) 'remember': true,
      },
    );

    // A login is the one answer that says where the session is kept (PD-28 browser store).
    return _session(response.data, fromLogin: true);
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
    // PD-20: a staff member may use the app only as Sales. The department is not on
    // `/me`, so it is asked for -- and only when the staff role could qualify at all, so
    // nobody else's sign-in costs a second request.
    if (body['kind'] == Wire.actorStaff && salesStaffRoles.contains(body['staffRole'])) {
      final Map<String, Object?>? access;
      try {
        access = (await _protected().get<Map<String, Object?>>('/lessons/access')).data;
      } on AppError catch (error) {
        // A network failure is not a verdict: let restore keep the session and retry. A
        // refusal is -- this staff member cannot be classified as Sales, so they are not.
        if (error.isTransient || error.terminatesSession || error.isRefreshable) rethrow;
        return principalFrom(body);
      }
      return principalFrom(body, salesDepartment: access?['sales'] == true);
    }
    return principalFrom(body);
  }

  /// Ends the session server-side, in at most three requests and never more.
  ///
  /// ## Why a retry at all
  ///
  /// `POST /auth/logout` is authenticated, and the moment a user is most likely to press
  /// sign out is after the app has sat in the background past the fifteen-minute access-token
  /// lifetime. The first attempt then 401s, [ApiClient] renews through the one refresh
  /// authority — which ROTATES, minting a fresh session — and declines to replay a POST. The
  /// client would clear its tokens and walk away, leaving a brand-new live session on the
  /// server that nobody holds the credentials for and that expires thirty days later.
  ///
  /// ## Why it is bounded by construction
  ///
  /// The retry goes over [AuthTransport], carrying the renewed token explicitly. That
  /// transport has no refresh interceptor, so the retry cannot trigger a second renewal no
  /// matter how it is refused. The ceiling for one sign-out is therefore: one logout, at most
  /// one refresh (ApiClient's, single-flighted), at most one logout retry. Nothing here
  /// changes generic replay policy, and `_mayReplay` is untouched — a POST is still not
  /// something the transport replays on its own.
  @override
  Future<void> signOut() => _signingOut ??= _signOut().whenComplete(() {
        _signingOut = null;
      });

  Future<void> _signOut() async {
    final before = await _currentAccessToken();

    try {
      await _protected().post<Map<String, Object?>>('/auth/logout');
      return;
    } on AppError catch (error) {
      // Only an expired access token is worth a second attempt. A revoked session, a
      // disabled or locked account, a network failure or a 500 are each either already final
      // or not recoverable by sending the same request again.
      if (!error.isRefreshable) return;
    }

    final renewed = await _currentAccessToken();
    // Unchanged means the refresh did not happen or did not succeed, so there is no new
    // credential to try and a retry would simply be refused identically.
    if (renewed == null || renewed == before) return;

    try {
      await _transport.post<Map<String, Object?>>(
        '/auth/logout',
        headers: {'Authorization': 'Bearer $renewed'},
      );
    } on AppError {
      // Bounded: there is no third attempt. The local session is cleared by AuthController
      // regardless, and a server session the client can no longer name will expire on its
      // own. Throwing would strand a user signed in on their own device.
    }
  }

  /// No server-push channel exists for revocation on this branch, so this never emits.
  ///
  /// Revocation is still enforced, and immediately: `AuthService.authenticate` re-reads the
  /// session row on every single request, so a revoked session fails the next call the app
  /// makes. What is missing is only *proactive* eviction of an app sitting idle, which the
  /// realtime workstream provides.
  @override
  Stream<void> get sessionRevoked => const Stream<void>.empty();

  /// `TokenPairDto` -> [AuthSession].
  static AuthSession _session(Map<String, Object?>? body, {bool fromLogin = false}) {
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
      // Read from a login only; a refresh never moves the session (see AuthSession.remembered).
      // Anything but a literal true is false: a missing field never buys a longer session.
      remembered: fromLogin ? _remembered(body) : null,
    );
  }

  static bool _remembered(Map<String, Object?>? body) {
    final session = body?['session'];
    return session is Map && session['remembered'] == true;
  }

  /// `ActorDto` -> [AuthUser], including the role decision.
  ///
  /// Visible for testing: this is the mapping that decides who may hold a session on a
  /// phone, so it is exercised directly rather than only through a scripted login.
  ///
  /// [salesDepartment] is `GET /lessons/access`'s `sales`, asked only for staff.
  static AuthUser principalFrom(Map<String, Object?> actor, {bool salesDepartment = false}) {
    final id = actor['actorId'];
    if (id is! String || id.isEmpty) {
      throw const AppError(
        AppErrorKind.server,
        debugDetail: 'principal carried no actorId',
      );
    }

    final displayName = actor['displayName'];
    final locale = actor['locale'];

    final role = roleFor(actor['kind'], staffRole: actor['staffRole'], salesDepartment: salesDepartment);
    return AuthUser(
      id: id,
      displayName: displayName is String ? displayName : '',
      role: role,
      locale: locale is String && locale.isNotEmpty ? locale : null,
      isSuperAdmin: role == UserRole.sales && actor['staffRole'] == superAdminStaffRole,
    );
  }

  /// `ActorDto.kind` -> [UserRole].
  ///
  /// The server's vocabulary is `contact | staff | teacher | system`; this app models
  /// `parent | teacher | sales`.
  ///
  /// PD-20: a `staff` principal is [UserRole.sales] only when ALL of these hold:
  ///  * [salesDepartment] -- `GET /lessons/access` says `sales: true`;
  ///  * the staff role is one the chat API serves (`admin | coverage | manager`);
  ///
  /// PD-20 amendment (owner, 2026-10-22): the organization's `super_admin` signs in too,
  /// with the same tabs. It needs no department: the server already serves it every
  /// conversation, family and payment of the organization.
  ///
  /// **Fails closed.** Any other staff member, `system` and anything this build has not
  /// heard of are refused, never defaulted. Defaulting an unknown kind to `parent` would
  /// hand a screen -- and a set of approval policies -- to a principal nobody classified.
  static UserRole roleFor(Object? kind, {Object? staffRole, bool salesDepartment = false}) => switch (kind) {
        Wire.actorContact => UserRole.parent,
        Wire.actorTeacher => UserRole.teacher,
        Wire.actorStaff when staffRole == superAdminStaffRole => UserRole.sales,
        Wire.actorStaff when salesDepartment && salesStaffRoles.contains(staffRole) => UserRole.sales,
        _ => throw AppError(
            AppErrorKind.forbidden,
            code: AuthFailures.roleNotSupported,
            debugDetail: 'actor kind "$kind" cannot hold a session in the mobile app',
          ),
      };
}

/// The staff roles the chat API serves to a Sales seat (`admin | coverage | manager`).
/// `finance`, `technical` and `academic` are deliberately absent; `super_admin` is let in
/// on its own ([superAdminStaffRole]), without the department check.
const salesStaffRoles = {'admin', 'coverage', 'manager'};

/// PD-20 amendment: the organization's super admin uses the app with the Sales tabs.
const superAdminStaffRole = 'super_admin';
