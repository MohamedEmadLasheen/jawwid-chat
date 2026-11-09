// W17: scripts/infra/scan-secrets.sh had no rule for Stripe, DigitalOcean, Google, Meta or Sentry
// credentials, nor for SMTP/Redis URLs carrying a password, and it never looked at binary key
// files (git grep -I skips them). These tests run the real script with bash inside a throwaway
// git repository holding ONLY the fixture files, and check that:
//   - each new pattern is caught, reported by rule and file, and its value is never printed
//   - a tracked key or keystore file is flagged by its name, whatever its contents
//   - the shapes this repository legitimately contains today (test keys like sk_test_unit,
//     $PASSWORD placeholders, user:password@host, reserved-TLD hosts) stay clean
//
// Every fixture value is assembled from parts at run time, so this file itself never contains
// a literal that any rule matches; the real scan of the repository stays clean.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

final _hex16 = '0123456789abcdef';
final _hex32 = _hex16 * 2;
final _hex64 = _hex16 * 4;
const _alnum = 'aB3dE5gH7jK9mN1pQ2rS4tU6vW8xY0zC'; // 32 characters, letters and digits only

class _Scan {
  _Scan(this.result);
  final ProcessResult result;
  String get out => '${result.stdout}${result.stderr}';
}

void main() {
  late Directory repo;

  setUp(() {
    repo = Directory.systemTemp.createTempSync('jawwid-scan-secrets-');
    final init = Process.runSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q', repo.path]);
    expect(init.exitCode, 0, reason: '${init.stderr}');
    Directory('${repo.path}/scripts/infra').createSync(recursive: true);
    File('scripts/infra/scan-secrets.sh').copySync('${repo.path}/scripts/infra/scan-secrets.sh');
  });
  tearDown(() => repo.deleteSync(recursive: true));

  // files: relative path -> String (text) or List<int> (bytes). All are tracked (forced past any
  // global gitignore), so both the content rules and the by-name rule see them.
  _Scan scan(Map<String, Object> files) {
    files.forEach((path, content) {
      final f = File('${repo.path}/$path')..parent.createSync(recursive: true);
      if (content is String) {
        f.writeAsStringSync(content);
      } else {
        f.writeAsBytesSync(content as List<int>);
      }
    });
    final add = Process.runSync('git', ['add', '-f', '-A', '--', '.'], workingDirectory: repo.path);
    expect(add.exitCode, 0, reason: '${add.stderr}');
    return _Scan(Process.runSync('bash', ['${repo.path}/scripts/infra/scan-secrets.sh']));
  }

  void expectFlagged(_Scan s, String rule, String file, {String? secret}) {
    expect(s.result.exitCode, 1, reason: s.out);
    expect(s.result.stdout, contains(rule), reason: s.out);
    expect(s.result.stdout, contains(file), reason: s.out);
    if (secret != null) expect(s.out, isNot(contains(secret)), reason: 'the matching value must never be printed');
  }

  void expectClean(_Scan s) {
    expect(s.result.exitCode, 0, reason: s.out);
    expect(s.result.stdout, contains('secret scan: clean (0 findings)'));
  }

  test('a file with no credential passes', () {
    expectClean(scan({'src/app.ts': 'export const greeting = "hello";\n'}));
  });

  group('each new credential pattern is caught, by rule and file, without printing it', () {
    final cases = <String, (String rule, String line, String secret)>{
      'stripe live secret key': (
        'stripe secret key',
        "const k = '${'sk' '_live_'}$_alnum';",
        '${'sk' '_live_'}$_alnum',
      ),
      'stripe test secret key': (
        'stripe secret key',
        'STRIPE_SECRET_KEY=${'sk' '_test_'}$_alnum',
        '${'sk' '_test_'}$_alnum',
      ),
      'stripe restricted key': (
        'stripe secret key',
        'STRIPE_SECRET_KEY: ${'rk' '_live_'}$_alnum',
        '${'rk' '_live_'}$_alnum',
      ),
      'stripe webhook secret': (
        'stripe webhook secret',
        'STRIPE_WEBHOOK_SECRET=${'whsec' '_'}$_alnum',
        '${'whsec' '_'}$_alnum',
      ),
      'digitalocean personal access token': (
        'digitalocean token',
        'DIGITALOCEAN_ACCESS_TOKEN=${'dop' '_v1_'}$_hex64',
        '${'dop' '_v1_'}$_hex64',
      ),
      'google api key': (
        'google api key',
        'apiKey: "${'AI' 'za'}${_alnum}x_-"',
        '${'AI' 'za'}${_alnum}x_-',
      ),
      'meta access token': (
        'meta access token',
        'FB_TOKEN=${'EA' 'A'}${_alnum * 3}',
        '${'EA' 'A'}${_alnum * 3}',
      ),
      'sentry dsn with a secret key': (
        'sentry dsn with secret',
        'SENTRY_DSN=https://$_hex32${':'}$_hex32@o1.ingest.sentry.io/1',
        '$_hex32${':'}$_hex32',
      ),
      'sentry organisation auth token': (
        'sentry auth token',
        'SENTRY_AUTH_TOKEN=${'sntry' 's_'}eyJ$_alnum$_alnum',
        '${'sntry' 's_'}eyJ$_alnum$_alnum',
      ),
      'sentry user auth token': (
        'sentry auth token',
        'SENTRY_AUTH_TOKEN=${'sntry' 'u_'}$_hex64',
        '${'sntry' 'u_'}$_hex64',
      ),
      'smtp url with a password': (
        'smtp url with password',
        'SMTP_URL=${'smtps' '://'}mailer:${'Xq7' 'vR2pL9'}@smtp.mailprovider.com:465',
        'Xq7' 'vR2pL9',
      ),
      'redis url with a password': (
        'redis url with password',
        'REDIS_URL=${'rediss' '://'}default:${'Zt8' 'kW3nB6'}@cache.db.ondigitalocean.com:25061',
        'Zt8' 'kW3nB6',
      ),
      'redis url with an empty user and a password': (
        'redis url with password',
        'REDIS_URL=${'redis' '://'}:${'Zt8' 'kW3nB6'}@cache.internal:6379/0',
        'Zt8' 'kW3nB6',
      ),
    };
    cases.forEach((label, c) {
      test(label, () {
        final (rule, line, secret) = c;
        expectFlagged(scan({'config/leak.txt': 'before\n$line\nafter\n'}), rule, 'config/leak.txt', secret: secret);
      });
    });
  });

  group('a tracked key or keystore file is flagged by name, even when binary', () {
    const binary = [0, 1, 2, 3, 0, 255, 254, 0, 48, 130];
    for (final path in [
      'ios/AuthKey_ABC123.p8',
      'certs/distribution.p12',
      'certs/distribution.pfx',
      'android/app/upload.jks',
      'android/release.keystore',
      'ios/Jawwid_AppStore.mobileprovision',
      'certs/UPPERCASE.P12',
    ]) {
      test(path, () => expectFlagged(scan({path: binary}), 'tracked key or keystore file', path));
    }

    test('a similar name that is not a key file passes', () {
      expectClean(scan({'docs/p8-notes.md': 'how to make an APNs key\n', 'src/keystore.dart': 'class Keystore {}\n'}));
    });
  });

  group('shapes this repository contains today stay clean (precision)', () {
    final benign = <String, String>{
      'short placeholder test keys': "new Stripe('${'sk' '_test_'}unit'); const s = '${'whsec' '_'}unit_test_secret';\n"
          "STRIPE_SECRET_KEY: '${'rk' '_live_'}x', '${'sk' '_test_'}signing_only'\n",
      'a key prefix in prose': '# Stripe test-mode keys locally (${'sk' '_test_'}..., ${'whsec' '_'}... from stripe listen).\n',
      'a shell-variable redis password': 'GOOD_URL="${'rediss' '://'}default:\$PASSWORD@\$HOST:25061"\n'
          'URL="${'rediss' '://'}default:\${REDIS_PASSWORD}@\$HOST:25061"\n',
      'the literal word password as a placeholder': '"SMTP_URL": "${'smtps' '://'}user:${'pass' 'word'}@host:465 from your provider",\n',
      'a redis url on a reserved .invalid host': 'managed = "${'rediss' '://'}default:${'s3cr3t' '-pw'}@jawwid-valkey.db.ondigitalocean.invalid:25061"\n',
      'a local redis url': 'REDIS_URL=${'redis' '://'}:${'devpass' '99'}@localhost:6379\n',
      'a smtp url without credentials': "SMTP_URL: '${'smtp' '://'}localhost:2525'\n",
      'a meta-like run inside a base64 blob': 'data:image/png;base64,iVBORw0KGgo/${'EA' 'A'}${_alnum * 3}\n',
      'a short AIza-like string': 'const s = "${'AI' 'za'}Short";\n',
    };
    benign.forEach((label, content) {
      test(label, () => expectClean(scan({'src/fixture.txt': content})));
    });
  });

  test('the reserved-host exclusion is limited to the new URL rules: a postgres URL is still flagged', () {
    final line = 'DATABASE_URL=${'postgres' '://'}app:${'s3cr3t' '-pw'}@db.ondigitalocean.invalid:25060/chat\n';
    expectFlagged(scan({'config/db.txt': line}), 'postgres url with password', 'config/db.txt', secret: 's3cr3t' '-pw');
  });

  test('.gitignore keeps APNs keys, keystores and provisioning profiles out of the tree', () {
    final lines = File('.gitignore').readAsLinesSync().map((l) => l.trim()).toSet();
    for (final p in ['*.p8', '*.p12', '*.pfx', '*.jks', '*.keystore', '*.mobileprovision']) {
      expect(lines, contains(p), reason: '$p must be ignored');
    }
  });
}
