/**
 * Stable, documented error codes. Clients (AI #3 mobile, AI #4 admin) branch on
 * these, never on message text. Adding a code is safe; changing one is a
 * breaking contract change. Documented in docs/communication/error-codes.md.
 */
export enum CommErrorCode {
  // --- BR-1 and the communication matrix ---
  /**
   * DEPRECATED by PD-7 (2026-10-14). PD-6's refusal for a teacher/parent pair
   * with no authorized relationship. Nothing in src/ raises it any more: PD-7
   * forbids the direct channel for every pair (BR1_TEACHER_PARENT_DIRECT).
   *
   * Kept, not deleted: shipped clients treat it as terminal (never retried),
   * and removing the constant would delete the contract those builds were
   * written against. Asserted by test/unit/authorization/br1-conformance.spec.ts.
   */
  TEACHER_PARENT_NOT_AUTHORIZED = 'COMM.TEACHER_PARENT_NOT_AUTHORIZED',
  /**
   * BR-1, restored by PD-7 (2026-10-14). A teacher and a parent may never share
   * a direct 1:1 conversation or call, whatever their relationship: refused on
   * open, on send (either side) and on call. They speak only in the Student
   * Group, with a live admin present (C-4).
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
  /**
   * 403. Family-facing staff, same organization, but the conversation's family
   * is not in this admin's charge: not a member, not the family's owner, not on
   * duty for it, not its live sticky handler. Managers are never refused this.
   */
  STAFF_OUT_OF_SCOPE = 'COMM.STAFF_OUT_OF_SCOPE',
  CONTACT_CANNOT_MESSAGE = 'COMM.CONTACT_CANNOT_MESSAGE',
  CONTACT_CANNOT_WRITE_INTERNAL = 'COMM.CONTACT_CANNOT_WRITE_INTERNAL',
  TEACHER_CANNOT_WRITE_INTERNAL = 'COMM.TEACHER_CANNOT_WRITE_INTERNAL',
  MEMBER_IS_SILENT = 'COMM.MEMBER_IS_SILENT',
  ACTOR_INACTIVE = 'COMM.ACTOR_INACTIVE',
  CANNOT_MANAGE_MEMBERSHIP = 'COMM.CANNOT_MANAGE_MEMBERSHIP',
  /**
   * A Student Group is provisioned by Jawwid staff for a family in their scope:
   * a manager for any family in their organization, an admin or coverage admin
   * for a family they own. Never by a parent, a teacher or department staff.
   */
  CANNOT_PROVISION_STUDENT_GROUP = 'COMM.CANNOT_PROVISION_STUDENT_GROUP',
  CANNOT_APPROVE = 'COMM.CANNOT_APPROVE',
  /**
   * A request body that fails validation (API-CONTRACT section 1: 400, the
   * message names the field). Shared with every route; first emitted by
   * `POST /conversations/:id/members`, whose missing reason used to reach the
   * audit_log NOT NULL constraint and fail as a 500.
   */
  VALIDATION = 'COMMON.VALIDATION',
  NOT_MESSAGE_AUTHOR = 'COMM.NOT_MESSAGE_AUTHOR',
  DELETE_WINDOW_EXPIRED = 'COMM.DELETE_WINDOW_EXPIRED',
  /** The author's edit window (`communication.edit_window_minutes`) has passed. */
  EDIT_WINDOW_EXPIRED = 'COMM.EDIT_WINDOW_EXPIRED',
  /**
   * Only a published, never-moderated, undeleted TEXT message can be edited: a
   * message that went through approval stays exactly as it was approved. 409.
   */
  MESSAGE_NOT_EDITABLE = 'COMM.MESSAGE_NOT_EDITABLE',

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
  /** RETIRED by PD-19 (2026-10-21): no longer issued -- a parent member may
   *  start a group call. Kept so clients that still map it keep compiling. */
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
  /** The call to action is malformed: an unknown kind, a non-https link, a bad number. */
  STORY_CTA_INVALID = 'COMM.STORY_CTA_INVALID',
  /** The story has no call to action, so there is nothing to tap. */
  STORY_NO_CTA = 'COMM.STORY_NO_CTA',
  /** A photo, video or voice story carries no words: rule 2, no caption. */
  STORY_CAPTION_NOT_ALLOWED = 'COMM.STORY_CAPTION_NOT_ALLOWED',
  /** Family segmentation data (country, plan) is for the super admin and managers. */
  STORY_AUDIENCE_DATA_DENIED = 'COMM.STORY_AUDIENCE_DATA_DENIED',
  /** The family named for audience data does not exist in the caller's organization. */
  STORY_FAMILY_NOT_FOUND = 'COMM.STORY_FAMILY_NOT_FOUND',

