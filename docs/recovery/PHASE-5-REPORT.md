# Phase 5 — Voice Calls, Recording, Stories & Broadcast

**STATUS: CANONICAL.** What Phase 5 actually built, what it deliberately did
not, the defects found on the way, and the verification record.

Read with `recovery/PHASE-4-REPORT.md`, whose outbox lease and notification
engine this phase reuses without changing.

---

## 1. What already existed

Phase 5 found a real calling foundation and two blank pages.

**Correct and reused unchanged.** `CallService.start` deriving the participant
set from conversation membership rather than from the client; the server-minted
room name; `LiveKitTokenIssuer`, which signs a real HS256 LiveKit access token
scoped to one room, one identity and a short window; `AuthorizationService.canCall`
running the *same* checks as the message path (so BR-1 and C-4 hold for calling
by construction) with the PD-2 initiate/join split; the `chat.call_participant`
BR-1 trigger; the transactional outbox and its Phase 4 lease; the notification
engine's dedupe-key guarantee, quiet hours and the `respectQuietHours: false`
carve-out that stops a conversation mute silencing an incoming call; the
`ReminderService` rules-as-data engine; the `ObjectStorage` seam and its signed,
expiring URLs; and `ScopeService`, which is what makes "which families" a live
question on every request.

**Present and unreachable.** `call.ring_timeout_seconds` had been a config row
since Phase 2 and **nothing read it**. A call to a recipient who was offline
rang in the database forever: never answered, never missed, never ended, and
permanently `ringing` in call history. `broadcasts.send` had been a permission
key since Phase 1 and nothing implemented the feature it names.

**Genuinely absent.** Recording (deliberately — `20260905093000` says so in a
comment). Stories, in every layer. Broadcast, in every layer. And the entire
Flutter calling surface: `lib/features/calls/` existed as an empty directory.

### Reconciliation table

| Requirement | Before Phase 5 |
|---|---|
| Call tables, participants, BR-1 trigger | **EXISTS** |
| Call authorization, LiveKit token minting | **EXISTS** |
| Incoming-call notification, quiet-hours exemption | **EXISTS** |
| Call lifecycle state machine | **BROKEN** — no declared transitions; see §2 |
| Missed calls | **MISSING** — the config row was read by nothing |
| Participant-level state | **MISSING** — a refusal was indistinguishable from a hang-up |
| Class calls, the predefined message, reminders | **MISSING** |
| Call recording (storage, authorization, retention, playback, audit) | **MISSING** |
| Stories (schema, audiences, publishing, visibility, views) | **MISSING** |
| Broadcast (audiences, queue, fan-out, retry, dedupe, tracking) | **MISSING** |
| Flutter calling UI | **MISSING** — empty directory |
| LiveKit *deployment* | **MISSING** — see §8 |

---

## 2. The call lifecycle became server-authoritative

Before Phase 5 there was no state machine. `status` was three strings and each
method wrote whichever one it felt like. Three consequences, all reachable from
an ordinary client:

* **`accept` after `decline` succeeded**, resurrecting a refused call.
* **A retried `end` rewrote a finished call** — `ended_at`, `outcome` and
  `duration_seconds` were written unconditionally, so a client retrying a
  request whose response it never saw silently rewrote the record of a call
  that finished days earlier. A client's retry is a writer, and nothing said no.
* **`missed` was unreachable**, because nothing consulted the clock.

All three are the same defect: the authoritative state was whatever the last
writer said.

The machine now lives in one pure, dependency-free module
(`calls/call-state.ts`) and is enforced twice:

```
initiated ──invite──▶ ringing ──accept──▶ active ──end──▶ ended[answered]
    │                    │                   │
    │                    ├──decline (last)──▶ ended[declined]
    │                    ├──ring timeout────▶ ended[missed]
    │                    ├──cancel──────────▶ ended[cancelled]
    └──dispatch failed───┴───────────────────▶ ended[failed]
```

`ended` is terminal and has no outgoing edge — which is what makes `end`
idempotent rather than destructive.

