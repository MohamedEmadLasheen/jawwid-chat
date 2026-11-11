// W56: scripts/mobile/verify-store-artifact.sh reads the release evidence from the SIGNED store
// artifacts before .github/workflows/release-store-builds.yml uploads them (LR-50, LR-51, LR-52,
// LR-58, LR-73). These tests run the real script with bash against stand-in tools first on PATH:
//   - `java` answers bundletool's `dump manifest --xpath` from a key=value fixture;
//   - `unzip` copies a fixture lib/ tree where the bundle's native libraries would be;
//   - `readelf` prints one LOAD line per alignment written in the fixture library;
//   - `plutil` answers `-extract <key path> raw` and `-lint` from key=value fixtures.
// They check every PASS and every FAIL the workflow relies on (a failure exits 1, so nothing is
// uploaded), that an alignment value is never evaluated as shell arithmetic, and that the helper's
// expectations stay in step with ios/Runner (PrivacyInfo.xcprivacy, Info.plist).
// scripts/mobile/install-bundletool.sh refuses a download that does not match its pinned SHA-256.
//
// Needs bash and the usual text tools (awk, sed, grep, find, sort, diff, mktemp) on PATH.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

const _script = 'scripts/mobile/verify-store-artifact.sh';

const _fakeJava = r'''#!/usr/bin/env bash
[ -z "${FAKE_JAVA_FAIL:-}" ] || exit 3
x=''
for a in "$@"; do case "$a" in --xpath=*) x="${a#--xpath=}" ;; esac; done
while IFS= read -r l; do [ "${l%%=*}" = "$x" ] && printf '%s\n' "${l#*=}"; done < "$FAKE_DIR/manifest.txt"
exit 0
''';

const _fakeUnzip = r'''#!/usr/bin/env bash
d=''
while [ $# -gt 0 ]; do [ "$1" = -d ] && { shift; d="$1"; }; shift; done
[ -d "$FAKE_DIR/libs" ] || exit 11
mkdir -p "$d/base/lib" && cp -R "$FAKE_DIR/libs/." "$d/base/lib/"
''';

const _fakeReadelf = r'''#!/usr/bin/env bash
f="${@: -1}"
for a in $(cat "$f"); do printf '  LOAD 0x000000 0x0000000000000000 0x0000000000000000 0x001000 0x001000 R E %s\n' "$a"; done
''';

const _fakePlutil = r'''#!/usr/bin/env bash
if [ "$1" = -lint ]; then grep -q BROKEN "$2" && exit 1; exit 0; fi
key="$2"; file="${@: -1}"
while IFS= read -r l; do [ "${l%%=*}" = "$key" ] && { printf '%s\n' "${l#*=}"; exit 0; }; done < "$file"
exit 1
''';

const _goodManifest = '''
/manifest/@package=com.jawwid.jawwid_chat
/manifest/@android:versionName=1.2.3
/manifest/@android:versionCode=45
/manifest/uses-sdk/@android:targetSdkVersion=36
/manifest/uses-sdk/@android:minSdkVersion=26
/manifest/uses-permission/@android:name=android.permission.INTERNET
/manifest/uses-permission/@android:name=android.permission.RECORD_AUDIO
/manifest/uses-permission/@android:name=android.permission.POST_NOTIFICATIONS
''';

const _goodInfo = '''
DTXcode=2610
DTSDKName=iphoneos26.1
ITSAppUsesNonExemptEncryption=false
UIBackgroundModes.0=voip
UIBackgroundModes.1=audio
''';

const _collected = '''
NSPrivacyCollectedDataTypes.0.NSPrivacyCollectedDataType=NSPrivacyCollectedDataTypeName
NSPrivacyCollectedDataTypes.1.NSPrivacyCollectedDataType=NSPrivacyCollectedDataTypeEmailAddress
NSPrivacyCollectedDataTypes.2.NSPrivacyCollectedDataType=NSPrivacyCollectedDataTypeCrashData
''';

