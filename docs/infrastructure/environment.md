# Environment Contract

Owner: AI #7 · Date: 2026-09-05

Every variable Jawwid Chat reads, what it is for, whether it is a secret, and
whether it is required in each environment.

**The machine-readable source of truth is `infra/env/manifest.tsv`**, not this
page. The tables below are derived from it. Three things consume the manifest:

| Tool | Purpose |
|---|---|
| `scripts/infra/check-env.sh <env>` | Validates a real environment. Runs in CI and as the first step of every deployment. |
| `scripts/infra/render-env-template.sh <env>` | Generates `infra/env/<env>.env.example`. |
| CI `guardrails` job | Fails if a committed template no longer matches the manifest. |

Add a variable by editing the manifest and regenerating the templates. Editing a
template by hand will fail CI (ADR-008).

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

- `CORS_ALLOWED_ORIGINS` set to `*` — wildcard CORS on a credentialed API;
- `NODE_ENV` not equal to `production`;
- `DATABASE_URL` containing `sslmode=disable`;
- `APNS_PRODUCTION` not `true` — the APNs sandbox gateway accepts production
  device tokens and delivers nothing, so this fails as "iOS push stopped
  working" with no error anywhere.

## Client applications

`VITE_*` variables are compiled into the Admin Web bundle and are **public**.
There is no private `VITE_` variable. `scripts/infra/check-web-env.sh` refuses a
build whose `VITE_*` names or values look like credentials, and scans the built
bundle as well.

The Flutter apps may carry the public API base URL, the public realtime URL and
the public LiveKit URL. They must never carry a JWT signing secret, storage
credentials, the LiveKit API secret, or Core credentials.

### Quran audio in lessons (PD-29): build-time, public, unset = no audio

These are compiled into client bundles, not read by the API, so they are not
in `infra/env/manifest.tsv`. Leaving any of them unset is safe: no lesson is
handed audio. Who may HEAR audio is the API's release gate
(`chat.config quran.audio.enabled_for`, `apps/api/src/quran/audio-gate.ts`),
whatever these say.

| Variable | Built into | Value | Set from |
|---|---|---|---|
| `VITE_LESSONS_ORIGIN` | Admin Web (`apps/admin-web/Dockerfile` build arg) | the lessons site's origin, e.g. `https://lessons.example.org`; only a frame on it is handed audio | `vars.STAGING_LESSONS_ORIGIN` (deploy-staging) |
| `JAWWID_LESSONS_ORIGIN` | the Flutter app and the teacher web portal (`--dart-define`) | the same origin | `LESSONS_ORIGIN` for `scripts/mobile/build-teacher-web.sh`; the phone build's `--dart-define` |
| `LESSONS_PARENT_ORIGINS` | the lessons engine (`apps/lessons/vite.config.ts`) | comma-separated https origins allowed to hand a lesson its audio list: the Admin Web and teacher web origins (= `frame-ancestors`); the phone app needs none | `vars.LESSONS_PARENT_ORIGINS` (ci.yml lessons build) |
| `LESSONS_MEDIA_ORIGINS` | the lessons engine (also its CSP `connect-src`) | comma-separated https origins the signed audio URLs point at (the object storage) | `vars.LESSONS_MEDIA_ORIGINS` (ci.yml lessons build) |

---

