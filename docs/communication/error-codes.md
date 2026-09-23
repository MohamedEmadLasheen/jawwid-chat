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
| `COMM.TEACHER_PARENT_NOT_AUTHORIZED` | A teacher and a parent were about to share a 1:1 channel or call with **no authorized relationship** between them. Never retry. |
| `COMM.BR1_TEACHER_PARENT_DIRECT` | **DEPRECATED (PD-6).** No longer emitted by the server. Clients still treat it as terminal so older builds behave correctly. |
| `COMM.ROLE_CANNOT_MESSAGE_FAMILY` | Finance/technical/academic staff may never take part in family communication. |
| `COMM.TEACHER_TEACHER_DISABLED` | Teacher-to-teacher DMs are off by default. |
| `COMM.STAFF_STAFF_DISABLED` | Staff-to-staff DMs are not in MVP; use internal notes. |
| `COMM.INVALID_PARTICIPANTS` | The pair cannot form a conversation (two parents, self-chat, no staff side). |

## Authorization — HTTP 403

| Code | Meaning |
|---|---|
| `COMM.NOT_ON_DUTY` | Staff is not on duty for this family. Internal notes are still allowed. |
| `COMM.ASSIST_NOT_PERMITTED` | Assist needs a server-evaluated grant. A client-supplied mode never grants access. |
| `COMM.ESCALATION_NOT_PERMITTED` | As above, for escalation. |
| `COMM.NOT_CONVERSATION_MEMBER` | Actor is not a live member. |
| `COMM.CONTACT_CANNOT_MESSAGE` | The contact lacks `can_message`. |
| `COMM.CONTACT_CANNOT_WRITE_INTERNAL` | Contacts cannot write internal notes. |
| `COMM.TEACHER_CANNOT_WRITE_INTERNAL` | Teachers cannot write internal notes. |
| `COMM.MEMBER_IS_SILENT` | Present in the conversation but may not post. |
| `COMM.ACTOR_INACTIVE` | Deactivated or offboarded actor. |
| `COMM.CANNOT_MANAGE_MEMBERSHIP` | Only Jawwid admins change membership. |
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

## Calling

| Code | HTTP | Meaning |
|---|---|---|
| `COMM.CALL_NOT_FOUND` | 404 | |
| `COMM.CALL_ALREADY_ENDED` | 409 | No token is issued for an ended call. |
| `COMM.CALL_NOT_A_PARTICIPANT` | 403 | Not in the server-derived participant set. |
| `COMM.PARENT_CANNOT_START_GROUP_CALL` | 403 | Product decision PD-2: a parent may JOIN a Student Group or Class Group call but may never START one. Never retry; a teacher or an admin starts it. |

## Client guidance

- **Never retry** a BR-1 or role denial: it is a rule, not a transient failure.
- **Retry with the same `clientMessageId`** on a network error. Duplicate sends
  are free and return the original message.
- `COMM.APPROVAL_ALREADY_DECIDED` means refresh, not retry.
- Treat unknown `COMM.*` codes as a generic failure and show the `message`.
