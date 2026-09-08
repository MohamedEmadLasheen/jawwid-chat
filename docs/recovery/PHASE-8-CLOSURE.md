# Phase 8 — Final Closure

Date: 2026-09-08 · Branch: `phase7/ai-and-automation`
Verification HEAD: `ae67dfb` (measured) · Closure commits through `d735aaa`
Supersedes nothing in [PHASE-8-REPORT.md](PHASE-8-REPORT.md); extends it.

> **The verdict here was re-gated on 2026-09-08 at `7e3225e`.** The
> classification is unchanged (PRODUCTION CANDIDATE — EXTERNAL BLOCKERS) but
> that gate found three further live defects and re-verified everything;
> [PHASE-8-EXTERNAL-GATE.md](PHASE-8-EXTERNAL-GATE.md) is authoritative for
> the matrix, the blocker register and the owner's next actions.

> ## FINAL CLASSIFICATION
> # PRODUCTION CANDIDATE — EXTERNAL BLOCKERS
>
> Every remaining blocker requires something this machine does not have: a git
> remote, hosting, a mobile toolchain, or a third party. **No engineering
> blocker remains open in the backend or web application.**
>
> This is a change from the previous verdict of NOT PRODUCTION READY, and it is
> justified below rather than asserted. It is **not** a claim that the system
> works when deployed — nothing has been deployed.

---

# 1. Phase 8 final reconciliation

The blocker list carried into this pass, reconciled against the repository as it
actually is. **Do not trust the old numbering** — several items were already
closed, and two were mis-stated.

| Prev. ID | Item | Status | Basis |
|---|---|---|---|
| P8-03 | No git remote / CI never executed | **BLOCKED BY EXTERNAL ACCESS** | `git remote -v` empty. Unchanged and unchangeable here |
| P8-04 | No hosting / staging / secret store / observability backend | **BLOCKED BY INFRASTRUCTURE** | No IaC of any kind exists (no Terraform, Helm, k8s, Pulumi). Only `docker-compose.yml` for local dev |
| P8-05 | Mobile unverified — Flutter/Dart/JDK unavailable | **BLOCKED BY INFRASTRUCTURE** | Still absent on this host. CI is now genuinely wired to run it (§4) |
| P8-06 | Rate limiting | **FIXED + VERIFIED** | 6 action scopes + WS frame budget. 13 assertions on a real database |
| P8-07 | DB security suites not gated | **FIXED + VERIFIED** | All 6 gated in `ci.yml`; all 6 pass on a fresh DB at HEAD |
| P8-08 | Observability | **PARTIALLY VERIFIED** | Structured logging + health checks implemented and tested (27 assertions). **Error tracking wired and tested (12 assertions, `0054ae9`/`6d70846`).** Metrics and alerts still absent |
| P8-09 | No production-scale load test | **PARTIALLY VERIFIED** | Local baseline + a full concurrency curve now exist. Production scale still **BLOCKED — NO STAGING** |
| P8-10 | Documentation / release gate | **FIXED** | Release gate carries an execution-backed §1a; readiness doc corrected; runbook gained backup/restore/rotation |

## 1a. What this closure pass found that was NOT on any list

Five defects, none of which existed on the prior blocker list. Four were live.

