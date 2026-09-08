# Phase 8 — Final External Readiness Gate

Date: 2026-09-08 · Branch: `phase7/ai-and-automation` · Verified tip: **`7e3225e`**
Authoritative for the readiness verdict. Extends [PHASE-8-CLOSURE.md](PHASE-8-CLOSURE.md).

---

# Classification

## PRODUCTION CANDIDATE — EXTERNAL BLOCKERS

Unchanged from the closure pass, and re-earned rather than carried forward: this
gate found **three new engineering defects**, fixed all three, and re-verified
the whole repository at the tip. Every remaining blocker needs a git remote,
hosting, a mobile toolchain, or a third party.

**It is not PRODUCTION READY.** Nothing has been deployed. No CI run has ever
executed. No mobile test has executed anywhere. No measurement exists under a
real topology.

---

# Current verified state

Measured at `7e3225e` in a **clean detached worktree**, so every number belongs
to committed code rather than to a tree carrying other agents' edits.

| Check | Result |
|---|---|
| API typecheck | PASS |
| API unit | **450 passed** |
| API integration | **762 passed** (with `JAWWID_REQUIRE_LIVEKIT=1` and a real LiveKit 1.8.4) |
| Admin Web typecheck | PASS |
| Admin Web tests | **111 passed** |
| Migrations, fresh install | **52 applied**, re-apply a no-op |
| Migrations, **upgrade path** | 51 applied → all 10 scopes seeded with live rows → 52nd applied clean |
| Database integrity suites | **6/6** on fresh, upgraded **and** restored databases |
| Release-gate guards | **9/9**, with **12/12 negative probes caught** |
| Secret scanner | clean; **9/9 negative probes** behave correctly |
| Backup + restore drill | bare cluster, encrypted archive, full parity, application read access proven |

Counts moved since the closure pass (438 → 450 unit) because a peer wired error
tracking (`0054ae9`) and added its tests. Integration and web are unchanged.

---

# Engineering status

**No engineering blocker is open.** Three were found and fixed in this pass —
all three were live, and none was on any prior list.

### E-1 · G-31 had been matching nothing since I wrote it — **P1, FIXED**

Consolidating the guards in `d735aaa` converted this gate from GNU
`grep -rInE '\b(videoCall|aiScore|…)\b'` to `git grep -InE` with the same
pattern. **`git grep -E` does not honour `\b`** — it matches nothing, silently,
on tracked and untracked files alike. Proven directly: `\b` against a tracked
file containing `aiScore` returns 0 matches; `-w` returns 1.

From that commit until this one, Phase 2 capability could have shipped into the
MVP with the gate reporting PASS. I introduced it; a negative probe caught it.

### E-2 · The restored database was unusable, for a second reason — **P0, FIXED**

The Phase 8 restore fix cured the loud half and left a silent half. `pg_dump`
records the schema's own entries with namespace `-`, not `chat`:

```
6;    2615 16385 SCHEMA - chat postgres
5289; 0    0     ACL    - SCHEMA chat postgres
```

`pg_restore --schema=chat` discards **both**. The missing `CREATE SCHEMA` was
loud and was silenced by pre-creating the schema. The missing **ACL** was silent:
the restored schema carried no grants, so `chat_app` had no `USAGE` and could not
read one row — while parity was exact (80 tables, 52 migrations, 128 config rows,
186 grants) and **all six integrity suites passed**.

The suites are blind to this by construction: table-level `has_table_privilege()`
does not depend on schema `USAGE`. Same shape as the `--no-privileges` defect
this phase opened with — a recovery that looks complete and is unusable.

Fixed by not passing `--schema` to `pg_restore` (the dump is already scoped) and
not pre-creating the schema. **CI's drill now logs in as `chat_app` and requires
the row count to match** — the check that caught this and the previous one.

### E-3 · Production required OTEL variables nothing reads — **P2, FIXED**

`SENTRY_DSN` is now genuinely consumed (a peer wired it). `OTEL_SERVICE_NAME`
and `OTEL_EXPORTER_OTLP_ENDPOINT` were still `req` in staging and production
with **no SDK and no `OTEL_` reference in `src/`** — so a release was refused
unless an operator supplied an endpoint nothing would export to. Downgraded to
`opt`, with an instruction to flip them back in the same commit that wires an
exporter. Wiring OpenTelemetry now was rejected: no collector exists here to
verify it against, and unverifiable tracing shipped to satisfy a checklist is
the failure this phase has spent its time correcting.

### Hardening added this pass

