import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/wire/wire_vocab.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/error_mapper.dart';

void main() {
  DioException responseWith(int status, Object? body) => DioException(
        requestOptions: RequestOptions(path: '/x'),
        type: DioExceptionType.badResponse,
        response: Response<Object?>(
          requestOptions: RequestOptions(path: '/x'),
          statusCode: status,
          data: body,
        ),
      );

  group('the communication engine error envelope', () {
    test('reads the nested error.code shape the engine actually sends', () {
      final error = ErrorMapper.map(
        responseWith(403, {
          'error': {
            'code': WireErrors.br1TeacherParentDirect,
            'message': 'teacher/parent direct is forbidden',
          },
        }),
      );

      expect(error.code, WireErrors.br1TeacherParentDirect);
      expect(error.kind, AppErrorKind.forbidden);
    });

    test('still reads a flat code from other services', () {
      final error = ErrorMapper.map(responseWith(403, {'code': 'some_flat_code'}));
      expect(error.code, 'some_flat_code');
    });

    test('a BR-1 refusal is never retried', () {
      final error = ErrorMapper.map(
        responseWith(403, {
          'error': {'code': WireErrors.br1TeacherParentDirect},
        }),
      );

      expect(
        error.isTransient,
        isFalse,
        reason: 'a policy refusal will fail identically forever',
      );
    });

    test('every terminal COMM code classifies as non-transient', () {
      for (final code in WireErrors.terminal) {
        final error = ErrorMapper.map(
          responseWith(500, {
            'error': {'code': code},
          }),
        );
        expect(
          error.isTransient,
          isFalse,
          reason: '$code arrived on a 500 but is decided by policy, not load',
        );
      }
    });

    test('a not-found code maps to notFound even on an odd status', () {
      final error = ErrorMapper.map(
        responseWith(400, {
          'error': {'code': WireErrors.conversationNotFound},
        }),
      );
      expect(error.kind, AppErrorKind.notFound);
    });

    test('an inactive actor ends the session', () {
      final error = ErrorMapper.map(
        responseWith(403, {
          'error': {'code': WireErrors.actorInactive},
        }),
      );
      expect(error.kind, AppErrorKind.accountDisabled);
      expect(error.terminatesSession, isTrue);
    });

    test('an empty message is a validation failure, not a refusal', () {
      final error = ErrorMapper.map(
        responseWith(400, {
          'error': {'code': WireErrors.emptyMessage},
        }),
      );
      expect(error.kind, AppErrorKind.validation);
    });
  });

  group('transport failures', () {
    test('a connection error is a network failure and is retryable', () {
      final error = ErrorMapper.map(
        DioException(
          requestOptions: RequestOptions(path: '/x'),
          type: DioExceptionType.connectionError,
        ),
      );
      expect(error.kind, AppErrorKind.network);
      expect(error.isTransient, isTrue);
    });

    test('each timeout variant maps to timeout', () {
      for (final type in [
        DioExceptionType.connectionTimeout,
        DioExceptionType.sendTimeout,
        DioExceptionType.receiveTimeout,
        DioExceptionType.transformTimeout,
      ]) {
        final error = ErrorMapper.map(
          DioException(requestOptions: RequestOptions(path: '/x'), type: type),
        );
        expect(error.kind, AppErrorKind.timeout, reason: type.name);
      }
    });
  });

  group('status codes without a code', () {
    test('401 is unauthenticated and ends the session', () {
      final error = ErrorMapper.map(responseWith(401, null));
      expect(error.kind, AppErrorKind.unauthenticated);
      expect(error.terminatesSession, isTrue);
    });

    test('429 is rate limited and retryable', () {
      expect(ErrorMapper.map(responseWith(429, null)).isTransient, isTrue);
    });

    test('503 is a server error and retryable', () {
      final error = ErrorMapper.map(responseWith(503, null));
      expect(error.kind, AppErrorKind.server);
      expect(error.isTransient, isTrue);
    });
  });

  group('the error path never throws', () {
    test('a non-map body is tolerated', () {
      expect(ErrorMapper.map(responseWith(500, 'plain text')).kind, AppErrorKind.server);
    });

    test('an arbitrary object is classified as unknown', () {
      expect(ErrorMapper.map(StateError('boom')).kind, AppErrorKind.unknown);
    });

    test('an AppError passes through unchanged', () {
      const original = AppError(AppErrorKind.forbidden, code: 'x');
      expect(identical(ErrorMapper.map(original), original), isTrue);
    });
  });
}
