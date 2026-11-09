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

  test('the iOS VoIP push registry exists at launch, not only once Dart starts (LR-13)', () {
    // A VoIP push that relaunches a killed app reaches only a PKPushRegistry made, with
    // its delegate set, before launch finishes. Made later (when Dart asks), the push is
    // never reported to CallKit, iOS terminates the app, and may stop VoIP delivery.
    final delegate = read('ios/Runner/AppDelegate.swift');
    final launch = delegate.indexOf('didFinishLaunchingWithOptions launchOptions');
    expect(launch, isNonNegative);
    final launchEnd = delegate.indexOf('return super.application(application, didFinishLaunchingWithOptions', launch);
    expect(launchEnd, isNonNegative);
    final body = delegate.substring(launch, launchEnd);
    expect(body, contains('PKPushRegistry(queue:'));
    expect(body, contains('registry.delegate = self'));
    expect(body, contains('desiredPushTypes = [.voIP]'));
    expect(body.indexOf('PKPushRegistry(queue:'), lessThan(body.indexOf('ensureEngine()')));

    // Exactly one registry, and registering for push does not make it.
    expect(RegExp(r'PKPushRegistry\(queue:').allMatches(delegate).length, 1);
    // `start` (prompt) and LR-11's `register` (no prompt) both go through
    // registerForPush, so a "Not now" or headless session still gets the VoIP token.
    final start = delegate.indexOf('private func startRegistering()');
    expect(start, isNonNegative);
    final startBody = delegate.substring(start, delegate.indexOf('\n  }\n', start));
    expect(startBody, contains('registerForPush()'));
    final register = delegate.indexOf('private func registerForPush()');
    expect(register, isNonNegative);
    final registerEnd = delegate.indexOf('\n  }\n', register);
    final registerBody = delegate.substring(register, registerEnd);
    expect(registerBody, isNot(contains('PKPushRegistry(')));
    // A token that arrived before Dart asked is handed over when it asks.
    expect(registerBody, contains('voipTokensWanted = true'));
    expect(registerBody, contains('pushToken(for: .voIP)'));
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

  test('iOS declares only the background modes it uses: voip and audio (LR-24)', () {
    // App Review rejects a background mode with no use. The server sends iOS no silent
    // (content-available) push, so remote-notification has none; add it back only with one.
    final plist = read('ios/Runner/Info.plist');
    final start = plist.indexOf('<key>UIBackgroundModes</key>');
    expect(start, isNonNegative);
    final array = plist.substring(start, plist.indexOf('</array>', start));
    final modes = RegExp(r'<string>([^<]+)</string>').allMatches(array).map((m) => m.group(1)).toList();
    expect(modes, ['voip', 'audio']);
  });

  test('the app is held portrait, and only the full-screen board turns (LR-39, PD-55 rev2)', () {
    // The screens were never checked in landscape. Landscape stays allowed in Info.plist
    // (and is not forbidden in the Android manifest) because the full-screen board
    // must be able to turn; the app itself is held portrait from main().
    final main = read('lib/main.dart');
    final binding = main.indexOf('WidgetsFlutterBinding.ensureInitialized();');
    final lock = main.indexOf('await lockAppOrientation();');
    expect(lock, greaterThan(binding));
    expect(main.indexOf('runApp(', lock), isNonNegative);

    // The router must report what lands on top, or a call over the board could turn.
    expect(read('lib/app/router.dart'), contains('observers: [...crashReportingObservers(), orientationObserver]'));

    final board = read('lib/features/whiteboards/presentation/board_editor_screen.dart');
    expect(board, contains('on ? allowBoardFullScreenOrientations() : lockAppOrientation()'));
    final dispose = board.indexOf('void dispose()');
    expect(board.indexOf('lockAppOrientation()', dispose), isNonNegative);

    final plist = read('ios/Runner/Info.plist');
    final start = plist.indexOf('<key>UISupportedInterfaceOrientations</key>');
    final array = plist.substring(start, plist.indexOf('</array>', start));
    expect(array, contains('UIInterfaceOrientationLandscapeLeft'));
    expect(array, contains('UIInterfaceOrientationLandscapeRight'));
  });
}
