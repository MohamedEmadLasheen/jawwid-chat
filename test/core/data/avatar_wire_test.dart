import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/wire/wire_mappers.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// Profile photos arrive as signed links on the chat payloads (2026-10-19):
/// `MessageDto.authorAvatarUrl`, `ConversationMemberDto.avatarUrl` and
/// `ConversationLearnerDto.avatarUrl`. The client never builds one.
void main() {
  const signed = 'https://api.test/api/v1/media/avatars/staff.s1.c1?v=o&a=me&e=1&s=x&k=ab';

  test("a message carries its author's photo; absent or blank stays null", () {
    final withPhoto = WireMappers.message(
      {'id': 'm1', 'authorId': 's1', 'authorKind': 'staff', 'type': 'text', 'createdAt': '2026-10-19T10:00:00Z', 'authorAvatarUrl': signed},
      viewerActorId: 'me',
    );
    expect(withPhoto.authorAvatarUrl, signed);
    final blank = WireMappers.message(
      {'id': 'm2', 'authorId': 's1', 'authorKind': 'staff', 'type': 'text', 'createdAt': '2026-10-19T10:00:00Z', 'authorAvatarUrl': ''},
      viewerActorId: 'me',
    );
    expect(blank.authorAvatarUrl, isNull);
    // A copy keeps it (e.g. when the send response is re-keyed to our client id).
    expect(withPhoto.withClientMessageId('local').authorAvatarUrl, signed);
    expect(withPhoto.copyWith(isDeleted: true).authorAvatarUrl, signed);
  });

  test('a member carries their photo', () {
    final member = WireMappers.groupMember({'actorId': 't1', 'displayName': 'T', 'memberRole': 'teacher', 'avatarUrl': signed});
    expect(member.avatarUrl, signed);
  });

  test("a 1:1 is pictured by the other person; a child's group by the child", () {
    final direct = WireMappers.conversation(
      {
        'id': 'c1',
        'type': 'direct',
        'lastActivityAt': '2026-10-19T10:00:00Z',
        'members': [
          {'actorId': 'me', 'actorKind': 'contact', 'memberRole': 'parent', 'avatarUrl': 'https://x/me'},
          {'actorId': 's1', 'actorKind': 'staff', 'memberRole': 'admin', 'avatarUrl': signed},
        ],
      },
      viewerRole: UserRole.parent,
      viewerActorId: 'me',
    );
    expect(direct.avatarUrl, signed);

    final group = WireMappers.conversation(
      {
        'id': 'g1',
        'type': 'student_group',
        'lastActivityAt': '2026-10-19T10:00:00Z',
        'learner': {'id': 'l1', 'name': 'Kid', 'avatarUrl': 'https://x/kid'},
      },
      viewerRole: UserRole.parent,
      viewerActorId: 'me',
    );
    expect(group.avatarUrl, 'https://x/kid');
    expect(group.learner?.avatarUrl, 'https://x/kid');
  });

  test('a family group, which names no learner on its row, is pictured by its one child', () {
    final family = WireMappers.conversation(
      {'id': 'f1', 'type': 'family_group', 'lastActivityAt': '2026-10-19T10:00:00Z', 'avatarUrl': 'https://x/only-child'},
      viewerRole: UserRole.parent,
      viewerActorId: 'me',
    );
    expect(family.avatarUrl, 'https://x/only-child');
  });
}
