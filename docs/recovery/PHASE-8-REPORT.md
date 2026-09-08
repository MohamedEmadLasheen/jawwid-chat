# Phase 8 — Production Hardening & Launch

Date: 2026-09-08 · Branch: `phase7/ai-and-automation` · Baseline HEAD: `549c67e`

> **Superseded verdict.** This report concluded NOT PRODUCTION READY. A closure
> pass on the same day fixed the remaining engineering defects and re-classified
> the system **PRODUCTION CANDIDATE — EXTERNAL BLOCKERS**. The findings and
> reasoning below stand; the verdict and the matrix are superseded by
> [PHASE-8-CLOSURE.md](PHASE-8-CLOSURE.md), which is authoritative.

---

# PRODUCTION READINESS REPORT

## Executive summary

## 🔴 NOT PRODUCTION READY — classified **Production Candidate (application), Blocked (delivery)**

The distinction is the finding, so it is worth stating precisely.

**The application is in materially better shape than any document in this
repository claimed.** 415 unit, 752 integration and 111 web tests pass; 51
migrations apply from empty and are idempotent; six database-level invariant
suites pass, including tenant isolation and RLS enforcement against the
least-privileged runtime role. Several P0 defects the release gate still listed
as open (JC-008, JC-010) are fixed and have regression tests proving it. On the
evidence, the application layer is a genuine Production Candidate.

**The delivery layer is not a candidate for anything, because none of it has ever
run.** There is no git remote, so no workflow in this repository has ever
executed — every previous claim about CI was a claim about the *content* of a
YAML file. And CI would not have passed anyway: it was red at its first job, and
since every other job `needs: guards`, nothing downstream was reachable.

Phase 8 fixed what could be fixed here and proved it by execution. What remains
cannot be closed from this machine, and is stated as blocked rather than
estimated.

| Area | Verdict | Basis |
|---|---|---|
| Security | **PASS (application)** | 752 integration tests incl. tenant/supervisor isolation, IDOR, RLS; 6 DB invariant suites; abuse controls added and tested |
| Performance | **PARTIAL** | First baseline ever measured. No HTTP-layer, WebSocket, or at-scale measurement — needs a deployed environment |
| Reliability | **PASS (recoverability), PARTIAL (runtime)** | Restore was broken and is now fixed and drilled onto a bare cluster. Queue/outbox crash-safety covered by tests; failure injection at scale unproven |
| Observability | **PARTIAL** | Structured JSON logging and health checks implemented and tested. No error tracking, metrics or alerts — all need a backend (BLOCKER-3) |
| Backend testing | **PASS** | 415 unit + 752 integration, green |
| E2E testing | **PARTIAL** | Journeys 1–3 and 5 covered at service+DB level. No browser or device E2E; Journey 4 (voice) has no runtime proof |
| Mobile testing | **FAIL** | 30 Dart test files have never executed anywhere. No Flutter/Dart/JDK on this host |
| CI/CD | **BLOCKED** | Pipeline now green locally through every check that can run here; **never executed on a runner** (no remote) |
| Backup & restore | **PASS** | Drilled onto a bare `postgres:17`: full parity, 6/6 integrity suites on the restored copy |
| Data integrity | **PASS** | BR-1, append-only, ownership, OD-01 and assignment invariants enforced in the database and gated in CI |

---

## 1. What Phase 8 found and fixed

Each of these was reproduced, root-caused, fixed, and re-verified by execution.

### P8-01 · The backup was not restorable — **P0, FIXED**

The most dangerous finding in the phase, because backups existed, ran cleanly,
and produced healthy-looking archives.

Running the documented drill failed immediately:

```
pg_restore: error: could not execute query: ERROR:  schema "chat" does not exist
```

**Root cause 1.** `pg_dump` records `CREATE SCHEMA chat` as a TOC entry whose own
namespace is `-`, not `chat`. `pg_restore --schema=chat` filters it out — the
restore drops the one statement that creates the schema it is filtering on.