  // --- Admin Portal ---
  /** Not the super admin. The `/admin` inspection surface is theirs alone. Never retry. */
  ADMIN_INSPECTION_DENIED = 'COMM.ADMIN_INSPECTION_DENIED',

  // --- Realtime revocation (RT-009) ---
  /**
   * 503. The revocation (a membership removal, a logout, a session or account
   * revocation) IS committed and durable -- but not every API node confirmed
   * that it can no longer deliver to the revoked recipient on a decision made
   * before it. The operation is therefore NOT reported as complete. Retrying
   * the same request is safe and idempotent; it succeeds once every node
   * confirms.
   */
  REVOCATION_UNCONFIRMED = 'COMM.REVOCATION_UNCONFIRMED',

  // --- Staff profiles ---
  /**
   * The profile does not exist, is in another organization, or is not one the
   * caller may see. One code for all three, so the route is not an existence
   * oracle for staff ids. 404.
   */
  STAFF_PROFILE_NOT_FOUND = 'COMM.STAFF_PROFILE_NOT_FOUND',
  /** The caller may see this profile but may not change this part of it. 403. */
  STAFF_PROFILE_EDIT_DENIED = 'COMM.STAFF_PROFILE_EDIT_DENIED',
  /** A field failed validation (length, characters, unknown field). 400. */
  STAFF_PROFILE_INVALID = 'COMM.STAFF_PROFILE_INVALID',
  /** Someone saved the profile after the caller loaded it. Reload, then retry. 409. */
  STAFF_PROFILE_CONFLICT = 'COMM.STAFF_PROFILE_CONFLICT',
  /** The uploaded bytes are not an acceptable profile photo. 400. */
  STAFF_AVATAR_INVALID = 'COMM.STAFF_AVATAR_INVALID',
  /** An official assignment (responsibility, reporting line) was refused. 403. */
  STAFF_ASSIGNMENT_DENIED = 'COMM.STAFF_ASSIGNMENT_DENIED',
  /** The assignment is not a lawful shape (hierarchy, duplicate, already ended). 409. */
  STAFF_ASSIGNMENT_INVALID = 'COMM.STAFF_ASSIGNMENT_INVALID',
  /** The organization-wide profile overview belongs to the super admin. 403. */
  STAFF_DIRECTORY_DENIED = 'COMM.STAFF_DIRECTORY_DENIED',
  /** The message cannot leave its conversation: deleted, held, rejected, a system message or a card. 403. */
  MESSAGE_NOT_FORWARDABLE = 'COMM.MESSAGE_NOT_FORWARDABLE',
  /** A chat theme or wallpaper request failed validation (unknown preset, wrong image). 400. */
  CHAT_THEME_INVALID = 'COMM.CHAT_THEME_INVALID',
  /**
   * A wallpaper photo was refused for what it IS, one code per reason so the
   * clients can say it in the viewer's language (the message stays English for
   * logs). 400 each: not a JPEG/PNG/WebP (or bytes that do not match the
   * declared type); over the byte limit; outside the pixel limits; animated.
   */
  CHAT_WALLPAPER_TYPE = 'COMM.CHAT_WALLPAPER_TYPE',
  CHAT_WALLPAPER_TOO_LARGE = 'COMM.CHAT_WALLPAPER_TOO_LARGE',
  CHAT_WALLPAPER_DIMENSIONS = 'COMM.CHAT_WALLPAPER_DIMENSIONS',
  CHAT_WALLPAPER_ANIMATED = 'COMM.CHAT_WALLPAPER_ANIMATED',
  /** No wallpaper for this viewer and chat (or not theirs to see). 404. */
  CHAT_WALLPAPER_NOT_FOUND = 'COMM.CHAT_WALLPAPER_NOT_FOUND',
  /** Exporting a chat (transcript + media) is the super admin's alone. 403. */
  CONVERSATION_EXPORT_DENIED = 'COMM.CONVERSATION_EXPORT_DENIED',
  // --- Staff tools: labels and quick replies (staff only) ---
  /** Labels and quick replies are staff tools; teachers and families never reach them. 403. */
  STAFF_TOOLS_DENIED = 'COMM.STAFF_TOOLS_DENIED',
  /** No such label or quick reply for this caller (or another person's private one). 404. */
  STAFF_TOOL_NOT_FOUND = 'COMM.STAFF_TOOL_NOT_FOUND',
  /** A name, colour, shortcut or body failed validation. 400. */
  STAFF_TOOL_INVALID = 'COMM.STAFF_TOOL_INVALID',
  /** That label name or shortcut is already taken in this library. 409. */
  STAFF_TOOL_CONFLICT = 'COMM.STAFF_TOOL_CONFLICT',
  // --- Profile photos (parents, teachers, children) ---
  /**
   * The photo does not exist or is not one the caller may see or change -- one
   * code for all of them, so a photo link is not an oracle. 404.
   */
  PROFILE_PHOTO_NOT_FOUND = 'COMM.PROFILE_PHOTO_NOT_FOUND',
  /** The caller may not change this photo (e.g. staff use their staff profile). 403. */
  PROFILE_PHOTO_DENIED = 'COMM.PROFILE_PHOTO_DENIED',
  /** The upload is not an acceptable profile photo (type, size, dimensions, key). 400. */
  PROFILE_PHOTO_INVALID = 'COMM.PROFILE_PHOTO_INVALID',
  /** PD-8: the learner has no supervisor, so no group can carry the required admin. 409. */
  LEARNER_UNSUPERVISED = 'COMM.LEARNER_UNSUPERVISED',
  /** PD-8: the organization structure (departments, supervision, backups) may not be changed by this actor. 403. */
  ORG_STRUCTURE_DENIED = 'COMM.ORG_STRUCTURE_DENIED',
  /** PD-8: the requested structure is not lawful (wrong department, ended link, mixed supervisors). 409. */
  ORG_STRUCTURE_INVALID = 'COMM.ORG_STRUCTURE_INVALID',
  /** PD-33: the change could not finish in time (a busy database); nothing was committed. 503; safe to retry. */
  ORG_STRUCTURE_BUSY = 'COMM.ORG_STRUCTURE_BUSY',
  /** PD-11: no such lesson, or none this caller may see. 404. */
  LESSON_NOT_FOUND = 'COMM.LESSON_NOT_FOUND',
  /** PD-11: this caller may see the lesson but may not record this on it. 403. */
  LESSON_DENIED = 'COMM.LESSON_DENIED',
  /** PD-11: the lesson is not in a state that allows this (already closed, not started, too late). 409. */
  LESSON_STATE = 'COMM.LESSON_STATE',
  /** PD-11: the teacher already has a lesson at that time. 409. */
  LESSON_TEACHER_BUSY = 'COMM.LESSON_TEACHER_BUSY',
  /** PD-10: this actor may not see, or may not make this change to, a Teacher File. 403. */
  TEACHER_FILE_DENIED = 'COMM.TEACHER_FILE_DENIED',
  /** PD-10: no such teacher in the actor's organization. 404, identical for a foreign id. */
  TEACHER_FILE_NOT_FOUND = 'COMM.TEACHER_FILE_NOT_FOUND',
  /** PD-10: the timeline refused the entry (already resolved, already recorded, wrong target). 409. */
  TEACHER_FILE_CONFLICT = 'COMM.TEACHER_FILE_CONFLICT',
  /** PD-18: payout accounts cannot be sealed or opened (no payout key configured, or a retired key). 503. */
  TEACHER_PAYROLL_UNAVAILABLE = 'COMM.TEACHER_PAYROLL_UNAVAILABLE',
  /** PD-12: no such certificate, or none this caller may see. 404. */
  CERTIFICATE_NOT_FOUND = 'COMM.CERTIFICATE_NOT_FOUND',
  /** PD-12: this caller may not request, issue or decline this certificate. 403. */
  CERTIFICATE_DENIED = 'COMM.CERTIFICATE_DENIED',
  /** PD-12: the certificate is not in a state that allows this (already decided, no group to deliver into). 409. */
  CERTIFICATE_STATE = 'COMM.CERTIFICATE_STATE',
  /** PD-12: no such leave request or teacher, or none this caller may see. 404. */
  LEAVE_NOT_FOUND = 'COMM.LEAVE_NOT_FOUND',
  /** PD-12: this caller may not request, decide or cancel this leave, or set this allowance. 403. */
  LEAVE_DENIED = 'COMM.LEAVE_DENIED',
  /** PD-12: the leave is not in a state that allows this (decided, overlapping, past, crossing a year). 409. */
  LEAVE_STATE = 'COMM.LEAVE_STATE',
  /** PD-12: open lessons fall inside the leave; approve again with cancelCollidingLessons. 409. */
  LEAVE_LESSONS_COLLIDE = 'COMM.LEAVE_LESSONS_COLLIDE',
  /** PD-32: parent feedback is filed by a family's parent and handled by the Teachers department; nobody else. 403. */
  FEEDBACK_DENIED = 'COMM.FEEDBACK_DENIED',
  /** PD-32: no such feedback, or no such child (with a teacher) in the parent's family. 404. */
  FEEDBACK_NOT_FOUND = 'COMM.FEEDBACK_NOT_FOUND',
  /** PD-32: the family or child has filed as much feedback as a day allows. 429. */
  FEEDBACK_LIMIT = 'COMM.FEEDBACK_LIMIT',
  /** PD-32: the feedback is not in a state that allows this (a complaint resolves through its PD-26 resolution). 409. */
  FEEDBACK_STATE = 'COMM.FEEDBACK_STATE',
  /** PD-12: this caller may not open this teacher's supervision conversation. 403. */
  SUPERVISION_DENIED = 'COMM.SUPERVISION_DENIED',
  /** PD-12: no such active teacher in the caller's organization. 404. */
  SUPERVISION_NOT_FOUND = 'COMM.SUPERVISION_NOT_FOUND',
  /** PD-12 S2: no such violation, lesson or teacher, or none this caller may see. 404. */
  DISCIPLINE_NOT_FOUND = 'COMM.DISCIPLINE_NOT_FOUND',
  /** PD-12 S2: only the Teachers department (and the super admin) records and decides discipline. 403. */
  DISCIPLINE_DENIED = 'COMM.DISCIPLINE_DENIED',
  /** PD-12 S2: not allowed now (already decided, below the late threshold, lesson not held, students still assigned). 409. */
  DISCIPLINE_STATE = 'COMM.DISCIPLINE_STATE',
  /** PD-12 S2: open lessons fall inside the suspension; decide again with cancelCollidingLessons. 409. */
  DISCIPLINE_LESSONS_COLLIDE = 'COMM.DISCIPLINE_LESSONS_COLLIDE',
  /** PD-12 S3: only Operations (in scope), the Operations Manager and the super admin read instalments. 403. */
  BILLING_DENIED = 'COMM.BILLING_DENIED',
  /** PD-12 S3: no such family in the caller's organization, or none this caller may see. 404. */
  BILLING_NOT_FOUND = 'COMM.BILLING_NOT_FOUND',
  /** PD-17: the instalment is already paid or voided, so it cannot be paid or voided again. 409. */
  BILLING_STATE = 'COMM.BILLING_STATE',
  /** PD-27: card payments are not configured on this deployment (no STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET). 503. */
  PAYMENTS_UNAVAILABLE = 'COMM.PAYMENTS_UNAVAILABLE',
  /**
   * PD-30: the child's group is read-only for the parent and the teacher -- the
   * subscription's lessons are used up (after the grace lessons) or an
   * instalment is overdue. Staff still write; the parent's direct chat with
   * their supervisor is never locked. Also refuses calls in the group and
   * booking a lesson for the child. 403. Retry after paying.
   */
  SUBSCRIPTION_LOCKED = 'COMM.SUBSCRIPTION_LOCKED',
  /** PD-30: granting or revoking an exception is the super admin's, the Operations Manager's and the Sales Manager's alone; the ledger is the payment recorders'. 403. */
  SUBSCRIPTION_DENIED = 'COMM.SUBSCRIPTION_DENIED',
  /** PD-30: already voided / revoked, or a renewal was already asked for today. 409. */
  SUBSCRIPTION_STATE = 'COMM.SUBSCRIPTION_STATE',
  /** PD-17: Parent Profiles are the administration's -- Operations (in scope), the Operations Manager and the super admin. Never a teacher. 403. */
  PARENT_PROFILE_DENIED = 'COMM.PARENT_PROFILE_DENIED',
  /** PD-17: no such parent in the caller's organization, or none this caller may see. 404. */
  PARENT_PROFILE_NOT_FOUND = 'COMM.PARENT_PROFILE_NOT_FOUND',
  /**
   * PD-21: this caller may not reset, suspend, reactivate or impersonate this
   * account -- not staff, the target is the caller's own account, the super
   * admin's, or (for anyone but the super admin) another staff member's; or an
   * impersonation of a staff account. 403. Never retry.
   */
  ACCOUNT_ADMIN_DENIED = 'COMM.ACCOUNT_ADMIN_DENIED',
  /** PD-21: no such account in the caller's organization. 404. */
  ACCOUNT_ADMIN_NOT_FOUND = 'COMM.ACCOUNT_ADMIN_NOT_FOUND',
  /** PD-21: not in a state for this (suspend an inactive account, reactivate one that is not suspended, impersonate an inactive one). 409. */
  ACCOUNT_ADMIN_STATE = 'COMM.ACCOUNT_ADMIN_STATE',
  /**
   * PD-23: the account has no live session with this id -- ended already, or
   * another account's. One code for both, so the status never confirms that a
   * session id exists. 404.
   */
  SESSION_NOT_FOUND = 'COMM.SESSION_NOT_FOUND',
  /**
   * PD-21: not allowed in a support session (an administrator acting as a
   * parent or teacher): it would act in the person's name where others see it,
   * unlabelled -- receipts, calls, reactions, edits, devices, logout, ... 403.
   */
  SUPPORT_SESSION_FORBIDDEN = 'COMM.SUPPORT_SESSION_FORBIDDEN',
  /** PD-21: no such support session of the caller's. 404. */
  IMPERSONATION_NOT_FOUND = 'COMM.IMPERSONATION_NOT_FOUND',
  /** PD-21: the support session has ended, expired or reached its hour. 409. */
  IMPERSONATION_ENDED = 'COMM.IMPERSONATION_ENDED',
  /** PD-13: no such scheduled call, or none in a conversation this caller may read. 404. */
  SCHEDULED_CALL_NOT_FOUND = 'COMM.SCHEDULED_CALL_NOT_FOUND',
  /** PD-13: only someone who may start a call in the conversation schedules one there; only its creator cancels it. 403. */
  SCHEDULED_CALL_DENIED = 'COMM.SCHEDULED_CALL_DENIED',
  /** PD-13: cancelled, not yet open (more than 10 minutes early), or over (2 hours after its start). 409. */
  SCHEDULED_CALL_NOT_JOINABLE = 'COMM.SCHEDULED_CALL_NOT_JOINABLE',

