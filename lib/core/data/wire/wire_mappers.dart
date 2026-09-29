import '../../../shared/models/conversation.dart';
import '../../../shared/models/message.dart';
import '../../../shared/models/story.dart';
import '../../../shared/models/system_event.dart';
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

  /// Whether a stored mute expiry is still in force.
  ///
  /// The contract models a mute as `mutedUntil`, not a boolean, so "muted" is a
  /// question about now. A far-future timestamp is how an indefinite mute is
  /// expressed; a past one is a mute that has lapsed and must read as off.
  static bool _isMuted(DateTime? mutedUntil) =>
      mutedUntil != null && mutedUntil.isAfter(DateTime.now().toUtc());

  /// Approval policy for a backend that does not yet send `viewerRequiresApproval`.
  ///
  /// Kept deliberately narrow: ONE flag, chosen by the viewer's role, and only
  /// on a group. Approval exists for student and class groups; a 1:1 has never
  /// been moderated, and claiming otherwise is the exact falsehood this whole
  /// change removes.
  static bool _legacyRequiresApproval(Map<String, Object?> json, UserRole viewerRole) {
    final type = json['type'] as String?;
    if (type != Wire.conversationStudentGroup && type != Wire.conversationClassGroup) {
      return false;
    }
    return viewerRole == UserRole.teacher
        ? json['teacherRequiresApproval'] == true
        : json['parentRequiresApproval'] == true;
  }

  /// The last message on a list row, or null when the conversation is empty.
  static MessagePreview? lastMessage(
    Object? json, {
    required String viewerActorId,
  }) {
    if (json is! Map<String, Object?>) return null;

    final kind = messageKind(json['type'] as String?);
    final authorId = json['authorId'] as String?;
    final text = (json['preview'] as String?)?.trim();

    return MessagePreview(
      kind: kind,
      at: parseTime(json['createdAt']) ?? DateTime.now(),
      // Only a text message carries text. The server sends null for every other
      // kind rather than a body that would be meaningless or, for a system
      // message, a raw payload.
      text: (text == null || text.isEmpty) ? null : text,
      systemEvent: SystemEvent.fromJson(json['systemEvent']),
      authorName: (json['authorName'] as String?)?.trim().isNotEmpty == true
          ? (json['authorName'] as String).trim()
          : null,
      isMine: authorId != null && authorId.isNotEmpty && authorId == viewerActorId,
    );
  }

  static Conversation conversation(
    Map<String, Object?> json, {
    required UserRole viewerRole,
    required String viewerActorId,
    String? handledByLabel,
  }) {
    final archivedAt = parseTime(json['archivedAt']);
    final lastActivity = parseTime(json['lastActivityAt']) ?? DateTime.now();

    // Server-derived: `viewerRequiresApproval` is decided by the same function
    // that decides the moderation a message is stored with, so the notice and
    // the behaviour cannot disagree.
    //
    // The per-role fallback below is for a backend that predates the field. It
    // reads ONE flag chosen by role -- never both OR-ed, which is what told a
    // parent their messages were reviewed because the teacher's were -- and it
    // gates on conversation type, because approval has never applied to a 1:1.
    final requiresApproval = json['viewerRequiresApproval'] is bool
        ? json['viewerRequiresApproval'] as bool
        : _legacyRequiresApproval(json, viewerRole);

    // Per-viewer pin/mute/archive. Written by POST /preferences and now read
    // back here; before the contract carried them the client could set them and
    // never see them again, so Favourites was permanently empty and a mute
    // always read as off after a reload.
    final viewerState = json['viewerState'];
    final state = viewerState is Map<String, Object?> ? viewerState : const <String, Object?>{};
    final viewerArchivedAt = parseTime(state['archivedAt']);

    final counterpartJson = json['counterpart'];
    final counterpart = counterpartJson is Map<String, Object?>
        ? ConversationCounterpart(
            id: (counterpartJson['actorId'] as String?) ?? '',
            displayName: (counterpartJson['displayName'] as String?) ?? '',
          )
        : null;

    return Conversation(
      id: json['id']! as String,
      kind: conversationKind(json['type'] as String?),
      title: (json['title'] as String?) ?? '',
      // Both from the DTO. They used to be parameters this mapper's caller had
      // to supply, because the payload carried neither — which meant the child
      // sections and the unread badge worked against fixtures and were blank
      // against the real API. Taking them as arguments is also what would let
      // a caller pass something it inferred locally, so the parameters are
      // gone rather than merely unused.
      learner: WireMappers.learner(json['learner']),
      counterpart: counterpart,
      updatedAt: lastActivity,
      lastMessageAt: lastActivity,
      lastMessage: lastMessage(json['lastMessage'], viewerActorId: viewerActorId),
      // Server-derived, per actor. Absent is treated as zero: the list route
      // always sends it, and a create/sync response that omits it is not
      // describing a badge.
      unreadCount: (json['unreadCount'] as num?)?.toInt() ?? 0,
      isPinned: parseTime(state['pinnedAt']) != null,
      // A mute is stored as an expiry, so a lapsed one is not a mute.
      isMuted: _isMuted(parseTime(state['mutedUntil'])),
      // Either kind of archive hides the row: the conversation being closed by
      // staff, or this viewer archiving their own copy. Only the first makes it
      // read-only, which is why `isReadOnly` below reads the conversation's.
      isArchived: archivedAt != null || viewerArchivedAt != null,
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
      // From the wire since backend gap O3 closed. Empty means unresolved, and
      // the bubble says a role word rather than an id in that case (§25).
      authorName: ((json['authorName'] as String?) ?? '').trim(),
      authorRole: authorRole(json['authorKind'] as String?),
      systemEvent: SystemEvent.fromJson(json['systemEvent']),
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

  /// One `StoryFeedItem`, or null when the row is unusable.
  ///
  /// `publishedAt` and `expiresAt` are required by the contract and are the two fields the
  /// viewer's behaviour hangs on -- the expiry is what it stops at. A row missing either is
  /// returned as null so the caller can drop it, rather than being handed a story with a
  /// substituted clock that would outstay the server's own answer.
  ///
  /// `mediaKind` and `mediaUrl` travel together: the server sets both or neither, and once
  /// media is purged it sends neither. A half-described attachment is treated as no
  /// attachment, so the viewer shows the words instead of an image box that cannot fill.
  static Story? story(Map<String, Object?> json) {
    final id = json['id'] as String?;
    final publishedAt = parseTime(json['publishedAt']);
    final expiresAt = parseTime(json['expiresAt']);
    if (id == null || id.isEmpty || publishedAt == null || expiresAt == null) return null;

    final mediaKind = StoryMediaKind.tryParse(json['mediaKind'] as String?);
    final mediaUrl = json['mediaUrl'] as String?;
    final hasMedia = mediaKind != null && mediaUrl != null && mediaUrl.isNotEmpty;

    return Story(
      id: id,
      title: _nonEmpty(json['title']),
      body: _nonEmpty(json['body']),
      mediaKind: hasMedia ? mediaKind : null,
      mediaUrl: hasMedia ? mediaUrl : null,
      publishedAt: publishedAt,
      expiresAt: expiresAt,
      isViewed: json['viewed'] == true,
    );
  }

  static String? _nonEmpty(Object? raw) {
    final value = raw as String?;
    if (value == null) return null;
    final trimmed = value.trim();
    return trimmed.isEmpty ? null : trimmed;
  }

  /// One group member.
  ///
  /// `displayName` comes from the payload now that `ConversationMemberDto`
  /// carries it; the parameter remains so a caller with a better name can
  /// override, and so the fake backend keeps working. An unresolved name stays
  /// EMPTY -- the UI shows a neutral word for that and must never fall back to
  /// the actor id (§25).
  static GroupMember groupMember(Map<String, Object?> json, {String? displayName}) {
    return GroupMember(
      id: (json['actorId'] as String?) ?? '',
      displayName: displayName ?? ((json['displayName'] as String?) ?? '').trim(),
      role: memberRole(json['memberRole'] as String?),
    );
  }

  static CallOutcome callOutcome(String? raw) => switch (raw) {
        Wire.callAnswered => CallOutcome.answered,
        Wire.callDeclined => CallOutcome.declined,
        _ => CallOutcome.missed,
      };
}
