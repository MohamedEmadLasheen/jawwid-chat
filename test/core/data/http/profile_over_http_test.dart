import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_profile_repository.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';

import 'test_server.dart';

class _StaticToken implements TokenProvider {
  @override
  Future<String?> accessToken() async => 'access-token-value';

  @override
  Future<String?> refresh() async => null;

  @override
  Future<void> onSessionEnded(AppError error) async {}
}

/// The parent profile over the real HTTP transport.
///
/// Everything above this file fakes the repository, so this is the only place the WIRE half
/// of `apps/api/src/communication/api/parent-profile.controller.ts` is proved: the paths, the
/// PATCH body. (The photos are `/me/avatar`'s, proved with ProfilePhotoRepository.) The server here is scripted, not real — this tests
/// the client's half of the contract and nothing about the backend's behaviour.
///
/// ## Why the PATCH body gets a test of its own
///
/// The contract gives three distinct meanings to one field: ABSENT means leave it alone,
/// `""` means clear it, and a value means set it. All three collapse into the same wire if
/// the body is built carelessly, and the failure is silent and destructive — saving an About
/// would wipe the name, or clearing an About would quietly do nothing. There is no way to
/// see which of the three was sent except by looking at the bytes, so that is what these
/// assertions do.
void main() {
  late TestServer server;
  late HttpProfileRepository repository;

  Map<String, Object?> profileBody({
    String displayName = 'Huda Qasim',
    Object? about = 'Parent of two.',
    Object? avatarUrl = 'https://storage.test/avatars/p?sig=1',
    List<Map<String, Object?>> children = const [],
  }) =>
      {
        'displayName': displayName,
        'relationship': 'Mother',
        'signInIdentity': 'huda',
        'about': about,
        'avatarUrl': avatarUrl,
        'canMessage': true,
        'children': children,
      };

  setUp(() async {
    server = await TestServer.start();
    repository = HttpProfileRepository(
      client: buildApiClient(
        config: ApiConfig(baseUrl: server.baseUrl),
        tokens: _StaticToken(),
      ),
    );
  });

  tearDown(() async {
    await server.stop();
  });

  group('GET /me/profile', () {
    test('asks the published path, with no parent id anywhere in it', () async {
      server.on('GET', '/me/profile', [
        Reply.ok(profileBody(children: [
          {
            'id': 'learner-1',
            'displayName': 'Yusuf Qasim',
            'level': 'Grade 2',
            'about': 'Loves football.',
            'avatarUrl': 'https://storage.test/avatars/c?sig=1',
          },
        ])),
      ]);

      final profile = await repository.me();

      // The caller is the token. A path that carried an id would be a path a client could
      // tamper with.
      expect(server.requests.single.path, '/me/profile');
      expect(server.requests.single.path, isNot(contains('parent')));
      expect(profile.displayName, 'Huda Qasim');
      expect(profile.about, 'Parent of two.');
      expect(profile.children.single.id, 'learner-1');
      expect(profile.children.single.about, 'Loves football.');
    });

    test('blank is absent, so the UI draws an empty state and not an empty string', () async {
      // A server that sends "" or "   " means "nothing here". Carried through as a String,
      // it would render as a blank line where the placeholder belongs.
      server.on('GET', '/me/profile', [
        Reply.ok(profileBody(about: '   ', avatarUrl: '')),
      ]);

      final profile = await repository.me();

      expect(profile.about, isNull);
      expect(profile.avatarUrl, isNull);
      expect(profile.hasAbout, isFalse);
      expect(profile.hasPhoto, isFalse);
    });

    test('a body-less response fails diagnosably rather than as a null crash', () async {
      server.on('GET', '/me/profile', [const Reply(200, '')]);

      await expectLater(
        repository.me(),
        throwsA(
          isA<AppError>().having((e) => e.code, 'code', 'malformed_profile'),
        ),
      );
    });
  });

  group('the PATCH body', () {
    Future<Map<String, Object?>> bodyOf(Future<void> Function() call) async {
      server.on('PATCH', '/me/profile', [Reply.ok(profileBody())]);
      server.on('PATCH', '/me/children/learner-1', [Reply.ok(profileBody())]);
      await call();
      return (server.requests.last.body as Map).cast<String, Object?>();
    }

    test('a field the caller did not pass is ABSENT, not null', () async {
      final body = await bodyOf(() => repository.updateMe(name: 'Huda Q.'));

      expect(body, {'name': 'Huda Q.'});
      // The distinction that matters: `about: null` on the wire would be read as "clear it".
      expect(body.containsKey('about'), isFalse);
    });

    test('an empty About IS sent, because that is how a parent clears it', () async {
      final body = await bodyOf(() => repository.updateMe(about: ''));

      expect(body, {'about': ''});
      expect(body.containsKey('name'), isFalse);
    });

    test('both fields travel together when both were edited', () async {
      final body = await bodyOf(
        () => repository.updateMe(name: 'Huda Q.', about: 'Parent of two.'),
      );

      expect(body, {'name': 'Huda Q.', 'about': 'Parent of two.'});
    });

    test('an edit of nothing sends an empty object, not nulls', () async {
      final body = await bodyOf(() => repository.updateMe());

      expect(body, isEmpty);
    });

    test('a child edit carries the learner id in the PATH and the same body rules', () async {
      final body = await bodyOf(
        () => repository.updateChild('learner-1', name: 'Yusuf Q.'),
      );

      expect(server.requests.last.path, '/me/children/learner-1');
      expect(body, {'name': 'Yusuf Q.'});
      // The body never names an owner: the server resolves the learner inside the caller's
      // own family, so there is nothing here for a client to claim.
      expect(body.keys, isNot(contains('parentId')));
      expect(body.keys, isNot(contains('familyId')));
    });
  });

}
