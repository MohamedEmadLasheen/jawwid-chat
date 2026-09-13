# Production Readiness

Owner: AI #7 · Last verified: 2026-09-06 · **Re-verified 2026-09-08 (Phase 8)** ·
**Re-verified 2026-09-13 (green integration checkpoint)**

Status: 🔴 **NOT READY.**

Not because infrastructure is unfinished — most of it is built and verified —
but because Jawwid Chat has **no place to run**. That is the blocker no amount of
configuration closes.

> **Corrections as of 2026-09-08.** This page was written on 2026-09-06 and three
> of its entries have since become false:
>
> - **BLOCKER-4 is CLOSED.** `apps/api/src/main.ts` and `src/worker.ts` both
>   exist and are wired. The API has an entrypoint.
> - **RISK-1 is CLOSED.** `npm run typecheck` passes cleanly on both projects.
> - **RISK-3 is PARTLY closed.** `pubspec.yaml` exists and 30 Dart test files
>   exist. Still no Flutter SDK on any known developer host, so they remain
>   unexecuted — but CI is now genuinely wired to run them.
>
> One entry became **worse** on inspection, and it was the most dangerous:
> "**Restore tested ✅ — drill executed 2026-09-05**" was true when written and
> false by 2026-09-08. The restore path was broken in two ways and produced a
> database the application could not write to. It is fixed and re-drilled. See
> `docs/recovery/PHASE-8-REPORT.md` §1 and `backup-recovery.md` §4.
>
> The authoritative current status is `docs/recovery/PHASE-8-REPORT.md`.

> **Corrections as of 2026-09-13**, at the green integration checkpoint
> `9b4e37e5` (tag `integration-green-2026-09-13`). Four entries below had become
> false, and one understated what is now proven:
>
> - **BLOCKER-2 is CLOSED.** The repository is hosted at
>   `github.com/MohamedEmadLasheen/jawwid-chat`, and CI has executed on a GitHub
>   runner. Statements about CI are no longer claims about file content.
> - **CI ran green on a runner.** Run `34652871489`, 7/7 jobs, including G-19
>   (44/44 suites, 776/776 tests) and G-41.
> - **BLOCKER-4 is CLOSED.** The 2026-09-08 note above already said so; the
>   entry under "Blockers" had not been updated to match, and said the opposite.
> - **Error tracking is wired.** `@sentry/node` is a dependency and
>   `createErrorTracker` is called in both `src/main.ts` and `src/worker.ts`.
>   What is missing is a Sentry PROJECT and a `SENTRY_DSN` value — the code is
>   ready, nothing receives the events.
> - **Restore is proven in CI, not only on a laptop.** G-41 takes the backup,
>   verifies the checksum, restores into a database that did not exist, and runs
>   the same six suites against the copy, on every run.
>
> **None of this changes the verdict.** CI is not staging, and staging is not
> production. BLOCKER-1 stands: there is still no environment to deploy to, and
> nothing here has been executed against real infrastructure.

## Checklist

Legend: ✅ done and verified · 🟡 partial · ❌ not done · ⛔ blocked