**Root cause 2, worse.** `backup-db.sh` passed `--no-privileges` to `pg_dump`, so
**every archive ever written contained zero ACL entries.** Restoring one produced
a database in which `chat_app` could not `INSERT` into a single table. The
application fails closed against its own restored data:

```
ERROR:  chat_app cannot INSERT into chat.account, ... -- the application would fail closed
```

The stated justification was portability across environments, but the roles named
in these GRANTs are ours (`chat_app`, `chat_service`, `authenticated`,
`service_role`), created by our own migrations and identical everywhere.
`--no-owner` is what handles the owner role that genuinely differs.

**Root cause 3, found by the fix.** Role *attributes* and *memberships* are
cluster-level and appear in no schema-scoped dump. Recreating `chat_app` as
`NOINHERIT` restored a database that failed its own acceptance test — a policy
written `to authenticated` is matched with `pg_has_role(..., 'USAGE')`, false for
a non-inheriting member — and `chat_service` without `BYPASSRLS` failed
`rls_enforcement` A3. **Both restore silently and then read zero rows.**

**Verified**, onto a `postgres:17` cluster that had never seen this schema or its
roles:

| | Before | After |
|---|---|---|
| `pg_restore` errors | 1 (aborted immediately) | **0** |
| `chat` tables | 0 | **80** |
| `chat.config` rows | 0 | **129** |
| Migrations recorded | 0 | **51** |
| `chat_app` grants | 0 | **186** |
| Integrity suites passing on the copy | 0 / 6 | **6 / 6** |

CI now runs the whole drill — backup, restore into a database that did not exist,
then all six suites against the copy. The old pipeline ran only the backup half,
which is exactly why root cause 2 survived: **the archive was always fine.**

### P8-02 · CI was red at its first job — **P0, FIXED**

Every job `needs: guards`, and `guards` failed on two steps, so no test, no
migration gate and no image build was reachable.

1. **The secret scanner exited 1** on six Phase 5 spec files setting
   `LIVEKIT_API_SECRET` to an invented string. A call test cannot exercise token
   signing without a signing secret.
2. **Environment templates had drifted** from `infra/env/manifest.tsv`, which
   gained four `DATABASE_*` rows and was never re-rendered.

The scanner fix is narrow and was proven narrow: the `livekit secret assignment`
rule matches a secret-shaped **name**, not credential **material**, so it is
exempt in test paths — and *only* it. Planting an AWS key, a private-key block, a
GitHub token and a DSN-with-password in a spec file confirmed all four hard rules
still fire there. **The control then caught this phase's own test file** and the
test was changed rather than the scanner.

All eight guard steps now pass.

### P8-03 · Tenant-isolation and RLS suites were gated by nothing — **P1, FIXED**

`db/tests/` holds six suites. CI ran two. `tenant_isolation.sql`,
`rls_enforcement.sql`, `assignment_invariants.sql` and `od01_conversation_model.sql`
all pass — and a regression in any of them could have shipped with every
application test green. All six are gated now.

### P8-04 · Nothing bounded an authenticated session — **P1, FIXED**

`AUTH-THROTTLING.md` §5 said it plainly: *"Authenticated endpoints are not
throttled. They are bounded by authorization, and a session that misbehaves can
be revoked."* Authorization answers whether an actor may do a thing, not whether
they may do it four thousand times a minute; revocation is a human noticing.

Added, reusing the existing counter rather than inventing a second one: per-actor
limits on message send, attachment authorization, broadcast queueing, story
publication and call initiation, plus an in-memory per-socket frame budget for
WebSockets — where a database write per keystroke would be a worse denial of
service than the abuse it defends against.

Verified against the real database, including the property that matters most:
**ten concurrent attempts against a limit of five admit exactly five.**

### P8-05 · Logs were unqueryable free text — **P1, FIXED**

`monitoring.md` §3 specified structured JSON since 2026-09-05 and nothing emitted
it. Now implemented, with the privacy rule enforced by a **field allowlist**
(content cannot leak through a channel that never carries content) and pattern
redaction as an explicit backstop. Routes log as patterns, never resolved URLs,
so user-controlled text stays out of the log store.

