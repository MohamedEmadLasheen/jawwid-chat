# Jawwid Chat: handoff document

Written 2026-11-23 by the engineering-lead Claude session, for a planner/coordinator who has **no access to this Mac or the repo**.
Everything here comes from the repository, GitHub, DigitalOcean (read-only `doctl`) and live HTTP checks run in this session, unless marked otherwise.
**No secret, password, key, token or student personal data is in this document.** Secrets are referred to by name only (section 3.4).

**Evidence tags used throughout**

| Tag | Meaning |
|---|---|
| **[V]** | Verified in this session: I read the file, ran the command, or fetched the URL. |
| **[R]** | Taken from a repo document or a saved note that I read but did not re-check against the live system. May be stale. |
| **[I]** | My inference. Treat as a hypothesis. |
| **[U]** | Unverified and cannot be verified from here (store consoles, owner-only systems). Needs the owner. |

## Index

1. Product overview
2. Architecture
3. Environments and deployment
4. Mobile app status (Android, iOS)
5. What is done
6. What is in progress
7. What is not started: backlog, bugs, debt, risks
8. Decisions and conventions
9. Operations
10. Recommended next steps and open questions
11. How to work with me
Appendix A: glossary. Appendix B: key file map. Appendix C: today's release, step by step.

---

## 0. Where things stand right now (read this first)

- **The Admin Web release is live in production.** [V] Run 45134892140 of "Deploy production" succeeded end to end (preflight, Admin Web image, backup, migrations no-op, Quran loader, release, smoke test, record). The owner approved it personally in GitHub.
  - Deployed commit: `733e197e3230cf96067d109b79ca9d76b921682e`. DigitalOcean active deployment `bdcba5b3-d12a-434e-a963-384d2f224b31`, phase ACTIVE. API and worker images carry tag `733e197e3230`; Admin Web image `production-7`.
  - https://admin.chat.jawwid.com/ serves the new bundle `index-GUm5G1-v.js`, which contains the new Certificates and Escalations pages. [V]
  - Terms of Use 1.0 was recorded in production through a one-off approved workflow (run 45081665887, succeeded, readiness check passed). The live legal pages `/legal/ar/terms/1.0/` and `/legal/en/terms/1.0/` hash to exactly the recorded SHA-256 values. [V]
- **Still true and deliberate:** the access switch `chat.access_switch 'deny_enforcement'` is OFF and `PERMISSION_GUARD_MODE` is `shadow`. [R, set by the release design; I did not query the production database. I only know the release did not change either.]
- **Not yet verified after the release:** the teacher web portal login with a real account; the API `/health/ready` body (the path I tried, `/api/health/ready`, returned 404, so the readiness route sits elsewhere; the worker log shows commit `733e197e…` running); a real parent sign-in showing the Terms screen once.
- **Open pull request needing the owner:** #638 (review-notes wording about the parent accepting Terms 1.0 once). Docs only.

---

## 1. Product overview

### 1.1 What Jawwid is
Jawwid is an online Quran and Arabic academy, mainly for children, run by an operations team. Families are served by assigned supervisors; teachers deliver classes online. [R: PRD v0.1 §2]
**Jawwid Chat** is the product in this repo. It is a *communication and academy-operations platform*: parents, teachers, supervisors and managers communicate safely around families and learners, and the platform enforces ownership, permissions, moderation, privacy and audit. It is not a generic CRM and not WhatsApp. [R: `docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md`]

It has since grown well beyond the original PRD (lessons, scheduling, payments, subscriptions, payroll, certificates, materials, a sales pipeline). The authority order is: product boundary doc, then PRD v0.2, then PRD v0.1, then everything else; the PD registry holds every later owner decision. [R]

### 1.2 Who uses it (roles)
| Role | Who | Where they work |
|---|---|---|
| Parent | One account per family; children are learner records, not app users. App is for adults 18+ only (owner decision 2026-11-18). [R] | Mobile app (iOS, Android) |
| Student/learner | A profile under a parent. No login. | none |
| Teacher | Delivers lessons. | Mobile app, and the same app as a **teacher web portal** at https://admin.chat.jawwid.com/teacher/ (PD-28) [R] |
| Supervisor (`admin`) | Owns a portfolio of families (onboarding, scheduling, teacher coordination, payments, complaints). | Admin Web; mobile for some |
| Manager | Department manager (Operations, Teachers, Sales, and configurable departments in progress). | Admin Web |
| Sales staff | Sales department. PD-20 lets them in the mobile app with Chats, Calls, Payments, Settings only. | Admin Web + mobile (limited) |
| Super admin | Owner/technical admin; everything incl. payroll and staff accounts. | Admin Web |

In the data, access is by *role + permission keys + department kind*, with a server-side `AuthorizationService` and PostgreSQL row-level security as defence in depth. [R: `docs/architecture/AUTHORIZATION-MODEL.md`] The latest work (access management M1-M3) adds effective-access visibility and an optional deny list (section 6).

### 1.3 Main flows (by role)
**Parent (mobile app)** [R: product boundary, PRD, review notes]
- Sign in with email and password (accounts are created by the academy; a parent signs up only with a one-time code from the supervisor, PD-16). Self-recovery of forgotten password/e-mail (PD-25).
- Chats tab: the persistent "Jawwid" conversation with their supervisor, plus the family/student group with the teacher. Messages publish immediately (PD-14); text, media, voice notes, replies, reactions, receipts.
- Calls: voice calls in chats they may write in (PD-19); rings through CallKit/ConnectionService.
- Schedule of their children; "Packages" (subscriptions) and amount due, with payment by card (Stripe Checkout), bank-transfer receipt upload, payment links; Settings (language Arabic/English, time zone, delete account, app lock).
- Must accept the current **Terms of Use** (version 1.0) once at next request (PD-58). No grandfathering.

**Teacher (app and web portal)**: lessons and schedule, student groups, lesson reports, whiteboards, materials, calls, own records. Never a direct chat or call with a parent (BR-1/PD-7). [R]

