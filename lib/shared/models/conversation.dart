/// The kinds of conversation this client can render.
///
/// There is deliberately no "direct chat with a teacher/parent" kind — the type system itself
/// refuses to represent the forbidden channel (§4).
enum ConversationKind {
  /// The family's single continuous support thread. Exactly one per family, and its identity
  /// survives a change of handling admin (§12).
  jawwidSupport,

  /// The official per-learner channel where a parent and teacher may speak (§24).
  studentGroup,

  /// A 1:1 with Jawwid staff. Available to both parents and teachers.
  adminDirect;

  static ConversationKind parse(String? raw) => switch (raw) {
        'jawwid_support' => ConversationKind.jawwidSupport,
        'student_group' => ConversationKind.studentGroup,
        'admin_direct' => ConversationKind.adminDirect,
        _ => ConversationKind.adminDirect,
      };
}

/// The learner a student group belongs to, used to group rows under each child (§11).
class LearnerRef {
  const LearnerRef({required this.id, required this.displayName, this.avatarUrl});

  final String id;
  final String displayName;
  final String? avatarUrl;
}

class Conversation {
  const Conversation({
    required this.id,
    required this.kind,
    required this.title,
    required this.updatedAt,
    this.avatarUrl,
    this.learner,
    this.lastMessagePreview = '',
    this.lastMessageAt,
    this.unreadCount = 0,
    this.isPinned = false,
    this.isMuted = false,
    this.isArchived = false,
    this.handledByLabel,
    this.requiresApproval = false,
    this.isReadOnly = false,
  });

  final String id;
  final ConversationKind kind;
  final String title;
  final String? avatarUrl;

  /// Set for [ConversationKind.studentGroup].
  final LearnerRef? learner;

  final String lastMessagePreview;
  final DateTime? lastMessageAt;
  final DateTime updatedAt;
  final int unreadCount;

  /// Per-user preferences — never shared between users (§42).
  final bool isPinned;
  final bool isMuted;
  final bool isArchived;

  /// Who is currently handling the support thread, e.g. "Handled by Dina".
  ///
  /// Supplied verbatim by the backend; the client never derives it and never shows an
  /// internal handler id (§12, decision D3).
  final String? handledByLabel;

  /// Whether messages sent here enter the approval flow (§26). Backend-supplied policy.
  final bool requiresApproval;

  /// Composer disabled — e.g. the user was removed from the group, or it was archived
  /// server-side (§72).
  final bool isReadOnly;

  bool get hasUnread => unreadCount > 0;

  Conversation copyWith({
    bool? isPinned,
    bool? isMuted,
    bool? isArchived,
    int? unreadCount,
  }) {
    return Conversation(
      id: id,
      kind: kind,
      title: title,
      avatarUrl: avatarUrl,
      learner: learner,
      lastMessagePreview: lastMessagePreview,
      lastMessageAt: lastMessageAt,
      updatedAt: updatedAt,
      unreadCount: unreadCount ?? this.unreadCount,
      isPinned: isPinned ?? this.isPinned,
      isMuted: isMuted ?? this.isMuted,
      isArchived: isArchived ?? this.isArchived,
      handledByLabel: handledByLabel,
      requiresApproval: requiresApproval,
      isReadOnly: isReadOnly,
    );
  }
}
