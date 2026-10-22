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

> **Superseded in part by ADR-010 (2026-10-22).** The provider is chosen, and
> the release step now deploys with `doctl` (ADR-012). Its rule survives: it
> still fails loudly without the deploy token or app id, never a silent no-op.
> The "Recommendation" and "UNRESOLVED" paragraphs below are history.

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

**UNRESOLVED — this recommendation conflicts with PRD §12.3.** The PRD names
"Docker containers on one cloud (Hetzner or AWS)" and requires infrastructure
as code from day one. The two disagree on compute hosting, and `docs/README.md`
places the PRD above infrastructure documents in authority — but it does not
list this ADR as superseded, and the paragraph above is explicitly a
*recommendation*, not a decision. **Neither can be treated as settled on
repository evidence.** The product owner must choose, and the choice should be
recorded as a new ADR superseding this paragraph.

Two notes for whoever makes it, both established from the code rather than
assumed:

* **The BYPASSRLS capability is the gating compatibility question**, not a
  detail. `20260910120200` grants it unconditionally and `apply.sh` runs with
  ON_ERROR_STOP=1. Run `scripts/db/preflight-role-capability.sh` against a
  trial instance of the candidate Postgres *before* committing to it; it
  changes nothing and answers the question in one command.
* **Admin Web is an nginx container that needs runtime environment**
  (`API_ORIGIN`, `REALTIME_ORIGIN`, `LIVEKIT_ORIGIN` for the call screen's
  media connection, and `STORAGE_ORIGIN` for voice-note uploads and playback)
  for its CSP, so "static hosting" above is
  not accurate for the image this repository actually builds.

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

**Impact.** Both entrypoints exist. `src/worker.ts` drains the transactional
outbox; it deliberately adds no queue of its own (see `architecture.md` §6).

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
mid-session if TTLs are set carelessly. The TTL is configurable per environment
and is capped at one hour, because a signed URL is a bearer credential for one
object.

**Implementation.** `S3ObjectStorage` (S3-compatible: presigned PUT and GET,
`forcePathStyle`, no provider hard-coded) is selected by
`storage.provider.ts` when the bucket and credentials are configured, and the
local HMAC reference implementation otherwise. A *partial* configuration is a
startup failure rather than a silent fallback — booting into local storage with
a bucket half-configured writes attachments to a filesystem the next deploy
deletes. The presigned PUT names `content-type` and `content-length` in
`signableHeaders`, so storage refuses a body that differs from the one
authorized; without that, setting ContentType on the command binds nothing.

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

---

## ADR-009 · Infrastructure as code is required, and is blocked on the provider

> **Unblocked by ADR-010 (2026-10-22), implemented by ADR-012.** The provider
> is DigitalOcean App Platform, whose declarative format is the app spec. The
> app spec and the real release step landed in one change, as the rule below
> requires.

**Decision.** No IaC tool is introduced yet. The requirement is recorded here so
it is not lost, and the implementation follows provider selection rather than
preceding it.

**Alternatives.** (a) Adopt Terraform (or Pulumi, or the chosen platform's own
declarative format) now and write it against a provider nobody has picked.
(b) Leave the requirement undocumented until somebody notices it again.

**Why.** PRD §12.3 asks for "infrastructure as code from day one" and the
repository has none — no Terraform, Pulumi or Bicep, and `infra/` holds only
the environment manifest and a Postgres init script. That gap is real. But IaC
describes *provider resources*, and the provider is the one thing not decided
(ADR-003, still open): a managed Postgres, a container host and a bucket are
different resources, different providers and in practice different tools.
Writing (a) produces configuration that cannot be applied, cannot be tested,
and will be rewritten the day the decision is taken — the same failure ADR-003
rejected for the release step. (b) loses a genuine PRD requirement.

**Trade-offs.** Between now and provider selection, whatever is provisioned is
provisioned by hand. That is acceptable only because nothing is provisioned
yet; the first environment must be created *from* the IaC, not imported into it
afterwards, or the code will describe something that has already drifted.

**What this does not defer.** Everything already declarative stays declarative
and is unaffected: `infra/env/manifest.tsv` (ADR-008), `docker-compose.yml`,
both Dockerfiles, the deployment workflows, and the SQL migration chain
(ADR-002). The gap is cloud resources, not configuration.

**When the choice is made.** Add the IaC in the same change that replaces the
release step, so that the platform's resources and the platform's deploy
command land together and neither is described by a document instead of by
code.

---

## ADR-010 · Compute is hosted on DigitalOcean App Platform

**Decision.** The product owner chose **DigitalOcean App Platform** as the
hosting provider on 2026-10-22. The API, the worker and Admin Web run there as
App Platform components. Their declarative description is an App Platform app
spec kept in this repository (ADR-009).

**Alternatives.** Those recorded in ADR-003: Fly.io or Render, which ADR-003
recommended, and Hetzner or AWS, which PRD §12.3 named. This decision resolves
ADR-003's open conflict between them. It supersedes the compute line of
PRD §12.3.

**Why.** It is the owner's choice of vendor, and choosing a vendor is the
owner's decision (ADR-003). App Platform satisfies what the repository already
assumes. It runs OCI images, so ADR-004's one image with two commands
deploys as one service component plus one worker component. It routes traffic
on health checks, which ADR-007's liveness/readiness split feeds. And it takes
per-component environment variables and secrets, which ADR-008's manifest
generates.

