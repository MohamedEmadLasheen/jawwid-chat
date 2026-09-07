# Phase 5 — Final Acceptance Audit

**STATUS: CANONICAL.** An acceptance/provenance audit of the completed Phase 5
work. No features were added. One real defect was found and fixed; nothing else
was changed.

# PHASE 5 — ACCEPTED WITH EXTERNAL DEPENDENCIES

The application implementation is complete and reproducible from its own
commits. Voice calls and recording require LiveKit and LiveKit Egress to be
deployed, which cannot be done or verified from this repository. Recording
retention still requires a business decision.

---

## 1. Provenance

Every commit on this branch carries the same git author, so authorship cannot
separate the work. Classification is by content.

**Phase 5 commits (19).** In order:

```
8af590d  feat(calls): the call lifecycle becomes server-authoritative
d533d48  feat(calls): the class call, and a reminder that stops for the right person
eec9a2d  feat(calls): follow-up call recording, with retention and an audit trail
38d3a33  feat(stories): one audience resolver, and stories built on it
55d97af  feat(broadcast): a durable job with a leased fan-out, not a loop in a request
ba48fa8  feat(chat): the calling surface, and a read-only story feed
49f2ecc  feat(admin-web): compose an audience, publish a story, watch a broadcast
0fbd7f8  test(phase5): security and lifecycle coverage, and two defects it caught
a0ae463  docs(phase5): the Phase 5 report, indexed as canonical
12a40e3  docs(phase5): record the final verification run and what it does not cover
4bdfa89  feat(infra): run the LiveKit server the API has been minting tokens for
10857b2  feat(calls): recordings are actually captured, not just described
91edaac  feat(chat): calls carry audio
16afed5  test(phase5): prove the media and recording contracts, against a real LiveKit
11439d3  docs(phase5): the closure report, and what is still not true
6967df7  fix(chat): remove another agent's push wiring my commit swept in
7af1f1d  test(phase5): poll for the recorder stop instead of sleeping for it
39ad719  docs(phase5): record the provenance defect the isolated verification found
2f3c313  fix(calls): delete a token-TTL fallback that could never run   ← this audit
```

**Peer commits interleaved on the same branch (4).** Not Phase 5, not modified,
not depended on:

```
4bc7d76  fix(realtime): two chat screens can no longer open two sockets
0cb3e80  test(phase4): lock the notification pipeline and the path that runs it
5cb5a2c  feat(notifications): a notification tap now reaches the app
d2938b3  feat(attachments): the mobile client can actually send a file
```

### Shared files, and the direction of dependency

| File | Phase 5 | Peer | Result |
|---|---|---|---|
| `lib/app/providers.dart` | media provider | push provider | Phase 5 content isolated by `6967df7` |
| `lib/app/bootstrap.dart` | LiveKit wiring | push wiring | same |
| `ios/Runner/Info.plist` | mic + `audio`/`voip` | `remote-notification` | peer **appended to** the array Phase 5 created |
| `android/…/AndroidManifest.xml` | audio permissions | `POST_NOTIFICATIONS`, intent filter | purely additive, disjoint |
| `lib/core/data/repositories.dart` | (Phase 5 content committed earlier) | `NotificationRepository` | uncommitted peer work, untouched |

**The dependency runs peer → Phase 5, never Phase 5 → peer.** The peer's plist
change extends a `UIBackgroundModes` array Phase 5 introduced; nothing in Phase 5
references anything of theirs.

### Verdict

**Phase 5 reproduces from its own commits.** A worktree built by cherry-picking
only the 19 Phase 5 commits onto `12a40e3` — skipping all four peer commits —
contains none of the peer's files, references none of their symbols, and passes
every suite (§6).

One conflict arose during that reconstruction, in `6967df7`, and it is expected:
that commit was authored *on top of* the peer's version of two files, so
replaying it on a peer-free line conflicts. Resolved to the commit's own intended
content, which is the pre-closure file plus only the media changes.

The shared working tree was never altered. The peer's uncommitted work
(4 modified files, 4 untracked) was left exactly as found.

---

## 2. Feature matrix

