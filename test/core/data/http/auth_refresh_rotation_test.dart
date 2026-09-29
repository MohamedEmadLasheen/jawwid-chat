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

/// Refresh-token ROTATION, end to end through the real stack.
///
/// ## Why this file exists separately
///
/// `POST /auth/refresh` retires the token it is given. `AuthService.handleRefreshReuse` reads
/// a second presentation of a retired token as theft and revokes **every live session on the
/// account** — so the cost of getting this wrong is not a failed request, it is the user
/// being signed out of every device they own.
///
/// Everything here therefore asserts a counting property: how many times a refresh token was
/// presented, and which one. `http_transport_test.dart` proves the interceptor's mechanics
/// against a fake token provider; this proves the whole chain — ApiClient, StoredTokenProvider
/// and HttpAuthRepository — against a server that speaks the real `AUTH.*` vocabulary.
void main() {
  late TestServer server;

  setUp(() async => server = await TestServer.start());
  tearDown(() async => server.stop());

  ({ApiClient client, TokenStore store, List<AppError> ended}) stack() {
    final store = InMemoryTokenStore();
    final ended = <AppError>[];
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
        onEnded: (error) async => ended.add(error),
      ),
    );

    return (client: client, store: store, ended: ended);
  }

  Future<void> seed(TokenStore store, {String access = 'stale-access', String refresh = 'refresh-1'}) =>
      store.write(AuthSession(
        accessToken: access,
        refreshToken: refresh,
        // Already past, which is the state a cold start after fifteen minutes finds.
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

  Reply authError(int status, String code) => Reply(status, {
        'error': {'code': code, 'message': 'refused'},
      });

  /// A server that accepts exactly one access token and refuses every other.
  void acceptOnly(String token) {
    server.onRequest(
      'GET',
      '/probe',
      (request) => request.headers['authorization'] == 'Bearer $token'
          ? const Reply.ok({'ok': true})
          : authError(401, AuthErrors.unauthenticated),
    );
  }

  group('an expired access token is renewed, once', () {
    test('one refresh, and the request is replayed with the new token', () async {
      acceptOnly('fresh-access');
      server.on('POST', '/auth/refresh', [Reply.ok(pair('fresh-access', 'refresh-2'))]);

      final s = stack();
      await seed(s.store);

      final response = await s.client.get<Map<String, Object?>>('/probe');

      expect(response.data, {'ok': true});
      expect(server.countOf('POST', '/auth/refresh'), 1);
      expect(server.lastRequestTo('GET', '/probe')!.headers['authorization'],
          'Bearer fresh-access');
      expect(s.ended, isEmpty);
    });

    test('the rotated pair is persisted, replacing BOTH tokens', () async {
      acceptOnly('fresh-access');
      server.on('POST', '/auth/refresh', [Reply.ok(pair('fresh-access', 'refresh-2'))]);

      final s = stack();
      await seed(s.store);
      await s.client.get<Map<String, Object?>>('/probe');

      final stored = await s.store.read();
      expect(stored!.accessToken, 'fresh-access');
      expect(
        stored.refreshToken,
        'refresh-2',
        reason: 'keeping the old refresh token would make the next refresh read as theft',
      );
      expect(stored.accessTokenExpiresAt.isAfter(DateTime.now()), isTrue);
    });

    test('the retired refresh token is never presented again', () async {
      // Two full renewal cycles. The second must present what the first was given.
      acceptOnly('never-accepted');
      server.on('POST', '/auth/refresh', [
        Reply.ok(pair('access-2', 'refresh-2')),
        Reply.ok(pair('access-3', 'refresh-3')),
      ]);

      final s = stack();
      await seed(s.store);

      // Both cycles end in refusal -- the point is only which token each one presented.
      for (var cycle = 0; cycle < 2; cycle++) {
        try {
          await s.client.get<Map<String, Object?>>('/probe');
        } on AppError {
          // Expected: this server accepts no access token at all.
        }
      }

      final presented = server.requests
          .where((r) => r.path == '/auth/refresh')
          .map((r) => r.json['refreshToken'])
          .toList();

      expect(
        presented,
        ['refresh-1', 'refresh-2'],
        reason: 'the second cycle presents what the first was given, never the retired one',
      );
    });
  });

  group('concurrency', () {
    test('ten simultaneous 401s produce exactly ONE refresh', () async {
      // The property the account depends on. Ten independent refreshes would present the
      // same retired token nine times over, and the ninth would revoke every session the
      // user has anywhere.
      acceptOnly('fresh-access');
      server.on('POST', '/auth/refresh', [Reply.ok(pair('fresh-access', 'refresh-2'))]);

      final s = stack();
      await seed(s.store);

      final responses = await Future.wait([
        for (var i = 0; i < 10; i++) s.client.get<Map<String, Object?>>('/probe'),
      ]);

      expect(responses, hasLength(10));
      expect(responses.every((r) => r.data?['ok'] == true), isTrue,
          reason: 'every request completed, on the token the single refresh produced');
      expect(
        server.countOf('POST', '/auth/refresh'),
        1,
        reason: 'single-flight: one exchange for the whole burst',
      );

      final probes = server.requests.where((r) => r.path == '/probe');
      expect(probes.length, 20, reason: 'ten refusals, ten replays — no request replayed twice');
    });

    test('a burst presents the refresh token exactly once', () async {
      acceptOnly('fresh-access');
      server.on('POST', '/auth/refresh', [Reply.ok(pair('fresh-access', 'refresh-2'))]);

      final s = stack();
      await seed(s.store);
      await Future.wait([
        for (var i = 0; i < 10; i++) s.client.get<Map<String, Object?>>('/probe'),
      ]);

      final presentations = server.requests
          .where((r) => r.path == '/auth/refresh')
          .map((r) => r.json['refreshToken'])
          .toList();

      expect(presentations, ['refresh-1']);
    });
  });

  group('terminal states never spend the refresh token', () {
    test('a revoked session ends without attempting a refresh', () async {
      server.on('GET', '/probe', [authError(401, AuthErrors.sessionRevoked)]);
      server.on('POST', '/auth/refresh', [Reply.ok(pair('x', 'y'))]);

      final s = stack();
      await seed(s.store);

      await expectLater(
        s.client.get<Map<String, Object?>>('/probe'),
        throwsA(isA<AppError>().having((e) => e.kind, 'kind', AppErrorKind.sessionRevoked)),
      );

      expect(server.countOf('POST', '/auth/refresh'), 0);
      expect(s.ended.single.kind, AppErrorKind.sessionRevoked);
    });

    test('a disabled account ends without attempting a refresh', () async {
      server.on('GET', '/probe', [authError(403, AuthErrors.accountDisabled)]);
      server.on('POST', '/auth/refresh', [Reply.ok(pair('x', 'y'))]);

      final s = stack();
      await seed(s.store);

      await expectLater(
        s.client.get<Map<String, Object?>>('/probe'),
        throwsA(isA<AppError>().having((e) => e.kind, 'kind', AppErrorKind.accountDisabled)),
      );

      expect(server.countOf('POST', '/auth/refresh'), 0);
      expect(s.ended.single.kind, AppErrorKind.accountDisabled);
    });

    test('a locked account ends without attempting a refresh', () async {
      server.on('GET', '/probe', [authError(403, AuthErrors.accountLocked)]);
      server.on('POST', '/auth/refresh', [Reply.ok(pair('x', 'y'))]);

      final s = stack();
      await seed(s.store);

      await expectLater(
        s.client.get<Map<String, Object?>>('/probe'),
        throwsA(isA<AppError>().having((e) => e.kind, 'kind', AppErrorKind.accountLocked)),
      );

      expect(server.countOf('POST', '/auth/refresh'), 0);
      expect(s.ended.single.kind, AppErrorKind.accountLocked);
    });

    test('a refresh that is itself refused ends the session, and does not loop', () async {
      server.on('GET', '/probe', [authError(401, AuthErrors.unauthenticated)]);
      server.on('POST', '/auth/refresh', [authError(401, AuthErrors.sessionRevoked)]);

      final s = stack();
      await seed(s.store);

      await expectLater(
        s.client.get<Map<String, Object?>>('/probe').timeout(const Duration(seconds: 5)),
        throwsA(isA<AppError>()),
      );

      expect(server.countOf('POST', '/auth/refresh'), 1);
      expect(server.countOf('GET', '/probe'), 1, reason: 'nothing replayed without a token');
      expect(s.ended, isNotEmpty);
    });

    test('a still-401 replay ends the session rather than retrying forever', () async {
      server.on('GET', '/probe', [authError(401, AuthErrors.unauthenticated)]);
      server.on('POST', '/auth/refresh', [Reply.ok(pair('still-bad', 'refresh-2'))]);

      final s = stack();
      await seed(s.store);

      await expectLater(
        s.client.get<Map<String, Object?>>('/probe').timeout(const Duration(seconds: 5)),
        throwsA(isA<AppError>()),
      );

      expect(server.countOf('GET', '/probe'), lessThanOrEqualTo(2));
      expect(server.countOf('POST', '/auth/refresh'), 1);
      expect(s.ended, isNotEmpty);
    });
  });

  group('the authenticated request itself', () {
    test('carries the bearer token from the store', () async {
      server.on('GET', '/probe', [const Reply.ok({'ok': true})]);

      final s = stack();
      await s.store.write(AuthSession(
        accessToken: 'live-access',
        refreshToken: 'r',
        accessTokenExpiresAt: DateTime.now().add(const Duration(minutes: 15)),
      ));

      await s.client.get<Map<String, Object?>>('/probe');

      expect(server.requests.single.headers['authorization'], 'Bearer live-access');
    });

    test('with no session, no Authorization header is invented', () async {
      server.on('GET', '/probe', [authError(401, AuthErrors.unauthenticated)]);

      final s = stack();

      await expectLater(
        s.client.get<Map<String, Object?>>('/probe'),
        throwsA(isA<AppError>()),
      );

      expect(server.requests.first.headers.containsKey('authorization'), isFalse);
      expect(server.countOf('POST', '/auth/refresh'), 0,
          reason: 'there is no refresh token to present');
    });
  });
}
