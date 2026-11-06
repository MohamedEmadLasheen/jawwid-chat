# Store readiness review: Google Play and App Store (final, 2026-11-03)

PR #447, branch `claude/store-release-readiness`, originally based on `main` @ `c7ca895c`, with
`main` merged in since. Its commits are listed in §10. Push notifications are not in this PR: they
are PRs #408, #411 and #449 (§2 and 3).

Nothing was uploaded, submitted, merged or deployed. Jawwid Core was not touched.

**Status key**
- **PASS**: verified on this Mac, with the evidence named.
- **FAIL**: a confirmed issue that must be fixed.
- **BLOCKED**: needs a device, a certificate, an account or external configuration.
- **N/A**: does not apply to this app.

Passing builds and tests are **not** treated as proof that the app is store-ready.

## Verdict

| Store | Recommendation | Why, in one line |
|---|---|---|
| **Google Play** | **NO-GO** | No production backend for reviewers. Android push cannot work until the owner's Firebase project exists. No report action for user content. The payments policy is unconfirmed. Nothing has run on an Android device. |
| **App Store** | **NO-GO** | No distribution certificate or App Store profile (export FAILS). No report action for user content (1.2). "Pay by card" vs 3.1.1. Teacher deletion needs contacting the academy (5.1.1(v)). No production backend. Nothing has run from a signed build on a device. |

## Prioritised blockers

| # | Blocker | Store | Type | Owner of the next step |
|---|---|---|---|---|
| 1 | No production backend (S-08): store builds have nothing to sign in to | both | BLOCKED | owner (infrastructure) |
| 2 | No way to report what users post: chat, stories, feedback (S-09; App Store 1.2, Play UGC policy) | both | FAIL | owner decision O-1, then engineering |
| 3 | "Pay by card" opens Stripe Checkout (S-10; App Store 3.1.1 / 3.1.3(d); Play Payments) | both | PASS (owner decision 2026-11-05: live 1:1 lessons only; residual risks R-1 to R-3) | `app-review-notes-payments.md` |
| 4 | Teacher deletion says "contact the academy" (`TEACHER_DELETION_BLOCKED`; App Store 5.1.1(v)) | App Store (Play also expects in-app deletion) | FAIL | owner decision O-3 |
| 5 | No iOS Distribution certificate and no App Store profile: `xcodebuild -exportArchive` fails | App Store | BLOCKED | owner (Apple account) |
| 6 | Firebase project, `google-services.json` and server `FCM_*`; APNs key on the server. Also reconcile the two push implementations (ship `674765a1`) and verify it | both (push) | BLOCKED | owner (credentials); engineering (reconcile, verify) |
| 7 | Demo accounts with data for review. Sign-up needs a WhatsApp code | both | BLOCKED | owner |
| 8 | Nothing tested on a device: notifications in all states, calls, permissions, signed builds (QA device domain: 24 of 27 rows NOT TESTED) | both | BLOCKED | release-qa with the owner |
| 9 | Store forms: privacy label / Data safety, age rating, target audience, availability (remove China mainland: CallKit), Sentry IP storage off | both | BLOCKED | owner, in the consoles |
| 10 | Calls do not ring while the app is closed (S-06): Android has no call UI; iOS is off on the server and never run on a device | both | FAIL / BLOCKED | engineering + owner |
| 11 | Open P3 defects a reviewer could see: TEACHER-020 (board header taps on iOS), PARENT-009 ("Active" next to "No subscription yet"), PARENT-010 (raw "parent") | both | FAIL | engineering |

## 1. Backend tests

