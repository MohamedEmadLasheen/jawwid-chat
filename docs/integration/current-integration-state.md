# Current Integration State

Date: 2026-09-06 · Owner: AI #10 · Type: **RECONCILIATION GATE — no implementation**
Integration line: **`feat/infrastructure` @ `d236ce3`**
Method: pristine detached checkout of `d236ce3`, empty **stock `postgres:17`** (no Supabase
image, no Core shim, no pre-seeding, no manual schema), migration chain applied from zero,
suites executed. Nothing below is taken from another agent's report.

Legend: **GREEN** executable evidence verified · **YELLOW** partially verified ·
**RED** missing/broken · **OPEN** product/architecture decision.

---

## 1. Git state — **RED**

**Nothing is merged. Every branch is branch-only.**

| Commit | Subject | Branch | Reachable from `d236ce3`? |
|---|---|---|---|
| `80765dc` | fix(api,db): close NF-08, NF-06, RT-025, RT-024 calling bypass | `fix/ai8-p0-blockers` | **NO** — base `03d4119`, ahead 1 |
| `f9f3eca` | feat(db): organization_id on every root entity (PRD §2.3) | `ai4/p1-canonical-foundation` | **NO** — base `03d4119`, ahead 1 |
| `72a5f29` | feat(db): organization_id on every root entity (PRD §2.3) | `ai4/rbac-canonicalization` | **NO** — base `d236ce3`, ahead 1 |
| `be5a508` | feat(db,authz): OD-01 conversation model | `integration/od-01-reconciliation` | **NO** — base `03d4119`, ahead 1 |
| `61e810c` | test(db): deterministic OD-01 type assertion | `integration/od-01-reconciliation` | **NO** — base `03d4119`, ahead 2 |

Also branch-only: `e42051e` (core-integration-boundary, ahead 10), `fb3fc1c`
(backend-foundation, ahead 7), `ee0dcdd` (prd-reconciliation, ahead 3), `4b2d3a5`
(ai7-runtime-fixes, ahead 2), `135ff55` (auth-decision-gate, ahead 1).

**Classification**
- **merged:** none.
- **reachable:** none of the four named commits.
- **branch-only:** all ten heads above.
- **duplicated / equivalent:** `f9f3eca` and `72a5f29` have the **same `git patch-id`
  (`976f5507fb80a85d`)** — byte-identical organization work applied to two different bases.
  One of the two must be dropped, not merged twice.
- **superseded:** `main` @ `eeca866` (docs only); `feat/communication-engine` @ `be77391`
  (0 unique commits — fully contained in the integration line).

Eleven worktrees are live against one repository.

## 2. Migration state — **GREEN** (chain is whole and idempotent)

Empty stock `postgres:17`, 0 pre-existing tables → `scripts/db/apply.sh`:

| Measure | Value |
|---|---|
| Migrations applied | **19** |
| Ledger rows (`chat.schema_migrations`) | **19**, order matches filename order exactly |
| Re-apply | **0 re-applied** (G-19 holds) |
| Tables (`chat`) | **39** |
| Views (`chat`) | **7** |
| Functions (`chat`, prokind=f) | **65** |
| Policies (`chat`) | **38** |
| Triggers (`chat`, non-internal) | **30** |

Range: `20260905090000_chat_foundation` … `20260905093200_chat_shared_logs`.
RT-023 is closed: the chain builds an empty database with no crutches.

## 3. Organization / tenancy — **RED (absent)**

Verified against the live gate database:

```
chat.organization table          : does not exist
columns named organization_id    : 0
migration matching '%organization%' in ledger : 0
```

**`20260906120000_chat_organization.sql` is NOT on the integration line.** It exists only on
`ai4/p1-canonical-foundation` (`f9f3eca`) and, identically, on `ai4/rbac-canonicalization`
(`72a5f29`) — 228 lines of migration plus `db/tests/tenant_isolation.sql` (193 lines) and a
Prisma delta.

The earlier report of "organization_id on 23/23 root entities, 9/9 tenant isolation tests"
describes **that branch**, not the integration line. Both statements are true of different
trees. The organization foundation is **unmerged**; per instruction it was not implemented
here, and no second migration was created.

## 4. OD-01 conversation model — **RED (absent from the integration line)**

| Artefact | On `d236ce3`? |
|---|---|
| `20260905094000_chat_od01_conversation_reconciliation.sql` | **ABSENT** |
| `db/tests/od01_conversation_model.sql` | **ABSENT** |
| `br1-admin-presence.spec.ts` | **ABSENT** |
| `BR1_ADMIN_PRESENCE_REQUIRED` | **0 files** |
| `liveMembersOf` / `requireAdminPresence` / `LiveMember` | **0 files** |

Live database confirms the pre-OD-01 shape: **`chat.thread` and `chat.support_case` both
still exist**, alongside `chat.conversation` and `chat.conversation_member`.

The OD-01 12/12 result was re-checked and **is not claimed for this tree** — the tests do not
exist here to run. It remains valid only on `integration/od-01-reconciliation`.

## 5. Authentication — **RED (absent)**

Searched `apps/api/src` on the integration line:

