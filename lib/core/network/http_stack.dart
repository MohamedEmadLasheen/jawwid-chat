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
/// [ApiClient] single-flights the refresh, so a burst of 401s produces one exchange. That
/// guarantee holds per provider instance, which is precisely why there must only ever be one.
class StoredTokenProvider implements TokenProvider {
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

  @override
  Future<String?> refresh() async {
    final session = await _store.read();
    if (session == null) return null;

    try {
      final renewed = await _auth.refresh(session.refreshToken);
      await _store.write(renewed);
      return renewed.accessToken;
    } on AppError {
      // A refresh that fails is the end of the session, not a retryable error.
      return null;
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

  Future<Response<T>> post<T>(String path, {Object? data}) async {
    try {
      return await _dio.post<T>(path, data: data);
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
/// There is no `identity` parameter any more. It carried the `x-actor-id` bring-up seam, and
/// PR-B removed the last reader of that header from the backend — `@ActorId()` now reads
/// `request.actor`, which only the verified-bearer guard writes. A client-supplied identity
/// header is therefore not merely disabled, it is ignored, and a seam that pretends to offer
/// an identity nobody honours is worse than none: it documents a security model that no
/// longer exists. Identity now comes from exactly one place, [TokenProvider].
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
