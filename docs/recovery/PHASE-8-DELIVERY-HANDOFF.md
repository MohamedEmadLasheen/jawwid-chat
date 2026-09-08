# Phase 8 → Delivery Validation Handoff

Date: 2026-09-08 · Branch: `phase7/ai-and-automation`
Delivery baseline: **`f7248de`** · Code baseline: **`90aa0c7`**

This is the handoff from engineering to delivery validation. It contains **no
new engineering** and adds no numbers of its own — the evidence lives in
[PHASE-8-EXTERNAL-GATE.md](PHASE-8-EXTERNAL-GATE.md), which remains the single
authoritative set of figures, and the complete/blocked/deferred split lives in
[PHASE-8-FREEZE.md](PHASE-8-FREEZE.md).

Its only job is to say **who must do what next, and what evidence closes each
item.**

---

## 1. Baseline reconciliation

HEAD moved twice after the immutable sign-off (`b9b5f1d` → `7806434` → `f7248de`),
both times for documentation. That was **verified, not assumed**:

| Check | Result |
|---|---|
| `git diff --name-only 90aa0c7..HEAD` | 6 files, all under `docs/` |
| Non-docs files in that range | **none** |
| `git diff --stat 90aa0c7..HEAD -- . ':(exclude)docs'` | **empty — not one byte differs** |
| Tree hash of `apps` `lib` `scripts` `supabase` `db` `.github` `android` `ios` `test` | **identical at `90aa0c7` and HEAD** |
| Working tree | clean |

Identical tree hashes across every code-bearing directory is proof rather than
inference: **the sign-off's verified numbers describe the current HEAD exactly.**

## 2. The frozen baseline

| Role | Commit | Why |
|---|---|---|
| **Code baseline** | `90aa0c7` | Last commit touching code. Everything verified — 450 unit, 762 integration, 111 web, 52 migrations, 6/6 suites, guards 9/9 — was measured against this tree |
| **Delivery baseline** | `f7248de` (HEAD) | Identical code, plus the complete documentation set. **Push this** |

No commit was created to record the freeze. The check that keeps this document
honest as HEAD moves again is:

```bash
git diff --name-only 90aa0c7..HEAD | grep -vE '^docs/'   # empty ⇒ numbers still valid
```

---

## 3. Classification of every remaining item

| Item | Classification | Repository work? | External dependency? | Blocking? | Required evidence |
|---|---|---|---|---|---|
| **B-1** Git remote | EXTERNAL BLOCKER | No | Git host + account | **YES** | A workflow run exists |
| **B-2** Hosting | EXTERNAL BLOCKER | No | Cloud account, DNS, TLS | **YES** | `check-env.sh production` passes against the real env |
| **B-3** Mobile toolchain/runtime | EXTERNAL BLOCKER | No | CI runner + devices | **YES** for mobile | CI mobile job green; device matrix executed |
| **B-4a** Metrics emission | **REPOSITORY ENGINEERING** | **YES** | Backend only to *consume* | Not for staging | `/metrics` (or OTLP) serves the golden signals; tests assert counters move |
| **B-4b** Alerts | EXTERNAL BLOCKER | No | Metrics backend + routing | No | An alert fires on a synthetic fault |
| **B-4c** `CORE_*` required but unconsumed | **REPOSITORY ENGINEERING** | **YES** | None | Blocks a *clean* deploy | `check-env.sh production` passes without Core credentials |
| **B-5** Staging | EXTERNAL BLOCKER | No | Hosting | **YES** | Smoke test passes |
| **B-6** Multi-instance realtime | DOWNSTREAM | No | Two instances | No | Message on node 1 → subscriber on node 2 |
| **B-7** Error tracking operational | DOWNSTREAM | No | Sentry project | No | A real 5xx appears in Sentry |
| **B-8** `integration_test` for device E2E | REPOSITORY ENGINEERING | YES | Devices to run it | No | Journeys pass on a device |
| **B-9** Push credentials | EXTERNAL BLOCKER | No | APNs + FCM | **YES** for push | A real push received, incl. killed-app |
| **B-10** LiveKit production | EXTERNAL BLOCKER | No | LiveKit project | **YES** for calls | Audio both ways between two devices |
| **B-11** Production load | DOWNSTREAM | Yes (a staging-capable harness) | Staging | No | p50/p95/p99 + error rate from staging |
| **B-12** Backup storage | EXTERNAL BLOCKER | No | Encrypted bucket | No | Restore from the bucket passes |
| **B-13** RPO / RTO | DOWNSTREAM | No | Staging | No | Timed drill numbers recorded |
| **B-14** Penetration test | EXTERNAL BLOCKER | No | Third party | No | Report triaged |
| CI execution | EXTERNAL BLOCKER | No | B-1 | **YES** | All 7 jobs green on a runner |
| Staging environment | EXTERNAL BLOCKER | No | B-2 | **YES** | Deployed + smoke |
| Production environment | EXTERNAL BLOCKER | No | B-2 | **YES** | Deployed + smoke + rollback rehearsed |
| Mobile runtime/device validation | EXTERNAL BLOCKER | No | B-3, B-9 | **YES** for mobile | §7 matrix executed |
| LiveKit media-path validation | EXTERNAL BLOCKER | No | B-10 + devices | **YES** for calls | Real call, audio both ways |
| Backup restore drill (staging) | DOWNSTREAM | No | B-5 | No | App instance on restored DB reaches `/health/ready` |
| Jawwid Core / CRM integration | **NOT REQUIRED** | No | Core delivering events | No | Deferred by design — `chat.core_event` has no writer |
| Everything in `PHASE-8-FREEZE.md` §COMPLETE | COMPLETE | — | — | No | Already executed here |

