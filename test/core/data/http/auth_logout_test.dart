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

/// Sign-out, and the orphan session it used to leave behind.
///
/// The moment a person is most likely to press sign out is after the app has sat in the
/// background past the fifteen-minute access-token lifetime. The first `POST /auth/logout`
/// then 401s, `ApiClient` renews through the one refresh authority — which ROTATES, minting
/// a fresh session — and declines to replay a POST. The client cleared its tokens and walked
/// away, leaving a brand-new live session on the server that nobody held credentials for.
///
/// Every test here is a counting test, because the fix is only correct if it is BOUNDED:
/// one logout, at most one refresh, at most one retry, and never a third request.
void main() {
  late TestServer server;

  setUp(() async => server = await TestServer.start());
  tearDown(() async => server.stop());

  ({HttpAuthRepository auth, TokenStore store, ApiClient client, List<AppError> ended})
      stack() {
    final store = InMemoryTokenStore();
    final ended = <AppError>[];
    late final ApiClient client;

    final auth = HttpAuthRepository(
      transport: buildAuthTransport(config: ApiConfig(baseUrl: server.baseUrl)),
      protected: () => client,
      device: _NoDevice(),
      currentAccessToken: () async => (await store.read())?.accessToken,
    );

    client = buildApiClient(
      config: ApiConfig(baseUrl: server.baseUrl),
      tokens: StoredTokenProvider(
        store: store,
        auth: auth,
        onEnded: (error) async => ended.add(error),
      ),
    );

    return (auth: auth, store: store, client: client, ended: ended);
  }

  Future<void> seed(TokenStore store, {String access = 'access-1'}) => store.write(
        AuthSession(
          accessToken: access,
          refreshToken: 'refresh-1',
          accessTokenExpiresAt: DateTime.now().add(const Duration(minutes: 5)),
        ),
      );

  Map<String, Object?> pair(String access, String refresh) => {
        'tokenType': 'Bearer',
        'accessToken': access,
        'expiresIn': 900,
        'refreshToken': refresh,
        'session': {'id': 's1', 'createdAt': '2026-09-29T09:00:00.000Z'},
        'actor': {
          'actorId': 'a1',
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

  int logouts() => server.countOf('POST', '/auth/logout');
  int refreshes() => server.countOf('POST', '/auth/refresh');

  test('Case A — a valid access token logs out in exactly one request', () async {
    server.on('POST', '/auth/logout', [const Reply.ok({'ok': true})]);

    final s = stack();
    await seed(s.store);
    await s.auth.signOut();

    expect(logouts(), 1);
    expect(refreshes(), 0);
    expect(server.requests.single.headers['authorization'], 'Bearer access-1');
  });

  test('Case B — an expired access token: one refresh, one retry, no orphan', () async {
    // The server accepts only the rotated token, which is what an expired access token
    // actually looks like from the client's side.
    server.onRequest(
      'POST',
      '/auth/logout',
      (request) => request.headers['authorization'] == 'Bearer access-2'
          ? const Reply.ok({'ok': true})
          : authError(401, AuthErrors.unauthenticated),
    );
    server.on('POST', '/auth/refresh', [Reply.ok(pair('access-2', 'refresh-2'))]);

    final s = stack();
    await seed(s.store);
    await s.auth.signOut();

    expect(refreshes(), 1, reason: 'exactly one, through the single refresh authority');
    expect(logouts(), 2, reason: 'the original attempt and exactly one retry');
    expect(server.requests, hasLength(3), reason: 'no third request of any kind');

    final retry = server.lastRequestTo('POST', '/auth/logout')!;
    expect(
      retry.headers['authorization'],
      'Bearer access-2',
      reason: 'the retry must carry the rotated token, or it is pointless',
    );
  });

  test('Case B — the rotated session is the one that gets ended', () async {
    // The whole point: the session the refresh minted must not survive the sign-out.
    final endedSessions = <String?>[];
    server.onRequest('POST', '/auth/logout', (request) {
      endedSessions.add(request.headers['authorization']);
      return request.headers['authorization'] == 'Bearer access-2'
          ? const Reply.ok({'ok': true})
          : authError(401, AuthErrors.unauthenticated);
    });
    server.on('POST', '/auth/refresh', [Reply.ok(pair('access-2', 'refresh-2'))]);

    final s = stack();
    await seed(s.store);
    await s.auth.signOut();

    expect(endedSessions, ['Bearer access-1', 'Bearer access-2']);
  });

  test('Case C — a refresh that fails means no retry at all', () async {
    server.on('POST', '/auth/logout', [authError(401, AuthErrors.unauthenticated)]);
    server.on('POST', '/auth/refresh', [authError(401, AuthErrors.sessionRevoked)]);

    final s = stack();
    await seed(s.store);
    await expectLater(s.auth.signOut(), completes);

    expect(refreshes(), 1);
    expect(logouts(), 1, reason: 'there is no new credential, so a retry would be refused');
    expect(s.ended, isNotEmpty, reason: 'the session ended, and the app is told');
  });

  test('Case C — a terminal refusal on the first attempt never refreshes', () async {
    server.on('POST', '/auth/logout', [authError(403, AuthErrors.accountDisabled)]);

    final s = stack();
    await seed(s.store);
    await expectLater(s.auth.signOut(), completes);

    expect(refreshes(), 0);
    expect(logouts(), 1);
  });

  test('Case D — a retry that fails does not refresh or retry again', () async {
    // The retry goes over AuthTransport, which has no interceptor, so its refusal cannot
    // reach the refresh machinery at all. Bounded by construction, not by a counter.
    server.on('POST', '/auth/logout', [
      authError(401, AuthErrors.unauthenticated),
      authError(401, AuthErrors.unauthenticated),
      authError(401, AuthErrors.unauthenticated),
    ]);
    server.on('POST', '/auth/refresh', [Reply.ok(pair('access-2', 'refresh-2'))]);

    final s = stack();
    await seed(s.store);
    await expectLater(s.auth.signOut(), completes);

    expect(refreshes(), 1, reason: 'the retry cannot provoke a second renewal');
    expect(logouts(), 2, reason: 'no third attempt');
    expect(server.requests, hasLength(3));
  });

  test('Case E — concurrent sign-outs run one flow, not several', () async {
    server.onRequest(
      'POST',
      '/auth/logout',
      (request) => request.headers['authorization'] == 'Bearer access-2'
          ? const Reply.ok({'ok': true})
          : authError(401, AuthErrors.unauthenticated),
    );
    server.on('POST', '/auth/refresh', [Reply.ok(pair('access-2', 'refresh-2'))]);

    final s = stack();
    await seed(s.store);

    await Future.wait([for (var i = 0; i < 5; i++) s.auth.signOut()]);

    expect(refreshes(), 1);
    expect(logouts(), 2, reason: 'five callers, one flow');
    expect(server.requests, hasLength(3));
  });

  test('a network failure clears locally and sends nothing more', () async {
    // No route registered at all: the test server answers 404, which is neither refreshable
    // nor terminal.
    final s = stack();
    await seed(s.store);

    await expectLater(s.auth.signOut(), completes);

    expect(refreshes(), 0);
    expect(logouts(), 1);
  });

  test('generic POST replay was not switched on to achieve any of this', () async {
    // The fix is logout-specific. An ordinary POST that 401s still refreshes once and is
    // still NOT replayed, because replaying a write the server may already have applied is
    // how duplicates happen.
    server.on('POST', '/messages', [
      authError(401, AuthErrors.unauthenticated),
      const Reply.ok({'ok': true}),
    ]);
    server.on('POST', '/auth/refresh', [Reply.ok(pair('access-2', 'refresh-2'))]);

    final s = stack();
    await seed(s.store);

    await expectLater(
      s.auth.signOut().then((_) => null),
      completes,
    );
    server.requests.clear();

    late final ApiClient client2;
    final store2 = InMemoryTokenStore();
    final auth2 = HttpAuthRepository(
      transport: buildAuthTransport(config: ApiConfig(baseUrl: server.baseUrl)),
      protected: () => client2,
      device: _NoDevice(),
      currentAccessToken: () async => (await store2.read())?.accessToken,
    );
    client2 = buildApiClient(
      config: ApiConfig(baseUrl: server.baseUrl),
      tokens: StoredTokenProvider(
        store: store2,
        auth: auth2,
        onEnded: (_) async {},
      ),
    );
    await seed(store2);

    await expectLater(
      client2.post<Map<String, Object?>>('/messages'),
      throwsA(isA<AppError>()),
    );

    expect(
      server.countOf('POST', '/messages'),
      1,
      reason: 'an unkeyed POST is still never replayed',
    );
  });

  test('a sign-out racing a protected 401 shares ONE refresh', () async {
    // The scenario the future realtime and push consumers will actually produce: the user
    // presses sign out while a background request is in flight, and both are refused for the
    // same expired access token.
    //
    // Both enter the single refresh authority, so there is one rotation, not two -- which
    // matters more here than anywhere else, because presenting a retired refresh token is
    // read as theft and revokes every live session on the account. The logout retry then
    // carries the token that rotation produced, so the session it ends is the live one.
    final logoutTokens = <String?>[];
    server.onRequest('POST', '/auth/logout', (request) {
      logoutTokens.add(request.headers['authorization']);
      return request.headers['authorization'] == 'Bearer access-2'
          ? const Reply.ok({'ok': true})
          : authError(401, AuthErrors.unauthenticated);
    });
    server.onRequest(
      'GET',
      '/probe',
      (request) => request.headers['authorization'] == 'Bearer access-2'
          ? const Reply.ok({'ok': true})
          : authError(401, AuthErrors.unauthenticated),
    );
    // Slow enough that both callers are inside the refresh window together.
    server.on('POST', '/auth/refresh', [
      Reply(200, pair('access-2', 'refresh-2'), delay: const Duration(milliseconds: 120)),
    ]);

    final s = stack();
    await seed(s.store);

    // One session, two callers -- the same store, the same token provider, the same client.
    await Future.wait<void>([
      s.auth.signOut(),
      s.client
          .get<Map<String, Object?>>('/probe')
          .then<void>((_) {}, onError: (Object _) {}),
    ]);

    expect(refreshes(), 1, reason: 'one rotation for the whole session, not one per caller');
    expect(logoutTokens, ['Bearer access-1', 'Bearer access-2']);
    expect(
      server.countOf('GET', '/probe'),
      2,
      reason: 'refused once, replayed once on the shared token',
    );
    expect(server.requests, hasLength(5), reason: '2 logout + 1 refresh + 2 probe');
    expect((await s.store.read())!.accessToken, 'access-2');
  });
}