### P8-06 · The mobile CI job tested nothing while reporting success — **P1, WIRED, NOT VERIFIED**

It printed four warnings and exited 0. Its stated reason — no Flutter on any
build host — was true of developer machines and never true of a GitHub runner. It
now installs Flutter, checks the committed localizations are not stale, analyzes,
runs all 30 test files and builds a debug APK, and fails if any of that fails.

**This has not executed.** See §3.

### P8-07 · A documented override that did nothing — **P3, FIXED**

`schema-invariants.spec.ts` documented a `JAWWID_PSQL` override and never read
it, so a host without `psql` saw twelve `ENOENT`s that read like twelve broken
database guarantees. Implemented, with an actionable message when the binary is
missing.

---

## 2. Readiness matrix

Legend: **PASS** verified by execution · **PARTIAL** partly verified, gap stated ·
**FAIL** verified as not working · **BLOCKED** cannot be verified from here ·
**N/A**

### Security

| Requirement | Status | Evidence |
|---|---|---|
| Authentication (login, refresh, revocation, expiry, malformed tokens) | PASS | `auth-and-sessions`, `auth-throttling`, `credentials-and-tokens`, `no-header-identity` |
| Default-deny authorization on every route | PASS | Global `AuthGuard`; routes opt out with `@Public()`. `no-header-identity.spec.ts` proves identity comes only from the signed token |
| Authorization matrix (roles, ownership, manager-only) | PASS | `matrix-and-handling`, `rbac-permissions`, `br1-conformance`, `authz-attacks` |
| Tenant isolation | PASS | `tenant-and-rbac`, `phase3-runtime-rls`, `db/tests/tenant_isolation.sql` — **now gated in CI** |
| Supervisor isolation, incl. after transfer | PASS | `supervisor-scope`, `phase3-supervisor-transfer`, `phase3-teacher-transfer`, `assignment_invariants.sql` |
| IDOR / BOLA | PASS | `security-regression`, `red-team/authz-attacks`, `phase3-group-roster-security` |
| RLS enforced on a least-privileged role | PASS | 5 × `*-runtime-rls` suites + `rls_enforcement.sql`; asserted at boot by `runtime_role_report()` |
| WebSocket authn/authz, revocation, room access | PASS | `phase2-realtime-handshake`, `phase4-realtime`, `realtime-revocation` — a client subscribes by id, never by naming a room |
| File security (presign, ownership, traversal) | PASS | `phase4-attachments`, `s3-presign`, `storage-and-integrity-attacks` |
| Rate limiting — unauthenticated | PASS | `auth-throttling` |
| Rate limiting — authenticated actions | PASS | **Added this phase.** `phase8-abuse-controls` |
| WebSocket flood protection | PASS | **Added this phase.** `frame-budget`, `phase4-realtime` |
| Secret hygiene (worktree + full history) | PASS | Scanner clean; negative-probe test proves hard rules still fire in test paths |
| Error responses leak nothing | PASS | Stable `{error:{code,message}}`; health probes sanitised |
| Phone-number privacy | PASS | `no-contact-channel-columns` (structural) + log redaction (this phase) |
| Volume/DDoS defence at the edge | **BLOCKED** | No WAF, LB or CDN exists. Documented, not implied |
| Penetration test by a third party | **BLOCKED** | Never performed |

### Performance

