# Phase 4 — Realtime, Media, Offline & Notifications

**STATUS: CANONICAL.** What Phase 4 actually built, what it deliberately did
not, the defects found on the way, and the verification record.

**Closed on 2026-09-07 after a closure audit and a completion pass.** §12 below
records what the audit found still missing, and what closing it required. The
sections before it describe the first pass and are left as written, because a
report that quietly edits its own history is worth less than one that shows the
correction.

Read with `recovery/PHASE-2-REPORT.md`, whose realtime and storage work this
completes without changing.

---

## 1. What already existed

The audit's framing was right: Phase 4 found foundations rather than a blank
page, and most of the value was in finding the places where a foundation was
load-bearing and hollow.

**Correct and reused unchanged.** Socket authentication (the same bearer token
and the same `AuthService` an HTTP request uses); room authorization through
`AuthorizationService.canRead`, with re-validation on the heartbeat (RT-009) and
`revokeLostSubscriptions` for a scope change mid-connection; the handshake race
fix (P2-7); `RelayRealtimePublisher`, which refuses to report success when no
API instance received an event (D-2); the transactional outbox's *enqueue*, in
the same transaction as the domain change; `S3ObjectStorage`'s SigV4 presigning;
`AttachmentService`'s upload authorization and RT-006 conversation-scoped signed
URLs; the notification engine's dedupe-key guarantee, quiet hours, per-
conversation mute, templates and rules; and on the client, `MessageLog`'s
identity-by-client-id and `Outbox`'s per-conversation ordering and backoff.

Two things the audit reported as present were present and **unreachable**:

* **Presence** was written to Redis by every connect and disconnect and read by
  nothing. `presence.changed` was in the event contract and forwarded by the
  mobile client; no code path in the repository ever emitted it. `isOnline` and
  `lastSeen` had no callers.
* **`sqflite` and `path`** had been dependencies since the first commit and
  nothing had ever opened a database. `providers.dart` said so in a comment:
  "overridden once the sqlite layer is wired".

---

## 2. The seven defects found and closed

| # | Defect | Where it came from |
|---|---|---|
| **P4-1** | **The outbox claimed a row by writing its terminal state.** A worker killed between the claim and the publish left a row saying `published` that had been published to nobody — terminal status, stamped `published_at`, nothing anywhere with a reason to look at it again. The event was not delayed; it was gone. `NotificationService.dispatchDue` had the identical shape with `sent`. | The audit named the ordering; reading the crash window showed reordering does not fix it |
| **P4-2** | **Both drains computed backoff from a stale attempt count** — read before the increment — so every retry backed off as though it were one attempt younger than it was. | Rewriting the claim as one `update … returning` |
| **P4-3** | **`KEYS` on two hot paths.** `isOnline` was `KEYS presence:<user>:*` and `whoIsTyping` was `KEYS typing:<conversation>:*`: a full keyspace scan, single-threaded, on the server that also carries the Socket.IO adapter, run whenever anybody opens a conversation. | Reading the realtime services for the presence work |
| **P4-4** | **The offline queue was a `Map` on a screen's notifier.** Riverpod disposes it when the user leaves the conversation, so a message composed offline was discarded by backgrounding the app, opening another chat, or the OS reclaiming memory — after the user had been shown a bubble saying it was queued. | Tracing what "offline" actually meant on the client |
| **P4-5** | **An attachment's object key was not bound to its conversation.** A member of A could attach an object key belonging to B, and because signed read URLs are scoped to the *message's* conversation (RT-006), their own thread would then hand them a signed URL for B's file. A read primitive into a conversation they are not in. | Tracing the attach path back from `signUrlsForMessages` |
| **P4-6** | **Nothing checked what was actually uploaded.** The presigned PUT signs only the host, so "image/png, 40 KB" and a 400 MB binary were the same request; the declared values went to the message row and to every reader. | The same trace |
| **P4-7** | **`conversation.unsubscribe` leaked a typing indicator.** `handleDisconnect` cleared typing; unsubscribe did not, so closing a conversation mid-word left every other participant watching an indicator until the TTL lapsed. | Auditing the gateway's transient state |

---

