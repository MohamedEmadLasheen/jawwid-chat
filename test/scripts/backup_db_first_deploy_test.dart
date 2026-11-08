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
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

const _password = 'hunter2-lr77';
const _dsn = 'postgres://backup:$_password@db.example.invalid:5432/jawwid_chat';

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
  List<String> get files => out.existsSync() ? out.listSync().map((e) => e.path.split('/').last).toList() : <String>[];
}

void main() {
  late Directory sandbox;

  setUp(() => sandbox = Directory.systemTemp.createTempSync('jawwid-backup-lr77-'));
  tearDown(() => sandbox.deleteSync(recursive: true));

  // psqlBehaviour: 'absent' | 'present' | 'garbage' | 'fail'.
  // pg_dump behaves like the real client: with no matching schema it errors, otherwise it
  // writes a dump to --file (or stdout).
  _Run run({required String psqlBehaviour, String? pgImage, bool schemaExists = false, bool dumpFails = false}) {
    final bin = Directory('${sandbox.path}/bin')..createSync();
    final out = Directory('${sandbox.path}/out');
    final calls = File('${sandbox.path}/calls');

    File('${bin.path}/psql').writeAsStringSync(r'''#!/usr/bin/env bash
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
    for (final f in ['psql', 'pg_dump', 'docker']) {
      Process.runSync('chmod', ['+x', '${bin.path}/$f']);
    }

    final env = <String, String>{
      'PATH': '${bin.path}:/usr/bin:/bin:/usr/sbin:/sbin',
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

    final r = Process.runSync(
      'bash',
      ['scripts/infra/backup-db.sh', '--out', out.path, '--schema', 'chat'],
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
}