| Requirement | Status | Evidence |
|---|---|---|
| Service-layer latency baseline | PASS (measured) | `docs/qa/performance-baseline.md` §2 |
| Concurrency behaviour | PASS (measured) | 20 concurrent senders → 84.5 msg/s aggregate, 5× the single-actor rate; p50 only doubles |
| N+1 / index review | PASS (measured) | Per-send DB work is constant, not proportional; essentially all `idx_scan`. ~35 lookups/send recorded as an optimisation opportunity, not a defect |
| HTTP p50/p95/p99 per endpoint | **BLOCKED** | No running API to load |
| WebSocket concurrency, reconnect storms | **BLOCKED** | Needs a deployed gateway |
| Broadcast fan-out at 100+ families | **BLOCKED** | Needs a worker under load |
| Multi-instance realtime (Redis adapter) | **BLOCKED** | RISK-4: a declared dependency, never a demonstrated behaviour |
| Connection-pool exhaustion | **BLOCKED** | Configured, never driven to its limit |
| Performance at production data volume | **BLOCKED** | Plans measured over hundreds of rows may differ over millions. **Highest-value remaining perf task** |

### Reliability

| Requirement | Status | Evidence |
|---|---|---|
| Outbox crash safety | PASS | `phase4-outbox-crash-safety` |
| Queue retry / idempotency | PASS | `phase4-notification-pipeline`, `automation.spec` |
| Notification retry and provider failure | PASS | `push-providers` (FCM 503, APNs 410/400/503), `phase4-notifications` |
| Message idempotency, no duplication | PASS | `phase2-messaging`, `20260905091000_chat_message_idempotency` |
| Graceful shutdown / draining | PASS | Implemented with a hard stop; unverified under real traffic |
| **Restore actually works** | PASS | **Fixed and drilled this phase.** 6/6 suites on a bare cluster |
| Backup configured | PARTIAL | `pg_dump` path works and is CI-gated. No provider backups — no provider |
| Backup encryption at rest | **FAIL** | Archives are unencrypted on whatever disk they land on |
| RPO / RTO measured | **BLOCKED** | Proposals only; needs a provider and a timed drill |
| Failure injection at scale | **BLOCKED** | Needs an environment |

### Observability

| Requirement | Status | Evidence |
|---|---|---|
| Structured JSON logging | PASS | **Added this phase.** `test/unit/observability/` (27 tests) |
| Secrets/PII never logged | PASS | Field allowlist + redaction, tested in both directions |
| Request correlation (`X-Request-Id`) | PASS | Honoured inbound, minted otherwise, echoed |
| Health: liveness / readiness / dependency | PASS | Implemented; 200 and 503 paths tested |
| Error tracking | **FAIL** | `SENTRY_DSN` defined, SDK not wired |
| Metrics | **FAIL** | Nothing emitted |
| Dashboards and alerts | **FAIL** | Nothing provisioned. Detection today means a person noticing |

### Testing, CI/CD, Mobile

| Requirement | Status | Evidence |
|---|---|---|
| Unit tests | PASS | 415 pass |
| Integration tests | PASS | 752 pass, 42 suites |
| Admin web tests | PASS | 111 pass |
| Database invariant suites | PASS | 6/6, all now gated |
| Migrations apply from empty + idempotent | PASS | 51 migrations, re-apply is a no-op |
| E2E Journey 1 (family messaging) | PARTIAL | Service + realtime + DB proven; no browser/device run |
| E2E Journey 2 (moderation) | PASS | `phase6-moderation`, `Moderation.test.tsx` |
| E2E Journey 3 (supervisor transfer) | PASS | `phase3-supervisor-transfer` incl. access loss and history |
| E2E Journey 4 (voice call) | PARTIAL | Lifecycle, tokens and authorization tested; **no real media path exercised** |
| E2E Journey 5 (broadcast) | PARTIAL | `phase5-broadcast` covers fan-out, dedupe, tracking; not at 100-family scale |
| CI executes the above | **BLOCKED** | No remote. Never run |
| Branch protection / required checks | **BLOCKED** | No remote |
| Mobile tests execute | **FAIL** | Wired this phase; never executed. No Flutter/Dart/JDK on this host |
| iOS / Android device testing | **FAIL** | No toolchain, no simulator, no device |
| Offline / poor network / killed app / multi-device | **FAIL** | Requires a device |

---

## 3. Production blockers

Unresolved. Each states who can clear it, because none can be cleared from this
machine.

