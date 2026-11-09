# Signed store builds in GitHub Actions, uploaded directly (LR-76 option (c), OT-2b)

**Workflow:** `.github/workflows/release-store-builds.yml` ("Release store builds").
**Risk:** High. The workflow holds signing material and can upload to both stores' **testing** channels.
It is a Code Owner path: the owner approves the merge. **No key, account or cloud resource exists or is
created by this change.** Creating each one in §3 is a separate owner decision.
**Background:** `docs/release/signed-build-options.md` (option (c), the GitHub facts H1–H9) and
`docs/release/signing-on-existing-mac.md` (C1: cloud signing with an App Store Connect key).

**What changed in OT-2b.** The first version (#547) encrypted each build with `age` and left it as a
GitHub artifact for the owner to upload by hand. That is gone: no build output is kept as a GitHub
artifact any more. Instead, after the same checks and signature verification, the workflow uploads the
debug symbols to Sentry and then the build itself, **only** to:
- **Google Play: the internal testing track, as a draft release** (nobody receives it until a person
  releases it in Play Console), signed in through **Workload Identity Federation** (no Google key exists);
- **App Store Connect / TestFlight**, through `xcodebuild -exportArchive` with destination `upload`
  (Apple cloud signing). Nothing is sent for App Review and nothing is released.

## 1. What it does

Started by hand (`workflow_dispatch`) from `main`, with four inputs:

| Input | Meaning |
|---|---|
| `ref` | the full 40-character SHA of a commit **already on `main`** |
| `platform` | `both`, `android` or `ios` |
| `build_name` | the version users see, `x.y.z` (`BUILD_NAME`) |
| `build_number` | a positive integer higher than the last upload to either store (`BUILD_NUMBER`) |

1. **Preflight** (no Environment, no secrets; token permissions `contents: read` and `actions: read`):
   refuses unless
   - the run started from `main`, `ref` is a full SHA that is an ancestor of `origin/main`, and the
     version inputs are well-formed;
   - the `store-release` Environment, read through the API, has at least one required reviewer,
     *Selected branches and tags* with exactly one rule, the branch `main`, and "Allow administrators to
     bypass" **off**. Anything it cannot read, or does not recognise, is a refusal.

   A bad request, or an Environment that is missing or unprotected, fails before anyone is asked to
   approve it.
2. **Android** (`ubuntu-latest`, Environment `store-release`; the **only** job with `id-token: write`):
   waits for the owner's approval, then
   - checks out the build commit, and separately the upload helpers (`scripts/mobile/`) from the
     workflow's **own** commit on `main`, so the helpers that talk to the stores are always the current,
     CI-guarded ones even when an older commit is built;
   - **before any build**, fails naming each one if a secret or variable of §3.6 is missing, or if
     `PLAY_WIF_PROVIDER`, `PLAY_SERVICE_ACCOUNT`, `SENTRY_ORG`, `SENTRY_PROJECT` or `SENTRY_URL` is not in
     its expected format;
   - decodes the upload keystore and `google-services.json`, checks them, writes `android/key.properties`
     (all mode 600, as before);
   - runs `scripts/mobile/build-store.sh android`;
   - verifies the `.aab` (`jarsigner -verify`; exactly one signer, the upload key; the optional
     `ANDROID_UPLOAD_CERT_SHA256` pin) and writes its SHA-256 into the summary;
   - installs **sentry-cli 3.8.2**, checked against its pinned SHA-256 (`scripts/mobile/install-sentry-cli.sh`),
     and uploads the Dart symbols (and the R8 `mapping.txt`, if the build wrote one) to Sentry. This runs
     **before** the store upload, so a broken Sentry setup stops the release rather than shipping a
     build whose crashes cannot be read;
   - signs in to Google with `google-github-actions/auth` (v3.0.0, pinned by SHA): GitHub's OIDC token
     for this job is exchanged for a **15-minute** access token of the Play service account, scope
     `androidpublisher` only, no credentials file written. The token is masked;
   - runs `scripts/mobile/play-upload.sh`, which does `edits.insert` → `edits.bundles.upload` →
     `edits.tracks.update` (track `internal`, one release `{versionCodes: [<build_number>], status:
     "draft", name: "<build_name> (<build_number>)"}`) → `edits.commit`. It checks that Play read the
     expected versionCode and the same SHA-256 as the verified file, and that the track answer is exactly
     that one draft release. On any failure it deletes the edit (best effort) and exits non-zero: nothing
     is published;
   - always deletes the signing material, even after a failure.
3. **iOS** (`macos-26`, Xcode 26 selected explicitly, Environment `store-release`): waits for approval, then
   - the same two checkouts and the same before-any-build check of its secrets and variables (§3.6);
   - decodes the App Store Connect `.p8` key (mode 600) and checks it parses as a private key;
   - runs `scripts/mobile/build-store.sh ios-config` (§5);
   - `xcodebuild archive`, then `xcodebuild -exportArchive` to a **local** `.ipa` (method
     `app-store-connect`, destination `export`), both with `-allowProvisioningUpdates` and
     `-authenticationKeyPath/-ID/-IssuerID`, so Apple **cloud-signs**;
   - verifies that `.ipa` exactly as before: `codesign --verify --deep --strict`; a distribution
     certificate; team `KX683HAR3Y`; `get-task-allow` false; `aps-environment` production; an App Store
     profile (no device list); bundle id, version and build number; Dart symbols and dSYMs present;
   - installs sentry-cli (as above) and uploads the archive's dSYMs and the Dart symbols to Sentry;
   - **uploads**: a second `xcodebuild -exportArchive` of the **same archive** with the same method, team
     and signing style and destination `upload`, plus `uploadSymbols` true and
     `manageAppVersionAndBuildNumber` false (Xcode must not change the version or build number). Apple
     cloud-signs it again and sends it to App Store Connect, where it is processed for TestFlight;
   - always deletes the `.p8`, the build logs and the outputs.

   *Why two exports.* `xcodebuild -exportArchive` cannot upload an `.ipa` that has already been exported;
   it uploads only what it exports itself. The only other Apple command-line uploader is not used here
   by decision. So the job verifies the local export, and the upload is a re-export of the same archive
   with identical options except the destination. The app binary, entitlements source, team, bundle id
   and version are the archive's in both; only the cloud signature is made a second time. The residual
   risk (Apple signing the second export differently) is small and visible: App Store Connect rejects an
   upload whose signature is not a valid App Store distribution signature.

Both signing jobs install Flutter **without** the shared cache (`cache: false`). Every action is pinned
to a full commit SHA. Inputs reach the shell only through `env`, never inside a `run` script.

## 2. What it does not do

- It does **not** publish anything to users or testers by itself. On Play the release is a **draft** on
  the **internal** track; on Apple the build lands in App Store Connect/TestFlight and is never sent for
  App Review or released. Any other track, status, staged release, review submission or release call is
  refused by `scripts/qa/check-store-upload-guards.sh` (§5.2), which CI runs on every change.
- It keeps **no build output as a GitHub artifact**.
- It does **not** create, rotate or download any key, certificate or profile on its own behalf, except
  what `xcodebuild -allowProvisioningUpdates` does in the Apple account (§6, risk 5).
- It never runs on a pull request, a push, a schedule or another workflow's completion.
- It does not tag the commit or record the release anywhere but the run summary.

## 3. OWNER SETUP (each item only after you approve it)

Do every step in a browser, or in **Google Cloud Shell** for the `gcloud` lines. **Never on the
development Mac** (the machine rule). Replace `<…>` with your values.

### 3.1 The `store-release` Environment

Settings → Environments → **New environment** → `store-release`. **If `store-release` is already in the
list, open it and edit it instead**: GitHub creates an Environment by itself, with no protection at all,
the first time any run names it, so an existing one proves nothing. Confirm all of these before you add
any secret:
- **Required reviewers:** yourself.
- **Prevent self-review:** see "Who starts a run" below.
- **Deployment branches and tags:** *Selected branches and tags* → exactly one rule, the branch `main`.
- **Deselect "Allow administrators to bypass configured protection rules".**

The preflight reads these three settings and refuses to run without them. That check is **UNVERIFIED**
until the first run (it was not run under the machine rule). If the first run stops with "Could not read
the store-release Environment with the job token" although the Environment exists, check the settings by
eye, tell the lead, and do not approve a run while that check fails.

Put every secret and variable of §3.6 in **this Environment**, never in repository secrets: Environment
secrets are released only after your approval, and only to runs from `main`.

**Who starts a run:** with Prevent self-review **on**, you cannot approve a run you started, so a run is
dispatched by `jawwid-bot` (asked by the lead) and approved by you. The lead recommends **on**.

### 3.2 (a) Google Cloud: Workload Identity Federation for the Play upload

No JSON key is ever created. GitHub proves who is asking with a short-lived OIDC token; Google accepts
it only for this repository, the `store-release` Environment and `main`.

1. Create (or pick) a Google Cloud project, then in Cloud Shell:
   ```sh
   PROJECT_ID=<project id>
   gcloud config set project "$PROJECT_ID"
   PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
   # "Google Play Android Developer API", plus the APIs the token exchange uses.
   gcloud services enable androidpublisher.googleapis.com iam.googleapis.com \
     iamcredentials.googleapis.com sts.googleapis.com
   ```
2. A service account with **no IAM roles** (do not grant it any project role; Play permissions come only
   from Play Console, step (b)):
   ```sh
   gcloud iam service-accounts create jawwid-play-upload \
     --display-name="Jawwid Play internal upload (GitHub Actions)"
   ```
3. A Workload Identity Pool and an OIDC provider for GitHub, with the attribute mapping and the
   **attribute condition** (the condition is the real lock: a token from any other repository,
   Environment or branch is refused at the exchange):
   ```sh
   gcloud iam workload-identity-pools create github \
     --location=global --display-name="GitHub Actions"
   gcloud iam workload-identity-pools providers create-oidc jawwid-chat \
     --location=global --workload-identity-pool=github \
     --display-name="jawwid-chat store-release" \
     --issuer-uri="https://token.actions.githubusercontent.com" \
     --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.environment=assertion.environment,attribute.ref=assertion.ref" \
     --attribute-condition="assertion.repository=='MohamedEmadLasheen/jawwid-chat' && assertion.environment=='store-release' && assertion.ref=='refs/heads/main'"
   ```
4. Let identities from that repository impersonate the service account:
   ```sh
   gcloud iam service-accounts add-iam-policy-binding \
     "jawwid-play-upload@$PROJECT_ID.iam.gserviceaccount.com" \
     --role=roles/iam.workloadIdentityUser \
     --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/MohamedEmadLasheen/jawwid-chat"
   ```
   The binding names only the repository; the Environment and branch are enforced by the provider's
   condition (step 3), which every token must pass first.
5. The two Environment **variables** (not secrets):
   - `PLAY_WIF_PROVIDER` = `projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/github/providers/jawwid-chat`
   - `PLAY_SERVICE_ACCOUNT` = `jawwid-play-upload@<PROJECT_ID>.iam.gserviceaccount.com`

**UNVERIFIED:** that GitHub's OIDC token for a job with `environment: store-release` carries the
`environment` claim used by the condition (GitHub documents it; not observed under the machine rule. If
the first run fails at "Sign in to Google" with a condition or "unauthorized" error, this is the first
thing to check). **UNVERIFIED:** that `roles/iam.workloadIdentityUser` alone lets the auth action mint
an access token; if the error names `iam.serviceAccounts.getAccessToken`, also grant
`roles/iam.serviceAccountTokenCreator` on the service account to the same `principalSet` (tell the lead
first).

### 3.3 (b) Play Console

1. Play Console → **Users and permissions** → **Invite new users** → the service account's e-mail
   (`jawwid-play-upload@<PROJECT_ID>.iam.gserviceaccount.com`).
2. **Account permissions: none.** Under **App permissions** → **Add app** → `com.jawwid.jawwid_chat` →
   tick **only "Release apps to testing tracks"**. Invite.
3. The app must exist in Play Console with the package `com.jawwid.jawwid_chat`.

**UNVERIFIED:** that "Release apps to testing tracks" alone allows the edits flow on the internal track
(it is the narrowest permission that names testing releases). **UNVERIFIED:** that Google requires the
**first** bundle of a new app to be uploaded by hand in Play Console; if so, the job stops with
`STOP: Google requires a first manual upload; do NOT do it from the development Mac; tell the lead`, and
the lead arranges that first upload as a separate, owner-approved step (this workflow keeps no copy of the
bundle). **UNVERIFIED:** that Play accepts only `draft` releases while the app has never been published
(the workflow only ever sends `draft`, so this does not block it), and how a track update treats
releases already on the internal track (a draft changes nothing for testers either way).

To release a draft to internal testers: Play Console → the app → Testing → Internal testing → the draft →
review and release it.

### 3.4 (c) Apple: App Store Connect

1. App Store Connect → Users and Access → Integrations → App Store Connect API → **Team Keys** → generate
   a key with access **App Manager**. The `.p8` downloads **once**. A team key needs Account Holder or
   Admin to create, and its access level cannot be changed afterwards.
2. The app record for bundle id `com.jawwid.jawwidChat` must exist in App Store Connect (My Apps → +);
   an upload for an unknown app is refused.
3. **For every version**, before it is ever submitted: the version page → **App Store Version Release** →
   **"Manually release this version"**. Then even an approved version waits for a person to release it.
4. TestFlight: an internal testing group with automatic distribution receives new builds when processing
   finishes; turn automatic distribution off on the group if builds should wait for a person.

**UNVERIFIED:** that an **App Manager** key is enough for cloud signing at archive and export (Apple's
cloud-managed distribution certificate needs Admin, Account Holder or the "Access to Cloud Managed
Distribution Certificate" permission). If the first run fails at archive or export with a permission
error, revoke the key and make an **Admin** key; that is a much bigger secret (an Admin key can manage
users), so tell the lead first.

### 3.5 (d) Sentry

1. A Sentry project for the app, slug **`jawwid-chat-app`** (platform Flutter). Its **DSN** goes in the
   secret `SENTRY_DSN` (it is compiled into the app).
2. An **organisation auth token** (Settings → Developer Settings → Organization Tokens), which can only
   create releases and upload source maps and debug files; it goes in the secret `SENTRY_AUTH_TOKEN`.
   Never a personal token.
3. Variables: `SENTRY_ORG` = the organisation slug, `SENTRY_PROJECT` = `jawwid-chat-app`, and only for a
   self-hosted Sentry `SENTRY_URL` = `https://<host>/`.

**UNVERIFIED:** the sentry-cli 3.x command names `debug-files upload` and `upload-proguard` (the 2.x names,
not re-read for 3.8.2 under the machine rule). If one has changed, the job fails at the symbols step,
**before** any store upload.

### 3.6 (e) The Environment's secrets and variables

Secrets (you paste every value yourself in the GitHub UI):

| Secret | Platform | What it is |
|---|---|---|
| `ANDROID_UPLOAD_KEYSTORE_BASE64` | Android | the upload keystore, base64 on one line (`base64 -i upload.jks` on a Mac) |
| `ANDROID_UPLOAD_KEYSTORE_PASSWORD` | Android | its store password (letters and digits only) |
| `ANDROID_UPLOAD_KEY_ALIAS` | Android | the key's alias (`jawwid-upload`) |
| `ANDROID_UPLOAD_KEY_PASSWORD` | Android | the key's password (letters and digits only) |
| `GOOGLE_SERVICES_JSON_BASE64` | Android | Firebase `google-services.json` for `com.jawwid.jawwid_chat`, base64 on one line |
| `ASC_API_KEY_ID` | iOS | App Store Connect API key ID |
| `ASC_API_ISSUER_ID` | iOS | the issuer ID shown above the keys list (a UUID) |
| `ASC_API_KEY_P8_BASE64` | iOS | the downloaded `AuthKey_<ID>.p8`, base64 on one line |
| `SENTRY_DSN` | both | the app's Sentry DSN |
| `SENTRY_AUTH_TOKEN` | both | the Sentry organisation auth token (§3.5) |

Variables (not secret):

| Variable | Platform | Value |
|---|---|---|
| `API_BASE_URL`, `PRIVACY_POLICY_URL`, `TERMS_URL`, `SUPPORT_URL`, `SUPPORT_EMAIL` | both | what `scripts/mobile/build-store.sh` reads (`docs/mobile/store-builds.md`) |
| `SENTRY_ORG`, `SENTRY_PROJECT` | both | §3.5 |
| `PLAY_WIF_PROVIDER`, `PLAY_SERVICE_ACCOUNT` | Android | §3.2 step 5 |
| `LESSONS_ORIGIN`, `SENTRY_ENVIRONMENT`, `SENTRY_URL` | both, optional | lesson audio origin; Sentry environment (default `production`); self-hosted Sentry only |
| `ANDROID_UPLOAD_CERT_SHA256` | Android, optional | the upload certificate's SHA-256 as Play Console shows it; any other signer then fails |

`STORE_ARTIFACT_AGE_RECIPIENT` is no longer used; delete it from the Environment if it was created.

How to make the keystore, `google-services.json` and the Apple key is unchanged from #547: see
`docs/mobile/android-release-signing.md` (keystore on a trusted device, never the development Mac) and
§3.4 above.

## 4. Running it

1. The lead (as `jawwid-bot`) dispatches the run from `main` with the commit, platform and version.
2. You review the pending run (Actions → the run → **Review deployments**): check the commit, the version
   and the Environment settings in the Preflight summary, then approve `store-release`.
3. When it is green:
   - **Android:** Play Console → Testing → Internal testing shows a **draft** named
     `<build_name> (<build_number>)`. Compare its SHA-256 and upload certificate with the run summary,
     then release it to internal testers yourself.
   - **iOS:** App Store Connect → TestFlight shows the build once Apple has processed it.
   - **Sentry:** the symbols are already uploaded.
4. The first runs should be `platform: android` (fully checkable) and then `platform: ios`, to settle the
   UNVERIFIED points of §3 and §6.

## 5. The scripts, the guard and the tests

- **`scripts/mobile/build-store.sh`** (unchanged here): `ios-config` runs every check and then
  `flutter build ios --release --config-only` with the same version, symbols path and dart-defines as
  `ios`; `xcodebuild archive` then compiles with those values. A commit older than `ios-config` stops the
  iOS job with a clear message.
- **`scripts/mobile/play-upload.sh`**: the Play edits flow above. The package
  (`com.jawwid.jawwid_chat`), track (`internal`) and status (`draft`) are `readonly` constants; it refuses
  to start if any `PLAY_*` variable other than `PLAY_ACCESS_TOKEN`, or `PACKAGE_NAME`, `TRACK`,
  `RELEASE_STATUS` or `USER_FRACTION`, is set. The token comes from the environment only, is removed from
  it before any other program starts, reaches curl on stdin (`-K -`), and is never printed; curl runs with
  `-sS --fail-with-body`, and only HTTP status codes and Google's error status/reason codes are printed,
  never headers or message text. A Google "package not found" style answer prints the STOP message (§3.3).
- **`scripts/mobile/install-sentry-cli.sh`**: downloads sentry-cli 3.8.2
  (`sentry-cli-Linux-x86_64` / `sentry-cli-Darwin-universal`) from its GitHub release and refuses it
  unless its SHA-256 is the pinned one.

### 5.1 Bumping sentry-cli

Change `SENTRY_CLI_VERSION` and both SHA-256 values in `scripts/mobile/install-sentry-cli.sh` together,
copying each asset's `sha256:` digest from `github.com/getsentry/sentry-cli/releases`. A download whose
hash differs is refused.

### 5.2 The guard: `scripts/qa/check-store-upload-guards.sh`

Run by CI on every change, inside the `app-icons` gate of `scripts/qa/guards.sh` (the PD-56 store-build
gate; no new gate id). Its `selftest` first proves every rule can fail, by mutating copies of the real
files. It fails if:
- the workflow has any trigger but `workflow_dispatch`;
- any job but `android` has `id-token: write`, the workflow default permissions are not exactly
  `contents: read`, or `write-all` appears;
- `play-upload.sh`'s constants are not exactly `com.jawwid.jawwid_chat` / `internal` / `draft`, are
  assigned more than once, read in or defaulted from anything, not used by its URLs and request body, or
  its override refusal is gone;
- any of `production`, `beta`, `alpha`, `rollout`, `completed`, `altool`, `iTMSTransporter`, `submit…`,
  `appStoreVersionSubmissions`, `reviewSubmissions`, `releaseType` appears in the workflow or
  `scripts/mobile/` (plus `inProgress`, `halted`, `userFraction` in `play-upload.sh`), except on three
  listed workflow lines (the Sentry environment default, the `aps-environment` check, the Xcode selection
  that skips pre-release Xcode) and the word `production` in `build-store.sh` (its production-host check);
- `upload-artifact` appears;
- an action is not pinned to a full commit SHA;
- an expression (`${{ … }}`) is written inside a `run` block;
- a script in `scripts/mobile/` other than `play-upload.sh` talks to the Play Developer API, or anything
  calls the App Store Connect API directly.

### 5.3 Tests

`test/scripts/play_upload_script_test.dart` runs the real `play-upload.sh` with bash against a stand-in
`curl` that records every call and answers like Google: the happy path makes exactly insert → upload →
tracks.update (internal, draft, the right name and versionCode) → commit, each with the token on stdin;
every override is refused before any call; the token never appears in the output, on a curl command line
or in curl's environment; a failing upload, track update or commit deletes the edit and exits non-zero;
a versionCode mismatch is refused; the "package not found" answer prints the STOP message. It also checks
`install-sentry-cli.sh` refuses a download with the wrong SHA-256.
`test/scripts/build_store_script_test.dart` still covers `build-store.sh`.

## 6. Risks and unverified points

1. **Secrets in GitHub.** The keystore, its passwords, the `.p8` and the Sentry auth token live in
   Environment secrets of a public repository. No Google key exists at all. Mitigations: Environment-only
   secrets, owner approval, `main` only, no admin bypass (read back by preflight), manual trigger only,
   every action pinned by SHA, inputs only through `env`, `persist-credentials: false`, no Flutter cache,
   the guard of §5.2.
2. **Google access.** `id-token: write` is on the Android job only. A Google token is minted only for a
   job of this repository, in `store-release`, on `refs/heads/main` (the provider condition), after your
   approval; it lives 15 minutes and carries only the `androidpublisher` scope. In Play Console the
   service account can release to testing tracks only; the script can only make an internal draft.
3. **Apple access.** The App Store Connect key can do whatever its role allows (App Manager can submit
   for review and release versions in App Store Connect). The workflow never does: it only runs
   `xcodebuild` archive/export, and the guard refuses any submission or release call. "Manually release
   this version" (§3.4) is the second lock.
4. **Logs.** Logs are readable by any logged-in GitHub user. Values pass through `env`, are never echoed,
   and the scripts never use `set -x`. The `xcodebuild` logs (they list the base64 dart-defines that carry
   the Sentry DSN) stay on the runner; only error lines are printed. `play-upload.sh` prints only status
   codes. No build output is kept as an artifact.
5. **Apple, UNVERIFIED until the first run:** that Xcode 26 still cloud-signs with the WWDC21 flags; that
   the archive's development signing works on a runner with no Apple account (`-allowProvisioningUpdates`
   may create development certificates that accumulate; revoke the CI-created ones periodically); that
   App Manager is enough (§3.4); that `-exportArchive` with destination `upload` accepts the
   `-authenticationKey*` flags and the `uploadSymbols` / `manageAppVersionAndBuildNumber` keys as used;
   that `--split-debug-info` is honoured through `--config-only` (the job fails clearly if not).
   **If the iOS job fails:** read the printed `error:` lines; "No Accounts"/"not authorized" points to the
   key's role; "No profiles"/"requires a provisioning profile" to provisioning; "already been uploaded" or
   "bundle version" to a reused `build_number`. Fix it in the Apple account; never weaken the verification.
6. **Google, UNVERIFIED until the first run:** the `environment` claim (§3.2), the token permission
   (§3.2), the Play permission, the first-upload rule and draft-only behaviour (§3.3).
7. **Code that runs with the secrets.** After approval, the build commit's build scripts, Gradle, Swift
   packages, Flutter and pub packages run with the signing secrets in reach. Review the commit you approve.
   The upload helpers come from the workflow's own commit (§1).
8. **Cost:** standard GitHub-hosted runners, including `macos-26`, are free for a public repository (H1;
   the macOS wording is UNVERIFIED there). The Google Cloud project, Workload Identity Federation and the
   Play Developer API have no charge for this use (UNVERIFIED; check the project's billing page).

## 7. Not run locally

Written under the machine rule: no workflow, script, test or build was run. CI (the guard's selftest and
check, and the Dart tests) and the first approved runs are the evidence.