## 3. The outbox reliability fix (P4-1)

### What was wrong

```
update … set status = 'published', published_at = now()   -- "claim"
await this.publish(…)                                     -- the work
```

This is a correct **mutual exclusion** — two workers never both took the row,
which is what it was written for — and an incorrect **claim**, because the state
it writes says the work is finished. Any death between the two statements
(SIGKILL, OOM, eviction, a dropped connection) produced a row that was both
unpublished and unreachable.

Reordering the statements does not fix it. It trades a lost-event window for an
unbounded-duplicate one: publish, crash before the status write, re-read as
pending, publish again — forever, if the crash is deterministic.

### The lifecycle now

```
pending ───────claim──────► processing      available_at = now + lease
processing ────confirm────► published       terminal; publication HAPPENED
processing ────error──────► pending (backoff) │ failed (attempts exhausted)
processing ────CRASH──────► nothing written
                                │
                                └─► the lease expires, the row is due again,
                                    and the next claim — any worker's — takes it
```

A crash at any instant therefore lands on *already published* or *will be
reclaimed*. There is no state that is both unpublished and unreachable.

Three details carry the correctness:

* **The claim is one `UPDATE … RETURNING` with `FOR UPDATE SKIP LOCKED`.**
  Concurrent workers take disjoint batches, and `attempts` comes back
  post-increment (P4-2).
* **`claimed_by` carries a per-claim fence token.** A worker returning late from
  a slow publish cannot stamp a row another worker has since taken. Not
  `claimed_at`: `timestamptz` is microsecond-precision in PostgreSQL and
  millisecond-precision in JavaScript, so a timestamp fence is truncated on the
  way out and never matches on the way back — every confirm would silently fall
  through to the lease-expired branch.
* **The notification lease is the same shape in `scheduled_at`.** A separate
  `sending` status would have to enter a CHECK that four services and two
  clients read as the delivery-state vocabulary, and `sending` is not a delivery
  state a product surface should render.

### What this guarantee is, and is not

**At-least-once**, and deliberately not called anything stronger. Crashing after
the publish but before the confirm republishes on reclaim, and no arrangement of
a database and a separate message bus removes that window without a distributed
transaction across both. It is paid for on the consumer side, where it is cheap:
realtime fan-out is idempotent by nature, and notifications dedupe on the unique
`dedupe_key`. On the device, the notification's `collapseId` — hashed from that
same dedupe key — makes a redelivery *replace* the notification rather than
appear beside it, so the user does not experience the guarantee as such.

### What cannot be repaired

**Rows lost by the old code are unrecoverable, and the migration does not
pretend otherwise.** The old claim wrote `status` and `published_at` in one
statement, so a crashed row is byte-identical to a genuinely delivered one.
There is no predicate that separates them, and a backfill that guessed would
replay real events at real people — redelivering messages and re-notifying
families about conversations that moved on days ago. The fix is forward-only.

---

## 4. Realtime

**Authentication** is unchanged and was already right: the socket presents the
same bearer access token an HTTP request does, verified by the same
`AuthService`; there is no separate socket identity. A socket's identity is
re-read at most every 30s on the frames that matter, so a revocation, a
suspension or an offboarding takes effect on a connection that is already open.

**Authorization** is per room and server-side. A client never names a room: it
asks to subscribe to a conversation id and the gateway runs the same `canRead`
the REST path uses. Room membership is re-checked on the heartbeat, because
`canRead` catches a revoked session but not a change of *scope* — and scope is
what moves in normal operation, when a family is reassigned or a cover window
ends. Exposure is bounded by the heartbeat interval rather than by the lifetime
of the connection.

**Presence** is now observable. The gateway announces the 0→1 and 1→0
transitions only — a second device or a reconnect is not a presence change — to
the conversations the actor is an active **member** of. Membership, not scope: a
supervisor can read conversations they are not in, and telling every one of
those threads that a supervisor's phone woke up would leak a staff work pattern
and turn one reconnect into a large fan-out.

**Presence and typing** are one sorted set per subject, scored by expiry
(P4-3), with a TTL on the set itself so an abandoned key is released. Expiry is
enforced on read as well as on write, so a connection that vanished cannot keep
somebody online and a client that stopped mid-word cannot leave a permanent
"typing…". Presence is the union of a person's devices: closing one of two
sessions no longer reads as going offline.

