// OT-2b: scripts/mobile/play-upload.sh puts one App Bundle on Google Play's INTERNAL track as a
// DRAFT release, and nothing else. These tests run the real script with bash against a stand-in
// `curl` (first on PATH) that records every call and answers like the Play Developer API, and
// check that:
//   - the happy path is exactly edits.insert -> bundles.upload -> tracks.update(internal, draft)
//     -> edits.commit, with the token handed to curl on stdin and never on a command line;
//   - every override of the package, track or status is refused before any call;
//   - the token never appears in the output;
//   - a failing step deletes the edit, exits non-zero and never commits;
//   - Google's "package not found" answer for an app with no upload yet prints the STOP message.
// scripts/mobile/install-sentry-cli.sh refuses a download that does not match its pinned SHA-256.
//
// Needs bash and jq on PATH (both on the CI runners).
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

// Assembled at run time so no literal in this file looks like a credential.
final _token = ['ya', '29.', 'fixture-only-', 'not-a-real-token_0123456789'].join();
const _pkg = 'com.jawwid.jawwid_chat';
const _api = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/$_pkg';
const _uploadApi = 'https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/$_pkg';
const _edit = '0123456789';
const _stop = 'STOP: Google requires a first manual upload; do NOT do it from the development Mac; tell the lead';

// Stand-in curl. Parses the flags play-upload.sh uses, records "<step> auth=<ok|missing> env=<clean|leaked>"
// per call (step names match only the exact URLs of package com.jawwid.jawwid_chat), the full argv,
// and the track request body; answers like Google; FAKE_FAIL_STEP makes one step fail the way
// `curl --fail-with-body` does (body written, status printed, exit 22).
const _fakeCurl = r'''#!/usr/bin/env bash
set -u
method=GET; out=""; data=""; url=""; wfmt=""; cfg_stdin=0
args=("$@")
printf '%s\n' "$*" >> "$FAKE_DIR/argv.log"
i=0
while [ "$i" -lt "${#args[@]}" ]; do
  a="${args[$i]}"
  case "$a" in
    -X) i=$((i+1)); method="${args[$i]}" ;;
    -o) i=$((i+1)); out="${args[$i]}" ;;
    -w) i=$((i+1)); wfmt="${args[$i]}" ;;
    -K) i=$((i+1)); [ "${args[$i]}" = - ] && cfg_stdin=1 ;;
    -H | --max-time | --proto) i=$((i+1)) ;;
    --data-binary) i=$((i+1)); data="${args[$i]#@}" ;;
    -*) : ;;
    *) url="$a" ;;
  esac
  i=$((i+1))
done
API="https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.jawwid.jawwid_chat"
UP="https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/com.jawwid.jawwid_chat"
E=0123456789
step=unknown
case "$method $url" in
  "POST $API/edits") step=insert ;;
  "POST $UP/edits/$E/bundles?uploadType=media") step=upload ;;
  "PUT $API/edits/$E/tracks/internal") step=track ;;
  "POST $API/edits/$E:commit") step=commit ;;
  "DELETE $API/edits/$E") step=delete ;;
esac
n="$(wc -l < "$FAKE_DIR/argv.log" | tr -d ' ')"
auth=missing
if [ "$cfg_stdin" = 1 ]; then
  cat > "$FAKE_DIR/auth.$n"
  auth=ok
fi
envstate=clean
[ -n "${PLAY_ACCESS_TOKEN+x}" ] && envstate=leaked
echo "$step auth=$auth env=$envstate" >> "$FAKE_DIR/calls.log"
answer() { # code body-file-or-text
  [ -n "$out" ] && printf '%s' "$2" > "$out"
  [ -n "$wfmt" ] && printf '%s' "$1"
}
if [ "${FAKE_FAIL_STEP:-}" = "$step" ]; then
  answer "${FAKE_FAIL_CODE:-500}" "$(cat "$FAKE_FAIL_BODY_FILE")"
  exit 22
fi
case "$step" in
  insert) answer 200 '{"id":"0123456789","expiryTimeSeconds":"1999999999"}' ;;
  upload)
    if command -v sha256sum > /dev/null 2>&1; then sha="$(sha256sum "$data" | awk '{print $1}')"
    else sha="$(shasum -a 256 "$data" | awk '{print $1}')"; fi
    answer 200 "{\"versionCode\":${FAKE_VERSION_CODE:-45},\"sha1\":\"x\",\"sha256\":\"$sha\"}" ;;
  track) cp "$data" "$FAKE_DIR/track-body.json"; answer 200 "$(cat "$data")" ;;
  commit) answer 200 '{"id":"0123456789"}' ;;
  delete) answer 204 '' ;;
  *) answer 404 '{"error":{"code":404,"status":"NOT_FOUND"}}'; exit 22 ;;
esac
exit 0
''';

class _Run {
  _Run(this.result, this.dir);
  final ProcessResult result;
  final Directory dir;
  String get out => '${result.stdout}${result.stderr}';
  List<String> get calls {
    final f = File('${dir.path}/calls.log');
    return f.existsSync() ? f.readAsLinesSync() : <String>[];
  }

