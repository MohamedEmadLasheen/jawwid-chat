# Final submission checklist: Apple 2.1 "Information Needed" (updated 2026-11-19)

Statuses:
- **VERIFIED**: tested, with evidence.
- **COMPLETED**: done; awaits an external check.
- **BLOCKED**: needs a named owner action.
- **NOT APPLICABLE**: with the reason.

**Decided by the owner (2026-11-19):**
- Lessons take place on **Zoom**, outside the app.
- **Marketing URL: leave empty** until the website is verified clean.
- Worldwide distribution.

**Recommended: build 3** (1.0.0, build number **4**, the next free number on both stores). It is `main` plus PR #613
(the enrol link, the strongest visible answer to Guideline 3.2). It needs no other app change: the Terms gate (#497)
is server-side, and the app's half is already in the build.

## A. Apple's six requested items

| # | Item | Status | Evidence / what remains |
|---|---|---|---|
| 1 | Physical iPhone recording | **BLOCKED (owner, on the phone)** | `SCREEN_RECORDING_SCRIPT.md` (20 steps, including the Zoom explanation). The phone runs iOS 27.0.1; it must be updated to 27.2.1 |
| 2 | Purpose and audience | **COMPLETED** | `APP_REVIEW_NOTES.md` §A and §B.2: a communication and coordination app; students, parents and teachers; lessons on Zoom outside the app; public enrolment |
| 3 | Setup and reviewer access | **COMPLETED** (instructions) / **BLOCKED** (owner runs the login check) | `REVIEWER_ACCESS.md`; `verify-review-logins.sh` |
| 4 | External services | **COMPLETED** | `EXTERNAL_SERVICES.md` (verified in the build-2 code; Zoom marked as outside the app) |
| 5 | Regional availability | **COMPLETED** | `REGIONAL_AVAILABILITY.md`: worldwide except China mainland (documented reasons: CallKit and ICP). EU trader checklist |
| 6 | Regulated industries and third-party material | **COMPLETED** | `APP_REVIEW_NOTES.md` §B.6 (Tanzil CC BY 3.0, OFL fonts, no recitation audio) |

## B. Blockers named in Apple's message

| Guideline | Status | Evidence / what remains |
|---|---|---|
| 2.1 bugs, crashes and journey | **VERIFIED (simulator, 21 steps)**; physical-device build, install and launch **VERIFIED** | `PHYSICAL_DEVICE_QA.md`. The full physical run is the owner's recording |
| 2.1 access | **COMPLETED** | No OTP or verification for the review accounts |
| 1.2 report and block | **VERIFIED (simulator)** | S-8 to S-14 (API 201 and 204) |
| 1.2 moderation operational | **BLOCKED (owner)** | Name the owner (Super Admin) and one backup manager (`APPLE_REVIEW_AUDIT.md` G-11) |
| 1.2 Terms acceptance (zero tolerance) | **VERIFIED (local, end to end)** / **BLOCKED (owner: production)** | PR #497 with launch scope (family Terms only; head `03b8bc056`). Local proof: `reports/AR-H-terms-gate-e2e.md`. Merged (`78435d64`). The owner procedure (SQL, then one deploy) is in §D step 2 |
| 2.3.3 screenshots | **COMPLETED** | 4 per language and size: 01 chats, 02 family group, 03 calls, 05 settings. 04 Packages is optional (shows "(demo)") |
| 3.1.1 / 3.1.3(d)(e) | **NOT APPLICABLE** (IAP) | Live one-to-one lessons on Zoom; nothing digital sold or unlocked; no StoreKit; bank transfer; card paused |
| 3.2 business model | **COMPLETED** | Public enrolment framing; PR #613 enrol link in build 3 |
| Marketing URL | **COMPLETED** (decision) | Leave empty in App Store Connect |

## C. Governance

No production write, deploy, merge, upload or resubmission by the agent. No protected project touched. No secret in
Git. Every PR is green: #613, #497 and #614, each 30/30.

## D. The owner's sequence: fastest path to resubmission

Do steps 1 to 3 in any order. They can run at the same time.

1. **Phone (now; the update takes about 20-30 minutes):** Settings > General > Software Update > install iOS
   **27.2.1**.
2. **Terms gate and legal-page e-mail live** (#497 merged `78435d64`, #615 merged `8a04dc60`; launch scope: family
   Terms only, your decision of 2026-11-19). Verified read-only on 2026-11-19:
   - Production runs `2e4127015`, and its deploys log `skip 20261107110000_chat_pd058_terms`. So the Terms tables and
     **`chat.publish_legal_version` already exist in production**. The only new migration is
     `20261117110000_chat_pd058_publish_order`; it numbers any version rows already there.
   - Therefore **one** production deploy suffices, with the SQL run **before** it. The running API (`2e4127015`) does
     not read these rows, and build 2's gate stays inert until the new API sends the `legal` block.

   **2a. Build the images (Deploy staging).** `gh workflow run deploy-staging.yml --ref main`, dispatched while
   `main` is `8a04dc6065fb170ba15b9fff029c8160d360c7f8`; the image tag is blank, so it builds that commit. Expected:
   - Job **"Build and publish images"** succeeds. It pushes `api:8a04dc60…` and records the `api-image-digest`
     artifact.
   - Job **"Deploy to staging"** fails at "The deploy credentials are present". The staging environment has never
     been provisioned: it holds only the LiveKit secrets, and none of its 35 runs has deployed.
   - The production preflight needs only that artifact, as for `2e4127015` (staging run 44277928325, build success,
     deploy failure).

   **2b. Production database (owner): put the family terms in force.** These values come from
   `docs/legal/published-versions.json` and are not secret:
   ```sql
   select chat.publish_legal_version('terms_family', '1.0',
     'https://admin.chat.jawwid.com/legal/ar/terms/1.0', 'https://admin.chat.jawwid.com/legal/en/terms/1.0',
     '41f366d2eae85ac9a5750cbbeec25a935d02dee00ca3627742e98f766f18bace',
     '907d5f65b9e158a2d59f837ad7d3810df690c1e27d6cd1ba2335919c69979c4c', true);
   insert into chat.config (key, value, scope, description)
   values ('legal.current.terms_family', to_jsonb('1.0'::text), 'legal', 'PD-58: the family terms in force')
   on conflict (key) do update set value = excluded.value, updated_at = now();
   ```
   - Statement 1 records version 1.0 of the family Terms in the append-only `chat.legal_document_version`: its two
     URLs, the SHA-256 of each page, and "requires acceptance". Running it again with the same values does nothing.
   - Statement 2 puts that version in force.

   Check, read-only, with `main`'s script:
   `DATABASE_URL=... python3 -I scripts/infra/production-setup.py legal`. It must exit 0, with
   `legal.current.terms_family  set: '1.0'` and the other three "not set: not yet in force".

   **2c. Deploy production:** Actions > Deploy production, `image_tag` = `8a04dc6065fb170ba15b9fff029c8160d360c7f8`,
   `confirm` = `DEPLOY`, then approve. The workflow:
   - takes a backup;
   - applies `20261117110000` only;
   - releases the new API (it starts, because `terms_family` is set);
   - releases the production Admin Web image, built from `8a04dc60`, which carries #615;
   - runs the smoke test.

   **2d. Check after the deploy:**
   - `curl -sI https://admin.chat.jawwid.com/legal/en/terms/1.0 | grep -i cache-control` shows `no-cache, no-transform`.
   - `curl -s https://admin.chat.jawwid.com/legal/en/terms/1.0 | grep -c info@jawwid.com` returns `7`.
   - `curl -s https://admin.chat.jawwid.com/legal/en/terms/1.0 | shasum -a 256` starts with `907d5f65`.
   - Sign in as the review parent on the phone: "Before you continue" appears. Before Agree, a report is refused;
     after Agree, it works.
   - A teacher or staff sign-in is not asked anything.

   **Rollback, if needed:**
   - API or Admin Web: Deploy production with `image_tag` = `2e4127015…`. That is the previous release; it ignores
     the legal rows and works with the new column.
   - The gate alone: delete the `legal.current.terms_family` row. Only do this after rolling back the API: the new
     API refuses to start without the row.
   - Migration (rarely needed): `psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261117110000_chat_pd058_publish_order.down.sql`,
     only with the old API.
   - Acceptance and version rows are consent records. Never delete them.
3. **Moderation:** confirm that you (Super Admin) and one named operations manager can open Admin Web `/moderation`.
4. **Build 3:**
   - Approve and merge PR #613, and #614 (documentation).
   - Approve the release run. The lead starts it on request:
     `gh workflow run release-store-builds.yml -f ref=<new main SHA> -f platform=ios -f build_name=1.0.0 -f build_number=4`.
     The `store-release` environment needs the owner's approval.
   - It uploads to App Store Connect / TestFlight. It does not submit.
5. **Install** 1.0.0 (4) from TestFlight on the updated iPhone. Remove the old developer build first.
6. **Record** following `SCREEN_RECORDING_SCRIPT.md`. AirDrop the video to
   `~/jawwid-evidence/apple-review-2026-11-19/recording/`.
7. **Restore the deletion-test account:** run the Review cohort workflow (owner approval). Then run
   `bash ~/jawwid-orchestrator/bin/verify-review-logins.sh` and expect 3 x OK.
8. **App Store Connect:**
   1. Version 1.0: select **build 1.0.0 (4)**.
   2. Pricing and Availability: all countries and regions **except China mainland**. Business: complete the EU
      trader checklist (`REGIONAL_AVAILABILITY.md` §3).
   3. App Information: **Marketing URL empty**.
   4. Screenshots: delete the existing iPhone screenshots. Upload `store-shots/upload/final/1206x2622/{en,ar}/` (6.3") and `upload/final/1320x2868/{en,ar}/` (6.9"): 4 files each (01 chats, 02 family group, 03 calls, 05 settings), in English and Arabic.
   5. App Review Information: Sign-in = parent login and password; **Notes = `APP_REVIEW_NOTES.md` §A**, with the
      placeholders typed.
   6. App Review (Resolution Center): reply with **§B**, with the placeholders filled: `{{BUILD}}` = 1.0.0 (4) and
      `{{IOS_VERSION}}` = 27.2.1. **Attach the recording.**
9. **Resubmit** (owner's final approval).
