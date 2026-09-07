# Phase 2 — Core WhatsApp-like Messaging

**STATUS: CANONICAL.** What Phase 2 built, what it deliberately did not, the
defects found on the way, and the verification record.

Read with `recovery/PHASE-1-REPORT.md`, which this builds on without changing.

---

## 1. What already existed

Phase 2 found far more in place than the phase brief assumed, and most of the
work was connecting it rather than writing it.

**The data model was almost complete.** `chat.message` already carried `seq`,
`reply_to_message_id`, `client_message_id` and the soft-delete columns;
`chat.message_reaction`, `chat.message_receipt`, `chat.message_hidden_for` and
`chat.conversation_participant_state` all existed with the right shapes. The
per-user hide was already a separate table rather than a misuse of
`deleted_at`, which is the single most common way this feature goes wrong.

**The engine was real.** `MessageService.send` already assigned `seq` under a
row lock, enforced idempotency on `client_message_id` through a unique index,
wrote receipts, and enqueued to a transactional outbox. `AuthorizationService`
already answered `canRead` / `canSend` / `canOpenDirect` with scope, and the
realtime gateway already authenticated its handshake with the same bearer token
HTTP uses.

**The mobile client's hard parts were done and disconnected.** `MessageLog`
deduped by client id and sorted by the server's `seq`; `Outbox` preserved
per-conversation order with backoff and reused the client id across retries;
`ChatScreen` used a reversed list so pagination preserved scroll for free. None
of it was reachable, because the app had no session and no socket:
`UnavailableAuthRepository` failed every auth call by design, and
`lib/core/realtime/` was an empty directory.

## 2. What Phase 2 added

### Database — `20260907110000_chat_phase2_messaging.sql`

| Object | Why |
|---|---|
| `chat.message.edited_at` / `edited_by` / `edit_count` | An edit is a stamped event, not a silent overwrite |
| `chat.message_revision` | Append-only history of superseded bodies, enforced by trigger |
| `chat.message.forwarded_from_message_id` / `_conversation_id` | Provenance for audit; never served to a client |
| `chat.forbid_message_rewrite()` narrowed | A body may change ONLY with an edit stamp; identity columns still immutable; a withdrawn message can never be restored |
| `message_body_search_idx` (partial GIN, `simple`) | Search is an index scan, and withdrawn/pending messages are not even candidates |
| `message_author_created_idx`, `message_conversation_created_idx`, `message_reply_to_idx`, `message_receipt_message_idx`, `message_hidden_for_actor_idx` | Each supports a query the engine actually issues |
| `message_reaction_emoji_length` | Bounds what the column can hold if the service is bypassed |
| Config: edit window, search page cap, forward target cap, message max length | No number is compiled into a service |

The text index uses the `simple` configuration deliberately: Postgres ships no
Arabic stemmer, and `english` would stem Arabic as though it were English —
worse than not stemming at all.

### API

**New:** `PATCH /conversations/:c/messages/:m` (edit) ·
`GET …/messages/:m/revisions` · `POST …/messages/:m/forward` ·
`POST …/messages/:m/me/restore` · `GET /search/messages` ·
`GET /conversations/:c/messages/search` · `GET /conversations/search`

**Changed:** `GET /conversations` and `GET /conversations/:id` now carry the
unread count, the last readable message, per-viewer pin/mute/archive state and
resolved member names. Every message route asserts the message is in the
conversation its path names. `MessageDto` gained `replyPreview`, `editedAt`,
`editCount` and `isForwarded`.

### Realtime

`message.updated` added. Receipt transitions now emit
`message.receipt.updated` in the same transaction that moves them — they moved
silently before, so a sender's ticks only advanced on a refetch. Every
message-scoped event now inherits its message's audience; they used to
broadcast to the whole conversation room, which leaked internal-note metadata
to contacts. Typing is cleared on disconnect, and a subscriber is told who is
already typing.

### Mobile

Real authentication against the Phase 1 contract; a Socket.IO client; delivery
acknowledgement, read cursors and status ticks; long-press actions with
reactions, edit, forward, copy and both deletions; typing indicators; the
unread divider; conversation and message search; graceful quote degradation.

## 3. Defects found and closed