**Delivery** is unchanged and correct. `DELIVERED` is asserted by the
recipient's device when it actually holds the message, never inferred by the
sender. **Read updates** are authorized, conversation-scoped, monotonic on both
sides, and duplicate-safe by construction: `updateMany` filters to states
strictly below the target, so a replayed acknowledgement updates nothing and
emits nothing.

**Reconnect** re-authenticates with a token read fresh on every attempt, and
re-subscribes on every `connect` — rooms do not survive a disconnect, so a
client that assumed otherwise would go silent and never say so. A subscribe
*refusal* is a policy answer and stops the retry; a transport failure does not.

---

## 5. Offline

The queue is now three pieces with three jobs.

**`AppDatabase`** — the app's one local database, versioned, with migrations
that are exercised rather than assumed. Deliberately singular: a second database
would give the app two answers to "what is queued" and no way to choose. Tokens
stay in the keychain; this file is ordinary sandbox storage that a rooted device
or a filesystem backup reads.

**`SqliteOutboxStore`** — one row per unacknowledged message, with
`client_message_id` as the **primary key** rather than a surrogate. That is the
idempotency key the server deduplicates on, so the database itself refuses to
hold the same message twice: a double-tapped send cannot become two messages
even if the code above it has a bug. Attempt counts and failure codes persist,
so closing the app is not a way to reset the retry budget — otherwise a
permanently-refused message becomes an infinite retry loop spread across
launches, one attempt each.

**`OutboxCourier`** — application-scoped, restored at startup, draining **every**
conversation. A message queued in one thread is no longer held hostage by which
screen the user has open. The chat screen subscribes to it rather than driving
it, so the two cannot disagree about what a bubble says.

**Interrupted sends.** A row persisted as `sending` means "a request was in
flight and this process never learned how it ended". It restores as `queued` and
re-sends with the same client id. That is the client half of at-least-once; the
server half is the unique index. Neither is sufficient alone, which is exactly
why duplicate prevention may not rest on the client.

**Draining is triggered three ways, redundantly**: startup, connectivity
returning, and the socket connecting. Connectivity reports the radio and not
reachability; the socket is the strongest signal but a build with realtime
disabled never emits it; and startup is the only one that fires for a message
left by a previous run when nothing else will ever change state.

**Sync after reconnect** is unchanged and was already right: `resync()` fetches
from the highest sequence held and **merges** by client id, so a replayed
catch-up reconciles into what is already there rather than duplicating it.

**The queue is cleared when a session ends.** Queued words belong to whoever
composed them, and the next person to sign in on the handset must not send them.

**One honest limitation.** The queue's mutators are synchronous and journal
through a chained future, which preserves write *order* without turning every
call site into an await for a local disk write. A process dying between the
in-memory transition and its journal write restores the **previous** state of
that entry — never a lost entry, because the entry was written when it was
enqueued, and never a duplicate, because the client id is unchanged. The worst
case is one extra attempt.

---

## 6. Media

The storage abstraction was already sound and is extended rather than replaced:
`ObjectStorage` gains `head` and `delete`, and a `verifiesObjects` capability
flag. `S3ObjectStorage` implements all of it against MinIO/S3 with SigV4 and no
AWS SDK.

**The attach path had two holes (P4-5, P4-6).** An upload is presigned: the API
authorizes it and then never sees the bytes or the object again, so everything
the send path knew arrived from the client and the only check was that the
*claims* were on the allowlist. Both are closed on the path every caller takes,
in `MessageService.send`:

* The object key must sit under this conversation's own prefix, and the
  remainder must match the single-segment shape `authorizeUpload` actually mints
  — so `conversations/<id>/../<other>/<key>` is refused too, because some
  storage backends normalise `..` and some do not, and a control whose
  correctness depends on which is deployed is not a control. Thumbnail keys are
  a second key on the same row and are checked identically.
* The object must **exist**, and its real size and recorded content type must
  match what was declared. The allowlist is re-run against the *storage's*
  content type, because comparing the two for equality alone would pass a
  client that declared and uploaded the same forbidden type.