- **A ninth guard**: no migration may narrow an earlier `CHECK` constraint —
  the generalised defence against C-1, which broke forgot-password. Verified by
  reintroducing C-1 verbatim.
- **CI job timeouts** — every job was unbounded against GitHub's 360-minute
  default.
- **CI now starts LiveKit** and sets `JAWWID_REQUIRE_LIVEKIT=1`, so the token
  contract is verified there instead of silently skipped.

---

# CI status

## BLOCKED — NO REMOTE / NO CI EXECUTION

`git remote -v` is empty. **No workflow in this repository has ever run**, including
every fix this phase made to CI. Everything below is configuration validated
locally; none of it is execution evidence.

What was validated here:

| Check | Result |
|---|---|
| YAML parses (all 3 workflows) | PASS |
| Job dependency graph | every job `needs: guards`; no job-level `if` that could skip a gate |
| Silent-success scan (`if: false`, `continue-on-error`, `\|\| true`, `exit 0`, `set +e`) | **one** `continue-on-error` — the dependency audit, a deliberate advisory labelled in the job name |
| Every referenced script / SQL file / lockfile exists | PASS |
| Every referenced npm script exists | PASS |
| Timeouts | added this pass (were absent) |
| Permissions | least-privilege; `contents: read` on CI |
| Guards step | calls the single source, `scripts/qa/guards.sh` |
| LiveKit startup step | **run verbatim on this machine**, including the health-poll loop |

**Honesty classification in the pipeline.** PASS/FAIL is enforced; ADVISORY is
the dependency audit, named as such; there is no SKIPPED-as-PASS left — the
mobile job runs real tests, and the LiveKit suite fails in CI if the server is
absent.

---

# Mobile status

## BLOCKED — NOT VERIFIABLE IN THE CURRENT ENVIRONMENT

No `flutter`, `dart`, JDK, simulator, emulator or device on this host. **29
`*_test.dart` files** (plus one non-test helper) have never executed anywhere.

Verified without the toolchain:

| Item | State |
|---|---|
| Project structure, `pubspec.lock`, `analysis_options.yaml`, `l10n.yaml`, `lib/main.dart` | present |
| Android `build.gradle.kts` (JDK 17), iOS `Info.plist` (target 15.0), Gradle 9.3.1 wrapper | present |
| Test discovery | 29 test files under `test/` |
| CI installs the toolchain, runs analyze + tests + APK build, fails on failure | configured (unexecuted) |
| Generated localizations | **committed**; CI checks they are not stale |
| `integration_test` package | **ABSENT** — on-device journey automation cannot be written as-is (**B-8**) |
| `google-services.json` / `GoogleService-Info.plist` | **absent and gitignored** — supplied per environment. `Firebase.initializeApp()` is wired, so **push cannot function at runtime** until they exist (**B-12**) |
| Google Services Gradle plugin | not applied → the debug APK build should not require the config file |

---

# Performance status

## LOCAL LOOPBACK BASELINE only · production scale **BLOCKED — NO STAGING**

The harness drives services **in process**. It has no HTTP or WebSocket client,
so **it cannot be pointed at staging without new code**.

**The throughput curve was over-read twice and is now retracted.** Three runs of
the same four-point curve, same machine, same database:

| concurrent | run 1 | run 2 | run 3 |
|---:|---:|---:|---:|
| 10 | 63.4 | 62.5 | 69.1 |
| 20 | 47.2 | 70.9 | 98.3 |
| 50 | 67.5 | 120.0 | 116.8 |
| 100 | 78.3 | 126.0 | 103.1 |

At 100 concurrent: 78, 126, 103 ops/sec — ±30%, and the *trend* flips between
runs. **This machine cannot resolve a throughput curve; no throughput number
here should be quoted.** What survives all three runs is that **p50 latency grows
monotonically with concurrency** — a usable regression tripwire, not a capacity
model.

---

# Observability status

| Signal | State |
|---|---|
| Structured JSON logging | **Implemented + Locally Verified** — field allowlist and redaction, tested both directions |
| Request correlation (`X-Request-Id`) | Implemented + Locally Verified |
| Health: liveness / readiness / dependency | Implemented + Locally Verified; liveness never touches a dependency |
| Error tracking | **Implemented (code) + Locally Verified** — `@sentry/node` wired, `SENTRY_DSN` consumed, 5xx only. **NOT operational**: no Sentry project exists and no event has ever been received |
| Metrics | **NOT IMPLEMENTED** — nothing emitted |
| Alerts | **NOT IMPLEMENTED** — detection means a person noticing |

