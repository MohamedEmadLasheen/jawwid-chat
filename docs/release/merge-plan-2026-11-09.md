# Merge plan for the open launch PRs (2026-11-09)

**Status:** proposed by the engineering lead. **The owner approves each batch explicitly.** Nothing is merged without
that approval, and no batch deploys, migrates production, or changes DNS or production settings.

## How every PR was validated (GitHub's state, 2026-11-09)

For each PR the lead checked:
- the current head SHA;
- a `Review: ACCEPT @ <that exact SHA>` comment from an independent reviewer;
- the latest run of each of the 7 required checks on that SHA (`Release-gate guards (fast)`, `API · typecheck + unit`,
  `Admin Web · typecheck + tests`, `Lessons · typecheck, tests, build`, `G-19 · migrations apply and are idempotent`,
  `Container images build and run unprivileged`, `Mobile · Flutter analyze + tests`);
- that it has no unresolved review threads;
- whether it is mergeable.

The merge order below was then simulated in a throwaway local worktree (never pushed). Each conflict it found is listed.

**Result.** #521–#546 all pass: ACCEPT at the exact head, required CI green on it, no unresolved threads. #523, #528
and #542 show BLOCKED only because they wait for the owner's Code Owner approval.

**Two older PRs were NOT ready, and are being fixed:**
- **#449:** no review ACCEPT had ever been posted at its head. A full independent review is running.
- **#498:** no ACCEPT posted, and the earlier review's P2-1 fix was sitting uncommitted in a local working tree. It is
  now committed as `557a877d` with tests; that tree was preserved untouched. A full re-review is running.

## Conflicts found by the simulation (all mechanical, none change behaviour)

| Conflict | Files | Resolution |
|---|---|---|
| #522 with #531 | `test/app/store_submission_config_test.dart` (both append a test at the end) | merge `main` into the second one, keep both tests, re-run CI, delta review |
| #535 with `main` | `test/features/calls/native_call_bridge_test.dart`, device plan | #449's branch predates the LR-74 tests on `main`; after #449 merges, merge `main` into the stack and keep both |
| #529 with #535 | `docs/qa/submission-device-test-plan.md` (rows SB-28 and SB-29 side by side) | keep both rows |
| #537 with #534 | `notification.controller.ts`, `device-registration.spec.ts` | keep #537's version (it is #534's code plus the session) |
| #497, #498 with #449 | `docs/security/pd040-route-permissions.md`; #449, #498, #503 also share `lib/l10n/*` | merge `main` in after the earlier one lands; keep all rows and strings |
| #545 with #539 | `docs/red-team/findings.md` | keep #539's table, add #545's RT-029 citation |

## Additional ordering constraints

- **#534 before #537.** #537 already contains #534's validation.
- **#498 and #537:** whichever merges second puts #537's session lock inside #498's shared `run()` helper. The note is
  on both PRs.
- **Stacked PRs:** #524, #529 and #537 sit on #449's branch; #535 sits on #524's; #543 sits on #533's. After the base
  merges, each is retargeted to `main` and `main` is merged in. The head changes, so CI re-runs and a delta review
  confirms only the merge changed.
- **Migrations, in filename order:** #497 (`20261107130000`), #498 (`140000`), #449 (`150000`), #537
  (`20261109120000`), #545 (`20261109130000`). Production has never been deployed and the ledger applies missing
  migrations in filename order, so order is not strictly required for correctness. Filename order keeps CI and any
  future staging ledger in step.

## Full rehearsal (2026-11-09): the combined result passes CI

Every open launch PR (37) was merged in this plan's order onto a throwaway branch,
`claude/merge-rehearsal-2026-11-09` @ `4071771c`, which is never merged. CI run `42640097090` passed every job,
including the four integration shards, G-19 migrations, the end-to-end smoke and Flutter. The conflicts it found and
how each was resolved form the recipe for the real merges:

| When merging | Conflict | Resolution |
|---|---|---|
| #522 after #531 | `store_submission_config_test.dart` | keep both tests |
| **#498 after #528** (not in the earlier plan) | `cli/review-cohort.ts` header; `review-cohort.spec.ts` | Both behaviours hold (#528's disposable parent has no teacher). Header describes three cases; #498's new test expects **3** active logins, not 2, and checks the disposable parent is unchanged |
| #498 after #497 | `API-CONTRACT.md` (both add §1.1c); `error-codes.md` | Terms keeps §1.1c (code cites it); account deletion becomes **§1.1d** |
| #498 after #497 | PD-58 coverage test | add #498's two write routes to `apps/api/test/unit/legal/ungated-writes.ts` (cancel request; staff complete) and the "Never gated" list |
| #449 after #497 | PD-58 coverage test | add `POST /me/feedback/:id/reply-seen` to `ungated-writes.ts` |
| #498, #449 | `pd040-route-permissions.md` count | 600 after #498, 601 after #449 |
| #535 after main | `native_call_bridge_test.dart` (both add group "N7") | keep LR-74's N7; rename #535's to N8 |
| #529, #535 | device plan | keep SB-28 and SB-29 |
| #537 after #534 | controller, spec | take #537's |
| #537 after #498 | `account-deletion.service.ts` | the session lock goes at the top of #498's shared `run()` |
| **#557 with #529** (whichever merges second) | `ios/Runner/AppDelegate.swift` registry lines | Put #529's `voipTokensWanted = true` and the stored `pushToken(for: .voIP)` report inside #557's `registerForPush` (NOT only in `startRegistering`), or iOS calls stop ringing after "Not now". Point #529's test in `store_submission_config_test.dart` at `registerForPush` |
| #557 with #449 (and #524, #535) | `MainActivity.kt` push channel `when` block | keep both `start` and `register` cases; run a merge-tree check first |
| #545, #551 after #539 | `findings.md` | keep #539's rows; RT-029 gets both notes |

