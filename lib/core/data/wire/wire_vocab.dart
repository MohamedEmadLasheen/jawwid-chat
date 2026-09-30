/// The wire vocabulary, mirroring `apps/api/src/communication/contracts/vocab.ts`.
///
/// These are the backend's strings, not ours. They exist as constants so a mapper cannot
/// drift from the contract silently, and so a value the backend adds later fails visibly at
/// the mapping boundary rather than producing a wrong-but-plausible screen.
abstract final class Wire {
  // ConversationType
  static const conversationDirect = 'direct';
  static const conversationStudentGroup = 'student_group';
  static const conversationClassGroup = 'class_group';
  static const conversationOfficial = 'official';

  // MemberRole
  static const memberParent = 'parent';
  static const memberTeacher = 'teacher';
  static const memberAdmin = 'admin';
  static const memberObserver = 'observer';

  // ActorKind
  static const actorContact = 'contact';
  static const actorStaff = 'staff';
  static const actorTeacher = 'teacher';
  static const actorSystem = 'system';

  // MessageType
  static const messageText = 'text';
  static const messageImage = 'image';
  static const messageVideo = 'video';
  static const messageVoice = 'voice';
  static const messageFile = 'file';
  static const messageSystem = 'system';

  // Moderation
  static const moderationPublished = 'published';
  static const moderationPending = 'pending';
  static const moderationRejected = 'rejected';

  // ReceiptState
  static const receiptSent = 'sent';
  static const receiptDelivered = 'delivered';
  static const receiptRead = 'read';

  // Visibility. The mobile client renders only `customer`; `internal` is an admin concept
  // and an internal message reaching this app would be a backend defect.
  static const visibilityCustomer = 'customer';
  static const visibilityInternal = 'internal';

  // CallOutcome
  static const callAnswered = 'answered';
  static const callMissed = 'missed';
  static const callDeclined = 'declined';

  // CallType. `chat.call.type` is immutable in the database (RT-024) and has no
  // video member -- voice only is the product rule (G-32), not a client choice.
  static const callTypeDirect = 'direct';
  static const callTypeGroup = 'group';
}

/// Backend error codes this client reacts to specifically.
///
/// Mirrors `apps/api/src/platform/errors.ts`. Everything else falls through to the generic
/// mapping by HTTP status.
abstract final class WireErrors {
  /// PD-6: a teacher and a parent may hold a 1:1 only where the server authorizes the
  /// relationship. This is the refusal for every other pairing — surfaced as a plain
  /// "not available" and never retried, because no amount of retrying creates a
  /// relationship.
  static const teacherParentNotAuthorized = 'COMM.TEACHER_PARENT_NOT_AUTHORIZED';

  /// DEPRECATED by PD-6 (2026-09-23): the server no longer sends this. Kept, and kept
  /// terminal, so a build that predates the change still behaves correctly against a
  /// server that has been upgraded. Remove it only once no shipped build sends traffic.
  static const br1TeacherParentDirect = 'COMM.BR1_TEACHER_PARENT_DIRECT';

  static const notConversationMember = 'COMM.NOT_CONVERSATION_MEMBER';
  static const contactCannotMessage = 'COMM.CONTACT_CANNOT_MESSAGE';
  static const memberIsSilent = 'COMM.MEMBER_IS_SILENT';
  static const actorInactive = 'COMM.ACTOR_INACTIVE';
  static const cannotManageMembership = 'COMM.CANNOT_MANAGE_MEMBERSHIP';
  static const conversationNotFound = 'COMM.CONVERSATION_NOT_FOUND';
  static const conversationArchived = 'COMM.CONVERSATION_ARCHIVED';
  static const messageNotFound = 'COMM.MESSAGE_NOT_FOUND';
  static const replyTargetCrossConversation = 'COMM.REPLY_TARGET_CROSS_CONVERSATION';
  static const emptyMessage = 'COMM.EMPTY_MESSAGE';