```
JwtService 0 · passport 0 · @nestjs/jwt 0 · AuthController 0
auth/login 0 · verifyToken 0 · bcrypt 0 · argon2 0
```

`realtime.gateway.ts:57` — `const actorId = String(client.handshake.auth?.actorId ?? '')`.
**Socket identity is still client-declared. RT-001 (complete authentication bypass at the
only live entry point) is OPEN on the integration line.**

Authentication exists only on `fix/ai8-p0-blockers` (`80765dc`): `access-token.ts`,
`authenticated.guard.ts`, `authentication.service.ts`, plus `nf008-authentication.spec.ts`.
Unmerged.

## 6. Teacher identity — **RED**

`chat.teacher` **does not exist**. Identity tables present: `account`, `staff` only.
`ActorKind.TEACHER` exists in `vocab.ts` and the authorization matrix reasons about
teachers, but **no teacher can authenticate or be resolved** — the actor kind has no
identity behind it. JC-003 is open on the integration line.

## 7. RBAC — **YELLOW · blast radius has CHANGED**

Measured on the live gate database. **The known figure of "12 policies, 7 functions" is now
12 policies and 9 functions.**

Role vocabulary in the database:
`chat.staff.role CHECK ∈ (admin, coverage, manager, finance, technical, academic)` —
**no `super_admin`, no `coverage_admin`**, both of which PRD §3 names.

**12 policies** referencing a role literal:
`contact_edited_by_admins` · `event_log_visible_to_staff` · `family_edited_by_admins` ·
`family_note_visible_to_staff` · `family_note_written_by_admins` ·
`handoff_written_by_admins` · `learner_edited_by_admins` · `message_written_by_staff` ·
`case_edited_by_admins` · `task_created_by_admins` ·
`task_updated_by_assignee_or_admins` · `thread_edited_by_admins`

**9 functions** referencing a role literal:
`assign_family_owner` · `guard_owner_locked_case_closure` · `is_manager` · `may_assist` ·
`offboard_staff` · `staff_can_see_family` · `staff_may_send` · `transfer_ownership` ·
`workload_units`

Application layer — **4 files**:
`platform/authorization.service.ts` (lines 234, 355) ·
`communication/messages/message.service.ts` (558) ·
`communication/approvals/approval.service.ts` (48) ·
`communication/contracts/vocab.ts` (18–23, 57, 87)

Client layer: `apps/admin-web/src/shared/types/domain.ts` declares
`admin|coverage|manager|finance|technical|academic|**system**` — it has `system` (not a PRD
role) and **does** carry `super_admin` in `capabilities.test.ts`, so the admin client and the
database disagree in both directions.

**Note for whoever does the RBAC work:** two of the nine functions
(`guard_owner_locked_case_closure`, `workload_units`) and two of the twelve policies
(`case_edited_by_admins`, `thread_edited_by_admins`) are attached to `support_case` /
`thread`, which OD-01 removes. **Sequencing RBAC before OD-01 means doing part of it twice.**

## 8. Realtime — **YELLOW**

Gateway, rooms, typing, presence, outbox and `outbox.worker.ts` all exist and the process
starts. **No end-to-end claim is made:** no authenticated client received an event through
the complete path, because there is no authentication to authenticate with (§5). Per the
instruction, realtime is not marked green on inspection alone.

## 9. Admin / Flutter compatibility — **RED**

Not re-tested in this gate (out of scope), but the schema-level contradiction is recorded:
the admin client's role union disagrees with the database (§7), and `Case` — which the admin
UI models (`CaseCards.tsx`, `caseApi`, `case.updated`) — is removed by OD-01, which is itself
unmerged. Flutter and Admin were deliberately not touched.

## 10. Security regression — **RED · two P0 BR-1 bypasses OPEN, proven by execution**

Suites on the integration line: **unit 84/84 pass** (6 suites), **integration 76/76 pass**
(3 suites). Those suites do **not** cover the two findings below — `db/tests/` does not exist
on this line at all.

Direct execution against the gate database:

| Attack | Result on the integration line |
|---|---|
| **RT-025** — `student_group` with a teacher + a parent and **zero admins** | **ACCEPTED.** `admins=0, members=2`. A private teacher↔parent channel wearing a group's name. **BR-1 violated. P0 OPEN.** |
| **RT-024 (conversation path)** — promote a legal group to `type='direct'` | **REJECTED** by `chat.enforce_conversation_type_immutable()`. **CLOSED.** |
| **RT-024 (calling path)** — promote a group `chat.call` to `type='direct'` | **ACCEPTED.** `call.type is now direct`. `call_type_immutable` **does not exist** on this line. **BR-1 violated. P0 OPEN.** |

Triggers present on the four BR-1 tables: `conversation_type_immutable`,
`conversation_member_br1`, `call_participant_br1`, `conversation_set_updated_at` — the
deferred cross-table backstop and `call_type_immutable` are absent.

Both open findings are fixed on unmerged work: the `20260905093300` backstop (working tree
only) and `80765dc`'s three migrations (`20260906090000/090100/090200`).

