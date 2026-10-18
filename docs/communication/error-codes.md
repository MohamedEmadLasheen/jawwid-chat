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
| `COMM.NOT_MESSAGE_AUTHOR` | Only the author (or a manager) may delete for everyone. |
| `COMM.DELETE_WINDOW_EXPIRED` | Past `communication.delete_for_everyone_window_minutes`. |

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
| `COMM.REVOCATION_UNCONFIRMED` | 503 | RT-009. A membership removal, Student Group sync, logout or session/account revocation **is committed**, but not every API server confirmed it can no longer deliver realtime events to the revoked person on an earlier decision — so it is not reported as done. Retry the same request; it is idempotent and succeeds once every server confirms. |

## Calling

| Code | HTTP | Meaning |
|---|---|---|
| `COMM.CALL_NOT_FOUND` | 404 | |
| `COMM.CALL_ALREADY_ENDED` | 409 | No token is issued for an ended call. |
| `COMM.CALL_NOT_A_PARTICIPANT` | 403 | Not in the server-derived participant set. |
| `COMM.PARENT_CANNOT_START_GROUP_CALL` | 403 | Product decision PD-2: a parent may JOIN a Student Group or Class Group call but may never START one. Never retry; a teacher or an admin starts it. |

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
