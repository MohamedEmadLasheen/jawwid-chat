import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/http/http_conversation_repository.dart';
import 'package:jawwid_chat/core/data/http/http_group_repository.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';
import 'package:jawwid_chat/features/moderation/application/direct_counterpart.dart';
import 'package:jawwid_chat/features/moderation/presentation/report_sheet.dart';
import 'package:jawwid_chat/features/profile/domain/profile_view.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import 'test_server.dart';

class _StaticToken implements TokenProvider {
  @override
  Future<String?> accessToken() async => 'access-token-value';

  @override
  Future<String?> refresh() async => null;

  @override
  Future<void> onSessionEnded(AppError error) async {}
}

/// PD-57 (#464 fix): the one-to-one profile's person, resolved over the real HTTP transport
/// from `GET /conversations/:id` members -- the actor id and kind of the OTHER member, never
/// the conversation id; nothing for a group, the official conversation, an unclear member
/// list or a failure. (Kept apart from the widget tests: a `testWidgets` in the same file
/// installs flutter_test's HTTP stub, which answers every real request with 400.)
void main() {
  group('the counterpart over HTTP', () {
    late TestServer server;

    setUp(() async => server = await TestServer.start());
    tearDown(() async => server.stop());

    Map<String, Object?> dto({String type = 'direct', required List<Map<String, Object?>> members}) => {
      'id': 'c1',
      'type': type,
      'title': 'Ustadh Kareem',
      'state': 'open',
      'needsReply': false,
      'lastSeq': '3',
      'lastActivityAt': '2026-11-01T12:00:00.000Z',
      'archivedAt': null,
      'teacherRequiresApproval': false,
      'parentRequiresApproval': false,
      'members': members,
    };

    const me = {'actorId': 'me', 'actorKind': 'contact', 'memberRole': 'parent', 'isSilent': false};
    const teacher = {
      'actorId': 't9',
      'actorKind': 'teacher',
      'memberRole': 'teacher',
      'isSilent': false,
      'displayName': 'Ustadh Kareem',
    };
    const staff = {'actorId': 's1', 'actorKind': 'staff', 'memberRole': 'admin', 'isSilent': false};

    Future<ProfilePerson?> resolve(Reply reply) async {
      server.on('GET', '/conversations/c1', [reply]);
      final ApiClient client = buildApiClient(
        config: ApiConfig(baseUrl: server.baseUrl),
        tokens: _StaticToken(),
      );
      final container = ProviderContainer(
        overrides: [
          principalIdProvider.overrideWithValue('me'),
          conversationRepositoryProvider.overrideWithValue(
            HttpConversationRepository(client: client, viewerRole: () => UserRole.parent, viewerActorId: () => 'me'),
          ),
          groupRepositoryProvider.overrideWithValue(HttpGroupRepository(client: client)),
        ],
      );
      addTearDown(container.dispose);
      final sub = container.listen(directCounterpartProvider('c1'), (_, _) {});
      addTearDown(sub.close);
      return container.read(directCounterpartProvider('c1').future);
    }

    test('a direct conversation answers the other member: their actor id and kind, not the conversation', () async {
      final person = await resolve(Reply.ok(dto(members: [me, teacher])));

      expect(person, isNotNull);
      expect(person!.id, 't9');
      expect(person.id, isNot('c1'));
      expect(reportActorKind(person.role), 'teacher');
      expect(person.displayName, 'Ustadh Kareem');
      expect(server.requests.every((r) => r.path == '/conversations/c1'), isTrue);
    });

    test('a staff counterpart reports as staff', () async {
      final person = await resolve(Reply.ok(dto(members: [me, staff])));
      expect((person?.id, reportActorKind(person?.role)), ('s1', 'staff'));
    });

    test('never the academy\'s official conversation', () async {
      expect(await resolve(Reply.ok(dto(type: 'official', members: [me, staff]))), isNull);
    });

    test('never a group', () async {
      expect(await resolve(Reply.ok(dto(type: 'student_group', members: [me, teacher, staff]))), isNull);
    });

    test('nothing unless exactly one other member is listed', () async {
      expect(await resolve(Reply.ok(dto(members: [me]))), isNull);
      expect(await resolve(Reply.ok(dto(members: const []))), isNull);
    });

    test('nothing on a failure', () async {
      expect(await resolve(Reply.commError(500, 'COMMON.INTERNAL')), isNull);
    });
  });
}