**Three answers, not two.** Every action returns `transition`, `refused`, or
`noop`. The third is how idempotency is expressed: declining an already-declined
call is neither a transition nor an error, so the service returns success
without writing. Accepting a *declined* call is `refused`, because the caller
believes they are joining a live call and they are not.

**The write is conditional, not just the decision.** Read-decide-write is a
check-then-act race: two devices accepting at once both read `ringing` and both
write. Every transition is an `updateMany` naming the state it expects; a count
of zero means somebody else won, and is re-evaluated rather than treated as an
error.

**The terminal-state modelling decision.** The brief names `declined`, `missed`
and `failed` as *states*. They are modelled as one terminal status (`ended`)
carrying an `outcome`, because the schema already had
`call_outcome_when_ended` enforcing exactly that pairing, and because four
terminal statuses make "is this call over?" a four-way test every reader has to
keep in step. Nothing is lost: `outcome` distinguishes answered / missed /
declined / cancelled / failed, and `cancelled` and `failed` are **new** — both
used to be recorded as `missed`, which blames the recipient for a call the
caller withdrew or the network dropped.

### The missed-call sweep

Server-side, because "the phone stopped ringing" is not an event the server
observes. The recipient may be offline, their app killed, the push dropped — and
the *caller* may have lost the network too. In every one of those cases the call
still has to become a missed call for both people, and leaving it to a client
means a call rings forever exactly when the client is the thing that failed.

The claim is one conditional `UPDATE` guarded on the call still being
unanswered, so two sweepers, or one restarted mid-batch, converge: one wins each
row and the rest write nothing. There is no lease to leak because there is
nothing in flight — the transition *is* the work.

---

## 3. Class calls

A distinct call type (`chat.call.type = 'class'`), refused outside a group
conversation, using the ordinary call authorization — there is no separate
class-call permission model to keep in step.

**"Teacher is waiting. Please join the class." is not in the code.** It lives in
`chat.notification_template` in Arabic and English, rendered per recipient in
their own locale at delivery. A test asserts that no message body and no event
payload anywhere contains the English sentence — a literal would freeze the
academy's primary language out of its own product. The invitation is *also*
posted into the thread as a structured system message, so the class is in the
conversation history even if every push fails.

**Reminders are data**, not code: two `chat.notification_rule` rows against
`class_call_started`. Changing "remind after a minute, then three" is an
`UPDATE`. Every instance is keyed `(rule, callId, recipient)`, which makes the
whole thing idempotent — re-running converges on the same notifications.

**Cancellation is per recipient**, and that needed a new method
(`cancelForSubjectRecipient`). A student joining must stop being told the
teacher is waiting; cancelling the whole subject there would silence every
*other* student who has not joined, which is the opposite of the point.

---

## 4. Recording

The PRD said "calls are not recorded in MVP; the data model leaves room for a
recording reference **if the policy changes later**". Phase 5 is that policy
change, taken deliberately and narrowly.

| | |
|---|---|
| **Storage** | `chat.call_recording` holds an object key into the same private storage attachments use. **No column ever holds a URL** — a stored URL is a bearer credential that outlives every check that produced it. |
| **Who may record** | `calls.record` — admin, coverage_admin, manager, super_admin. Fixed at call creation as a *mode*, never a per-request flag: "record this call" must not be switchable mid-call or askable on a call you merely joined. A `normal` call can never grow a recording, and `chat.enforce_recording_mode` refuses the row rather than trusting the service. |
| **Who may listen** | `recordings.read`, **and** the call's family in live scope. **Not the participants.** Everyone on a call heard it; the right to have been present is not the right to keep a copy of somebody else's voice, and a parent with playback is a distribution surface for the teacher who was on it. |
| **Discovery** | A parent or teacher gets *no read policy at all* on `chat.call_recording`, so they cannot learn a recording exists by probing. `hasRecording` in call history is `false` — not omitted — for an unauthorized reader, because a field that appears only for authorized readers is itself the signal. |
| **Playback** | `POST /recordings/:id/playback`. Authenticate → permission → scope → exists → retention → *then* sign. Nothing before the last step produces a capability. A recording the caller may not reach is **404, never 403**: distinguishing them makes the route an oracle for which calls were recorded. |
| **Retention** | Every `available` recording carries `retention_expires_at`; a CHECK constraint refuses one without it, so nothing is kept indefinitely by omission. The sweep deletes the **object first**, then tombstones the row — the other order reports compliance it did not achieve. Playback also checks the clock, so a retention policy is not enforced only by a cron job with a gap the length of the cron interval. |
| **Audit** | started, completed, failed, playback, **playback refused**, deleted, retention cleanup. The signed URL is deliberately *not* written to the audit log: a log that stores the capability it is auditing hands a copy to everyone who may read it. |

