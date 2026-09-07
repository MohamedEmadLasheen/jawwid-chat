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

### Attachments and storage

`S3ObjectStorage` — SigV4 presigning against `node:crypto`, no AWS SDK — behind
the existing `ObjectStorage` interface, chosen by configuration. This is the
item architecture §2.5 assigns to Phase 2, and it was a real gap: `STORAGE_*`
is REQUIRED for staging and production, `docker-compose` provisions a private
MinIO bucket, and the local signer produced URLs for a path this API does not
serve — so an authorized upload could not have been uploaded in a deployment.
The other half of that section, object-level authorization on
`signUrlsForMessages` (RT-006), was already in place.

The mobile **attach button** is the affordance the phase scope supports: the
phase map gives this client the realtime client, and assigns a picker and an
upload pipeline to no phase at all. It is rendered, reachable, enabled and
honest — it says attachments are not available yet, and carries a semantic
label and hint.

### Realtime

`message.updated` added. Receipt transitions now emit
`message.receipt.updated` in the same transaction that moves them — they moved
silently before, so a sender's ticks only advanced on a refetch. Every
message-scoped event now inherits its message's audience; they used to
broadcast to the whole conversation room, which leaked internal-note metadata
to contacts. Typing is cleared on disconnect, and a subscriber is told who is
already typing.

### Mobile (Flutter — the Family and Teacher client)

Real authentication against the Phase 1 contract; a Socket.IO client; delivery
acknowledgement, read cursors and status ticks; long-press actions with
reactions, edit, forward, copy and both deletions; typing indicators; the
unread divider; conversation and message search with sender and date filters;
graceful quote degradation; an attach affordance that says attachments are not
available yet.

### Admin Web (React — the Supervisor/Admin client)

The Communication Operations Console: a conversation queue (needs reply /
waiting on family) beside a conversation view carrying the same message surface
the mobile client has — send, reply with a server-resolved quote, edit, both
deletions, reactions, forwarding, search, typing, unread and receipts.

It replaced a client that shared ZERO endpoints with the API and eleven
realtime event names of which two matched and neither payload did. What
changed: the CRM endpoint surface for `/conversations`; the `/staff` namespace
and `withCredentials` for the default namespace, the same bearer token HTTP
uses, and an explicit `conversation.subscribe`; the bilingual error body for
the API's `{error:{code,message}}`; and `/me/duty` for nothing, because who is
responsible arrives per conversation as `handlerId`.

**One messaging core, two clients.** Both call the same routes, hold the same
DTOs, obey the same authorization, consume the same realtime events, and share
the same status and deletion semantics. There is no second messaging model.

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

| P2-8 | The mobile attach affordance was never rendered: `ChatScreen` passed no `onAttach`, so the composer's button was permanently absent. "Attach buttons" is a named Phase 2 UX item. | The post-implementation audit |
| P2-9 | Search by sender and by date were implemented in the API and in the repository, tested, and exposed by NEITHER client. | The post-implementation audit |
| P2-10 | A message arriving while the conversation was open and the reader was at the bottom never advanced the read cursor, so an actively-watched conversation accumulated a phantom unread badge. | The post-implementation audit |
| P2-11 | Admin Web's `StaffRole` included `system`, which is an actor kind. `chat.staff.role`'s CHECK admits four values and does not include it, so every branch testing for it was dead. | The post-implementation audit |
| P2-12 | **No S3/MinIO object storage.** `STORAGE_*` is REQUIRED for staging and production and `docker-compose` provisions a private bucket, but the wired implementation was the local reference signer, which produces URLs for a path this API does not serve. An upload authorized in a deployed environment could not have been uploaded. Its own class comment said so. | The attach-button closure |

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

Every command below was run from a clean working tree against a migrated
database, the API and the outbox worker.

| Gate | Command | Result |
|---|---|---|
| API typecheck | `npm run typecheck` | PASS |
| API build | `npm run build` | PASS |
| API suite (Phase 2 scope) | `npx jest --runInBand --testPathIgnorePatterns phase3` | PASS — **517/517**, 29 suites |
| API suite (whole tree today) | `npx jest --runInBand` | PASS — 531/531, 31 suites |
| Admin Web typecheck | `npm run typecheck` | PASS |
| Admin Web tests | `npx vitest run` | PASS — 87/87 (76 before) |
| Admin Web build | `npm run build` | PASS |
| Flutter analyze | `flutter analyze` | PASS — 1 pre-existing lint on a `docs/` file |
| Flutter tests | `flutter test` | PASS — 303/303 (224 before Phase 2) |
| Live smoke, all four scripts | `scripts/qa/phase2-smoke/run.sh` | PASS — **76/76** |
| Flutter against the live API | `flutter test test/integration/live_backend_test.dart` | PASS — 15/15 |

**Two API numbers, and why.** A concurrent agent began Phase 3 in this working
tree while the audit ran; its specs are now in `apps/api/test`. `517` is the
Phase 2 scope with those excluded, and is the number this report stands behind.
`531` is what the tree currently runs. Neither is padded: the Phase 3 specs are
somebody else's work and are named as such.

