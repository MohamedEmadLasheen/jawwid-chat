# Monitoring, Logging and Alerting

Owner: AI #7 · Date: 2026-09-05 · Updated: 2026-10-21 (structured logs and error tracking wired)
Status: **partly implemented.** No monitoring backend is provisioned (BLOCKER-3).
The application side — health endpoints, build identity, sanitised probe
errors, structured JSON logs and Sentry error tracking — exists and is tested;
metrics, dashboards and alerts do not.

## 1. Stack

| Concern | Tool | Status |
|---|---|---|
| Errors | Sentry (`SENTRY_DSN`) | **wired** in API and worker (§3a); inert without a DSN |
| Traces / metrics | OpenTelemetry → OTLP (`OTEL_EXPORTER_OTLP_ENDPOINT`) | not wired; `OTEL_*` optional until it is |
| Dashboards / alerts | Grafana (or the hosting platform's built-in) | not provisioned |
| Logs | structured JSON to stdout, collected by the platform | **implemented** in API and worker (§3) |
| Health | `/health/live`, `/health/ready`, `/health` | **implemented and tested** |
| Uptime | external HTTP check against `/health/live` | not provisioned |

No second system for anything already covered — one error tracker, one metrics
pipeline (role assignment §41).

## 2. Signals

**Golden signals, per service (API, worker):** request rate, error rate
(5xx and 4xx separately — a 4xx spike is usually a client bug or an attack),
p50/p95/p99 latency, saturation (CPU, memory, event-loop lag).

| Area | Track |
|---|---|
| API | uptime, latency, error rate, in-flight requests |
| Database | connection-pool utilisation, query latency, slow queries, replication lag, disk |
| Redis | availability, memory, evicted keys (**must be 0** — `noeviction` is set), connected clients |
| Queues | depth per queue, oldest-job age, completion rate, failure rate, dead-letter size, worker heartbeat |
| Realtime | connected sockets per instance, connect/disconnect rate, auth rejections, pub/sub lag |
| Push | send attempts, failures by provider, invalid-token rate, delivery latency |
| Storage | upload/download errors, signed-URL failures, bucket size |
| Calling | token mints, room join failures, call setup latency, drop rate |
| Jawwid Core | request rate, error rate, timeout rate, webhook receipt and signature failures |
| Host | CPU, memory, disk, network |

**Oldest-job age matters more than queue depth.** A depth of 5 that never drains
is an outage; a depth of 5,000 draining steadily is a busy morning.

## 3. Logging

Structured JSON, one object per line, to stdout. **Implemented** in
`apps/api/src/infra/observability/json-logger.ts`, used by both processes
(`service` is `api` or `worker`) and constructed before the Nest application, so
the lines written while modules wire up -- and a startup failure -- are JSON too.
Level is `LOG_LEVEL` (default `info`; `environment.md`).

```json
{"ts":"2026-10-20T13:20:11.482Z","level":"info","env":"production",
 "service":"api","commit":"a1b2c3d","context":"Http","message":"request",
 "request_id":"7f3a1b2c-...","route":"POST /api/v1/conversations/:id/messages",
 "status":201,"latency_ms":42,"actor_kind":"staff"}
```

Always: `ts`, `level`, `env`, `service`, `commit`, `message`. Where relevant:
`context`, `request_id`, `route`, `status`, `latency_ms`, `actor_kind`,
`error_code`. Those are the ONLY fields: anything else a caller attaches is
dropped. `correlation_id`, `job_id` and `queue` are not emitted yet (§4).

**The request log** (`request-log.ts`) writes one line per HTTP request, from
the response's `finish` event, so it includes guard refusals (401), unmatched
routes (404) and the status an exception filter finally chose. `route` is the
route TEMPLATE Express matched, never the resolved path; a request that matched
no route logs `<unmatched>`. It never reads the body, the query string (a media
link's `s=` signature lives there) or any header except `X-Request-Id`. 4xx is
`warn`, 5xx `error`, a client that disconnected first `499`/`warn`, and a
successful health probe or preflight `debug`.

**How the rule below is enforced**, in order of strength:

1. *Nothing serialises content.* A log message is a string; an `Error`
   contributes its message, never its stack (Nest passes the stack as a
   parameter -- it is discarded); any other object becomes a fixed placeholder.
   A Prisma error is logged as its class and code only, because Prisma prints
   the arguments of the failed call -- a message body, a name -- into its
   message.
2. *A field allowlist* (above).
3. *`redact()`* (`redact.ts`) on every message, as a backstop for free-form
   text: bearer tokens, JWTs, credential assignments, DSN passwords, email
   addresses, phone numbers (including Arabic-Indic digits), query strings,
   URLs and paths carrying a UUID (object keys, resolved ids), Postgres
   constraint DETAIL values. It cannot recognise a name or a message body, so it
   is never a reason to log one.

**Never logged:** passwords, tokens, `Authorization` headers, database or storage
credentials, **message content**, **phone numbers**, private staff notes, or any
customer data not needed to diagnose the entry. Identify people by opaque id.

Phone privacy is a product rule (PRD BR / role assignment §1), and logs are one
of the places it is most easily broken — a phone number in a log line is exposed
to everyone with log access and every downstream log processor.

## 3a. Error tracking

Sentry, behind an `ErrorTracker` seam (`error-tracker.ts`). Nothing imports the
SDK except `sentry-error-tracker.ts`, which is `require`d only when
`SENTRY_DSN` is set; otherwise the tracker is a no-op and `@sentry/node` is never
loaded. Release is `GIT_COMMIT`, environment `APP_ENV`.

**Reported:** API 5xx (with the exception the handler threw, captured by
`RequestErrorCaptureInterceptor`; a 5xx with no exception -- a failed guard --
as a fixed `HttpServerError`), every worker subsystem failure the loop survives
(`outbox.drain`, `stories.sweep`, `calls.expireRinging`, `lessons.sweep`,
`notifications.dispatchDue`), unhandled rejections, uncaught exceptions and a
failed boot. **Not reported:** 4xx -- a refusal is the authorization service
working. Tags are labels only: `route` (template), `status`, `component`,
`actor_kind`, `version`; `extra` carries `request_id`, which joins an event to
its log line.

**What can never leave**, in three layers; the third does not trust the first two:

1. `defaultIntegrations: false` plus an allowlist of three (LinkedErrors,
   Dedupe, Context). RequestData, LocalVariables, Console, Http and NodeFetch --
   the integrations that attach bodies, headers, stack-frame locals, log lines
   and URLs -- are never loaded, and neither is anything a future SDK adds by
   default.
2. `sendDefaultPii: false`, no tracing, no breadcrumbs, no OpenTelemetry setup.
3. `beforeSend` **rebuilds** each event from an allowlist (`scrubEvent`): ids,
   level, release, environment, the redacted message, exception types and
   redacted values (Prisma errors as class and code), frame locations without
   `vars` or source lines, the five tags, `request_id`, and the runtime/os
   contexts. There is no `request`, `user`, `breadcrumbs`, `server_name`,
   `transaction` or request-derived metadata on the event that is sent.

`test/unit/observability/error-tracker.spec.ts` asserts each layer, and drives a
real SDK client over an in-memory transport with a scope deliberately loaded
with a user, a draft, a signed URL and breadcrumbs, then checks the wire bytes.

**Process faults** (`process-errors.ts`): an unhandled rejection is logged,
reported, and the process continues; an uncaught exception is logged, reported,
flushed (bounded, 2 s) and the process exits 1, as Node would -- resuming after
one is unsafe. Shutdown flushes the tracker before exiting.

## 4. Correlation

One customer message must be traceable end to end **without exposing its
contents**:

```
HTTP request (request_id)
  └─ database write        (correlation_id)
     └─ outbox / event     (correlation_id)
        └─ queued job      (correlation_id, job_id)
           └─ push send    (correlation_id)
           └─ realtime emit(correlation_id)
```

`X-Request-Id` is accepted from the edge and generated if absent; it is echoed
back on the response (already in the CORS `exposedHeaders` allowlist). The
`correlation_id` is minted at the entry point and carried through the outbox and
into every job the write spawns.

## 5. Alerts

Alert on symptoms users feel, and on conditions that will become those symptoms.
Every alert names an owner and links to a runbook section. An alert nobody acts
on gets muted, and a muted alert is worse than none.

| Alert | Condition | Severity |
|---|---|---|
| API down | `/health/live` failing from outside for 2 min | **SEV-1** |
| API error rate | 5xx > 2% of requests over 5 min | SEV-2 |
| Database unavailable | readiness reports database down, 2 min | **SEV-1** |
| Database near capacity | connections > 80% or disk > 85% | SEV-2 |
| Redis unavailable | readiness reports redis down, 2 min | **SEV-1** |
| Redis evicting keys | evicted_keys > 0 | SEV-2 (queue data loss) |
| Queue not draining | oldest job age > 15 min | SEV-2 |
| Worker dead | no heartbeat for 5 min while jobs are pending | SEV-2 |
| Job failure spike | failure rate > 10% over 10 min | SEV-2 |
| Push failure spike | provider errors > 20% over 15 min | SEV-3 |
| Invalid push tokens | invalid-token rate > 30% | SEV-3 (often APNs sandbox/production mismatch) |
| Realtime disconnect storm | disconnect rate 5× baseline | SEV-2 |
| Storage errors | upload/download failures > 5% over 10 min | SEV-3 |
| Calling failures | room-join failure > 10% over 10 min | SEV-3 |
| Core integration failing | Core error or timeout rate > 25% over 10 min | SEV-3 (degrades, does not take Chat down) |
| Certificate expiry | < 14 days | SEV-3 |
| Deployment failed | pipeline failure on main | SEV-3 |

**Deliberately not alerted:** single 5xx responses, a single failed job inside
its retry budget, brief latency spikes within SLO, a Core timeout that succeeded
on retry.

## 6. Gaps

- Nothing is provisioned; the table above is a target, not a running system.
  Error tracking needs a Sentry project and its DSN in the secret store.
- OpenTelemetry is not initialised: no metrics, no traces. `OTEL_*` stay
  optional until an exporter is wired.
- `correlation_id` is not carried through the outbox yet, and log lines written
  outside the request log do not carry the `request_id` (§4).
- WebSocket handler failures are logged by the gateway but not reported to the
  error tracker; only HTTP 5xx, the worker loop and process faults are.
- No SLOs agreed. Suggested starting point: API availability 99.5% monthly,
  p95 latency < 500 ms, message-send success > 99.9%.
