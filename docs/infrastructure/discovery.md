# Infrastructure Discovery Report

Owner: AI #7 (Infrastructure / Deployment / Production Engineering)
Date: 2026-09-05 · Branch: `feat/infrastructure`
Method: direct inspection of the repository, the running containers and the live
databases. Peer reports were read but re-verified against files; where a peer
conclusion is now stale, that is stated.

---

## 1. What existed before this work

The repository is **not** a greenfield. Between 15:58 and 16:30 on 2026-09-05
five agents scaffolded in parallel, and the tree changed materially during this
discovery pass.

| Area | State found | Owner |
|---|---|---|
| Backend API | NestJS 11 + Prisma 6 under `apps/api`. Compiles. **No `main.ts`** — there is no bootstrap, so the API cannot start. | AI #1 / AI #2 |
| Database (A) | `supabase/migrations/*.sql`, applied by `scripts/db/apply.sh` into a `chat` schema, with its own ledger `chat.schema_migrations`. **Live and ahead** — 13 migrations, 31 tables. | AI #1 |
| Database (B) | `apps/api/prisma/schema.prisma`, 675 lines, `public` schema, separate Postgres on :5433. **Never applied** — that database holds no application tables. | AI #2 |
| Admin Web | React 18 + Vite 6 + TS under `apps/admin-web`. Core plumbing only, no routes yet. | AI #4 |
| Flutter | `lib/` with domain/model Dart files. **No `pubspec.yaml`.** Flutter and Dart SDKs are absent from this host. | AI #3 |
| Docs | `docs/{admin,mobile,qa,design}` — discovery reports and contract requests. `docs/architecture/` exists but is **empty**. | various |
| Infrastructure | **None.** No Dockerfile, no compose file, no CI, no environment template beyond two app-local `.env.example` files, no health endpoint, no deployment configuration, no backups. | — |

Local services were running, started by hand with `docker run`:

```
jawwid-chat-pg     postgres:16-alpine                    :5433    (AI #2, empty)
jawwid-chat-redis  redis:7-alpine                        :6380    (AI #2)
jawwid-chat-test   supabase/postgres:17.6.1.140          :55432   (AI #1, populated)
```

Nothing recorded how to recreate them. That is the first gap this work closes.

There is **no git remote**. CI and CD are written and validated as files, but
cannot execute until the repository is hosted.

---

## 2. Findings

### F-1 · Two migration authorities over one domain — **BLOCKING**

This is the most serious infrastructure problem in the repository, and it is
architectural rather than operational.

|  | AI #1 | AI #2 |
|---|---|---|
| Authority | `supabase/migrations/*.sql` | `apps/api/prisma/schema.prisma` |
| Runner | `scripts/db/apply.sh` | `prisma db push` / `prisma migrate` |
| Ledger | `chat.schema_migrations` | `_prisma_migrations` |
| Schema | `chat` inside the **Jawwid Core** database | `public` in a **standalone** database |
| Naming | `snake_case` | `camelCase` mapped via `@@map` |
| State | applied: 13 migrations, 31 tables | never applied, 0 tables |

They are not two views of one model; they are two different databases holding
overlapping entities. `chat.thread` and Prisma's `Thread` both exist, and they
disagree: the live `chat.thread` carries `UNIQUE (family_id)` — one thread per
family — while Prisma's `Thread` has a `kind` discriminator and no such
constraint.

AI #5 flagged the risk on 2026-09-05 while both directories were empty, calling
it "a contract-drift risk to watch… flagged, not yet a defect". **Both are now
populated. It is a defect.**

Infrastructure cannot resolve this — the data model is AI #1's domain and the
communication model is AI #2's. What infrastructure can do, and has done, is
refuse to pick a winner by accident:

- The deployment pipeline runs **`scripts/db/apply.sh` only**, because that is
  the authority that is actually applied to a live database today.
- The local stack ships **one** Postgres container, on the Supabase image, which
  is a superset able to host either model — so resolving F-1 does not also
  require rebuilding local development.

**Update, later the same day — the decision has been made.** The product owner
locked it (`docs/product-operations/database-divergence.md` §0): Jawwid Chat is
standalone, **owns its own PostgreSQL database**, has **one** authoritative
migration system — the SQL migrations — and integrates with Jawwid Core over an
API/webhook boundary rather than direct database coupling. That matches the
authority infrastructure had already inferred from the evidence (ADR-002), so no
pipeline changes were needed. AI #1 owns the reconciliation; AI #8 and AI #10
track it as a release blocker.

