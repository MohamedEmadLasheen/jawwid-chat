import 'dart:async';
import 'dart:io';

import 'package:dio/dio.dart';

import '../errors/app_error.dart';

/// Collapses every transport and HTTP outcome into the [AppError] taxonomy.
///
/// Doing this in exactly one place is what lets the rest of the app — and the retry logic in
/// particular — reason about failures without ever touching a Dio type.
abstract final class ErrorMapper {
  /// Backend codes that mean "this session is over", distinguished so the UI can say
  /// something truthful rather than inviting a pointless retry (§7).
  static const _disabledCodes = {'account_disabled', 'user_disabled'};
  static const _revokedCodes = {'session_revoked', 'device_revoked', 'token_revoked'};

  static AppError map(Object error) {
    if (error is AppError) return error;

    if (error is DioException) return _fromDio(error);
    if (error is SocketException) return const AppError(AppErrorKind.network);
    if (error is TimeoutException) return const AppError(AppErrorKind.timeout);

    return AppError(AppErrorKind.unknown, debugDetail: error.runtimeType.toString());
  }

  static AppError _fromDio(DioException error) {
    switch (error.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        return const AppError(AppErrorKind.timeout);
      case DioExceptionType.connectionError:
        return const AppError(AppErrorKind.network);
      case DioExceptionType.cancel:
        return const AppError(AppErrorKind.unknown, code: 'cancelled');
      case DioExceptionType.badCertificate:
        return const AppError(AppErrorKind.network, code: 'bad_certificate');
      case DioExceptionType.badResponse:
      case DioExceptionType.unknown:
        break;
    }

    final response = error.response;
    if (response == null) return const AppError(AppErrorKind.network);

    final code = _codeOf(response.data);
    return AppError(_kindFor(response.statusCode, code), code: code);
  }

  static AppErrorKind _kindFor(int? status, String? code) {
    if (code != null) {
      if (_disabledCodes.contains(code)) return AppErrorKind.accountDisabled;
      if (_revokedCodes.contains(code)) return AppErrorKind.sessionRevoked;
    }

    return switch (status) {
      400 || 422 => AppErrorKind.validation,
      401 => AppErrorKind.unauthenticated,
      403 => AppErrorKind.forbidden,
      404 || 410 => AppErrorKind.notFound,
      429 => AppErrorKind.rateLimited,
      _ when status != null && status >= 500 => AppErrorKind.server,
      _ => AppErrorKind.unknown,
    };
  }

  /// Read the backend's machine-readable code, tolerating a body that is not the shape we
  /// expect — an error path must never itself throw.
  static String? _codeOf(Object? body) {
    if (body is! Map) return null;
    final code = body['code'] ?? body['error'] ?? body['error_code'];
    return code is String && code.isNotEmpty ? code : null;
  }
}