## Variables

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
| `DATABASE_STATEMENT_TIMEOUT_MS` | no | opt | req | req |
| `DATABASE_POOL_MAX` | no | opt | req | req |
| `DATABASE_WORKER_POOL_MAX` | no | opt | req | req |

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
| `RESET_CODE_HASH_SECRET` (PD-43: the HMAC key for one-time codes; locally derived from `JWT_REFRESH_SECRET`) | **yes** | opt | req | req |
| `LESSON_APPROVALS_SIGNING_KEY` (PD-49: the Ed25519 key that signs the export of children's Quran content approvals; unset = nothing is exported, so no content reaches a child) | **yes** | opt | opt | opt |

### Storage

| Variable | Secret | Local | Staging | Production |
|---|---|---|---|---|
| `STORAGE_ENDPOINT` | no | req | req | req |
| `STORAGE_REGION` | no | opt | req | req |
| `STORAGE_BUCKET` | no | req | req | req |
| `STORAGE_ACCESS_KEY` | **yes** | req | req | req |
| `STORAGE_SECRET_KEY` | **yes** | req | req | req |
| `STORAGE_SIGNED_URL_TTL_SECONDS` | no | opt | req | req |
| `STORAGE_SIGNING_SECRET` | **yes** | req | req | req |
| `STORAGE_LOCAL_ROOT` | no | opt | opt | opt |
| `STORAGE_PUBLIC_BASE_URL` | no | opt | opt | opt |
| `ATTACHMENT_MAX_BYTES_IMAGE` | no | opt | opt | opt |
| `ATTACHMENT_MAX_BYTES_VIDEO` | no | opt | opt | opt |
| `ATTACHMENT_MAX_BYTES_VOICE` | no | opt | opt | opt |
| `ATTACHMENT_MAX_BYTES_FILE` | no | opt | opt | opt |
| `ATTACHMENT_MAX_VOICE_DURATION_MS` | no | opt | opt | opt |

### Push

| Variable | Secret | Local | Staging | Production |
|---|---|---|---|---|
| `FCM_PROJECT_ID` | no | opt | req | req |
| `FCM_SERVICE_ACCOUNT_JSON` | **yes** | opt | req | req |
| `APNS_KEY_ID` | no | opt | req | req |
| `APNS_TEAM_ID` | no | opt | req | req |
| `APNS_BUNDLE_ID` | no | opt | req | req |
| `APNS_PRIVATE_KEY` | **yes** | opt | req | req |
| `APNS_PRODUCTION` | no | opt | req | req |

### Calling

| Variable | Secret | Local | Staging | Production |
|---|---|---|---|---|
| `LIVEKIT_URL` | no | req | req | req |
| `LIVEKIT_API_KEY` | **yes** | req | req | req |
| `LIVEKIT_API_SECRET` | **yes** | req | req | req |

> **Media-token lifetime is not an environment variable.** It is
> `call.token_ttl_seconds` in `chat.config` (120 s), which is what
> `CallService.issueToken` reads. A `LIVEKIT_TOKEN_TTL_SECONDS` variable used
> to be declared here and set to 300 by both deploy workflows; no code ever
> read it, so the deployed lifetime was always 120 s regardless. It was removed
> on 2026-09-24 rather than wired up: a shorter token is the security property,
> and a variable that claims to control something it does not is worse than no
> variable at all.

### Core

| Variable | Secret | Local | Staging | Production |
|---|---|---|---|---|
| `CORE_BASE_URL` | no | req | req | req |
| `CORE_API_KEY` | **yes** | opt | req | req |
| `CORE_WEBHOOK_SECRET` | **yes** | opt | req | req |
| `CORE_WEBHOOK_SECRETS` | **yes** | opt | opt | opt |
| `CORE_WEBHOOK_TOLERANCE_SECONDS` | no | opt | opt | opt |
| `CORE_TIMEOUT_MS` | no | opt | req | req |
| `CORE_RETRY_MAX` | no | opt | req | req |
| `CORE_INVOICES_ENABLED` | no | opt | opt | opt |

`CORE_INVOICES_ENABLED=true` connects Instalment Payments (PD-12 S3) to Core's
invoice read API at `CORE_BASE_URL`, authenticated with `CORE_API_KEY`. Unset, the
page says Core is not connected; `CORE_BASE_URL` alone never turns it on. See
`docs/admin/pd012-s3.md`.

### Observability

| Variable | Secret | Local | Staging | Production |
|---|---|---|---|---|
| `SENTRY_DSN` | **yes** | opt | opt | req |
| `OTEL_SERVICE_NAME` | no | opt | opt | opt |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no | opt | opt | opt |
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

## Notes on individual variables

**`DATABASE_URL`** — Postgres connection string. TLS is required outside local.
The pipeline never prints it; errors that quote it are sanitised before display.

**`REDIS_URL`** — used for BullMQ, caching and Socket.IO pub/sub. Redis must not
become the source of truth for customer data: it is configured `appendonly yes`
so queued jobs survive a restart, and `maxmemory-policy noeviction` so a queue
backend cannot evict pending work under memory pressure.

RT-009 (realtime revocation) makes three further demands of it. **Every API
replica of an environment must use the same Redis** — the API refuses to boot
without `REDIS_URL` outside `APP_ENV=local`, but it cannot tell two replicas
pointed at two different Redis servers apart, so a single `REDIS_URL` per
environment (this manifest) is what guarantees it. **Leave the idle-client
`timeout` at 0** (the default) and keep `tcp-keepalive` enabled: a replica that
is alive but frozen must keep its connection, because that connection is how a
revocation tells "frozen" from "dead". **`CLIENT LIST`, `CLIENT SETNAME` and
`EVAL` must be allowed** for the API's user; if they are not, revocations fail
closed (503 `COMM.REVOCATION_UNCONFIRMED`) rather than succeed unverified.

**`QUEUE_PREFIX`** — namespaces BullMQ keys per environment. Without it, a
staging worker pointed at a shared Redis will consume production jobs.

**`JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`** — variable *names* are proposed by
infrastructure; the authentication design is AI #1's (see `handoff-ai1.md`).
Rotating them invalidates issued tokens; `secrets.md` covers doing it without
signing every user out at once.

**`STORAGE_*`** — storage is private in every environment. Clients receive signed
URLs valid for `STORAGE_SIGNED_URL_TTL_SECONDS`, never credentials.

Which of these the code reads today is not the same as which the deployment
contract reserves. `STORAGE_SIGNING_SECRET` signs those URLs and the API refuses
to start without it (at least 32 characters). `STORAGE_ENDPOINT`,
`STORAGE_PUBLIC_BASE_URL`,
`STORAGE_SIGNED_URL_TTL_SECONDS` and `STORAGE_LOCAL_ROOT` configure the reference
`SignedLocalObjectStorage`/`LocalFsBlobStore` pair that serves attachments now.
`STORAGE_ENDPOINT` does **not**: it is the S3 service endpoint only, and its
presence is part of what selects the S3 backend — see `STORAGE_PUBLIC_BASE_URL`
below.
`STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY` and `STORAGE_SECRET_KEY`
are the S3-compatible surface the `ObjectStorage` seam is built for: no adapter
exists yet (`findings.md` RT-022), so no code reads them, and `docker-compose.yml`
already runs the local service they configure. No provider has been selected.

**`STORAGE_PUBLIC_BASE_URL`** — the public base URL of this API's own `/storage`
route, used ONLY by the local reference storage when it mints signed URLs. A
client has to reach those URLs, so on any deployment reachable over a network
this must be set to that deployment's own public URL, prefix included (for
example `http://10.0.0.5:3399/api/v1/storage`). Optional because the code
defaults it to `http://localhost:3000/api/v1/storage`, which is right on a
laptop and wrong everywhere else; the startup log says so when it is unset.