**Retention period: not a business policy this repository knows.** Neither the
PRD nor the audit states one, and inventing a number and calling it the
academy's policy would be a fabrication. `recording.retention_days` defaults to
**30 as a safe technical default**, chosen only so nothing is stored unbounded,
and is a config row precisely so the business can set the real figure without a
deploy. **This is a decision the academy still owes.**

**Role change / deleted call.** Permission and scope are resolved live on every
playback, so a supervisor who lost a family yesterday cannot play the call
today. `call_recording.call_id` cascades, though calls are never deleted (BR-5).

---

## 5. Stories

**Publishing is Manager/Admin.** `stories.publish` is held by admin, manager and
super_admin; teachers and parents hold `stories.read` and nothing else. The
check is against *effective* permissions, so a per-account DENY restricts one
person without inventing a role for them.

Holding the permission is **necessary and not sufficient**: the resolver
independently refuses any audience clause outside the author's live scope. An
admin therefore publishes to their own families and a manager to the academy,
through the same code and the same request.

**The audience is materialised at publish time**, into
`chat.story_recipient`, and this is the decision the whole feature rests on.
Resolving at *read* time would run a union across `family_label`,
`group_member`, `learner_teacher_assignment` and `contact` per story per pull —
an N+1 with extra steps that cannot be usefully indexed, and that makes "who was
this published to?" unanswerable after the fact. Write-time resolution makes a
feed a single indexed join, makes deduplication a primary key rather than a code
path, and makes visibility an RLS predicate simple enough to be obviously
correct.

What it costs: the audience is a **snapshot** — a family labelled tomorrow does
not retroactively receive today's story. That is correct for a publication, and
it is stated so it is a decision rather than a surprise. What a snapshot must
*not* do is keep serving somebody whose access was withdrawn, so the read path
re-checks liveness rather than trusting the snapshot alone.

**Visibility.** There is no query anywhere that returns a story to a
non-recipient, on the server or the client — so there is nothing to filter and
no filtering to get wrong. The RLS policy says the same thing underneath. A
reader's story carries **no audience and no counts**: a parent who learned they
were reached via "the Installments label" would learn how the academy files its
customers.

---

## 6. Broadcast

The shape this exists to make impossible:

```
for (const family of families) await sendMessage(family)
```

inside the creating request. Every part of that is wrong at the size the feature
is for: the manager's request is held open for the fan-out; one unreachable
recipient fails the lot; a retry re-sends to everyone who already got it; a
deploy mid-loop loses the remainder with no record of where it stopped; and
afterwards nothing can answer "did Rania get it?".

```
Admin/Manager → create (authorize, resolve audience, write ledger) → return
                                                                       │
                       queue ────────────────────────────────────────┘
                         │
              leased worker → fan-out (batched, bounded) → delivery tracking
```