**What this does not decide.** Each of the following is still open and is
decided on its own evidence:

* **The database host.** DigitalOcean Managed PostgreSQL is the natural fit.
  But `20260910120200` grants BYPASSRLS unconditionally, and DigitalOcean's
  admin role is not a superuser. Run `scripts/db/preflight-role-capability.sh`
  against a trial cluster **before** committing to it. If it fails, either the
  migration changes or the database lives elsewhere (Supabase, matching Core).
* **Redis, object storage (Spaces or R2), push credentials, LiveKit.** Each
  needs an account, chosen when it is provisioned.
* **The domain.** It also blocks passkeys (PD-23 Phase B).

**Trade-offs.** App Platform is a managed PaaS: less control than droplets or
Kubernetes, and per-component pricing that is higher than raw VMs at scale. At
MVP scale that is the right trade. A move later means rewriting the app spec,
not the application. The images, the manifest and the migrations stay
provider-neutral.

---

## ADR-011 · Admin Web is served by its nginx container

*Ported from an uncommitted draft on `gate2/deploy-pipeline`, written
2026-09-09 against DigitalOcean's documentation. Recorded now that ADR-010
makes DigitalOcean the platform.*

**Decision.** Admin Web deploys to App Platform as a **container component**
running `apps/admin-web/Dockerfile`.
`apps/admin-web/infra-nginx/default.conf.template` is the reference
implementation of the delivery contract, not an incidental convenience.

**Alternatives.** An App Platform **static site** component, the "static
hosting" that ADR-003 recommended. ADR-003 already noted that this is not what
the repository builds.

**Why.** The delivery contract is HTTP response behaviour.
`scripts/infra/smoke.sh` §7 checks it against the deployed site: `GET /`
returns 200, deep links fall back to the SPA, a `Content-Security-Policy`
header is present, and `index.html` is not cacheable. The static-site component
cannot produce most of it:

| Required behaviour | Static site component |
|---|---|
| SPA deep-link fallback | supported: `catchall_document: index.html` |
| `Content-Security-Policy` response header | no arbitrary response-header field |
| CSP `frame-ancestors` | not expressible |
| CSP `connect-src` pinning | not expressible |
| HSTS | not set by the platform; "set the headers in your app's code" |
| `Cache-Control: no-store` on `index.html` | no response-header configuration |
| immutable caching for hashed `/assets` | no response-header configuration |
| `/healthz` | not applicable: a static site has no liveness probe |

Two of the gaps are security properties. `frame-ancestors` guards against
clickjacking on a console that can transfer family ownership and impersonate
accounts (PD-21), and a `<meta http-equiv>` CSP cannot express it.
`connect-src` stops injected script from sending customer messages to an
arbitrary host.

**Trade-offs.** A web server runs where none is strictly required. It costs
more than static hosting, it does not scale to zero, and nginx becomes a
surface to patch. ADR-006 stays in force: production needs its own Admin Web
image built with production URLs, and a rollback rebuilds the bundle.

**Impact.** Any change to `default.conf.template` changes the production
security posture.

---

## ADR-012 · The app spec is generated, holds no values, and is verified live

**Decision.** `.do/app.staging.yaml` and `.do/app.production.yaml` are the
infrastructure as code ADR-009 requires. They are rendered from
`infra/env/manifest.tsv` by `scripts/infra/app-spec.py`, hold only `${NAME}`
placeholders, and are deployed by the Release step of each deploy workflow with
`scripts/infra/do-release.sh`. Components: `api` (service, `node dist/main.js`)
and `worker` (worker, `node dist/worker.js`) from the one API image (ADR-004);
`admin-web` as a container service (ADR-011). The API's readiness check is
`/health/ready` and its liveness check `/health/live` (ADR-007). Each component
gets its own host (`api.<domain>`, `admin.<domain>`) through authority-matched
ingress rules.

**Alternatives.** (a) A hand-written spec with literal values, edited in the
DigitalOcean console afterwards. (b) Secrets set once in the console, and the
spec carrying only the structure. (c) One host, with the API routed under path
prefixes.

**Why.** (a) is the drift ADR-008 exists to stop, and a console edit is an
undocumented deployment. (b) breaks on the first `doctl apps update`, which
replaces the whole spec and would clear any value the spec omits. Keeping the
values in the GitHub Environment keeps one secret store, the one `check-env.sh`
already validates. The placeholders are filled on the runner, before the backup
and the migrations, so a missing value stops the run before anything changes.
(c) would couple the routing to the API's route list and split one origin
between a console and an API that the CSP and the CORS allowlist treat as two.

The release is verified, not assumed. A failed App Platform deployment leaves
the previous one active, so `do-release.sh` reads the ACTIVE deployment back
and fails unless it runs the requested tags. It also refuses an app id that
names the other environment's app, and refuses to create a second app.

**Trade-offs.** The resolved spec, which holds secrets, briefly exists as a
mode-600 file on an ephemeral GitHub runner. Every deploy re-sends every
secret. A change made in the DigitalOcean console is overwritten by the next
deploy, which is intended, but surprises anyone who makes one. The guard needs
`doctl` (installed pinned and checksum-verified in CI). The domain must be
chosen before the first deploy, because the Admin Web bundle compiles the API
URL in.

