import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_group_repository.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
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

/// Conversation members, read off a REAL HTTP response (gap O3).
///
/// The server used to send no `members` at all on `GET /conversations/:id` — not
/// nameless ones, none — so the member sheet was empty and a teacher had no way
/// to name the parent they are authorized to speak to. Both halves of that are
/// now closed, and this drives the real repository against a real socket so the
/// only place a name can come from is the JSON.
///
/// No widget binding here, deliberately: `TestWidgetsFlutterBinding` installs an
/// `HttpOverrides` that answers every real request with a 400, so a widget test
/// cannot also be a network test.
void main() {
  late TestServer server;

  setUp(() async => server = await TestServer.start());
  tearDown(() async => server.stop());

  HttpGroupRepository repository() => HttpGroupRepository(
        client: buildApiClient(
          config: ApiConfig(baseUrl: server.baseUrl),
          tokens: _NoTokens(),
        ),
      );

  Map<String, Object?> member(
    String actorId,
    String actorKind,
    String memberRole,
    Object? displayName, {
    Object? canOpenDirect,
  }) =>
      {
        'actorId': actorId,
        'actorKind': actorKind,
        'memberRole': memberRole,
        'isSilent': false,
        'displayName': displayName,
        'canOpenDirect': ?canOpenDirect,
      };

  test('maps every member, with the display name off the wire', () async {
    server.on('GET', '/conversations/c1', [
      Reply.ok({
        'id': 'c1',
        'type': 'student_group',
        'title': 'Yusuf · Jawwid',
        'learnerId': 'l1',
        'teacherRequiresApproval': true,
        'parentRequiresApproval': false,
        'members': [
          member('p1', 'contact', 'parent', 'Umm Yusuf'),
          member('t1', 'teacher', 'teacher', 'Ustadh Kareem'),
          member('a1', 'staff', 'admin', 'Jawwid Support'),
        ],
      }),
    ]);

    final group = await repository().group('c1');

    expect(group.members.map((m) => m.displayName), [
      'Umm Yusuf',
      'Ustadh Kareem',
      'Jawwid Support',
    ]);
    expect(group.members.map((m) => m.id), ['p1', 't1', 'a1']);
    expect(group.members.map((m) => m.role), [
      ParticipantRole.parent,
      ParticipantRole.teacher,
      ParticipantRole.admin,
    ]);
  });

  test('an unresolvable member is empty, never an id', () async {
    // A membership row outlives the actor it names (BR-5), so the server sends
    // '' — and the UI renders that as `groupMemberUnresolved`. Showing the uuid
    // instead would put an internal identifier in front of a parent.
    server.on('GET', '/conversations/c1', [
      Reply.ok({
        'id': 'c1',
        'type': 'student_group',
        'members': [member('ghost-uuid', 'staff', 'observer', '')],
      }),
    ]);

    final group = await repository().group('c1');

    expect(group.members.single.displayName, '');
    expect(group.members.single.displayName, isNot('ghost-uuid'));
  });

  test('a missing or blank name is treated as unresolved, not as whitespace',
      () async {
    server.on('GET', '/conversations/c1', [
      Reply.ok({
        'id': 'c1',
        'type': 'student_group',
        'members': [
          member('m1', 'contact', 'parent', null),
          member('m2', 'contact', 'parent', '   '),
        ],
      }),
    ]);

    final group = await repository().group('c1');

    expect(group.members.map((m) => m.displayName), ['', '']);
  });

  test('a conversation with no members yields an empty list, not a failure',
      () async {
    // The list route deliberately omits `members`, and a detail response for a
    // conversation whose membership has not loaded must not read as an error.
    server.on('GET', '/conversations/c1', [
      const Reply.ok({'id': 'c1', 'type': 'direct'}),
    ]);

    final group = await repository().group('c1');

    expect(group.members, isEmpty);
  });

  /// PD-6. `canOpenDirect` is the server's advisory, and the client must take it
  /// from the wire rather than infer it: whether a teacher may open a channel
  /// with a parent depends on a relationship this client is never told.
  test('reads canOpenDirect off the wire, per member', () async {
    server.on('GET', '/conversations/c1', [
      Reply.ok({
        'id': 'c1',
        'type': 'student_group',
        'title': 'Yusuf · Jawwid',
        'learnerId': 'l1',
        'teacherRequiresApproval': true,
        'parentRequiresApproval': false,
        'members': [
          member('p1', 'contact', 'parent', 'Umm Yusuf', canOpenDirect: true),
          member('p2', 'contact', 'parent', 'Abu Yusuf', canOpenDirect: false),
          member('a1', 'staff', 'admin', 'Jawwid Support', canOpenDirect: true),
        ],
      }),
    ]);

    final group = await repository().group('c1');

    expect(
      {for (final m in group.members) m.id: m.canOpenDirect},
      {'p1': true, 'p2': false, 'a1': true},
    );
  });

  /// Fails closed on every shape that is not a literal `true`. An advisory that
  /// defaulted to "you may" would offer actions the server then refuses, and a
  /// truthy-string would make a stray `"false"` read as permission.
  test('a missing or non-boolean canOpenDirect is false', () async {
    server.on('GET', '/conversations/c1', [
      Reply.ok({
        'id': 'c1',
        'type': 'student_group',
        'title': 'Yusuf · Jawwid',
        'learnerId': 'l1',
        'teacherRequiresApproval': true,
        'parentRequiresApproval': false,
        'members': [
          member('p1', 'contact', 'parent', 'Umm Yusuf'),
          member('p2', 'contact', 'parent', 'Abu Yusuf', canOpenDirect: 'true'),
          member('p3', 'contact', 'parent', 'Khala', canOpenDirect: 1),
          member('p4', 'contact', 'parent', 'Amm', canOpenDirect: null),
        ],
      }),
    ]);

    final group = await repository().group('c1');

    expect(
      group.members.where((m) => m.canOpenDirect),
      isEmpty,
    );
  });
}