| Concern | How |
|---|---|
| **Audience** | The shared resolver. All families, assigned families, specific families, groups, labels, teachers, all teachers, named users, and any mix. |
| **Queue** | `chat.broadcast_recipient` is the queue. No second bus: the outbox already proved the database is the right place for work written in the same transaction as the domain change. |
| **Lease** | Identical discipline to the Phase 4 outbox, for the identical reason. Claiming pushes `available_at` forward and keeps the row claimable; a worker that dies lets the lease lapse. `claimed_by` is the fence, so a worker returning late from a slow provider cannot stamp a row another worker has taken. |
| **Fan-out** | Batched (`fanout_batch_size`), bounded concurrency (`fanout_concurrency`, a sliding window rather than chunked `Promise.all`, so one slow recipient does not idle the others). Bounded so fan-out can never starve interactive chat of database or provider capacity. |
| **Deduplication** | `UNIQUE (broadcast_id, actor_id)`. A family matching the label *and* the group *and* named explicitly is one row because a second cannot exist. |
| **Retry** | Per recipient, exponential backoff, terminal `failed` after `max_attempts`. A failure retrying cannot fix (no conversation, inactive recipient) is parked immediately rather than spending the budget. |
| **Idempotency** | Client `idempotencyKey` (unique index) for the creating request; `message_id` on the recipient row as the delivery anchor, so a redelivered lease finds the message already written; deterministic notification dedupe key. |
| **Failure isolation** | Each delivery is its own transaction and its own try/catch. `partial_failure` is a first-class terminal state — 398 of 400 is neither `completed` nor `failed`, and forcing it into either makes the operator's screen lie. |
| **Delivery tracking** | `pending → queued → sent → delivered`, with `failed`. **`sent` is not `delivered`**: `sent` means a message row was written and a notification scheduled; `delivered` is set only by a real client or provider acknowledgement. A successful insert is never promoted. |

**Authorization was not widened.** `broadcasts.send` is manager and super_admin,
exactly as before Phase 5 — implementing the feature was not taken as licence to
widen who may use it. What is *added* is a second, independent check: the
resolver refuses every clause outside the author's live scope, so even an admin
granted the permission by override reaches their own families and not the
academy.

---

## 7. The audience resolver

One authoritative layer, shared by stories and broadcast, with the same
vocabulary in both database CHECKs — so "the Thursday group" cannot come to mean
different sets of people depending on which feature asked.

Guarantees: **authorized** (every clause against the author's live scope; no
family, label, group or user id from a client is trusted), **deduplicated**,
**deterministic** (sorted by actor id, so a resolution is reproducible in a test
and comparable in an audit), and **live-only** (inactive contacts, deactivated
teachers, and contacts who may not be messaged are excluded).

**Two shapes of refusal, and the difference is deliberate.** A clause naming
*one record* outside reach is **refused** — the author asked for something
specific and silently dropping it would send a broadcast they did not compose. A
clause naming a *set* is **intersected** with scope, and the shortfall is
reported as a note the compose screen shows *before* the send. `all_families`
additionally requires an organization-wide role, because for a supervisor
"everyone" would otherwise silently mean "my forty families".

A forged id and a real id out of scope return the **same** code. Distinguishing
them would make the endpoint an existence oracle for other people's families.

---

## 8. LiveKit

```
Server-side token generation .................. IMPLEMENTED
Authorization before any token exists ......... IMPLEMENTED
Room naming and call→room mapping ............. IMPLEMENTED
Participant identity .......................... IMPLEMENTED
Flutter client integration (grant plumbing) ... IMPLEMENTED
Flutter media attachment (livekit_client SDK) . NOT IMPLEMENTED
LiveKit server deployment ..................... REQUIRES DEPLOYMENT
```

`LiveKitTokenIssuer` signs a real HS256 LiveKit access token: the room is inside
the signed payload (so a token cannot be replayed into another room),
`roomCreate` and `roomList` are false (the server owns the room lifecycle), and
the TTL is `call.token_ttl_seconds`. The client never names a room, never
self-authorizes, and re-runs the full authorization chain on every token mint —
so a permission revoked mid-call takes effect on the next join.

**What this repository cannot do.** There is no LiveKit server in
`docker-compose.yml` or `infra/`, and `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` /
`LIVEKIT_URL` are read from the environment with a startup failure if unset. The
Flutter client holds and displays the grant but does **not** attach to the media
room: `livekit_client` is not a dependency, and adding an SDK plus iOS/Android
audio-session and CallKit/ConnectionService plumbing is a body of work this
phase did not do and does not claim.

**Exact operational dependency:** a reachable LiveKit deployment (Cloud or
self-hosted), its API key/secret/URL in the API's and worker's environment, and
`livekit_client` integrated into the Flutter app with platform call UX. Until
then calls are correct in the database, correctly authorized, correctly
notified, and carry **no audio**.

