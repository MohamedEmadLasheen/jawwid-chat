# Production Readiness: the Phase 1 checklist

Owner: release-qa, refreshed 2026-11-05 against `main` @ `c4563a20` and against the live DigitalOcean and GitHub state (read-only: `doctl apps list`, `doctl databases list`, `doctl spaces keys list`, `gh api …/environments`). Launch sizes and the staging Redis are ADR-013.

**Phase 1** means the system app is submitted to the App Store and Google Play, against a production backend on DigitalOcean App Platform (ADR-010, ADR-012). Materials are frozen and are not part of it.

Status: 🔴 **NOT READY.** Two different kinds of work remain, and they close separately:

- **The owner's accounts and keys.** The deploy path is code-complete, but there is nothing to deploy to. This is most of the backend list below.
- **Mobile store work.** Most of it is now built (account deletion, the privacy manifest, release signing, app crash reporting, Android push in review). What remains is the call ring with the app closed (S-06), owner credentials, and devices. The gates are S-01..S-08 in `docs/qa/release-gate.md` §2a, which is the source of truth for them. The phone-side test plan is `docs/qa/submission-device-test-plan.md`.

## 0. The review period: database on Supabase Free (ADR-014)

Until launch, the production database is a dedicated **Supabase Free** project
(its own organisation, Frankfurt, never Core's). Everything else is unchanged:
the API, worker, Admin Web, a private in-app Redis (ADR-015) and Spaces run on DigitalOcean, from
the **production** pipeline, so the approved store builds never need a rebuild.
Status on 2026-11-05: a project exists and the BYPASSRLS preflight passed on it
through the session pooler, but it was created in West EU (Ireland), not
Frankfurt, so it is to be recreated in Frankfurt while still empty.

| Requirement | How |
|---|---|
| Hardening | Data API off, `pg_graphql` off, Auth sign-ups off, SSL enforced; `chat` never an exposed schema. |
| Connections | Session pooler only (port 5432, `<role>.<project-ref>`, `sslmode=require`) for the app, migrations and backups. |
| Pool sizes | `production` Environment variables `DATABASE_POOL_MAX=5`, `DATABASE_WORKER_POOL_MAX=2`; remove both at the cutover. |
| Region | Central EU (Frankfurt): the session pooler host is `aws-0-eu-central-1.pooler.supabase.com`. A project created elsewhere is recreated in Frankfurt while it is still empty. |
| Statement timeout | The pooler drops the connection's `options` (measured: `2min` instead of `15s`), so set it on the role once: `alter role postgres set statement_timeout = '15s';`. `apply.sh` exempts migrations (`set local statement_timeout = 0`). Remove the role setting at the cutover. |
| Backups | `backup-daily.yml` + a weekly copy outside GitHub + a monthly drill (`backup-recovery.md` §3c). |
| Pausing | The worker queries continuously while it runs; `backup-daily.yml` reads every table daily. Check the dashboard before every submission. |
| No real users | Store builds on manual release (App Store Connect) and managed publishing (Google Play) until the cutover. |
| Redis | `LAUNCH_PHASE=review` (production Environment variable): the private in-app `redis` component, `REDIS_URL=redis://redis:6379`. The resolver refuses anything else in review, and at `launch` drops the component and requires managed Valkey, verified before any change (ADR-015). |
| Monthly cost (review period) | DigitalOcean: API $12 + worker $5 + Admin Web $5 + in-app Redis $5 + Spaces $5 = **$32**, before tax. Supabase Free $0. A staging app is not included (about $27 more if it runs). Not yet created: managed Valkey ($15), DigitalOcean Postgres ($15.15). |
| Cutover at launch | Rehearse once; then stop the API and worker, take a final `backup-db.sh`, run the DigitalOcean preflight, `restore-db.sh` into the DigitalOcean cluster, replace `DATABASE_URL`, remove the pool overrides; provision managed Valkey and switch to `LAUNCH_PHASE=launch` (`production-runbook.md` §1c); deploy, smoke test. Only then make the store release public. About 15–30 minutes. |

**Filling the GitHub configuration.** `python3 -I scripts/infra/production-setup.py status` lists every value the production deploy reads, whether it is set, and who provides it. `fixed` sets the values the repository already knows (hostnames, `LAUNCH_PHASE=review`, pool sizes, storage endpoint, APNs bundle and team, the review-period `REDIS_URL`), `generate` creates the four random app secrets without anyone seeing them, and `ask` / `file` take the owner's own secrets through gh's hidden prompt or from a file. It never prints a secret.

Legend for the **Code** column: ✅ built and tested · 🟡 partly built · ❌ not built.
Legend for the **Owner provides** column: the account, key or decision only the owner can supply. "—" means nothing is needed.

## 1. Backend

| Item | Code | What exists | Owner provides |
|---|---|---|---|
| **App Platform app (production)** | ✅ | `.do/app.production.yaml`, generated from `infra/env/manifest.tsv` by `scripts/infra/app-spec.py` and checked in CI (`app-spec` guard). Region `fra`. Components: `api` (`node dist/main.js`, 1 vCPU/1 GB, health `/health/ready` + `/health/live`), `worker` (same image, `node dist/worker.js`, 0.5 GB), `admin-web` (nginx, 0.5 GB). Launch sizes per ADR-013; when to raise one is `production-runbook.md` §1b. Production cannot be created before staging: the production workflow refuses an API image staging has not built. Release: `.github/workflows/deploy-production.yml` → `scripts/infra/do-release.sh`. Its order: preflight → Admin Web build → credentials → `check-env.sh` → bucket versioning check → database role preflight → encrypted `pg_dump` → migrations → `doctl` release → smoke test. | A DigitalOcean account and project. GitHub Environment `production`, with required reviewers and deploys limited to `main`. `DIGITALOCEAN_ACCESS_TOKEN`, `GHCR_PULL_CREDENTIALS`, then `DIGITALOCEAN_APP_ID` after `first_deploy`. Optionally `DIGITALOCEAN_PROJECT_ID`. Steps 1, 4, 5 and 9 below. |
| **Managed Postgres 17, backups, PITR** | 🟡 | The spec has deliberately no `databases:` block: the database arrives as the secret `DATABASE_URL`, and `check-env.sh` refuses `sslmode=disable`. The migration grants BYPASSRLS, so `scripts/db/preflight-role-capability.sh` must pass on the provider before the provider is chosen; the deploy re-runs it. Portable encrypted backup: `scripts/infra/backup-db.sh` / `restore-db.sh` (AES-256 + HMAC). It runs **before every deploy** and is kept 30 days as a workflow artifact, and it is drilled in CI (G-41). **A weekly scheduled backup now exists**: `backup-weekly.yml` (Sundays) dumps, encrypts and stores the copy in Spaces for 8 weeks (`backup-recovery.md` §3b), and the CI guard `backup-offsite` holds its upload and retention contract. DigitalOcean's daily backups and 7-day PITR are the first line. | The managed cluster (the "Jawwid Chat" project already holds one: verify it is PG 17 and run the preflight). Turn on and confirm the provider's daily backups and point-in-time recovery. DigitalOcean documents PITR for the last 7 days on managed Postgres; record the actual window. `BACKUP_ENCRYPTION_PASSPHRASE`, with a copy kept outside GitHub. Set up the `backup` GitHub Environment, the read-only `jawwid_backup` role and a key limited to a dedicated backup bucket (`backup-recovery.md` §3b), run `backup-weekly.yml` once by hand, then the §5a drill from that copy. |
| **Redis** | ✅ | `REDIS_URL` + `QUEUE_PREFIX`. Used by realtime (`communication/realtime/redis.provider.ts`, the Socket.IO adapter), presence, typing and rate limiters. Nothing durable lives in it: the outbox is in Postgres (`architecture.md`), so AOF is not required; `noeviction` is recommended; Redis ≥ 6.2 is required (`production-runbook.md` §1a). **Staging** runs it as a private in-app component (`redis`, Valkey 8.1, `REDIS_URL=redis://redis:6379`, ADR-013). **Production** runs the same in-app component during the review period only (`LAUNCH_PHASE=review`), and managed Valkey from `LAUNCH_PHASE=launch`, which the deploy verifies before changing anything (ADR-015, `production-runbook.md` §1c). Multi-instance realtime is unproven (RISK-4), so production runs **one** API instance until it is proven. | Review period: the variable `LAUNCH_PHASE=review`. At launch: a managed Valkey 1 GiB cluster in `fra1`, Trusted Sources limited to the app, eviction policy `noeviction`, a token with database read access, then `LAUNCH_PHASE=launch`. Staging: nothing. |
| **Object storage (Spaces)** | ✅ | The S3 adapter `communication/attachments/s3-object-storage.ts`; a partial configuration refuses to boot. `scripts/infra/storage-versioning.sh` turns on versioning, 30-day expiry of old versions and 1-day abandoned uploads. The production deploy verifies them and refuses to release without them. Spaces only (R2 has no versioning). | A private bucket in `fra1`, created **before** anything is uploaded, plus two Spaces keys: the app's, limited to the bucket, and a separate admin key (`STORAGE_ADMIN_*`, deploy check only) with `GetBucketVersioning` / `GetLifecycleConfiguration`. `STORAGE_*` values and `STORAGE_SIGNING_SECRET`. Run `storage-versioning.sh apply`, then `--verify-expiry` (step 7). |
| **Domains and TLS** | ✅ | The spec names `${API_DOMAIN}` (primary) and `${ADMIN_WEB_DOMAIN}` (alias), minimum TLS 1.2. App Platform issues the certificates once DNS resolves. The store apps must use this HTTPS origin, never a local one (the local test stack's CA does not apply). | The domain and DNS CNAMEs. The variables `PRODUCTION_API_BASE_URL`, `PRODUCTION_REALTIME_URL`, `PRODUCTION_ADMIN_WEB_URL`, `PRODUCTION_CORS_ALLOWED_ORIGINS`, `TRUSTED_PROXY_HOPS` (step 3). |
| **Secrets** | ✅ | Every value is in `infra/env/manifest.tsv` (marked secret or variable, and required, optional or forbidden per environment), templated in `infra/env/production.env.example`, inventoried in `secrets.md` §2 and judged by `scripts/infra/check-env.sh`. That script rejects placeholders, wildcard CORS, sandbox APNs, `NODE_ENV≠production` and TLS-off database URLs. CI scans the full git history for secrets. | Production requires: `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `RESET_CODE_HASH_SECRET`, the storage keys and `STORAGE_SIGNING_SECRET`, `APNS_PRIVATE_KEY`, `FCM_SERVICE_ACCOUNT_JSON`, `LIVEKIT_API_KEY`/`SECRET`, `SENTRY_DSN`, `SMTP_URL`. Optional: `STRIPE_*`, `TEACHER_PAYOUT_KEYS`, `LESSON_APPROVALS_SIGNING_KEY`, `WHATSAPP_ACCESS_TOKEN`, and the `CORE_*` group (ADR-013). |
| **APNs (iOS push)** | 🟡 | Server: `notifications/apns.provider.ts`, selected by `push.provider.selector.ts`. The deploy hard-codes `APNS_PRODUCTION=true`, and `check-env.sh` forbids anything else. Without a key it falls back to logging, which is what the local test stack runs: no push is delivered there, recorded as the LAUNCH BLOCKER on rows D-14/D-17b. VoIP (call ring with the app closed) is gated by `APNS_VOIP_ENABLED`: in the manifest (optional, default off), the app spec and both deploy workflows. Turn it on in staging first, once the iOS CallKit build is proven on a device (S-06). | An Apple **APNs auth key (.p8)** from the paid developer team: `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_PRIVATE_KEY`. The bundle id must match the store app. |
| **FCM (Android push)** | 🟡 | Server: `notifications/fcm.provider.ts` (data-only, high priority) and call routing in `call-push-routing.ts` (Android receives every kind). App: built natively (#408, merged; #449 open), and a release build refuses to start without `android/app/google-services.json`, which does not exist yet (S-05 in the gate). | A Firebase project with the Android app registered (`com.jawwid.jawwid_chat`, or the final id). `FCM_PROJECT_ID`, `FCM_SERVICE_ACCOUNT_JSON`, and the `google-services.json` for the build. |
| **LiveKit (calls)** | ✅ | `communication/calls/media-token.ts` (microphone only, 120 s TTL from `chat.config`) and `media-room-control.ts`. `.github/workflows/livekit-probe.yml` verifies an environment's credentials. Only the staging LiveKit exists. After provisioning, run `rt037-media-revocation.spec.ts` §G against it (`LIVEKIT_REAL_URL`) to close gate G-06. | A LiveKit Cloud project, or a self-hosted server with TURN. `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` in the `production` Environment. |
| **Stripe (live)** | ✅ | `billing/stripe.gateway.ts`, `stripe-webhook.controller.ts`, `checkout.service.ts`. Unset means card payments are off and the webhook answers 503. The endpoint and its events are in `docs/admin/pd027-payments.md`. Card refunds reach Stripe once per refund id (#358). **There is no check that refuses a `sk_test_` key in production**; worth a `check-env.sh` rule. | Chat's Stripe account, a **restricted live key** (Checkout Sessions write, Refunds write), `STRIPE_SECRET_KEY`, the live webhook's `STRIPE_WEBHOOK_SECRET`, and `PAYMENT_LINK_BASE_URL`. |
| **E-mail (SMTP)** | ✅ | `account-recovery/recovery-delivery.ts` (nodemailer). It carries first-login and reset codes for staff and teachers (PD-40/43) and parents' recovery (PD-25). `SMTP_URL` + `RECOVERY_MAIL_FROM` are **required**; the deploy refuses without them. | An SMTP provider and a sending domain with SPF and DKIM. |
| **Error tracking (Sentry)** | 🟡 | API and worker: `infra/observability/sentry-error-tracker.ts` behind a privacy allowlist (`monitoring.md` §3a). `SENTRY_DSN` is required in production. Flutter app: built (`lib/core/crash/crash_reporting.dart`, S-07); `build-store.sh` passes the app DSN. | A Sentry organisation, a project per component, and the DSNs. |
| **Monitoring and alerts** | ❌ | Code: structured JSON logs with redaction, and `/health/live` + `/health/ready`. The spec provisions only App Platform's `DEPLOYMENT_FAILED` and `DOMAIN_FAILED` alerts. `monitoring.md` §5's alert table is "a target, not a running system". No uptime check, metrics, dashboards or OpenTelemetry. | At minimum, for Phase 1: an external uptime check on `/health/ready`; App Platform CPU, memory and restart alerts; Sentry alert rules; database storage and connection alerts. Someone to receive them (on-call, runbook §9 "not yet defined"). |
| **Rollback runbook** | ✅ | `production-runbook.md` §3: **forward-only by design.** Roll back the application by redeploying the previous sha; roll back data by restoring the pre-deploy encrypted backup; roll back config by reverting the variable. §3a restores an object from a bucket version. There are 23 hand-written `db/rollback/*.down.sql` scripts, for 159 migrations, none run in CI. Most migrations are not reversible by script. Treat every production migration as one-way, and keep the pre-deploy backup as the way back (gate G-19). | Decide the RPO/RTO (proposed: ≤ 5 min / ≤ 2 h, `backup-recovery.md` §6) and do one restore drill into staging before the first production deploy. |
| **Core integration** | 🟡 | Signed inbound webhook only (`apps/api/src/core-boundary`); with no secret it answers 503. No Chat code calls Core, and Chat never touches Core's database. Phase 1 does not need Core to feed Chat, so the `CORE_*` group is optional in production (ADR-013). | Nothing for Phase 1. Connecting Core later is a deliberate step, coordinated with the Core team (`secrets.md`). |

## 2. Mobile store builds

These are the code-side half of Phase 1. Gate ids refer to `docs/qa/release-gate.md` §2a.

The verdicts below are copied from the gate on 2026-11-05; the gate wins if they differ.

| Item | Code | State on `main` | Owner provides |
|---|---|---|---|
| iOS release signing and push entitlement (S-03) | ✅ config | Release uses `Runner/RunnerRelease.entitlements` (`aps-environment = production`), team `KX683HAR3Y`. Never yet signed with a distribution certificate. The bundle id is `com.jawwid.jawwidChat`. | The paid team's distribution certificate and App Store profile, and the App Store Connect app record. |
| iOS Background Modes / CallKit / PushKit (S-06) | 🟡 | `CallKitBridge.swift` and the PushKit registry exist, but they never ran on a device and `APNS_VOIP_ENABLED` is off. | — |
| iOS privacy manifest (S-02) | ✅ | `ios/Runner/PrivacyInfo.xcprivacy`. | The App Privacy answers in App Store Connect. |
| Android release signing and AAB (S-04) | ✅ | A release artefact is refused without `android/key.properties`; it is never signed with the debug key. The `applicationId` is `com.jawwid.jawwid_chat`, which differs from the iOS id; decide before the first upload, because it cannot change afterwards. | An upload keystore, kept outside the repo, enrolled in Play App Signing. The Play Console app record. |
| Android push and call UI (S-05, S-06) | 🟡 | FCM client built (#408); real delivery blocked on Firebase and a device. No closed-app call UI yet. | `google-services.json` (see FCM). |
| Account deletion (S-01) | ✅, one risk | In-app (`POST /me/account/delete`) and the public web page Google Play needs (`GET/POST /account-deletion`, PD-56). Risk: a teacher with open lessons or payroll is told to contact the academy, which Apple may reject (gate O-3). | Decision O-3. The page goes live at `https://api.chat.jawwid.com/account-deletion` with the first production deploy. |
| App crash reporting (S-07) | ✅ code | `lib/core/crash/crash_reporting.dart`, release only, scrubbed. | A Sentry DSN for the app. |
| Release API address | ✅ | `scripts/mobile/build-store.sh` compiles `API_BASE_URL` in (https, ending `/api/v1`, no default); a release build without it stops at startup (`lib/app/bootstrap.dart`). The LiveKit URL comes from the server's token response. | Production: `https://api.chat.jawwid.com/api/v1`. |
| Store listings | — | Not code. | Names, screenshots, privacy policy URL, support URL, age rating, review account(s) for Apple and Google. |

## 3. What is ready today (no owner action needed)

- **Repository and CI.** 8 CI jobs on every push and PR, including Flutter (`mobile`). The last completed run on main, https://github.com/MohamedEmadLasheen/jawwid-chat/actions/runs/41471455277 on `0d1a1f50`, passed all 8.
- **Containers.** The images build and run unprivileged (`uid=1000`). The `images` job checks the security headers.
- **Database.** The migrations apply from empty and re-apply as a no-op (CI `migrations`). The encrypted backup/restore drill runs in CI (G-41).
- **Behaviour.** Final acceptance, 512 rows: 415 PASS, 0 open P1. The local system-test stack (`main`, a release build on a physical iPhone) has run every chat, call, lesson, payment and whiteboard flow except push.

## Owner steps that remain

Everything the repository can do is done. The rest needs accounts, money or
DNS, so it is the owner's. In this order — each step names what it unblocks.
Re-verified on 2026-11-05. In GitHub, the `staging` Environment holds only
`LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`. The `production`
Environment exists (created 2026-10-31, required reviewer, deployments limited
to `main`) and holds nothing. There is no repository variable. On
DigitalOcean, the "Jawwid Chat" project (tagged Development) holds only one
Postgres 17 cluster, single node, in **nyc3**, not `fra`: there is no app, no
Spaces bucket, no Spaces key and no Valkey. The domain is chosen (step 3).

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
3. **The domain (chosen 2026-11-05).** Chat lives under `chat.jawwid.com`, and
   staging under its own parent `chat-staging.jawwid.com`, so staging's cookies
   and passkeys can never reach production. Neither name collides with Core's
   `api.jawwid.com`. `jawwid.com`'s DNS is at Hostinger; the deploy only ADDS
   two CNAME records per environment there (step 9), and changes none of Core's.
   Set these **repository variables**
   (Settings → Secrets and variables → Actions → Variables):

   | Variable | Value |
   |---|---|
   | `STAGING_API_BASE_URL` | `https://api.chat-staging.jawwid.com` — the API **origin**, no `/api/v1` |
   | `STAGING_REALTIME_URL` | `wss://api.chat-staging.jawwid.com` |
   | `STAGING_ADMIN_WEB_URL` | `https://admin.chat-staging.jawwid.com` |
   | `STAGING_CORS_ALLOWED_ORIGINS` | `https://admin.chat-staging.jawwid.com` |
   | `PRODUCTION_API_BASE_URL` | `https://api.chat.jawwid.com` |
   | `PRODUCTION_REALTIME_URL` | `wss://api.chat.jawwid.com` |
   | `PRODUCTION_ADMIN_WEB_URL` | `https://admin.chat.jawwid.com` |
   | `PRODUCTION_CORS_ALLOWED_ORIGINS` | `https://admin.chat.jawwid.com` |

   The Admin Web bundle compiles the API URL in (ADR-006), which is why the
   domain comes before the first deploy. The domain also unblocks passkeys
   (PD-23 Phase B, relying party `chat.jawwid.com`).
4. **The GitHub Environments. ✅ Done.** `staging` and `production` exist;
   `production` has a required reviewer and deployments limited to `main`. The
   production workflow's safety depends on these rules, and no file can
   enforce them, so keep them.
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
7. **Create the production bucket on DigitalOcean Spaces, versioned, before
   anything is uploaded.** Attachments, voice notes, avatars, Materials and
   whiteboard images exist only in the bucket, so a delete is final unless the
   bucket keeps versions (`backup-recovery.md` §1).
   * **Spaces, not R2.** Cloudflare R2 does not implement bucket versioning, so
     it cannot meet this requirement. Use the same region as the app (`fra1`).
   * Create the bucket (private) and **two Spaces keys, never one**:
     - the **application key** (`STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY`):
       *Limited Access*, Read/Write/Delete on this bucket only. The API and
       worker run with it. Never widen it: it would hand every API process the
       power to switch off the 30-day recovery.
     - the **admin key** (`STORAGE_ADMIN_ACCESS_KEY` /
       `STORAGE_ADMIN_SECRET_KEY`): *Full Access*, used ONLY by the deploy's
       storage check and the "Object storage versioning" workflow. Spaces
       refuses a bucket-limited key `GetBucketLifecycleConfiguration` and the
       `Put…` calls. It never reaches the app spec, and
       `scripts/qa/guards.sh storage-admin-keys` fails CI if it would.
     Save all four as secrets in the `production` GitHub Environment
     (`production-setup.py ask …`).
   * Run the **"Object storage versioning"** workflow with `mode: apply` (owner
     approves the run). The keys never leave GitHub. It enables versioning, sets a lifecycle that expires deleted or overwritten
     versions after **30 days** and abandoned uploads after 1 day, reads both
     back, and fails unless they took.
   * Then prove the provider honours the expiry rule: run `--verify-expiry
     start`, and `--verify-expiry check <id>` two to three days later.
     DigitalOcean documents expiry of current objects, and of old versions only
     indirectly. Until `check` passes, the 30-day bound is unproven.
   * The production deploy re-checks versioning and the lifecycle on every run
     with the **admin** key, and refuses to release without them, or when the
     admin key is missing or is the application key. The application key needs
     no access to the bucket's configuration.
8. **Provision the remaining services and set their values** in each
   Environment, under the manifest's own names (`infra/env/<env>.env.example`
   lists every one; `scripts/infra/check-env.sh <env>` is what judges them):
   `DATABASE_URL`, `REDIS_URL` (staging: `redis://redis:6379`, its in-app
   component, ADR-013), `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
   storage (`STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_REGION`,
   `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_SIGNING_SECRET`, and
   in production the deploy-only `STORAGE_ADMIN_ACCESS_KEY` /
   `STORAGE_ADMIN_SECRET_KEY` of step 7),
   LiveKit for production, and push, Core and `SENTRY_DSN` where the
   environment requires them.
   **`SMTP_URL` (secret) and `RECOVERY_MAIL_FROM` (variable) are REQUIRED in
   production.** E-mail carries the first-login and reset codes for staff and
   teachers (PD-40, PD-43) and parents' password recovery (PD-25), so a
   production without it leaves people unable to sign in. Both are needed:
   `SMTP_URL` alone leaves the e-mail channel off. The manifest marks both
   `req`, so the production deploy refuses without them.
   Leave **`TRUSTED_PROXY_HOPS`** unset for the first deploy: it is MEASURED on
   the live app afterwards (`production-runbook.md` §1d), never guessed. 0 is
   wrong on App Platform (every client would share one login budget), and one
   too many lets a client forge its address. Unset is safe (no forwarded header
   is read) but leaves the per-address login budget off, so the
   `LAUNCH_PHASE=launch` deploy refuses to run without it.
9. **First deploy.** Actions → **Deploy staging** → `first_deploy` = true. The run
   creates the app and prints its id. Save the id as the `DIGITALOCEAN_APP_ID`
   secret of `staging`; every later run requires it and refuses without it.
   Point both hosts' DNS (CNAME) at the app's default ingress, which the
   DigitalOcean console shows. App Platform issues the certificates once DNS
   resolves. Then re-run **Deploy staging** normally: the smoke test is the
   proof. Repeat for production with **Deploy production**, giving a commit
   staging has already run.
10. **Then** the rest of **What would make this green**: a restore drill against
   staging (6), observability (7), multi-instance realtime (8), on-call (9).

What the repository guarantees meanwhile: until steps 1–9 are done, every
deploy run fails at its first step with the missing item named, and changes
nothing. It never reports a deployment that did not happen (ADR-003).

## Blockers

**BLOCKER-1 · No hosting.** The provider was chosen on 2026-10-22: DigitalOcean App Platform (ADR-010). The app spec and release step are in the repository (ADR-012). The project holds a Postgres cluster, and nothing else is provisioned. Owner: product owner, via **Owner steps that remain** above. Until then, every deploy run stops at its first step with the missing item named, and changes nothing (ADR-003). A red `Deploy staging` run is the expected outcome, not a regression. It must not be "fixed" by relaxing a guard.

**BLOCKER-2 · No git remote. ✅ CLOSED 2026-09-24.**

**BLOCKER-3 · No observability backend.** There is no error tracking, metrics, dashboards or alerting. Detection today means a person noticing. See the Monitoring row above.

**BLOCKER-4 · The API has no entrypoint. ✅ CLOSED.**

**BLOCKER-5 · The store builds are not submittable** (2026-11-02; narrowed 2026-11-05). Account deletion, the privacy manifest, release signing, the iOS release entitlement and app crash reporting are built. What remains: the call ring with the app closed (S-06), Android push delivery on a device with the owner's Firebase project (S-05), decision O-3 on teacher deletion (S-01), and the owner's signing and DSN credentials. `docs/qa/release-gate.md` §2a is authoritative.

## Risks

- **RISK-1 · Prisma client drift. ✅ CLOSED.** The CI `api` job typechecks and is green on main.
- **RISK-2 · Two schema authorities. 🟡 Open, smaller.** The SQL migrations are the only authority CI applies. Prisma can still `db push`, and the `db:drift` check that `schema.prisma` mentions does not exist (gate G-21).
- **RISK-3 · Mobile unbuildable. ✅ CLOSED.** The Flutter app builds and its suite runs in CI. Release builds have been installed on a physical iPhone. What remains is the store work in BLOCKER-5.
- **RISK-4 · Multi-instance realtime is unproven.** Production must run one API instance until two instances are shown, on staging, to deliver every event through the Redis adapter.
- **RISK-5 · Shared working trees.** Several agents work in one repository. Verify the committed tree, never the working copy.
- **RISK-6 · Backups between deploys rest entirely on the provider.** 🟡 Mitigated in code: `backup-weekly.yml` takes an encrypted dump every Sunday and keeps 8 weeks in Spaces (`backup-recovery.md` §3b), whether or not anyone deploys. Open until (a) the provider's daily backups and 7-day PITR are confirmed on the production cluster, (b) the `backup` Environment, read-only role and dedicated bucket key exist (`backup-recovery.md` §3b) and the weekly job has run once, and (c) the §5a restore drill from a weekly copy has passed.

## What would make this green (Phase 1 order)

1. Owner steps 1–8 above (accounts, database preflight, domain, Environments, credentials, bucket, services).
2. Deploy staging, run the smoke test, run a restore drill into staging (G-41), and run the real-LiveKit test §G (G-06).
3. Finish the store items (BLOCKER-5) and turn `APNS_VOIP_ENABLED` on in staging first.
4. Run `docs/qa/submission-device-test-plan.md` on staging with the release builds.
5. Provision Sentry (API, worker, app), an uptime check and alerts. Name who is on call.
6. Deploy production from a commit staging has run. Submit the store builds pointed at it.
7. Re-run this checklist against the real environment rather than against files.
