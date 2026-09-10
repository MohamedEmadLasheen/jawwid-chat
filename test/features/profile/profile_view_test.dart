import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/features/profile/domain/profile_view.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// The privacy boundary on the profile, asserted rather than assumed.
///
/// The product rule is that a teacher must never read a parent's contact file, and that it
/// must not merely be hidden in the UI. These tests check the two halves of that: the view
/// model refuses the data to the wrong audience, and — more importantly — no type in the
/// client can carry the data in the first place.
void main() {
  final now = DateTime.utc(2026, 9, 5, 12);

  Conversation groupConversation() => Conversation(
        id: 'c_group_1',
        kind: ConversationKind.studentGroup,
        title: 'أحمد · جَوِّد',
        learner: const LearnerRef(id: 'l_1', displayName: 'أحمد'),
        updatedAt: now,
        requiresApproval: true,
      );

  StudentGroup groupMembers() => const StudentGroup(
        conversationId: 'c_group_1',
        learner: LearnerRef(id: 'l_1', displayName: 'أحمد'),
        requiresApproval: true,
        members: [
          GroupMember(
            id: 'm_parent',
            displayName: 'ولي الأمر',
            role: ParticipantRole.parent,
          ),
          GroupMember(
            id: 'm_teacher',
            displayName: 'المعلم',
            role: ParticipantRole.teacher,
          ),
        ],
      );

  group('a conversation profile is always someone else', () {
    test('a teacher opening a parent-bearing group gets the "other" audience', () {
      final view = ProfileViewBuilder.forConversation(
        conversation: groupConversation(),
        viewerRole: UserRole.teacher,
        group: groupMembers(),
      );

      expect(view.audience, ProfileAudience.other);
      expect(
        view.maySeeContactFile,
        isFalse,
        reason: 'a teacher must never be offered a parent contact file',
      );
      expect(
        view.maySeeChildren,
        isFalse,
        reason: 'group membership must not become a family directory (§25)',
      );
      expect(view.children, isEmpty);
    });

    test('a parent opening a group gets the same restricted audience', () {
      // Not a special case for teachers: nobody reads anybody else's contact file.
      final view = ProfileViewBuilder.forConversation(
        conversation: groupConversation(),
        viewerRole: UserRole.parent,
        group: groupMembers(),
      );

      expect(view.audience, ProfileAudience.other);
      expect(view.maySeeContactFile, isFalse);
      expect(view.maySeeChildren, isFalse);
    });

    test('members carry name, role and avatar, and the type allows nothing else', () {
      final view = ProfileViewBuilder.forConversation(
        conversation: groupConversation(),
        viewerRole: UserRole.teacher,
        group: groupMembers(),
      );

      expect(view.members, hasLength(2));
      final teacher = view.members.firstWhere(
        (m) => m.role == ParticipantRole.teacher,
      );
      expect(teacher.displayName, 'المعلم');

      // A compile-time guarantee: ProfilePerson has exactly id/displayName/role/avatarUrl.
      // Adding a contact field would have to change this type, and this test names it.
      expect(teacher.id, isNotEmpty);
      expect(teacher.avatarUrl, isNull);
    });
  });

  group('my own account', () {
    test('a parent owns their account and may see their children', () {
      final view = ProfileViewBuilder.forOwnAccount(
        id: 'u_parent',
        displayName: 'ولي أمر',
        role: UserRole.parent,
        children: const [
          ProfileChild(
            learner: LearnerRef(id: 'l_1', displayName: 'أحمد'),
            conversationId: 'c_group_1',
            groupTitle: 'أحمد · جَوِّد',
            teacherName: 'المعلم',
          ),
        ],
      );

      expect(view.audience, ProfileAudience.owner);
      expect(view.maySeeChildren, isTrue);
      expect(view.children.single.learner.displayName, 'أحمد');
    });

    test('a teacher account lists no children even if some were passed', () {
      // Defence in depth: the caller cannot hand a teacher a family roster by mistake.
      final view = ProfileViewBuilder.forOwnAccount(
        id: 'u_teacher',
        displayName: 'معلم',
        role: UserRole.teacher,
        children: const [
          ProfileChild(
            learner: LearnerRef(id: 'l_1', displayName: 'أحمد'),
            conversationId: 'c_group_1',
          ),
        ],
      );

      expect(view.children, isEmpty);
    });

    test('the owner may see a contact file — there is simply none to see', () {
      final view = ProfileViewBuilder.forOwnAccount(
        id: 'u_parent',
        displayName: 'ولي أمر',
        role: UserRole.parent,
      );

      // The gate is open for the owner and shut for everyone else. What flows through it
      // today is nothing, because the backend holds nothing.
      expect(view.maySeeContactFile, isTrue);
    });
  });

  group('unresolved names never fall back to an id', () {
    test('a member with no display name is reported as unresolved', () {
      // Over HTTP, ConversationMemberDto carries no name (gap O3). The UI must show a role
      // word, never the actor id, which is an internal identifier.
      const person = ProfilePerson(id: 'act_9f3c', displayName: '');
      expect(person.hasResolvedName, isFalse);
    });
  });

  group('the client cannot hold contact data at all', () {
    test('no profile type declares a phone or email field', () {
      // This is the half that matters. A UI check can be bypassed by a future screen; a
      // type that has no field cannot leak one. Scanning the source keeps that true as
      // the feature grows, in the spirit of the existing directionality guard.
      final offenders = <String>[];
      final dir = Directory('lib/features/profile');

      for (final file in dir.listSync(recursive: true).whereType<File>()) {
        if (!file.path.endsWith('.dart')) continue;
        final lines = file.readAsLinesSync();
        for (var i = 0; i < lines.length; i++) {
          final line = lines[i];
          // Field or parameter declarations only — prose in doc comments explains *why*
          // these are absent and must stay allowed to say the words.
          if (line.trimLeft().startsWith('///')) continue;
          if (RegExp(
            r'\b(phone|email|msisdn|mobile|whatsapp|address)\w*\s*[,;=)]',
            caseSensitive: false,
          ).hasMatch(line)) {
            offenders.add('${file.path}:${i + 1}  ${line.trim()}');
          }
        }
      }

      expect(
        offenders,
        isEmpty,
        reason: 'The profile feature must not model contact data. The backend holds none '
            'and the privacy guarantee is that the client cannot leak what it never '
            'holds.\n${offenders.join('\n')}',
      );
    });
  });
}