Recording has the same boundary: the application contract is complete
(authorize → start → upload authorization → complete/fail → retention →
playback → audit), and the component that actually *writes* the audio — a
LiveKit egress worker — is not in this repository.

---

## 9. Defects found on the way

| # | Defect | How it was found |
|---|---|---|
| **P5-1** | The call state machine had no transitions at all: `accept` after `decline` succeeded, and a retried `end` rewrote a finished call's outcome and duration. | Reading `CallService` against the brief's §7 idempotency requirement. |
| **P5-2** | `call.ring_timeout_seconds` had been config since Phase 2 and was read by nothing. Unanswered calls rang in the database forever. | Grepping the config keys for readers. |
| **P5-3** | **The caller was counted as somebody who could answer their own call.** A declined 1:1 call stayed `ringing` forever, waiting for its own initiator. | Written by the lifecycle integration suite, which failed. |
| **P5-4** | **The caller was marked as having *missed* their own outgoing call**, putting an outgoing call in the caller's missed list and sending them a push about it. | Same suite; found while fixing P5-3. |
| **P5-5** | **My own migrations shipped `for all to chat_app using (true)` policies on all eight new tables.** These read as "let the application work" and are in fact *permissive* policies that OR with every other policy — silently cancelling every read policy in the same file and handing the application role unrestricted read of every recording, story and broadcast ledger. | The runtime-RLS suite, which asserted a parent could not read a broadcast and found they could. |
| **P5-6** | `chat.event_log.type` is a closed CHECK vocabulary; the new event names violated it. First attempt at widening it parsed the constraint text and dropped the existing sixty names. | The recording suite failed on insert; the bad rewrite failed on migration. |

P5-5 is the one worth remembering. The blanket form is legitimate for exactly
five identity tables (`20260907120000`) *because those carry no `authenticated`
policy at all*. Copying it onto a table that does have read policies deletes
them, silently, with no error anywhere. The RLS suite is what caught it, which
is the argument for having one.

---

## 10. Verification

Commands, and what they were run against.

```bash
# Database, built from empty by the migration chain alone
JAWWID_INT_CONTAINER=jawwid-phase5 JAWWID_INT_PORT=55455 \
  bash scripts/db/integration-db.sh up
JAWWID_INT_CONTAINER=jawwid-phase5 JAWWID_INT_PORT=55455 \
  bash scripts/db/integration-db.sh verify     # schema acceptance + BR-1 invariants

# API
cd apps/api && npx tsc -p tsconfig.json --noEmit
cd apps/api && DATABASE_URL=... DATABASE_APP_URL=... npx jest --runInBand

# Admin web
cd apps/admin-web && npm run typecheck && npm test

# Mobile
flutter analyze && flutter test
```

A **dedicated database on port 55455** was used throughout, not the shared
`jawwid-chat-int`. Other agents were running suites against the shared instance
during this work, and a verification record taken from a database somebody else
is truncating is not a verification record.

### Final run, from the committed tree, against a database rebuilt from empty

| Gate | Result |
|---|---|
| Migration chain builds an empty database | **PASS** |
| `schema_acceptance.sql` | **FRESH DATABASE ACCEPTANCE PASSED** |
| `br1_invariants.sql` | **ALL BR-1 INVARIANT TESTS PASSED** |
| API typecheck | **PASS** |
| API tests | **829 passed / 841**, 12 failing — all `schema-invariants.spec.ts` |
| Admin-web typecheck | **PASS** |
| Admin-web tests | **99 passed / 99** |
| `flutter analyze` | **clean** |
| `flutter test` | **346 passed**, 15 skipped |
| JC-011 protected-tests guard | **pass** |

**The 12 failures are pre-existing and environmental, not Phase 5.**
`schema-invariants.spec.ts` shells out to a `psql` binary; this host has none
(`spawnSync psql ENOENT`, 24 occurrences). The Phase 3 report records the same
12 failures for the same reason. The SQL those tests wrap — `schema_acceptance`
and `br1_invariants` — is the two rows above, and both **pass** when run through
`docker exec`. So the invariants are proved; only the Jest wrapper cannot run
here.

