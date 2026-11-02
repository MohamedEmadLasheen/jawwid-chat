import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_auth_repository.dart';
import 'package:jawwid_chat/core/data/http/http_password_change_repository.dart';
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

/// TEACHER-023: a password change ROTATES this device's session -- so a refresh token that
/// leaked from this device dies with the change -- and answers with the successor's pair.
/// The app must store it: the next request and the next refresh present the NEW pair,
/// because the old one is already revoked.
void main() {
  late TestServer server;

  setUp(() async => server = await TestServer.start());
  tearDown(() async => server.stop());

  ({HttpPasswordChangeRepository repo, TokenStore store, ApiClient client}) stack() {
    final store = InMemoryTokenStore();
    late final ApiClient client;
    final auth = HttpAuthRepository(
      transport: buildAuthTransport(config: ApiConfig(baseUrl: server.baseUrl)),
      protected: () => client,
      device: _NoDevice(),
      currentAccessToken: () async => (await store.read())?.accessToken,
    );
    client = buildApiClient(
      config: ApiConfig(baseUrl: server.baseUrl),
      tokens: StoredTokenProvider(store: store, auth: auth, onEnded: (_) async {}),
    );
    return (repo: HttpPasswordChangeRepository(client: client, tokens: store), store: store, client: client);
  }

  Future<void> seed(TokenStore store) => store.write(
        AuthSession(
          accessToken: 'access-1',
          refreshToken: 'refresh-1',
          accessTokenExpiresAt: DateTime.now().add(const Duration(minutes: 5)),
        ),
      );

  test('the rotated pair is stored, and the next request carries it', () async {
    server.on('POST', '/auth/password/change', [
      const Reply.ok({
        'tokenType': 'Bearer',
        'accessToken': 'access-2',
        'expiresIn': 900,
        'refreshToken': 'refresh-2',
        'session': {'id': 's2', 'createdAt': '2026-11-02T09:00:00.000Z'},
      }),
    ]);
    server.on('GET', '/me', [const Reply.ok({'ok': true})]);

    final s = stack();
    await seed(s.store);
    await s.repo.change(currentPassword: 'old-pass', newPassword: 'new-pass');

    final stored = await s.store.read();
    expect(stored?.accessToken, 'access-2');
    expect(stored?.refreshToken, 'refresh-2');
    expect(server.requests.single.headers['authorization'], 'Bearer access-1');

    await s.client.get<Object?>('/me');
    expect(server.requests.last.headers['authorization'], 'Bearer access-2');
    expect(server.countOf('POST', '/auth/refresh'), 0);
  });

  test('a refusal stores nothing: the session in hand is still the one in use', () async {
    server.on('POST', '/auth/password/change', [
      const Reply(400, {
        'error': {'code': 'AUTH.PASSWORD_UNCHANGED', 'message': 'refused'},
      }),
    ]);

    final s = stack();
    await seed(s.store);
    await expectLater(
      s.repo.change(currentPassword: 'same-pass', newPassword: 'same-pass'),
      throwsA(isA<AppError>().having((e) => e.code, 'code', 'AUTH.PASSWORD_UNCHANGED')),
    );
    expect((await s.store.read())?.refreshToken, 'refresh-1');
  });
}
