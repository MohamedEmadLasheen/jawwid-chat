# Phase 0 — Branch Ledger and Recovery Snapshot

Status: **CANONICAL record of the Phase 0 reconciliation** · Date: 2026-09-07
Owner: Phase 0 lead (Principal Engineer / Integration Lead)
Integration line: `integration/recovery`

Every branch that existed when the repository was frozen has an explicit
disposition below. Nothing was deleted before its useful work was classified;
every deleted branch is preserved as an annotated tag under `archive/phase0/…`
so the decision is reversible.

---

## 0. Freeze snapshot (Step 0)

Captured before any modification, on 2026-09-07 (raw capture:
`git status --porcelain -uall`, `git for-each-ref`, `git worktree list --porcelain`,
`git diff`, kept in the Phase 0 session scratchpad and summarised here).

| Item | State at freeze |
|---|---|
| Checked-out branch | `feat/infrastructure` |
| HEAD | `148b7a2` — *fix(mobile): the app never left the splash screen* |
| `main` | `eeca866` — 4 commits, nothing merged into it |
| Local branches | **16** (+ `main`) |
| Worktrees | **17** (main tree + 11 under session scratchpads + 5 under `.claude/worktrees/`; one of the scratchpad ones detached at `148b7a2`, one at `d236ce3`) |
| Remotes | **none** — the repository has never been pushed |
| Stash | empty |
| Staged changes | none |
| Modified tracked files | 10 (see §0.1) |
| Untracked files | `docs/integration/{backend-decision-memo,current-integration-state}.md`, `docs/release/od-01-{conversation-model,migration-impact}.md`, `test/app/startup_routing_test.dart`, five worktree directories under `.claude/worktrees/` |
| Tracked vendor/generated files | `apps/admin-web/node_modules/` (5,917 files), `apps/admin-web/dist/`, `.dart_tool/`, `.flutter-plugins-dependencies`, `*.iml`, `tsconfig.tsbuildinfo`, a gitlink `.claude/worktrees/ai2-integration-audit` |
| Toolchain on the host | node 24.18, npm 11.16, Docker 29.7, no `psql` binary, no `pnpm`; Flutter 3.47.2 / Dart 3.13.2 installed at `~/development/flutter/bin` (not on `PATH`) |

The audit document *"Jawwid Chat: What Is Actually Built"* named in the Phase 0
brief was **not present in the repository or on disk**. Its claims were treated
as hypotheses and re-verified against code and execution; every one that
mattered was confirmed (see `PHASE-0-REPORT.md` §1).

### 0.1 Modified tracked files at freeze (all AI #9 red-team work, uncommitted)

`.github/workflows/ci.yml`, `apps/api/test/integration/schema-invariants.spec.ts`,
`docs/qa/protected-tests.tsv`, `docs/red-team/findings.md`,
`docs/red-team/handoff-to-release.md`, `scripts/db/integration-db.sh`,
`scripts/qa/check-protected-tests.sh`, plus noise in
`.flutter-plugins-dependencies`, `apps/admin-web/node_modules/.vite/vitest/results.json`
and the deleted gitlink. Verified (empty `postgres:17` → 20 migrations → both SQL
gates pass) and committed as `5eae5a3`.

### 0.2 Uncommitted work found inside worktrees

| Worktree (branch) | Uncommitted content | Disposition |
|---|---|---|
| `wt-d1` (`ai4/p1-canonical-foundation`), `wt-rbac` (`ai4/rbac-canonicalization`), `od01`, `.claude/worktrees/ai8-blockers` | untracked copies of `app.module.ts`, `main.ts`, `worker.ts`, `db/tests/br1_invariants.sql`, `db/tests/schema_acceptance.sql`, `20260905093300_chat_br1_structural_backstop.sql` | byte-identical to the versions already committed on `feat/infrastructure` (`18a8dd8`, `ed3216d`) — nothing to recover |
| `wt-rbac` | `supabase/migrations/20260906130000_chat_rbac_canonical_roles.sql` (293 lines, never committed) | preserved as `docs/recovery/evidence/uncommitted/ai4-…sql`; input to Phase 1 |
| `od01` (`integration/od-01-reconciliation`) | family-scoped fixtures for `schema-invariants.spec.ts`; an OD-01 variant of `schema_acceptance.sql` | **applied** on top of the OD-01 cherry-pick (`1b27075`); kept as evidence |
| `wt-ai7` (`feat/ai7-runtime-fixes`) | `src/platform/config.controller.ts` (`GET /config`), `docs/infrastructure/api-contract-reconciliation.md`, a `platform.module.ts` wiring change | doc committed (`e064d3d`); controller preserved as evidence, endpoint specified in `docs/contracts/API-CONTRACT.md`, not implemented in Phase 0 |
| `mobile` (detached `148b7a2`) | `test/app/signed_out_startup_test.dart` | superseded by `test/app/startup_routing_test.dart`; preserved as evidence |
| `.claude/worktrees/ai9-core-auth-contract` | `docs/integration/authentication-implementation-boundary.md`, `core-authentication-contract-request.md` | committed (`e064d3d`) |

