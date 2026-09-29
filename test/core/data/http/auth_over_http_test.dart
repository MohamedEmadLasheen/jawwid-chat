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
import 'package:jawwid_chat/shared/models/user_role.dart';

import 'test_server.dart';

/// A device that knows what it is. The real one reaches two platform channels.
class _FakeDevice implements DeviceDescriptor {
  _FakeDevice([this.description]);

  final DeviceDescription? description;

  @override
  Future<DeviceDescription?> describe() async => description;
}

/// Authentication over the real HTTP transport.
///
/// This is where the client's half of `apps/api/src/platform/auth/auth.controller.ts` is
/// proved: the paths, the request bodies, the `TokenPairDto` envelope, the `AUTH.*` refusal
/// codes, and — the part that matters most — which of those refusals may provoke a refresh.
///
/// The server here is scripted, not real. What is under test is the client.
void main() {
  late TestServer server;

  setUp(() async => server = await TestServer.start());
  tearDown(() async => server.stop());

  /// The full authenticated stack, wired exactly as `bootstrap.dart` wires it: one token
  /// store, one token provider, one ApiClient, and a repository whose public routes bypass
  /// the refresh interceptor.
  ({HttpAuthRepository auth, TokenStore store, ApiClient client, List<AppError> ended})
      stack({DeviceDescription? device}) {
    final store = InMemoryTokenStore();
    final ended = <AppError>[];
    late final ApiClient client;

    final auth = HttpAuthRepository(
      transport: buildAuthTransport(config: ApiConfig(baseUrl: server.baseUrl)),
      protected: () => client,
      device: _FakeDevice(device),
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

  Map<String, Object?> actorDto({String kind = Wire.actorContact}) => {
        'actorId': 'actor-1',
        'kind': kind,
        'displayName': 'Mona Salah',
        'locale': 'ar',
        'isActive': true,
        'staffRole': null,
        'familyId': 'family-1',
        'canMessage': true,
        'organizationId': 'org-1',
        'permissions': <String>[],
      };

  Map<String, Object?> tokenPair({
    String access = 'access-1',
    String refresh = 'refresh-1',
    int expiresIn = 900,
    String kind = Wire.actorContact,
  }) =>
      {
        'tokenType': 'Bearer',
        'accessToken': access,
        'expiresIn': expiresIn,
        'refreshToken': refresh,
        'session': {'id': 'session-1', 'createdAt': '2026-09-29T09:00:00.000Z'},
        'actor': actorDto(kind: kind),
      };

  Reply authError(int status, String code, {Map<String, String> headers = const {}}) =>
      Reply(status, {
        'error': {'code': code, 'message': 'refused'},
      }, headers: headers);

  group('POST /auth/login', () {
    test('sends the published body to the published path', () async {
      server.on('POST', '/auth/login', [Reply.ok(tokenPair())]);

      await stack(
        device: const DeviceDescription(
          platform: 'ios',
          name: 'iPhone 17 Pro',
          appVersion: '1.4.0',
        ),
      ).auth.signIn(username: 'mona', password: 'correct-horse');

      final request = server.requests.single;
      expect(request.method, 'POST');
      expect(request.path, '/auth/login');
      expect(request.json['username'], 'mona');
      expect(request.json['password'], 'correct-horse');
      expect(request.json['device'], {
        'platform': 'ios',
        'name': 'iPhone 17 Pro',
        'appVersion': '1.4.0',
      });
    });

    test('omits the device block rather than inventing one', () async {
      // `AuthService.upsertDevice` silently drops a platform outside {ios, android, web},
      // which would cost the user the device row they later read their sessions from. A
      // build that cannot describe itself says nothing instead.
      server.on('POST', '/auth/login', [Reply.ok(tokenPair())]);

      await stack().auth.signIn(username: 'mona', password: 'pw');

      expect(server.requests.single.json.containsKey('device'), isFalse);
    });

    test('expiresIn is a duration in seconds, not an instant', () async {
      server.on('POST', '/auth/login', [Reply.ok(tokenPair(expiresIn: 900))]);

      final before = DateTime.now();
      final session = await stack().auth.signIn(username: 'mona', password: 'pw');
      final after = DateTime.now();

      expect(session.accessToken, 'access-1');
      expect(session.refreshToken, 'refresh-1');
      // Read as an epoch this would land in 1970 and refresh on every request; read as
      // milliseconds it would land fifteen minutes in the past.
      expect(session.accessTokenExpiresAt.isAfter(before.add(const Duration(seconds: 890))), isTrue);
      expect(session.accessTokenExpiresAt.isBefore(after.add(const Duration(seconds: 910))), isTrue);
    });

    test('a response with no usable token pair is an error, not a blank session', () async {
      server.on('POST', '/auth/login', [const Reply.ok({'tokenType': 'Bearer'})]);

      await expectLater(
        stack().auth.signIn(username: 'mona', password: 'pw'),
        throwsA(isA<AppError>().having((e) => e.kind, 'kind', AppErrorKind.server)),
      );
    });

    test('bad credentials are invalidCredentials, and provoke NO refresh', () async {
      // The regression this exists for: classified as `unauthenticated`, a mistyped password
      // made the transport spend a refresh and emit a session-ended event for a session that
      // never existed.
      server.on('POST', '/auth/login', [authError(401, AuthErrors.invalidCredentials)]);
      server.on('POST', '/auth/refresh', [Reply.ok(tokenPair())]);

      final s = stack();
      await expectLater(
        s.auth.signIn(username: 'mona', password: 'wrong'),
        throwsA(
          isA<AppError>()
              .having((e) => e.kind, 'kind', AppErrorKind.invalidCredentials)
              .having((e) => e.terminatesSession, 'terminatesSession', isFalse),
        ),
      );

      expect(server.countOf('POST', '/auth/refresh'), 0);
      expect(s.ended, isEmpty, reason: 'a failed login ends no session');
    });

    test('a disabled account is terminal and distinct', () async {
      server.on('POST', '/auth/login', [authError(403, AuthErrors.accountDisabled)]);

      await expectLater(
        stack().auth.signIn(username: 'mona', password: 'pw'),
        throwsA(
          isA<AppError>()
              .having((e) => e.kind, 'kind', AppErrorKind.accountDisabled)
              .having((e) => e.terminatesSession, 'terminatesSession', isTrue),
        ),
      );
    });

    test('a locked account is terminal, and not the same as disabled', () async {
      server.on('POST', '/auth/login', [authError(403, AuthErrors.accountLocked)]);

      await expectLater(
        stack().auth.signIn(username: 'mona', password: 'pw'),
        throwsA(isA<AppError>().having((e) => e.kind, 'kind', AppErrorKind.accountLocked)),
      );
    });

    test('rate limiting keeps the Retry-After the server sent', () async {
      // The backend puts the wait in the header and NOT the body on purpose: a per-account
      // countdown in a response body leaks which accounts are under attack.
      server.on('POST', '/auth/login', [
        authError(429, AuthErrors.rateLimited, headers: {'Retry-After': '120'}),
      ]);

      try {
        await stack().auth.signIn(username: 'mona', password: 'pw');
        fail('expected a rate-limit refusal');
      } on AppError catch (error) {
        expect(error.kind, AppErrorKind.rateLimited);
        expect(error.retryAfter, const Duration(seconds: 120));
      }
    });
  });

  group('GET /me and the role decision', () {
    Future<UserRole> roleFromServer(String kind) async {
      server.on('GET', '/me', [Reply.ok(actorDto(kind: kind))]);
      final user = await stack().auth.currentUser();
      return user.role;
    }

    test('a contact is a parent', () async {
      expect(await roleFromServer(Wire.actorContact), UserRole.parent);
    });

    test('a teacher is a teacher', () async {
      expect(await roleFromServer(Wire.actorTeacher), UserRole.teacher);
    });

    test('the principal is read from the server, field by field', () async {
      server.on('GET', '/me', [Reply.ok(actorDto())]);

      final user = await stack().auth.currentUser();

      expect(user.id, 'actor-1');
      expect(user.displayName, 'Mona Salah');
      expect(user.locale, 'ar');
      expect(server.requests.single.path, '/me');
    });

    for (final kind in [Wire.actorStaff, Wire.actorSystem, 'auditor', '']) {
      test('"$kind" cannot hold a session on a phone', () async {
        // Fails CLOSED. Defaulting an unclassified principal to parent would hand them a
        // screen and a set of approval policies nobody decided they should have.
        server.on('GET', '/me', [Reply.ok(actorDto(kind: kind))]);

        await expectLater(
          stack().auth.currentUser(),
          throwsA(
            isA<AppError>()
                .having((e) => e.code, 'code', AuthFailures.roleNotSupported)
                .having((e) => e.kind, 'kind', AppErrorKind.forbidden),
          ),
        );
      });
    }

    test('the refusal never echoes the server body', () async {
      expect(
        () => HttpAuthRepository.roleFor(Wire.actorStaff),
        throwsA(isA<AppError>()),
      );
      try {
        HttpAuthRepository.roleFor(Wire.actorStaff);
      } on AppError catch (error) {
        expect(error.toString(), isNot(contains('displayName')));
      }
    });
  });

  group('POST /auth/refresh', () {
    test('posts the refresh token to the public path', () async {
      server.on('POST', '/auth/refresh', [Reply.ok(tokenPair(access: 'a2', refresh: 'r2'))]);

      final session = await stack().auth.refresh('r1');

      expect(server.requests.single.path, '/auth/refresh');
      expect(server.requests.single.json['refreshToken'], 'r1');
      expect(session.accessToken, 'a2');
      expect(session.refreshToken, 'r2', reason: 'the pair rotates');
    });

    test('carries no Authorization header: the route is public', () async {
      server.on('POST', '/auth/refresh', [Reply.ok(tokenPair())]);

      await stack().auth.refresh('r1');

      expect(server.requests.single.headers.containsKey('authorization'), isFalse);
    });

    test('a 401 on refresh itself cannot recurse into the refresh machinery', () async {
      // The shape this forecloses:
      //   refresh() -> ApiClient -> 401 -> _refreshOnce() -> the future already awaiting it.
      // The public transport has no refresh interceptor, so there is nothing to re-enter.
      server.on('POST', '/auth/refresh', [authError(401, AuthErrors.sessionRevoked)]);

      await expectLater(
        stack().auth.refresh('stolen').timeout(const Duration(seconds: 5)),
        throwsA(
          isA<AppError>().having((e) => e.kind, 'kind', AppErrorKind.sessionRevoked),
        ),
      );

      expect(
        server.countOf('POST', '/auth/refresh'),
        1,
        reason: 'exactly one presentation; a replay would read as refresh-token theft',
      );
    });
  });

  group('POST /auth/logout', () {
    test('is sent while the credentials still exist', () async {
      server.on('POST', '/auth/logout', [const Reply.ok({'ok': true})]);

      final s = stack();
      await s.store.write(AuthSession(
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        accessTokenExpiresAt: DateTime.now().add(const Duration(minutes: 15)),
      ));

      await s.auth.signOut();

      final request = server.requests.single;
      expect(request.path, '/auth/logout');
      expect(request.headers['authorization'], 'Bearer access-1');
    });

    test('a server failure does not throw: the user still gets to leave', () async {
      server.on('POST', '/auth/logout', [const Reply(500, {'error': {'code': 'boom'}})]);

      await expectLater(stack().auth.signOut(), completes);
    });
  });

  group('capabilities the contract does not publish', () {
    test('the session registry fails explicitly rather than inventing a list', () async {
      final s = stack();

      await expectLater(
        s.auth.devices(),
        throwsA(
          isA<AppError>().having((e) => e.code, 'code', AuthFailures.sessionsNotSupported),
        ),
      );
      await expectLater(
        s.auth.revokeDevice('device-1'),
        throwsA(
          isA<AppError>().having((e) => e.code, 'code', AuthFailures.sessionsNotSupported),
        ),
      );
      expect(server.requests, isEmpty, reason: 'no endpoint was guessed at');
    });

    test('sessionRevoked is empty, not a fabricated channel', () async {
      expect(await stack().auth.sessionRevoked.toList(), isEmpty);
    });
  });
}
