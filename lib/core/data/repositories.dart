import '../../shared/models/auth.dart';
import '../../shared/models/conversation.dart';
import '../../shared/models/message.dart';
import '../../shared/models/user_role.dart';

/// One page of a cursor-paginated list (§19).
class Page<T> {
  const Page({required this.items, this.nextCursor, this.hasMore = false});

  final List<T> items;
  final String? nextCursor;
  final bool hasMore;
}

/// A member of a student group, as shown in the members sheet.
///
/// There is no phone-number field. §5 makes phone numbers unrenderable, so the client does
/// not model them and cannot leak what it never receives.
class GroupMember {
  const GroupMember({
    required this.id,
    required this.displayName,
    required this.role,
    this.avatarUrl,
  });

  final String id;
  final String displayName;
  final ParticipantRole role;
  final String? avatarUrl;
}

class StudentGroup {
  const StudentGroup({
    required this.conversationId,
    required this.learner,
    required this.members,
    this.requiresApproval = false,
  });

  final String conversationId;
  final LearnerRef learner;
  final List<GroupMember> members;
  final bool requiresApproval;
}

/// A backend-authorized call session.
///
/// The client never constructs a room name and never self-authorizes (§31, §35): it receives
/// [serverUrl] and a short-lived [token] from the backend, or it does not join at all.
class CallGrant {
  const CallGrant({
    required this.callId,
    required this.serverUrl,
    required this.token,
    required this.expiresAt,
  });

  final String callId;
  final String serverUrl;
  final String token;
  final DateTime expiresAt;
}

enum CallOutcome { answered, missed, declined }

class CallHistoryEntry {
  const CallHistoryEntry({
    required this.id,
    required this.conversationId,
    required this.title,
    required this.startedAt,
    required this.outcome,
    required this.isGroup,
    this.duration,
  });

  final String id;
  final String conversationId;

  /// A display name — "Jawwid", "Mr. Ahmed". Never a phone number (§36).
  final String title;
  final DateTime startedAt;
  final CallOutcome outcome;
  final bool isGroup;
  final Duration? duration;
}

/// A device/session this user is signed in on (§9, §43).
class DeviceSession {
  const DeviceSession({
    required this.id,
    required this.label,
    required this.platform,
    required this.lastSeenAt,
    this.isCurrent = false,
  });

  final String id;
  final String label;
  final String platform;
  final DateTime lastSeenAt;
  final bool isCurrent;
}

/// A recording sitting on disk that has not been uploaded yet.
///
/// Held separately from [UploadedAttachment] because the two are at different
/// stages of the same journey, and confusing them is how a retry re-uploads the
/// same bytes.
class PendingVoiceNote {
  const PendingVoiceNote({
    required this.filePath,
    required this.mimeType,
    required this.byteSize,
    required this.duration,
  });

  final String filePath;
  final String mimeType;
  final int byteSize;
  final Duration duration;
}

/// A photo or document the user chose, sitting on disk, not yet uploaded.
///
/// The sibling of [PendingVoiceNote], and deliberately a separate type rather
/// than a widened one: a voice note carries a duration and never a file name,
/// a document carries a file name and never a duration, and collapsing them
/// would give every call site two fields it has to remember not to read.
class PendingAttachment {
  const PendingAttachment({
    required this.filePath,
    required this.kind,
    required this.mimeType,
    required this.byteSize,
    this.fileName,
  });

  final String filePath;

  /// [MessageKind.image] or [MessageKind.file]. Never voice — that is
  /// [PendingVoiceNote] — and never text or system.
  final MessageKind kind;

  final String mimeType;
  final int byteSize;

  /// What the user will see on a file bubble. Null for a photo, which is shown
  /// rather than named.
  final String? fileName;
}

/// An attachment whose bytes are already in storage, addressed by the object key
/// the backend minted. This is what a message is sent with.
class UploadedAttachment {
  const UploadedAttachment({
    required this.kind,
    required this.objectKey,
    required this.mimeType,
    required this.byteSize,
    this.durationMs,
  });

  final MessageKind kind;
  final String objectKey;
  final String mimeType;
  final int byteSize;
  final int? durationMs;
}

/// Draft of an outgoing message, handed to the transport layer.
class OutgoingMessage {
  const OutgoingMessage({
    required this.clientMessageId,
    required this.conversationId,
    required this.kind,
    this.body = '',
    this.replyToMessageId,
    this.attachments = const [],
    this.voiceNote,
    this.pendingAttachment,
  });

  /// Generated once at compose time and reused on every retry (§16, §17).
  final String clientMessageId;
  final String conversationId;
  final MessageKind kind;
  final String body;
  final String? replyToMessageId;

  /// Already in storage; safe to re-send verbatim on a retry.
  final List<UploadedAttachment> attachments;

  /// Still on disk. Non-null only until the upload succeeds.
  final PendingVoiceNote? voiceNote;

  /// A photo or document still on disk. Non-null only until the upload
  /// succeeds. Mutually exclusive with [voiceNote] — one message, one pending
  /// payload.
  final PendingAttachment? pendingAttachment;

