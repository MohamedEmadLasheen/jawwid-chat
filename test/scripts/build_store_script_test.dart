// P-5: scripts/mobile/build-store.sh refuses to start a store build without a well-formed
// SUPPORT_URL (https) and SUPPORT_EMAIL, exactly as it does for the privacy policy and the
// terms. `check` runs only the validation, so no Flutter build is started.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  const valid = {
    'API_BASE_URL': 'https://api.jawwid.com/api/v1',
    'BUILD_NAME': '1.2.3',
    'BUILD_NUMBER': '45',
    'PRIVACY_POLICY_URL': 'https://example.org/{lang}/privacy',
    'TERMS_URL': 'https://example.org/{lang}/terms',
    'SUPPORT_URL': 'https://example.org/{lang}/help',
    'SUPPORT_EMAIL': 'support@example.org',
    'SENTRY_DSN': 'https://key@sentry.jawwid.com/1',
  };

  ProcessResult run(String target, Map<String, String?> overrides) {
    final env = <String, String>{'PATH': Platform.environment['PATH'] ?? '/usr/bin:/bin'};
    for (final e in {...valid, ...overrides}.entries) {
      if (e.value != null) env[e.key] = e.value!;
    }
    return Process.runSync('bash', ['scripts/mobile/build-store.sh', target], environment: env, includeParentEnvironment: false);
  }

  ProcessResult check(Map<String, String?> overrides) => run('check', overrides);

  test('all values valid: the checks pass', () {
    final r = check({});
    expect(r.exitCode, 0, reason: '${r.stderr}');
    expect(r.stdout, contains('build-store: ok'));
  });

  test('SUPPORT_URL missing or not https: refused, and the message names it', () {
    for (final value in [null, '', 'http://example.org/help', 'example.org/help', 'https://example.org/he lp']) {
      final r = check({'SUPPORT_URL': value});
      expect(r.exitCode, 1, reason: '$value');
      expect(r.stderr, contains('SUPPORT_URL'), reason: '$value');
    }
  });

  test('SUPPORT_EMAIL missing or not a plausible address: refused, and the message names it', () {
    for (final value in [null, '', 'support', 'support@', '@example.org', 'support@example', 'a b@example.org', 'a@b@example.org', 'mailto:support@example.org']) {
      final r = check({'SUPPORT_EMAIL': value});
      expect(r.exitCode, 1, reason: '$value');
      expect(r.stderr, contains('SUPPORT_EMAIL'), reason: '$value');
    }
  });

  test('the build passes both values to flutter as dart-defines', () {
    final script = File('scripts/mobile/build-store.sh').readAsStringSync();
    expect(script, contains('--dart-define=SUPPORT_URL="\$SUPPORT_URL"'));
    expect(script, contains('--dart-define=SUPPORT_EMAIL="\$SUPPORT_EMAIL"'));
  });

  test('BUILD_NAME and BUILD_NUMBER are required and well-formed (LR-21a)', () {
    for (final value in [null, '', '1.2', '1.2.3.4', 'v1.2.3', '1.2.x', '1.2.3-beta']) {
      final r = check({'BUILD_NAME': value});
      expect(r.exitCode, 1, reason: '$value');
      expect(r.stderr, contains('BUILD_NAME'), reason: '$value');
    }
    for (final value in [null, '', '0', 'abc', '-3', '1.5', '01x']) {
      final r = check({'BUILD_NUMBER': value});
      expect(r.exitCode, 1, reason: '$value');
      expect(r.stderr, contains('BUILD_NUMBER'), reason: '$value');
    }
  });

  test('a non-production API host is refused and the accepted host is printed (LR-21b)', () {
    for (final host in [
      'staging.jawwid.com', 'api-staging.jawwid.com', 'api.stage.jawwid.com', 'dev.jawwid.com', 'test.jawwid.com',
      'qa.jawwid.com', 'uat.jawwid.com', 'sandbox.jawwid.com', 'preview.jawwid.com', 'api.local', 'localhost',
      'api.jawwid.example.org', 'abc.ngrok.io', 'api.internal', '10.0.0.5', '192.168.1.2:3000', '[::1]', 'api.jawwid.com@dev.evil.com',
    ]) {
      final r = check({'API_BASE_URL': 'https://$host/api/v1'});
      expect(r.exitCode, 1, reason: host);
      expect(r.stderr, contains('API_BASE_URL'), reason: host);
    }
    final ok = check({});
    expect(ok.exitCode, 0, reason: '${ok.stderr}');
    expect(ok.stdout, contains('api.jawwid.com'));
  });

  test('LESSONS_ORIGIN follows the same host rule', () {
    final bad = check({'LESSONS_ORIGIN': 'https://lessons.staging.jawwid.com'});
    expect(bad.exitCode, 1);
    expect(bad.stderr, contains('LESSONS_ORIGIN'));
    expect(check({'LESSONS_ORIGIN': 'https://lessons.jawwid.com'}).exitCode, 0);
  });

  test('SENTRY_DSN is required and never printed (LR-21c)', () {
    for (final value in [null, '']) {
      final r = check({'SENTRY_DSN': value});
      expect(r.exitCode, 1, reason: '$value');
      expect(r.stderr, contains('SENTRY_DSN'), reason: '$value');
    }
    final r = check({});
    expect('${r.stdout}${r.stderr}', isNot(contains('key@sentry')));
  });

  test('the build passes version and split-debug-info to flutter, without obfuscation (LR-21a, LR-22)', () {
    final script = File('scripts/mobile/build-store.sh').readAsStringSync();
    expect(script, contains('--build-name "\$BUILD_NAME" --build-number "\$BUILD_NUMBER"'));
    expect(script, contains('--split-debug-info='));
    expect(script, isNot(contains('--obfuscate')));
  });

  // LR-76: `ios-config` is what CI uses to configure the signed iOS build. It must refuse exactly
  // what `ios` refuses, and hand Flutter exactly the same version, symbols path and dart-defines;
  // otherwise a CI-built iPhone app could ship without the production settings.
  group('ios-config (LR-76)', () {
    test('is an accepted target; an unknown target is refused with the usage line', () {
      final bogus = run('ios-configure', {});
      expect(bogus.exitCode, 2);
      expect(bogus.stderr, contains('ios-config'));
      // A missing flutter binary is reached only after every check passed and the target was accepted.
      final r = run('ios-config', {'FLUTTER': '/nonexistent/flutter'});
      expect(r.exitCode, 1, reason: '${r.stderr}');
      expect(r.stderr, contains('flutter not found'));
    });

    test('applies the same refusals as ios, before Flutter is reached', () {
      final bad = <String, Map<String, String?>>{
        'API_BASE_URL': {'API_BASE_URL': 'https://api.staging.jawwid.com/api/v1'},
        'BUILD_NAME': {'BUILD_NAME': '1.2'},
        'BUILD_NUMBER': {'BUILD_NUMBER': '0'},
        'PRIVACY_POLICY_URL': {'PRIVACY_POLICY_URL': 'http://example.org/privacy'},
        'TERMS_URL': {'TERMS_URL': null},
        'SUPPORT_URL': {'SUPPORT_URL': ''},
        'SUPPORT_EMAIL': {'SUPPORT_EMAIL': 'support'},
        'LESSONS_ORIGIN': {'LESSONS_ORIGIN': 'https://lessons.dev.jawwid.com'},
        'SENTRY_DSN': {'SENTRY_DSN': null},
      };
      for (final target in ['ios', 'ios-config']) {
        for (final e in bad.entries) {
          final r = run(target, {...e.value, 'FLUTTER': '/nonexistent/flutter'});
          expect(r.exitCode, 1, reason: '$target ${e.key}');
          expect(r.stderr, contains(e.key), reason: '$target ${e.key}');
          expect(r.stderr, isNot(contains('flutter not found')), reason: '$target ${e.key}');
        }
      }
    });

    test('passes flutter build ios --config-only the same flags as flutter build ipa', () {
      // The script writes its symbols folder under build/; use a build number nobody ships and
      // remove only what this test created.
      const number = '987654321';
      final symbols = Directory('build/symbols/ios/1.2.3+$number');
      final existed = symbols.existsSync();
      final tmp = Directory.systemTemp.createTempSync('fake_flutter_');
      addTearDown(() {
        tmp.deleteSync(recursive: true);
        if (!existed && symbols.existsSync()) symbols.deleteSync(recursive: true);
      });
      final fake = File('${tmp.path}/flutter')
        ..writeAsStringSync('#!/bin/sh\n'
            'for a in "\$@"; do printf \'%s\\n\' "\$a"; done >> "\$FAKE_FLUTTER_LOG"\n'
            'printf \'%s\\n\' "<end>" >> "\$FAKE_FLUTTER_LOG"\n');
      expect(Process.runSync('chmod', ['+x', fake.path]).exitCode, 0);

      List<String> buildArgs(String target) {
        final log = File('${tmp.path}/$target.log');
        final r = run(target, {'FLUTTER': fake.path, 'FAKE_FLUTTER_LOG': log.path, 'BUILD_NUMBER': number});
        expect(r.exitCode, 0, reason: '$target: ${r.stderr}');
        final calls = log.readAsStringSync().split('<end>\n').where((c) => c.isNotEmpty).toList();
        expect(calls, hasLength(2), reason: '$target: pub get, then one build');
        expect(calls.first, 'pub\nget\n--enforce-lockfile\n');
        return calls.last.split('\n')..removeLast();
      }

      final config = buildArgs('ios-config');
      final ipa = buildArgs('ios');
      expect(config.take(4), ['build', 'ios', '--release', '--config-only']);
      expect(ipa.take(3), ['build', 'ipa', '--release']);
      expect(config.skip(4).toList(), ipa.skip(3).toList());
      expect(config.skip(4).toList(), [
        '--build-name', '1.2.3',
        '--build-number', number,
        '--split-debug-info=build/symbols/ios/1.2.3+$number',
        '--dart-define=JAWWID_API_BASE_URL=https://api.jawwid.com/api/v1',
        '--dart-define=PRIVACY_POLICY_URL=https://example.org/{lang}/privacy',
        '--dart-define=TERMS_URL=https://example.org/{lang}/terms',
        '--dart-define=SUPPORT_URL=https://example.org/{lang}/help',
        '--dart-define=SUPPORT_EMAIL=support@example.org',
        '--dart-define=JAWWID_LESSONS_ORIGIN=',
        '--dart-define=SENTRY_DSN=https://key@sentry.jawwid.com/1',
        '--dart-define=SENTRY_ENVIRONMENT=production',
      ]);
    });

    test('the --config-only line in the script carries the version, symbols and DEFINES', () {
      final script = File('scripts/mobile/build-store.sh').readAsStringSync();
      expect(
        script,
        contains('build ios --release --config-only --build-name "\$BUILD_NAME" --build-number "\$BUILD_NUMBER" '
            '--split-debug-info="\$SYMBOLS" "\${DEFINES[@]}"'),
      );
    });
  });
}