### B-4c — a new finding from this audit, and it removes an external dependency

`CORE_BASE_URL`, `CORE_API_KEY`, `CORE_WEBHOOK_SECRET`, `CORE_TIMEOUT_MS` and
`CORE_RETRY_MAX` are **`req` in production**, three of them secrets. Verified
this pass: **not one of them is referenced anywhere in `apps/` or `lib/`**, and
no Core client class exists. `chat.core_event` is documented as dormant —
nothing writes it.

So a production deploy is currently refused unless the operator supplies an API
key and a webhook secret for an integration the code does not perform. This is
exactly the pattern already corrected for `OTEL_*` (commit `e9666e3`), and it is
**repository work, not an external dependency** — filing it as "provision Jawwid
Core" would put a false prerequisite on the owner's list.

**Not fixed in this task**, per the handoff's no-code-changes rule: it is
pre-existing, not a regression introduced after the sign-off. Recommended fix is
one line per row in `infra/env/manifest.tsv` (`req` → `opt`, regenerate the
templates), to be flipped back in the same commit that implements a Core client.

---

## 4. B-4a — the metrics decision

**Decision: implement it, but it does NOT have to precede staging.**

1. **Minimally required.** Exactly the golden signals `monitoring.md` §2 already
   specifies, and nothing more: request rate; error rate with **4xx and 5xx
   separate**; latency histogram; WebSocket connections; **queue depth and
   oldest-job age** (§2 is explicit that oldest-job age matters more); database
   pool utilisation. Process CPU/memory/event-loop lag come free from a default
   Node collector.
2. **Where emitted.** Both processes — the API and the worker. The worker is
   where queue depth and oldest-job age live, and it is the process most likely
   to fail silently.
3. **Components to instrument** — all four seams already exist, which is why this
   is small:
   - `RequestLogInterceptor` already computes route pattern, status and
     `latency_ms` per request. Rate, error rate and the latency histogram are
     three lines at a seam that is already there.
   - `HealthService` already probes Postgres and Redis with latency and status.
   - `worker.ts` already runs the outbox drain loop.
   - `RealtimeGateway` already tracks connection lifecycle.
4. **Surface.** A `/metrics` endpoint in Prometheus text format, **not public** —
   it must sit behind the same default-deny `AuthGuard` or be bound to an
   internal interface. An OTLP push exporter is the alternative and is the reason
   `OTEL_*` still exists in the manifest as `opt`.
5. **Tests that would prove it.** Unit: the registry serialises the expected
   series and **carries no label containing user-controlled text** — a route
   *pattern* is a bounded label set, a raw URL is unbounded cardinality and a
   privacy leak, the same distinction the logger already enforces. Integration:
   drive a request and a 5xx and assert the counters move; assert `/metrics`
   requires authentication.
6. **Smallest production-appropriate implementation.** One dependency
   (`prom-client`), one registry module, four instrument sites, one guarded
   endpoint. Follow the `ErrorTracker`/`NoopErrorTracker` pattern already in
   `infra/observability/` so it is inert when unconfigured.
7. **Can it wait for staging?** **Yes, and it should.** Nothing consumes metrics
   until a backend exists (B-4b), the four seams are stable and will not move,
   and implementing an exporter with no collector to point it at is the
   unverifiable-work pattern this phase spent its time removing. The one thing
   that must not happen is deploying to *production* without it: at that point
   detection is a person noticing.

**Sequence: B-1 → B-2 → B-5 (staging) → B-4a → B-4b → production.**

---

## 5. CI delivery path

