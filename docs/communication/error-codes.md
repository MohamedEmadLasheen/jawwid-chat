# Error codes

Every failure returns `{ "error": { "code": "COMM.…", "message": "…" } }`.
**Branch on `code`, never on `message`.** Adding a code is safe; changing or
removing one is a breaking change.

Source of truth: `apps/api/src/platform/errors.ts`.

## BR-1 and the communication matrix — HTTP 403

> **PD-6 (2026-09-23)** re-versioned BR-1. Direct teacher↔parent channels are now
> allowed for an authorized relationship; only an *unauthorized* pairing is refused.

| Code | Meaning |
|---|---|
| `COMM.BR1_TEACHER_PARENT_DIRECT` | **Active again (PD-7, 2026-10-14).** A teacher and a parent may never share a direct 1:1 conversation or call, whatever their relationship; refused on open, on send (either side, including a conversation left over from the PD-6 window) and on call. They speak only in the Student Group. Never retry. |
| `COMM.TEACHER_PARENT_NOT_AUTHORIZED` | **DEPRECATED (PD-7).** The PD-6 relationship refusal; no longer emitted. Clients still treat it as terminal so older builds behave correctly. |
| `COMM.ROLE_CANNOT_MESSAGE_FAMILY` | Finance/technical/academic staff may never take part in family communication. |
| `COMM.TEACHER_TEACHER_DISABLED` | Teacher-to-teacher DMs are off by default. |
| `COMM.STAFF_STAFF_DISABLED` | Staff-to-staff DMs are not in MVP; use internal notes. |
| `COMM.INVALID_PARTICIPANTS` | The pair cannot form a conversation (two parents, self-chat, no staff side); or a membership add names someone who may not join this conversation in that role. |
| `COMM.CALL_PARTICIPANT_LEFT` | 409. The actor is on this call's participant list but has already left it — they were dropped, or left a group call that continued without them. Terminal: the call is over for them. Since 2026-09-27 a decline ENDS the call, so a repeat decline reports `COMM.CALL_ALREADY_ENDED` instead; this code still appears on a concurrent-decline race and on the token/accept paths. |
| `COMM.CALL_NOT_RINGING` | 409. The call is no longer ringing, so there is nothing to decline. An answered call is left by ending it. |
| `COMM.CALL_ALREADY_DECLINED` | 409. Every other participant has left, so the call was already refused. Answering it would record an answer nobody gave. A backstop since 2026-09-27: a decline now ends the call, so that state is normally reported as `COMM.CALL_ALREADY_ENDED`. |

## Authorization — HTTP 403

| Code | Meaning |
|---|---|
| `COMM.NOT_ON_DUTY` | Staff is not on duty for this family. Internal notes are still allowed. |
| `COMM.ASSIST_NOT_PERMITTED` | Assist needs a server-evaluated grant. A client-supplied mode never grants access. |
| `COMM.ESCALATION_NOT_PERMITTED` | As above, for escalation. |
| `COMM.NOT_CONVERSATION_MEMBER` | Actor is not a live member. |
| `COMM.STAFF_OUT_OF_SCOPE` | 403. Family-facing staff of the right organization, but the conversation is not in this admin's charge: not a member, not the family's owner, not on duty for it, not its live sticky handler. Managers are never refused this. Also the answer to a realtime `conversation.subscribe`. Never retry; the admin list only ever shows conversations in charge. |
| `COMM.CONTACT_CANNOT_MESSAGE` | The contact lacks `can_message`. |
| `COMM.CONTACT_CANNOT_WRITE_INTERNAL` | Contacts cannot write internal notes. |
| `COMM.TEACHER_CANNOT_WRITE_INTERNAL` | Teachers cannot write internal notes. |
| `COMM.MEMBER_IS_SILENT` | Present in the conversation but may not post. |
| `COMM.ACTOR_INACTIVE` | Deactivated or offboarded actor. |
| `COMM.CANNOT_MANAGE_MEMBERSHIP` | Only Jawwid staff with the conversation's family in scope change membership; a direct conversation's membership never changes. |
| `COMM.CANNOT_PROVISION_STUDENT_GROUP` | Only the family's supervisor (admin / coverage owner) or a manager of the same organization may create or re-sync a Student Group. |
| `COMM.CANNOT_APPROVE` | Only the active handler or a manager may decide. |
| `COMM.NOT_MESSAGE_AUTHOR` | Only the author, a manager, or (PD-14) an admin in charge of the conversation may edit or delete for everyone. |
| `COMM.DELETE_WINDOW_EXPIRED` | Past `communication.delete_for_everyone_window_minutes`. |
| `COMM.EDIT_WINDOW_EXPIRED` | Past `communication.edit_window_minutes`. |

