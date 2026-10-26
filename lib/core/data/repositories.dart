import '../../shared/models/auth.dart';
import '../../shared/models/conversation.dart';
import '../../shared/models/lesson.dart';
import '../../shared/models/message.dart';
import '../../shared/models/parent_billing.dart';
import '../../shared/models/parent_profile.dart';
import '../../shared/models/story.dart';
import '../../shared/models/student_profile.dart';
import '../../shared/models/supervision.dart';
import '../../shared/models/teacher_feedback.dart';
import '../../shared/models/teacher_profile.dart';
import '../../shared/models/trial.dart';
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
/// PD-26: a teacher member who is away today, and the last day they are away.
///
/// Staff read why; a parent or teacher reads [MemberAwayKind.leave] or
/// [MemberAwayKind.away] (a suspension or a recorded day off is the
/// administration's business). Messaging still works; the chat only says so.
enum MemberAwayKind { leave, away }

class MemberAway {
  const MemberAway({required this.kind, required this.until});

  final MemberAwayKind kind;

  /// A calendar day: the same day in every time zone.
  final DateTime until;
}

class GroupMember {
  const GroupMember({
    required this.id,
    required this.displayName,
    required this.role,
    this.avatarUrl,
    this.canOpenDirect = false,
    this.away,
  });

  final String id;
  final String displayName;
  final ParticipantRole role;
  final String? avatarUrl;

  /// Whether the server says the viewer may open a 1:1 with this member.
  ///
  /// Advisory, exactly like the call capability: it decides what the UI may
  /// OFFER, never what the server will allow. PD-6 made the teacher/parent
  /// pairing undecidable from roles alone, so the client stopped guessing and
  /// asks; since PD-7 the server answers false for that pairing always. Defaults
  /// to false, which is what a server that does not send the field — an older
  /// build — correctly yields.
  final bool canOpenDirect;

  /// PD-26. Null when not away, and from a server that does not send it.
  final MemberAway? away;
}

/// PD-36: someone asked to step in who is not a member -- an admin, a manager. Shown at the
/// top of Group Info, highlighted, until they join or the request lapses. Name and role are
/// shown to everyone in the group (owner decision 2026-10-26).
class SummonedPerson {
  const SummonedPerson({
    required this.id,
    required this.displayName,
    required this.staffRole,
    required this.at,
    this.steppedIn = false,
    this.mentionedByName,
  });

  final String id;
  final String displayName;

  /// 'super_admin' | 'manager' | 'admin' | 'coverage'.
  final String staffRole;
  final DateTime at;

  /// In a 1:1 they "step in" without a seat; otherwise they are waiting.
  final bool steppedIn;
  final String? mentionedByName;
}

class StudentGroup {
  const StudentGroup({
    required this.conversationId,
    required this.learner,
    required this.members,
    this.requiresApproval = false,
    this.summoned = const [],
  });

  final String conversationId;
  final LearnerRef learner;
  final List<GroupMember> members;
  final bool requiresApproval;

  /// PD-36: asked in, not (yet) members.
  final List<SummonedPerson> summoned;
}

/// Whether the server would let this actor START a call in a conversation.
///
/// ADVISORY, and short-lived. It is what the policy says at the moment it was
/// asked, and it is not a promise about the request that follows: authorization
/// can be revoked in between, and `POST /calls` decides again. The interface
/// uses it to know whether to OFFER a call — `screens/call.md` §4 requires the
/// affordance to be absent where the backend does not authorize the pairing —
/// and for nothing else.
///
/// Never cache it. The relationship it reflects can change at any time.
class CallCapability {
  const CallCapability({required this.canCall, this.code});

  final bool canCall;

  /// The server's own `COMM.*` code when refused, null when allowed. A stable
  /// identifier for which rule said no, never a sentence and never a name.
  final String? code;
}

/// A call the server has created and is ringing.
class StartedCall {
  const StartedCall({required this.callId, required this.roomName});

  final String callId;

  /// The server's handle for the media room. Carried because the API returns
  /// it; W3 does nothing with it. Joining is W4's.
  final String roomName;
}

