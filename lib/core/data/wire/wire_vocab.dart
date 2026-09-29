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
}

/// Backend error codes this client reacts to specifically.
///
/// Mirrors `apps/api/src/platform/errors.ts`. Everything else falls through to the generic
/// mapping by HTTP status.
abstract final class WireErrors {
  /// The rule: a teacher and a parent may never hold a 1:1. The client does not offer this,
  /// so seeing it means something reached the API another way — it is surfaced as a plain
  /// "not available" and never retried.
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

  /// Codes that mean "this will never succeed, stop asking".
  static const terminal = <String>{
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
  };
}
