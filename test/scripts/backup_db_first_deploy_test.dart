// LR-77: the deploy workflows run `scripts/infra/backup-db.sh --schema chat` BEFORE the
// migrations create the `chat` schema. On a never-migrated database pg_dump finds no matching
// schema and errors, so the first deploy stopped before any migration.
//
// backup-db.sh now asks the database first. These tests run the real script with bash and
// FAKE clients (psql, pg_dump, docker) first on PATH: no database, no docker daemon.
//   - schema absent           exit 0, a loud workflow warning, no file written, pg_dump never runs
//   - schema present          the dump runs exactly as before
//   - the check cannot run    connection/auth error: non-zero, no password in the output
//   - an unrecognised answer  falls back to the dump, as before
//   - FIRST_DEPLOY            the skip happens only when it is unset, empty or "true";
//                             any other value turns an absent schema into a failure
//   - a non-plain --schema    (a pattern, capitals) skips the check and dumps as before
//   - no psql on the host     the check is skipped and the host pg_dump runs as before
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

const _password = 'hunter2-lr77';
// @localhost, as in scripts/qa/check-backup-encryption.sh: scripts/infra/scan-secrets.sh treats a
// localhost DSN as a development default. In the container path the script rewrites it to
// host.docker.internal, which the fake docker ignores.
const _dsn = 'postgres://backup:$_password@localhost:5432/jawwid_chat';

// The commands backup-db.sh (and the fake clients' `#!/usr/bin/env bash`) need. A runner's
// /usr/bin holds a real psql, so "no psql on the host" needs a PATH built from these alone.
const _hostTools = [
  'bash', 'basename', 'cat', 'date', 'dirname', 'mkdir', 'mktemp', 'od', 'rm', 'sed',
  'sha256sum', 'shasum', 'tr', 'wc',
];

class _Run {
  _Run(this.result, this.out, this.calls);
  final ProcessResult result;
  final Directory out;
  final String calls;
  String get output => '${result.stdout}${result.stderr}';
  // Host pg_dump logs "pg_dump host ..."; the container logs "docker run ... IMAGE pg_dump ...".
  bool get dumpRan => calls
      .split('\n')
      .any((l) => l.startsWith('pg_dump ') || (l.startsWith('docker ') && l.contains(' pg_dump ')));
  bool get checkRan => calls
      .split('\n')
      .any((l) => l.startsWith('psql ') || (l.startsWith('docker ') && l.contains(' psql ')));
  List<String> get files => out.existsSync() ? out.listSync().map((e) => e.path.split('/').last).toList() : <String>[];
}