/// A short-lived credential for the media room.
///
/// The client never constructs a room name and never self-authorizes (§31,
/// §35): it receives [serverUrl] and [token] from the backend, or it does not
/// join at all.
///
/// W3 OBTAINS THIS AND DOES NOT USE IT. No LiveKit client exists yet; parsing
/// this into one is W4. It is modelled here because the endpoint is part of the
/// call contract, not because anything consumes it.
class CallMediaGrant {
  const CallMediaGrant({
    required this.token,
    required this.serverUrl,
    required this.roomName,
    required this.expiresAt,
  });

  final String token;
  final String serverUrl;
  final String roomName;
  final DateTime expiresAt;
}

enum CallOutcome { answered, missed, declined }

/// Who placed a call in the account history, as the server's `initiatorId`
/// says, compared with the signed-in actor. Presentation only: it picks the
/// row's arrow, never a permission.
enum CallHistoryDirection { outgoing, incoming }

class CallHistoryEntry {
  const CallHistoryEntry({
    required this.id,
    required this.conversationId,
    required this.title,
    required this.startedAt,
    required this.outcome,
    required this.isGroup,
    this.duration,
    this.direction,
  });

  final String id;
  final String conversationId;

  /// A display name — "Jawwid", "Mr. Ahmed". Never a phone number (§36).
  final String title;
  final DateTime startedAt;
  final CallOutcome outcome;
  final bool isGroup;
  final Duration? duration;

  /// Null when the row did not say who placed it, or before a session exists.
  final CallHistoryDirection? direction;
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
    this.mentions = const [],
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

  /// PD-36: the "@..." spans in [body]. The server resolves and checks every one; a mention
  /// of someone the sender may not reach refuses the send.
  final List<MessageMention> mentions;

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
        mentions: mentions,
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
  /// [remember] is PD-23's "keep me signed in on this device". Only the PD-28 browser sends
  /// it (the phone keeps every session in the Keychain / Keystore); the server decides whether
  /// it is granted and says so in [AuthSession.remembered].
  Future<AuthSession> signIn({
    required String username,
    required String password,
    bool remember = false,
  });

  /// The server-asserted principal. Never inferred from a cached value (§7).
  Future<AuthUser> currentUser();

  Future<AuthSession> refresh(String refreshToken);

  Future<void> signOut();

  // The account's sessions ("Devices & sessions", PD-23) are not here: they are their own
  // repository, `AccountSessionsRepository`, over the one authenticated ApiClient.

  /// Emits when the backend ends this session — revoked elsewhere, or account disabled.
  Stream<void> get sessionRevoked;
}

/// PD-16: a parent whose account the academy created (when their child was enrolled) sets
/// their own password. Both calls are PUBLIC -- they go over the same transport as sign-in,
/// never the authenticated client -- and neither says whether an e-mail is known.
abstract interface class ParentSignupRepository {
  /// `POST /auth/signup/request` -- the family's supervisor then receives a one-time code to
  /// send the parent on WhatsApp. Succeeds the same way for any e-mail.
  Future<void> requestCode(String email);

  /// `POST /auth/signup/verify` -- sets the password. The caller then signs in normally.
  Future<void> verify({required String email, required String code, required String password});
}

/// The build with no sign-up server (fixtures, tests that do not override it).
class NoParentSignupRepository implements ParentSignupRepository {
  const NoParentSignupRepository();

  @override
  Future<void> requestCode(String email) => throw UnsupportedError('no sign-up server in this build');

  @override
  Future<void> verify({required String email, required String code, required String password}) =>
      throw UnsupportedError('no sign-up server in this build');
}

/// PD-21: a parent or teacher finishes a password reset the academy issued. The
/// administrator handed over a one-time code; the password is the person's own. PUBLIC --
/// the sign-in transport, never the authenticated client -- and it opens no session: the
/// caller signs in normally afterwards (every earlier session was ended by the reset).
abstract interface class PasswordResetRepository {
  /// `POST /auth/password-reset`. A refusal is an AppError with the server's code
  /// (`AUTH.RESET_CODE_INVALID`, `AUTH.PASSWORD_TOO_WEAK`, `COMMON.RATE_LIMITED`).
  Future<void> complete({required String username, required String code, required String password});
}

/// The build with no reset server (fixtures, tests that do not override it).
class NoPasswordResetRepository implements PasswordResetRepository {
  const NoPasswordResetRepository();