Storage that cannot answer says so, and the service logs that verification was
skipped rather than passing silently — a check that succeeds because the backend
cannot answer reads exactly like a check that succeeded. Only the local
reference signer is in that position; `STORAGE_*` is REQUIRED for staging and
production.

The controller's duplicate of the old check was **removed** rather than updated:
a controller-level copy of a security rule is a second definition to keep in
step with the first.

---

## 7. Notifications

**Real providers.** `FcmPushProvider` (HTTP v1, service-account assertion) and
`ApnsPushProvider` (token-based, ES256), both against `node:crypto` — what is
needed is one signed JWT and one POST, and `firebase-admin` or `apn` would bring
an enormous transitive tree for it. Selected by configuration exactly as object
storage is.

Four details that are silent when wrong, each pinned by a test: APNs signs
ES256 as raw `r||s` and not DER (DER is well-formed, verifies nowhere, and
returns `InvalidProviderToken`, which reads as a wrong *key*); the provider
token is reused, because Apple rate-limits per-request minting in a way that
looks like APNs randomly refusing valid pushes; a VoIP push goes to
`<bundle>.voip` with no `aps.alert`, because on the alert topic it silently
fails to raise CallKit and iOS terminates an app that takes a VoIP push and
reports no call; and `APNS_ENVIRONMENT` is required with no default and is not a
boolean, because a token registered against one gateway is rejected by the other
and `APNS_PRODUCTION=false` has an implicit answer for "unset".

**Routing.** `PlatformRoutingPushProvider` dispatches on the token's own
platform. Sending every token to one provider works with one platform and
misroutes with two — and since this pipeline retires whatever a provider calls
invalid, an APNs token posted to FCM would deactivate every iPhone in the tenant
one push at a time and look like users turning notifications off.

**Preferences.** There were none; quiet hours answer "not now" and mute answers
"not this thread". Five categories, enforced where notifications are
**generated** — a preference the client applies is a display filter, because by
then the phone has buzzed and the lock screen has shown the text. The
rule-to-category mapping is a **column** on `notification_rule`, not a switch in
code, for the same reason the schedules are rows. Absent means enabled: a
missing row meaning "off" would silently send nothing to everybody who has never
opened the settings screen. An uncategorised notification is always sent. A
suppressed one is still a row, with the status the vocabulary already had, so
the dedupe key stays claimed and the decision is on record. The row-level policy
is the narrowest in the schema: your own settings, and nobody else's.

**Grouping.** A thread id per conversation, so ten messages from one parent are
one stack rather than ten entries burying the lock screen — and a collapse id
hashed from the dedupe key (hashed because APNs caps it at 64 bytes and a dedupe
key is an unbounded composite of ids, so only the longer ones would be rejected
and it would look intermittent).

**Mute and calls are kept apart throughout.** Calls are their own category, they
bypass conversation mute, and they are scheduled quiet-hours-exempt. Muting a
conversation says "stop buzzing me about messages in it"; it has never said "and
let a call from my child's teacher fail silently".

**Deep links.** `PushPayload` decides a destination and refuses a malformed id
rather than passing it through — an id from a payload becomes a URL path
segment. `NotificationNavigator` decides *when*: a cold-start tap arrives before
there is a navigator, a session or a router, so it is held and released when the
app is ready; a signed-out tap waits for the session rather than bouncing and
losing the destination; a session ending discards what is held. It holds exactly
one — the last thing the user chose — because a queue would flash the earlier
screens on the way.

**The conversation id in a payload is a destination and never an access.** It
arrived over the network. The route resolves the conversation from the backend,
which runs the same authorization every other read does, so an id this device is
not entitled to fails there with a safe error; nothing is ever rendered from
what the notification said.

---

## 8. Security controls verified

