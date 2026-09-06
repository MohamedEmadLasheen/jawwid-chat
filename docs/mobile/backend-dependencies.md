# Mobile → Backend Dependencies (AI #3 → AI #1 / AI #2)

> ## Status update — 2026-09-05, after AI #2 published its contract
>
> **Most of this document is now satisfied.** AI #2 has shipped
> `apps/api/src/communication/contracts/` (`dto.ts`, `events.ts`, `vocab.ts`), the
> `chat.*` schema, and REST controllers for conversations, messages, approvals, calls and
> notifications. `lib/core/data/wire/` maps that contract into the domain models and is
> covered by `test/core/data/wire_mappers_test.dart`.
>
> Specifically resolved:
>
> | Was | Now |
> |---|---|
> | **C6** client idempotency key — "schema addition request" | `message.clientMessageId` exists; re-sending returns the original |
> | **C8** Student Groups — "no entity exists" | `chat.conversation` type `student_group`, with `conversation_member` |
> | **C9** approvals — "no entity exists" | `chat.message_approval` + `moderation` on the message |
> | **C13** call authorization — "no entity exists" | `chat.call` + `POST /calls/:id/token` |
> | **C5** cursor pagination + ordering key | `seq`, with `before`/`after` cursors |
> | **C7** resumable realtime cursor | `after` on the message list; realtime gateway published |
> | **C10** short-lived media URLs | `AttachmentDto.url` documented as signed, never permanent |
> | Phone privacy | DTO mappers enumerate fields explicitly; the chat schema has no phone column |
>
> **Two contract details corrected the client**, and are worth recording because they were
> not what mobile assumed:
>
> 1. `seq` is a **string**, not a number — it is 64-bit and JSON numbers are unsafe at that
>    width. Parsing it as a number would silently round in a long conversation.
> 2. Errors arrive as `{ error: { code, message } }`, not a flat `code`.
>
> **Still outstanding — see §5 below.**

---

**Original request (2026-09-05, before the contract was published).** Retained as the record
of what mobile asked for and why.

---

## 0. Summary of what mobile cannot do without

| # | Capability | Owner | In brief's data model? | Severity |
|---|---|---|---|---|
| C1 | Username/password login, refresh, logout | AI #1 | Not specified | **Blocking** |
| C2 | Authenticated user identity + role (`parent` \| `teacher`) | AI #1 | Partially (`staff.role`, `contact.role_preset`) | **Blocking** |
| C3 | Device/session registration + revocation | AI #1 | No | **Blocking** |
| C4 | Conversation list for the authenticated user | AI #2 | Partially (`thread`) | **Blocking** |
| C5 | Message history with cursor pagination | AI #2 | Partially (`message`) | **Blocking** |
| C6 | Send message with client-supplied idempotency key | AI #2 | **No** — `message` has no client id | **Blocking** |
| C7 | Realtime event stream | AI #2 | No | **Blocking** |
| C8 | Student Groups + membership | AI #2 | **No entity exists** | **Blocking (new entity)** |
| C9 | Message approval lifecycle | AI #2 | **No entity exists** | **Blocking (new entity)** |
| C10 | Media upload + short-lived access URLs | AI #2 | Partially (`attachments jsonb`) | High |
| C11 | Voice note upload + playback | AI #2 | No | High |
| C12 | Push token registration + payload schema | AI #2 | No | High |
| C13 | Call session authorization (LiveKit token) | AI #2 | **No entity exists** | **Blocking (new entity)** |
| C14 | Call history | AI #2 | No | Medium |
| C15 | Read receipts / delivery / typing | AI #2 | No | Medium |
| C16 | Reactions | AI #2 | No | Medium |
| C17 | Per-user pin / mute / archive | AI #2 | No | Low |
| C18 | Search scoped to the caller's authorization | AI #2 | No | Low |

---

## 1. Requests to AI #1 — identity, session, authorization

### C1 · Authentication
MVP is username + password, no public registration, no OTP reset (role assignment §8).
Mobile needs: login, token refresh, logout, and a documented, distinguishable failure for
**account disabled** vs **bad credentials** vs **session revoked** — the app has to react
differently to each (§7, §9).

Required of the response: an access token, a refresh token, and their expiries. Mobile stores
both in platform secure storage and never persists the password.

### C2 · Who am I
A single endpoint returning the authenticated principal: stable id, display name, avatar URL,
**role**, and locale/timezone if the backend holds them.

