import 'dart:async';

import 'package:dio/dio.dart';

import '../errors/app_error.dart';
import '../logging/redacting_logger.dart';
import 'error_mapper.dart';

/// Supplies and renews credentials for [ApiClient]. Kept as an interface so the client has
/// no opinion about where tokens live.
abstract interface class TokenProvider {
  Future<String?> accessToken();

  /// Obtain a fresh access token. Returns null when no token could be obtained. Never throws.
  ///
  /// A provider that can tell "the session is over" apart from "the server could not be
  /// reached" also implements [RenewalReporting], and [ApiClient] asks it that instead.
  Future<String?> refresh();

  Future<void> onSessionEnded(AppError error);
}

/// What one renewal attempt produced.
final class Renewal {
  const Renewal.renewed(String this.token) : unreachable = null;

  /// The session cannot be renewed: refused, expired, or never stored.
  const Renewal.ended()
      : token = null,
        unreachable = null;

  /// The refresh request never reached the server ([AppError.neverReachedServer]). Nothing
  /// was rotated, so the stored session is intact and still renewable later.
  const Renewal.unreachable(AppError this.unreachable) : token = null;

  final String? token;
  final AppError? unreachable;
}

/// A [TokenProvider] that can say WHY a renewal produced no token.
///
/// Without it, "no network" and "session over" both arrive as a null token, and the only
/// safe reading of a null is the terminal one -- which signed people out whenever their
/// access token expired while they had no signal.
abstract interface class RenewalReporting {
  /// The same single flight as [TokenProvider.refresh].
  Future<Renewal> renew();
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

  Future<Renewal>? _inFlightRefresh;

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

  Future<Response<T>> delete<T>(String path, {Map<String, Object?>? query}) =>
      _guard(() => _dio.delete<T>(path, queryParameters: query));

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

    // A disabled account, a locked account or a revoked session is terminal: refreshing
    // cannot help, and pretending otherwise would strand the user on a spinner. Worse, the
    // backend rotates refresh tokens and reads a replayed one as theft, so spending the
    // refresh token on a refusal that will repeat is not merely futile.
    if (mapped.terminatesSession && !mapped.isRefreshable) {
      await _tokens.onSessionEnded(mapped);
      return handler.reject(error);
    }

    // Everything else -- a policy refusal, a validation failure, and in particular a failed
    // *login* -- travels on untouched. A wrong password is not this layer's business: it has
    // no session to renew and none to end.
    if (!mapped.isRefreshable) return handler.next(error);

    final request = error.requestOptions;
    if (request.extra['jawwid.replayed'] == true) {
      // Already retried once with a fresh token and still rejected — stop.
      await _tokens.onSessionEnded(mapped);
      return handler.reject(error);
    }

    // Renewed by someone else while this request was in flight -- the socket, or another
    // request's refresh that has already completed. The token it was refused with is simply
    // out of date: replay with the current one rather than rotating again. Every rotation is
    // another chance for an answer to be lost in transit, and a lost answer ends the session.
    final current = await _tokens.accessToken();
    if (current != null &&
        request.headers['Authorization'] != 'Bearer $current' &&
        _mayReplay(request)) {
      return _replay(request, current, error, handler);
    }

    final renewal = await _refreshOnce();
    final unreachable = renewal.unreachable;
    if (unreachable != null) {
      // The refresh never reached the server, so nothing was rotated and the session is
      // intact. This request fails as what it is -- no network -- and the session is kept.
      // Ending it here is what used to sign people out for opening the app without signal.
      return handler.reject(
        DioException(
          requestOptions: request,
          error: unreachable,
          type: DioExceptionType.connectionError,
        ),
      );
    }

    final refreshed = renewal.token;
    if (refreshed == null) {
      await _tokens.onSessionEnded(mapped);
      return handler.reject(error);
    }

    if (!_mayReplay(request)) return handler.next(error);

    return _replay(request, refreshed, error, handler);
  }

  /// Once only: a replay that is refused again ends the session above.
  Future<void> _replay(
    RequestOptions request,
    String token,
    DioException original,
    ErrorInterceptorHandler handler,
  ) async {
    request.headers['Authorization'] = 'Bearer $token';
    request.extra['jawwid.replayed'] = true;

    try {
      final response = await _dio.fetch<dynamic>(request);
      return handler.resolve(response);
    } catch (_) {
      return handler.reject(original);
    }
  }

  /// Single-flight the refresh so a burst of 401s produces one token exchange.
  ///
  /// This bounds THIS client's refreshes only. A provider shared with other consumers (the
  /// realtime socket renews through it too) must single-flight itself; [StoredTokenProvider]
  /// does.
  Future<Renewal> _refreshOnce() {
    final existing = _inFlightRefresh;
    if (existing != null) return existing;

    final Future<Renewal> renewal = switch (_tokens) {
      final RenewalReporting reporting => reporting.renew(),
      final tokens => tokens.refresh().then(
            (token) => token == null ? const Renewal.ended() : Renewal.renewed(token),
          ),
    };
    final future = renewal.whenComplete(() => _inFlightRefresh = null);
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
