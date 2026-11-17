import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_auth_repository.dart';
import 'package:jawwid_chat/core/data/http/http_legal_repository.dart';
import 'package:jawwid_chat/core/data/http/http_parent_signup_repository.dart';
import 'package:jawwid_chat/core/data/http/http_password_change_repository.dart';
import 'package:jawwid_chat/core/data/wire/wire_vocab.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/device_descriptor.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/shared/models/auth.dart';
import 'package:jawwid_chat/shared/models/legal.dart';

import 'test_server.dart';

class _NoDevice implements DeviceDescriptor {
  @override
  Future<DeviceDescription?> describe() async => null;
}

class _StaticToken implements TokenProvider {
  @override
  Future<String?> accessToken() async => 'access-token-value';

  @override
  Future<String?> refresh() async => null;

  @override
  Future<void> onSessionEnded(AppError error) async {}
}

/// PD-58 (ENG-11) on the wire: the client's half of API-CONTRACT §1.1c. The server is
/// scripted; what is proved is what the client sends and how it reads the answers.
void main() {
  late TestServer server;

  setUp(() async => server = await TestServer.start());
  tearDown(() async => server.stop());

  const terms = {
    'documentKey': 'terms_teacher',
    'version': '2026-12-01',
    'urlAr': 'https://legal.example.test/ar/teacher-terms',
    'urlEn': 'https://legal.example.test/en/teacher-terms',
  };
  const conduct = {
    'documentKey': 'code_of_conduct',
    'version': '2026-12-01.2',
    'urlAr': 'https://legal.example.test/ar/conduct',
    'urlEn': 'https://legal.example.test/en/conduct',
  };
  const required = {
    'state': 'required',
    'required': [terms, conduct],
    'unavailable': <String>[],
  };

  ApiClient client({void Function(AppError)? onTermsNotAccepted}) => buildApiClient(
        config: ApiConfig(baseUrl: server.baseUrl),
        tokens: _StaticToken(),
        onTermsNotAccepted: onTermsNotAccepted,
      );

  Future<AppError> refusal(Future<Object?> Function() call) async {
    try {
      await call();
    } on AppError catch (e) {
      return e;
    }
    fail('expected a refusal');
  }

  group('GET /me/legal', () {
    test('reads the block (documents are extra and ignored)', () async {
      server.on('GET', '/me/legal', [
        const Reply.ok({
          ...required,
          'documents': [
            {...terms, 'accepted': false, 'acceptedVersion': null, 'acceptedAt': null},
          ],
        }),
      ]);
      final legal = await HttpLegalRepository(client: client()).current();
      expect(server.requests.single.method, 'GET');
      expect(server.requests.single.path, '/me/legal');
      expect(legal.state, LegalState.required);
      expect(legal.required.map((d) => d.documentKey), ['terms_teacher', 'code_of_conduct']);
    });
  });

  group('POST /me/legal/accept', () {
    final documents = [
      LegalDocument.fromWire(terms)!,
      LegalDocument.fromWire(conduct)!,
    ];

    test('sends exactly {documents: [{documentKey, version}], client, locale} and reads {legal}', () async {
      server.on('POST', '/me/legal/accept', [
        const Reply.ok({
          'legal': {'state': 'accepted', 'required': [], 'unavailable': []},
        }),
      ]);
      final legal = await HttpLegalRepository(client: client()).accept(
        documents: documents,
        client: 'ios',
        locale: 'ar',
      );
      final request = server.requests.single;
      expect(request.method, 'POST');
      expect(request.path, '/me/legal/accept');
      expect(request.json, {
        'documents': [
          {'documentKey': 'terms_teacher', 'version': '2026-12-01'},
          {'documentKey': 'code_of_conduct', 'version': '2026-12-01.2'},
        ],
        'client': 'ios',
        'locale': 'ar',
      });
      expect(legal.state, LegalState.accepted);
    });

    test('an answer without a legal block is never read as accepted', () async {
      server.on('POST', '/me/legal/accept', [const Reply.ok({'ok': true})]);
      final legal = await HttpLegalRepository(client: client()).accept(documents: documents, client: 'android', locale: 'en');
      expect(legal.state, LegalState.unavailable);
    });

    test('the contract refusals reach the caller with their codes', () async {
      final repo = HttpLegalRepository(client: client());
      for (final (status, code) in [
        (409, WireErrors.legalVersionStale),
        (400, WireErrors.legalWrongDocuments),
        (403, WireErrors.supportSessionForbidden),
        (503, WireErrors.legalNotConfigured),
      ]) {
        server.on('POST', '/me/legal/accept', [Reply.commError(status, code)]);
        final error = await refusal(() => repo.accept(documents: documents, client: 'android', locale: 'en'));
        expect(error.code, code, reason: '$status');
      }
    });
  });

  group('a 403 COMM.TERMS_NOT_ACCEPTED from ANY route is reported centrally', () {
    test('reported once, with its detail, and still thrown to the caller', () async {
      final reported = <AppError>[];
      server.on('POST', '/conversations/c1/messages', [
        const Reply(403, {
          'error': {
            'code': 'COMM.TERMS_NOT_ACCEPTED',
            'message': 'refused',
            'detail': {
              'required': [terms],
            },
          },
        }),
      ]);
      final error = await refusal(
        () => client(onTermsNotAccepted: reported.add).post<Object?>('/conversations/c1/messages', data: {'text': 'hi'}),
      );
      expect(error.code, WireErrors.termsNotAccepted);
      expect(error.kind, AppErrorKind.forbidden);
      expect(reported, hasLength(1));
      expect(reported.single.code, WireErrors.termsNotAccepted);
      expect(reported.single.detail?['required'], isA<List<Object?>>());
    });

    test('any other 403 is not', () async {
      final reported = <AppError>[];
      server.on('POST', '/me/blocks', [Reply.commError(403, 'COMM.BLOCK_NOT_ALLOWED')]);
      await refusal(() => client(onTermsNotAccepted: reported.add).post<Object?>('/me/blocks'));
      expect(reported, isEmpty);
    });
  });

  group('the token pair: refresh and password change hand the block on', () {
    Map<String, Object?> pair(String access, {Object? legal}) => {
          'tokenType': 'Bearer',
          'accessToken': access,
          'expiresIn': 900,
          'refreshToken': 'refresh-$access',
          'session': {'id': 's', 'createdAt': '2026-11-02T09:00:00.000Z'},
          'actor': {'actorId': 'a1', 'kind': 'teacher', 'displayName': 'T', 'legal': ?legal},
          'legal': ?legal,
        };

    ({HttpAuthRepository auth, InMemoryTokenStore store, StoredTokenProvider tokens, List<LegalStatus> seen}) stack() {
      final store = InMemoryTokenStore();
      final seen = <LegalStatus>[];
      late final ApiClient api;
      final auth = HttpAuthRepository(
        transport: buildAuthTransport(config: ApiConfig(baseUrl: server.baseUrl)),
        protected: () => api,
        device: _NoDevice(),
        currentAccessToken: () async => (await store.read())?.accessToken,
      );
      final tokens = StoredTokenProvider(store: store, auth: auth, onEnded: (_) async {}, onLegal: seen.add);
      api = buildApiClient(config: ApiConfig(baseUrl: server.baseUrl), tokens: tokens);
      return (auth: auth, store: store, tokens: tokens, seen: seen);
    }

    Future<void> seed(TokenStore store) => store.write(AuthSession(
          accessToken: 'access-1',
          refreshToken: 'refresh-1',
          accessTokenExpiresAt: DateTime.now().add(const Duration(minutes: 5)),
        ));

    test('a refresh carrying legal reports it; one without says nothing', () async {
      final s = stack();
      await seed(s.store);
      server.on('POST', '/auth/refresh', [
        Reply.ok(pair('access-2', legal: required)),
        Reply.ok(pair('access-3')),
      ]);
      await s.tokens.refresh();
      expect(s.seen.single.state, LegalState.required);
      await s.tokens.refresh();
      expect(s.seen, hasLength(1));
    });

    test('a password change carrying legal reports it', () async {
      final s = stack();
      await seed(s.store);
      final seen = <LegalStatus>[];
      server.on('POST', '/auth/password/change', [Reply.ok(pair('access-2', legal: required))]);
      final repo = HttpPasswordChangeRepository(
        client: buildApiClient(config: ApiConfig(baseUrl: server.baseUrl), tokens: s.tokens),
        tokens: s.store,
        onLegal: seen.add,
      );
      await repo.change(currentPassword: 'old-pass', newPassword: 'new-pass');
      expect(seen.single.state, LegalState.required);
      expect((await s.store.read())?.accessToken, 'access-2');
    });
  });

  group('PD-16 sign-up', () {
    HttpParentSignupRepository repo() =>
        HttpParentSignupRepository(transport: buildAuthTransport(config: ApiConfig(baseUrl: server.baseUrl)));

    test('GET /auth/signup/legal 200: the family set', () async {
      server.on('GET', '/auth/signup/legal', [
        const Reply.ok({
          'required': [
            {
              'documentKey': 'terms_family',
              'version': '2026-12-01',
              'urlAr': 'https://legal.example.test/ar/family-terms',
              'urlEn': 'https://legal.example.test/en/family-terms',
            },
            conduct,
          ],
        }),
      ]);
      final docs = await repo().signupLegal();
      expect(server.requests.single.path, '/auth/signup/legal');
      expect(docs?.map((d) => d.documentKey), ['terms_family', 'code_of_conduct']);
    });

    test('200 with nothing in force (outside production): an empty set, not "none offered"', () async {
      server.on('GET', '/auth/signup/legal', [const Reply.ok({'required': []})]);
      expect(await repo().signupLegal(), isEmpty);
    });

    test('404 (the API before ENG-10): null -- no legal step', () async {
      server.on('GET', '/auth/signup/legal', [
        const Reply(404, {'statusCode': 404, 'message': 'Cannot GET /auth/signup/legal', 'error': 'Not Found'}),
      ]);
      expect(await repo().signupLegal(), isNull);
    });

    test('503 COMM.LEGAL_NOT_CONFIGURED: thrown, never read as "nothing to accept"', () async {
      server.on('GET', '/auth/signup/legal', [Reply.commError(503, WireErrors.legalNotConfigured)]);
      final error = await refusal(() => repo().signupLegal());
      expect(error.code, WireErrors.legalNotConfigured);
    });

    test('a malformed 200 is thrown, never read as "nothing to accept"', () async {
      server.on('GET', '/auth/signup/legal', [
        const Reply.ok({
          'required': [
            {'documentKey': 'terms_family'},
          ],
        }),
      ]);
      await refusal(() => repo().signupLegal());
    });

    test('verify carries acceptLegal, client and locale when given', () async {
      server.on('POST', '/auth/signup/verify', [const Reply.ok({'ok': true})]);
      await repo().verify(
        email: 'parent@example.test',
        code: '482913',
        password: 'long-password-1',
        acceptLegal: [LegalDocument.fromWire({...terms, 'documentKey': 'terms_family'})!, LegalDocument.fromWire(conduct)!],
        client: 'android',
        locale: 'ar',
      );
      expect(server.requests.single.json, {
        'email': 'parent@example.test',
        'code': '482913',
        'password': 'long-password-1',
        'acceptLegal': [
          {'documentKey': 'terms_family', 'version': '2026-12-01'},
          {'documentKey': 'code_of_conduct', 'version': '2026-12-01.2'},
        ],
        'client': 'android',
        'locale': 'ar',
      });
    });

    test('verify without acceptLegal sends none of the three', () async {
      server.on('POST', '/auth/signup/verify', [const Reply.ok({'ok': true})]);
      await repo().verify(email: 'parent@example.test', code: '482913', password: 'long-password-1', client: 'android', locale: 'en');
      expect(server.requests.single.json.keys, unorderedEquals(['email', 'code', 'password']));
    });
  });
}
