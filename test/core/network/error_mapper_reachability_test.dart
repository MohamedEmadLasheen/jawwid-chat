import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/error_mapper.dart';

/// Which transport failures prove the server never saw the request. Only those may keep a
/// session whose refresh failed: re-presenting a refresh the server processed is reuse.
void main() {
  final request = RequestOptions(path: '/auth/refresh');
  AppError map(DioExceptionType type) =>
      ErrorMapper.map(DioException(requestOptions: request, type: type));

  test('no connection, or a connect timeout: provably never reached the server', () {
    expect(map(DioExceptionType.connectionError).neverReachedServer, isTrue);
    expect(map(DioExceptionType.connectionTimeout).neverReachedServer, isTrue);
  });

  test('a read or send timeout is ambiguous: the server may have processed it', () {
    expect(map(DioExceptionType.receiveTimeout).neverReachedServer, isFalse);
    expect(map(DioExceptionType.sendTimeout).neverReachedServer, isFalse);
    expect(map(DioExceptionType.unknown).neverReachedServer, isFalse);
  });

  test('a 5xx is ambiguous; a 429 was turned away unprocessed', () {
    Response<Object?> reply(int status) => Response(requestOptions: request, statusCode: status);
    AppError status(int code) => ErrorMapper.map(DioException(
          requestOptions: request,
          response: reply(code),
          type: DioExceptionType.badResponse,
        ));
    expect(status(503).neverReachedServer, isFalse);
    expect(status(429).neverReachedServer, isTrue);
  });

  test('the kinds are unchanged: the codes are additional', () {
    expect(map(DioExceptionType.connectionError).kind, AppErrorKind.network);
    expect(map(DioExceptionType.connectionTimeout).kind, AppErrorKind.timeout);
  });

  test('an AppError an interceptor already decided is carried through, not re-derived', () {
    const decided = AppError(AppErrorKind.network, code: AppError.connectFailed);
    final wrapped = DioException(
      requestOptions: request,
      error: decided,
      type: DioExceptionType.connectionError,
    );
    expect(identical(ErrorMapper.map(wrapped), decided), isTrue);
  });
}
