# RT-037 — real-media rejoin test (staging) — PROCEDURE

**Status: NOT RUN.** Required to close RT-037 and to re-close W5 / W8-W1
(`docs/release/REOPEN-W5-W8W1-2026-10-14.md`). Release stays blocked until it passes.

## Why it is needed

Locally (LiveKit 1.8.4 container) a signalling-only client joins a room and is removed on
deactivation, but it never becomes ACTIVE, so LiveKit sends **no `participant_joined`
webhook** for it. Join-time ejection — what stops a re-join with a token issued before the
deactivation (LiveKit admits tokens ~60 s past `exp`) — is therefore only proven with signed
payloads, not with LiveKit observing a real media join. Only a real WebRTC client proves it.

## Missing prerequisites (why it was not run)

1. A staging deployment of this API + worker (CI's staging deploy is quarantined: "nowhere to
   deploy", commit `2f54732`).
2. A staging LiveKit project, its `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`, and
   its webhook URL set to `https://<staging-api>/api/v1/livekit/webhook` (signed with the same
   key).
3. A real WebRTC client: a browser with `livekit-client`, the Flutter app on a device or
   simulator, or the LiveKit CLI (`lk`) publishing a test tone.
4. Authorized test accounts in an isolated staging organization: one admin (A), one parent (P),
   one second parent (Q) — all in one family's Student Group or a direct A↔P conversation.

Never against production.

## Steps and the evidence to capture

| # | Step | Pass criterion | Evidence |
|---|---|---|---|
| 1 | A starts a call in an isolated conversation (`POST /api/v1/calls`); P fetches a token (`POST /calls/:id/token`) and **joins with real media** (publish an audio track) | LiveKit lists P as ACTIVE; the API log shows `livekit webhook: participant_joined -> <outcome>` (a media-presence outcome, not `rejected`) | RoomService `ListParticipants` output; API log line; `chat.call_participant.media_joined_at` set |
| 2 | Keep P's token. Deactivate P through the approved workflow: `node dist/cli/deactivate-principal.js --kind contact --id <P> --reason "RT-037 staging test" --target <host:port/db>` | the CLI exits **0** only after the barrier AND room removal confirmed; while LiveKit is unreachable it must exit **75** (optional negative: block the API→LiveKit egress, expect 75, restore, re-run, expect 0) | CLI output; `select transition, writer, confirmed_at, last_error from chat.principal_revocation where principal_id = '<P>'` |
| 3 | Observe P's client | P is disconnected from the room; P no longer in `ListParticipants` | client log; ListParticipants |
| 4 | **Rejoin with the SAME token** within its validity (and once more 30–60 s after `exp`, inside LiveKit's leeway) | LiveKit admits the media join, sends `participant_joined`; the API answers 200 and removes P within the webhook round trip | API log: `a join by an identity that is no longer live was undone`; `/health/ready` → `realtime.mediaJoinsRefused` incremented; P's client disconnected; time from join to removal (record it) |
| 5 | Q (live) joins the same call with real media; A and Q talk | Q stays connected; audio flows both ways | ListParticipants (A, Q ACTIVE); client logs |
| 6 | Re-activate P (operator SQL); P fetches a NEW token and joins | P is admitted (no cached verdict) | ListParticipants |
| 7 | Collect | — | API + worker logs for the window; LiveKit server/webhook logs; the SQL above; `/health/ready` before/after |

**Fail (keep RT-037 OPEN):** step 2 returns 0 before P is out of the room; step 4 leaves P in
the room (no webhook, 401/400 from the API, or no removal); step 5 drops Q.

## Recording

Attach the evidence to `docs/red-team/findings.md` (RT-037) and the reopen record, with the
staging build commit, LiveKit server version, client type/version, and the measured
join→removal latency of step 4.
