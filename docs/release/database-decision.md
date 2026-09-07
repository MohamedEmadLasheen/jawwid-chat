> **STATUS: REFERENCE** (Phase 0, 2026-09-07). The decision stands (Chat owns its database; single SQL migration authority). Its D-1..D-7 are *violations found*, now closed; see `docs/recovery/PHASE-0-DATABASE-RECONCILIATION.md`.
> Canonical index: `docs/README.md`.

# Jawwid Chat — Database Decision

Date: 2026-09-05 · Owner: AI #5 (release engineering)
Status: **DECIDED by the product owner. Not open for re-litigation.**

---

## 1. The decision

1. Jawwid Chat is **completely standalone** from Second School and from Jawwid Core.
2. Jawwid Chat **owns its own PostgreSQL database**.
3. Jawwid Chat **must not depend directly on Core's database** — no shared
   database, no cross-schema reads, no foreign keys into Core, no views over
   Core tables.
4. Jawwid Core integration goes through the **approved integration boundary
   (API / webhooks)**, never through SQL.
5. **SQL migrations under `supabase/migrations/` are the authoritative migration
   system.**
6. **No competing migration authorities.** Prisma must not own schema.

---

## 2. What the code assumes today (all of it contradicts §1)

Every item below is verified, with evidence.

| # | Current assumption | Evidence | Verdict |
|---|---|---|---|
| **D-1** | Chat lives *inside* Core's Supabase database | `20260905090000_chat_foundation.sql` header: *"It lives in the `chat` schema inside the Jawwid Core Supabase database. Core (the `public` schema) stays the source of truth… Jawwid Chat reads Core only through the `chat.core_*` boundary views"* | **VIOLATES §1.2, §1.3** |
| **D-2** | Actor identity is Core's Supabase auth | **14 references** to `auth.users` across `feat/infrastructure` migrations, e.g. `message.author_id uuid references auth.users (id) on delete restrict` | **VIOLATES §1.3** — a foreign key into another product's identity table |
| **D-3** | Core data is read via SQL views | `chat.core_*` boundary views | **VIOLATES §1.4** — integration must be API/webhook |
| **D-4** | Subscription vocabulary mirrors Core's table | `090300`: *"Mirrors `public.subscriptions.status` verbatim… If Core widens its vocabulary this CHECK must widen too"* | **VIOLATES §1.3** — schema-level coupling to Core's release cycle |
| **D-5** | The Core contract is Second School's schema | `db/test/00_core_shim.sql`: *"Column shapes are copied from **second-school's live migrations**"*, naming four specific Second School migration files | **VIOLATES §1.1** — Second School used as a schema dependency |
| **D-6** | Two schema authorities | `apps/api/prisma/schema.prisma` **and** `supabase/migrations/*.sql` both define the same tables | **VIOLATES §1.5, §1.6** |
| **D-7** | Test DB must be the Supabase image | `scripts/db/test-db.sh` pins `public.ecr.aws/supabase/postgres:17.6.1.140` *"so the auth schema… behave as they do in production"* | Consequence of D-2; blocks a plain-Postgres integration DB |

**None of this was unreasonable when written** — it followed the superseded
brief, which described a CS console co-located with Core. It is simply no longer
the product.

---

## 3. Required changes

### DB-1 · Chat owns its identity table (P0, blocks everything else)

Replace `auth.users` with a Chat-owned actor identity. Every `references
auth.users (id)` becomes a reference into Chat's own table.

**This is the change that makes the database standalone**, and it is a
prerequisite for a plain-Postgres integration environment. *Owner: AI #1.*

Constraint that must survive: the identity table carries **no phone, email or
other contact channel** — phone privacy is currently enforced by construction
and is guarded in CI (`no-contact-channel-columns.spec.ts`, gate G-07). Note
that an identity table is exactly where an `email` column is normally added; if
authentication requires one, it needs a privacy review and the redaction tests
of test-plan §14 in the same change.

### DB-2 · Replace `chat.core_*` views with the integration boundary (P0)

Core-sourced data (families, parents, learners, teachers, enrolments,
subscriptions) arrives via the approved API/webhooks and is **materialised into
Chat-owned tables**, with explicit sync state and a recorded `core_*_id` for
identity mapping.

Core remains the **source of truth** (INV-16); Chat holds a replica it does not
author. The `chat.core_*` **views** are removed; the boundary becomes a service.
*Owner: AI #1.* **UNVERIFIED — the approved boundary's transport, auth,
payloads and delivery semantics are not in any document available to QA. Must be
supplied before JC-01…JC-07 in the test plan can be written.**

### DB-3 · Decouple vocabularies (P1)

`subscription.status` must not mirror `public.subscriptions.status` verbatim.
Chat defines its own vocabulary and the boundary translates. Otherwise a Core
release silently breaks a Chat CHECK constraint. *Owner: AI #1.*

### DB-4 · Delete the Second School-derived shim (P1)

`db/test/00_core_shim.sql` and `db/testkit/00_core_shim.sql` are rebuilt as
fixtures of the **integration boundary payloads**, not of Second School's
tables. No file in this repository may cite a `second-school` migration as its
contract. *Owner: AI #1 + AI #5.*

### DB-5 · Single migration authority (P0)

`supabase/migrations/*.sql` is authoritative. `apps/api/prisma/schema.prisma`
becomes **client-generation only**:

- `prisma migrate` is never run against any environment.
- `prisma db push` is removed from `package.json` (it currently exists as
  `prisma:push` and can silently overwrite the SQL-defined schema).
- The schema file is introspected from the migrated database, or maintained
  strictly as a read model, and CI fails on drift.

*Owner: AI #1.* **Contract impact: AI #2** uses `@prisma/client` types
throughout — those keep working; only the authority changes.

---

## 4. Consequences for the integration test environment

With DB-1 and DB-5 done, the integration database is **plain `postgres:17`**:
no Supabase image, no `auth` schema, no Core shim.

Until DB-1 lands, the integration environment must still provide a minimal
`auth.users` stand-in, because 14 foreign keys demand it. That stand-in is
**test scaffolding for a known-violating state**, and it is removed by DB-1 —
it must not be mistaken for the target architecture.

This is recorded so the integration DB I build next is not later read as an
endorsement of the Core-coupled design.

---

## 5. Status

| Change | Severity | Owner | Status |
|---|---|---|---|
| DB-1 Chat-owned identity | P0 | AI #1 | OPEN |
| DB-2 Integration boundary replaces views | P0 | AI #1 | OPEN — **blocked**, boundary spec not available |
| DB-3 Decouple vocabularies | P1 | AI #1 | OPEN |
| DB-4 Remove Second School-derived shim | P1 | AI #1 + AI #5 | OPEN |
| DB-5 Single migration authority | P0 | AI #1 | OPEN |

Tracked collectively as **JC-009** in `docs/qa/defects.md`. Release gate **G-21**
(Core remains source of truth, Chat is not a second source of truth) stays
**FAIL** until DB-1, DB-2 and DB-5 are complete.
