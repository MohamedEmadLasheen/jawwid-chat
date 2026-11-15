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
  /// PD-8: a group a supervisor creates about one or more children of one family.
  static const conversationFamilyGroup = 'family_group';
  /// PD-11 / PD-12: a teacher's private conversation with the Teachers department.
  static const conversationTeacherSupervision = 'teacher_supervision';
  /// PD-11 T4: a teacher's staff-only group with Sales about their trial lessons.
  static const conversationTrialGroup = 'trial_group';
  /// PD-35 B6: a department's staff-only room (Sales sees its own in the app).
  static const conversationDepartmentRoom = 'department_room';

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

  /// PD-11: a ticket's card. `MessageDto.card` carries its structure.
  static const messageCard = 'card';

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
  /// DEPRECATED by PD-7 (2026-10-14): the PD-6 refusal of an unauthorized pairing. The
  /// server no longer sends it (every pairing is now refused with BR-1, below). Kept, and
  /// kept terminal, for servers still at PD-6.
  static const teacherParentNotAuthorized = 'COMM.TEACHER_PARENT_NOT_AUTHORIZED';

  /// ACTIVE again since PD-7 (2026-10-14): a teacher and a parent never hold a 1:1 —
  /// only the Student Group. Terminal: surfaced as "not available", never retried.
  /// (PD-6 had deprecated it from 2026-09-23 to 2026-10-14.)
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

  /// LD-12 / MG-3: the text holds a word on the server's content filter list. A standing
  /// refusal of THESE words: the person changes them, the client never re-sends them as
  /// they are. The message never names the word.
  static const contentNotAllowed = 'COMM.CONTENT_NOT_ALLOWED';

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

  /// OA-12: one learner per paid lesson call. During one of the teacher's lessons a call
  /// with that lesson's family may not also seat another family's guardian. Refused on
  /// start, answer and media token; never retried. Shown in words, never as "not
  /// available" (`CallUiFailure.oneLearnerLesson`).
  static const lessonOneLearner = 'COMM.LESSON_ONE_LEARNER';

  // PD-58 Terms of Use (docs/communication/error-codes.md "Terms of Use (PD-58)"). None is
  // in [terminal]: each has its own handling (the legal gate, a reload, a message), and
  // a TERMS_NOT_ACCEPTED refusal stops being true once the person accepts.

  /// 403 from any `@RequiresLegal()` route: something is still to accept. `ApiClient`
  /// reports it centrally; the identity is refreshed and the legal gate shown.
  static const termsNotAccepted = 'COMM.TERMS_NOT_ACCEPTED';

  /// 400: the documents accepted are not exactly the required set. Reload; never re-send.
  static const legalWrongDocuments = 'COMM.LEGAL_WRONG_DOCUMENTS';

  /// 409: a version accepted is no longer the one in force. Reload and ask again.
  static const legalVersionStale = 'COMM.LEGAL_VERSION_STALE';

  /// 400 from sign-up verify without `acceptLegal`.
  static const legalRequired = 'COMM.LEGAL_REQUIRED';

  /// 503: the owner's configuration cannot be decided. A generic failure; never "no terms".
  static const legalNotConfigured = 'COMM.LEGAL_NOT_CONFIGURED';

  /// 403: a staff support session (PD-21) cannot accept for the person.
  static const supportSessionForbidden = 'COMM.SUPPORT_SESSION_FORBIDDEN';

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
    contentNotAllowed,
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
