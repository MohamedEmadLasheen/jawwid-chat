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
| `COMM.BR1_TEACHER_PARENT_DIRECT` | 403 | **Active (PD-7, 2026-10-14).** A teacher and a parent may never share a direct 1:1 conversation or call, whatever their relationship: refused on open, send (either side), new reaction, call start/join/token. Never retry. |
| `COMM.TEACHER_PARENT_NOT_AUTHORIZED` | 403 | **DEPRECATED (PD-7).** PD-6's relationship refusal; no longer emitted. Clients keep treating it as terminal so older builds behave correctly. |
| `COMM.STAFF_OUT_OF_SCOPE` | 403 | Staff scope (2026-10-14): the conversation is not in this admin's charge. Never retry. |
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
| `COMM.CANNOT_MANAGE_MEMBERSHIP` | 403 | `POST /conversations/:id/members` by a non-family-facing actor, by staff outside the conversation's family scope, or on any `direct` conversation. |
| `COMM.CANNOT_PROVISION_STUDENT_GROUP` | 403 | `POST /conversations/student-group` or `…/:learnerId/sync` by a parent, a teacher, department staff, or family-facing staff outside the family's scope. |
| `COMM.REVOCATION_UNCONFIRMED` | 503 | RT-009 completion barrier. `POST /conversations/:id/members` (`remove`), `POST /conversations/student-group/:learnerId/sync`, `POST /auth/logout`: the change is committed, but not every API node confirmed it can no longer deliver to the revoked recipient on an earlier decision. Not a success; retry is safe and idempotent. |
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
| `COMM.CALL_NOT_FOUND` | 404 | Also any `/calls/:id` route whose id is not a uuid (e.g. `None`); it names no call. |
| `COMM.CALL_ALREADY_ENDED` | 409 | Token requested for an ended call. |
| `COMM.CALL_PARTICIPANT_LEFT` | 409 | The actor is a recorded participant but has already left the call (`accept`, `decline`, `POST /calls/:id/token`). |
| `COMM.CALL_NOT_RINGING` | 409 | `decline` on a call that is no longer ringing. |
| `COMM.CALL_ALREADY_DECLINED` | 409 | `accept` on a call every other participant has left. |
| `COMM.CALL_NOT_A_PARTICIPANT` | 403 | Not in the server-derived participant set. |
| `COMM.PARENT_CANNOT_START_GROUP_CALL` | 403 | **Retired by PD-19 (2026-10-21); no longer issued.** Was PD-2: a family contact starting a group call. |

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
| `COMMON.RATE_LIMITED` | 429 | Includes `Retry-After`. Raised by login (§3.1) and by the authenticated-action limits (§1.1a). |

Flutter already distinguishes `unauthenticated`, `accountDisabled` and `sessionRevoked` (`lib/core/network/api_client.dart#_onError`); the three `AUTH.*` codes above are what its `ErrorMapper` must map to.

### 1.1a Abuse limits on authenticated actions (Phase 8, 2026-10-21)

A handful of authenticated actions are rationed per ACTOR (the token's actor, never anything in the request), in a fixed window, in Redis. Over the limit the route answers **429 `COMMON.RATE_LIMITED`** with `Retry-After` (seconds until the window ends) and the body `{ error: { code: 'COMMON.RATE_LIMITED', message: 'too many attempts; try again later' } }` — the same code and header as login, so a client handles both once. The check runs after authentication and before the handler, so a refused request has no effect, and every attempt counts (a request later refused for another reason still spent budget).

| Route | Budget (chat.config key) | Default per 60 s |
|---|---|---|
| `POST /conversations/:id/messages` | `abuse.throttle.message_send_actor` | 60 |
| `POST /conversations/:id/messages/forward` | `abuse.throttle.message_send_actor` (shared with send) | 60 |
| `POST /conversations/:id/messages/attachments/authorize` | `abuse.throttle.attachment_upload_actor` | 30 |
| `POST /stories/media` | `abuse.throttle.attachment_upload_actor` (shared) | 30 |
| `POST /stories/:id/publish` | `abuse.throttle.story_publish_actor` | 20 |
| `POST /calls` | `abuse.throttle.call_start_actor` | 20 |
| `POST /scheduled-calls/:id/join` | `abuse.throttle.call_start_actor` (shared) | 20 |

The window is `abuse.throttle.window_seconds` (60). If the rate limit store is unreachable these routes are **served, not refused** (fail open, logged) — the opposite of login. WebSocket frames are bounded separately: a socket sending more than `abuse.realtime.frames_per_socket_per_minute` (600) frames in a minute has the excess frame dropped and is disconnected by the server (`io server disconnect`). Details: `docs/security/ABUSE-LIMITS.md`.

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
| POST | `/conversations/student-group` | API | RECONCILE | Gated (2026-10-12): family-facing staff with the learner's family in scope; tenant-isolated. Permission key `conversations.manage` still Phase 1. §3.4 |
| POST | `/conversations/student-group/:learnerId/sync` | API | RECONCILE | Gated (2026-10-12), same rule; the route now carries the actor. §3.4, §5 |
| GET | `/conversations/:id` | API, Flutter | RECONCILE | Must include `members[]` (promised by `mobile-contract.md`, not passed by the controller). Side-effect upsert removed. §3.4 |
| POST | `/conversations/:id/members` | API | RECONCILE | Scoped and validated (2026-10-12): family scope, tenant isolation, direct conversations immutable, member judged from their own row, `COMMON.VALIDATION` 400. Permission key still Phase 1. §3.4 |
| POST | `/conversations/:id/preferences` | API, Flutter | EXISTS | §3.4 |
| GET | `/conversations/:id/call-capability` | API, Flutter | **EXISTS (new 2026-09-24)** | Advisory: may the caller START a call here. Same `canCall` as `POST /calls`; never a grant. §3.4 |
| GET | `/conversations/:conversationId/messages` | API, Flutter | EXISTS | seq pagination unchanged. §3.5 |
| POST | `/conversations/:conversationId/messages` | API, Flutter | EXISTS | Idempotent on `clientMessageId`. §3.5 |
| POST | `/conversations/:conversationId/messages/attachments/authorize` | API | RECONCILE | Checks `canRead` today; Phase 1 checks `canSend`. §3.6 |
| POST | `/conversations/:conversationId/messages/read` | API, Flutter | EXISTS | Forward-only cursor (PD-37). §3.5 |
| POST | `/conversations/:conversationId/messages/delivered` | API | **EXISTS (new 2026-10-26, PD-37)** | Delivery cursor `{ upToSeq }`. §3.5 |
| GET | `/conversations/:conversationId/messages/unread` | API, Flutter | EXISTS | Counts only the caller's own receipts; no membership check needed. §3.5 |
| POST | `/conversations/:conversationId/messages/:messageId/delivered` | API | EXISTS | Duplicate of WS `message.delivered`; kept. §3.5 |
| GET | `/presence?staff=<ids>&teachers=<ids>` | API | **EXISTS (new 2026-10-26, PD-37)** | Online / last seen of up to 100 people, ONLY those `PresencePolicy` lets the caller see (others are absent, not "offline"). Response `{ presence: [{ actorId, online, lastSeenAt }] }`. |
| GET / PATCH | `/me/presence` | API | **EXISTS (new 2026-10-26, PD-37)** | Staff only (`COMM.PRESENCE_DENIED` 403 otherwise). `{ hideLastSeen: boolean }`: on, nobody sees the caller's last seen and the caller sees nobody's; online stays visible. |
| GET | `/conversations/:conversationId/messages/:messageId/info` | API | **EXISTS (new 2026-10-26, PD-37)** | Message info: who read / has / lacks the message. Author or staff only; countable readers only. §3.5 |
| POST | `/conversations/:conversationId/messages/:messageId/reactions` | API, Flutter | EXISTS | §3.5 |
| DELETE | `/conversations/:conversationId/messages/:messageId/reactions` | API, Flutter | RECONCILE | Gains `?emoji=`; Flutter must send it. §3.5, §6 |
| DELETE | `/conversations/:conversationId/messages/:messageId/me` | API | EXISTS | §3.5 |
| DELETE | `/conversations/:conversationId/messages/:messageId` | API | EXISTS | `?reason=` query. §3.5 |
| GET | `/approvals/pending` | API | RECONCILE | Unscoped (all pending, any family, `take: 200`); Phase 1 scopes to handler/manager and paginates. §3.7 |
| GET | `/approvals/mine` | API | RECONCILE | Response → `{items,nextCursor}` (Phase 1). §3.7 |
| POST | `/approvals/:id/approve` | API | EXISTS | §3.7 |
| POST | `/approvals/:id/reject` | API | EXISTS | §3.7 |
| GET | `/approvals/history/:conversationId` | API | RECONCILE | Response → `{items,nextCursor}` (Phase 1). §3.7 |
| POST | `/livekit/webhook` | API | **EXISTS (new 2026-09-27)** | LiveKit's own callback, not a Jawwid actor. Verified with the official `WebhookReceiver`; records MEDIA presence, never an accept. §3.9 |
| POST | `/calls` | API | EXISTS | §3.8 |
| POST | `/calls/:id/token` | API | EXISTS | §3.8 |
| POST | `/calls/:id/accept` | API | EXISTS | Emits **`call.accepted`** — an application answer. `call.participant_joined` means MEDIA presence and comes only from `POST /livekit/webhook`. §3.8 |
| POST | `/calls/:id/decline` | API | EXISTS | §3.8 |
| POST | `/calls/:id/end` | API | EXISTS | §3.8 |
| GET | `/calls/history` | API | **EXISTS (new 2026-09-28, W8-W2)** | THIS ACTOR's calls across the conversations they may read. Paged `{items,nextCursor}`. **Not a family query.** §3.8 |
| GET | `/calls/history/:conversationId` | API | RECONCILE | Response → `{items,nextCursor}` (Phase 1). Unchanged by W8-W2 — see §3.8. |
| POST | `/scheduled-calls` | API | **EXISTS (new 2026-10-19, PD-13)** | Schedule a call or create a members-only call link in ONE conversation; posts a card. Needs the right to start a call there. §3.8a |
| GET | `/scheduled-calls` | API | **EXISTS (PD-13)** | The caller's open and coming scheduled calls, soonest first. §3.8a |
| GET | `/scheduled-calls/:id` | API | **EXISTS (PD-13)** | 404 unless the caller reads its conversation. §3.8a |
| POST | `/scheduled-calls/:id/cancel` | API | **EXISTS (PD-13)** | Creator only; posts a cancellation card. §3.8a |
| POST | `/scheduled-calls/:id/join` | API | **EXISTS (PD-13)** | `{callId, conversationId, mode: 'started'\|'joined'}` via `CallService.start`/`accept`. Serialized per scheduled call. §3.8a |
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
| POST | `/conversations/:id/messages/:messageId/reactions` | Flutter (`http_message_repository.dart`) | EXISTS | **Fixed:** the client posted to `/messages/:id/reactions`, which is not a route — every reaction 404'd. Now nested under its conversation. |
| DELETE | `/conversations/:id/messages/:messageId/reactions` | Flutter (same) | EXISTS | **Fixed:** `?emoji=` is now sent, ahead of the server reading it. |
| DELETE | `/conversations/:id/messages/:messageId/me` | Flutter (same) | EXISTS | Delete for me. |
| DELETE | `/conversations/:id/messages/:messageId` | Flutter (same) | EXISTS | Delete for everyone; a `DELETE_WINDOW_EXPIRED` refusal is presented, not pre-empted. |
| POST | `/conversations/:id/messages/attachments/authorize` | Flutter (same) | EXISTS | Now used for `image` and `file` as well as `voice`. |
| — | `x-actor-id` header | — | **RETIRED** | Deleted on both sides. `actor_identity.dart` and `DebugActorHeaderIdentity` no longer exist; `Authorization: Bearer` is the only credential Flutter sends. |
| — | auth: login / refresh / me / logout | Flutter (`http_auth_repository.dart`) | **EXISTS** | §3.1, §3.2. `UnavailableAuthRepository` is retired. |
| — | auth: `GET/DELETE /me/sessions` | Flutter (`http_auth_repository.dart`) | MISSING (server) | Named in IDENTITY-MODEL §4 but not published. `devices()` / `revokeDevice()` fail explicitly rather than fabricating a list. |
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
  teacherRequiresApproval: boolean, parentRequiresApproval: boolean,     // PD-14: always false
  viewerModerates?: string[],                   // detail only (PD-14): author kinds this viewer
                                                // may edit / delete for everyone here
  members?: ConversationMemberDto[],                                      // detail only
  learner?: ConversationLearnerDto|null,        // list + detail; null when the conversation
                                                // is about the family, not one child
  unreadCount?: number                          // list + detail; per requesting actor
}
ConversationLearnerDto { id, name }             // two fields only -- never level,
                                                // nextClassAt, teacherId or familyId
ConversationMemberDto { actorId, actorKind: 'contact'|'staff'|'teacher'|'system',
  memberRole: 'parent'|'teacher'|'admin'|'observer', isSilent: boolean,
  displayName: string,                            // '' when the actor no longer
                                                  // resolves; never an id (O3)
  canOpenDirect: boolean }                        // advisory (canOpenDirect), per requesting
                                                  // actor: may YOU open a 1:1 with
                                                  // this member? Computed by the same
                                                  // AuthorizationService.canOpenDirect
                                                  // that POST /conversations/direct
                                                  // runs, with the teacher<->parent
                                                  // relationship resolved server-side.
                                                  // NOT permission -- the request is
                                                  // authorized again. Always present,
                                                  // never omitted for false; false is
                                                  // the value for an unknown viewer.
