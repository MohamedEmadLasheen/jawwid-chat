import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Store payments (owner decision 2026-11-05; docs/release/app-review-notes-payments.md):
/// card (Stripe) and bank-transfer payments stay in the App Store and Google Play
/// builds, for live one-to-one lessons only (App Store 3.1.3(d), Google Play's 1:1
/// online paid services). These read the shipped sources as text, so a change that
/// quietly hides payments in a store build, or that starts recording lessons, fails.
void main() {
  String read(String path) => File(path).readAsStringSync();

  Iterable<File> dartFiles(String dir) => Directory(dir)
      .listSync(recursive: true)
      .whereType<File>()
      .where((f) => f.path.endsWith('.dart'));

  test('the parent billing screens have no platform, release-mode or build-flag gate', () {
    // A store build is a release build on iOS or Android; any of these would let one
    // hide Pay by card or the bank transfer there.
    const gates = [
      'Platform.isIOS',
      'Platform.isAndroid',
      'defaultTargetPlatform',
      'kReleaseMode',
      'fromEnvironment',
      'TargetPlatform.',
    ];
    for (final f in dartFiles('lib/features/billing')) {
      final source = f.readAsStringSync();
      for (final g in gates) {
        expect(source.contains(g), isFalse, reason: '${f.path} uses $g');
      }
    }
  });

  test('the store build script defines nothing that could switch payments off', () {
    final defines = RegExp(r'--dart-define=(\w+)=')
        .allMatches(read('scripts/mobile/build-store.sh'))
        .map((m) => m.group(1)!)
        .toSet();
    expect(defines, {
      'JAWWID_API_BASE_URL',
      'PRIVACY_POLICY_URL',
      'TERMS_URL',
      'JAWWID_LESSONS_ORIGIN',
      'SENTRY_DSN',
      'SENTRY_ENVIRONMENT',
    });
  });

  test('no lesson call is recorded: the app has no LiveKit egress or call recording', () {
    // Google Play's 1:1 rule: the session "is not recorded and cannot be accessed or
    // used again". Voice notes in chat (lib/core/audio/voice_recorder.dart) are
    // messages, not calls; nothing in the call code records.
    for (final f in [...dartFiles('lib/features/calls'), ...dartFiles('lib/core/call_media')]) {
      final source = f.readAsStringSync();
      expect(RegExp(r'[Ee]gress|startRecording|MediaRecorder').hasMatch(source), isFalse, reason: f.path);
    }
  });
}
