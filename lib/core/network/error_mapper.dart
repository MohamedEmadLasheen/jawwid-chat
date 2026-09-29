import 'dart:async';
import 'dart:io';

import 'package:dio/dio.dart';

import '../data/wire/wire_vocab.dart';
import '../errors/app_error.dart';

/// Collapses every transport and HTTP outcome into the [AppError] taxonomy.
///
/// Doing this in exactly one place is what lets the rest of the app — and the retry logic in
/// particular — reason about failures without ever touching a Dio type.
abstract final class ErrorMapper {
  /// Backend codes that mean "this session is over", distinguished so the UI can say
  /// something truthful rather than inviting a pointless retry (§7).
  ///
  /// The `AUTH.*` constants are the ones the running backend actually sends
  /// (`apps/api/src/platform/auth/auth.errors.ts`) and they take precedence. The bare
  /// lower-case codes are kept alongside them because other services in the estate use that
  /// flatter shape, and dropping them would silently downgrade a session ending those
  /// services still report correctly.
  static const _disabledCodes = {AuthErrors.accountDisabled, 'account_disabled', 'user_disabled'};
  static const _revokedCodes = {
    AuthErrors.sessionRevoked,
    'session_revoked',
    'device_revoked',
    'token_revoked',
  };
  static const _lockedCodes = {AuthErrors.accountLocked, 'account_locked'};

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
      case DioExceptionType.transformTimeout:
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
    return AppError(
      _kindFor(response.statusCode, code),
      code: code,
      retryAfter: _retryAfterOf(response),
    );
  }

  /// Reads `Retry-After`, which is where the backend puts the wait for
  /// [AuthErrors.rateLimited] -- deliberately not in the body, so that a per-account
  /// countdown cannot leak which accounts are being attacked. Both forms the RFC allows are
  /// accepted; anything unparseable yields null rather than a guess.
  static Duration? _retryAfterOf(Response<Object?> response) {
    final raw = response.headers.value('retry-after')?.trim();
    if (raw == null || raw.isEmpty) return null;

    final seconds = int.tryParse(raw);
    if (seconds != null) return Duration(seconds: seconds.clamp(0, 86400));

    try {
      final wait = HttpDate.parse(raw).difference(DateTime.now().toUtc());
      return wait.isNegative ? Duration.zero : wait;
    } on FormatException {
      // A header this client cannot read is not worth failing over; the caller simply gets
      // no countdown. An error path must never itself throw.
      return null;
    }
  }

  static AppErrorKind _kindFor(int? status, String? code) {
    if (code != null) {
      // The authentication plane first. These are decided before any controller runs, and
      // three of the four are terminal -- answering them with a refresh spends the session's
      // last credential on a request that will refuse identically.
      if (_disabledCodes.contains(code)) return AppErrorKind.accountDisabled;
      if (_revokedCodes.contains(code)) return AppErrorKind.sessionRevoked;
      if (_lockedCodes.contains(code)) return AppErrorKind.accountLocked;

      switch (code) {
        // A login failure, not a session failure. Classified away from `unauthenticated`
        // precisely so the transport does not answer a wrong password with a refresh.
        case AuthErrors.invalidCredentials:
          return AppErrorKind.invalidCredentials;
        // Authenticated but not permitted. Never a reason to sign anybody out.
        case AuthErrors.forbidden:
          return AppErrorKind.forbidden;
        case AuthErrors.unauthenticated:
          return AppErrorKind.unauthenticated;
        case AuthErrors.rateLimited:
          return AppErrorKind.rateLimited;
      }

      // The communication engine's own refusals. These are decided by policy and will fail
      // identically on every attempt, so they must classify as terminal regardless of the
      // status code that carried them — retrying a BR-1 refusal is exactly what §3 forbids.
      if (WireErrors.terminal.contains(code)) {
        return switch (code) {
          WireErrors.conversationNotFound ||
          WireErrors.messageNotFound ||
          // A story that is expired, deleted or was never yours reads the same way to a
          // client: it is not there any more. The viewer distinguishes them by `code` when
          // it needs to; the taxonomy does not have to.
          WireErrors.storyNotFound ||
          WireErrors.storyExpired ||
          WireErrors.storyDeleted => AppErrorKind.notFound,
          WireErrors.emptyMessage ||
          WireErrors.replyTargetCrossConversation => AppErrorKind.validation,
          WireErrors.actorInactive => AppErrorKind.accountDisabled,
          _ => AppErrorKind.forbidden,
        };
      }
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

  /// Read the backend's machine-readable code.
  ///
  /// The communication engine wraps it as `{ error: { code, message } }`; other services may
  /// send it flat. Both shapes are accepted, and anything unexpected yields null rather than
  /// throwing — an error path must never itself throw.
  static String? _codeOf(Object? body) {
    if (body is! Map) return null;

    final nested = body['error'];
    if (nested is Map) {
      final code = nested['code'];
      if (code is String && code.isNotEmpty) return code;
    }

    final flat = body['code'] ?? body['error_code'] ?? nested;
    return flat is String && flat.isNotEmpty ? flat : null;
  }
}
