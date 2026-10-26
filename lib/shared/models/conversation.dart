/// The kinds of conversation this client can render.
///
/// PD-6 (2026-09-23) added [teacherParentDirect]. PD-7 (2026-10-14) forbids creating that
/// channel again (BR-1), but the conversations PD-6 created still exist and stay readable,
/// so the type must still be able to name them — read-only (`wire_mappers.dart`).
///
/// This enum is **presentation and domain mapping only**. It never grants anything: the
/// server decides who may speak to whom and refuses anything else (a teacher<->parent
/// direct with `COMM.BR1_TEACHER_PARENT_DIRECT`), whatever this client believes a row to be.
enum ConversationKind {
  /// The family's single continuous support thread. Exactly one per family, and its identity
  /// survives a change of handling admin (§12).
  jawwidSupport,

  /// The official per-learner channel where a parent and teacher may speak (§24).
  studentGroup,

  /// A 1:1 with Jawwid staff. Available to both parents and teachers.
  adminDirect,

  /// A 1:1 between a parent and a teacher created under PD-6 (2026-09-23 to
  /// 2026-10-14). Read-only since PD-7: history, no new messages, calls or reactions.
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

/// PD-33: the supervisor here is away and a backup covers for them until [until]
/// ("Amira is covering for Noura until 3 Nov"). Straight from the server's
/// `cover`; the client never works it out.
class ConversationCover {
  const ConversationCover({required this.supervisorName, required this.coverName, required this.until});

  final String supervisorName;
  final String coverName;
  final DateTime until;
}

/// PD-30: a family / student group locked for payment, as `GET /conversations/:id`
/// describes it to THIS viewer (`paymentLock`). Null when nothing is locked, when
/// enforcement is off, or from a server that predates PD-30.
///
/// ADVISORY. The server refuses every send, reaction and call on its own
/// (`COMM.SUBSCRIPTION_LOCKED`); this only decides what the screen draws.
class PaymentLock {
  const PaymentLock({required this.readOnly, required this.canPay, this.children = const []});

  /// The viewer's: a parent and a teacher may not write; staff still may.
  final bool readOnly;

  /// A parent: offer the way to Subscriptions.
  final bool canPay;

  /// Each locked child. A teacher's carry no reasons (nothing financial).
  final List<LockedChild> children;
}

/// One child whose lessons are paused.
class LockedChild {
  const LockedChild({
    required this.id,
    required this.name,
    this.reasons = const [],
    this.overdueLabel,
    this.overdueDueDate,
  });

  final String id;
  final String name;

  /// `balance` / `overdue`; empty for a teacher.
  final List<String> reasons;
  final String? overdueLabel;

  /// The instalment's due day; it is overdue from the day after.
  final DateTime? overdueDueDate;
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
    this.lastMessageKind,
    this.lastMessageAt,
    this.unreadCount = 0,
    this.isPinned = false,
    this.isMuted = false,
    this.isArchived = false,
    this.handledByLabel,
    this.requiresApproval = false,
    this.isReadOnly = false,
    this.isTeacherSupervision = false,
    this.isTrialGroup = false,
    this.namedByServer = false,
    this.themeKey,
    this.wallpaperUrl,
    this.cover,
    this.paymentLock,
  });

  final String id;
  final ConversationKind kind;
  final String title;
  final String? avatarUrl;

  /// Set for [ConversationKind.studentGroup].
  final LearnerRef? learner;

  final String lastMessagePreview;

  /// What the last message is when it has no text to preview: `image`, `video`,
  /// `voice`, `file`, `deleted`, or `system:<kind>`. Null when there is none, or
  /// when [lastMessagePreview] carries its text. The tile words it (§ preview).
  final String? lastMessageKind;
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

  /// PD-12: the teacher's private conversation with the Teachers department. It groups
  /// and behaves like a 1:1 with Jawwid ([ConversationKind.adminDirect]); this flag only
  /// gives it its own name and its own tickets under "+". Taken from the server's type,
  /// never inferred from a title.
  final bool isTeacherSupervision;

  /// PD-11 T4: the teacher's staff-only group with Sales about their trial lessons. Like
  /// the supervision conversation it has its own name and its own "+" (the trial report).
  /// Taken from the server's type, never inferred from a title.
  final bool isTrialGroup;

  /// PD-20: shown under the server's title even when it is a trial group. A teacher has
  /// one trial group and reads it as "Trial lessons"; Sales sees one per teacher, and
  /// only the server's title (the teacher's name) tells them apart.
  final bool namedByServer;

  /// The viewer's OWN background preset for this chat (owner decisions
  /// 2026-10-20: private, synced). Null is the default look.
  final String? themeKey;

  /// The viewer's OWN wallpaper photo for this chat, a link signed for them.
  final String? wallpaperUrl;

  /// PD-33: who covers for the away supervisor here, and until when; null when nobody.
  final ConversationCover? cover;
  /// PD-30: the group is locked for payment (only `GET /conversations/:id` says so).
  final PaymentLock? paymentLock;

  bool get hasUnread => unreadCount > 0;

  /// The name to show: the server's title, except for a supervision conversation, which
  /// the teacher reads under its own localized name ([supervisionLabel]).
  String displayTitle(String supervisionLabel, {String? trialGroupLabel}) => isTeacherSupervision
      ? supervisionLabel
      : isTrialGroup && trialGroupLabel != null && !namedByServer
          ? trialGroupLabel
          : title;

  Conversation copyWith({
    bool? isPinned,
    bool? isMuted,
    bool? isArchived,
    int? unreadCount,
    String? themeKey,
    String? wallpaperUrl,
  }) {
    return Conversation(
      id: id,
      kind: kind,
      title: title,
      avatarUrl: avatarUrl,
      learner: learner,
      lastMessagePreview: lastMessagePreview,
      lastMessageKind: lastMessageKind,
      lastMessageAt: lastMessageAt,
      updatedAt: updatedAt,
      unreadCount: unreadCount ?? this.unreadCount,
      isPinned: isPinned ?? this.isPinned,
      isMuted: isMuted ?? this.isMuted,
      isArchived: isArchived ?? this.isArchived,
      handledByLabel: handledByLabel,
      requiresApproval: requiresApproval,
      isReadOnly: isReadOnly,
      isTeacherSupervision: isTeacherSupervision,
      isTrialGroup: isTrialGroup,
      namedByServer: namedByServer,
      themeKey: themeKey ?? this.themeKey,
      wallpaperUrl: wallpaperUrl ?? this.wallpaperUrl,
      cover: cover,
      paymentLock: paymentLock,
    );
  }
}
