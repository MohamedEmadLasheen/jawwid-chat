# Handoff → AI #2 (Communication engine)

From AI #7 (infrastructure) · 2026-09-06

## 1. The worker entrypoint

The image is built to run **one artifact, two processes** (ADR-004):

```
API    : node dist/main.js
Worker : node dist/worker.js
```

`dist/worker.js` does not exist yet. Same image, so the worker can never be at a
different commit than the API — a worker running yesterday's code against
today's schema is a miserable class of bug.

The worker must handle `SIGTERM`: stop taking new jobs, finish in-flight work
within `SHUTDOWN_GRACE_MS` (15s), exit. `tini` is PID 1 in the image, so the
signal actually arrives — without a real init, PID 1 ignores SIGTERM and the
platform SIGKILLs you instead, dropping in-flight jobs on every deploy.

## 2. Queue requirements

`QUEUE_PREFIX` namespaces BullMQ keys per environment. It is required in every
environment: without it, a staging worker pointed at a shared Redis will consume
production jobs.

- **Jobs must be idempotent.** At-least-once is the only guarantee; a retried
  reminder must not send twice.
- Bounded retries with exponential backoff, plus a dead-letter queue. A job that
  vanishes silently is worse than one that fails loudly.
- Every job needs a timeout; an unbounded job holds a worker slot forever.
- Redis is `appendonly yes` / `noeviction`, so queued jobs survive a restart and
  are never evicted under memory pressure. If Redis is lost entirely, jobs are
  lost — please make pending work reconstructible from the database outbox.

Monitoring watches **oldest-job age**, not just queue depth: a depth of 5 that
never drains is an outage, a depth of 5,000 draining steadily is a busy morning.

## 3. Realtime

Socket.IO runs in the API process; `@socket.io/redis-adapter` is already a
declared dependency. Two things follow:

- With the adapter, **sticky sessions are not required** for WebSocket
  transport. The HTTP long-polling fallback *does* need affinity — either pin
  the transport to WebSocket or ask me to enable affinity at the proxy.
- Proxy idle timeout for upgraded connections must be ≥ 1h. A 60s idle timeout
  disconnects every quiet conversation once a minute.

Realtime is a delivery optimisation, never a source of truth. A dropped event
must be recoverable by re-reading server state on reconnect.

**Multi-instance realtime is unproven** (RISK-4). Two instances without the
adapter deliver events to only one of them, silently. This must be tested on
staging before any horizontal scaling.

## 4. Storage

The attachment bucket is **private in every environment, including local**
(ADR-005). Clients get short-lived signed URLs (`STORAGE_SIGNED_URL_TTL_SECONDS`,
300s), never credentials. Making local storage private too means you exercise
the signed-URL path daily, so an authorization bug shows up on a laptop rather
than in production.

Media does not flow through the API — clients upload and download directly
against storage after the API has authorized the request. Size limits are
configured per media type (`ATTACHMENT_MAX_BYTES_*`).

Attachments are the one data class with no second copy in the system: they
cannot be reconstructed from Postgres. Production storage will need versioning.

## 5. Push

`FCM_*` and `APNS_*` are defined and required in staging and production, empty
locally (stub the provider in development).

**The failure you will hit:** `APNS_PRODUCTION=false` points at Apple's sandbox
gateway, which cheerfully accepts production device tokens and delivers nothing.
It presents as "iOS push stopped working" with no error anywhere.
`check-env.sh` refuses `APNS_PRODUCTION != true` in production, so this can only
happen via a manual environment edit. Watch the invalid-token rate; a sudden
spike is nearly always this.

Push payloads must not carry sensitive data — no phone numbers, no tokens, no
internal notes, no message content beyond what the product has approved for a
lock screen.

## 6. Calling

`LIVEKIT_URL` is public and may ship in a client. `LIVEKIT_API_SECRET` is
server-side only; the server mints room tokens with a 300s TTL. The secret
scanner fails the build if it appears under `lib/` or `apps/admin-web/src/`.

Server clock skew invalidates short-TTL tokens — if calls fail to connect
intermittently, check the clock before the code. Video is Phase 2; no video
infrastructure exists and none should be built.

## 7. Timeouts you inherit

| | |
|---|---|
| HTTP request | `REQUEST_TIMEOUT_MS` 30s |
| Database statement | `DATABASE_STATEMENT_TIMEOUT_MS` 15s |
| Jawwid Core call | `CORE_TIMEOUT_MS` 5s, `CORE_RETRY_MAX` 3 |
| Shutdown grace | `SHUTDOWN_GRACE_MS` 15s |

Core latency must not become Chat latency. A Core outage degrades Core-dependent
features and leaves the rest of Chat running; do not let a Core failure corrupt
Chat state or fabricate Core data.

## 8. One thing to fix

`npm run typecheck` currently fails: the generated Prisma client no longer
exports members the test specs import (`MessageVisibility`, `OnBehalfMode`,
`ThreadKind`, `StaffRole`). `src/` still compiles, so the image builds, but the
CI typecheck gate will fail. Worth knowing: **the container build regenerates the
Prisma client from scratch**, so it catches drift that a local build hides behind
a stale generated client.
