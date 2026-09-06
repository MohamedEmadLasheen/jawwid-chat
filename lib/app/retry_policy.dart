import 'dart:math' as math;

import '../core/errors/app_error.dart';
import '../core/network/error_mapper.dart';

/// How a failed provider is retried.
///
/// Riverpod retries a failed provider automatically. Left at its default that is wrong for
/// this product: a `403` from the communication policy, a validation failure, or a revoked
/// session will fail identically on every attempt, so retrying them burns battery and data
/// on exactly the low-end devices and slow networks this app targets — and §3 explicitly
/// forbids retrying a backend refusal.
///
/// Returning `null` means "do not retry".
abstract final class JawwidRetryPolicy {
  /// Stop after this many attempts even for a transient failure, so a long outage does not
  /// leave a device retrying forever.
  static const maxAttempts = 5;

  static const _base = Duration(milliseconds: 400);
  static const _cap = Duration(seconds: 30);

  static Duration? retry(int retryCount, Object error) {
    final failure = error is AppError ? error : ErrorMapper.map(error);

    // A refusal, a validation error, or an ended session is terminal.
    if (!failure.isTransient) return null;
    if (retryCount >= maxAttempts) return null;

    final millis = _base.inMilliseconds * math.pow(2, retryCount);
    return Duration(
      milliseconds: math.min(millis, _cap.inMilliseconds.toDouble()).round(),
    );
  }

  /// Exposed so tests and `main()` configure the container identically.
  ///
  /// Typed structurally rather than as Riverpod's `Retry`, which the package does not
  /// export from its public entrypoints.
  static Duration? Function(int, Object) get policy => retry;
}