Each real merge of a stacked or conflicting PR still gets its own CI run and a delta review at its new head.

## Batches

| Batch | PRs, in merge order (head SHA) | Purpose | Risk | Verify afterwards |
|---|---|---|---|---|
| **1. Docs and tests** | #521 `fb72aea1`, #541 `e36dbe60`, #532 `3b140dec`, #539 `b7e5c3a4`, #527 `618c967c`, #530 `722b0f47`, #525 `aa2f2285`, #533 `ff044aa0` | release, legal, store and security docs; one test made clock-independent | Low: no runtime change | main CI green after the last merge |
| **2. Small app and tooling hardening** | #526 `bb5340b7`, #531 `fb6a0e1d`, #538 `63025b5b`, #544 `1d2e0ff1` | no undeclared Sentry session data; no unused iOS background mode; wider secret scan; bounded legacy receipt frame | Low | main CI green; the secret scan stays clean on `main` |
| **2b. Portrait lock** | #522 (new head after `main` is merged in) | portrait everywhere except the full-screen board | Low | CI on the new head plus a delta review, then main CI |
| **3. Security fixes (API and app)** | #534 `8d1dff77`, #536 `7053582f`, #546 `9b9f5774`, #540 `6d4ef3a1` | push-registration blocker; no personal data on the lock screen; send re-checks membership; offline sign-out retried | Medium: auth, push and messaging paths | main CI green, including integration shards |
| **4. CI workflows** (Code Owner) | #523 `9c022267`, #542 `ccc3ed5b` | release-readiness evidence; secret scan over the full history | Low at runtime; touches `.github/` | main CI green; first Release-readiness run produces reports |
| **5. Review-accounts workflow** (Code Owner, High) | #528 `920b04c1` alone | gated production workflow for the review accounts | **High.** Merging runs nothing. Every run writes to the production database, needs its own approval through the `production` Environment, and needs three secrets the owner sets first | main CI green. **No run until LR-01 is live and the owner approves it** |
| **6. Migrations and their dependants** (High, one PR at a time) | #497 `9bc9416e`, then #498 (after re-review), then #449 (after review), then the stack: #524 → #535, #529, then #537 (after #534 and #449), then #545 (after #539 and #537) | terms gate; teacher deletion; push deep links; ring fixes; session-bound push tokens; same-organization learner rule | **High:** each carries a migration or touches calls and push | after each: main CI green, including `G-19 · migrations apply and are idempotent` |
| **6b. After #545** (High, one PR at a time) | #550 `bbebe272` (stacked on #545), then #551 `b1ee304f` (stacked on #550) | RT-029: a teacher cannot move organization while learners name them; `organization_id` immutable on family, conversation and teacher | **High: migrations `20261109140000`, `20261109150000`.** #551 had two independent reviews (database; breakage hunt over every write path and open PR) | after each: retarget to `main`, merge `main` in, CI, delta review, then main CI including G-19 |
| **3b. After #546** | #552 `7ac19737` (stacked on #546) | RT-014 follow-up: room syncs and the seat sweep lock member rows before the conversation | Medium: concurrency; no migration | retarget, CI, delta review, then main CI with integration shards |
| **4b. Store tooling** (Code Owner where `.github/` is touched) | #547 `66f9418f`, #548 `5349bf83`, #549 `6365275f` | signed store builds on GitHub runners (inert until secrets and owner approval exist); deploy inputs through env; store screenshots | #547 High (signing workflow; merging creates no key and runs nothing) | main CI green |
| **7. New, after their bases** | #554 (LR-26, on #449), #555 and #556 (docs), #557 (LR-11 explain-first) | | Low / Low / Low / Medium | main CI |
| **Excluded** | #553: duplicate of #524, do not merge | | | |
| **Separate** | #503 (another session's PR; it shares `lib/l10n/*` with #449 and #498), #517 (Code Owner, `scripts/qa`), #543 (after #533, then retarget) | | Low / Low / Low | main CI |

High-risk PRs are never batched together: batch 5 is one PR, and batch 6 merges one PR at a time with main CI checked
in between.
