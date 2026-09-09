# Environment Contract

Owner: AI #7 · Date: 2026-09-05

Every variable Jawwid Chat reads, what it is for, whether it is a secret, and
whether it is required in each environment.

**The machine-readable source of truth is the manifests**, not this page. The
tables below are derived from them. There are two, because there are two
processes with deliberately opposite database rules (see *The two processes*):

| Manifest | Process | Command |
|---|---|---|
| `infra/env/manifest.tsv` | the API — `node dist/main.js` | *(default)* |
| `infra/env/worker.manifest.tsv` | the worker — `node dist/worker.js` | `--component worker` |

Three things consume them:

| Tool | Purpose |
|---|---|
| `scripts/infra/check-env.sh <env> [--component worker]` | Validates a real environment. Runs in CI and as the first step of every deployment. |
| `scripts/infra/render-env-template.sh <env> [--component worker]` | Generates `infra/env/<env>.env.example` and `infra/env/worker.<env>.env.example`. |
| CI `guardrails` job | Fails if a committed template no longer matches its manifest, or if a variable in both manifests disagrees about being a secret. |

The component is always stated and never inferred. Guessing it from which
variables happen to be present would grade an API environment against the
worker's contract the moment one shared env file leaked `DATABASE_SERVICE_URL`
into it — and the worker's contract *requires* a BYPASSRLS credential.

Add a variable by editing the manifest that owns it and regenerating the
templates. Editing a template by hand will fail CI (ADR-008).

## Rules

- **No real secret ever appears in this repository.** Templates carry names and
  a `# SECRET` marker; values come from the secret store at deploy time.
- `req` — the deployment is refused if it is missing or empty.
- `opt` — optional; if unset, the feature it configures is off. A secret marked
  `opt` outside local prints a note, so "push is silently disabled" is visible.
- `forbid` — **the deployment is refused if it is present.** Used for debug and
  mock switches, so "turn it on temporarily in production" is a reviewed change
  to the manifest rather than an untracked console edit.
- `APP_ENV` is always explicit. `NODE_ENV` only distinguishes an optimised build
  from a development one; it cannot tell staging from production, and code that
  infers the environment infers it wrongly on the day that matters.

## Checks beyond per-variable rules

`check-env.sh` also refuses, outside local:

- any required value that looks like a development placeholder — `localhost`,
  `127.0.0.1`, `changeme`, `devkey`, `devsecret`, `jawwid-dev`, `example.com`,
  `<...>`. The **name** is reported; the value never is.

and in production specifically:

- `NODE_ENV` not equal to `production` — **both components**;
- `APNS_ENVIRONMENT` not `production` — **both components**. The APNs sandbox
  gateway accepts production device tokens and delivers nothing, so this fails
  as "iOS push stopped working" with no error anywhere. The worker is checked
  too because the worker is the process that actually sends;
- TLS disabled on the connection **that component opens** — `sslmode=disable` in
  `DATABASE_URL` for the API, in `DATABASE_SERVICE_URL` for the worker. The
  check follows the component, because each forbids the other's variable;
- `CORS_ALLOWED_ORIGINS` set to `*` — wildcard CORS on a credentialed API.
  **API only:** the worker serves no HTTP, so it has no CORS policy to get
  wrong, and grading it on a variable it must not hold would be theatre.

## Client applications

`VITE_*` variables are compiled into the Admin Web bundle and are **public**.
There is no private `VITE_` variable. `scripts/infra/check-web-env.sh` refuses a
build whose `VITE_*` names or values look like credentials, and scans the built
bundle as well.

The Flutter apps may carry the public API base URL, the public realtime URL and
the public LiveKit URL. They must never carry a JWT signing secret, storage
credentials, the LiveKit API secret, or Core credentials.

---

## The two processes

The API and the worker run the **same image** (ADR-004) and build the same
module graph, but they must never connect to the database as the same role.

| | API | Worker |
|---|---|---|
| Command | `node dist/main.js` | `node dist/worker.js` |
| Connects as | `chat_app` — **NOBYPASSRLS** | `chat_service` — **BYPASSRLS** |
| Through | `DATABASE_URL` — **required** | `DATABASE_SERVICE_URL` — **required** |
| Must not hold | `DATABASE_SERVICE_URL` — **forbidden** | `DATABASE_URL` — **forbidden** in staging/production |
| Serves HTTP | yes — `PORT`, `CORS_ALLOWED_ORIGINS` | no — neither variable belongs to it |

