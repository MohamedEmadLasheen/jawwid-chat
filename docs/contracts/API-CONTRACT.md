# Jawwid Chat — Canonical API Contract (Phase 0)

**Status: CANONICAL · Phase 0 · supersedes `docs/admin/backend-contract-required.md`, `docs/communication/{mobile,admin}-contract.md` as contracts (they remain as reference), `docs/infrastructure/api-contract-reconciliation.md`.**

Date: 2026-09-07 · Branch: `integration/recovery` (HEAD includes OD-01 and `organization_id`).
Product decisions PD-1 to PD-5 are **CLOSED**; the record is `../product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` §4. PD-2 is implemented in this branch.
Evidence base: `apps/api/src/**` (controllers, services, `contracts/dto.ts`, `contracts/events.ts`, `platform/errors.ts`, `platform/authorization.service.ts`), `apps/admin-web/src/core/api/endpoints.ts`, `apps/admin-web/src/core/realtime/*`, `lib/core/data/http/*.dart`, `lib/core/network/*.dart`.

How to read this document:

- **EXISTS** — implemented in `apps/api` today; shape below is what the code does.
- **MISSING** — required for Phase 1; not implemented; spec below is normative.
- **RECONCILE** — implemented, but Phase 1 must change it in the stated way. Nothing is changed in Phase 0.
- **RENAME** — same operation, different name/header on a client; the client changes.
- **DUPLICATE** — a client endpoint whose operation an existing API route already serves.
- **OBSOLETE** — CRM machinery removed by product direction (decision 6). No replacement.
- **DEFERRED** — product decision pending; not part of the Phase 1 contract.

Phase in which each item lands: **Phase 0** = this document only · **Phase 1** = authentication + canonical endpoints + listed fixes · **Phase 2** = later.

---

## 1. Conventions

| Topic | Rule | Evidence / note |
|---|---|---|
| Base path | `/api/v1` for every route except health. Health is mounted at `/health`, `/health/live`, `/health/ready` with **no** prefix. | `apps/api/src/main.ts` `setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] })` |
| Transport | HTTPS JSON. Request `Content-Type: application/json`. Responses are JSON objects; a mutation that has nothing to return answers `{ "ok": true }`. | controllers |
| Casing | **camelCase** on the wire, in every request and response field and query parameter. Enum values are lower snake (`student_group`, `waiting_on_jawwid`), exactly as in `contracts/vocab.ts`. | decision 1; `dto.ts`; `vocab.ts` |
| Authentication (Phase 1) | HTTP: `Authorization: Bearer <access token>`. WebSocket: socket.io handshake `auth: { token }` on the **default** namespace. Access tokens are short-lived; refresh tokens rotate (`POST /auth/refresh`). | decision 2 |
| Authentication (today) | **As specified above — the deprecated seam is gone.** HTTP `x-actor-id` was removed by PR-B; the WebSocket `auth: { actorId }` handshake was removed 2026-09-23 (Phase 8). The socket now verifies `auth: { token }` — `Authorization: Bearer` is accepted as a fallback — through the same `AuthService.authenticate()` the HTTP guard uses. A missing, malformed, forged or revoked token disconnects the socket, and no client-supplied field can name the actor. The `APP_ENV` boot restriction that contained the old seam is deleted. | `api/actor.decorator.ts`, `realtime/realtime.gateway.ts` `handleConnection`, `platform/auth/auth.service.ts` |
| Cookies | Not part of the contract. Admin Web drops `credentials: 'include'` and adopts bearer tokens. | decision 2; `admin-web/src/core/api/client.ts` |
| Authorization | Server-side `AuthorizationService` (`platform/authorization.service.ts`) is the only place an access decision is made. Client permission lists are UX affordances only. Every canonical endpoint states: **auth** (required / none), **permission key**, **scope rule**. | decision 8; `admin-web/src/core/permissions/capabilities.ts` header comment |
| Error body | `{ "error": { "code": "<stable code>", "message": "<developer diagnostic>" } }`. Clients branch on `code` and localise client-side; `message` is never rendered to a user. **Today only `CommError` is mapped** (`api/http-exception.filter.ts`); Nest defaults (`{statusCode,message,error}`) still leak for unknown routes, malformed JSON and the health 503. **Phase 1: a catch-all filter maps every non-`CommError` to the same body using the `COMMON.*` codes below.** | decision 1; `main.ts` `useGlobalFilters(new CommErrorFilter())` |
| Pagination — messages | `?before=<seq>` walks back (descending), `?after=<seq>` catches up (ascending), `?limit=` capped by config `communication.page_size_max` (100), default `communication.page_size_default` (50). Response `{ messages, nextBefore }`; `nextBefore` is non-null only when a full page was returned. Unchanged. | `messages/message.service.ts#list` |
| Pagination — every other list | `?cursor=<opaque>&limit=<n>` → `{ items: T[], nextCursor: string \| null }`. Existing lists that return a bare array or a named array (`{conversations}`, `{approvals}`, `{history}`, `{calls}`) are **RECONCILE** and keep their current shape until Phase 1. | decision 4 |
| Idempotency — message send | Body `clientMessageId` (client-generated UUID). A retry with the same value returns the original `MessageDto` instead of creating a duplicate; concurrent duplicates collapse on the unique index. **Existing.** | `message.service.ts#send`, `findByClientMessageId` |
| Idempotency — other mutations | Header **`Idempotency-Key: <uuid>`** on every non-idempotent POST/PATCH/DELETE. Server-side enforcement (replay returns the first response; a different body under the same key → `409 COMMON.IDEMPOTENCY_CONFLICT`) is **Phase 1+**; today the header is accepted and ignored. Mobile's `X-Idempotency-Key` is a **RENAME**. | decision 3; `admin-web/src/core/api/client.ts`; `lib/core/network/api_client.dart` `idempotencyHeader` |
| `seq` | Per-conversation 64-bit sequence assigned by the server under a row lock. **Always a JSON string** (`"42"`), in DTOs, query parameters, `upToSeq`, and events. Ordering comes from `seq`, never from device clocks. | `dto.ts` `seq: string \| null`; `message.service.ts` `SELECT last_seq … FOR UPDATE` |
| Dates | ISO-8601 UTC with milliseconds (`2026-09-06T10:00:00.000Z`) in every field. Inputs (`mutedUntil`) are parsed as ISO-8601. | `dto.ts` `toISOString()` |
| Identifiers | UUID strings. `audit_log.id` / `event_log.id` are bigint and are serialised as strings. | `prisma/schema.prisma` |
| Privacy | **No contact channel ever crosses this API**: no phone number, email, or address in any DTO, event, notification payload, log line, or error message. The chat schema has no such column; every DTO mapper enumerates fields explicitly (no spread). Actors are an opaque id plus a display name. | `dto.ts` header comment; `platform/types.ts` `Actor`; `events.ts` header |
| Tenancy | `organization_id` exists on every root entity with a DB default. It is **not** a wire field in Phase 1; the server derives it from the authenticated principal. | `prisma/schema.prisma` |
| CORS | Browser origins must be in `CORS_ALLOWED_ORIGINS`; requests without an `Origin` header (mobile, curl) are not CORS requests. | `infra/http/bootstrap.ts` |
| Vocabulary | Conversation (`direct` \| `student_group` \| `class_group` \| `official`), Participant/member, Message, Attachment, Call, Approval, Notification, Family, Learner, Contact, Staff, Teacher, Organization. Admin Web's `thread` → Conversation; `case` → removed (product decision C-3); `InboxRow` → conversation summary. | decision 5; `vocab.ts`; `docs/release/od-01-conversation-model.md` |

### 1.1 Error codes

Source of truth: `apps/api/src/platform/errors.ts`. Default HTTP status of a `CommError` is **403** unless the raise site passes another status; the statuses below are taken from the raise sites in the services.

