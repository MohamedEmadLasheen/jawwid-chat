> **STATUS: HISTORICAL** (Phase 0, 2026-09-07). Executed and superseded by `docs/recovery/PHASE-0-BRANCH-LEDGER.md`.
> Canonical index: `docs/README.md`.

# Jawwid Chat — Branch Reconciliation Plan

Date: 2026-09-05 · Owner: AI #10 · Status: **PLAN — no merge is authorised by this document**
Prerequisite reading: `database-decision.md`, `docs/qa/authoritative-scope.md`

> ## No branch may be merged on the strength of a clean `git merge`.
>
> `git merge-tree feat/infrastructure feat/backend-foundation` reports **zero
> textual conflicts**. That is the danger signal, not the all-clear: the two
> stacks do not collide because they write to *different schemas*
> (`chat` vs `public`). Merging them today produces one database containing two
> disjoint, mutually unaware definitions of `staff`, `family`, `contact`,
> `config`, `event_log`, `audit_log`, `thread` and `message`, both live, neither
> aware of the other. **Git cannot detect this class of conflict. Only this
> document gates it.**

---

## 1. Branch topology (verified 2026-09-05)

| Branch | Head | Ancestry |
|---|---|---|
| `main` | `eeca866` | ancestor of all others |
| `feat/backend-foundation` | `3c2c9a6` | **diverged** — 4 unique commits |
| `feat/communication-engine` | `be77391` | **fully contained** in `feat/infrastructure` (`git merge-base --is-ancestor` → true; 0 unique commits) |
| `feat/infrastructure` | `df528ee` | the de-facto integration branch — carries 7 of 9 agents' work |

---

## 2. Reconciliation table

| Branch | Purpose | Valid Work | Superseded Work | Conflicts | Dependencies | Recommendation |
|---|---|---|---|---|---|---|
| **`main`** | Trunk / integration target | Repository init, `.gitignore`, the PDF brief as a **historical artifact** (its operating-model chapter is still the best written record of ownership, coverage, attention and workload) | `README.md` points to `docs/brief/JAWWID_CHAT_BRIEF.md`, a path that does not exist; root `package.json` is AI #2's superseded pre-monorepo manifest | none | — | **KEEP** as the integration target. Fix the README path and delete the root `package.json` (already deleted in the working tree) at first merge. |
| **`feat/backend-foundation`** | Authoritative database: schema, migrations, coverage/ownership/attention/workload engines, SQL test harness | **Substantial and high quality — the largest body of correct work in the repo.** 9 migrations; `chat.on_duty()`, `coverage_chain()`, `effective_handler()`, `extend_stickiness()`; `transfer_ownership()` with in-transaction audit; `guard_owner_change()`, `apply_owner_lock()`, `offboard_staff()`; attention signals/score/bucket and workload units/score/level, all config-driven; append-only `event_log`/`audit_log`; `chat.forbid_mutation()`; a real migration ledger; executable SQL tests for coverage, ownership, attention and workload | Four specific items, listed in §3: **(a)** the Core-database premise, **(b)** `thread.family_id UNIQUE`, **(c)** `staff.role` without teacher, **(d)** no Student Group / approval / call / device-token / reminder tables | **With `feat/infrastructure`:** competing schema authority (Prisma), competing `config` semantics (raise vs silent default), competing `contact.can_message` default (`false` vs `true`), competing thread/message definitions. **With PRD v0.1:** one thread per family; teacher not an actor. **With `database-decision.md`:** `auth.uid()`, `auth_user_id`, Core CHECK mirroring, `chat.core_*` views | `database-decision.md` D-4 makes this the authority. Blocks on nothing; everything else blocks on it | **KEEP AS THE DATABASE AUTHORITY — REWORK BEFORE MERGE.** Four targeted corrections (§3), then merge as the *first* integration step, because every other component's data contract depends on which schema wins. |
| **`feat/communication-engine`** | Historical — AI #2's engine + the first QA scope findings | All of it. `authoritative-scope.md` and `defects.md` originate here | none unique | none — it is an ancestor | Already merged by ancestry | **DISCARD THE BRANCH, NOT THE WORK.** 0 unique commits; every commit is already on `feat/infrastructure`. Delete the ref after `feat/infrastructure` is merged, so nobody branches from a stale pointer. |
| **`feat/infrastructure`** | De-facto integration branch: Admin Web, Flutter apps, NestJS/Prisma engine, infra, CI, and the QA / design / product-ops / red-team documentation sets | Admin Web (builds, 319 kB); Flutter parent+teacher app incl. `CommunicationPolicy` and its tests; the communication engine's **service layer** (message sequencing under row lock, idempotency, monotonic receipts, transactional outbox, explicit DTO mappers, phone-privacy-by-construction); `docker-compose.yml`, `Dockerfile`, env manifest, `check-env.sh`, `scan-secrets.sh`, backup/restore scripts; `.github/workflows/ci.yml`; the QA, design, product-ops and red-team doc sets — the strongest documentation in the project | `apps/api/prisma/schema.prisma` as a **schema authority** (Prisma stays as a query client only); `prisma:push`; §C `/// DESIGN-ONLY` Student Group / approval / call models; `AppConfigService` silent-default semantics; `db/test/00_core_shim.sql` and the CI step that applies it | **With `feat/backend-foundation`:** the whole of RC-06/RC-07. **Internal:** admin and mobile have incompatible auth, idempotency headers, casing and realtime vocabularies (RC-03/RC-04) | Its data layer depends on which schema wins; its client contracts depend on an API that does not exist | **KEEP as the integration branch — REWORK the data layer.** Do not merge `feat/backend-foundation` *into* it until §3 corrections land, or the merge silently creates the two-schema database. |

