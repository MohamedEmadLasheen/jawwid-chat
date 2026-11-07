// P-5: scripts/mobile/build-store.sh refuses to start a store build without a well-formed
// SUPPORT_URL (https) and SUPPORT_EMAIL, exactly as it does for the privacy policy and the
// terms. `check` runs only the validation, so no Flutter build is started.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  const valid = {
    'API_BASE_URL': 'https://api.example.org/api/v1',
    'PRIVACY_POLICY_URL': 'https://example.org/{lang}/privacy',
    'TERMS_URL': 'https://example.org/{lang}/terms',
    'SUPPORT_URL': 'https://example.org/{lang}/help',
    'SUPPORT_EMAIL': 'support@example.org',
    'SENTRY_DSN': 'https://key@sentry.example.org/1',
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
}
