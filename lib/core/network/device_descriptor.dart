import 'dart:io' show Platform;

import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
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

      // PD-28 first: `Platform` is unsupported in a browser and throws on the first read.
      if (kIsWeb) {
        final browser = await _deviceInfo.webBrowserInfo;
        _cached = DeviceDescription(
          // 'web' is what selects the browser session lifetimes (PD-23 session-policy.ts):
          // 12 h / 7 d, or 7 d / 30 d when "keep me signed in" is granted.
          platform: 'web',
          name: browserDeviceLabel(browser.userAgent, platform: browser.platform),
          appVersion: version,
        );
      } else if (Platform.isIOS) {
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
      // `web`, which would be a lie the user would later read off their session list. (The
      // PD-28 web build above is a browser, so for it `web` is the truth.)
    } catch (_) {
      // A plugin that is unavailable must not cost anybody their login.
      _cached = null;
    }
    return _cached;
  }
}

/// PD-28: the name a browser signs in under ("Chrome on macOS"), so Devices & sessions can
/// tell one browser from another. The same rules as Admin Web's `deviceLabel`
/// (`apps/admin-web/src/core/auth/device.ts`), so a teacher's laptop and an administrator's
/// read alike: at most 60 characters, and never a version number -- a label for a person,
/// not a fingerprint.
String browserDeviceLabel(String? userAgent, {String? platform}) {
  final ua = userAgent ?? '';
  final browser = _browserFromUserAgent(ua) ?? 'Web browser';
  final os = _osFromUserAgent(ua) ?? _osFromPlatform(platform);
  final label = os == null ? browser : '$browser on $os';
  return label.length > 60 ? label.substring(0, 60) : label;
}

String? _browserFromUserAgent(String ua) {
  if (RegExp(r'Edg(e|A|iOS)?/').hasMatch(ua)) return 'Edge';
  if (RegExp(r'OPR/|Opera').hasMatch(ua)) return 'Opera';
  if (ua.contains('SamsungBrowser/')) return 'Samsung Internet';
  if (RegExp(r'Firefox/|FxiOS/').hasMatch(ua)) return 'Firefox';
  if (RegExp(r'CriOS/|Chrome/').hasMatch(ua)) return 'Chrome';
  if (ua.contains('Safari/')) return 'Safari';
  return null;
}

String? _osFromUserAgent(String ua) {
  if (ua.contains('iPhone')) return 'iPhone';
  if (ua.contains('iPad')) return 'iPad';
  if (ua.contains('Android')) return 'Android';
  if (ua.contains('Windows')) return 'Windows';
  if (ua.contains('CrOS')) return 'ChromeOS';
  if (RegExp(r'Mac OS X|Macintosh').hasMatch(ua)) return 'macOS';
  if (ua.contains('Linux')) return 'Linux';
  return null;
}

String? _osFromPlatform(String? platform) {
  if (platform == null || platform.isEmpty) return null;
  final p = platform.toLowerCase();
  if (p.contains('mac')) return 'macOS';
  if (p.contains('win')) return 'Windows';
  if (p.contains('android')) return 'Android';
  if (p.contains('chrome os') || p.contains('chromeos') || p.contains('cros')) return 'ChromeOS';
  if (p.contains('ios')) return 'iOS';
  if (p.contains('linux')) return 'Linux';
  return null;
}