  // Teacher professional profile. The review states are a vocabulary of their
  // own: a client that cannot tell "you may not review" from "this is not ready
  // to review" shows the wrong thing to the wrong person.
  TEACHER_PROFILE_NOT_FOUND = 'COMM.TEACHER_PROFILE_NOT_FOUND',
  TEACHER_PROFILE_NOT_A_TEACHER = 'COMM.TEACHER_PROFILE_NOT_A_TEACHER',
  TEACHER_PROFILE_CANNOT_REVIEW = 'COMM.TEACHER_PROFILE_CANNOT_REVIEW',
  TEACHER_PROFILE_REVIEW_NOTE_REQUIRED = 'COMM.TEACHER_PROFILE_REVIEW_NOTE_REQUIRED',
  TEACHER_PROFILE_CONFLICT = 'COMM.TEACHER_PROFILE_CONFLICT',

  // The profile-level review codes are gone with the workflow that raised them
  // (NO_OPEN_REVISION, NOT_SUBMITTED, ALREADY_SUBMITTED, CERTIFICATES_UNDECIDED,
  // REVISION_CLOSED). A teacher saves their own profile and it is immediately
  // current, so there is no state a save can be refused for. REVIEW_NOTE_REQUIRED
  // stays: rejecting a CERTIFICATE still needs a reason.

