import 'message.dart';
import 'system_event.dart';

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

/// The other party in a 1:1, resolved by the backend from actual membership.
///
/// A direct conversation has no title — it is not a room somebody named — so
/// before this existed the chat list drew a blank name and a placeholder
/// avatar, and the chat header showed nothing at all. The name is a property of
/// the OTHER MEMBER and only the server can resolve it, so the server does, per
/// caller. Null on a group, where the title and learner already identify it.
class ConversationCounterpart {
  const ConversationCounterpart({
    required this.id,
    required this.displayName,
    this.avatarUrl,
  });

  final String id;

  /// Empty when the backend could not resolve the principal. The UI treats that
  /// as unresolved and must never fall back to the id (§25).
  final String displayName;
  final String? avatarUrl;
}

/// The last message in a conversation, as a list row needs it.
///
/// A row cannot simply quote a body: a voice note has none, and a system
/// message's body is a payload. So the KIND travels with the text and the words
/// are chosen at render time, in the reader's language.
class MessagePreview {
  const MessagePreview({
    required this.kind,
    required this.at,
    this.text,
    this.systemEvent,
    this.authorName,
    this.isMine = false,
  });

  final MessageKind kind;
  final DateTime at;

  /// Present only for a text message; null for every other kind.
  final String? text;

  /// Present only for a system message.
  final SystemEvent? systemEvent;

  /// Null when unresolved. Never an actor id.
  final String? authorName;

  /// Whether the signed-in user wrote it, so the row can say "You:".
  final bool isMine;
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
    this.counterpart,
    this.lastMessage,
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

  /// Set for a 1:1. The only thing that can name one.
  final ConversationCounterpart? counterpart;

  /// What the list row shows, or null for a conversation with nothing in it.
  final MessagePreview? lastMessage;
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

  /// Whether THIS viewer's next message enters the approval flow (§26).
  ///
  /// Server-derived, and deliberately not computed here. The client used to
  /// decide it by OR-ing the conversation's two stored policy flags, which told
  /// a parent their messages were reviewed whenever the TEACHER's were, and
  /// showed the notice on 1:1 conversations where approval has never applied.
  /// The backend now answers it with the same function that decides the
  /// moderation a message is actually stored with, so the notice and the
  /// behaviour cannot disagree.
  final bool requiresApproval;

  /// Composer disabled — e.g. the user was removed from the group, or it was archived
  /// server-side (§72).
  final bool isReadOnly;

  bool get hasUnread => unreadCount > 0;

  /// The name to render: the room's own title, or the other person's.
  ///
  /// Exactly one of the two is meaningful for any given conversation, so this
  /// is the only place either is read for display. Empty means genuinely
  /// unresolved, which the UI shows as such rather than as a placeholder
  /// standing in for a name nobody has.
  String get displayTitle {
    final own = title.trim();
    if (own.isNotEmpty) return own;
    return counterpart?.displayName.trim() ?? '';
  }

  /// The avatar to render, from whichever side of the conversation has one.
  String? get displayAvatarUrl => avatarUrl ?? counterpart?.avatarUrl;

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
      counterpart: counterpart,
      lastMessage: lastMessage,
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