## Validation and state

| Code | HTTP | Meaning |
|---|---|---|
| `COMM.UNKNOWN_ACTOR` | 401 | The actor id resolves to nobody. |
| `COMM.CONVERSATION_NOT_FOUND` | 404 | Also returned instead of 403 where existence itself is sensitive. |
| `COMM.MESSAGE_NOT_FOUND` | 404 | Includes messages the caller may not see — absent, not forbidden. |
| `COMM.CONVERSATION_ARCHIVED` | 403 | Archived conversations are readable, never writable. |
| `COMM.REPLY_TARGET_CROSS_CONVERSATION` | 403 | A reply must target the same conversation. |
| `COMM.EMPTY_MESSAGE` | 400 | Text needs a body; media needs an attachment. |
| `COMM.ATTACHMENT_TOO_LARGE` | 400 | Over the configured per-kind limit. |
| `COMM.ATTACHMENT_TYPE_NOT_ALLOWED` | 400 | MIME type not allowed for that kind. |
| `COMM.APPROVAL_ALREADY_DECIDED` | 409 | Someone else decided first. Refresh the queue. |
| `COMM.APPROVAL_REASON_REQUIRED` | 400 | A rejection must state a reason. |
| `COMM.CHAT_WALLPAPER_TYPE` | 400 | The wallpaper is not a JPEG, PNG or WebP image, or its bytes do not match the declared type. |
| `COMM.CHAT_WALLPAPER_TOO_LARGE` | 400 | The wallpaper is over 4 MB. |
| `COMM.CHAT_WALLPAPER_DIMENSIONS` | 400 | Each side of a wallpaper must be 200–4096 px. |
| `COMM.CHAT_WALLPAPER_ANIMATED` | 400 | An animated image cannot be a wallpaper. |
| `COMM.MESSAGE_NOT_EDITABLE` | 409 | Only a published, undeleted text message can be edited. |
| `COMM.REVOCATION_UNCONFIRMED` | 503 | RT-009. A membership removal, Student Group sync, logout or session/account revocation **is committed**, but not every API server confirmed it can no longer deliver realtime events to the revoked person on an earlier decision — so it is not reported as done. Retry the same request; it is idempotent and succeeds once every server confirms. |

## Calling

| Code | HTTP | Meaning |
|---|---|---|
| `COMM.CALL_NOT_FOUND` | 404 | |
| `COMM.CALL_ALREADY_ENDED` | 409 | No token is issued for an ended call. |
| `COMM.CALL_NOT_A_PARTICIPANT` | 403 | Not in the server-derived participant set. |
| `COMM.PARENT_CANNOT_START_GROUP_CALL` | 403 | **Retired by PD-19 (2026-10-21); no longer issued.** Under PD-2 a parent could JOIN a group call but not START one. Clients may keep mapping it for older servers. |

## Stories