One infrastructure decision *was* reversed by the lock: the local Postgres image.
It was the Supabase image solely because Chat was believed to live inside Core's
database. That premise is gone, so the local stack is now plain
`postgres:17-alpine`, matching the image CI runs migrations against (ADR-001).

### F-2 · The API cannot start while Postgres is unavailable — for AI #1

`PrismaService.onModuleInit()` calls `$connect()` and does not catch. Verified
by booting the compiled application against an unreachable database:

```
BOOT FAILED: Can't reach database server at `localhost:5499`
```

The process exits instead of starting and reporting itself unready. During a
brief database blip, every replacement container crash-loops rather than waiting
in the "not ready" state the readiness probe exists to express — turning a
30-second database event into a full outage that outlives it.

Suggested fix (AI #1's call): let `$connect()` fail without aborting boot, and
let `/health/ready` report the database as down until it succeeds. The readiness
probe added in this branch already handles that case correctly.

### F-3 · A `chat`-schema backup is not restorable on its own — **verified**

A restore drill was run end to end. Dumping `--schema chat` and restoring it into
a fresh database **fails**:

```
pg_restore: error: relation "public.children" does not exist
```

`chat.core_*` boundary views select from Core-owned tables in `public`. With
`--exit-on-error` the restore aborts partway: the drill produced 4 of 16 tables
and **zero** `chat.config` rows — a silently partial database, discovered during
an incident if it is not discovered now.

The corrected procedure — apply the Core schema (or `db/test/00_core_shim.sql`)
first, then restore `chat` — was then verified to complete cleanly: 0 errors,
31 tables, 57 config rows, 13 migration ledger entries. It is documented in
`backup-recovery.md` and is exercised by CI.

**This constraint is transitional.** Once the locked decision lands and Core is
reached over an API/webhook boundary instead of `chat.core_*` views, a `chat`
dump becomes self-contained and the extra step disappears. The warning must be
removed from the runbook when that happens — a stale recovery caveat is its own
hazard.

Second-order finding from the same drill: restoring a Supabase-flavoured dump
requires a role with `CREATE` on the target database. The plain `postgres`
superuser in the Supabase image is **not** sufficient; `supabase_admin` is.

### F-4 · No security headers and no CORS policy on the API

Confirmed by running the smoke test against the booted application: no
`X-Content-Type-Options`, no CORS configuration of any kind. Addressed in this
branch by `apps/api/src/infra/http/bootstrap.ts`, which AI #1 adopts with one
line in `main.ts` when the bootstrap is written.

### F-5 · `apps/api` has no test runner

`package.json` declares `test`, `test:unit` and `test:int` scripts using
`--selectProjects`, but there is no `jest.config.js`. CI will fail the API test
step with an explicit message naming the gap rather than a jest stack trace.
Owner: AI #2 / AI #5.

### F-6 · Mobile build infrastructure cannot be validated

`lib/` contains Dart, but there is no `pubspec.yaml`, and neither Flutter nor
Dart is installed on this host. Nothing about the mobile build — dependency
resolution, flavors, signing, artifacts — can be executed or verified. AI #3's
build requirements are documented in `handoff-ai3.md` as a specification, and
are explicitly **not** claimed to be tested.

### F-7 · Docker Compose is not installed on this host

The Docker engine is present; the `compose` plugin is not, and there is no
`docker-compose` binary. The compose stack in this branch was validated
structurally rather than by being started. `scripts/infra/dev.sh` detects the
absence and prints installation instructions instead of failing obscurely.

---

## 3. Deliberately not touched

Per the parallel-development rules, and because these belong to other agents:

- No peer file was modified. Every file added is new, and application code is
  confined to `apps/api/src/infra/`, a namespace no other agent uses.
- The hand-started containers were left running. `dev.sh` reports them and
  explains the migration; it does not stop or delete them.
- `apps/api/package.json` was not edited — the health and bootstrap modules are
  written against dependencies already declared, adding none.
- The `thread.family_id UNIQUE` conflict with the PRD is AI #5's finding C-2 and
  AI #1's to fix. It is repeated here only because F-1 makes it observable in
  two places at once.