| Check | Status | Evidence |
|---|---|---|
| API typecheck | PASS | `npx tsc -p tsconfig.json --noEmit`: exit 0 |
| API unit | PASS | `npx jest --selectProjects unit --maxWorkers=2` on the final code: 161 suites, 2289 tests. The FCM expectation was updated for the new `title`/`body`, and it failed before the change. |
| Migrations from empty, and re-apply is a no-op (G-19) | PASS | `scripts/db/apply.sh` twice on a private Postgres 17 (`jawwid-relrev-pg`) |
| DB gates | PASS | schema_acceptance, invariants, br1_invariants, story_rls, relationship_predicate, teacher_profile_rls |
| API integration | PASS (no genuine failure) | §1a |

### 1a. Integration
**Full run:** `npm run test:int -- --runInBand`, on a private Postgres 17 (`jawwid-relrev-pg`) and
Redis 7 (`jawwid-relrev-redis`), in 2581 s.
- Suites: 182 passed, 4 failed, 1 skipped (187).
- Tests: 3112 passed, 24 failed, 44 skipped.

Each failing suite was re-run on its own:

| Suite | First run | Cause | Re-run | Classification |
|---|---|---|---|---|
| `schema-invariants` | 20 failed: `spawnSync psql ENOENT` | The spec shells out to a host `psql`, and this Mac has none | PASS, with a `psql` shim into the container | **Environmental** |
| `role-capability-preflight` | failed | Same missing `psql`. A first shim dropped the role from the URL. | PASS, with a URL-preserving shim | **Environmental** |
| `realtime-delivery` | 2 failed, plus a hook timeout | It reads `REALTIME_TEST_REDIS_URL`, default port 6410 (CI's port), which was not set | PASS with it set | **Environmental** |
| `pd043-teacher-history-http` | 2 failed: event order | `audit_log.at`: Prisma-written rows take the app host's clock, SQL-written rows take the database's `now()`. The Docker VM clock runs ahead of the Mac's (measured 0.1–0.2 s; `test/setup-integration.ts` records 0.7 s on this machine), so events milliseconds apart swap order. Fails under `TZ=UTC` too. | still fails locally | **Environmental (clock skew)** |

Corroboration: CI run 41546170736, on the same commit `c7ca895c` this branch is based on, passed **186 of 186** integration suites, including all four above.

Scope note: the integration run started before the FCM `title`/`body` change (`fcm.provider.ts`). No integration spec configures FCM, since they use the logging provider. The change is covered by the unit suite, re-run on the final code: 161 suites, 2289 tests passed.

Low-risk note: in production the order of history events written within milliseconds depends on the app and database clocks agreeing. NTP keeps them within milliseconds, so the effect is cosmetic.

## 2 and 3. Ordinary push notifications

Push notifications are **not part of this PR.** They are three other PRs, which their owners
reconciled on 2026-11-03:
- **#408** (`claude/android-push-fcm`): the Android FCM base and the only call path;
- **#411**: the call foreground service, stacked on #408;
- **#449** (`claude/pd032-feedback-reply-notifications`): the iOS notification delegate, Dart tap
  routing, the server action ids, and the Android tap nonce and `PushPayload`.

A combined tree meeting the owner's acceptance criteria (permission explained and denial handled,
no duplicate notifications, calls and CallKit unchanged, every destination bound to the signed-in
account) was built and tested, and awaits the owner's decisions on landing it. Its evidence is
`docs/release/push-notification-acceptance.md` in that work, and the gates are S-05 and S-11 to
S-15 in `docs/qa/release-gate.md`. An earlier attempt on this branch was superseded and is not
included here.

No Android emulator or system image is installed on this Mac. The iOS simulator cannot be granted notification permission without someone tapping Allow, so runtime evidence must come from devices (test plan SB-04, SB-11 to SB-13).

## 4. iOS distribution signing

