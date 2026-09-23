import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_conversation_repository.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/actor_identity.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import 'test_server.dart';

class _NoTokens implements TokenProvider {
  @override
  Future<String?> accessToken() async => null;
  @override
  Future<String?> refresh() async => null;
  @override
  Future<void> onSessionEnded(AppError error) async {}
}

/// Child context and unread counts, read off a REAL HTTP response.
///
/// These are the two fields the chat list could not render. Every other
/// conversation test in this repository runs against the in-memory fixture,
/// where both work because the fixture hands them over directly — which is
/// exactly how the gap stayed invisible for so long: the UI was right and the
/// payload was empty.
///
/// So this drives the real repository against a real socket. The only place the
/// child's name and the badge can come from here is the JSON.
///
/// No widget binding in this file, deliberately: `TestWidgetsFlutterBinding`
/// installs an `HttpOverrides` that answers every real request with a 400, so a
/// widget test cannot also be a network test. Rendering is covered separately.
void main() {
  late TestServer server;

  setUp(() async => server = await TestServer.start());
  tearDown(() async => server.stop());

  HttpConversationRepository repository() => HttpConversationRepository(
        client: buildApiClient(
          config: ApiConfig(baseUrl: server.baseUrl),
          tokens: _NoTokens(),
          identity: const BearerTokenIdentity(),
        ),
        viewerRole: () => UserRole.parent,
      );

  Map<String, Object?> dto({
    String id = 'c_1',
    String title = 'أحمد · جَوِّد',
    String type = 'student_group',
    Map<String, Object?>? learner,
    Object? unreadCount = 0,
  }) =>
      {
        'id': id,
        'type': type,
        'familyId': 'f_1',
        'learnerId': learner?['id'],
        'title': title,
        'state': 'open',
        'needsReply': false,
        'lastSeq': '10',
        'lastActivityAt': '2026-09-05T12:00:00.000Z',
        'archivedAt': null,
        'teacherRequiresApproval': true,
        'parentRequiresApproval': false,
        'learner': ?learner,
        'unreadCount': ?unreadCount,
      };

  group('learner context', () {
    test('the child comes back resolved to a name', () async {
      server.on('GET', '/conversations', [
        Reply.ok({
          'conversations': [
            dto(learner: {'id': 'l_1', 'name': 'أحمد'}),
          ],
        }),
      ]);

      final conversations = await repository().list();

      expect(conversations.single.learner?.id, 'l_1');
      expect(conversations.single.learner?.displayName, 'أحمد');
    });

    test('the name is the server\'s, never parsed out of the title', () async {
      // The decisive case. The title says one child and the learner says
      // another; only a client reading the DTO renders the learner. A client
      // splitting "Ahmed · Jawwid" on the separator would answer "Ahmed".
      server.on('GET', '/conversations', [
        Reply.ok({
          'conversations': [
            dto(
              title: 'Ahmed · Jawwid',
              learner: {'id': 'l_1', 'name': 'Mohamed Junior'},
            ),
          ],
        }),
      ]);

      final conversations = await repository().list();

      expect(conversations.single.learner?.displayName, 'Mohamed Junior');
      expect(conversations.single.title, 'Ahmed · Jawwid');
    });

    test('a conversation with no learner has none', () async {
      server.on('GET', '/conversations', [
        Reply.ok({
          'conversations': [dto(type: 'direct', title: 'جَوِّد')],
        }),
      ]);

      expect((await repository().list()).single.learner, isNull);
    });

    test('an explicit null learner is null, not an empty child', () async {
      server.on('GET', '/conversations', [
        Reply.ok({
          'conversations': [
            {...dto(type: 'direct'), 'learner': null},
          ],
        }),
      ]);

      expect((await repository().list()).single.learner, isNull);
    });

    test('a malformed learner is dropped rather than half-rendered', () async {
      server.on('GET', '/conversations', [
        Reply.ok({
          'conversations': [
            {...dto(), 'learner': {'name': 'no id'}},
          ],
        }),
      ]);

      expect((await repository().list()).single.learner, isNull);
    });

    test('the detail route carries the learner too', () async {
      server.on('GET', '/conversations/c_1', [
        Reply.ok(dto(learner: {'id': 'l_1', 'name': 'أحمد'})),
      ]);

      final conversation = await repository().byId('c_1');

      expect(conversation.learner?.displayName, 'أحمد');
    });
  });

  group('unread count', () {
    test('comes off the payload', () async {
      server.on('GET', '/conversations', [
        Reply.ok({
          'conversations': [dto(unreadCount: 3)],
        }),
      ]);

      final conversation = (await repository().list()).single;

      expect(conversation.unreadCount, 3);
      expect(conversation.hasUnread, isTrue);
    });

    test('zero is zero', () async {
      server.on('GET', '/conversations', [
        Reply.ok({
          'conversations': [dto(unreadCount: 0)],
        }),
      ]);

      expect((await repository().list()).single.hasUnread, isFalse);
    });

    test('an omitted count is zero, never invented', () async {
      // The create and sync routes do not compute it. Absent must read as "no
      // badge", not as a number the client made up.
      server.on('GET', '/conversations', [
        Reply.ok({
          'conversations': [dto(unreadCount: null)],
        }),
      ]);

      expect((await repository().list()).single.unreadCount, 0);
    });

    test('a refetch reflects what the server now says', () async {
      // The lifecycle the chat list has to survive without realtime: the badge
      // moves because the list was fetched again, not because anything local
      // counted messages.
      server.on('GET', '/conversations', [
        Reply.ok({
          'conversations': [dto(unreadCount: 0)],
        }),
        Reply.ok({
          'conversations': [dto(unreadCount: 4)],
        }),
        Reply.ok({
          'conversations': [dto(unreadCount: 0)],
        }),
      ]);

      final repo = repository();
      expect((await repo.list()).single.unreadCount, 0);
      expect((await repo.list()).single.unreadCount, 4);
      expect((await repo.list()).single.unreadCount, 0);
    });

    test('each conversation keeps its own count', () async {
      server.on('GET', '/conversations', [
        Reply.ok({
          'conversations': [
            dto(id: 'c_1', unreadCount: 2),
            dto(id: 'c_2', unreadCount: 0),
            dto(id: 'c_3', unreadCount: 7),
          ],
        }),
      ]);

      final byId = {
        for (final c in await repository().list()) c.id: c.unreadCount,
      };

      expect(byId, {'c_1': 2, 'c_2': 0, 'c_3': 7});
    });
  });
}
