import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/features/conversations/domain/conversation_list.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

void main() {
  final t0 = DateTime.utc(2026, 9, 5, 12);

  Conversation conv({
    required String id,
    required ConversationKind kind,
    String title = 'untitled',
    LearnerRef? learner,
    int minutesAgo = 0,
    bool pinned = false,
    bool archived = false,
  }) {
    final at = t0.subtract(Duration(minutes: minutesAgo));
    return Conversation(
      id: id,
      kind: kind,
      title: title,
      learner: learner,
      updatedAt: at,
      lastMessageAt: at,
      isPinned: pinned,
      isArchived: archived,
    );
  }

  const ahmed = LearnerRef(id: 'l_ahmed', displayName: 'أحمد');
  const mariam = LearnerRef(id: 'l_mariam', displayName: 'مريم');

  group('parent layout', () {
    test('the Jawwid support thread leads the list', () {
      final sections = ConversationListBuilder.build(
        role: UserRole.parent,
        conversations: [
          conv(
            id: 'g1',
            kind: ConversationKind.studentGroup,
            learner: ahmed,
            minutesAgo: 1,
          ),
          conv(id: 'support', kind: ConversationKind.jawwidSupport, minutesAgo: 500),
        ],
      );

      expect(sections.first.key, 'primary');
      expect(sections.first.conversations.single.id, 'support');
    });

    test('student groups are grouped under each child', () {
      final sections = ConversationListBuilder.build(
        role: UserRole.parent,
        conversations: [
          conv(id: 'g_ahmed', kind: ConversationKind.studentGroup, learner: ahmed, minutesAgo: 10),
          conv(id: 'g_mariam', kind: ConversationKind.studentGroup, learner: mariam, minutesAgo: 5),
        ],
      );

      expect(sections.map((s) => s.key), ['learner:l_mariam', 'learner:l_ahmed']);
      expect(sections.first.learner?.displayName, 'مريم');
    });

    test('the child with the most recent activity is listed first', () {
      final sections = ConversationListBuilder.build(
        role: UserRole.parent,
        conversations: [
          conv(id: 'a1', kind: ConversationKind.studentGroup, learner: ahmed, minutesAgo: 60),
          conv(id: 'm1', kind: ConversationKind.studentGroup, learner: mariam, minutesAgo: 90),
          conv(id: 'a2', kind: ConversationKind.studentGroup, learner: ahmed, minutesAgo: 2),
        ],
      );

      expect(sections.first.key, 'learner:l_ahmed');
    });

    test('staff conversations come last', () {
      final sections = ConversationListBuilder.build(
        role: UserRole.parent,
        conversations: [
          conv(id: 'admin', kind: ConversationKind.adminDirect, minutesAgo: 1),
          conv(id: 'support', kind: ConversationKind.jawwidSupport, minutesAgo: 100),
        ],
      );

      expect(sections.last.key, 'staff');
    });
  });

  group('teacher layout', () {
    test('assigned groups lead, admin conversations follow', () {
      final sections = ConversationListBuilder.build(
        role: UserRole.teacher,
        conversations: [
          conv(id: 'admin', kind: ConversationKind.adminDirect, minutesAgo: 1),
          conv(id: 'g1', kind: ConversationKind.studentGroup, learner: ahmed, minutesAgo: 50),
        ],
      );

      expect(sections.map((s) => s.key), ['primary', 'staff']);
      expect(sections.first.conversations.single.id, 'g1');
    });

    test('a teacher list is never grouped per child', () {
      // §25: group membership must not read as a family directory.
      final sections = ConversationListBuilder.build(
        role: UserRole.teacher,
        conversations: [
          conv(id: 'g1', kind: ConversationKind.studentGroup, learner: ahmed),
          conv(id: 'g2', kind: ConversationKind.studentGroup, learner: mariam),
        ],
      );

      expect(sections.single.key, 'primary');
      expect(sections.single.conversations, hasLength(2));
      expect(sections.any((s) => s.key.startsWith('learner:')), isFalse);
    });
  });

  group('ordering and filtering', () {
    test('pinned conversations sort above more recent unpinned ones', () {
      final sections = ConversationListBuilder.build(
        role: UserRole.teacher,
        conversations: [
          conv(id: 'recent', kind: ConversationKind.studentGroup, learner: ahmed, minutesAgo: 1),
          conv(
            id: 'pinned',
            kind: ConversationKind.studentGroup,
            learner: ahmed,
            minutesAgo: 999,
            pinned: true,
          ),
        ],
      );

      expect(sections.first.conversations.first.id, 'pinned');
    });

    test('archived conversations are hidden by default and shown on request', () {
      final conversations = [
        conv(id: 'g1', kind: ConversationKind.studentGroup, learner: ahmed),
        conv(id: 'old', kind: ConversationKind.studentGroup, learner: ahmed, archived: true),
      ];

      final hidden = ConversationListBuilder.build(
        role: UserRole.teacher,
        conversations: conversations,
      );
      expect(hidden.single.conversations.map((c) => c.id), ['g1']);

      final shown = ConversationListBuilder.build(
        role: UserRole.teacher,
        conversations: conversations,
        includeArchived: true,
      );
      expect(shown.single.conversations, hasLength(2));
    });

    test('an empty input produces no sections rather than empty ones', () {
      expect(
        ConversationListBuilder.build(role: UserRole.parent, conversations: []),
        isEmpty,
      );
    });

    test('a student group with no learner is not dropped into a phantom section', () {
      final sections = ConversationListBuilder.build(
        role: UserRole.parent,
        conversations: [conv(id: 'orphan', kind: ConversationKind.studentGroup)],
      );

      expect(sections.any((s) => s.key.startsWith('learner:')), isFalse);
    });
  });
}