| | Item | State | Note |
|---|---|---|---|
| ⛔ | Production environment exists | ❌ | No hosting account, no domain. BLOCKER-1 |
| ✅ | Repository hosted, CI executable | ✅ | Hosted on GitHub; CI executed on a runner and is green (run `34652871489`, 2026-09-13). BLOCKER-2 closed |
| ✅ | Application entrypoint | ✅ | `main.ts` and `worker.ts` exist and are wired (2026-09-08) |
| ⛔ | Secrets configured | ❌ | No secret store exists |
| ⛔ | TLS enabled | ❌ | No domain |
| 🟡 | Database configured | 🟡 | Local ✅. No managed instance. Authority locked to the SQL migrations; reconciliation in progress |
| 🟡 | Database backup configured | 🟡 | **Application-level drill proven in CI** (G-41, every run): `pg_dump`, checksum, restore into a database that did not exist, six structural suites against the copy, 128 config rows and a `chat_app` read-back of 128. **Not configured:** provider-managed backups and point-in-time recovery — those need a provider, and none exists (BLOCKER-1) |
| ✅ | **Restore tested** | ✅ | **Was BROKEN; fixed 2026-09-08.** Re-drilled onto a bare cluster: 80 tables, 50 migrations, 119 config rows, 186 grants, 6/6 integrity suites. **Now proven in CI on every run** (G-41): backup, checksum, restore, six suites against the restored copy, 128 config rows, `chat_app` read-back 128. Never drilled against staging or production, which do not exist |
| 🟡 | Redis configured | 🟡 | Local ✅, `appendonly` + `noeviction`. No managed instance |
| 🟡 | Workers configured | 🟡 | `src/worker.ts` exists and builds; never run in a deployed environment |
| 🟡 | Object storage configured | 🟡 | MinIO ✅, private bucket ✅. No production bucket |
| ❌ | Push configured | ❌ | No Firebase or Apple credentials |
| ❌ | LiveKit configured | ❌ | No project |
| 🟡 | Core integration configured | 🟡 | Boundary being reworked to API/webhook per the locked decision |
| 🟡 | Realtime configured | 🟡 | Gateway exists; multi-instance Redis adapter unproven |
| ✅ | Health checks | ✅ | Liveness/readiness implemented; 200 and 503 paths both tested |
| 🟡 | Monitoring | 🟡 | Structured JSON logging implemented and tested (2026-09-08). Metrics, dashboards and alerts still unprovisioned. BLOCKER-3 |
| 🟡 | Error tracking | 🟡 | SDK **is** wired: `@sentry/node` plus `createErrorTracker` in `main.ts` and `worker.ts`. No Sentry project and no `SENTRY_DSN` value, so nothing receives the events |
| ✅ | CI configured | ✅ | Was RED at its first job; fixed 2026-09-08. **Executed on a GitHub runner 2026-09-13: 7/7 jobs green** (run `34652871489`) — guards, API, Admin Web, images, dependency audit, Mobile, and G-19 (44/44 suites, 776/776 tests) through G-41 |
| 🟡 | CD configured | 🟡 | Complete except the release step, which fails deliberately |
| ✅ | Rollback documented | ✅ | Including which migrations are *not* reversible |
| ✅ | Incident response documented | ✅ | No on-call rotation exists |
| ❌ | Staging validated | ❌ | No staging environment |
| ✅ | Smoke tests available | ✅ | Executed against a live app; caught two real defects |
| ✅ | Secret hygiene | ✅ | Scanner clean over worktree and full history |
| ✅ | Config validation | ✅ | Rejects placeholders, wildcard CORS, sandbox APNs, TLS-disabled DSNs |
| ✅ | Images build unprivileged | ✅ | Verified `uid=1000(node)` |

## Blockers

**BLOCKER-1 · No hosting.** No cloud account, domain, TLS certificate, managed
Postgres, Redis, object storage bucket, push credentials or LiveKit project
exists for Jawwid Chat. Owner: product owner. Until then, nothing can be
deployed anywhere, and the release step of both deployment workflows fails on
purpose rather than pretending (ADR-003).

**BLOCKER-2 · No git remote. — CLOSED 2026-09-13.** The repository is hosted at
`github.com/MohamedEmadLasheen/jawwid-chat`, and CI has executed on a GitHub
runner: run `34652871489`, 7/7 jobs green. The original entry read: *"The
repository is local-only. CI and CD are written and validated as files but have
never run on a runner. Every claim about them is a claim about their content,
not their behaviour."* That is no longer true of CI. It remains true of **CD**,
whose release step has still never run — see BLOCKER-1 and the CD row above.