**Why the API is forbidden the service credential.** `chat_service` ignores every
row-level security policy in the schema. An API process that merely *has* the
variable gives any bug that picks the wrong client both authorization layers at
once (`RLS-STRATEGY.md` §6).

**Why the worker is forbidden the API credential.** Connected as `chat_app` the
worker still *claims* outbox rows — that table carries a blanket policy — but
every read it needs in order to route what it claimed returns nothing, because
it has no actor context to satisfy the policies with. It marks each row
`published` and delivers it to nobody, at full throughput, with no error in any
log. The runtime refuses to fall back (`platform/database-role.ts`); forbidding
the variable means there is nothing to fall back *to*.

`DATABASE_MIGRATION_URL` is forbidden for both. It is the owner/DDL credential,
and it belongs to CI for the length of one migration step and nowhere else.

**`QUEUE_PREFIX` must be byte-identical in both processes.** It namespaces the
Redis pub/sub channel, and pub/sub is global to the Redis *server* rather than
to the selected database. A mismatch is silent: the worker publishes to a
channel no API instance is listening on, so events are "delivered" and nobody
receives them. No gate can catch this — the two values are supplied
independently at deploy time — so it is stated here and in both manifests.

---

## Variables

Unless a section says otherwise, these are the **API** process's variables. The
worker's are listed separately under *Worker variables*.

### Application

| Variable | Secret | Local | Staging | Production |
|---|---|---|---|---|
| `NODE_ENV` | no | req | req | req |
| `APP_ENV` | no | req | req | req |
| `PORT` | no | req | req | req |
| `LOG_LEVEL` | no | opt | req | req |
| `CORS_ALLOWED_ORIGINS` | no | req | req | req |
| `REQUEST_TIMEOUT_MS` | no | opt | req | req |
| `SHUTDOWN_GRACE_MS` | no | opt | req | req |

### Database

| Variable | Secret | Local | Staging | Production |
|---|---|---|---|---|
| `DATABASE_URL` | **yes** | req | req | req |
| `DATABASE_SERVICE_URL` | **yes** | opt | **forbid** | **forbid** |
| `DATABASE_MIGRATION_URL` | **yes** | opt | **forbid** | **forbid** |
| `DATABASE_STATEMENT_TIMEOUT_MS` | no | opt | req | req |
| `DATABASE_POOL_MAX` | no | opt | req | req |

### Redis

| Variable | Secret | Local | Staging | Production |
|---|---|---|---|---|
| `REDIS_URL` | **yes** | req | req | req |
| `QUEUE_PREFIX` | no | req | req | req |
| `WORKER_CONCURRENCY` | no | opt | req | req |

### Auth

| Variable | Secret | Local | Staging | Production |
|---|---|---|---|---|
| `JWT_ACCESS_SECRET` | **yes** | req | req | req |
| `JWT_REFRESH_SECRET` | **yes** | req | req | req |
| `JWT_ACCESS_TTL` | no | opt | req | req |
| `JWT_REFRESH_TTL` | no | opt | req | req |

### Storage

| Variable | Secret | Local | Staging | Production |
|---|---|---|---|---|
| `STORAGE_ENDPOINT` | no | req | req | req |
| `STORAGE_REGION` | no | opt | req | req |
| `STORAGE_BUCKET` | no | req | req | req |
| `STORAGE_ACCESS_KEY` | **yes** | req | req | req |
| `STORAGE_SECRET_KEY` | **yes** | req | req | req |
| `STORAGE_SIGNED_URL_TTL_SECONDS` | no | opt | req | req |
| `ATTACHMENT_MAX_BYTES_IMAGE` | no | opt | opt | opt |
| `ATTACHMENT_MAX_BYTES_VIDEO` | no | opt | opt | opt |
| `ATTACHMENT_MAX_BYTES_VOICE` | no | opt | opt | opt |
| `ATTACHMENT_MAX_BYTES_FILE` | no | opt | opt | opt |