  @override
  Future<void> complete({required String username, required String code, required String password}) =>
      throw UnsupportedError('no reset server in this build');
}

/// PD-25: which self-service ways back in this deployment offers. Configuration only -- the
/// same answer for everyone.
class RecoveryOptions {
  const RecoveryOptions({required this.email, required this.whatsapp, required this.codeMinutes});

  /// Forgot password: a code is e-mailed to the sign-in address.
  final bool email;

  /// Forgot e-mail: a code goes by WhatsApp to the phone the academy has on file.
  final bool whatsapp;

  final int codeMinutes;

  /// What an unreachable server or an older API means: no self-service way in.
  static const none = RecoveryOptions(email: false, whatsapp: false, codeMinutes: 10);
}

/// PD-25: a parent recovers their own account from the sign-in screen. PUBLIC -- the sign-in
/// transport, never the authenticated client. The two requests succeed the same way whatever
/// was typed, so nothing here says whether an e-mail or phone belongs to an account. The new
/// password is set through [PasswordResetRepository.complete] with the code received.
abstract interface class AccountRecoveryRepository {
  /// `GET /auth/recovery/options`.
  Future<RecoveryOptions> options();

  /// `POST /auth/recovery/password` -- e-mails a code to [email] if it is a parent's sign-in.
  Future<void> requestPasswordCode(String email);

  /// `POST /auth/recovery/email` -- sends a code by WhatsApp to the phone on file.
  Future<void> requestEmailCode(String phone);

  /// `POST /auth/recovery/email/verify` -- the sign-in e-mails the code is good for. A refusal
  /// is an AppError (`AUTH.RESET_CODE_INVALID`, `COMMON.RATE_LIMITED`).
  Future<List<String>> verifyEmailCode({required String phone, required String code});
}

/// The build with no recovery server (fixtures, tests that do not override it).
class NoAccountRecoveryRepository implements AccountRecoveryRepository {
  const NoAccountRecoveryRepository();

  @override
  Future<RecoveryOptions> options() async => RecoveryOptions.none;

  @override
  Future<void> requestPasswordCode(String email) => throw UnsupportedError('no recovery server in this build');

  @override
  Future<void> requestEmailCode(String phone) => throw UnsupportedError('no recovery server in this build');

  @override
  Future<List<String>> verifyEmailCode({required String phone, required String code}) =>
      throw UnsupportedError('no recovery server in this build');
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

  /// Open the 1:1 channel with [withActorId], creating it only if none exists.
  ///
  /// **Idempotent by the server's construction, not by a check here.**
  /// `conversation.direct_key` is unique, so the same pair always resolves to the
  /// same conversation: a second call returns the first one rather than making a
  /// second channel. The client therefore does not look first and must not — a
  /// look-then-create is a race, and the race is exactly what the unique index
  /// exists to lose safely.
  ///
  /// **Authorization is the server's, entirely.** Whether these two actors may
  /// share a channel is `AuthorizationService.canOpenDirect`, and a refusal
  /// arrives as a typed `AppError` carrying the engine's own code. Nothing here
  /// re-implements that decision; `CommunicationPolicy` only decides whether to
  /// *offer* the action, which is UX and is deliberately narrower.
  Future<Conversation> openDirect(String withActorId);
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

/// The signed-in teacher's own professional profile.
///
/// Every method is about the CALLER. There is no teacher-id parameter anywhere
/// in this interface, because the server derives the teacher from the session --
/// so "edit somebody else's profile" is not a request this client can express.
///
/// There is no submit, no draft and no state. The teacher owns the profile:
/// [saveProfile] writes it and the write is the publish.
abstract interface class TeacherProfileRepository {
  /// The current profile. Creates nothing.
  Future<TeacherProfile> myProfile();

  /// Save the profile content. Immediately current when it returns.
  Future<TeacherProfile> saveProfile({
    String? bio,
    String? specialization,
    String? qualifications,
    String? experience,
    List<String> languages,
  });

  /// Rename the signed-in teacher.
  ///
  /// Separate from [saveProfile] because the name is IDENTITY: it lives on
  /// `chat.teacher` and is read by surfaces that have nothing to do with this
  /// screen. Returns the authoritative name the server stored -- which is what
  /// the caller must then display, rather than the string it sent.
  Future<String> updateName(String name);

