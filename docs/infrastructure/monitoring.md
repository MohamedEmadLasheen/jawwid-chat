# Monitoring, Logging and Alerting

Owner: AI #7 · Date: 2026-09-05
Status: **specification.** No monitoring backend is provisioned (BLOCKER-3).
The application-side seams — health endpoints, build identity, sanitised probe
errors — exist and are verified.

## 1. Stack

| Concern | Tool | Status |
|---|---|---|
| Errors | Sentry (`SENTRY_DSN`) | variable defined, SDK not wired |
| Traces / metrics | OpenTelemetry → OTLP (`OTEL_EXPORTER_OTLP_ENDPOINT`) | variable defined, not wired |
| Dashboards / alerts | Grafana (or the hosting platform's built-in) | not provisioned |
| Logs | structured JSON to stdout, collected by the platform | format specified below |
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
