# Production Readiness

Owner: AI #7 · Last verified: 2026-09-06

Status: 🔴 **NOT READY.**

Not because infrastructure is unfinished — most of it is built and verified —
but because Jawwid Chat has no place to run and no application entrypoint to run
there. Both are blockers no amount of configuration closes.

## Checklist

Legend: ✅ done and verified · 🟡 partial · ❌ not done · ⛔ blocked

| | Item | State | Note |
|---|---|---|---|
| ⛔ | Production environment exists | ❌ | No hosting account, no domain. BLOCKER-1 |
| ⛔ | Repository hosted, CI executable | ❌ | No git remote. BLOCKER-2 |
| ⛔ | Application entrypoint | ❌ | `main.ts` does not exist; the API cannot start. BLOCKER-4 |
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
| 🟡 | CI configured | 🟡 | Pipeline written and locally dry-run; **never executed on a runner** |
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

**BLOCKER-2 · No git remote.** The repository is local-only. CI and CD are
written and validated as files but have **never run on a runner**. Every claim
about them is a claim about their content, not their behaviour. Owner: product
owner.

**BLOCKER-3 · No observability backend.** No error tracking, metrics, dashboards
or alerting. Detection today means a person noticing. Owner: AI #7, once
BLOCKER-1 clears.

**BLOCKER-4 · The API has no entrypoint.** `apps/api` has no `main.ts`; nothing
constructs a Nest application, so the API cannot start in any environment. The
image builds and the health and bootstrap modules are ready and tested; they are
one import away from working. Owner: AI #1 / AI #2.

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

1. Provision hosting and a git remote (BLOCKER-1, BLOCKER-2).
2. Write `main.ts` and `worker.ts` (BLOCKER-4).
3. Land the database reconciliation (RISK-2).
4. Fill in the release step in both deployment workflows.
5. Run CI on a real runner and fix what it finds.
6. Deploy to staging; run the smoke test; run a restore drill against staging.
7. Provision observability and wire Sentry and OTLP (BLOCKER-3).
8. Prove multi-instance realtime on staging (RISK-4).
9. Define an on-call rotation and escalation path.
10. Re-run this checklist against the real environment rather than against files.