  List<String> get steps => calls.map((c) => c.split(' ').first).toList();
  String get argv {
    final f = File('${dir.path}/argv.log');
    return f.existsSync() ? f.readAsStringSync() : '';
  }
}

void main() {
  late Directory tmp;
  late File aab;

  setUp(() {
    tmp = Directory.systemTemp.createTempSync('jawwid-play-upload-');
    final fake = File('${tmp.path}/bin/curl')..createSync(recursive: true);
    fake.writeAsStringSync(_fakeCurl);
    expect(Process.runSync('chmod', ['+x', fake.path]).exitCode, 0);
    aab = File('${tmp.path}/app-release.aab')..writeAsBytesSync(List<int>.generate(4096, (i) => i % 251));
  });
  tearDown(() => tmp.deleteSync(recursive: true));

  _Run run({
    List<String>? args,
    Map<String, String> env = const {},
    String? failStep,
    int failCode = 500,
    String failBody = '{"error":{"code":500,"status":"INTERNAL","message":"boom-detail-not-for-logs","errors":[{"reason":"backendError"}]}}',
    bool withToken = true,
  }) {
    final bodyFile = File('${tmp.path}/fail-body.json')..writeAsStringSync(failBody);
    final environment = <String, String>{
      'PATH': '${tmp.path}/bin:${Platform.environment['PATH'] ?? '/usr/bin:/bin'}',
      'FAKE_DIR': tmp.path,
      'FAKE_FAIL_BODY_FILE': bodyFile.path,
      'FAKE_FAIL_CODE': '$failCode',
      if (failStep != null) 'FAKE_FAIL_STEP': failStep,
      if (withToken) 'PLAY_ACCESS_TOKEN': _token,
      ...env,
    };
    final r = Process.runSync(
      'bash',
      ['scripts/mobile/play-upload.sh', ...(args ?? [aab.path, '1.2.3', '45'])],
      environment: environment,
      includeParentEnvironment: false,
    );
    return _Run(r, tmp);
  }

  void expectNoToken(_Run r) {
    expect(r.out, isNot(contains(_token)), reason: 'the token was printed');
    expect(r.out, isNot(contains('Bearer')), reason: 'an auth header was printed');
    expect(r.argv, isNot(contains(_token)), reason: 'the token was on a curl command line');
    for (final c in r.calls) {
      expect(c, contains('env=clean'), reason: 'curl inherited PLAY_ACCESS_TOKEN: $c');
    }
  }

  test('happy path: exactly insert, upload, tracks.update(internal, draft), commit', () {
    final r = run();
    expect(r.result.exitCode, 0, reason: r.out);
    expect(r.steps, ['insert', 'upload', 'track', 'commit']);
    for (final c in r.calls) {
      expect(c, contains('auth=ok'), reason: 'every call gets the token on stdin: $c');
    }
    for (var n = 1; n <= 4; n++) {
      expect(File('${tmp.path}/auth.$n').readAsStringSync(), 'header = "Authorization: Bearer $_token"\n');
    }
    final body = jsonDecode(File('${tmp.path}/track-body.json').readAsStringSync());
    expect(body, {
      'track': 'internal',
      'releases': [
        {
          'name': '1.2.3 (45)',
          'versionCodes': ['45'],
          'status': 'draft',
        }
      ],
    });
    expect(r.argv, contains('$_api/edits'));
    expect(r.argv, contains('$_uploadApi/edits/$_edit/bundles?uploadType=media'));
    expect(r.argv, contains('--fail-with-body'));
    expect(r.result.stdout, contains('draft'));
    expect(r.result.stdout, contains('internal'));
    expectNoToken(r);
  });

  test('overrides of the package, track or status are refused before any call', () {
    final overrides = <String, String>{
      'PLAY_TRACK': 'qa',
      'PLAY_STATUS': 'live',
      'PLAY_RELEASE_STATUS': 'live',
      'PLAY_PACKAGE_NAME': 'com.example.other',
      'PLAY_ANYTHING': '',
      'TRACK': 'qa',
      'RELEASE_STATUS': 'live',
      'PACKAGE_NAME': 'com.example.other',
      'USER_FRACTION': '0.5',
    };
    for (final e in overrides.entries) {
      final r = run(env: {e.key: e.value});
      expect(r.result.exitCode, 2, reason: e.key);
      expect(r.result.stderr, contains(e.key), reason: e.key);
      expect(r.calls, isEmpty, reason: '${e.key}: no call may be made');
      expectNoToken(r);
    }
  });

  test('wrong arguments or no token: refused before any call', () {
    final cases = <String, _Run Function()>{
      'a fourth argument': () => run(args: [aab.path, '1.2.3', '45', 'qa']),
      'two arguments': () => run(args: [aab.path, '1.2.3']),
      'not an .aab': () => run(args: ['${tmp.path}/fail-body.json', '1.2.3', '45']),
      'missing bundle': () => run(args: ['${tmp.path}/none.aab', '1.2.3', '45']),
      'bad build name': () => run(args: [aab.path, '1.2', '45']),
      'bad build number': () => run(args: [aab.path, '1.2.3', '0']),
      'no token': () => run(withToken: false),
      'a malformed token': () => run(env: {'PLAY_ACCESS_TOKEN': 'abc"\nurl = "https://example.org'}),
    };
    for (final e in cases.entries) {
      final r = e.value();
      expect(r.result.exitCode, isNot(0), reason: e.key);
      expect(r.calls, isEmpty, reason: '${e.key}: no call may be made');
      expectNoToken(r);
    }
  });

  test('a failing step after the edit opened: the edit is deleted, nothing is committed, exit non-zero', () {
    final expected = {
      'upload': ['insert', 'upload', 'delete'],
      'track': ['insert', 'upload', 'track', 'delete'],
      'commit': ['insert', 'upload', 'track', 'commit', 'delete'],
    };
    for (final e in expected.entries) {
      for (final f in tmp.listSync().whereType<File>()) {
        if (f.path.endsWith('.log') || f.path.contains('/auth.')) f.deleteSync();
      }
      final r = run(failStep: e.key);
      expect(r.result.exitCode, isNot(0), reason: e.key);
      expect(r.steps, e.value, reason: e.key);
      expect(r.result.stderr, contains('HTTP 500'), reason: e.key);
      expect(r.result.stderr, contains('INTERNAL backendError'), reason: e.key);
      expect(r.out, isNot(contains('boom-detail-not-for-logs')), reason: '${e.key}: Google message text is not printed');
      expect(r.result.stderr, contains('deleted'), reason: e.key);
      expectNoToken(r);
    }
  });

  test('edits.insert fails: no edit to delete, exit non-zero', () {
    final r = run(failStep: 'insert');
    expect(r.result.exitCode, isNot(0));
    expect(r.steps, ['insert']);
    expectNoToken(r);
  });

  test('Play reads another versionCode from the bundle: deleted, never committed', () {
    final r = run(env: {'FAKE_VERSION_CODE': '44'});
    expect(r.result.exitCode, isNot(0));
    expect(r.steps, ['insert', 'upload', 'delete']);
    expect(r.result.stderr, contains('versionCode'));
    expectNoToken(r);
  });

  test('the app has no upload yet: the STOP message, exit 1', () {
    const notFound = '{"error":{"code":404,"message":"Package not found: com.jawwid.jawwid_chat.",'
        '"status":"NOT_FOUND","errors":[{"message":"Package not found: com.jawwid.jawwid_chat.","domain":"global","reason":"notFound"}]}}';
    final atInsert = run(failStep: 'insert', failCode: 404, failBody: notFound);
    expect(atInsert.result.exitCode, 1);
    expect(atInsert.result.stderr, contains(_stop));
    expect(atInsert.steps, ['insert']);
    expectNoToken(atInsert);

    for (final f in tmp.listSync().whereType<File>()) {
      if (f.path.endsWith('.log')) f.deleteSync();
    }
    final atUpload = run(failStep: 'upload', failCode: 404, failBody: notFound);
    expect(atUpload.result.exitCode, 1);
    expect(atUpload.result.stderr, contains(_stop));
    expect(atUpload.steps, ['insert', 'upload', 'delete']);
    expectNoToken(atUpload);
  });

  test('the package, track and status are readonly constants in the script', () {
    final script = File('scripts/mobile/play-upload.sh').readAsStringSync();
    expect(script, contains("readonly PACKAGE_NAME='com.jawwid.jawwid_chat'"));
    expect(script, contains("readonly TRACK='internal'"));
    expect(script, contains("readonly RELEASE_STATUS='draft'"));
  });

  test('install-sentry-cli.sh refuses a download that does not match the pinned SHA-256', () {
    final bin = Directory('${tmp.path}/bin2')..createSync();
    final fake = File('${bin.path}/curl')
      ..writeAsStringSync('#!/usr/bin/env bash\n'
          'while [ \$# -gt 0 ]; do [ "\$1" = -o ] && { shift; printf "not sentry-cli" > "\$1"; }; shift; done\n'
          'exit 0\n');
    expect(Process.runSync('chmod', ['+x', fake.path]).exitCode, 0);
    final dest = '${tmp.path}/sentry';
    final r = Process.runSync(
      'bash',
      ['scripts/mobile/install-sentry-cli.sh', dest],
      environment: {'PATH': '${bin.path}:${Platform.environment['PATH'] ?? '/usr/bin:/bin'}'},
      includeParentEnvironment: false,
    );
    expect(r.exitCode, 1, reason: '${r.stderr}');
    expect('${r.stderr}', anyOf(contains('does not match its pinned SHA-256'), contains('no pinned sentry-cli build')));
    expect(File('$dest/sentry-cli').existsSync(), isFalse);
    expect(File('$dest/sentry-cli.download').existsSync(), isFalse);
  });
}
