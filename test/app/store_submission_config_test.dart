import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// PD-56 (store compliance): what a store build declares must match what it does.
///
/// These read the shipped configuration files as text. They guard the gaps a
/// review would reject or a privacy label would misstate, not the app's behaviour.
void main() {
  String read(String path) => File(path).readAsStringSync();

  test('the iOS privacy manifest declares crash data, because the app ships Sentry', () {
    // lib/core/crash/crash_reporting.dart sends crash reports (with a hashed actor id)
    // off the device in a release build with a DSN. Apple's privacy label calls that
    // Diagnostics > Crash Data; the manifest is what App Store Connect checks it against.
    expect(read('pubspec.yaml'), contains('sentry_flutter:'));
    final manifest = read('ios/Runner/PrivacyInfo.xcprivacy');
    expect(manifest, contains('<string>NSPrivacyCollectedDataTypeCrashData</string>'));
  });

  test('the store build script compiles in the crash-reporting DSN when it is given', () {
    // build-store.sh is the only way a store binary is built (docs/mobile/store-builds.md).
    // Without passing SENTRY_DSN through, crash reporting is silently off in every store build.
    final script = read('scripts/mobile/build-store.sh');
    expect(script, contains('--dart-define=SENTRY_DSN='));
    expect(script, contains('--dart-define=SENTRY_ENVIRONMENT='));
  });

  test('iOS asks for notification authorization when push registration starts', () {
    // A standard APNs token without authorization delivers nothing visible: no banner,
    // sound or badge. registerForRemoteNotifications alone is not enough.
    final delegate = read('ios/Runner/AppDelegate.swift');
    expect(delegate, contains('import UserNotifications'));
    final start = delegate.indexOf('private func startRegistering()');
    expect(start, isNonNegative);
    expect(delegate.indexOf('requestAuthorization(options:', start), isNonNegative);
  });

  test('Android keeps the session off cloud backup', () {
    expect(read('android/app/src/main/AndroidManifest.xml'), contains('android:allowBackup="false"'));
  });

  test('iOS can save an exported board picture to Photos without being terminated', () {
    // A PNG export goes to the share sheet (board_export.dart), whose "Save Image" adds it
    // to Photos. Without this key iOS terminates the app at that tap.
    expect(read('ios/Runner/Info.plist'), contains('<key>NSPhotoLibraryAddUsageDescription</key>'));
  });

  test('every iOS permission prompt has its English and Arabic text', () {
    final keys = RegExp(r'<key>(NS\w+UsageDescription)</key>')
        .allMatches(read('ios/Runner/Info.plist'))
        .map((m) => m[1]!)
        .toList();
    expect(keys, isNotEmpty);
    for (final lang in ['en', 'ar']) {
      final strings = read('ios/Runner/$lang.lproj/InfoPlist.strings');
      for (final key in keys) {
        expect(strings, contains('"$key" = "'), reason: '$lang.lproj lacks $key');
      }
    }
  });

  test('a duplicate VoIP push is still reported to CallKit', () {
    // iOS terminates an app that returns from a VoIP delivery without reporting a call.
    final bridge = read('ios/Runner/CallKitBridge.swift');
    final dup = bridge.indexOf('if let existing = uuidByCall[callId]');
    expect(dup, isNonNegative);
    final reported = bridge.indexOf('reportNewIncomingCall(with: existing', dup);
    expect(reported, isNonNegative);
    expect(reported - dup, lessThan(400));
  });
}
