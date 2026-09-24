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

  /// Classify a conversation from its wire payload.
  ///
  /// Before PD-6 the type alone decided this: a `direct` conversation could only be with
  /// staff, because BR-1 refused every other 1:1. Since PD-6 a `direct` conversation may be
  /// Parent <-> Admin, Teacher <-> Admin **or** Parent <-> Teacher, and the type no longer
  /// distinguishes them.
  ///
  /// So the participants decide, and only the participants the payload actually states.
  ///
  /// WHAT THIS IS NOT. This is not an authorization decision and cannot become one. The
  /// server authorizes the channel and refuses anything else with
  /// `COMM.TEACHER_PARENT_NOT_AUTHORIZED`; classifying a row as
  /// [ConversationKind.teacherParentDirect] grants the viewer nothing they did not already
  /// have. It decides how the row is presented, nothing more.
  ///
  /// WHY `actorKind` AND NOT `memberRole`. `memberRole` is a label on the membership row
  /// and a teacher can carry `member_role: 'admin'` — red-team RT-025 C5 is exactly that
  /// attack against the server. `actorKind` is the identity's own kind and is the field the
  /// server's own rules are written against, so it is the field to read here too.
  ///
  /// FAILING CLOSED. Anything other than exactly one `contact` and exactly one `teacher` is
  /// [ConversationKind.unknownDirect] — no members (the list endpoint sends none, by
  /// contract), an empty list, a malformed entry, or a set this client does not recognise.
  /// Guessing [ConversationKind.teacherParentDirect] from a type, a title or an id is the
  /// one mistake this function exists to make impossible.
  static ConversationKind conversationKind(
    String? type, {
    Object? members,
  }) =>
      switch (type) {
        Wire.conversationOfficial => ConversationKind.jawwidSupport,
        Wire.conversationStudentGroup => ConversationKind.studentGroup,
        Wire.conversationClassGroup => ConversationKind.studentGroup,
        Wire.conversationDirect => _directKind(members),
        // An unknown type is not a direct conversation this client understands.
        // adminDirect remains the pre-PD-6 default for backward compatibility;
        // what matters is that it is never teacherParentDirect.
        _ => ConversationKind.adminDirect,
      };

  /// The participant shapes of a `direct` conversation. Order is irrelevant: a set is a set.
  static ConversationKind _directKind(Object? members) {
    if (members is! List) return ConversationKind.unknownDirect;

    var contacts = 0;
    var teachers = 0;
    var staff = 0;
    var unrecognised = 0;

    for (final entry in members) {
      if (entry is! Map) {
        unrecognised += 1;
        continue;
      }
      switch (entry['actorKind']) {
        case Wire.actorContact:
          contacts += 1;
        case Wire.actorTeacher:
          teachers += 1;
        case Wire.actorStaff:
          staff += 1;
        default:
          unrecognised += 1;
      }
    }

    if (unrecognised > 0) return ConversationKind.unknownDirect;

    // Exactly one of each, and nobody else present. A third participant means this is not
    // the 1:1 the server's two-participant ceiling describes, so it is not classified.
    if (contacts == 1 && teachers == 1 && staff == 0) {
      return ConversationKind.teacherParentDirect;
    }
    // Parent <-> Admin and Teacher <-> Admin: one staff member and one counterpart.
    if (staff == 1 && contacts + teachers == 1) {
      return ConversationKind.adminDirect;
    }

    return ConversationKind.unknownDirect;
  }

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

  /// The learner a conversation is about, straight off `ConversationDto`.
  ///
  /// Null for a conversation that has none — the family's own thread with
  /// Jawwid — and null when the server did not resolve one. It is never
  /// assembled from anything else: not from the title, not from a participant
  /// name, not from a cached message. The backend is the authority on which
  /// child a conversation belongs to, and a client that guesses will
  /// eventually guess wrong in front of a parent with two children.
  ///
  /// `avatarUrl` stays null because `chat.learner` has no avatar column. An
  /// absent field is rendered as absent rather than filled in with an initial
  /// dressed up as data.
  static LearnerRef? learner(Object? raw) {
    if (raw is! Map) return null;

    final id = raw['id'];
    final name = raw['name'];
    if (id is! String || id.isEmpty) return null;

    return LearnerRef(
      id: id,
      displayName: name is String ? name : '',
    );
  }

  static Conversation conversation(
    Map<String, Object?> json, {
    required UserRole viewerRole,
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
      kind: conversationKind(json['type'] as String?, members: json['members']),
      title: (json['title'] as String?) ?? '',
      // Both from the DTO. They used to be parameters this mapper's caller had
      // to supply, because the payload carried neither — which meant the child
      // sections and the unread badge worked against fixtures and were blank
      // against the real API. Taking them as arguments is also what would let
      // a caller pass something it inferred locally, so the parameters are
      // gone rather than merely unused.
      learner: WireMappers.learner(json['learner']),
      updatedAt: lastActivity,
      lastMessageAt: lastActivity,
      lastMessagePreview: lastMessagePreview,
      // Server-derived, per actor. Absent is treated as zero: the list route
      // always sends it, and a create/sync response that omits it is not
      // describing a badge.
      unreadCount: (json['unreadCount'] as num?)?.toInt() ?? 0,
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
      // No preview is embedded on the wire; the chat screen resolves the quote
      // from the log it already holds, and shows a neutral placeholder when the
      // original has not been paged in yet.
      replyTo: null,
      replyToMessageId: json['replyToMessageId'] as String?,
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
}
