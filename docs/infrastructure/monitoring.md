# Monitoring, Logging and Alerting

Owner: AI #7 · Date: 2026-09-05 · Updated: 2026-10-21 (structured logs and error tracking wired);
2026-11-09 (LR-29: what is monitored at launch, what is missing, the minimal launch set, §7)
Status: **partly implemented.** No monitoring backend is provisioned (BLOCKER-3).
The application side — health endpoints, build identity, sanitised probe
errors, structured JSON logs and Sentry error tracking — exists and is tested;
metrics and dashboards do not. The only alerts are App Platform's two app-level
rules in the spec and, in production, the restart, memory and CPU alerts on the
API and the worker (§7.1, §7.4). **For launch, read §7.**

## 1. Stack

| Concern | Tool | Status |
|---|---|---|
| Errors | Sentry (`SENTRY_DSN`) | **wired** in API and worker (§3a); inert without a DSN |
| Traces / metrics | OpenTelemetry → OTLP (`OTEL_EXPORTER_OTLP_ENDPOINT`) | not wired; `OTEL_*` optional until it is |
| Dashboards / alerts | Grafana (or the hosting platform's built-in) | dashboards not provisioned; App Platform's `DEPLOYMENT_FAILED` and `DOMAIN_FAILED` in the spec (§7.1); production component alerts on `api` and `worker` (§7.4) |
| Logs | structured JSON to stdout, collected by the platform | **implemented** in API and worker (§3) |
| Health | `/health/live`, `/health/ready`, `/health` | **implemented and tested** |
| Uptime | DigitalOcean Uptime check against `/health/ready` | not provisioned; the owner creates it after the first deploy (§7.3) |

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
`notifications.dispatchDue`), unexpected exceptions from WebSocket handlers
(`WS <event>`, via `WsErrorReportFilter` on the gateway -- Nest applies no
global filter to gateways) and failed socket handshakes (`WS handshake`),
unhandled rejections, uncaught exceptions and a failed boot. **Not reported:**
4xx -- a refusal is the authorization service working; its WebSocket twins
(`WsException`, an `HttpException` below 500); and a `/health/*` probe's 503,
which is readiness draining traffic during an outage (the failure behind it is
reported by whatever hit it; a health route's 500 is still reported). Tags are
labels only: `route` (template or event name), `status`, `component`,
`actor_kind`, `version`; `extra` carries `request_id`, which joins an event to
its log line, and `suppressed` (below).

**Volume** (`error-budget.ts`): every report passes a per-process budget first
-- one event per kind of failure (component, route, status, error class,
Prisma code; never the message) per 15 minutes, and at most 20 events an hour
across all kinds. The next event of a kind after a quiet spell carries
`suppressed`, how many were held back. An uncaught exception or a failed boot
skips both limits (the process exits right after). The budget runs on a
monotonic clock, so a wall-clock correction cannot hide reports. A day-long outage of
both processes therefore sends under 1,000 events, where it would otherwise
send on the order of 10,000 an hour. Every failure is still logged in full;
the budget only removes duplicates from Sentry.

**What can never leave**, in three layers; the third does not trust the first two:

1. `defaultIntegrations: false` plus an allowlist of three (LinkedErrors,
   Dedupe, Context). RequestData, LocalVariables, Console, Http and NodeFetch --
   the integrations that attach bodies, headers, stack-frame locals, log lines
   and URLs -- are never loaded, and neither is anything a future SDK adds by
   default.
2. `sendDefaultPii: false`, no tracing, no breadcrumbs, no OpenTelemetry setup.
3. `beforeSend` **rebuilds** each event from an allowlist (`scrubEvent`) and
   carries **no free text**. No event message and no logentry are sent, and
   an exception's message is never copied -- not even redacted, because no
   pattern recognises a child's name or a line of a conversation. What is
   sent: ids, level, release, environment; per exception, its class (its
   constructor's name, else `Error`) and a value *built* from approved facts on the
   error object -- a Prisma code (`P2002`), a Node code (`ECONNREFUSED`), a
   SQLSTATE, the fixed statement-timeout code, an HTTP status
   (`InternalServerErrorException status=500`); frame locations without
   `vars` or source lines; the five tags; `request_id`; `suppressed`;
   runtime/os name and version. Every kept string must match its field's
   shape in full or it is dropped -- and no shape admits a bare word, which
   is what a one-word name would be: an exception type is the name of the
   error's *constructor* -- the class as declared in source -- never the
   writable `error.name` (which could say `LaylaError`), else `Error`; a route is an HTTP template, `WS area.action`,
   `WS handshake` or a worker `area.task` label; `actor_kind` and `component`
   are their closed vocabularies. Stack-frame file and function names are
   kept (they are the diagnosis): V8 takes them from source code, and no code
   here renames a function at runtime. There is no `request`, `user`, `breadcrumbs`,
   `server_name`, `transaction`, `fingerprint` or request-derived metadata on
   the event that is sent. The full message stays in the redacted log line
   (`request_id` joins the two), behind the log store's access controls.

`test/unit/observability/sentry-privacy-wire.spec.ts` plants synthetic
children's and parents' names, Arabic and English chat text, emails, phone
numbers, tokens, a password and a card number in every source an event could
draw from (message, cause, name, error properties, Prisma arguments, thrown
non-Errors, SDK scope, a direct `captureMessage`, application labels, a
WebSocket frame, an HTTP request, an unhandled rejection) and searches the
whole serialized envelope stream of a real SDK client for each of them.
`test/unit/observability/error-budget.spec.ts` measures the budget on the wire
(1,000 identical failures send one event; 14,400 across twenty subsystems in an
hour send 20), and `ws-error-report.filter.spec.ts` drives Nest's own
WebSocket exception handler and checks that no frame data, socket or token is
handed over and that the client's `exception` frame is unchanged.
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
- No SLOs agreed. Suggested starting point: API availability 99.5% monthly,
  p95 latency < 500 ms, message-send success > 99.9%.

## 7. Launch minimum: uptime, alerts, on call (LR-29)

The §5 table is the target. This section is what production actually has at
the first deploy, what is missing, and the smallest set that closes LR-29 with
no paid service. Nothing here changes a live system: the spec applies only at a
deploy the owner approves, and the console steps are the owner's.

### 7.1 What is monitored today

| Signal | Where | What it catches | Who hears it |
|---|---|---|---|
| Readiness `GET /health/ready` | App Platform `health_check` on `api` (`.do/app.production.yaml`, every 10 s, 3 failures) | Postgres or Redis unreachable (`apps/api/src/infra/health/health.service.ts`, `readiness()`; the revocation probe is reported but does not block readiness, `:121-122`); a 503 takes the instance out of routing, never restarts it | nobody: it is a routing decision, not an alert |
| Liveness `GET /health/live` | App Platform `liveness_health_check` on `api` (every 30 s, 3 failures) | a wedged API process; touches no dependency (`health.controller.ts`, `live()`), so the container is restarted | nobody directly; a restart loop shows only as `RESTART_COUNT` (§7.4) |
| Admin Web `GET /healthz` | App Platform health and liveness checks on `admin-web` | nginx down | nobody |
| Worker | none: it serves no HTTP, so it has no health check; a crash exits and App Platform restarts it | a crash, only as a restart | nobody (§7.4) |
| Post-deploy smoke test | `Smoke test` step of `.github/workflows/deploy-production.yml`, running `scripts/infra/smoke.sh` against `PRODUCTION_API_BASE_URL` | `/health/live` 200, `/health/ready` 200, no credential-shaped text in the health payload, security headers, CORS refuses a foreign origin | whoever ran the deploy (the workflow fails); once per deploy, never after |
| Errors | Sentry, API and worker (§3a) | 5xx, worker-subsystem failures, WebSocket handler faults, process faults | the members of the Sentry project, by Sentry's own notification rules. `SENTRY_DSN` is **required** in production (`infra/env/manifest.tsv`, `PROD` column `req`), so a production deploy without it is refused |
| `DEPLOYMENT_FAILED`, `DOMAIN_FAILED` | app-level `alerts:` in `.do/app.production.yaml` | a failed deploy; a domain or certificate that fails to configure | the App Platform alert destinations (§7.5); not yet set to anyone named |
| `RESTART_COUNT`, `MEM_UTILIZATION`, `CPU_UTILIZATION` | component `alerts:` on `api` and `worker` in `.do/app.production.yaml` (§7.4); live from the next approved production deploy | a crash loop (for the worker, its only crash signal); sustained memory or CPU pressure | the App Platform alert destinations (§7.5); not yet set to anyone named |
| Backups | `backup-daily.yml`, `backup-weekly.yml` (scheduled) | a failed backup run | GitHub e-mails a failed **scheduled** run to the user who last changed its `cron:` line, not to an on-call person |

All health routes sit outside `/api/v1` (`apps/api/src/main.ts`, the global
prefix excludes `health`, `health/live`, `health/ready`) and are
unauthenticated (`@Public()`), so an outside checker needs no token.

### 7.2 What is missing

1. **An uptime check from outside DigitalOcean's app.** Every probe above runs
   inside App Platform. If the domain, the TLS certificate, DNS or the whole app
   is down, nothing outside notices, and the smoke test runs only during a
   deploy.
2. **An on-call person (OA-19: the owner action "who is on call for production alerts" in the launch tracker, `docs/release/launch-readiness-checklist.md` §5, on PR #501's branch).** `incident-response.md` "Gaps": no rotation,
   no escalation path, no contact list. The owner names the person.
3. **An alert destination.** The two spec alerts and any uptime check need an
   e-mail address to go to; none is configured, and none can be inferred.
4. **Component alerts** for the API and the worker (CPU, memory, restarts):
   now in the production spec (§7.4), but not live until the next approved
   production deploy, and silent until their destinations are set (§7.5).

Still out of scope for launch, unchanged: metrics, dashboards, queue age,
error-rate alerts (§5, §6; BLOCKER-3).

### 7.3 Recommended minimal set for launch

No paid service. Every piece is either already in the spec, a DigitalOcean
feature on the existing account, or Sentry's existing project.

| # | What | Who, when |
|---|---|---|
| 1 | The owner names the on-call person and a backup (OA-19), and that person's e-mail. Both must be members of the DigitalOcean team (App Platform and Uptime only notify team members' e-mails) and of the Sentry project | owner, before launch |
| 2 | DigitalOcean Uptime check on `https://api.chat.jawwid.com/health/ready`, alerting the on-call e-mail (steps below) | owner, after the first production deploy succeeds |
| 3 | App Platform alert destinations: the on-call e-mail for `DEPLOYMENT_FAILED` and `DOMAIN_FAILED` (§7.5) | owner, after the first deploy (the app id exists only then) |
| 4 | Component alerts (§7.4): in the generator and the production spec; applied by the next approved deploy | engineering (done); the owner approves the deploy and sets destinations (§7.5) |
| 5 | Sentry: confirm the on-call person is a project member and the project's alert rule e-mails on a new issue (Sentry's default rule) | owner |

**Why `/health/ready` and not `/health/live`:** readiness is 503 whenever the
API cannot serve users (database or Redis down; a revocation backlog does not fail readiness, so nothing alerts on it yet) as well
as when the API itself is down, so it is the symptom users feel. `/health/live`
would stay green through a database outage. The §5 "API down" row predates this
choice; for launch the uptime check uses `/health/ready`.

**Steps: create the uptime check** (DigitalOcean control panel; labels may
read slightly differently in the console):

1. Wait until `Deploy production` has succeeded and its smoke test passed, and
   `https://api.chat.jawwid.com/health/ready` answers 200 in a browser.
2. Control panel → **Monitoring** → **Uptime** → **Create Uptime check**
   (or the project → **Create** → **Uptime check**).
3. Type **HTTPS**; URL `https://api.chat.jawwid.com/health/ready`; name
   `jawwid-chat-production-api-ready`; regions: pick **at least two**,
   including a European one (users and the app are in Frankfurt), so one
   region's network trouble is not reported as an outage.
4. Before saving, read the price shown. **If the console shows a charge, stop**:
   a paid resource is the owner's decision and this plan assumes none.
5. Add alerts on the check, each to the on-call e-mail:
   - **Down** (the check fails), period **2 minutes**: SEV-1 per §5.
   - **SSL certificate expiry**, **14 days** before: SEV-3 per §5.
   - **Latency** above **2000 ms** for **5 minutes**: optional; skip it if it
     turns out noisy.
6. Confirm the first results show the check **Up**. Do **not** take the
   production API down to test the alert; the check's history shows that it
   runs, and the e-mail address is the part to double-check.

Optional, same steps: a second check on the Admin Web host's `/healthz`.

**Staging:** no uptime check. Staging is not watched out of hours.

### 7.4 Component alerts (in the production spec)

**Implemented** in the generator: `COMPONENT_ALERTS` and
`component_alerts_block()` in `scripts/infra/app-spec.py` render the block
below into the `api` and `worker` components of `.do/app.production.yaml`
only; staging gets none. They take effect only at the next production deploy
the owner approves, and each needs its destination set afterwards (§7.5).

`.do/app.production.yaml` is **generated** (the header says so), and the
`app-spec` guard (`bash scripts/qa/guards.sh app-spec`) fails CI when the file
differs from what the generator renders. The same guard checks that both
components carry all three alerts (`alert_invariants`), accepts a literal
`value:` only as the numeric threshold of one of these alerts (every other
`value:` must stay a `${NAME}` placeholder), and runs
`doctl apps spec validate --schema-only` on the rendered spec, which checks
the field names (`alerts[]` on a service or worker: `rule`, `operator`,
`value`, `window`) against DigitalOcean's own AppSpec types.

```yaml
# under services[name=api] and workers[name=worker]
    alerts:
      # A crash loop. For the worker this is the ONLY crash signal: it has no
      # health check, and App Platform restarts it silently.
      - rule: RESTART_COUNT
        operator: GREATER_THAN
        value: 3
        window: FIVE_MINUTES
      - rule: MEM_UTILIZATION
        operator: GREATER_THAN
        value: 85
        window: TEN_MINUTES
      - rule: CPU_UTILIZATION
        operator: GREATER_THAN
        value: 90
        window: TEN_MINUTES
```

| Alert | Why this threshold |
|---|---|
| `RESTART_COUNT` > 3 in 5 min | one restart is a deploy or a single fault; four in five minutes is a loop. A wedged API needs about 110 s to be restarted by liveness (20 s initial delay + 3 × 30 s), so liveness alone restarts it at most about three times in 5 min; a process that crashes on boot restarts faster and crosses the threshold. A wedged API is caught by the uptime check instead |
| `MEM_UTILIZATION` > 85% for 10 min | the API runs on 1 GB, the worker on 0.5 GB; a sustained climb ends in an out-of-memory kill |
| `CPU_UTILIZATION` > 90% for 10 min | one shared vCPU each; sustained saturation shows as latency before it shows as errors |

Not proposed: `DEPLOYMENT_LIVE` (one e-mail per successful deploy is noise for
an on-call inbox; the deploy run already reports it), and alerts on `admin-web`
and the review-period `redis` component (Redis loss already shows as
`/health/ready` 503 on the uptime check). Production only: staging would send
the same e-mails to the same person.

### 7.5 Alert destinations

App Platform alerts carry no recipient in the spec. After the first deploy, the
owner sets the on-call e-mail as the destination of each app alert: the app →
**Settings** → alert policies in the console, or
`doctl apps list-alerts <app id>` and
`doctl apps update-alert-destinations <app id> <alert id> --alert-destinations <file>`
with the e-mail in the file. Repeat for the component alerts once §7.4 is
deployed (each alert is a separate id). The address must belong to a member of
the DigitalOcean team.

### 7.6 When LR-29 is done

- [ ] OA-19 answered: on-call person and backup named, e-mail known (owner).
- [ ] Uptime check on `/health/ready` exists, two or more regions, Down and
      certificate alerts to the on-call e-mail (owner, §7.3).
- [ ] `DEPLOYMENT_FAILED` and `DOMAIN_FAILED` deliver to the on-call e-mail (owner, §7.5).
- [ ] Component alerts deployed and delivering to the on-call e-mail (§7.4,
      §7.5). In the generator and the rendered production spec already;
      deploy and destinations pending.
- [ ] On-call person is in the Sentry project and gets new-issue e-mails.
- [ ] `incident-response.md` "Gaps" updated with the named contact.
