import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Opens the phone's own screen where the owner adds a fingerprint or a screen lock. That
/// is what the App lock hint asks them to do when the device can authenticate nobody.
///
/// THE SEAM. No test reaches the platform channel. Android only. iOS has no public way to
/// open Face ID & Passcode (app-settings: lands on this app's own page, which has neither),
/// so iOS shows the hint alone.
abstract interface class DeviceSecuritySettings {
  /// True when the screen was opened. False on a platform without one, or when nothing
  /// on the phone answered.
  Future<bool> open();
}

/// [DeviceSecuritySettings] over the channel `MainActivity.kt` answers. On Android 11+ it
/// is the biometric enrolment screen (fingerprint or screen lock, the strength app lock
/// accepts). Before that, or on a phone without that screen, it is Security settings, then
/// Settings itself.
///
/// WHAT IS NOT VERIFIED. The Kotlin half is compiled only by an Android build. CI has no
/// Android toolchain, and no build was run for this change, so the first proof is a QA APK.
class PlatformDeviceSecuritySettings implements DeviceSecuritySettings {
  const PlatformDeviceSecuritySettings({MethodChannel? channel})
      : _channel = channel ?? const MethodChannel(channelName);

  /// Shared with `MainActivity.kt`. A mismatch is a silent no-op, so it is one constant.
  static const channelName = 'jawwid/device_security_settings';

  final MethodChannel _channel;

  @override
  Future<bool> open() async {
    try {
      return await _channel.invokeMethod<bool>('openSecuritySettings') ?? false;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      // iOS, the web portal, a test: nothing answers, and the hint stands alone.
      return false;
    }
  }
}

final deviceSecuritySettingsProvider = Provider<DeviceSecuritySettings>(
  (ref) => const PlatformDeviceSecuritySettings(),
);
