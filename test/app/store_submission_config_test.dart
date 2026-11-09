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

  // LR-46 P3-13: Android 12+ device-to-device transfer ignores allowBackup="false";
  // only dataExtractionRules stops it.
  test('Android 12+ excludes every data domain from cloud backup and device transfer', () {
    final manifest = read('android/app/src/main/AndroidManifest.xml');
    final application = RegExp(r'<application\b[^>]*>').firstMatch(manifest)!.group(0)!;
    expect(application, contains('android:allowBackup="false"'));
    expect(application, contains('android:dataExtractionRules="@xml/data_extraction_rules"'));

    final rules = read('android/app/src/main/res/xml/data_extraction_rules.xml');
    expect(rules, isNot(contains('<include')), reason: 'nothing is opted back in');
    const domains = [
      'root', 'file', 'database', 'sharedpref', 'external',
      'device_root', 'device_file', 'device_database', 'device_sharedpref',
    ];
    for (final section in ['cloud-backup', 'device-transfer']) {
      final body = RegExp('<$section>(.*?)</$section>', dotAll: true).firstMatch(rules);
      expect(body, isNotNull, reason: '<$section> is present');
      for (final domain in domains) {
        expect(body!.group(1), contains('<exclude domain="$domain" path="." />'),
            reason: '<$section> excludes all of $domain');
      }
    }
  });

  test('the call foreground service is typed microphone only, with no phoneCall (Play FGS policy, LR-14)', () {
    final manifest = read('android/app/src/main/AndroidManifest.xml');
    expect(manifest, contains('android:foregroundServiceType="microphone"'));
    expect(manifest, contains('android.permission.FOREGROUND_SERVICE_MICROPHONE'));
    expect(manifest, isNot(contains('phoneCall')));
    expect(manifest, isNot(contains('FOREGROUND_SERVICE_PHONE_CALL')));
    expect(manifest, isNot(contains('MANAGE_OWN_CALLS')));
    final service = read('android/app/src/main/kotlin/com/jawwid/jawwid_chat/CallForegroundService.kt');
    expect(service, isNot(contains('FOREGROUND_SERVICE_TYPE_PHONE_CALL')));
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
