# Infrastructure Decision Log

Owner: AI #7 · Date: 2026-09-05

Each record states what was decided, what else was considered, why, and what it
costs. A decision with no cost listed has not been thought about hard enough.

---

## ADR-001 · One local Postgres, on the Supabase image

**Decision.** The local stack runs a single Postgres container using
`public.ecr.aws/supabase/postgres:17.6.1.140`, not `postgres:16-alpine`.

**Alternatives.** (a) Two containers, one per database strategy — matches the
status quo. (b) Plain `postgres:17-alpine` only. (c) Full `supabase start`.

**Why.** The repository currently contains two competing database strategies
(discovery F-1). Infrastructure must not resolve that by fiat, but it also must
not force every developer to run two databases while it is unresolved. The
Supabase image is a strict superset of stock Postgres: it adds the `auth` schema,
the `anon`/`authenticated`/`service_role` roles and the RLS behaviour that AI
#1's `chat` schema and Jawwid Core rely on, and it remains an ordinary Postgres
for Prisma. One container serves both.

**Trade-offs.** The image is ~1 GB versus ~80 MB for alpine, so first pull is
slow. Rejected (c) because the full Supabase stack starts nine containers to
provide services (Kong, GoTrue, Studio, Realtime) that Jawwid Chat does not use
— its realtime layer is Socket.IO, not Supabase Realtime.

**Impact.** Whichever way F-1 is resolved, local development does not change.

---

## ADR-002 · The migration authority is `scripts/db/apply.sh`

**Decision.** The deployment pipeline applies migrations with AI #1's
`scripts/db/apply.sh` and its `chat.schema_migrations` ledger. Prisma is used to
generate a typed client; `prisma migrate` and `prisma db push` are **not** run
by any pipeline.

**Alternatives.** (a) Prisma Migrate as the authority. (b) Both, split by schema.

**Why.** Only one of the two has ever been applied to a live database. `chat`
holds 31 tables and a populated `chat.config`; the Prisma database is empty. An
authority is established by what governs the real data, not by which file is
longer. (b) is the worst option available: two ledgers over one database is how
migration state diverges irrecoverably, and it is precisely the risk AI #5
flagged.

**Trade-offs.** Prisma's schema and the SQL schema will drift until F-1 is
resolved, and Prisma-generated types may not describe the live database. This is
a real, live inconsistency; recording the authority does not fix it, and this
ADR should be revisited the moment AI #1 and AI #2 converge.

**Impact.** CI runs `scripts/db/test-db.sh reset` — AI #1's own script — so the
pipeline exercises the project's real migration path rather than a second
implementation of it.

---

## ADR-003 · Hosting is not chosen yet, and the pipeline says so

**Decision.** The deployment workflows are complete up to the release step. That
step **fails loudly** with a link to the blocker instead of pretending.

**Alternatives.** (a) Pick a platform now and write its commands. (b) Omit the
workflows until hosting exists. (c) Make the release step a no-op that succeeds.

**Why.** No cloud account, domain or credential exists for Jawwid Chat, and the
product owner has not chosen a platform. Writing (a) speculatively produces
configuration nobody can test and everybody trusts. (c) is the dangerous one: a
pipeline that reports success without deploying is a false negative on every
future incident. (b) throws away the 90% that *is* decidable and testable —
validation, backup, migration, smoke tests — and that 90% is already verified.

**Trade-offs.** The pipeline cannot deploy today. That is the honest state of
the project, and it is visible rather than hidden.

**Recommendation when the choice is made.** Managed Postgres (Supabase, matching
Core), a container host with health-check-driven rolling deploys (Fly.io or
Render), Cloudflare R2 for object storage, a managed Redis, LiveKit Cloud, and
static hosting for Admin Web. All are boring, managed, and appropriate for MVP
scale; none requires Kubernetes.

---

## ADR-004 · The API and the worker are one image, two commands

**Decision.** A single `apps/api` image. The API runs `node dist/main.js`; the
background worker runs `node dist/worker.js`.

**Alternatives.** Separate images per process.

**Why.** They share the domain code. Two images can be at two commits at once,
and a worker running yesterday's code against today's schema is a class of bug
that is miserable to diagnose. One artifact makes that impossible to express.

**Trade-offs.** The worker image carries the HTTP dependencies it does not use;
a few MB, against a whole failure mode. The two processes still scale
independently — that is a deployment decision, not a packaging one.

**Impact.** `dist/worker.js` does not exist yet. AI #2 owns the worker
entrypoint; the image is ready for it.

---

## ADR-005 · Private object storage, always, with signed URLs

**Decision.** The attachment bucket is private in every environment, including
local. Access is exclusively via short-lived signed URLs (default 300s).
Local development uses MinIO; `minio-init` explicitly sets the bucket to
`anonymous: none`.

**Alternatives.** A public bucket with unguessable keys.

**Why.** Attachments are family and student communication content. "Unguessable"
is not an access control: URLs are shared, logged, cached by proxies and pasted
into tickets. Making local storage private too means the signed-URL code path is
the one developers exercise daily, so an authorization bug shows up on a laptop
rather than in production.

**Trade-offs.** Every read needs a signing round-trip, and signed URLs expire
mid-session if TTLs are set carelessly. The TTL is configurable per environment.

---

## ADR-006 · The Admin Web image is environment-specific

**Decision.** Admin Web images are built per environment and are never promoted
from staging to production.

**Alternatives.** Build once, inject configuration at runtime (from a
`config.json` fetched at boot, or via envsubst into the bundle).

**Why.** Vite inlines `import.meta.env.VITE_*` at build time; the API URL is
compiled into the JavaScript. A "promoted" staging bundle would talk to the
staging API from the production domain — a data-crossing bug that looks like a
caching problem.

**Trade-offs.** Production runs a bundle that was not byte-for-byte the one
staging tested. The mitigation is that both are built from the same commit, and
the commit is recorded in the image and reported by the smoke test. Runtime
configuration would remove this trade-off and is the right change if
build-per-environment becomes painful.

---

## ADR-007 · Health checks separate liveness from readiness

**Decision.** `/health/live` never touches a dependency. `/health/ready` checks
Postgres and Redis, and returns 503 when either is down. Jawwid Core, push
providers and LiveKit are deliberately excluded from readiness.

**Alternatives.** A single `/health` that checks everything.

**Why.** The two probes drive different actions. Liveness failure restarts the
container; readiness failure removes it from the load balancer. Checking the
database in the liveness probe means a database blip restarts every API instance
— adding an outage to an outage. Including Core in readiness means a Core outage
takes Jawwid Chat entirely offline, when most of the product does not touch Core
at all; §62 of the role assignment requires the opposite.

**Trade-offs.** A Core outage will not be visible in the readiness signal. It
must be caught by monitoring and alerting instead — `monitoring.md` covers it.

---

## ADR-008 · Environment configuration is declared in one manifest

**Decision.** `infra/env/manifest.tsv` is the single machine-readable source of
truth. `check-env.sh` validates against it; `render-env-template.sh` generates
the per-environment templates; CI fails if a committed template differs from
what the generator produces.

**Alternatives.** Hand-maintained `.env.example` files per environment.

**Why.** Hand-maintained templates drift from the checker, and the drift is
discovered by a failed deployment at the worst possible moment. Generating them
makes drift impossible to commit.

**Trade-offs.** Adding a variable now means editing the manifest and
regenerating, which is a slightly heavier step than editing one file — and the
step is enforced by CI, so it cannot be skipped.