Nothing here is CI evidence. CI status is **BLOCKED — NO REMOTE / NO CI
EXECUTION** until a run exists.

1. Create the remote; push `phase7/ai-and-automation` at `f7248de`.
2. Confirm workflow discovery — three workflows should appear (`ci`,
   `deploy-staging`, `deploy-production`).
3. **First real run.** Expect failures; this pipeline has never executed.
   Most likely first-run failures, in order of probability:
   - the **mobile** job (first-ever Flutter install, `flutter analyze` on 29
     never-analyzed test files, first-ever Gradle/APK build);
   - the **images** job (first-ever Docker build with a from-scratch Prisma
     generate);
   - the **migrations** job's PGDG `postgresql-client-17` install step;
   - the restore drill's `chat_app` login step, which has only ever run against
     a local container.
4. Remediate. These are CI-only failures by definition — the same code passes
   here — so fix the pipeline, not the application, unless a failure reproduces
   locally.
5. Re-run to green.
6. **Only then** may any row in the gate matrix move from Locally Verified to CI
   Verified.
7. Set branch protection; make the seven jobs required checks.

---

## 6. Staging readiness — what this repository actually requires

Taken from the 44 production-required rows in `infra/env/manifest.tsv`, not from
a generic checklist.

**Required — the application will not start or function without these:**

| Service | Why the repo needs it | Evidence it is right |
|---|---|---|
| **PostgreSQL 17** | The entire domain; RLS is enforced against `chat_app` | `DATABASE_URL`, `DATABASE_POOL_MAX`, `DATABASE_STATEMENT_TIMEOUT_MS` |
| **Redis** | Presence, typing, the Socket.IO adapter, BullMQ | `REDIS_URL`, `QUEUE_PREFIX`, `WORKER_CONCURRENCY`; consumed in 6 files |
| **API hosting** | `dist/main.js` | `PORT`, `CORS_ALLOWED_ORIGINS`, `REQUEST_TIMEOUT_MS`, `SHUTDOWN_GRACE_MS` |
| **Worker process** | `dist/worker.js` — the outbox drain. Separate process, same image (ADR-004) | `WORKER_CONCURRENCY` |
| **Object storage (S3-compatible)** | Attachments and story media; signed URLs | 7 `STORAGE_*` rows, consumed in 3 files |
| **LiveKit** | Voice calls; the API mints room tokens | 4 `LIVEKIT_*` rows, consumed in 2 files |
| **APNs + FCM** | Push. `Firebase.initializeApp()` is wired in the app | 7 `push` rows, both consumed |
| **Secret store** | 13 rows are marked SECRET and must not come from a tracked file | manifest `SECRET` column |
| **Domain + TLS** | `CORS_ALLOWED_ORIGINS` fails closed; HSTS is set unconditionally | `bootstrap.ts` |
| **Sentry** | `SENTRY_DSN` is `req` **and consumed** | `sentry-error-tracker.ts` |

**Explicitly NOT required to stand staging up:**

- **Jawwid Core / CRM.** Required by the manifest, consumed by nothing (B-4c).
  Do not provision an endpoint or mint credentials for it to run staging.
- **A metrics backend.** Nothing emits metrics yet (B-4a).
- **An alerting stack.** Downstream of metrics (B-4b).
- **Kubernetes, a service mesh, a message broker, a CDN.** The repository
  requires none of them. Two processes, a database, Redis, a bucket, LiveKit.

---

## 7. Mobile validation — what must be supplied externally

The repository is **wired**; nothing has run. These are prerequisites, not
achievements.

| Requirement | Exact version / form |
|---|---|
| Flutter SDK | ≥ 3.47.0 (`pubspec.yaml`) |
| Dart SDK | ^3.13.0 |
| JDK | **17** (`JavaVersion.VERSION_17`, `JVM_17`) |
| Gradle | 9.3.1 (wrapper self-downloads) |
| Android SDK | compile/min/target from Flutter defaults |
| Xcode + CocoaPods | iOS deployment target **15.0** |
| `google-services.json` | Android, gitignored — **must be supplied** |
| `GoogleService-Info.plist` | iOS, gitignored — **must be supplied** |
| APNs key + FCM service account | for real delivery |
| Physical devices | ≥ 1 iOS, ≥ 1 Android; 2 of one platform for multi-device |
| `integration_test` package | **absent** — add before on-device journey automation (B-8) |

Behaviours that must be exercised on real devices, none of which a widget test
can reach: **foreground / background / killed-app notifications · notification
tap → deep link (re-authorized server-side) · offline → reconnect · poor network ·
Wi-Fi ↔ cellular handover · app killed and reopened mid-conversation · the same
account on two devices.** The properties to assert are no message loss, no
duplicate delivery, no duplicate notification, correct ordering after reconnect,
and read state converging.