### Push

| Variable | Secret | Local | Staging | Production |
|---|---|---|---|---|
| `FCM_PROJECT_ID` | no | opt | req | req |
| `FCM_SERVICE_ACCOUNT_JSON` | **yes** | opt | req | req |
| `APNS_KEY_ID` | no | opt | req | req |
| `APNS_TEAM_ID` | no | opt | req | req |
| `APNS_BUNDLE_ID` | no | opt | req | req |
| `APNS_PRIVATE_KEY` | **yes** | opt | req | req |
| `APNS_ENVIRONMENT` | no | opt | req | req |

### Calling

| Variable | Secret | Local | Staging | Production |
|---|---|---|---|---|
| `LIVEKIT_URL` | no | req | req | req |
| `LIVEKIT_API_KEY` | **yes** | req | req | req |
| `LIVEKIT_API_SECRET` | **yes** | req | req | req |
| `LIVEKIT_TOKEN_TTL_SECONDS` | no | opt | req | req |

### Core

| Variable | Secret | Local | Staging | Production |
|---|---|---|---|---|
| `CORE_BASE_URL` | no | req | req | req |
| `CORE_API_KEY` | **yes** | opt | req | req |
| `CORE_WEBHOOK_SECRET` | **yes** | opt | req | req |
| `CORE_TIMEOUT_MS` | no | opt | req | req |
| `CORE_RETRY_MAX` | no | opt | req | req |

### Observability

| Variable | Secret | Local | Staging | Production |
|---|---|---|---|---|
| `SENTRY_DSN` | **yes** | opt | req | req |
| `OTEL_SERVICE_NAME` | no | opt | req | req |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no | opt | req | req |
| `OTEL_TRACES_SAMPLER_ARG` | no | opt | opt | opt |
| `HEALTH_PROBE_TIMEOUT_MS` | no | opt | opt | opt |

### Release

| Variable | Secret | Local | Staging | Production |
|---|---|---|---|---|
| `GIT_COMMIT` | no | opt | req | req |
| `BUILD_VERSION` | no | opt | req | req |
| `BUILD_TIME` | no | opt | req | req |

### Guardrail

| Variable | Secret | Local | Staging | Production |
|---|---|---|---|---|
| `PRISMA_MIGRATE_SKIP_GENERATE` | no | opt | opt | opt |
| `DEBUG` | no | opt | forbid | forbid |
| `PRISMA_STUDIO` | no | opt | forbid | forbid |
| `USE_MOCK_PUSH` | no | opt | forbid | forbid |
| `USE_MOCK_CORE` | no | opt | forbid | forbid |
| `ALLOW_INSECURE_TLS` | no | forbid | forbid | forbid |

---

## Worker variables

Source: `infra/env/worker.manifest.tsv`. Validate with
`scripts/infra/check-env.sh <env> --component worker`.

| Variable | Group | Secret | Local | Staging | Production |
|---|---|---|---|---|---|
| `NODE_ENV` | application | no | req | req | req |
| `APP_ENV` | application | no | req | req | req |
| `SHUTDOWN_GRACE_MS` | application | no | opt | req | req |
| `DATABASE_SERVICE_URL` | database | **yes** | req | req | req |
| `DATABASE_URL` | database | **yes** | opt | **forbid** | **forbid** |
| `DATABASE_MIGRATION_URL` | database | **yes** | opt | **forbid** | **forbid** |
| `REDIS_URL` | redis | **yes** | req | req | req |
| `QUEUE_PREFIX` | redis | no | req | req | req |
| `OUTBOX_POLL_MS` | worker | no | opt | opt | opt |
| `OUTBOX_BATCH_SIZE` | worker | no | opt | opt | opt |
| `OUTBOX_IDLE_BACKOFF_MS` | worker | no | opt | opt | opt |
| `CALL_SWEEP_MS` | worker | no | opt | opt | opt |
| `STORAGE_ENDPOINT` | storage | no | req | req | req |
| `STORAGE_REGION` | storage | no | opt | req | req |
| `STORAGE_BUCKET` | storage | no | req | req | req |
| `STORAGE_ACCESS_KEY` | storage | **yes** | req | req | req |
| `STORAGE_SECRET_KEY` | storage | **yes** | req | req | req |
| `STORAGE_SIGNED_URL_TTL_SECONDS` | storage | no | opt | req | req |
| `STORAGE_SIGNING_SECRET` | storage | **yes** | req | req | req |
| `FCM_SERVICE_ACCOUNT_JSON` | push | **yes** | opt | req | req |
| `APNS_KEY_ID` | push | no | opt | req | req |
| `APNS_TEAM_ID` | push | no | opt | req | req |
| `APNS_BUNDLE_ID` | push | no | opt | req | req |
| `APNS_PRIVATE_KEY` | push | **yes** | opt | req | req |
| `APNS_ENVIRONMENT` | push | no | opt | req | req |
| `SENTRY_DSN` | observability | **yes** | opt | req | req |
| `GIT_COMMIT` | release | no | opt | req | req |

