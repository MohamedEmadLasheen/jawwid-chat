import '../../features/messages/domain/outgoing_attachment.dart';
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

/// How a call ended. Mirrors `CallOutcome` in
/// `apps/api/src/communication/contracts/vocab.ts`.
///
/// [cancelled] and [failed] are Phase 5 additions, and the distinction is not
/// cosmetic: both used to be shown as "missed", which tells the recipient they
/// failed to pick up a call the caller withdrew, or that the network dropped.
enum CallOutcome { answered, missed, declined, cancelled, failed }

/// Where a call is in its lifecycle. Mirrors `CallStatus`.
///
/// The SERVER owns this. The client renders it and never advances it: a screen
/// that decided locally that a call had connected would be showing a call that
/// the server, and therefore the other participant, knows nothing about.
enum CallStatus { initiated, ringing, active, ended }

/// Whether this call may be recorded. Mirrors `CallMode`.
///
/// Fixed by the server when the call is created. The client DISPLAYS it -- a
/// recording indicator is not optional -- and can never set it.
enum CallMode { normal, followUp }

/// What kind of call this is. Mirrors `CallType`.
enum CallKind { direct, group, classCall }

/// One invitee's relationship to a call. Mirrors `CallParticipantState`.
enum CallParticipantState { invited, joined, declined, left, missed }

class CallParticipantView {
  const CallParticipantView({
    required this.actorId,
    required this.state,
    this.joinedAt,
  });

  final String actorId;
  final CallParticipantState state;
  final DateTime? joinedAt;
}

/// The server's view of a call, as every transition returns it.
///
/// Every accept/decline/end call returns one of these rather than an
/// acknowledgement, because a client that has just acted on a call needs to
/// know what the SERVER decided -- especially when its request changed nothing
/// because somebody else got there first.
class CallView {
  const CallView({
    required this.id,
    required this.conversationId,
    required this.kind,
    required this.mode,
    required this.status,
    required this.initiatorId,
    required this.startedAt,
    this.outcome,
    this.answeredAt,
    this.endedAt,
    this.ringExpiresAt,
    this.duration,
    this.hasRecording = false,
    this.participants = const [],
  });

  final String id;
  final String conversationId;
  final CallKind kind;
  final CallMode mode;
  final CallStatus status;
  final String initiatorId;
  final DateTime startedAt;
  final CallOutcome? outcome;
  final DateTime? answeredAt;
  final DateTime? endedAt;

  /// When an unanswered invitation stops being valid. Lets the client stop
  /// ringing on its own instead of ringing until the user gives up -- but the
  /// SERVER is still what makes the call missed.
  final DateTime? ringExpiresAt;
  final Duration? duration;

  /// Whether a recording exists AND this viewer is allowed to know that.
  /// False for everyone else -- including participants of the call.
  final bool hasRecording;
  final List<CallParticipantView> participants;

  bool get isLive => status == CallStatus.ringing || status == CallStatus.active;
  bool get isRecordable => mode == CallMode.followUp;
}

/// An incoming call, as the ring screen needs it.
///
/// Deliberately carries only what the recipient is authorized to see: who is
/// calling (a display name, never a phone number), what kind of call, the
/// conversation it belongs to, whether it may be recorded, and when the
/// invitation lapses.
class IncomingCall {
  const IncomingCall({
    required this.callId,
    required this.conversationId,
    required this.callerName,
    required this.kind,
    required this.mode,
    this.expiresAt,
    this.groupName,
  });

  final String callId;
  final String conversationId;

  /// A display name. §5 makes phone numbers unrenderable.
  final String callerName;
  final CallKind kind;
  final CallMode mode;
  final DateTime? expiresAt;

  /// Set for a class call, so the ring screen can name the class.
  final String? groupName;

  bool get isClassCall => kind == CallKind.classCall;

  /// Whether this invitation is still worth showing.
  ///
  /// A push that arrives late, or an app resumed long after the fact, must not
  /// present a ringing screen for a call that ended twenty minutes ago.
  bool isStale(DateTime now) => expiresAt != null && !expiresAt!.isAfter(now);
}

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

/// Draft of an outgoing message, handed to the transport layer.
class OutgoingMessage {
  const OutgoingMessage({
    required this.clientMessageId,
    required this.conversationId,
    required this.kind,
    this.body = '',
    this.replyToMessageId,
    this.attachments = const [],
  });

