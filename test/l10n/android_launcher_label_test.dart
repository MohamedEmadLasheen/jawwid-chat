import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// The Android launcher label is the product's name in the phone's language -- the same
/// name the app itself uses (`appName` in the ARBs) -- and never the package id
/// "jawwid_chat", which is what an Android build showed under its icon until 2026-10-27.
void main() {
  String appName(String arb) =>
      (jsonDecode(File('lib/l10n/$arb').readAsStringSync()) as Map<String, dynamic>)['appName'] as String;

  String label(String values) {
    final xml = File('android/app/src/main/res/$values/strings.xml').readAsStringSync();
    final match = RegExp(r'<string name="app_name">([^<]*)</string>').firstMatch(xml);
    expect(match, isNotNull, reason: '$values/strings.xml has no app_name');
    return match!.group(1)!;
  }

  test('the manifest takes the label from the localized resources', () {
    final manifest = File('android/app/src/main/AndroidManifest.xml').readAsStringSync();
    expect(manifest, contains('android:label="@string/app_name"'));
    expect(manifest, isNot(contains('android:label="jawwid_chat"')));
  });

  test('English (the default) and Arabic say what the app says', () {
    expect(label('values'), appName('app_en.arb'));
    expect(label('values-ar'), appName('app_ar.arb'));
    // The canonical Arabic spelling (see brand_name_test.dart), never the misspelling.
    expect(label('values-ar'), 'جَوِّد');
    expect(label('values-ar'), isNot(contains('جوّيد')));
  });
}
