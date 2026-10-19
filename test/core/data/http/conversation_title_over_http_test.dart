import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_conversation_repository.dart';
import 'package:jawwid_chat/core/data/wire/wire_mappers.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
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

/// What a conversation row is called.
///
/// A direct conversation has no server title, and the mapper used to take the
/// title alone -- so every direct row rendered as an empty name with a "?"
/// avatar (found on a PD-6-era Teacher<->Parent direct in QA). The list DTO
/// already carries each member's `displayName`; the row is now named after the
/// OTHER members, the viewer excluded by actor id. Never a name this client
/// resolved itself.
void main() {
  Map<String, Object?> member(String actorId, String kind, String role, String? name) => {
        'actorId': actorId,
        'actorKind': kind,
        'memberRole': role,
        'isSilent': false,
        'displayName': ?name,
      };

  final teacher = member('t_1', 'teacher', 'teacher', 'QA Teacher A');
  final parent = member('c_1', 'contact', 'parent', 'QA Parent A');
  final admin = member('s_1', 'staff', 'admin', 'QA Admin A');

  group('WireMappers.conversationTitle', () {
    test("the server's title wins when it set one (a Student Group)", () {
      expect(
        WireMappers.conversationTitle(
          {'title': 'QA Learner A · Jawwid', 'members': [teacher, parent, admin]},
          viewerActorId: 'c_1',
        ),
        'QA Learner A · Jawwid',
      );
    });

    test('an untitled direct is named after the other member, from either side', () {
      final legacy = {'title': null, 'members': [teacher, parent]};
      expect(WireMappers.conversationTitle(legacy, viewerActorId: 't_1'), 'QA Parent A');
      expect(WireMappers.conversationTitle(legacy, viewerActorId: 'c_1'), 'QA Teacher A');

      final withAdmin = {'title': '', 'members': [parent, admin]};
      expect(WireMappers.conversationTitle(withAdmin, viewerActorId: 'c_1'), 'QA Admin A');
    });

    test('members without a name are skipped; nobody else named reads as empty, never invented', () {
      expect(
        WireMappers.conversationTitle(
          {'members': [parent, member('s_2', 'staff', 'admin', null)]},
          viewerActorId: 'c_1',
        ),
        '',
      );
      expect(WireMappers.conversationTitle({'members': null}, viewerActorId: 'c_1'), '');
      expect(WireMappers.conversationTitle(const {}, viewerActorId: 'c_1'), '');
    });
  });

  group('over HTTP', () {
    late TestServer server;
    setUp(() async => server = await TestServer.start());
    tearDown(() async => server.stop());

    HttpConversationRepository repository(String viewer) => HttpConversationRepository(
          client: buildApiClient(
            config: ApiConfig(baseUrl: server.baseUrl),
            tokens: _NoTokens(),
          ),
          viewerRole: () => UserRole.teacher,
          viewerActorId: () => viewer,
        );

    test('a direct row comes back named after the other member', () async {
      server.on('GET', '/conversations', [
        Reply.ok({
          'conversations': [
            {
              'id': 'd_1',
              'type': 'direct',
              'familyId': 'f_1',
              'learnerId': null,
              'title': null,
              'state': 'open',
              'needsReply': false,
              'lastSeq': '1',
              'lastActivityAt': '2026-10-14T14:34:00.000Z',
              'archivedAt': null,
              'teacherRequiresApproval': true,
              'parentRequiresApproval': true,
              'unreadCount': 0,
              'members': [teacher, parent],
            },
          ],
        }),
      ]);

      final rows = await repository('t_1').list();
      expect(rows.single.title, 'QA Parent A');
      // Still the PD-6-era kind, and still read-only: naming it changes nothing else.
      expect(rows.single.kind, ConversationKind.teacherParentDirect);
      expect(rows.single.isReadOnly, isTrue);
    });
  });
}