  /// Generated once at compose time and reused on every retry (§16, §17).
  final String clientMessageId;
  final String conversationId;
  final MessageKind kind;
  final String body;
  final String? replyToMessageId;
  /// Objects ALREADY IN STORAGE that this message names.
  ///
  /// Metadata, not files: the upload completes before the message is queued, so
  /// what the offline outbox persists is a few hundred bytes it can actually
  /// keep rather than a video it cannot.
  final List<OutgoingAttachment> attachments;
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

/// One message search result, with the conversation it was found in.
///
/// The conversation context travels with the hit because a global search shows
/// results across threads, and a result the user cannot place is not a result.
class MessageSearchHit {
  const MessageSearchHit({
    required this.message,
    required this.conversationId,
    required this.conversationTitle,
  });

  final Message message;
  final String conversationId;
  final String conversationTitle;
}

/// The filters a message search may carry (§23).
class MessageSearchQuery {
  const MessageSearchQuery({
    required this.text,
    this.conversationId,
    this.authorId,
    this.from,
    this.to,
  });

  final String text;

  /// Restrict to one conversation. Authorized by the server exactly as opening
  /// that conversation would be.
  final String? conversationId;
  final String? authorId;
  final DateTime? from;
  final DateTime? to;

  bool get isEmpty => text.trim().length < 2;
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

  /// Replace the body of one's own message. The server enforces authorship and
  /// the edit window; the UI hides the action when it is clearly unavailable,
  /// but never decides it.
  Future<Message> edit({
    required String conversationId,
    required String messageId,
    required String body,
  });

  /// Hide a message from THIS user's view only. Others keep their copy.
  Future<void> deleteForMe({
    required String conversationId,
    required String messageId,
  });

  /// Withdraw a message from everyone who can see it.
  Future<void> deleteForEveryone({
    required String conversationId,
    required String messageId,
    required String reason,
  });

  /// Copy a message into other conversations. The server authorizes the source
  /// and every destination independently.
  Future<List<Message>> forward({
    required String conversationId,
    required String messageId,
    required List<String> toConversationIds,
  });

  Future<void> react(String conversationId, String messageId, String emoji);

  Future<void> removeReaction(String conversationId, String messageId);

  /// Confirm to the server that these messages are on this device.
  Future<void> markDelivered({
    required String conversationId,
    required String messageId,
  });

  /// Scoped strictly to conversations the caller is authorized for (§41).
  Future<List<MessageSearchHit>> search(MessageSearchQuery query);

  Future<void> setTyping(String conversationId, {required bool isTyping});
}

/// Permission to put bytes in object storage, minted by the server.
///
/// The client never composes an object key. `authorizeUpload` runs the same
/// read authorization the conversation itself does and returns a key bound to
/// that conversation; a key from anywhere else is refused when the message
/// naming it is sent.
class UploadGrant {
  const UploadGrant({
    required this.objectKey,
    required this.uploadUrl,
    required this.headers,
    required this.expiresAt,
  });

  final String objectKey;
  final String uploadUrl;
  final Map<String, String> headers;
  final DateTime? expiresAt;
}

/// Attachment upload, against
/// `apps/api/src/communication/api/message.controller.ts`.
///
/// | Method | Path | Body |
/// |---|---|---|
/// | POST | `/conversations/:id/messages/attachments/authorize` | `{ kind, mimeType, byteSize }` |
///
/// The PUT that follows goes to OBJECT STORAGE, not to this API, and carries no
/// session credential — the URL is presigned and its signature is the
/// authorization. Sending a bearer token to a third-party storage host would
/// hand that host a credential for this system.
abstract interface class AttachmentRepository {
  Future<UploadGrant> authorizeUpload({
    required String conversationId,
    required String kind,
    required String mimeType,
    required int byteSize,
  });

  /// PUT the bytes at [grant]. Returns when storage has accepted them.
  Future<void> putObject({
    required UploadGrant grant,
    required String filePath,
    void Function(int sent, int total)? onProgress,
  });
}

/// Device push tokens, against `apps/api/src/communication/api/notification.controller.ts`.
///
/// | Method | Path | Body |
/// |---|---|---|
/// | POST | `/notifications/devices` | `{ token, platform, isVoip?, locale? }` |
/// | DELETE | `/notifications/devices/:token` | — |
///
/// Both are scoped to the authenticated caller by the server: registration
/// binds the token to the bearer's actor, and de-registration only matches the
/// caller's own rows. There is no route that touches somebody else's device.
abstract interface class NotificationRepository {
  Future<void> registerDevice({
    required String token,
    required String platform,
    bool isVoip,
    String? locale,
  });