**BLOCKER-3 · No observability backend.** No error tracking, metrics, dashboards
or alerting. Detection today means a person noticing. Owner: AI #7, once
BLOCKER-1 clears.

**BLOCKER-4 · The API has no entrypoint. — CLOSED 2026-09-08.** `src/main.ts`
constructs the Nest application and listens; `src/worker.ts` runs the outbox and
sweep loops. Both are exercised by CI. The original entry read: *"`apps/api` has
no `main.ts`; nothing constructs a Nest application, so the API cannot start in
any environment."* It was recorded as closed in the 2026-09-08 note at the top of
this page, and this entry was left contradicting it until 2026-09-13.

## High risks

**RISK-1 · The Prisma client and the API source have drifted. — CLOSED
2026-09-08; proven on a runner 2026-09-13.** `npm run typecheck` passes on both
projects, and CI gates it: `API · typecheck + unit` and `Admin Web · typecheck +
tests` are both green in run `34652871489`. The original entry read: *"`npm run
typecheck` fails on the test project: the generated client no longer exports
members the specs import. `src/` still compiles, so the image builds — but CI's
typecheck gate will fail."*

The observation that outlives the fix is still worth keeping: the container build
regenerates the Prisma client from scratch and is therefore a **stricter** check
than any local build, which reuses a stale client. That build also runs in CI
(`Container images build and run unprivileged`, green). Owner: AI #2 / AI #5.

**RISK-2 · Database reconciliation is mid-flight.** The authority is locked to
the SQL migrations, and Prisma is being moved onto the `chat` schema. Until it
lands, the two descriptions of the domain disagree. Owner: AI #1.
Cross-referenced: `docs/product-operations/database-divergence.md`.

**RISK-3 · Mobile is unbuildable and untestable. — CLOSED for CI 2026-09-13.
NOT closed for end-to-end verification.** The original entry read: *"No
`pubspec.yaml`; no Flutter SDK on any known host. Every mobile build instruction
in `handoff-ai3.md` is a specification that has never been executed."* CI now
installs Flutter and runs the mobile job green in run `34652871489`: `flutter
analyze`, 29 Dart test files, and a debug Android APK that actually builds.

What replaces it is a narrower risk, and it is deliberately not the same claim.
The app COMPILES and its widget tests pass. **No mobile build has ever talked to
a Jawwid API.** `test/integration/live_backend_test.dart` skips itself unless
`JAWWID_LIVE_API` is set, and CI does not set it; and a build without
`--dart-define=JAWWID_API_BASE_URL` runs against `fake_backend.dart`, which is
exactly what CI builds. Compiling is not the same as working. Owner: AI #3.

**RISK-4 · Multi-instance realtime is unproven.** The Socket.IO Redis adapter is
a declared dependency, not a demonstrated behaviour. Running two API instances
without it silently delivers events to only one of them. Must be tested on
staging before any horizontal scaling.

**RISK-5 · One shared working tree.** Five-plus agents commit to one checkout;
files written by one were committed by another, and this branch's `ci.yml` was
overwritten and had to be merged back. Nothing here is safe to assume unread.
Cross-referenced: `docs/product-operations/shared-working-tree-risk.md`.

## What would make this green

1. Provision hosting (BLOCKER-1). The git remote now exists (BLOCKER-2 closed).
2. ~~Write `main.ts` and `worker.ts`~~ — done (BLOCKER-4 closed).
3. Land the database reconciliation (RISK-2).
4. Fill in the release step in both deployment workflows.
5. ~~Run CI on a real runner and fix what it finds~~ — done: 7/7 green (run
   `34652871489`). Running it against a real ENVIRONMENT is still item 6.
6. Deploy to staging; run the smoke test; run a restore drill against staging.
7. Provision observability and wire Sentry and OTLP (BLOCKER-3).
8. Prove multi-instance realtime on staging (RISK-4).
9. Define an on-call rotation and escalation path.
10. Re-run this checklist against the real environment rather than against files.