  /** The teacher's own name, on chat.teacher -- the only teacher identity. */
  TEACHER_NAME_INVALID = 'COMM.TEACHER_NAME_INVALID',
  TEACHER_PROFILE_INVALID_CONTENT = 'COMM.TEACHER_PROFILE_INVALID_CONTENT',
  TEACHER_CERTIFICATE_NOT_FOUND = 'COMM.TEACHER_CERTIFICATE_NOT_FOUND',
  TEACHER_CERTIFICATE_INVALID_TYPE = 'COMM.TEACHER_CERTIFICATE_INVALID_TYPE',
  TEACHER_CERTIFICATE_TOO_LARGE = 'COMM.TEACHER_CERTIFICATE_TOO_LARGE',
  /** The upload never reached storage, so there is no file to claim. 409. */
  TEACHER_CERTIFICATE_NOT_UPLOADED = 'COMM.TEACHER_CERTIFICATE_NOT_UPLOADED',

  /** The caller is authenticated but is not a family contact, so has no parent profile. */
  PROFILE_NOT_AVAILABLE = 'COMM.PROFILE_NOT_AVAILABLE',
  /** A submitted name or About failed server-side validation. */
  PROFILE_FIELD_INVALID = 'COMM.PROFILE_FIELD_INVALID',
  /**
   * The learner is not in the caller's family.
   *
   * Deliberately ONE code for "no such learner" and "not your learner" alike: telling them
   * apart would turn every child route into an oracle for which learner ids exist, which is
   * the same reasoning STORY_NOT_FOUND above is written for.
   */
  LEARNER_NOT_IN_FAMILY = 'COMM.LEARNER_NOT_IN_FAMILY',

