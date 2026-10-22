import 'package:dio/dio.dart';

import '../data/repositories.dart';
import '../errors/app_error.dart';
import '../logging/redacting_logger.dart';
import '../storage/secure_token_store.dart';
import 'api_client.dart';
import 'api_config.dart';
import 'error_mapper.dart';

/// Bridges the token store to [ApiClient], and routes a terminal auth failure back to
/// whoever owns the session.
///
/// ## THE SINGLE-TOKEN-AUTHORITY RULE
///
/// **There is exactly one of these per session, and every authenticated consumer shares it.**
/// The HTTP client shares it today; realtime and push registration must share it when they
/// arrive. Do not give any consumer its own token provider, its own refresh call, or its own
/// copy of the refresh token.
///
/// This is not a style preference. `POST /auth/refresh` ROTATES: the presented refresh token
/// is retired as it is used, and presenting an already-rotated one is read as theft —
/// `AuthService.handleRefreshReuse` then revokes **every live session on the account**, not
/// just the offending one. Two independent refreshers on one device are therefore not a race
/// that costs a retry; they are a race that signs the user out of every device they own.
///
/// The refresh is single-flighted HERE, in the one object every consumer shares. [ApiClient]
/// also single-flights its own 401s, but that only ever covered HTTP: the realtime socket
/// renews a refused handshake by calling [refresh] on this same instance, and an app resuming
/// after its access token expired does both at once -- the socket reconnects and a screen
/// reloads. Two exchanges of one refresh token is the reuse above, and before this the second
/// one revoked every session on the account.
class StoredTokenProvider implements TokenProvider, RenewalReporting {
  StoredTokenProvider({
    required TokenStore store,
    required AuthRepository auth,
    required Future<void> Function(AppError) onEnded,
  })  : _store = store,
        _auth = auth,
        _onEnded = onEnded;

  final TokenStore _store;
  final AuthRepository _auth;
  final Future<void> Function(AppError) _onEnded;

  @override
  Future<String?> accessToken() async => (await _store.read())?.accessToken;

  Future<Renewal>? _inFlight;

  @override
  Future<String?> refresh() async => (await renew()).token;

  @override
  Future<Renewal> renew() {
    final existing = _inFlight;
    if (existing != null) return existing;

    final flight = _exchange().whenComplete(() => _inFlight = null);
    _inFlight = flight;
    return flight;
  }

  Future<Renewal> _exchange() async {
    final session = await _store.read();
    if (session == null) return const Renewal.ended();

    try {
      final renewed = await _auth.refresh(session.refreshToken);
      await _store.write(renewed);
      return Renewal.renewed(renewed.accessToken);
    } on AppError catch (error) {
      // Only a refresh that provably never arrived keeps the session. Anything else may have
      // been processed -- the token rotated server-side and only the answer lost -- and
      // presenting it again would be the reuse that revokes the whole account. Ending this
      // session locally is the safe reading of an ambiguous failure.
      if (error.neverReachedServer) return Renewal.unreachable(error);
      return const Renewal.ended();
    }
  }

  @override
  Future<void> onSessionEnded(AppError error) => _onEnded(error);
}

/// The transport for the **public** half of the auth plane: `POST /auth/login` and
/// `POST /auth/refresh`.
///
/// ## Why this exists rather than reusing [ApiClient]
///
/// [ApiClient] answers a 401 by refreshing and replaying. That is right for a protected
/// route and catastrophic for `/auth/refresh` itself:
///
/// ```
/// AuthRepository.refresh()  ->  ApiClient  ->  401
///                           ->  ApiClient._refreshOnce()   (already in flight)
///                           ->  returns the very future that is awaiting this request
/// ```
///
/// The chain then awaits itself and never completes. Fixing the error vocabulary removes
/// today's trigger, but the *shape* would still be there for the next person to hit. So the
/// two routes that must never provoke a refresh are given a transport that has no refresh
/// interceptor to provoke: the recursion is impossible by construction, not by care.
///
/// It is also the honest boundary. These are exactly the routes the backend marks
/// `@Public()` — the only two in the whole application — so "unauthenticated transport" and
/// "public route" are the same line drawn in two places.
///
/// It owns no tokens and coordinates nothing. The single refresh authority remains
/// [StoredTokenProvider]; this only carries the bytes.
class AuthTransport {
  AuthTransport({required Dio dio}) : _dio = dio;

  final Dio _dio;

  /// [headers] exists for exactly one caller: the bounded logout retry, which must present
  /// a credential explicitly BECAUSE this transport has no interceptor to attach one. That
  /// is the whole point — a retry sent here cannot provoke a second refresh, so the sign-out
  /// flow is bounded by construction rather than by a counter somebody has to maintain.
  Future<Response<T>> post<T>(
    String path, {
    Object? data,
    Map<String, String>? headers,
  }) async {
    try {
      return await _dio.post<T>(
        path,
        data: data,
        options: headers == null ? null : Options(headers: headers),
      );
    } catch (error) {
      throw ErrorMapper.map(error);
    }
  }

  /// PD-25: the one public read, `GET /auth/recovery/options`.
  Future<Response<T>> get<T>(String path) async {
    try {
      return await _dio.get<T>(path);
    } catch (error) {
      throw ErrorMapper.map(error);
    }
  }
}

/// Builds the public-route transport. Same base options as [buildApiClient], deliberately
/// **without** the token and refresh interceptors.
AuthTransport buildAuthTransport({
  required ApiConfig config,
  HttpClientAdapter? adapter,
}) {
  final dio = Dio(_baseOptions(config));
  if (adapter != null) dio.httpClientAdapter = adapter;
  return AuthTransport(dio: dio);
}

BaseOptions _baseOptions(ApiConfig config) => BaseOptions(
      baseUrl: config.baseUrl,
      connectTimeout: config.connectTimeout,
      receiveTimeout: config.receiveTimeout,
      sendTimeout: config.sendTimeout,
      contentType: Headers.jsonContentType,
      responseType: ResponseType.json,
      // Let every status through to the error mapper, which owns the taxonomy. Dio's own
      // 2xx-only default would classify a 403 as a transport failure.
      validateStatus: (status) => status != null && status >= 200 && status < 300,
    );

/// Builds the configured, authenticated HTTP client.
///
/// **`Authorization: Bearer` is the only credential this client sends**, and [TokenProvider]
/// is the only thing that can produce one. There is deliberately no way to pass an identity
/// in alongside it: the backend derives the actor exclusively from the verified token
/// (AUTH-INV-1), so a second identity channel could only ever be a client asserting something
/// the server does not read. Do not add one back.
ApiClient buildApiClient({
  required ApiConfig config,
  required TokenProvider tokens,
  RedactingLogger logger = const RedactingLogger(),
  HttpClientAdapter? adapter,
}) {
  final dio = Dio(_baseOptions(config));

  if (adapter != null) dio.httpClientAdapter = adapter;

  return ApiClient(dio: dio, tokens: tokens, logger: logger);
}
