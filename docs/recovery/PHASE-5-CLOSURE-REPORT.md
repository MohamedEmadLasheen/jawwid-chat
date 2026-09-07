# Phase 5 — Closure & Functional Completion Pass

**STATUS: CANONICAL.** What the closure pass found, what it built, and what is
still not true.

Read with `recovery/PHASE-5-REPORT.md`, which this does not replace: that
report describes the domain work, and this describes closing the gap between
"the domain is right" and "the feature works".

## PHASE 5 — APPLICATION COMPLETE / EXTERNAL INFRASTRUCTURE REQUIRED

Voice calls now carry audio in any environment that runs the LiveKit service
this repository configures, and recordings are genuinely captured by LiveKit
Egress rather than described by metadata. Neither claim extends to a deployed
environment, because deploying one is not something this repository can do or
verify. §4 and §8 say exactly what remains.

---

## 1. Reconciliation — what was actually true before this pass

Verified against the code, not against the previous report.

| Feature | Before | Evidence |
|---|---|---|
| Call lifecycle | **COMPLETE** | state machine + trigger + 21 tests |
| LiveKit token generation | **COMPLETE** | real HS256, room in the signed payload |
| LiveKit server integration | **MISSING** | `.env.example` pointed at `ws://localhost:7880`; `docker-compose.yml` had no such service |
| Flutter LiveKit media | **MISSING** | the grant was stored in state and never used; `livekit_client` was not a dependency; `toggleMute` flipped a bool |
| CallKit / native call UX | **MISSING** | no `NSMicrophoneUsageDescription`, no `UIBackgroundModes`, no `RECORD_AUDIO` |
| Class calls | **COMPLETE** | 10 tests |
| Call reminders | **COMPLETE** | rules-as-data, per-recipient cancel |
| Recording capture | **MISSING** | nothing called an egress API; the upload URL was minted for a caller that did not exist |
| Recording storage | **COMPLETE** | MinIO, object key, delete-then-tombstone |
| Recording playback | **COMPLETE** | authorized, audited, signed, 404-not-403 |
| Recording retention | **COMPLETE** | config + sweep + CHECK |
| Recording audit | **COMPLETE** | including refusals |
| Stories / publishing | **COMPLETE** | 31 tests |
| Broadcast / fan-out / delivery | **COMPLETE** | 31 tests |
| `LIVEKIT_TOKEN_TTL_SECONDS` | **BROKEN** | required in the manifest, set by both deploy workflows, **read by nothing** |

Nothing marked COMPLETE was rebuilt. The state machine, audience resolver,
broadcast worker, RLS model, recording authorization and the existing Phase 5
tests are untouched except where a defect was proved.

---

## 2. Newly completed in this pass

### Voice calls carry audio

`livekit_client` 2.12.0 is now a dependency and `LiveKitCallMedia` implements a
`CallMedia` seam: room connection, microphone publishing, remote audio
subscription, mute, disconnection, reconnection and room cleanup.

The seam exists for the same reason `ObjectStorage` and `MediaTokenIssuer` do on
the server — the controller's job is the call's *lifecycle*, and a controller
that imported LiveKit directly could not be tested without a media stack.

**What the interface cannot express is the point.** There is no `join(room)`,
only `connect(grant)`. The client cannot name a room, cannot mint or extend a
token, and cannot grant itself publish rights, because the room and the grants
are inside the token's *signed* payload. Authorization is not represented in the
media layer at all, because none of it happens there.

Four behaviours, each a test:

* **A dropped transport is not an ended call.** LiveKit reconnects and the other
  participant is still there, so the screen says "reconnecting" and the
  controller asks the *server* what the call is rather than concluding anything
  from a socket.
* **Media failure does not end an authorized call.** Ending it because *this*
  device could not get audio would hang up on somebody who can hear fine.
* **The microphone is released before the network call** on decline and hang-up.
  A decline that failed to reach the server must still stop this device
  transmitting.
* **Mute is local.** A mute that round-tripped would stop working exactly when
  the network does, which is when people reach for it.

### Recording is captured, not described

`CallRecorder` is a seam with `LiveKitEgressRecorder` behind it. The API asks
Egress to record; Egress joins the room as a hidden participant, mixes the audio
and writes the file to the private bucket **itself** — the bytes never pass
through this API, exactly as an attachment upload never does.

* **The absence is loud.** `DisabledCallRecorder` throws. A recording request
  that appears to work and records nothing is worse than one that fails: the
  participants were told the call is being recorded and the academy believes it
  has an artefact it does not have.
* **A failed start marks the row `failed`, never pending.** A pending recording
  reads as "recording in progress" on every surface that shows one, so a
  recorder that never started would look exactly like one that is working —
  indefinitely.