---

## 1. Topology before reconciliation

```
main (eeca866)
 └── feat/infrastructure ─────────────────────────── 148b7a2  (51 commits, linear over main)
       ├── feat/communication-engine (be77391)        ancestor of infrastructure, 0 unique
       ├── integration/ai2-audit (dde20f1)            +3 from 71e55cc
       ├── ai4/p1-canonical-foundation (f9f3eca)      +1 from 03d4119
       ├── fix/ai8-p0-blockers (80765dc)              +1 from 03d4119
       ├── integration/od-01-reconciliation (61e810c) +2 from 03d4119
       ├── feat/ai7-runtime-fixes (16857af)           +3 from 7e0c6a3
       ├── integration/prd-reconciliation (ee0dcdd)   +3 from 7e0c6a3
       ├── integration/current-state-reconciliation   +1 from 0270f05
       ├── docs/core-auth-contract-request (d236ce3)  = an ancestor, 0 unique
       ├── ai4/rbac-canonicalization (72a5f29)        +1 from d236ce3
       ├── docs/ai8-auth-current-state (5d3840e)      +1 from d236ce3
       ├── docs/auth-decision-gate (135ff55)          +1 from d236ce3
       └── integration/ai8-auth-subset (315ed95)      +1 from ed3216d
 └── feat/backend-foundation (fb3fc1c)                7 commits from ebbbc93 (a second DB lineage)
       └── feat/core-integration-boundary (3c53043)   merge of backend-foundation + c0d755a, +5
```

Two facts drove the strategy:

1. `feat/infrastructure` is the **only** lineage that boots, and it is linear
   over `main`. Its 13 platform migrations are byte-identical to
   `feat/backend-foundation`'s, i.e. the "second lineage" was already absorbed.
2. Every other branch is a **small delta** (1–3 commits) on top of that lineage,
   except `feat/core-integration-boundary`, which is built on the pre-communication
   schema and conflicts with OD-01.

Therefore `integration/recovery` was created at `main` and fast-forwarded to
`148b7a2` (identical to branching at the tip — 0 merge commits between `main`
and the tip), and every delta was brought in **surgically by cherry-pick or
extraction**, verified after each step. No branch was merged wholesale.

---

## 2. Ledger

Legend for *Decision*: KEEP · MERGE · CHERRY-PICK · EXTRACT · REWRITE · DEPRECATE · DROP.
Every branch is tagged `archive/phase0/<branch>` at the listed HEAD before deletion.

