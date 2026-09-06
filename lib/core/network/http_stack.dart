import 'package:dio/dio.dart';

import '../data/repositories.dart';
import '../errors/app_error.dart';
import '../logging/redacting_logger.dart';
import '../storage/secure_token_store.dart';
import 'actor_identity.dart';
import 'api_client.dart';
import 'api_config.dart';

/// Bridges the token store to [ApiClient], and routes a terminal auth failure back to
/// whoever owns the session.
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

/// Attaches the actor-identity headers to every request.
///
/// In a release build [DebugActorHeaderIdentity] returns nothing, so this interceptor is
/// inert — the header cannot ship.
class _ActorIdentityInterceptor extends Interceptor {
  _ActorIdentityInterceptor(this._identity);

  final ActorIdentity _identity;

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    options.headers.addAll(await _identity.headers());
    handler.next(options);
  }
}

/// Builds the configured HTTP client.
ApiClient buildApiClient({
  required ApiConfig config,
  required TokenProvider tokens,
  required ActorIdentity identity,
  RedactingLogger logger = const RedactingLogger(),
  HttpClientAdapter? adapter,
}) {
  final dio = Dio(
    BaseOptions(
      baseUrl: config.baseUrl,
      connectTimeout: config.connectTimeout,
      receiveTimeout: config.receiveTimeout,
      sendTimeout: config.sendTimeout,
      contentType: Headers.jsonContentType,
      responseType: ResponseType.json,
      // Let every status through to the error mapper, which owns the taxonomy. Dio's own
      // 2xx-only default would classify a 403 as a transport failure.
      validateStatus: (status) => status != null && status >= 200 && status < 300,
    ),
  );

  if (adapter != null) dio.httpClientAdapter = adapter;
  dio.interceptors.add(_ActorIdentityInterceptor(identity));

  return ApiClient(dio: dio, tokens: tokens, logger: logger);
}