**A correction carried from the previous report.** It reported `505/505` while
also reporting `308/320` integration, reconciling the two by counting a
docker-path run of `schema-invariants` as if it belonged to the same
invocation. It did not: those 12 were failing in the command as given. The
cause was environmental — the suite shells out to `psql`, absent on the
development host — and installing it (`brew install libpq`) makes the single
command pass with no caveat. CI already installed `postgresql-client` for the
same reason. Counting a test as PASS because a different invocation could run
it was the wrong call.

The 35-step Family <-> Supervisor acceptance scenario runs as a test:
`apps/api/test/integration/phase2-acceptance.spec.ts`.

### Verification levels, stated precisely

| Level | What it means here | Where |
|---|---|---|
| Unit tested | Pure logic, no I/O | 197 API unit, 87 Admin Web, most Flutter |
| Integration tested | Real services against the real migrated database | 320 API integration |
| Live transport tested | The running API, guard, route table, filter, socket, worker | `phase2-smoke` HTTP + realtime |
| Client live tested | A real client's own transport modules against that running stack | Flutter `live_backend_test` (15); Admin Web's `core/api/conversations.ts` in `bidirectional.mjs` |
| **Browser E2E tested** | **Nothing.** No browser drove the console's React tree | — |

That last row is the honest one: the Admin Web console has no browser E2E
coverage in this repository, and its React rendering is verified by unit tests
and by its transport module, not by a browser.

### Which clients actually participated

| Direction | Family side | Supervisor side |
|---|---|---|
| Family -> Supervisor | Flutter `HttpMessageRepository` + `SocketIoRealtimeClient` | Socket.IO client on the canonical events |
| Supervisor -> Family | Flutter client on a real socket | **the Admin Web console's own endpoint module** (`core/api/conversations.ts`) |

The supervisor direction drives the console's real path and body construction
rather than a script's idea of it, so a route the console gets wrong fails in
the smoke instead of in a browser. What it does NOT do is drive the console's
React tree in a browser; that is stated as a limitation below rather than
described as an end-to-end UI test.

## 6. What Phase 2 did NOT do

* **The console's React tree is not exercised in a browser.** Its logic is
  covered by 87 unit tests and its contract by the live smoke; there is no
  Playwright/Cypress layer in this repository to add a UI run to.
* **Media forwarding.** Attachments are objects in storage with their own
  scoped URLs; copying the row would point a new audience at an object they
  were never authorized for. Text only, refused explicitly by the API.
* **The mobile attach PIPELINE** — file picker, upload progress, attachment
  rendering. The phase map assigns this client the realtime client and assigns
  a picker to no phase; the server half that Phase 2 does name (real object
  storage, object-level authorization) is built and verified end to end. The
  button is the entry point, and says attachments are not available yet.
* **The console's frozen CRM features** (inbox, families, tasks, coverage,
  dashboard, cases) stay on disk, unrouted, per
  `PHASE-0-ADMIN-WEB-RECONCILIATION` §2.7. They are deleted with a later phase.
* **The console's family directory, staff picker and supervisor assignment**
  are unbuilt because the API serves no route for them (that document marks
  them CONTRACT, not EXISTS). Approving a held message is likewise not
  surfaced yet, though `/approvals/*` exists — it is queue work rather than
  messaging.
* **A plain `admin` still needs an on-duty coverage window** to reply to a
  family. Phase 1 behaviour, unchanged here; it is why the live smoke uses a
  manager as the supervisor.
* **Search is Phase 3 in this repository's own phase map**
  (`product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` §5). Built because the Phase 2
  execution brief required it; the divergence is recorded rather than absorbed.

## 7. Role semantics for messaging

| Role | May message a family | Scope | Notes |
|---|---|---|---|
| `admin` | yes, when on duty for it | families assigned to them | The coverage engine decides "on duty"; without a shift, `COMM.NOT_ON_DUTY` |
| `coverage_admin` | yes, when on duty | families with a live temporary assignment | Same rule, different assignment kind |
| `manager` | yes, any time | the whole organization | Also holds `messages.delete` and `messages.moderate` |
| `super_admin` | yes, any time | the whole organization | Manager plus user management |
| departmental staff | never | none | A department is an attribute, not a role (PD-5); no console area at all |
| family contact | yes, to their own conversations | their family | `can_message` must be set |
| teacher | yes, in the student group and to staff | families of learners they teach | Never a 1:1 with a parent (BR-1) |

`system` is an ACTOR KIND and never a staff role. It was in Admin Web's
`StaffRole` union and was removed in this phase: `chat.staff.role`'s CHECK
admits four values and does not include it.

## 8. The audit that produced this document

The first Phase 2 report declared the phase COMPLETE and excluded Admin Web.
That exclusion was wrong — three canonical documents name the Admin Web rework
as Phase 2 work — and it was reached after implementation, on the grounds that
the work was large. The audit that followed found seven further gaps; all are
listed in §3 and all are closed.

The lesson worth recording: a scope exclusion decided AFTER the work, and not
traceable to a document written BEFORE it, is a rationalisation. The phase map
existed the whole time.