  /// Retire a token. Called at sign-out, so the next person to use this handset
  /// does not receive the previous account's notifications.
  Future<void> unregisterDevice(String token);
}

abstract interface class GroupRepository {
  Future<StudentGroup> group(String conversationId);
}

abstract interface class CallRepository {
  /// Ask the backend to authorize a call. Throws an [AppError] with
  /// [AppErrorKind.forbidden] when policy refuses; the client must not retry or improvise.
  ///
  /// [followUp] asks for a RECORDABLE call and is refused unless this account
  /// holds `calls.record`. The client asks; the server decides, and the mode it
  /// returns on [CallView] is the truth.
  Future<CallGrant> requestGrant({
    required String conversationId,
    bool followUp = false,
  });

  /// A teacher opens the class. Refused unless this actor may start a group
  /// call in that conversation.
  Future<CallGrant> startClassCall({required String conversationId});

  Future<CallGrant> acceptIncoming({required String callId});

  Future<void> decline({required String callId});

  /// The caller withdraws before anybody answers. Initiator only.
  Future<CallView> cancel({required String callId});

  /// Hang up. Safe to call twice: the server treats a repeat as a no-op rather
  /// than rewriting a finished call.
  Future<CallView> end({required String callId, bool failed = false});

  /// The server's current view. THE way a client recovers after a reconnect,
  /// a cold start, or a missed realtime event.
  Future<CallView> callById(String callId);

  Future<Page<CallHistoryEntry>> history({String? cursor});

  /// Full call records for one conversation, including recording availability
  /// where this viewer is entitled to know about it.
  Future<List<CallView>> conversationHistory(String conversationId);

  /// Mint a short-lived playback URL for a recording. Authorized and audited
  /// server-side on every request; the client stores nothing.
  Future<RecordingPlayback> recordingPlayback({required String recordingId});
}

/// A short-lived, authorized playback grant.
///
/// Held in memory for as long as the player needs it and never persisted: it is
/// a bearer credential, and one written to disk outlives every check that
/// produced it.
class RecordingPlayback {
  const RecordingPlayback({
    required this.url,
    required this.expiresAt,
    this.duration,
  });

  final String url;
  final DateTime expiresAt;
  final Duration? duration;
}

// ---------------------------------------------------------------------------------------
// Stories and broadcast (Phase 5).
//
// Note what neither repository exposes: any way to state WHO receives something.
// A client sends an AUDIENCE -- "this label, that group" -- and the server
// resolves it. Audience resolution lives in exactly one place, and it is not here.
// ---------------------------------------------------------------------------------------

// Audience AUTHORING is absent from this client too, for the same reason
// broadcast is: composing an audience is a publisher's act, and this app cannot
// authenticate as a publisher. A reader receives stories; they never state who
// else does.
class Story {
  const Story({
    required this.id,
    required this.state,
    this.title,
    this.body,
    this.mediaUrl,
    this.mediaKind,
    this.publishedAt,
    this.expiresAt,
    this.viewed = false,
  });

  final String id;
  final String state;
  final String? title;
  final String? body;

  /// Signed and short-lived, minted per read. Never cached to disk.
  final String? mediaUrl;
  final String? mediaKind;
  final DateTime? publishedAt;
  final DateTime? expiresAt;
  final bool viewed;

  /// Note what a reader's story does NOT carry: the audience it was published
  /// to, and how many people received it. A parent who learned they were
  /// reached via "the Installments label" would learn how the academy files its
  /// customers. The server does not send those fields to a reader, and this
  /// model has nowhere to put them if it did.
  bool get isPublished => state == 'published';
}

abstract interface class StoryRepository {
  /// The stories published to THIS reader.
  ///
  /// Server-filtered, and there is deliberately no unfiltered variant to reach
  /// for by mistake: the client cannot ask for stories it is not in the
  /// audience of, so there is no client-side filtering to get wrong.
  Future<List<Story>> feed();

  /// Record that this reader watched a story. Idempotent.
  Future<void> markViewed(String storyId);
}

// Broadcast is deliberately ABSENT from this client.
//
// [UserRole] is `parent | teacher`: this app cannot authenticate as the roles
// that may send a broadcast, so a repository for it here would be dead code
// with a permission check as its only body. Composing, queueing and monitoring
// a broadcast live in the operations console (`apps/admin-web`).
//
// A broadcast reaches a parent as an ORDINARY MESSAGE in their conversation --
// `origin: broadcast`, delivered by the fan-out worker through the same
// messaging engine as everything else -- which is why nothing on this client
// has to know broadcasts exist at all.
