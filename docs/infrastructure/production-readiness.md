# Production Readiness

Owner: AI #7 · Last verified: 2026-10-22 (GitHub configuration re-read; the deploy path is code-complete)

Status: 🔴 **NOT READY.**

Not because infrastructure is unfinished — the deploy path is now code-complete
for DigitalOcean App Platform (ADR-010, ADR-012) — but because Jawwid Chat still
has no place to run. What remains is a short list of owner actions, in order,
under **Owner steps that remain** below; none of it is a repository defect.

## Checklist

Legend: ✅ done and verified · 🟡 partial · ❌ not done · ⛔ blocked

| | Item | State | Note |
|---|---|---|---|
| ⛔ | Production environment exists | ❌ | No hosting account, no domain. BLOCKER-1 |
| ✅ | Repository hosted, CI executable | ✅ | Remote live; CI runs on every push and PR, green on a GitHub-hosted runner. BLOCKER-2 closed |
| ✅ | Application entrypoint | ✅ | `apps/api/src/main.ts` and `apps/api/src/worker.ts` both exist. BLOCKER-4 closed |
| ⛔ | Secrets configured | ❌ | No secret store exists |
| ⛔ | TLS enabled | ❌ | No domain |
| 🟡 | Database configured | 🟡 | Local ✅. No managed instance. Authority locked to the SQL migrations; reconciliation in progress |
| ❌ | Database backup configured | ❌ | Provider backups need a provider. `pg_dump` path ✅ |
| ✅ | **Restore tested** | ✅ | Drill executed 2026-09-05: 0 errors, 31 tables, 57 config rows |
| 🟡 | Redis configured | 🟡 | Local ✅, `appendonly` + `noeviction`. No managed instance |
| 🟡 | Workers configured | 🟡 | Code ✅ — `src/worker.ts` drains the outbox, same image as the API (ADR-004). No worker process runs anywhere |
| 🟡 | Object storage configured | 🟡 | MinIO ✅, private bucket ✅. No production bucket |
| ❌ | Push configured | ❌ | No Firebase or Apple credentials |
| ❌ | LiveKit configured | ❌ | No project |
| 🟡 | Core integration configured | 🟡 | Boundary being reworked to API/webhook per the locked decision |
| 🟡 | Realtime configured | 🟡 | Gateway exists; multi-instance Redis adapter unproven |
| ✅ | Health checks | ✅ | Liveness/readiness implemented; 200 and 503 paths both tested |
| ❌ | Monitoring | ❌ | Structured JSON logs implemented (`monitoring.md` §3); metrics, dashboards, alerts not provisioned. BLOCKER-3 |
| 🟡 | Error tracking | 🟡 | Sentry wired in API and worker behind a privacy allowlist (`monitoring.md` §3a, 2026-10-21); no Sentry project or DSN provisioned |
| ✅ | CI configured | ✅ | Executes on GitHub-hosted runners; green on `main` |
| 🟡 | CD configured | 🟡 | Release step implemented: `doctl` deploys `.do/app.<env>.yaml` and verifies the active deployment (ADR-012). Never executed: no DigitalOcean account yet |
| ✅ | Infrastructure as code | ✅ | App Platform specs generated from the manifest; guard `app-spec` (stale spec, ADR invariants, workflow supply, `doctl` schema) runs in CI |
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
* no DigitalOcean account, token or app exists, so the `Release` step — now
  implemented (ADR-012) — refuses loudly, and the run stops at **The deploy
  credentials are present**, before the backup and the migrations

**A red `Deploy staging` run is therefore the expected and correct outcome**, and
will stay that way until infrastructure exists. It is not a regression, and it
must not be "fixed" by relaxing a guard, making the release step succeed, or
marking the job `continue-on-error`. ADR-003 considered and rejected exactly
that: a pipeline reporting success without deploying is a false negative on
every future incident. It turns green by doing **Owner steps that remain**.

