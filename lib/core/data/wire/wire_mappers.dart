import '../../../shared/models/conversation.dart';
import '../../../shared/models/message.dart';
import '../../../shared/models/notification.dart';
import '../../../shared/models/user_role.dart';
import '../repositories.dart';
import 'wire_vocab.dart';

/// Translates the communication engine's DTOs into the app's domain models.
///
/// This is the only place that knows the wire format. Two things it is careful about:
///
/// * **`seq` arrives as a string.** It is a 64-bit sequence and JSON numbers are not safe at
///   that width, so the backend stringifies it. Parsing it here — rather than letting a
///   `num` cast silently lose precision — is what keeps message ordering correct in a long
///   conversation.
/// * **Approval outranks receipts.** A message the server accepted but has not published is
///   `pending`, and must never be presented as delivered.
abstract final class WireMappers {
  /// Parse the stringified 64-bit sequence. Returns null rather than throwing, so one
  /// malformed row cannot blank an entire conversation.
  static int? parseSeq(Object? raw) => switch (raw) {
        null => null,
        final int value => value,
        final String value => int.tryParse(value),
        _ => null,
      };

  static DateTime? parseTime(Object? raw) =>
      raw is String ? DateTime.tryParse(raw)?.toLocal() : null;

  static ConversationKind conversationKind(String? type) => switch (type) {
        Wire.conversationOfficial => ConversationKind.jawwidSupport,
        Wire.conversationStudentGroup => ConversationKind.studentGroup,
        Wire.conversationClassGroup => ConversationKind.studentGroup,
        // A `direct` conversation from this client's perspective is always with staff: the
        // backend refuses a teacher/parent direct channel outright (BR1).
        _ => ConversationKind.adminDirect,
      };

  static ParticipantRole memberRole(String? role) => switch (role) {
        Wire.memberParent => ParticipantRole.parent,
        Wire.memberTeacher => ParticipantRole.teacher,
        Wire.memberAdmin => ParticipantRole.admin,
        // An observer is a real member but has no 1:1 affordance, so it maps to `unknown`,
        // which CommunicationPolicy denies. Failing closed is the right default.
        Wire.memberObserver => ParticipantRole.unknown,
        _ => ParticipantRole.unknown,
      };

  static ParticipantRole authorRole(String? actorKind) => switch (actorKind) {
        Wire.actorContact => ParticipantRole.parent,
        Wire.actorTeacher => ParticipantRole.teacher,
        Wire.actorStaff => ParticipantRole.admin,
        Wire.actorSystem => ParticipantRole.system,
        _ => ParticipantRole.unknown,
      };

  static MessageKind messageKind(String? type) => switch (type) {
        Wire.messageImage => MessageKind.image,
        Wire.messageVideo => MessageKind.video,
        Wire.messageVoice => MessageKind.voice,
        Wire.messageFile => MessageKind.file,
        Wire.messageSystem => MessageKind.system,
        _ => MessageKind.text,
      };

  static ApprovalState approvalState(String? moderation) => switch (moderation) {
        Wire.moderationPending => ApprovalState.pending,
        Wire.moderationRejected => ApprovalState.rejected,
        // `published` covers both "approval was not required" and "approved". The client
        // does not need to tell them apart: either way the message is live.
        _ => ApprovalState.notRequired,
      };

  /// The strongest receipt across recipients.
  ///
  /// The server sends per-actor receipts; a sender's bubble shows a single state, so the
  /// weakest-link rule applies in reverse — a message is "read" only when the log says so
  /// for someone, and otherwise falls back to delivered, then sent.
  static DeliveryState deliveryState(List<Object?> receipts) {
    var best = DeliveryState.sent;

    for (final entry in receipts) {
      if (entry is! Map) continue;
      final state = entry['state'];

      if (state == Wire.receiptRead) return DeliveryState.read;
      if (state == Wire.receiptDelivered) best = DeliveryState.delivered;
    }
    return best;
  }

