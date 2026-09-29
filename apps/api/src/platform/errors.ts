/**
 * Stable, documented error codes. Clients (AI #3 mobile, AI #4 admin) branch on
 * these, never on message text. Adding a code is safe; changing one is a
 * breaking contract change. Documented in docs/communication/error-codes.md.
 */
export enum CommErrorCode {
  // --- BR-1 and the communication matrix ---
  BR1_TEACHER_PARENT_DIRECT = 'COMM.BR1_TEACHER_PARENT_DIRECT',
  BR1_ADMIN_PRESENCE_REQUIRED = 'COMM.BR1_ADMIN_PRESENCE_REQUIRED',
  ROLE_CANNOT_MESSAGE_FAMILY = 'COMM.ROLE_CANNOT_MESSAGE_FAMILY',
  TEACHER_TEACHER_DISABLED = 'COMM.TEACHER_TEACHER_DISABLED',
  STAFF_STAFF_DISABLED = 'COMM.STAFF_STAFF_DISABLED',
  INVALID_PARTICIPANTS = 'COMM.INVALID_PARTICIPANTS',

  // --- Authorization ---
  NOT_ON_DUTY = 'COMM.NOT_ON_DUTY',
  ASSIST_NOT_PERMITTED = 'COMM.ASSIST_NOT_PERMITTED',
  ESCALATION_NOT_PERMITTED = 'COMM.ESCALATION_NOT_PERMITTED',
  NOT_CONVERSATION_MEMBER = 'COMM.NOT_CONVERSATION_MEMBER',
  CONTACT_CANNOT_MESSAGE = 'COMM.CONTACT_CANNOT_MESSAGE',
  CONTACT_CANNOT_WRITE_INTERNAL = 'COMM.CONTACT_CANNOT_WRITE_INTERNAL',
  TEACHER_CANNOT_WRITE_INTERNAL = 'COMM.TEACHER_CANNOT_WRITE_INTERNAL',
  MEMBER_IS_SILENT = 'COMM.MEMBER_IS_SILENT',
  ACTOR_INACTIVE = 'COMM.ACTOR_INACTIVE',
  CANNOT_MANAGE_MEMBERSHIP = 'COMM.CANNOT_MANAGE_MEMBERSHIP',
  CANNOT_APPROVE = 'COMM.CANNOT_APPROVE',
  NOT_MESSAGE_AUTHOR = 'COMM.NOT_MESSAGE_AUTHOR',
  DELETE_WINDOW_EXPIRED = 'COMM.DELETE_WINDOW_EXPIRED',

  // --- Validation / state ---
  UNKNOWN_ACTOR = 'COMM.UNKNOWN_ACTOR',
  CONVERSATION_NOT_FOUND = 'COMM.CONVERSATION_NOT_FOUND',
  CONVERSATION_ARCHIVED = 'COMM.CONVERSATION_ARCHIVED',
  MESSAGE_NOT_FOUND = 'COMM.MESSAGE_NOT_FOUND',
  REPLY_TARGET_CROSS_CONVERSATION = 'COMM.REPLY_TARGET_CROSS_CONVERSATION',
  EMPTY_MESSAGE = 'COMM.EMPTY_MESSAGE',
  ATTACHMENT_TOO_LARGE = 'COMM.ATTACHMENT_TOO_LARGE',
  ATTACHMENT_TYPE_NOT_ALLOWED = 'COMM.ATTACHMENT_TYPE_NOT_ALLOWED',
  /**
   * An attachment names an object outside the conversation it was sent to.
   * A policy refusal, not a validation error: the key may be perfectly
   * well-formed and may name a real object -- it just is not this
   * conversation's to read.
   */
  ATTACHMENT_NOT_IN_CONVERSATION = 'COMM.ATTACHMENT_NOT_IN_CONVERSATION',
  APPROVAL_ALREADY_DECIDED = 'COMM.APPROVAL_ALREADY_DECIDED',
  APPROVAL_REASON_REQUIRED = 'COMM.APPROVAL_REASON_REQUIRED',
  GROUP_ALREADY_EXISTS = 'COMM.GROUP_ALREADY_EXISTS',

  // --- Calling ---
  CALL_NOT_FOUND = 'COMM.CALL_NOT_FOUND',
  CALL_ALREADY_ENDED = 'COMM.CALL_ALREADY_ENDED',
  CALL_NOT_A_PARTICIPANT = 'COMM.CALL_NOT_A_PARTICIPANT',
  /** PD-2: a family contact may join a Student Group call but never start one. */
  PARENT_CANNOT_START_GROUP_CALL = 'COMM.PARENT_CANNOT_START_GROUP_CALL',

  // --- Stories ---
  /** Not a publisher. Also the answer to "may I see the viewer list?". */
  STORY_CANNOT_PUBLISH = 'COMM.STORY_CANNOT_PUBLISH',
  STORY_CANNOT_READ = 'COMM.STORY_CANNOT_READ',
  /**
   * Returned for "does not exist", "not yours to see" and "not published to
   * you" alike. Deliberately one code: distinguishing them would turn every
   * story route into an existence oracle.
   */
  STORY_NOT_FOUND = 'COMM.STORY_NOT_FOUND',
  STORY_EMPTY = 'COMM.STORY_EMPTY',
  STORY_TOO_LONG = 'COMM.STORY_TOO_LONG',
  STORY_ALREADY_PUBLISHED = 'COMM.STORY_ALREADY_PUBLISHED',
  STORY_NOT_PUBLISHED = 'COMM.STORY_NOT_PUBLISHED',
  /** Past expires_at. A 410: it existed, it does not any more. */
  STORY_EXPIRED = 'COMM.STORY_EXPIRED',
  STORY_DELETED = 'COMM.STORY_DELETED',
  STORY_DELETE_REASON_REQUIRED = 'COMM.STORY_DELETE_REASON_REQUIRED',
  /** The authored audience resolves to nobody the author may address. */
  STORY_AUDIENCE_EMPTY = 'COMM.STORY_AUDIENCE_EMPTY',
  STORY_AUDIENCE_INVALID = 'COMM.STORY_AUDIENCE_INVALID',
}

export class CommError extends Error {
  constructor(
    readonly code: CommErrorCode,
    message: string,
    readonly status = 403,
  ) {
    super(message);
    this.name = 'CommError';
  }
}