  /// Upload a credential and attach it to the profile.
  Future<TeacherProfile> addCertificate({
    required PendingCertificateFile file,
    required String title,
    String? issuingOrganization,
    DateTime? issuedOn,
    void Function(int sent, int total)? onProgress,
  });

  /// Edit a credential's metadata.
  ///
  /// The FILE is not a parameter and does not move. The server returns the
  /// claim to `pending` -- a reviewer approved those words, not the file in the
  /// abstract -- so an edited credential needs deciding again.
  Future<TeacherProfile> updateCertificate(
    String certificateId, {
    required String title,
    String? issuingOrganization,
    DateTime? issuedOn,
  });

  Future<TeacherProfile> removeCertificate(String certificateId);

  /// A short-lived URL for one certificate file, authorized per request.
  ///
  /// Not cached and not stored: it expires, and holding it would be holding a
  /// capability past the moment it was granted for.
  Future<String> certificateUrl(String certificateId);
}

/// Stories, read-only.
///
/// There is no create, no publish, no delete and no viewer list here, and that is not an
/// omission. This client authenticates only as `parent` or `teacher`; publishing is
/// `stories.publish`, held by the family-facing staff roles, and the viewer list is
/// deliberately publisher-only (docs/product/STORIES.md section 3). A method for any of them
/// would be a method whose only possible body is a permission error.
abstract interface class StoryRepository {
  /// The live stories published to the signed-in actor, newest first.
  ///
  /// The server resolves the audience and filters by expiry; there is nothing to filter
  /// here. No cursor: `GET /stories/feed` returns one page of at most
  /// `story.feed_page_size` and publishes no pagination contract, so this does not invent
  /// one.
  Future<List<Story>> feed();

  /// Record that the signed-in actor opened this story. Idempotent on the server.
  Future<void> markViewed(String storyId);

  /// The reader tapped the story's button. The server records the tap and answers where to
  /// go: a URL to open, or -- for "message the publisher" -- the conversation to open.
  Future<StoryCtaTap> tapCta(String storyId);
}

abstract interface class GroupRepository {
  Future<StudentGroup> group(String conversationId);
}

/// The call operations the backend actually exposes.
///
/// RECONCILED 2026-09-24. The previous shape described an API that does not
/// exist: one `requestGrant` for what is two server calls, an `acceptIncoming`
/// returning a grant the server does not send, no `end` at all, and a global
/// paginated history for a per-conversation endpoint with no cursor. It was
/// written against an imagined backend and nothing had ever exercised it.
///
/// Every method below is one endpoint in `contracts/API-CONTRACT.md` §3.4/§3.8.
///
/// NO AUTHORIZATION LIVES HERE. Each method asks the server and reports what it
/// said. Errors keep the server's `COMM.*` code so a caller can tell a revoked
/// relationship from a call that has already ended — see [WireErrors].
/// The signed-in parent's own profile, and their children's.
///
/// ## None of these take an owner id
///
/// There is no `parentId` and no `familyId` anywhere below, because the server reads the
/// caller from the bearer token. This client could not ask for — or write — somebody else's
/// profile if it tried. `childId` is the one id that travels, and the server resolves it
/// only inside the caller's own family, so it carries no authority.
///
/// ## Every mutation answers with the WHOLE profile
///
/// So a caller never has to re-fetch to learn what a save did, and the screen never has to
/// guess. It is also what makes "save and immediately see the result" true rather than
/// optimistic: what is shown is what the server stored.
///
/// ## No photo methods
///
/// The photos are the account photos, set through [ProfilePhotoRepository]; `GET /me/profile`
/// carries their links.
abstract interface class ProfileRepository {
  /// `GET /me/profile`.
  Future<ParentProfile> me();

  /// `PATCH /me/profile` — save the caller's own name and/or About.
  ///
  /// An omitted field is left untouched; passing `about: ''` clears it. That distinction is
  /// what stops a one-field save from wiping the other.
  Future<ParentProfile> updateMe({String? name, String? about});

  /// `PATCH /me/children/:id` — the same, for a child of the caller's family.
  Future<ParentProfile> updateChild(String childId, {String? name, String? about});
}

abstract interface class CallRepository {
  /// `GET /conversations/:id/call-capability`.
  ///
  /// Advisory only. A `true` does not make the [start] that follows succeed.
  Future<CallCapability> capability({required String conversationId});

