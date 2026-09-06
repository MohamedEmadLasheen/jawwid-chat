# Jawwid Chat — Release Scorecard

Owner: AI #10 · Date: 2026-09-05 · Intended stage: **Pilot**
Status vocabulary (§52): **PASS** · **FAIL** · **BLOCKED** · **NOT TESTED** · **UNVERIFIED** · **KNOWN RISK**
`PASS` is used only where AI #10 executed the verification.

# Current verdict: 🔴 NOT READY

Eleven blockers open (`blockers.md`). The application cannot start, so most gates
are not merely failing — they are **unexecutable**.

---

| Area | Status | Evidence | Blockers | Owner |
|---|---|---|---|---|
| **Product** | **UNVERIFIED** | PRD v0.1 is not on disk; scope is graded against `authoritative-scope.md` §3. Two conflicting owner reconciliations on record (OD-01) | RC-13 | Product owner |
| **Backend** | **FAIL** | Services typecheck and build (exit 0), but no `main.ts`, no root module, no controllers beyond `/health`. `dist/main.js` is never emitted | RC-01, RC-05 | AI #1, AI #2 |
| **Database** | **FAIL** | Two schema authorities in different schemas; decision issued (`database-decision.md`), not yet executed. SQL stack is strong: 9 migrations, real engines, executable SQL tests — on an unmerged branch | RC-06, RC-07, DB-1…DB-8 | AI #1 |
| **Authentication** | **FAIL** | Three incompatible positions (cookie / Bearer / none). Socket accepts a client-declared `handshake.auth.userId` — full authentication bypass at the only live entry point (RT-001 P0) | RC-03 | AI #1 |
| **Authorization** | **UNVERIFIED** | One centralized `AuthorizationService` with the right contract (PF-2). **JC-005 and JC-006 verified fixed by AI #10** — assertions intact, suite green. Cannot express conversation kind or participant set (RT-002 P0); manager attribution still client-chosen (RT-003) | JC-002, RT-003 | AI #1 |
| **Messaging** | **UNVERIFIED** | Sequencing under row lock, client-message-id idempotency, monotonic receipts, soft delete, explicit DTOs — all correct at the service layer, none reachable | RC-01, RC-05 | AI #2 |
| **Realtime** | **FAIL** | Gateway registered in no module. Admin and server event contracts are disjoint (3 overlapping names, 3 incompatible payloads, wrong namespace, CORS `origin:false`) | RC-01, RC-04 | AI #2, AI #4 |
| **Student Groups** | **FAIL** | `/// DESIGN-ONLY. Not implemented.` No table in the authoritative SQL schema. A two-child family cannot have two groups (G-F) | JC-001, JC-002 | AI #1, AI #2 |
| **Approvals** | **FAIL** | `MessageApproval` is `DESIGN-ONLY`; `ModerationStatus.PENDING/REJECTED` declared but unused | JC-001 | AI #2 |
| **Notifications** | **FAIL** | Tables, templates, rules, quiet hours and `dedupeKey` all modelled well. **No worker, no provider client, nothing drains the outbox** | RC-02 | AI #2 |
| **Tasks** | **BLOCKED** | `chat.task` exists in SQL on an unmerged branch; no service, no endpoint. Admin UI is complete against a contract nobody implements | RC-05, RC-06 | AI #1, AI #4 |
| **Ownership** | **BLOCKED** | `transfer_ownership()`, owner guards, `offboard_staff()` and SQL tests all exist — on `feat/backend-foundation`, which nothing runs | RC-06 | AI #1 |
| **Coverage** | **FAIL** | `on_duty()` + coverage chain implemented in SQL (unmerged). The running stub returns the owner. **The covering admin is not in the delivery audience** (RC-09) | RC-06, RC-09 | AI #1 |
| **Workload** | **BLOCKED** | Attention and workload engines implemented in SQL, config-driven, with tests — unmerged. Two headline attention signals are structurally dead pending Core sync (G-G) | RC-06 | AI #1 |
| **Calling** | **FAIL** | `DESIGN-ONLY`. No LiveKit client, no token issuance, no call authorization | JC-001 | AI #2 |
| **Storage** | **UNVERIFIED** | Signed-URL service + private-by-default bucket in compose; exercised by red-team unit tests, never against a live bucket | RC-01 | AI #2, AI #7 |
| **Mobile** | **BLOCKED** | Parent + teacher apps, `CommunicationPolicy` and tests all written. **Flutter/Dart SDK absent on every build host** — nothing compiles or runs. CI reports this honestly rather than hiding it | G-37 | AI #3, AI #7 |
| **Admin** | **UNVERIFIED** | Builds cleanly (319.70 kB / 97.30 kB gzip); complete inbox, family 360, tasks, coverage, dashboard. **Zero tests.** Every endpoint it calls is unimplemented | RC-04, RC-05 | AI #4 |
| **Core Integration** | **FAIL** | Must be an API/webhook boundary (D-6). No client, no receiver, no contract. Existing code assumes **database co-tenancy**, now prohibited. CI actively fabricates Core's tables inside Chat's test DB | DB-1…DB-6 | AI #1 |
| **Infrastructure** | **UNVERIFIED** | Strong: compose stack with health checks and a private bucket, multi-stage non-root Dockerfile with tini, env manifest with `forbid` guardrails, working `check-env.sh` and `scan-secrets.sh`. But the production template fails its own gate, and every cited `docs/infrastructure/*` file is missing | RC-08, RC-11 | AI #7 |
| **CI/CD** | **UNVERIFIED** | `ci.yml` now exists — secret gate, employee-name gate, Phase-2 scan, API and admin jobs, a migrations job with real Postgres asserting idempotency, and an explicit `mobile: BLOCKED` job. Never observed executing; no artifact, no deploy, no rollback | RC-11 | AI #5, AI #7 |
| **Observability** | **FAIL** | `SENTRY_DSN` and `OTEL_*` required in staging and production; **0 imports** in `apps/api/src`; 3 `new Logger()` calls total. Production cannot answer any of the eleven §31 questions | RC-11 | AI #7 |
| **Backups** | **NOT TESTED** | `backup-db.sh` and `restore-db.sh` now exist. No schedule, no retention policy, no monitoring, no RPO/RTO | RC-11 | AI #7 |
| **Recovery** | **NOT TESTED** | No restore has been rehearsed. No runbook for any of the eleven §32 incident classes | RC-11 | AI #7 |
| **Security** | **UNVERIFIED** | Genuinely strong controls: phone privacy by construction (**executing test**, P-4), append-only logs, deny-by-default authorization, no secrets in the tree (`scan-secrets.sh` clean), synthetic-fixture policy enforced in CI. Two P0s open against the entry point and the policy's type signature | RC-03, JC-002 | AI #1, AI #5 |
| **Red Team** | **PARTIAL / NOT TESTED** | Campaign 1 delivered: 15 findings (2×P0, 8×P1) with honest evidence grades. **AI #10 executed the runtime evidence: 2 suites, 12 tests, all passing.** Transport, queue, storage and chaos surfaces remain **NOT TESTED** because the app cannot boot — per instruction 10 this is not a pass | RC-01, RC-12 | AI #9 |
| **UX** | **UNVERIFIED** | Design system, bilingual EN/AR terminology, user journeys, cross-platform rules and 15 screen specs. Not implemented against a running system; terminology conflicts with shipped code (thread `RESOLVED` vs "a conversation is never resolved") | — | AI #6 |
| **Documentation** | **FAIL** | Documentation is the project's strongest asset — and it cites files that do not exist: `README.md` → `docs/brief/JAWWID_CHAT_BRIEF.md`; `.env.example` and `Dockerfile` → four `docs/infrastructure/*` files; the governing PRD itself | RC-13, RC-11 | All |