MessageDto {
  id, conversationId: string|null, seq: string|null, authorKind, authorId: string|null,
  authorDisplayName: string|null,                 // canonical Actor.displayName (O3).
                                                  // null for a system message and for
                                                  // an author who no longer resolves.
                                                  // Resolved in ONE batch per page via
                                                  // IdentityService.resolveActors.
  onBehalfMode: 'owner'|'coverage'|'assist'|'escalation'|null,
  type: 'text'|'image'|'video'|'voice'|'file'|'system', body: string|null,
  visibility: 'customer'|'internal', moderation: 'published'|'pending'|'rejected',
  origin: 'user'|'automation'|'broadcast', replyToMessageId: string|null,
  clientMessageId: string|null, deletedAt: string|null, deletedForAll: boolean, createdAt,
  attachments: AttachmentDto[], reactions: {actorId, emoji}[],
  status: 'sent'|'delivered'|'read'|null   // PD-37 (closes RT-012, §5 S-5): the ticks on the
                                          // VIEWER'S OWN message over countable readers (live,
                                          // not silent, not observer); null on anyone else's
                                          // message, a deleted-for-all one, and a direct
                                          // teacher<->parent conversation. No per-recipient
                                          // detail: that is GET …/messages/:messageId/info.
}
AttachmentDto { id, kind: 'image'|'video'|'voice'|'file', mimeType, byteSize, originalName,
  durationMs, width, height, url: string|null /* absolute link to GET /media/attachments/:id, bound to the reader, re-authorized on every request (RT-037) */, thumbnailUrl }
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
- Request: `{ username: string, password: string, device?: { platform: 'ios'|'android'|'web', name?: string }, remember?: boolean }`. PD-23: `remember: true` asks for Admin Web "keep me signed in"; it is granted only to staff (never the super admin) on `platform: 'web'`. Whether `username` holds a username or an email is the open item in `docs/integration/authentication-decision-gate.md` §5; the **wire field name is `username` either way** (Flutter's `AuthRepository.signIn({username,password})`; Admin Web renames `email`).
- Response: `200 TokenPairDto`.
- Errors: `AUTH.INVALID_CREDENTIALS` 401 · `AUTH.ACCOUNT_DISABLED` 403 · `AUTH.ACCOUNT_LOCKED` 403 · `COMMON.RATE_LIMITED` 429.
- Idempotency: none (no header).
- Audit: `audit_log` `{action:'session.created', entity:'session', entityId, actorId, reason:'login'}`; `event_log` `auth.login_failed` with `{username hash, reason code}` — never the password, never the raw username.
- Realtime: none.

**POST /auth/refresh**
- Auth: none (the refresh token is the credential). Request: `{ refreshToken: string }`.
- Response: `200 TokenPairDto` with a **rotated** refresh token; the presented one is invalidated. Presenting an already-rotated token revokes the whole session (reuse detection).
- PD-23: the successor keeps the login's `authenticated_at`, client and `remembered`; its `expiresAt` is the earlier of the role's idle and absolute limits. Past the absolute limit the session is revoked as `session lifetime reached` (never as `rotated`) and the answer is `AUTH.SESSION_REVOKED` 401.
- PD-23 (login and refresh): `TokenPairDto.session` is `{ id, createdAt, remembered, expiresAt, absoluteExpiresAt: string|null }`. Admin Web keeps the refresh token in `localStorage` only when `remembered` is true.
- Errors: `AUTH.SESSION_REVOKED` 401 · `AUTH.ACCOUNT_DISABLED` 403.
- Audit: `event_log` `auth.refresh_reuse_detected` on reuse. Realtime: `session.revoked` to the actor room on reuse (§4).

**POST /auth/logout**
- Auth: required. Permission: `sessions.manage`. Scope: current session only.
- Request: `{}`. Response: `{ ok: true }`. Idempotent by nature (second call → `{ok:true}`).
- RT-009 (2026-10-12): `{ ok: true }` is returned only once every API node has confirmed it can no longer deliver to this session on a decision made before the revocation; otherwise `COMM.REVOCATION_UNCONFIRMED` 503 — the session IS revoked; retry. A repeat is held to the same confirmation.
- Side effects: session revoked; device tokens registered under this session deactivated (`chat.device_token.is_active=false`); sockets of this session disconnected.
- Audit: `audit_log` `{action:'session.revoked', entity:'session', entityId, reason:'logout'}`. Realtime: none to others.

### 3.1a Devices & sessions (`MeSessionsController`) — EXISTS (PD-23)

```
SessionDto { id, current: boolean, platform: 'ios'|'android'|'web'|null, deviceName: string|null, appVersion: string|null,
             signedInAt, lastSeenAt: string|null, expiresAt, remembered: boolean }   // no ip, no user agent, no token material
```

Keyed by the verified request only. Support sessions (PD-21) are never listed and may not call the POSTs (`COMM.SUPPORT_SESSION_FORBIDDEN` 403).
- **GET /me/sessions** — `{ sessions: SessionDto[] }`, current first, then most recently active.
- **POST /me/sessions/:sessionId/revoke** — `200 { ok: true }`. The current session = sign out (reason `logout`); another = reason `signed out from another device`. Not one of the caller's live sessions: `COMM.SESSION_NOT_FOUND` 404.
- **POST /me/sessions/revoke-others** — `200 { revoked }`. Every other live session of the account, in one transaction with one audit row; their sockets disconnect (RT-009).

**POST /auth/password-reset** — EXISTS (PD-21)
- Auth: none (the one-time code is the credential). Rate-limited by the login limiter, per identifier (`reset:<username>`) and per source, before anything else.
- Request: `{ username: string, code: string /* 6 digits */, password: string /* 4..128, every account: owner decision 2026-10-27, was 8 */ }`.
- Response: `200 { ok: true }`. Opens no session: the client signs in with `POST /auth/login`.
- Side effects (one transaction): the code is spent, the password set (Argon2id), the lockout cleared, **every session of the account revoked**; then sockets disconnected (RT-009 barrier, an unconfirmed barrier is logged, not returned, since the reset happened).
- Errors: `AUTH.RESET_CODE_INVALID` 401 — one code for an unknown login, a wrong / expired / used / superseded code, and a code spent by its fifth miss · `AUTH.PASSWORD_TOO_WEAK` 400 · `COMMON.RATE_LIMITED` 429.
- Audit: `audit_log` `{action:'account.password_reset_completed', entity:'account', entityId, actorId:null, after:{resetCodeId, channel, issuedBy, revokedSessions}}` and `session.revoked`. `channel` is `admin` (PD-21) or `email` / `whatsapp` (PD-25, `issuedBy` null).

**PD-25 parent self-recovery — `/auth/recovery`** — EXISTS. All public; every POST spends the login limiter (per identifier and per source) before anything else. Parents only: an active, signed-up family account. Neither request says whether an account exists, and both send AFTER answering. Record: `../admin/pd025-parent-self-recovery.md`.

**GET /auth/recovery/options**
- Response: `200 { email: boolean, whatsapp: boolean, codeMinutes: number }` — which channels this deployment has configured. The same for everyone; the app hides a channel that is off.

**POST /auth/recovery/password** (forgot password)
- Request: `{ email: string }`. Limiter identifier `recover-email:<email>`.
- Response: `200 { ok: true }` always. When the e-mail is a parent's sign-in and e-mail is on: a 6-digit code (10 min, 5 tries, hash only) is e-mailed to it, superseding any live code; nothing inside the 60 s resend wait or past 5 codes per account per hour.
- Then: `POST /auth/password-reset { username: email, code, password }`.
- Audit: `account.recovery_code_sent` `{actorId:null, after:{resetCodeId, channel:'email', expiresAt}}`.

**POST /auth/recovery/email** (forgot e-mail, step 1)
- Request: `{ phone: string }` — any spacing, `+`/`00` international or local (Egypt by default). Limiter identifier `recover-phone:<last 9 digits>`.
- Response: `200 { ok: true }` always. When the phone matches a parent file (E.164 equality) of a signed-up parent and WhatsApp is on: ONE code by WhatsApp to the number ON FILE, one code row per matching account.
- Audit: `account.recovery_code_sent` with `channel:'whatsapp'`, per account.

**POST /auth/recovery/email/verify** (forgot e-mail, step 2)
- Request: `{ phone: string, code: string }`.
- Response: `200 { emails: string[] }` — the sign-in e-mail of every account the code is good for. Stamps `verified_at`; the code stays live, so `POST /auth/password-reset { username: <one of emails>, code, password }` may follow. A miss spends one of the code's 5 tries (shared with the completion).
- Errors: `AUTH.RESET_CODE_INVALID` 401 (unknown phone, wrong / expired / spent code, or a non-WhatsApp code) · `COMMON.RATE_LIMITED` 429.

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
- Auth: required. Permission: `conversations.read`. Scope: contact / teacher → conversations where the actor is a live member; **staff (2026-10-14, "staff scope")**: `manager` → every conversation of their organization; `admin` / `coverage` → conversations of their organization where they are a live member, OR whose family they own (`family.owner_id`), OR whose family they are on duty for (`chat.families_on_duty`), OR whose live sticky handler they are; `take: 200`. Exactly the set `canRead` (below) admits, so a row in the list always opens. Other staff → `COMM.ROLE_CANNOT_MESSAGE_FAMILY` 403. (RT-011's "every conversation in the system" is closed for the list and every read path.)
- **Staff scope on every read path.** `GET /conversations/:id`, `GET/POST …/messages`, `…/read`, attachments, approvals (`GET /approvals/pending` is filtered to conversations the caller may read), calls, and realtime `conversation.subscribe` / delivery all run `AuthorizationService.canRead(actor, conv, membership, staffInScope)`: another organization's conversation → `COMM.CONVERSATION_NOT_FOUND` 404; an admin outside their charge → `COMM.STAFF_OUT_OF_SCOPE` 403. `staffInScope` is resolved server-side (`ConversationService.staffInScope`), never from the request.
- Query today: none. Response today: `{ conversations: ConversationDto[] }`, ordered `lastActivityAt desc`. Since 2026-10-14 each row carries `members` (live members with `displayName` and the `canOpenDirect` advisory for the caller), resolved for the whole list in one membership query plus one identity batch. Each row carries `learner` (resolved from `conversation.learner_id`, null when there is none) and `unreadCount` (always a number on this route).
- **`unreadCount`** is derived from `chat.message_receipt` — the existing read-state architecture, which `markReadUpTo` already writes — and counts messages where the actor holds a receipt in `sent|delivered`, excluding `message_hidden_for` rows and `deleted_for_all`. Receipts are written only for live members other than the author and never for a pending message, so an actor's own messages, messages awaiting approval and (for a contact) internal notes have no receipt and cannot be counted. One grouped query per list request, never one per row (this is the cost that kept the field off the DTO: mobile gap O1).
- **`learner`** rides the same membership join that authorizes the list, so a contact can only receive the learner of a conversation they are a live member of. `learnerId` is unchanged and remains the authority on whether a conversation has a learner at all.
- **Phase 1:** query `familyId?`, `section?: 'needs_reply'|'pending_approval'|'unanswered'|'all'` (default `all`), `includeArchived?` (default false), `cursor`, `limit` (default 30, max 100); response `Page<ConversationDto>`; staff scope = family scope rule (§3.3) plus conversations the staff is a live member of. Section definitions: `needs_reply` = `needsReply === true`; `pending_approval` = at least one `message_approval` with `decision='pending'`; `unanswered` = `needsReply === true` and `lastStaffMessageAt is null` (never answered; a subset of `needs_reply`) — *this definition is proposed [B], to be confirmed by product*; `all` = no filter. Contacts and teachers may pass `section` but not `familyId`.
- Errors: `COMM.UNKNOWN_ACTOR` 401 · `COMM.ROLE_CANNOT_MESSAGE_FAMILY` 403.
- Audit / Realtime: none.

**POST /conversations/direct** — EXISTS (`getOrCreateDirect`)
- Auth: required. Permission: `conversations.read` (opening one's own channel) + `AuthorizationService.canOpenDirect`. Scope: allowed pairs only: contact ↔ family-facing staff, teacher ↔ family-facing staff. **contact ↔ teacher is refused, whatever their relationship** (PD-7, 2026-10-14, superseding PD-6): `COMM.BR1_TEACHER_PARENT_DIRECT` 403. `withActorId` is a lookup key, never evidence.
- Request: `{ withActorId: string }`. Response: `200 ConversationDto` (existing or created; `familyId` = the contact's family; `directKey` is the sorted pair, so the pair is unique).
- Errors: `COMM.UNKNOWN_ACTOR` 401 (either side) · `COMM.ACTOR_INACTIVE` · `COMM.INVALID_PARTICIPANTS` · `COMM.BR1_TEACHER_PARENT_DIRECT` · `COMM.TEACHER_TEACHER_DISABLED` · `COMM.STAFF_STAFF_DISABLED` · `COMM.ROLE_CANNOT_MESSAGE_FAMILY` (all 403).
- Idempotency: natural (get-or-create; unique `direct_key`, P2002 re-read).
- Audit: `event_log` `{type:'conversation_created', familyId, actorKind, actorId, payload:{conversationId, type:'direct'}}` on create only.
- Realtime (2026-10-14): on create only, `conversation.membership_changed` `{conversationId, added:[both], removed:[]}`, which also reaches each member's actor room as `conversation.added` (§4).

**POST /conversations/student-group** — EXISTS → RECONCILE (`ensureStudentGroup`)
- Auth (2026-10-12): bearer required. Checked **before** the learner is looked up: the actor must be active family-facing staff (`admin`, `coverage`, `manager`) with an organization, else `COMM.CANNOT_PROVISION_STUDENT_GROUP` 403 — identical for a real and an unknown learner id. Then: a learner (or its family) in another organization → `COMM.CONVERSATION_NOT_FOUND` 404, exactly as an unknown learner; a `manager` may provision for any family in their organization; `admin` / `coverage` only for a family they own (`family.owner_id`), else 403. On-duty cover is not scope (PD-3). Decided by `AuthorizationService.canProvisionStudentGroup` / `canProvisionStudentGroupFor`. Permission key `conversations.manage` remains Phase 1.
- Request: `{ learnerId: string }`. Response: `200 ConversationDto` (existing live group, or created with members derived from Core: contacts with `canMessage`, `family.ownerId` as `admin`, `learner.teacherId` as `teacher`; title `"<learner name> · Jawwid"`).
- Errors: `COMM.CANNOT_PROVISION_STUDENT_GROUP` 403 · `COMM.ACTOR_INACTIVE` 403 · `COMM.UNKNOWN_ACTOR` 401 · `COMM.CONVERSATION_NOT_FOUND` 404 (unknown learner, or a learner in another organization).
- Idempotency: natural (one live group per learner; partial unique index).
- Audit: `event_log` `student_group_created` (actorKind `system`); a `system` message `group.created` is written as `seq 1`.
- Realtime: none on create (the system message does not enqueue `message.created`).

**POST /conversations/student-group/:learnerId/sync** — EXISTS → RECONCILE (`syncStudentGroup`)
- Auth (2026-10-12): bearer required; the route passes `@ActorId()`. Same rule as `POST /conversations/student-group`, except that a learner in another organization answers `{ synced: false }` exactly as an unknown learner does. Whether the route should later leave the public surface for a worker-only path is still open (§5).
- Request: none. Response: `200 ConversationDto`, or `{ synced: false }` when the learner or live group does not exist.
- Side effects: members added / `leftAt` set to match Core; `system` message `group.membership_changed`.
- Completion (RT-009, 2026-10-12): as for `remove` above — `COMM.REVOCATION_UNCONFIRMED` 503 when the realtime completion cannot be confirmed, including on a repeat that finds nothing left to change.
- Audit: `event_log` `student_group_membership_synced`. Realtime: `conversation.membership_changed { conversationId, added[], removed[] }` (only when something changed).

**GET /conversations/:id** — EXISTS → RECONCILE (`conversation.controller.ts#get`)
- Auth: required. Permission: `conversations.read`. Scope: `canRead` — contact / teacher must be a live member; family-facing staff any conversation.
- Response today: `ConversationDto` carrying `learner` and `unreadCount`, but **without `members`** — the controller calls `toConversationDto(conv)` with no member list, although `docs/communication/mobile-contract.md` promises `members` on detail responses and `lib/core/data/http/http_group_repository.dart` depends on it. **Phase 1: return `members: ConversationMemberDto[]` (live members).** The authorization check is performed via `setPreferences(id, actorId, {})`, which also upserts an empty `conversation_participant_state` row as a side effect; Phase 1 replaces it with a pure `canRead` check.
- Errors: `COMM.CONVERSATION_NOT_FOUND` 404 · `COMM.NOT_CONVERSATION_MEMBER` 403 · `COMM.ROLE_CANNOT_MESSAGE_FAMILY` 403 · `COMM.ACTOR_INACTIVE` 403.

**GET /conversations/:id/call-capability** — EXISTS (added 2026-09-24, `conversation.controller.ts#callCapability`)
- Auth: required. Permission: `conversations.read` **then** the call decision. Scope: `canRead` establishes access to the conversation first; only then is `canCall` evaluated. A caller who fails `canRead` receives that refusal, so this cannot be used to probe a conversation they could not open.
- Response: `{ canCall: boolean, code: string | null }`. `code` is a stable `COMM.*` value when `canCall` is false, `null` when true. **Nothing else** — no identifier, no display name, no relationship detail, no prose reason.
- **Advisory, not an authorization.** It is the policy's answer at that instant and does not promise the next `POST /calls` will succeed; a relationship revoked in between is refused there. `POST /calls` re-decides from scratch and remains the only thing that authorizes a call. Not cached, client-side or server-side.
- **One policy.** It calls `CallService.callCapability`, which shares `decideInitiate` with `CallService.start` — same participant resolution, same family owner, same live members, same `AuthorizationService.canCall` (BR-1 per PD-7) with `CallIntent.INITIATE`. There is no second call-authorization path; `call-capability.spec.ts` asserts the two agree case for case, including the refusal code.
- Why it exists: `docs/design/screens/call.md` §4 requires the call affordance to be **absent** where the backend does not authorize the pairing, and forbids the client inferring which pairings those are. Under PD-6 that set was data; under PD-7 it is again empty for teacher↔parent, and a conversation's existence proves only that the relationship held when it was created.
- Errors (from the read gate): `COMM.CONVERSATION_NOT_FOUND` 404 · `COMM.NOT_CONVERSATION_MEMBER` 403 · `COMM.ROLE_CANNOT_MESSAGE_FAMILY` 403 · `COMM.ACTOR_INACTIVE` 403 · `COMM.UNKNOWN_ACTOR` 403.
- Audit: none. Read-only; it creates no call and writes no row.

**POST /conversations/:id/members** — EXISTS → RECONCILE (`setMembership`)
- Auth (2026-10-12): required. Gate: active family-facing staff with an organization (`canManageMembership`), else `COMM.ACTOR_INACTIVE` / `COMM.CANNOT_MANAGE_MEMBERSHIP` 403. Scope (`canManageMembershipIn`): a conversation in another organization → `COMM.CONVERSATION_NOT_FOUND` 404, as an unknown one; **`direct` → 403 for everyone** (its identity is its two members, `direct_key`); a `manager` for any conversation in their organization; `admin` / `coverage` only for a conversation of a family they own (on-duty is not scope, PD-3); a family-less conversation only through live `admin` membership of it. Permission key `conversations.manage` remains Phase 1.
- Request: `{ action: 'add'|'remove', actorId, actorKind, memberRole, isSilent?: boolean, reason: string }`. Shape errors → `COMMON.VALIDATION` 400 naming the field: `action` not add/remove, blank `reason`, non-uuid `actorId` or conversation id, unknown `actorKind`, non-boolean `isSilent`.
- `add` (`canAddMember`): the member is judged from **their own row**, never from the request. contact → only as `parent`, active, `canMessage`, of the conversation's family; teacher → only as `teacher`, active, and only into the Student Group of a learner they teach; staff → only as `admin`/`observer`, active, family-facing. Anything else, an unknown id, or another organization's row → `COMM.INVALID_PARTICIPANTS` 403 (one answer for all three). Contacts and teachers are refused in class groups and official conversations until Phase 2 defines them. Re-adding an identical live member is a no-op (200, nothing written); in a different role → `COMMON.VALIDATION` 400.
- `remove`: acts on the live membership row; the request's `actorKind` / `memberRole` are ignored, and the audit records the row's role. Removing a non-member is a no-op (200, nothing written).
- `remove` completion (RT-009, 2026-10-12): `200` only once every API node has confirmed it can no longer deliver to the removed member on a decision made before the removal; otherwise `COMM.REVOCATION_UNCONFIRMED` 503 with the removal committed. A retry — including the no-op repeat — is held to the same confirmation, never answered `200` on the strength of the first attempt.
- Every refusal happens before the transaction and writes nothing. A concurrent identical add is absorbed by the live-member unique index (one row, one audit, one event).
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
- Response: `{ messages: MessageDto[], nextBefore: string|null }`. Visibility filter (single place, `visibilityFilter`): contacts/teachers never see `internal`; nobody sees their own `deleted for me` rows; `pending` visible only to the author and family-facing staff; `rejected` only to the author. Attachment `url`/`thumbnailUrl` are minted per read for THIS reader (link expiry `STORAGE_SIGNED_URL_TTL_SECONDS`, default 300 s) and point at `GET /media/attachments/:id` (RT-037) — never at the storage bucket. A message `deletedForAll` has `body: null, attachments: []`.
- Errors: `COMM.CONVERSATION_NOT_FOUND` 404 · `COMM.NOT_CONVERSATION_MEMBER` 403 · `COMM.ROLE_CANNOT_MESSAGE_FAMILY` 403.
- Audit / Realtime: none.

**POST /conversations/:conversationId/messages**
- Auth: required. Permission: `messages.send`. Scope: `AuthorizationService.canSend` (membership, BR-1, C-4 admin presence, on-duty / sticky / manager, silent, `can_message`, archived).
- Request: `{ type?: 'text'|'image'|'video'|'voice'|'file' (default text; 'system' is downgraded to text for non-system actors), body?: string, visibility?: 'customer'|'internal' (default customer), clientMessageId?: string (strongly recommended), replyToMessageId?: string, requestedMode?: 'assist'|'escalation' (only these are honoured; owner/coverage are derived), attachments?: [{ kind, objectKey, mimeType, byteSize, checksumSha256?, originalName?, durationMs?, width?, height?, thumbnailObjectKey? }] }`.
- Response: `200 MessageDto` (`moderation` is always `'published'` since PD-14 — nothing is held for approval; `onBehalfMode` derived).
- Errors: `COMM.EMPTY_MESSAGE` 400 · `COMM.ATTACHMENT_*` 400 · `COMM.MESSAGE_NOT_FOUND` 404 (reply target) · `COMM.REPLY_TARGET_CROSS_CONVERSATION` 403 · `COMM.CONVERSATION_ARCHIVED` 403 · every matrix code in §1.1 · `COMMON.RATE_LIMITED` 429 (abuse limit, §1.1a).
- Idempotency: **`clientMessageId`** (fast-path lookup + unique-index P2002 re-read, scoped to `(conversationId, authorId, clientMessageId)` — the unique index is asserted by the service comment; not re-verified in the migrations here). `Idempotency-Key` is redundant for this route.
- Side effects: `seq = last_seq + 1` under `FOR UPDATE`; `lastActivityAt`; for published customer-visible messages a contact author sets `lastCustomerMessageAt` and clears `resolvedAt`, a staff author sets `lastStaffMessageAt` and becomes sticky handler for `handoff.grace_minutes` (15); receipts `sent` created for live members other than the author (internal notes: staff only); pending messages create a `message_approval` and **no receipts**.
- Audit: `event_log` `{type:'message_sent', payload:{conversationId, messageId, type, visibility, moderation}}` (never the body); `audit_log` `{action:'message.assist'|'message.escalation', entity:'conversation', after:{messageId}, reason}` when `onBehalfMode` is assist / escalation.
- Realtime: published → `message.created` (+ `conversation.updated`); pending → `approval.requested` (+ `conversation.updated`). Worker side effect: one `new_message` push notification per recipient (`dedupeKey new_message:<messageId>:<actorId>`), skipping muted and inactive recipients.

**POST /conversations/:conversationId/messages/read**
- Auth: required. Permission: `messages.read`. Scope: `canRead`. Request: `{ upToSeq: string }` (a whole number ≥ 0, else `COMMON.VALIDATION` 400). Rate limit: `abuse.throttle.receipt_cursor_actor` (240 / window, PD-37).
- Side effects (PD-37, one transaction): the caller's cursor `lastReadSeq` becomes `GREATEST(old, min(upToSeq, conversation.lastSeq))` — **forward only**, never past the last message; `lastDeliveredSeq` follows it (a read implies delivered); `lastReadAt` is stamped when the cursor moved. The caller's receipts for `seq <= cursor` move to `read` in one set-based statement (monotonic — never downgrades). When the cursor moved, the caller is a **seated** member (live, not silent, not observer), the conversation is not a direct teacher↔parent one (PD-7), and `realtime.receipts_announce` is on (default OFF until the PD-37 worker is deployed), a `receipts.advanced` outbox row is written; the worker sends `message.status` to the authors. PD-34's `conversation.read` row is written in the same transaction on every read. Response: `{ ok: true }`. Idempotent.
- Realtime: `message.status` to each affected **author** (§4). Nothing to the room.

**POST /conversations/:conversationId/messages/delivered** (PD-37)
- As `read`, for the delivery cursor: `lastDeliveredSeq` forward-only and clamped; the caller's `sent` receipts for `seq <= cursor` become `delivered`. Same outbox row (`kind: 'delivered'`) for a seated caller. The WS `message.delivered { conversationId, upToSeq }` does the same.

**GET /conversations/:conversationId/messages/unread**
- Auth: required. Permission: `messages.read`. Scope: counts only the caller's own receipts in `sent|delivered`; no membership check is run (nothing to leak). Response: `{ unread: number }`.

**GET /conversations/:conversationId/messages/:messageId/info** (PD-37)
- Auth: required. Scope: the same read check as every message route (`loadForActor`), AND the caller is the message's author or staff — otherwise `COMM.NOT_MESSAGE_AUTHOR` 403. A deleted-for-all message, one the caller deleted for themselves, or one outside `:conversationId` → `COMM.MESSAGE_NOT_FOUND` 404. A non-staff party to a direct teacher↔parent conversation → `COMM.BR1_TEACHER_PARENT_DIRECT` (PD-7: no signals between them).
- Response: `{ messageId, status, readBy: Entry[], deliveredTo: Entry[], pending: Entry[] }`, `Entry = { actorId, actorKind, displayName, avatarUrl, at }`. Lists **countable readers only**: live members who are not silent and not `observer`, excluding the author. A PD-8 reader without a seat has no receipt and never appears; neither does a member who left or one who joined after the message.

**POST /conversations/:conversationId/messages/:messageId/delivered**
- Auth: required. Permission: `messages.read`. Scope: caller's own receipt. Response: `{ updated: number }`. Duplicate of the WS `message.delivered` ack; kept for clients without a socket. Realtime: none.

**POST /conversations/:conversationId/messages/:messageId/reactions**
- Auth: required. Permission: `messages.read` (a reaction is not a post; silent members may react — current behaviour). Scope: `canRead` on the message's conversation; internal / pending messages the actor may not see → 404.
- Request: `{ emoji: string }`. One reaction per actor per message: a second emoji **replaces** the first (upsert). Response: `{ ok: true }`. Idempotent.
- Realtime: `reaction.added { conversationId, messageId, actorId, emoji }`. Audit: none.

**DELETE /conversations/:conversationId/messages/:messageId/reactions** — RECONCILE
- Auth: required. Permission: `messages.read`. Scope: as above.
- Today: no parameters; removes the caller's single reaction and emits `reaction.removed` with the stored emoji. **Phase 1: query `?emoji=<emoji>` is required**; if the stored reaction differs the call is a no-op `{ ok: true, removed: false }`. Rationale: makes the delete safe against a concurrent replace and keeps the route stable if multi-reaction ever lands. Flutter now sends the emoji, ahead of the server reading it, so the client needs no change when Phase 1 lands.
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
- Errors: `COMM.ATTACHMENT_TYPE_NOT_ALLOWED` 400 · `COMM.ATTACHMENT_TOO_LARGE` 400 · `canRead` codes · `COMMON.RATE_LIMITED` 429 (abuse limit, §1.1a).
- Audit / Realtime: none. Download: never a permanent URL — `AttachmentDto.url` is minted per read and served by the media route below.

### GET /media/attachments/:attachmentId · GET /media/stories/:storyId (RT-037, 2026-10-14)

- Auth: **`@Public()` to the bearer guard** — an `<img>`, a link or a player cannot send a header. The URL carries `v` (o|t), `a` (the reader's actor id), `e` (expiry, unix s) and `s` (HMAC-SHA256 over kind, id, variant, actor, expiry with a key derived from `JWT_ACCESS_SECRET`). **The signature is not the decision.** On every request: signature + expiry (403), the reader is live — principal and login (403), and the reader may read this message / story NOW — conversation scope, membership, visibility, deleted-for-me, deleted-for-everyone; story audience, publication, expiry, deletion (404). Only then are the bytes read from storage and streamed.
- Response: the bytes, `Content-Type` as stored, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`, `Cache-Control: private, no-store`, `Accept-Ranges: bytes`; single-range requests → 206 with `Content-Range`; out-of-range → 416. No storage URL is ever returned.
- Guarantee: a deactivation, a removal or a deletion refuses the very NEXT request on a link minted earlier. Not covered: bytes already delivered, and one response already streaming when the change commits.

### Forwarding messages (2026-10-19, owner decisions: anyone, any message they can read; text and media; up to 10 chats)

**`POST /conversations/:cid/messages/forward`**
- Body: `{ messageIds: string[], toConversationIds: string[] }`, with at most 30 messages and 10 destinations.
- Response: `{ sent: MessageDto[] }`, ordered by destination, then by the original message order.
- Rate limit: one attempt against the sender's message-send budget, whatever the fan-out: `COMMON.RATE_LIMITED` 429 (abuse limit, §1.1a).

**Two authorizations, neither implying the other:**
- **Source:** every message must be readable by the caller in `:cid`. It must also be allowed to leave: published, not deleted, and not a system message or a ticket's card. Otherwise the request fails with `COMM.MESSAGE_NOT_FORWARDABLE` (403).
- **Destination:** every target is checked up front with the send decision, and then each copy goes through the ordinary send path. A forward can therefore never reach a chat an ordinary message could not, and it inherits BR-1, staff scope, silencing and approval.

**What a forward creates:**
- A NEW message, authored by the forwarder, with `MessageDto.forwarded: true`.
- No reactions, receipts or reply target from the original.
- An internal note stays an internal note, so it can never reach a family.

**Media:** each stored object is COPIED server-side (`ObjectStorage.copy`: S3 CopyObject, or the local blob store) into `conversations/<target>/<uuid>`. Keys are never shared across conversations. A store without `copy` refuses media forwards.

**Provenance and audit:**
- `chat.message.forwarded_from_message_id` is kept for audit and NEVER returned to a client (migration `20261020100000`).
- `chat.audit_log` records `message.forwarded`.

### Labels and quick replies (2026-10-19, owner decisions: labels private per staff member; any staff member manages; quick replies = team library + personal)

Staff only. Every route first checks that the caller is active conversation staff in an organization; a teacher or a family member gets `COMM.STAFF_TOOLS_DENIED` (403) before anything is read. Errors: `COMM.STAFF_TOOL_NOT_FOUND` (404), `COMM.STAFF_TOOL_INVALID` (400), `COMM.STAFF_TOOL_CONFLICT` (409, duplicate name/shortcut).

**Labels are private to their owner.** A colleague, a family or a teacher never sees them: they do not exist outside the owner's own requests.
- `GET /me/labels` → `{ labels: [{ id, name, color, conversationCount }] }`
- `POST /me/labels` `{ name, color }` → `LabelDto`. `name` is 1–40 characters, unique per owner (case and surrounding spaces ignored). `color` is one of `'1'`…`'8'`.
- `PATCH /me/labels/:id` `{ name?, color? }` → `LabelDto`. `DELETE /me/labels/:id` → `{ ok: true }`, which also removes the label from every chat.
- `PUT /conversations/:cid/labels` `{ labelIds }` → `{ labels: LabelDto[] }`. This replaces the caller's OWN labels on a chat they can read (`canReadResolved`). A colleague's tagging of the same chat is never touched. Someone else's label id is 404, just like a missing one.
- `ConversationDto.labels?: LabelDto[]` on `GET /conversations` and `GET /conversations/:cid`: the viewer's own labels, **present only for a staff viewer**. The field is absent for teachers and families.

**Quick replies:** `scope: 'team'` is the organization's library, which any staff member may add to, edit or delete. `scope: 'mine'` is personal: only its owner sees or changes it, and anyone else gets 404.
- `GET /quick-replies` → `{ team: QuickReplyDto[], mine: QuickReplyDto[] }`, where `QuickReplyDto = { id, shortcut, body, scope, updatedAt }`
- `POST /quick-replies` `{ shortcut, body, scope }`. `shortcut` is 1–24 letters (any script, Arabic included), digits, `_` or `-`; a typed leading `/` is dropped. Shortcuts are unique within a library, case-insensitively. `body` is 1–2000 characters.
- `PATCH /quick-replies/:id` `{ shortcut?, body? }`. `DELETE /quick-replies/:id` → `{ ok: true }`.
- A quick reply only fills the message box. It is sent like any other message, through the ordinary send path and all its checks.

**Storage:** migration `20261020110000` adds `chat.staff_label`, `chat.conversation_label` (a same-org trigger) and `chat.quick_reply` (owner NULL = team; partial unique indexes per library). RLS is enabled with no policies, so they are reachable only through the service role.

### Chat themes (2026-10-20, owner decisions: private to the viewer; presets + own photo; saved on the server)

A theme is the **viewer's own** look for one chat. It is stored on their row of `chat.conversation_participant_state`, next to mute, pin and favourite, so nobody else's view of the chat changes. It changes only the background behind the messages. Bubbles keep their own contrast-checked colours, and clients dim a photo.

Every route below first requires that the caller can read the conversation (`canReadResolved`).
- `PUT /conversations/:cid/theme` `{ theme }` → `{ theme }`
  - `theme` is one of `lagoon`, `sand`, `rose`, `sky`, `lilac`, `olive`, `slate`, `dusk`, or `null` for the default look.
  - Anything else fails with `COMM.CHAT_THEME_INVALID` (400). So does a body **without** a `theme` field: only an explicit `null` resets to the default.
- Setting a wallpaper takes two steps, like a profile photo:
  1. `POST /conversations/:cid/wallpaper/upload` `{ mimeType, byteSize }` → an upload grant (`uploadUrl`, `objectKey`, `headers`). The type is JPEG, PNG or WebP, the size at most 4 MB, and the key sits under `wallpapers/<actorId>/<cid>/`.
     - The key becomes the viewer's **one pending upload** for the chat. Authorizing again deletes the previous pending object, so uploads that are never committed cannot pile up: a viewer holds at most the wallpaper in use plus one upload in flight per chat.
  2. `POST /conversations/:cid/wallpaper` `{ objectKey }` → `{ wallpaperUrl }`.
     - The key must be exactly the pending one; committing the wallpaper already in use is a no-op.
     - The stored bytes are judged: the real type must match the declared one, no animation, and each side between 200 and 4096 px.
     - The row is locked while it changes, so two commits at once are ordered and nothing is left unreferenced.
     - A rejected object is deleted, and the previous wallpaper is deleted on replace.
  - A refused photo has its own code, so clients can word it: `COMM.CHAT_WALLPAPER_TYPE`, `COMM.CHAT_WALLPAPER_TOO_LARGE`, `COMM.CHAT_WALLPAPER_DIMENSIONS`, `COMM.CHAT_WALLPAPER_ANIMATED` (400 each). Any other refusal (unknown preset, missing field, a key that is not the pending one) stays `COMM.CHAT_THEME_INVALID`.
- `DELETE /conversations/:cid/wallpaper` → `{ wallpaperUrl: null }`, and the object is deleted.
- `ConversationViewerStateDto` gains `theme: string | null` and `wallpaperUrl: string | null`, on the list and on a single conversation, for the viewer only.

**`GET /media/wallpapers/:cid`** (RT-037 pattern; `@Public`, signed):
- The signature binds the viewer, and the object served is **that viewer's own** wallpaper for the chat. It is served only while they can still read the chat; every refusal is the same 404 (`COMM.CHAT_WALLPAPER_NOT_FOUND`).
- Links are hour-bucketed (they expire 1–2 hours after issue) and carry a `&k=` fingerprint of the object, so a replaced photo gets a new URL.
- Served with `Cache-Control: private, max-age=3600`: the viewer's own photo at a per-object URL, so opening a chat does not re-download it. Every other media kind stays `private, no-store`. A client that holds a chat longer than a link lives re-reads the conversation for a fresh one when the photo fails to load.

**Storage:** migrations `20261020150000` and `20261020160000` (`wallpaper_pending_key`, with the same shape CHECK and a unique index).
- `theme` is limited to the eight presets by a CHECK.
- `wallpaper_object_key` has a CHECK that the key names this row's own `actor_id` and `conversation_id`, plus a unique index. A copied key can never be stored on another viewer's row.

### Message search and chat export (2026-10-20, owner decisions: search inside a chat and across chats; export = super admin only, logged, transcript + media)

**Search never decides who may see a message.** The route first narrows to the conversations the caller may read. Text is matched with `chat.search_fold`, and every candidate then passes the same per-message rule the message list uses (`visibilityFilter`: internal notes, held or rejected messages, deleted-for-me). Messages deleted for everyone, system messages and cards are never matched.
- `GET /conversations/:cid/messages/search?q=&before=` → `{ hits: MessageDto[], nextBefore: string | null }`
  - Newest first, 50 per page, paged by seq.
  - The caller must be able to read `:cid` (`canReadResolved`).
  - Visibility is applied after the text match, so one request reads up to five windows of 200 text candidates until its page is full. A page can be short, or even empty, with `nextBefore` set: keep paging until `nextBefore` is null.
- `GET /me/search?q=` → `{ hits: [{ conversationId, message: MessageDto }] }`
  - Newest first, at most 40 hits, with no paging; a narrower term finds more. Up to five windows of 200 text candidates are read to fill them.
  - `q` needs **3** meaningful characters here, not 2. A two-letter term cannot use the trigram index and would fold every message of every listed chat.
  - The boundary is `listForActor`: exactly the chats in the caller's list (PD-8 scope for staff, live membership for families and teachers).
- `q` must be 2–100 characters (3 across chats) after Arabic marks and spaces are removed, or the request fails with `COMM.VALIDATION` (400). `%` and `_` are literal characters.
- **Matching** (migration `20261020140000`):
  - Case-insensitive substring match.
  - Arabic harakat, superscript alef and tatweel are ignored.
  - أ/إ/آ/ٱ are treated as ا, ى as ي, and ة as ه.
  - A trigram GIN index on `chat.search_fold(body)` serves terms of three or more characters.
  - The clients carry a copy of the fold **for highlighting only**.

**`GET /conversations/:cid/export`** → `application/zip`, `Content-Disposition: attachment; filename="jawwid-chat-<date>-<id8>.zip"`.
- **Super admin only.** Any other caller gets `COMM.CONVERSATION_EXPORT_DENIED` (403) before anything is read. The conversation must also be readable by the super admin.
- **Audit:** `chat.audit_log` records `conversation.exported` with `{ messages, mediaFiles, mediaBytes, internalNotes }`. The row is written BEFORE the first byte, so an interrupted download is still logged.
- **Two passes over one frozen set:** messages up to the conversation's `last_seq` when the export starts. The first pass only counts (for the audit row); the second streams the archive batch by batch. The whole chat is never held in memory; each media file is held only while it is written. Nothing is signed: an export carries bytes, never links.
- **Contents** — exactly what the super admin can read in the chat:
  - `chat.txt`: UTF-8 with a BOM, oldest first, `[YYYY-MM-DD HH:mm] Sender: text`, times in `stats.zone`. Internal notes, forwarded, held and rejected messages are marked as such.
  - `media/NNNN-<name>`: the stored bytes, under sanitized names.
  - A message deleted for everyone appears as deleted, and its media are NOT exported.
  - A file whose object key is outside this conversation's namespace is never read, whatever row points at it (the media route's rule). It is listed as `<file missing: …>`.
- **Format:** stored entries (no compression) with UTF-8 names and no ZIP64. If the archive would pass 4 GiB, the remaining files are listed in the transcript as not included.
- **CORS:** `Content-Disposition` is exposed so the browser can read the file name.

### Starred and pinned messages (2026-10-19, owner decisions: anyone who can write may pin; at most 3)

**Star: a private bookmark.** Nobody else ever sees it.
- `POST` and `DELETE /conversations/:cid/messages/:mid/star`.
- Starring requires the caller to be able to read the message, and the message must not be deleted for everyone.
- Unstarring always succeeds for the caller's own star.
- `GET /me/starred?before=&limit=` returns `{ items: [{ starredAt, conversationId, message: MessageDto }], nextBefore }`. Items are newest star first, and only from conversations the caller may still read (the same visibility rule as the message page).

**Pin: shared with everyone in the conversation.**
- `POST` and `DELETE /conversations/:cid/messages/:mid/pin`.
- Allowed exactly when the caller may WRITE there: the same `canSend` decision a send takes. Being able to read is not enough; an archived conversation refuses with `COMM.CONVERSATION_ARCHIVED`.
- Only a published, non-system message that is not deleted can be pinned (otherwise 400 `COMM.VALIDATION`).
- At most 3 per conversation. A fourth replaces the oldest, in one transaction under a lock on the conversation row. The `chat.enforce_message_pin` trigger also enforces the cap, and that the message belongs to the conversation, for any writer.
- Every pin or unpin emits `conversation.updated` (clients re-read the page and the pins) and writes `chat.audit_log` (`message.pinned` or `message.unpinned`).
- `GET /conversations/:cid/messages/pins` returns `{ pins: [{ pinnedAt, pinnedBy, message: MessageDto }] }`, oldest first. It holds only the pins this viewer could read anyway, so a pinned internal note is never shown to a family.

**`MessageDto` fields:**
- `starred`: the viewer's own bookmark.
- `pinned`: pinned for everyone.
- Both are set on the message page, the pins list and the starred list.

**Schema:** migration `20261020091000_chat_message_star_pin.sql` adds `chat.message_star` and `chat.message_pin`. Both cascade with their message, and RLS is on with no policy (owner connection only).

### Editing a message (2026-10-20, owner request)

`PATCH /conversations/:cid/messages/:mid` with `{ body }` returns the `MessageDto` as it now reads.

- **Only the author**, and only within `communication.edit_window_minutes` (config, default 15). Anyone else gets `COMM.NOT_MESSAGE_AUTHOR`; a late edit gets `COMM.EDIT_WINDOW_EXPIRED`.
- **Only a published, never-moderated, undeleted TEXT message** (409 `COMM.MESSAGE_NOT_EDITABLE` otherwise). A message that went through approval stays exactly as it was approved. So does any message whose author's sends here would now be held: an edit is never a way round moderation.
- **The author must still be able to write there:** the same `canSend` decision a send takes (an archived conversation refuses with `COMM.CONVERSATION_ARCHIVED`). A message of another conversation than `:cid` reads as absent (404).
- An empty body is 400 `COMM.EMPTY_MESSAGE`. An unchanged body is a no-op: no revision, no event.
- **The previous wording is kept** in `chat.message_revision`, in the same transaction. `chat.forbid_message_rewrite` (now amended) refuses any body change that is not such a recorded edit of a published, unmoderated text, whoever writes. Revisions are immutable. The audit row (`message.edit`) holds no text.
- `MessageDto.editedAt` is the time of the last edit (null when never edited); `body` is the current wording, and the chat-list preview follows it.
- Realtime: `message.updated` `{ conversationId, messageId, visibility, editedAt }`, with no body. An internal note's edit goes to staff rooms only.

### Favorite chats (2026-10-20)

A viewer's own list, like pin / archive / mute: `POST /conversations/:id/preferences` with `{ favorite: true | false }`. `viewerState.favorite` comes back on the list and the detail. Nobody else sees it.

**Schema:** migration `20261020130000_chat_edit_favorites.sql` adds `chat.message.edited_at`, `chat.message_revision` (RLS on with no policy: owner connection only) and `chat.conversation_participant_state.favorited_at`, plus the config row `communication.edit_window_minutes`.

### Profile photos in chat (2026-10-19, owner decision: everyone, WhatsApp-style, children included)

Who has a photo:
- **Staff:** unchanged. They set it on their staff profile (`/staff-profiles/:ref/avatar…`, RT-037 directory rule).
- **Parents and teachers:** set their own.
- **Parents:** also set their children's.

The photos reach chat as signed links on the payloads below. A client never builds a link and never sees an object key.

**Payload fields** (all are `string | null`, signed for the VIEWER in the context named):
- `MessageDto.authorAvatarUrl`: the author's photo in this conversation.
- `ConversationMemberDto.avatarUrl`: the member's photo in this conversation.
- `ConversationLearnerDto.avatarUrl`: the child's photo, on `GET /conversations` and `GET /conversations/:id`.
- No `ConversationDto.avatarUrl`. A client pictures a 1:1 by the other member and a student group by its learner.

**`GET /media/avatars/:id`**
- Auth: `@Public()`, signed exactly as `/media/attachments` (`v`, `a`, `e`, `s`).
- `:id` is `<kind>.<id>.<context>`:
  - `kind` is `staff`, `contact`, `teacher` or `learner`;
  - `context` is a conversation id, or `self`.
- The link also carries `k`: 8 hex characters of the stored key's SHA-256. A new photo is therefore a new URL. `k` is not signed and grants nothing.
- Expiry is bucketed to the hour, so a list re-read every minute hands out the same URL.
- On every request:
  1. signature + expiry (403);
  2. the reader is live (403);
  3. the decision, otherwise 404:
     - same organization;
     - the stored key is `avatars/<kind>/<id>/<uuid>`;
     - for `self`: the reader's own photo, or a child of the reader's own family;
     - for a conversation: the reader may read it NOW (staff scope included), and the person is or was a member of it or wrote in it, or the child is the one it is about.
- Response headers match `/media/attachments` (`private, no-store`).

**Endpoints** (`profile-photo.controller.ts`, `communication/profile/avatar.service.ts`):

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/me/photo` | none | `{ avatarUrl, children: [{ id, name, avatarUrl }] }`. `children` is filled for a parent only. |
| POST | `/me/avatar/upload` | `{ mimeType, byteSize }` | A signed PUT under `avatars/<contact|teacher>/<self>/`. JPEG/PNG/WebP, at most 2 MiB. |
| POST | `/me/avatar` | `{ objectKey }` | `{ avatarUrl }` |
| DELETE | `/me/avatar` | none | `{ avatarUrl: null }` |
| POST · POST · DELETE | `/me/children/:learnerId/avatar/upload`, `/me/children/:learnerId/avatar` | as above | As above, under `avatars/learner/<learnerId>/`, for a learner of the caller's own family only. |

**Errors:**
- `COMM.PROFILE_PHOTO_INVALID` (400): type, size or dimensions; bytes that are not a real image; or a key outside the owner's prefix.
- `COMM.PROFILE_PHOTO_DENIED` (403): staff calling `/me/avatar`.
- `COMM.PROFILE_PHOTO_NOT_FOUND` (404): any other refusal.

**What a commit does:** checks the key structurally, inspects the stored bytes (`judgeAvatar`), updates only `avatar_object_key`, writes `chat.audit_log` (`profile_photo.set|removed`), and deletes the replaced object. The database CHECK of 20261014130000 independently holds every key to its own row's prefix.

### Parent profile: About for a parent and their children (on main 2026-10-21)

A parent edits their own name and About, and each child's. Save is the publish. Migration `20261021010000`; `parent-profile.controller.ts`, `profile/parent-profile.service.ts`.

- **Names** stay `chat.contact.name` / `chat.learner.name`. The profile tables hold no name.
- **About** lives in `chat.contact_profile` / `chat.learner_profile`, Chat-owned siblings of the identity rows, so a Core projection can never overwrite it. At most 1000 characters; whitespace-only clears it.
- **Photos** are the account photos, set through `/me/avatar` and `/me/children/:learnerId/avatar` (above). The profile carries their `self` links.
- **No owner id.** The caller is the token. The one id that travels is a child's, and it resolves only inside the caller's own family.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/me/profile` | none | `{ displayName, relationship, signInIdentity, about, avatarUrl, canMessage, children: [{ id, displayName, level, about, avatarUrl }] }`. Contacts only. |
| PATCH | `/me/profile` | `{ name?, about? }` | The profile. An absent field is left alone; `about: null` or blank clears it. |
| PATCH | `/me/children/:learnerId` | `{ name?, about? }` | The profile, for a child of the caller's family. |

**Errors:** `COMM.PROFILE_NOT_AVAILABLE` (403, not a family contact), `COMM.PROFILE_FIELD_INVALID` (400), `COMM.LEARNER_NOT_IN_FAMILY` (404, also for a learner that does not exist).

**Audit:** `profile.name.changed` and `profile.child.name.changed` (old and new name); `profile.about.saved` and `profile.child.about.saved` (the About's LENGTH, never its text). The actor is always the parent.

### Teacher professional profile (Teacher Profile V2; on main 2026-10-20)

The teacher owns it: **Save is the publish.** There is no draft, no submit and no profile approval. What a reviewer still decides is each **certificate**, because an upload does not make a credential verified. Migrations `20261021000000` + `20261021000100`; `teacher-profile.controller.ts`, `teacher-profile/teacher-profile.service.ts`.

- **Name:** `chat.teacher.name` only. No profile table holds a name.
- **Photo:** the teacher's one account photo, set through `/me/avatar` (above). The profile carries its `self` link as `photoUrl`; there is no teacher-profile photo route.
- **No route takes a teacher id.** Every `/me/…` route resolves the teacher from the session.
- **No response carries an object key.** Uploads return an opaque `uploadToken` that is handed straight back.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/me/teacher-profile` | none | The profile: `{ name, role, photoUrl, bio, specialization, qualifications, experience, languages, certificates[], updatedAt }`. Creates nothing. |
| POST | `/me/teacher-profile` | `{ bio?, specialization?, qualifications?, experience?, languages? }` | The profile, immediately current. |
| PATCH | `/me/teacher-profile/name` | `{ name }` | `{ name, role }`, the name as stored (trimmed, whitespace collapsed). |
| POST | `/me/teacher-profile/certificates/upload` | `{ mimeType, byteSize }` | `{ uploadUrl, uploadToken, expiresAt, headers }`. PDF/JPEG/PNG, at most 10 MiB. PUT the bytes with exactly `headers`. |
| POST | `/me/teacher-profile/certificates` | `{ title, issuingOrganization?, issuedOn?, mimeType, byteSize, uploadToken }` | The profile; the new certificate is `pending`. The file must already be in storage, at the declared size, and sniff as the declared type: otherwise `COMM.TEACHER_CERTIFICATE_NOT_UPLOADED` (409) or `_INVALID_TYPE` (400, and the file is deleted). |
| PATCH | `/me/teacher-profile/certificates/:id` | `{ title, issuingOrganization?, issuedOn? }` | The profile. A retitled claim returns to `pending`; the file never moves. |
| DELETE | `/me/teacher-profile/certificates/:id` | none | The profile. |
| GET | `/teacher-profiles/review` | none | `{ profiles: [{ profileId, teacherName, pendingCertificates, certificates[] }] }`, reviewers only. |
| POST | `/teacher-profiles/certificates/:id/decide` | `{ approved, note? }` | Reviewers only, never on their own; rejecting needs a `note`. |
| GET | `/teacher-profiles/certificates/:id/download` | none | `{ url }`: a `GET /media/teacher-certificates/:id` link bound to the caller, the owning teacher or a reviewer, re-decided on every request (RT-037). |

**Reviewers:** admin, coverage, manager and the super admin (`AuthorizationService.canReviewTeacherProfile`, mirrored by `chat.current_can_review_teacher_profile()`), same organization.

**Errors:** `COMM.TEACHER_PROFILE_NOT_A_TEACHER`, `_CANNOT_REVIEW`, `_REVIEW_NOTE_REQUIRED`, `_INVALID_CONTENT`, `_CONFLICT`, `_NOT_FOUND`; `COMM.TEACHER_NAME_INVALID`; `COMM.TEACHER_CERTIFICATE_NOT_FOUND`, `_INVALID_TYPE`, `_TOO_LARGE`, `_NOT_UPLOADED`.

No parent-facing route exists yet: `publicProfile` (approved certificates only) is service-level, waiting for the family screen.

### 3.6a Time zone (`time-zone.controller.ts`) — EXISTS (PD-22)

The caller's own time zone. No route reads or writes another person's.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/me/time-zone` | none | `{ timeZone: string \| null, automatic: boolean, updatedAt: string \| null }` |
| POST | `/me/time-zone/device` | `{ timeZone }` | The setting. The phone's OS zone, recorded only while `automatic` is true. |
| PUT | `/me/time-zone` | `{ automatic, timeZone }` | The setting. `automatic: false` pins `timeZone`; `true` follows the phone again. |

- `timeZone` is an IANA name (`Asia/Kuwait`); letter case is corrected. An offset
  (`+03:00`) or an unknown name is `COMMON.VALIDATION` (400).
- Every weekly slot in a Student Profile or a group's children carries
  `nextStartsAt` (ISO), the next real start; the Student Profile also carries
  `familyTimeZone` for staff.

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

#### The call lifecycle — the locked contract (W6, 2026-09-27)

Persisted vocabulary, and there is no other: `status ∈ {ringing, active, ended}`,
`outcome ∈ {answered, missed, declined}`, with `call_outcome_when_ended` requiring an
outcome on every ended call. There is no `accepted`, `declined` or `timeout` **status** —
decline and missed are outcomes.

```
RINGING ── accept ───────────▶ ACTIVE   answered_at, participant.joined_at
        ├─ decline ──────────▶ ENDED    outcome = declined, duration 0
        ├─ explicit end ─────▶ ENDED    outcome = missed,   duration 0
        └─ ring timeout ─────▶ ENDED    outcome = missed,   duration 0

ACTIVE  ── explicit end ─────▶ ENDED    outcome = answered, duration = now − answered_at
        └─ ring timeout ─────▶ no match. The sweep reads status = 'ringing' only.

ENDED is terminal. accept/decline → COMM.CALL_ALREADY_ENDED with nothing written;
a second end is a no-op that does not rewrite the outcome or emit a second event;
the sweep matches nothing; a late media webhook is recorded into history and
announces nothing.
```

One writer per outcome: **answered** only from `end` on an ACTIVE call · **missed** only
from `end` on a RINGING call or the sweep · **declined** only from `decline`.

**Media presence is not the lifecycle.** `media_joined_at` / `media_left_at` (W5) record
what LiveKit observed and never write `status`, `outcome`, `answered_at`, `joined_at`,
`left_at` or `duration_seconds`.

- An accepted call whose device never reached the room is still **answered**. HTTP accept
  is the user's acceptance; a missing media join does not retract it.
- A media leave never ends a call, and an answered call never becomes `missed` because
  media later disappeared.
- Duration is measured from `answered_at`, never from `media_joined_at`. Accepted 10:00,
  media joined 10:03, ended 10:10 ⇒ **10 minutes**.
- A media join on a ringing call does not answer it.

**The transition is unconditional.** A decline ends the call whoever declines and however
many participants it has. There is **no group-call exception**: no product source defines
one, and W6 does not invent one. `docs/design/screens/call.md` §7 says only that *"a group
call with one participant is allowed"*, which is about a call continuing, not about a
refusal. If a Student Group call is to survive one parent's refusal, that is a product
decision with its own authorization.

**A decline stamps `left_at` for the decliner alone.** A participant who was still ringing
did not leave, and a call becoming terminal is not evidence that they did — so an ended
call may carry a participant whose `left_at` is null. Terminal state is `call.status`, which
is what every guard checks. `end` and the ring-timeout sweep do stamp every open
participant; that is their existing rule and it is unchanged. The asymmetry is deliberate.

**Carry-forward risk (out of scope for W6, stated deliberately).** An ACTIVE call has no
deadline: nothing but an explicit `end` terminates it, so a call accepted by a client that
then disappears stays ACTIVE indefinitely. A stale-active reconciliation is a separate,
unauthorized lifecycle rule.

**POST /calls** — EXISTS
- Auth: required. Permission: `calls.start`. Scope: `canCall(intent = initiate)` = `canSend` (customer visibility) + refusal of any direct teacher/parent pair (**BR-1, PD-7**) + C-4. Participants = live, active, non-silent members (server-derived; never client-supplied). Room name minted server-side.
- **PD-19** (supersedes PD-2): a family contact who is a member may start a `student_group`, `class_group` or `family_group` call, as well as their 1:1 with their handler. Only live members may start a call (D1).
- **PD-19 amendment:** the super admin may start a `student_group`, `class_group` or `family_group` call in a conversation they may write in without being a member; the server adds them to the call as a participant (`call_participant`), never to the conversation. A direct call between two other people stays `COMM.NOT_CONVERSATION_MEMBER` (two seats). Managers and backups are unchanged.
- Request: `{ conversationId: string }`. Response: `{ callId, roomName }`.
- Errors: matrix codes; `COMM.BR1_TEACHER_PARENT_DIRECT` 403; `COMM.PARENT_CANNOT_START_GROUP_CALL` 403; `COMMON.RATE_LIMITED` 429 (abuse limit, §1.1a).
- **Never a 500 for a refused seat set (2026-10-22).** The call type is decided with the decision: `group` for `student_group`, `class_group`, `family_group`, `trial_group` and `teacher_supervision`, otherwise `direct`. A direct call with more than two seats is refused as `COMM.INVALID_PARTICIPANTS` 403, by `POST /calls` and `GET /conversations/:id/call-capability` alike, before anything is written. Should the BR-1 call triggers (`chat.assert_call_br1`) still refuse the set at commit, the refusal is answered as `COMM.INVALID_PARTICIPANTS`, `COMM.BR1_TEACHER_PARENT_DIRECT` or `COMM.BR1_ADMIN_PRESENCE_REQUIRED` (403), nothing is written, and the API logs it as a defect.
- Audit: `event_log` `call_started`. Realtime: `call.incoming { callId, conversationId, type, initiatorId, initiatorName }` to the conversation room. **`roomName` was removed from this payload 2026-09-24:** the room handle comes back from `POST /calls/:id/token` with the token that makes it usable, so broadcasting it added nothing and put a media handle in a fan-out.

**POST /calls/:id/token** — EXISTS

> **LiveKit (Phase 13).** The room is `jawwid-<conversationId>-<uuid>`, minted by
> `CallService.start` and stored on `chat.call.room_name` (UNIQUE). The client
> never names a room: the endpoint takes only the call id, and the room is read
> from the call row, so both participants are placed in the same server-chosen
> room and two calls in one conversation never share one.
>
> **Grant, in full:** `roomJoin`, `room`, `canPublish`, `canSubscribe`, and
> `roomCreate: false`, `roomList: false`. Nothing else — no `roomAdmin`, no
> `recorder`, no `hidden`, and **no `canPublishData`** (removed 2026-09-24: a
> voice call needs audio, and a data channel would be a second messaging path
> that no Jawwid rule governs). `sub` is the server-resolved actor id.
>
> **TTL** is `chat.config['call.token_ttl_seconds']` (120 s) and nothing else.
> The `LIVEKIT_TOKEN_TTL_SECONDS` environment variable was removed.
>
> **Rooms are created implicitly by LiveKit** on first join and are reaped by
> LiveKit when the last participant leaves; the API never calls LiveKit's
> RoomService and needs no cleanup of its own. A room name is used once because
> it carries a fresh uuid per call.
>
> **Webhooks are not implemented and are not required for media.** They become a
> dependency only for `call.participant_joined` / `participant_left`, which mean
> media presence and are deliberately unemitted until something has observed it
> (Phase 10).
>
> **Not verified:** that LiveKit accepts these tokens. `scripts/infra/livekit-probe.sh`
> asks the real service and needs credentials the repository does not contain.
- Auth: required. Permission: `calls.accept`. Scope: recorded participant, call not ended, still a member, `canCall(intent = join)` re-evaluated — including the BR-1 refusal of a direct teacher–parent call (PD-7; under PD-6 this was the relationship predicate, so a relationship revoked in Jawwid Core refuses the next join even mid-call. This is the JOIN path. Response: `{ token, url, roomName, expiresAt }`; TTL `call.token_ttl_seconds` (120); `canPublish = !isSilent`.
- Errors: `COMM.CALL_NOT_FOUND` 404 · `COMM.CALL_ALREADY_ENDED` 409 · `COMM.CALL_NOT_A_PARTICIPANT` 403 · matrix codes. Audit / Realtime: none.

**POST /calls/:id/accept** — EXISTS · Permission `calls.accept` · Scope: **the full join authorization chain**, identical to `POST /calls/:id/token` — actor active, recorded participant, `left_at` null, call not ended, still a conversation member, communication matrix, C-4, and the **PD-6 relationship re-resolved now** (starting a call does not guarantee it may still be answered). `joinedAt` set; `ringing → active` with `answeredAt`, decided under `SELECT … FOR UPDATE` so concurrent accept/decline/end cannot tear the state. Answering twice is an idempotent no-op. Response `{ ok: true }`. Errors: matrix codes; `COMM.CALL_PARTICIPANT_LEFT` 409; `COMM.CALL_ALREADY_ENDED` 409; `COMM.CALL_ALREADY_DECLINED` 409; `COMM.CALL_NOT_A_PARTICIPANT` 403. **A refused accept writes nothing** — no `joinedAt`, no `answeredAt`, no status change, no event. Realtime: **`call.accepted { callId, conversationId, actorId }`** to `conversation:<id>`. **Changed 2026-09-24:** this used to emit `call.participant_joined` with no `conversationId`, which the outbox could not route and silently discarded. `participant_joined` means MEDIA presence and is emitted only by something that has observed it — `POST /livekit/webhook` and nothing else (§3.9, built 2026-09-27). An HTTP accept does not assert a media connection, and the two facts are stored in different columns: `joined_at` is the accept, `media_joined_at` is the room. Audit: none.

**POST /calls/:id/decline** — EXISTS · Permission `calls.accept` · Scope: the same full join authorization chain as accept, plus the call must still be **ringing**. `leftAt` set, under the same row lock.

**Changed 2026-09-27 (W6): a decline is now the TERMINAL transition.** `ringing → ended` with `outcome = 'declined'`, `duration_seconds = 0`, `answered_at` left null, and the decliner's `leftAt` stamped — all in one transaction with the refusal. It used to mark only the participant and leave the call `ringing`, so the ring-timeout sweep collected it ~45s later and recorded `outcome = 'missed'`: a call the callee had explicitly refused was written into history as one they never saw, `missed_call` then pushed a notification to the person who had just declined, and the `declined` outcome the schema defines was unreachable from this endpoint. The sweep needed no change to respect the new state — it matches `status = 'ringing'`.

The transition is **unconditional** — no participant-count qualifier, and no group-call exception (see the lifecycle block above). Only the decliner's `leftAt` is written; nobody else's is fabricated because the call ended.

Declining again is refused with `COMM.CALL_ALREADY_ENDED` (was `COMM.CALL_PARTICIPANT_LEFT`) and changes nothing. Errors: matrix codes; `COMM.CALL_NOT_RINGING` 409; `COMM.CALL_ALREADY_ENDED` 409; `COMM.CALL_PARTICIPANT_LEFT` 409 (reachable in a concurrent-decline race). Realtime: **`call.declined { callId, conversationId, actorId }`** and, when the call becomes terminal, **`call.ended { callId, conversationId, outcome: 'declined', durationSeconds: 0 }`**, both to `conversation:<id>`, exactly once each. They are enqueued in one transaction and therefore share `created_at`; their relative delivery order is not guaranteed and nothing depends on it. Audit: `event_log` `call_ended` when it terminates.

**POST /calls/:id/end** — EXISTS · Permission `calls.accept` · Scope participant. **No request body.** Call `ended`, all open participants `leftAt`, `durationSeconds` computed. Realtime: `call.ended { callId, conversationId, outcome, durationSeconds }`. Audit: `event_log` `call_ended`.

**Changed 2026-09-27 (W6), twice.** (1) The outcome is no longer a request field. `{ outcome }` used to be forwarded straight into the service, so a participant could POST `{"outcome":"answered"}` for a call nobody answered — false history through the front door — or any other string and turn a check-constraint violation into a 500. It is now derived: ACTIVE ends `answered`, RINGING ends `missed`. **The service takes no `outcome` argument either** — `CallService.end(callId, actorId)` — so there is no parameter for a future caller to rediscover. (2) The derivation reads `answered_at` **through the row lock**, and an already-ended call is a **no-op**. Without the guard, an `end` arriving after any other ending (a decline, the sweep, a second device) overwrote `status`, `ended_at`, `outcome` and `duration_seconds` and enqueued a second `call.ended`. Hanging up twice is a retry: it succeeds and changes nothing. Ending still never fails for authorization reasons, so no call can be stranded ACTIVE.

> **Ring timeout (Phase 11).** A call nobody answers is not left ringing. The
> worker sweeps calls whose `started_at` is older than
> `chat.config['call.ring_timeout_seconds']` (45s) and ends them server-side with
> `outcome: 'missed'`, `durationSeconds: 0`, `answeredAt` null and every
> participant's `joinedAt` still null.
>
> **No new event and no new state.** The terminal event is the same
> `call.ended { callId, conversationId, outcome: 'missed', durationSeconds: 0 }`
> a client already handles; `outcome` is what distinguishes a timeout from an
> answered or declined ending, so nothing needs to learn a second vocabulary. No
> `call.expired` event and no `expired` status exist.
>
> The transition is a single conditional `UPDATE ... WHERE status = 'ringing'`,
> so it is atomic, idempotent, and safe to run on every worker replica at once.
> An expired call cannot then be accepted, declined, or issued a media token.

**POST /livekit/webhook** — EXISTS (added 2026-09-27, `livekit-webhook.controller.ts`)
- Auth: **not a Jawwid session.** LiveKit carries no actor and no bearer of ours; it authenticates with an HS256 JWT signed by the project API secret, whose `sha256` claim is a hash of the RAW body. Verified by `WebhookReceiver` from `livekit-server-sdk` — the official verifier, not a hand-rolled HMAC. `main.ts` sets `rawBody: true` because the hash is over the bytes as they arrived, and `applyInfrastructure` claims `application/webhook+json` (LiveKit's content type) with the raw bytes kept. The controller is `@Public()` to the bearer guard: its authentication is the LiveKit signature (both fixed 2026-10-14 — before, every real delivery was refused; see findings RT-038). **Join-time enforcement (RT-037):** a `participant_joined` for an identity that is no longer live is undone via RoomService.RemoveParticipant; if that fails the webhook answers 503 so LiveKit retries. A participant access token is never accepted here: that is a credential we send a device, this is one LiveKit sends us.
- Events consumed: **`participant_joined` and `participant_left`, and nothing else.** `room_started`, `room_finished`, `track_published`, `track_unpublished`, `participant_connection_aborted` and the egress/ingress family are verified and ignored — W5 establishes presence, and consuming more would be a media-analytics system.
- Room → call: `chat.call.room_name`, which is UNIQUE and server-minted. Never a conversation id, never participant metadata.
- Identity → participant: the LiveKit participant `identity`, which is the actor id the server put in the token (`CallService.issueToken`). Never a display name, never metadata. A non-uuid identity fails closed rather than reaching the database.
- Writes **only** `chat.call_participant.media_joined_at` / `media_left_at`. It never creates a call or a participant, never touches `joined_at` / `left_at` / `answered_at` / `status` / `outcome`, never ends a call, and never authorizes anything.
- **Accepted ≠ in the room.** `joined_at` is the HTTP accept; `media_joined_at` is LiveKit. Emits `call.participant_joined` / `call.participant_left` through the existing outbox, in the same transaction as the write — **never `call.accepted`**, which stays an application act.
- Idempotent and order-independent: earliest join wins, latest leave wins, both from the event's own timestamp rather than arrival time. Duplicate delivery changes nothing and emits nothing; a rejoin newer than a recorded departure clears it.
- A webhook for an ended call is recorded into history and announced to nobody; terminal state never moves backwards.
- Responses: `200 {ok:true}` for every verified event including ignored and no-op ones — LiveKit retries a non-2xx, and a failure code for "already seen" would buy a retry loop. `401` with no body for anything unverified, and nothing is written.

**GET /calls/history** — EXISTS (added 2026-09-28, W8-W2)
- Auth: required. Permission `conversations.read`. **Scope: the conversations this actor may read, and nothing else.**
- **THE SCOPE IS DERIVED, NOT DECLARED.** `CallService.historyForActor` calls `ConversationService.listForActor`, which IS the canonical "conversations this actor may read" surface — family-facing staff are probed through `AuthorizationService.canRead` and then see the conversation set; a contact or a teacher gets live membership and nothing else. Calls follow from that set. There is no second authorization model and no `canRead` reimplementation to drift from the original.
- **IT NEVER QUERIES BY `family_id`, AND THAT IS THE POINT.** A family holds conversations a given parent is **not** a member of — the second parent's 1:1 with an admin, a teacher/admin thread about the learner — so `where family_id = …` (filtered afterwards or not) would hand a parent somebody else's calls. Family membership is not permission to read a family's calls. A regression test pins this: two conversations sharing one `family_id`, the actor a member of only one, and the other's call absent.
- An **inactive** actor is refused (`COMM.ACTOR_INACTIVE`). This mirrors `canRead`'s first check at a new entry point: `listForActor` probes `canRead` for staff but not for a contact or teacher, so without it the account scope would have been weaker than the per-conversation one.
- Request: `?cursor=<opaque>&limit=<n>`. `limit` defaults to 30 and is **clamped server-side** to 100; a client cannot ask for the whole table.
- Response: `{ items: CallHistoryDto[], nextCursor: string | null }`. `nextCursor` is null on the last page.
- **Ordering is the server's**: `started_at desc, id desc`. The id breaks ties so a page boundary cannot repeat or skip a row when two calls share a timestamp.
- **Cursor semantics.** Keyset, base64url, carrying the last row's `started_at` and `id`. It is **not a capability**: the authorized scope is re-derived on every request, so a cursor naming a call the actor may not read yields their own first page. A malformed cursor is treated as no cursor rather than an error.
- Privacy: the rows come from the **same** `toHistoryRow` mapping the per-conversation endpoint uses — one explicit field mapping, so G-07 has one place to be right. No phone number, no `room_name`, no media credential, no column added later that nobody listed.
- Indexes: reuses `call_conversation_idx (conversation_id, started_at)`. **No migration.**
- **This endpoint does NOT grant family-wide access.** See the family-scope note below.

> **FAMILY-SCOPED CALL HISTORY — BLOCKED, AUTHORIZATION CONTRACT REQUIRED.**
>
> PRD v0.1 §9 requires call history *"per conversation and per family"*, and that
> requirement **stands**. It is not cancelled, not descoped, and not satisfied by
> the endpoint above.
>
> It is blocked because **no family-level authorization predicate exists in this
> repository**. Every read rule in `AuthorizationService` takes a *conversation*:
> `canRead(actor, conv, membership)`. The closest rule — *"family-facing staff may
> open any family conversation"* — still requires a conversation, and
> `isFamilyFacingStaff` is a role test, not a family-access decision. There is no
> `canReadFamily`, and no endpoint anywhere serves a family.
>
> **`family_id` alone cannot authorize access.** A parent belongs to a family and
> is a member of only some of its conversations, so treating family membership as
> permission would expose the second parent's calls and teacher/admin calls about
> the learner. That is an authorization expansion, not a query convenience.
>
> The documented family-level consumer is **Family 360** (`screens/family-360.md`
> §1: *admin · coverage · manager*), which is an **Admin Web** surface and is
> outside W8's scope. The rule must be owned by the workstream that defines that
> consumer.
>
> **No family-wide data is exposed by `GET /calls/history`.** W8-W2 implemented
> account scope only and invented no predicate.

**GET /calls/history/:conversationId** — EXISTS → RECONCILE · **Unchanged by W8-W2.** Its `{ calls: … }` envelope and its RECONCILE status are inherited, not endorsed: settling it would change a response shape that W6/W7 already consume, which is a behaviour change inside a closed workstream rather than the additive read capability W8-W2 was authorized to add. The two endpoints are not competing shapes — one is a bounded per-conversation list, the other a paged account list — and the account endpoint above is canonical for account scope. · Permission `conversations.read` · Scope `canRead`. Response today `{ calls: CallHistoryDto[] }` newest first, `take: 100`; Phase 1 `Page<CallHistoryDto>`.

### 3.8a Scheduled calls and call links (`scheduled-call.controller.ts`) — all EXISTS (PD-13)

The full contract, including the DTO, the card payloads, the join window and the error codes, is in `../communication/scheduled-calls.md`. A scheduled call grants nothing. Scheduling uses `CallService.callCapability`. Reading uses `canRead`, with the same 404 for "absent" and "not yours". Joining uses `CallService.start` or `accept`. The frozen call routes above are consumed and not changed. `POST /scheduled-calls/:id/join` shares the call-start budget with `POST /calls` (it starts the call when nobody is in it yet): `COMMON.RATE_LIMITED` 429 (abuse limit, §1.1a).

### 3.8b Stories (`story.controller.ts`, `story.service.ts`) — all EXISTS

Canonical design: `../product/STORIES.md` (§12: the 2026-10-17 owner decisions — no
expiry, no caption, voice, one button, analytics, segment targeting, super admin publishes).

```
StoryFeedItem  { id, kind: 'text'|'image'|'video'|'voice', body: string|null /* text stories only */,
  background: string|null, mediaKind: 'image'|'video'|'audio'|null, mediaUrl: string|null,
  mediaDurationMs: number|null, cta: StoryCtaDto|null, publishedAt,
  expiresAt: string|null /* null since 2026-10-17: does not expire */, viewed: boolean }
StoryCtaDto    { kind: 'whatsapp'|'message_publisher'|'link', label: string|null,
  url: string|null /* built by the server: the link, or https://wa.me/<digits>; null for message_publisher */ }
StoryAdminItem { id, kind, internalName: string|null, title: string|null /* legacy only */, body,
  background, mediaKind, mediaUrl, mediaDurationMs, cta: (StoryCtaDto & { phone: string|null })|null,
  state: 'draft'|'published'|'expired'|'deleted', createdAt, publishedAt: string|null,
  expiresAt: string|null, deletedAt: string|null, createdBy, creatorName,
  audiences: { kind, refId: string|null, filter: SegmentFilter|null }[],
  recipientCount: number, viewCount: number, ctaTapCount: number, ctaTapperCount: number }
StoryViewer    { actorId, displayName, actorKind, viewedAt, ctaTaps: number }
AudienceClause { kind: 'all_families'|'all_teachers'|'assigned_families'|'family'|'teacher'
  |'contact'|'conversation'|'segment', refId?: string|null, filter?: SegmentFilter }
SegmentFilter  { who: 'everyone'|'families'|'teachers', planMonths?: (1|3|6|12)[],
  children?: (1|2|3|4)[] /* 4 = four or more */, countries?: string[] /* ISO alpha-2 */ }
  /* planMonths/children/countries only with who = 'families'; empty = any; dimensions AND */
```

**`internalName` and `cta.phone` never reach a reader.** The feed carries neither, nor a
title; a non-empty `title` on create is refused (`COMM.STORY_CAPTION_NOT_ALLOWED`).

**No route accepts a recipient list.** A client states an AUDIENCE and the server
resolves it, so "may this publisher address an arbitrary person?" is not a check
that can be forgotten — it is unrepresentable. No route accepts an actor id
either: every handler takes the authenticated actor from `@ActorId()`.

**GET /stories/feed** — EXISTS
- Auth: required. Scope: `canReadStories` — any active actor; a contact must hold `can_message`. Returns only stories joined through the caller's own `chat.story_recipient` rows, with `state = 'published' AND (expires_at IS NULL OR expires_at > now()) AND deleted_at IS NULL`. Page size `story.feed_page_size` (50), newest first. `body` is sent for text stories only.
- **There is no `state` or `expired` filter.** A client cannot ask to see expired stories.
- Response: `{ stories: StoryFeedItem[] }`. `mediaUrl` is a link to `GET /media/stories/:id` bound to the reader, minted per request and re-authorized on every use (RT-037); `null` once media is purged. A story that is expired, deleted or purged signs nothing on any surface — `mediaUrl` is `null`, never a URL that would 404 or outlive access.
- Errors: `COMM.STORY_CANNOT_READ` 403 · `COMM.ACTOR_INACTIVE` 403.

**GET /stories?drafts=true|false** — EXISTS
- Auth: required. Scope: `canPublishStory` (admin, coverage, manager, **super_admin** since 2026-10-17) + own organization. `take: 200`, newest created first.
- Response: `{ stories: StoryAdminItem[] }`. Deleted stories are never returned. Expired ones are (this is the reporting surface) but carry `mediaUrl: null`. Errors: `COMM.STORY_CANNOT_PUBLISH` 403.

**POST /stories/media** — EXISTS
- Auth: required. Scope: `canPublishStory`. Request `{ mimeType, byteSize }`. Reuses the attachment object-storage seam with prefix `stories/`; the signature is bound to the MIME type and byte size.
- Accepted: `image/jpeg|png|webp|heic` ≤ 10 MB, `video/mp4|quicktime|webm` ≤ 100 MB, `audio/mp4|mpeg|aac|wav` ≤ 20 MB (voice; webm/ogg refused because iOS cannot play them).
- Response: `UploadAuthorization { objectKey, uploadUrl, method: 'PUT', headers, expiresAt }`.
- Errors: `COMM.ATTACHMENT_TYPE_NOT_ALLOWED` 400 · `COMM.ATTACHMENT_TOO_LARGE` 400 · `COMMON.RATE_LIMITED` 429 (abuse limit, §1.1a) (shares the attachment upload budget).

**POST /stories** — EXISTS
- Auth: required. Scope: `canPublishStory`. Creates a **draft**; the audience is validated against the author's scope but not yet materialised.
- Request `{ body?, internalName?, background?, mediaObjectKey?, mediaKind?: 'image'|'video'|'audio', mediaMime?, mediaDurationMs?, cta?: { kind, label?, url?, phone? }, audiences: AudienceClause[] }`. Idempotency-Key honoured. A text story is `body` (+ `background`, default `teal`); a photo/video/voice story carries **no** body. `cta.phone` accepts common notations and is stored as E.164 digits; `cta.url` must be https.
- Response: `StoryAdminItem`. Audit: `audit_log` `story.created`.
- Errors: `COMM.STORY_EMPTY` 400 · `COMM.STORY_TOO_LONG` 400 · `COMM.STORY_CAPTION_NOT_ALLOWED` 400 · `COMM.STORY_CTA_INVALID` 400 · `COMM.STORY_AUDIENCE_EMPTY` 400 · `COMM.STORY_AUDIENCE_INVALID` 400 · `COMM.ATTACHMENT_TYPE_NOT_ALLOWED` 400.

**GET /stories/:id** — EXISTS (2026-10-17)
- Auth: required. Scope: `canPublishStory` + own organization. Response `StoryAdminItem`. Errors: `COMM.STORY_NOT_FOUND` 404.

**GET /stories/audience/facts** — EXISTS (2026-10-17)
- Auth: required. Scope: `canPublishStory` + own organization. **Counts only.** Response `{ families, contacts, teachers, countries: {code, families}[], plans: {months, families}[], children: {bucket, families}[], unknownCountry, unknownPlan, noChildren }`.

**POST /stories/audience/estimate** — EXISTS (2026-10-17)
- Auth: required. Scope: `canPublishStory`. Request `{ audiences: AudienceClause[], ctaKind?: string|null }`. Runs the same resolution `publish` runs, including the reply scope below. **Counts only.** Response `{ recipients, contacts, teachers, families, excludedByReplyScope }`.

**GET /stories/audience/families?search=&missing=true** · **POST /stories/audience/families/:familyId** — EXISTS (2026-10-17)
- Auth: required. Scope: `canManageStoryAudienceData` — **super_admin and managers only**, own organization. GET lists `{ families: { id, displayName, countryCode, subscriptionPlanMonths, childCount, segmentSource, segmentUpdatedAt }[], truncated }` (≤ 500). POST `{ countryCode?: string|null, subscriptionPlanMonths?: 1|3|6|12|null }` sets them, `segment_source = 'admin'`; audit `family.audience_data_set`. Number of children is derived from `chat.learner`, never stored. These are Jawwid Core's facts; the Core projection will write the same columns.
- Errors: `COMM.STORY_AUDIENCE_DATA_DENIED` 403 · `COMM.STORY_FAMILY_NOT_FOUND` 404 · `COMM.STORY_AUDIENCE_INVALID` 400.

**POST /stories/:id/publish** — EXISTS
- Auth: required. Scope: `canPublishStory`, own organization, and the author, a manager **or the super admin** (an admin may not publish another admin's draft).
- Resolves the audience **again** under the publisher's live scope and writes `chat.story_recipient` in the same transaction as the state change. **`expires_at = NULL`** (2026-10-17: stories do not expire; `story.default_lifetime_hours` is unused).
- **Reply scope.** With `cta.kind = 'message_publisher'`, contacts are kept only when the publisher reaches their family (PD-8 `reachesFamily`; the super admin reaches all); teachers are always kept. The estimate reports how many were left out.
- Response: `StoryAdminItem`. Audit: `audit_log` `story.published` with `recipientCount` / `familyCount`. Realtime: `story.published` to each recipient's actor room; notification `story_published` per recipient.
- Errors: `COMM.STORY_NOT_FOUND` 404 · `COMM.STORY_ALREADY_PUBLISHED` 409 · `COMM.STORY_EXPIRED` 410 · `COMM.STORY_AUDIENCE_EMPTY` 400 · `COMMON.RATE_LIMITED` 429 (abuse limit, §1.1a).

**POST /stories/:id/view** — EXISTS
- Auth: required. Scope: `canReadStories` **and** a `chat.story_recipient` row for the caller — the recipient join is part of the lookup, not a check after it, so a non-recipient gets `STORY_NOT_FOUND` and learns nothing. Expiry is checked against the clock, not the state column. Idempotent (composite PK).
- Response `{ ok: true }`. Errors: `COMM.STORY_NOT_FOUND` 404 · `COMM.STORY_EXPIRED` 410 · `COMM.STORY_DELETED` 410 · `COMM.STORY_NOT_PUBLISHED` 409.

**POST /stories/:id/cta** — EXISTS (2026-10-17)
- Auth: required. Scope: `canReadStories` + a `chat.story_recipient` row for the caller (same lookup as `/view`; every refusal reads as not found). Records a tap in `chat.story_cta_click` (every tap, not idempotent). For `message_publisher` it opens the direct conversation with the publisher through `getOrCreateDirect` (BR-1/PD-8 re-applied) and records the tap only once that succeeds.
- Response `{ kind, url: string|null, conversationId: string|null }`. Errors: `COMM.STORY_NOT_FOUND` 404 · `COMM.STORY_EXPIRED` 410 · `COMM.STORY_DELETED` 410 · `COMM.STORY_NO_CTA` 409 · the direct-conversation codes (e.g. `COMM.STAFF_OUT_OF_SCOPE` 403).

**GET /stories/:id/analytics?tz=<IANA>** — EXISTS (2026-10-17)
- Auth: required. Scope: `canReadStoryViewers` + own organization. Every figure is a query over `story_recipient`, `story_view`, `story_cta_click`. `tz` (validated) decides where a day starts.
- Response `{ storyId, state, publishedAt, reach: {total, contacts, teachers, families}, views: {total, contacts, teachers}, cta: {kind, taps, tappers}, rates: {view, tapOfViews, tapOfReach}, firstViewAt, lastViewAt, daily: {date, views, taps}[] /* ≤ 90 days */, byCountry: {code|null, reach, views, tappers}[] }`. Names nobody.
- Errors: `COMM.STORY_CANNOT_PUBLISH` 403 · `COMM.STORY_NOT_FOUND` 404 · `COMM.STORY_AUDIENCE_INVALID` 400 (unknown time zone).

**GET /stories/:id/viewers** — EXISTS
- Auth: required. Scope: `canReadStoryViewers` (= `canPublishStory`) + own organization. **Deliberately not available to recipients.** `take: 500`, newest first.
- Response `{ viewers: StoryViewer[] }` — display names, times and each viewer's tap count; the `Actor` contract carries no phone or email, so neither can appear.
- Errors: `COMM.STORY_CANNOT_PUBLISH` 403 · `COMM.STORY_NOT_FOUND` 404.

**DELETE /stories/:id?reason=…** — EXISTS
- Auth: required. Scope: `canPublishStory`, own organization, author, manager **or super admin**. Soft delete: access ends immediately, the row survives as the audit trail, media is purged by the retention sweep. Idempotent.
- `reason` is a **query parameter and required** (no default, unlike `DELETE /messages/:id`): an academy publication removed without a stated reason is a gap in the audit trail.
- Response `{ ok: true, alreadyDeleted: boolean }`. Audit: `audit_log` `story.deleted`. Realtime: `story.retired { reason: 'deleted' }`.
- Errors: `COMM.STORY_DELETE_REASON_REQUIRED` 400 · `COMM.STORY_CANNOT_PUBLISH` 403 · `COMM.STORY_NOT_FOUND` 404.

### 3.9 Notifications / Devices (`notification.controller.ts`, `notification.service.ts`)

> **THE VOICE-CALL PUSH CONTRACT (W8-W1, 2026-09-28).**
>
> **Which device receives what.** A VoIP token (iOS PushKit) receives call
> notifications and **nothing else** — on iOS a PushKit delivery that does not
> immediately report a call to CallKit terminates the app, so a stray message
> push there is a crash loop, not an inefficiency. The rule lives in one place,
> `call-push-routing.ts`, and routes on `rule.event_type`:
>
> | destination | receives |
> |---|---|
> | VoIP token (`is_voip = true`) | `call_started`, `group_call_started` only |
> | iOS standard token | everything except those two |
> | Android / web token | everything — FCM has no VoIP channel |
>
> An iPhone holding both tokens gets a call on the VoIP one only, so it rings
> once. An iPhone with no VoIP token yet is not sent a call at all, and the
> notification records `NO_DEVICE_TOKEN`: an incoming-call banner with no
> CallKit screen behind it is the degraded experience the platform rules exist
> to prevent.
>
> **The payload.** `data` carries at most four keys and is BUILT, never copied
> from a row:
>
> ```
> { eventType, notificationId, conversationId?, callId? }
> ```
>
> `callId` appears **only** for `call_started` and `group_call_started`. It is
> there because the native call layer must report a specific call to CallKit and
> later correlate an accept or a decline to it. It is **data-only, never
> rendered, and authorizes nothing**: `POST /calls/:id/accept`, `/decline` and
> `/end` each re-run the full server-side chain, and `POST /calls/:id/token` is
> the only route to media. A call id without a session is useless.
>
> Never present, and structurally unable to be: a LiveKit token, a room name, an
> access token, any media credential, a contact channel (BR-2).
>
> **Transport.** Configured, not compiled — APNs (`@parse/node-apn`) and FCM v1
> (`google-auth-library` + `fetch`) behind the existing `PushProvider` seam, with
> `LoggingPushProvider` as the fallback when nothing is configured. A **half**
> configured provider refuses to start rather than reporting a healthy pipeline
> that delivers nothing. Only Apple's and Google's *permanent* rejection codes
> deactivate a device; a 5xx, a 429 or our own credential failure never does.
>
> **THE iOS VoIP ACTIVATION GATE.** `APNS_VOIP_ENABLED` defaults to **false**,
> and while it is closed no VoIP push is delivered — such a message is reported
> as `VOIP_GATED` and retried rather than recorded as sent. It must not be set
> to `true` until the native CallKit reporting path exists (W8-W3): delivering a
> PushKit push to an app that cannot report a call terminates it and, repeated,
> costs the VoIP entitlement.
>
> **Android is not yet configured.** The channel, the Dart boundary and the
> manifest permission exist; obtaining an FCM token needs a Firebase project
> (`google-services.json` + the Gradle plugin), which is infrastructure
> configuration rather than code. Until then the device reports no token and
> `POST /notifications/devices` is simply never called from Android.
>
> **Push is not the call.** A push wakes the app; the call itself still arrives
> over the realtime connection and the server remains the only authority on its
> lifecycle. Nothing in the push path marks a call ringing, active, answered,
> declined or ended.

**POST /notifications/devices** — EXISTS → RECONCILE
- Auth: required. Permission: `sessions.manage`. Scope: self.
- Request: `{ token: string, platform: string, isVoip?: boolean, locale?: 'ar'|'en' }`. Upsert by `token`: today a token already registered to another actor is **silently re-bound** to the caller ("device handed over"). Phase 1: the token is bound to the authenticated actor **and session** (revoking the session deactivates it); re-binding across actors requires the previous session to be revoked.
- Response: `{ ok: true }`. Idempotent. Audit / Realtime: none.

**DELETE /notifications/devices/:token** — EXISTS
- **Closed 2026-09-24.** Auth required (global guard); Scope: **own tokens only** — the update is `where { token, actorId }` with `actorId` from the verified actor. A token belonging to anyone else, or no token at all, matches nothing and returns `{ ok: true }`: a 404 or 403 would answer "does this token exist?" for an enumerator, and the honest response to deleting something that is not yours is that nothing happened. Idempotent for the owner too. Previously took the token alone, so any authenticated caller who knew one could silence that person's push, including their incoming-call push.
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

### 3.10a Account administration (`account-admin.controller.ts`) — EXISTS (PD-21)

```
AccountSummaryDto { accountId, kind: 'family'|'teacher'|'staff', name, staffRole: string|null,
                    familyName: string|null, children: string[], status: 'provisioned'|'active'|'suspended'|'deactivated',
                    hasLogin: boolean, lockedUntil: string|null, lastLoginAt: string|null,
                    allowed: { resetPassword, suspend, reactivate, impersonate, signOut } }   // advisory; decided again per action
```

Permission (every route): `AuthorizationService.canAdministerAccount`, same organization. PD-40 narrowed it (`apps/api/src/platform/account-admin-policy.ts`). A parent account is administered by the super admin and the Operations department; Sales may reset and sign out only. A teacher account is administered by the super admin and the Teachers department. A staff account is administered only by the super admin, and never the super admin's account or the caller's own. `GET /admin/accounts` lists only the kinds the caller administers and names them in `administers`. A non-staff caller gets `COMM.ACCOUNT_ADMIN_DENIED` 403 before any lookup; another tenant's account is `COMM.ACCOUNT_ADMIN_NOT_FOUND` 404. No route returns a password, a hash, a login identifier or a contact channel.

**GET /admin/accounts** — Query: `q?` (the person's, the family's or a child's name), `kind?` (`family`|`teacher`|`staff`; staff for the super admin only). Response: `{ accounts: AccountSummaryDto[], truncated }`, at most 100, never the caller's own nor the super admin's.

**GET /admin/accounts/:accountId** — Response: `AccountSummaryDto`; an account the caller may not administer is `404`.

**POST /admin/accounts/:accountId/password-reset** — Request: `{ reason: string, signOutEverywhere?: boolean }`. Response: `201 { code, expiresAt, expiresInMinutes, signedOutSessions }` — the plain code exists only in this response. Any earlier live code is superseded. Errors: `COMMON.VALIDATION` 400 (reason) · `COMM.ACCOUNT_ADMIN_STATE` 409 (deactivated) · `COMMON.RATE_LIMITED` 429 (10 codes per account per hour). Audit: `account.password_reset_issued` `{actorId: staff, reason, after:{resetCodeId, expiresAt, signOutEverywhere}}`; `session.revoked` when signing out everywhere.

**POST /admin/accounts/:accountId/suspend** — Request: `{ reason }`. Response: `200 AccountSummaryDto`. One transaction: `chat.deactivate_principal('account', …, 'suspended')` (RT-032 journal), every session revoked, audit `account.suspended` `{before:{status:'active'}, after:{status:'suspended', revokedSessions}}`; then the RT-009 barrier (`COMM.REVOCATION_UNCONFIRMED` 503 → retry; idempotent). Suspending a suspended account changes nothing and writes no audit row. Errors: `COMM.ACCOUNT_ADMIN_STATE` 409 (provisioned / deactivated).

**POST /admin/accounts/:accountId/reactivate** — Request: `{ reason }`. Response: `200 AccountSummaryDto`. `chat.reactivate_account` (suspended → active only); earlier sessions stay revoked. Audit `account.reactivated`. An active account is left alone (no audit row). Errors: `COMM.ACCOUNT_ADMIN_STATE` 409 (deactivated / provisioned).

**PD-23 — an account's sessions.** Permission `canAdministerAccount(…, 'sign_out')` (the suspend rule).
- **GET /admin/accounts/:accountId/sessions** — `{ sessions: SessionDto[] }` (see §3.1a; `current` always false).
- **POST /admin/accounts/:accountId/sessions/:sessionId/revoke** — Request `{ reason }`. `200 { ok: true }`. Reason stored as `signed out by an administrator: <reason>`; audit `session.revoked`. A session not of this account: `COMM.SESSION_NOT_FOUND` 404.
- **POST /admin/accounts/:accountId/sessions/revoke-all** — Request `{ reason }`. `200 { revoked }`. Every session, a support session included (as a suspension does); the account stays active. RT-009 barrier as for suspend.

### 3.10b Support sessions — impersonation (`impersonation.controller.ts`) — EXISTS (PD-21)

```
SupportSessionDto { id, target: { accountId, kind: 'family'|'teacher', name, actorId }, staff: { id, name },
                    reason, startedAt, expiresAt, endsAtLatest, endedAt: string|null, endedReason: string|null, actions: number }
SupportTokenDto   { session: SupportSessionDto, accessToken, expiresInSeconds }   // NO refresh token, ever
```

Every route runs on the **administrator's own** token. Permission: `canAdministerAccount(…, 'impersonate')` — any staff role, a parent or teacher account of the organization, never staff.

**POST /admin/impersonations** — Request `{ accountId, reason }`. Response `201 SupportTokenDto`. The account must be able to sign in (`COMM.ACCOUNT_ADMIN_STATE` 409 otherwise). Ends the administrator's previous live support session (`superseded by a new support session`). Audit `impersonation.started`.

**POST /admin/impersonations/:id/token** — A fresh access token for a live support session of the caller's; extends it by 15 minutes, never past an hour from its start. Audit `impersonation.extended` when it extends. Errors: `COMM.IMPERSONATION_NOT_FOUND` 404 · `COMM.IMPERSONATION_ENDED` 409.

**POST /admin/impersonations/:id/end** — Exit; revokes the support session's session. Idempotent. Audit `impersonation.ended`.

**GET /admin/impersonations** (`?accountId=`) — the record: the super admin's whole organization, anyone else their own; newest first, at most 100. **GET /admin/impersonations/:id/actions** — its trail: `{ session, actions: [{ method, route, status, at }] }` (route templates; never a body).

**On the support token** (the account's own routes, as that person):
- every request re-checks the support session (not ended or expired), the administrator's own session, account and permission — any of them gone ends it (`401`);
- reads are allowed and send no receipt; writes only from the allowlist (`SupportSessionInterceptor`: sending a message, the person's own profile / photos / teacher profile / leave requests, star, delete-for-me, chat preferences) — anything else `COMM.SUPPORT_SESSION_FORBIDDEN` 403;
- every request is recorded in `chat.impersonation_action`; every audit row written carries `impersonation_id`; every message sent carries it and is served with `MessageDto.sentBySupport: true`;
- `POST /auth/refresh` has nothing to present; `POST /auth/logout` is refused; the realtime gateway refuses the token.

### 3.10c Certificates (`certificates.controller.ts`, `certificate.controller.ts`) — EXISTS (PD-41)

Design and the owner's safeguards: `docs/product/pd041-certificates-design.md` (§3 states, §14 safeguards). Every staff route names its PD-40 key (below). The service decides which certificate and which act on the **locked row**, and `chat.guard_appreciation_certificate` decides again and writes the history.

```
CertificateDto (projection 'full': the requester side, an overseer)
  { projection:'full', id, category:'student'|'teacher', type: TypeRef|null, state, stateGroup,
    learner:{id,name}|null, teacher:{id,name}|null, signatoryTeacher:{id,name}|null,
    requestedBy:Person|null, suggestedBy:Person|null,
    title, achievement, achievedOn, grade, printedName, juz, periodStart, periodEnd,
    designerNote, internalNote, publishStory, requestedAt, updatedAt,
    assignedDesigner:Person|null, designStartedAt, returnMessage,
    currentFile: FileRef|null, files: FileRef[], approval:{fileId,by,at}|null,
    sent:{at,by,conversationId}|null, suggestion:{decidedAt,decidedBy,declineReason}|null,
    consent:{kind,method,recordedAt,recordedBy}|null, story:{id,publishedAt,withdrawnAt}|null,
    cancelled:{at,by,reason}|null, actions: Act[], history?: Event[] }
CertificateDto (projection 'design': a Designer) -- an allow-list, nothing else:
  { projection:'design', id, category, type, state, stateGroup, title, achievement, achievedOn, grade,
    printedName, signatoryName, juz, periodStart, periodEnd, designerNote, requesterName, requestedAt,
    assignedDesigner, designStartedAt, returnMessage, currentFile, files, delivered:boolean, actions, history? }
state      proposed | requested | in_design | changes_requested | uploaded | approved | sent | cancelled | declined
stateGroup suggested | pending | in_progress | completed | sent | closed   (the page's lists)
Act        edit | resubmit | cancel | accept | decline | start | return | release | upload | approve
           | redesign | withdraw_approval | send | consent | story          (what THIS caller may do now)
```

| Route | Key | What |
|---|---|---|
| `GET /certificates/access` | view | the caller's per-category capabilities (nav, form, tabs) |
| `GET /certificates/types?category&includeDisabled` | view | active types; `includeDisabled=true` for the super admin |
| `POST /certificates/types` · `POST /certificates/types/:id` | types | add / relabel / enable / disable. Never delete (owner safeguard 6) |
| `GET /certificates?category&status&q&before` | view | 100 a page; `status` is a stateGroup or a state; `nextBefore` pages |
| `GET /certificates/recipients?category&q` | request.student \| request.teacher | the caller's learners (with their teacher), or teachers in scope |
| `POST /certificates` | request.* | `{ category, typeId, learnerId|teacherId, printedName, title?, achievement?, achievedOn?, grade?, juz?, periodStart?, periodEnd?, designerNote?, internalNote?, publishStory?, requestKey, confirmDuplicate? }` → `201 { certificate, replayed }`. Same `requestKey` → the first request. `COMM.CERTIFICATE_DUPLICATE` 409 (same recipient, type, Juz' or period) · `COMM.CERTIFICATE_DUPLICATE_SUSPECTED` 409 (similar in 30 days; resend with `confirmDuplicate`) · `COMM.CERTIFICATE_TYPE_DISABLED` 409 |
| `GET /certificates/:id` | view | the DTO with `history` |
| `POST /certificates/:id/edit` · `/resubmit` | request.* | the requester of record, in `requested` / `changes_requested` |
| `POST /certificates/:id/accept` · `/decline` | request.student | a teacher's suggestion: the learner's assigned supervisor or their active cover only. `accept {typeId, juz?, …}`, `decline {reason ≥10}` |
| `POST /certificates/:id/start` · `/return {message ≥10}` · `/release` | design (release: design \| oversee) | the Designer takes, returns, or lets go |
| `POST /certificates/:id/files/upload {mimeType, byteSize}` | design | a signed PUT into `certificate-uploads/<org>/<id>/` (never served) |
| `POST /certificates/:id/files {objectKey, fileName}` | design | sniffs the bytes, pins a copy, → `uploaded`. Idempotent per upload |
| `GET /certificates/:id/files/:fileId` | view | `{ url, expiresInSeconds }`, a 5-minute signed read |
| `POST /certificates/:id/approve {fileId}` | request.* | the requester approves THIS revision. `COMM.CERTIFICATE_REVISION_CHANGED` 409 · `COMM.CERTIFICATE_SELF_APPROVAL` 403 |
| `POST /certificates/:id/redesign {message}` · `/withdraw-approval {message}` | request.* | back to `in_design`, with the message |
| `GET /certificates/:id/delivery` | deliver | `{ target: { conversationId, type, title, members } \| null }`, the group the server would choose |
| `POST /certificates/:id/send {conversationId}` | deliver | `approved` only (`COMM.CERTIFICATE_NOT_APPROVED` 409). Must echo the target (`COMM.CERTIFICATE_TARGET_CHANGED` 409 with `detail.conversationId`). Repeat → `replayed: true` |
| `POST /certificates/:id/consent` | story | student only. `{ kind:'granted', contactId, method:'in_chat'|'phone'|'in_person'|'written', evidenceMessageId?, note? }` or `{ kind:'withdrawn', note }`. A withdrawal takes a published Story down |
| `POST /certificates/:id/story` | story | `approved`/`sent`, opted in, image file (`COMM.CERTIFICATE_STORY_NEEDS_IMAGE`), student: latest consent granted (`COMM.CERTIFICATE_STORY_CONSENT_MISSING`). Once; repeat → `replayed: true` |
| `POST /certificates/:id/cancel {reason ≥10}` | request.* \| oversee | |
| `GET /learner-certificates?state` · `POST /learner-certificates` | not for staff | the teacher app: own suggestions, and suggesting one (unchanged body). Staff routes `/:id/upload|issue|decline` are **removed**: the Certificates page replaces them |

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
| `conversation.subscribe` | `{ conversationId }` | Authorized (`canRead`, staff scope included); `code` on refusal (`COMM.NOT_CONVERSATION_MEMBER`, `COMM.STAFF_OUT_OF_SCOPE`, `COMM.CONVERSATION_NOT_FOUND`, `COMM.UNKNOWN_ACTOR` — the last is the connect/authenticate race and is the only one worth retrying). |
| `conversation.unsubscribe` | `{ conversationId }` | |
| `typing.start` | `{ conversationId }` | Server-side debounce in Redis BEFORE authorization (`realtime.typing_ttl_seconds` = 8; a "started" at most once per 3 s). PD-37: only a **seated** member, never in a direct teacher↔parent conversation. |
| `typing.stop` | `{ conversationId }` | Same seat rule. |
| `presence.heartbeat` | — | Refreshes the TTL key (`realtime.presence_ttl_seconds` = 45). |
| `message.delivered` | `{ conversationId, upToSeq }` (PD-37) or `{ messageIds: string[] }` | Cursor form: as `POST …/messages/delivered`. Id form: only the caller's own receipts, announces nothing. Ack `{ ok, updated }`. |

**Server → client**

| Event | Payload | Delivered to | Emitted today by |
|---|---|---|---|
| `message.created` | `{ conversationId, messageId, seq, authorKind, authorId, type, visibility, moderation, createdAt }` — a hint, no body. **Deliberately no `authorDisplayName`:** the event does not render a message, it triggers `GET …/messages?after=<seq>`, and the rendered author comes from `MessageDto` on that fetch. Adding the name here would enlarge a push-adjacent payload to answer a question the fetch already answers. | conversation room; **internal notes: staff actor rooms only** | `send` (published), `approve` |
| `message.deleted` | `{ conversationId, messageId, deletedForAll }` | conversation room | `deleteForEveryone` |
| `message.receipt.updated` | — | — | **Deprecated, never emitted** (PD-37 replaced it with `message.status`). |
| `message.status` | `{ conversationId, items: [{ messageId, seq, status }] }` | **the author's sockets only** (delivery-time checks, RT-009) | outbox worker, from `receipts.advanced` (PD-37) |
| `reaction.added` / `reaction.removed` | `{ conversationId, messageId, actorId, emoji }` | conversation room | `react` / `unreact` |
| `typing.started` / `typing.stopped` | `{ conversationId, actorId, displayName }` | **seated members only** (PD-37), excluding sender | gateway (direct emit, not outbox) |
| `presence.changed` | `{ actorId, state: 'online'\|'offline', lastSeenAt }` | actor rooms | **nobody** — declared, never emitted (`PresenceService` only writes Redis keys). Phase 1 decides. |
| `conversation.updated` | `{ conversationId, familyId, state, needsReply, lastActivityAt, handlerId }` | conversation room | `send` (always) |
| `story.published` | `{ storyId, publishedAt, expiresAt, hasMedia, recipientCount }` — a hint; **no title, no body, no media URL** | the resolved audience's actor rooms, one per recipient. Never a broadcast: there is no room meaning "everyone" | `StoryService.publish` via outbox |
| `story.retired` | `{ storyId, reason: 'expired'\|'deleted', at }` | the same actor rooms | `StorySweeper.expireDue`, `StoryService.remove` |
| `conversation.membership_changed` | `{ conversationId, added: string[], removed: string[] }` | conversation room | `setMembership`, `syncStudentGroup`, and (2026-10-14) creation in `getOrCreateDirect` / `ensureStudentGroup` |
| `conversation.added` | `{ conversationId }` — nothing else | **each added member's own actor room** | the worker, from every `conversation.membership_changed` with a non-empty `added` (2026-10-14): the added people are not in the conversation room yet, so this is how their devices learn the conversation exists. |
| `approval.requested` | `{ conversationId, messageId, approvalId, requestedBy }` | **staff actor rooms only** | `send` (pending) |
| `approval.decided` | `{ conversationId, messageId, approvalId, decision, rejectionReason }` | conversation room | `decide` |
| `call.incoming` | `{ callId, conversationId, type, initiatorId, initiatorName }` | conversation room | `start`. **No `roomName`** — removed 2026-09-24; the room handle comes back from `POST /calls/:id/token`. |
| `call.accepted` | `{ callId, conversationId, actorId }` | conversation room | **`accept`** — the HTTP answer, an APPLICATION act. |
| `call.declined` | `{ callId, conversationId, actorId }` | conversation room | `decline` |
| `call.participant_joined` | `{ callId, conversationId, actorId }` | conversation room | **`POST /livekit/webhook` only** (`MediaPresenceService`) — MEDIA presence, something observed in the room. **Never `accept`.** |
| `call.participant_left` | `{ callId, conversationId, actorId }` | conversation room | **`POST /livekit/webhook` only.** Records a departure; does **not** end the call. |
| `call.ended` | `{ callId, conversationId, outcome, durationSeconds }` | conversation room | `end`, the ring-timeout sweep, and `decline` (terminal since 2026-09-27) |
| `notification.created` | `{ notificationId, recipientId, eventType, title, body, conversationId }` | actor room | **nobody** — `in_app` channel is a no-op in `deliver()`. Phase 1 decides. |
| **`session.revoked`** (Phase 1, new) | `{ sessionId }` | actor room, then the session's sockets are disconnected | `DELETE /me/sessions/:id`, refresh-reuse detection |
| **`family.assignment_changed`** (Phase 1, new) | `{ familyId, fromStaffId, toStaffId, at }` | actor rooms of both staff + the family's conversation rooms | `POST /families/:id/assignment` |

Routing rules in the worker: `call.*`, `reaction.*`, `message.deleted`, `conversation.*`, `approval.decided` → conversation room; `message.created` with `visibility: 'internal'` and `approval.requested` → staff member actor rooms; events without `conversationId` are dropped (`default` branch). Guarantees: transactional outbox (`chat.outbox_event`), at-least-once (dedupe on `messageId` / `callId` / `approvalId`), `message.created` carries no body, a pending message emits nothing to the group.

Reconnect: re-subscribe, then (only once rejoined) `GET …/messages?after=<last seq held>` per open conversation until nothing newer returns, re-read the newest page (deletions / reactions / approvals do not move a seq), re-read the list, then `message.delivered` for anything new. A `message.created` for an APPROVED message carries its original (send-time) seq, which may be below the client's watermark: fetch `?after=<seq - 1>`. See `docs/communication/realtime-events.md`.

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
| S-2 | **Routes with no actor at all**: `POST /conversations/student-group/:learnerId/sync`, `DELETE /notifications/devices/:token`, `POST /notifications/:id/delivered`. Anyone can resync any group, silence any device's push, or corrupt delivery metrics. | `conversation.controller.ts#sync`, `notification.controller.ts#unregister`, `#delivered` | Auth required on all three; sync becomes `conversations.manage` (or worker-internal); device / delivered scoped to owner / recipient. **`unregister` closed 2026-09-24** (scoped to the authenticated owner); **`sync` closed 2026-10-12** (actor required; family-scoped, tenant-isolated); `delivered` remains open. | 1 |
| S-3 | `POST /conversations/student-group` performs no actor or permission check (header only used as `addedBy`). | `conversation.controller.ts#studentGroup`, `ensureStudentGroup` | `conversations.manage` + family scope. **Closed 2026-10-12**: staff gate before lookup, owner-or-manager scope, tenant isolation. | 1 |
| S-4 | **RT-011 — unscoped staff lists.** `GET /conversations` returns every conversation (`take: 200`) to any family-facing staff; `GET /approvals/pending` returns every pending approval; `canRead` allows any family-facing staff into any conversation. | `conversation.service.ts#listForActor`; `approval.service.ts#listPending`; `authorization.service.ts#canRead`; `docs/red-team/findings.md` RT-011 | Family scope rule (§3.3) applied to `listForActor`, `listPending`, `canRead` for non-managers; cursor pagination. Lists are built from an authorization-derived filter, never a probe. | 1 |
| S-5 | **RT-012 — receipt roster disclosure.** `MessageDto.receipts` maps every receipt row (`actorId`, `deliveredAt`, `readAt`) to every reader, so a parent learns staff ids and read times. | `dto.ts#toMessageDto`; findings RT-012 | **Closed 2026-10-26 (PD-37):** `receipts` removed from `MessageDto`; the author gets an aggregate `status` over countable readers; the roster is `GET …/messages/:messageId/info`, author or staff only (§3.5). | 1 |
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
2. **Auth endpoints — DONE.** `HttpAuthRepository` (`lib/core/data/http/http_auth_repository.dart`) is the production `AuthRepository`, consuming `POST /auth/login`, `POST /auth/refresh`, `GET /me` and `POST /auth/logout` unchanged. `UnavailableAuthRepository` and `DebugActorHeaderIdentity` are deleted; `Authorization: Bearer` is the only identity mechanism Flutter has. `ErrorMapper` recognises the `AUTH.*` and `COMMON.RATE_LIMITED` codes, and `Retry-After` is carried on `AppError`.

   Four properties are load-bearing and must survive any future change here:

   - **One session authority.** Exactly one `SecureTokenStore`, one `StoredTokenProvider` and one `ApiClient` per session, built in `bootstrap.dart` and shared by every authenticated consumer — realtime and push included, when they arrive. `POST /auth/refresh` rotates and a replayed refresh token revokes every live session on the account, so a second refresher is not a wasted request, it is a sign-out on every device the user owns.
   - **Login and refresh do not use the authenticated client.** They go over `AuthTransport`, which has no 401 interceptor, so `/auth/refresh` cannot re-enter the refresh machinery and await its own future. `/me` and `/auth/logout` go over `ApiClient` precisely *because* it refreshes.
   - **Refresh is single-flight, and replay is capped at one.** A burst of 401s produces one token exchange; an unkeyed POST is never replayed.
   - **Sign-out is bounded.** One logout, at most one refresh, at most one logout retry over `AuthTransport` with the rotated token — so an expired access token cannot leave the rotated session live on the server. Generic replay policy is unchanged.

   Still owed by the server: `GET /me/sessions` and `DELETE /me/sessions/:id` (IDENTITY-MODEL §4). `devices()` and `revokeDevice()` fail explicitly until they exist, and `AuthRepository.sessionRevoked` stays an empty stream until realtime can carry a revocation signal — request-time validation in `AuthService.authenticate` remains authoritative meanwhile.
3. **Reaction DELETE must carry the emoji**: `HttpMessageRepository.removeReaction(messageId, emoji)` (`lib/core/data/http/http_message_repository.dart:131`) calls `DELETE /conversations/:id/messages/:messageId/reactions` with no parameters; send `?emoji=<emoji>` (Phase 1 requires it; today it is ignored).
4. **List shape**: `GET /conversations` moves from `{conversations}` to `{items, nextCursor}`; add cursor paging and `includeArchived` instead of filtering locally.
5. **Members on detail**: `HttpGroupRepository` reads `members[]` from `GET /conversations/:id`; the server does not return it today (RECONCILE §3.4) — no client change, but expect empty members until the server fix. Display names for members remain an open server item (mobile O3).
6. **Realtime**: implement a socket.io client per §4 (default namespace, `auth: { token }`, `conversation.subscribe`, `typing.start/stop`, `message.delivered`, reconnect via `?after=`). `setTyping` stops being a no-op. Listen for `session.revoked` to feed `AuthRepository.sessionRevoked`.
7. **Receipts**: after S-5 lands, `MessageDto.receipts` shrinks to the viewer's own row plus aggregates; `WireMappers.message` must tolerate both shapes during the transition.