| Code | HTTP | Meaning |
|---|---|---|
| `COMM.STORY_CANNOT_PUBLISH` | 403 | Not a publisher. Publishing is the family-facing staff roles (admin, coverage, manager) and, since 2026-10-17, the super admin. Also the answer to "may I read the viewer list / analytics?". Never retry. |
| `COMM.STORY_CANNOT_READ` | 403 | This contact is not a communicating contact for the family. |
| `COMM.STORY_NOT_FOUND` | 404 | Deliberately returned for "does not exist", "not yours" and "not published to you" alike, with the same message. Distinguishing them would turn every story route into an existence oracle. |
| `COMM.STORY_EMPTY` | 400 | A story needs a body or a piece of media. |
| `COMM.STORY_TOO_LONG` | 400 | Body longer than `story.max_body_length`. |
| `COMM.STORY_ALREADY_PUBLISHED` | 409 | Refresh; publishing is not idempotent by design. |
| `COMM.STORY_NOT_PUBLISHED` | 409 | Still a draft. |
| `COMM.STORY_EXPIRED` | 410 | Past `expires_at`. It existed; it does not any more. Never retry. |
| `COMM.STORY_DELETED` | 410 | Removed by an operator. Never retry. |
| `COMM.STORY_DELETE_REASON_REQUIRED` | 400 | Deleting a story requires a reason; it is recorded in `chat.audit_log`. |
| `COMM.STORY_AUDIENCE_EMPTY` | 400 | The authored audience resolves to nobody you may address. |
| `COMM.STORY_AUDIENCE_INVALID` | 400 | A clause is malformed, names an unknown kind, or names a record outside your organization; a segment filter is malformed; or an analytics time zone is unknown. Loud rather than silent, so an operator learns while composing. |
| `COMM.STORY_CAPTION_NOT_ALLOWED` | 400 | A photo, video or voice story carries no words, and no story has a title (2026-10-17). Name it for yourself with `internalName`. |
| `COMM.STORY_CTA_INVALID` | 400 | The button is malformed: an unknown kind, a link that is not https, a WhatsApp number that is not international, or a label over 40 characters. |
| `COMM.STORY_NO_CTA` | 409 | The story has no button to tap (or replies are not available for it). |
| `COMM.STORY_AUDIENCE_DATA_DENIED` | 403 | Family country / plan data is for the super admin and managers. Never retry. |
| `COMM.STORY_FAMILY_NOT_FOUND` | 404 | No such family in your organization. |

## Admin Portal

| Code | HTTP | Meaning |
|---|---|---|
| `COMM.ADMIN_INSPECTION_DENIED` | 403 | The read-only `/admin` inspection surface belongs to `super_admin` alone (PD-5, `users.manage`). Every other role, every contact and every teacher receives this. Never retry. |

## Staff profiles

| Code | HTTP | Meaning |
|---|---|---|
| `COMM.STAFF_PROFILE_NOT_FOUND` | 404 | No such profile, another organization's, or one the caller may not see. Deliberately one code. |
| `COMM.STAFF_PROFILE_EDIT_DENIED` | 403 | The caller may see the profile but may not change that field group (e.g. an admin editing another admin, a manager editing a name). Never retry. |
| `COMM.STAFF_PROFILE_INVALID` | 400 | A field is too long, contains control characters, or is not an editable field. |
| `COMM.STAFF_PROFILE_CONFLICT` | 409 | The profile changed after it was loaded. Reload and re-apply the edit. |
| `COMM.STAFF_AVATAR_INVALID` | 400 | The uploaded object is not a JPEG/PNG/WebP of acceptable size and dimensions, or its bytes do not match the declared type. The object is deleted. |
| `COMM.STAFF_ASSIGNMENT_DENIED` | 403 | The caller may not assign or end this responsibility or reporting line (self-assignment, outside their team, not the super admin). Never retry. |
| `COMM.STAFF_ASSIGNMENT_INVALID` | 409 | The assignment is not lawful: already active, already ended, or it breaks the reporting hierarchy. |
| `COMM.STAFF_DIRECTORY_DENIED` | 403 | The organization-wide staff overview belongs to `super_admin` alone. |

## Lessons (PD-9 / PD-11)

