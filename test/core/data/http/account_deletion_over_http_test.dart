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

  test('a teacher still with lessons, students or payroll: a request, not a refusal (O-3); the session stays', () async {
    server.on('POST', '/me/account/delete', [
      const Reply.ok({
        'deleted': false,
        'request': {
          'id': 'r-1',
          'state': 'pending',
          'requestedAt': '2026-11-07T10:00:00.000Z',
          'deadlineAt': '2026-12-07T10:00:00.000Z',
          'openItems': ['future_lessons'],
          'completedAt': null,
          'completedVia': null,
          'cancelledAt': null,
        },
      }),
    ]);
    final s = stack();
    await seed(s.store);
    final outcome = await s.repo.deleteAccount(password: 'my-password');
    expect(outcome.deleted, isFalse);
    expect(outcome.request?.isPending, isTrue);
    expect(outcome.request?.deadlineAt, DateTime.utc(2026, 12, 7, 10));
    expect((await s.store.read())?.refreshToken, 'refresh-1');
  });

  test('GET /me/account/deletion and POST /me/account/deletion-request/cancel', () async {
    server.on('GET', '/me/account/deletion', [
      const Reply.ok({'kind': 'teacher', 'immediate': false, 'openItems': ['open_payroll'], 'request': null, 'deadlineIfRequested': '2026-12-07T10:00:00.000Z'}),
    ]);
    server.on('POST', '/me/account/deletion-request/cancel', [
      const Reply.ok({
        'request': {'id': 'r-1', 'state': 'cancelled', 'requestedAt': '2026-11-07T10:00:00.000Z', 'deadlineAt': '2026-12-07T10:00:00.000Z', 'cancelledAt': '2026-11-08T10:00:00.000Z'},
      }),
    ]);
    final s = stack();
    await seed(s.store);
    final status = await s.repo.status();
    expect(status.immediate, isFalse);
    expect(status.request, isNull);
    expect(status.deadlineIfRequested, DateTime.utc(2026, 12, 7, 10));
    final cancelled = await s.repo.cancelRequest();
    expect(cancelled.state, 'cancelled');
    expect(cancelled.isPending, isFalse);
  });

  test('cancelling with none pending keeps its code', () async {
    server.on('POST', '/me/account/deletion-request/cancel', [Reply.commError(409, 'AUTH.DELETION_REQUEST_NOT_PENDING')]);
    final s = stack();
    await seed(s.store);
    await expectLater(
      s.repo.cancelRequest(),
      throwsA(isA<AppError>().having((e) => e.code, 'code', 'AUTH.DELETION_REQUEST_NOT_PENDING')),
    );
  });
}
