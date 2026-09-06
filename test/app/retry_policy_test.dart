import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/retry_policy.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';

void main() {
  group('never retried — these fail identically every time', () {
    const terminal = {
      AppErrorKind.forbidden,
      AppErrorKind.unauthenticated,
      AppErrorKind.sessionRevoked,
      AppErrorKind.accountDisabled,
      AppErrorKind.notFound,
      AppErrorKind.validation,
      AppErrorKind.unknown,
    };

    for (final kind in terminal) {
      test('${kind.name} is not retried', () {
        expect(
          JawwidRetryPolicy.retry(0, AppError(kind)),
          isNull,
          reason: 'retrying a ${kind.name} would burn battery for no chance of success',
        );
      });
    }

    test('a policy refusal is not retried even on the first attempt', () {
      // §3: do not attempt to bypass a backend refusal, do not retry indefinitely.
      expect(
        JawwidRetryPolicy.retry(0, const AppError(AppErrorKind.forbidden)),
        isNull,
      );
    });
  });

  group('retried — these may succeed on another attempt', () {
    const transient = {
      AppErrorKind.network,
      AppErrorKind.timeout,
      AppErrorKind.rateLimited,
      AppErrorKind.server,
    };

    for (final kind in transient) {
      test('${kind.name} is retried', () {
        expect(JawwidRetryPolicy.retry(0, AppError(kind)), isNotNull);
      });
    }

    test('backoff grows with each attempt', () {
      final first = JawwidRetryPolicy.retry(0, const AppError(AppErrorKind.network))!;
      final second = JawwidRetryPolicy.retry(1, const AppError(AppErrorKind.network))!;
      final third = JawwidRetryPolicy.retry(2, const AppError(AppErrorKind.network))!;

      expect(second, greaterThan(first));
      expect(third, greaterThan(second));
    });

    test('backoff is capped', () {
      final late_ = JawwidRetryPolicy.retry(4, const AppError(AppErrorKind.network));
      expect(late_, isNotNull);
      expect(late_!, lessThanOrEqualTo(const Duration(seconds: 30)));
    });

    test('retrying stops after the attempt limit', () {
      expect(
        JawwidRetryPolicy.retry(
          JawwidRetryPolicy.maxAttempts,
          const AppError(AppErrorKind.network),
        ),
        isNull,
        reason: 'a long outage must not leave the device retrying forever',
      );
    });
  });

  group('non-AppError inputs', () {
    test('an arbitrary object is classified before being judged', () {
      // Anything unrecognised maps to `unknown`, which is terminal — fail closed.
      expect(JawwidRetryPolicy.retry(0, StateError('boom')), isNull);
    });
  });
}