| Code | HTTP | Raised when |
|---|---|---|
| `COMM.TEACHER_PARENT_NOT_AUTHORIZED` | 403 | A teacher and a parent would share a 1:1 conversation or call **without an authorized relationship** (`canOpenDirect`, `canSend`, `canCall`; PD-6). Never retry. |
| `COMM.BR1_TEACHER_PARENT_DIRECT` | 403 | **DEPRECATED (PD-6, 2026-09-23).** No longer emitted: the blanket teacher↔parent 1:1 prohibition was re-versioned. Clients keep treating it as terminal so older builds behave correctly. |
| `COMM.BR1_ADMIN_PRESENCE_REQUIRED` | 403 | Teacher and parent in a group with no live Jawwid admin member (C-4), or presence could not be established (fail closed). |
| `COMM.ROLE_CANNOT_MESSAGE_FAMILY` | 403 | Staff role is finance / technical / academic. |
| `COMM.TEACHER_TEACHER_DISABLED` | 403 | Teacher ↔ teacher direct. |
| `COMM.STAFF_STAFF_DISABLED` | 403 | Staff ↔ staff direct (use internal notes). |
| `COMM.INVALID_PARTICIPANTS` | 403 | Self-chat, contact ↔ contact, or no staff side. |
| `COMM.NOT_ON_DUTY` | 403 | Staff (non-manager) sends customer-visible text to a family they are not on duty / sticky for. |
| `COMM.ASSIST_NOT_PERMITTED` | 403 | `requestedMode: "assist"` — no server-evaluated grant exists yet (JC-005, fail closed). |
| `COMM.ESCALATION_NOT_PERMITTED` | 403 | `requestedMode: "escalation"` — as above. |
| `COMM.NOT_CONVERSATION_MEMBER` | 403 | Contact or teacher who is not a live member. |
| `COMM.CONTACT_CANNOT_MESSAGE` | 403 | Contact lacks `can_message`. |
| `COMM.CONTACT_CANNOT_WRITE_INTERNAL` | 403 | Contact sends `visibility: "internal"`. |
| `COMM.TEACHER_CANNOT_WRITE_INTERNAL` | 403 | Teacher sends `visibility: "internal"`. |
| `COMM.MEMBER_IS_SILENT` | 403 | Member has `isSilent`. |
| `COMM.ACTOR_INACTIVE` | 403 | Deactivated / offboarded actor. |
| `COMM.CANNOT_MANAGE_MEMBERSHIP` | 403 | Non-family-facing actor calls `POST /conversations/:id/members`. |
| `COMM.CANNOT_APPROVE` | 403 | Not the active handler or a manager; also returned by `GET /approvals/history/:conversationId` for non-staff. |
| `COMM.NOT_MESSAGE_AUTHOR` | 403 | Delete-for-everyone by neither the author nor a manager. |
| `COMM.DELETE_WINDOW_EXPIRED` | 403 | Author past `communication.delete_for_everyone_window_minutes` (60). |
| `COMM.UNKNOWN_ACTOR` | 401 | Actor id resolves to nobody (`requireActor`). |
| `COMM.CONVERSATION_NOT_FOUND` | 404 | Unknown conversation; also unknown learner in `POST /conversations/student-group`. |
| `COMM.CONVERSATION_ARCHIVED` | 403 | Write to an archived conversation. |
| `COMM.MESSAGE_NOT_FOUND` | 404 | Unknown message, a message the actor may not see (internal / pending), a missing reply target, **and an unknown approval id** (`approval.service.ts#decide`). |
| `COMM.REPLY_TARGET_CROSS_CONVERSATION` | 403 | `replyToMessageId` belongs to another conversation. |
| `COMM.EMPTY_MESSAGE` | 400 | Text without body, or media type without attachment. |
| `COMM.ATTACHMENT_TOO_LARGE` | 400 | Over the per-kind byte limit (`ATTACHMENT_MAX_BYTES_*`). |
| `COMM.ATTACHMENT_TYPE_NOT_ALLOWED` | 400 | Unknown kind or MIME not allowed for the kind. |
| `COMM.APPROVAL_ALREADY_DECIDED` | 409 | Refresh, do not retry. |
| `COMM.APPROVAL_REASON_REQUIRED` | 400 | Rejection without a non-blank reason. |
| `COMM.GROUP_ALREADY_EXISTS` | — | Declared; **no raise site found** in the services reviewed (`ensureStudentGroup` returns the existing group instead). Reserved. |
| `COMM.CALL_NOT_FOUND` | 404 | |
| `COMM.CALL_ALREADY_ENDED` | 409 | Token requested for an ended call. |
| `COMM.CALL_NOT_A_PARTICIPANT` | 403 | Not in the server-derived participant set. |
| `COMM.PARENT_CANNOT_START_GROUP_CALL` | 403 | **PD-2.** A family contact tried to START a `student_group` / `class_group` call. Joining is allowed; starting is a teacher or staff action. Never retry. |

**Phase 1 codes (normative, not yet in `errors.ts`):**

| Code | HTTP | Meaning |
|---|---|---|
| `AUTH.UNAUTHENTICATED` | 401 | Missing / malformed / expired bearer token. Clients refresh once, then end the session. |
| `AUTH.INVALID_CREDENTIALS` | 401 | Login: wrong username or password (single code for both). |
| `AUTH.ACCOUNT_DISABLED` | 403 | Login or any call: account deactivated / offboarded. Terminal for the client. |
| `AUTH.ACCOUNT_LOCKED` | 403 | Login: temporarily locked after repeated failures. Terminal until unlock. |
| `AUTH.SESSION_REVOKED` | 401 | Refresh token revoked, rotated-and-reused, or session deleted. Terminal. |
| `AUTH.FORBIDDEN` | 403 | Authenticated but lacks the permission key (used only where no `COMM.*` code is more specific). |
| `COMMON.VALIDATION` | 400 | Body / query fails schema validation. `message` names the field. |
| `COMMON.NOT_FOUND` | 404 | Unknown route or resource with no domain-specific code. |
| `COMMON.IDEMPOTENCY_CONFLICT` | 409 | Same `Idempotency-Key`, different request body. |
| `COMMON.RATE_LIMITED` | 429 | Includes `Retry-After`. |

Flutter already distinguishes `unauthenticated`, `accountDisabled` and `sessionRevoked` (`lib/core/network/api_client.dart#_onError`); the three `AUTH.*` codes above are what its `ErrorMapper` must map to.

### 1.2 Permission keys

Canonical list (decision 8). Server-side evaluation only; `GET /me` returns the actor's keys for UX.

| Key | Grants | Who holds it (Phase 1 default) |
|---|---|---|
| `messages.read` | Read messages, receipts, unread, react, delete-for-me | Every active actor (scoped by membership / family scope) |
| `messages.send` | Send messages, authorize uploads | Every active actor subject to `AuthorizationService.canSend` |
| `messages.delete` | Delete for everyone (author, inside window) | Every active actor |
| `messages.moderate` | Approve / reject, delete for everyone at any time, approval queue & history | Family-facing staff (admin, coverage, manager) |
| `conversations.read` | List / open conversations, preferences | Every active actor |
| `conversations.manage` | Create student groups, sync, change membership | Family-facing staff |
| `families.read` | Family list / detail / conversations / assignment history | Family-facing staff |
| `families.assign` | Reassign supervisor | Manager |
| `contacts.view_private` | Reserved: no private contact field exists in the chat schema. Gates nothing in Phase 1. | Manager |
| `calls.start` | Start a call | Every active actor subject to `canCall` |
| `calls.accept` | Accept / decline / token / end | Call participants |
| `broadcasts.send` | Post to `official` conversations (BR-7). **No endpoint yet**; reserved. | Manager |
| `audit.read` | `GET /audit` | Manager |
| `settings.manage` | `PATCH /config` (DEFERRED) | Manager |
| `users.manage` | `GET /staff` (and future staff mutations) | Manager |
| `sessions.manage` | Own sessions and device tokens | Every active actor (own only) |

---

## 2. Inventory & classification

One row per distinct (method, path). Paths are relative to `/api/v1` unless marked. "Called by" = API (implemented), Admin (`endpoints.ts` / `RealtimeProvider.tsx`), Flutter (`lib/core/data/http/*.dart`).

### 2.1 API routes (35)

| Method | Path | Called by | Classification | Canonical replacement or note |
|---|---|---|---|---|
| GET | `/conversations` | API, Flutter | RECONCILE | Gains `familyId`, `section`, `cursor`/`limit`; response → `{items,nextCursor}`; staff scope narrowed (RT-011). §3.4 |
| POST | `/conversations/direct` | API | EXISTS | §3.4 |
| POST | `/conversations/student-group` | API | RECONCILE | No actor/permission check today; Phase 1 requires `conversations.manage`. §3.4 |
| POST | `/conversations/student-group/:learnerId/sync` | API | RECONCILE | **No actor at all.** Phase 1: `conversations.manage` or internal-only (worker). §3.4, §5 |
| GET | `/conversations/:id` | API, Flutter | RECONCILE | Must include `members[]` (promised by `mobile-contract.md`, not passed by the controller). Side-effect upsert removed. §3.4 |
| POST | `/conversations/:id/members` | API | RECONCILE | `reason` must be validated (400) rather than failing at the DB NOT NULL. §3.4 |
| POST | `/conversations/:id/preferences` | API, Flutter | EXISTS | §3.4 |
| GET | `/conversations/:conversationId/messages` | API, Flutter | EXISTS | seq pagination unchanged. §3.5 |
| POST | `/conversations/:conversationId/messages` | API, Flutter | EXISTS | Idempotent on `clientMessageId`. §3.5 |
| POST | `/conversations/:conversationId/messages/attachments/authorize` | API | RECONCILE | Checks `canRead` today; Phase 1 checks `canSend`. §3.6 |
| POST | `/conversations/:conversationId/messages/read` | API, Flutter | EXISTS | §3.5 |
| GET | `/conversations/:conversationId/messages/unread` | API, Flutter | EXISTS | Counts only the caller's own receipts; no membership check needed. §3.5 |
| POST | `/conversations/:conversationId/messages/:messageId/delivered` | API | EXISTS | Duplicate of WS `message.delivered`; kept. §3.5 |
| POST | `/conversations/:conversationId/messages/:messageId/reactions` | API, Flutter | EXISTS | §3.5 |
| DELETE | `/conversations/:conversationId/messages/:messageId/reactions` | API, Flutter | RECONCILE | Gains `?emoji=`; Flutter must send it. §3.5, §6 |
| DELETE | `/conversations/:conversationId/messages/:messageId/me` | API | EXISTS | §3.5 |
| DELETE | `/conversations/:conversationId/messages/:messageId` | API | EXISTS | `?reason=` query. §3.5 |
| GET | `/approvals/pending` | API | RECONCILE | Unscoped (all pending, any family, `take: 200`); Phase 1 scopes to handler/manager and paginates. §3.7 |
| GET | `/approvals/mine` | API | RECONCILE | Response → `{items,nextCursor}` (Phase 1). §3.7 |
| POST | `/approvals/:id/approve` | API | EXISTS | §3.7 |
| POST | `/approvals/:id/reject` | API | EXISTS | §3.7 |
| GET | `/approvals/history/:conversationId` | API | RECONCILE | Response → `{items,nextCursor}` (Phase 1). §3.7 |
| POST | `/calls` | API | EXISTS | §3.8 |
| POST | `/calls/:id/token` | API | EXISTS | §3.8 |
| POST | `/calls/:id/accept` | API | EXISTS | Emits `call.participant_joined`, not `call.accepted`. §3.8 |
| POST | `/calls/:id/decline` | API | EXISTS | §3.8 |
| POST | `/calls/:id/end` | API | EXISTS | §3.8 |
| GET | `/calls/history/:conversationId` | API | RECONCILE | Response → `{items,nextCursor}` (Phase 1). §3.8 |
| POST | `/notifications/devices` | API | RECONCILE | Token re-binding to any actor; Phase 1 binds to the authenticated session. §3.9 |
| DELETE | `/notifications/devices/:token` | API | RECONCILE | **No actor at all.** Phase 1: auth required, own tokens only. §3.9, §5 |
| POST | `/notifications/:id/delivered` | API | RECONCILE | **No actor at all.** Phase 1: auth required, recipient only. §3.9, §5 |
| POST | `/notifications/:id/opened` | API | EXISTS | §3.9 |
| GET | `/health/live` (no prefix) | API | EXISTS | §3.11 |
| GET | `/health/ready` (no prefix) | API | EXISTS | §3.11 |
| GET | `/health` (no prefix) | API | EXISTS | §3.11 |

