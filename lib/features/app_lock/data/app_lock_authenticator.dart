import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:local_auth/local_auth.dart';

/// The device's own unlock: Face ID, Touch ID, Android BiometricPrompt, or the device
/// passcode / PIN / pattern as a fallback.
///
/// THE SEAM. Everything app-lock does goes through this, so no test ever reaches the
/// `local_auth` platform channel. The app never sees biometric data -- the platform answers
/// yes or no, and that boolean is all that crosses.
abstract interface class AppLockAuthenticator {
  /// True when the device can authenticate its owner at all: enrolled biometrics OR a
  /// device passcode. False also when the platform cannot be asked.
  Future<bool> isAvailable();

  /// Shows the system prompt. True only for a successful authentication; a cancel, a
  /// failure, a lockout or a platform error is false. Never throws.
  Future<bool> authenticate({required String reason});
}

class LocalAuthAppLockAuthenticator implements AppLockAuthenticator {
  LocalAuthAppLockAuthenticator({LocalAuthentication? plugin})
      : _plugin = plugin ?? LocalAuthentication();

  final LocalAuthentication _plugin;

  @override
  Future<bool> isAvailable() async {
    try {
      // `isDeviceSupported` is "biometrics OR device credentials", which is exactly the
      // owner's rule: a passcode alone is enough, biometrics are not required.
      return await _plugin.isDeviceSupported();
    } catch (_) {
      return false;
    }
  }

  @override
  Future<bool> authenticate({required String reason}) async {
    try {
      return await _plugin.authenticate(
        localizedReason: reason,
        // The passcode is an allowed fallback (owner decision).
        biometricOnly: false,
        // A face match unlocks without a second "confirm" tap on Android.
        sensitiveTransaction: false,
        // Backgrounded mid-prompt is a failed attempt; the lock screen offers Unlock again.
        persistAcrossBackgrounding: false,
      );
    } catch (_) {
      return false;
    }
  }
}

final appLockAuthenticatorProvider = Provider<AppLockAuthenticator>(
  (ref) => LocalAuthAppLockAuthenticator(),
);