  bool get needsUpload => voiceNote != null || pendingAttachment != null;

  /// Promote a finished upload. The pending payload is dropped, so a later
  /// retry re-sends the object key rather than pushing the bytes a second time.
  OutgoingMessage withUploaded(UploadedAttachment attachment) => OutgoingMessage(
        clientMessageId: clientMessageId,
        conversationId: conversationId,
        kind: kind,
        body: body,
        replyToMessageId: replyToMessageId,
        attachments: [...attachments, attachment],
      );
}

// ---------------------------------------------------------------------------------------
// Repository interfaces.
//
// The app depends only on these. Two implementations exist: an in-memory fake used by tests
// and local development, and an HTTP/WebSocket one written against the contract proposed in
// docs/mobile/backend-dependencies.md. See decision D4 — that contract is a request awaiting
// AI #1 / AI #2 sign-off, so keeping it behind a seam is what stops an unagreed protocol from
// spreading through the UI.
// ---------------------------------------------------------------------------------------

abstract interface class AuthRepository {
  Future<AuthSession> signIn({
    required String username,
    required String password,
  });

  /// The server-asserted principal. Never inferred from a cached value (§7).
  Future<AuthUser> currentUser();

  Future<AuthSession> refresh(String refreshToken);

  Future<void> signOut();

  Future<List<DeviceSession>> devices();

  Future<void> revokeDevice(String deviceId);

  /// Emits when the backend ends this session — revoked elsewhere, or account disabled.
  Stream<void> get sessionRevoked;
}

abstract interface class ConversationRepository {
  Future<List<Conversation>> list({bool includeArchived = false});

  Future<Conversation> byId(String conversationId);

  Future<void> setPinned(String conversationId, bool pinned);

  Future<void> setMuted(String conversationId, bool muted);

  Future<void> setArchived(String conversationId, bool archived);

  Future<void> markRead(String conversationId, {required int throughSequence});

  /// Scoped strictly to the caller's own authorized conversations — never a directory (§41).
  Future<List<Conversation>> search(String query);
}

abstract interface class MessageRepository {
  /// Newest page first when [beforeCursor] is null; older pages thereafter (§19).
  Future<Page<Message>> history(
    String conversationId, {
    String? beforeCursor,
    int limit = 30,
  });

  /// Everything the client missed, given the highest sequence it holds (§49).
  Future<List<Message>> since(String conversationId, {required int afterSequence});

  Future<Message> send(OutgoingMessage message);

  /// Put a recording into storage and return the reference to attach to a
  /// message.
  ///
  /// Two steps behind one call, matching the published contract: authorize —
  /// which is where the backend enforces MIME and size *before* the user waits
  /// for a transfer — then PUT the bytes to the returned signed URL. The bytes
  /// never pass through the API.
  Future<UploadedAttachment> uploadVoiceNote({
    required String conversationId,
    required PendingVoiceNote note,
  });

  /// The same two steps as [uploadVoiceNote], for a photo or a document.
  ///
  /// Kept as its own method rather than folded into the voice one: the two take
  /// different descriptions of what is on disk, and the voice path is covered by
  /// its own suite that has no business changing because photos arrived.
  Future<UploadedAttachment> uploadAttachment({
    required String conversationId,
    required PendingAttachment attachment,
  });

  /// [conversationId] is part of the route, not a convenience: every message
  /// endpoint is nested under its conversation, and that is where the server
  /// re-checks membership.
  Future<void> react({
    required String conversationId,
    required String messageId,
    required String emoji,
  });

  /// [emoji] is sent so the removal cannot race a replacement — the server
  /// no-ops when the stored reaction is a different one.
  Future<void> removeReaction({
    required String conversationId,
    required String messageId,
    required String emoji,
  });

  /// Hide a message for the caller alone. Everyone else still sees it.
  Future<void> deleteForMe({
    required String conversationId,
    required String messageId,
  });

  /// Retract a message for everyone.
  ///
  /// The server is the authority: the author may do this only inside its
  /// configured window, and nobody may do it to someone else's message. The
  /// window length is on no DTO the client can read, so this call can be
  /// refused (`COMM.DELETE_WINDOW_EXPIRED`) after the action was offered — the
  /// caller must present that refusal, never pre-empt it with a guess.
  Future<void> deleteForEveryone({
    required String conversationId,
    required String messageId,
  });

  Future<void> setTyping(String conversationId, {required bool isTyping});
}

abstract interface class GroupRepository {
  Future<StudentGroup> group(String conversationId);
}

abstract interface class CallRepository {
  /// Ask the backend to authorize a call. Throws an [AppError] with
  /// [AppErrorKind.forbidden] when policy refuses; the client must not retry or improvise.
  Future<CallGrant> requestGrant({required String conversationId});

  Future<CallGrant> acceptIncoming({required String callId});

  Future<void> decline({required String callId});

  Future<Page<CallHistoryEntry>> history({String? cursor});
}
