# CF-09 — Core Database Decoupling Audit

**Owner:** AI #8 (audit) · **Remediation owner:** AI #1, sequenced by AI #10
**Date:** 2026-09-06 · **Status:** **RELEASE BLOCKER**
**Governing decision:** Jawwid Chat is an independent product with its own PostgreSQL.
Jawwid Core integration is **API/webhook only**. Chat must never depend on Core database
objects.

**Target state:** the Chat database operates with **ZERO Core database objects**. A clean
PostgreSQL instance is sufficient to create the schema, run every migration, run the database
tests and start the API.

> **Scope discipline.** This is an audit and a disposition register. It designs no
> replacement mechanism, invents no business rule, and does not create a compatibility layer.
> Where the replacement requires a design choice, the choice is named as AI #1's and left open.

---

## 1. Complete occurrence register

Swept across the working tree and `feat/backend-foundation` (the branch holding the 14-migration
series). Every occurrence of `chat.core_*`, `public.profiles`, `public.children`,
`public.subscriptions`, `public.payments`, `auth.uid()`, `auth.users`.

### 1.1 Core business tables — the coupling itself

| # | Location | Occurrence | Disposition |
|---|---|---|---|
| **C-01** | `supabase/migrations/20260905090900_chat_core_integration.sql:13-19` | `create view chat.core_parent … from public.profiles p where p.role = 'parent'` | **REPLACE WITH API/WEBHOOK INTEGRATION** |
| **C-02** | same, `:21-27` | `create view chat.core_child … from public.children c` | **REPLACE WITH API/WEBHOOK INTEGRATION** |
| **C-03** | same, `:29-41` | `create view chat.core_subscription … from public.subscriptions s` + two correlated subqueries over `public.payments` | **REPLACE WITH API/WEBHOOK INTEGRATION** |
| **C-04** | same, `:116` | `create view chat.core_parent_awaiting_owner` — derived from C-01 | **REPLACE WITH CHAT-OWNED DATA** (an unowned-family worklist is Chat's own operational state, not a Core read) |
| **C-05** | same, `:123`, `:181` | `sync_family_from_core()`, `sync_learners_from_core()` — read the views above | **REPLACE WITH API/WEBHOOK INTEGRATION** — keep the functions' *shape*, change their **input** from a view to a payload |
| **C-06** | `supabase/migrations/20260905090000_chat_foundation.sql:3-7,17` | Header and schema comment: *"lives in the `chat` schema inside the Jawwid Core Supabase database … Reads Jawwid Core only via `chat.core_*` views"* | **LEGACY / DEAD** — the statement is now false; correct the text |
| **C-07** | `supabase/migrations/20260905090300_chat_family_domain.sql:159` | `chat.subscription.status` CHECK *"mirrors `public.subscriptions.status` verbatim so the boundary needs no translation table"* | **REPLACE WITH CHAT-OWNED DATA** — Chat owns its subscription vocabulary; the boundary translates. A verbatim mirror is a coupling that fails on a Core release (FS-26) |

**Assessment.** The entire Core read surface is **three views in one migration**. That
migration's own header anticipates this remediation — *"keeps the surface small enough to
re-point at an HTTP client or a separate database later without touching the domain."*
The design absorbed the change it now needs; this is a bounded change, not a rewrite.

### 1.2 What already has the right shape — preserve

| Object | Why it survives |
|---|---|
| `chat.core_event` + `record_core_event()` + `mark_core_event_processed()` | Already a webhook-ingestion table with idempotent processing. **This is the boundary**; it simply is not yet the *only* one |
| `chat.sync_state` | Chat-owned sync bookkeeping; needed more under API/webhook, not less |
| `chat.family.core_parent_id`, `chat.learner.core_child_id`, `chat.subscription.core_subscription_id` | **Correlation identifiers, not foreign keys.** They are Chat-owned columns holding an external id — the correct pattern for an API boundary. **Keep** |
| `chat.subscription`, `chat.learner` as tables | Already Chat-owned mirrors. Under the target state they stop being fed by views and start being fed by the boundary |

### 1.3 Supabase auth primitives

`auth.uid()` is a **Supabase authentication** primitive, not a Jawwid Core business object.
It is listed separately because the disposition depends on a decision AI #1 has not published.

| # | Location | Occurrence | Disposition |
|---|---|---|---|
| **A-01** | `20260905090700_chat_ownership_invariants.sql:21` | `chat.current_staff_id()` → `where s.auth_user_id = auth.uid()` | **REPLACE WITH CHAT-OWNED DATA** |
| **A-02** | `20260905091100_chat_authorization.sql:44` | `where app_user_id = auth.uid()` | **REPLACE WITH CHAT-OWNED DATA** |
| **A-03** | `20260905091200_chat_rls.sql:223,232,248,274,301` | five RLS policies keyed on `auth.uid()`; the file's own comment: *"`auth.uid()` … are the entire access control — keep them airtight"* | **REPLACE WITH CHAT-OWNED DATA** |

**Why these must change regardless of the auth decision.** A clean PostgreSQL instance has no
`auth` schema and no `auth.uid()`. RLS policies referencing it **fail at creation**, so §2's
independence gate cannot pass while they exist. Today this is masked by the test shim (T-01),
which is precisely the masking the gate is meant to remove.

**Open — AI #1's design choice, not named here.** How Chat's own session identity reaches the
database (a session GUC set by the API per request, a Chat-owned `auth` equivalent, or RLS
demoted to defence-in-depth behind the service). This is the undeclared authorization strategy
already tracked as **X-15**; CF-09 makes it urgent rather than theoretical. **This audit does
not choose it.**

### 1.4 Fabricated Core objects in test and CI fixtures

Instruction: *"Do NOT keep Core tables/views merely for tests."*

| # | Location | Occurrence | Disposition |
|---|---|---|---|
| **T-01** | `db/test/00_core_shim.sql` | Creates `auth.users`, `auth.uid()`, `public.profiles`, `public.children`, `public.subscriptions`, `public.payments` (15 hits) | **REMOVE** |
| **T-02** | `db/testkit/00_core_shim.sql` (`feat/backend-foundation`) | same fixture, 15 hits | **REMOVE** |
| **T-03** | `db/integration/01_core_boundary_stub.sql` | Recreates the four Core tables; its own comment concedes *"DB-2 replaces the `chat.core_*` SQL views with the approved integration"* | **REMOVE** |
| **T-04** | `db/integration/00_identity_stub.sql` | Supplies `auth.uid()` alone | **REMOVE** once A-01…A-03 land; it is the only remaining consumer |
| **T-05** | `db/testkit/02_fixture.sql`, `db/tests/integration.sql` (`feat/backend-foundation`) | 6 + 7 hits seeding Core rows | **REPLACE WITH CHAT-OWNED DATA** — fixtures seed `chat.*` directly, or drive the boundary |
| **T-06** | `scripts/db/test-db.sh:37-38` | Drops the four Core tables, then loads the shim | **REMOVE** both lines |
| **T-07** | `scripts/db/integration-db.sh:7,43-44` | Documents the shim as required | **REMOVE** |

**Why this matters more than it looks.** The shim is what makes the coupling invisible. Every
migration applies "cleanly" in CI *because CI fabricates Core first*. Removing the shim is not
cleanup — **it is the test that proves independence**, and it will fail loudly on first run.
That failure is the correct outcome and the measure of the remaining work.

---

## 2. CI independence gate

**Requirement:** a clean PostgreSQL instance must be sufficient to create the schema, run all
migrations, run database tests and start the API — with no fabricated Core auth, users,
profiles, children, subscriptions or payments.

### G-CORE-01 · No Chat object references a Core database object
```
grep -rInE "public\.(profiles|children|subscriptions|payments)|auth\.(uid|users)" \
     supabase/migrations db scripts
```
**PASS** = zero matches. Run on every push. This is the gate the instruction asks for:
*"Jawwid Chat database has no dependency on Jawwid Core database objects."*

### G-CORE-02 · Clean-Postgres migration
Start stock `postgres:<pinned>` — **not** Supabase, no shim, no `auth` schema, no `public`
seeding. Apply every migration in order. **PASS** = exit 0.
*Expected to FAIL on first run at A-03 (RLS policies referencing `auth.uid()`). That is the
point of the gate.*

### G-CORE-03 · Post-migration dependency assertion
After G-CORE-02, assert against the live catalog — cheaper to trust than a grep:
```sql
select count(*) from pg_depend d
  join pg_namespace n on n.oid = ...
 where n.nspname in ('public','auth');     -- expect 0
select count(*) from information_schema.views
 where table_schema='chat' and view_definition ~* '(public|auth)\.';   -- expect 0
```

### G-CORE-04 · Database tests on clean Postgres
Every `db/tests/*.sql` passes with no Core fixture loaded.

### G-CORE-05 · API boots against clean Postgres
Gated behind **RC-01** (no `main.ts`, no `AppModule`). Until the API has a process this gate is
**NOT TESTED**, which is graded identically to FAIL.

### G-CORE-06 · Prisma is a client only
```
grep -rn "prisma migrate\|prisma db push" .github apps/api/package.json scripts
```
**PASS** = zero matches. **Verified passing at `4ff47c3`:** CI runs `npx prisma generate` only
(`ci.yml:124`, `:232`). Keep it that way — this gate exists to stop a regression, not to fix
a defect.

---

## 3. Remediation sequence (for AI #10 to schedule — not started by AI #8)

1. **A-01…A-03** — decide and implement Chat-owned session identity; unblocks G-CORE-02.
2. **C-01…C-05** — replace the three views with Chat-owned tables fed by `chat.core_event`.
   `sync_family_from_core()` and `sync_learners_from_core()` keep their names and semantics and
   change their input from a view to a payload.
3. **C-07** — Chat owns its subscription-status vocabulary; the boundary translates and
   quarantines unknown values rather than rejecting rows (FS-26).
4. **T-01…T-07** — delete the shims. Fixtures seed `chat.*` or drive the boundary.
5. **C-06** — correct every migration header and comment asserting shared-database residency.
6. **G-CORE-01…06** — wire into CI; G-CORE-05 stays NOT TESTED until RC-01 clears.

## 4. Exit criteria

- [ ] G-CORE-01 passes: zero references to Core database objects anywhere
- [ ] G-CORE-02 passes: stock PostgreSQL, no shim, every migration applies
- [ ] G-CORE-03 passes: no catalog dependency on `public` or `auth`
- [ ] G-CORE-04 passes: database tests green with no Core fixture
- [ ] G-CORE-06 stays passing: no `prisma migrate` / `db push`
- [ ] Every mirrored entity has a named producer through the boundary and a visible `synced_at`
- [ ] No second compatibility layer was introduced anywhere
- [ ] AI #5 re-runs the release gate; **G-21 becomes evaluable for the first time**
