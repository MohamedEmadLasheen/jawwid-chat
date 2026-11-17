import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_auth_repository.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
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

/// LR-46 follow-up: the sign-out says whether the server gave a verdict, so a sign-out made
/// offline can be kept pending and retried instead of leaving the server session live.
void main() {
  late TestServer server;

  setUp(() async => server = await TestServer.start());
  tearDown(() async => server.stop());

  ({HttpAuthRepository auth, TokenStore store}) stack(String baseUrl) {
    final store = InMemoryTokenStore();
    late final ApiClient client;
    final auth = HttpAuthRepository(
      transport: buildAuthTransport(config: ApiConfig(baseUrl: baseUrl)),
      protected: () => client,
      device: _NoDevice(),
      currentAccessToken: () async => (await store.read())?.accessToken,
    );
    client = buildApiClient(
      config: ApiConfig(baseUrl: baseUrl),
      tokens: StoredTokenProvider(store: store, auth: auth, onEnded: (_) async {}),
    );
    return (auth: auth, store: store);
  }

  Future<void> seed(TokenStore store) => store.write(
        AuthSession(
          accessToken: 'access-1',
          refreshToken: 'refresh-1',
          accessTokenExpiresAt: DateTime.now().add(const Duration(minutes: 5)),
        ),
      );

  test('a 2xx is a verdict: ended', () async {
    server.on('POST', '/auth/logout', [const Reply.ok({'ok': true})]);
    final s = stack(server.baseUrl);
    await seed(s.store);

    expect(await s.auth.signOutReporting(), SignOutOutcome.ended);
  });

  test('a 401 revocation is a verdict too: the session is already over', () async {
    server.on('POST', '/auth/logout', [
      const Reply(401, {
        'error': {'code': 'AUTH.SESSION_REVOKED', 'message': 'refused'},
      }),
    ]);
    final s = stack(server.baseUrl);
    await seed(s.store);

    expect(await s.auth.signOutReporting(), SignOutOutcome.ended);
  });

  test('a 5xx is not a verdict: unreached', () async {
    server.on('POST', '/auth/logout', [const Reply(503, {})]);
    final s = stack(server.baseUrl);
    await seed(s.store);

    expect(await s.auth.signOutReporting(), SignOutOutcome.unreached);
  });

  test('no network is not a verdict: unreached, and signOut still completes', () async {
    final gone = await TestServer.start();
    final baseUrl = gone.baseUrl;
    await gone.stop();
    final s = stack(baseUrl);
    await seed(s.store);

    expect(await s.auth.signOutReporting(), SignOutOutcome.unreached);
    await expectLater(s.auth.signOut(), completes);
  });

  test('logoutWith presents the given token over the public transport, with no refresh', () async {
    server.on('POST', '/auth/logout', [
      const Reply(401, {
        'error': {'code': 'AUTH.UNAUTHENTICATED', 'message': 'refused'},
      }),
    ]);
    final s = stack(server.baseUrl);

    await expectLater(
      s.auth.logoutWith('access-pending'),
      throwsA(isA<AppError>()),
    );

    expect(server.countOf('POST', '/auth/refresh'), 0);
    expect(server.requests.single.headers['authorization'], 'Bearer access-pending');
  });
}