It is **not** an alternative spelling of `STORAGE_ENDPOINT`. That variable is the
S3 service endpoint, and because its presence is one of the five signals that
select the S3 backend, setting it to reach the local route produces a
half-configured S3 process that refuses to start. Neither variable falls back to
the other, in either direction.

**`STORAGE_LOCAL_ROOT`** — optional because the code defaults it, but the default
is the OS temp directory: per-instance, and gone on restart. Naming a path here
does not make that path durable or shared, which is why this is a hosting
decision rather than a configuration one.

**`FCM_SERVICE_ACCOUNT_JSON` / `APNS_PRIVATE_KEY`** — full credential documents,
stored as multi-line secrets. `check-env.sh` reads them with `env -0` so
newlines survive intact.

**`LIVEKIT_API_SECRET`** — server-side only. The server mints short-lived room
tokens; the secret itself must never reach a client. `scan-secrets.sh` fails the
build if it appears under `lib/` or `apps/admin-web/src/`.

**`CORE_*`** — Jawwid Core integration. `CORE_TIMEOUT_MS` bounds Core's latency
so it cannot become Chat's latency. `CORE_WEBHOOK_SECRETS` (or, when it is unset,
the deployed name `CORE_WEBHOOK_SECRET`) holds `keyid:secret[,keyid2:secret2]`
and verifies inbound webhook signatures at `POST /integration/core/events`; two
entries is how a rotation lands. A value without a key id is ignored, and an
empty one leaves the endpoint answering 503. `CORE_WEBHOOK_TOLERANCE_SECONDS`
(default 300) is the timestamp window. See
`docs/integration/core-subscription-confirmation.md`. A Core outage degrades Core-dependent features and leaves
the rest of Chat running (see `architecture.md` §4).

**`GIT_COMMIT` / `BUILD_VERSION` / `BUILD_TIME`** — injected at image build time
and reported by `/health/live`. They are what makes "what exactly is running in
production?" answerable from outside the pipeline. Required in staging and
production; the smoke test fails if `commit` is `unknown`.

**`LOG_LEVEL`** — read by the JSON logger in both processes, the API and the
worker (`apps/api/src/infra/observability/json-logger.ts`): `trace`, `debug`,
`info`, `warn`, `error` or `fatal`. Unset or unrecognised means `info`, and an
unrecognised value is reported once at startup. The deploy workflows set `info`;
`.env.example` sets `debug`. Successful health probes and CORS preflights are
logged at `debug`, so `info` keeps a load balancer's probing out of the log.
There is no log-format switch: output is always one JSON object per line on
stdout (`monitoring.md` §3).

**`SENTRY_DSN`** — consumed by both processes. Set, the API reports 5xx
responses and the worker reports every subsystem failure its loop survives,
and both report unhandled rejections and uncaught exceptions; unset or empty,
error tracking is inert and `@sentry/node` is never loaded. Required in
production; optional in staging, where the deploy workflow passes the
`SENTRY_DSN` secret if one exists. The Sentry environment is `APP_ENV` and the
release is `GIT_COMMIT` -- there is deliberately no `SENTRY_ENVIRONMENT` or
`SENTRY_RELEASE`. What an event may and may not carry is in `monitoring.md`
§3a; in short, it never carries a request, a body, a user, breadcrumbs,
stack-frame variables, a signed URL or an object key.

**`OTEL_*`** — optional everywhere because nothing reads them: no OpenTelemetry
SDK is installed and no exporter is wired (`monitoring.md` §6). Return them to
`req` in the same change that wires an exporter, not before.