| Feature | Repository Status | Verified | External Dependency |
|---|---|---|---|
| Call lifecycle | COMPLETE | yes — 21 tests + DB trigger | — |
| Incoming call | COMPLETE | yes — 26 Flutter tests | — |
| Accept | COMPLETE | yes | — |
| Decline | COMPLETE | yes | — |
| End | COMPLETE | yes | — |
| Missed call | COMPLETE | yes — server sweeper, idempotent | — |
| Call history | COMPLETE | yes | — |
| Class call | COMPLETE | yes — 10 tests | — |
| Class reminder | COMPLETE | yes — rules-as-data, per-recipient cancel | — |
| LiveKit token | COMPLETE | yes — **against a real LiveKit server** | — |
| LiveKit server config | COMPLETE | yes — server runs from this config | deployment |
| Flutter LiveKit media | COMPLETE | yes — 10 tests; analyze/build clean | — |
| **Two-way audio** | COMPLETE | **NOT VERIFIED** — needs two devices | LiveKit deployment |
| Recording request | COMPLETE | yes — 12 tests | — |
| **Recording capture** | COMPLETE | **NOT VERIFIED end-to-end** | EXTERNAL DEPENDENCY (Egress) |
| Recording storage | COMPLETE | yes — private, delete-then-tombstone | — |
| Recording playback | COMPLETE | yes — authorized, audited, 404-not-403 | — |
| Recording retention | COMPLETE | yes — CHECK + sweep + clock | BUSINESS DECISION (period) |
| Recording audit | COMPLETE | yes — including refusals | — |
| Stories | COMPLETE | yes — 31 tests | — |
| Story audiences | COMPLETE | yes — families, teachers, users, labels, groups, mixed | — |
| Story publishing | COMPLETE | yes — Manager/Admin, DENY beats role | — |
| Broadcast | COMPLETE | yes — 31 tests | — |
| Audience resolver | COMPLETE | yes — one resolver, shared, deterministic | — |
| Broadcast queue | COMPLETE | yes — durable ledger, leased | — |
| Fan-out | COMPLETE | yes — batched, bounded concurrency | — |
| Retry | COMPLETE | yes — backoff, terminal failure, lease recovery | — |
| Deduplication | COMPLETE | yes — service **and** unique index | — |
| Delivery tracking | COMPLETE | yes — sent ≠ delivered | — |
| CallKit / native call UI | **NOT IMPLEMENTED** | n/a | Apple VoIP certificate |

"COMPLETE / NOT VERIFIED" means the code is finished and the behaviour cannot be
observed here. It is not a claim that it works.

---

## 3. Voice call acceptance

The application-side chain was checked against the architecture, by inspection
and by test:

| Property | Result |
|---|---|
| Client cannot mint a token | **confirmed** — no signing key or HMAC anywhere in `lib/` |
| Client cannot choose a room | **confirmed** — `CallMedia.connect(grant)` has no room parameter; the room is in the token's *signed* payload |
| Publish permission is server-derived | **confirmed** — `canPublish: !membership?.isSilent`, resolved server-side into the signed grant |
| Call state stays server-authoritative | **confirmed** — every transition returns the server's `CallView`; the client applies it |
| Media disconnect ≠ ended call | **confirmed** — a lost transport triggers reconciliation with the server, not an ended state |
| Stale invitations | **confirmed** — local expiry *and* server reconciliation before ringing |
| Duplicate lifecycle operations | **confirmed** — machine returns `noop`; DB trigger makes terminal re-entry unrepresentable |

**No new defects found in the call path.**

---

## 4. LiveKit acceptance

Verified against a live `livekit/livekit-server:v1.8` started from this
repository's own `infra/livekit/livekit.yaml`:

| Check | Result |
|---|---|
| Token minted by `LiveKitTokenIssuer` | **200 accepted** |
| Token signed with a different secret | **401 refused** |
| Expired token | **401 refused** |
| Room / participant mapping | **confirmed** — room in signed payload, `roomCreate:false`, `roomList:false` |
| Publish/subscribe grants | **confirmed** — `canPublish` from membership, `canSubscribe` true |
| Config internally consistent | **confirmed** — server starts, health 200, ports as declared |

### `LIVEKIT_TOKEN_TTL_SECONDS` — the one defect this audit found

The closure pass claimed to have fixed this dead configuration. **It had not.**
Its replacement was itself unreachable:

```ts
const configured = await this.config.get('call.token_ttl_seconds');
if (typeof configured === 'number' && Number.isFinite(configured)) return configured;  // ALWAYS
const fromEnv = Number(process.env.LIVEKIT_TOKEN_TTL_SECONDS);                          // dead
```

`AppConfigService.get` returns the stored row, or its own compile-time default
when there is no row — so it always yields a finite number and the branch below
could never execute in any state. Proved by observation, not by reading: with
`LIVEKIT_TOKEN_TTL_SECONDS=999` the resolved value is still `120`.

