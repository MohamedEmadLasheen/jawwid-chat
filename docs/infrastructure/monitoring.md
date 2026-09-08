# Monitoring, Logging and Alerting

Owner: AI #7 · Date: 2026-09-05 · Logging implemented in Phase 8 (2026-09-08)
Status: **partly implemented.** Structured JSON logging and per-request
correlation now exist and are tested (§3). Everything that needs a BACKEND —
error tracking, metrics, dashboards, alerts — remains unprovisioned
(BLOCKER-3). The application-side seams — health endpoints, build identity,
sanitised probe errors — exist and are verified.

## 1. Stack

| Concern | Tool | Status |
|---|---|---|
| Errors | Sentry (`SENTRY_DSN`) | **implemented and tested** (§7) |
| Traces / metrics | OpenTelemetry → OTLP (`OTEL_EXPORTER_OTLP_ENDPOINT`) | variable defined, not wired |
| Dashboards / alerts | Grafana (or the hosting platform's built-in) | not provisioned |
| Logs | structured JSON to stdout, collected by the platform | **implemented and tested** (§3) |
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

Structured JSON, one object per line, to stdout.

```json
{"ts":"2026-09-05T13:20:11.482Z","level":"info","env":"production",
 "service":"api","request_id":"01J...","correlation_id":"01J...",
 "actor_kind":"STAFF","route":"POST /api/v1/messages","status":201,
 "latency_ms":42,"commit":"a1b2c3d"}
```

Always: timestamp, level, `env`, `service`, `request_id`, `commit`. Where
relevant: `correlation_id`, `job_id`, `queue`, `error_code`, `latency_ms`.

**Never logged:** passwords, tokens, `Authorization` headers, database or storage
credentials, **message content**, **phone numbers**, private staff notes, or any
customer data not needed to diagnose the entry. Identify people by opaque id.

Phone privacy is a product rule (PRD BR / role assignment §1), and logs are one
of the places it is most easily broken — a phone number in a log line is exposed
to everyone with log access and every downstream log processor.

### How that rule is actually enforced (Phase 8)

Implementation: `src/infra/observability/json-logger.ts`,
`src/infra/observability/request-log.interceptor.ts`.
Tests: `test/unit/observability/`.

Two controls, and it matters which is which — conflating them is how the weaker
one ends up trusted:

**1. A field allowlist — this is the real control.** `JsonLogger` writes a fixed
set of declared fields and silently drops everything else, and the request
interceptor never reads a body, a query string or a header at all. Content
cannot leak through a channel that never carries content. Somebody attaching
`{ body }` to a log call "to help with debugging" gets nothing in the output.

**2. Pattern redaction — a backstop, and only that.** Free-form messages are
scrubbed for bearer tokens, JWTs, `secret`/`password`/`token`/`api_key`
assignments, passwords inside connection strings, and phone numbers. It
recognises the shapes it knows and no others, so it is **never** a licence to log
something sensitive on the grounds that the logger will catch it.

The redaction is deliberately narrow. A scrubber that rewrote anything long and
alphanumeric would destroy the UUIDs and commit hashes that make a log
correlatable, and a log nobody can follow is not safer — it is useless as well as
leaky. UUIDs, commit hashes and route patterns pass through untouched.

Routes are logged as **patterns** (`POST /conversations/:id/messages`), never as
resolved URLs. That aggregates for latency queries, and it keeps user-controlled
text out of the log store: a search term, a filename or an id arrives in the path
or the query string, and unmatched requests — 404s and guard refusals, which is
what a scan produces — have their identifier segments masked.

Actor identity is logged as `actor_kind` only (STAFF / TEACHER / FAMILY). That
answers "are family users seeing these errors?", which is what logs get asked,
without accumulating a record of which individual did what. Audit answers that
question deliberately, in a place with access controls on it.

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
- Sentry and OpenTelemetry SDKs are not initialised — that belongs in the API
  bootstrap, which does not exist yet.
- No SLOs agreed. Suggested starting point: API availability 99.5% monthly,
  p95 latency < 500 ms, message-send success > 99.9%.

---

## 7. Error tracking (implemented 2026-09-08)

Closes blocker **B-4** for errors. `SENTRY_DSN` was `req` in staging and
production while nothing read it -- an operator obliged to supply a credential
that no code consumed, and "detection = a person noticing" in the meantime.

**The seam.** Nothing in the application imports Sentry; it imports
`ErrorTracker`. `createErrorTracker()` returns the real one when `SENTRY_DSN`
is set and `NoopErrorTracker` when it is not -- the same shape as
`OBJECT_STORAGE`, `PUSH_PROVIDER`, `CALL_RECORDER` and `AI_PROVIDER`. The SDK is
reached through a lazy `require`, so a process without a DSN never loads it.

**What is reported.** 5xx responses, plus `unhandledRejection` and
`uncaughtException` in both the API and the worker, plus every subsystem error
the worker loop deliberately swallows -- those are the ones that would otherwise
be a log line on a machine nobody is watching. A 4xx is **not** reported: a 403
from the authorization service is the system working, and reporting every
correct refusal would bury the one real fault of the day.

**What is never transmitted.** The privacy rule is that conversation content
does not leave the systems that govern it, and an error tracker is the easiest
place to break that rule by accident. Three layers, and the third does not trust
the other two:

1. the `Console`, `LocalVariables`, `RequestData`, `Http` and `NodeFetch`
   integrations are not loaded. `LocalVariables` is the most dangerous default
   in the SDK for this application -- in this codebase a stack-frame local is
   routinely a message body or a drafted reply;
2. `sendDefaultPii` is false and `tracesSampleRate` is 0;
3. `beforeSend` deletes `request`, `user`, `breadcrumbs` and `server_name`
   outright, strips `vars` and source context from every frame, and runs the
   message, every exception value and every `extra` string through the **same**
   `redact()` the log store uses -- so the two can never disagree about what a
   secret looks like.

The request is deleted rather than filtered on purpose: an allowlist of safe
request fields is a list somebody eventually adds `body` to.

Tags carry the route **pattern** (`POST /conversations/:id/messages`, never a
resolved URL), `actor_kind`, status and component; `extra` carries the request
id, so an event joins the log line that recorded the same failure.

Verified by `test/unit/observability/error-tracker.spec.ts` (12 assertions),
which tests `scrubEvent` directly rather than through a live SDK, so every claim
above about what does not leave this process is executable.
