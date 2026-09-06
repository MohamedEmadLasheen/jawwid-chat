# Infrastructure Inventory

Owner: AI #7 · Last verified: 2026-09-06

Every service Jawwid Chat needs, what state it holds, who owns it, and whether
it exists. "Exists" means it has been observed running or executed — not that it
has been designed.

## Services

| Service | Env | Purpose | Owner | Deploy | Depends on | Health | Monitored | Backed up | Exists |
|---|---|---|---|---|---|---|---|---|---|
| API | all | HTTP + Socket.IO | AI #1/#2 (code), AI #7 (runtime) | container image | Postgres, Redis, storage, Core, LiveKit | `/health/live`, `/health/ready` | ✗ | n/a | code only — **no bootstrap** |
| Worker | all | BullMQ consumers | AI #2 | same image, `dist/worker.js` | Postgres, Redis, push | process liveness | ✗ | n/a | ✗ |
| PostgreSQL | all | authoritative state | AI #1 | managed (prod), compose (local) | — | `pg_isready` | ✗ | pg_dump ✓, provider ✗ | local ✓ |
| Redis | all | cache, queues, pub/sub | AI #2 | managed (prod), compose (local) | — | `PING` | ✗ | not backed up (by design) | local ✓ |
| Object storage | all | attachments, voice notes | AI #2 | R2/S3 (prod), MinIO (local) | — | bucket reachability | ✗ | provider versioning ✗ | local ✓ |
| Admin Web | all | staff console | AI #4 (app), AI #7 (delivery) | static or nginx image | API | `/healthz` | ✗ | n/a | builds ✓ |
| Parent app | all | Flutter | AI #3 | app stores | API | — | ✗ | n/a | **cannot build** |
| Teacher app | all | Flutter | AI #3 | app stores | API | — | ✗ | n/a | **cannot build** |
| LiveKit | all | voice + group calling | AI #2 | external SaaS | — | provider status | ✗ | n/a | ✗ |
| FCM / APNs | staging, prod | push | AI #2 | external | — | provider status | ✗ | n/a | ✗ |
| Jawwid Core | all | source of truth for accounts, children, subscriptions | external | external | — | Core status | ✗ | Core's own | boundary in flux |
| Sentry | staging, prod | error tracking | AI #7 | external SaaS | — | — | — | n/a | ✗ |
| OTLP / Grafana | staging, prod | metrics, traces, dashboards | AI #7 | external | — | — | — | n/a | ✗ |
| CI | — | build, test, gates | AI #5 (gates), AI #7 (pipeline) | GitHub Actions | — | — | — | n/a | file ✓, **never executed** |
| CD | staging, prod | deployment | AI #7 | GitHub Actions | registry, secret store | — | — | n/a | file ✓, release step **not implemented** |

## Repository artifacts

| Path | Purpose |
|---|---|
| `docker-compose.yml` | Local Postgres + Redis + MinIO, health-gated, ports overridable |
| `infra/docker/postgres-init/` | Creates the local application role |
| `infra/env/manifest.tsv` | **Machine-readable configuration source of truth** |
| `infra/env/{staging,production}.env.example` | Generated templates |
| `.env.example` | Local template |
| `apps/api/Dockerfile` | Multi-stage, non-root, tini, healthcheck |
| `apps/admin-web/Dockerfile` + `infra-nginx/` | Static delivery, CSP, SPA fallback, cache policy |
| `apps/api/src/infra/health/` | Liveness / readiness / detail endpoints |
| `apps/api/src/infra/http/bootstrap.ts` | Security headers, CORS allowlist, graceful shutdown |
| `apps/api/src/infra/build-info.ts` | Release identity reported by `/health/live` |
| `scripts/infra/dev.sh` | Local stack lifecycle |
| `scripts/infra/check-env.sh` | Per-environment configuration validation |
| `scripts/infra/render-env-template.sh` | Generates env templates from the manifest |
| `scripts/infra/check-web-env.sh` | Refuses secrets in a browser bundle |
| `scripts/infra/scan-secrets.sh` | Credential tripwire, worktree + history |
| `scripts/infra/smoke.sh` | Post-deploy verification |
| `scripts/infra/backup-db.sh` / `restore-db.sh` | Backup, checksum, guarded restore |
| `.github/workflows/ci.yml` | QA gates (AI #5) + infrastructure jobs (AI #7) |
| `.github/workflows/deploy-{staging,production}.yml` | Deployment, release step unimplemented |

## Ports (local)

| Service | Port | Override |
|---|---|---|
| API | 3000 | `PORT` |
| Admin Web dev server | 5174 | vite config |
| Postgres | 5433 | `POSTGRES_PORT` |
| Redis | 6380 | `REDIS_PORT` |
| MinIO API / console | 9000 / 9001 | `STORAGE_PORT` / `STORAGE_CONSOLE_PORT` |

## External accounts required — none of which exist

Git host · container registry · Postgres provider · Redis provider · object
storage · Firebase (FCM) · Apple Developer (APNs) · LiveKit · Sentry · metrics
backend · DNS and TLS · Apple App Store and Google Play.

This list is the practical content of BLOCKER-1 and BLOCKER-2 in
`production-readiness.md`.