| # | Severity | Finding | Status |
|---|---|---|---|
| **C-1** | **P0** | A concurrent migration restated the `auth_throttle` scope CHECK and dropped `reset_request_subject`, the per-target axis of the forgot-password throttle. On an existing database the migration aborts; on a fresh one it applies and then **every forgot-password request raises a check violation**. Both reproduced | **FIXED** (one line, in the peer's commit `ed28d20`) + regression test |
| **C-2** | **P1** | `ci.yml`'s own G-20 step matches `ci.yml`. Run verbatim under bash, the guards job **could never have passed** | **FIXED** |
| **C-3** | **P1** | A real employee name from the product brief (`مريم`, 4 occurrences in the brief, on the G-20 list) was shipping in `lib/core/data/fake_backend.dart` as a learner displayName | **FIXED** |
| **C-4** | **P1** | Environment templates drifted from the manifest **again**, six hours after the same defect was fixed. CI's first job was red once more | **FIXED**, and the gate is now runnable in one command so it is discoverable without CI |
| **C-5** | **P2** | The LiveKit contract suite reported ✓ having contacted nothing. Its result with a real LiveKit 1.8.4 on `:7880` was **byte-identical** to the run with no server | **FIXED** — `JAWWID_REQUIRE_LIVEKIT=1` makes absence a failure; the run now states which it was |

**C-1 and C-4 arrived during this pass, from other agents.** That is the standing
hazard of five agents in one working tree, and it is why the guards are now a
script anyone can run before committing rather than eight steps inside a
pipeline that has never executed.

## 1b. Phase 8 commit map

All eleven Phase 8 commits verified present at HEAD; nothing lost to concurrent
activity.

| Commit | Purpose | Evidence | Status |
|---|---|---|---|
| `53151a6` | Unblock CI (scanner false positives, template drift) | guards 8/8 | intact |
| `6cbb432` | Backup restorable + CI restore drill | bare-cluster drill, 6/6 suites | intact |
| `11e52ab` | Authenticated + WebSocket abuse limits | 13 int, 13 unit | intact |
| `ea4a8e6` | Performance baseline | measured table | intact |
| `6c8e7bc` | Structured JSON logging | 27 unit | intact |
| `8c7b70d` | Mobile job actually runs Flutter | unexecuted (no remote) | intact |
| `9c10390` | Readiness report + doc corrections | — | intact |
| `49a9d8c` | Throttle-vocabulary regression test | 3 int | closure |
| `1b2cd04` | Harness parameterised; concurrency curve | 4-point curve | closure |
| `15e652b` | LiveKit suite cannot pass while verifying nothing | 3 modes | closure |
| `d735aaa` | Guards runnable + C-2/C-3/C-4 fixed | 8 negative probes | closure |

---

# 2. Production readiness evidence matrix

**This is the authoritative table.** Categories are used strictly:

- **Implemented** — code/config exists.
- **Local** — actually executed successfully here, on this machine.
- **CI** — a CI provider executed it. **Nothing has any CI evidence: there is no remote.**
- **Staging / Production** — executed against a real environment. **Nothing has any.**

Measured at `ae67dfb` in a clean detached worktree (so the numbers are
attributable to committed code, not to a working tree carrying other agents'
edits): **438 unit · 762 integration · 111 web · 52 migrations · 6/6 DB suites.**

| Area | Implemented | Local evidence | CI | Staging | Prod | Status |
|---|---|---|---|---|---|---|
| Authentication | ✅ | ✅ 9 adversarial assertions (forged key, `alg:none`, tampered payload, expired, revoked session, deactivated account, reset-invalidates-all) | ✗ | ✗ | ✗ | **Locally Verified** |
| Authorization | ✅ | ✅ role/ownership/manager matrices; client-supplied fields read by nothing | ✗ | ✗ | ✗ | **Locally Verified** |
| Tenant isolation | ✅ | ✅ 6 API assertions + `tenant_isolation.sql` + DB-level cross-org refusal with the service bypassed | ✗ | ✗ | ✗ | **Locally Verified** |
| Supervisor isolation | ✅ | ✅ before **and after** transfer; `assignment_invariants.sql` | ✗ | ✗ | ✗ | **Locally Verified** |
| IDOR / BOLA | ✅ | ✅ 7 explicit id-substitution cases across family, conversation, message, group, approval | ✗ | ✗ | ✗ | **Locally Verified** |
| API security | ✅ | ✅ headers, CORS allowlist fail-closed, stable error envelope, no stack leakage | ✗ | ✗ | ✗ | **Locally Verified** |
| WebSocket security | ✅ | ✅ auth, forged room id, revocation mid-session, typing isolation, frame flooding | ✗ | ✗ | ✗ | **Locally Verified** |
| File security | ✅ | ✅ key binding, traversal, cross-conversation key, thumbnail key, short-lived URLs | ✗ | ✗ | ✗ | **Locally Verified** |
| Rate limiting | ✅ | ✅ 13 assertions incl. 10-concurrent-vs-limit-5 admitting exactly 5 | ✗ | ✗ | ✗ | **Locally Verified** |
| Backup | ✅ | ✅ dump + checksum, privileges captured (186 grants) | ✗ | ✗ | ✗ | **Locally Verified** |
| Restore | ✅ | ✅ bare cluster, full parity, 6/6 integrity suites on the copy | ✗ | ✗ | ✗ | **Locally Verified** |
| Queues | ✅ | ✅ retry, idempotency, backoff | ✗ | ✗ | ✗ | **Locally Verified** |
| Outbox | ✅ | ✅ crash-safety suite | ✗ | ✗ | ✗ | **Locally Verified** |
| Notifications | ✅ | ✅ FCM 503, APNs 410/400/503, dedupe, quiet hours | ✗ | ✗ | ✗ | **Locally Verified** |
| CRM sync | ⚠️ dormant | — | ✗ | ✗ | ✗ | **NOT APPLICABLE — by design.** `chat.core_event` is an ingestion boundary with **no writer**; Jawwid Core delivers nothing yet |
| Logging | ✅ | ✅ 27 assertions; field allowlist + redaction, both directions | ✗ | ✗ | ✗ | **Locally Verified** |
| Error tracking | ✅ | ✅ 12 assertions on `scrubEvent` and the 5xx/4xx boundary; inert without a DSN | ✗ | ✗ | ✗ | **Locally Verified.** `SENTRY_DSN` is consumed by `infra/observability/sentry-error-tracker.ts`. No event has been transmitted to a real Sentry project — there is no project |
| Metrics | ❌ | — | ✗ | ✗ | ✗ | **NOT IMPLEMENTED.** Same for `OTEL_*` |
| Alerts | ❌ | — | ✗ | ✗ | ✗ | **NOT IMPLEMENTED.** Detection today = a person noticing |
| Health checks | ✅ | ✅ liveness never touches a dependency; readiness reports `degraded`; probe errors sanitised; reports `rlsEnforced` | ✗ | ✗ | ✗ | **Locally Verified** |
| Backend tests | ✅ | ✅ 438 unit + 762 integration | ✗ | ✗ | ✗ | **Locally Verified** |
| Data integrity | ✅ | ✅ 6/6 suites on a **fresh** DB and on a **restored** DB | ✗ | ✗ | ✗ | **Locally Verified** |
| E2E — J1 messaging | ✅ | ✅ service + realtime + persistence | ✗ | ✗ | ✗ | **Locally Verified** (no browser/device) |
| E2E — J2 moderation | ✅ | ✅ hold → decide → audit | ✗ | ✗ | ✗ | **Locally Verified** |
| E2E — J3 transfer | ✅ | ✅ A loses access, B gains history, on the next call | ✗ | ✗ | ✗ | **Locally Verified** |
| E2E — J4 voice | ✅ | ⚠️ **token contract verified against a real LiveKit 1.8.4** (accepted / wrong-secret refused / expired refused / one room only). **No media path, no audio, no device** | ✗ | ✗ | ✗ | **Partially Verified** |
| E2E — J5 broadcast | ✅ | ✅ fan-out, dedupe, retries, tracking — **not at 100-family scale** | ✗ | ✗ | ✗ | **Partially Verified** |
| Mobile | ✅ code | ❌ **never executed anywhere** | ✗ | ✗ | ✗ | **BLOCKED — NOT VERIFIABLE IN THIS ENVIRONMENT** |
| Performance | ✅ harness | ✅ latency table + 4-point concurrency curve | ✗ | ✗ | ✗ | **Partially Verified** — local only |
| CI/CD | ✅ | ✅ guards 8/8 locally + 8 negative probes; YAML valid; every referenced path exists | ❌ **never executed** | ✗ | ✗ | **BLOCKED — NO REMOTE / NO CI EXECUTION** |
| Deployment | ⚠️ workflows only | — | ✗ | ✗ | ✗ | **BLOCKED.** Both deploy workflows are complete **except the Release step, which fails on purpose** (ADR-003) |
| Secret hygiene (repo) | ✅ | ✅ scanner clean over worktree **and full history**; hard rules proven still active in test paths | ✗ | ✗ | ✗ | **Locally Verified** |
| Secret management (prod) | ❌ | — | ✗ | ✗ | ✗ | **BLOCKED — PRODUCTION INFRASTRUCTURE.** No secret store exists |

---

# 3. Production blocker register

| ID | Sev | Area | Problem | Evidence | Why it blocks production | Required action | Owner | Dependency |
|---|---|---|---|---|---|---|---|---|
| **B-1** | P0 | CI/CD | No git remote; no workflow has ever executed | `git remote -v` is empty | Every gate is unproven. The pipeline was red twice in one day and only manual runs found it | Create the remote, push, run CI, fix what the first real run finds | Product owner | — |
| **B-2** | P0 | Hosting | No environment, domain, TLS, managed Postgres/Redis/bucket, push credentials, LiveKit project | No IaC of any kind in the repo; Release steps fail deliberately | Nothing can be deployed | Provision hosting and a secret store | Product owner | — |
| **B-3** | P0 | Mobile | 30 Dart test files have never executed anywhere | No `flutter`, `dart` or JDK on this host | Both apps are untested by construction | Run the CI mobile job (§4) | Clears with B-1 | B-1 |
| **B-4** | P1 | Observability | **Metrics and alerts** remain absent. Error tracking is now wired | `grep -r OTEL_ apps/api/src` → nothing | No metrics pipeline, so saturation and queue-depth signals do not exist; alerting has nothing to alert on | Wire an OTLP exporter, and flip `OTEL_*` back to `req` in the same commit | AI #7 | B-2 |
| **B-4a** | — | Observability | **CLOSED.** Error tracking wired; `SENTRY_DSN` consumed and `OTEL_*` downgraded to `opt`, so the manifest no longer requires a credential nothing reads | `0054ae9`, `6d70846`, manifest §observability | — | — | — | — |
| **B-5** | P1 | Staging | Nothing has been deployed or smoke-tested anywhere | No environment | Every "Locally Verified" row above is unproven under a real topology | Deploy to staging; run `scripts/infra/smoke.sh` | Clears with B-2 | B-2 |
| **B-6** | P1 | Realtime | Multi-instance realtime unproven (RISK-4) | Redis adapter is a declared dependency, never a demonstrated behaviour | Two instances without a working adapter silently deliver events to only one | Run two API instances on staging and assert cross-instance delivery | AI #2 | B-5 |
| **B-7** | P2 | Backup | **CLOSED.** `backup-db.sh` encrypts at rest (`aes-256-cbc`/PBKDF2) and REFUSES an unencrypted dump when `APP_ENV` is staging or production, before dumping | `7b8851e`; an `APP_ENV=production` encrypted dump restored into a scratch database passing 6/6 integrity suites; wrong and missing passphrase both refused | — | Provider-side backups still need B-2 | AI #7 | — |
| **B-8** | P2 | Mobile | `integration_test` is **not a dependency** | absent from `pubspec.yaml` | On-device journey automation cannot be written as-is; device testing stays manual | Add `integration_test`, port the journeys | AI #3 | B-3 |
| **B-9** | P2 | Performance | No measurement at production data volume or topology | §4 of the baseline | Query plans chosen over hundreds of rows may not hold over millions | Seed production-shaped data; re-run §3 of the baseline | AI #5 | B-5 |
| **B-10** | P2 | Security | No third-party penetration test | — | Internal tests find what we thought to test for | Commission one | Product owner | B-2 |

**No P0 or P1 blocker is an engineering defect in the application.** Every one
is the absence of an environment, a toolchain, or a third party.

---

# 4. Mobile execution plan

Everything below is **specification, not evidence**. Nothing in it has run.

## 4.1 Required external environment

| Requirement | Version | Source |
|---|---|---|
| Flutter SDK | ≥ 3.47.0 | `pubspec.yaml` `environment.flutter` |
| Dart SDK | ^3.13.0 | `pubspec.yaml` `environment.sdk` |
| JDK | **17** | `android/app/build.gradle.kts` (`JavaVersion.VERSION_17`, `JVM_17`) |
| Gradle | 9.3.1 | wrapper (downloads itself) |
| Xcode + CocoaPods | iOS deployment target **15.0** | `ios/Runner.xcodeproj/project.pbxproj` |
| `integration_test` | **MISSING** | not in `pubspec.yaml` — **B-8** |

## 4.2 Commands

```bash
flutter pub get
flutter gen-l10n && git diff --exit-code -- lib/l10n   # generated files are COMMITTED
flutter analyze --no-pub
flutter test --no-pub --reporter expanded              # all 30 files
flutter build apk --debug                              # Gradle, plugins, manifest
flutter build ios --debug --no-codesign                # macOS only
```

The live-backend suite skips itself unless pointed at a running API:

```bash
scripts/db/integration-db.sh up
# start apps/api (dist/main.js) and the worker (dist/worker.js)
DATABASE_URL=... scripts/qa/phase2-smoke/run.sh        # seeds smoke_parent / smoke_supervisor
JAWWID_LIVE_API=http://127.0.0.1:3999/api/v1 \
JAWWID_LIVE_PARENT_SUBJECT=smoke_parent \
JAWWID_LIVE_ADMIN_SUBJECT=smoke_supervisor \
JAWWID_LIVE_PASSWORD=smoke-password-long-enough \
  flutter test test/integration/live_backend_test.dart
```

## 4.3 Device test matrix — **all rows UNEXECUTED**

| Platform | Environment | Journey | Expected | Status |
|---|---|---|---|---|
| iOS | Simulator | Login | Pass | ☐ not run |
| iOS | Simulator | Messaging send/receive | Pass | ☐ not run |
| iOS | Real device | Messaging | Pass | ☐ not run |
| iOS | Real device | Voice call (media path) | Pass | ☐ not run |
| iOS | Real device | Background notification | Pass | ☐ not run |
| iOS | Real device | Notification tap → deep link | Pass | ☐ not run |
| iOS | Real device | Offline → reconnect | Pass | ☐ not run |
| Android | Emulator | Login | Pass | ☐ not run |
| Android | Emulator | Messaging send/receive | Pass | ☐ not run |
| Android | Real device | Messaging | Pass | ☐ not run |
| Android | Real device | Voice call (media path) | Pass | ☐ not run |
| Android | Real device | Background notification | Pass | ☐ not run |
| Android | Real device | Offline → reconnect | Pass | ☐ not run |
| Both | Real devices | Same account, two devices | Pass | ☐ not run |

Network and lifecycle conditions each journey must be repeated under: **good
network · poor network (high latency, loss) · Wi-Fi ↔ cellular handover ·
offline · reconnect · app backgrounded · app killed · app reopened · device
locked · two devices simultaneously.**

The properties to assert, since they are the ones the architecture can get
wrong: **no message loss, no duplicate delivery, no duplicate notification,
correct ordering after reconnect, read state converging across devices, and a
deep link re-authorized server-side on open** (a push must never open content
the recipient may not read).

---

# 5. Staging load test plan

**Status: BLOCKED — NO STAGING ENVIRONMENT.** No production-scale number exists
and none is invented here.

## 5.1 What the current harness can and cannot do

`apps/api/test/perf/baseline.perf.ts` drives the service graph **in process**.
It has no HTTP client and no WebSocket client, so **it cannot be pointed at
staging**. It is a service-layer instrument, and it is now parameterised:

```bash
JAWWID_PERF_ITERATIONS=20 JAWWID_PERF_CONCURRENCY=100 JAWWID_PERF_ROUNDS=5 \
  npx jest --selectProjects perf --runInBand
```

Measured with it (local, one process, loopback): the send path **saturates at
roughly 50–80 messages/second**, with latency growing linearly beyond ~10
concurrent senders. See `docs/qa/performance-baseline.md` §2a.

## 5.2 Scenarios to run once staging exists

Against the deployed HTTP and WebSocket endpoints, with an external generator
(k6 or Artillery — neither is a dependency today).

| # | Scenario | Shape | Primary question |
|---|---|---|---|
| A | 10 concurrent users | mixed read/send, 5 min | Does the deployed p95 resemble the local baseline? |
| B | 50 concurrent users | mixed, 10 min | Where is the real ceiling with network in the path? |
| C | 100 concurrent users | mixed, 10 min | Does it degrade gracefully or collapse? |
| D | Broadcast → 100 families | one broadcast, tracked to completion | Fan-out duration, retries, duplicates, partial failure |
| E | 100+ concurrent WebSockets | hold, then a reconnect storm | Connection ceiling; recovery after mass reconnect |
| F | **Two API instances** | messages via instance 1, subscribers on instance 2 | **B-6** — does the Redis adapter actually work? |
| G | Soak: 10 users, 4 hours | steady | Memory growth, pool drift, queue backlog |

Record for every run: concurrency · duration · requests · successes · failures ·
p50/p95/p99 · throughput · CPU · memory · DB connections in use · queue depth ·
oldest-job age · WS connections. **Oldest-job age matters more than queue
depth** (`monitoring.md` §2).

---

# 6. Production deployment checklist

Ordered by dependency. Nothing below is done.

| # | Item | State | Blocked by |
|---|---|---|---|
| 1 | Git remote created; repository pushed | ☐ | — |
| 2 | CI runs and is green on a real runner | ☐ | 1 |
| 3 | Branch protection; required checks | ☐ | 2 |
| 4 | Mobile job green (analyze, 30 test files, APK) | ☐ | 2 |
| 5 | Cloud account, domain, TLS certificate | ☐ | — |
| 6 | Secret store provisioned; `check-env.sh production` passes against the real environment | ☐ | 5 |
| 7 | Managed Postgres; migrations applied; **runtime roles given LOGIN** (migrations create them NOLOGIN on purpose) | ☐ | 5 |
| 8 | Managed Redis (`appendonly yes`, `noeviction`) | ☐ | 5 |
| 9 | Object storage bucket, private, versioned | ☐ | 5 |
| 10 | Workers running from `dist/worker.js` | ☐ | 7,8 |
| 11 | WebSocket verified across **two** instances (B-6) | ☐ | 10 |
| 12 | APNs + FCM credentials; a real push delivered end to end | ☐ | 5 |
| 13 | LiveKit project; `JAWWID_REQUIRE_LIVEKIT=1` in the release gate | ☐ | 5 |
| 14 | CRM/Core: **nothing to do** — `chat.core_event` has no writer yet | n/a | — |
| 15 | Sentry wired; OTLP still unwired and `OTEL_*` downgraded to `opt` accordingly (B-4) | ☑ | 5 |
| 16 | Alerts defined and actionable | ☐ | 15 |
| 17 | `pg_dump` copies **encrypted** (B-7) ☑; provider backups still need hosting | ◐ | 7 |
| 18 | **Restore drill against staging**, including the one step never covered: an application instance pointed at the restored database reaching `/health/ready` = 200 | ☐ | 17 |
| 19 | RPO/RTO **measured** by that drill, not assumed | ☐ | 18 |
| 20 | Staging deployed; smoke test passes | ☐ | 6–13 |
| 21 | Load scenarios A–G run against staging | ☐ | 20 |
| 22 | Real-device mobile matrix (§4.3) executed | ☐ | 12 |
| 23 | Rollback rehearsed (app rollback; migrations are **not** all reversible) | ☐ | 20 |
| 24 | On-call rotation and escalation path defined | ☐ | — |
| 25 | Third-party penetration test (B-10) | ☐ | 20 |

---

# 7. Final production readiness report

## Classification: **PRODUCTION CANDIDATE — EXTERNAL BLOCKERS**

### Why this is the honest label, and not one of the other three

**Not `PRODUCTION READY`.** Nothing has been deployed, no CI has run, no mobile
test has executed anywhere, and no measurement exists under a real topology.
Local evidence is not production evidence, and this report does not convert one
into the other.

**Not `PRODUCTION CANDIDATE — ENGINEERING BLOCKERS`.** This was the honest label
at the start of this pass and it is no longer accurate. The engineering defects
found in Phase 8 — an unrestorable backup, a pipeline red at its first job,
unbounded authenticated actions, ungated isolation suites, unqueryable logs, a
throttle vocabulary that broke password reset, a gate that could never pass, an
employee name shipping in `lib/` — are **fixed and verified by execution**. What
remains is a remote, a host, a toolchain, and a third party.

**Not `NOT PRODUCTION READY`.** That was the previous verdict and it undersold
the application. Cross-tenant and cross-supervisor access are refused under
adversarial test, not by assertion; a restored database passes the same six
invariant suites a migrated one does; a token minted here is accepted by a real
LiveKit server and a forged one is refused.

### Per-area verdict

| Area | Verdict |
|---|---|
| Security | **PASS (locally verified)** — no open finding |
| Data integrity | **PASS (locally verified)** — fresh **and** restored |
| Reliability / recoverability | **PASS (locally verified)** |
| Backend & web testing | **PASS** — 438 + 762 + 111 |
| Performance | **PARTIAL** — local ceiling measured; production scale BLOCKED |
| Observability | **PARTIAL** — logging and health done; error tracking, metrics, alerts absent |
| E2E journeys | **PARTIAL** — J1–J3, J5 locally verified; J4 token contract real, media path not |
| Mobile | **BLOCKED — NOT VERIFIABLE IN THE CURRENT ENVIRONMENT** |
| CI/CD | **BLOCKED — NO REMOTE / NO CI EXECUTION** |
| Deployment / infrastructure | **BLOCKED — NONE EXISTS** |

### The one thing to carry forward

Twice in one day, a control that existed only inside a pipeline nobody could run
turned out to be broken — and both times it was found by *running* it, not by
reading it. Everything in §2 marked **Locally Verified** is in that same
category with respect to production: real evidence, from the wrong environment.

The next honest step is not more engineering. It is **B-1** — create the remote
and let the pipeline run — because until it does, every gate in this repository
is a claim about a file.