**Fixed in `2f3c313`** by deleting the dead branch rather than making it
reachable — wiring the variable in would give one threshold two sources of
truth, which is what the config table exists to prevent. A test now locks the
single source. The closure report's false claim is corrected in the same commit.

**Still open:** the variable remains marked required in `infra/env/manifest.tsv`
and read by nothing. Listed in §9.

---

## 5. Recording acceptance

| Requirement | Result |
|---|---|
| Normal calls cannot record | **confirmed** — service refuses, DB trigger refuses, and the recorder is never reached |
| Follow-up calls request recording | **confirmed** — recorder receives the server's own room and object key |
| Recorder failure ⇒ explicit failed state | **confirmed** — never left `pending`, and audited |
| Egress webhook security boundary | **confirmed** — 10 attacks, each asserting *nothing was written* |
| Unauthorized playback rejected | **confirmed** — including participants of the call |
| Storage private | **confirmed** — no public URL path; no column holds a URL |
| Retention deletes the object | **confirmed** — object first, then tombstone |
| Audit events exist | **confirmed** — start, complete, fail, playback, **refusal**, delete |

**Recording capture is `EXTERNAL DEPENDENCY`, not COMPLETE-and-verified.** No
LiveKit Egress deployment was available, so no audio file has been produced by
this pipeline. What is verified is every repository-side contract around it.

---

## 6. Clean-checkout verification (mandatory)

A temporary worktree containing **only** the 19 Phase 5 commits, on a database
built from empty by the migration chain alone:

| Gate | Result |
|---|---|
| Peer files present | **none** |
| Peer symbols referenced | **none** |
| Migration chain from empty | **PASS** |
| `schema_acceptance.sql` | **FRESH DATABASE ACCEPTANCE PASSED** |
| `br1_invariants.sql` | **ALL BR-1 INVARIANT TESTS PASSED** |
| API typecheck | **PASS** |
| API tests | **856 passed / 868** |
| Flutter analyze | **clean** |
| Flutter tests | **356 passed**, 15 skipped |
| Admin-web typecheck | **PASS** |
| Admin-web tests | **99 / 99** |
| JC-011 protected-tests guard | **pass** |

The temporary worktree was deleted afterwards. The shared tree was not altered.

---

## 7. Test results, classified

### Phase 5 failures
**None.**

### Pre-existing repository failures
**None.**

### Environment / tooling failures
**12**, all in `apps/api/test/integration/schema-invariants.spec.ts`.

Classified, not assumed:

* the binary is absent — `which psql` → not found; 24 × `spawnSync psql ENOENT`;
* the failure **predates Phase 5** — the suite was added in `e0d4dca`
  (2026-09-06), Phase 5 began at `8af590d` (2026-09-07);
* **the same SQL passes through Docker** — `integration-db.sh verify` runs
  `schema_acceptance.sql` and `br1_invariants.sql` against the same database and
  both pass.

The invariants are proved; only the Jest wrapper that shells to a local `psql`
cannot run on this host. **This is not a Phase 5 regression.**

### Test counts, shared branch vs Phase 5 only

| | Shared branch | Phase 5 only |
|---|---|---|
| API | 875 | 868 |
| Flutter | 362 | 356 |

The differences are the peer's own tests, correctly absent from the Phase 5 line.

---

## 8. Security acceptance

Re-audited directly against the database built from the Phase-5-only migration
chain.

**No broad permissive policy has reappeared.** Every `FOR ALL` policy on a Phase
5 table is the **RESTRICTIVE** organization-isolation policy; there is no
`USING (true)` on any of the eight, and **no policy targets `chat_app`** — the
trap the Phase 5 pass caught has not returned.

| Table | RLS | Read gate |
|---|---|---|
| `call_recording` | on | `recordings.read` **and** family in scope |
| `story` | on | resolved audience, or `stories.publish` |
| `story_audience` | on | `stories.publish` |
| `story_recipient` | on | own row, or `stories.publish` |
| `story_view` | on | own row, or `stories.publish` |
| `broadcast` | on | `broadcasts.send` |
| `broadcast_audience` | on | `broadcasts.send` |
| `broadcast_recipient` | on | `broadcasts.send` |

The five child tables carry no `organization_id`; tenancy reaches them through
their parent, which is the design rather than an omission — verified against
`information_schema`.

