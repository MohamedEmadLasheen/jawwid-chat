import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/attachment_uploader.dart';
import 'package:jawwid_chat/core/data/http/http_profile_repository.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';
import 'package:jawwid_chat/shared/models/message.dart';

import 'test_server.dart';

class _StaticToken implements TokenProvider {
  @override
  Future<String?> accessToken() async => 'access-token-value';

  @override
  Future<String?> refresh() async => null;

  @override
  Future<void> onSessionEnded(AppError error) async {}
}

/// Records an upload instead of performing one.
class _RecordingUploader implements AttachmentUploader {
  String? url;
  Uint8List? bytes;
  Map<String, String>? headers;

  @override
  Future<void> put(
    String uploadUrl, {
    required Uint8List bytes,
    required Map<String, String> headers,
  }) async {
    url = uploadUrl;
    this.bytes = bytes;
    this.headers = headers;
  }
}

/// The parent profile over the real HTTP transport.
///
/// Everything above this file fakes the repository, so this is the only place the WIRE half
/// of `apps/api/src/communication/api/parent-profile.controller.ts` is proved: the paths, the
/// PATCH body, and the two-step upload. The server here is scripted, not real — this tests
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
  late _RecordingUploader uploader;

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
    uploader = _RecordingUploader();
    repository = HttpProfileRepository(
      client: buildApiClient(
        config: ApiConfig(baseUrl: server.baseUrl),
        tokens: _StaticToken(),
      ),
      uploads: uploader,
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

    test('GET /me/avatar is the kind-agnostic read, and carries no children', () async {
      // What a staff member or a teacher calls: they have no family, so `me` is not
      // available to them. The same DTO comes back with `children` empty, which is why
      // nothing above this layer has to branch on who is signed in.
      server.on('GET', '/me/avatar', [
        Reply.ok(profileBody(displayName: 'QA Teacher', children: const [])),
      ]);

      final profile = await repository.myAvatar();

      expect(server.requests.single.path, '/me/avatar');
      expect(profile.displayName, 'QA Teacher');
      expect(profile.children, isEmpty);
      expect(profile.hasPhoto, isTrue);
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

  group('the avatar upload', () {
    late File file;

    setUp(() async {
      final dir = await Directory.systemTemp.createTemp('jawwid-avatar-test');
      addTearDown(() => dir.delete(recursive: true));
      file = File('${dir.path}/photo.jpg');
      await file.writeAsBytes(Uint8List.fromList(List.filled(32, 7)));
    });

    PendingAttachment image({int? byteSize}) => PendingAttachment(
          filePath: file.path,
          kind: MessageKind.image,
          mimeType: 'image/jpeg',
          byteSize: byteSize ?? 32,
        );

    test('authorizes, PUTs the bytes to storage, then commits the key', () async {
      server.on('POST', '/me/avatar/authorize', [
        const Reply.ok({
          'objectKey': 'avatars/abc123',
          'uploadUrl': 'https://storage.test/upload?sig=xyz',
          'headers': {'Content-Type': 'image/jpeg'},
        }),
      ]);
      server.on('POST', '/me/avatar', [Reply.ok(profileBody())]);

      await repository.setAvatar(image());

      // Step one states only what is being uploaded -- never where it may be written.
      expect(
        (server.lastRequestTo('POST', '/me/avatar/authorize')!.body as Map)
            .cast<String, Object?>(),
        {'mimeType': 'image/jpeg', 'byteSize': 32},
      );
      // Step two goes STRAIGHT to storage: the bytes never pass through the API.
      expect(uploader.url, 'https://storage.test/upload?sig=xyz');
      expect(uploader.bytes, hasLength(32));
      expect(uploader.headers, {'Content-Type': 'image/jpeg'});
      // Step three names the key the SERVER chose, echoed back unmodified.
      expect(
        (server.lastRequestTo('POST', '/me/avatar')!.body as Map)['objectKey'],
        'avatars/abc123',
      );
      // And no request body ever carried the image itself.
      for (final request in server.requests) {
        expect(request.bodyBytes.length, lessThan(200));
      }
    });

    test('the access token is never sent to the storage host', () async {
      server.on('POST', '/me/avatar/authorize', [
        const Reply.ok({
          'objectKey': 'avatars/abc123',
          'uploadUrl': 'https://storage.test/upload?sig=xyz',
          'headers': {'Content-Type': 'image/jpeg'},
        }),
      ]);
      server.on('POST', '/me/avatar', [Reply.ok(profileBody())]);

      await repository.setAvatar(image());

      // The upload URL carries its own authorization and, in any real deployment, points at
      // a host that is not ours. Sending the bearer token there would hand the user's
      // session to a third party.
      expect(uploader.headers, isNot(contains('Authorization')));
      expect(uploader.headers!.keys.map((k) => k.toLowerCase()),
          isNot(contains('authorization')));
      expect(uploader.headers!.values.join(), isNot(contains('access-token-value')));
      // Whereas the API calls themselves are of course authenticated.
      expect(
        server.lastRequestTo('POST', '/me/avatar')!.headers['authorization'],
        'Bearer access-token-value',
      );
    });

    test('a grant missing its key or URL is refused before any upload', () async {
      server.on('POST', '/me/avatar/authorize', [
        const Reply.ok({'objectKey': 'avatars/abc123'}),
      ]);

      await expectLater(
        repository.setAvatar(image()),
        throwsA(
          isA<AppError>()
              .having((e) => e.code, 'code', 'malformed_upload_authorization'),
        ),
      );
      expect(uploader.url, isNull, reason: 'nothing may be uploaded without a grant');
      expect(server.countOf('POST', '/me/avatar'), 0);
    });

    test('a file that changed size since authorization fails with something readable',
        () async {
      // The grant is signed for a byte count. Uploading a different size earns an opaque
      // 403 from storage, which tells a support engineer nothing.
      server.on('POST', '/me/avatar/authorize', [
        const Reply.ok({
          'objectKey': 'avatars/abc123',
          'uploadUrl': 'https://storage.test/upload?sig=xyz',
          'headers': <String, String>{},
        }),
      ]);

      await expectLater(
        repository.setAvatar(image(byteSize: 999)),
        throwsA(
          isA<AppError>().having((e) => e.code, 'code', 'avatar_size_changed'),
        ),
      );
      expect(uploader.url, isNull);
    });

    test('a child photo uses the child path, and still names no owner', () async {
      server.on('POST', '/me/avatar/authorize', [
        const Reply.ok({
          'objectKey': 'avatars/child1',
          'uploadUrl': 'https://storage.test/upload?sig=xyz',
          'headers': <String, String>{},
        }),
      ]);
      server.on('POST', '/me/children/learner-1/avatar', [Reply.ok(profileBody())]);

      await repository.setChildAvatar('learner-1', image());

      final commit = server.lastRequestTo('POST', '/me/children/learner-1/avatar')!;
      expect((commit.body as Map).keys, ['objectKey']);

      // The grant must name the SUBJECT, because the key the server mints contains it.
      // Without this the server would mint a key under the PARENT's namespace and then
      // refuse the very commit it just authorized.
      final grant = (server.lastRequestTo('POST', '/me/avatar/authorize')!.body as Map)
          .cast<String, Object?>();
      expect(grant['learnerId'], 'learner-1');
    });

    test("the caller's OWN photo names no subject at all", () async {
      // Absent, not null: absent is what the server reads as "the caller themselves", and
      // an explicit null would be a different claim.
      server.on('POST', '/me/avatar/authorize', [
        const Reply.ok({
          'objectKey': 'avatars/contacts/c1/abc',
          'uploadUrl': 'https://storage.test/upload?sig=xyz',
          'headers': <String, String>{},
        }),
      ]);
      server.on('POST', '/me/avatar', [Reply.ok(profileBody())]);

      await repository.setAvatar(image());

      final grant = (server.lastRequestTo('POST', '/me/avatar/authorize')!.body as Map)
          .cast<String, Object?>();
      expect(grant.containsKey('learnerId'), isFalse);
      expect(grant.keys.toSet(), {'mimeType', 'byteSize'});
    });
  });

  group('removal', () {
    test('DELETEs the published paths and carries no body', () async {
      server.on('DELETE', '/me/avatar', [Reply.ok(profileBody(avatarUrl: null))]);
      server.on('DELETE', '/me/children/learner-1/avatar', [
        Reply.ok(profileBody(avatarUrl: null)),
      ]);

      final mine = await repository.removeAvatar();
      final childs = await repository.removeChildAvatar('learner-1');

      expect(server.requests.first.path, '/me/avatar');
      expect(server.requests.first.bodyBytes, isEmpty);
      expect(server.requests.last.path, '/me/children/learner-1/avatar');
      expect(mine.hasPhoto, isFalse);
      expect(childs.hasPhoto, isFalse);
    });
  });
}