  static Conversation conversation(
    Map<String, Object?> json, {
    required UserRole viewerRole,
    LearnerRef? learner,
    int unreadCount = 0,
    String lastMessagePreview = '',
    bool isPinned = false,
    bool isMuted = false,
    String? handledByLabel,
  }) {
    final archivedAt = parseTime(json['archivedAt']);
    final lastActivity = parseTime(json['lastActivityAt']) ?? DateTime.now();

    // Approval policy is per role, so the flag the composer honours depends on who is
    // looking (§26).
    final requiresApproval = viewerRole == UserRole.teacher
        ? json['teacherRequiresApproval'] == true
        : json['parentRequiresApproval'] == true;

    return Conversation(
      id: json['id']! as String,
      kind: conversationKind(json['type'] as String?),
      title: (json['title'] as String?) ?? '',
      learner: learner,
      updatedAt: lastActivity,
      lastMessageAt: lastActivity,
      lastMessagePreview: lastMessagePreview,
      unreadCount: unreadCount,
      isPinned: isPinned,
      isMuted: isMuted,
      isArchived: archivedAt != null,
      handledByLabel: handledByLabel,
      requiresApproval: requiresApproval,
      // An archived conversation is read-only for this client; the backend also refuses
      // with CONVERSATION_ARCHIVED.
      isReadOnly: archivedAt != null,
    );
  }

  static Message message(
    Map<String, Object?> json, {
    required String viewerActorId,
    String authorName = '',
  }) {
    final authorId = json['authorId'] as String?;
    final isMine = authorId != null && authorId == viewerActorId;
    final receipts = (json['receipts'] as List?) ?? const [];

    final reactionsRaw = (json['reactions'] as List?) ?? const [];
    final byEmoji = <String, List<String>>{};
    for (final entry in reactionsRaw) {
      if (entry is! Map) continue;
      final emoji = entry['emoji'];
      final actor = entry['actorId'];
      if (emoji is String && actor is String) {
        byEmoji.putIfAbsent(emoji, () => []).add(actor);
      }
    }

    return Message(
      id: json['id'] as String?,
      // A message from another device has no client id of ours; fall back to the server id
      // so the log can still key it uniquely.
      clientMessageId:
          (json['clientMessageId'] as String?) ?? (json['id'] as String? ?? ''),
      conversationId: (json['conversationId'] as String?) ?? '',
      sequence: parseSeq(json['seq']),
      authorId: authorId,
      authorName: authorName,
      authorRole: authorRole(json['authorKind'] as String?),
      kind: messageKind(json['type'] as String?),
      body: (json['body'] as String?) ?? '',
      attachments: [
        for (final a in (json['attachments'] as List?) ?? const [])
          if (a is Map<String, Object?>) attachment(a),
      ],
      replyTo: null,
      reactions: [
        for (final entry in byEmoji.entries)
          Reaction(
            emoji: entry.key,
            count: entry.value.length,
            mine: entry.value.contains(viewerActorId),
          ),
      ],
      deliveryState: deliveryState(receipts),
      approvalState: approvalState(json['moderation'] as String?),
      createdAt: parseTime(json['createdAt']) ?? DateTime.now(),
      isMine: isMine,
      isDeleted: json['deletedAt'] != null || json['deletedForAll'] == true,
    );
  }

  static Attachment attachment(Map<String, Object?> json) {
    return Attachment(
      id: (json['id'] as String?) ?? '',
      kind: messageKind(json['kind'] as String?),
      fileName: json['originalName'] as String?,
      byteSize: (json['byteSize'] as num?)?.toInt(),
      // Short-lived signed URLs from the backend, never permanent storage URLs (§22).
      // `url` is what makes a voice note playable at all; dropping it here was
      // why the client could model a voice message but never hear one.
      url: json['url'] as String?,
      thumbnailUrl: json['thumbnailUrl'] as String?,
      mimeType: json['mimeType'] as String?,
      durationMs: (json['durationMs'] as num?)?.toInt(),
    );
  }

  static GroupMember groupMember(Map<String, Object?> json, {String displayName = ''}) {
    return GroupMember(
      id: (json['actorId'] as String?) ?? '',
      displayName: displayName,
      role: memberRole(json['memberRole'] as String?),
    );
  }

  static CallOutcome callOutcome(String? raw) => switch (raw) {
        Wire.callAnswered => CallOutcome.answered,
        Wire.callDeclined => CallOutcome.declined,
        _ => CallOutcome.missed,
      };