**Supervisor/staff (Admin Web)**: Chat console, Dashboard, Tasks (incl. Escalations tab), People & Organization (accounts, staff profiles, teachers, families, students), Sales, Scheduling calendar, Operations (needs-action, Materials, Certificates, Lesson audio), Finance (instalments, payments), Communication (stories, calls), Admin & Settings. Source of truth for the navigation: `apps/admin-web/src/app/navigation.ts`, described in `docs/admin/navigation-architecture.md`. [V]

### 1.4 Business rules (the constitution)
From PRD v0.1 §4, as amended by later PDs. [R]
- **BR-1 / PD-7**: no direct Teacher-Parent chat or call, ever; only inside the official Student Group with a supervisor present. Enforced in the API and in database triggers.
- **BR-2**: nobody sees another user's phone number.
- **BR-3**: who may talk to whom follows relationships (family, enrolment, ownership).
- **BR-4 / PD-8 / PD-24**: every family has one current supervisor; scope follows departments and per-child supervision; a supervisor can be changed in place keeping history.
- **BR-5**: history belongs to Jawwid; nothing is deleted when staff leave.
- **PD-14 / BR-6**: no message is held for approval; managers moderate after sending; every edit keeps the old wording.
- **BR-8**: no end-to-end encryption; encrypted in transit and at rest, audited.
- **Trials, scheduling, sessions**: PD-9 (Chat owns lessons per cut-over teacher), PD-11 (tickets: apologies, make-ups, suspensions, transfers, trials), PD-15 (student journey), PD-31 (direct scheduling with time chips; "this lesson only" or "every week"), PD-22 (each account has its own time zone; Admin Web shows Cairo time with the family's local time beside it). Sales pipeline PD-59 stages: New Lead, Contacted, Trial Booked, Trial Completed, Converted, Lost.
- **Payments and subscriptions**: PD-17 (family money recorded in Chat), PD-27 (payment links, Stripe card, bank-transfer receipts, cash, invoices, instalment reminders), PD-30 (a subscription includes N lessons; two grace lessons; then the child's group locks for parent and teacher if used up or an instalment is overdue; three roles grant exceptions). PD-18: teacher payroll in Chat, super admin only. PD-12: certificates, discipline, leave.
- **Progress tracking and curriculum**: lessons engine (`apps/lessons`, PD-29), materials (PD-51 bilingual), lesson audio (PD-48), children's Quran experience (PD-49), whiteboards and rewards (PD-39/54/55), monthly statistics.
- **Account lifecycle**: PD-21 (admin password reset by one-time code, inactive accounts, impersonation), PD-23 (session lifetimes per role), PD-56 (account deletion with 7-year financial retention), PD-57 (Report and Block), PD-58 (Terms acceptance per account kind).

Full list: `docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` §4 (PD-1 to PD-31) and `docs/product/pd-registry/PD-*.md` (PD-1 to PD-60; 50 files). [V]

---

## 2. Architecture

### 2.1 Repositories and folders [V]
Main repository: `/Users/mohamedlasheen/dev/jawwid-chat` (GitHub `MohamedEmadLasheen/jawwid-chat`, default branch `main`, about 2,739 commits on `origin/main`, 638 PRs numbered so far).

| Path | What |
|---|---|
| `apps/api` | NestJS 11 + Prisma 6 API and worker (Node 24.18.0 in the Dockerfile). Modules under `apps/api/src/`: account-admin, account-deletion, account-recovery, action-log, admin, billing, calendar, cases, certificates, communication, core-boundary, dashboard, discipline, geo, infra, leave, legal, lesson-audio, lesson-content, lessons, materials, moderation, new-students, org, parent-profile, platform (authorization), quran, rewards, sales-pipeline, scheduled-calls, staff-accounts, staff-profile, subscriptions, supervision, tasks, teacher-file, teacher-supervisors, whiteboards. Entrypoints `main.ts` (API) and `worker.ts` (outbox drain). |
| `apps/admin-web` | React 18 + Vite 6 + TypeScript 5 admin console. `src/features/*` has about 38 feature folders. Also `teacher-web/` (the Flutter web build is placed under `/teacher/`) and `legal-web/` (static bilingual legal pages), served by nginx 1.27. |
| `apps/lessons` | Chat-owned lessons/materials renderer (Quran text from a verified snapshot, reviewed lesson JSON, audio manifests). Hosted on its own origin. |
| `lib/`, `test/`, `ios/`, `android/`, `web/`, `pubspec.yaml` | The Flutter app (parents, teachers, some staff). Features: app_lock, auth, billing, calls, conversations, feedback, legal, lessons, materials, messages, moderation, notifications, profile, rewards, sales_payments, sessions, settings, stories, student_profile, supervision, tasks, teacher_profile, trials, whiteboards. Flutter SDK `^3.13` Dart, Flutter `>=3.47`. pubspec version is `0.1.0+1`, but store builds take the version from CI inputs, not pubspec (`docs/mobile/store-builds.md`). |
| `supabase/migrations` | 183 SQL migrations; this is the **single schema authority** (Prisma is a query client only; `prisma migrate/db push` is forbidden). About 220 distinct `chat.*` tables created. Rollback scripts in `db/rollback/`, tests in `db/tests/`. |
| `scripts/` | `db` (apply.sh), `infra` (production-setup.py, backup/restore, deploy helpers), `qa` (guards.sh: 23 release guards), `mobile` (build-store.sh), `lessons`, `legal`, `docs`, `ci`, `ops`, `ai`, `geo`, `brand`, `assets` |
| `docs/` | Canonical docs index at `docs/README.md`. Code plus executed evidence beats docs, docs beat old reports. |
| `infra/` | docker + env templates |
| `.github/workflows/` | ci, deploy-staging, deploy-production, backup-daily, backup-weekly, storage-versioning, release-store-builds, review-cohort, livekit-probe, production-terms-config |

Other local repos on this Mac [V, listed; contents not all inspected]:
- `~/dev/jawwid-chat-release-assets`: store listing assets and Android/iOS readiness plans (not in git).
- `~/dev/jawwid-sales-landing*` (several): the public sales landing page(s), including the adult programmes page experiments. A separate product; this handoff does not cover them in depth.
- Many `~/dev/jawwid-wNN`, `jawwid-*` folders are **git worktrees** of the main repo for individual branches (about 100). See section 6.
- **Protected, not in this repo and never to be touched without owner approval:** Jawwid Core (the older CRM; Stripe recurring billing may live there), Jawwid Teacher System, Jawwid Jadwal, Second School (`~/dev/second-school`). [R: AGENTS.md]

### 2.2 Tech stack and versions [V from package/Docker files]
- API: NestJS 11, Prisma 6, Socket.IO 4.8 (Redis adapter), `livekit-server-sdk` 2.x, `stripe` 23. Node 24.18.0 (Docker). Note: `docs/infrastructure/local-development.md` still says Node 22; it is stale. [V]
- Database: PostgreSQL 17 (local containers postgres:17-alpine; production see 3.2). Redis 7 locally, Valkey/Redis 8.1 image in production.
- Admin Web: React 18.3, Vite 6, TypeScript 5.7, vitest.
- Mobile: Flutter, Sentry Flutter 10, webview_flutter (for lessons), LiveKit for audio.
- Object storage: S3-compatible (DigitalOcean Spaces in production; MinIO locally). R2 is ruled out (no versioning).

### 2.3 How the pieces talk [V/R]
```
Flutter app (parent/teacher)      Admin Web (staff)      Teacher web (/teacher/)
        \                              |                       /
         ---------- HTTPS /api/v1 + Socket.IO (WSS) ----------
                                |
                     NestJS API (apps/api)  <---- Stripe webhook
                      |      |        \
               PostgreSQL  Redis   Object storage (signed URLs; clients upload directly)
                      |
                 Worker (polls chat.outbox_event; no BullMQ queue by design)
                      |
        FCM / APNs push,  LiveKit (calls),  e-mail (SMTP),  WhatsApp (recovery codes)
```
- The database is authoritative. Realtime is a delivery optimisation; clients re-read state on reconnect. Realtime must not bypass authorization.
- Readiness checks only Postgres and Redis (ADR-007); other dependencies degrade a feature, not the product.
- Jawwid Core boundary: HTTPS API/webhooks only, never SQL; Chat keeps `external_id` + `synced_at`. Core still owns teachers' payroll history for non-cut-over teachers, etc. (PD-9, PD-10 as amended).

### 2.4 Auth and roles [R]
Username/e-mail + password; short-lived access tokens with rotating refresh tokens bound to device records; per-role idle/absolute session limits (PD-23); rate limiting and lockout; staff Admin Web can "keep me signed in". `PermissionGuard` (API) runs in **`shadow`** mode in production: it logs would-be refusals but only the legacy tier rules actually enforce, except denies (see 6.1). `chat.staff_has_permission` and `chat.staff_access_profile` are the one evaluator in SQL.

### 2.5 Data model [R/V]
About 220 tables in schema `chat`. Core objects: organization, department (+ member/account), staff, family, contact, learner (child), teacher, conversation (+ member), message (+ revision, receipt, reaction), attachment, call, scheduled_call, lesson, task, case/escalation tables, subscription, payment, instalment plan, invoice, certificate, material_item, lesson audio, story, whiteboard, notification/outbox_event, audit_log, event_log, config, legal_version + acceptance, access role/grant tables, access_switch, staff_permission_deny. Schema orientation docs: `docs/recovery/PHASE-0-DATABASE-RECONCILIATION.md`, `docs/architecture/organization-model.md`, `docs/db/`. Every root entity carries `organization_id` (future multi-tenant).

### 2.6 APIs [R]
One versioned REST API under `/api/v1` plus Socket.IO. Contract: `docs/contracts/API-CONTRACT.md`, `docs/communication/*`. Per-feature controllers sit beside the modules listed in 2.1. A Stripe webhook is at `api.chat.jawwid.com/api/v1/stripe/webhook`.

### 2.7 Third-party services (names only)
DigitalOcean App Platform (API, worker, Admin Web, Valkey) and Spaces; Supabase (hosts only the PostgreSQL database, free tier, Frankfurt, per ADR-014); GitHub + GitHub Actions; Cloudflare (DNS/proxy in front of the domains); Stripe; Sentry; LiveKit; Firebase Cloud Messaging; Apple Push Notification service; SMTP provider; WhatsApp Business Cloud API (recovery codes); App Store Connect; Google Play Console; Docker/Colima locally.

### 2.8 Push and media
Push via FCM and APNs (dispatcher in `apps/api/src/communication/notifications`; VoIP push for iOS calls only if `APNS_VOIP_ENABLED=true`, default off). Media uses signed upload/download URLs; the bucket keeps 30-day object versions after deletion (affects the privacy notice).

---

## 3. Environments and deployment

### 3.1 Local setup [R: `docs/infrastructure/local-development.md`]
1. `cp .env.example .env; scripts/infra/check-env.sh local --file .env`
2. `scripts/infra/dev.sh up` starts Postgres (:5433), Redis (:6380), MinIO (:9000/:9001). Needs Docker Compose v2 plugin. Docker runs through **Colima** on this Mac (running now [V]).
3. Apply migrations with `scripts/db/apply.sh`; Quran snapshot with `python3 -I scripts/lessons/build-quran-snapshot.py` (needed in a fresh worktree or four lessons test files fail).
4. API tests: `npx jest --maxWorkers=2` (unit), `npm run test:int -- --runInBand` (integration; needs its own Postgres and Redis and a `psql` 17 client). Admin Web/lessons: `npx vitest run --pool=forks ...`. Flutter lives at `~/development/flutter/bin` (not on PATH): `flutter test --concurrency=2`. Guards: `bash scripts/qa/guards.sh <name>`. Check `uptime`; wait if 1-minute load is above 60 (shared Mac).
5. Containers `jc-preview-pg` (postgres:17) and `jc-preview-redis` are running [V]. They are not part of this repo's compose file; I believe they belong to another preview stack [I]. Do not stop them. Never touch `~/jawwid-systest*`.

### 3.2 Environments [V/R]
| Env | Details |
|---|---|
| Local | compose stack above |
| Staging | `deploy-staging.yml`, DigitalOcean; also has a `build_only` mode (PR #635) that only builds and records the API image digest. [V] |
| Production | DigitalOcean app `jawwid-chat-production` (id `30b7bae3-f7bb-4c34-b066-92e13f1b8853`), services api, worker, admin-web, redis. Domains `api.chat.jawwid.com`, `admin.chat.jawwid.com`. Database: dedicated Supabase Free project (ADR-014) with **no provider backups or PITR**, session pooler. [R, from ADR-014 and my earlier session. Older notes in my memory say DigitalOcean Managed PostgreSQL; ADR-014 is newer. Confirm with the owner.] |

### 3.3 Build and release flow [V]
- **CI** (`ci.yml`): jobs guards, api, admin-web, lessons, migrations, integration, e2e, images, dependencies, mobile, android, android-ring. A 23-guard script (`scripts/qa/guards.sh`) enforces, among others, migration slot claims, PD registry, image-digest rules, pinned actions.
- **Deploy path**: merge to `main` (protected; Code Owner review) → run "Deploy staging" (records the API image digest for the commit; `build_only` skips the staging deploy) → run "Deploy production" with `image_tag` = full 40-char SHA and `confirm=DEPLOY`.
  - Production job order: preflight (digest must match a recorded staging run on `main`) → build Admin Web image → credentials check → resolve app spec → storage versioning check → DB role capability preflight → encrypted `pg_dump` uploaded as an artifact → `scripts/db/apply.sh` migrations → Quran loader → release via doctl → smoke test → record.
  - The GitHub Environment `production` requires the owner as reviewer, `prevent_self_review: true`, admins cannot bypass, branch policy `main` only. **A run dispatched by the owner's own login cannot be approved by them.** So runs are dispatched from the `jawwid-bot` GitHub account and the owner approves personally. Do not weaken this.
- **PD-58 Terms gate**: the API refuses to start in production unless `chat.config` has `legal.current.terms_family` naming a published version. The first production deploy (#17) failed for exactly this reason and auto-rolled back; the fix was the one-off workflow `production-terms-config.yml`. Runbook: `docs/infrastructure/production-runbook.md`.
- **Mobile**: `release-store-builds.yml` (inputs `ref`, `platform`, `build_name`, `build_number`, `android_delivery`) in the GitHub Environment `store-release`; `scripts/mobile/build-store.sh`. Debug symbols go to Sentry before store upload.

### 3.4 Configuration names (values are never in the repo)
API/worker: `APP_ENV`, `NODE_ENV`, `PORT`, `DATABASE_URL`, `DATABASE_POOL_MAX`, `DATABASE_WORKER_POOL_MAX`, `DATABASE_STATEMENT_TIMEOUT_MS`, `REDIS_URL`, `QUEUE_PREFIX`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `RESET_CODE_HASH_SECRET`, `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_REGION`, `STORAGE_SIGNING_SECRET`, `STORAGE_PUBLIC_BASE_URL`, `MEDIA_PUBLIC_BASE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYMENT_LINK_BASE_URL`, `SUBSCRIPTION_LOCK_ENFORCED`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `FCM_PROJECT_ID`, `FCM_SERVICE_ACCOUNT_JSON`, `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID`, `APNS_PRODUCTION`, `APNS_VOIP_ENABLED`, `SMTP_URL`, `RECOVERY_MAIL_FROM`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_RECOVERY_TEMPLATE`, `CORE_BASE_URL`, `CORE_API_KEY`, `CORE_WEBHOOK_SECRET`, `SENTRY_DSN`, `TEACHER_PAYOUT_KEYS`, `LESSON_APPROVALS_SIGNING_KEY`, `MATERIALS_SITE_BASE_URL`, `MATERIALS_FRAME_ORIGINS`, `CORS_ALLOWED_ORIGINS`, `TRUSTED_PROXY_HOPS`, `PERMISSION_GUARD_MODE`, `SALES_FAMILY_SCOPE`, `TEACHER_SUPERVISOR_STRICT_SCOPE`, outbox tuning (`OUTBOX_POLL_MS`, `OUTBOX_BATCH_SIZE`, `OUTBOX_IDLE_BACKOFF_MS`), `LOG_LEVEL`. [V: names from `infra/env` templates; `PERMISSION_GUARD_MODE` from release work]
Where they live: GitHub Environments `production`, `staging`, `store-release`, `backup`; DigitalOcean app spec/secrets; the owner's Mac helper scripts under `~/.jawwid` (e.g. create-super-admin, set-production-database-url). The `backup` Environment has **zero** secrets (section 9). Secrets policy: `docs/infrastructure/secrets.md`. Never ask the owner to paste a secret into chat; use hidden-prompt scripts such as `python3 -I scripts/infra/production-setup.py ask <NAME>`.

---

## 4. Mobile app status

**Honest limit:** I have no access to Google Play Console or App Store Connect. The owner told me Android is published and iOS was submitted for review. I cannot confirm either. Everything below is from the repo, CI runs and saved notes, so version/build numbers marked [U] must be read off the consoles.

### 4.1 Identities [R]
iOS bundle `com.jawwid.jawwidChat` (Apple team `KX683HAR3Y`). Android application id `com.jawwid.jawwid_chat`. App name "Jawwid". Adults 18+ only, free, worldwide, developer account type Organization (Jawwid LLC, per owner decisions 2026-11-18).

### 4.2 Builds on record [V from `gh run list`; R from notes]
| When | CI run | Commit | Result | What |
|---|---|---|---|---|
| 2026-11-12 | 43215124577 | `b708295e` | success | iOS 1.0.0 (build 1) signed and uploaded by CI. |
| 2026-11-18 | 44285965671, 44306602707 | `2e412701` | success | Android release AAB **1.0.0, versionCode 3**, targetSdk 36, 16 KB-aligned native libs (SHA-256 recorded in the notes; encrypted copy in `~/dev/jawwid-chat-release-assets/android-play/run-44306602707-encrypted`). |
No newer store-build CI run exists after 2026-11-18. [V] So **if a newer iOS build was submitted to Apple, it was not produced by this workflow** (or was produced outside CI). [U] The iOS 1.0.0 (1) build is stale relative to main (100+ commits later, including teacher deletion request, Packages wording, currency digits). [R]

**Exact current published/submitted version and build numbers: [U].** Ask the owner for: Play Console production release name and versionCode; App Store Connect version and build selected for review; submission date; review status.

### 4.3 Release notes and review submission material [V]
`docs/release/store-console/` holds listing copy, review notes (App Review Information "Notes", Play "App access"), age rating, Apple privacy, Google Data Safety, Play declarations. Review accounts (`parent@`, `teacher@`, `parent2@` on a review-only organization with made-up data) are provisioned by the `review-cohort.yml` workflow and described in `docs/release/review-accounts.md`; passwords are secrets in the `production` Environment and consoles only. **Apple needs the parent test account to accept Terms 1.0 once**; PR #638 adds this to the review notes. The owner must paste the updated Notes in App Store Connect and the Play text.

### 4.4 Known review risks [R/I]
- Apple 2.1 "Information Needed" has been raised (resolution pack in `docs/release/`, PRs #613/#614); Apple 3.2 and sign-in link to the public enrolment page (PR #613) pending. [R]
- Parents are asked to accept Terms 1.0 on first request after the release: the reviewer's first sign-in shows a Terms screen. Needs the note above.
- Calls: ringing while the app is closed only works if production sets `APNS_VOIP_ENABLED=true` (default off). Review notes depend on this. [R]
- Staff features: Sales staff and the super admin can sign in to the app (PD-20), so "no staff in the app" would be false; notes describe it instead. No review account exists for the Sales role (open item). [R]
- Card payments: Stripe is live-capable but cards were seeded **paused** in production (2026-11-17). Store copy was written card-free. [R]
- UGC (Apple 1.2 / Google): Report and Block exist (PD-57). Quran audio rights are an open research item (`docs/legal/quran-audio-rights-research.md`). [R]
- Legal: counsel not appointed; legal drafts say there is no automatic renewal, but Core may auto-charge some customers monthly (unverified, section 7). [R]

### 4.5 If Apple rejects
Read the rejection reason in App Store Connect Resolution Center (owner only). Typical path: fix in a branch, new PR, owner merges, run the "Release store builds" workflow with a higher `build_number`, owner selects the new build in App Store Connect, replies in the Resolution Center. Pure metadata/review-note rejections need no new build. Never claim an upload or submission without console proof. [I]

### 4.6 Signing and release process (no keys) [R]
- Android: upload key held in the `store-release` Environment (secrets) and, per `docs/release/android-upload-key.md`, Google manages app signing. First bundle upload had to be manual; owner chose option E (encrypted first-bundle artifact, `age` tool). Release builds need `android/key.properties`, never committed.
- iOS: CI signs with the distribution certificate and App Store Connect API key (Environment secrets); entitlements `RunnerRelease.entitlements` (`aps-environment` production). Local alternative: `docs/release/signing-on-existing-mac.md`.
- Debug symbols (Dart split-debug-info, dSYMs) are uploaded to Sentry in CI before the store upload.
- Local phone installs require the owner's approval (saved rule). 

---

## 5. What is done (with evidence)

| Area | Evidence |
|---|---|
| **Admin Web release of 2026-11-23** (M1 effective access, M2 department-kind audit, M3 dormant deny enforcement, Certificates and Educational Materials as top-level navigation, Escalations tab, materials author/review roles, PD-59 sales pipeline, PD-58 publish order) | Production run 45134892140 success; live bundle contains the new pages [V]; PR #634 merged as `a1fd1550`, #635, #636, #637 merged [V]; API unit tests 3,051 passing locally after the last fix (from my notes of this session) |
| Six migrations applied in production | Run 45078561801 recorded them; the later run applied none (no-op) [V] |
| Terms of Use 1.0 live and recorded | Run 45081665887 success; live pages hash to the recorded SHA-256 [V] |
| Backup tooling fixes | `restore-db.sh` handles the `jawwid_backup` role (#636); CI restore drill updated [V] |
| Core platform: messaging, groups, calls, push, authorization, RLS, audit, outbox worker, org structure, supervision | `docs/README.md` canonical set; protected security tests `docs/qa/protected-tests.tsv`; integration suites in `apps/api/test/integration` [R] |
| Academy operations: lessons, scheduling, trials, new-student enrolment, instalments, payments, subscriptions, payroll, discipline, leave, certificates, materials, lesson audio, whiteboards, stories | PD-9 to PD-60 files; feature folders in 2.1 [V existence; R completeness] |
| Store compliance: account deletion, report/block, privacy and terms links, crash reporting | PD-56, PD-57, `docs/release/store-console/` [R] |
| Legal pages live and public | https://admin.chat.jawwid.com/legal/ [V for terms 1.0 ar/en] |
| Android 1.0.0 (3) built from `2e412701` | CI run 44306602707 [V] |
| Production safeguards | Environment protection, digest-bound deploys, encrypted pre-deploy dump, storage versioning check, smoke test [V] |

Not counting: I never ran the Flutter suite in this session, so I do not state its test count. [U]

---

## 6. In progress or half-done

### 6.1 Access management (the latest program) [V from docs in `jawwid-nav-ia` worktree]
- **M1** effective-access visibility, **M2** department-kind audit (8 SQL rules corrected so a new configurable department cannot be confused with a core one), **M3** enforced denies: all **shipped to production but dormant**: switch OFF, guard shadow, so production behaves as before.
- **M4/M5 not started**: configurable departments (relaxing the unique `(organization_id, kind)` to a partial unique on core kinds, department default roles, Prisma compound-key removal, create-department UI). Prerequisites are listed in `docs/admin/department-kind-audit.md`.
- Turning denies on needs its own approval: export of staff and effective permissions, endpoint inventory, staged rollout for one department, rollback script exists.

### 6.2 Open pull requests (as of this session; first 30 shown by `gh`) [V]
Notable ones: #638 (review-notes Terms wording; owner to merge); PD-59 Sales stack #623-#632 (#623 gate fix, #624 integration tests, #625 stabilization doc, #627 F7 trial ownership, #628-#632 stacked on #627: needs-handover list, trial task owner, no family-login administration, prospect-id DB function, trial-group cards). **Do not modify #629-#632** (owner instruction). #630 conflicts with main in `pd040-catalogue-seed.spec.ts`. #633 owner redirect fix. #626 visual-review doc. Store/launch: #591 (store console and legal texts, "merge last"), #611 (store submission pack), #613/#614 (Apple 2.1 items), #610 (DB credential rotation blocker doc). Reliability/security: #567 (offboard fail-closed), #569-#571 (auth/token follow-ups), #586/#575 (review cohort), #588/#590 (push), #592 (pin actions), #596, #601, #612 (test flakes), #574, #578.
There are more below #567 (list was truncated at 30). Ask me to re-run `gh pr list --state open` for the full set.

### 6.3 Branches and worktrees [V]
About 100 git worktrees exist (see `git worktree list`), many of them named `jawwid-wNN` for single-ticket branches, plus `.claude/worktrees/agent-*` from subagents and QA envs under `~/jawwid-qa-env`. `git branch -a` shows 1,384 branches. Some worktrees are locked. Most hold merged or abandoned work. Nobody has audited which are safe to delete. **Do not clean them without checking each for uncommitted work** (house rule: preserve the owner's uncommitted work).
Current branch in the main checkout: `claude/pipeline-gate-on-server-access` (clean).

### 6.4 Half-done items [R]
- PD-59 migration changes prepared but not executed in production (#629-#631 carry "migration prepared").
- PD-60 Students page: spec approved; verify status in `PD-60.md` (state says IN PROGRESS; the nav doc says built). [I: built, record not updated]
- Teacher web portal login not verified with a real account after the release.
- `docs/product/pd-registry` states lag reality for several PDs (marked IN PROGRESS although shipped). [I]

---

## 7. Not started, backlog, risks

### 7.1 Blockers to public launch (owner-level) [R]
1. **BLOCKER-6**: rotate the exposed production database password before public launch. The note says `doadmin` on DigitalOcean Managed PostgreSQL, while ADR-014 says the production database is Supabase. Reconcile first. [R/U]
2. **Backups**: the `backup` GitHub Environment has no secrets, so the daily backup fails and the weekly workflow is disabled. The read-only `jawwid_backup` role SQL (`scripts/infra/create-jawwid-backup-role.sql`) is written and CI-tested but **not run in production**; running it needs the owner's explicit approval and a hidden-prompt secret flow. Supabase Free has no provider backups or PITR, so today the only recovery is the encrypted pre-deploy dump artifact (retention limited). This is the biggest operational risk. [V/R]
3. **Counsel and legal accuracy**: no appointed counsel; Terms 13.9 / Privacy 4.11 card-charging wording must be made true; recurring billing in Core is unverified (7.2).
4. Stripe: live key chosen to reuse Core's account; cards paused by seed; owner must finish Admin settings (invoice issuer, bank account), resume cards and run one real small payment and refund. Invoice issuer street address and EIN are not in any record. [R]
5. Google Play production eligibility items: Data Safety, target audience (adults), package registration check, 14-day closed-testing contingency docs exist. Ask the owner what Play requires now. [U]

### 7.2 Known risks and unknowns [R/I]
- **Recurring billing may exist in Jawwid Core** (owner statement 2026-11-07, unverified): Chat's ledger would not see renewals. Keep `SUBSCRIPTION_LOCK_ENFORCED` off in production until verified.
- **Single point of failure for data**: free-tier database without backups (7.1).
- **Production Terms gate**: every family must accept Terms 1.0 at the next request; expect support questions and review-account friction.
- **Shadow guard**: `PermissionGuard` is not enforcing missing permissions anywhere in production. Enforcement mode needs the endpoint inventory (`docs/admin/pd040-enforce-readiness.md`).
- **Task assignment gap** (M3): a task already assigned to someone later denied `certificates.design` stays with them until reassigned.
- **Deniable keys limited to five**; widening needs a per-key coverage review (a spec enforces it).
- **Docs drift**: some docs are stale (Node 22 in local-development, "not yet released to a store" in architecture.md, PD states). Rule: code and executed evidence win.
- **CI action pinning** (PR #592) and **secret scan across full history** (branch `claude/ci-secret-scan-full-history`) are open.
- **Test flakes** noted: slow-reader storage timeout (#612), PD-27 digits (#601), android-ring (#596, `lr78-ring-flake`).
- **Migration governance** is strict and easy to trip: every migration needs a claim file under `docs/product/migration-slots/`, the PD-40 registry, and `deny-coverage.json` entries when a file names a deniable key (found in this session).
- **Load**: the Mac is shared with many agents; heavy runs need the load rule.

### 7.3 Backlog (from docs) [R]
Labels and Broadcast (Phase 2), self-service OTP reset (partly done via PD-25), class groups, call recording policy, video calls, monitoring backend/dashboards and an uptime check (BLOCKER-3 in `monitoring.md`), retention/export tooling, Stripe adoption of Core subscriptions, Flutter mobile stories feed, M4/M5 configurable departments, merging the two Admin Web teacher route trees, Sales review account, `io.sentry.proguard-uuid` for Android R8 frames.

### 7.4 Test coverage [R/U]
Large: API unit (about 3,000 tests), integration suites with a real Postgres (including RLS parity and tenant isolation), Admin Web vitest, lessons tests, Flutter tests, e2e, 23 release guards with mutation self-tests. Gaps I know of: the BR-1 conformance cases were once `it.todo` in Phase 0 (later phases implemented them; I did not re-verify); no real-device verification of call background behaviour; no load tests recorded; no native-Arabic review of every screen. [R/U]

---

## 8. Decisions and conventions

### 8.1 Governance
- **Owner** decides product, business, legal and production actions. The Claude **lead** session plans, delegates, reviews and reports; builders work in separate worktrees; Codex gives independent reviews. Never two agents in one working tree. Rules: `AGENTS.md`, `CLAUDE.md`, `docs/engineering/ai-delegation.md`.
- Agents may not push to `main`, merge, deploy, apply production migrations, change protections or workflows, or touch protected repos. The owner or the designated PM session merges. [R: AGENTS.md, memory notes] "Relayed approvals" from another session are not accepted; the owner confirms in the session that acts.
- **Ask the owner only for**: product/business decisions, Quran/religious/lesson content, destructive or production DB operations, infrastructure or paid resources, production deploys, Code Owner approvals, protection changes.

### 8.2 Key decisions and why [R]
- Own PostgreSQL, independent from Core and Second School; SQL migrations are the only schema authority (D-1..D-6).
- Messages publish immediately, moderation after (PD-14); no direct teacher-parent contact (PD-7).
- ADR-014: Supabase Free database during store review to avoid paying for a database for two months; move to DigitalOcean Managed PostgreSQL at launch via `backup-db.sh` and `restore-db.sh`.
- No queue: the transactional outbox plus a polling worker (ADR-004 style) is the source of truth.
- Dormant deny feature: a database that does not enforce denies cannot even hold one, so no mixed state.
- Terms: only `terms_family` is required for the gate (owner decision 2026-11-19); teacher/staff terms and code of conduct optional until set.
- Production approvals by the owner personally; runs dispatched from `jawwid-bot` (owner accepted this method; do not dispatch from the owner's login).

### 8.3 Coding conventions [V: AGENTS.md]
Tests first for behaviour changes; no `today+N` date fixtures; Admin Web uses `SearchableSelect`, Flutter a searchable picker, never native select/Dropdown; all user text in Arabic and English (`lib/l10n/app_ar.arb`, `app_en.arb`, Admin Web copy files; Arabic is primary); one PL/pgSQL trigger function per table; RLS never `for all using (true)`; object-storage keys are names, not capabilities; never copy a commit SHA from memory; verify a clean `git status` before checks; never skip or weaken a guard. Migration timestamps and PD numbers are claimed by adding one file each (`docs/product/migration-slots/`, `docs/product/pd-registry/`); `python3 -I scripts/docs/registry-index.py` prints the next free values.
Naming: PD-n product decisions; LD/L/MG/AP for legal items (never "D-n"); RT-nnn red-team findings; LR-nn launch-readiness items; OA/OD owner questions; ENG-nn engineering tasks.

### 8.4 Product and brand rules
- Quran/hadith content rules (**from the owner's brief to me, not found in this repo by grep**) [U for the exact wording]: Bukhari and Muslim only; nothing child-facing without sheikh approval; never alter hadith text. In the repo, the enforcing mechanism that I did verify is the lessons engine: Quran text only from the verified snapshot (`data/quran/`, 6,236 verses, fails closed), lesson prose reviewed before release (pending files do not ship), and CODEOWNERS on Quran data and lesson content. [V/R]
- Brand: Jawwid logo/colours/typography; WhatsApp look-alike allowed but no WhatsApp branding. No phone numbers shown to anyone. Children's imagery and any children-facing content need approval.
- Arabic first, RTL, Gulf/Egypt academy audience; native-Arabic copy review is advised before launch.

---

## 9. Operations

- **Monitoring**: Sentry (API, worker, app); structured JSON logs to stdout (read with `doctl apps logs <app-id> --type run|deploy`); health routes (`/health/live`, `/health/ready`) on the API; DigitalOcean alerts for `DEPLOYMENT_FAILED` and `DOMAIN_FAILED` only. No metrics backend, no dashboards, no uptime check yet (BLOCKER-3). [R]
- **Backups**: see 7.1. Pre-deploy encrypted dump on every production deploy (works; run 45134892140 uploaded one). Daily/weekly scheduled backups: failing/disabled. Object storage: versioning with 30-day noncurrent retention, enforced by the deploy. Redis is not backed up by design. [V/R]
- **Logs**: DigitalOcean App Platform logs; GitHub Actions logs (retention per GitHub). Never log secrets (the Terms workflow reads the DB URL from the environment and never prints it).
- **Costs**: paid DigitalOcean app (api, worker, admin-web, Valkey) and Spaces; Supabase Free ($0); GitHub; Stripe fees; Sentry plan; LiveKit; Apple developer program; Google Play one-time fee; Cloudflare. Exact amounts: [U], owner has the bills.
- **Mac disk / iCloud (bird) issue**: **status per my checks now [V]:** root disk 460 GiB total, 17 GiB used, 87 GiB free (17%); the `bird` process (iCloud Drive sync daemon) is running at about 27% CPU. I cannot see history of the original problem from this repo (no doc mentions it), so I do not know what was fixed or what remains. [U] Suggested watch items: keep repos and worktrees out of iCloud-synced folders (these live in `~/dev`, which is not an iCloud path [I]); watch for `bird` CPU spikes; large Docker volumes live in Colima's VM disk. Question for owner: what exactly was the symptom and the last fix?
- **Periodic attention**: weekly check of CI on `main`; production deploys need the Terms/legal check; rotate the exposed DB credential (BLOCKER-6); backup role creation; storage-versioning workflow; dependency release-age (7 days) and supply-chain guards; review the open-PR list and the 100 worktrees; confirm Stripe card pause state before enabling payments; watch the Supabase Free project limits (storage, pausing after inactivity [I]).

---

## 10. Recommended next steps (priority order) and open questions

### 10.1 Next steps
1. **Finish verifying the live release** (small, now): sign in to https://admin.chat.jawwid.com/ as the super admin and click the new Certificates, Educational Materials, and Tasks → Escalations pages; confirm the Admin Web staff profile shows the Access panel; test the teacher portal login with a real teacher; check `doctl apps logs` for errors over an hour. (I can run the log and header checks; sign-ins need the owner or a test account.)
2. **Merge PR #638** and paste the updated review notes into App Store Connect and Play so reviewers know about the one-time Terms acceptance. Highest-value small action for the store review.
3. **Fix backups (biggest risk).** Owner approves running `scripts/infra/create-jawwid-backup-role.sql` in production via the hidden-prompt flow, then sets the `backup` Environment secrets, re-enables the weekly job, and runs a restore drill from a real dump into a disposable database.
4. **Reconcile the database provider and the BLOCKER-6 password rotation** (Supabase vs DigitalOcean Managed). Then rotate once, with the prepared plan.
5. **Get exact store state** from the owner (section 4.2), and build a fresh iOS build from `main` if the submitted build is the stale 1.0.0 (1). Plan around Apple's response.
6. **Stripe go-live checklist** (Admin settings, resume cards, one real payment and refund), only after the owner decides to launch payments and the Core recurring-billing question is answered.
7. **Sales pipeline stack**: resolve #630's conflict, merge #623-#632 in order with the owner's approval (do not change those PRs unless asked), then run the staging plan in #625.
8. **Docs truth pass**: update PD states, Node version, "not released" claims; consider one up-to-date "operations" page.
9. **Housekeeping**: audit the ~100 worktrees and 1,384 branches for uncommitted work, then prune with the owner's OK. Add an uptime check and Sentry alert routes.
10. **Access management M4/M5** only after the owner prioritises configurable departments.

My honest assessment: the product is feature-rich and heavily tested; the real risks are operational (no backups on the database, single-person approvals, owner-only console steps), not code. I would do items 2, 3, 1 first.

### 10.2 Questions for the owner
1. Exact Play production version name/versionCode, and Apple version/build and status. Is the submitted iOS build the old 1.0.0 (1)? Date submitted?
2. Is the production database Supabase Free (ADR-014) or DigitalOcean Managed PostgreSQL? Has the exposed password already been rotated?
3. May I run the production backup-role SQL, and who sets the `backup` Environment secrets? Is a restore drill allowed?
4. Are cards still paused in production? Has the Core recurring-billing question been checked in the live Stripe account?
5. Which Quran/hadith content rules exist in writing (Bukhari/Muslim only, sheikh approval)? Where is the approver list recorded?
6. What was the Mac `bird`/iCloud issue and the last fix? Is anything still syncing that should not?
7. Order for the Sales PD-59 PRs and who may merge; may I resolve #630's conflict on a new branch?
8. Is `APNS_VOIP_ENABLED` meant to be on for launch?
9. Terms teacher/staff/code of conduct: when should they become required?
10. Who is the planned counsel, and when are the legal reviews due?

---

## 11. How to work with me (for the planner)

**What I need to continue each piece of work**
| Work | I need from the owner/planner |
|---|---|
| Production deploy | Owner personally approves in GitHub (Environment `production`). Planner gives the target commit SHA (a commit on `main` with a recorded staging digest). Prompt: "Dispatch Deploy production for `<sha>` from `jawwid-bot`; tell me when it reaches the approval gate." |
| Production DB statement | The exact SQL, its owner approval in writing, a one-off workflow PR (as done for Terms 1.0). Never raw access. |
| Store build | Approval of version/build number and the ref SHA; owner runs or approves the `store-release` workflow; owner does console steps. |
| New feature | A decision recorded as PD-n (ask me to draft it), acceptance criteria, whether any migration is needed (slot claim). |
| Bug | Role, screen, steps, expected vs actual, environment, screenshots without personal data. |
| Review notes/legal text | Owner approval of wording; I edit docs only; the owner pastes into consoles. |

**Prompts and commands that work well**
- "Check CI and PR status for `<PR#>` and tell me only if something needs me."
- "Run the release guards and the API unit suite on `<branch>` and report counts and the first failure." (`bash scripts/qa/guards.sh`, `npx jest --maxWorkers=2` in `apps/api`)
- "Prepare a migration for X: claim the slot, add rollback, tests first, run `scripts/db/apply.sh` on a disposable Postgres 17, open a PR; do not apply anywhere shared."
- "Verify production: run `doctl apps get 30b7bae3-f7bb-4c34-b066-92e13f1b8853`, the health URL, logs for the last hour and the legal-page hashes."
- "Give me a read-only status of branches and worktrees; do not delete anything."
- "Draft the PD for `<decision>` into `docs/product/pd-registry/` and propose the migration slot."
Useful manual commands for the owner: `gh run list --workflow deploy-production.yml`, `gh pr list --state open`, `doctl apps logs <app-id> --type run`.

**Things I will not do without an explicit owner instruction in their own session:** merge, deploy, run production SQL/migrations, change protections or workflows, touch Core/Second School, delete volumes, expose or request secrets, approve my own deployments, or record a Terms acceptance for anyone.

---

## Appendix A: glossary
PD-n product decision; BR-n business rule; M0-M5 delivery milestones (PRD) and M1-M5 access-management stages (separate series); LR-n launch readiness; RT-n red-team finding; ADR-n infra decision; `chat.*` the database schema; Core = Jawwid Core (separate system); the "owner" = the business owner (GitHub `MohamedEmadLasheen`); `jawwid-bot` = automation GitHub account used only to dispatch workflows.

## Appendix B: key files
- Rules: `AGENTS.md`, `CLAUDE.md`; product: `docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md`, PRD v0.1/v0.2, `docs/product/pd-registry/`
- Architecture: `docs/architecture/*`, `docs/infrastructure/architecture.md`, `docs/contracts/API-CONTRACT.md`
- Ops: `docs/infrastructure/production-runbook.md`, `backup-recovery.md`, `monitoring.md`, `secrets.md`, `decisions.md`
- Release: `docs/release/store-console/*`, `docs/release/review-accounts.md`, `docs/mobile/store-builds.md`, `docs/release/signed-builds-ci.md`
- Admin Web: `apps/admin-web/src/app/navigation.ts`, `docs/admin/navigation-architecture.md`
- Access program: `docs/admin/access-management-architecture.md`, `access-deny-enforcement.md`, `department-kind-audit.md` (on branch `claude/admin-web-nav-ia`, worktree `~/dev/jawwid-nav-ia`; check they landed on main) [V that the files exist there]
- Workflows: `.github/workflows/deploy-production.yml`, `deploy-staging.yml`, `production-terms-config.yml`, `release-store-builds.yml`, `review-cohort.yml`

## Appendix C: today's release timeline (for context)
1. #634 (six migrations, Admin Web) merged; #635 added `build_only` staging; #636 fixed restore for the backup role.
2. First production deploy (run 45078561801) applied all six migrations, then failed at Release: the API refused to start without `legal.current.terms_family`; DigitalOcean rolled back to the old API (`aaea48f0`). The database stayed on the new schema.
3. Fix: #637 added a one-off approved workflow publishing Terms of Use 1.0 (effective 2026-11-17, re-acceptance required). Owner approved it (run 45081665887, success).
4. Second production deploy (run 45134892140), dispatched from `jawwid-bot` and approved by the owner: success; DigitalOcean deployment `bdcba5b3-d12a-434e-a963-384d2f224b31`.
5. I missed the PD-58 pre-step in the earlier release audit; it is now in my checklist.
