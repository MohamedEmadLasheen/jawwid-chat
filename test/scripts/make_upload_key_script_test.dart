// LR-07c: scripts/mobile/make-upload-key.sh makes the Android upload keystore. It must never
// overwrite an existing keystore, must refuse a password the CI workflow cannot use, and must never
// show the password or put it on keytool's command line. It is run here against a stand-in `keytool`
// that records its arguments and its environment, so no real key is ever made.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  const password = 'Abcdefgh12345678XyZ9';
  const fingerprint =
      'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89';
  const keystoreContent = 'FAKE-KEYSTORE-BYTES-0123456789';
  final script = '${Directory.current.path}/scripts/mobile/make-upload-key.sh';

  late Directory tmp;
  late Directory work;
  late File keytool;
  late File argvLog;
  late File envLog;

  setUp(() {
    tmp = Directory.systemTemp.createTempSync('fake_keytool_');
    work = Directory('${tmp.path}/work')..createSync();
    argvLog = File('${tmp.path}/argv.log');
    envLog = File('${tmp.path}/env.log');
    keytool = File('${tmp.path}/keytool')
      ..writeAsStringSync('#!/bin/sh\n'
          'for a in "\$@"; do printf \'%s\\n\' "\$a"; done >> "\$FAKE_KEYTOOL_ARGV"\n'
          'printf \'%s\\n\' "<end>" >> "\$FAKE_KEYTOOL_ARGV"\n'
          'env >> "\$FAKE_KEYTOOL_ENV"\n'
          'printf \'%s\\n\' "<end>" >> "\$FAKE_KEYTOOL_ENV"\n'
          'case "\$1" in\n'
          '  -genkeypair)\n'
          '    printf \'%s\' "$keystoreContent" > jawwid-upload.jks\n'
          '    chmod 644 jawwid-upload.jks\n'
          '    echo "Generating 4,096 bit RSA key pair" >&2 ;;\n'
          '  -list)\n'
          '    printf \'Alias name: jawwid-upload\\nCertificate fingerprints:\\n\'\n'
          '    printf \'\\t SHA1: 11:22:33:44:55:66:77:88:99:00:11:22:33:44:55:66:77:88:99:00\\n\'\n'
          '    printf \'\\t SHA256: %s\\n\' "\${FAKE_FPR:-$fingerprint}"\n'
          '    printf \'Signature algorithm name: SHA384withRSA\\n\' ;;\n'
          'esac\n');
    expect(Process.runSync('chmod', ['+x', keytool.path]).exitCode, 0);
  });

  tearDown(() => tmp.deleteSync(recursive: true));

  File keystore() => File('${work.path}/jawwid-upload.jks');

  Future<({int code, String out, String err})> run(String stdin,
      {Map<String, String> env = const {}, Directory? dir}) async {
    final p = await Process.start('bash', [script],
        workingDirectory: (dir ?? work).path,
        environment: {
          'PATH': Platform.environment['PATH'] ?? '/usr/bin:/bin',
          'KEYTOOL': keytool.path,
          'FAKE_KEYTOOL_ARGV': argvLog.path,
          'FAKE_KEYTOOL_ENV': envLog.path,
          ...env,
        },
        includeParentEnvironment: false);
    try {
      p.stdin.write(stdin);
      await p.stdin.close();
    } on IOException {
      // The script may refuse and exit before it reads stdin.
    }
    final out = p.stdout.transform(utf8.decoder).join();
    final err = p.stderr.transform(utf8.decoder).join();
    final code = await p.exitCode;
    return (code: code, out: await out, err: await err);
  }

  test('a good password: creates the keystore with mode 600 and prints the fingerprint line', () async {
    final r = await run('$password\n');
    expect(r.code, 0, reason: r.err);
    expect(keystore().existsSync(), isTrue);
    expect(keystore().statSync().mode & 0x1FF, 0x180, reason: 'mode must be 600');
    expect(r.out, contains('ANDROID_UPLOAD_CERT_SHA256 = $fingerprint'));
    for (final name in [
      'ANDROID_UPLOAD_KEYSTORE_BASE64',
      'ANDROID_UPLOAD_KEYSTORE_PASSWORD',
      'ANDROID_UPLOAD_KEY_PASSWORD',
    ]) {
      expect(r.out, contains(name));
    }
    expect(r.out, contains('ANDROID_UPLOAD_KEY_ALIAS         = jawwid-upload'));
    expect(r.out, contains("base64 -i jawwid-upload.jks | tr -d '\\n' | pbcopy"));
    // Never the keystore's base64 (nor its bytes), never keytool's own chatter on stdout.
    expect(r.out, isNot(contains(base64.encode(utf8.encode(keystoreContent)))));
    expect(r.out, isNot(contains(keystoreContent)));
    expect(r.out, isNot(contains('Generating')));
  });

  test('never prints the password, and passes it to keytool through the environment, not argv', () async {
    final r = await run('$password\n');
    expect(r.code, 0, reason: r.err);
    expect('${r.out}${r.err}', isNot(contains(password)));

    final calls = argvLog.readAsStringSync().split('<end>\n').where((c) => c.isNotEmpty).toList();
    expect(calls, hasLength(2), reason: 'genkeypair, then list');
    expect(argvLog.readAsStringSync(), isNot(contains(password)));
    final gen = calls.first.split('\n')..removeLast();
    final envName = gen[gen.indexOf('-storepass:env') + 1];
    expect(gen, [
      '-genkeypair',
      '-keystore', 'jawwid-upload.jks',
      '-storetype', 'PKCS12',
      '-alias', 'jawwid-upload',
      '-keyalg', 'RSA',
      '-keysize', '4096',
      '-validity', '10000',
      '-dname', 'CN=Jawwid LLC upload key, O=Jawwid LLC',
      '-storepass:env', envName,
      '-keypass:env', envName,
    ]);
    final list = calls.last.split('\n')..removeLast();
    expect(list.take(2), ['-list', '-v']);
    expect(list, containsAllInOrder(['-storepass:env', envName]));
    expect(list.where((a) => a.startsWith('-storepass') && a != '-storepass:env'), isEmpty);

    // Both keytool calls saw the password in exactly that environment variable.
    final envs = envLog.readAsStringSync().split('<end>\n').where((c) => c.isNotEmpty).toList();
    expect(envs, hasLength(2));
    for (final e in envs) {
      expect(e.split('\n'), contains('$envName=$password'));
    }
    // No file the run left behind holds the password.
    for (final f in work.listSync().whereType<File>()) {
      expect(f.readAsStringSync(), isNot(contains(password)), reason: f.path);
    }
  });

  test('refuses to overwrite an existing keystore (file or symlink), and never calls keytool', () async {
    keystore().writeAsStringSync('KEEP-ME');
    final r = await run('$password\n');
    expect(r.code, isNot(0));
    expect(r.err, contains('already exists'));
    expect(keystore().readAsStringSync(), 'KEEP-ME');
    expect(argvLog.existsSync(), isFalse);

    keystore().deleteSync();
    Link('${work.path}/jawwid-upload.jks').createSync('${tmp.path}/nowhere');
    final l = await run('$password\n');
    expect(l.code, isNot(0));
    expect(l.err, contains('already exists'));
    expect(File('${tmp.path}/nowhere').existsSync(), isFalse);
    expect(argvLog.existsSync(), isFalse);
  });

  test('refuses weak or invalid passwords before keytool is reached, without echoing them', () async {
    final bad = <String>[
      '', // empty
      'Abc123', // short
      'Abcdefgh1234567', // 15 characters
      'Abcdefgh12345678!', // punctuation
      'Abcdefgh 12345678', // space
      'Abcdefgh12345678\t', // trailing tab
      'Abcdefgh12345678\r', // Windows line end
      'Äbcdefgh12345678', // non-ASCII letter
      'Abcdefgh1234567=', // properties-file metacharacter
    ];
    for (final pw in bad) {
      final r = await run('$pw\n');
      expect(r.code, isNot(0), reason: jsonEncode(pw));
      expect(r.err, contains('password'), reason: jsonEncode(pw));
      if (pw.length > 3) expect('${r.out}${r.err}', isNot(contains(pw)), reason: jsonEncode(pw));
      expect(keystore().existsSync(), isFalse, reason: jsonEncode(pw));
    }
    expect(argvLog.existsSync(), isFalse);
  });

  test('stdin must hold exactly one line', () async {
    final r = await run('$password\n$password\n');
    expect(r.code, isNot(0));
    expect(r.err, contains('one line'));
    expect(argvLog.existsSync(), isFalse);
  });

  test('a password without a final newline is accepted', () async {
    final r = await run(password);
    expect(r.code, 0, reason: r.err);
    expect(r.out, contains('ANDROID_UPLOAD_CERT_SHA256 = $fingerprint'));
  });

  test('refuses to run in CI, and refuses any argument', () async {
    for (final env in [
      {'CI': 'true'},
      {'GITHUB_ACTIONS': 'true'},
    ]) {
      final r = await run('$password\n', env: env);
      expect(r.code, isNot(0), reason: '$env');
      expect(r.err, contains('CI'), reason: '$env');
    }
    final p = Process.runSync('bash', [script, password],
        workingDirectory: work.path,
        environment: {'PATH': Platform.environment['PATH'] ?? '/usr/bin:/bin', 'KEYTOOL': keytool.path},
        includeParentEnvironment: false);
    expect(p.exitCode, isNot(0));
    expect('${p.stdout}${p.stderr}', isNot(contains(password)));
    expect(argvLog.existsSync(), isFalse);
    expect(keystore().existsSync(), isFalse);
  });

  test('refuses a git checkout: .git (dir or file) in the folder or in any parent', () async {
    Future<void> expectRefused(Directory dir, String why) async {
      final r = await run('$password\n', dir: dir);
      expect(r.code, isNot(0), reason: why);
      expect(r.err, contains('git checkout'), reason: why);
      expect('${r.out}${r.err}', isNot(contains(password)), reason: why);
      expect(File('${dir.path}/jawwid-upload.jks').existsSync(), isFalse, reason: why);
      expect(argvLog.existsSync(), isFalse, reason: why);
    }

    // A worktree has a .git FILE in its root.
    final dotGitFile = File('${work.path}/.git')..writeAsStringSync('gitdir: /elsewhere\n');
    await expectRefused(work, '.git file in the folder');
    dotGitFile.deleteSync();

    // A normal clone has a .git DIRECTORY, here two levels above the folder.
    Directory('${tmp.path}/.git').createSync();
    final nested = Directory('${work.path}/a/b')..createSync(recursive: true);
    await expectRefused(nested, '.git directory in a parent');
    await expectRefused(work, '.git directory in the parent');
  });

  test('refuses a project area: a path containing /dev/ or /Documents/jawwid', () async {
    for (final rel in ['dev', 'dev/upload-key', 'x/DEV/y', 'Documents/jawwid', 'Documents/jawwid-chat/k']) {
      final dir = Directory('${tmp.path}/$rel')..createSync(recursive: true);
      final r = await run('$password\n', dir: dir);
      expect(r.code, isNot(0), reason: rel);
      expect(r.err, contains('project area'), reason: rel);
      expect('${r.out}${r.err}', isNot(contains(password)), reason: rel);
      expect(File('${dir.path}/jawwid-upload.jks').existsSync(), isFalse, reason: rel);
    }
    expect(argvLog.existsSync(), isFalse);

    // Look-alikes that are not project areas still work.
    for (final rel in ['devices', 'Documents/notes']) {
      final dir = Directory('${tmp.path}/$rel')..createSync(recursive: true);
      final r = await run('$password\n', dir: dir);
      expect(r.code, 0, reason: '$rel: ${r.err}');
      expect(File('${dir.path}/jawwid-upload.jks').existsSync(), isTrue, reason: rel);
    }
  });

  test('a fingerprint that cannot be read is a failure, not a wrong value', () async {
    final r = await run('$password\n', env: {'FAKE_FPR': 'not-a-fingerprint'});
    expect(r.code, isNot(0));
    expect(r.out, isNot(contains('ANDROID_UPLOAD_CERT_SHA256')));
    expect(r.err, contains('SHA-256'));
  });

  test('the script unsets the password variable and never uses a plain -storepass or -keypass', () {
    final text = File(script).readAsStringSync();
    expect(text, contains('unset JAWWID_UPLOAD_KEYSTORE_PW\n'));
    expect(RegExp(r'-(storepass|keypass)(?!:env)\b').hasMatch(text.split('\n').where((l) => !l.trimLeft().startsWith('#')).join('\n')), isFalse);
    expect(RegExp(r'read -r -s -p').allMatches(text), hasLength(2), reason: 'hidden prompt, twice');
  });
}