  // -----------------------------------------------------------------------------------
  // Notifications
  // -----------------------------------------------------------------------------------

  /// A notification card from the centre.
  ///
  /// Returns null on a row with no id rather than throwing, so one malformed
  /// record cannot blank a whole page of a parent's history.
  ///
  /// `title` and `body` are taken verbatim. The server rendered them once, in
  /// the recipient's language, and froze them so a later change cannot rewrite
  /// what the parent was told; recomposing the sentence here would undo exactly
  /// that guarantee.
  static AppNotification? notification(Map<String, Object?> json) {
    final id = json['id'] as String?;
    if (id == null || id.isEmpty) return null;

    return AppNotification(
      id: id,
      type: json['type'] as String?,
      category: NotificationCategory.parse(json['category'] as String?),
      priority: NotificationPriority.parse(json['priority'] as String?),
      title: (json['title'] as String?) ?? '',
      body: (json['body'] as String?) ?? '',
      createdAt: parseTime(json['createdAt']) ?? DateTime.now(),
      readAt: parseTime(json['readAt']),
      isEssential: json['isEssential'] == true,
      deeplink: json['deeplink'] as String?,
      entityType: json['entityType'] as String?,
      entityId: json['entityId'] as String?,
      conversationId: json['conversationId'] as String?,
      learnerId: json['learnerId'] as String?,
      learnerName: json['learnerName'] as String?,
      senderId: json['senderId'] as String?,
      senderName: json['senderName'] as String?,
      announcementId: json['announcementId'] as String?,
      groupCount: (json['groupCount'] as num?)?.toInt() ?? 1,
      imageUrl: json['imageUrl'] as String?,
    );
  }

  /// The realtime `notification.created` payload.
  ///
  /// Deliberately thinner than the REST card: the event carries enough to show
  /// a toast and move the badge, and the centre refetches for the rest. It is a
  /// hint that something arrived, not the record of it — the same rule
  /// `message.created` follows.
  static AppNotification? realtimeNotification(Map<String, Object?> json) {
    final id = json['notificationId'] as String?;
    if (id == null || id.isEmpty) return null;

    return AppNotification(
      id: id,
      category: NotificationCategory.unknown,
      priority: NotificationPriority.normal,
      title: (json['title'] as String?) ?? '',
      body: (json['body'] as String?) ?? '',
      createdAt: DateTime.now(),
      conversationId: json['conversationId'] as String?,
    );
  }

  static UnreadCounts unreadCounts(Map<String, Object?> json) {
    final raw = json['byCategory'];
    final byCategory = <NotificationCategory, int>{};

    if (raw is Map) {
      for (final entry in raw.entries) {
        final category = NotificationCategory.parse(entry.key as String?);
        // A category this build does not know still counts towards the total
        // the server sent; it just has no tab of its own.
        if (category == NotificationCategory.unknown) continue;
        byCategory[category] = (entry.value as num?)?.toInt() ?? 0;
      }
    }

    return UnreadCounts(
      total: (json['total'] as num?)?.toInt() ?? 0,
      byCategory: byCategory,
    );
  }

  static NotificationPreference? notificationPreference(Map<String, Object?> json) {
    final category = NotificationCategory.parse(json['category'] as String?);
    if (category == NotificationCategory.unknown) return null;

    return NotificationPreference(
      category: category,
      isOptional: json['isOptional'] == true,
      pushEnabled: json['pushEnabled'] != false,
    );
  }

  static Announcement? announcement(Map<String, Object?> json) {
    final id = json['id'] as String?;
    if (id == null || id.isEmpty) return null;

    return Announcement(
      id: id,
      title: (json['title'] as String?) ?? '',
      body: (json['body'] as String?) ?? '',
      priority: (json['priority'] as String?) ?? 'normal',
      imageUrl: json['imageUrl'] as String?,
      actionLabel: json['actionLabel'] as String?,
      actionUrl: json['actionUrl'] as String?,
      publishedAt: parseTime(json['publishedAt']),
      expiresAt: parseTime(json['expiresAt']),
    );
  }
}