- The role must be **server-asserted**. Mobile will not trust a locally cached role (§7).
- The brief's model has `staff.role` and `contact.role_preset`, but **no `teacher` actor**.
  `learner.teacher_id` is a bare field with no corresponding principal. **AI #1 must decide how
  a teacher authenticates and what entity represents them.** This is the single largest
  unmodelled dependency in the mobile scope.

### C3 · Device & session registry
Per role assignment §9, mobile registers platform, model, app version, and push token, and must
detect revocation. Needed: register/refresh a device, list the user's active sessions (for the
profile screen), and revoke one.

Revocation must be observable to the client — either a distinguishable auth error on the next
call, or a realtime event. Mobile clears local sensitive state and returns to login on receipt.

### Authorization invariants mobile relies on (enforcement stays server-side)
The app hides forbidden affordances, but treats the backend as the authority (§3, §56). AI #1
must enforce, and reject with a stable machine-readable error code:

1. **No teacher ↔ parent 1:1 conversation may be created**, in either direction.
2. **No teacher ↔ parent 1:1 call may be initiated**, in either direction.
3. A user may read only conversations they are a member of.
4. Group membership is not editable by parent or teacher users (§24).
5. Phone numbers are never returned in any payload reaching a parent or teacher client (§5) —
   this must hold for user, contact, group-member, call-history, and notification payloads.

---

## 2. Requests to AI #2 — communication engine

The canonical location for this is `docs/communication/mobile-contract.md`, which does not yet
exist. Mobile will conform to it once published.

### C4 · Conversation list
Per conversation, mobile renders: id, kind (`jawwid_support` \| `student_group`), title,
avatar, last-message preview + timestamp, unread count, pin/mute/archive flags, and — for
student groups — the associated learner so rows can be grouped under each child (§11).

Two brief-specific constraints that mobile will honour:
- The support thread is **one continuous thread per family** and must keep the same id when
  the handling admin changes (§12). A handler change is a label change, never a new
  conversation.
- The "Handled by …" label is whatever the backend reports; mobile never derives it (D3).

### C5 · Message history — cursor pagination
Mobile requires **cursor-based** pagination (§19) and a **server-authoritative ordering key**
(§18); local timestamps are not sufficient to order across devices. Please expose a monotonic
per-conversation sequence number on each message.

### C6 · Sending — idempotency (design note)
Mobile generates a stable `client_message_id` (UUID v4) **once per composed message** and reuses
it across every retry (§16, §17, §48). The server must treat a repeat of the same
`client_message_id` within a conversation as the **same** message and return the original
rather than creating a duplicate.

The brief's `message` entity has no such column. **This is a schema addition request.**

Mobile never fabricates a delivery state (§16); `sent`/`delivered`/`read` come from the server.
Locally the app may only ever show `queued`, `sending`, or `failed`.

### C7 · Realtime
A single authenticated stream carrying at minimum: message created, message state changed,
approval state changed, reaction changed, typing, conversation updated, membership/system
event, and call signalling.

Critically, mobile must be able to **resynchronise after a reconnect** (§49): the client cannot
assume it received every event while disconnected. Please provide either a resumable cursor on
the stream or a "changes since X" endpoint. Without one, the app has to refetch broadly, which
is exactly the behaviour we want to avoid on low-end devices and slow networks (§47).

### C8 · Student Groups — **new entity**
The official parent ↔ teacher channel (§24). Mobile needs the group, its learner, and its
members with **name, avatar, role only — never phone numbers** (§25).

This entity **does not exist in the brief**, whose model is deliberately one thread per family
with `thread.family_id UNIQUE` and the invariant "cases never create a second thread". A
per-learner group conversation is a genuine addition to the data model, not an extension of the
existing thread. **AI #1 and AI #2 need to agree how it coexists with that invariant.**

### C9 · Message approval — **new entity**
Default MVP policy is approval ON for both teacher and parent messages in student groups
(§26), but the effective policy must come from the backend, per conversation.

Mobile needs, on each message, an approval state of `pending` / `approved` / `rejected`, plus a
rejection reason when present. The sender sees "Pending approval"; the message must **not**
appear delivered to other members while pending, and other members must not receive it.

No approval concept exists in the brief. **Schema and policy request.**