* **Only the recorder's own report completes a recording**, by webhook, matched
  on the egress job id. Retention starts when the file exists and not before.
* **Ending the call stops the recorder**, after the transaction commits and
  best-effort — a call must never fail to end because the recorder is
  unreachable.

### The LiveKit service this repository had been assuming

`docker-compose.yml` gains `livekit` (and `egress`, behind a `recording`
profile), configured by `infra/livekit/*.yaml`. The config is a real one: a TCP
fallback port, because a parent on a UDP-blocking mobile network cannot
establish media at all and that is the commonest real-world failure; and a
narrow UDP range, because Docker Desktop cannot map the default ephemeral one.

### Native configuration calling cannot work without

iOS `NSMicrophoneUsageDescription` — **without it iOS terminates the app** the
instant the microphone is requested, so a call would crash rather than fail —
plus `UIBackgroundModes: audio, voip`. Android `RECORD_AUDIO`,
`MODIFY_AUDIO_SETTINGS`, `BLUETOOTH_CONNECT` and `FOREGROUND_SERVICE_MICROPHONE`,
which Android 14 requires for a call that continues while the app is
backgrounded.

### A configuration defect found on the way

`LIVEKIT_TOKEN_TTL_SECONDS` is marked required for every environment in
`infra/env/manifest.tsv` and is set by both deploy workflows — and was read by
nothing. An operator lowering it in production would have changed no behaviour
at all: configuration that looks like a control and is a comment. The config row
stays authoritative (that is this system's rule for every threshold); the
environment variable is now honoured as the deployment-level default beneath it.

---

## 3. What was verified, and how

**The token contract was verified against a real LiveKit server**, not against
this repository's assumptions about LiveKit's format. That is exactly the class
of assumption that is wrong silently: a token we consider perfectly formed,
refused by the server, fails as a connection timeout on a parent's phone and as
nothing at all in CI.

| Presented to a real `livekit/livekit-server:v1.8` | Result |
|---|---|
| A token minted by `LiveKitTokenIssuer` | **200 accepted** |
| The same token signed with a different secret | **401 refused** |
| An expired token | **401 refused** |
| Room, `roomCreate:false`, `roomList:false` in the signed payload | **confirmed** |

The suite skips loudly when no server is reachable, so a green run is never
mistaken for a verified one.

**What was NOT verified: two-way audio between two real devices.** That needs
two handsets with microphones and cannot be done from this environment. What is
proved is everything up to the media edge — the token is accepted by a real
server, the room is scoped, the client presents the grant and drives the SDK,
and the SDK's own contract is exercised by its tests, not ours.

---

## 4. Still requires external infrastructure

| Dependency | State |
|---|---|
| LiveKit server | **CODE COMPLETE · CONFIG COMPLETE · DEPLOYMENT REQUIRED** — runs locally from `docker-compose.yml`; staging/production must run one and set `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (already required in the manifest and wired in both deploy workflows) |
| LiveKit Egress | **CODE COMPLETE · CONFIG COMPLETE · DEPLOYMENT REQUIRED** — behind the `recording` profile locally; production needs an Egress deployment reachable from the API, with the storage credentials it writes with |
| Egress webhook delivery | **CODE COMPLETE · CONFIGURATION REQUIRED** — LiveKit must be configured to POST to `/webhooks/egress`; the API verifies the signature and the body digest |
| CallKit / ConnectionService | **NOT IMPLEMENTED · EXTERNAL ACCOUNT REQUIRED** — see below |
| APNs VoIP certificate | **EXTERNAL ACCOUNT REQUIRED** — an Apple Developer VoIP push certificate |
| Object storage | already required since Phase 2 |

### CallKit, stated plainly

**Not implemented.** The repository-side prerequisites are now in place — the
`voip` background mode, the microphone permission, and a media layer that can be
driven from a native answer — but native incoming-call UI needs a CallKit /
ConnectionService plugin, Swift and Kotlin glue, and an APNs **VoIP** push
certificate that must be issued from Apple's developer portal. None of that can
be written blind and none of it can be verified here: a CallKit integration that
has never presented a call on a device is a guess with a plugin dependency.

Until it exists, an incoming call is presented by the in-app screen driven by
realtime and the existing critical push. That works while the app is running; it
does **not** ring a locked iPhone the way a phone call does.

---

## 5. Still requires a business decision

**Recording retention.**

```
Technical default:      30 days
Business policy:        NOT YET SPECIFIED
Configuration location: chat.config, key `recording.retention_days`
                        (seeded by supabase/migrations/20260907150000_chat_phase5_calls.sql,
                         mirrored in apps/api/src/platform/app-config.service.ts)
```

Neither the PRD nor the audit states a retention period. 30 days is a safe
technical default chosen so that nothing is stored unbounded by omission, and it
is a config row so the real figure needs no deploy. It is **not** an
academy-approved policy and this report does not present it as one.

---

## 6. Security verification

No RLS policy was weakened. The Phase 5 model is unchanged; the closure pass
added one new externally-reachable surface and one new seam, and both are tested
as boundaries.

**The egress webhook** is the only route in the API that accepts a write from
something that is not a user — Egress has no session and no actor, which is
exactly the shape of route that becomes an unauthenticated write endpoint by
accident. It is authenticated by LiveKit's signature, and **both the signature
and the body digest** are checked: a valid signature over a *different* body is
a replay with substituted contents, and a signature-only check would pass it.

Ten attacks, each asserting that **nothing was written** rather than that a
status code came back: no header; wrong secret; valid signature over a
substituted body; expired signature; a non-JWT; a missing `sha256` claim; and a
deployment with no secret configured (which must refuse, not fall through to
"nothing to check").

Everything from the Phase 5 security pass still holds and still runs — a normal
call cannot be recorded (service *and* trigger), a participant cannot play back
their own call, another family's supervisor gets 404 not 403, forged ids are
refused identically to out-of-scope ones, and under `chat_app` with the service
layer removed parents and teachers cannot read a recording row at all.

---

## 7. Test results

| Suite | Result |
|---|---|
| API | **863 passed / 875**, 12 failing |
| Flutter | **362 passed**, 15 skipped |
| Admin-web | **99 passed / 99** |
| API typecheck | **PASS** |
| Admin-web typecheck | **PASS** |
| `flutter analyze` | **clean** |
| Schema acceptance + BR-1 invariants | **PASS** |
| JC-011 protected-tests guard | **pass** |

**The 12 failures are pre-existing and environmental.**
`schema-invariants.spec.ts` shells out to a `psql` binary this host does not
have (`spawnSync psql ENOENT`). The Phase 3 and Phase 5 reports record the same
12 for the same reason, and the SQL those tests wrap passes when run through
`docker exec`.

New in this pass: 12 recording-capture tests, 10 webhook-attack tests, 4 LiveKit
contract tests, 10 Flutter media tests.

---

## 8. Exact commands

```bash
# The stack, including the LiveKit server the API needs
docker compose up -d                      # postgres, redis, minio, livekit
docker compose --profile recording up -d  # ...and egress

# A private verification database, built from empty by the migration chain
JAWWID_INT_CONTAINER=jawwid-phase5 JAWWID_INT_PORT=55455 \
  bash scripts/db/integration-db.sh up
JAWWID_INT_CONTAINER=jawwid-phase5 JAWWID_INT_PORT=55455 \
  bash scripts/db/integration-db.sh verify

# API
cd apps/api && npx tsc -p tsconfig.json --noEmit
cd apps/api && DATABASE_URL=... DATABASE_APP_URL=... npx jest --runInBand

# The LiveKit contract suite needs a running server; it skips loudly otherwise
docker run -d --name jawwid-lk -p 7880:7880 \
  -v "$PWD/infra/livekit/livekit.yaml:/etc/livekit.yaml:ro" \
  livekit/livekit-server:v1.8 --config /etc/livekit.yaml

# Admin web
cd apps/admin-web && npm run typecheck && npm test

# Mobile
flutter analyze && flutter test

# The JC-011 guard
bash scripts/qa/check-protected-tests.sh
```

---

## 9. Definition of done

| Item | State |
|---|---|
| Call lifecycle, invitation, accept, decline, end, missed, history | **DONE** |
| Realtime and notification integration | **DONE** |
| Two-way audio | **APPLICATION COMPLETE** — media layer implemented and driven; needs a deployed LiveKit and two devices to observe |
| Class calls: type, notification, localized message, reminder, no-answer | **DONE** |
| Normal calls remain unrecorded | **DONE** — service, trigger, and the recorder is never reached |
| Follow-up calls request recording | **DONE** |
| Recording pipeline exists | **APPLICATION COMPLETE** — Egress requested, configured, webhook-completed; needs a deployed Egress |
| Recording storage, authorization, playback, retention, deletion, audit | **DONE** |
| Stories: creation, publishing, viewing, all audiences, server-side visibility | **DONE** |
| Broadcast: audiences, resolver, queue, fan-out, retry, dedup, idempotency, tracking, isolation | **DONE** |
| CallKit / native incoming-call UI | **NOT DONE** — §4 |
| Backend, Flutter, admin-web, security and RLS tests | **DONE** |
| Typecheck, lint, fresh verification | **DONE** |
| No unrelated changes | **DONE** — another agent's uncommitted notification work was left untouched |

**Phase 5 is application-complete.** Calls and recordings will function the
moment LiveKit and Egress are deployed and configured, and this report does not
claim they are.