### 2.2 Admin Web endpoint definitions (48, `apps/admin-web/src/core/api/endpoints.ts`)

| Method | Path | Called by | Classification | Canonical replacement or note |
|---|---|---|---|---|
| GET | `/me` | Admin | MISSING | `GET /me` → `ActorDto`, not `Staff` (snake_case → camelCase). §3.2 |
| GET | `/me/duty` | Admin | DEFERRED | Depends on shifts/coverage windows (product decision pending). Not Phase 1. |
| POST | `/auth/login` | Admin | MISSING | `POST /auth/login`; body `{username,password}` (was `{email,password}`); returns tokens, not a cookie. §3.1 |
| POST | `/auth/logout` | Admin | MISSING | `POST /auth/logout`. §3.1 |
| GET | `/config` | Admin | MISSING | `GET /config` (staff only). §3.2 |
| PATCH | `/config` | Admin | DEFERRED | `settings.manage`; not Phase 1. |
| GET | `/inbox?section=` | Admin | RENAME | `GET /conversations?section=…&cursor=&limit=` (§3.4). Sections are `needs_reply \| pending_approval \| unanswered \| all`; brief-era buckets (`now/today/waiting_family/quiet`, `covering`) are OBSOLETE. |
| GET | `/inbox/away-summary` | Admin | OBSOLETE | CRM (handoffs). |
| GET | `/inbox/shift-banner` | Admin | OBSOLETE | Shift presentation. |
| POST | `/inbox/snooze-to-next-shift` | Admin | OBSOLETE | |
| POST | `/inbox/order-feedback` | Admin | OBSOLETE | Attention-weight calibration. |
| GET | `/families/:id` | Admin | MISSING | `GET /families/:id` (camelCase; learners + contacts; no phone). §3.3 |
| GET | `/families/:id/messages` | Admin | RENAME | Messages live on conversations: `GET /families/:id/conversations` then `GET /conversations/:id/messages`. |
| POST | `/families/:id/messages` | Admin | RENAME | `POST /conversations/:id/messages` (`case_id` dropped; `visibility` kept). |
| GET | `/families/:id/cases` | Admin | OBSOLETE | No Case entity (C-3). |
| POST | `/families/:id/cases` | Admin | OBSOLETE | |
| POST | `/families/:id/notes` | Admin | DUPLICATE | `POST /conversations/:id/messages` with `visibility: "internal"`. `pinned` has no server counterpart (dropped). |
| POST | `/families/:id/pin-handler` | Admin | OBSOLETE | Stickiness is derived server-side on reply (`stickyHandlerId`/`stickyUntil`); never set by a client. |
| POST | `/families/:id/defer-to-owner` | Admin | OBSOLETE | |
| GET | `/families` | Admin | MISSING | `GET /families?q&cursor&limit` scoped to the actor. Filters `owner_id/on_duty_id/bucket/state/needs_reply` → only `q` and `ownerId` survive. §3.3 |
| GET | `/families/:id/transfer-impact` | Admin | OBSOLETE | Workload scoring / open cases / open tasks. |
| POST | `/families/:id/transfer-ownership` | Admin | RENAME | `POST /families/:id/assignment` `{toStaffId, reason}`. §3.3 |
| PATCH | `/cases/:id` | Admin | OBSOLETE | |
| POST | `/cases/:id/escalate` | Admin | OBSOLETE | |
| POST | `/cases/:id/follow-up` | Admin | OBSOLETE | |
| GET | `/tasks` | Admin | DEFERRED | Generic task management out of scope; a conversation-scoped follow-up may return. |
| POST | `/tasks` | Admin | DEFERRED | |
| PATCH | `/tasks/:id` | Admin | DEFERRED | |
| GET | `/coverage/shifts` | Admin | DEFERRED | Product decision pending on coverage windows. |
| POST | `/coverage/shifts` | Admin | DEFERRED | |
| PATCH | `/coverage/shifts/:id` | Admin | DEFERRED | |
| DELETE | `/coverage/shifts/:id` | Admin | DEFERRED | |
| GET | `/coverage/rules` | Admin | DEFERRED | |
| POST | `/coverage/rules` | Admin | DEFERRED | |
| PATCH | `/coverage/rules/:id` | Admin | DEFERRED | |
| DELETE | `/coverage/rules/:id` | Admin | DEFERRED | |
| GET | `/coverage/absences` | Admin | DEFERRED | |
| POST | `/coverage/absences` | Admin | DEFERRED | |
| POST | `/absences/:id/activate-backup` | Admin | DEFERRED | |
| GET | `/coverage/tonight` | Admin | OBSOLETE | |
| GET | `/coverage/gaps` | Admin | DEFERRED | |
| GET | `/dashboard/header` | Admin | OBSOLETE | Unattended count / open escalations (CRM). |
| GET | `/dashboard/team-now` | Admin | OBSOLETE | |
| GET | `/dashboard/unattended` | Admin | OBSOLETE | Nearest canonical: `GET /conversations?section=needs_reply`. |
| GET | `/dashboard/needs-action` | Admin | OBSOLETE | |
| GET | `/dashboard/this-week` | Admin | OBSOLETE | Renewals / at-risk. |
| GET | `/staff` | Admin | MISSING | `GET /staff` (manager, paginated, camelCase). §3.10 |
| POST | `/staff/:id/offboard` | Admin | DEFERRED | `users.manage`; requires the assignment endpoint first. Phase 2. |

### 2.3 Flutter calls (`lib/core/data/http/*.dart`)

| Method | Path | Called by | Classification | Canonical replacement or note |
|---|---|---|---|---|
| GET | `/conversations` | Flutter (`http_conversation_repository.dart:36`) | EXISTS → RECONCILE | Reads `{conversations}`; Phase 1 reads `{items,nextCursor}`. Filters archived locally (no server param). |
| GET | `/conversations/:id` | Flutter (`http_conversation_repository.dart:57`, `http_group_repository.dart:27`) | EXISTS → RECONCILE | Group repository expects `members[]`; the controller does not return it today. Server fix (§3.4). |
| POST | `/conversations/:id/preferences` | Flutter (`:132`) | EXISTS | |
| POST | `/conversations/:id/messages/read` | Flutter (`:97`) | EXISTS | `upToSeq` string. |
| GET | `/conversations/:id/messages/unread` | Flutter (`:110`) | EXISTS | Not called per row (O1). |
| GET | `/conversations/:id/messages?before&limit` | Flutter (`http_message_repository.dart:43`) | EXISTS | |
| GET | `/conversations/:id/messages?after` | Flutter (same) | EXISTS | Reconnect catch-up. |
| POST | `/conversations/:id/messages` | Flutter (same) | EXISTS + RENAME | Body ok; header `X-Idempotency-Key` → `Idempotency-Key`. |
| POST | `/conversations/:id/messages/:messageId/reactions` | Flutter (`:124`) | EXISTS | |
| DELETE | `/conversations/:id/messages/:messageId/reactions` | Flutter (`:131`) | RECONCILE | Must send `?emoji=`; today dropped. |
| — | `x-actor-id` header (debug builds only) | Flutter (`lib/core/network/actor_identity.dart`) | RENAME | Replaced by `Authorization: Bearer`. |
| — | auth: login / refresh / me / logout / sessions | Flutter (`unavailable_auth_repository.dart`) | MISSING | §3.1, §3.2 |
| — | typing / realtime | Flutter (`setTyping` no-op) | MISSING (client) | Flutter has no socket client yet; §4 is the contract to implement. |

---

## 3. Canonical endpoints

Spec block fields: **Auth** · **Permission** · **Scope** · **Request** · **Response** · **Errors** (beyond `AUTH.UNAUTHENTICATED` / `AUTH.ACCOUNT_DISABLED` / `COMMON.VALIDATION`, which apply to every authenticated route) · **Pagination** · **Idempotency** · **Audit** (rows written in the same transaction) · **Realtime** (outbox events enqueued; delivered by the worker per §4). Field names for EXISTS endpoints are verbatim from `contracts/dto.ts` and the controllers.

Shared DTOs (`apps/api/src/communication/contracts/dto.ts`):

```
ConversationDto {
  id, type: 'direct'|'student_group'|'class_group'|'official', familyId: string|null,
  learnerId: string|null, title: string|null,
  state: 'open'|'waiting_on_customer'|'waiting_on_jawwid'|'resolved',   // computed
  needsReply: boolean, lastSeq: string, lastActivityAt: string, archivedAt: string|null,
  teacherRequiresApproval: boolean, parentRequiresApproval: boolean,
  members?: ConversationMemberDto[]                                       // detail only
}
ConversationMemberDto { actorId, actorKind: 'contact'|'staff'|'teacher'|'system',
  memberRole: 'parent'|'teacher'|'admin'|'observer', isSilent: boolean }
MessageDto {
  id, conversationId: string|null, seq: string|null, authorKind, authorId: string|null,
  onBehalfMode: 'owner'|'coverage'|'assist'|'escalation'|null,
  type: 'text'|'image'|'video'|'voice'|'file'|'system', body: string|null,
  visibility: 'customer'|'internal', moderation: 'published'|'pending'|'rejected',
  origin: 'user'|'automation'|'broadcast', replyToMessageId: string|null,
  clientMessageId: string|null, deletedAt: string|null, deletedForAll: boolean, createdAt,
  attachments: AttachmentDto[], reactions: {actorId, emoji}[],
  receipts: {actorId, state: 'sent'|'delivered'|'read', deliveredAt, readAt}[]   // RT-012, see §5
}
AttachmentDto { id, kind: 'image'|'video'|'voice'|'file', mimeType, byteSize, originalName,
  durationMs, width, height, url: string|null /* signed, short-lived */, thumbnailUrl }
```