**Code readiness and operational readiness are different things here**, and the
distinction is load-bearing: error tracking is code-ready and operationally
absent.

---

# Backup / restore status

**PASS (locally verified)** — re-drilled this pass against the newly added
encryption, and it found E-2.

| Step | Result |
|---|---|
| Encrypted backup (aes-256-cbc, pbkdf2) | 761 KB `.enc` + `.sha256` |
| Plaintext backup refused when `APP_ENV=staging\|production` | refused, exit 1 |
| Wrong passphrase | refused: "DECRYPTION FAILED" |
| Restore onto a **bare cluster** (0 roles) | clean |
| Plaintext left behind after restore | none |
| Parity (tables / migrations / config / grants) | 80 / 52 / 128 / 186 — **exact** |
| Role attributes + memberships | `chat_app` INHERIT, `chat_service` BYPASSRLS, both memberships restored |
| Schema `USAGE` | **`chat_app USAGE = true`** (this was the defect) |
| Six integrity suites on the copy | **6/6** |
| **Application read access as `chat_app`** | **128 rows** |

```
RPO — NOT MEASURED
RTO — NOT MEASURED
```

Neither can be measured without a provider and a timed drill in the operational
environment. They are not estimated here.

---

# E2E status

| Journey | Classification | Basis |
|---|---|---|
| **1 · Family messaging** | AUTOMATED + LOCALLY VERIFIED | Login → group → send → supervisor receives → replies → family receives, at service + realtime + persistence level. No browser, no device |
| **2 · Moderation** | AUTOMATED + LOCALLY VERIFIED | Flag → hold → approve/edit/reject → audit trail; admin controls covered in web tests |
| **3 · Supervisor transfer** | AUTOMATED + LOCALLY VERIFIED | A loses access and B gains history **on the next call**; assignment invariants enforced in the database |
| **4 · Voice call** | AUTOMATED + EXTERNAL DEPENDENCY | Signalling, authorization and lifecycle locally verified. **Token contract verified against a real LiveKit 1.8.4** — minted token accepted, wrong-secret refused, expired refused, one room only. **No media path, no audio, no device** |
| **5 · Broadcast** | AUTOMATED + LOCALLY VERIFIED (partial) | Fan-out, dedupe, retries, delivery tracking, partial failure. **Not at 100-family scale** — that needs staging |

---

# External blockers

| ID | Sev | Area | Current state | Evidence | Required external action | Owner | Dependency | Verification method | Exit criteria |
|---|---|---|---|---|---|---|---|---|---|
| **B-1** | P0 | Git remote / CI | No remote; no workflow has ever run | `git remote -v` empty | Create remote, push branch | Product owner | — | CI run appears | All 7 jobs green on a runner |
| **B-2** | P0 | Hosting | Nothing provisioned; no IaC in repo | only `docker-compose.yml` (local) | Provision host, DNS, TLS, managed Postgres/Redis/bucket | Product owner | — | `check-env.sh production` against the real env | Passes; `/health/ready` = 200 |
| **B-3** | P0 | Mobile toolchain | No Flutter/Dart/JDK here | `command -v flutter` → absent | Run the CI mobile job | — | B-1 | CI job output | analyze + 29 tests + APK green |
| **B-4** | P1 | Metrics & alerts | Not implemented | nothing emitted | Provision a metrics backend; define alerts | AI #7 | B-2 | Dashboard receives data | Alerts fire on a synthetic fault |
| **B-5** | P1 | Staging | Does not exist | — | Deploy staging | Product owner | B-2 | `scripts/infra/smoke.sh` | Smoke passes |
| **B-6** | P1 | Multi-instance realtime | Unproven (RISK-4) | Redis adapter declared, never demonstrated | Run two API instances | AI #2 | B-5 | Message on node 1 → subscriber on node 2 | Event delivered cross-instance |
| **B-7** | P2 | Error tracking operational | Code wired, no project | no DSN, no event received | Create Sentry project, set `SENTRY_DSN` | AI #7 | B-2 | Trigger a 5xx | Event visible in Sentry |
| **B-8** | P2 | Mobile E2E automation | `integration_test` absent | not in `pubspec.yaml` | Add it; port journeys | AI #3 | B-3 | `flutter test integration_test/` | Journeys pass on a device |
| **B-9** | P2 | Push credentials | Firebase config absent (gitignored) | `google-services.json` missing | Supply APNs + FCM credentials | Product owner | B-2 | Send a real push | Received foreground, background, killed |
| **B-10** | P2 | LiveKit production | Only a local dev server | `infra/livekit/livekit.yaml` is dev keys | Provision a LiveKit project | Product owner | B-2 | Real call between two devices | Audio both ways |
| **B-11** | P2 | Load at scale | Harness is in-process only | no HTTP/WS client | Write a k6/Artillery suite; run A–G | AI #5 | B-5 | Scenario run | p95 and error rate recorded |
| **B-12** | P2 | Backup storage | Local files only | `--out` is a directory | Encrypted off-host bucket + retention | AI #7 | B-2 | Restore from the bucket | Drill passes from remote storage |
| **B-13** | P2 | RPO / RTO | Not measured | — | Timed drill in the real environment | AI #7 | B-5 | Stopwatch | Numbers recorded |
| **B-14** | P3 | Penetration test | Never performed | — | Commission one | Product owner | B-5 | Report | Findings triaged |
| **B-15** | n/a | CRM / Jawwid Core | **Dormant by design** | `chat.core_event` has no writer | Nothing until Core delivers events | — | — | — | — |

