import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_auth_repository.dart';
import 'package:jawwid_chat/core/data/wire/wire_vocab.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/device_descriptor.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/features/auth/application/auth_controller.dart';
import 'package:jawwid_chat/features/auth/application/pending_sign_out.dart';
import 'package:jawwid_chat/features/auth/application/session_termination.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
import 'package:jawwid_chat/shared/models/auth.dart';

import 'test_server.dart';

class _NoDevice implements DeviceDescriptor {
  @override
  Future<DeviceDescription?> describe() async => null;
}

/// A keychain that, once [refuseWrites] is set, refuses to save a token pair -- and, with
/// [refuseClear], to delete one.
class _RefusingStore extends InMemoryTokenStore {
  bool refuseWrites = false;
  bool refuseClear = false;

  @override
  Future<void> write(AuthSession session) async {
    if (refuseWrites) throw StateError('keychain refused the write');
    return super.write(session);
  }

  @override
  Future<void> clear() async {
    if (refuseClear) throw StateError('keychain refused the delete');
    return super.clear();
  }
}

class _NoTimer implements Timer {
  @override
  void cancel() {}

  @override
  bool get isActive => false;

  @override
  int get tick => 0;
}

/// W49b: the refresh reached the server -- which rotated, retiring `refresh-1` -- and then the
/// keychain refused to save the new pair.
///
/// The store still holds the retired token. Presenting it again is read by the API as theft
/// (`handleRefreshReuse`) and revokes every session on the account, on every device. So the
/// session must end locally, and nothing -- a later request, a pending sign-out, its retrier
/// -- may present `refresh-1` a second time.
void main() {
  late TestServer server;

  setUp(() async => server = await TestServer.start());
  tearDown(() async => server.stop());

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

  Reply unauthenticated() => const Reply(401, {
        'error': {'code': AuthErrors.unauthenticated, 'message': 'refused'},
      });

  /// Accepts only the rotated access token on [path].
  void acceptOnlyFresh(String method, String path) => server.onRequest(
        method,
        path,
        (request) => request.headers['authorization'] == 'Bearer fresh-access'
            ? const Reply.ok({'ok': true})
            : unauthenticated(),
      );

  List<Object?> presented() => server.requests
      .where((r) => r.method == 'POST' && r.path == '/auth/refresh')
      .map((r) => r.json['refreshToken'])
      .toList();

  Future<_RefusingStore> seeded() async {
    final store = _RefusingStore();
    await store.write(AuthSession(
      accessToken: 'stale-access',
      refreshToken: 'refresh-1',
      // Already past: the next request needs a refresh.
      accessTokenExpiresAt: DateTime.utc(2020),
    ));
    store.refuseWrites = true;
    return store;
  }

  ({ApiClient client, HttpAuthRepository auth}) stack(
    TokenStore store,
    Future<void> Function(AppError) onEnded,
  ) {
    late final ApiClient client;
    final auth = HttpAuthRepository(
      transport: buildAuthTransport(config: ApiConfig(baseUrl: server.baseUrl)),
      protected: () => client,
      device: _NoDevice(),
      currentAccessToken: () async => (await store.read())?.accessToken,
    );
    client = buildApiClient(
      config: ApiConfig(baseUrl: server.baseUrl),
      tokens: StoredTokenProvider(store: store, auth: auth, onEnded: onEnded),
    );
    return (client: client, auth: auth);
  }

  Future<Object?> failureOf(Future<Object?> request) => request
      .then<Object?>((_) => null, onError: (Object e) => e)
      .timeout(const Duration(seconds: 10));

  group('the provider', () {
    test('ends the session and clears the store; the retired token is never presented again', () async {
      acceptOnlyFresh('GET', '/probe');
      server.on('POST', '/auth/refresh', [Reply.ok(pair('fresh-access', 'refresh-2'))]);
      final store = await seeded();
      final ended = <AppError>[];
      final s = stack(store, (e) async => ended.add(e));

      final first = await failureOf(s.client.get<Object?>('/probe'));

      expect(first, isA<AppError>(), reason: 'an AppError, not an escaped keychain error');
      expect((first! as AppError).isTransient, isFalse,
          reason: 'never "no network": a sign-out would keep the retired token to retry');
      expect(ended, isNotEmpty, reason: 'the session is over locally');
      expect(await store.read(), isNull, reason: 'the retired token is not left to be read back');

      await failureOf(s.client.get<Object?>('/probe'));
      expect(presented(), ['refresh-1']);
    });

    test('a keychain that also refuses the delete: still never presented again', () async {
      acceptOnlyFresh('GET', '/probe');
      server.on('POST', '/auth/refresh', [Reply.ok(pair('fresh-access', 'refresh-2'))]);
      final store = await seeded();
      store.refuseClear = true;
      final ended = <AppError>[];
      final s = stack(store, (e) async => ended.add(e));

      await failureOf(s.client.get<Object?>('/probe'));
      await failureOf(s.client.get<Object?>('/probe'));
      await failureOf(s.client.get<Object?>('/probe'));

      expect(ended, isNotEmpty);
      expect(presented(), ['refresh-1'],
          reason: 'the store still holds it, and this provider remembers it is retired');
    });
  });

  group('a sign-out whose refresh rotated but could not be saved', () {
    late ProviderContainer container;

    setUp(() => container = ProviderContainer());
    tearDown(() => container.dispose());

    Future<
        ({
          AuthController controller,
          NotifierProvider<AuthController, AuthState> provider,
          InMemoryPendingSignOutStore pending,
          PendingSignOutRetrier retrier,
        })> wire(_RefusingStore store) async {
      final termination = SessionTermination();
      final s = stack(store, termination.end);
      final pending = InMemoryPendingSignOutStore();
      final retrier = PendingSignOutRetrier(
        store: pending,
        server: s.auth,
        liveTokens: store,
        timer: (_, _) => _NoTimer(),
      );
      final provider = NotifierProvider<AuthController, AuthState>(
        () => AuthController(
          repository: s.auth,
          tokens: store,
          clearLocalData: () async {},
          termination: termination,
          pendingSignOut: retrier,
        ),
      );
      final controller = container.read(provider.notifier);
      return (controller: controller, provider: provider, pending: pending, retrier: retrier);
    }

    test('signs out locally, records nothing retired, and no retry presents it', () async {
      acceptOnlyFresh('POST', '/auth/logout');
      server.on('POST', '/auth/refresh', [Reply.ok(pair('fresh-access', 'refresh-2'))]);
      final store = await seeded();
      final w = await wire(store);

      await w.controller.signOut().timeout(const Duration(seconds: 10));

      expect(container.read(w.provider), isA<AuthSignedOut>());
      expect(await store.read(), isNull);
      expect(
        [for (final e in await w.pending.read()) e.session.refreshToken],
        isNot(contains('refresh-1')),
        reason: 'a pending sign-out holding the retired token would refresh it later',
      );

      await w.retrier.flush(force: true);
      await w.retrier.flush(force: true);

      expect(presented(), ['refresh-1']);
    });

    test('with a keychain that also refuses the delete', () async {
      acceptOnlyFresh('POST', '/auth/logout');
      server.on('POST', '/auth/refresh', [Reply.ok(pair('fresh-access', 'refresh-2'))]);
      final store = await seeded();
      store.refuseClear = true;
      final w = await wire(store);

      await w.controller.signOut().timeout(const Duration(seconds: 10));

      expect(container.read(w.provider), isA<AuthSignedOut>());
      expect(
        [for (final e in await w.pending.read()) e.session.refreshToken],
        isNot(contains('refresh-1')),
      );

      await w.retrier.flush(force: true);

      expect(presented(), ['refresh-1']);
    });
  });
}
