# RT-037 — real-media rejoin test (staging) — PROCEDURE AND CHECKLIST

**Status: NOT RUN — BLOCKED on prerequisites (§1).** Required to close RT-037 and to re-close
W5 / W8-W1 (`docs/release/REOPEN-W5-W8W1-2026-10-14.md`). The release stays blocked until it
passes. Never against production.

## Why it is needed

Locally (LiveKit 1.8.4 container) a signalling-only client joins a room and is removed on
deactivation, but it never becomes ACTIVE, so LiveKit sends **no `participant_joined`
webhook** for it. Join-time ejection — what stops a re-join with a token issued before the
deactivation (LiveKit admits tokens ~60 s past `exp`) — is therefore proven only with signed
payloads, not with LiveKit observing a real media join. Only a real WebRTC client proves it.
None of these substitutes for this test: `rt037-media-revocation.spec.ts` §G (real LiveKit,
signalling-only participant), `livekit-webhook-http.spec.ts` (signed payloads over HTTP), the
local `rt037-live` probe.

## 1. Prerequisites — all missing today (exact list)

| # | Prerequisite | State on 2026-10-14 |
|---|---|---|
| P1 | An isolated staging deployment of this build (API **and** worker), `APP_ENV=staging`, reachable over TLS | MISSING — CI's staging deploy is quarantined ("nowhere to deploy", `2f54732`) |
| P2 | Staging Postgres with this branch's migrations applied (through `20261014160000`) and Redis | MISSING — and applying migrations to a shared/staging database needs the owner's explicit approval |
| P3 | S3-compatible object storage configured (`STORAGE_*`): local storage is refused outside local/test/ci (RT-039) | MISSING |
| P4 | A staging LiveKit project: `LIVEKIT_URL` (wss), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` set on API **and** worker | MISSING |
| P5 | That project's webhook URL = `https://<staging-api>/api/v1/livekit/webhook`, signed with the **same** key/secret pair as P4 | MISSING |
| P6 | `MEDIA_PUBLIC_BASE_URL` (or `TRUSTED_PROXY_HOPS` matching the proxy chain) | MISSING |
| P7 | A real WebRTC client that joins with **the token the API issued** (browser `livekit-client`, the Flutter app on a device/simulator, or the LiveKit CLI publishing a test tone) — never a token the tester mints, which would bypass the API | MISSING |
| P8 | Authorized synthetic accounts in an isolated staging organization: staff A (admin), parent P, second parent Q of the same family, all members of that family's Student Group | MISSING |
| P9 | An operator with server-side DB access to run `deactivate-principal` and read `chat.principal_revocation`, plus read access to LiveKit `ListParticipants` and API/worker logs | MISSING |
| P10 | Owner approval for P1/P2 (a deployment and a shared-environment migration) | NOT GIVEN |

Do not fabricate any of these. If one is unavailable the test stays BLOCKED.

## 2. Checklist

Record for every step: UTC timestamp, the command or action, the HTTP status / exit code, and
the evidence named. "Expect" is the pass criterion; anything else is a FAIL (§3).

### Phase 0 — configuration proof (before any call)
- [ ] 0.1 `GET /health/ready` → 200; save the whole `realtime` block (baseline counters).
- [ ] 0.2 Build commit of API and worker = the commit under test (record both).
- [ ] 0.3 A throwaway call joined by a live account produces, in the API log,
      `livekit webhook: participant_joined -> <outcome> in <n>ms` and **no**
      `livekit webhook: rejected, …` line. Expect: webhook delivery and signature verified.
- [ ] 0.4 A deliberately unsigned POST to the webhook URL → 401 (signature check in the
      controller, not the bearer guard). Expect: refused.

### Phase 1 — real-media join (step 1)
- [ ] 1.1 A: `POST /api/v1/calls {conversationId: <Student Group>}` → 201; record call id and
      room name (`jawwid-<conversationId>-<uuid>`).
- [ ] 1.2 P: `POST /calls/:id/accept` (if ringing) then `POST /calls/:id/token` → 201. Keep this
      token (T_old) and its `exp`.
- [ ] 1.3 P joins **with real media** using T_old and publishes an audio track.
- Expect: `ListParticipants` shows P ACTIVE; API log `participant_joined -> <presence outcome>`;
  `chat.call_participant.media_joined_at` set for P.

