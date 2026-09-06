# Infrastructure Decision Log

Owner: AI #7 · Date: 2026-09-05

Each record states what was decided, what else was considered, why, and what it
costs. A decision with no cost listed has not been thought about hard enough.

---

## ADR-001 · One local Postgres, plain `postgres:17-alpine`

*Superseded once, on the day it was written. The original decision and why it
changed are kept, because the reversal is the useful part.*

**Decision.** The local stack runs a single `postgres:17-alpine` container,
overridable via `POSTGRES_IMAGE`.

**Originally decided.** The Supabase Postgres image
(`public.ecr.aws/supabase/postgres:17.6.1.140`), on the grounds that Jawwid Chat
lived in a `chat` schema **inside the Jawwid Core database** and therefore needed
Core's `auth` schema, its `anon`/`authenticated`/`service_role` roles and its RLS
behaviour. That image is a strict superset of stock Postgres, so one container
could serve both of the competing database strategies in the tree (discovery
F-1) without infrastructure picking a winner by fiat.

**Why it changed.** On 2026-09-05 the product owner locked the database
decision: Jawwid Chat is standalone, **owns its own PostgreSQL database**, and
integrates with Core over an API/webhook boundary rather than direct database
coupling (`docs/product-operations/database-divergence.md`). The entire premise
for the Supabase image — sharing Core's database — is gone.

**Why plain Postgres now.** It is ~80 MB rather than ~1 GB, and it matches the
`postgres:17` service AI #5's CI already runs migrations against. Local and CI
now exercise the same image, which is worth more than the superset ever was.

**Trade-offs.** Anything that genuinely depends on Supabase-specific roles will
fail locally. Given the lock, such a dependency is now a defect to find rather
than a compatibility need to serve — so failing loudly is the desired behaviour.
`scripts/db/test-db.sh` (AI #1's) still uses the Supabase image; converging it is
part of the reconciliation AI #1 owns, not something to change underneath them.

---

## ADR-002 · The migration authority is `scripts/db/apply.sh`

**Status: CONFIRMED by the product owner on 2026-09-05.** This ADR was written
as infrastructure's inference from the evidence; the product owner then locked
the same answer independently (`docs/product-operations/database-divergence.md`
§0). It is recorded as a decision, not a proposal.

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

**Trade-offs.** Prisma's schema and the SQL schema drift until the reconciliation
lands, and Prisma-generated types may not describe the live database. That is not
hypothetical: as of 2026-09-06 the Prisma client no longer exports members the
API's test suite imports, so `npm run typecheck` fails on the test project while
`src/` still compiles. Recording the authority does not fix the drift; it only
stops the pipeline from deepening it.

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