Phase 1 DTOs (normative):

```
ActorDto {
  actorId, kind: 'contact'|'staff'|'teacher', displayName, locale: 'ar'|'en', isActive,
  staffRole?: 'admin'|'coverage'|'manager'|'finance'|'technical'|'academic',   // kind=staff
  familyId?: string, canMessage?: boolean,                                       // kind=contact
  organizationId, permissions: string[]                                          // UX only
}
TokenPairDto { tokenType: 'Bearer', accessToken, expiresIn: number /* seconds */, refreshToken,
  session: { id, createdAt }, actor: ActorDto }
SessionDto { id, createdAt, lastSeenAt, platform: 'ios'|'android'|'web'|'unknown',
  deviceName: string|null, isCurrent: boolean }
Page<T> { items: T[], nextCursor: string|null }
```

### 3.1 Auth & Session — all MISSING (Phase 1)

**POST /auth/login**
- Auth: none. Permission: —. Scope: any active principal (staff, contact, teacher).
- Request: `{ username: string, password: string, device?: { platform: 'ios'|'android'|'web', name?: string } }`. Whether `username` holds a username or an email is the open item in `docs/integration/authentication-decision-gate.md` §5; the **wire field name is `username` either way** (Flutter's `AuthRepository.signIn({username,password})`; Admin Web renames `email`).
- Response: `200 TokenPairDto`.
- Errors: `AUTH.INVALID_CREDENTIALS` 401 · `AUTH.ACCOUNT_DISABLED` 403 · `AUTH.ACCOUNT_LOCKED` 403 · `COMMON.RATE_LIMITED` 429.
- Idempotency: none (no header).
- Audit: `audit_log` `{action:'session.created', entity:'session', entityId, actorId, reason:'login'}`; `event_log` `auth.login_failed` with `{username hash, reason code}` — never the password, never the raw username.
- Realtime: none.

**POST /auth/refresh**
- Auth: none (the refresh token is the credential). Request: `{ refreshToken: string }`.
- Response: `200 TokenPairDto` with a **rotated** refresh token; the presented one is invalidated. Presenting an already-rotated token revokes the whole session (reuse detection).
- Errors: `AUTH.SESSION_REVOKED` 401 · `AUTH.ACCOUNT_DISABLED` 403.
- Audit: `event_log` `auth.refresh_reuse_detected` on reuse. Realtime: `session.revoked` to the actor room on reuse (§4).

**POST /auth/logout**
- Auth: required. Permission: `sessions.manage`. Scope: current session only.
- Request: `{}`. Response: `{ ok: true }`. Idempotent by nature (second call → `{ok:true}`).
- Side effects: session revoked; device tokens registered under this session deactivated (`chat.device_token.is_active=false`); sockets of this session disconnected.
- Audit: `audit_log` `{action:'session.revoked', entity:'session', entityId, reason:'logout'}`. Realtime: none to others.

### 3.2 Me / Config — MISSING (Phase 1)

**GET /me**
- Auth: required. Permission: — (any authenticated). Scope: self.
- Response: `200 ActorDto` (server-asserted; the client never infers role).
- Errors: `AUTH.ACCOUNT_DISABLED` 403.

**GET /me/sessions**
- Auth: required. Permission: `sessions.manage`. Scope: own sessions.
- Query: `cursor`, `limit` (default 20, max 100). Response: `Page<SessionDto>` ordered by `lastSeenAt desc`.

**DELETE /me/sessions/:id**
- Auth: required. Permission: `sessions.manage`. Scope: own session; revoking the current session is allowed (equivalent to logout).
- Response: `{ ok: true }`. Errors: `COMMON.NOT_FOUND` 404 (unknown or not owned — absent, not forbidden).
- Idempotency: natural. Audit: `audit_log` `{action:'session.revoked', entity:'session', entityId:id, reason:'revoked by user'}`.
- Realtime: `session.revoked { sessionId }` to the actor room, then the revoked session's sockets are disconnected. This is what makes revocation observable to Flutter (`AuthRepository.sessionRevoked`).

**GET /config**
- Auth: required. Permission: — but **staff only** (any `kind: 'staff'`); contacts and teachers get `AUTH.FORBIDDEN` 403.
- Response: `{ config: Record<string, unknown>, count: number }` — every key in `chat.config` (defaults in `platform/app-config.service.ts`: `communication.page_size_max`, `communication.delete_for_everyone_window_minutes`, `handoff.grace_minutes`, `realtime.*`, `call.*`, `notification.max_attempts`, `automation.*`).
- No pagination. `PATCH /config` is DEFERRED.

### 3.3 Families & Assignment — MISSING (Phase 1)

Family scope rule ("actor's supervisor scope"), used by every route below: **manager** → every family in the organization; **admin / coverage** → families where the actor is `family.owner_id`, or `chat.on_duty(family, now)` returns the actor, or the actor is the live `stickyHandlerId` of one of the family's conversations; **finance / technical / academic, contact, teacher** → `AUTH.FORBIDDEN` 403. This is the same predicate that fixes RT-011 for `GET /conversations`.

```
FamilySummaryDto { id, displayName, ownerId, ownerName, tier: 'standard'|'priority',
  state: string /* as stored: onboarding|active|at_risk|renewal_due|paused|churned */,
  language: 'ar'|'en', learnerCount: number, needsReplyCount: number, lastActivityAt: string|null }
FamilyDetailDto extends FamilySummaryDto {
  createdAt,
  learners: { id, name, level: string|null, teacherId: string|null, nextClassAt: string|null }[],
  contacts: { id, name, relationship: string|null, rolePreset, canMessage, isActive }[],   // no phone/email: none exist
  assignment: { supervisorId: string /* = ownerId */, onDutyId: string|null }
}
FamilyAssignmentDto { id: string /* audit_log.id as string */, familyId, fromStaffId, toStaffId, changedBy, reason, at }
```

**GET /families**
- Auth: required. Permission: `families.read`. Scope: family scope rule.
- Query: `q` (display name prefix, optional), `ownerId` (optional), `cursor`, `limit` (default 30, max 100). Response: `Page<FamilySummaryDto>` ordered by `lastActivityAt desc, id`.

**GET /families/:id**
- Auth: required. Permission: `families.read`. Scope: family scope rule. Response: `200 FamilyDetailDto`.
- Errors: `COMMON.NOT_FOUND` 404 for unknown **or out-of-scope** family (existence is sensitive).

**GET /families/:id/conversations**
- Auth: required. Permission: `conversations.read` + `families.read`. Scope: family scope rule.
- Query: `cursor`, `limit`, `includeArchived` (default false). Response: `Page<ConversationDto>` (no `members`), ordered by `lastActivityAt desc`.

**POST /families/:id/assignment**
- Auth: required. Permission: `families.assign`. Scope: **manager only**, family in organization.
- Request: `{ toStaffId: string, reason: string }`. `reason` non-blank → else `COMMON.VALIDATION` 400. `toStaffId` must be an active family-facing staff → else `COMM.ROLE_CANNOT_MESSAGE_FAMILY` 403 / `COMM.ACTOR_INACTIVE` 403. Same staff as current owner → `COMMON.VALIDATION` 400.
- Response: `200 FamilyAssignmentDto`.
- Idempotency: `Idempotency-Key` required.
- Side effects: `chat.family.owner_id` updated (**the only path that changes it**); every active `student_group` of the family's learners is re-synced (`ConversationService.syncStudentGroup`) so the new supervisor becomes the group's `admin` member and the old one leaves.
- Audit: `audit_log` `{action:'family.assignment_changed', entity:'family', entityId, before:{ownerId}, after:{ownerId}, reason}`; `event_log` `{type:'ownership_transferred', familyId, actorKind:'staff', actorId}`; plus the `student_group_membership_synced` event rows the sync writes.
- Realtime: `family.assignment_changed { familyId, fromStaffId, toStaffId, at }` to the actor rooms of both staff and to the conversation rooms of the family's conversations; `conversation.membership_changed` per re-synced group (existing).

**GET /families/:id/assignment/history**
- Auth: required. Permission: `families.read`. Scope: family scope rule.
- Query: `cursor`, `limit`. Response: `Page<FamilyAssignmentDto>` newest first, read from `audit_log` where `entity='family' and action='family.assignment_changed'`.

### 3.4 Conversations

**GET /conversations** — EXISTS → RECONCILE (`conversation.controller.ts#list`, `conversation.service.ts#listForActor`)
- Auth: required. Permission: `conversations.read`. Scope today: contact / teacher → conversations where the actor is a live member; **staff (family-facing) → every conversation in the system, `take: 200`, no scope (RT-011)**; other staff → `COMM.ROLE_CANNOT_MESSAGE_FAMILY` 403.
- Query today: none. Response today: `{ conversations: ConversationDto[] }` (no `members`), ordered `lastActivityAt desc`.
- **Phase 1:** query `familyId?`, `section?: 'needs_reply'|'pending_approval'|'unanswered'|'all'` (default `all`), `includeArchived?` (default false), `cursor`, `limit` (default 30, max 100); response `Page<ConversationDto>`; staff scope = family scope rule (§3.3) plus conversations the staff is a live member of. Section definitions: `needs_reply` = `needsReply === true`; `pending_approval` = at least one `message_approval` with `decision='pending'`; `unanswered` = `needsReply === true` and `lastStaffMessageAt is null` (never answered; a subset of `needs_reply`) — *this definition is proposed [B], to be confirmed by product*; `all` = no filter. Contacts and teachers may pass `section` but not `familyId`.
- Errors: `COMM.UNKNOWN_ACTOR` 401 · `COMM.ROLE_CANNOT_MESSAGE_FAMILY` 403.
- Audit / Realtime: none.

**POST /conversations/direct** — EXISTS (`getOrCreateDirect`)
- Auth: required. Permission: `conversations.read` (opening one's own channel) + `AuthorizationService.canOpenDirect`. Scope: allowed pairs only: contact ↔ family-facing staff, teacher ↔ family-facing staff, and **contact ↔ teacher when the relationship predicate authorizes it** (PD-6; `AUTHORIZATION-MODEL.md` §4.1). The relationship is resolved server-side from Jawwid Core data — `withActorId` is a lookup key, never evidence.
- Request: `{ withActorId: string }`. Response: `200 ConversationDto` (existing or created; `familyId` = the contact's family; `directKey` is the sorted pair, so the pair is unique).
- Errors: `COMM.UNKNOWN_ACTOR` 401 (either side) · `COMM.ACTOR_INACTIVE` · `COMM.INVALID_PARTICIPANTS` · `COMM.TEACHER_PARENT_NOT_AUTHORIZED` · `COMM.TEACHER_TEACHER_DISABLED` · `COMM.STAFF_STAFF_DISABLED` · `COMM.ROLE_CANNOT_MESSAGE_FAMILY` (all 403).
- Idempotency: natural (get-or-create; unique `direct_key`, P2002 re-read).
- Audit: `event_log` `{type:'conversation_created', familyId, actorKind, actorId, payload:{conversationId, type:'direct'}}` on create only.
- Realtime: none (no outbox row on create).

**POST /conversations/student-group** — EXISTS → RECONCILE (`ensureStudentGroup`)
- Auth today: **none enforced** — the controller passes the header actor only as `addedBy`; there is no `requireActor` and no permission check. Phase 1: auth required, Permission `conversations.manage`, Scope: family-facing staff with the learner's family in scope.
- Request: `{ learnerId: string }`. Response: `200 ConversationDto` (existing live group, or created with members derived from Core: contacts with `canMessage`, `family.ownerId` as `admin`, `learner.teacherId` as `teacher`; title `"<learner name> · Jawwid"`).
- Errors: `COMM.CONVERSATION_NOT_FOUND` 404 (unknown learner).
- Idempotency: natural (one live group per learner; partial unique index).
- Audit: `event_log` `student_group_created` (actorKind `system`); a `system` message `group.created` is written as `seq 1`.
- Realtime: none on create (the system message does not enqueue `message.created`).

**POST /conversations/student-group/:learnerId/sync** — EXISTS → RECONCILE (`syncStudentGroup`)
- Auth today: **none** (no `@ActorId`). Phase 1: either `conversations.manage` (staff, family scope) or removed from the public surface and invoked only by the worker on Core relationship changes. Flagged in §5.
- Request: none. Response: `200 ConversationDto`, or `{ synced: false }` when the learner or live group does not exist.
- Side effects: members added / `leftAt` set to match Core; `system` message `group.membership_changed`.
- Audit: `event_log` `student_group_membership_synced`. Realtime: `conversation.membership_changed { conversationId, added[], removed[] }` (only when something changed).

**GET /conversations/:id** — EXISTS → RECONCILE (`conversation.controller.ts#get`)
- Auth: required. Permission: `conversations.read`. Scope: `canRead` — contact / teacher must be a live member; family-facing staff any conversation.
- Response today: `ConversationDto` **without `members`** — the controller calls `toConversationDto(conv)` with no member list, although `docs/communication/mobile-contract.md` promises `members` on detail responses and `lib/core/data/http/http_group_repository.dart` depends on it. **Phase 1: return `members: ConversationMemberDto[]` (live members).** The authorization check is performed via `setPreferences(id, actorId, {})`, which also upserts an empty `conversation_participant_state` row as a side effect; Phase 1 replaces it with a pure `canRead` check.
- Errors: `COMM.CONVERSATION_NOT_FOUND` 404 · `COMM.NOT_CONVERSATION_MEMBER` 403 · `COMM.ROLE_CANNOT_MESSAGE_FAMILY` 403 · `COMM.ACTOR_INACTIVE` 403.

**POST /conversations/:id/members** — EXISTS → RECONCILE (`setMembership`)
- Auth: required. Permission: `conversations.manage`. Scope: family-facing staff (`canManageMembership`); Phase 1 additionally requires the conversation's family in scope.
- Request: `{ action: 'add'|'remove', actorId, actorKind, memberRole, isSilent?: boolean, reason: string }`. `reason` is required: today a missing reason reaches `audit_log.reason NOT NULL` and fails as a 500; Phase 1 returns `COMMON.VALIDATION` 400. `add` of an existing live member violates the member uniqueness and surfaces as a 500 today (Phase 1: 409 `COMMON.IDEMPOTENCY_CONFLICT` or no-op).
- Response: `{ ok: true }`. Idempotency: `Idempotency-Key` recommended.
- Audit: `audit_log` `{action:'conversation.member_add'|'conversation.member_remove', entity:'conversation', entityId, after:{actorId, memberRole}, reason}`.
- Realtime: `conversation.membership_changed`. Note: BR-1 membership constraints are also enforced by DB triggers (`chat.enforce_direct_conversation_rules`, `chat.assert_conversation_br1`); a trigger violation surfaces as a 500 today.

**POST /conversations/:id/preferences** — EXISTS (`setPreferences`)
- Auth: required. Permission: `conversations.read`. Scope: `canRead`.
- Request: `{ archived?: boolean, pinned?: boolean, mutedUntil?: string|null }` — each omitted field is untouched; `mutedUntil: null` unmutes. Per-actor (`conversation_participant_state`); one actor's pin never affects another.
- Response: `{ ok: true }`. Idempotent by nature. Audit / Realtime: none. Note: the per-actor `archivedAt`/`pinnedAt`/`mutedUntil` are **not** surfaced on `ConversationDto` (its `archivedAt` is the conversation-level archive) — Phase 1 should add `preferences: {archivedAt, pinnedAt, mutedUntil, lastReadSeq}` to the list/detail DTO (mobile O1/O3 class of gaps).

### 3.5 Messages (`message.controller.ts`, `message.service.ts`) — all EXISTS unless noted

**GET /conversations/:conversationId/messages**
- Auth: required. Permission: `messages.read`. Scope: `canRead`.
- Query: `before?: string(seq)`, `after?: string(seq)`, `limit?: number`. `after` → ascending; otherwise descending. Limit capped at `communication.page_size_max`.
- Response: `{ messages: MessageDto[], nextBefore: string|null }`. Visibility filter (single place, `visibilityFilter`): contacts/teachers never see `internal`; nobody sees their own `deleted for me` rows; `pending` visible only to the author and family-facing staff; `rejected` only to the author. Attachment `url`/`thumbnailUrl` are signed per read (`STORAGE_SIGNED_URL_TTL_SECONDS`, default 300 s). A message `deletedForAll` has `body: null, attachments: []`.
- Errors: `COMM.CONVERSATION_NOT_FOUND` 404 · `COMM.NOT_CONVERSATION_MEMBER` 403 · `COMM.ROLE_CANNOT_MESSAGE_FAMILY` 403.
- Audit / Realtime: none.

**POST /conversations/:conversationId/messages**
- Auth: required. Permission: `messages.send`. Scope: `AuthorizationService.canSend` (membership, BR-1, C-4 admin presence, on-duty / sticky / manager, silent, `can_message`, archived).
- Request: `{ type?: 'text'|'image'|'video'|'voice'|'file' (default text; 'system' is downgraded to text for non-system actors), body?: string, visibility?: 'customer'|'internal' (default customer), clientMessageId?: string (strongly recommended), replyToMessageId?: string, requestedMode?: 'assist'|'escalation' (only these are honoured; owner/coverage are derived), attachments?: [{ kind, objectKey, mimeType, byteSize, checksumSha256?, originalName?, durationMs?, width?, height?, thumbnailObjectKey? }] }`.
- Response: `200 MessageDto` (with `moderation: 'pending'` when held for approval; `onBehalfMode` derived).
- Errors: `COMM.EMPTY_MESSAGE` 400 · `COMM.ATTACHMENT_*` 400 · `COMM.MESSAGE_NOT_FOUND` 404 (reply target) · `COMM.REPLY_TARGET_CROSS_CONVERSATION` 403 · `COMM.CONVERSATION_ARCHIVED` 403 · every matrix code in §1.1.
- Idempotency: **`clientMessageId`** (fast-path lookup + unique-index P2002 re-read, scoped to `(conversationId, authorId, clientMessageId)` — the unique index is asserted by the service comment; not re-verified in the migrations here). `Idempotency-Key` is redundant for this route.
- Side effects: `seq = last_seq + 1` under `FOR UPDATE`; `lastActivityAt`; for published customer-visible messages a contact author sets `lastCustomerMessageAt` and clears `resolvedAt`, a staff author sets `lastStaffMessageAt` and becomes sticky handler for `handoff.grace_minutes` (15); receipts `sent` created for live members other than the author (internal notes: staff only); pending messages create a `message_approval` and **no receipts**.
- Audit: `event_log` `{type:'message_sent', payload:{conversationId, messageId, type, visibility, moderation}}` (never the body); `audit_log` `{action:'message.assist'|'message.escalation', entity:'conversation', after:{messageId}, reason}` when `onBehalfMode` is assist / escalation.
- Realtime: published → `message.created` (+ `conversation.updated`); pending → `approval.requested` (+ `conversation.updated`). Worker side effect: one `new_message` push notification per recipient (`dedupeKey new_message:<messageId>:<actorId>`), skipping muted and inactive recipients.

**POST /conversations/:conversationId/messages/read**
- Auth: required. Permission: `messages.read`. Scope: `canRead`. Request: `{ upToSeq: string }`.
- Side effects: the caller's receipts for `seq <= upToSeq` move to `read` (monotonic — never downgrades); `conversation_participant_state.lastReadSeq` upserted. Response: `{ ok: true }`. Idempotent.
- Realtime: **none** — `message.receipt.updated` is declared but never emitted (§4).

**GET /conversations/:conversationId/messages/unread**
- Auth: required. Permission: `messages.read`. Scope: counts only the caller's own receipts in `sent|delivered`; no membership check is run (nothing to leak). Response: `{ unread: number }`.

**POST /conversations/:conversationId/messages/:messageId/delivered**
- Auth: required. Permission: `messages.read`. Scope: caller's own receipt. Response: `{ updated: number }`. Duplicate of the WS `message.delivered` ack; kept for clients without a socket. Realtime: none.

**POST /conversations/:conversationId/messages/:messageId/reactions**
- Auth: required. Permission: `messages.read` (a reaction is not a post; silent members may react — current behaviour). Scope: `canRead` on the message's conversation; internal / pending messages the actor may not see → 404.
- Request: `{ emoji: string }`. One reaction per actor per message: a second emoji **replaces** the first (upsert). Response: `{ ok: true }`. Idempotent.
- Realtime: `reaction.added { conversationId, messageId, actorId, emoji }`. Audit: none.

**DELETE /conversations/:conversationId/messages/:messageId/reactions** — RECONCILE
- Auth: required. Permission: `messages.read`. Scope: as above.
- Today: no parameters; removes the caller's single reaction and emits `reaction.removed` with the stored emoji. **Phase 1: query `?emoji=<emoji>` is required**; if the stored reaction differs the call is a no-op `{ ok: true, removed: false }`. Rationale: makes the delete safe against a concurrent replace and keeps the route stable if multi-reaction ever lands. Flutter drops the emoji today (`http_message_repository.dart:131`).
- Response: `{ ok: true }`. Realtime: `reaction.removed`.

**DELETE /conversations/:conversationId/messages/:messageId/me**
- Auth: required. Permission: `messages.read`. Scope: `canRead`. Hides the message for the caller only (`message_hidden_for`). Response: `{ ok: true }`. Idempotent. Audit / Realtime: none.

**DELETE /conversations/:conversationId/messages/:messageId**
- Auth: required. Permission: `messages.delete` (author within `communication.delete_for_everyone_window_minutes`) or `messages.moderate` (manager, any time). Scope: `canRead` + author/manager rule.
- Query: `reason?: string` (default `"deleted by author"`). Response: `{ ok: true }`. The row is kept: `deletedAt`, `deletedBy`, `deletedForAll=true`, `redactedReason`; body never served again.
- Errors: `COMM.NOT_MESSAGE_AUTHOR` 403 · `COMM.DELETE_WINDOW_EXPIRED` 403 · `COMM.MESSAGE_NOT_FOUND` 404.
- Audit: `audit_log` `{action:'message.delete_for_everyone', entity:'message', entityId, reason}`. Realtime: `message.deleted { conversationId, messageId, deletedForAll: true }`.

### 3.6 Attachments

**POST /conversations/:conversationId/messages/attachments/authorize** — EXISTS → RECONCILE (`attachment.service.ts#authorizeUpload`)
- Auth: required. Permission: `messages.send`. Scope today: `canRead` only (a silent member or a contact without `can_message` can mint an upload key). **Phase 1: `canSend`.**
- Request: `{ kind: 'image'|'video'|'voice'|'file', mimeType: string, byteSize: number }`. Limits: image 10 MiB, video 100 MiB, voice 16 MiB, file 25 MiB (env-tunable); MIME allow-lists per kind.
- Response: `{ objectKey, uploadUrl, method: 'PUT', headers: Record<string,string>, expiresAt }` (`UploadAuthorization`). Client PUTs to `uploadUrl`, then sends the message with `attachments[].objectKey`. Limits are re-validated on send.
- Errors: `COMM.ATTACHMENT_TYPE_NOT_ALLOWED` 400 · `COMM.ATTACHMENT_TOO_LARGE` 400 · `canRead` codes.
- Audit / Realtime: none. Download: never a permanent URL — `AttachmentDto.url` is signed per read.

### 3.7 Approvals (`approval.controller.ts`, `approval.service.ts`)

```
PendingApprovalDto { approvalId, conversationId, messageId, requestedBy, approverId: string|null,
  createdAt, message: MessageDto }
ApprovalHistoryDto { approvalId, messageId, requestedBy, approverId, decision: 'pending'|'approved'|'rejected',
  rejectionReason: string|null, createdAt, decidedAt: string|null }
```

**GET /approvals/pending** — EXISTS → RECONCILE
- Auth: required. Permission: `messages.moderate`. Scope today: any family-facing staff sees **every** pending approval in the system (`take: 200`, optional `?conversationId=`) — unscoped like RT-011. **Phase 1: scope to conversations whose family is in the actor's scope (§3.3); manager → all; paginate.**
- Query today: `conversationId?`. Response today: `{ approvals: PendingApprovalDto[] }` ascending by `createdAt`. Phase 1: `Page<PendingApprovalDto>` with `conversationId?`, `familyId?`, `cursor`, `limit`.
- Errors: `COMM.CANNOT_APPROVE` 403 (non-staff).

**GET /approvals/mine** — EXISTS → RECONCILE
- Auth: required. Permission: `messages.send`. Scope: `requestedBy = actor`. Response today `{ approvals: PendingApprovalDto[] }` (all decisions, newest first, `take: 100`); Phase 1 `Page<PendingApprovalDto>`.

**POST /approvals/:id/approve** — EXISTS
- Auth: required. Permission: `messages.moderate`. Scope: `canApprove(actor, activeHandler)` — the family's active handler (sticky handler while live, else `chat.on_duty`) or any manager. The approver never edits the message (DB trigger `chat.forbid_message_rewrite`).
- Request: `{}`. Response: `{ ok: true }`.
- Errors: `COMM.MESSAGE_NOT_FOUND` 404 (unknown approval) · `COMM.APPROVAL_ALREADY_DECIDED` 409 · `COMM.CANNOT_APPROVE` 403.
- Side effects: `moderation → published` (original `seq` kept, so it lands in its original position); receipts `sent` for live members except the author; `lastActivityAt`; contact-authored customer message sets `lastCustomerMessageAt` and clears `resolvedAt`.
- Audit: `audit_log` `{action:'message.approved', entity:'message', entityId, after:{decision}, reason:'approved by active handler'}`.
- Realtime: `message.created` (moderation `published`) + `approval.decided { decision:'approved', rejectionReason:null }`.

**POST /approvals/:id/reject** — EXISTS
- As approve, with Request `{ reason: string }` (non-blank → else `COMM.APPROVAL_REASON_REQUIRED` 400). `moderation → rejected`; no receipts; no `message.created`.
- Audit: `audit_log` `{action:'message.rejected', …, reason}`. Realtime: `approval.decided { decision:'rejected', rejectionReason }`.

**GET /approvals/history/:conversationId** — EXISTS → RECONCILE
- Auth: required. Permission: `messages.moderate` (`canReadInternal`) + `canRead`. Response today `{ history: ApprovalHistoryDto[] }` newest first, `take: 200`; Phase 1 `Page<ApprovalHistoryDto>`.
- Errors: `COMM.CANNOT_APPROVE` 403 (non-staff) · `canRead` codes.

### 3.8 Calls (`call.controller.ts`, `call.service.ts`)

```
CallHistoryDto { id, conversationId, type: 'direct'|'group', status: 'ringing'|'active'|'ended',
  outcome: 'answered'|'missed'|'declined'|null, initiatorId, startedAt, endedAt, durationSeconds: number|null,
  participants: { actorId, actorKind, joinedAt, leftAt }[] }
```

**POST /calls** — EXISTS
- Auth: required. Permission: `calls.start`. Scope: `canCall(intent = initiate)` = `canSend` (customer visibility) + the authorized-relationship check on a direct teacher/parent pair (**PD-6**) + C-4 + **PD-2**. Participants = live, active, non-silent members (server-derived; never client-supplied). Room name minted server-side.
- **PD-2:** a family contact may not start a `student_group` or `class_group` call. A parent's 1:1 call to their handler is unaffected.
- Request: `{ conversationId: string }`. Response: `{ callId, roomName }`.
- Errors: matrix codes; `COMM.TEACHER_PARENT_NOT_AUTHORIZED` 403; `COMM.PARENT_CANNOT_START_GROUP_CALL` 403.
- Audit: `event_log` `call_started`. Realtime: `call.incoming { callId, conversationId, type, initiatorId, initiatorName, roomName }` to the conversation room.

**POST /calls/:id/token** — EXISTS
- Auth: required. Permission: `calls.accept`. Scope: recorded participant, call not ended, still a member, `canCall(intent = join)` re-evaluated — including the PD-6 relationship predicate, so a teacher–parent relationship revoked in Jawwid Core refuses the next join even mid-call. This is the JOIN path, so a parent is allowed here (**PD-2**). Response: `{ token, url, roomName, expiresAt }`; TTL `call.token_ttl_seconds` (120); `canPublish = !isSilent`.
- Errors: `COMM.CALL_NOT_FOUND` 404 · `COMM.CALL_ALREADY_ENDED` 409 · `COMM.CALL_NOT_A_PARTICIPANT` 403 · matrix codes. Audit / Realtime: none.

**POST /calls/:id/accept** — EXISTS · Permission `calls.accept` · Scope participant. `joinedAt` set; `ringing → active` with `answeredAt`. Response `{ ok: true }`. Realtime: **`call.participant_joined { callId, actorId }`** (not `call.accepted`). Audit: none.

**POST /calls/:id/decline** — EXISTS · Permission `calls.accept` · Scope participant. `leftAt` set. Realtime: `call.declined { callId, actorId }`. Audit: none.

**POST /calls/:id/end** — EXISTS · Permission `calls.accept` · Scope participant. Request `{ outcome?: 'answered'|'missed'|'declined' }` (default derived from `answeredAt`). Call `ended`, all open participants `leftAt`, `durationSeconds` computed. Realtime: `call.ended { callId, conversationId, outcome, durationSeconds }`. Audit: `event_log` `call_ended`.

**GET /calls/history/:conversationId** — EXISTS → RECONCILE · Permission `conversations.read` · Scope `canRead`. Response today `{ calls: CallHistoryDto[] }` newest first, `take: 100`; Phase 1 `Page<CallHistoryDto>`.

### 3.9 Notifications / Devices (`notification.controller.ts`, `notification.service.ts`)

**POST /notifications/devices** — EXISTS → RECONCILE
- Auth: required. Permission: `sessions.manage`. Scope: self.
- Request: `{ token: string, platform: string, isVoip?: boolean, locale?: 'ar'|'en' }`. Upsert by `token`: today a token already registered to another actor is **silently re-bound** to the caller ("device handed over"). Phase 1: the token is bound to the authenticated actor **and session** (revoking the session deactivates it); re-binding across actors requires the previous session to be revoked.
- Response: `{ ok: true }`. Idempotent. Audit / Realtime: none.

**DELETE /notifications/devices/:token** — EXISTS → RECONCILE
- Auth today: **none** (no `@ActorId`); anyone can deactivate any token. Phase 1: auth required, Permission `sessions.manage`, Scope: own tokens only; unknown/not-owned → `{ ok: true }` (no enumeration).
- Response: `{ ok: true }`.

**POST /notifications/:id/delivered** — EXISTS → RECONCILE
- Auth today: **none**; any caller can mark any notification `delivered`. Phase 1: auth required; Scope: `recipientId = actor` (same predicate as `opened`). Transition `sent → delivered`, never inferred by the server.
- Response: `{ ok: true }`. Idempotent.

**POST /notifications/:id/opened** — EXISTS
- Auth: required. Scope: `recipientId = actor`; `sent|delivered → opened`. Response `{ ok: true }`.

There is no `GET /notifications` list. In-app notifications are declared to travel over `notification.created` on the actor room (§4), but that event has no emitter today.

### 3.10 Staff & Audit — MISSING (Phase 1)

```
StaffDto { id, name, role: StaffRole, isActive, presence: string, lastActivityAt: string|null }
AuditEntryDto { id: string, actorId: string|null, action, entity, entityId, before: unknown, after: unknown, reason, at }
```

**GET /staff**
- Auth: required. Permission: `users.manage`. Scope: manager; organization only.
- Query: `role?`, `active?` (default true), `cursor`, `limit`. Response: `Page<StaffDto>` ordered by `name`.

**GET /audit**
- Auth: required. Permission: `audit.read`. Scope: manager; organization only.
- Query: `entity?`, `entityId?`, `actorId?`, `action?` (prefix match, e.g. `message.`), `from?`, `to?` (ISO-8601), `cursor`, `limit` (default 50, max 200). Response: `Page<AuditEntryDto>` newest first, read from `chat.audit_log`. `before`/`after` are returned as stored; they never contain message bodies (no writer stores one).
- Audit: reading the audit log is itself recorded in `event_log` `{type:'audit_viewed', actorId, payload:{filters}}`.

### 3.11 Health (`infra/health/health.controller.ts`) — EXISTS, unauthenticated, no prefix

| Route | Response | Status |
|---|---|---|
| `GET /health/live` | `{ status:'ok', build:{commit,version,environment}, uptimeSeconds }` | Always 200 while the process runs. |
| `GET /health/ready` | `{ status:'ok'\|'degraded', build, uptimeSeconds, checks:{ database:{status,latencyMs,error?}, redis:{…} } }` | 200 when no check is `down`; **503** otherwise (Nest default body, not `{error}` — accepted for probes). |
| `GET /health` | Same report | Always 200. |

`Cache-Control: no-store`. No hostnames, connection strings or customer data.

---

## 4. Realtime contract

Transport: socket.io on the **default namespace** at the API origin (Redis adapter for horizontal fan-out; worker events relayed via `infra/realtime/realtime-relay.service.ts` with `.local` emit). Source of truth: `apps/api/src/communication/contracts/events.ts`; gateway `communication/realtime/realtime.gateway.ts`; routing `communication/outbox/outbox.worker.ts`.

**Handshake**

| | Today (DEPRECATED) | Phase 1 (canonical) |
|---|---|---|
| Namespace | default (`/`) | default (`/`). Admin Web's `/staff` namespace is **RENAME → default**. |
| Auth | `io(API_URL, { auth: { actorId } })`; unknown / inactive actor is disconnected on connect | `io(API_URL, { auth: { token: <access token> } })`; the server verifies the token, resolves the `Actor`, and disconnects on `AUTH.UNAUTHENTICATED` / `AUTH.SESSION_REVOKED`. On access-token expiry the client reconnects with a fresh token. |
| Cookies | Admin Web `withCredentials: true` | Not used. |

**Rooms** (`events.ts` `room`): `actor:<actorId>` — every socket joins its own actor room on connect (multi-device fan-out); `conversation:<conversationId>` — joined only via `conversation.subscribe`, after the same `AuthorizationService.canRead` the REST path uses. A client never names a room.

**Client → server** (all acknowledged with `{ ok: boolean, code?: string }`)

| Event | Payload | Rule |
|---|---|---|
| `conversation.subscribe` | `{ conversationId }` | Authorized (`canRead`); `code` on refusal (`COMM.NOT_CONVERSATION_MEMBER`, `COMM.CONVERSATION_NOT_FOUND`, `COMM.UNKNOWN_ACTOR`). |
| `conversation.unsubscribe` | `{ conversationId }` | |
| `typing.start` | `{ conversationId }` | Authorized; server-side debounce (`realtime.typing_ttl_seconds` = 8). |
| `typing.stop` | `{ conversationId }` | |
| `presence.heartbeat` | — | Refreshes the TTL key (`realtime.presence_ttl_seconds` = 45). |
| `message.delivered` | `{ messageIds: string[] }` | Only the caller's own receipts; ack `{ ok, updated }`. |

**Server → client**

| Event | Payload | Delivered to | Emitted today by |
|---|---|---|---|
| `message.created` | `{ conversationId, messageId, seq, authorKind, authorId, type, visibility, moderation, createdAt }` — a hint, no body | conversation room; **internal notes: staff actor rooms only** | `send` (published), `approve` |
| `message.deleted` | `{ conversationId, messageId, deletedForAll }` | conversation room | `deleteForEveryone` |
| `message.receipt.updated` | `{ conversationId, messageId, actorId, state, at }` | conversation room | **nobody** — declared, never enqueued. Phase 1 decides: emit on `read` / `delivered` (subject to RT-012 scoping) or remove. |
| `reaction.added` / `reaction.removed` | `{ conversationId, messageId, actorId, emoji }` | conversation room | `react` / `unreact` |
| `typing.started` / `typing.stopped` | `{ conversationId, actorId, displayName }` | conversation room, excluding sender | gateway (direct emit, not outbox) |
| `presence.changed` | `{ actorId, state: 'online'\|'offline', lastSeenAt }` | actor rooms | **nobody** — declared, never emitted (`PresenceService` only writes Redis keys). Phase 1 decides. |
| `conversation.updated` | `{ conversationId, familyId, state, needsReply, lastActivityAt, handlerId }` | conversation room | `send` (always) |
| `conversation.membership_changed` | `{ conversationId, added: string[], removed: string[] }` | conversation room | `setMembership`, `syncStudentGroup` |
| `approval.requested` | `{ conversationId, messageId, approvalId, requestedBy }` | **staff actor rooms only** | `send` (pending) |
| `approval.decided` | `{ conversationId, messageId, approvalId, decision, rejectionReason }` | conversation room | `decide` |
| `call.incoming` | `{ callId, conversationId, type, initiatorId, initiatorName, roomName }` | conversation room | `start` |
| `call.accepted` | `{ callId, actorId }` | — | **nobody** (accept emits `call.participant_joined`). Phase 1: remove or alias. |
| `call.declined` | `{ callId, actorId }` | conversation room | `decline` |
| `call.participant_joined` | `{ callId, actorId }` | conversation room | `accept` |
| `call.participant_left` | `{ callId, actorId }` | — | **nobody**. Phase 1 decides. |
| `call.ended` | `{ callId, conversationId, outcome, durationSeconds }` | conversation room | `end` |
| `notification.created` | `{ notificationId, recipientId, eventType, title, body, conversationId }` | actor room | **nobody** — `in_app` channel is a no-op in `deliver()`. Phase 1 decides. |
| **`session.revoked`** (Phase 1, new) | `{ sessionId }` | actor room, then the session's sockets are disconnected | `DELETE /me/sessions/:id`, refresh-reuse detection |
| **`family.assignment_changed`** (Phase 1, new) | `{ familyId, fromStaffId, toStaffId, at }` | actor rooms of both staff + the family's conversation rooms | `POST /families/:id/assignment` |

Routing rules in the worker: `call.*`, `reaction.*`, `message.deleted`, `conversation.*`, `approval.decided` → conversation room; `message.created` with `visibility: 'internal'` and `approval.requested` → staff member actor rooms; events without `conversationId` are dropped (`default` branch). Guarantees: transactional outbox (`chat.outbox_event`), at-least-once (dedupe on `messageId` / `callId` / `approvalId`), `message.created` carries no body, a pending message emits nothing to the group.

Reconnect: re-subscribe, `GET …/messages?after=<last seq held>` per conversation, then `message.delivered` for anything new.

**Admin Web `/staff` events → canonical**

| Admin event (`core/realtime/events.ts`) | Disposition |
|---|---|
| `family.updated {family_id, bucket, top_reason, needs_reply, on_duty_id, handling_mode}` | → `conversation.updated` (`needsReply`, `handlerId`, `state`); `bucket` / `top_reason` / `handling_mode` OBSOLETE. |
| `message.created {family_id, message}` | → `message.created` (hint; fetch the message). Key on `conversationId`, not `family_id`. |
| `case.updated` | OBSOLETE |
| `task.updated` | DEFERRED |
| `handoff.created` | OBSOLETE (no Handoff entity; `communication/handoff/` is empty) |
| `coverage.changed` | DEFERRED |
| `ownership.changed {family_id, from, to}` | → `family.assignment_changed` (Phase 1) |
| `unattended.changed` | OBSOLETE |
| `escalation.created` | OBSOLETE |
| `presence.changed {staff_id, presence}` | → `presence.changed {actorId, state, lastSeenAt}` (not emitted yet) |
| `shift.ending` | OBSOLETE |

---

## 5. Security gaps recorded

| # | Gap | Evidence | Fix | Phase |
|---|---|---|---|---|
| S-1 | **No authentication.** `x-actor-id` header and `auth.actorId` handshake are trusted after identity resolution; any caller can act as any active actor. | `api/actor.decorator.ts`; `realtime.gateway.ts#handleConnection`; `docs/integration/auth-current-state.md` | Bearer tokens, guard populating `request.user`, WS token verification (§1, §3.1, §4). | 1 |
| S-2 | **Routes with no actor at all**: `POST /conversations/student-group/:learnerId/sync`, `DELETE /notifications/devices/:token`, `POST /notifications/:id/delivered`. Anyone can resync any group, silence any device's push, or corrupt delivery metrics. | `conversation.controller.ts#sync`, `notification.controller.ts#unregister`, `#delivered` | Auth required on all three; sync becomes `conversations.manage` (or worker-internal); device / delivered scoped to owner / recipient. | 1 |
| S-3 | `POST /conversations/student-group` performs no actor or permission check (header only used as `addedBy`). | `conversation.controller.ts#studentGroup`, `ensureStudentGroup` | `conversations.manage` + family scope. | 1 |
| S-4 | **RT-011 — unscoped staff lists.** `GET /conversations` returns every conversation (`take: 200`) to any family-facing staff; `GET /approvals/pending` returns every pending approval; `canRead` allows any family-facing staff into any conversation. | `conversation.service.ts#listForActor`; `approval.service.ts#listPending`; `authorization.service.ts#canRead`; `docs/red-team/findings.md` RT-011 | Family scope rule (§3.3) applied to `listForActor`, `listPending`, `canRead` for non-managers; cursor pagination. Lists are built from an authorization-derived filter, never a probe. | 1 |
| S-5 | **RT-012 — receipt roster disclosure.** `MessageDto.receipts` maps every receipt row (`actorId`, `deliveredAt`, `readAt`) to every reader, so a parent learns staff ids and read times. | `dto.ts#toMessageDto`; findings RT-012 | Receipts scoped to the requester's own row plus an aggregate (`readCount`, `deliveredCount`) for the author; staff see the roster for staff-authored messages only. Shape change is a breaking DTO change — announce with the Phase 1 DTO. | 1 |
| S-6 | Device token re-binding: registering a token already owned by another actor silently moves it. | `notification.service.ts#registerDevice` (`update: { actorId }`) | Bind tokens to actor + session (§3.9). | 1 |
| S-7 | Upload authorization requires `canRead`, not `canSend`: silent members and `can_message=false` contacts can mint object keys. | `attachment.service.ts#authorizeUpload` | Check `canSend`. | 1 |
| S-8 | `Idempotency-Key` accepted but not enforced; a double-submit of a non-message mutation (membership add, assignment) is not deduplicated. | no server-side handling found | Idempotency store keyed by (actor, key) with body hash. | 1+ |
| S-9 | Non-`CommError` failures (validation, unknown routes, DB constraint violations such as a missing `reason` or a BR-1 trigger) return Nest default bodies / 500s, leaking internals and breaking the error contract. | `main.ts` (only `CommErrorFilter`), `setMembership` | Catch-all filter → `COMMON.*` codes; request validation. | 1 |
| S-10 | RT-013 (internal notes announced to contacts) — **addressed**: the worker routes `visibility: 'internal'` to staff actor rooms only. Recorded as closed. | `outbox.worker.ts#publish` | — | done |
| S-11 | RT-006: `signUrlsForMessages(messageIds)` takes no actor; safe only because the sole caller already filtered by `visibilityFilter`. | `attachment.service.ts` | Pass the actor; assert message visibility inside. | 1 |
| S-12 | Client-controlled `authorId` trust surfaces in tests only; approvals list embeds full `MessageDto` (with receipts) for staff — acceptable once S-5 lands. | `approval.service.ts` | Follows S-5. | 1 |

---

## 6. Client migration notes

### 6.1 Admin Web (`apps/admin-web`)

1. **Auth**: replace the cookie session (`credentials: 'include'`) with bearer tokens: `POST /auth/login {username,password}` → store `TokenPairDto`; attach `Authorization: Bearer`; refresh once on 401 via `POST /auth/refresh`; `setUnauthenticatedHandler` fires on `AUTH.SESSION_REVOKED` / second 401. `GET /me` returns `ActorDto` (camelCase, `staffRole`, `permissions[]`), not `Staff`.
2. **Casing & errors**: switch `core/api/client.ts` to camelCase and to `{error:{code,message}}`; drop `message_en`/`message_ar` — localise from `code` with a client-side table (existing `fallbackMessages` becomes the miss path).
3. **Pagination**: `Paginated<T> {items, next_cursor}` → `Page<T> {items, nextCursor}`; messages keep `{messages, nextBefore}` with `before`/`after` on `seq` (strings).
4. **Vocabulary / types** (`shared/types/domain.ts`): `InboxRow` → `ConversationDto` (+ `FamilySummaryDto` for the family list); `Case`, `Handoff`, `TeamNowRow`, `AttentionBucket`, `HandlingMode` ('sticky', 'none'), `WorkloadLevel`, `ShiftBanner`, `DutyState` → removed. `Staff` → `StaffDto`/`ActorDto`.
5. **Endpoints**: adopt the existing conversation, message, approval, call and notification routes (§3.4–3.9); `familyApi.messages/sendMessage/notes` → conversation routes (`visibility: 'internal'` for notes); `transferOwnership` → `POST /families/:id/assignment`; `inbox.section` → `GET /conversations?section=`. Everything marked OBSOLETE in §2.2 is deleted; DEFERRED items are removed from navigation until a product decision lands (`capabilities.ts` areas `coverage`, `tasks`, `dashboard`).
6. **Idempotency**: keep `Idempotency-Key` on POST/PATCH/DELETE (already the canonical name); message sends additionally carry body `clientMessageId`.
7. **Realtime**: connect to the default namespace with `auth: { token }`; subscribe per conversation with `conversation.subscribe`; handle the §4 events (signals → refetch remains a good policy). Remove the `/staff` handlers listed OBSOLETE.

### 6.2 Flutter (`lib/`)

1. **Header rename**: `ApiClient.idempotencyHeader` `'X-Idempotency-Key'` → `'Idempotency-Key'` (`lib/core/network/api_client.dart`). Keep `clientMessageId` in the body — that is the guarantee the server enforces.
2. **Auth endpoints**: replace `UnavailableAuthRepository` with an HTTP implementation of `POST /auth/login`, `POST /auth/refresh`, `GET /me`, `POST /auth/logout`, `GET/DELETE /me/sessions`; the existing `TokenProvider` / single-flight refresh in `ApiClient` already fits `TokenPairDto`. Map `AUTH.UNAUTHENTICATED` → `unauthenticated`, `AUTH.ACCOUNT_DISABLED` → `accountDisabled`, `AUTH.SESSION_REVOKED` → `sessionRevoked` in `ErrorMapper`. Delete `DebugActorHeaderIdentity` (`actor_identity.dart`) once the guard lands.
3. **Reaction DELETE must carry the emoji**: `HttpMessageRepository.removeReaction(messageId, emoji)` (`lib/core/data/http/http_message_repository.dart:131`) calls `DELETE /conversations/:id/messages/:messageId/reactions` with no parameters; send `?emoji=<emoji>` (Phase 1 requires it; today it is ignored).
4. **List shape**: `GET /conversations` moves from `{conversations}` to `{items, nextCursor}`; add cursor paging and `includeArchived` instead of filtering locally.
5. **Members on detail**: `HttpGroupRepository` reads `members[]` from `GET /conversations/:id`; the server does not return it today (RECONCILE §3.4) — no client change, but expect empty members until the server fix. Display names for members remain an open server item (mobile O3).
6. **Realtime**: implement a socket.io client per §4 (default namespace, `auth: { token }`, `conversation.subscribe`, `typing.start/stop`, `message.delivered`, reconnect via `?after=`). `setTyping` stops being a no-op. Listen for `session.revoked` to feed `AuthRepository.sessionRevoked`.
7. **Receipts**: after S-5 lands, `MessageDto.receipts` shrinks to the viewer's own row plus aggregates; `WireMappers.message` must tolerate both shapes during the transition.