  /// `POST /calls` — create the call and start it ringing.
  ///
  /// This is the authorization that matters. It is re-decided server-side and
  /// throws when refused; the client must not retry or improvise around it.
  Future<StartedCall> start({required String conversationId});

  /// `POST /calls/:id/token` — a short-lived, room-scoped media credential.
  ///
  /// W3 does not consume it. W4 does.
  Future<CallMediaGrant> mediaToken({required String callId});

  /// `POST /calls/:id/accept` — answer at the APPLICATION level.
  ///
  /// It does not mean a device reached the media room; the server is explicit
  /// about that, and so is this client.
  Future<void> accept({required String callId});

  /// `POST /calls/:id/decline` — refuse a ringing call.
  Future<void> decline({required String callId});

  /// `POST /calls/:id/end` — hang up. NO BODY, AND NO OUTCOME.
  ///
  /// The client asks to end the call; the server decides what the call WAS. An
  /// ACTIVE call ends `answered`, a still-ringing one ends `missed`, and
  /// `declined` comes only from `decline`.
  ///
  /// This used to take an optional `outcome` and forward it. The server stopped
  /// accepting one on 2026-09-27 -- a participant naming their own call history
  /// is false history through the front door -- so the parameter is gone rather
  /// than left here to be rediscovered and silently ignored.
  Future<void> end({required String callId});

  /// `GET /calls/history/:conversationId`.
  ///
  /// PER CONVERSATION, and unpaginated — that is the endpoint. There is no
  /// global call history on the server, and this interface does not pretend
  /// otherwise; `docs/mobile/backend-dependencies.md` carries the gap.
  Future<List<CallHistoryEntry>> callHistory({required String conversationId});
}

/// PD-9 / PD-11 lesson tickets. Every method is one endpoint; NO AUTHORIZATION LIVES
/// HERE -- each call asks the server and reports what it said, keeping its `COMM.*` code.
///
/// Submitting returns nothing to draw: the card the ticket posts arrives in the chat
/// through the ordinary message path, exactly like anyone else's message.
abstract interface class LessonRepository {
  /// `GET /conversations/:id/lesson-tickets` -- what "+" may offer here, now. Advisory.
  Future<List<LessonTicket>> tickets(String conversationId);

  /// `POST /lessons/:id/report`
  Future<void> report(String lessonId, LessonReportDraft draft);

  /// `POST /lessons/:id/absence`
  Future<void> absence(String lessonId, {String? note});

  /// `POST /lessons/:id/apology`, `/teacher-apology` or `/late-apology`, by [kind].
  Future<void> apologise(String lessonId, LessonTicketKind kind, String reason);

  /// `GET /lessons/:id/makeup-slots`
  Future<MakeupOffer> makeupSlots(String lessonId);

  /// `POST /lessons/:id/makeup`
  Future<void> bookMakeup(String lessonId, DateTime startsAt);

  /// `GET /learners/:id/schedule-options` -- PD-31: the current weekly times too.
  Future<ScheduleOptions> scheduleOptions(String learnerId);

  /// `POST /learners/:id/schedule-change-requests` -- PD-31: [slots] is the FULL new
  /// weekly set; [effectiveFrom] is 'YYYY-MM-DD' in the teacher's zone.
  Future<void> requestScheduleChange(String learnerId, List<WeeklyKey> slots, {String? effectiveFrom, String? note});

  /// PD-31: `GET /lessons/:id/move-slots` -- where one lesson may move, or why it cannot.
  Future<MoveOffer> moveSlots(String lessonId);

  /// PD-31: `POST /lessons/:id/move` -- [startsAt] exactly as offered.
  Future<void> moveLesson(String lessonId, DateTime startsAt);

  /// PD-31: `GET /learners/:id/schedule` -- a child's weekly times.
  Future<ChildSchedule> childSchedule(String learnerId);

  /// PD-31: `GET /lessons?learnerId&from&to` -- one child's lessons (a parent: their
  /// own family's only; a teacher: their own lessons only).
  Future<List<ScheduledLesson>> learnerLessons(String learnerId, DateTime from, DateTime to);