The closure sequence is external and ordered: choose the platform, provision the
infrastructure, create the GitHub `staging` environment, configure its variables
and secrets, implement the real release command, deploy, then run
`scripts/infra/smoke.sh` against the live host. Owner: product owner for the
first two; AI #7 thereafter.

## Owner steps that remain

Everything the repository can do is done. The rest needs accounts, money or
DNS, so it is the owner's. In this order — each step names what it unblocks.
Re-verified against the live GitHub configuration on 2026-10-22: the `staging`
Environment exists and holds only `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` and
`LIVEKIT_URL`; there is no `production` Environment and no repository variable.

1. **Create the DigitalOcean account and a project** (e.g. `jawwid-chat`).
   Optionally save the project's id as the repository or Environment variable
   `DIGITALOCEAN_PROJECT_ID`; a first deploy then lands the app in it instead of
   the default project.
2. **Choose the database host — run the preflight first.** Create a *trial*
   DigitalOcean Managed PostgreSQL 17 cluster and run, from a machine that can
   reach it:
   ```bash
   DATABASE_URL='postgresql://doadmin:…@…:25060/defaultdb?sslmode=require' scripts/db/preflight-role-capability.sh
   ```
   It changes nothing (the probe is rolled back). Exit 0: the migrations' BYPASSRLS
   grant works there, and DigitalOcean can be the database host. Non-zero: it
   cannot as things stand — either the migration changes or the database lives
   elsewhere (ADR-010). Delete the trial cluster either way. The app spec does
   not provision a database on purpose: it reads `DATABASE_URL` from the
   Environment, so this choice changes no code.
3. **Choose the domain.** The deploy needs two hosts per environment, e.g.
   `api.staging.<domain>` and `admin.staging.<domain>`, and the same without
   `staging.` for production. Set these **repository variables**
   (Settings → Secrets and variables → Actions → Variables):

   | Variable | Example |
   |---|---|
   | `STAGING_API_BASE_URL` | `https://api.staging.<domain>` — the API **origin**, no `/api/v1` |
   | `STAGING_REALTIME_URL` | `wss://api.staging.<domain>` |
   | `STAGING_ADMIN_WEB_URL` | `https://admin.staging.<domain>` |
   | `STAGING_CORS_ALLOWED_ORIGINS` | `https://admin.staging.<domain>` |
   | `PRODUCTION_*` | the same four for production |

   The Admin Web bundle compiles the API URL in (ADR-006), which is why the
   domain comes before the first deploy. The domain also unblocks passkeys
   (PD-23 Phase B).
4. **Create the GitHub Environments.** `staging` exists. Create `production`
   with required reviewers and a deployment-branch rule limited to `main`
   (Settings → Environments). The production workflow's safety depends on
   these rules, and no file can enforce them.
5. **Add the deploy credentials to both Environments:**
   * `DIGITALOCEAN_ACCESS_TOKEN`: a DigitalOcean personal access token with
     read, create and update on apps (plus read on projects if step 1 set
     `DIGITALOCEAN_PROJECT_ID`). Use one token per environment if you want to
     revoke staging without touching production.
   * `GHCR_PULL_CREDENTIALS`: `<github-username>:<token>`, a GitHub token with
     `read:packages` only. App Platform pulls the images from GHCR with it, at
     every deploy and every restart, so it must be long-lived. The workflow's
     own `GITHUB_TOKEN` expires with the run.
6. **Set `BACKUP_ENCRYPTION_PASSPHRASE`** in both Environments, and keep a copy
   outside GitHub. Secrets there are write-only, and an archive nobody can
   decrypt is not a backup (`backup-recovery.md` §3). Without it, the deploy
   stops at the backup step, before any migration.
