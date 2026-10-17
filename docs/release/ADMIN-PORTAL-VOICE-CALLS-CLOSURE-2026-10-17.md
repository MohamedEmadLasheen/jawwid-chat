# Closure record — Admin Portal voice calls (2026-10-17)

**State: CLOSED / FROZEN** by the product owner, 2026-10-17 (in session: *"please end this point
forever"*). Nothing below may be reopened except through the Critical Defect Reopen Protocol with
the owner's explicit authorization. Committed locally; **not pushed, not merged** — see §3.

## 1. What was delivered, and where

Two local branches. Neither is pushed.

| Branch | Commits | What |
|---|---|---|
| `claude/admin-portal-voice-calls-audit-0c5794` | `022856d` | C2–C4 staff scope and PD-7 (no new direct Teacher↔Parent conversations or calls; existing ones are read-only history), API + DB |
| | `1ba9f6d` | D4: the LiveKit webhook `@Public()` + `application/webhook+json` raw-body capture (W5 reopened) |
| | `b07efea` | W5 re-closed, with real-LiveKit evidence |
| `claude/admin-portal-call-screen` (from `eabc5c8`) | `abe155d` | Admin Web call screen (Stage 3): 1:1 and Student Group calls from the admin chat |
| | `017e106` | `@Public()` on the signed local-storage route (uploads/reads were 401 under the global guard) |
| | `6b9ddbb` | Admin Web: floating call window, web voice messages, media fixes, CSP `STORAGE_ORIGIN` |
| | `a91c690` | Phone: WhatsApp-style call screen (W7 reopened) |
| | `a60aa13` | W7 CLOSED again at `a91c690` |
| | `cf74606` | W4: a failed media join is always reported (W4 reopened) |
| | `ff9c47b` | W4 CLOSED again at `cf74606` |

Records: `REOPEN-W5-D4-2026-10-15.md` (audit branch), `REOPEN-W7-CALL-SCREEN-REDESIGN-2026-10-17.md`,
`REOPEN-W4-CONNECT-FAILURE-2026-10-17.md`.

Last verified state of the call-screen branch: Admin Web 266/266; phone 1150 passed (17
pre-existing environment-gated skips); API storage/attachment/webhook suites 45/45; 17/17
mutants; live web ↔ iOS simulator against a real LiveKit, including two-way audio from the
owner's Chrome.

## 2. Frozen

W4 (`cf74606`), W5 (`b07efea`, audit branch), W7 (`a91c690`) and this Admin Portal voice-calls
work as a whole.

## 3. Not done — recorded so it cannot vanish

These were explicitly left open when the owner ended this work. None is a defect in what was
delivered; each needs its own decision or task.

1. **Integration:** merge `claude/admin-portal-call-screen` with
   `claude/admin-portal-voice-calls-audit-0c5794` (the storage fix `017e106` must reach the audit
   lineage too), rerun every suite on the combined tree, then push and open a PR — owner approval
   needed for the push.
2. **Minimum LiveKit server version** for deployment: `livekit-client` 2.22.4 (Admin Web) does not
   work against LiveKit 1.8.x (rejoins every 15 s); QA ran 1.13.7. Recommended: ≥ 1.13.
3. **Stale ACTIVE calls:** nothing ends a call that both sides abandon; no timeout exists by
   design (no invented rule) — a product decision.
4. **On-duty routing** is not organization-scoped (known mis-routing) — a product/engineering fix.
5. **Performance acceptance** thresholds — not set.
6. **D6** — not applicable on the rtchat lineage; re-check after the merge.
7. **Phone "Try again"** on a failed call that still exists on the server starts a new call
   (the web offers Hang up) — W7 behavior, would need a W7 reopen.
8. **RT-037 staging real-media test** (`docs/qa/RT-037-STAGING-REAL-MEDIA-TEST.md`) — needs a
   staging environment.

## 4. Local QA environment

Stopped, not deleted (data kept): the `jawwid-advc-*` Docker containers (QA Postgres/Redis/LiveKit
and the isolated test databases), the QA API, worker and storage forwarder, the Admin Web dev
server, and the test simulator `advc-call-test` (shut down). Remove them only on the owner's
instruction.
