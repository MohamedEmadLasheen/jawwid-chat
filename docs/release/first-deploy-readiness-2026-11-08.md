# First deploy readiness (LR-01), 2026-11-08

Owner of this report: release manager (builder session). Low risk, documents only. **Nothing was
deployed, run or changed to write it.**

> **Status: Blocker LR-77 (§1d) is fixed (update, 2026-11-08).** When this report was written, the
> first deploy failed at the backup step, before any migration: both workflows back up the `chat`
> schema before `scripts/db/apply.sh` creates it, and the backup refused a database with no `chat`
> schema. `scripts/infra/backup-db.sh` now skips the backup, loudly and without writing a file, when
> the schema does not exist and `FIRST_DEPLOY` is unset, empty or `true`; with any other `FIRST_DEPLOY` value
> it fails. The workflow follow-up (#518, merged 2026-11-08 as `84a4e5d5`) passes `FIRST_DEPLOY` to
> that step: the deploy's `first_deploy` input in both deploy workflows, and `'false'` in the scheduled
> backups (§1d). Do **not**
> create the schema by hand. The LR-77 "fails at the backup step" / "until LR-77 is fixed" notes in §1a-§1c,
> §4 and §6 describe the state before the fix.

Evidence base: `main` @ `9bb0418d` (this branch's parent), read on 2026-11-08, plus read-only GitHub
queries that list **names only** (no secret or variable value was printed or read):

| Query | Result (names) |
|---|---|
| `gh secret list` (repository) | none |
| `gh variable list` (repository) | `PRODUCTION_ADMIN_WEB_URL`, `PRODUCTION_API_BASE_URL`, `PRODUCTION_CORS_ALLOWED_ORIGINS`, `PRODUCTION_REALTIME_URL`, `STAGING_ADMIN_WEB_URL`, `STAGING_API_BASE_URL`, `STAGING_CORS_ALLOWED_ORIGINS`, `STAGING_REALTIME_URL` |
| `gh secret list --env staging` | `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` |
| `gh variable list --env staging` | `LIVEKIT_URL` |
| `gh secret list --env production` | `APNS_PRIVATE_KEY`, `BACKUP_ENCRYPTION_PASSPHRASE`, `DATABASE_URL`, `DIGITALOCEAN_ACCESS_TOKEN`, `FCM_SERVICE_ACCOUNT_JSON`, `GHCR_PULL_CREDENTIALS`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `REDIS_URL`, `RESET_CODE_HASH_SECRET`, `SENTRY_DSN`, `SMTP_URL`, `STORAGE_ACCESS_KEY`, `STORAGE_ADMIN_ACCESS_KEY`, `STORAGE_ADMIN_SECRET_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_SIGNING_SECRET` (19) |
| `gh variable list --env production` | `APNS_BUNDLE_ID`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `DATABASE_POOL_MAX`, `DATABASE_WORKER_POOL_MAX`, `FCM_PROJECT_ID`, `LAUNCH_PHASE`, `LIVEKIT_URL`, `RECOVERY_MAIL_FROM`, `STORAGE_BUCKET`, `STORAGE_ENDPOINT`, `STORAGE_REGION` (12) |
| `gh secret list --env backup` / `gh variable list --env backup` | none / none |
| `gh run list --workflow deploy-staging.yml --limit 5` | newest: 2026-11-05 `workflow_dispatch` **cancelled** (run 42095782131, 4m25s); the 4 before it: 2026-10-06 `push` **failure** (before the push trigger was removed) |
| `gh run list --workflow deploy-production.yml --limit 5` | **no runs ever** |
| `gh run list --workflow storage-versioning.yml` | 2026-11-06 **success** (42171637901); 2026-11-05 failure |
| `gh run list --workflow backup-daily.yml` / `backup-weekly.yml` | every recent run **failure** after ~10 s (2026-11-06, 07, 08; weekly 2026-11-08) |

**Supersedes** the GitHub state in `docs/infrastructure/production-readiness.md:90-96` (2026-11-05:
"`production` … holds nothing. There is no repository variable"). Both have changed since: the
eight repository URL variables exist, and `production` now holds every name its deploy requires.

### What could not be verified (and why)

- **UNVERIFIED: values.** By rule only names were listed. Whether a value is correct (for example
  `LAUNCH_PHASE=review`, `REDIS_URL=redis://redis:6379`, `DATABASE_URL` using the Supabase session
  pooler with `sslmode=require`, the storage keys being two different keys) is checked only by the
  deploy itself, in the steps before anything changes (`check-env.sh`, `app-spec.py resolve`, the
  credentials step).
- **UNVERIFIED: environment protection rules and the `backup` environment's existence.** The
  brief's `gh api …/environments/…` calls needed an interactive approval this session cannot give,
  so they were not run; the same name lists were taken with `gh secret list --env` /
  `gh variable list --env` instead. The `production` reviewer and `main`-only rule are therefore
  as recorded on 2026-11-05 (`production-readiness.md:136-139`), not re-checked. `--env backup`
  returned nothing, which means either "exists and empty" or "does not exist".
- **UNVERIFIED: whether an API image exists in GHCR for any commit.** The 2026-11-05 staging run was
  cancelled; viewing its jobs (`gh run view`) was outside the allowed commands. Assume no image
  exists until a `Deploy staging` build job has completed.
- **UNVERIFIED: the DigitalOcean side** (Supabase project region, the bucket, any app). No `doctl`
  or provider call was made. Last recorded state: `production-readiness.md:18-20, 94-96`.
- **UNVERIFIED: the tracker text of LR-05, LR-18, LR-19, LR-29, LR-43.** Only LR-01 ("production
  backend") and LR-05 ("review accounts") are defined in the repository
  (`docs/release/store-console/README.md:68`). The mapping of checklist items to the other IDs in §6
  is this report's inference from the lead's brief and must be checked against the tracker.

---

## 1. What a first deploy does, step by step

Both workflows are `workflow_dispatch` only, with a `first_deploy` boolean input
(`deploy-staging.yml:35-39`, `deploy-production.yml:36-40`).

### 1a. `Deploy staging` with `first_deploy = true` (`.github/workflows/deploy-staging.yml`)

Job **`build` — "Build and publish images"** (`:56`, no GitHub Environment, so no environment secrets):

1. "Resolve release identity" (`:65-76`): tag = this commit's SHA (or the `image_tag` input).
2. "Build and push API image" (`:86-97`): `ghcr.io/<repo>/api:<sha>` and `:staging`. **This is the
   image production later requires** (§1b step 3).
3. "Build and push Admin Web image" (`:107-147`): fails unless repository variables
   `STAGING_API_BASE_URL` (https origin, no path) and `STAGING_REALTIME_URL` are set (`:116-129`);
   builds the teacher web portal into it; tag `staging-<sha>`.

Job **`deploy` — "Deploy to staging"** (`:149-157`, GitHub Environment `staging`):

4. "The deploy credentials are present" (`:165-184`): **first, before anything changes.** Needs
   `DIGITALOCEAN_ACCESS_TOKEN` and `GHCR_PULL_CREDENTIALS`; with `first_deploy=true` it **refuses if
   `DIGITALOCEAN_APP_ID` is already set** (`:179`), otherwise requires it (`:181`).
5. "Install doctl" (`:186-187`).
6. "Validate the staging configuration and resolve the app spec" (`:189-325`):
   `scripts/infra/check-env.sh staging` (every `req` name in `infra/env/manifest.tsv`) and
   `app-spec.py resolve staging`, which also requires staging's `REDIS_URL` to be the in-app
   `redis://redis:6379` (`scripts/infra/app-spec.py:121, 451-454`).
7. "Preflight the database role capability" (`:327-334`): the BYPASSRLS probe, rolled back.
8. **Backup:** "Back up the database before migrating" (`:336-348`): encrypted `pg_dump` of `chat`;
   refuses without `BACKUP_ENCRYPTION_PASSPHRASE`. (Staging does not upload it as an artifact.)
   **On a never-migrated database this step FAILS and the run stops here** (Blocker LR-77, §1d).
9. **Migrations:** "Apply database migrations" (`:350-355`): `scripts/db/apply.sh`, every file in
   `supabase/migrations/` not yet in `chat.schema_migrations`, in filename order (§5).
10. "Load the pinned Quran text" (`:357-366`).
11. **"Release"** (`:368-379`) → `scripts/infra/do-release.sh staging`. With `FIRST_DEPLOY=true` and no
    app id it refuses if an app named `jawwid-chat-staging` already exists (`do-release.sh:60-64`),
    then runs `doctl apps create --spec … --wait` (`:66-69`, `--project-id` only if
    `DIGITALOCEAN_PROJECT_ID` is set, `:68`) and prints **"Save the app id"** as a run notice and in
    the run summary (`:71-77`). **This is where `DIGITALOCEAN_APP_ID` comes from: the owner copies it
    from the run summary into the Environment secret by hand. The workflow does not save it.** It then
    requires the ACTIVE deployment to run exactly the new tags (`:93-109`).
12. "Smoke test" (`:381-385`): `scripts/infra/smoke.sh $STAGING_API_BASE_URL --web $STAGING_ADMIN_WEB_URL`,
    one attempt, no retry (`smoke.sh:42-46`).
13. "Remove the resolved app spec" (`:387-389`, always).

**No storage check in staging.** The bucket versioning check exists only in production.

### 1b. `Deploy production` with `first_deploy = true` (`.github/workflows/deploy-production.yml`)

Inputs: `image_tag` (required, a SHA), `confirm` = `DEPLOY`, `first_deploy` (`:28-40`).

Job **`preflight`** (`:51`):
1. "Confirmation" (`:55-60`): `confirm` must be exactly `DEPLOY`.
2. "The tag must be an ancestor of main" (`:64-71`): searched within the last 200 commits of `main`.

Job **`build-admin-web`** (`:73`):
3. **"The API image for this commit exists"** (`:94-100`): refuses with "deploy this commit to
   staging first" unless `ghcr.io/<repo>/api:<image_tag>` exists. Production never builds the API.
4. "Build and push the Admin Web image" (`:109-142`): needs `PRODUCTION_API_BASE_URL` and
   `PRODUCTION_REALTIME_URL`; tag `production-<sha>`.

Job **`deploy`** (`:144-150`, GitHub Environment `production`, required reviewer as recorded):
5. "The deploy credentials are present" (`:156-182`): `DIGITALOCEAN_ACCESS_TOKEN`,
   `GHCR_PULL_CREDENTIALS`, **both** `STORAGE_ADMIN_ACCESS_KEY`/`STORAGE_ADMIN_SECRET_KEY`, and the
   admin key must differ from `STORAGE_ACCESS_KEY` (`:174-175`); `DIGITALOCEAN_APP_ID` must be
   **absent** for `first_deploy=true` (`:177`).
6. "Install doctl" (`:184-185`).
7. "Validate the production configuration and resolve the app spec" (`:187-324`): `check-env.sh
   production` plus `LAUNCH_PHASE` must be `review` or `launch` (`:198`; `app-spec.py:456-470`;
   under `review`, `REDIS_URL` must be `redis://redis:6379`, `:463`).
8. "Launch phase: managed Valkey is provisioned and locked down" (`:326-337`): **skipped** unless
   `LAUNCH_PHASE == 'launch'`.
9. **Storage check:** "Object storage keeps deleted objects for 30 days" (`:339-358`):
   `storage-versioning.sh verify` with the admin key; refuses unless versioning is Enabled and the
   lifecycle expires noncurrent versions after 30 days. (The "Object storage versioning" workflow
   succeeded on 2026-11-06, which is evidence it was applied; this step re-checks it.)
10. "Preflight the database role capability" (`:360-367`).
11. **Backup:** "Back up the database" (`:369-388`) and "Upload the pre-deployment backup" (`:390-395`,
    artifact `pre-deploy-backup-<run>`, 30 days). **On a never-migrated database "Back up the
    database" FAILS and the run stops here, before any migration** (Blocker LR-77, §1d).
12. **Migrations:** "Apply database migrations" (`:397-401`).
13. "Load the pinned Quran text" (`:403-412`).
14. **"Release"** (`:414-425`) → `do-release.sh production`: creates `jawwid-chat-production`, prints
    the app id to save (same as §1a step 11).
15. "Smoke test" (`:427-431`) against `PRODUCTION_API_BASE_URL` / `PRODUCTION_ADMIN_WEB_URL`.
16. "Record the release" (`:433-446`), "Remove the resolved app spec" (`:448-450`).

### 1c. The DNS step is not in either workflow

Neither workflow touches DNS. The app spec declares the hosts (`.do/app.production.yaml:22-28`,
`api` PRIMARY, `admin` ALIAS, TLS ≥ 1.2; same in `.do/app.staging.yaml:22-28`), and App Platform
issues certificates "once DNS resolves" (`production-readiness.md:49, 210-212`). The CNAME target is
the app's default ingress hostname, which **exists only after step 11/14 creates the app**.

**Today the first run never gets this far:** it stops at the backup step (§1d, Blocker LR-77). The
rest of this paragraph describes the first run **after LR-77 is fixed**.

**Consequence for the first run (inference, UNVERIFIED until it happens):** the first
`first_deploy=true` run creates the app, applies the migrations and releases, then its **smoke test
fails**, because `api.chat.jawwid.com` (or the staging host) does not resolve yet and `smoke.sh` does
not retry. A red first run after a successful "Release" step is the expected outcome, not a failed
deploy. The documented sequence (`production-readiness.md:207-213`) is: save the app id → add the
CNAMEs → wait for the certificate → start a new run (Actions → the workflow → Run workflow)
**without** `first_deploy`; that run's smoke test is the proof. The new run backs up again (the `chat`
schema exists by then), finds no new migration, and runs `doctl apps update`.

### 1d. Blocker LR-77: the first deploy fails at the backup step

**What happens.** Both workflows run `scripts/infra/backup-db.sh --out ./backups --schema chat`
(`deploy-staging.yml:348`, `deploy-production.yml:388`) **before** "Apply database migrations"
(`deploy-staging.yml:350-355`, `deploy-production.yml:397-401`). The `chat` schema is created only by
the migration runner itself: `scripts/db/apply.sh:24-30` (`create schema if not exists chat;`). On a
database that has never been migrated there is no `chat` schema when the backup runs, so:

1. `pg_dump --schema=chat` matches no schema and exits non-zero. PostgreSQL's documentation for
   `--strict-names` says: *"Note that if none of the extension/schema/table patterns find matches,
   pg_dump will generate an error even without `--strict-names`."*
   (<https://www.postgresql.org/docs/17/app-pgdump.html>, read 2026-11-08; the workflows run pg_dump
   from `postgres:17-alpine`, `deploy-staging.yml:347`, `deploy-production.yml:387`.) **Verified on
   the documentation:** that it is an error. **UNVERIFIED:** the exact message text (commonly "no
   matching schemas were found"); the documentation page does not quote it, and nothing was run here.
2. `backup-db.sh` runs pg_dump in a pipe under `set -euo pipefail` (`:27`); the failed pipe hits
   `dump_failed "pg_dump or encryption FAILED:"` (`:184-185`), which exits 1 (`:148-153`).
3. The step fails, so the job stops: **no migration, no Quran load, no app creation, no release.**
   Nothing is changed, but the first deploy cannot proceed. This applies to staging and production
   alike.

**What it needs: a code fix, not an owner workaround.** One of:
- `backup-db.sh` treats an absent target schema on a first deploy as "nothing to back up": it checks
  that the schema does not exist, logs that loudly (a workflow warning saying no backup was taken
  because the `chat` schema does not exist yet), and exits 0; any other pg_dump failure still fails
  the step. Or
- the workflows create the `chat` schema before the backup step (so the dump succeeds, nearly empty).

Either way it needs a test that fails today (a backup against a database without the schema). The
fix is in the deploy path, so **the lead classes LR-77 High risk (deployment protection): it needs
the owner's approval before it is implemented.** The owner must **not** create the `chat` schema by
hand to get past it.

**Update (2026-11-08): fixed (LR-77, PR #516).** The fix takes the first option and changes only
`scripts/infra/backup-db.sh`. Before dumping, the script asks the database whether the `chat`
schema exists, using the same client as the dump:
- **No `chat` schema, and `FIRST_DEPLOY` unset, empty or exactly `true`:** it prints a workflow
  warning ("Backup skipped") and `NO BACKUP TAKEN`, writes no file, and exits 0. The next step,
  "Upload the pre-deployment backup", then finds no file. That step only warns (`upload-artifact`'s
  default is `if-no-files-found: warn`), so the run goes on to the migrations.
- **No `chat` schema, and `FIRST_DEPLOY` anything else (e.g. `false`):** the step fails with an error
  saying the schema is missing on a deploy that is not a first deploy (wrong `DATABASE_URL`?).
- **`chat` exists, even if empty:** the backup runs exactly as before.
- **The database cannot be queried** (connection or password error): the step fails, as before.

The test is `test/scripts/backup_db_first_deploy_test.dart`, which uses fake clients and no
database.

**The workflow follow-up is merged (#518, `84a4e5d5`, 2026-11-08; #516 is `bc47d376`).** The backup
step now receives `FIRST_DEPLOY: ${{ inputs.first_deploy == true && 'true' || 'false' }}` in
`deploy-production.yml` and `deploy-staging.yml`, and `FIRST_DEPLOY: 'false'` in `backup-daily.yml`
and `backup-weekly.yml`. So only a run started with `first_deploy` ticked may skip the backup; every
other deploy, and every scheduled backup, fails at the backup step if the `chat` schema is missing
(details: `docs/infrastructure/backup-recovery.md` §3).

---

## 2. Requirements versus what exists

Legend: ✅ name present · ❌ missing · — not required in that environment · "default" means the
workflow supplies a value when unset. "Manifest" is `infra/env/manifest.tsv` (`req` = `check-env.sh`
refuses without it). Repository variables are visible to both environments.

### 2a. Hard requirements (the deploy refuses without them)

| Requirement | Where required (file:line) | Staging present? | Production present? | Owner action if missing |
|---|---|---|---|---|
| `DIGITALOCEAN_ACCESS_TOKEN` (secret) | staging `:170,176`; prod `:161,172`; `do-release.sh:41-42` | ❌ | ✅ | Staging: create a DO token (apps read/create/update; projects read if a project id is used) and add it (`production-readiness.md:141-144`) |
| `GHCR_PULL_CREDENTIALS` (secret, `user:token`, `read:packages`) | staging `:172,177`; prod `:163,173` | ❌ | ✅ | Staging: add (`production-readiness.md:145-148`) |
| `DIGITALOCEAN_APP_ID` (secret) — must be **absent** on the first run, **present** after | staging `:179,181`; prod `:177,179`; `do-release.sh:57-58, 79-84` | absent (correct for first run) | absent (correct for first run) | After the first run: copy the id from the run summary into that environment's secret |
| `STORAGE_ADMIN_ACCESS_KEY`, `STORAGE_ADMIN_SECRET_KEY` (secrets, ≠ app key) | prod `:167-168,174-175,356-357` | — | ✅ ✅ (distinctness UNVERIFIED; the step checks it) | — |
| `STAGING_API_BASE_URL`, `STAGING_REALTIME_URL` (repo vars) | staging `:110-111,116-129` | ✅ ✅ (repo) | — | — |
| `STAGING_ADMIN_WEB_URL`, `STAGING_CORS_ALLOWED_ORIGINS` (repo vars) | staging `:157,209,317`; manifest:41 | ✅ ✅ (repo) | — | — |
| `PRODUCTION_API_BASE_URL`, `PRODUCTION_REALTIME_URL` (repo vars) | prod `:112-124,318-319` | — | ✅ ✅ (repo) | — |
| `PRODUCTION_ADMIN_WEB_URL`, `PRODUCTION_CORS_ALLOWED_ORIGINS` (repo vars) | prod `:150,210,316`; manifest:41 | — | ✅ ✅ (repo) | — |
| API image `ghcr.io/<repo>/api:<sha>` | prod `:94-100` | built by staging `:86-97` | UNVERIFIED (assume none) | Run **Deploy staging**'s build job for the chosen SHA first (§4) |
| `LAUNCH_PHASE` (var, `review`/`launch`) | prod `:198`; `app-spec.py:456-458` | — | ✅ | — |
| `DATABASE_URL` (secret) | manifest:51; staging `:212,333,342,352`; prod `:213,366,382,399` | ❌ | ✅ | Staging: a separate staging database (never production's) |
| `BACKUP_ENCRYPTION_PASSPHRASE` (secret) | staging `:343`; prod `:383` | ❌ | ✅ | Staging: add; keep a copy outside GitHub (`production-readiness.md:149-152`) |
| `REDIS_URL` (secret; staging and prod-review must be `redis://redis:6379`) | manifest:64; staging `:219`; prod `:220`; `app-spec.py:121,463,764` | ❌ | ✅ (value UNVERIFIED) | Staging: add `redis://redis:6379` |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (secrets) | manifest:70-71; staging `:222-223`; prod `:223-224` | ❌ ❌ | ✅ ✅ | Staging: generate both |
| `RESET_CODE_HASH_SECRET` (secret) | manifest:81; staging `:224`; prod `:225` | ❌ | ✅ | Staging: generate |
| `STORAGE_ENDPOINT`, `STORAGE_BUCKET` (vars) | manifest:96,98; staging `:227,229`; prod `:228,230,353-354` | ❌ ❌ | ✅ ✅ | Staging: a separate staging bucket |
| `STORAGE_REGION` (var) | manifest:97; staging `:228` (default `auto`); prod `:229` (default) and `:355` (**no default** in the storage check) | default | ✅ | — |
| `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` (secrets) | manifest:99-100; staging `:230-231`; prod `:231-232` | ❌ ❌ | ✅ ✅ | Staging: a bucket-limited key for the staging bucket |
| `STORAGE_SIGNING_SECRET` (secret) | manifest:113; staging `:236`; prod `:237` | ❌ | ✅ | Staging: generate |
| `LIVEKIT_URL` (var or secret), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | manifest:188-190; staging `:266-268`; prod `:268-270` | ✅ ✅ ✅ | ✅ ✅ ✅ | — (confirm production's are not staging's LiveKit project: UNVERIFIED) |
| `DATABASE_POOL_MAX`, `DATABASE_WORKER_POOL_MAX` (vars) | manifest:62-63; staging `:217-218` (defaults 7/3); prod `:218-219` | default | ✅ ✅ | — (Supabase Free values 5/2, `production-readiness.md:26`) |
| `FCM_PROJECT_ID` (var), `FCM_SERVICE_ACCOUNT_JSON` (secret) | manifest:165-166 (prod `req`); prod `:256-257` | — (opt) | ✅ ✅ | — |
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID` (vars), `APNS_PRIVATE_KEY` (secret) | manifest:167-170 (prod `req`); prod `:258-261` | — (opt) | ✅ ✅ ✅ ✅ | — |
| `SENTRY_DSN` (secret) | manifest:282 (prod `req`); prod `:302` | — (opt) | ✅ | — |
| `SMTP_URL` (secret), `RECOVERY_MAIL_FROM` (var) | manifest:307-308 (prod `req`); prod `:278-279` | — (opt) | ✅ ✅ | — |
| Hard-coded by the workflow (`NODE_ENV`, `PORT`, `LOG_LEVEL`, `SHUTDOWN_GRACE_MS`, `DATABASE_STATEMENT_TIMEOUT_MS`, `QUEUE_PREFIX`, `JWT_*_TTL`, `STORAGE_SIGNED_URL_TTL_SECONDS`, `APNS_PRODUCTION`, `GIT_COMMIT`, `BUILD_VERSION`, `BUILD_TIME`) | staging `:198-311`; prod `:199-310` | set by workflow | set by workflow | — |
| `RECOVERY_DELIVERY_LOG` must be **absent** in production | manifest:322 (`forbid`) | — | ✅ absent | Never add it to production |

**Result:** production has every name its first deploy requires. Staging is missing 13 required
names (2 deploy credentials, the backup passphrase, and 10 application names), plus a staging database
and a staging bucket to point them at.

### 2b. Optional for the first deploy (unset = feature off; none present in either environment)

`TRUSTED_PROXY_HOPS` (**leave unset** for the first deploy; measured afterwards,
`production-runbook.md:131-183`; required before `LAUNCH_PHASE=launch`, `app-spec.py:473`),
`PROXY_HOPS_PROBE`, `DIGITALOCEAN_PROJECT_ID` (app lands in the default DO project if unset,
`do-release.sh:68`), `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` (no card payments; test keys are
refused in production, `check-env.sh:146-156`), `CORE_*`, `TEACHER_PAYOUT_KEYS`,
`LESSON_APPROVALS_SIGNING_KEY`, `WHATSAPP_*`, `MATERIALS_*`, `APNS_VOIP_ENABLED`, `STAGING_LESSONS_ORIGIN`,
`SUBSCRIPTION_LOCK_ENFORCED` (production defaults to `false`, `deploy-production.yml:295`),
`TEACHER_SUPERVISOR_STRICT_SCOPE`, `SALES_FAMILY_SCOPE`, OpenTelemetry and tuning variables.

### 2c. The `backup` environment (not part of the deploy, but blocks the daily backups)

| Requirement | Where required | `backup` present? | Owner action |
|---|---|---|---|
| `BACKUP_DATABASE_URL` (secret, read-only `jawwid_backup` role via the session pooler) | `backup-daily.yml:53,66`; `backup-weekly.yml:54,71`; `backup-recovery.md:225, 241-246` | ❌ | Create the role (`backup-recovery.md:206-213`) **after** the first deploy has created the `chat` schema, then add the secret |
| `BACKUP_ENCRYPTION_PASSPHRASE` (secret) | `backup-daily.yml:54,67`; `backup-weekly.yml:55,72` | ❌ | Add (same passphrase as production is the simplest to restore; owner's choice) |
| `BACKUP_SPACES_ACCESS_KEY`/`SECRET_KEY` (secrets), `BACKUP_BUCKET`, `BACKUP_SPACES_ENDPOINT`, `BACKUP_SPACES_REGION` (vars) | `backup-weekly.yml:56-57,79-83` | ❌ | Only with a backup bucket; during the review period disable `backup-weekly.yml` instead (`backup-recovery.md:256-258`) |

Both backup workflows have failed daily since 2026-11-06, consistent with this table.

---

## 3. DNS

The DNS for `jawwid.com` is at **Hostinger**; the deploy only **adds** two CNAME records per
environment and changes none of Core's records (`production-readiness.md:114-118`). The hosts come from
the repository variables (`production-readiness.md:122-131`; also `scripts/infra/production-setup.py:49-52`).

| Environment | Record type | Name (FQDN) | Host field at Hostinger (relative to `jawwid.com`) | Target |
|---|---|---|---|---|
| production | CNAME | `api.chat.jawwid.com` | `api.chat` | the production app's default ingress (`<…>.ondigitalocean.app`) |
| production | CNAME | `admin.chat.jawwid.com` | `admin.chat` | the same production default ingress |
| staging | CNAME | `api.chat-staging.jawwid.com` | `api.chat-staging` | the staging app's default ingress |
| staging | CNAME | `admin.chat-staging.jawwid.com` | `admin.chat-staging` | the same staging default ingress |

- **Target: UNVERIFIED until the app exists.** The docs say "the app's default ingress, which the
  DigitalOcean console shows" (`production-readiness.md:210-211`): DigitalOcean → Apps →
  `jawwid-chat-<env>` → Settings → Domains shows each domain's CNAME target. Copy it from there.
- **When: after the first deploy's "Release" step has created the app**, and before the normal
  (second) run. The target does not exist earlier. Save the app id in the same sitting.
- The "Host field" column assumes Hostinger's usual relative-name form; if its form wants the full
  name, enter the FQDN instead.
- **UNVERIFIED:** whether `jawwid.com` has a CAA record that would stop App Platform's certificate
  issuance (no DNS query was in the allowed commands). Check it in Hostinger's DNS zone list.
- The spec raises a `DOMAIN_FAILED` alert while a domain does not resolve (`.do/app.production.yaml:16-18`);
  expect it between the first run and the CNAMEs.

---

## 4. Staging first or production first

Today: staging holds only `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (§2a); production holds
every required name. **The owner decides; both are described.** Both options are blocked until LR-77
(§1d) is fixed: the first `first_deploy=true` run of either workflow stops at the backup step today.

Wherever a SHA is asked for below, use **the full 40-character commit SHA**, never the 7-character
short form: copy it from the commit's page on GitHub (the copy button next to the short SHA copies the
full one), from the workflow run's page ("Commit" link → its page); it must be the commit the staging run built (the production workflow passes it straight to `git merge-base` and to the image tag,
`deploy-production.yml:68`, `:98`; an image tagged with the full SHA is not found under a short one; the staging build tags the image with the full `GITHUB_SHA`,
`deploy-staging.yml:72`).

### Option A: staging first (the documented path)

The runbook expects it: "Production cannot be created before staging"
(`production-readiness.md:45`), "Prerequisites: … it has been running on staging"
(`production-runbook.md:13-14`), restore drill into staging before production
(`production-readiness.md:58, 246`).

Minimal owner steps:
1. Provision a **separate** staging database (e.g. a second Supabase Free project in Frankfurt, hardened
   like production, `production-readiness.md:24-28`) and a **separate** staging Spaces bucket with a
   bucket-limited key. Reusing production's would mix test data into production.
2. Add to the `staging` Environment: secrets `DIGITALOCEAN_ACCESS_TOKEN`, `GHCR_PULL_CREDENTIALS`,
   `BACKUP_ENCRYPTION_PASSPHRASE`, `DATABASE_URL`, `REDIS_URL` (= `redis://redis:6379`),
   `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `RESET_CODE_HASH_SECRET`, `STORAGE_ACCESS_KEY`,
   `STORAGE_SECRET_KEY`, `STORAGE_SIGNING_SECRET`; variables `STORAGE_ENDPOINT`, `STORAGE_BUCKET`
   (optionally `STORAGE_REGION`).
3. Deploy staging `first_deploy=true`. This **also starts a paid App Platform app** (about $27/month,
   see the risk line below) and applies the forward-only migrations to the staging database, which
   cannot be undone (staging holds no real data). → save the staging app id → two staging CNAMEs → start a new run
   (Actions → Deploy staging → Run workflow) with `first_deploy` unticked.
4. Then production (Option B steps 2-5) with the full 40-character SHA staging ran.

Risk: more owner work (a second database, bucket, key and 11 secrets) and about **$27/month more**
while it runs (`production-readiness.md:33`). Benefit: the first-ever migration run, App Platform
creation, DNS and certificates are exercised where a mistake costs nothing, and the restore drill
(G-41) has a target.

### Option B: production first (possible today, deviates from the runbook)

It works because the production workflow needs only the **API image**, which the staging workflow's
`build` job publishes without touching the `staging` Environment (`deploy-staging.yml:56-147`). That
run's `deploy` job then stops at "The deploy credentials are present" (`:165-184`) with "Nothing was
changed", because staging has no `DIGITALOCEAN_ACCESS_TOKEN`.

Minimal owner steps:
1. Actions → **Deploy staging** → Run workflow on `main` (`image_tag` blank, `first_deploy` off). Wait
   for **Build and publish images** to succeed; the **Deploy to staging** job is expected to fail at
   its first step and change nothing. Copy the full 40-character commit SHA of that run.
2. Actions → **Deploy production** → `image_tag` = that full SHA, `confirm` = `DEPLOY`,
   `first_deploy` = ✔. Approve the `production` environment when prompted. (Paid, irreversible: see
   §6 item 7.)
3. Copy the app id from the run summary ("First deploy of jawwid-chat-production") → Settings →
   Environments → `production` → Add secret `DIGITALOCEAN_APP_ID`.
4. Add the two production CNAMEs (§3), wait until App Platform shows the domains as active.
5. Start a new run (Actions → **Deploy production** → Run workflow) with the same full SHA,
   `first_deploy` unticked. Green smoke test = done.

Risk: the first-ever run of 177 migrations, the BYPASSRLS grant, the app creation and the DNS/TLS
issuance all happen first on the production project. Mitigations already in place: the review period
has **no real users** and the store builds stay on manual release (`production-readiness.md:31`); the
database is empty, so a failed migration can be cleared by deleting and recreating the Supabase
project (a DELETE: confirm first in Supabase → Table Editor / SQL editor that it holds no data); the
pre-deploy backup and the forward-only rollback (`production-runbook.md:195-218`, `production-readiness.md:58`) apply. What it skips:
the staging restore drill before production (`production-readiness.md:58`) and the "it has been running
on staging" prerequisite, which the owner would be waiving for the first deploy. The recurring
deliberately red **Deploy staging** run is also a signal people must learn to read.

### Recommendation (for the owner to decide)

**Option B, production first**, while `LAUNCH_PHASE=review` and the database is empty: everything it
needs already exists, the blast radius is an empty review-period project, and staging can follow
before launch for the restore drill and multi-instance tests. Choose **Option A** if the owner wants
the runbook's order kept exactly, or if the production Supabase project already holds data that must
not be at risk (UNVERIFIED; it was empty on 2026-11-05).

---

## 5. Migrations a first deploy applies

`scripts/db/apply.sh` applies, in filename order, every `supabase/migrations/*.sql` whose version is
not in `chat.schema_migrations` (`apply.sh:19-58`). On a never-migrated database that is **all of them:
177 files** on `main` @ `9bb0418d` (`production-readiness.md:58` says 159; that count is stale).

The newest 10:

1. `20261102270000_chat_pd046_lesson_create_key.sql`
2. `20261104100000_chat_pd057_moderation.sql`
3. `20261106100000_chat_pd027_lesson_package_link.sql`
4. `20261106130000_chat_pd057_report_effects.sql`
5. `20261106140000_chat_pd057_block_notices.sql`
6. `20261106150000_chat_pd057_report_escalation.sql`
7. `20261106160000_chat_pd030_lock_lesson_instalments.sql`
8. `20261106170000_chat_pd030_d3_push_wording.sql`
9. `20261107110000_chat_pd058_terms.sql`
10. `20261107120000_chat_pd027_stripe_lifecycle.sql`

Open PRs add more (as given in the brief; not re-read here): **#497** (`20261107130000`), **#498**
(`20261107140000`), **#449** (`20261107150000`). Whichever of them is merged before the deploy SHA is
chosen is in the first deploy; the rest arrive with a later deploy. `20260910120200_chat_connection_roles.sql`
grants BYPASSRLS (`deploy-production.yml:361-364`); the preflight step checks that the provider allows it
before any migration runs.

---

## 6. Owner checklist for the first deploy

Production-first order (Option B). For Option A, do items 1-2 for staging first (§4 Option A). Each item
names the tracker ID it unblocks; IDs other than LR-01 and LR-05 are this report's inference (see
"What could not be verified").

1. **Decide staging-first or production-first** (§4), and **approve or decline the LR-77 fix** (§1d;
   High risk, deployment protection). No first deploy can succeed until it is merged. Unblocks: LR-01.
2. **Confirm the production values are right before the run** (names are present; values cannot be read
   by anyone in GitHub): `LAUNCH_PHASE` = `review`; `REDIS_URL` = `redis://redis:6379`; `DATABASE_URL`
   is the **Frankfurt** Supabase project's session pooler (`aws-0-eu-central-1.pooler.supabase.com`,
   port 5432, `sslmode=require`), recreated there if it is still the Ireland one
   (`production-readiness.md:18-20, 27`) — recreating means **deleting** the Ireland project, so first
   confirm in Supabase (Table Editor / SQL editor) that it is empty; the role has `statement_timeout = '15s'` (`:28`); the
   Supabase hardening is done (`:24`); the storage admin key is a different key from the app key; the
   LiveKit values are production's, not staging's. Unblocks: LR-01, LR-19.
3. **Keep the backup passphrase outside GitHub** (password manager), the one in `production`'s
   `BACKUP_ENCRYPTION_PASSPHRASE`. Unblocks: LR-01, LR-29.
4. **Leave `TRUSTED_PROXY_HOPS` unset** for the first deploy. Unblocks: LR-01 (LR-43 is item 11).
5. **Optional:** DigitalOcean → the project → copy its id → GitHub → Settings → Secrets and variables
   → Actions → Variables → `DIGITALOCEAN_PROJECT_ID`. Without it the app lands in the default project.
   Unblocks: LR-01.
6. **Build the API image:** Actions → **Deploy staging** → Run workflow → branch `main`, `image_tag`
   blank, `first_deploy` unticked → Run. Wait for "Build and publish images" to go green (the
   "Deploy to staging" job then fails at its first step and changes nothing). Copy **the full
   40-character commit SHA**: open the run → click the commit link → on the commit page use the copy
   button next to the short SHA (it copies all 40 characters). Use the SHA of **that staging run**,
   not simply the newest commit on `main`: if anything merged after the run, the newest commit has no
   image and production stops at "The API image for this commit exists". The 7-character short SHA
   does not work. Unblocks: LR-01.
7. **First production run.** The LR-77 fix (#516, #518) is merged; with `first_deploy` ticked, "Back
   up the database" skips with a "Backup skipped" warning and the run continues to the migrations.
   **What this run does — read before starting it:**
   - It **starts a paid DigitalOcean App Platform app**, `jawwid-chat-production`: about **$32/month**
     before tax for the review period (API $12 + worker $5 + Admin Web $5 + in-app Redis $5 + Spaces
     $5, `production-readiness.md:33`).
   - It **applies 177 forward-only migrations** to the production database (§5). They cannot be
     undone; there is no `down` mechanism (`production-runbook.md:204-209`; "Treat every production migration
     as one-way", `production-readiness.md:58`).
   - **If a step after "Apply database migrations" fails, the database stays changed** (whatever
     migrations ran remain applied) even though nothing was released.

   Steps: Actions → **Deploy production** → Run workflow → `image_tag` = the full 40-character SHA from
   item 6, `confirm` = `DEPLOY`, `first_deploy` ticked → Run → approve `production` when asked.
   Expect: every step green up to and including **Release**; **Smoke test** red (no DNS yet). If a step
   before "Apply database migrations" fails, nothing was changed; read the step's error. Unblocks: LR-01.
8. **Save the app id:** open that run's summary ("First deploy of jawwid-chat-production") → copy the
   id → Settings → Environments → `production` → Add secret → `DIGITALOCEAN_APP_ID`. Every later run
   refuses without it. Unblocks: LR-01.

   **Recovery if "Release" failed after the app was created** (for example the run failed while
   waiting for the deployment to become active, so no "Save the app id" summary was written): open
   DigitalOcean → **Apps** → `jawwid-chat-production` → copy the app id (the UUID in the page address,
   `cloud.digitalocean.com/apps/<app id>`, or under Settings) → save it as the `production`
   Environment secret `DIGITALOCEAN_APP_ID`. Then start a new run (Actions → **Deploy production** →
   Run workflow) with the same full SHA and `first_deploy` **unticked**. Do not tick `first_deploy`
   again: the release refuses to create a second app of that name (`do-release.sh:60-64`).
   **If no app named `jawwid-chat-production` exists** (the create step failed before creating
   anything), there is no id to save: start a new run with `first_deploy` **ticked** again.
9. **DNS at Hostinger:** DigitalOcean → Apps → `jawwid-chat-production` → Settings → Domains → copy the
   CNAME target. Hostinger → Domains → `jawwid.com` → DNS / Nameservers → Add record: CNAME
   `api.chat` → target; CNAME `admin.chat` → target. Change no other record. Wait until DigitalOcean
   shows both domains active (certificate issued). Unblocks: LR-01, LR-18.
10. **Second production run:** start a new run (Actions → **Deploy production** → Run workflow; not
    "Re-run jobs" on the first run, which would repeat `first_deploy`) → the same full 40-character
    SHA, `confirm` = `DEPLOY`, `first_deploy` **unticked** → approve. Green **Smoke test** = LR-01's backend is live at
    `https://api.chat.jawwid.com` (the account-deletion page then exists at `/account-deletion`,
    `production-readiness.md:74`). Unblocks: LR-01, LR-05 (review accounts can only be created on a
    live backend, `store-console/play-declarations.md:34`).
11. **Measure `TRUSTED_PROXY_HOPS`** per `production-runbook.md:131-183` (probe secret, `send`,
    `interpret`, set the variable, delete the probe secret, redeploy). Unblocks: LR-43.
12. **Turn on the daily backup:** after item 10 (the `chat` schema now exists), create the read-only
    `jawwid_backup` role on the production database as in `backup-recovery.md:206-213`; Settings →
    Environments → `backup` (create it if missing; no required reviewers, deployments limited to
    `main`, `backup-weekly.yml:21`) → secrets `BACKUP_DATABASE_URL` (session pooler,
    `jawwid_backup.<project-ref>`, `sslmode=require`) and `BACKUP_ENCRYPTION_PASSPHRASE`. Disable
    **Weekly database backup** in the Actions tab until a backup bucket exists
    (`backup-recovery.md:256-258`). Run **Daily database backup** once by hand. Unblocks: LR-19, LR-29.
13. **Staging, before launch** (if Option B was chosen): §4 Option A steps 1-3, then the restore drill
    into staging (`production-readiness.md:58, 246`). Unblocks: LR-29.

LR-29's monitoring part (uptime check on `/health/ready`, alert e-mail, the on-call person of OA-19,
proposed component alerts) is in `docs/infrastructure/monitoring.md` §7; its steps come after the
first production deploy and do not block it.

Until LR-77 is fixed and items 7-10 are done, LR-01 stays open. Nothing in this list changes Core, Core's DNS records or
any protected project.
