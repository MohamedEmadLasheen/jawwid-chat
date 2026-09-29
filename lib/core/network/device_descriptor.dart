import 'dart:io' show Platform;

import 'package:device_info_plus/device_info_plus.dart';
import 'package:package_info_plus/package_info_plus.dart';

/// What this device calls itself, for `POST /auth/login`.
///
/// The backend stores it on `chat.device` and shows it back to the user when they look at
/// where they are signed in (`AuthService.upsertDevice`, which matches a returning device by
/// `accountId + platform + name` and therefore reuses the row rather than accumulating one
/// per login).
///
/// A seam, like [VoicePlayer] and [StoryVideoPlayer], because both plugins behind it reach a
/// platform channel: a test that constructed the real one would have to stand up a binding
/// to log in.
class DeviceDescription {
  const DeviceDescription({
    required this.platform,
    required this.name,
    required this.appVersion,
  });

  /// `ios` | `android` | `web`, and nothing else — the values `AuthService`'s `PLATFORMS`
  /// set accepts. Anything else is dropped by the server, which would silently cost the user
  /// their device row, so this never invents one.
  final String platform;

  /// Human-readable, e.g. "iPhone 17 Pro". Shown to the user, never used for a decision.
  final String name;

  final String appVersion;

  Map<String, Object?> toWire() => {
        'platform': platform,
        'name': name,
        'appVersion': appVersion,
      };
}

abstract interface class DeviceDescriptor {
  /// Returns null when this build cannot describe itself. Login proceeds without the device
  /// block rather than failing: signing in matters more than naming the handset, and the
  /// server treats `device` as optional.
  Future<DeviceDescription?> describe();
}

/// The real one, over `device_info_plus` and `package_info_plus` — both already dependencies.
class PlatformDeviceDescriptor implements DeviceDescriptor {
  PlatformDeviceDescriptor({DeviceInfoPlugin? deviceInfo})
      : _deviceInfo = deviceInfo ?? DeviceInfoPlugin();

  final DeviceInfoPlugin _deviceInfo;

  /// Resolved once. The answer cannot change while the process lives, and login should not
  /// pay two platform-channel round trips every time a token is exchanged.
  DeviceDescription? _cached;
  bool _resolved = false;

  @override
  Future<DeviceDescription?> describe() async {
    if (_resolved) return _cached;
    _resolved = true;

    try {
      final version = (await PackageInfo.fromPlatform()).version;

      if (Platform.isIOS) {
        final ios = await _deviceInfo.iosInfo;
        _cached = DeviceDescription(
          platform: 'ios',
          name: ios.utsname.machine,
          appVersion: version,
        );
      } else if (Platform.isAndroid) {
        final android = await _deviceInfo.androidInfo;
        _cached = DeviceDescription(
          platform: 'android',
          name: '${android.manufacturer} ${android.model}'.trim(),
          appVersion: version,
        );
      }
      // Any other host — desktop during development — is left null rather than sent as
      // `web`, which would be a lie the user would later read off their session list.
    } catch (_) {
      // A plugin that is unavailable must not cost anybody their login.
      _cached = null;
    }
    return _cached;
  }
}