7. **Provision the remaining services and set their values** in each
   Environment, under the manifest's own names (`infra/env/<env>.env.example`
   lists every one; `scripts/infra/check-env.sh <env>` is what judges them):
   `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
   storage (`STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_REGION`,
   `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_SIGNING_SECRET`),
   LiveKit for production, and push, Core and `SENTRY_DSN` where the
   environment requires them. Also set **`TRUSTED_PROXY_HOPS`** (variable). It
   is required, and it is the number of proxies App Platform puts in front of
   the API. Establish it from DigitalOcean rather than by guessing, and confirm
   it after the first deploy (the login rate limiter keys on the address it
   yields).
8. **First deploy.** Actions → **Deploy staging** → `first_deploy` = true. The run
   creates the app and prints its id. Save the id as the `DIGITALOCEAN_APP_ID`
   secret of `staging`; every later run requires it and refuses without it.
   Point both hosts' DNS (CNAME) at the app's default ingress, which the
   DigitalOcean console shows. App Platform issues the certificates once DNS
   resolves. Then re-run **Deploy staging** normally: the smoke test is the
   proof. Repeat for production with **Deploy production**, giving a commit
   staging has already run.
9. **Then** the rest of **What would make this green**: a restore drill against
   staging (6), observability (7), multi-instance realtime (8), on-call (9).

What the repository guarantees meanwhile: until steps 1–8 are done, every
deploy run fails at its first step with the missing item named, and changes
nothing. It never reports a deployment that did not happen (ADR-003).

## Blockers

**BLOCKER-1 · No hosting.** *Provider chosen 2026-10-22: DigitalOcean App
Platform (ADR-010); the app spec and release step are in the repository
(ADR-012). Nothing is provisioned yet — see **Owner steps that remain**.* No cloud account, domain, TLS certificate, managed
Postgres, Redis, object storage bucket, push credentials or LiveKit project
exists for Jawwid Chat. Owner: product owner. Until then, nothing can be
deployed anywhere, and the release step of both deployment workflows fails on
purpose rather than pretending (ADR-003).

**BLOCKER-2 · No git remote. — ✅ CLOSED 2026-09-24.** The repository is hosted
at `MohamedEmadLasheen/jawwid-chat`, and CI executes on GitHub-hosted runners on
every push and pull request, green on `main`. Claims about CI are now claims
about observed behaviour. CD still cannot be judged this way: `Deploy staging`
has failed on all 21 recorded runs, and the deploy job was skipped on every run
because the build job failed first — so the release stub has never executed, and
would refuse on purpose (ADR-003) if it ever did. What remains unexecuted is the
*deployment*, not the pipeline. That is BLOCKER-1, not this one.

**BLOCKER-3 · No observability backend.** No error tracking, metrics, dashboards
or alerting. Detection today means a person noticing. Owner: AI #7, once
BLOCKER-1 clears.

**BLOCKER-4 · The API has no entrypoint. — ✅ CLOSED.** `apps/api/src/main.ts`
exists: it constructs the Nest application from `AppModule` and listens on the
configured port. `apps/api/src/worker.ts` is the second entrypoint, draining the
outbox from the same image under a different command (ADR-004). Both are
exercised by the test suites. Nothing about this closes BLOCKER-1 — the API can
start, but there is still nowhere to start it.

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

1. ~~Provision a git remote~~ — done; CI runs and is green (BLOCKER-2 closed).
2. ~~Write `main.ts` and `worker.ts`~~ — done (BLOCKER-4 closed).
3. ~~Choose a provider~~ — DigitalOcean App Platform (ADR-010). Provision
   hosting, then create the GitHub `staging` environment and configure its
   variables and secrets (BLOCKER-1; ordered sequence under **Staging:
   CODE-CLOSED / INFRA-BLOCKED**). Verify the BYPASSRLS capability first —
   `scripts/db/preflight-role-capability.sh` answers it against a trial instance
   without migrating anything.
4. Land the database reconciliation (RISK-2).
5. ~~Fill in the release step in both deployment workflows, together with the IaC
   for the chosen provider (ADR-009)~~ — done: `.do/app.<env>.yaml` and the
   `doctl` release step landed together (ADR-012).
6. Deploy to staging; run the smoke test; run a restore drill against staging.
7. Provision observability and wire Sentry and OTLP (BLOCKER-3).
8. Prove multi-instance realtime on staging (RISK-4).
9. Define an on-call rotation and escalation path.
10. Re-run this checklist against the real environment rather than against files.
