/// The kinds of conversation this client can render.
///
/// PD-6 (2026-09-23) added [teacherParentDirect]. An earlier revision of this file said
/// "there is deliberately no 'direct chat with a teacher/parent' kind — the type system
/// itself refuses to represent the forbidden channel". That channel is no longer forbidden
/// when the server authorizes the relationship, so the type must now be able to name it.
///
/// This enum is **presentation and domain mapping only**. It never grants anything: the
/// server decides who may speak to whom and refuses anything else with
/// `COMM.TEACHER_PARENT_NOT_AUTHORIZED`, whatever this client believes a row to be.
enum ConversationKind {
  /// The family's single continuous support thread. Exactly one per family, and its identity
  /// survives a change of handling admin (§12).
  jawwidSupport,

  /// The official per-learner channel where a parent and teacher may speak (§24).
  studentGroup,

  /// A 1:1 with Jawwid staff. Available to both parents and teachers.
  adminDirect,

  /// A 1:1 between a parent and a teacher the server has authorized (PD-6).
  ///
  /// Only ever produced when the payload actually says so — exactly one `contact` member
  /// and exactly one `teacher` member. It is never inferred from the conversation type,
  /// from a title, or from an id.
  teacherParentDirect,

  /// A direct conversation whose participants could not be established.
  ///
  /// The honest answer when the payload carries no members (the list endpoint does not send
  /// them, by contract) or carries a set this client does not recognise. It groups and
  /// renders exactly like [adminDirect]; what it must never do is stand in for
  /// [teacherParentDirect], because that is the one classification a wrong guess could turn
  /// into an affordance the relationship does not support.
  unknownDirect;

  /// True for every 1:1 shape, known or not.
  ///
  /// List grouping and filtering must use this rather than testing `== adminDirect`: a new
  /// member of this enum that no filter recognises makes conversations silently vanish from
  /// the chat list, which is a worse failure than mislabelling one.
  bool get isDirect =>
      this == ConversationKind.adminDirect ||
      this == ConversationKind.teacherParentDirect ||
      this == ConversationKind.unknownDirect;

  static ConversationKind parse(String? raw) => switch (raw) {
        'jawwid_support' => ConversationKind.jawwidSupport,
        'student_group' => ConversationKind.studentGroup,
        'admin_direct' => ConversationKind.adminDirect,
        'teacher_parent_direct' => ConversationKind.teacherParentDirect,
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