| # | Branch | HEAD | Ahead of `main` | Unique vs `feat/infrastructure` | Purpose | Subsystems touched | Valid? | Duplicates / conflicts | Decision | What entered `integration/recovery` |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `feat/infrastructure` | `148b7a2` | 51 | — | The working trunk: API bootstrap, communication engine, Admin Web, Flutter, CI, QA gates, red-team harness | everything | yes (boots; 84 unit + 77 int tests) | contains `feat/communication-engine` entirely | **KEEP → became `integration/recovery`** (fast-forward) | all 51 commits |
| 2 | `feat/communication-engine` | `be77391` | 6 | 0 | Early QA docs on the trunk | docs/qa | yes | fully contained in #1 | **DROP** (no unique work) | nothing to add |
| 3 | `feat/backend-foundation` | `fb3fc1c` | 11 | 7 | AI #1's standalone DB: 13 migrations, `db/testkit`, `db/tests/*`, ADRs | supabase/migrations, db/, docs/architecture | migrations valid and already on the trunk byte-for-byte; ADR-001 ("build the brief, no teacher/no groups/no calls") is obsolete | migrations duplicate #1; `db/tests/{attention,coverage_engine,ownership,rls,workload,integration,invariants}.sql` target the pre-OD-01 schema (thread/case) | **EXTRACT** docs, DROP the rest | `docs/architecture/decisions.md` (reference, ADR-001 marked superseded) |
| 4 | `feat/core-integration-boundary` | `3c53043` | 54 | 13 | Jawwid Core webhook ingestion (HMAC-signed), Core mirror tables, `organization` model with org-scoped RLS + keys, drift-check script | apps/api/src/integration, prisma, 9 migrations 094000–095400, docs/architecture | design valid; built on the thread-era schema without the communication migrations; competes with #7 on tenancy; assumes "each org has its own Core and identity provider" (not in PRD) | conflicts with OD-01 (RLS rewrite) and with `72a5f29`; migration numbers collide with 094000 | **EXTRACT** docs now; **REWRITE** the ingestion boundary in a later phase against the canonical schema | `core-integration-contract.md`, `open-contract-decisions.md`, `organization-model.md`, `backend-contract.md` (reference) |
| 5 | `integration/ai2-audit` | `dde20f1` | 42 | 3 | AI #2 audit of the communication engine on a composed branch | migrations (copies), db/tests/workload.sql, scripts, docs/communication, one test fix | test fix valid; migration copies duplicate #3; its `093300_chat_br1_hardening.sql` competes with the trunk's `093300_chat_br1_structural_backstop.sql`; `093400_idempotency_reconciliation` is a useful but thread-era note | duplicates #3; conflicting BR-1 migration | **CHERRY-PICK** `8f43064` (RT-028 deterministic privacy assertion); **EXTRACT** `integration-audit.md`; DROP the migration copies | `1ad4ee9`, `docs/communication/integration-audit.md` |
| 6 | `ai4/p1-canonical-foundation` | `f9f3eca` | 45 | 1 | `organization_id` on every root entity (PRD §2.3) | migration, prisma, db/tests/tenant_isolation.sql | valid | **byte-identical patch** to #7 (`git patch-id` equal) on an older base | **DROP** (duplicate of #7) | via #7 |
| 7 | `ai4/rbac-canonicalization` | `72a5f29` | 49 | 1 | same `organization_id` patch on a newer base (+ an uncommitted RBAC role migration in its worktree) | as #6 | valid after OD-01 (the migration skips absent tables) | competes with #4's organization model | **CHERRY-PICK** with adaptation (Thread hunk dropped; Prisma defaults added) | `38b2b3b`; uncommitted RBAC migration preserved as evidence |
| 8 | `docs/ai8-auth-current-state` | `5d3840e` | 49 | 1 | Auth/identity current-state record | docs/integration | historical | — | **CHERRY-PICK** (doc) | `c8f933a` |
| 9 | `docs/auth-decision-gate` | `135ff55` | 49 | 1 | Core capability audit; teacher blocker | docs/integration | historical | — | **CHERRY-PICK** (doc) | `46d86e1` |
| 10 | `docs/core-auth-contract-request` | `d236ce3` | 48 | 0 | Branch pointer only; its two docs lived untracked in its worktree | — | — | — | **DROP** (docs recovered from the worktree) | `e064d3d` |
| 11 | `feat/ai7-runtime-fixes` | `16857af` | 48 | 3 | D-1 message-author validation, D-2 outbox realtime delivery, D-6 full authentication (JWT + password + sessions + `chat.account_credential`/`chat.session`) | api, migrations, tests | D-1 superseded by OD-01 (thread removed entirely); D-2 valid and verified; D-6 is Phase 1 work, well designed, one of two competing auth implementations | D-1 duplicates NF-06 (#12) and OD-01 §1; its `091150_chat_runtime_roles` duplicates the trunk's `091150_chat_application_roles`; D-6 competes with #12/#13 | **CHERRY-PICK** D-2 (`4b2d3a5`); **EXTRACT** D-6 as the Phase 1 authentication baseline (see `IDENTITY-MODEL.md` §7); DROP D-1 | `755e870` |
| 12 | `fix/ai8-p0-blockers` | `80765dc` | 45 | 1 | Bearer-token guard (verify-only), NF-06 author scope, student-group owner-presence trigger, call-type immutability | api/platform/auth, migrations 090000–090200 | guard valid but Phase 1; NF-06 superseded by OD-01; `090200_call_type_immutable` superseded by `093300`; `090100_student_group_owner_presence` **must not merge** (breaks `transfer_ownership()` silently — AI #10's executed decision, `docs/integration/backend-decision-memo.md` §2) | superseded / harmful | **EXTRACT** the guard shape into Phase 1; DROP the rest | nothing (reference only) |
| 13 | `integration/ai8-auth-subset` | `315ed95` | 51 | 1 | The approved subset of #12 (guard + NF-06) rebased on the trunk | as #12 minus two migrations | as #12 | NF-06 superseded by OD-01 | **EXTRACT** (Phase 1 reference), DROP | nothing |
| 14 | `integration/current-state-reconciliation` | `2d26a33` | 48 | 1 | AI #10's current-state gate from the tip | docs/integration | historical | — | **CHERRY-PICK** (doc) | `5b1ae23` |
| 15 | `integration/od-01-reconciliation` | `61e810c` | 46 | 2 | OD-01: remove `chat.thread` and `chat.support_case`, rehome task/handoff/attention/workload, C-2 family scope, C-4 admin presence in `AuthorizationService` | migration 094000, api authz/services, db/tests, unit specs | valid and the single most important domain reconciliation; its "77 integration tests pass" claim was **not reproducible** from the commit (harness and Prisma still referenced `thread`) | resolves the thread-vs-conversation fork; supersedes D-1 and NF-06 | **CHERRY-PICK** + complete in the API | `21afe5b`, `41d1767`, completed by `1b27075` |
| 16 | `integration/prd-reconciliation` | `ee0dcdd` | 48 | 3 | PRD reconciliation steps 1–2 (docs) and D-1 canonical role vocabulary + a fourth workload state (migration, api vocab, Admin Web capabilities) | docs/integration, migration 20260906130000, vocab.ts, admin-web | docs valid; the role migration reads `chat.thread`/`chat.support_case` (breaks after OD-01) and mixes role vocabulary with workload machinery | competes with the uncommitted AI #4 role migration; both superseded by `AUTHORIZATION-MODEL.md` | **CHERRY-PICK** the two docs; **REWRITE** the role migration in Phase 1 | `1aecbc3`, `07f1889` |

Summary: 16 branches → 5 cherry-picked in part or whole (#5, #7, #11, #15, plus
5 doc-only commits from #8, #9, #14, #16), 4 extracted as reference documents
(#3, #4, #12, #13), 3 dropped as duplicates or empty (#2, #6, #10), and #1
became the integration line. **Zero branches merged wholesale.**

---

## 3. Topology after reconciliation

```
main (eeca866)
 └── integration/recovery ── linear, 0 merge commits
       148b7a2  freeze point (= archive/phase0/freeze-148b7a2)
       5eae5a3  recover(qa,db): AI #9's RT-023/024/025 closure
       15ff3fc  chore(repo): untrack vendor/generated files, anchored .gitignore
       e064d3d  recover(docs,mobile): untracked decision records + mobile test
       c8f933a…07f1889  five doc-only cherry-picks
       afbf01d  recover(docs): reference docs extracted from archived branches
       1ad4ee9  test: RT-028 deterministic privacy assertion   (from integration/ai2-audit)
       21afe5b  feat(db,authz): OD-01                           (from integration/od-01-reconciliation)
       41d1767  test(db): OD-01 deterministic type assertion   (same)
       1b27075  feat(api,db): complete OD-01 in the API
       38b2b3b  feat(db): organization_id on every root entity (from ai4/rbac-canonicalization)
       755e870  fix(realtime): D-2 outbox delivery              (from feat/ai7-runtime-fixes)
       8dcb43e  fix(api): RT-001 containment guard
       1ee7a2c… Phase 0 canonical documents
```

Branches: `main`, `integration/recovery`. Worktrees: 1. Tags: 17 under
`archive/phase0/`. Remotes: still none (pushing is a decision for the owner).

---

## 4. Commits deliberately NOT taken, and why

| Commit | Branch | Reason |
|---|---|---|
| `216ab93` D-1 author validation | #11 | superseded: OD-01 removes `chat.thread`, the root cause |
| `16857af` D-6 authentication | #11 | Phase 1 scope by the Phase 0 brief; preserved as the Phase 1 baseline |
| `80765dc` / `315ed95` guard + NF-06 + triggers | #12, #13 | NF-06 superseded by OD-01; `090100` breaks ownership transfer; `090200` superseded by `093300`; guard is Phase 1 |
| `950e2a3` audit branch migrations | #5 | duplicates of the platform migrations plus a competing BR-1 hardening; the trunk's `093300` is the verified control |
| `ee0dcdd` role migration | #16 | reads dropped tables; role vocabulary is locked in `AUTHORIZATION-MODEL.md` and implemented in Phase 1 |
| `118501b`…`dca3863` Core ingestion + org model | #4 | thread-era base, colliding migration numbers, competing tenancy model; re-implemented later against the canonical schema |
| `f9f3eca` | #6 | identical patch to `72a5f29` |

---

## 5. How to recover anything from this ledger

```bash
git tag -l 'archive/phase0/*'                      # every archived head
git log archive/phase0/feat/ai7-runtime-fixes -3   # inspect
git cherry-pick -x <sha>                           # bring a commit forward
```

Tags are annotated; `git show archive/phase0/<branch>` prints the reason.
