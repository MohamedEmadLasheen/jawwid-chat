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

  ProcessResult check(Map<String, String?> overrides) {
    final env = <String, String>{'PATH': Platform.environment['PATH'] ?? '/usr/bin:/bin'};
    for (final e in {...valid, ...overrides}.entries) {
      if (e.value != null) env[e.key] = e.value!;
    }
    return Process.runSync('bash', ['scripts/mobile/build-store.sh', 'check'], environment: env, includeParentEnvironment: false);
  }

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
}