---

## 3. Required rework on `feat/backend-foundation` before it may be merged

Each is small, none is a rewrite, and none discards the engines.

| # | Rework | Why | Owner |
|---|---|---|---|
| **BF-1** | Remove the Core-database premise: migration headers, `auth.uid()` in `chat.current_staff_id()`, `chat.staff.auth_user_id` as a Core identity, the verbatim `public.subscriptions.status` CHECK mirror, the promised `chat.core_*` views, and `db/test/00_core_shim.sql` (plus the CI step that applies it) | `database-decision.md` D-1/D-2/D-6. Chat runs on its own database; `auth.uid()` does not exist there, so `chat.current_staff_id()` returns NULL and every owner guard silently misattributes | AI #1 |
| **BF-2** | Replace `chat.thread.family_id uuid not null unique` with a typed conversation model: an explicit `kind` and an explicit participant set, sufficient to represent Parent↔Admin 1:1, Teacher↔Admin 1:1 and Student Group **concurrently**, including two Student Groups for a two-child family | PRD v0.1 correction C-2 / JC-002. The UNIQUE constraint is the superseded brief's "cases never create a second thread" invariant, and it makes BR-1's *permitted* channel unrepresentable | AI #1 + AI #2 |
| **BF-3** | Make Teacher a first-class authenticated actor, authorized independently of CS back-office staff, who can never obtain a 1:1 channel to a parent | JC-003. QA specifies the behaviour, not the table design | AI #1 |
| **BF-4** | Add the missing MVP entities: Student Group + membership, approval (state + mandatory rejection reason), call session/participant/outcome (**no phone number anywhere**), device/push token, reminder schedule | JC-001 / scope correction C-3 | AI #1 + AI #2 |

**Explicitly preserved through all four:** `on_duty()` and the coverage chain,
`transfer_ownership()` and the owner guards, `offboard_staff()`, attention and
workload, append-only logs, `forbid_mutation()`, the config table and its
fail-loud accessors, the migration ledger, and every SQL test. BF-2 changes the
thread's *shape*; it does not touch the operating model built around it.

---

## 4. Work that survives from the superseded brief

Per instruction 8, origin is not a verdict. These were built from the superseded
PDF and are **kept**, because PRD v0.1 carries the same concepts forward:

`chat.config` and config-driven constants · `chat.staff` · `chat.shift` ·
`chat.coverage_rule` · `chat.absence` · `chat.family` · `chat.contact` capability
flags · `chat.learner` · `chat.subscription` (as a boundary-fed mirror) ·
`chat.family_note` · `chat.support_case` · `chat.task` · `chat.handoff` ·
append-only `event_log`/`audit_log` · `on_duty()` · attention · workload ·
permanent ownership · Unattended · handoff cards · manager dashboard.

The brief's **operating-model chapter remains the best written description of the
product's operations.** It is its **communication chapter** that is superseded.

Equally preserved on the application side, despite having been written against
the same brief: message sequencing under a row lock, client-message-id
idempotency, monotonic receipt transitions, the transactional outbox, explicit
DTO field enumeration, `Actor` carrying no phone/email/address, `on_behalf_mode`
derived rather than trusted, and the Flutter `CommunicationPolicy` correctly
labelled defence-in-depth.

---

## 5. Merge sequence (not authorised to execute yet)

Ordered so that no step can silently create a second implementation.

