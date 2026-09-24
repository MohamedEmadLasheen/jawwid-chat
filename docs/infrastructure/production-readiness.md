# Production Readiness

Owner: AI #7 · Last verified: 2026-09-24

Status: 🔴 **NOT READY.**

Not because infrastructure is unfinished — most of it is built and verified, and
the code and CI blockers below have since closed — but because Jawwid Chat still
has no place to run. That is a provisioning decision, not a repository defect;
see **Readiness is three separate questions** below.

## Checklist

Legend: ✅ done and verified · 🟡 partial · ❌ not done · ⛔ blocked

| | Item | State | Note |
|---|---|---|---|
| ⛔ | Production environment exists | ❌ | No hosting account, no domain. BLOCKER-1 |
| ✅ | Repository hosted, CI executable | ✅ | Remote live; CI runs green on a runner. BLOCKER-2 closed |
| ✅ | Application entrypoint | ✅ | `main.ts` bootstraps Nest and listens. BLOCKER-4 closed |
| ⛔ | Secrets configured | ❌ | No secret store exists |
| ⛔ | TLS enabled | ❌ | No domain |
| 🟡 | Database configured | 🟡 | Local ✅. No managed instance. Authority locked to the SQL migrations; reconciliation in progress |
| ❌ | Database backup configured | ❌ | Provider backups need a provider. `pg_dump` path ✅ |
| ✅ | **Restore tested** | ✅ | Drill executed 2026-09-05: 0 errors, 31 tables, 57 config rows |
| 🟡 | Redis configured | 🟡 | Local ✅, `appendonly` + `noeviction`. No managed instance |
| ❌ | Workers configured | ❌ | `dist/worker.js` does not exist (AI #2) |
| 🟡 | Object storage configured | 🟡 | MinIO ✅, private bucket ✅. No production bucket |
| ❌ | Push configured | ❌ | No Firebase or Apple credentials |
| ❌ | LiveKit configured | ❌ | No project |
| 🟡 | Core integration configured | 🟡 | Boundary being reworked to API/webhook per the locked decision |
| 🟡 | Realtime configured | 🟡 | Gateway exists; multi-instance Redis adapter unproven |
| ✅ | Health checks | ✅ | Liveness/readiness implemented; 200 and 503 paths both tested |
| ❌ | Monitoring | ❌ | Specified, nothing provisioned. BLOCKER-3 |
| ❌ | Error tracking | ❌ | `SENTRY_DSN` defined, SDK not wired |
| ✅ | CI configured | ✅ | Executes on GitHub-hosted runners; green on `main` |
| 🟡 | CD configured | 🟡 | Complete except the release step, which fails deliberately |
| ✅ | Rollback documented | ✅ | Including which migrations are *not* reversible |
| ✅ | Incident response documented | ✅ | No on-call rotation exists |
| ⛔ | Staging validated | ❌ | No staging environment. CODE-CLOSED / INFRA-BLOCKED |
| ✅ | Smoke tests available | ✅ | Executed against a live app; caught two real defects |
| ✅ | Secret hygiene | ✅ | Scanner clean over worktree and full history |
| ✅ | Config validation | ✅ | Rejects placeholders, wildcard CORS, sandbox APNs, TLS-disabled DSNs |
| ✅ | Images build unprivileged | ✅ | Verified `uid=1000(node)` |

## Readiness is three separate questions

They are tracked separately because they close separately, and conflating them
is how a project talks itself into believing it can deploy.

**1 · Repository / code readiness — ✅ READY.** The application builds, the
entrypoint exists, the test suites and security guards pass.

**2 · CI readiness — ✅ READY.** The pipeline runs on GitHub-hosted runners and
is green on `main`. This is observed behaviour, not a reading of the YAML.

**3 · Staging infrastructure readiness — ⛔ NOT READY.**

### Staging: CODE-CLOSED / INFRA-BLOCKED

The repository side of staging is correct and complete. What is missing is
external provisioning, verified against the live GitHub configuration on
2026-09-24:

* no staging hosting target exists
* no `staging` environment exists in GitHub (the repository has zero
  environments; `deploy-staging.yml` references one that has never been created)
* no staging database exists
* no staging Redis exists
* no staging object storage exists
* no staging domain or TLS certificate exists
* no deployment credentials exist (the repository has zero Actions secrets and
  zero Actions variables)
* the `Release` step remains intentionally unimplemented, and fails loudly,
  until a hosting platform is selected and provisioned (ADR-003)

**A red `Deploy staging` run is therefore the expected and correct outcome**, and
will stay that way until infrastructure exists. It is not a regression, and it
must not be "fixed" by relaxing a guard, making the release step succeed, or
marking the job `continue-on-error`. ADR-003 considered and rejected exactly
that: a pipeline reporting success without deploying is a false negative on
every future incident.

The closure sequence is external and ordered: choose the platform, provision the
infrastructure, create the GitHub `staging` environment, configure its variables
and secrets, implement the real release command, deploy, then run
`scripts/infra/smoke.sh` against the live host. Owner: product owner for the
first two; AI #7 thereafter.

## Blockers

**BLOCKER-1 · No hosting.** No cloud account, domain, TLS certificate, managed
Postgres, Redis, object storage bucket, push credentials or LiveKit project
exists for Jawwid Chat. Owner: product owner. Until then, nothing can be
deployed anywhere, and the release step of both deployment workflows fails on
purpose rather than pretending (ADR-003).

**BLOCKER-2 · No git remote. — ✅ CLOSED 2026-09-24.** The repository is hosted
at `MohamedEmadLasheen/jawwid-chat` and CI executes on GitHub-hosted runners,
green on `main`. Claims about CI are now claims about observed behaviour. CD
still cannot be judged this way: `Deploy staging` has failed on all 21 recorded
runs, and the deploy job was skipped on every run because the build job failed
first. The release stub has therefore never executed. That is BLOCKER-1, not
this one.

**BLOCKER-3 · No observability backend.** No error tracking, metrics, dashboards
or alerting. Detection today means a person noticing. Owner: AI #7, once
BLOCKER-1 clears.

**BLOCKER-4 · The API has no entrypoint. — ✅ CLOSED.** `apps/api/src/main.ts`
exists: it constructs the Nest application from `AppModule` and listens on the
configured port. The API can start. Nothing about this closes BLOCKER-1 — the
API can start, but there is still nowhere to start it.

## High risks

**RISK-1 · The Prisma client and the API source have drifted.** `npm run
typecheck` fails on the test project: the generated client no longer exports
members the specs import. `src/` still compiles, so the image builds — but CI's
typecheck gate will fail. Note the container build regenerates the Prisma client
from scratch and is therefore a **stricter** check than any local build, which
reuses a stale client. Owner: AI #2 / AI #5.

**RISK-2 · Database reconciliation is mid-flight.** The authority is locked to
the SQL migrations, and Prisma is being moved onto the `chat` schema. Until it
lands, the two descriptions of the domain disagree. Owner: AI #1.
Cross-referenced: `docs/product-operations/database-divergence.md`.

**RISK-3 · Mobile is unbuildable and untestable.** No `pubspec.yaml`; no Flutter
SDK on any known host. Every mobile build instruction in `handoff-ai3.md` is a
specification that has never been executed. Owner: AI #3.

**RISK-4 · Multi-instance realtime is unproven.** The Socket.IO Redis adapter is
a declared dependency, not a demonstrated behaviour. Running two API instances
without it silently delivers events to only one of them. Must be tested on
staging before any horizontal scaling.

**RISK-5 · One shared working tree.** Five-plus agents commit to one checkout;
files written by one were committed by another, and this branch's `ci.yml` was
overwritten and had to be merged back. Nothing here is safe to assume unread.
Cross-referenced: `docs/product-operations/shared-working-tree-risk.md`.

## What would make this green

1. Provision hosting, then create the GitHub `staging` environment and configure
   its variables and secrets (BLOCKER-1; ordered sequence under **Staging:
   CODE-CLOSED / INFRA-BLOCKED**).
2. Write `worker.ts`; `dist/worker.js` still does not exist. (`main.ts` is done —
   BLOCKER-4 closed.)
3. Land the database reconciliation (RISK-2).
4. Fill in the release step in both deployment workflows.
5. Deploy to staging; run the smoke test; run a restore drill against staging.
6. Provision observability and wire Sentry and OTLP (BLOCKER-3).
7. Prove multi-instance realtime on staging (RISK-4).
8. Define an on-call rotation and escalation path.
9. Re-run this checklist against the real environment rather than against files.
