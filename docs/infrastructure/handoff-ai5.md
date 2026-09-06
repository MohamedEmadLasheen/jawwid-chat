# Handoff → AI #5 (QA, security validation, release gates)

From AI #7 (infrastructure) · 2026-09-06

## 0. First, an apology and a correction

I overwrote `.github/workflows/ci.yml` — your file, with your release gates —
before noticing it had been committed. It is restored. The current file is
**your pipeline plus infrastructure jobs**, and the diff against your commit
contains exactly one removed line: the header, which now credits both of us.
Every gate (G-18, G-19, G-20, G-31..G-35, G-37, and the G-07/G-04/G-44 test
step) is intact and unmodified.

The division I have assumed: **you decide what must pass; I provide the pipeline
that runs it.** If any infrastructure job belongs under a gate ID of yours,
renumber it — I will not object.

## 1. What I added to your pipeline

To `guards` (four steps, complementary to G-18 rather than replacing it):

| Step | What it catches |
|---|---|
| `scan-secrets.sh --history` | Credentials in the worktree **and full git history**; server secrets reachable from `lib/` or `apps/admin-web/src/`; tracked `.env` files |
| `check-web-env.sh` | Secret-shaped `VITE_*` variables |
| `check-env.sh local --file .env.example` | The local template is valid and complete |
| template diff | `infra/env/*.env.example` still matches `infra/env/manifest.tsv` |

To `admin-web`: a real `npm run build`, then a credential scan of the built
bundle. To `migrations`: a backup drill against the current schema. Two new
jobs: `images` (both images build; the API image must not run as root) and
`dependencies` (advisory `npm audit`, non-blocking by design — promoting it to
blocking is your call, not a side effect of my job).

I also added `permissions: contents: read`. The workflow runs on
`pull_request`, so anyone able to open one can trigger it; the default token is
broader than it needs.

## 2. Running the suite against an environment

```bash
scripts/infra/smoke.sh <api-base-url> [--web <admin-url>]
```

Asserts: liveness 200; readiness 200; **build identity present and not
`unknown`**; the health payload carries no credentials; `nosniff`; HSTS on
https; CORS does not reflect an untrusted origin. With `--web`: the SPA serves
deep links, CSP is present, and `index.html` is not cacheable.

It authenticates as nobody and reads no customer data, so it is safe against
production. It is deliberately shallow — it proves the deployment is wired up,
not that the product is correct. That remains `docs/qa/test-plan.md`.

This is not theoretical: run against a live app during this work it caught two
real defects (no security headers, no CORS policy), both now fixed.

## 3. Security controls you can test

| Control | Where | How to verify it works |
|---|---|---|
| Security headers | `apps/api/src/infra/http/bootstrap.ts` | `curl -D -` on any endpoint |
| CORS allowlist | same | Send `Origin: https://evil.example` — expect **no** `Access-Control-Allow-Origin` |
| Graceful shutdown | same | `SIGTERM` → clean exit within `SHUTDOWN_GRACE_MS` (verified) |
| Health payload sanitisation | `health.service.ts` | Take Postgres down; the payload says `"error":"Error"`, never a DSN |
| Config validation | `check-env.sh` | `check-env.sh production --file .env.example` → 26 errors, exit 1 |
| Browser-bundle secrets | `check-web-env.sh` | `VITE_LIVEKIT_API_SECRET=x ./scripts/infra/check-web-env.sh` → refused |
| Secret scan | `scan-secrets.sh` | Plant a decoy private key; confirm it fails |
| Non-root container | `apps/api/Dockerfile` | `docker run --rm --entrypoint id <image> -un` → `node` |

All eight were executed during this work and behaved as described.

**Please adversarially test `check-env.sh` and `scan-secrets.sh` specifically.**
Both are guards I wrote and I found two bugs in them myself (`git grep` parsing
patterns beginning with `-` as flags, so the private-key rule silently matched
nothing; and localhost DSNs in example files raising false positives). A guard
that quietly matches nothing is worse than no guard, because it is trusted.

## 4. Rate limiting

Infrastructure provides the surfaces — authentication, message send, upload,
search, calls, admin APIs — and the limits are configurable. **The values are
yours to set.** They are not implemented yet; when you specify them, I will add
the variables to the manifest.

## 5. Health endpoints

`/health/live` (never touches a dependency), `/health/ready` (Postgres + Redis,
503 when down), `/health` (detail, always 200). Core, push and LiveKit are
deliberately excluded from readiness (ADR-007): they degrade features and must
not remove a healthy instance from the pool.

Both the 200 and 503 paths were tested against real dependencies.

## 6. Failure scenarios you can exercise on staging

Stop Redis (readiness → 503, instance drains); make Postgres unreachable
(**note: the API currently fails to boot rather than reporting unready** —
that is the finding in `handoff-ai1.md`); restart the worker mid-job; expire a
LiveKit token; point APNs at the sandbox with a production token; make Core time
out; run two API instances and verify realtime fan-out (RISK-4 — this one is
unproven and I expect it to fail without the Redis adapter wired).

Do not run destructive failure injection against production.

## 7. Backup and restore

The restore drill is documented in `backup-recovery.md` §5 with a five-point
checklist. Last run 2026-09-05: **passed** — 0 errors, 31 tables, 57 config
rows, 13 migrations.

The finding worth your attention: a naive `--schema chat` restore **fails
partway and looks like it worked** — 4 of 16 tables, zero config rows. If a
recovery procedure is ever tested by someone who does not read §4, that is the
shape the failure takes.

## 8. Test accounts and fixtures

None exist, and I have not created any. Note your own G-20 constraint: fixtures
must use synthetic staff (`admin_a`, `coverage_b`), never the real employee
names in the brief. When you define fixtures, tell me and I will wire seeding
into the staging deployment.

## 9. What blocks you

Staging does not exist (BLOCKER-1), so nothing in §2 or §6 can be executed yet.
CI has never run on a runner (BLOCKER-2) — every claim about the pipeline is a
claim about its content. And `npm run typecheck` currently fails on the test
project because the Prisma client drifted from the specs (RISK-1); your `api`
job will go red on the first real run for that reason.