| Area | Control | Evidence |
|---|---|---|
| Realtime | Socket authenticates with the same token and service HTTP uses | `phase4-realtime.spec.ts` |
| Realtime | Non-member, unauthenticated and forged-id joins all refused | `phase4-realtime.spec.ts` (both sides of every rule) |
| Realtime | Access revoked mid-connection removes the socket from the room | `phase4-realtime.spec.ts` |
| Realtime | A non-member cannot announce typing — refused *before* any state is written | `phase4-realtime.spec.ts` |
| Realtime | Internal-note events reach staff rooms only | Phase 2, unchanged |
| Offline | Queued messages cleared when a session ends | `offline_outbox_test.dart` |
| Offline | Idempotency key survives restart; the database refuses a duplicate | `offline_outbox_test.dart` |
| Media | Object key bound to its conversation; traversal and nesting refused | `phase4-attachments.spec.ts` |
| Media | Object must exist and match its declared size and type | `phase4-attachments.spec.ts` |
| Media | Signed URLs are short-lived, per-read, and conversation-scoped (RT-006) | `phase4-attachments.spec.ts` |
| Notifications | Preferences enforced server-side, not on the device | `phase4-notifications.spec.ts` |
| Notifications | Preferences are readable and writable only by their owner (RLS) | migration `20260907140100` |
| Notifications | A dead token is retired; a transient rejection is not | `phase4-notifications.spec.ts` |
| Deep links | A payload names a destination, never an entitlement | `deep_link_test.dart` |

**Logging.** No access token, refresh token, signed URL, push token, message
body or notification title is logged anywhere added in this phase. Provider
errors are reduced to a status and a reason code, because an FCM or APNs
rejection echoes the device token it rejected and a token is a routing
capability. Outbox errors are truncated and carry no payload. `stuckReport()`
returns counts and an age.

**Secrets.** Nothing hardcoded. Every credential is required from the
environment with no fallback, and a missing one is a startup failure rather than
a silent downgrade.

---

## 9. Verification

Run from a **clean `git worktree` at this phase's HEAD**, against a database
built only from the Phase 0–4 migrations — so none of the concurrent Phase 5
agent's uncommitted work is in it.

| Gate | Command | Result |
|---|---|---|
| API typecheck | `npx tsc --noEmit` | PASS |
| API build | `npm run build` | PASS |
| API suite (unit + integration) | `npx jest --runInBand` | **PASS — 686/686, 43 suites** |
| Flutter analyze | `flutter analyze` | PASS (1 pre-existing info on a `docs/` file) |
| Flutter tests | `flutter test` | **PASS — 330/330** (15 skipped: the live-backend suite) |

```
tests run:  1016
passed:     1016
failed:        0
skipped:      15   (test/integration/live_backend_test.dart — needs a running API)
```

**Baseline for comparison.** Before this phase: API 618 (197 unit + 421
integration) with **one failing** — `realtime-delivery.spec.ts`, which built its
own `PrismaService` and so depended on the shell having exported
`DATABASE_URL`; it now sets up its own environment. Flutter 303.

### The reliability tests that matter most

1. **`phase4-outbox-crash-safety.spec.ts` — "a worker that dies between claiming
   and publishing leaves the event recoverable".** The crash is produced by
   making every post-claim write fail at the connection, which leaves the row
   exactly as a SIGKILL leaves it rather than hand-crafting that state. It then
   asserts the row is held for the lease, not taken by a second worker, and
   published on reclaim.
2. **`phase4-outbox-crash-safety.spec.ts` — "a claim is a lease" (notifications).**
   The same shape for the push pipeline.
3. **`offline_outbox_test.dart` — "a message queued while offline is sent after
   the app is killed and reopened".** Against a real SQLite engine; a restart is
   expressed as a second courier over the same database file, which is what a
   relaunch is.
4. **`phase4-attachments.spec.ts` — "REFUSES a key belonging to a conversation
   the sender is not in".** The read primitive, closed.
5. **`phase4-realtime.spec.ts` — "a member whose access is REVOKED is removed
   from the room it already holds".**

---

## 10. Git

| Commit | What |
|---|---|
| `dc57fc5` | `fix(outbox): a worker that dies mid-publish can no longer lose the event` |
| `6dc6ccc` | `feat(realtime): presence that can be observed, and no keyspace scans` |
| `9101bed` | `feat(offline): the send queue survives the app being killed` |
| `f6afd01` | `fix(media): an attachment must be an object this conversation actually holds` |
| `f7f596b` | `feat(notifications): real APNs and FCM, and preferences the server enforces` |
| `1d9abc2` | `feat(notifications): a notification tap reaches the right screen` |
| `a27cdbd` | `test(offline): make the ordering assertion about ordering, not about timing` |

