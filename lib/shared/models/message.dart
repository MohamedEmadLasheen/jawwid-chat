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

/// The reactions this client offers.
///
/// Mirrors `ALLOWED_REACTIONS` in
/// `apps/api/src/communication/contracts/vocab.ts`. The server rejects anything
/// outside its own list, so offering a wider picker here would only produce
/// refusals the user cannot understand.
const kReactionEmoji = <String>['👍', '❤️', '😂', '😮', '😢', '🙏'];

class Attachment {
  const Attachment({
    required this.id,
    required this.kind,
    this.fileName,
    this.byteSize,
    this.url,
    this.mimeType,
    this.thumbnailUrl,
    this.durationMs,
    this.waveform = const [],
  });

  final String id;
  final MessageKind kind;
  final String? fileName;
  final int? byteSize;

  /// Short-lived, backend-issued, minted PER READ. Never a permanent storage
  /// URL, and never cached beyond the message it arrived with — the server
  /// re-authorizes on every fetch, so a URL held past its expiry is simply
  /// dead rather than a way around that check.
  ///
  /// Null for a message this client has just sent and not yet had back from the
  /// server: the object exists, but no signed read has been minted for it.
  final String? url;

  final String? mimeType;

  /// Short-lived, backend-issued. Never a permanent storage URL (§22).
  final String? thumbnailUrl;
  final int? durationMs;
  final List<double> waveform;
}

/// Why a quoted message cannot be shown.
///
/// The distinction is not pedantry: "deleted" is a thing the other person did
/// and the reader should understand as such, whereas "unavailable" covers a
/// message this reader specifically cannot see. Collapsing them would tell a
/// parent that a supervisor's internal note had been deleted, which is both
/// wrong and a disclosure.
enum QuoteUnavailableReason { deleted, restricted, missing }

/// A quoted message shown above a reply.
///
/// A quote may exist WITHOUT its content: the reply still renders, and the
/// quote reads as "this message is no longer available". That is the graceful
/// degradation §14 asks for — the alternative, dropping the quote entirely,
/// makes the reply look like it was addressed to nothing.
class ReplyPreview {
  const ReplyPreview({
    required this.messageId,
    required this.authorName,
    required this.excerpt,
    this.isAvailable = true,
    this.unavailableReason,
  });

  /// A quote whose target this reader may not see. Carries no excerpt, ever.
  const ReplyPreview.unavailable({
    required this.messageId,
    required QuoteUnavailableReason reason,
  })  : authorName = '',
        excerpt = '',
        isAvailable = false,
        unavailableReason = reason;

  final String messageId;
  final String authorName;
  final String excerpt;

  /// False when the target is deleted, restricted or gone.
  final bool isAvailable;
  final QuoteUnavailableReason? unavailableReason;

  static QuoteUnavailableReason? parseReason(String? raw) => switch (raw) {
        'deleted' => QuoteUnavailableReason.deleted,
        'restricted' => QuoteUnavailableReason.restricted,
        'missing' => QuoteUnavailableReason.missing,
        _ => null,
      };
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
    this.reactions = const [],
    this.approvalState = ApprovalState.notRequired,
    this.rejectionReason,
    this.isMine = false,
    this.isDeleted = false,
    this.isForwarded = false,
    this.editedAt,
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
  final ReplyPreview? replyTo;
  final List<Reaction> reactions;
  final DeliveryState deliveryState;
  final ApprovalState approvalState;
  final String? rejectionReason;
  final DateTime createdAt;
  final bool isMine;

  /// True for a message withdrawn for EVERYONE. A message the user hid for
  /// themselves is not marked deleted — it is simply not in the log.
  final bool isDeleted;

  /// Shown as a small "forwarded" marker. Deliberately a flag and not a source
  /// reference: the conversation a message came from is usually one this reader
  /// may not access, so the backend serves a boolean and nothing more.
  final bool isForwarded;

  /// When the author last replaced the body. Null means never edited.
  final DateTime? editedAt;

  bool get isEdited => editedAt != null;

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
        reactions: reactions,
        deliveryState: deliveryState,
        approvalState: approvalState,
        rejectionReason: rejectionReason,
        createdAt: createdAt,
        isMine: isMine,
        isDeleted: isDeleted,
        isForwarded: isForwarded,
        editedAt: editedAt,
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
    String? body,
    DateTime? editedAt,
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
      body: body ?? this.body,
      attachments: attachments,
      replyTo: replyTo,
      reactions: reactions ?? this.reactions,
      deliveryState: deliveryState ?? this.deliveryState,
      approvalState: approvalState ?? this.approvalState,
      rejectionReason: rejectionReason ?? this.rejectionReason,
      createdAt: createdAt,
      isMine: isMine,
      isDeleted: isDeleted ?? this.isDeleted,
      isForwarded: isForwarded,
      editedAt: editedAt ?? this.editedAt,
      failureCode: failureCode ?? this.failureCode,
    );
  }
}