**Why storage is required for a process that uploads nothing.** The worker
builds the whole module graph, so Nest constructs the object-storage provider
whether or not the worker ever calls it. With the four S3 variables set it
builds the S3 client; without them it builds the local signer, whose field
initializer throws unless `STORAGE_SIGNING_SECRET` is at least 32 characters.
Either way the process does not start unless one of those branches is satisfied.

**Why push credentials matter more here than in the API.** The worker is the
process that actually sends: `NotificationService.dispatchDue()` runs in its
loop, not in a request.

**What is deliberately absent.** `PORT` and `CORS_ALLOWED_ORIGINS` (no HTTP
server; `PORT` is omitted rather than forbidden because some platforms inject it
into every component); `JWT_*` (read only inside auth methods the worker never
calls); `LIVEKIT_*` (read with a default, never used here);
`DATABASE_TRANSACTION_*` (read inside `runWithActor`, whose only caller is the
HTTP actor interceptor); and every variable that no code reads — including
`WORKER_CONCURRENCY`, which despite its name configures nothing: the worker loop
is sequential, and the only real concurrency control is the database-backed
`broadcast.fanout_concurrency`.

---

## Notes on individual variables

**`DATABASE_URL`** — Postgres connection string. TLS is required outside local.
The pipeline never prints it; errors that quote it are sanitised before display.

**`REDIS_URL`** — used for BullMQ, caching and Socket.IO pub/sub. Redis must not
become the source of truth for customer data: it is configured `appendonly yes`
so queued jobs survive a restart, and `maxmemory-policy noeviction` so a queue
backend cannot evict pending work under memory pressure.

**`QUEUE_PREFIX`** — namespaces BullMQ keys per environment. Without it, a
staging worker pointed at a shared Redis will consume production jobs.

**`JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`** — variable *names* are proposed by
infrastructure; the authentication design is AI #1's (see `handoff-ai1.md`).
Rotating them invalidates issued tokens; `secrets.md` covers doing it without
signing every user out at once.

**`STORAGE_*`** — the bucket is private in every environment. Clients receive
signed URLs valid for `STORAGE_SIGNED_URL_TTL_SECONDS`, never credentials.

**`FCM_SERVICE_ACCOUNT_JSON` / `APNS_PRIVATE_KEY`** — full credential documents,
stored as multi-line secrets. `check-env.sh` reads them with `env -0` so
newlines survive intact.

**`LIVEKIT_API_SECRET`** — server-side only. The server mints short-lived room
tokens; the secret itself must never reach a client. `scan-secrets.sh` fails the
build if it appears under `lib/` or `apps/admin-web/src/`.

**`CORE_*`** — Jawwid Core integration. `CORE_TIMEOUT_MS` bounds Core's latency
so it cannot become Chat's latency; `CORE_WEBHOOK_SECRET` verifies inbound
webhook signatures. A Core outage degrades Core-dependent features and leaves
the rest of Chat running (see `architecture.md` §4).

**`GIT_COMMIT` / `BUILD_VERSION` / `BUILD_TIME`** — injected at image build time
and reported by `/health/live`. They are what makes "what exactly is running in
production?" answerable from outside the pipeline. Required in staging and
production; the smoke test fails if `commit` is `unknown`.