| Code | HTTP | Meaning |
|---|---|---|
| `COMM.LESSON_NOT_FOUND` | 404 | No such lesson or ruling, or one the caller may not see (another teacher's, another family's, another organization's). Deliberately one code. |
| `COMM.LESSON_DENIED` | 403 | The caller sees the lesson but may not record this on it: a parent writing a report, a teacher deciding a ruling, an Operations supervisor cancelling. Never retry. |
| `COMM.LESSON_STATE` | 409 | The lesson does not allow it now: already closed, not started yet, started already (send a late apology instead), or past the 48-hour late-apology window. Refresh the lesson; do not retry. |
| `COMM.LESSON_TEACHER_BUSY` | 409 | The teacher already has a lesson that overlaps this time. |

## Certificates, leave and the supervision conversation (PD-12)

| Code | HTTP | Meaning |
|---|---|---|
| `COMM.CERTIFICATE_NOT_FOUND` | 404 | No such certificate, or a learner the teacher does not teach (one code for both, so a teacher cannot probe other learners). |
| `COMM.CERTIFICATE_DENIED` | 403 | PD-41: the caller may not do this to this certificate (not the requester of record, not the learner's supervisor, not a designer, or no key). Never retry. |
| `COMM.CERTIFICATE_STATE` | 409 | The certificate's state does not allow this act, the file has not been uploaded, or the recipient has no live group. Refresh; do not retry. |
| `COMM.CERTIFICATE_DUPLICATE` | 409 | PD-41: the same certificate (recipient, type, Juz' or period) is already open or sent; `detail.certificateId` names it. |
| `COMM.CERTIFICATE_DUPLICATE_SUSPECTED` | 409 | PD-41: a similar certificate was requested in the last 30 days; resend with `confirmDuplicate: true` to file another. |
| `COMM.CERTIFICATE_NOT_APPROVED` | 409 | PD-41: send and Story need the requester's approval of the current design first. |
| `COMM.CERTIFICATE_REVISION_CHANGED` | 409 | PD-41: the design changed since it was reviewed; review `detail.currentFileId`. |
| `COMM.CERTIFICATE_SELF_APPROVAL` | 403 | PD-41: the person who uploaded a design does not approve it (four eyes). |
| `COMM.CERTIFICATE_TARGET_CHANGED` | 409 | PD-41: the group the server would send into changed since it was shown; `detail.conversationId` is the new one. Check and send again. |
| `COMM.CERTIFICATE_STORY_NOT_OPTED_IN` | 409 | PD-41: the request did not opt in to a Story. |
| `COMM.CERTIFICATE_STORY_CONSENT_MISSING` | 409 | PD-41: a student certificate's Story needs the family's recorded consent; none, or it was withdrawn. |
| `COMM.CERTIFICATE_STORY_NEEDS_IMAGE` | 409 | PD-41: a Story shows an image; this certificate's file is a PDF. |
| `COMM.CERTIFICATE_TYPE_DISABLED` | 409 | PD-41: the certificate type is disabled; pick an active one. |
| `COMM.STORY_MEDIA_NOT_GRANTED` | 403 | PD-41: a story's media is a `stories/` key that `POST /stories/media` issued to this publisher, used once. Any other key is refused. Upload again. |
| `COMM.LEAVE_NOT_FOUND` | 404 | No such leave request or teacher, or one the caller may not see. |
| `COMM.LEAVE_DENIED` | 403 | Leave is requested by a teacher for themselves, decided by the Teachers department, and the allowance is set by its manager or the super admin. Never retry. |
| `COMM.LEAVE_STATE` | 409 | The leave does not allow it: already decided or withdrawn, overlapping another open or approved request, in the past, or crossing a calendar year. |
| `COMM.LEAVE_LESSONS_COLLIDE` | 409 | Open lessons fall inside the leave. Approve again with `cancelCollidingLessons: true` to cancel them (each family is told in its group). |
| `COMM.FEEDBACK_DENIED` | 403 | PD-32: parent feedback is filed by the family's parent and handled by the Teachers department (or the super admin); a supervisor reads their families' only. A teacher never reaches it. |
| `COMM.FEEDBACK_NOT_FOUND` | 404 | PD-32: no such feedback, or the child is not in the parent's family, or the child has no teacher. |
| `COMM.FEEDBACK_LIMIT` | 429 | PD-32: the child (3) or the family (10) has filed as much feedback as a rolling 24 hours allows (`feedback.limit.*` in chat.config). |
| `COMM.FEEDBACK_STATE` | 409 | PD-32: not in a state that allows this; a complaint is resolved through its PD-26 resolution, not directly. |
| `COMM.SUPERVISION_DENIED` | 403 | Only the teacher themselves, or the Teachers department, opens a supervision conversation. |
| `COMM.SUPERVISION_NOT_FOUND` | 404 | No such active teacher in the caller's organization. |

| `COMM.DISCIPLINE_NOT_FOUND` | 404 | No such violation, lesson or teacher in the caller's organization. |
| `COMM.DISCIPLINE_DENIED` | 403 | Discipline is read, recorded and decided only by the Teachers department and the super admin. Never retry. |
| `COMM.DISCIPLINE_STATE` | 409 | Not allowed now: already decided, below the late threshold, the lesson was not held, the suspension starts in the past, or the teacher still has students (permanent suspension). |
| `COMM.DISCIPLINE_LESSONS_COLLIDE` | 409 | Open lessons fall inside the suspension. Decide again with `cancelCollidingLessons: true` to cancel them (each family is told in its group). For a permanent suspension, also when a lesson was booked after the cancellations: nothing was decided; decide again. |
| `COMM.DISCIPLINE_NOT_CANCELLED` | 409 | A permanent suspension cancels the teacher's lessons first; some could not be cancelled, so nothing was decided and the teacher is still active. `detail.cancelledLessons` / `detail.notCancelled` (`{ lessonId, reason }`). Deal with those lessons, then decide again. |
| `COMM.BILLING_DENIED` | 403 | A family's money (PD-17: read and recorded) is only for Operations supervisors (their families), the Operations Manager, the Sales department and the super admin, and a parent's own (`/me/billing`) only for a parent of that family; a billing supervisor is set only by the Operations Manager and the super admin. Never retry. |
| `COMM.BILLING_NOT_FOUND` | 404 | No such family in the caller's organization, or one this caller does not reach. |
| `COMM.BILLING_STATE` | 409 | PD-17: the instalment is already paid or voided. PD-27: also a payment request already paid, cancelled or expired, a receipt already decided, a card payment voided instead of refunded, a refund larger than what is left. Reload; never retry blindly. |
| `COMM.PAYMENTS_UNAVAILABLE` | 503 | PD-27: card payments are not configured on this deployment (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`). Offer the bank transfer instead. |
| `COMM.SUBSCRIPTION_LOCKED` | 403 | PD-30: the child's group is read-only for the parent and the teacher (lessons used up after the grace lessons, or an instalment overdue): a message, a reaction or a call there, or a lesson booked for the child. Staff are never refused; a direct chat never. Show the banner; retry after paying. |
| `COMM.SUBSCRIPTION_DENIED` | 403 | PD-30: exceptions are granted and revoked only by the super admin, the Operations Manager and the Sales Manager. Never retry. |
| `COMM.SUBSCRIPTION_STATE` | 409 | PD-30: the subscription is already voided, the exception already revoked, or a renewal was already requested today. Reload. |
| `COMM.PARENT_PROFILE_DENIED` | 403 | PD-17: Parent Profiles are the administration's (Operations in scope, the Operations Manager, Sales, the super admin) — never a teacher or a parent — and their contact record is edited by Operations and the super admin only (Sales gets this on an edit). Answered before any parent is looked up. Never retry. |
| `COMM.PARENT_PROFILE_NOT_FOUND` | 404 | PD-17: no such parent in the caller's organization, or one this caller does not reach. Indistinguishable on purpose. |
| `COMM.ACCOUNT_ADMIN_DENIED` | 403 | PD-21 as narrowed by PD-40: this caller may not reset, suspend, reactivate, sign out or impersonate this account. Parent accounts are administered by the super admin and the Operations department (Sales: reset and sign out only); teacher accounts by the super admin and the Teachers department; another staff account only by the super admin; nobody acts on the super admin's account or their own; a staff account is never impersonated. Never retry. |
| `COMM.PERMISSION_DENIED` | 403 | PD-40: this staff account does not hold the permission the route declares (`docs/security/pd040-route-permissions.md`), the route declares none, or it is a parent's or a teacher's own route. Only staff are checked. Until PD-40 enforces, existing staff roles are let through and the refusal is only logged (`SHADOW_DENIED`). Never retry: it changes only when the account's roles change. |
| `COMM.ACCOUNT_ADMIN_NOT_FOUND` | 404 | PD-21: no such account in the caller's organization. Indistinguishable from another tenant's account on purpose. |
| `COMM.ACCOUNT_ADMIN_STATE` | 409 | PD-21: the account is not in a state for this — suspending one that is not active, reactivating one that is not suspended, impersonating one that cannot sign in. Reload the account; never retry blindly. |
| `COMM.SESSION_NOT_FOUND` | 404 | PD-23: the account has no live session with this id — ended already, or another account's (one answer for both). Refetch the list. |
| `COMM.SUPPORT_SESSION_FORBIDDEN` | 403 | PD-21: not allowed in a support session (an administrator acting as a parent or teacher): it would act in the person's name where others see it, unlabelled — receipts, reactions, pins, edits, deletes for everyone, forwards, calls, devices, story views, lesson actions, new chats, logout. Only reads, a labelled message, the person's own profile and private state are allowed. Never retry. |
| `COMM.IMPERSONATION_NOT_FOUND` | 404 | PD-21: no such support session of the caller's (only the administrator who started one may re-token or end it). |
| `COMM.IMPERSONATION_ENDED` | 409 | PD-21: the support session has ended, expired or reached its hour. Start a new one. |
| `COMM.SCHEDULED_CALL_NOT_FOUND` | 404 | PD-13: no such scheduled call or call link, or one in a conversation the caller cannot read. Indistinguishable on purpose. |
| `COMM.SCHEDULED_CALL_DENIED` | 403 | PD-13: only the person who scheduled a call cancels it. (Scheduling itself answers with the call-capability refusal, e.g. `COMM.PARENT_CANNOT_START_GROUP_CALL`.) Never retry. |
| `COMM.SCHEDULED_CALL_NOT_JOINABLE` | 409 | PD-13: cancelled, not open yet (more than 10 minutes before its start), or over (2 hours after it). Show the state; do not retry automatically. |

Issuing a certificate answers `COMM.ATTACHMENT_NOT_IN_CONVERSATION` (403) for a
file that was not uploaded into the learner's group, and
`COMM.ATTACHMENT_TYPE_NOT_ALLOWED` (400) when the stored bytes are not the PDF or
image they were declared as.

A client may never send a message of type `card`; `POST /conversations/:id/messages`
answers `COMMON.VALIDATION` (400). Cards are written only by the ticket that
recorded them.

## Client guidance

- **Never retry** a BR-1 or role denial: it is a rule, not a transient failure.
- **Retry with the same `clientMessageId`** on a network error. Duplicate sends
  are free and return the original message.
- `COMM.APPROVAL_ALREADY_DECIDED` means refresh, not retry.
- Treat unknown `COMM.*` codes as a generic failure and show the `message`.
- **Retry** `COMM.REVOCATION_UNCONFIRMED` with the same request: the change is
  already saved; only its realtime completion is unconfirmed. Do not undo it.
- **Never retry** `COMM.STORY_EXPIRED` or `COMM.STORY_DELETED`: both are final
  states, not transient failures. Drop the story from the view instead.
