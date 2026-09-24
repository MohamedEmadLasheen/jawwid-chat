/**
 * Stable, documented error codes. Clients (AI #3 mobile, AI #4 admin) branch on
 * these, never on message text. Adding a code is safe; changing one is a
 * breaking contract change. Documented in docs/communication/error-codes.md.
 */
export enum CommErrorCode {
  // --- BR-1 and the communication matrix ---
  /**
   * PD-6 (2026-09-23). A teacher and a parent would share a direct 1:1
   * conversation or call with NO authorized relationship between them.
   *
   * "Authorized" is the relationship predicate: a learner in the contact's
   * family, taught by that teacher, both sides live, one organization. It is
   * resolved from Jawwid Core data and never from anything the client sent.
   */
  TEACHER_PARENT_NOT_AUTHORIZED = 'COMM.TEACHER_PARENT_NOT_AUTHORIZED',
  /**
   * DEPRECATED by PD-6. The server no longer emits this for any authorization
   * decision: the blanket teacher<->parent prohibition it named is gone, and
   * an unauthorized pairing now reports TEACHER_PARENT_NOT_AUTHORIZED above.
   *
   * Kept, not deleted, for exactly one reason: shipped clients treat this code
   * as terminal (never retried), and removing the constant would delete the
   * contract those builds were written against. Nothing in src/ raises it.
   * Asserted by test/unit/authorization/br1-conformance.spec.ts.
   */
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
  /**
   * The actor is recorded on this call but has already left it -- they
   * declined, or were dropped. A participant row survives leaving, so
   * "is a participant" and "is still on the call" are different questions and
   * the second one is the one that governs joining.
   */
  CALL_PARTICIPANT_LEFT = 'COMM.CALL_PARTICIPANT_LEFT',
  /** The call is no longer ringing, so there is nothing left to decline. */
  CALL_NOT_RINGING = 'COMM.CALL_NOT_RINGING',
  /**
   * Every other participant has left, so a direct call has already been
   * refused. Accepting it would record an answer nobody gave.
   */
  CALL_ALREADY_DECLINED = 'COMM.CALL_ALREADY_DECLINED',
  /** PD-2: a family contact may join a Student Group call but never start one. */
  PARENT_CANNOT_START_GROUP_CALL = 'COMM.PARENT_CANNOT_START_GROUP_CALL',
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