Two migrations: `20260907140000_chat_phase4_outbox_lease`,
`20260907140100_chat_phase4_notification_preferences`. Neither edits an applied
migration; both are additive and forward-only.

**A note on the shared working tree.** A concurrent agent was building Phase 5
in this tree throughout. Its uncommitted work touches four files this phase also
changed (`schema.prisma`, `errors.ts`, `harness.ts`, `communication.module.ts`);
only this phase's hunks were staged, reconstructed onto the committed versions,
and the shared working tree was restored afterwards. Running the suite in the
shared tree shows 30 failures in four suites — all of them that agent's
in-flight work (`stories.publish` absent from its own test's expectation, a call
outcome, an `event_log` CHECK missing `recording_started`). The clean-worktree
run above is the number this report stands behind.

---

## 11. Remaining limitations

Stated plainly. Nothing below is partially wired and reported as done.

### NOT IMPLEMENTED — push on the device

**REASON.** Binding a push plugin needs a Firebase project, an Apple Developer
team with an APNs `.p8` key, and platform configuration files that carry real
project identifiers. None exists in this environment, and fabricating them would
produce a build that looks wired and cannot work — the worst of the available
outcomes.

**WHAT IS REQUIRED.** A Firebase project with `google-services.json` and
`GoogleService-Info.plist`; an Apple Developer team, an APNs key, the Push
Notifications capability, and Background Modes (`remote-notification`, `voip`);
then `firebase_messaging` in `pubspec.yaml`, a POST of the token to
`/notifications/devices` (the endpoint exists), and
`NotificationNavigator.onTapped` bound to the plugin's `getInitialMessage` (cold)
and `onMessageOpenedApp` (warm/background). The server side of all of this is
complete and tested; what is missing is the plugin and the credentials.

### NOT IMPLEMENTED — the mobile attachment upload pipeline

**REASON.** The backend is complete end to end (authorize → upload → verified
attach → signed read) and tested. The client needs a file picker, image
compression and an upload-progress UI, none of which existed; the attach button
still says attachments are not available, which is the honest state.

**WHAT IS REQUIRED.** A picker package, and a client upload flow against the two
endpoints that already exist.

### NOT IMPLEMENTED — signing `content-type` into the presigned PUT

**REASON.** It would make a MIME mismatch impossible rather than merely
detected. It changes the SigV4 signed-header set, which cannot honestly be
verified without a run against real MinIO, and no MinIO is running here. The
detection control (`head` verification) is in place and tested, so a mismatched
object can never be attached to a message — it is unreachable garbage rather
than served content.

**WHAT IS REQUIRED.** Add `content-type` to `X-Amz-SignedHeaders`, then run
`scripts/qa/phase2-smoke` against MinIO.

### NOT IMPLEMENTED — a preferences UI, and a call screen

The preferences API exists (`GET`/`PUT /notifications/preferences`) and neither
client renders it. Call notifications deep-link to the **conversation**, because
there is no call screen; `PushDestination.OpenIncomingCall` names that in one
place so it is visible rather than lost.

### NOT VERIFIED — realtime end to end with a real client

Carried forward from Phase 2 and unchanged: the gateway is exercised directly
and the relay path is unit- and integration-tested, but no test drives a real
Socket.IO client against a running API. `scripts/qa/phase2-smoke` is the nearest
thing and needs a running stack.

### Presence has no consumer on the client

The gateway now emits `presence.changed` and the mobile client forwards it, but
no screen renders an online indicator. The event is real and observable; the UI
for it was not in scope.


---

## 12. Closure audit, and the completion pass

The first pass reported itself complete on the strength of a green suite. A
strict audit against the original requirements found three things that a green
suite could not see, and one requirement that had been read too narrowly.

### F-1 — the notification pipeline had no production caller