| Check | Status | Evidence |
|---|---|---|
| Bundle id `com.jawwid.jawwidChat`, team `KX683HAR3Y` (Jawwid LLC, Company, paid) | PASS | `project.pbxproj`; Xcode's team list; archive `TeamIdentifier=KX683HAR3Y` |
| Release archive | PASS | `xcodebuild archive … -configuration Release`: ARCHIVE SUCCEEDED, signed "Apple Development" |
| App Store export | **FAIL → BLOCKED** | `xcodebuild -exportArchive` (method `app-store-connect`, run without `-allowProvisioningUpdates` so nothing on the Apple account changed): `No signing certificate "iOS Distribution" found`; `No profiles for 'com.jawwid.jawwidChat' were found` |
| Development profile | PASS | "iOS Team Provisioning Profile: com.jawwid.jawwidChat". Push is enabled on the App ID; valid until 2027-10-17. |
| Release entitlement `aps-environment = production` | PASS (config); BLOCKED (signed IPA) | The archive shows `development`, because Xcode matches the development profile it signed with. The exported IPA must be checked with `codesign -d --entitlements -`. |
| Xcode 26.6, iOS 26.5 SDK, minimum iOS 15.0, iPhone only | PASS | built `Info.plist` (`DTSDKName iphoneos26.5`, `UIDeviceFamily [1]`) |

**To produce an App Store-ready archive.** All three steps are the owner's, on the Jawwid LLC team, as Account Holder or Admin:
1. Create an Apple Distribution certificate. Either Xcode → Settings → Accounts → Manage Certificates → +, or the Developer portal.
2. Get an App Store provisioning profile for `com.jawwid.jawwidChat` with Push. Automatic signing creates it on the first export with `-allowProvisioningUpdates`.
3. Create the app record in App Store Connect.

Then run `scripts/mobile/build-store.sh ios`, check the entitlement, and upload to TestFlight.

## 5. Google Play