| Step | Action | Gate that must pass first |
|---|---|---|
| 0 | Publish this plan; freeze new schema work on both stacks | — |
| 1 | BF-1 lands on `feat/backend-foundation` | CI `migrations` job green **without** the Core shim |
| 2 | Remove Prisma as a schema authority on `feat/infrastructure`: delete `prisma:push`, reconcile `schema.prisma` to the SQL schema (or introspect it), delete the §C `DESIGN-ONLY` models | `apps/api` typecheck + unit green; no `prisma migrate`/`db push` anywhere |
| 3 | Merge `feat/backend-foundation` → `feat/infrastructure` | Steps 1–2 complete. **A reviewer confirms in writing that the merged tree contains exactly one definition of each of `staff`, `family`, `contact`, `config`, `event_log`, `audit_log`, `thread`, `message`.** A clean `git merge` is not that confirmation |
| 4 | BF-2/BF-3/BF-4 land on the merged branch | JC-001/002/003 acceptance criteria in `blockers.md` |
| 5 | Merge to `main`; delete `feat/communication-engine` and `feat/backend-foundation` refs | RC-01/RC-02 resolved — `main` should not carry a system that cannot start |

---

## 6. What must NOT be merged, under any schedule

1. **Both schema stacks.** Not simultaneously, not "temporarily", not behind a flag.
2. **`db/test/00_core_shim.sql`, or any fixture that fabricates Core's `auth`/`public` tables inside Chat's database** — including the CI step that applies it today.
3. **Any `chat.core_*` view over another product's schema.**
4. **`prisma db push` / `prisma migrate` / a second migration directory.**
5. **The §C `/// DESIGN-ONLY` Student Group, approval and call models as-is.** They are the right entities with the wrong status; they must be implemented against the authoritative schema, not merged as declarations.
6. **`thread.family_id UNIQUE`** into any branch that must satisfy PRD v0.1.
7. **A second authorization matrix**, for calling, groups, search or notifications. There is exactly one `AuthorizationService`, and it governs messaging *and* calling.


---

## 8. Empirical validation (2026-09-05, superseding parts of §2 and §4)

The plan above was written from static inspection. It was then **executed against
a real database**, which corrected it. Recording both, because the correction is
the useful part.

### 8.1 The working tree alone does not apply

```
$ scripts/db/integration-db.sh reset      # working-tree migrations only
  apply   20260905093000_chat_communication
ERROR:  relation "chat.family" does not exist
```

`feat/infrastructure` cannot build a database by itself. Its communication
migration references `chat.family`, `chat.thread`, `chat.learner` and
`chat.staff`, which exist only on `feat/backend-foundation`. **Reconciliation is
not optional housekeeping — it is a hard prerequisite for any integration
environment.**

### 8.2 The combined set DOES apply, in filename order

All migrations from both branches apply cleanly from empty, once
`db/integration/00_identity_stub.sql` supplies `auth.uid()` and
`01_core_boundary_stub.sql` supplies the four Core tables. The two lineages are
**mergeable**; they were never as divergent as the static view suggested.

### 8.3 Corrections to §2 and §4

| Claim | Status |
|---|---|
| **R-1** two competing `chat.message` definitions | **RESOLVED by AI #2**, uncommitted in the working tree. `093000` now does `alter table chat.message add column conversation_id` instead of creating its own. |
| **R-2** two conversation models | **RESOLVED.** `conversation` is layered *onto* `thread`, not opposed to it. |
| `090400` DISCARD | **REVERSED → KEEP.** It is now a dependency of `093000`. |
| **R-5** engines must be repointed at `conversation` | **REDUCED.** The engines keep reading `thread` / `support_case`, which survive. Still needs review, no longer a rewrite. |
| **R-3** duplicate logs | **CONFIRMED AND WORSE — now JC-010 (P0).** `create table if not exists` makes the conflict *silent*: AI #1's definition wins, AI #2's is skipped, and code writing `actor_kind` fails only at runtime. |
| **R-7** Core coupling | **CONFIRMED, and narrowed.** The whole `auth` surface is one `auth.uid()` call in `090700`. But a **new** migration, `090900_chat_core_integration`, adds `chat.core_*` views over `public.profiles`/`children`/`subscriptions`/`payments` — a live violation of the database decision, and `091200_chat_rls` depends on it, so it is not isolable. |
| **R-8** BR-1 trigger gap | **CONFIRMED by reproduction — now JC-008.** |

### 8.4 Migrations that appeared during this pass

`feat/backend-foundation` is moving quickly. Between the first and last run:
`090900_chat_core_integration`, `091000_chat_message_idempotency`,
`091100_chat_authorization`, `091200_chat_rls`,
`091300_chat_policy_helper_privileges`.

The plan is therefore a **snapshot**. Re-run `scripts/db/integration-db.sh reset`
before executing the merge; it is the cheapest way to detect a new conflict.

### 8.5 Revised bottom line

Reconciliation is **substantially less risky than §2 implied**, because AI #2
converged toward AI #1's model on their own. The remaining blockers are:

1. **JC-010** — reconcile the duplicate logs. *Must be fixed before merge*; it is
   silent, and a clean merge will hide it.
2. **JC-008** — close the BR-1 trigger gap.
3. **JC-009 / DB-2** — decide the Core boundary. `090900` currently violates the
   database decision and `091200` depends on it.

Nothing here changes the standing instruction: **no automatic merge.**
