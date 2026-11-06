import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_block_repository.dart';
import 'package:jawwid_chat/core/data/http/http_message_repository.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';
import 'package:jawwid_chat/features/moderation/data/block_repository.dart';

import 'test_server.dart';

class _StaticToken implements TokenProvider {
  @override
  Future<String?> accessToken() async => 'access-token-value';

  @override
  Future<String?> refresh() async => null;

  @override
  Future<void> onSessionEnded(AppError error) async {}
}

/// PD-57 §5 (closure plan) over the real HTTP transport: the three block routes, their exact
/// bodies, the error codes, and `hiddenByBlock` on a message. The server is scripted, so this
/// proves the client's half of the contract and nothing about the backend.
void main() {
  late TestServer server;
  late HttpBlockRepository repository;

  ApiClient client() => buildApiClient(
    config: ApiConfig(baseUrl: server.baseUrl),
    tokens: _StaticToken(),
  );

  setUp(() async {
    server = await TestServer.start();
    repository = HttpBlockRepository(client: client());
  });

  tearDown(() async => server.stop());

  group('POST /me/blocks', () {
    test('sends exactly {subject: {kind, id}} and reads the new block (201)', () async {
      server.on('POST', '/me/blocks', [
        const Reply(201, {
          'id': 'b1',
          'subject': {'kind': 'teacher', 'id': 't9', 'name': 'Ustadh Kareem'},
          'createdAt': '2026-11-06T10:00:00.000Z',
        }),
      ]);

      final block = await repository.block(const BlockSubject(kind: 'teacher', id: 't9'));

      final request = server.requests.single;
      expect(request.method, 'POST');
      expect(request.path, '/me/blocks');
      expect(request.json, {
        'subject': {'kind': 'teacher', 'id': 't9'},
      });
      expect(block.id, 'b1');
      expect(block.subject, const BlockSubject(kind: 'teacher', id: 't9'));
      expect(block.name, 'Ustadh Kareem');
      expect(block.createdAt?.toUtc(), DateTime.utc(2026, 11, 6, 10));
    });

    test('200 (already blocked) answers the existing block, the same shape', () async {
      server.on('POST', '/me/blocks', [
        const Reply(200, {
          'id': 'b0',
          'subject': {'kind': 'staff', 'id': 's1', 'name': 'Noura'},
          'createdAt': '2026-11-01T10:00:00.000Z',
        }),
      ]);

      final block = await repository.block(const BlockSubject(kind: 'staff', id: 's1'));
      expect(block.id, 'b0');
      expect(block.name, 'Noura');
    });

    test('the contract error codes reach the caller with their kind', () async {
      Future<AppError> refused(int status, String code) async {
        server.on('POST', '/me/blocks', [Reply.commError(status, code)]);
        try {
          await repository.block(const BlockSubject(kind: 'contact', id: 'p1'));
        } on AppError catch (e) {
          return e;
        }
        fail('expected a refusal');
      }

      final notAllowed = await refused(403, BlockErrors.notAllowed);
      expect((notAllowed.kind, notAllowed.code), (AppErrorKind.forbidden, BlockErrors.notAllowed));
      final noShared = await refused(404, BlockErrors.noSharedConversation);
      expect((noShared.kind, noShared.code), (AppErrorKind.notFound, BlockErrors.noSharedConversation));
      final limited = await refused(429, BlockErrors.rateLimited);
      expect(limited.kind, AppErrorKind.rateLimited);
      final terms = await refused(403, BlockErrors.termsNotAccepted);
      expect(terms.code, BlockErrors.termsNotAccepted);
    });
  });

  group('GET /me/blocks', () {
    test('asks the published path and reads each block, newest first; unusable rows dropped', () async {
      server.on('GET', '/me/blocks', [
        const Reply.ok([
          {
            'id': 'b1',
            'subject': {'kind': 'teacher', 'id': 't9', 'name': 'Ustadh Kareem', 'avatar': 'https://cdn.example/a.png'},
            'createdAt': '2026-11-01T08:00:00.000Z',
          },
          {
            'id': 'b2',
            'subject': {'kind': 'staff', 'id': 's1', 'name': null},
            'createdAt': '2026-11-03T08:00:00.000Z',
          },
          {
            'subject': {'kind': 'staff', 'id': 's2'},
            'createdAt': '2026-11-03T08:00:00.000Z',
          },
          {'id': 'b4', 'createdAt': '2026-11-03T08:00:00.000Z'},
        ]),
      ]);

      final blocks = await repository.mine();

      expect(server.requests.single.method, 'GET');
      expect(server.requests.single.path, '/me/blocks');
      expect(blocks.map((b) => b.id), ['b2', 'b1']);
      expect(blocks[0].name, '', reason: 'no name is never filled with an id');
      expect(blocks[1].name, 'Ustadh Kareem');
      expect(blocks[1].avatarUrl, 'https://cdn.example/a.png');
      expect(blocks[1].subject, const BlockSubject(kind: 'teacher', id: 't9'));
    });
  });

  group('DELETE /me/blocks/:id', () {
    test('deletes by the block id', () async {
      server.on('DELETE', '/me/blocks/b1', [const Reply(204, null)]);

      await repository.unblock('b1');

      expect(server.requests.single.method, 'DELETE');
      expect(server.requests.single.path, '/me/blocks/b1');
    });

    test('404 for an unknown block reaches the caller as notFound', () async {
      server.on('DELETE', '/me/blocks/nope', [Reply.commError(404, 'COMMON.NOT_FOUND')]);
      await expectLater(
        repository.unblock('nope'),
        throwsA(isA<AppError>().having((e) => e.kind, 'kind', AppErrorKind.notFound)),
      );
    });
  });

  group('hiddenByBlock on a message', () {
    Map<String, Object?> dto(String id, {Object? hiddenByBlock, String body = ''}) => {
      'id': id,
      'conversationId': 'c1',
      'seq': '1',
      'authorKind': 'teacher',
      'authorId': 't9',
      'authorDisplayName': 'Ustadh Kareem',
      'type': 'text',
      'body': body,
      'visibility': 'customer',
      'moderation': 'published',
      'origin': 'user',
      'deletedForAll': false,
      'createdAt': DateTime.utc(2026, 11, 1).toIso8601String(),
      'attachments': <Object?>[],
      'reactions': <Object?>[],
      'receipts': <Object?>[],
      'hiddenByBlock': ?hiddenByBlock,
    };

    test('is read when true, and its absence (or anything else) means not hidden', () async {
      server.on('GET', '/conversations/c1/messages', [
        Reply.ok({
          'messages': [
            dto('m1', hiddenByBlock: true),
            dto('m2', body: 'hello'),
            dto('m3', hiddenByBlock: 'yes', body: 'x'),
          ],
          'nextBefore': null,
        }),
      ]);

      final page = await HttpMessageRepository(client: client(), viewerActorId: () => 'me').history('c1');
      final byId = {for (final m in page.items) m.id: m};

      expect(byId['m1']!.isHiddenByBlock, isTrue);
      expect(byId['m1']!.body, isEmpty);
      expect(byId['m2']!.isHiddenByBlock, isFalse);
      expect(byId['m3']!.isHiddenByBlock, isFalse);
    });
  });
}
