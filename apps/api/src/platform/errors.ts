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
  /** A request body the caller can fix by sending different values. */
  NOTIFICATION_PREFERENCE_INVALID = 'COMM.NOTIFICATION_PREFERENCE_INVALID',

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
  /** The record exists, but it is outside this actor's authorized scope. */
  OUT_OF_SCOPE = 'COMM.OUT_OF_SCOPE',
  /** The actor's effective permissions do not include the required key. */
  PERMISSION_DENIED = 'COMM.PERMISSION_DENIED',
  /** The record belongs to a different organization. */
  CROSS_TENANT = 'COMM.CROSS_TENANT',
  CANNOT_MANAGE_MEMBERSHIP = 'COMM.CANNOT_MANAGE_MEMBERSHIP',
  CANNOT_APPROVE = 'COMM.CANNOT_APPROVE',
  NOT_MESSAGE_AUTHOR = 'COMM.NOT_MESSAGE_AUTHOR',
  DELETE_WINDOW_EXPIRED = 'COMM.DELETE_WINDOW_EXPIRED',
  /** The author's edit window has closed. A moderator is not bound by it. */
  EDIT_WINDOW_EXPIRED = 'COMM.EDIT_WINDOW_EXPIRED',
  /**
   * The message is in a state that has no lawful edit: deleted for everyone,
   * held for approval, rejected, or a type whose content is not text.
   */
  MESSAGE_NOT_EDITABLE = 'COMM.MESSAGE_NOT_EDITABLE',
  /** The message may be read, but not copied out of the conversation. */
  MESSAGE_NOT_FORWARDABLE = 'COMM.MESSAGE_NOT_FORWARDABLE',

  // --- Validation / state ---
  UNKNOWN_ACTOR = 'COMM.UNKNOWN_ACTOR',
  CONVERSATION_NOT_FOUND = 'COMM.CONVERSATION_NOT_FOUND',
  CONVERSATION_ARCHIVED = 'COMM.CONVERSATION_ARCHIVED',
  MESSAGE_NOT_FOUND = 'COMM.MESSAGE_NOT_FOUND',
  REPLY_TARGET_CROSS_CONVERSATION = 'COMM.REPLY_TARGET_CROSS_CONVERSATION',
  EMPTY_MESSAGE = 'COMM.EMPTY_MESSAGE',
  /** The body exceeds communication.message_max_length. */
  MESSAGE_TOO_LONG = 'COMM.MESSAGE_TOO_LONG',
  /** The emoji is not in the supported reaction set. */
  REACTION_NOT_ALLOWED = 'COMM.REACTION_NOT_ALLOWED',
  /** A search was issued with nothing to search for. */
  SEARCH_QUERY_TOO_SHORT = 'COMM.SEARCH_QUERY_TOO_SHORT',
  ATTACHMENT_TOO_LARGE = 'COMM.ATTACHMENT_TOO_LARGE',
  ATTACHMENT_TYPE_NOT_ALLOWED = 'COMM.ATTACHMENT_TYPE_NOT_ALLOWED',
  APPROVAL_ALREADY_DECIDED = 'COMM.APPROVAL_ALREADY_DECIDED',
  APPROVAL_REASON_REQUIRED = 'COMM.APPROVAL_REASON_REQUIRED',
  GROUP_ALREADY_EXISTS = 'COMM.GROUP_ALREADY_EXISTS',

  // --- Calling ---
  CALL_NOT_FOUND = 'COMM.CALL_NOT_FOUND',
  CALL_ALREADY_ENDED = 'COMM.CALL_ALREADY_ENDED',
  CALL_NOT_A_PARTICIPANT = 'COMM.CALL_NOT_A_PARTICIPANT',
  /** PD-2: a family contact may join a Student Group call but never start one. */
  PARENT_CANNOT_START_GROUP_CALL = 'COMM.PARENT_CANNOT_START_GROUP_CALL',
  /** The action is not legal from the call's current state. See calls/call-state.ts. */
  CALL_INVALID_TRANSITION = 'COMM.CALL_INVALID_TRANSITION',
  /** The invitation window closed before anyone answered. */
  CALL_EXPIRED = 'COMM.CALL_EXPIRED',
  /** Only the actor who started a call may cancel it. */
  CALL_NOT_INITIATOR = 'COMM.CALL_NOT_INITIATOR',
  /** A class call may only be started in a Student Group or Class Group. */
  CLASS_CALL_REQUIRES_GROUP = 'COMM.CLASS_CALL_REQUIRES_GROUP',

  // --- Recording ---
  /** A `normal` call cannot be recorded. Recording belongs to follow-up calls. */
  RECORDING_NOT_PERMITTED_FOR_MODE = 'COMM.RECORDING_NOT_PERMITTED_FOR_MODE',
  RECORDING_NOT_FOUND = 'COMM.RECORDING_NOT_FOUND',
  /** The recording exists but is not yet playable, or is no longer playable. */
  RECORDING_NOT_AVAILABLE = 'COMM.RECORDING_NOT_AVAILABLE',
  /** Retention elapsed; the audio is gone and no URL will be minted. */
  RECORDING_EXPIRED = 'COMM.RECORDING_EXPIRED',
  RECORDING_ALREADY_EXISTS = 'COMM.RECORDING_ALREADY_EXISTS',

  // --- Stories ---
  STORY_NOT_FOUND = 'COMM.STORY_NOT_FOUND',
  STORY_ALREADY_PUBLISHED = 'COMM.STORY_ALREADY_PUBLISHED',
  STORY_NOT_PUBLISHED = 'COMM.STORY_NOT_PUBLISHED',
  STORY_EXPIRED = 'COMM.STORY_EXPIRED',
  STORY_EMPTY = 'COMM.STORY_EMPTY',
  STORY_TOO_LONG = 'COMM.STORY_TOO_LONG',

  // --- Audience resolution (stories and broadcast share it) ---
  /** The audience list was empty, or every clause was malformed. */
  AUDIENCE_EMPTY = 'COMM.AUDIENCE_EMPTY',
  /** A clause named a kind that is not in the audience vocabulary. */
  AUDIENCE_KIND_INVALID = 'COMM.AUDIENCE_KIND_INVALID',
  /**
   * A clause named a record the author may not target. Returned for a forged
   * id and for a real id outside the author's scope ALIKE -- distinguishing
   * them would turn this endpoint into an existence oracle for other people's
   * families, labels and groups.
   */
  AUDIENCE_TARGET_NOT_FOUND = 'COMM.AUDIENCE_TARGET_NOT_FOUND',
  /** Only an organization-wide role may target everyone. */
  AUDIENCE_TOO_BROAD = 'COMM.AUDIENCE_TOO_BROAD',
  /** The resolved audience exceeds broadcast.max_recipients. */
  AUDIENCE_TOO_LARGE = 'COMM.AUDIENCE_TOO_LARGE',

  // --- Broadcast ---
  BROADCAST_NOT_FOUND = 'COMM.BROADCAST_NOT_FOUND',
  /** Queue/cancel was called from a state that has no such transition. */
  BROADCAST_INVALID_STATE = 'COMM.BROADCAST_INVALID_STATE',
  BROADCAST_EMPTY_BODY = 'COMM.BROADCAST_EMPTY_BODY',
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
