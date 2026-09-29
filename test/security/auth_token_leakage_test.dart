import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_auth_repository.dart';
import 'package:jawwid_chat/core/data/wire/wire_vocab.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/logging/redacting_logger.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/device_descriptor.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/shared/models/auth.dart';

import '../core/data/http/test_server.dart';

class _NoDevice implements DeviceDescriptor {
  @override
  Future<DeviceDescription?> describe() async => null;
}

/// A token-shaped string, so a leak looks exactly like the real thing to every guard here.
const _accessToken =
    'eyJhbGciOiJIUzI1NiIsImtpZCI6ImFiYzEyMyJ9.eyJzdWIiOiJ1LTEiLCJzaWQiOiJzLTEifQ.c2lnbmF0dXJl';
const _refreshToken = 'rt_7f3c9a1e4b2d8f60a5c3e7b9d1f4a6c8e2b5d7f9a1c3e5b7';

/// Nothing carrying credentials may reach a log, an exception, a string, or a URL.
///
/// §56 forbids logging tokens; this asserts the property rather than trusting call sites to
/// remember it. Every check uses a value that is shaped like a real credential, because a
/// guard that only catches the string "token" catches nothing that matters.
void main() {
  group('values that are printed', () {
    test('AuthSession prints its expiry and nothing else', () {
      final session = AuthSession(
        accessToken: _accessToken,
        refreshToken: _refreshToken,
        accessTokenExpiresAt: DateTime.utc(2030),
      );

      expect(session.toString(), isNot(contains(_accessToken)));
      expect(session.toString(), isNot(contains(_refreshToken)));
      expect(session.toString(), contains('2030'));
    });

    test('AppError prints its classification, never a payload', () {
      const error = AppError(
        AppErrorKind.unauthenticated,
        code: AuthErrors.unauthenticated,
        debugDetail: 'anything at all',
      );

      expect(error.toString(), contains('unauthenticated'));
      expect(error.toString(), isNot(contains('anything at all')));
    });

    test('the auth failures this client raises never quote a credential', () {
      // The role refusal is the one that interpolates a server value; prove what it carries.
      try {
        HttpAuthRepository.roleFor(Wire.actorStaff);
        fail('staff must be refused');
      } on AppError catch (error) {
        expect(error.debugDetail, contains('staff'));
        expect(error.debugDetail, isNot(contains(_accessToken)));
        expect(error.debugDetail, isNot(contains(_refreshToken)));
      }
    });
  });

  group('values that are logged', () {
    test('a bearer header is masked wherever it appears in free text', () {
      final line = RedactingLogger.redactText('Authorization: Bearer $_accessToken');
      expect(line, isNot(contains(_accessToken)));
      expect(line, contains('[redacted]'));
    });

    test('a bare JWT is masked even without the Bearer prefix', () {
      expect(RedactingLogger.redactText(_accessToken), isNot(contains(_accessToken)));
    });

    test('structured token fields are masked by key, at any depth', () {
      final safe = RedactingLogger.redactMap({
        'accessToken': _accessToken,
        'nested': {
          'refreshToken': _refreshToken,
          'password': 'correct-horse',
        },
        'list': [
          {'token': _accessToken},
        ],
      });

      final rendered = safe.toString();
      expect(rendered, isNot(contains(_accessToken)));
      expect(rendered, isNot(contains(_refreshToken)));
      expect(rendered, isNot(contains('correct-horse')));
    });
  });

  group('values that travel', () {
    late TestServer server;

    setUp(() async => server = await TestServer.start());
    tearDown(() async => server.stop());

    test('no credential is ever put in a URL or a query string', () async {
      final store = InMemoryTokenStore();
      late final ApiClient client;

      final auth = HttpAuthRepository(
        transport: buildAuthTransport(config: ApiConfig(baseUrl: server.baseUrl)),
        protected: () => client,
        device: _NoDevice(),
      );
      client = buildApiClient(
        config: ApiConfig(baseUrl: server.baseUrl),
        tokens: StoredTokenProvider(
          store: store,
          auth: auth,
          onEnded: (_) async {},
        ),
      );

      server.on('POST', '/auth/login', [
        const Reply.ok({
          'tokenType': 'Bearer',
          'accessToken': _accessToken,
          'expiresIn': 900,
          'refreshToken': _refreshToken,
          'session': {'id': 's1', 'createdAt': '2026-09-29T09:00:00.000Z'},
          'actor': {
            'actorId': 'a1',
            'kind': Wire.actorContact,
            'displayName': 'Mona',
            'locale': 'ar',
            'isActive': true,
            'permissions': <String>[],
          },
        }),
      ]);
      server.on('POST', '/auth/refresh', [
        const Reply.ok({
          'tokenType': 'Bearer',
          'accessToken': _accessToken,
          'expiresIn': 900,
          'refreshToken': _refreshToken,
          'session': {'id': 's1', 'createdAt': '2026-09-29T09:00:00.000Z'},
          'actor': {
            'actorId': 'a1',
            'kind': Wire.actorContact,
            'displayName': 'Mona',
            'locale': 'ar',
            'isActive': true,
            'permissions': <String>[],
          },
        }),
      ]);
      server.on('GET', '/me', [
        const Reply.ok({
          'actorId': 'a1',
          'kind': Wire.actorContact,
          'displayName': 'Mona',
          'locale': 'ar',
          'isActive': true,
          'permissions': <String>[],
        }),
      ]);
      server.on('POST', '/auth/logout', [const Reply.ok({'ok': true})]);

      await store.write(await auth.signIn(username: 'mona', password: 'pw'));
      await auth.refresh(_refreshToken);
      await auth.currentUser();
      await auth.signOut();

      expect(server.requests, isNotEmpty);
      for (final request in server.requests) {
        expect(request.path, isNot(contains(_accessToken)));
        expect(request.path, isNot(contains(_refreshToken)));
        expect(
          request.query.values.join('|'),
          isNot(anyOf(contains(_accessToken), contains(_refreshToken))),
          reason: 'a credential in a query string lands in every proxy and access log',
        );
      }

      // The refresh token travels in a POST body, and only there.
      final refreshRequest = server.lastRequestTo('POST', '/auth/refresh')!;
      expect(refreshRequest.json['refreshToken'], _refreshToken);
    });
  });

  group('where credentials may be persisted', () {
    test('only the secure store is allowed to hold a token', () {
      // A structural guard, because this is the kind of thing that gets "temporarily" added
      // during a debugging session. shared_preferences is plaintext on both platforms.
      final offenders = <String>[];

      final files = Directory('lib')
          .listSync(recursive: true)
          .whereType<File>()
          .where((f) => f.path.endsWith('.dart'));

      for (final file in files) {
        final source = file.readAsStringSync();
        // The IMPORT, not the word: `secure_token_store.dart` names shared_preferences in a
        // comment saying tokens must never go there, which is the opposite of an offence.
        if (!source.contains('package:shared_preferences')) continue;
        final mentionsToken = RegExp(
          r'(access|refresh)[_ ]?token',
          caseSensitive: false,
        );
        if (mentionsToken.hasMatch(source)) {
          offenders.add(file.path);
        }
      }

      expect(
        offenders,
        isEmpty,
        reason: 'tokens belong in SecureTokenStore only (Keychain / Keystore)',
      );
    });

    test('flutter_secure_storage is imported in exactly one place', () {
      final importers = Directory('lib')
          .listSync(recursive: true)
          .whereType<File>()
          .where((f) => f.path.endsWith('.dart'))
          .where((f) => f.readAsStringSync().contains('package:flutter_secure_storage'))
          .map((f) => f.path)
          .toList();

      expect(
        importers,
        ['lib/core/storage/secure_token_store.dart'],
        reason: 'one door to the keychain, so there is one place to audit',
      );
    });
  });
}
