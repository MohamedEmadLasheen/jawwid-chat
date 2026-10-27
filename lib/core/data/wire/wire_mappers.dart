import '../../../shared/models/conversation.dart';
import '../../../shared/models/lesson.dart';
import '../../../shared/models/message.dart';
import '../../../shared/models/story.dart';
import '../../../shared/models/supervision.dart' show parseCalendarDay;
import '../../../shared/models/teacher_profile.dart';
import '../../../shared/models/user_role.dart';
import '../../../shared/utils/app_clock.dart';
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

  /// An ISO instant, shown in the account's zone (PD-22, [AppClock]).
  static DateTime? parseTime(Object? raw) => AppClock.parse(raw);

  /// Classify a conversation from its wire payload.
  ///
  /// Before PD-6 the type alone decided this: a `direct` conversation could only be with
  /// staff, because BR-1 refused every other 1:1. During PD-6 (2026-09-23 to 2026-10-14) a
  /// `direct` conversation could also be Parent <-> Teacher; PD-7 refuses new ones, but the
  /// rows PD-6 created still exist (read-only), so the type still does not distinguish them.
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
        // PD-8: a supervisor-created group. A group in every respect the client
        // cares about (moderated, admin present, several members); it may be
        // about more than one child, so it can arrive without a single learner.
        Wire.conversationFamilyGroup => ConversationKind.studentGroup,
        // PD-20: a teacher's trial group with Sales is a GROUP (several members, Sales
        // joins and leaves it) and lists under Groups -- for the teacher and for Sales.
        Wire.conversationTrialGroup => ConversationKind.studentGroup,
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
        Wire.messageCard => MessageKind.card,
        _ => MessageKind.text,
      };

  static ApprovalState approvalState(String? moderation) => switch (moderation) {
        Wire.moderationPending => ApprovalState.pending,
        Wire.moderationRejected => ApprovalState.rejected,
        // `published` covers both "approval was not required" and "approved". The client
        // does not need to tell them apart: either way the message is live.
        _ => ApprovalState.notRequired,
      };

  /// The ticks on the viewer's own message, as the server decided them (PD-37).
  ///
  /// The server sends one aggregate `status` on the author's own messages -- `read` only
  /// when every countable reader read it -- and null on everyone else's. It no longer sends
  /// per-recipient receipts, so the client has nothing to combine and must not try.
  static DeliveryState deliveryState(String? status) => switch (status) {
        Wire.receiptRead => DeliveryState.read,
        Wire.receiptDelivered => DeliveryState.delivered,
        _ => DeliveryState.sent,
      };

  /// What a conversation row is called: the server's title when it set one (a Student
  /// Group's), else who it is WITH -- the display names the server sent for the other
  /// members, never names this client resolved itself. A direct conversation has no
  /// title, so before this every direct row (Parent<->Admin, Teacher<->Admin, a PD-6-era
  /// Teacher<->Parent one) rendered as an empty name with a "?" avatar. Empty only when
  /// the payload names nobody else -- the viewer is excluded by actor id.
  static String conversationTitle(
    Map<String, Object?> json, {
    String viewerActorId = '',
  }) {
    final title = _nonEmpty(json['title']);
    if (title != null) return title;
    final members = json['members'];
    if (members is! List) return '';
    final others = <String>[];
    for (final entry in members) {
      if (entry is! Map) continue;
      if (viewerActorId.isNotEmpty && entry['actorId'] == viewerActorId) {
        continue;
      }
      final name = _nonEmpty(entry['displayName']);
      if (name != null) others.add(name);
    }
    return others.join(', ');
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
  /// `avatarUrl` is the child's photo, set by a parent: a signed link for this
  /// viewer, or absent -- rendered as absent, never as an initial dressed up as
  /// data.
  static LearnerRef? learner(Object? raw) {
    if (raw is! Map) return null;

    final id = raw['id'];
    final name = raw['name'];
    if (id is! String || id.isEmpty) return null;

    return LearnerRef(
      id: id,
      displayName: name is String ? name : '',
      avatarUrl: _nonEmpty(raw['avatarUrl']),
    );
  }

  static Conversation conversation(
    Map<String, Object?> json, {
    required UserRole viewerRole,
    String viewerActorId = '',
    String lastMessagePreview = '',
    bool isPinned = false,
    bool isMuted = false,
    String? handledByLabel,
  }) {
    final archivedAt = parseTime(json['archivedAt']);
    final lastActivity = parseTime(json['lastActivityAt']) ?? DateTime.now();

    // Approval policy is per viewer (§26). The server now says it outright --
    // `viewerRequiresApproval`, from the same function that decides a sent
    // message's moderation, so a 1:1 is never "reviewed" and a parent never
    // inherits the teachers' rule. The per-role stored flag is only the fallback
    // for a server that predates the field.
    final viewerRule = json['viewerRequiresApproval'];
    final requiresApproval = viewerRule is bool
        ? viewerRule
        : viewerRole == UserRole.teacher
            ? json['teacherRequiresApproval'] == true
            : json['parentRequiresApproval'] == true;

    // The viewer's own pin / mute / archive, read back from the server. Absent
    // (an older server, or a create response) falls back to the caller's values.
    final state = json['viewerState'];
    final viewerState = state is Map ? state : null;
    final mutedUntil = parseTime(viewerState?['mutedUntil']);

    // The newest message THIS viewer may see (the server applies the message
    // page's own visibility rule). Text previews as itself; anything else is
    // named by kind and worded by the tile in the reader's language.
    final last = json['lastMessage'];
    final lastMessage = last is Map ? last : null;
    final lastText = lastMessage?['text'];
    final lastKind = lastMessage == null
        ? null
        : lastMessage['deleted'] == true
            ? 'deleted'
            : lastMessage['type'] == 'system'
                ? 'system:${lastMessage['systemKind'] ?? ''}'
                : (lastText is String && lastText.isNotEmpty)
                    ? null
                    : lastMessage['type'] as String?;

    final kind = conversationKind(json['type'] as String?, members: json['members']);
    final learnerRef = WireMappers.learner(json['learner']);

    return Conversation(
      id: json['id']! as String,
      kind: kind,
      // WhatsApp-style: a 1:1 shows the other person's photo, a group about a
      // child shows the child's. Signed links, straight from the server.
      avatarUrl: kind.isDirect
          ? _counterpartAvatar(json['members'], viewerActorId)
          // The group's picture: its one child's photo -- family groups too,
          // which link their child without naming a learner on the row.
          : _nonEmpty(json['avatarUrl']) ?? learnerRef?.avatarUrl,
      title: conversationTitle(json, viewerActorId: viewerActorId),
      // Both from the DTO. They used to be parameters this mapper's caller had
      // to supply, because the payload carried neither — which meant the child
      // sections and the unread badge worked against fixtures and were blank
      // against the real API. Taking them as arguments is also what would let
      // a caller pass something it inferred locally, so the parameters are
      // gone rather than merely unused.
      learner: learnerRef,
      updatedAt: lastActivity,
      lastMessageAt: parseTime(lastMessage?['createdAt']) ?? lastActivity,
      lastMessagePreview:
          (lastText is String && lastMessage?['deleted'] != true) ? lastText : lastMessagePreview,
      lastMessageKind: lastKind,
      // Server-derived, per actor. Absent is treated as zero: the list route
      // always sends it, and a create/sync response that omits it is not
      // describing a badge.
      unreadCount: (json['unreadCount'] as num?)?.toInt() ?? 0,
      isPinned: viewerState != null ? viewerState['pinned'] == true : isPinned,
      isMuted: viewerState != null
          ? (mutedUntil != null && mutedUntil.isAfter(DateTime.now()))
          : isMuted,
      // Archived for everyone (server-side, read-only) or archived by this viewer
      // (a personal "hide from my list"). Only the first makes it read-only, below.
      isArchived: archivedAt != null || viewerState?['archived'] == true,
      // The viewer's own look for this chat: a preset and/or a photo.
      themeKey: viewerState?['theme'] is String ? viewerState!['theme'] as String : null,
      wallpaperUrl: _nonEmpty(viewerState?['wallpaperUrl']),
      handledByLabel: handledByLabel,
      cover: _cover(json['cover']),
      isMentioned: viewerState?['mention'] is Map && (viewerState!['mention']! as Map)['seen'] == false,
      requiresApproval: requiresApproval,
      // An archived conversation is read-only for this client; the backend also refuses
      // with CONVERSATION_ARCHIVED. So is a direct teacher<->parent conversation: PD-7
      // (2026-10-14) forbids that channel again, and one left over from the PD-6 window is
      // history -- the backend refuses every send into it with BR1_TEACHER_PARENT_DIRECT.
      isReadOnly: archivedAt != null || kind == ConversationKind.teacherParentDirect,
      isTeacherSupervision: json['type'] == Wire.conversationTeacherSupervision,
      isTrialGroup: json['type'] == Wire.conversationTrialGroup,
      // Sales sees every teacher's trial group; the server's title (the teacher's name)
      // is what tells them apart, so it is not replaced by "Trial lessons".
      namedByServer: viewerRole == UserRole.sales,
      paymentLock: paymentLock(json['paymentLock']),
    );
  }

  /// PD-30: `paymentLock` off `GET /conversations/:id`. Absent, null or malformed reads
  /// as not locked -- the server refuses a locked send on its own, and the screen then
  /// learns of the lock from that refusal.
  static PaymentLock? paymentLock(Object? raw) {
    if (raw is! Map) return null;
    final children = <LockedChild>[];
    for (final c in (raw['children'] is List ? raw['children'] as List : const [])) {
      if (c is! Map) continue;
      final id = c['id'];
      if (id is! String || id.isEmpty) continue;
      final overdue = c['overdue'] is Map ? c['overdue'] as Map : null;
      final due = overdue?['dueDate'];
      final dueMatch = due is String ? RegExp(r'^(\d{4})-(\d{2})-(\d{2})').firstMatch(due) : null;
      children.add(LockedChild(
        id: id,
        name: c['name'] is String ? c['name'] as String : '',
        reasons: [
          if (c['reasons'] is List)
            for (final r in c['reasons'] as List)
              if (r is String) r,
        ],
        overdueLabel: overdue?['label'] is String ? overdue!['label'] as String : null,
        overdueDueDate: dueMatch == null
            ? null
            : DateTime(int.parse(dueMatch[1]!), int.parse(dueMatch[2]!), int.parse(dueMatch[3]!)),
      ));
    }
    return PaymentLock(
      readOnly: raw['readOnly'] == true,
      canPay: raw['canPay'] == true,
      children: children,
    );
  }

  /// PD-33: `cover` as the server sends it, or null when absent or malformed.
  static ConversationCover? _cover(Object? raw) {
    if (raw is! Map) return null;
    final supervisor = _nonEmpty(raw['supervisorName']);
    final cover = _nonEmpty(raw['coverName']);
    final until = parseTime(raw['until']);
    if (supervisor == null || cover == null || until == null) return null;
    return ConversationCover(supervisorName: supervisor, coverName: cover, until: until);
  }

  /// The one other member's photo in a 1:1; null when there is not exactly one.
  static String? _counterpartAvatar(Object? members, String viewerActorId) {
    if (members is! List) return null;
    final others = [
      for (final m in members)
        if (m is Map && m['actorId'] != viewerActorId) m,
    ];
    return others.length == 1 ? _nonEmpty(others.single['avatarUrl']) : null;
  }

  /// One message, from `MessageDto`.
  ///
  /// `authorName` now comes off the wire as `authorDisplayName` (gap O3 closed).
  /// It used to be a named parameter defaulting to `''` because the DTO carried no
  /// name at all and the caller had nothing to pass — so the parameter is gone
  /// rather than left as a second, quieter way to set an identity.
  ///
  /// **Null or absent stays `''`, and the client resolves nothing.** The server
  /// sends null for a system message (there is no person) and for an author whose
  /// actor no longer resolves. `MessageBubble` then falls back to the ROLE label —
  /// which is defensive presentation, **not** identity resolution: this client
  /// never asks an identity endpoint for a missing name, and it never derives one
  /// from the role, the actor kind, or conversation membership.
  /// PD-11: `MessageDto.card`, or null when absent or malformed. A malformed card is
  /// dropped rather than thrown on: the message still has its plain-text body.
  static MessageCard? messageCard(Object? raw) {
    if (raw is! Map) return null;
    final kind = raw['kind'];
    final payload = raw['payload'];
    if (kind is! String || kind.isEmpty || payload is! Map) return null;
    return MessageCard(
      kind: kind,
      lessonId: raw['lessonId'] as String?,
      payload: Map<String, Object?>.from(payload),
    );
  }

  /// PD-36: a message's "@..." chips. A malformed row is dropped, never guessed at.
  static List<MessageMention> mentions(Object? raw) => [
        for (final m in (raw as List?) ?? const [])
          if (m is Map<String, Object?> && m['start'] is int && m['length'] is int)
            MessageMention(
              start: m['start']! as int,
              length: m['length']! as int,
              actorId: m['actorId'] as String?,
              role: m['role'] as String?,
            ),
      ];

  static Message message(
    Map<String, Object?> json, {
    required String viewerActorId,
  }) {
    final authorId = json['authorId'] as String?;
    final isMine = authorId != null && authorId == viewerActorId;

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
      authorName: _nonEmpty(json['authorDisplayName']) ?? '',
      authorAvatarUrl: _nonEmpty(json['authorAvatarUrl']),
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
      card: messageCard(json['card']),
      isStarred: json['starred'] == true,
      isPinned: json['pinned'] == true,
      isForwarded: json['forwarded'] == true,
      isSentBySupport: json['sentBySupport'] == true,
      editedAt: parseTime(json['editedAt']),
      isInternal: json['visibility'] == Wire.visibilityInternal,
      mentions: mentions(json['mentions']),
      mentionsMe: json['mentionsViewer'] == true,
      reactions: [
        for (final entry in byEmoji.entries)
          Reaction(
            emoji: entry.key,
            count: entry.value.length,
            mine: entry.value.contains(viewerActorId),
          ),
      ],
      deliveryState: deliveryState(json['status'] as String?),
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
  /// One story from `StoryFeedItem`.
  ///
  /// A null `expiresAt` is a story that does not expire (every story since 2026-10-17), NOT a
  /// row to drop: the first version of this mapper refused it, which would have made every
  /// new story invisible on the phone. A row with no id or no publication time is still
  /// dropped -- there is no story without those.
  ///
  /// Words are kept only for a TEXT story. The server already sends none for the other kinds;
  /// an older server's caption under a picture is not rendered either, because a story has
  /// no caption.
  static Story? story(Map<String, Object?> json) {
    final id = json['id'] as String?;
    final publishedAt = parseTime(json['publishedAt']);
    if (id == null || id.isEmpty || publishedAt == null) return null;
    final expiresAt = parseTime(json['expiresAt']);

    final mediaKind = StoryMediaKind.tryParse(json['mediaKind'] as String?);
    final mediaUrl = json['mediaUrl'] as String?;
    final hasMedia = mediaKind != null && mediaUrl != null && mediaUrl.isNotEmpty;
    final kind = StoryKind.fromWire(json['kind'] as String?, mediaKind);
    final durationMs = json['mediaDurationMs'];

    return Story(
      id: id,
      kind: kind,
      body: kind == StoryKind.text ? _nonEmpty(json['body']) : null,
      background: _nonEmpty(json['background']),
      mediaKind: hasMedia ? mediaKind : null,
      mediaUrl: hasMedia ? mediaUrl : null,
      mediaDuration: durationMs is num && durationMs > 0
          ? Duration(milliseconds: durationMs.round())
          : null,
      cta: storyCta(json['cta']),
      publishedAt: publishedAt,
      expiresAt: expiresAt,
      isViewed: json['viewed'] == true,
    );
  }

  /// A story's button. An unknown kind, or a link/WhatsApp button with no address, is no
  /// button: a control that could only fail is worse than none.
  static StoryCta? storyCta(Object? raw) {
    if (raw is! Map) return null;
    final kind = StoryCtaKind.tryParse(raw['kind'] as String?);
    if (kind == null) return null;
    final url = _nonEmpty(raw['url']);
    if (kind != StoryCtaKind.messagePublisher && (url == null || !url.startsWith('https://'))) {
      return null;
    }
    return StoryCta(kind: kind, label: _nonEmpty(raw['label']), url: url);
  }

  /// What `POST /stories/:id/cta` answered.
  static StoryCtaTap? storyCtaTap(Map<String, Object?> json) {
    final kind = StoryCtaKind.tryParse(json['kind'] as String?);
    if (kind == null) return null;
    return StoryCtaTap(
      kind: kind,
      url: _nonEmpty(json['url']),
      conversationId: _nonEmpty(json['conversationId']),
    );
  }

  /// `GET /me/teacher-profile` and every teacher-facing mutation return this
  /// same flat object. There is no `{published, draft}` envelope any more and no
  /// state to interpret: what the server returns is what is current.
  ///
  /// `name` is required, because the profile is unrenderable without the
  /// teacher's identity -- but it is read from the response rather than from any
  /// local copy, so the client cannot drift from `chat.teacher`.
  static TeacherProfile teacherProfile(Map<String, Object?> json) => TeacherProfile(
        name: (json['name'] as String?)?.trim() ?? '',
        // A signed URL, short-lived by design. Never cached: holding it would be
        // holding a capability past the moment it was granted for.
        photoUrl: _nonEmpty(json['photoUrl']),
        bio: _nonEmpty(json['bio']),
        specialization: _nonEmpty(json['specialization']),
        qualifications: _nonEmpty(json['qualifications']),
        experience: _nonEmpty(json['experience']),
        languages: [
          for (final language in (json['languages'] as List?) ?? const [])
            if (language is String && language.trim().isNotEmpty) language.trim(),
        ],
        certificates: [
          for (final certificate in (json['certificates'] as List?) ?? const [])
            ?_certificate(certificate),
        ],
        updatedAt: parseTime(json['updatedAt']),
      );

  static ProfileCertificate? _certificate(Object? raw) {
    if (raw is! Map<String, Object?>) return null;
    final id = raw['id'] as String?;
    final title = _nonEmpty(raw['title']);
    final state = CertificateState.tryParse(raw['state'] as String?);
    // A claim with no id cannot be opened or removed, and one with no title has
    // nothing to show; either way it is unusable rather than partially usable.
    if (id == null || id.isEmpty || title == null || state == null) return null;

    return ProfileCertificate(
      id: id,
      title: title,
      state: state,
      issuingOrganization: _nonEmpty(raw['issuingOrganization']),
      issuedOn: parseTime(raw['issuedOn']),
      reviewNote: _nonEmpty(raw['reviewNote']),
    );
  }

  static String? _nonEmpty(Object? raw) {
    final value = raw as String?;
    if (value == null) return null;
    final trimmed = value.trim();
    return trimmed.isEmpty ? null : trimmed;
  }

  /// One member of a conversation, from `ConversationMemberDto`.
  ///
  /// `displayName` now comes off the wire (gap O3 closed). It used to be a named
  /// parameter defaulting to `''`, because the DTO carried no name at all and the
  /// caller had nothing to pass — so the parameter is gone rather than left as a
  /// second, quieter way to set a name.
  ///
  /// An absent or blank name stays `''`. The server sends `''` for a member whose
  /// actor no longer resolves, and the UI renders that as `groupMemberUnresolved`
  /// rather than an id — so empty is a value this client already knows how to
  /// show, not a defect to paper over here.
  static GroupMember groupMember(Map<String, Object?> json) {
    return GroupMember(
      id: (json['actorId'] as String?) ?? '',
      displayName: _nonEmpty(json['displayName']) ?? '',
      role: memberRole(json['memberRole'] as String?),
      // Absent or non-boolean reads as false: an advisory that defaulted to
      // "you may" would offer actions the server then refuses.
      canOpenDirect: json['canOpenDirect'] == true,
      avatarUrl: _nonEmpty(json['avatarUrl']),
      away: memberAway(json['away']),
    );
  }

  /// PD-26 `away: { kind, until }`. Anything but a well-formed object is "not away":
  /// a notice that guessed would tell a family something the server did not say.
  /// Every kind but `leave` reads as away -- staff's own kinds included.
  static MemberAway? memberAway(Object? raw) {
    if (raw is! Map) return null;
    final until = parseCalendarDay(raw['until']);
    if (until == null) return null;
    return MemberAway(
      kind: raw['kind'] == 'leave' ? MemberAwayKind.leave : MemberAwayKind.away,
      until: until,
    );
  }

  static CallOutcome callOutcome(String? raw) => switch (raw) {
        Wire.callAnswered => CallOutcome.answered,
        Wire.callDeclined => CallOutcome.declined,
        _ => CallOutcome.missed,
      };
}
