import 'user_role.dart';

/// How far an outgoing message has travelled.
///
/// The three local states ([queued], [sending], [failed]) are the only ones the client may
/// ever assign to itself. Everything from [sent] onwards is server-asserted — §16 forbids
/// fabricating "Delivered".
enum DeliveryState {
  queued,
  sending,
  sent,
  delivered,
  read,
  failed;

  bool get isLocal => this == queued || this == sending || this == failed;
  bool get isInFlight => this == queued || this == sending;

  static DeliveryState parse(String? raw) => switch (raw) {
        'sent' => DeliveryState.sent,
        'delivered' => DeliveryState.delivered,
        'read' => DeliveryState.read,
        _ => DeliveryState.sent,
      };
}

/// Student-group approval lifecycle (§26). Policy comes from the backend per conversation;
/// [notRequired] is used wherever approval does not apply.
enum ApprovalState {
  notRequired,
  pending,
  approved,
  rejected;

  static ApprovalState parse(String? raw) => switch (raw) {
        'pending' => ApprovalState.pending,
        'approved' => ApprovalState.approved,
        'rejected' => ApprovalState.rejected,
        _ => ApprovalState.notRequired,
      };

  /// Whether the message should be presented to its *sender* as not yet visible to others.
  bool get isWithheld => this == pending || this == rejected;
}

enum MessageKind { text, image, video, file, voice, system }

class Attachment {
  const Attachment({
    required this.id,
    required this.kind,
    this.fileName,
    this.byteSize,
    this.url,
    this.thumbnailUrl,
    this.mimeType,
    this.durationMs,
    this.waveform = const [],
  });

  final String id;
  final MessageKind kind;
  final String? fileName;
  final int? byteSize;

  /// Short-lived, backend-issued. Never a permanent storage URL (§22), and never
  /// persisted or cached — when it expires the message is re-fetched instead.
  ///
  /// While a voice note is still in the outbox this holds the *local* file path
  /// of the recording, so the sender can replay their own note before it has
  /// finished uploading.
  final String? url;

  final String? thumbnailUrl;
  final String? mimeType;

  /// Server-stored, so a list of voice notes renders its durations without
  /// decoding a single file (handoff §9).
  final int? durationMs;

  final List<double> waveform;

  Duration? get duration => durationMs == null ? null : Duration(milliseconds: durationMs!);

  /// A local recording that has not been uploaded yet.
  bool get isLocal => url != null && !url!.startsWith('http');
}

/// A quoted message shown above a reply.
class ReplyPreview {
  const ReplyPreview({
    required this.messageId,
    required this.authorName,
    required this.excerpt,
  });

  final String messageId;
  final String authorName;
  final String excerpt;
}

class Reaction {
  const Reaction({required this.emoji, required this.count, required this.mine});

  final String emoji;
  final int count;
  final bool mine;

  Reaction copyWith({int? count, bool? mine}) =>
      Reaction(emoji: emoji, count: count ?? this.count, mine: mine ?? this.mine);
}

/// A single message.
///
/// [clientMessageId] is generated once when the user composes and is **reused across every
/// retry** so the server can deduplicate (§16, §17). [sequence] is the server-authoritative
/// ordering key — local timestamps are not trusted to order across devices (§18).
class Message {
  const Message({
    required this.clientMessageId,
    required this.conversationId,
    required this.kind,
    required this.createdAt,
    required this.deliveryState,
    this.id,
    this.sequence,
    this.authorId,
    this.authorName = '',
    this.authorRole = ParticipantRole.unknown,
    this.body = '',
    this.attachments = const [],
    this.replyTo,
    this.replyToMessageId,
    this.reactions = const [],
    this.approvalState = ApprovalState.notRequired,
    this.rejectionReason,
    this.isMine = false,
    this.isDeleted = false,
    this.failureCode,
  });

  /// Server id. Null until the server has accepted the message.
  final String? id;

  /// Stable client-generated id. Never changes, including across retries.
  final String clientMessageId;

  final String conversationId;

  /// Server-authoritative ordering key within the conversation. Null while pending.
  final int? sequence;

  final String? authorId;
  final String authorName;
  final ParticipantRole authorRole;
  final MessageKind kind;
  final String body;
  final List<Attachment> attachments;

  /// The quote to render above this bubble.
  ///
  /// Set only on the **local echo**, where the composer already knows what the
  /// user was replying to. Everything that came from the server carries
  /// [replyToMessageId] instead and has its quote resolved from the loaded log,
  /// because `MessageDto` embeds no preview — see `WireMappers.message`.
  final ReplyPreview? replyTo;

  /// The message this one answers, as the server records it. Always within the
  /// same conversation: the API refuses a cross-conversation reply target
  /// (`COMM.REPLY_TARGET_CROSS_CONVERSATION`).
  final String? replyToMessageId;

  final List<Reaction> reactions;
  final DeliveryState deliveryState;
  final ApprovalState approvalState;
  final String? rejectionReason;
  final DateTime createdAt;
  final bool isMine;
  final bool isDeleted;

  /// Machine-readable reason a send failed, for choosing the retry affordance.
  final String? failureCode;

  bool get isSystem => kind == MessageKind.system;
  bool get isPending => deliveryState.isInFlight;
  bool get canRetry => deliveryState == DeliveryState.failed;

  /// A pending or rejected group message must not look delivered to its sender (§15, §26).
  bool get isVisibleToOthers =>
      !approvalState.isWithheld && !deliveryState.isLocal && !isDeleted;

  /// Re-key this message to the client id it was composed under.
  ///
  /// Used only for the response to our own send, where the correspondence is certain.
  Message withClientMessageId(String value) => Message(
        id: id,
        clientMessageId: value,
        conversationId: conversationId,
        sequence: sequence,
        authorId: authorId,
        authorName: authorName,
        authorRole: authorRole,
        kind: kind,
        body: body,
        attachments: attachments,
        replyTo: replyTo,
        replyToMessageId: replyToMessageId,
        reactions: reactions,
        deliveryState: deliveryState,
        approvalState: approvalState,
        rejectionReason: rejectionReason,
        createdAt: createdAt,
        isMine: isMine,
        isDeleted: isDeleted,
        failureCode: failureCode,
      );

  Message copyWith({
    String? id,
    int? sequence,
    DeliveryState? deliveryState,
    ApprovalState? approvalState,
    String? rejectionReason,
    List<Reaction>? reactions,
    String? failureCode,
    bool? isDeleted,
  }) {
    return Message(
      id: id ?? this.id,
      clientMessageId: clientMessageId,
      conversationId: conversationId,
      sequence: sequence ?? this.sequence,
      authorId: authorId,
      authorName: authorName,
      authorRole: authorRole,
      kind: kind,
      body: body,
      attachments: attachments,
      replyTo: replyTo,
      replyToMessageId: replyToMessageId,
      reactions: reactions ?? this.reactions,
      deliveryState: deliveryState ?? this.deliveryState,
      approvalState: approvalState ?? this.approvalState,
      rejectionReason: rejectionReason ?? this.rejectionReason,
      createdAt: createdAt,
      isMine: isMine,
      isDeleted: isDeleted ?? this.isDeleted,
      failureCode: failureCode ?? this.failureCode,
    );
  }
}