### Phase 2 — deactivation during the call (step 2)
- [ ] 2.1 `node dist/cli/deactivate-principal.js --kind contact --id <P> --reason "RT-037 staging test" --target <host:port/db>`
- Expect: exit **0** only after the completion barrier **and** P's removal from every live
  call room. Record wall time.
- [ ] 2.2 `select transition, writer, confirmed_at, attempts, last_error from chat.principal_revocation where principal_id = '<P>';`
- Expect: one row, `confirmed_at` set, `last_error` null.

### Phase 3 — removal from the active room (step 3)
- [ ] 3.1 `ListParticipants` → P absent. P's client log shows it was disconnected/removed.
- [ ] 3.2 `/health/ready` → `realtime.mediaParticipantsRemoved` +1, `deactivationsConfirmed` +1.

### Phase 4 — rejoin with the OLD token (step 4)
- [ ] 4.1 P rejoins with T_old **before** its `exp`, publishing media.
- [ ] 4.2 P rejoins with T_old again 30–60 s **after** `exp` (inside LiveKit's ~60 s leeway).
- Expect, each time: LiveKit admits the join and posts `participant_joined`; the API answers 200,
  logs `livekit webhook: a join by an identity that is no longer live was undone`, and
  `realtime.mediaJoinsRefused` +1; P disappears from `ListParticipants`.
- [ ] 4.3 Measure join → removal latency from P's client log and the API log (ms). Record it.

### Phase 5 — the revoked participant cannot re-enter or receive media (step 6)
- [ ] 5.1 P cannot obtain a new token: `POST /calls/:id/token` with P's credentials → refused
      (P is no longer live: 401).
- [ ] 5.2 After each removal in Phase 4, P's client shows no subscribed remote track and no
      further audio frames; A and Q receive no track from P (`ListParticipants` + client logs).
- [ ] 5.3 Record whether P received any media during the 4.3 window. **Known residual:** between a
      re-join and its webhook-driven removal, media can flow for the webhook round trip. Its
      acceptable size is an owner decision; record the measurement, do not judge it here.
- [ ] 5.4 Control: Q (live) joins with real media; A and Q talk both ways; Q stays connected.

### Phase 6 — failure cases (step 8)
- [ ] 6.1 **Room removal fails at deactivation.** Block API/worker → LiveKit control-plane egress,
      deactivate a second synthetic participant who is in a live call. Expect: CLI exit **75**
      (saved, not complete); `principal_revocation.last_error` populated, `attempts` rising;
      `realtime.mediaRemovalFailed` +1; the participant is still not able to start anything new
      (REST 401). Restore egress → the `RevocationConfirmer` (1 s interval) confirms; re-running the
      same CLI command → exit **0**, same revocation id (idempotent).
- [ ] 6.2 **Removal fails at join time.** With egress blocked, rejoin with an old token. Expect:
      API answers **503**, logs `could not undo a join by an inactive identity … LiveKit will retry`,
      `mediaRemovalFailed` +1. Restore egress and **observe** whether LiveKit redelivers and the
      participant is then removed — record what LiveKit actually does; do not assume.
- [ ] 6.3 **Webhook misconfigured.** (Optional) wrong signing key on the LiveKit side → API logs
      `rejected`, answers 401; restore.

### Phase 7 — cleanup
- [ ] 7.1 `POST /calls/:id/end` for every test call; `ListParticipants` empty.
- [ ] 7.2 Re-activate P (operator SQL on the staging DB, account and principal consistent) and show
      P is admitted with a NEW token (no cached verdict). Delete nothing; keep the isolated org.
- [ ] 7.3 Final `/health/ready` snapshot.

## 3. Fail conditions (RT-037 stays OPEN)

Step 2.1 returns 0 while P is still in the room · Phase 4 leaves P in the room (no webhook,
401/400 from the API, no removal) · P obtains a new token after deactivation · Q is dropped ·
6.1 returns 0 while removal failed · 6.2 answers anything but 503 on a failed removal.

## 4. Evidence to retain

API + worker logs for the whole window; LiveKit server and webhook-delivery logs; every
`ListParticipants` output; the SQL output of 2.2 / 6.1; `/health/ready` before, after each phase,
and at the end; client logs (type and version); build commit, LiveKit server version, the
measured join→removal latencies. Attach to `docs/red-team/findings.md` (RT-037) and the reopen
record. Closure additionally needs the owner's explicit CLOSED decision.