  // --- PD-29: Materials ---
  /** No such library item, recitation or upload, or none this caller may see. 404. */
  MATERIAL_NOT_FOUND = 'COMM.MATERIAL_NOT_FOUND',
  /** The library is managed by the super admin and the Teachers manager; this caller may not do this. 403. */
  MATERIAL_DENIED = 'COMM.MATERIAL_DENIED',
  /** A library item, import row or recitation failed validation. 400. */
  MATERIAL_INVALID = 'COMM.MATERIAL_INVALID',
  /** The uploaded file is not what it claims, or the package is refused (unsafe path, type, size). 400. */
  MATERIAL_FILE_REFUSED = 'COMM.MATERIAL_FILE_REFUSED',
  /** The upload never reached storage, so there is no file to use. 409. */
  MATERIAL_NOT_UPLOADED = 'COMM.MATERIAL_NOT_UPLOADED',
  /** The lessons site is not configured on this deployment (MATERIALS_SITE_BASE_URL). 409. */
  MATERIAL_UNAVAILABLE = 'COMM.MATERIAL_UNAVAILABLE',

  // --- PD-35: the visible seat (joining a conversation by choice) ---
  /** No such seat reason, or no feature on this deployment takes seats for it. 400. */
  SEAT_REASON_UNKNOWN = 'COMM.SEAT_REASON_UNKNOWN',
  /** This reason does not give the caller a seat here, now. 403. */
  SEAT_NOT_ELIGIBLE = 'COMM.SEAT_NOT_ELIGIBLE',
  /** A seat for this reason cannot be taken in this kind of conversation (a 1:1). 409. */
  SEAT_NOT_ALLOWED_HERE = 'COMM.SEAT_NOT_ALLOWED_HERE',
  /** The caller is already a member in their own right: there is no seat to take. 409. */
  SEAT_ALREADY_MEMBER = 'COMM.SEAT_ALREADY_MEMBER',
  /** The caller holds no open seat here. 404. */
  SEAT_NOT_FOUND = 'COMM.SEAT_NOT_FOUND',
  /** A join's note or source failed validation. 400. */
  SEAT_INVALID = 'COMM.SEAT_INVALID',
}

export class CommError extends Error {
  constructor(
    readonly code: CommErrorCode,
    message: string,
    // A refusal that says "not found" IS a 404, whoever throws it. Several call
    // sites passed a canRead decision straight through and so answered another
    // organization's conversation as 403 CONVERSATION_NOT_FOUND while an unknown
    // id was 404 -- the status alone told a caller the id exists in another
    // tenant (found by org-scope-pd8.spec, 2026-10-15). Deciding it here means
    // no call site can forget it again.
    readonly status: number = code.endsWith('_NOT_FOUND') ? 404 : 403,
  ) {
    super(message);
    this.name = 'CommError';
  }
}
