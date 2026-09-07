import '../../../shared/models/conversation.dart';
import '../../../shared/models/message.dart';
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

  /// The quoted message shown above a reply.
  ///
  /// The backend decides availability, not this client: it knows whether the
  /// target was deleted, is an internal note, or was hidden by this reader, and
  /// it serves an excerpt ONLY when the reader may see one. An unavailable
  /// quote therefore arrives with no excerpt, and this mapper's job is to
  /// preserve that rather than to substitute anything for it.
  static ReplyPreview? replyPreview(
    Map<String, Object?> json, {
    Map<String, String> displayNames = const {},
  }) {
    final raw = json['replyPreview'];
    if (raw is! Map) {
      // No preview served -- an older backend, or a message the read path did
      // not resolve. Fall back to the bare id so the bubble can still show that
      // a quote existed, rather than silently dropping the relationship.
      final id = json['replyToMessageId'];
      return id is String
          ? ReplyPreview.unavailable(
              messageId: id,
              reason: QuoteUnavailableReason.missing,
            )
          : null;
    }

    final messageId = (raw['messageId'] as String?) ?? '';
    if (raw['available'] != true) {
      return ReplyPreview.unavailable(
        messageId: messageId,
        reason: ReplyPreview.parseReason(raw['unavailableReason'] as String?) ??
            QuoteUnavailableReason.missing,
      );
    }

    final authorId = raw['authorId'] as String?;
    return ReplyPreview(
      messageId: messageId,
      authorName: (authorId == null ? null : displayNames[authorId]) ?? '',
      excerpt: (raw['excerpt'] as String?) ?? '',
    );
  }

  static Conversation conversation(
    Map<String, Object?> json, {
    required UserRole viewerRole,
    String? viewerActorId,
    LearnerRef? learner,
    String? handledByLabel,
  }) {
    final archivedAt = parseTime(json['archivedAt']);
    final lastActivity = parseTime(json['lastActivityAt']) ?? DateTime.now();

    // Phase 2 serves these ON THE ROW. They used to be absent, which cost one
    // request per row to render a chat list; the zero-defaults below are for
    // the by-id endpoint, which returns a conversation without them.
    final unreadCount = (json['unreadCount'] as num?)?.toInt() ?? 0;
    final lastMessagePreview = (json['lastMessagePreview'] as String?) ?? '';
    final lastMessageAt = parseTime(json['lastMessageAt']);
    final isPinned = json['isPinned'] == true;
    final isMuted = json['isMuted'] == true;
    final isArchivedForMe = json['isArchivedForMe'] == true;

    // Approval policy is per role, so the flag the composer honours depends on who is
    // looking (§26).
    final requiresApproval = viewerRole == UserRole.teacher
        ? json['teacherRequiresApproval'] == true
        : json['parentRequiresApproval'] == true;

    return Conversation(
      id: json['id']! as String,
      kind: conversationKind(json['type'] as String?),
      title: (json['title'] as String?) ??
          titleFromMembers(json, excludeActorId: viewerActorId) ??
          '',
      learner: learner,
      updatedAt: lastActivity,
      lastMessageAt: lastMessageAt ?? lastActivity,
      lastMessagePreview: lastMessagePreview,
      unreadCount: unreadCount,
      isPinned: isPinned,
      isMuted: isMuted,
      isArchived: archivedAt != null || isArchivedForMe,
      handledByLabel: handledByLabel,
      requiresApproval: requiresApproval,
      // An archived conversation is read-only for this client; the backend also refuses
      // with CONVERSATION_ARCHIVED. A conversation the USER filed away is merely out of
      // the main list, and they may still write in it.
      isReadOnly: archivedAt != null,
    );
  }

  /// A name for a conversation the backend gave no title.
  ///
  /// A 1:1 has no title of its own, so it is named after the other side.
  /// Returns null rather than a placeholder when the members were not served,
  /// so the caller's own fallback applies.
  static String? titleFromMembers(Map<String, Object?> json, {String? excludeActorId}) {
    final members = json['members'];
    if (members is! List) return null;

    final names = <String>[
      for (final m in members)
        if (m is Map &&
            m['actorId'] != excludeActorId &&
            m['displayName'] is String &&
            (m['displayName'] as String).isNotEmpty)
          m['displayName'] as String,
    ];
    return names.isEmpty ? null : names.join('، ');
  }

  /// Display names by actor id, for resolving authors and quotes.
  static Map<String, String> memberNames(Map<String, Object?> json) {
    final members = json['members'];
    if (members is! List) return const {};

    return {
      for (final m in members)
        if (m is Map && m['actorId'] is String && m['displayName'] is String)
          m['actorId'] as String: m['displayName'] as String,
    };
  }

  static Message message(
    Map<String, Object?> json, {
    required String viewerActorId,
    String authorName = '',
    /// Display names by actor id, from the conversation's member list. Used for
    /// the author line and for the name above a quote, so the client never has
    /// to fetch an actor to render a bubble.
    Map<String, String> displayNames = const {},
  }) {
    final authorId = json['authorId'] as String?;
    final isMine = authorId != null && authorId == viewerActorId;
    final receipts = (json['receipts'] as List?) ?? const [];
    final resolvedAuthorName = authorName.isNotEmpty
        ? authorName
        : (authorId == null ? '' : displayNames[authorId] ?? '');

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
      authorName: resolvedAuthorName,
      authorRole: authorRole(json['authorKind'] as String?),
      kind: messageKind(json['type'] as String?),
      body: (json['body'] as String?) ?? '',
      attachments: [
        for (final a in (json['attachments'] as List?) ?? const [])
          if (a is Map<String, Object?>) attachment(a),
      ],
      replyTo: replyPreview(json, displayNames: displayNames),
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
      isForwarded: json['isForwarded'] == true,
      editedAt: parseTime(json['editedAt']),
    );
  }

  static Attachment attachment(Map<String, Object?> json) {
    return Attachment(
      id: (json['id'] as String?) ?? '',
      kind: messageKind(json['kind'] as String?),
      fileName: json['originalName'] as String?,
      byteSize: (json['byteSize'] as num?)?.toInt(),
      // Short-lived signed URL from the backend, never a permanent storage URL (§22).
      thumbnailUrl: json['thumbnailUrl'] as String?,
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
}