| # | Defect | Where it came from |
|---|---|---|
| P2-1 | A reply could target a message the replier **could not see** — same conversation was checked, visibility was not. A contact who learned an internal note's id could have its text rendered as a quote above their own message. | Reading `validateReplyTarget` |
| P2-2 | Receipt transitions emitted no event. Status was correct in the database and invisible on screen. | Tracing the ticks back from the UI |
| P2-3 | `message.deleted`, `message.receipt.updated` and the reaction events broadcast to the conversation room regardless of the message's visibility, leaking internal-note ids and read times to contacts. | Auditing the outbox worker's audience rules |
| P2-4 | Message routes did not assert the message belonged to the conversation in the path, so a readable conversation could wrap operations on messages elsewhere. | Auditing the new routes |
| P2-5 | `GET /conversations/:id` carried no unread count, so a client opening from a notification could never place the unread divider. | Reading the client path back |
| P2-6 | A reaction event triggered a refetch of the newest page — which cannot update a reaction on an older message, and is a request per reaction. | Reading the client path back |
| P2-7 | **The socket handshake race.** `handleConnection` was async; Socket.IO does not await it. A client subscribing on `connect` — which a correct client must, since rooms do not survive a reconnect — could be refused `COMM.UNKNOWN_ACTOR`. Indistinguishable from an authorization failure, so a correct client stops retrying and the conversation silently goes dead. | **Driving a real socket.** No service-level test could have found it |

P2-7 is why `scripts/qa/phase2-smoke/` is now in the repository: it exercises
the running system — the global guard, the route table, the error filter, a
real handshake, and the worker delivering across processes — and that is the
gap the defect lived in.

## 4. Security

Authorization is unchanged from Phase 1 and reused, never re-implemented.

* **Scope by construction.** Search builds its candidate set from the same
  `ScopeService` predicate the chat list uses, so an out-of-scope message is
  never a row rather than a filtered one — a search that filtered afterwards
  leaks through its result count and its timing.
* **Forwarding is two authorizations.** The source is read-authorized, and each
  destination goes through the ordinary send path, so forwarding can never
  reach a conversation an ordinary message could not, and cannot be used as a
  read primitive.
* **Editing is not moderation.** Only the author, inside a window — not a
  manager. Putting different words under somebody's name is a different and
  worse act than removing what they said, which is what `messages.delete` is
  for.
* **Deletion is two decisions**, `canDeleteForEveryone` and `canDeleteForMe`,
  named separately in `AuthorizationService` so they cannot be confused at a
  call site.
* **Quotes degrade rather than leak**: deleted, restricted, hidden-for-this-
  reader and missing targets all render without their text.
* **Provenance is a boolean.** A forwarded message says it was forwarded and
  never where from; the source conversation is usually one the reader cannot
  access.

## 5. Verification

| Gate | Result |
|---|---|
| API typecheck | PASS |
| API build | PASS |
| API unit | PASS — 169/169 |
| API integration | PASS — 324/336; the 12 are `schema-invariants`, which shells to `psql`, absent on the dev host. 12/12 via its docker path |
| Live HTTP smoke | PASS — 30/30 against the running API |
| Live realtime smoke | PASS — 11/11 over a real socket, with the outbox worker |
| Flutter analyze | PASS — one pre-existing lint on a file under `docs/` |
| Flutter test | PASS — 291/291 (224 before Phase 2) |
| Release gates G-18, G-19, G-20, G-31..35, JC-011 | PASS |

The 35-step Family ↔ Supervisor acceptance scenario runs as a test:
`apps/api/test/integration/phase2-acceptance.spec.ts`.

## 6. What Phase 2 did NOT do

* **Admin Web is not reworked.** It is built against a different, unimplemented
  operations contract (`/families/:id/messages`, `/inbox`, `/tasks`,
  `/coverage`, a `/staff` socket namespace). Bridging it onto the canonical
  conversation API is an app-sized piece of work, and doing it inside this
  phase would have been a rewrite disguised as an integration. The
  Supervisor/Admin side is verified through the API and realtime, not through
  that console.
* **Media forwarding.** Attachments are objects in storage with their own
  scoped URLs; copying the row would point a new audience at an object they
  were never authorized for. Text only, refused explicitly.
* **A plain `admin` still needs an on-duty coverage window** to reply to a
  family. That is Phase 1 / coverage-engine behaviour, unchanged here, and it
  is why the live smoke uses a manager as the supervisor.
* **Search is Phase 3 in this repository's own phase map**
  (`product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` §5). It was built because the
  Phase 2 execution brief required it; the divergence is recorded here rather
  than silently absorbed.
