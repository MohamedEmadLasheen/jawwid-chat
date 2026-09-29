import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/bootstrap.dart';
import 'package:jawwid_chat/core/data/http/http_auth_repository.dart';
import 'package:jawwid_chat/core/data/wire/wire_vocab.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/device_descriptor.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/features/auth/application/auth_controller.dart';
import 'package:jawwid_chat/features/auth/application/session_termination.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import '../../core/data/http/test_server.dart';

class _NoDevice implements DeviceDescriptor {
  @override
  Future<DeviceDescription?> describe() async => null;
}

/// A terminal refusal seen by the TRANSPORT must end the application session.
///
/// Before this, `StoredTokenProvider.onEnded` cleared only the actor id. A revoked user whose
/// conversation list refresh was refused kept `AuthState.Authenticated`, kept their tokens,
/// and kept looking at a protected screen until they restarted the app — while the server had
/// already ended the session. §7 asks for the opposite: detect the failure, clear sensitive
/// local state, return to login, and do not continue showing protected data.
///
/// Everything here drives a real protected REQUEST, not `AuthController` methods directly.
/// Calling the controller would prove the controller works, which was never in doubt; what
/// was missing was the wire between the two.
void main() {
  late TestServer server;

  setUp(() async => server = await TestServer.start());
  tearDown(() async => server.stop());

  /// The composition root, assembled exactly as `bootstrap.dart` assembles it.
  ({
    ApiClient client,
    TokenStore store,
    SessionContext session,
    ProviderContainer container,
    NotifierProvider<AuthController, AuthState> provider,
    int Function() localClears,
  }) app() {
    final store = InMemoryTokenStore();
    final session = SessionContext();
    final termination = SessionTermination();
    var localClears = 0;
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
        onEnded: (error) async {
          await session.end(error);
          await termination.end(error);
        },
      ),
    );

    final provider = NotifierProvider<AuthController, AuthState>(
      () => AuthController(
        repository: auth,
        tokens: store,
        clearLocalData: () async => localClears++,
        onPrincipal: (p) => session.adopt(role: p.role, actorId: p.id),
        onSessionCleared: session.clear,
        termination: termination,
      ),
    );

    final container = ProviderContainer();
    addTearDown(container.dispose);

    return (
      client: client,
      store: store,
      session: session,
      container: container,
      provider: provider,
      localClears: () => localClears,
    );
  }

  Map<String, Object?> actor() => {
        'actorId': 'actor-1',
        'kind': Wire.actorContact,
        'displayName': 'Mona',
        'locale': 'ar',
        'isActive': true,
        'permissions': <String>[],
      };

  Map<String, Object?> pair(String access, String refresh) => {
        'tokenType': 'Bearer',
        'accessToken': access,
        'expiresIn': 900,
        'refreshToken': refresh,
        'session': {'id': 's1', 'createdAt': '2026-09-29T09:00:00.000Z'},
        'actor': actor(),
      };

  Reply authError(int status, String code) => Reply(status, {
        'error': {'code': code, 'message': 'refused'},
      });

  /// Sign in for real, so the assertions below run against a genuinely authenticated app.
  Future<void> signIn(
    ({
      ApiClient client,
      TokenStore store,
      SessionContext session,
      ProviderContainer container,
      NotifierProvider<AuthController, AuthState> provider,
      int Function() localClears,
    }) a,
  ) async {
    server.on('POST', '/auth/login', [Reply.ok(pair('access-1', 'refresh-1'))]);
    server.on('GET', '/me', [Reply.ok(actor())]);

    await a.container.read(a.provider.notifier).signIn(username: 'mona', password: 'pw');

    expect(a.container.read(a.provider), isA<AuthAuthenticated>());
    expect(a.session.actorId(), 'actor-1');
  }

  group('a terminal refusal on a background request ends the session', () {
    for (final (code, status, reason) in [
      (AuthErrors.sessionRevoked, 401, SignedOutReason.sessionRevoked),
      (AuthErrors.accountDisabled, 403, SignedOutReason.accountDisabled),
      (AuthErrors.accountLocked, 403, SignedOutReason.accountLocked),
    ]) {
      test('$code signs the user out with the right reason', () async {
        final a = app();
        await signIn(a);

        server.on('GET', '/conversations', [authError(status, code)]);

        await expectLater(
          a.client.get<Map<String, Object?>>('/conversations'),
          throwsA(isA<AppError>()),
        );

        final state = a.container.read(a.provider);
        expect(state, isA<AuthSignedOut>());
        expect((state as AuthSignedOut).reason, reason);

        expect(await a.store.read(), isNull, reason: 'tokens must not survive');
        expect(a.session.actorId(), isEmpty);
        expect(a.session.role(), UserRole.parent);
        expect(a.localClears(), 1, reason: 'cached protected data is dropped too');
      });
    }

    test('an unauthenticated refusal whose refresh fails signs the user out', () async {
      final a = app();
      await signIn(a);

      server.on('GET', '/conversations', [authError(401, AuthErrors.unauthenticated)]);
      server.on('POST', '/auth/refresh', [authError(401, AuthErrors.sessionRevoked)]);

      await expectLater(
        a.client.get<Map<String, Object?>>('/conversations'),
        throwsA(isA<AppError>()),
      );

      expect(a.container.read(a.provider), isA<AuthSignedOut>());
      expect(await a.store.read(), isNull);
      expect(a.session.actorId(), isEmpty);
    });

    test('a forbidden refusal does NOT sign the user out', () async {
      // A policy refusal is not an authentication failure. Signing someone out because a
      // teacher may not open a 1:1 would be a security control behaving as a bug.
      final a = app();
      await signIn(a);

      server.on('GET', '/conversations', [authError(403, AuthErrors.forbidden)]);

      await expectLater(
        a.client.get<Map<String, Object?>>('/conversations'),
        throwsA(isA<AppError>().having((e) => e.kind, 'kind', AppErrorKind.forbidden)),
      );

      expect(a.container.read(a.provider), isA<AuthAuthenticated>());
      expect(await a.store.read(), isNotNull);
      expect(a.session.actorId(), 'actor-1');
    });
  });

  group('duplicate terminal signals', () {
    test('ten concurrent revocations produce ONE clean signed-out state', () async {
      final a = app();
      await signIn(a);

      server.on('GET', '/conversations', [
        authError(401, AuthErrors.sessionRevoked),
      ]);

      final outcomes = await Future.wait([
        for (var i = 0; i < 10; i++)
          a.client
              .get<Map<String, Object?>>('/conversations')
              .then<Object?>((r) => r, onError: (Object e) => e),
      ]);

      expect(outcomes.whereType<AppError>(), hasLength(10));

      final state = a.container.read(a.provider);
      expect(state, isA<AuthSignedOut>());
      expect((state as AuthSignedOut).reason, SignedOutReason.sessionRevoked);
      expect(
        a.localClears(),
        1,
        reason: 'the destructive path runs once, not once per refused request',
      );
      expect(await a.store.read(), isNull);
    });

    test('a later terminal signal does not overwrite the first reason', () async {
      final a = app();
      await signIn(a);

      server.on('GET', '/conversations', [authError(403, AuthErrors.accountDisabled)]);
      await expectLater(
        a.client.get<Map<String, Object?>>('/conversations'),
        throwsA(isA<AppError>()),
      );

      server.on('GET', '/messages', [authError(401, AuthErrors.sessionRevoked)]);
      await expectLater(
        a.client.get<Map<String, Object?>>('/messages'),
        throwsA(isA<AppError>()),
      );

      final state = a.container.read(a.provider) as AuthSignedOut;
      expect(
        state.reason,
        SignedOutReason.accountDisabled,
        reason: 'the refusal that actually ended the session is the one to report',
      );
      expect(a.localClears(), 1);
    });
  });

  group('a failed sign-in leaves nothing behind', () {
    test('it clears a principal the controller had already adopted', () async {
      // Unreachable through the router today, which is exactly why it is worth pinning: a
      // controller whose safety depends on which screen calls it is not reusable.
      final a = app();
      await signIn(a);
      expect(a.session.actorId(), 'actor-1');

      server.on('POST', '/auth/login', [authError(401, AuthErrors.invalidCredentials)]);

      await a.container
          .read(a.provider.notifier)
          .signIn(username: 'mona', password: 'wrong');

      final state = a.container.read(a.provider) as AuthSignedOut;
      expect(state.error, isNotNull);
      expect(state.error!.kind, AppErrorKind.invalidCredentials);
      expect(a.session.actorId(), isEmpty, reason: 'no stale principal');
      expect(a.session.role(), UserRole.parent);
      expect(await a.store.read(), isNull, reason: 'a failed login stores no credential');
    });

    test('invalid credentials from a clean start store nothing and end no session', () async {
      final a = app();
      server.on('POST', '/auth/login', [authError(401, AuthErrors.invalidCredentials)]);

      await a.container.read(a.provider.notifier).signIn(username: 'm', password: 'bad');

      expect(await a.store.read(), isNull);
      expect(server.countOf('POST', '/auth/refresh'), 0, reason: 'no refresh for a typo');
      expect(a.container.read(a.provider), isA<AuthSignedOut>());
    });

    test('a locked account keeps its own reason through the failure path', () async {
      final a = app();
      server.on('POST', '/auth/login', [authError(403, AuthErrors.accountLocked)]);

      await a.container.read(a.provider.notifier).signIn(username: 'm', password: 'pw');

      final state = a.container.read(a.provider) as AuthSignedOut;
      expect(state.reason, SignedOutReason.accountLocked);
      expect(state.error!.kind, AppErrorKind.accountLocked);
    });
  });
}