---

## Summary

| Status | Count |
|---|---|
| PASS | **0** |
| UNVERIFIED | 10 |
| FAIL | 12 |
| BLOCKED | 4 |
| NOT TESTED / PARTIAL | 3 |

**Zero areas are PASS.** One control passes at a single layer with executing
evidence (phone privacy). Two defects moved from FAIL to VERIFIED FIXED today
(JC-005, JC-006) — the first gates in this project to be closed by execution
rather than assertion.

## Sign-off model (§57) — none granted

| Area | Signatory | Status |
|---|---|---|
| Product | AI #8 / Product owner | **withheld** — PRD absent, OD-01…OD-05 open |
| Security | AI #5 + AI #9 | **withheld** — 2 P0 open; transport surface untested |
| Infrastructure | AI #7 | **withheld** — no observability, no rehearsed recovery, no runbooks |
| Architecture | AI #1 | **withheld** — dual schema authority; Core boundary violated |
| Communication | AI #2 | **withheld** — no HTTP surface, no outbox consumer |
| Mobile | AI #3 | **withheld** — toolchain absent; nothing executed |
| Admin | AI #4 | **withheld** — no tests; no backend |
| UX | AI #6 | **withheld** — not implemented |
| **Final integration/release** | **AI #10** | **🔴 NOT READY** |
