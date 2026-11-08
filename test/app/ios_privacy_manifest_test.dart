import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// LR-73 (store compliance): the iOS privacy manifest must declare every data type the
/// App Privacy label declares (docs/release/store-console/apple-app-privacy.md), each
/// linked to the person and none used for tracking.
///
/// These read ios/Runner/PrivacyInfo.xcprivacy as text, like store_submission_config_test.dart.
void main() {
  const app = 'NSPrivacyCollectedDataTypePurposeAppFunctionality';
  const analytics = 'NSPrivacyCollectedDataTypePurposeAnalytics';

  /// Every collected type, with the purposes the label draft gives it.
  const expected = <String, Set<String>>{
    'NSPrivacyCollectedDataTypeName': {app},
    'NSPrivacyCollectedDataTypeEmailAddress': {app},
    'NSPrivacyCollectedDataTypePhoneNumber': {app},
    'NSPrivacyCollectedDataTypeOtherFinancialInfo': {app},
    'NSPrivacyCollectedDataTypeCoarseLocation': {app},
    'NSPrivacyCollectedDataTypeEmailsOrTextMessages': {app},
    'NSPrivacyCollectedDataTypePhotosorVideos': {app},
    'NSPrivacyCollectedDataTypeAudioData': {app},
    'NSPrivacyCollectedDataTypeCustomerSupport': {app},
    'NSPrivacyCollectedDataTypeOtherUserContent': {app},
    'NSPrivacyCollectedDataTypeUserID': {app},
    'NSPrivacyCollectedDataTypeDeviceID': {app},
    'NSPrivacyCollectedDataTypePurchaseHistory': {app},
    'NSPrivacyCollectedDataTypeProductInteraction': {app, analytics},
    'NSPrivacyCollectedDataTypeCrashData': {app},
    'NSPrivacyCollectedDataTypeOtherDiagnosticData': {app},
  };

  final raw = File('ios/Runner/PrivacyInfo.xcprivacy').readAsStringSync();
  // Comments may mention any key; only the property list itself counts.
  final manifest = raw.replaceAll(RegExp(r'<!--.*?-->', dotAll: true), '');

  /// The NSPrivacyCollectedDataTypes array: from its key to the next top-level key.
  String collectedSection() {
    const key = '<key>NSPrivacyCollectedDataTypes</key>';
    final start = manifest.indexOf(key);
    expect(start, isNonNegative, reason: 'NSPrivacyCollectedDataTypes is missing');
    final end = manifest.indexOf('<key>NSPrivacyAccessedAPITypes</key>', start);
    expect(end, greaterThan(start), reason: 'NSPrivacyAccessedAPITypes must follow the collected types');
    return manifest.substring(start + key.length, end);
  }

  /// One entry per collected type: its dictionary's text, by type name.
  Map<String, String> entries() {
    final out = <String, String>{};
    for (final m in RegExp(r'<dict>(.*?)</dict>', dotAll: true).allMatches(collectedSection())) {
      final body = m[1]!;
      final type = RegExp(r'<key>NSPrivacyCollectedDataType</key>\s*<string>(\w+)</string>').firstMatch(body);
      expect(type, isNotNull, reason: 'an entry has no NSPrivacyCollectedDataType: $body');
      expect(out.containsKey(type![1]), isFalse, reason: '${type[1]} is declared twice');
      out[type[1]!] = body;
    }
    return out;
  }

  test('the manifest is balanced property-list XML', () {
    for (final tag in ['plist', 'dict', 'array']) {
      final open = RegExp('<$tag[ >]').allMatches(manifest).length;
      final close = '</$tag>'.allMatches(manifest).length;
      expect(open, close, reason: '<$tag> opened $open times, closed $close times');
    }
    // Every <key> is followed by a value, never by another key.
    expect(RegExp(r'</key>\s*<key>').hasMatch(manifest), isFalse);
  });

  test('the app does not track', () {
    expect(RegExp(r'<key>NSPrivacyTracking</key>\s*<false/>').hasMatch(manifest), isTrue);
    expect(RegExp(r'<key>NSPrivacyTrackingDomains</key>\s*<array/>').hasMatch(manifest), isTrue);
  });

  test('every data type the App Privacy label declares is in the manifest, and nothing else', () {
    expect(entries().keys.toSet(), expected.keys.toSet());
  });

  for (final type in expected.keys) {
    test('$type is linked, not for tracking, with the label\'s purposes', () {
      final body = entries()[type];
      expect(body, isNotNull, reason: '$type is not declared');
      expect(RegExp(r'<key>NSPrivacyCollectedDataTypeLinked</key>\s*<true/>').hasMatch(body!), isTrue,
          reason: '$type must be linked to the person');
      expect(RegExp(r'<key>NSPrivacyCollectedDataTypeTracking</key>\s*<false/>').hasMatch(body), isTrue,
          reason: '$type must not be used for tracking');
      final purposes = RegExp(r'<key>NSPrivacyCollectedDataTypePurposes</key>\s*<array>(.*?)</array>', dotAll: true)
          .firstMatch(body);
      expect(purposes, isNotNull, reason: '$type has no purposes');
      final declared = RegExp(r'<string>(\w+)</string>').allMatches(purposes![1]!).map((m) => m[1]!).toSet();
      expect(declared, expected[type]);
    });
  }

  test('no collected type is marked for tracking', () {
    final section = collectedSection();
    expect(RegExp(r'<key>NSPrivacyCollectedDataTypeTracking</key>\s*<true/>').hasMatch(section), isFalse);
    expect('<key>NSPrivacyCollectedDataTypeTracking</key>'.allMatches(section).length, expected.length);
  });
}