### C10–C11 · Media and voice notes
Upload with progress and retry, returning an id; playback via **short-lived access URLs**,
never permanent public storage URLs (§22). Thumbnails and durations should be server-provided
so low-end clients don't decode media to render a list. Resumable upload is desirable for large
files (§70). Voice notes need a duration and ideally a waveform peak array.

### C12 · Push notifications
Token registration per device, and a **payload schema** carrying only: notification id, type,
and target entity id (§29). Mobile fetches details from the backend after tapping. Explicitly
**not** in the payload: phone numbers, payment details, or message bodies beyond what is needed
for the visible preview.

Types mobile will route on: new message, approval result, class reminder, schedule change,
payment/renewal reminder, incoming call, missed call.

### C13 · Call authorization — **new entity**
Mobile must **never** construct or guess a room name and must never self-authorize (§31, §35).
The flow required is: client asks the backend for a call session against a conversation →
backend authorizes, creates/looks up the room, and returns a **short-lived LiveKit token** plus
the server URL. If authorization fails, mobile shows a safe error and does **not** attempt any
fallback room.

The same applies to joining a group call and to accepting an incoming call.

Calling is absent from the brief entirely. **Product confirmation plus schema needed.**

### C14–C18 · Secondary
Call history (participants, type, duration, outcome, timestamp — **no phone numbers**, §36);
read/delivery receipts and typing (§14); reactions add/change/remove with realtime sync (§21);
per-user pin/mute/archive that must **not** leak across users (§42); and search scoped strictly
to the caller's own authorized conversations — never a parent or teacher directory (§41).

---

## 3. Cross-cutting requirements

**Error contract.** Mobile needs stable, machine-readable error codes — not prose — so it can
distinguish: unauthenticated, session revoked, account disabled, forbidden-by-policy (e.g. a
blocked teacher↔parent action), validation failure, rate limit, and server error. §37 and §55
require distinct user-facing messages per class, and §56 forbids surfacing internal detail.

**No phone numbers, anywhere.** §5 is absolute. Worth a server-side response filter and one of
AI #5's security tests, not just client-side discipline.

**Localisation.** Mobile localises its own chrome, but server-originated strings — system
messages, rejection reasons, top_reason text, reminder bodies — must be localisable too.
Please return either a translated string for the caller's locale, or a message key plus
parameters. Timezone defaults to Cairo (§46).

---

## 4. Open questions — resolved

Questions 1–4 of the original list are answered: `docs/qa/authoritative-scope.md` confirms the
teacher app, Student Groups, approvals and voice calling are all MVP, and AI #2's `vocab.ts`
supplies the teacher actor kind and the group/approval/call entities. Question 5 (design doc
v3) was overtaken by `docs/design/`, which supplies the screen specs mobile needed.

## 5. Still outstanding

These are what mobile is currently blocked on or working around. Each is small.

| # | Need | Owner | Why it matters |
|---|---|---|---|
| O1 | **Unread count per conversation** on `ConversationDto` | AI #2 | The chat list, the tab badge and Parent Home all render it. `GET /conversations/:id/messages/unread` exists but the list would need one call per row — a per-row round trip is exactly the cost the low-end target cannot absorb. |
| O2 | **Last-message preview** on `ConversationDto` | AI #2 | Every chat-list row shows it; without it the list needs a second fetch per conversation. |
| O3 | **Display names for members and authors** | AI #1 / AI #2 | `MessageDto` carries `authorId` but no name; `ConversationMemberDto` carries `actorId` but no name. Mobile renders names and avatars and must never fall back to an id. |
| O4 | **The `handledBy` label** for the Jawwid thread | AI #2 | `parent-home.md` §4 requires the parent's Jawwid contact. Mobile must not derive it; it needs a supplied, already-localised string. |
| O5 | **Auth, session and device endpoints** | AI #1 | C1–C3 are unchanged: login, refresh, logout, `me`, device registration and revocation. The communication engine assumes an actor id already exists. |
| O6 | **Localisation of server-originated strings** | AI #1 / AI #2 | System messages, rejection reasons and reminder bodies must arrive localised or as key+params. Mobile will not compose them. |
| O7 | **Learner reference on a student-group conversation** | AI #2 | `learnerId` is present; mobile also needs the learner's display name to group rows under each child. |

O1 and O2 are the two that shape a screen rather than a field: without them the chat list
cannot be built in one request, and the parent audience's network is the constraint the whole
mobile design is organised around.
