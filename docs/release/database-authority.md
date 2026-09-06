# Database Authority

Date: 2026-09-06 · Auditor: AI #4 · Status: 🔴 **BLOCKED**
Gate: remains BLOCKED until a clean database can be created from zero via one authoritative path.

## 0. Product boundary

Jawwid Chat is an **independent product**. It owns its own PostgreSQL, its own
persistence and its own migration system. It does **not** use Second School's
database, and it does not use Jawwid Core as its store. Second School artifacts
were not consulted in this audit.

Jawwid Core remains an **external system of record** for financial/enrolment
facts, reached across a defined boundary — not a schema Jawwid Chat writes into.
That boundary is still undefined (E-10 / RC-12).

## 1. Candidate schema and migration paths

| # | Path | Location | Target | Migration ledger | Verdict |
|---|---|---|---|---|---|
| A | SQL migration series | `supabase/migrations/*.sql` (5 files) | schema `chat` | `chat.schema_migrations` via `scripts/db/apply.sh` | **AUTHORITATIVE (candidate)** — but cannot apply from zero |
| B | Prisma schema | `apps/api/prisma/schema.prisma` | schema `chat` (`multiSchema`, `schemas = ["chat"]`) | **none — no `prisma/migrations/`** | **NOT an authority** — no history, no down path |
| C | Test/integration stubs | `db/test/00_core_shim.sql`, `db/integration/00_identity_stub.sql`, `01_core_boundary_stub.sql` | `chat` + stubbed platform | n/a | **Harness only** — must never run in staging/production |
| D | Infra DB init | `infra/docker/postgres-init/10-app-role.sh` | role/grant bootstrap | n/a | **Complementary** — role creation, not schema |
| E | Seed/scripts | `scripts/db/apply.sh`, `integration-db.sh`, `test-db.sh` | — | — | **Tooling** |

## 2. Material change since the last audit — one finding is now stale

My `integration-risk-register.md` RR-02 recorded *"two databases claiming the
same entities — Prisma targets `public`, SQL targets `chat`."*

**That is no longer true.** `schema.prisma` now declares
`previewFeatures = ["multiSchema"]` and `schemas = ["chat"]`. Both stacks now
target the **same schema**. The dual-*schema* divergence is **RESOLVED**.

I am recording this prominently because acting on the stale version would cause
someone to "fix" a problem that no longer exists — which is exactly the failure
mode this reconciliation gate is meant to stop.

## 3. What still blocks

| ID | Blocker | Evidence | Owner |
|---|---|---|---|
| **DA-1** | **The migration series cannot apply to an empty database.** `scripts/db/test-db.sh reset` **fails**. The series omits platform tables it depends on; AI #9 had to create them in a scratch harness (deliberately uncommitted) to run RT-024/RT-025 at all. | AI #9 **RT-023 · P0 · runtime-confirmed** | AI #1 |
| **DA-2** | **Two migration authorities remain.** Path A has a real ledger; Path B has a generated client and **no migration history at all**. `prisma db push` is not a migration strategy — no ordering, no down path, no reproducibility. | `ls apps/api/prisma/migrations` → absent | AI #1 + AI #2 |
| **DA-3** | **Running code targets a schema without the BR-1 backstop.** | AI #9 **RT-026 · P0** | AI #1 / AI #2 |
| **DA-4** | **The BR-1 trigger is bypassable** (see `domain-reconciliation.md` §4). | AI #9 **RT-024 · P0 · runtime-confirmed** | AI #1 |
| **DA-5** | Jawwid Core boundary undefined — no view, no sync job, no contract. | RC-12 / E-10 | AI #1 |

## 4. Recommended authority (decision required — not taken here)

**Path A (SQL series + `chat.schema_migrations`) is the only candidate that can
be an authority**, because it is the only one with an ordered, recorded ledger
and the only one carrying the BR-1 database backstop.

Prisma should be demoted to **client generation only** — introspecting a schema
that migrations own — or promoted with a real `prisma/migrations/` history. It
cannot stay as it is: a schema definition with no way to apply itself
reproducibly.

**This is AI #1's decision to ratify, not mine.** I am recording the audit, not
selecting the authority.

## 5. Exit criteria for this gate

- [ ] `scripts/db/test-db.sh reset` succeeds against an empty database (closes DA-1/RT-023)
- [ ] Exactly one migration authority, written down and enforced in CI
- [ ] Fresh-DB test: empty → migrate → API starts
- [ ] Upgrade test: populated → migrate → data valid
- [ ] BR-1 backstop present in the schema the running code actually targets (DA-3)
- [ ] BR-1 backstop not bypassable by mutation (DA-4)
- [ ] Test/integration stubs provably excluded from staging and production

Until every box is ticked this document stays **BLOCKED**.