const _goodPrivacy = '''
NSPrivacyTracking=false
NSPrivacyAccessedAPITypes.0.NSPrivacyAccessedAPIType=NSPrivacyAccessedAPICategoryUserDefaults
NSPrivacyAccessedAPITypes.0.NSPrivacyAccessedAPITypeReasons.0=CA92.1
NSPrivacyAccessedAPITypes.1.NSPrivacyAccessedAPIType=NSPrivacyAccessedAPICategoryFileTimestamp
NSPrivacyAccessedAPITypes.1.NSPrivacyAccessedAPITypeReasons.0=C617.1
NSPrivacyAccessedAPITypes.2.NSPrivacyAccessedAPIType=NSPrivacyAccessedAPICategorySystemBootTime
NSPrivacyAccessedAPITypes.2.NSPrivacyAccessedAPITypeReasons.0=35F9.1
$_collected''';

void main() {
  late Directory tmp;

  void exe(String name, String body) {
    final f = File('${tmp.path}/bin/$name')..createSync(recursive: true);
    f.writeAsStringSync(body);
    expect(Process.runSync('chmod', ['+x', f.path]).exitCode, 0);
  }

  setUp(() {
    tmp = Directory.systemTemp.createTempSync('jawwid-store-evidence-');
    exe('java', _fakeJava);
    exe('unzip', _fakeUnzip);
    exe('readelf', _fakeReadelf);
    exe('plutil', _fakePlutil);
  });
  tearDown(() => tmp.deleteSync(recursive: true));

  ProcessResult run(List<String> args, {Map<String, String> env = const {}}) => Process.runSync(
        'bash',
        [_script, ...args],
        environment: {
          'PATH': '${tmp.path}/bin:${Platform.environment['PATH'] ?? '/usr/bin:/bin'}',
          'FAKE_DIR': tmp.path,
          ...env,
        },
        includeParentEnvironment: false,
      );

  // ------------------------------------------------------------ Android
  /// The good bundle: arm64-v8a and x86_64 at 16 KB, armeabi-v7a at 4 KB (reported only).
  void android({String manifest = _goodManifest, Map<String, String>? libs}) {
    File('${tmp.path}/manifest.txt').writeAsStringSync(manifest);
    File('${tmp.path}/app-release.aab').writeAsStringSync('stand-in bundle');
    File('${tmp.path}/bundletool.jar').writeAsStringSync('stand-in jar');
    final l = libs ??
        {
          'arm64-v8a/libflutter.so': '0x4000 0x4000',
          'arm64-v8a/libapp.so': '0x4000 0x10000',
          'x86_64/libflutter.so': '0x4000',
          'x86_64/libapp.so': '0x4000',
          'armeabi-v7a/libflutter.so': '0x1000',
        };
    for (final e in l.entries) {
      File('${tmp.path}/libs/${e.key}')
        ..createSync(recursive: true)
        ..writeAsStringSync(e.value);
    }
  }

  ProcessResult runAndroid({String name = '1.2.3', String number = '45', Map<String, String> env = const {}}) =>
      run(['android', '${tmp.path}/app-release.aab', '${tmp.path}/bundletool.jar', name, number], env: env);

  String out(ProcessResult r) => '${r.stdout}${r.stderr}';

  /// The table row for a check, or '' if there is none.
  String rowFor(ProcessResult r, String check) =>
      '${r.stdout}'.split('\n').firstWhere((l) => l.startsWith('| $check |'), orElse: () => '');

  void expectRow(ProcessResult r, String check, String result) {
    final row = rowFor(r, check);
    expect(row, isNotEmpty, reason: 'no row for "$check" in:\n${out(r)}');
    expect(row.trimRight(), endsWith('| $result |'), reason: row);
  }

  test('a good signed App Bundle passes, with a Markdown evidence table', () {
    android();
    final r = runAndroid();
    expect(r.exitCode, 0, reason: out(r));
    expect('${r.stdout}', contains('| check | expected | found | result |'));
    expectRow(r, 'package', 'PASS');
    expectRow(r, 'versionName', 'PASS');
    expectRow(r, 'versionCode', 'PASS');
    expectRow(r, 'LR-50 targetSdkVersion', 'PASS');
    expectRow(r, 'LR-50 minSdkVersion', 'PASS');
    expectRow(r, 'Data safety: no AD_ID permission', 'PASS');
    expectRow(r, 'LR-51 ELF alignment, 64-bit', 'PASS');
    expect(rowFor(r, 'LR-51 ELF alignment, 64-bit'), contains('4 libraries, smallest p_align 16384'));
    expectRow(r, 'arm64-v8a Flutter libraries', 'PASS');
    // 32-bit libraries are outside Play's 16 KB rule: reported, never failed.
    expectRow(r, '32-bit libraries (not covered by the 16 KB rule)', 'INFO');
    expect('${r.stdout}', contains('Every check passed.'));
    expect('${r.stdout}', isNot(contains('FAIL')));
  });

  final androidFailures = <String, (String, Map<String, String>?, String)>{
    'targetSdk 35': (_goodManifest.replaceFirst('targetSdkVersion=36', 'targetSdkVersion=35'), null, 'LR-50 targetSdkVersion'),
    'no targetSdk in the manifest': (_goodManifest.replaceFirst('/manifest/uses-sdk/@android:targetSdkVersion=36\n', ''), null, 'LR-50 targetSdkVersion'),
    'minSdk 24': (_goodManifest.replaceFirst('minSdkVersion=26', 'minSdkVersion=24'), null, 'LR-50 minSdkVersion'),
    'another package': (_goodManifest.replaceFirst('=com.jawwid.jawwid_chat', '=com.example.other'), null, 'package'),
    'another versionCode': (_goodManifest.replaceFirst('versionCode=45', 'versionCode=44'), null, 'versionCode'),
    'the AD_ID permission': ('$_goodManifest/manifest/uses-permission/@android:name=com.google.android.gms.permission.AD_ID\n', null, 'Data safety: no AD_ID permission'),
    'AD_ID through uses-permission-sdk-23': ('$_goodManifest/manifest/uses-permission-sdk-23/@android:name=com.google.android.gms.permission.AD_ID\n', null, 'Data safety: no AD_ID permission'),
    'a permission dump without INTERNET (not trusted)': (_goodManifest.replaceFirst('/manifest/uses-permission/@android:name=android.permission.INTERNET\n', ''), null, 'Data safety: no AD_ID permission'),
    'a 64-bit library at 4 KB': (_goodManifest, {'arm64-v8a/libflutter.so': '0x4000', 'arm64-v8a/libapp.so': '0x4000 0x1000'}, 'LR-51 ELF alignment, 64-bit'),
    'an x86_64 library at 4 KB': (_goodManifest, {'arm64-v8a/libflutter.so': '0x4000', 'arm64-v8a/libapp.so': '0x4000', 'x86_64/libapp.so': '0x1000'}, 'LR-51 ELF alignment, 64-bit'),
    'an unknown ABI at 4 KB (treated as 64-bit)': (_goodManifest, {'arm64-v8a/libflutter.so': '0x4000', 'arm64-v8a/libapp.so': '0x4000', 'riscv64/libapp.so': '0x1000'}, 'LR-51 ELF alignment, 64-bit'),
    'no native library at all': (_goodManifest, <String, String>{}, 'LR-51 ELF alignment, 64-bit'),
    'only 32-bit libraries': (_goodManifest, {'armeabi-v7a/libflutter.so': '0x4000', 'armeabi-v7a/libapp.so': '0x4000'}, 'LR-51 ELF alignment, 64-bit'),
    'no arm64-v8a libapp.so': (_goodManifest, {'arm64-v8a/libflutter.so': '0x4000', 'x86_64/libapp.so': '0x4000'}, 'arm64-v8a Flutter libraries'),
    'a library whose LOAD segments cannot be read': (_goodManifest, {'arm64-v8a/libflutter.so': '0x4000', 'arm64-v8a/libapp.so': ''}, 'LR-51 ELF alignment'),
  };
  for (final e in androidFailures.entries) {
    test('Android FAILS (exit 1) on ${e.key}', () {
      final (manifest, libs, check) = e.value;
      android(manifest: manifest, libs: libs);
      final r = runAndroid();
      expect(r.exitCode, 1, reason: out(r));
      expectRow(r, check, 'FAIL');
      expect('${r.stdout}', contains('A check FAILED: nothing is uploaded.'));
    });
  }

  test('Android FAILS when bundletool cannot read the bundle', () {
    android();
    final r = runAndroid(env: {'FAKE_JAVA_FAIL': '1'});
    expect(r.exitCode, 1, reason: out(r));
    expectRow(r, 'LR-50 targetSdkVersion', 'FAIL');
    expectRow(r, 'Data safety: no AD_ID permission', 'FAIL');
  });

  test('an alignment value is never evaluated as shell arithmetic', () {
    final marker = '${tmp.path}/evaluated';
    android(libs: {
      'arm64-v8a/libflutter.so': '0x4000',
      'arm64-v8a/libapp.so': 'x[\$(touch\${IFS}$marker)]',
    });
    final r = runAndroid();
    expect(r.exitCode, 1, reason: out(r));
    expectRow(r, 'LR-51 ELF alignment, 64-bit', 'FAIL');
    expect(File(marker).existsSync(), isFalse, reason: 'a LOAD alignment value was evaluated');
  });

  test('a missing App Bundle or bundletool jar fails; bad arguments are refused', () {
    android();
    var r = run(['android', '${tmp.path}/none.aab', '${tmp.path}/bundletool.jar', '1.2.3', '45']);
    expect(r.exitCode, 1, reason: out(r));
    expectRow(r, 'App Bundle', 'FAIL');
    r = run(['android', '${tmp.path}/app-release.aab', '${tmp.path}/none.jar', '1.2.3', '45']);
    expect(r.exitCode, 1, reason: out(r));
    expectRow(r, 'bundletool', 'FAIL');
    expect(runAndroid(name: '1.2').exitCode, 2);
    expect(runAndroid(number: '0').exitCode, 2);
    expect(run(['android']).exitCode, 2);
    expect(run(['web', 'x']).exitCode, 2);
  });

  // ------------------------------------------------------------ iOS
  late String app;
  late String source;

  void ios({String info = _goodInfo, String? privacy = _goodPrivacy, String sourcePrivacy = _goodPrivacy}) {
    app = '${tmp.path}/Payload/Runner.app';
    Directory(app).createSync(recursive: true);
    File('$app/Info.plist').writeAsStringSync(info);
    if (privacy != null) File('$app/PrivacyInfo.xcprivacy').writeAsStringSync(privacy);
    source = '${tmp.path}/source/PrivacyInfo.xcprivacy';
    File(source)
      ..createSync(recursive: true)
      ..writeAsStringSync(sourcePrivacy);
  }

  ProcessResult runIos() => run(['ios', app, source]);

  test('a good signed iOS app passes, with a Markdown evidence table', () {
    ios();
    final r = runIos();
    expect(r.exitCode, 0, reason: out(r));
    expectRow(r, 'LR-52 DTXcode', 'PASS');
    expectRow(r, 'LR-52 DTSDKName', 'PASS');
    expectRow(r, 'ITSAppUsesNonExemptEncryption', 'PASS');
    expectRow(r, 'UIBackgroundModes (exactly)', 'PASS');
    expectRow(r, 'LR-58 PrivacyInfo.xcprivacy', 'PASS');
    expectRow(r, 'LR-58 NSPrivacyTracking', 'PASS');
    expectRow(r, 'LR-58 required-reason APIs', 'PASS');
    expectRow(r, 'LR-73 collected data types', 'PASS');
    expect('${r.stdout}', contains('Every check passed.'));
    expect('${r.stdout}', isNot(contains('FAIL')));
  });

  final iosFailures = <String, (String, String?, String, String)>{
    'Xcode 16 (DTXcode 1640)': (_goodInfo.replaceFirst('DTXcode=2610', 'DTXcode=1640'), _goodPrivacy, _goodPrivacy, 'LR-52 DTXcode'),
    'no DTXcode': (_goodInfo.replaceFirst('DTXcode=2610\n', ''), _goodPrivacy, _goodPrivacy, 'LR-52 DTXcode'),
    'the iOS 18 SDK': (_goodInfo.replaceFirst('iphoneos26.1', 'iphoneos18.2'), _goodPrivacy, _goodPrivacy, 'LR-52 DTSDKName'),
    'a simulator SDK': (_goodInfo.replaceFirst('iphoneos26.1', 'iphonesimulator26.1'), _goodPrivacy, _goodPrivacy, 'LR-52 DTSDKName'),
    'encryption not declared': (_goodInfo.replaceFirst('ITSAppUsesNonExemptEncryption=false\n', ''), _goodPrivacy, _goodPrivacy, 'ITSAppUsesNonExemptEncryption'),
    'encryption declared true': (_goodInfo.replaceFirst('ITSAppUsesNonExemptEncryption=false', 'ITSAppUsesNonExemptEncryption=true'), _goodPrivacy, _goodPrivacy, 'ITSAppUsesNonExemptEncryption'),
    'an extra background mode': ('${_goodInfo}UIBackgroundModes.2=fetch\n', _goodPrivacy, _goodPrivacy, 'UIBackgroundModes (exactly)'),
    'a missing background mode': (_goodInfo.replaceFirst('UIBackgroundModes.1=audio\n', ''), _goodPrivacy, _goodPrivacy, 'UIBackgroundModes (exactly)'),
    'a repeated background mode': (_goodInfo.replaceFirst('UIBackgroundModes.1=audio', 'UIBackgroundModes.1=voip'), _goodPrivacy, _goodPrivacy, 'UIBackgroundModes (exactly)'),
    'no privacy manifest in the app': (_goodInfo, null, _goodPrivacy, 'LR-58 PrivacyInfo.xcprivacy'),
    'a privacy manifest that fails lint': (_goodInfo, '${_goodPrivacy}BROKEN\n', _goodPrivacy, 'LR-58 PrivacyInfo.xcprivacy'),
    'tracking declared': (_goodInfo, _goodPrivacy.replaceFirst('NSPrivacyTracking=false', 'NSPrivacyTracking=true'), _goodPrivacy, 'LR-58 NSPrivacyTracking'),
    'a required-reason category missing': (_goodInfo, _goodPrivacy.replaceFirst('APICategorySystemBootTime', 'APICategoryDiskSpace'), _goodPrivacy, 'LR-58 required-reason APIs'),
    'a required reason replaced': (_goodInfo, _goodPrivacy.replaceFirst('=CA92.1', '=1C8F.1'), _goodPrivacy, 'LR-58 required-reason APIs'),
    'an accessed-API entry with no reason': (_goodInfo, '${_goodPrivacy}NSPrivacyAccessedAPITypes.3.NSPrivacyAccessedAPIType=NSPrivacyAccessedAPICategoryDiskSpace\n', _goodPrivacy, 'LR-58 required-reason APIs'),
    'a collected type missing from the app': (_goodInfo, _goodPrivacy.replaceFirst('NSPrivacyCollectedDataTypes.2.NSPrivacyCollectedDataType=NSPrivacyCollectedDataTypeCrashData\n', ''), _goodPrivacy, 'LR-73 collected data types'),
    'a collected type the source does not declare': (_goodInfo, '${_goodPrivacy}NSPrivacyCollectedDataTypes.3.NSPrivacyCollectedDataType=NSPrivacyCollectedDataTypePreciseLocation\n', _goodPrivacy, 'LR-73 collected data types'),
  };
  for (final e in iosFailures.entries) {
    test('iOS FAILS (exit 1) on ${e.key}', () {
      final (info, privacy, sourcePrivacy, check) = e.value;
      ios(info: info, privacy: privacy, sourcePrivacy: sourcePrivacy);
      final r = runIos();
      expect(r.exitCode, 1, reason: out(r));
      expectRow(r, check, 'FAIL');
      expect('${r.stdout}', contains('A check FAILED: nothing is uploaded.'));
    });
  }

  test('iOS FAILS without an Info.plist, or without the source manifest', () {
    ios();
    File('$app/Info.plist').deleteSync();
    var r = runIos();
    expect(r.exitCode, 1, reason: out(r));
    expectRow(r, 'Info.plist', 'FAIL');
    ios();
    File(source).deleteSync();
    r = runIos();
    expect(r.exitCode, 1, reason: out(r));
    expectRow(r, 'LR-73 collected data types', 'FAIL');
  });

  // ------------------------------------------------------------ in step with the app
  test("the helper's required-reason APIs are the ones ios/Runner/PrivacyInfo.xcprivacy declares", () {
    final helper = File(_script).readAsStringSync();
    final pinned = RegExp(r"^readonly REQUIRED_REASONS='([^']*)'$", multiLine: true).firstMatch(helper);
    expect(pinned, isNotNull);
    final fromHelper = pinned![1]!.split(' ').where((s) => s.isNotEmpty).toSet();

    final xml = File('ios/Runner/PrivacyInfo.xcprivacy')
        .readAsStringSync()
        .replaceAll(RegExp(r'<!--.*?-->', dotAll: true), '');
    final start = xml.indexOf('<key>NSPrivacyAccessedAPITypes</key>');
    expect(start, isNonNegative);
    final fromManifest = <String>{};
    for (final m in RegExp(r'<dict>(.*?)</dict>', dotAll: true).allMatches(xml.substring(start))) {
      final type = RegExp(r'<key>NSPrivacyAccessedAPIType</key>\s*<string>(\w+)</string>').firstMatch(m[1]!);
      final reasons = RegExp(r'<key>NSPrivacyAccessedAPITypeReasons</key>\s*<array>(.*?)</array>', dotAll: true)
          .firstMatch(m[1]!);
      expect(type, isNotNull);
      expect(reasons, isNotNull);
      for (final r in RegExp(r'<string>([\w.]+)</string>').allMatches(reasons![1]!)) {
        fromManifest.add('${type![1]}=${r[1]}');
      }
    }
    expect(fromHelper, fromManifest);
  });

  test("the helper's background modes are exactly ios/Runner/Info.plist's", () {
    final helper = File(_script).readAsStringSync();
    final pinned = RegExp(r"^readonly BACKGROUND_MODES='([^']*)'$", multiLine: true).firstMatch(helper);
    expect(pinned, isNotNull);
    final info = File('ios/Runner/Info.plist').readAsStringSync().replaceAll(RegExp(r'<!--.*?-->', dotAll: true), '');
    final modes = RegExp(r'<key>UIBackgroundModes</key>\s*<array>(.*?)</array>', dotAll: true).firstMatch(info);
    expect(modes, isNotNull);
    final declared = RegExp(r'<string>(\w+)</string>').allMatches(modes![1]!).map((m) => m[1]!).toList()..sort();
    expect(pinned![1]!.split(' '), declared);
  });

  // ------------------------------------------------------------ bundletool
  test('install-bundletool.sh refuses a download that does not match the pinned SHA-256', () {
    final bin = Directory('${tmp.path}/bin2')..createSync();
    final fake = File('${bin.path}/curl')
      ..writeAsStringSync('#!/usr/bin/env bash\n'
          'while [ \$# -gt 0 ]; do [ "\$1" = -o ] && { shift; printf "not bundletool" > "\$1"; }; shift; done\n'
          'exit 0\n');
    expect(Process.runSync('chmod', ['+x', fake.path]).exitCode, 0);
    final dest = '${tmp.path}/bundletool';
    final r = Process.runSync(
      'bash',
      ['scripts/mobile/install-bundletool.sh', dest],
      environment: {'PATH': '${bin.path}:${Platform.environment['PATH'] ?? '/usr/bin:/bin'}'},
      includeParentEnvironment: false,
    );
    expect(r.exitCode, 1, reason: '${r.stderr}');
    expect('${r.stderr}', contains('does not match its pinned SHA-256'));
    expect(Directory(dest).listSync(), isEmpty, reason: 'the refused download was left behind');
  });

  test('install-bundletool.sh refuses a directory that is not empty', () {
    final dest = Directory('${tmp.path}/full')..createSync();
    File('${dest.path}/planted.jar').writeAsStringSync('x');
    final r = Process.runSync('bash', ['scripts/mobile/install-bundletool.sh', dest.path]);
    expect(r.exitCode, 2, reason: '${r.stderr}');
    expect('${r.stderr}', contains('is not empty'));
  });
}