  /// `GET /lessons?from&to` -- for a teacher, their own lessons.
  Future<List<ScheduledLesson>> myLessons(DateTime from, DateTime to);

  /// `GET /lessons/:id` -- the tickets the reader may open on this one lesson now,
  /// as "+" would offer them (`acts`). Advisory, like [tickets].
  Future<List<LessonTicket>> lessonTickets(String lessonId);

  /// `GET /learners/:id/progress` -- this month, in the academy's zone.
  Future<ChildProgress> progress(String learnerId);

  /// `GET /stats/me` -- a teacher's own month.
  Future<TeacherWorkload> myWorkload();

  /// PD-15: `GET /lessons/:id` -- the lesson's live report, to edit it (null when none).
  Future<LessonReportDraft?> reportFor(String lessonId);

  /// PD-15: `POST /lessons/:id/report/edit` -- the whole report again; its card is
  /// rewritten in place and the previous version is kept.
  Future<void> editReport(String lessonId, LessonReportDraft draft);

  /// PD-15: `GET /conversations/:id/learners` -- each child of a group, apart.
  Future<List<GroupChild>> groupChildren(String conversationId);

  /// PD-17: `GET /learners/:id/profile` -- the Student Profile, for the child's own
  /// teacher. Any other teacher gets a 404 (`COMM.LESSON_NOT_FOUND`), passed on intact.
  Future<StudentProfile> studentProfile(String learnerId);
}

/// The lesson repository of a build with no lesson server (the fixture build, tests
/// that do not override it): it offers no ticket, so "+" shows only attachments, and
/// it refuses every submission. A fixture lesson would be indistinguishable on screen
/// from a real one, and a parent must never see a report that was not written.
/// PD-12 S1: the teacher's private supervision conversation, their certificate
/// requests and their own leave. Every method is one endpoint; NO AUTHORIZATION LIVES
/// HERE -- the server decides and its `COMM.*` code reaches the caller intact.
abstract interface class SupervisionRepository {
  /// `GET /conversations/:id/supervision-tickets` -- what "+" may offer here. Advisory.
  Future<SupervisionTickets> tickets(String conversationId);

  /// `POST /learner-certificates` -- the request's card lands in the supervision conversation.
  Future<void> requestCertificate(CertificateDraft draft);

  /// `POST /me/leave-requests`
  Future<void> requestLeave({required DateTime firstDay, required DateTime lastDay, required String reason});

  /// `POST /me/leave-requests/:id/withdraw` -- only while undecided.
  Future<void> withdrawLeave(String requestId);

  /// `GET /me/leave?year=` -- the teacher's own allowance, used days, balance and requests.
  Future<LeaveSummary> myLeave({int? year});

  /// `POST /me/supervision-conversation` -- the teacher's own, created on first use.
  Future<String> openOwnConversation();
}

/// The build with no supervision server (fixtures, tests that do not override it):
/// offers nothing and refuses every submission, so a fixture balance can never be
/// mistaken for the teacher's real one.
class NoSupervisionRepository implements SupervisionRepository {
  const NoSupervisionRepository();

  @override
  Future<SupervisionTickets> tickets(String conversationId) async => SupervisionTickets.none;

  @override
  Future<void> requestCertificate(CertificateDraft draft) => throw UnsupportedError('no supervision server in this build');

  @override
  Future<void> requestLeave({required DateTime firstDay, required DateTime lastDay, required String reason}) =>
      throw UnsupportedError('no supervision server in this build');

  @override
  Future<void> withdrawLeave(String requestId) => throw UnsupportedError('no supervision server in this build');

  @override
  Future<LeaveSummary> myLeave({int? year}) => throw UnsupportedError('no supervision server in this build');

  @override
  Future<String> openOwnConversation() => throw UnsupportedError('no supervision server in this build');
}

class NoLessonRepository implements LessonRepository {
  const NoLessonRepository();

  @override
  Future<List<LessonTicket>> tickets(String conversationId) async => const [];

  @override
  Future<void> report(String lessonId, LessonReportDraft draft) =>
      throw UnsupportedError('no lesson server in this build');

  @override
  Future<void> absence(String lessonId, {String? note}) =>
      throw UnsupportedError('no lesson server in this build');