| ID | Sev | Blocker | Owner |
|---|---|---|---|
| **B-1** | **P0** | **No git remote.** No workflow has ever executed. Every CI claim in this report is a claim about file content, including the fixes this phase made to CI | Product owner |
| **B-2** | **P0** | **No hosting.** No environment, domain, TLS, managed Postgres, Redis, bucket, push credentials or LiveKit project. The release step of both deploy workflows fails on purpose rather than pretending (ADR-003) | Product owner |
| **B-3** | **P0** | **Mobile is untested by construction.** 30 Dart test files have never run. Now wired to run in CI, which is blocked by B-1 | Clears with B-1 |
| **B-4** | **P1** | **No observability backend.** No error tracking, metrics, dashboards or alerts. Detection means a person noticing | Clears after B-2 |
| **B-5** | **P1** | **No staging.** Nothing has been deployed and smoke-tested anywhere | Clears after B-2 |
| **B-6** | **P1** | **Multi-instance realtime unproven (RISK-4).** Running two API instances without a working Redis adapter silently delivers events to only one | Needs staging |
| **B-7** | **P2** | **Backups are unencrypted at rest** | Clears with B-2 |
| **B-8** | **P2** | **No third-party penetration test** | Product owner |

## 4. Remaining risks that are not blockers

- **Query plans at scale are unmeasured.** §2 proves there is no N+1 at *small*
  scale, not that the planner still chooses index scans over millions of rows.
- **The send path is chatty** — ~35 indexed lookups per message, with
  `conversation` resolved ~9 times inside one send. Sub-millisecond each, so
  61 ms rather than a hazard. Recorded with evidence rather than optimised, per
  Phase 8's rule of targeted fixes over speculative rewrites.
- **Rate limits are hypotheses, not measurements.** Every number is a
  `chat.config` row so it can be corrected without a deploy, and every one is
  labelled `INITIAL HYPOTHESIS`.
- **Redaction is a backstop, not a guarantee.** It recognises the shapes it
  knows. The field allowlist is the real control.
- **One shared working tree.** Five agents commit to one checkout; this phase's
  baseline HEAD moved twice during the work.

## 5. What would make this green

1. Create a git remote and run CI. Fix what the first real run finds — including
   in this phase's own CI changes, which have never executed.
2. Provision hosting, secrets and TLS (B-2).
3. Deploy to staging; run the smoke test; run a restore drill *against staging*,
   including the one checklist item this phase could not cover — an application
   instance pointed at a restored database.
4. Wire Sentry and OTLP; define alerts that are actionable (B-4).
5. Prove multi-instance realtime with two instances (B-6).
6. Run the mobile suite on a runner, then on a simulator, then on a device.
   Cover offline, poor network, killed-app and multi-device behaviour.
7. Re-run the performance baseline against production-shaped data volume.
8. Encrypt backup archives at rest.
9. Commission a third-party penetration test.
10. Re-run this matrix against the real environment rather than against files.

---

## 6. Honest statement of the verdict

Phase 8 was asked to produce evidence sufficient to classify this system
Production Ready. **It does not exist, and this report will not manufacture it.**

What the evidence does support:

- The application's **security controls are real and tested** — not asserted from
  code inspection, but proven by 752 integration tests and six database-level
  invariant suites, including deliberate cross-tenant and cross-supervisor
  attempts.
- The system is **recoverable**, which it demonstrably was not at the start of
  this phase. That single finding — a backup that restored into a database the
  application could not write to — would have been discovered during an incident.
- The pipeline that verifies all of this **can now run at all**, which it could
  not.

What the evidence cannot support, and no amount of further work on this machine
could: **that any of it works when deployed.** Nothing has been deployed.
No workflow has run. No mobile test has executed anywhere. Three of the ten
areas in the summary are BLOCKED for the same underlying reason — the delivery
environment does not exist.

**Classification: NOT PRODUCTION READY.** The application layer is a Production
Candidate on the evidence. Promotion to Production Ready requires clearing B-1
and B-2 and then re-running this matrix against something real.
