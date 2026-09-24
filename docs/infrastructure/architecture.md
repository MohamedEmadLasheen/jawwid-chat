# Infrastructure Architecture

Owner: AI #7 · Date: 2026-09-05

This describes the infrastructure that runs Jawwid Chat, not the product's
domain design (AI #1) or its communication engine (AI #2). Where the repository
and this document could disagree, the repository wins — sections marked
**PLANNED** describe infrastructure that does not exist yet and say so.

Jawwid Chat is an **independent product**. It shares no infrastructure,
credentials, domains, pipelines or deployment machinery with any other system.
Its only external dependency on the wider Jawwid estate is the Jawwid Core API
and database, across an explicit, read-only boundary.

---

## 1. Components

| Component | Technology | Process | State | Status |
|---|---|---|---|---|
| API | NestJS 11 (Node 22) | `node dist/main.js` | stateless | code exists, **no bootstrap yet** |
| Worker | same image | `node dist/worker.js` | stateless | **PLANNED** (AI #2) |
| Realtime | Socket.IO on the API process | — | in-memory per instance | dependency declared, not wired |
| Database | PostgreSQL 17 | managed | **authoritative state** | live locally |
| Cache / queue | Redis 7 | managed | ephemeral + queue durability | live locally |
| Object storage | S3-compatible (R2 in production, MinIO locally) | managed | attachments | local only |
| Push | FCM + APNs | external | — | **PLANNED** |
| Calling | LiveKit | external | rooms | **PLANNED** |
| Admin Web | React 18 + Vite, static | CDN or nginx | none | builds |
| Mobile | Flutter (parent + teacher) | app stores | local cache | **cannot be built** (no `pubspec.yaml`, no SDK) |
| Jawwid Core | external API + database | external | source of truth for accounts, children, subscriptions | boundary views exist |

---

## 2. Traffic flow

```
   Parent app     Teacher app     Admin Web (browser)
        |              |                  |
        |  HTTPS + WSS |                  | HTTPS + WSS
        +--------------+---------+--------+
                                 |
                        [ TLS / reverse proxy ]      PLANNED
                                 |
                    +------------+------------+
                    |                         |
                API instances            static bundle
              (HTTP + Socket.IO)         (Admin Web)
                    |
     +--------------+----------------+--------------------+
     |              |                |                    |
 PostgreSQL       Redis          Object storage       External:
 (authoritative) (cache,        (attachments,        Jawwid Core
                  queues,        voice notes)        FCM / APNs
                  pub/sub)                           LiveKit
                    |
                Worker instances
              (BullMQ consumers)
```

Media never flows through the API: clients upload to and download from object
storage directly, using short-lived signed URLs the API issues after it has
authorized the request. This keeps large transfers off the API's connection
budget and means an attachment cannot be read without an authorization decision.

---

## 3. Network boundaries

| Boundary | Rule |
|---|---|
| Public internet → API | HTTPS only. TLS terminates at the proxy or platform edge. |
| Public internet → Admin Web | HTTPS only, static assets, no server-side execution. |
| API → Postgres | Private network. **The database is never publicly reachable.** TLS required (`sslmode=disable` is refused by `check-env.sh`). |
| API → Redis | Private network, authenticated, TLS where the provider offers it. Never public. |
| API → object storage | Server-side credentials. Clients never receive storage credentials — only signed URLs. |
| API → Jawwid Core | Outbound HTTPS, authenticated, bounded by `CORE_TIMEOUT_MS`. |
| Core → API (webhooks) | Inbound HTTPS, signature-verified with `CORE_WEBHOOK_SECRETS`. |
| Client → LiveKit | Direct, using a short-lived token minted by the API. The LiveKit **API secret never leaves the server**. |

---

## 4. Failure boundaries

The design goal is that a failure degrades a feature rather than the product.

| Fails | Effect | Readiness | Behaviour |
|---|---|---|---|
| Postgres | total | **not ready** → drained | Nothing works; state is authoritative here. Highest-severity dependency. |
| Redis | severe | **not ready** → drained | Queues and cross-instance realtime fan-out stop. Messages already persisted are safe. |
| Object storage | partial | ready | Text messaging continues. Uploads and attachment reads fail, visibly. |
| Push provider | partial | ready | In-app delivery unaffected. Notifications are retried by the worker; delivery is delayed, not lost. |
| LiveKit | partial | ready | Calling unavailable. Messaging and approvals unaffected. |
| **Jawwid Core** | partial | **ready** | Chat keeps running. Core-dependent reads degrade and surface an explicit error. Chat must **not** fabricate Core data, and must not become a second source of truth. |
| One API instance | none | that instance drained | Clients reconnect to another instance. |
| Worker | delayed | API unaffected | Jobs queue in Redis and drain when the worker returns. A worker crash must never take down the API — separate processes, ADR-004. |

Readiness deliberately covers only Postgres and Redis (ADR-007). Everything else
is watched by monitoring, not by the load balancer.

---

## 5. Realtime

Socket.IO runs in the API process. With more than one API instance, a client
connected to instance A must receive events published by instance B, so the
Redis adapter (`@socket.io/redis-adapter`, already a declared dependency) fans
events out over Redis pub/sub.

Consequences that follow from that, and that the application must respect:

- **No sticky sessions are required** for correctness once the adapter is in
  place. Socket.IO's HTTP long-polling fallback *does* require affinity, so
  either pin the transport to WebSocket or enable session affinity at the proxy.
- **Realtime is a delivery optimisation, never a source of truth.** A dropped
  event must be recoverable by re-reading server state; the client reconciles on
  reconnect. Server-side persistence is authoritative.
- **The realtime layer must not bypass application authorization.** Room
  membership is an authorization decision, evaluated by the same code path as
  HTTP — which matters most for BR-1, the Teacher↔Parent prohibition.
- Reverse proxies must not kill idle upgraded connections; see §8.

*Status: dependencies declared, gateway not yet implemented (AI #2).*

---

## 6. Queues and workers — PLANNED

BullMQ on Redis. Queue keys are namespaced by `QUEUE_PREFIX` per environment, so
a misconfigured staging worker cannot consume production jobs.

Requirements infrastructure places on the worker (AI #2 owns the implementation):

- Jobs are **idempotent**. At-least-once delivery is the only guarantee on
  offer; a retried reminder must not send twice.
- Bounded retries with exponential backoff, and a dead-letter queue for
  exhausted jobs — a job that vanishes silently is worse than one that fails.
- Every job has a timeout. An unbounded job holds a worker slot forever.
- The worker handles `SIGTERM` by refusing new jobs, finishing in-flight work
  within the grace period, and exiting.
- Redis is configured `appendonly yes` and `maxmemory-policy noeviction`: a
  queue backend that evicts keys under memory pressure deletes pending work.

---

## 7. Environments

| | Local | Staging | Production |
|---|---|---|---|
| API | `npm run start` or container | container host | container host |
| Postgres | container (compose) | managed | managed, backups + PITR |
| Redis | container (compose) | managed | managed |
| Storage | MinIO | R2/S3 bucket | R2/S3 bucket |
| Push | stubbed | real, APNs **sandbox** | real, APNs **production** |
| LiveKit | local or shared dev | LiveKit project | LiveKit project |
| Core | shim / dev instance | Core staging | Core production |
| Secrets | `.env`, throwaway | GitHub Environment `staging` | GitHub Environment `production` |
| Deploy | — | automatic on merge to main | manual, protected |

Staging exists to catch what unit tests cannot: realtime across instances, queue
behaviour, push integration, storage permissions, migrations against real data
shape, and configuration. It does not need production's capacity.

Cross-environment rules, enforced by `check-env.sh`:
production credentials never appear in local; staging credentials never appear
in production; `localhost` endpoints are rejected outside local; `DEBUG`,
`USE_MOCK_PUSH`, `USE_MOCK_CORE` and `PRISMA_STUDIO` are forbidden outside local;
`ALLOW_INSECURE_TLS` is forbidden everywhere.

---

## 8. Edge, timeouts and limits — PLANNED

| Setting | Value | Reason |
|---|---|---|
| TLS | 1.2+ | — |
| Proxy read timeout (HTTP) | 60s | Above the API's own 30s request timeout. |
| Proxy timeout (WebSocket) | ≥ 1h idle | A 60s idle timeout on an upgraded connection disconnects every quiet chat once a minute. |
| Request body limit | 1 MB JSON | Attachments go to object storage, not through the API. |
| API request timeout | `REQUEST_TIMEOUT_MS`, 30s | |
| Database statement timeout | `DATABASE_STATEMENT_TIMEOUT_MS`, 15s | One slow query must not hold a pooled connection indefinitely. |
| Core API timeout | `CORE_TIMEOUT_MS`, 5s | Core latency must not become Chat latency. |
| Health probe timeout | `HEALTH_PROBE_TIMEOUT_MS`, 2s | A hung probe reads as a dead process. |
| Shutdown grace | `SHUTDOWN_GRACE_MS`, 15s | Then a hard exit, so a stuck connection cannot block a deploy. |

Rate limiting is configurable per surface (authentication, message send, upload,
search, calls, admin APIs). Limits are AI #5's to set; infrastructure provides
the knobs.

---

## 9. Secrets

Secrets live in the platform's secret store — GitHub Environments for CI/CD, the
hosting platform's own store at runtime. They are injected as environment
variables at deploy time and are never committed, never logged, never returned
by an API response, and never compiled into a client. `secrets.md` covers
rotation and leak recovery; `scan-secrets.sh` and `check-web-env.sh` enforce the
tracked-file and client-bundle halves in CI.

---

## 10. Scaling

The MVP scales the boring way, in this order:

1. **API instances** — stateless; add replicas. Requires the Socket.IO Redis
   adapter for realtime correctness.
2. **Workers** — add replicas; BullMQ distributes by concurrency.
3. **Postgres** — vertical first, then read replicas for reporting. The Admin
   Inbox and Manager Dashboard are the first read-heavy surfaces.
4. **Redis** — vertical; separate the cache instance from the queue instance
   before clustering either.
5. **Object storage / CDN** — effectively unbounded; put a CDN in front of
   signed reads if attachment traffic grows.

Explicitly **not** built now: Kubernetes, service mesh, multi-region, event bus,
microservices. None is justified by MVP scale, and each adds failure modes that
cost more than the load they would absorb (ADR-003, role assignment §74).