---

# Remaining engineering work

**None is blocking.** Everything here is either downstream of an external
blocker or a recorded, non-urgent improvement.

1. **Wire OTLP metrics** and flip `OTEL_*` back to `req` in the same commit (B-4).
2. **Add `integration_test`** and port the five journeys to on-device automation (B-8).
3. **Write a staging load harness** — the current one cannot leave the process (B-11).
4. **Re-measure query plans at production data volume**; §3 of the baseline proves there is no N+1 at *small* scale only.
5. **The send path is chatty** — ~35 indexed lookups per message, `conversation` resolved ~9 times. Sub-millisecond each; recorded with evidence rather than optimised.

---

# Exact owner actions

```
STEP 1   Create the git remote; push phase7/ai-and-automation.
STEP 2   Run CI. Expect first-run failures in the never-executed jobs
         (mobile toolchain, image build, the restore drill's psql pinning).
STEP 3   Fix what CI finds. Nothing below starts until CI is green.
STEP 4   Set branch protection; make the 7 jobs required checks.
STEP 5   Provision hosting: DNS, TLS, managed Postgres, Redis, object storage,
         and a secret store.
STEP 6   Fill the 44 production-required variables; run check-env.sh production
         against the real environment.
STEP 7   Give chat_app and chat_service a LOGIN and a password from the secret
         store — migrations create them NOLOGIN on purpose.
STEP 8   Deploy staging. Run scripts/infra/smoke.sh.
STEP 9   Prove multi-instance realtime with two API instances (B-6).
STEP 10  Provision Sentry + a metrics backend; define alerts (B-4, B-7).
STEP 11  Run a restore drill IN staging, including the step no drill has yet
         covered: an application instance pointed at the restored database
         reaching /health/ready = 200. Measure RPO and RTO there (B-13).
STEP 12  Supply APNs/FCM credentials and a LiveKit project (B-9, B-10).
STEP 13  Run the mobile suite in CI, then on a simulator, then on real devices
         across the §4.3 matrix in PHASE-8-CLOSURE.md.
STEP 14  Write and run the staging load scenarios A–G (B-11).
STEP 15  Commission a penetration test (B-14).
STEP 16  Re-run this gate against the real environment. ONLY THEN evaluate
         Production Ready.
```

---

# Final production readiness matrix

**CI / Staging / Production columns are empty for every row.** There is no
remote and no environment; that is the finding, not an omission.

