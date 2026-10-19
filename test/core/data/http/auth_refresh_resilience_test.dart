import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_auth_repository.dart';
import 'package:jawwid_chat/core/data/wire/wire_vocab.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/device_descriptor.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/shared/models/auth.dart';

import 'test_server.dart';

class _NoDevice implements DeviceDescriptor {
  @override
  Future<DeviceDescription?> describe() async => null;
}

/// What a refresh does when the network, not the session, is the problem -- and what it does
/// when two consumers renew at once. Both are launch paths: a cold start after the access
/// token expired renews before anything renders, and a resume renews from the socket and a
/// screen in the same moment.
///
/// The invariant underneath every case: a refresh token is never presented twice. The
/// backend reads a second presentation as theft and revokes every session on the account.
void main() {
  late TestServer server;

  setUp(() async => server = await TestServer.start());
  tearDown(() async => server.stop());

  /// A base URL nothing listens on: the connection is refused, so the request provably never
  /// reached a server.
  Future<String> deadBaseUrl() async {
    final socket = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
    final port = socket.port;
    await socket.close();
    return 'http://127.0.0.1:$port';
  }

  ({ApiClient client, StoredTokenProvider tokens, TokenStore store, List<AppError> ended})
      stack({String? authBaseUrl, Duration authReceive = const Duration(seconds: 5)}) {
    final store = InMemoryTokenStore();
    final ended = <AppError>[];
    late final ApiClient client;

    final auth = HttpAuthRepository(
      transport: buildAuthTransport(
        config: ApiConfig(baseUrl: authBaseUrl ?? server.baseUrl, receiveTimeout: authReceive),
      ),
      protected: () => client,
      device: _NoDevice(),
      currentAccessToken: () async => (await store.read())?.accessToken,
    );
    final tokens = StoredTokenProvider(
      store: store,
      auth: auth,
      onEnded: (error) async => ended.add(error),
    );
    client = buildApiClient(config: ApiConfig(baseUrl: server.baseUrl), tokens: tokens);
    return (client: client, tokens: tokens, store: store, ended: ended);
  }

  Future<void> seed(TokenStore store) => store.write(AuthSession(
        accessToken: 'stale-access',
        refreshToken: 'refresh-1',
        accessTokenExpiresAt: DateTime.now().subtract(const Duration(minutes: 1)),
      ));

  Map<String, Object?> pair(String access, String refresh) => {
        'tokenType': 'Bearer',
        'accessToken': access,
        'expiresIn': 900,
        'refreshToken': refresh,
        'session': {'id': 's1', 'createdAt': '2026-09-29T09:00:00.000Z'},
        'actor': {
          'actorId': 'actor-1',
          'kind': Wire.actorContact,
          'displayName': 'Mona',
          'locale': 'ar',
          'isActive': true,
          'permissions': <String>[],
        },
      };

  void acceptOnly(String token) {
    server.onRequest(
      'GET',
      '/probe',
      (request) => request.headers['authorization'] == 'Bearer $token'
          ? const Reply.ok({'ok': true})
          : const Reply(401, {
              'error': {'code': AuthErrors.unauthenticated, 'message': 'refused'},
            }),
    );
  }

  group('the socket and a screen renewing at once', () {
    test('share ONE refresh: the token is presented once, and both get the new one', () async {
      acceptOnly('fresh-access');
      // Slow enough that the second renewal starts while the first is in flight.
      server.on('POST', '/auth/refresh', [
        Reply(200, pair('fresh-access', 'refresh-2'), delay: const Duration(milliseconds: 150)),
      ]);
      final s = stack();
      await seed(s.store);

      // The realtime client renews by calling refresh() on the shared provider directly;
      // the screen's request renews through ApiClient's 401 path.
      final results = await Future.wait<Object?>([
        s.tokens.refresh(),
        s.client.get<Map<String, Object?>>('/probe').then((r) => r.data),
        s.tokens.refresh(),
      ]);

      expect(server.countOf('POST', '/auth/refresh'), 1,
          reason: 'a second exchange of refresh-1 is reuse: every session on the account revoked');
      expect(results, ['fresh-access', {'ok': true}, 'fresh-access']);
      expect((await s.store.read())!.refreshToken, 'refresh-2');
      expect(s.ended, isEmpty);
    });

    test('a later renewal is a new flight, presenting the rotated token', () async {
      server.on('POST', '/auth/refresh', [
        Reply.ok(pair('access-2', 'refresh-2')),
        Reply.ok(pair('access-3', 'refresh-3')),
      ]);
      final s = stack();
      await seed(s.store);

      expect(await s.tokens.refresh(), 'access-2');
      expect(await s.tokens.refresh(), 'access-3');
      expect(server.countOf('POST', '/auth/refresh'), 2);
      expect(
        server.requests
            .where((r) => r.method == 'POST' && r.path == '/auth/refresh')
            .map((r) => r.json['refreshToken']),
        ['refresh-1', 'refresh-2'],
      );
    });
  });

  group('a refresh that never reached the server keeps the session', () {
    test('the request fails as "no network"; nothing is ended, nothing is cleared', () async {
      acceptOnly('fresh-access');
      final s = stack(authBaseUrl: await deadBaseUrl());
      await seed(s.store);

      final error = await s.client.get<Object?>('/probe').then<Object?>((_) => null,
          onError: (Object e) => e);

      expect(error, isA<AppError>());
      final failure = error! as AppError;
      expect(failure.kind, AppErrorKind.network);
      expect(failure.neverReachedServer, isTrue);
      expect(s.ended, isEmpty, reason: 'no signal is not a sign-out');
      expect((await s.store.read())?.refreshToken, 'refresh-1');
    });

    test('the realtime path gets null and no exception', () async {
      final s = stack(authBaseUrl: await deadBaseUrl());
      await seed(s.store);

      expect(await s.tokens.refresh(), isNull);
      expect((await s.tokens.renew()).unreachable?.neverReachedServer, isTrue);
      expect(s.ended, isEmpty);
    });
  });

  group('a refresh the server MAY have processed ends the session locally', () {
    test('an answer lost to a read timeout: ended, and refresh-1 is never presented again',
        () async {
      acceptOnly('fresh-access');
      server.on('POST', '/auth/refresh', [
        Reply(200, pair('fresh-access', 'refresh-2'), delay: const Duration(seconds: 2)),
      ]);
      final s = stack(authReceive: const Duration(milliseconds: 200));
      await seed(s.store);

      final error = await s.client.get<Object?>('/probe').then<Object?>((_) => null,
          onError: (Object e) => e);

      expect(error, isA<AppError>());
      expect(s.ended, hasLength(1),
          reason: 'the server may have rotated: re-presenting refresh-1 would be reuse');
      expect(server.countOf('POST', '/auth/refresh'), 1);
    });

    test('a 5xx: ended, presented once', () async {
      acceptOnly('fresh-access');
      server.on('POST', '/auth/refresh', [
        const Reply(503, {'error': {'code': 'unavailable', 'message': 'down'}}),
      ]);
      final s = stack();
      await seed(s.store);

      await s.client.get<Object?>('/probe').then<Object?>((_) => null, onError: (Object e) => e);

      expect(s.ended, hasLength(1));
      expect(server.countOf('POST', '/auth/refresh'), 1);
    });

    test('a refusal still ends the session (unchanged)', () async {
      acceptOnly('fresh-access');
      server.on('POST', '/auth/refresh', [
        const Reply(401, {'error': {'code': AuthErrors.sessionRevoked, 'message': 'revoked'}}),
      ]);
      final s = stack();
      await seed(s.store);

      await s.client.get<Object?>('/probe').then<Object?>((_) => null, onError: (Object e) => e);

      expect(s.ended, hasLength(1));
    });
  });
}