| Check | Status | Evidence |
|---|---|---|
| AAB signed with an upload key, never the debug key | PASS (with a throwaway key) / BLOCKED (owner's key) | `keytool -printcert -jarfile`: `CN=review`. Without `key.properties` the build refuses. |
| Target API 36, compile 36, min 26 | PASS | Flutter 3.47.2 defaults; `minSdk = 26` |
| 16 KB page size | PASS | Every arm64-v8a and x86_64 `.so` has LOAD alignment 0x4000 or 0x10000 (`llvm-readelf -lW`). Two armeabi-v7a libraries are 0x1000; they are 32-bit and outside the rule. |
| Permissions | PASS | Merged release manifest: INTERNET, ACCESS_NETWORK_STATE, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS, POST_NOTIFICATIONS, USE_BIOMETRIC, USE_FINGERPRINT, WAKE_LOCK, c2dm RECEIVE. No sensitive-permission declaration is needed. |
| Exported components | PASS | `MainActivity` only. The messaging service is `exported=false`. |
| Backup | PASS | `allowBackup="false"` |
| Account deletion in the app, and a web URL | PASS (code) / FAIL (teacher block, #4) | Settings → Delete account. Public `GET/POST /account-deletion` (form token, rate limit). |
| Data safety form | BLOCKED (console) | Declare: name, e-mail, photos and videos, audio, other content, user id, device id, crash logs, approximate location (time zone). Shared with service providers only; encrypted in transit; deletion available. |
| Pre-launch report, internal testing track | BLOCKED (console, device) | |

## 6. App Store

| Check | Status | Evidence |
|---|---|---|
| Privacy manifest | PASS | In the bundle: no tracking. The collected types include crash data. Required-reason APIs: CA92.1, C617.1, 35F9.1. 18 SDK manifests are bundled. |
| Usage descriptions | PASS | Camera, photo library, photo-library add, microphone and Face ID, each in English and Arabic (a test enforces it). |
| Export compliance | PASS | `ITSAppUsesNonExemptEncryption = false` |
| Account deletion (5.1.1(v)) | PASS (parents) / FAIL (teachers, #4) | |
| Sign in with Apple (4.8) | N/A | No third-party sign-in |
| User content (1.2) | FAIL (#2) | |
| Payments (3.1) | FAIL (risk, #3) | |
| Completeness (2.1) | BLOCKED | Needs the production backend, demo accounts and a device run. Code sweep: every route builds a real screen; no placeholder, "coming soon", debug-only or TODO text; ARB key sets are identical; empty states exist. |
| Kids category (1.3) | N/A, if the owner does not choose it | |
| Background modes | PASS (code) / BLOCKED (device) | `voip` is backed by PushKit/CallKit, and a duplicate VoIP push now reports its call. `audio` is for calls. `remote-notification` is for push. |
| App Privacy label, age rating, review notes, China availability | BLOCKED (console) | |

## 7. Phase 2 materials

| Check | Status | Evidence |
|---|---|---|
| Reporting or feedback on learning materials | PASS: none exists, so there was nothing to remove | No UI and no endpoint (materials controller, play controller and the screens were audited). It is deferred to Phase 2 and not required for launch. Materials are published by the academy, so App Store 1.2 does not apply to them. |
| Other Phase 2 or postponed materials items reachable | PASS: none | Completion events, resume, achievements, points and levels (plan P1/P2) are not built and not exposed. The memorization-map endpoints remain on the server, but the app never calls them. |
| Launch materials (library, "Opened this week", player, lesson-report Practice) | PASS (code) | Finished, with loading, empty and error states |
| Risks | BLOCKED (owner) | The Materials tile always shows in store builds: publish content before review. Set `LESSONS_ORIGIN` so lessons have recitation audio. |
| `feedbackShortcutProblem` "Report a problem" | N/A | The PD-52 teacher-feedback shortcut (a complaint), not about materials. Kept. |

## 8. Whole-app sweep

| Check | Status |
|---|---|
| Routes, dead buttons, placeholders, debug features, ARB parity | PASS (code audit) |
| Release builds start and cannot fall back to test data | PASS (code, `bootstrap.dart`) |
| Crash risks found and fixed on this branch: "Save Image" without `NSPhotoLibraryAddUsageDescription`; a duplicate VoIP push left unreported | PASS (fixed and guarded by tests) |
| Open defects: TEACHER-020, PARENT-009, PARENT-010, PARENT-016, PARENT-024; fixes awaiting retest (#423, #433, #440) | FAIL / BLOCKED (retest) |
| Router has no `errorBuilder` (go_router's default English "Page Not Found") | Low; reachable only through a bad route, and push routes are built from fixed patterns |
| On-device QA | BLOCKED: 24 of 27 device rows NOT TESTED |

## 9. Flutter and native tests

| Suite | Status | Evidence |
|---|---|---|
| Flutter, all (this PR's final head) | see PR #447 | `flutter test --concurrency=2`. The result for the final head is in the PR description (local run) and CI's "Mobile · Flutter analyze + tests" job. On the earlier local branch: 2462 passed, 25 skipped, 0 failed. |
| `flutter analyze` | PASS for this branch's files; 2 infos already on `main` | |
| Android release AAB | PASS (on `c4a0bb75`, 2026-11-03) | `build-store.sh android`, with a throwaway key, deleted afterwards. Not rebuilt for the later commits, which change no Android file. |
| iOS release build and archive | PASS | `flutter build ios --release --no-codesign`; `xcodebuild archive` |
| Native unit tests | N/A | Android has none; iOS `RunnerTests` is Flutter's empty template |

## 10. What changed on this branch

| Commit | Change |
|---|---|
| `c4a0bb75` | iOS notification authorization; crash data in the manifest; `SENTRY_DSN` passed through; `allowBackup=false` |
| `48814144` (cherry-pick of `928089ab`) | `NSPhotoLibraryAddUsageDescription` (English and Arabic); a duplicate VoIP push re-reported; S-09 scoped to user posts, with materials reporting deferred to Phase 2 |
| the docs commit | This report and the release gate (S-01 to S-15, §2c) |
| the merge of `main` | brings the branch up to date |