  @override
  Future<void> apologise(String lessonId, LessonTicketKind kind, String reason) =>
      throw UnsupportedError('no lesson server in this build');

  @override
  Future<MakeupOffer> makeupSlots(String lessonId) =>
      throw UnsupportedError('no lesson server in this build');

  @override
  Future<void> bookMakeup(String lessonId, DateTime startsAt) =>
      throw UnsupportedError('no lesson server in this build');

  @override
  Future<ScheduleOptions> scheduleOptions(String learnerId) =>
      throw UnsupportedError('no lesson server in this build');

  @override
  Future<void> requestScheduleChange(String learnerId, List<WeeklyKey> slots, {String? effectiveFrom, String? note}) =>
      throw UnsupportedError('no lesson server in this build');

  @override
  Future<MoveOffer> moveSlots(String lessonId) => throw UnsupportedError('no lesson server in this build');

  @override
  Future<void> moveLesson(String lessonId, DateTime startsAt) =>
      throw UnsupportedError('no lesson server in this build');

  @override
  Future<ChildSchedule> childSchedule(String learnerId) => throw UnsupportedError('no lesson server in this build');

  @override
  Future<List<ScheduledLesson>> learnerLessons(String learnerId, DateTime from, DateTime to) async => const [];

  @override
  Future<List<ScheduledLesson>> myLessons(DateTime from, DateTime to) async => const [];

  @override
  Future<List<LessonTicket>> lessonTickets(String lessonId) async => const [];

  @override
  Future<ChildProgress> progress(String learnerId) =>
      throw UnsupportedError('no lesson server in this build');

  @override
  Future<TeacherWorkload> myWorkload() => throw UnsupportedError('no lesson server in this build');

  @override
  Future<LessonReportDraft?> reportFor(String lessonId) => throw UnsupportedError('no lesson server in this build');

  @override
  Future<void> editReport(String lessonId, LessonReportDraft draft) =>
      throw UnsupportedError('no lesson server in this build');

  @override
  Future<List<GroupChild>> groupChildren(String conversationId) async => const [];

  @override
  Future<StudentProfile> studentProfile(String learnerId) =>
      throw UnsupportedError('no lesson server in this build');
}

/// PD-17: the signed-in parent's own payments. NO AUTHORIZATION LIVES
/// HERE -- the server answers only the parent who holds billing for their family and
/// refuses everyone else (`COMM.BILLING_DENIED`), and that refusal reaches the caller.
///
/// PD-27 adds paying: a card checkout the server opens (and confirms only from Stripe's
/// verified webhook -- nothing the app sees marks anything paid), a bank-transfer receipt
/// the academy verifies, and each invoice's PDF.
abstract interface class BillingRepository {
  /// `GET /me/billing`
  Future<ParentBilling> myBilling();

  /// `POST /me/billing/checkout` with exactly one of [requestId] / [instalmentId]: the
  /// Stripe Checkout URL to open in the browser. `503 COMM.PAYMENTS_UNAVAILABLE` on a
  /// deployment without Stripe; `409 COMM.BILLING_STATE` when it is no longer open.
  Future<String> checkout({String? requestId, String? instalmentId});

  /// Upload the file (`POST /me/billing/receipts/upload`, then a bare PUT to the signed
  /// URL), then `POST /me/billing/receipts`. Answers the whole billing view again.
  Future<ParentBilling> submitReceipt(ReceiptDraft draft);

  /// `GET /me/billing/invoices/:id/link`: a short-lived signed PDF link for this viewer.
  Future<String> invoiceLink(String invoiceId);
}

/// PD-27: the refusals a payment screen answers in its own words.
abstract final class BillingErrors {
  /// 503: Stripe is not configured on this deployment.
  static const paymentsUnavailable = 'COMM.PAYMENTS_UNAVAILABLE';

  /// 409: already paid, cancelled, expired or decided.
  static const state = 'COMM.BILLING_STATE';
}

/// PD-27: one bank-transfer receipt, before it is sent. Pays exactly one of
/// [requestId] / [instalmentId] (a request wins when both are known).
class ReceiptDraft {
  const ReceiptDraft({
    required this.file,
    required this.amountMinor,
    required this.transferredOn,
    this.requestId,
    this.instalmentId,
    this.note,
  });

