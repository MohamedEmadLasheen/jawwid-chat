# Error codes

Every failure returns `{ "error": { "code": "COMM.…", "message": "…" } }`.
**Branch on `code`, never on `message`.** Adding a code is safe; changing or
removing one is a breaking change.

Source of truth: `apps/api/src/platform/errors.ts`.

## BR-1 and the communication matrix — HTTP 403

| Code | Meaning |
|---|---|
| `COMM.BR1_TEACHER_PARENT_DIRECT` | A teacher and a parent were about to share a 1:1 channel or call. Never retry; offer the Student Group instead. |
| `COMM.ROLE_CANNOT_MESSAGE_FAMILY` | Departmental staff (a `chat.staff.department` of finance, technical or academic) may never take part in family communication. Since Phase 1 a department is an attribute, not a role. |
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
| `COMM.NOT_MESSAGE_AUTHOR` | Only the author, or somebody holding `messages.delete`, may delete for everyone. |
| `COMM.DELETE_WINDOW_EXPIRED` | Past `communication.delete_for_everyone_window_minutes`. |
| `COMM.OUT_OF_SCOPE` | The record exists, but this family is not in the actor's current authorized scope. A reassignment produces this on the very next request. Never retry; refresh the list. |
| `COMM.PERMISSION_DENIED` | The actor's effective permissions do not include the required key. Note "effective": a per-account DENY produces this for somebody whose role would otherwise allow it. |
| `COMM.CROSS_TENANT` | The record belongs to another organization. |

Codes that name a record the caller may not reach return **404 with
`COMM.CONVERSATION_NOT_FOUND`**, not 403: a by-id route must answer identically
for a record that exists elsewhere and one that does not exist at all, or the
error itself becomes an existence oracle.

## Authentication — HTTP 401 (403 where noted)

| Code | Meaning |
|---|---|
| `AUTH.MISSING_TOKEN` | No `Authorization: Bearer` header. |
| `AUTH.INVALID_TOKEN` | Signature, session or principal did not verify. Refresh, then re-authenticate. |
| `AUTH.INVALID_CREDENTIALS` | Wrong password — **or** an unknown subject, or a principal who is no longer active. The three are deliberately indistinguishable, so the endpoint cannot be used to enumerate accounts. |
| `AUTH.ACCOUNT_DISABLED` | The account is provisioned, suspended or deactivated. Told apart from a bad password on purpose: a person locked out of their own account needs to know why. |
| `AUTH.ACCOUNT_LOCKED` | Too many failed attempts; try again after `auth.lockout_seconds`. |
| `AUTH.SESSION_INVALID` | The refresh token is spent, revoked or expired. |
| `AUTH.DEVICE_LIMIT_REACHED` | **403.** Only under the `reject_new` device-limit policy. |
| `AUTH.WEAK_PASSWORD` | **400.** Shorter than `auth.min_password_length`. |
| `AUTH.INVALID_RESET_TOKEN` | **400.** The reset link is unknown, spent or expired. |
| `AUTH.INVALID_VERIFICATION_TOKEN` | **400.** As above, for verification. |
| `AUTH.FORBIDDEN` | **403.** The action requires a permission the caller does not hold. |
| `AUTH.NOT_FOUND` | **404.** No such account or session **for this caller** — including one that belongs to somebody else. |

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
