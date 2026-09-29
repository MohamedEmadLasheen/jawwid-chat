import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_auth_repository.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/actor_identity.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import 'test_server.dart';

/// A token provider that records what the client asked it to do.
///
/// It stands in for `StoredTokenProvider` so a test can see whether the
/// authenticated client tried to refresh, and whether it declared the session
/// over — the two behaviours the adapter must not disturb.
class _Tokens implements TokenProvider {
  _Tokens(this._current, {this.renewed});

  /// The token a request would carry NOW. It moves on a successful refresh,
  /// because `StoredTokenProvider` writes the renewed session to the store
  /// before returning -- so the request interceptor reads the new one on the
  /// replay. A fake that kept handing back the stale token would make a
  /// correct replay look wrong.
  String? _current;
  final String? renewed;

  int refreshes = 0;
  final ended = <AppError>[];

  @override
  Future<String?> accessToken() async => _current;

  @override
  Future<String?> refresh() async {
    refreshes++;
    if (renewed != null) _current = renewed;
    return renewed;
  }

  @override
  Future<void> onSessionEnded(AppError error) async => ended.add(error);
}

/// The real authentication adapter against a real socket (W8-W0).
///
/// Every assertion is about the wire and the mapping: which route was
/// addressed, what was in the body, what typed value came back, and — the part
/// that matters most — WHICH TRANSPORT each method used.
///
/// The last one is not stylistic. Login and refresh must not travel on the
/// authenticated client, because its 401 interceptor would turn a wrong
/// password into a token refresh and a failed refresh into a deadlock. Two
/// tests below prove that transport split by counting refreshes.
///
/// No widget binding, deliberately: `TestWidgetsFlutterBinding` installs an
/// `HttpOverrides` that answers every real request with a 400.
void main() {
  late TestServer server;

  setUp(() async => server = await TestServer.start());
  tearDown(() async => server.stop());

  /// The adapter, plus the token provider its authenticated half will use.
  (HttpAuthRepository, _Tokens) build({
    String? token = 'fake-access-token',
    String? renewed,
  }) {
    final tokens = _Tokens(token, renewed: renewed);
    final config = ApiConfig(baseUrl: server.baseUrl);
    final client = buildApiClient(
      config: config,
      tokens: tokens,
      identity: const BearerTokenIdentity(),
    );
    return (
      HttpAuthRepository(
        config: config,
        authenticatedClient: () => client,
      ),
      tokens,
    );
  }

  Map<String, Object?> actorDto({String kind = 'parent'}) => {
        'actorId': 'a_1',
        'kind': kind,
        'displayName': 'Sara',
        'locale': 'ar',
        'isActive': true,
        'staffRole': null,
        'familyId': 'f_1',
        'canMessage': true,
        'organizationId': null,
        'permissions': <String>[],
      };

  Map<String, Object?> tokenPair({int expiresIn = 900}) => {
        'tokenType': 'Bearer',
        'accessToken': 'access-1',
        'expiresIn': expiresIn,
        'refreshToken': 'refresh-1',
        'session': {'id': 's_1', 'createdAt': '2026-09-29T10:00:00.000Z'},
        'actor': actorDto(),
      };

  group('1/2. login maps TokenPairDto onto AuthSession', () {
    test('it posts the credentials to /auth/login', () async {
      server.on('POST', '/auth/login', [Reply.ok(tokenPair())]);
      final (auth, _) = build();

      await auth.signIn(username: 'sara', password: 'correct-horse');

      final request = server.lastRequestTo('POST', '/auth/login')!;
      expect(request.json['username'], 'sara');
      expect(request.json['password'], 'correct-horse');
    });

    test('the tokens come back verbatim', () async {
      server.on('POST', '/auth/login', [Reply.ok(tokenPair())]);
      final (auth, _) = build();

      final session = await auth.signIn(username: 'sara', password: 'p');

      expect(session.accessToken, 'access-1');
      expect(session.refreshToken, 'refresh-1');
    });

    test(
      'expiresIn is a DURATION and becomes an instant on this clock',
      () async {
        // The server says "900 seconds from now"; AuthSession holds a moment.
        // Reading it as an epoch — the obvious misreading — would put the
        // expiry in 1970 and every request would refresh.
        server.on('POST', '/auth/login', [Reply.ok(tokenPair(expiresIn: 900))]);
        final (auth, _) = build();

        final before = DateTime.now();
        final session = await auth.signIn(username: 'sara', password: 'p');
        final after = DateTime.now();

        expect(
          session.accessTokenExpiresAt.isAfter(
            before.add(const Duration(seconds: 899)),
          ),
          isTrue,
        );
        expect(
          session.accessTokenExpiresAt.isBefore(
            after.add(const Duration(seconds: 901)),
          ),
          isTrue,
        );
      },
    );

    test('a response with no numeric expiresIn is refused, not guessed',
        () async {
      final malformed = tokenPair()..remove('expiresIn');
      server.on('POST', '/auth/login', [Reply.ok(malformed)]);
      final (auth, _) = build();

      await expectLater(
        auth.signIn(username: 'sara', password: 'p'),
        throwsA(
          isA<AppError>()
              .having((e) => e.kind, 'kind', AppErrorKind.server)
              .having((e) => e.code, 'code', 'malformed_login'),
        ),
      );
    });
  });

  group('3/4. GET /me maps ActorDto onto AuthUser', () {
    test('the principal comes from the server, on the authenticated client',
        () async {
      server.on('GET', '/me', [Reply.ok(actorDto())]);
      final (auth, _) = build();

      final user = await auth.currentUser();

      expect(user.id, 'a_1');
      expect(user.displayName, 'Sara');
      expect(user.locale, 'ar');
      // Absent from ActorDto entirely; left null rather than invented.
      expect(user.avatarUrl, isNull);
      expect(user.timeZone, isNull);
      // It carried the bearer, which is what makes /me answer at all.
      final request = server.lastRequestTo('GET', '/me')!;
      expect(request.headers['authorization'], 'Bearer fake-access-token');
    });

    test('the role is the server word, through the existing contract',
        () async {
      server.on('GET', '/me', [Reply.ok(actorDto(kind: 'teacher'))]);
      final (auth, _) = build();

      expect((await auth.currentUser()).role, UserRole.teacher);
    });

    test('a kind this app cannot BE is refused, never defaulted', () async {
      // UserRole is parent|teacher. An admin authenticating here must not be
      // silently rendered as a parent -- that would be a privilege question
      // answered by a fallback.
      server.on('GET', '/me', [Reply.ok(actorDto(kind: 'admin'))]);
      final (auth, _) = build();

      await expectLater(
        auth.currentUser(),
        throwsA(
          isA<AppError>()
              .having((e) => e.kind, 'kind', AppErrorKind.forbidden)
              .having((e) => e.code, 'code', 'unsupported_actor_kind'),
        ),
      );
    });
  });

  group('5/6/7. the one refresh path is preserved', () {
    test('6. a 401 on /me refreshes once and replays', () async {
      server.on('GET', '/me', [
        const Reply(401, {'error': {'code': 'AUTH.UNAUTHENTICATED'}}),
        Reply.ok(actorDto()),
      ]);
      final (auth, tokens) = build(renewed: 'access-2');

      final user = await auth.currentUser();

      expect(user.id, 'a_1');
      expect(tokens.refreshes, 1, reason: 'exactly one refresh');
      expect(server.countOf('GET', '/me'), 2, reason: 'replayed once');
      // The replay carried the NEW token, not the stale one.
      expect(server.requests.last.headers['authorization'], 'Bearer access-2');
    });

    test('7. a refresh that cannot renew ends the session', () async {
      server.on('GET', '/me', [
        const Reply(401, {'error': {'code': 'AUTH.UNAUTHENTICATED'}}),
      ]);
      final (auth, tokens) = build(); // renewed: null

      await expectLater(auth.currentUser(), throwsA(isA<AppError>()));

      expect(tokens.refreshes, 1);
      expect(tokens.ended, hasLength(1));
      expect(tokens.ended.single.kind, AppErrorKind.unauthenticated);
    });

    test(
      '5a. A WRONG PASSWORD DOES NOT REFRESH, and does not end a session',
      () async {
        // The defect this exists to prevent: login on the authenticated client
        // makes a 401 mean "refresh and retry", so a typo would spend a refresh
        // and then declare the session over -- a session the user was still
        // trying to create.
        server.on('POST', '/auth/login', [
          const Reply(401, {'error': {'code': 'AUTH.INVALID_CREDENTIALS'}}),
        ]);
        final (auth, tokens) = build(renewed: 'access-2');

        await expectLater(
          auth.signIn(username: 'sara', password: 'wrong'),
          throwsA(
            isA<AppError>().having(
              (e) => e.kind,
              'kind',
              AppErrorKind.unauthenticated,
            ),
          ),
        );

        expect(tokens.refreshes, 0, reason: 'login must never refresh');
        expect(tokens.ended, isEmpty, reason: 'no session to end');
        expect(server.countOf('POST', '/auth/login'), 1, reason: 'no replay');
      },
    );

    test(
      '5b. AN EXPIRED REFRESH TOKEN FAILS CLEANLY INSTEAD OF DEADLOCKING',
      () async {
        // On the authenticated client this would re-enter the single-flight
        // refresh and await the very future it is already inside. The test
        // would hang rather than fail, so a timeout guards it.
        server.on('POST', '/auth/refresh', [
          const Reply(401, {'error': {'code': 'AUTH.SESSION_REVOKED'}}),
        ]);
        final (auth, tokens) = build();

        await expectLater(
          auth.refresh('stale-refresh-token').timeout(
                const Duration(seconds: 5),
              ),
          throwsA(isA<AppError>()),
        );

        expect(tokens.refreshes, 0, reason: 'refresh must not re-enter itself');
        expect(server.countOf('POST', '/auth/refresh'), 1);
      },
      timeout: const Timeout(Duration(seconds: 15)),
    );

    test('refresh sends the token and returns the renewed pair', () async {
      server.on('POST', '/auth/refresh', [Reply.ok(tokenPair())]);
      final (auth, _) = build();

      final session = await auth.refresh('refresh-0');

      expect(server.lastRequestTo('POST', '/auth/refresh')!.json['refreshToken'],
          'refresh-0');
      expect(session.accessToken, 'access-1');
    });
  });

  group('sign-out', () {
    test('it ends the session server-side on the authenticated client',
        () async {
      server.on('POST', '/auth/logout', [const Reply.ok({'ok': true})]);
      final (auth, _) = build();

      await auth.signOut();

      final request = server.lastRequestTo('POST', '/auth/logout')!;
      expect(request.headers['authorization'], 'Bearer fake-access-token');
    });
  });

  group('8. what the server does not publish fails explicitly', () {
    test('devices() throws rather than reporting no other devices', () async {
      final (auth, _) = build();

      await expectLater(
        auth.devices(),
        throwsA(
          isA<AppError>().having(
            (e) => e.code,
            'code',
            'auth_session_registry_unavailable',
          ),
        ),
      );
      expect(server.requests, isEmpty, reason: 'there is no route to call');
    });

    test('revokeDevice() throws rather than silently doing nothing', () async {
      final (auth, _) = build();

      await expectLater(
        auth.revokeDevice('d_1'),
        throwsA(
          isA<AppError>().having(
            (e) => e.code,
            'code',
            'auth_session_registry_unavailable',
          ),
        ),
      );
      expect(server.requests, isEmpty);
    });

    test('sessionRevoked is an empty stream, not an error', () async {
      final (auth, _) = build();

      // Nothing produces it server-side; enforcement is the 401 path above.
      expect(await auth.sessionRevoked.toList(), isEmpty);
    });
  });
}
