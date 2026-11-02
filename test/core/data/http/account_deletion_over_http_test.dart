import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_account_deletion_repository.dart';
import 'package:jawwid_chat/core/data/http/http_auth_repository.dart';
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

/// PD-56: deleting your own account sends the password on the session's client. A wrong
/// password is a 401 with AUTH.INVALID_CREDENTIALS -- a refusal of THIS request, never an
/// expired session: it must not spend a refresh or end the session.
void main() {
  late TestServer server;

  setUp(() async => server = await TestServer.start());
  tearDown(() async => server.stop());

  ({HttpAccountDeletionRepository repo, TokenStore store}) stack() {
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
    return (repo: HttpAccountDeletionRepository(client: client), store: store);
  }

  Future<void> seed(TokenStore store) => store.write(
        AuthSession(
          accessToken: 'access-1',
          refreshToken: 'refresh-1',
          accessTokenExpiresAt: DateTime.now().add(const Duration(minutes: 5)),
        ),
      );

  test('POST /me/account/delete with the password, on the bearer token', () async {
    server.on('POST', '/me/account/delete', [const Reply.ok({'deleted': true})]);
    final s = stack();
    await seed(s.store);
    await s.repo.deleteAccount(password: 'my-password');
    expect(server.requests.single.json, {'password': 'my-password'});
    expect(server.requests.single.headers['authorization'], 'Bearer access-1');
  });

  test('a wrong password is the request\'s refusal: no refresh, the session in hand stays', () async {
    server.on('POST', '/me/account/delete', [Reply.commError(401, 'AUTH.INVALID_CREDENTIALS')]);
    final s = stack();
    await seed(s.store);
    await expectLater(
      s.repo.deleteAccount(password: 'wrong'),
      throwsA(isA<AppError>().having((e) => e.code, 'code', 'AUTH.INVALID_CREDENTIALS')),
    );
    expect(server.countOf('POST', '/auth/refresh'), 0);
    expect((await s.store.read())?.refreshToken, 'refresh-1');
  });

  test('a teacher still with lessons, students or payroll: the 409 keeps its code and the session', () async {
    server.on('POST', '/me/account/delete', [Reply.commError(409, 'AUTH.TEACHER_DELETION_BLOCKED')]);
    final s = stack();
    await seed(s.store);
    await expectLater(
      s.repo.deleteAccount(password: 'my-password'),
      throwsA(isA<AppError>().having((e) => e.code, 'code', 'AUTH.TEACHER_DELETION_BLOCKED')),
    );
    expect(server.countOf('POST', '/auth/refresh'), 0);
    expect((await s.store.read())?.refreshToken, 'refresh-1');
  });
}