void main() {
  late Directory sandbox;

  setUp(() => sandbox = Directory.systemTemp.createTempSync('jawwid-backup-lr77-'));
  tearDown(() => sandbox.deleteSync(recursive: true));

  // psqlBehaviour: 'absent' | 'present' | 'garbage' | 'fail'.
  // pg_dump behaves like the real client: with no matching schema it errors, otherwise it
  // writes a dump to --file (or stdout).
  // firstDeploy: null leaves FIRST_DEPLOY unset. withPsql: false removes psql from the host
  // entirely (no fake, and a PATH without /usr/bin).
  _Run run({
    required String psqlBehaviour,
    String? pgImage,
    bool schemaExists = false,
    bool dumpFails = false,
    String schema = 'chat',
    String? firstDeploy,
    bool withPsql = true,
  }) {
    final bin = Directory('${sandbox.path}/bin')..createSync();
    final out = Directory('${sandbox.path}/out');
    final calls = File('${sandbox.path}/calls');

    var path = '${bin.path}:/usr/bin:/bin:/usr/sbin:/sbin';
    var bash = 'bash';
    if (!withPsql) {
      final tools = Directory('${sandbox.path}/tools')..createSync();
      for (final t in _hostTools) {
        final w = Process.runSync('bash', ['-c', 'command -v $t']);
        final p = '${w.stdout}'.trim();
        if (w.exitCode == 0 && p.startsWith('/')) Link('${tools.path}/$t').createSync(p);
      }
      path = '${bin.path}:${tools.path}';
      bash = '${tools.path}/bash';
      expect(Process.runSync(bash, ['-c', 'command -v psql'], environment: {'PATH': path}, includeParentEnvironment: false).exitCode,
          isNot(0),
          reason: 'the test PATH must not contain psql');
    }

    if (withPsql) File('${bin.path}/psql').writeAsStringSync(r'''#!/usr/bin/env bash
echo "psql host $*" >> "$CALLS"
case "$PSQL_BEHAVIOUR" in
  absent)  echo schema-absent ;;
  present) echo schema-present ;;
  garbage) echo 0 ;;
  fail)    echo "psql: error: connection to server failed: password authentication failed for $FAKE_DSN" >&2; exit 2 ;;
esac
''');
    File('${bin.path}/pg_dump').writeAsStringSync(r'''#!/usr/bin/env bash
echo "pg_dump host $*" >> "$CALLS"
if [ "$SCHEMA_EXISTS" != 1 ] || [ "$DUMP_FAILS" = 1 ]; then
  echo "pg_dump: error: no matching schemas were found for pattern \"chat\"" >&2; exit 1
fi
file=""
for a in "$@"; do case "$a" in --file=*) file="${a#--file=}" ;; esac; done
if [ -n "$file" ]; then printf 'PGDMP-stub' > "$file"; else printf 'PGDMP-stub'; fi
''');
    // `docker run ... IMAGE psql|pg_dump ...`: dispatch on the client, as the image would.
    File('${bin.path}/docker').writeAsStringSync(r'''#!/usr/bin/env bash
echo "docker $*" >> "$CALLS"
client=""
for a in "$@"; do case "$a" in psql|pg_dump) client="$a"; break ;; esac; done
host_dir=""; file=""
for a in "$@"; do
  case "$a" in
    *:/backup) host_dir="${a%%:/backup}" ;;
    --file=/backup/*) file="${a#--file=/backup/}" ;;
  esac
done
case "$client" in
  psql)
    case "$PSQL_BEHAVIOUR" in
      absent)  echo schema-absent ;;
      present) echo schema-present ;;
      garbage) echo 0 ;;
      fail)    echo "psql: error: connection to server failed for $FAKE_DSN" >&2; exit 2 ;;
    esac ;;
  pg_dump)
    if [ "$SCHEMA_EXISTS" != 1 ] || [ "$DUMP_FAILS" = 1 ]; then
      echo "pg_dump: error: no matching schemas were found for pattern \"chat\"" >&2; exit 1
    fi
    if [ -n "$host_dir" ] && [ -n "$file" ]; then printf 'PGDMP-stub' > "$host_dir/$file"; else printf 'PGDMP-stub'; fi ;;
  *) exit 1 ;;
esac
''');
    for (final f in [if (withPsql) 'psql', 'pg_dump', 'docker']) {
      Process.runSync('chmod', ['+x', '${bin.path}/$f']);
    }

    final env = <String, String>{
      'PATH': path,
      'TMPDIR': sandbox.path,
      // APP_ENV=ci: no key needed, so this exercises the schema check, not the encryption
      // refusal (that has its own guard, scripts/qa/check-backup-encryption.sh).
      'APP_ENV': 'ci',
      'DATABASE_URL': _dsn,
      'FAKE_DSN': _dsn,
      'CALLS': calls.path,
      'PSQL_BEHAVIOUR': psqlBehaviour,
      'SCHEMA_EXISTS': schemaExists ? '1' : '0',
      'DUMP_FAILS': dumpFails ? '1' : '0',
    };
    if (pgImage != null) env['PG_IMAGE'] = pgImage;
    if (firstDeploy != null) env['FIRST_DEPLOY'] = firstDeploy;

    final r = Process.runSync(
      bash,
      ['scripts/infra/backup-db.sh', '--out', out.path, '--schema', schema],
      environment: env,
      includeParentEnvironment: false,
    );
    return _Run(r, out, calls.existsSync() ? calls.readAsStringSync() : '');
  }

  group('schema absent (first deploy)', () {
    for (final image in [null, 'postgres:17-alpine']) {
      final client = image == null ? 'host psql' : 'PG_IMAGE container';
      test('exit 0, a loud warning, no backup file, pg_dump never runs ($client)', () {
        final r = run(psqlBehaviour: 'absent', pgImage: image);
        expect(r.result.exitCode, 0, reason: r.output);
        expect(r.result.stdout, contains('::warning'));
        expect(r.result.stdout, contains("schema 'chat' does not exist"));
        expect(r.result.stdout, contains('NO BACKUP TAKEN'));
        expect(r.files, isEmpty, reason: 'no archive, checksum or partial file may be written');
        expect(r.calls, contains('psql'));
        expect(r.dumpRan, isFalse, reason: r.calls);
        expect(r.output, isNot(contains(_password)));
      });
    }

    test('with an encryption passphrase: still no file, not even a .partial', () {
      if (Process.runSync('bash', ['-c', 'command -v openssl']).exitCode != 0) {
        markTestSkipped('openssl is not installed');
        return;
      }
      final bin = Directory('${sandbox.path}/bin')..createSync();
      File('${bin.path}/psql').writeAsStringSync('#!/usr/bin/env bash\necho schema-absent\n');
      File('${bin.path}/pg_dump').writeAsStringSync('#!/usr/bin/env bash\necho "pg_dump ran" >&2; exit 1\n');
      Process.runSync('chmod', ['+x', '${bin.path}/psql', '${bin.path}/pg_dump']);
      final out = Directory('${sandbox.path}/out');
      final r = Process.runSync(
        'bash',
        ['scripts/infra/backup-db.sh', '--out', out.path, '--schema', 'chat'],
        environment: {
          'PATH': '${bin.path}:/usr/bin:/bin:/usr/sbin:/sbin',
          'TMPDIR': sandbox.path,
          'APP_ENV': 'production',
          'BACKUP_ENCRYPTION_PASSPHRASE': 'correct-horse-battery-staple-lr77-passphrase',
          'DATABASE_URL': _dsn,
        },
        includeParentEnvironment: false,
      );
      expect(r.exitCode, 0, reason: '${r.stdout}${r.stderr}');
      expect('${r.stdout}', contains('::warning'));
      expect(out.existsSync() ? out.listSync() : const [], isEmpty);
      expect('${r.stdout}${r.stderr}', isNot(contains('correct-horse')));
      expect('${r.stdout}${r.stderr}', isNot(contains(_password)));
    });
  });

  group('schema present: the dump runs as before', () {
    for (final image in [null, 'postgres:17-alpine']) {
      final client = image == null ? 'host' : 'PG_IMAGE container';
      test('dump attempted with --schema=chat and an archive written ($client)', () {
        final r = run(psqlBehaviour: 'present', pgImage: image, schemaExists: true);
        expect(r.result.exitCode, 0, reason: r.output);
        expect(r.dumpRan, isTrue, reason: r.calls);
        expect(r.calls, contains('--schema=chat'));
        expect(r.files.where((f) => f.endsWith('.dump')), hasLength(1), reason: '${r.files}');
        expect(r.result.stdout, isNot(contains('::warning')));
      });
    }

    test('a pg_dump error still fails the backup, without leaking the password', () {
      final r = run(psqlBehaviour: 'present', schemaExists: true, dumpFails: true);
      expect(r.result.exitCode, isNot(0), reason: r.output);
      expect(r.result.stderr, contains('pg_dump FAILED'));
      expect(r.output, isNot(contains(_password)));
    });
  });

  group('the existence check itself fails', () {
    for (final image in [null, 'postgres:17-alpine']) {
      final client = image == null ? 'host psql' : 'PG_IMAGE container';
      test('non-zero exit, no dump, no file, no password in the output ($client)', () {
        final r = run(psqlBehaviour: 'fail', pgImage: image);
        expect(r.result.exitCode, isNot(0), reason: r.output);
        expect(r.result.stderr, contains('FAILED'));
        expect(r.result.stdout, isNot(contains('::warning')));
        expect(r.dumpRan, isFalse, reason: r.calls);
        expect(r.files, isEmpty);
        expect(r.output, isNot(contains(_password)));
      });
    }
  });

  test('an answer that is not exactly "schema-absent" never skips the backup', () {
    // A database is skipped only when it positively says the schema is absent. Anything else
    // goes to pg_dump as before, which here fails because the schema is missing.
    final r = run(psqlBehaviour: 'garbage');
    expect(r.result.exitCode, isNot(0), reason: r.output);
    expect(r.dumpRan, isTrue, reason: r.calls);
    expect(r.result.stdout, isNot(contains('NO BACKUP TAKEN')));
  });

  group('FIRST_DEPLOY decides whether an absent schema may be skipped', () {
    for (final image in [null, 'postgres:17-alpine']) {
      final client = image == null ? 'host psql' : 'PG_IMAGE container';

      for (final value in ['false', 'no', 'TRUE']) {
        test('FIRST_DEPLOY=$value + absent schema: non-zero, a clear error, no dump, no file ($client)', () {
          final r = run(psqlBehaviour: 'absent', pgImage: image, firstDeploy: value);
          expect(r.result.exitCode, isNot(0), reason: r.output);
          expect(r.result.stderr, contains('::error'));
          expect(r.result.stderr, contains("schema 'chat' does not exist"));
          expect(r.result.stderr, contains('not a first deploy'));
          expect(r.result.stderr, contains('DATABASE_URL'));
          expect(r.result.stdout, isNot(contains('NO BACKUP TAKEN')));
          expect(r.dumpRan, isFalse, reason: r.calls);
          expect(r.files, isEmpty);
          expect(r.output, isNot(contains(_password)));
        });
      }

      for (final value in ['true', '']) {
        test('FIRST_DEPLOY="$value" + absent schema: exit 0, NO BACKUP TAKEN ($client)', () {
          final r = run(psqlBehaviour: 'absent', pgImage: image, firstDeploy: value);
          expect(r.result.exitCode, 0, reason: r.output);
          expect(r.result.stdout, contains('::warning'));
          expect(r.result.stdout, contains('NO BACKUP TAKEN'));
          expect(r.dumpRan, isFalse, reason: r.calls);
          expect(r.files, isEmpty);
        });
      }

      test('FIRST_DEPLOY=false + present schema: the dump runs as before ($client)', () {
        final r = run(psqlBehaviour: 'present', pgImage: image, schemaExists: true, firstDeploy: 'false');
        expect(r.result.exitCode, 0, reason: r.output);
        expect(r.dumpRan, isTrue, reason: r.calls);
        expect(r.files.where((f) => f.endsWith('.dump')), hasLength(1), reason: '${r.files}');
      });
    }
  });

  group('a non-plain --schema skips the check and dumps as before', () {
    for (final image in [null, 'postgres:17-alpine']) {
      final client = image == null ? 'host' : 'PG_IMAGE container';
      for (final schema in ['chat*', 'Chat']) {
        test('--schema $schema: no existence check, pg_dump runs with it ($client)', () {
          // psql would answer "absent"; it must never be asked.
          final r = run(psqlBehaviour: 'absent', pgImage: image, schemaExists: true, schema: schema, firstDeploy: 'false');
          expect(r.result.exitCode, 0, reason: r.output);
          expect(r.checkRan, isFalse, reason: r.calls);
          expect(r.dumpRan, isTrue, reason: r.calls);
          expect(r.calls, contains('--schema=$schema'));
          expect(r.result.stdout, isNot(contains('NO BACKUP TAKEN')));
          expect(r.files.where((f) => f.endsWith('.dump')), hasLength(1), reason: '${r.files}');
        });
      }
    }
  });

  group('a host pg_dump with no psql: the check is skipped, the dump runs as before', () {
    test('schema present: says psql is not installed, and the archive is written', () {
      final r = run(psqlBehaviour: 'absent', schemaExists: true, withPsql: false);
      expect(r.result.exitCode, 0, reason: r.output);
      expect(r.result.stdout, contains('psql not installed'));
      expect(r.checkRan, isFalse, reason: r.calls);
      expect(r.dumpRan, isTrue, reason: r.calls);
      expect(r.files.where((f) => f.endsWith('.dump')), hasLength(1), reason: '${r.files}');
    });

    test('schema absent: never skipped; pg_dump decides, and fails as before', () {
      final r = run(psqlBehaviour: 'absent', withPsql: false);
      expect(r.result.exitCode, isNot(0), reason: r.output);
      expect(r.result.stderr, contains('pg_dump FAILED'));
      expect(r.result.stdout, isNot(contains('NO BACKUP TAKEN')));
      expect(r.output, isNot(contains(_password)));
    });
  });
}
