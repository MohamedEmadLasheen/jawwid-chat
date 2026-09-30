import '../../../shared/models/conversation.dart';
import '../../../shared/models/user_role.dart';

/// One rendered section of the chat list.
class ConversationSection {
  const ConversationSection({
    required this.key,
    required this.conversations,
    this.learner,
  });

  /// Stable identifier: `'primary'`, `'staff'`, or `'learner:<id>'`. The visible heading is
  /// resolved through localisation at render time, never stored here (§46).
  final String key;

  /// Set when this section groups a child's conversations, so the heading can show the
  /// child's name.
  final LearnerRef? learner;

  final List<Conversation> conversations;

  bool get isEmpty => conversations.isEmpty;
}

/// Arranges conversations into the sectioned chat list.
///
/// Parent layout (§11): the Jawwid support thread is pinned to the very top, then each
/// child's student groups under that child's name, then any remaining staff conversations.
///
/// Teacher layout (§13): assigned student groups, then admin conversations. A teacher is
/// never grouped by child in a way that would read as a family directory (§25).
abstract final class ConversationListBuilder {
  static List<ConversationSection> build({
    required UserRole role,
    required List<Conversation> conversations,
    bool includeArchived = false,
  }) {
    final visible = conversations
        .where((c) => includeArchived || !c.isArchived)
        .toList(growable: false);

    return switch (role) {
      UserRole.parent => _buildForParent(visible),
      UserRole.teacher => _buildForTeacher(visible),
    };
  }

  static List<ConversationSection> _buildForParent(List<Conversation> all) {
    final support = all
        .where((c) => c.kind == ConversationKind.jawwidSupport)
        .toList()
      ..sort(_byRecency);

    final groups =
        all.where((c) => c.kind == ConversationKind.studentGroup).toList();

    // PD-6: every 1:1 shape, not only adminDirect. Testing `== adminDirect`
    // here would make an authorized parent<->teacher chat vanish from the list
    // entirely, which is a worse failure than showing it in the wrong section.
    final staff = all.where((c) => c.kind.isDirect).toList()..sort(_byRecency);

    final sections = <ConversationSection>[];

    if (support.isNotEmpty) {
      sections.add(ConversationSection(key: 'primary', conversations: support));
    }

    // Group by child, ordered by each child's most recent activity so the family member who
    // needs attention surfaces first.
    final byLearner = <String, List<Conversation>>{};
    final learners = <String, LearnerRef>{};

    for (final conversation in groups) {
      final learner = conversation.learner;
      if (learner == null) continue;
      byLearner.putIfAbsent(learner.id, () => []).add(conversation);
      learners[learner.id] = learner;
    }

    final learnerIds = byLearner.keys.toList()
      ..sort((a, b) {
        final left = _mostRecent(byLearner[a]!);
        final right = _mostRecent(byLearner[b]!);
        return right.compareTo(left);
      });

    for (final id in learnerIds) {
      final forLearner = byLearner[id]!..sort(_byRecency);
      sections.add(
        ConversationSection(
          key: 'learner:$id',
          learner: learners[id],
          conversations: forLearner,
        ),
      );
    }

    if (staff.isNotEmpty) {
      sections.add(ConversationSection(key: 'staff', conversations: staff));
    }

    return List.unmodifiable(sections);
  }

  static List<ConversationSection> _buildForTeacher(List<Conversation> all) {
    final groups = all
        .where((c) => c.kind == ConversationKind.studentGroup)
        .toList()
      ..sort(_byRecency);

    // PD-6: see the note in _buildForParent.
    final staff = all.where((c) => c.kind.isDirect).toList()..sort(_byRecency);

    return List.unmodifiable([
      if (groups.isNotEmpty)
        ConversationSection(key: 'primary', conversations: groups),
      if (staff.isNotEmpty)
        ConversationSection(key: 'staff', conversations: staff),
    ]);
  }

  /// Pinned first, then most recent activity, then title for a stable order.
  static int _byRecency(Conversation a, Conversation b) {
    if (a.isPinned != b.isPinned) return a.isPinned ? -1 : 1;

    final left = a.lastMessageAt ?? a.updatedAt;
    final right = b.lastMessageAt ?? b.updatedAt;
    final byTime = right.compareTo(left);
    if (byTime != 0) return byTime;

    return a.title.compareTo(b.title);
  }

  static DateTime _mostRecent(List<Conversation> conversations) {
    return conversations
        .map((c) => c.lastMessageAt ?? c.updatedAt)
        .reduce((a, b) => a.isAfter(b) ? a : b);
  }
}