Tenant isolation: **not testable** — no organization_id (§3).
Authentication tests: **not present** on this line (§5).

## 11. Uncommitted peer work — **RED · 793 lines versioned on no branch**

| File | Owner | Integration line | Other branches | Verdict |
|---|---|---|---|---|
| `db/tests/schema_acceptance.sql` (161 lines) | AI #9 | absent | **none** | **Versioned nowhere.** Lost by any `git clean`. |
| `db/tests/br1_invariants.sql` (336 lines) | AI #9 | absent | **none** | **Versioned nowhere.** This is the BR-1 security harness. |
| `supabase/migrations/20260905093300_chat_br1_structural_backstop.sql` (296 lines) | AI #1 | absent | **none** | **Versioned nowhere.** Fixes RT-024-calling and RT-025. |
| `scripts/db/integration-db.sh` | AI #5 | **tracked** | on 6 branches | Modified in the main working tree; not duplicated. Stays with AI #5. |
| `apps/api/test/integration/schema-invariants.spec.ts` | AI #5 | **tracked** | on 6 branches | Same. Stays with AI #5. |

Nothing was staged or committed by this gate.

**This is the single most urgent item in the document.** 793 lines of security-critical work
— the entire BR-1 test harness and the backstop that closes two open P0s — exists only as
untracked files in one working tree, on a repository where eleven worktrees are active.

## 12. Open product decisions — **OPEN**

| # | Decision | Status |
|---|---|---|
| **Owner-locked closure** | **`owner-lock closure is NOT a PRD requirement`** — verified against the PRD alone. The PRD nowhere restricts who may resolve or close (grep for owner-only resolution: **no match**), and §5.2 states the opposite: *"Coverage admins act with the owner's permissions on that family for the duration of the window."* §7.5 defines `resolved` as a plain conversation state. The removed guard cited *"brief SS5"*, the superseded document. **Recorded, not implemented, and not to become a new feature.** |
| **PD-1** | Coverage-admin Student Group membership: permanent silent members vs window-joined. PRD §15.2 #4. **Unresolved — do not guess.** |
| **PD-2** | Parent-initiated Student Group calls. PRD §15.2 #5, §9 *"parent by policy"*. **Unresolved — do not guess.** |

## 13. Exact blockers

| # | Blocker | Severity | Evidence |
|---|---|---|---|
| **B-1** | 793 lines of BR-1 security harness + backstop versioned on **no branch** | **BLOCKER** | §11 |
| **B-2** | **RT-025 open** — teacher+parent group with no admin is accepted | **BLOCKER (P0)** | §10, executed |
| **B-3** | **RT-024 calling path open** — group call promotable to `direct` | **BLOCKER (P0)** | §10, executed |
| **B-4** | **RT-001 open** — socket identity is client-declared; no authentication anywhere | **BLOCKER (P0)** | §5 |
| **B-5** | Nothing merged; 10 branch-only heads, 11 live worktrees | **BLOCKER** | §1 |
| **B-6** | organization_id absent from the integration line, and **duplicated** across two branches with identical patch-ids | **BLOCKER** | §1, §3 |
| **B-7** | OD-01 absent; `thread` and `support_case` still live | **BLOCKER** | §4 |
| **B-8** | Teacher cannot authenticate — actor kind with no identity | **BLOCKER** | §6 |
| **B-9** | RBAC vocabulary disagrees across DB / API / admin client (`super_admin`, `coverage_admin`, `system`) | HIGH | §7 |

## 14. Recommended integration order

Ordered so nothing is done twice. **Each step ends with the gate in §2 and §10 re-run.**

1. **Commit the unversioned work** (B-1). AI #9 commits `db/tests/*`; AI #1 commits the
   `093300` backstop. Nothing else can be trusted while a `git clean` would delete the
   security harness. *This is not an integration step; it is a preservation step, and it is
   first.*
2. **Drop one of the duplicate organization branches** (B-6). `f9f3eca` and `72a5f29` are the
   same patch; keep the one whose base survives, abandon the other.
3. **Merge `fix/ai8-p0-blockers` (`80765dc`)** — closes RT-025, RT-024-calling and lands
   authentication. Re-run §10; B-2, B-3, B-4 must flip.
4. **Merge OD-01 (`be5a508`, `61e810c`)** — removes `thread` and `support_case`. Must precede
   RBAC, or two of nine functions and two of twelve policies get reworked twice (§7).
5. **Merge organization_id** (the surviving branch from step 2), then run
   `db/tests/tenant_isolation.sql` against the merged line.
6. **Then, and only then, RBAC canonicalization** against the post-OD-01, post-organization
   blast radius — which will not be 12/9.
7. Teacher identity (B-8), then realtime end-to-end with a real authenticated client.

## Runtime status — **GREEN**

Integration line, built and booted against the gate database:
`/health/live` **200** · `/health/ready` **200** with `database up (28ms)` and
`redis up (32ms)` · Nest started, routes mapped under `/api/v1` ·
`SIGTERM received; draining (grace 15000ms)` → `closed cleanly`.

The application starts and stops correctly. It is the **contents** of the line, not its
bootability, that block release.