The five new Phase 5 security suites are registered in
`docs/qa/protected-tests.tsv`, so deleting one fails the build.

### Phase 5 test coverage

| Suite | Tests |
|---|---|
| `test/unit/calls/call-state.spec.ts` | 25 — exhaustive: every action from every state |
| `test/integration/phase5-call-lifecycle.spec.ts` | 21 |
| `test/integration/phase5-class-call.spec.ts` | 10 |
| `test/integration/phase5-recording.spec.ts` | 26 |
| `test/integration/phase5-stories.spec.ts` | 31 |
| `test/integration/phase5-broadcast.spec.ts` | 31 |
| `test/integration/phase5-runtime-rls.spec.ts` | 10 — under `chat_app`, NOBYPASSRLS |
| `test/features/calls/call_controller_test.dart` | 16 |
| `src/features/stories/AudiencePicker.test.tsx` | 6 |

### Security boundaries proved, not just happy paths

Unauthorized call start (PD-2 parent, non-member); unauthorized call join;
accept after decline; accept by a non-participant; cancel by a non-initiator;
duplicate transitions; expired invitations refused a media token; a normal call
refused a recording **by the database**; a participant refused playback of their
own call; another family's supervisor gets 404 not 403; forged recording id;
expired and deleted recordings; recording existence hidden from call history;
the signed URL absent from the audit log; teacher and parent refused story
publishing; a per-account DENY beating the role default; an admin refused
`all_families`; forged family, label and group ids; a real family out of scope
refused *identically* to a forged one; a story invisible to a non-recipient
including one in the same family; a view refused from outside the audience **by
the database**; an admin refused broadcast; a granted admin still narrowed by
the resolver; a duplicate recipient impossible **by the database**; a duplicate
idempotency key impossible; delivery acknowledgement refused on somebody else's
behalf; and under `chat_app` with the service layer removed: parents and
teachers cannot read recordings, parents see only their own stories, the
broadcast ledger is invisible to parents *and* to admins.

---

## 11. Known limitations

* **No audio.** See §8. This is the largest one and it is infrastructural.
* **Recording retention is a technical default, not a business policy.** §4.
* **The recording upload is an authorized contract, not a pipeline.** Nothing in
  this repository writes the audio file; a LiveKit egress worker must.
* **Story media upload is authorized but has no client.** The endpoint and the
  storage seam exist; no compose surface uploads through it yet.
* **Broadcast reaches recipients who already have a conversation.** A recipient
  with no thread is recorded and reported as `NO_CONVERSATION` rather than
  having one created — creating conversations is the messaging domain's job,
  with its own BR-1 triggers, and a broadcast has no business minting hundreds
  of threads as a side effect.
* **Cross-conversation call history is composed client-side.** The server scopes
  call history per conversation because that is what it can authorize in one
  check.
* **`CallHistoryEntry`/`history()` on the mobile `CallRepository` returns an
  empty page.** The richer `conversationHistory` is what the UI uses; the older
  method is left in place for contract compatibility and does not lie about
  having data.
* **Stories and broadcast emit realtime events that no client consumes yet.**

## 12. Infrastructure dependencies

| Dependency | Status |
|---|---|
| LiveKit server (Cloud or self-hosted) | **REQUIRED, not present** |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` / `LIVEKIT_URL` | **REQUIRED** in API and worker environments |
| `livekit_client` in the Flutter app + CallKit/ConnectionService | **REQUIRED, not implemented** |
| LiveKit egress worker for recording | **REQUIRED, not present** |
| S3-compatible object storage (`STORAGE_*`) | already required since Phase 2 |
| Worker process running `CallSweeper` and `BroadcastWorker` | wired in `worker.ts`; needs `DATABASE_SERVICE_URL` (`chat_service`, bypasses RLS) |

> **Repository implementation: COMPLETE** for the call lifecycle, class calls,
> recording authorization/retention/playback/audit, stories, broadcast, and the
> client surfaces named in §10.
> **External infrastructure: REQUIRED** for audio to flow and for recordings to
> be produced.
> **Verification status:** everything above the media layer is tested against a
> real database; the media layer is untested because it is not deployable from
> this repository, and this report does not claim otherwise.