  // Stories. All four are final states or standing refusals, never transient, so the client
  // must not retry any of them -- it refetches the feed instead, which is a different
  // request answering a different question.
  static const storyNotFound = 'COMM.STORY_NOT_FOUND';
  static const storyExpired = 'COMM.STORY_EXPIRED';
  static const storyDeleted = 'COMM.STORY_DELETED';
  static const storyCannotRead = 'COMM.STORY_CANNOT_READ';

  /// Story codes that mean "this story is over". The viewer reacts to these by leaving the
  /// story and refreshing the feed, rather than by showing an error the reader cannot act on.
  static const storyGone = <String>{storyNotFound, storyExpired, storyDeleted};

  // Calling. Kept distinguishable because they mean different things to a
  // caller: a call that ended is over, a participant who left has already
  // answered one way, and an unauthorized pairing is not a retry.
  static const callNotFound = 'COMM.CALL_NOT_FOUND';
  static const callAlreadyEnded = 'COMM.CALL_ALREADY_ENDED';
  static const callNotAParticipant = 'COMM.CALL_NOT_A_PARTICIPANT';
  static const callParticipantLeft = 'COMM.CALL_PARTICIPANT_LEFT';
  static const callNotRinging = 'COMM.CALL_NOT_RINGING';
  static const callAlreadyDeclined = 'COMM.CALL_ALREADY_DECLINED';

  /// Codes that mean "this will never succeed, stop asking".
  static const terminal = <String>{
    teacherParentNotAuthorized,
    br1TeacherParentDirect,
    notConversationMember,
    contactCannotMessage,
    memberIsSilent,
    actorInactive,
    cannotManageMembership,
    conversationNotFound,
    conversationArchived,
    messageNotFound,
    replyTargetCrossConversation,
    emptyMessage,
    storyNotFound,
    storyExpired,
    storyDeleted,
    storyCannotRead,
    // A terminal call state does not become untrue on a retry.
    callNotFound,
    callAlreadyEnded,
    callNotAParticipant,
    callParticipantLeft,
    callNotRinging,
    callAlreadyDeclined,
  };
}

/// The authentication error codes, mirroring `apps/api/src/platform/auth/auth.errors.ts`.
///
/// Separate from [WireErrors] because these are not communication-domain refusals: the
/// backend decides them in `AuthenticatedGuard` before any controller runs, and the client
/// branches on them to decide whether to refresh, re-login, or stop for good.
///
/// The `AUTH.` prefix is not decoration. Before these constants existed the client recognised
/// `session_revoked` and `account_disabled` — codes the backend has never sent — so a revoked
/// session was classified merely `unauthenticated` and the client answered it by presenting
/// a dead refresh token, and a disabled account classified as `forbidden` and kept rendering
/// protected screens.
abstract final class AuthErrors {
  /// 401. Missing, malformed or expired bearer token. Refresh once, then end.
  static const unauthenticated = 'AUTH.UNAUTHENTICATED';

  /// 401 from `POST /auth/login` only. Uniform for "no such user" and "wrong password",
  /// because a response that distinguished them would enumerate accounts.
  static const invalidCredentials = 'AUTH.INVALID_CREDENTIALS';

  /// 403. Deactivated or suspended.
  static const accountDisabled = 'AUTH.ACCOUNT_DISABLED';

  /// 403. Temporarily locked after repeated failures.
  static const accountLocked = 'AUTH.ACCOUNT_LOCKED';

  /// 401. Revoked, rotated-and-reused, or the session row is gone.
  static const sessionRevoked = 'AUTH.SESSION_REVOKED';

  /// 403. Authenticated, but not permitted. NOT a reason to end the session.
  static const forbidden = 'AUTH.FORBIDDEN';

  /// 429. Carries the wait in the `Retry-After` header, never in the body.
  static const rateLimited = 'COMMON.RATE_LIMITED';
}