Service-role access is unchanged: the fan-out worker connects as `chat_service`,
which bypasses RLS by design, and `phase5-runtime-rls` proves the fan-out
*cannot* run on the application connection.

Negative authorization re-run and passing: teacher and parent refused story
publishing; a per-account DENY beating the role default; an admin refused
`all_families`; forged family/label/group ids refused identically to
out-of-scope ones; a participant refused playback of their own call; a broadcast
ledger invisible to parents *and* to admins.

---

## 9. Remaining production-hardening items

1. **`LIVEKIT_TOKEN_TTL_SECONDS` is declared required and read by nothing.**
   The dead code is gone; the manifest divergence is not. The infrastructure
   owner should either seed the `call.token_ttl_seconds` config row from it at
   deploy time, or drop it from `infra/env/manifest.tsv` and both deploy
   workflows. Not fixed here: it is a deployment contract owned by another
   domain.
2. **CallKit / ConnectionService** — §10.
3. **Egress webhook endpoint must be registered** with the LiveKit deployment.
4. **`schema-invariants` needs `psql` on the CI image** (pre-existing).

---

## 10. CallKit

```
CallKit status: NOT IMPLEMENTED
```

**What works today.** An incoming call reaches the recipient by realtime and by
a critical push that is exempt from quiet hours and conversation mute. The
in-app call screen rings, and accept/decline/end all work while the app is
running or backgrounded — the `voip` and `audio` background modes and the
microphone permission are configured.

**What does not work.** A locked or terminated iPhone does not present a native
full-screen incoming call. There is no CallKit UI, no ConnectionService on
Android, and no VoIP push wake path.

**Platforms affected.** iOS most severely (a locked device shows a notification,
not a ringing call). Android is degraded in the same way but less starkly.

**External configuration required.** An Apple Developer **VoIP push
certificate**, a CallKit/ConnectionService plugin, and native Swift/Kotlin glue.

**Blocker?** **Not a Phase 5 blocker — a production-hardening item.** Phase 5's
scope is the call lifecycle, authorization, media and recording, all of which
are complete. Native call presentation is a platform-integration workstream that
cannot be written or verified without a device and an Apple account, and an
implementation that has never presented a call on hardware would be a guess.

---

## 11. Deployment boundary

### LiveKit server
```
CODE:       COMPLETE
CONFIG:     COMPLETE   (infra/livekit/livekit.yaml, docker-compose.yml)
DEPLOYMENT: REQUIRED
```
Production configuration: `LIVEKIT_URL` (wss://), `LIVEKIT_API_KEY`,
`LIVEKIT_API_SECRET` — all three already required in `infra/env/manifest.tsv`
and wired in both deploy workflows. The server must publish its TCP fallback
port and a reachable UDP range, or media fails on restrictive networks.

### LiveKit Egress
```
CODE:       COMPLETE
CONFIG:     COMPLETE   (infra/livekit/egress.yaml, compose profile `recording`)
DEPLOYMENT: REQUIRED
```
Production configuration: an Egress deployment reachable from the API; Redis
shared with the LiveKit server; the S3 credentials Egress writes with
(`STORAGE_*`); and LiveKit configured to POST egress webhooks to
`/webhooks/egress`, signed with `LIVEKIT_API_SECRET`.

### Not deployed, not claimed
Neither service was deployed to any environment by this audit. A LiveKit server
was run **locally**, solely to verify the token contract.

---

## 12. Business decision required

```
Recording retention:
  Technical default = 30 days
  Business policy   = NOT YET DEFINED
  Configuration     = chat.config, key `recording.retention_days`
```

Neither the PRD nor the audit states a retention period. 30 days was chosen so
that nothing is stored unbounded by omission. **It is not academy-approved and
is not presented as policy.**

---

## 13. Precision statement

| Claim | Status |
|---|---|
| Call lifecycle, stories, broadcast implemented | **implemented and verified** |
| Media token accepted by a real LiveKit server | **verified** (locally) |
| Flutter media layer implemented | **implemented**; unit-verified |
| Two-way audio on physical devices | **NOT VERIFIED** — needs two handsets |
| Recording pipeline implemented | **implemented**; contracts verified |
| An audio file produced end to end by Egress | **NOT VERIFIED** — no Egress deployment |
| LiveKit / Egress deployed to any environment | **NOT DEPLOYED** |
| Recording retention business-approved | **NO** — technical default only |
| CallKit exists | **NO** |
| Phase 5 reproducible from its own commits | **verified** |