`src/worker.ts` ran exactly one loop, `outbox.drain()`. Nothing called
`NotificationService.dispatchDue()`. Notifications were scheduled into
`chat.notification` and never dispatched: **no push would have been sent even
with FCM and APNs fully credentialed.** Every unit was tested; the pipeline was
not connected.

The dispatch loop now exists, added by Phase 5's broadcast commit `55d97af`. It
was deliberately NOT reimplemented — a second loop would give two processes a
claim on the same rows. What Phase 4 owes instead is the coverage whose absence
let the gap survive, and that is `phase4-notification-pipeline.spec.ts`: a real
message walking send → drain → schedule → dispatch → provider, and a parse of
`worker.ts` asserting a real call expression named `dispatchDue`.

**This is a cross-phase dependency and is recorded as one.** Phase 4's
notification delivery is production-reachable *because of* Phase 5's worker.

### F-2 — the deep-link navigator was dead code

`NotificationNavigator` and `PushPayload` were correct, tested, and instantiated
by nothing but their own test. There was no path from a notification to them, so
tapping one did what it did before any of it existed.

Closed by `startNotifications`, which reuses the existing router, navigator,
authentication state and route authorization. Warm and background taps arrive on
a stream; the cold-start tap is asked for and held until authentication
resolves; sign-out retires the device token and discards any held destination.

`notification_activation_test.dart` drives the real activation against a real
router and asserts the router's LOCATION changes. That guard earns its place:
the wiring was deleted once during this pass by a concurrent agent unwinding an
accidental sweep, and nothing failed.

### F-3 — duplicate connection prevention did not hold

`connect()` guarded on `_socket != null` and then awaited the token read before
assigning it. The audit measured the race directly: two concurrent callers both
passed the guard. `MessagesController._attachRealtime()` calls `connect()` once
per chat screen, so two conversations opened inside the keychain read window
produced two sockets, the first orphaned — still connected, still receiving,
unreferenced.

Callers now share one in-flight future, and a generation counter stops a
superseded attempt from installing a socket after a `disconnect()`.

### Mobile attachments — the requirement read too narrowly

The first pass treated the backend as the deliverable and deferred the client.
The canonical phase map has no Phase 4 at all, so the brief governs, and it
states the verification as `select attachment → upload → …`. "Select" is a
client action. The audit's conclusion was that this was **incomplete**, and it
was right.

The client now picks, validates, uploads and sends, and renders received
attachments. The ordering matters and is the design: **the bytes reach object
storage before the message is queued.** The outbox can persist a few hundred
bytes of metadata across a restart; it cannot persist a 100 MB video. The
consequence is stated rather than hidden — an attachment cannot be composed
offline, and the user is told the upload failed and offered a retry instead of
being shown a queued bubble for bytes that never left the device.

### Verification after the completion pass

Clean worktree at this phase's HEAD, database built from the migration set at
that commit.

| Gate | Result |
|---|---|
| API typecheck / build | PASS |
| API suite | **876/876, 54 suites** |
| Flutter analyze | PASS (1 pre-existing info on a `docs/` file) |
| Flutter tests | **395/395** (15 skipped: the live-backend suite) |

The API total includes Phase 5's suites, because Phase 4's completion now sits
on top of Phase 5's commits and its own pipeline test depends on Phase 5's
worker. All six Phase 4 suites pass.

### What is still not true

* **Push does not reach a device.** All application code exists — providers,
  routing, registration, taps, platform permissions and intent filters. What is
  missing is a Firebase project (`google-services.json`,
  `GoogleService-Info.plist`), an Apple Developer team, an APNs `.p8` key and
  the `aps-environment` entitlement. This is an EXTERNAL blocker, not missing
  code, and the build degrades to no push rather than failing to launch.
* **No test drives a real socket, or a real MinIO, end to end.** Each half is
  tested against the other's contract; nothing exercises both at once.
  Carried forward from Phase 2.
* **Attachments cannot be composed offline**, by design, as above.
* **Thumbnails are not generated.** The schema and the signing path carry them;
  nothing produces one. Images render from the full object, which is correct
  and heavier than it needs to be on a slow connection.
* **No preferences UI** in either client; the API exists.
* **Calls deep-link to the conversation**, because there is no call screen.