---

## 8. Production load validation

Current classification, preserved verbatim: **LOCAL LOOPBACK BASELINE — NOT
PRODUCTION LOAD VALIDATED.** The local figures (78 / 126 / 103 ops/sec at 100
concurrent, ±30% between runs) are **not** a capacity claim and must not be
quoted as one.

To convert this into a meaningful production result:

- **A staging-capable harness.** The current one drives services **in process**;
  it has no HTTP or WebSocket client and cannot target a deployed environment
  without new code (B-11).
- **Scenarios A–G** from `PHASE-8-EXTERNAL-GATE.md` §5.2 — 10/50/100 concurrent,
  a 100-family broadcast, 100+ WebSockets with a reconnect storm, two-instance
  realtime, and a 4-hour soak.
- **Per run, recorded:** concurrency, duration, requests, successes, failures,
  p50/p95/p99, throughput, CPU, memory, DB connections in use, queue depth,
  **oldest-job age**, WS connections.
- **Production-shaped data volume**, because §3 of the baseline proves there is
  no N+1 at *small* scale only; plans can change with cardinality.

---

## 9. E2E delivery evidence

Classifications preserved. What each still needs:

| Journey | Current | External evidence required |
|---|---|---|
| J1 Family messaging | AUTOMATED + LOCALLY VERIFIED | Staging run through the real HTTP/WS stack, from a device |
| J2 Moderation | AUTOMATED + LOCALLY VERIFIED | Staging run via Admin Web in a browser |
| J3 Supervisor transfer | AUTOMATED + LOCALLY VERIFIED | Staging run; confirm live WS subscriptions move with ownership |
| J4 Voice call | AUTOMATED + EXTERNAL DEPENDENCY | **Real media path**: LiveKit project, two devices, audio both ways, reconnect mid-call, background behaviour |
| J5 Broadcast | AUTOMATED + LOCALLY VERIFIED (partial) | **100-family fan-out on staging** with delivery tracking, retries, partial failure and completion state |

Also needed and not covered by any journey: **real notification delivery** —
foreground, background and killed-app, with tap → deep link re-authorized
server-side.

---

## 10. Backup / restore — the staging drill

The local bare-cluster drill is **PASS** and is not to be repeated. What staging
adds is the one link the local chain cannot contain:

1. Back up staging (encrypted; `BACKUP_ENCRYPTION_PASSPHRASE` set).
2. Restore into a scratch database in the same environment.
3. Verify parity and run all six `db/tests/*.sql` suites against the copy.
4. Confirm the application role reads **and writes**.
5. **Point a running application instance at the restored database and reach
   `/health/ready` = 200.** No drill has ever covered this.
6. Time steps 1–5.

```
RPO — NOT MEASURED
RTO — NOT MEASURED
```

Neither is estimated. They become real numbers at step 6 and not before.

---

## 11. Observability — the split, restated so it cannot be re-merged

| | B-4a Metrics | B-4b Alerts |
|---|---|---|
| Classification | **REPOSITORY ENGINEERING** | **EXTERNAL BLOCKER** |
| Work location | `apps/api/src/infra/observability/` | The alerting backend |
| Evidence it is real | no `/metrics`, no `prom-client`, no OTLP meter, no instrument anywhere in `src/` | no alert definitions; `monitoring.md` §1 says they belong to the tool |
| Depends on | nothing — writable today | B-4a **and** a backend |
| Owner | AI #7 (code) | AI #7 (configuration) |
| Exit criteria | `/metrics` serves the golden signals; authenticated; tests assert counters move | An alert fires on a synthetic fault and is actionable |

A metrics backend cannot scrape what is not emitted. Provisioning one first buys
nothing.

---

## 12. Action lists

### OWNER ACTIONS — in dependency order

1. **Create a Git remote** and grant push access. *(unblocks everything)*
2. **Push** `f7248de`.
3. **Provision hosting**: PostgreSQL 17, Redis, API + worker runtime, an
   S3-compatible bucket, a domain and TLS.
4. **Provide a secret store** and populate the 13 SECRET rows.
5. **Create a LiveKit project** (B-10) and a **Sentry project** (B-7).
6. **Supply push credentials**: APNs key + FCM service account, plus
   `google-services.json` and `GoogleService-Info.plist` (B-9).
