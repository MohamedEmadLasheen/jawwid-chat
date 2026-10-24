import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_auth_repository.dart';
import 'package:jawwid_chat/core/data/wire/wire_vocab.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/device_descriptor.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';
import 'package:jawwid_chat/core/storage/browser_token_store.dart';

import '../../storage/browser_token_store_test.dart' show FakeKeyValue, FakeLocks;
import 'test_server.dart';

class _WebDevice implements DeviceDescriptor {
  @override
  Future<DeviceDescription?> describe() async =>
      const DeviceDescription(platform: 'web', name: 'Chrome on macOS', appVersion: '0.1.0');
}

/// PD-28: the web portal's session over the real HTTP transport, wired as `bootstrap.dart`
/// wires it in a browser -- a [BrowserTokenStore] and its refresh lock under the one
/// [StoredTokenProvider].
void main() {
  late TestServer server;
  late FakeKeyValue tab;
  late FakeKeyValue device;
  late FakeLocks locks;

  setUp(() async {
    server = await TestServer.start();
    tab = FakeKeyValue();
    device = FakeKeyValue();
    locks = FakeLocks();
  });
  tearDown(() async => server.stop());

  /// One browser tab. A second call is a reload (or a second tab): new memory, same storage.
  ({HttpAuthRepository auth, BrowserTokenStore store, ApiClient client, List<AppError> ended}) tabStack() {
    final store = BrowserTokenStore(BrowserBindings(tab: tab, device: device, lock: locks.call));
    final ended = <AppError>[];
    late final ApiClient client;
    final auth = HttpAuthRepository(
      transport: buildAuthTransport(config: ApiConfig(baseUrl: server.baseUrl)),
      protected: () => client,
      device: _WebDevice(),
      currentAccessToken: () async => (await store.read())?.accessToken,
    );
    client = buildApiClient(
      config: ApiConfig(baseUrl: server.baseUrl),
      tokens: StoredTokenProvider(
        store: store,
        auth: auth,
        onEnded: (error) async => ended.add(error),
        exclusive: store.exclusive,
      ),
    );
    return (auth: auth, store: store, client: client, ended: ended);
  }

  Map<String, Object?> tokenPair(String access, String refresh, {bool remembered = false}) => {
        'tokenType': 'Bearer',
        'accessToken': access,
        'expiresIn': 900,
        'refreshToken': refresh,
        'session': {
          'id': 'session-1',
          'createdAt': '2026-10-24T09:00:00.000Z',
          'remembered': remembered,
          'expiresAt': '2026-10-24T21:00:00.000Z',
          'absoluteExpiresAt': '2026-10-31T09:00:00.000Z',
        },
        'actor': {'actorId': 'teacher-1', 'kind': Wire.actorTeacher, 'displayName': 'Omar'},
      };

  test('"keep me signed in" is sent only when ticked, with the web device block', () async {
    server.on('POST', '/auth/login', [
      Reply.ok(tokenPair('a1', 'r1')),
      Reply.ok(tokenPair('a2', 'r2', remembered: true)),
    ]);
    final s = tabStack();

    await s.auth.signIn(username: 'omar', password: 'pw');
    await s.auth.signIn(username: 'omar', password: 'pw', remember: true);

    final [first, second] = server.requests;
    expect(first.json.containsKey('remember'), isFalse);
    expect(second.json['remember'], isTrue);
    expect(second.json['device'], {'platform': 'web', 'name': 'Chrome on macOS', 'appVersion': '0.1.0'});
  });

  test("the server's session.remembered decides the storage, not the checkbox", () async {
    // Asked for, refused (as the super admin always is): the token stays in this tab.
    server.on('POST', '/auth/login', [Reply.ok(tokenPair('a1', 'r1', remembered: false))]);
    final s = tabStack();

    final session = await s.auth.signIn(username: 'owner', password: 'pw', remember: true);
    expect(session.remembered, isFalse);
    await s.store.write(session);

    expect(tab.values[BrowserTokenStore.tabRefreshKey], 'r1');
    expect(device.values, isEmpty);
  });

  test('a refresh does not restate where the session is kept', () async {
    server.on('POST', '/auth/refresh', [Reply.ok(tokenPair('a2', 'r2', remembered: true))]);

    final renewed = await tabStack().auth.refresh('r1');
    expect(renewed.remembered, isNull);
  });

  test('after a reload: no header, a 401, one refresh under the lock, then the request', () async {
    server.on('POST', '/auth/login', [Reply.ok(tokenPair('a1', 'r1', remembered: true))]);
    server.on('POST', '/auth/refresh', [Reply.ok(tokenPair('a2', 'r2', remembered: true))]);
    server.onRequest('GET', '/me', (request) {
      if (request.headers['authorization'] != 'Bearer a2') {
        return Reply.commError(401, AuthErrors.unauthenticated);
      }
      return const Reply.ok({'actorId': 'teacher-1', 'kind': Wire.actorTeacher, 'displayName': 'Omar'});
    });

    final first = tabStack();
    await first.store.write(await first.auth.signIn(username: 'omar', password: 'pw', remember: true));

    final reloaded = tabStack();
    final user = await reloaded.auth.currentUser();

    expect(user.id, 'teacher-1');
    final mes = server.requests.where((r) => r.path == '/me').toList();
    expect(mes.first.headers.containsKey('authorization'), isFalse);
    expect(mes.last.headers['authorization'], 'Bearer a2');
    expect(server.lastRequestTo('POST', '/auth/refresh')!.json['refreshToken'], 'r1');
    expect(locks.held, [BrowserTokenStore.refreshLock]);
    expect(device.values[BrowserTokenStore.deviceRefreshKey], 'r2');
    expect(reloaded.ended, isEmpty);
  });
}