  /// JPEG, PNG, WebP or PDF, at most [maxBytes].
  final PendingAttachment file;
  final String? requestId;
  final String? instalmentId;

  /// What the parent says they sent, in the currency's minor units.
  final int amountMinor;
  final DateTime transferredOn;
  final String? note;

  /// The server's allow-list, mirrored so a wrong file is refused before any upload.
  static const mimeTypes = {'image/jpeg', 'image/png', 'image/webp', 'application/pdf'};
  static const maxBytes = 10 * 1024 * 1024;
}

/// The build with no billing server: refuses rather than answering "no payments",
/// because an empty list would tell a parent who owes money that they owe none.
class NoBillingRepository implements BillingRepository {
  const NoBillingRepository();

  @override
  Future<ParentBilling> myBilling() => throw UnsupportedError('no billing server in this build');

  @override
  Future<String> checkout({String? requestId, String? instalmentId}) =>
      throw UnsupportedError('no billing server in this build');

  @override
  Future<ParentBilling> submitReceipt(ReceiptDraft draft) => throw UnsupportedError('no billing server in this build');

  @override
  Future<String> invoiceLink(String invoiceId) => throw UnsupportedError('no billing server in this build');
}

/// PD-11 T4: the teacher's trial group -- the trials they may report under "+", and the
/// report itself. Sales books trials and records the decision in the Admin Web.
abstract interface class TrialRepository {
  /// `GET /conversations/:id/trial-tickets` -- what "+" may offer here. Advisory.
  Future<List<TrialTicket>> tickets(String conversationId);

  /// `POST /trials/:id/attendance` -- the card lands in the trial group.
  Future<void> reportAttendance(String trialId, TrialAttendanceDraft draft);

  /// PD-20: `POST /trials/groups/:id/join` -- a Sales seat becomes a live member of a
  /// teacher's trial group (and from then on the server's call capability applies).
  Future<void> joinGroup(String conversationId);
}

/// The build with no trial server (fixtures, tests that do not override it): "+" offers
/// no trial report, and nothing is ever sent.
class NoTrialRepository implements TrialRepository {
  const NoTrialRepository();

  @override
  Future<List<TrialTicket>> tickets(String conversationId) async => const [];

  @override
  Future<void> reportAttendance(String trialId, TrialAttendanceDraft draft) =>
      throw UnsupportedError('no trial server in this build');

  @override
  Future<void> joinGroup(String conversationId) => throw UnsupportedError('no trial server in this build');
}

/// PD-32: a parent's feedback about their child's teacher. The administration reviews it;
/// the teacher never sees who wrote it.
abstract interface class FeedbackRepository {
  /// False in a build with no feedback server: the profile offers no entry.
  bool get isAvailable;

  /// `GET /me/feedback` -- the parent's children (with each one's teacher) and every item
  /// they sent, newest first. `403 COMM.FEEDBACK_DENIED` for anyone but a parent.
  Future<MyFeedback> mine();

  /// `POST /me/feedback`. [body] is trimmed and 1..2000 characters. Refused with
  /// [FeedbackErrors.notFound] (the child is not in the family, or has no teacher) and
  /// [FeedbackErrors.limit] (too many today).
  Future<FeedbackItem> submit({
    required String learnerId,
    required FeedbackCategory category,
    required String body,
  });
}

/// PD-32: the refusals the feedback screens answer in their own words.
abstract final class FeedbackErrors {
  /// 403: the signed-in account is not a parent.
  static const denied = 'COMM.FEEDBACK_DENIED';

  /// 404: the child is not in the family, or has no teacher.
  static const notFound = 'COMM.FEEDBACK_NOT_FOUND';

  /// 429: too many submissions today.
  static const limit = 'COMM.FEEDBACK_LIMIT';

  /// The longest body the server accepts.
  static const maxLength = 2000;
}

/// The build with no feedback server: the entry is not offered, and nothing is sent.
class NoFeedbackRepository implements FeedbackRepository {
  const NoFeedbackRepository();

  @override
  bool get isAvailable => false;

  @override
  Future<MyFeedback> mine() async => const MyFeedback();

  @override
  Future<FeedbackItem> submit({
    required String learnerId,
    required FeedbackCategory category,
    required String body,
  }) =>
      throw UnsupportedError('no feedback server in this build');
}
