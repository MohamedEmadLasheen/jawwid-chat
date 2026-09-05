import 'dart:async';

import 'package:dio/dio.dart';

import '../errors/app_error.dart';
import '../logging/redacting_logger.dart';
import 'error_mapper.dart';

/// Supplies and renews credentials for [ApiClient]. Kept as an interface so the client has
/// no opinion about where tokens live.
abstract interface class TokenProvider {
  Future<String?> accessToken();

  /// Obtain a fresh access token. Returns null when the session cannot be renewed, which the
  /// client treats as terminal.
  Future<String?> refresh();

  Future<void> onSessionEnded(AppError error);
}

/// The app's HTTP client.
///
/// Two behaviours here are deliberate and worth stating, because getting them wrong is how
/// duplicate messages and infinite retry loops appear:
///
/// * **A 401 triggers at most one refresh, and refreshes are single-flighted.** Ten requests
///   failing at once produce one refresh call, not ten; and a request is replayed only once,
///   so a persistently rejecting server cannot cause a loop.
/// * **Only idempotent requests are retried automatically.** A POST is retried solely when
///   the caller has marked it idempotent by attaching a client-generated key (§48) — which
///   is exactly what message sending does.
class ApiClient {
  ApiClient({
    required Dio dio,
    required TokenProvider tokens,
    RedactingLogger logger = const RedactingLogger(),
  })  : _dio = dio,
        _tokens = tokens,
        _logger = logger {
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: _onRequest,
        onError: _onError,
      ),
    );
  }

  /// Header carrying the client-generated idempotency key (see C6).
  static const idempotencyHeader = 'X-Idempotency-Key';

  /// Marks a request the client may safely replay.
  static const _retryableFlag = 'jawwid.retryable';

  final Dio _dio;
  final TokenProvider _tokens;
  final RedactingLogger _logger;

  Future<String?>? _inFlightRefresh;

  /// Build options for a non-idempotent write that carries an idempotency key, making it
  /// safe to replay.
  static Options idempotent(String clientKey) => Options(
        headers: {idempotencyHeader: clientKey},
        extra: const {_retryableFlag: true},
      );

  Future<Response<T>> get<T>(String path, {Map<String, Object?>? query}) =>
      _guard(() => _dio.get<T>(path, queryParameters: query));

  Future<Response<T>> post<T>(
    String path, {
    Object? data,
    Options? options,
  }) =>
      _guard(() => _dio.post<T>(path, data: data, options: options));

  Future<Response<T>> patch<T>(String path, {Object? data}) =>
      _guard(() => _dio.patch<T>(path, data: data));

  Future<Response<T>> delete<T>(String path) => _guard(() => _dio.delete<T>(path));

  Future<Response<T>> _guard<T>(Future<Response<T>> Function() send) async {
    try {
      return await send();
    } catch (error) {
      throw ErrorMapper.map(error);
    }
  }

  Future<void> _onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    final token = await _tokens.accessToken();
    if (token != null) options.headers['Authorization'] = 'Bearer $token';
    handler.next(options);
  }

  Future<void> _onError(
    DioException error,
    ErrorInterceptorHandler handler,
  ) async {
    final mapped = ErrorMapper.map(error);

    // A disabled account or a revoked session is terminal: refreshing cannot help, and
    // pretending otherwise would strand the user on a spinner.
    if (mapped.kind == AppErrorKind.accountDisabled ||
        mapped.kind == AppErrorKind.sessionRevoked) {
      await _tokens.onSessionEnded(mapped);
      return handler.reject(error);
    }

    if (mapped.kind != AppErrorKind.unauthenticated) return handler.next(error);

    final request = error.requestOptions;
    if (request.extra['jawwid.replayed'] == true) {
      // Already retried once with a fresh token and still rejected — stop.
      await _tokens.onSessionEnded(mapped);
      return handler.reject(error);
    }

    final refreshed = await _refreshOnce();
    if (refreshed == null) {
      await _tokens.onSessionEnded(mapped);
      return handler.reject(error);
    }

    if (!_mayReplay(request)) return handler.next(error);

    request.headers['Authorization'] = 'Bearer $refreshed';
    request.extra['jawwid.replayed'] = true;

    try {
      final response = await _dio.fetch<dynamic>(request);
      return handler.resolve(response);
    } catch (_) {
      return handler.reject(error);
    }
  }

  /// Single-flight the refresh so a burst of 401s produces one token exchange.
  Future<String?> _refreshOnce() {
    final existing = _inFlightRefresh;
    if (existing != null) return existing;

    final future = _tokens.refresh().whenComplete(() => _inFlightRefresh = null);
    _inFlightRefresh = future;
    return future;
  }

  /// Replay only what is safe to replay (§48).
  bool _mayReplay(RequestOptions request) {
    const idempotentMethods = {'GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'};
    if (idempotentMethods.contains(request.method.toUpperCase())) return true;

    final flagged = request.extra[_retryableFlag] == true;
    final hasKey = request.headers.containsKey(idempotencyHeader);

    if (!flagged || !hasKey) {
      _logger.debug('not replaying non-idempotent request', data: {
        'method': request.method,
      });
    }
    return flagged && hasKey;
  }
}