7. **Provide devices**: ≥ 1 iOS, ≥ 1 Android, plus a second of one platform.
8. **Provision a metrics/alerting backend** — *after* B-4a lands.
9. **Provide encrypted off-host backup storage** (B-12).
10. **Commission a penetration test** (B-14).
11. **Decide** whether Jawwid Core integration is in scope for launch. If not,
    B-4c is simply a manifest correction; if yes, it is a new feature and a new
    phase.

### CLAUDE ACTIONS — each waits on a named prerequisite

| Action | Waits on |
|---|---|
| Fix the first real CI run's failures | B-1, and a run existing |
| **Implement B-4a metrics** (§4) | B-5 staging, so it can be verified against something |
| **Correct B-4c** — `CORE_*` `req` → `opt`, regenerate templates | Owner decision (11) |
| Write a staging-capable load harness and run A–G | B-5 |
| Add `integration_test` and port the journeys (B-8) | B-3 devices |
| Run the staging restore drill; record RPO/RTO | B-5 |
| Prove multi-instance realtime (B-6) | Two staging instances |
| Re-run the readiness gate against the real environment | All of the above |

### NO ACTION — complete, do not reopen

Authentication · authorization · tenant and supervisor isolation · IDOR/BOLA ·
RLS · API and WebSocket security · file security · rate limiting · AI abuse
protection · queue and outbox reliability · notification retry logic · backup
and restore mechanics · structured logging and redaction · health checks · error
tracking *code* · the guard suite · the migration constraint guard · the
performance harness · all Phase 8 documentation.

---

## 13. Final gate

| Gate | Current state | Next evidence |
|---|---|---|
| Code | **COMPLETE** — frozen at `90aa0c7`, tree-hash verified | None required |
| Security | **LOCALLY VERIFIED** | Staging run; penetration test |
| Reliability | **LOCALLY VERIFIED** | Staging failure injection |
| Database | **LOCALLY VERIFIED** — fresh + upgrade + restored | Migrations applied to staging |
| Backup/Restore | **LOCALLY VERIFIED** (incl. app READ + WRITE) | Staging drill with a live app instance; RPO/RTO |
| CI | **BLOCKED — no remote** | A green run on a runner |
| Metrics | **REPOSITORY ENGINEERING (B-4a)** | `/metrics` serving the golden signals |
| Alerts | **EXTERNAL BLOCKER (B-4b)** | An alert fires on a synthetic fault |
| Mobile | **REPOSITORY READY / RUNTIME BLOCKED** | CI mobile job green; device matrix executed |
| LiveKit | **TOKEN CONTRACT VERIFIED / MEDIA PATH BLOCKED** | Real call, audio both ways |
| E2E | **J1–J3, J5 LOCALLY VERIFIED · J4 PARTIAL** | Staging + devices; 100-family broadcast |
| Load | **LOCAL LOOPBACK BASELINE** | Staging scenarios A–G at production data volume |
| Staging | **DOES NOT EXIST** | Deployed; smoke test passes |
| Production | **DOES NOT EXIST** | Deployed; smoke; rollback rehearsed |

---

### A. What is DONE

Every repository-level engineering control Phase 8 set out to establish, verified
by execution rather than inspection and re-verified at the frozen baseline:
security (authn, authz, tenant and supervisor isolation, IDOR/BOLA, RLS, API and
WebSocket, files, rate limiting, AI cost abuse), reliability (queues, outbox,
notification retry), data integrity across fresh, upgraded **and restored**
databases, backup and restore mechanics end-to-end including schema ACLs and
application read *and* write, structured logging with enforced redaction, health
checks, error-tracking code, and a nine-check guard suite proven by 13 negative
probes. The working tree is clean and the code baseline is tree-hash identical to
HEAD.

### B. What is BLOCKED BY THE ENVIRONMENT

Everything that requires something this machine does not have: a Git remote
(so **no CI run has ever existed**), hosting and therefore staging and
production, a mobile toolchain and physical devices (**29 test files have never
executed anywhere**), a LiveKit project for the media path, push credentials, a
metrics/alerting backend, encrypted off-host backup storage, and a third-party
penetration test. **B-1 and B-2 are the two that gate all the others.**

### C. What Claude still needs to implement in the repository

Exactly two items, neither blocking staging:

1. **B-4a — metrics emission.** Genuinely repository work; four instrument seams
   already exist. Should follow staging so it can be verified against a real
   collector rather than assumed.
2. **B-4c — `CORE_*` required but unconsumed.** A manifest correction,
   contingent on the owner's decision at OWNER ACTION 11. It is listed here
   rather than on the owner's list because it is repository work, and filing it
   as "provision Jawwid Core" would invent an external dependency the code does
   not have.

Nothing else. **No further engineering phase is warranted; the next evidence must
come from the delivery environment.**