| Area | Implemented | Locally Verified | CI Verified | Staging Verified | Production Verified | Status |
|---|---|---|---|---|---|---|
| Authentication | ✅ | ✅ 9 adversarial assertions | ✗ | ✗ | ✗ | Locally Verified |
| Authorization | ✅ | ✅ role/ownership/manager matrices | ✗ | ✗ | ✗ | Locally Verified |
| Tenant isolation | ✅ | ✅ API + `tenant_isolation.sql` + DB-level refusal | ✗ | ✗ | ✗ | Locally Verified |
| Supervisor isolation | ✅ | ✅ before **and after** transfer | ✗ | ✗ | ✗ | Locally Verified |
| IDOR / BOLA | ✅ | ✅ 7 id-substitution cases | ✗ | ✗ | ✗ | Locally Verified |
| API security | ✅ | ✅ headers, CORS fail-closed, no stack leakage | ✗ | ✗ | ✗ | Locally Verified |
| WebSocket security | ✅ | ✅ auth, forged room, revocation, frame flooding | ✗ | ✗ | ✗ | Locally Verified |
| File security | ✅ | ✅ key binding, traversal, short-lived URLs | ✗ | ✗ | ✗ | Locally Verified |
| Rate limiting | ✅ | ✅ 13 assertions, incl. 10-concurrent-vs-limit-5 | ✗ | ✗ | ✗ | Locally Verified |
| AI abuse protection | ✅ | ✅ all 3 paid routes throttled; 4th is sweeper-only | ✗ | ✗ | ✗ | Locally Verified |
| Queue reliability | ✅ | ✅ retry, idempotency, backoff | ✗ | ✗ | ✗ | Locally Verified |
| Outbox | ✅ | ✅ crash-safety suite | ✗ | ✗ | ✗ | Locally Verified |
| Notifications | ✅ | ✅ FCM 503, APNs 410/400/503, dedupe, quiet hours | ✗ | ✗ | ✗ | Locally Verified (no real push) |
| CRM | ⚠️ dormant | — | ✗ | ✗ | ✗ | **NOT APPLICABLE — by design** |
| Backup | ✅ | ✅ encrypted, checksummed, plaintext refused in prod | ✗ | ✗ | ✗ | Locally Verified |
| Restore | ✅ | ✅ bare cluster, parity, 6/6 suites, **app read access** | ✗ | ✗ | ✗ | Locally Verified |
| Logging | ✅ | ✅ 27 assertions, allowlist + redaction | ✗ | ✗ | ✗ | Locally Verified |
| Error tracking | ✅ code | ✅ wired, 5xx only | ✗ | ✗ | ✗ | **Code ready, NOT operational** |
| Metrics | ❌ | — | ✗ | ✗ | ✗ | **NOT IMPLEMENTED** |
| Alerts | ❌ | — | ✗ | ✗ | ✗ | **NOT IMPLEMENTED** |
| Backend tests | ✅ | ✅ 450 unit + 762 integration | ✗ | ✗ | ✗ | Locally Verified |
| Web tests | ✅ | ✅ 111 | ✗ | ✗ | ✗ | Locally Verified |
| Data integrity | ✅ | ✅ 6/6 on fresh, upgraded **and** restored | ✗ | ✗ | ✗ | Locally Verified |
| E2E | ✅ | ✅ J1–J3, J5 locally; J4 token contract against real LiveKit | ✗ | ✗ | ✗ | Partially Verified |
| Mobile | ✅ code | ❌ **never executed anywhere** | ✗ | ✗ | ✗ | **BLOCKED** |
| Performance | ✅ harness | ✅ latency only; throughput unmeasurable here | ✗ | ✗ | ✗ | Partially Verified |
| CI/CD | ✅ | ✅ config validated; guards 9/9, 12/12 probes | ❌ **never executed** | ✗ | ✗ | **BLOCKED** |
| Deployment | ⚠️ workflows only | — | ✗ | ✗ | ✗ | **BLOCKED** — Release step fails on purpose (ADR-003) |

---

# Evidence summary

## What is production-ready today?
**Nothing, in the strict sense** — "production-ready" requires production
evidence and none exists. The application's security, data-integrity and
recoverability controls are as strong as local execution can demonstrate.

## What is only locally verified?
Everything marked Locally Verified above: all security controls, backup/restore,
logging, queues, outbox, notifications, and the backend and web suites.

## What has never actually executed?
CI (any job, ever). Every mobile test. Any deployment. Any real push, any real
call between devices, any load beyond a laptop.

## What requires CI? B-1, B-3.
## What requires staging? B-5, B-6, B-11, B-13.
## What requires real devices? B-3, B-8, B-9, B-10.
## What requires external services? B-2, B-4, B-7, B-9, B-10, B-12, B-14.

## What engineering work remains?
Nothing blocking. Five recorded improvements, all downstream of an external
blocker or explicitly non-urgent.

## What external work remains?
Fifteen blockers, B-1 through B-14 plus one N/A, in the table above.

## What are the exact launch blockers?
**B-1** (no remote → CI has never run) and **B-2** (no hosting). Everything else
is downstream of those two.

---

## The finding that matters most

This gate set out to confirm a classification and instead found three live
defects, one of them a `P0`-class recovery failure that **every existing check
passed**: exact parity, 186 grants, six green integrity suites — on a database
the application could not open. It was caught by one new check: log in as the
application role and read a row.

Twice now, in two consecutive passes, the restore has looked complete and been
unusable for a different reason each time. That is the strongest available
argument for the rule this phase has been operating under, and for treating
every **Locally Verified** row above as exactly that — real evidence, from the
wrong environment.

> **Execution evidence beats code inspection.**
