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
- **App Store Connect / TestFlight**: one cloud-signed export to a local `.ipa`, which is verified and
  hashed; Apple's `altool` then uploads **that exact file**, in an upload mode only, after its SHA-256
  is checked again. Nothing is sent for App Review and nothing is released.

## 1. What it does

Started by hand (`workflow_dispatch`) from `main`, with four inputs:

| Input | Meaning |
|---|---|
| `ref` | the full 40-character SHA of **the head of `main`** when the run is started (the commit the workflow itself runs from; an older commit is refused, see §6 risk 7) |
| `platform` | `both`, `android` or `ios` |
| `build_name` | the version users see, `x.y.z` (`BUILD_NAME`) |
| `build_number` | a positive integer higher than the last upload to either store (`BUILD_NUMBER`) |

1. **Preflight** (no Environment, no secrets; token permissions `contents: read` and `actions: read`):
   refuses unless
   - the run started from `main`, `ref` is a full SHA that is an ancestor of `origin/main` **and equals
     `GITHUB_SHA`** (the head of `main` at dispatch, the workflow's own commit: P2-1, §6 risk 7), and the
     version inputs are well-formed;
   - the run's own identity, read from the runner (not from any token), is exactly: repository id
     `1362573850`, owner id `183662661`, repository `MohamedEmadLasheen/jawwid-chat`, ref
     `refs/heads/main`, workflow ref
     `MohamedEmadLasheen/jawwid-chat/.github/workflows/release-store-builds.yml@refs/heads/main`. These
     are the values Google's provider condition pins (§3.2); the Android job asserts them again before it
     signs in;
   - the `store-release` Environment, read through the API, has at least one required reviewer,
     *Selected branches and tags* with exactly one rule, the branch `main`, and "Allow administrators to
     bypass" **off**. Anything it cannot read, or does not recognise, is a refusal.

   A bad request, or an Environment that is missing or unprotected, fails before anyone is asked to
   approve it.
2. **Android** (`ubuntu-latest`, Environment `store-release`; the **only** job with `id-token: write`):
   waits for the owner's approval, then
   - checks out the build commit, and separately the upload helpers (`scripts/mobile/`) from the
     workflow's **own** commit on `main` (the same commit, since preflight requires it), then asserts
     `git rev-parse HEAD` equals `GITHUB_SHA` **before any of the commit's code runs** and before the
     Google sign-in;
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
     build whose crashes cannot be read. See "Sentry and the log" below;
   - asserts its own identity (the same five values as preflight) as its **first** step, before any
     checkout and long before the Google sign-in;
   - signs in to Google with `google-github-actions/auth` (v3.0.0, pinned by SHA; the only Google sign-in
     in the workflow): GitHub's OIDC token
     for this job is exchanged for a **30-minute** access token of the Play service account, scope
     `androidpublisher` only, no credentials file written. The token is masked;
   - runs `scripts/mobile/play-upload.sh`, which does `edits.insert` → `edits.bundles.upload` →
     `edits.tracks.update` (track `internal`, one release `{versionCodes: [<build_number>], status:
     "draft", name: "<build_name> (<build_number>)"}`) → `edits.commit`. It checks that Play read the
     expected versionCode and the same SHA-256 as the verified file, and that the track answer is safe to
     commit: exactly one release is that draft (versionCodes exactly `[<build_number>]`), no other
     release carries that versionCode, and every release in the answer is either a draft or a
     `completed` one (an earlier internal release Play may list beside it), so none is `inProgress`,
     `halted` or of an unknown status. On any failure it deletes the edit (best effort) and exits
     non-zero: nothing is published;
   - always deletes the signing material, even after a failure.
3. **iOS** (`macos-26`, Xcode 26 selected explicitly, Environment `store-release`): waits for approval, then
   - the same two checkouts and the same before-any-build check of its secrets and variables (§3.6);
   - decodes the App Store Connect `.p8` key (mode 600) and checks it parses as a private key;
   - runs `scripts/mobile/build-store.sh ios-config` (§5);
   - `xcodebuild archive`, then **one** `xcodebuild -exportArchive` to a **local** `.ipa` (method
     `app-store-connect`, destination `export`, `uploadSymbols` false, `manageAppVersionAndBuildNumber`
     false), both with `-allowProvisioningUpdates` and `-authenticationKeyPath/-ID/-IssuerID`, so Apple
     **cloud-signs**;
   - verifies that `.ipa` exactly as before: `codesign --verify --deep --strict`; a distribution
     certificate; team `KX683HAR3Y`; `get-task-allow` false; `aps-environment` production; an App Store
     profile (no device list); bundle id, version and build number; Dart symbols and dSYMs present.
     It then records the CodeDirectory hash (`codesign -d -vvv`: `CandidateCDHashFull sha256`, else
     `CDHash`) of the app and of every framework and extension inside it, makes the `.ipa` read-only, and
     records its **SHA-256** (all shown in the run summary). Any missing value fails the job;
   - installs sentry-cli (as above) and uploads the archive's dSYMs and the Dart symbols to Sentry;
   - **uploads the verified file itself** with Apple's `altool` (shipped with Xcode), the `.p8` copied to
     `~/.appstoreconnect/private_keys/AuthKey_<id>.p8` (mode 600) for that step only, where altool looks
     for it. The step first refuses unless the `.ipa` is still read-only, `ASC_APP_APPLE_ID` is numeric,
     and the bundle id, version and build read from the verified `.ipa`'s own `Info.plist` are this
     app's. It then reads `xcrun altool --help` (nothing is uploaded to find out) and runs **one**
     uploader, chosen from that help text:
     1. if it lists `--upload-package`: `xcrun altool --upload-package <that .ipa> --type ios --apiKey
        <ASC_API_KEY_ID> --apiIssuer <ASC_API_ISSUER_ID>`; and, **only if the same help text names
        `--apple-id`** (altool versions that require it), with `--apple-id <ASC_APP_APPLE_ID> --bundle-id
        <CFBundleIdentifier> --bundle-version <CFBundleVersion> --bundle-short-version-string
        <CFBundleShortVersionString>` added, all three read from the verified `.ipa`'s `Info.plist`;
     2. else, if it lists `--upload-app`: `xcrun altool --upload-app -f <that .ipa> -t ios --apiKey …
        --apiIssuer …`;
     3. else Apple's Transporter (`iTMSTransporter -m upload -assetFile <that .ipa> -apiKey … -apiIssuer …
        -v informational`), **only** if `xcrun --find` or an installed Transporter.app provides it;
     4. else the job stops with "No uploader on this runner" and uploads nothing.

     On the line **immediately before** whichever upload command runs, the `.ipa`'s SHA-256 is
     re-computed and the step refuses unless it equals the recorded one. The job succeeds only if the
     uploader exits 0 **and** prints its own success line ("No errors uploading", or "UPLOAD SUCCEEDED" on newer Xcode, for altool, "uploaded
     successfully" for Transporter) with no `*** Error` / `ERROR ITMS-` line. On anything else it fails
     closed and prints only the uploader's error lines (cut to 300 characters, never a line naming the
     key folder); the full log stays on the runner;
   - always deletes the `.p8` (both copies), the symbols, the build logs and the outputs.

   *Why one export and altool (owner requirement R1).* The build Apple receives must be the build
   that was verified. A second `xcodebuild -exportArchive` with destination `upload` (the first OT-2b
   design) signs the app **again** in Apple's cloud and sends it in the same command, so its signature
   and cdhashes can never be compared with the verified ones before they leave the runner; it is removed
   and the guard refuses it. Instead there is one export, and the bytes uploaded are the bytes verified:
   the SHA-256 of the whole `.ipa` is checked immediately before the upload, which covers every
   executable, `Info.plist`, entitlement and cdhash inside it. *Why altool and not Transporter first:*
   Apple's standalone Transporter download is gone, Transporter.app is only in the Mac App Store and is
   not on GitHub's runners, and `iTMSTransporter` has not shipped with Xcode since Xcode 14, so a
   Transporter-only upload could never run on `macos-26`. `altool` ships with Xcode and uploads a given
   file as it is. It is allowed **only** in its two upload modes, on lines the guard pins exactly
   (`--validate-app`, `--list-apps`, any notarization mode and every other mode are refused; §5.2).
   *Fail closed:* no uploader, a changed or writable `.ipa`, or an upload not reported as successful:
   the job fails, says so, and there is no fallback to a second export and no second upload attempt.
   **UNVERIFIED until the first run** (not checked under the machine rule): **every altool flag above**
   (`--upload-package`, `--upload-app`, `-f`, `--type`/`-t ios`, `--apiKey`, `--apiIssuer`,
   `--apple-id`, `--bundle-id`, `--bundle-version`, `--bundle-short-version-string`, `--help`), in
   particular whether `--upload-package` on Xcode 26 needs `--apple-id` and the three `--bundle-*` flags
   and whether "the help names `--apple-id`" is the right signal for passing them; that altool finds the key in
   `~/.appstoreconnect/private_keys`; that `altool --help` lists the mode names as written; and the
   exact success wording ("No errors uploading" or "UPLOAD SUCCEEDED"). If any is wrong the job fails at the upload step with
   nothing uploaded (or, if the wording alone differs, after an upload that must be checked in App Store
   Connect before any re-run); tell the lead (§6, risk 5).

Both signing jobs install Flutter **without** the shared cache (`cache: false`). Every action is pinned
to a full commit SHA. Inputs reach the shell only through `env`, never inside a `run` script.

**Sentry and the log (owner requirement R3).** Debug symbols and the R8 mapping go to Sentry and nowhere
else, and nothing of them, of the token or of sentry-cli's configuration reaches the public log:
- the token reaches sentry-cli **only** as `SENTRY_AUTH_TOKEN` in the Sentry step's `env` (sentry-cli
  reads it from there); never `--auth-token`, never a command line, never echoed;
- `SENTRY_LOG_LEVEL: warn` in every Sentry step; no `--log-level debug`/`trace`, no `set -x`, no
  `sentry-cli info`/`login`/config print, no `.sentryclirc`;
- sentry-cli reads **nothing an earlier step planted** (P2-2). Before the first upload the Sentry step
  unsets every `SENTRY_*`/`SENTRYCLI_*` variable except the five it sets itself (an earlier step, such
  as the build, could have added `SENTRY_PROPERTIES` or similar through `GITHUB_ENV`), and the proxy
  (`*_proxy`, `*_PROXY`), CA-bundle (`SSL_CERT_*`, `CURL_CA_BUNDLE`) and dynamic-loader (`LD_*`,
  `DYLD_*`) variables; sets `SENTRY_LOAD_DOTENV=0` so no `.env` file is read (sentry-cli's documented
  switch; UNVERIFIED on 3.8.2, and harmless if ignored since the directory is empty); **removes and
  re-creates** `$RUNNER_TEMP/sentry-out` (mode 700, never reused, so nothing can be waiting in it) and
  makes it both sentry-cli's working directory and its `HOME`; and refuses to run if a `.sentryclirc`
  exists in any parent directory of it (sentry-cli may look for one upwards from its working
  directory). These close the planted-file paths; they cannot stop code that is still running from an
  earlier step on the same runner (§6 risk 7);
- only `debug-files upload` and `upload-proguard` are run (no source bundles, no source maps), through a
  helper that keeps sentry-cli's output in a file and prints one summary line ("Sentry: Dart symbols
  uploaded"); on a failure it prints at most five of sentry-cli's own `error:` lines, cut to 200
  characters;
- no artifact is uploaded, and the `.ipa` carries no symbols for Apple (`uploadSymbols` false);
- the always-cleanup step deletes `$RUNNER_TEMP/sentry-out`, `build/symbols` (and on Android
  `build/app/outputs`, which holds the mapping file), even after a failure.

The guard (§5.2) fails CI if any of these is broken.

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
it only when **every** claim below matches (owner requirement R2). The values are this repository's:

| Claim | Required value | Why |
|---|---|---|
| `repository_id` | `1362573850` | the repository's **immutable** id: a deleted and re-created, renamed or transferred repository with the same name has a different id |
| `repository_owner_id` | `183662661` | the owner's immutable id: a new account that takes the name `MohamedEmadLasheen` after a rename has a different id |
| `repository` | `MohamedEmadLasheen/jawwid-chat` | readability only (names can be re-used; the ids above are the lock) |
| `ref` | `refs/heads/main` | only runs from `main` (reviewed, merged code) |
| `environment` | `store-release` | only jobs that waited for the owner's approval in the protected Environment |
| `job_workflow_ref` | `MohamedEmadLasheen/jawwid-chat/.github/workflows/release-store-builds.yml@refs/heads/main` | only this workflow file, from `main`: no other workflow in the repository, even one that names the same Environment, can obtain the token |

Inside the workflow, only the `android` job has `id-token: write` and only it signs in to Google; its
first step, and preflight, assert the same repository id, owner id, repository, ref and workflow ref from
the runner's own context, so a mismatch fails before Google is asked (the guard, §5.2, keeps it so).

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
3. A Workload Identity Pool and an OIDC provider for GitHub, with this exact attribute mapping and
   **attribute condition** (the condition is the real lock: a token whose claims differ in any way is
   refused at the exchange). If the provider already exists from an earlier draft, use
   `providers update-oidc` with the same two flags instead of `create-oidc`:
   ```sh
   gcloud iam workload-identity-pools create github \
     --location=global --display-name="GitHub Actions"
   gcloud iam workload-identity-pools providers create-oidc jawwid-chat \
     --location=global --workload-identity-pool=github \
     --display-name="jawwid-chat store-release" \
     --issuer-uri="https://token.actions.githubusercontent.com" \
     --attribute-mapping="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.repository=assertion.repository,attribute.ref=assertion.ref,attribute.environment=assertion.environment,attribute.job_workflow_ref=assertion.job_workflow_ref" \
     --attribute-condition="assertion.repository_id=='1362573850' && assertion.repository_owner_id=='183662661' && assertion.repository=='MohamedEmadLasheen/jawwid-chat' && assertion.ref=='refs/heads/main' && assertion.environment=='store-release' && assertion.job_workflow_ref=='MohamedEmadLasheen/jawwid-chat/.github/workflows/release-store-builds.yml@refs/heads/main'"
   ```
   The mapping, one attribute per claim:

   | Google attribute | GitHub claim |
   |---|---|
   | `google.subject` | `assertion.sub` (`repo:MohamedEmadLasheen/jawwid-chat:environment:store-release`) |
   | `attribute.repository_id` | `assertion.repository_id` |
   | `attribute.repository_owner_id` | `assertion.repository_owner_id` |
   | `attribute.repository` | `assertion.repository` |
   | `attribute.ref` | `assertion.ref` |
   | `attribute.environment` | `assertion.environment` |
   | `attribute.job_workflow_ref` | `assertion.job_workflow_ref` |

   The ids are compared as strings (GitHub sends them as strings), hence the quotes.
4. Let identities from that repository **by id** impersonate the service account. The principal binding
   uses `attribute.repository_id`, not the name, so a re-created or renamed repository never matches:
   ```sh
   gcloud iam service-accounts add-iam-policy-binding \
     "jawwid-play-upload@$PROJECT_ID.iam.gserviceaccount.com" \
     --role=roles/iam.workloadIdentityUser \
     --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository_id/1362573850"
   ```
   If an earlier binding on `attribute.repository/MohamedEmadLasheen/jawwid-chat` exists, remove it
   (`remove-iam-policy-binding` with that member) so only the id-based one is left. The binding names
   only the repository id; the owner id, ref, Environment and workflow are enforced by the provider's
   condition (step 3), which every token must pass first.
5. The two Environment **variables** (not secrets):
   - `PLAY_WIF_PROVIDER` = `projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/github/providers/jawwid-chat`
   - `PLAY_SERVICE_ACCOUNT` = `jawwid-play-upload@<PROJECT_ID>.iam.gserviceaccount.com`

**UNVERIFIED:** that GitHub's OIDC token for a job with `environment: store-release` carries the
`environment`, `repository_id`, `repository_owner_id` and `job_workflow_ref` claims with exactly the
values above (GitHub documents them; for a workflow that is not reusable, `job_workflow_ref` is the
workflow's own path and ref; not observed under the machine rule). If the first run fails at "Sign in to
Google" with a condition or "unauthorized" error, compare the claims first; never loosen the condition
without the owner. **UNVERIFIED:** that `roles/iam.workloadIdentityUser` alone lets the auth action mint
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
   an upload for an unknown app is refused. Its numeric **Apple ID** (the app → App Information →
   General Information → Apple ID) goes in the Environment **variable** `ASC_APP_APPLE_ID` (not a
   secret; altool versions whose `--upload-package` requires `--apple-id` name the app by it). It is
   always required and format-checked (digits only), so a run never stops late for want of it.
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

**Checked against the sentry-cli 3.0 release notes:** `upload-proguard` still exists in 3.x (3.0 removed
only its `--app-id`, `--version`, `--version-code`, `--android-manifest` and `--platform` arguments, none
of which the workflow passes, and made chunked upload the default); `debug-files upload` is unchanged.
The pinned 3.8.2 SHA-256 values match the digests GitHub shows for the release assets. If a command
still fails, the job stops at the symbols step, **before** any store upload.

**Known gap: Java/Kotlin stack frames are not de-obfuscated yet.** Sentry matches an Android event to its
R8 mapping file by a ProGuard UUID that the app must declare (the `io.sentry.proguard-uuid` manifest
entry, which the Sentry Android Gradle plugin writes at build time). The app does not declare one today,
so Java/Kotlin frames in Android crash reports stay obfuscated even though the mapping is uploaded. The
mapping upload is kept, so the files are already in Sentry. Dart frames (the split-debug-info symbols)
and iOS frames (dSYMs) are not affected. The fix changes the Android build files and is a follow-up
(§7), not part of this change.

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
| `ASC_APP_APPLE_ID` | iOS | the app's numeric Apple ID (§3.4 step 2); checked to be digits only before any build |
| `LESSONS_ORIGIN`, `SENTRY_ENVIRONMENT`, `SENTRY_URL` | both, optional | lesson audio origin; Sentry environment (default `production`); self-hosted Sentry only |
| `ANDROID_UPLOAD_CERT_SHA256` | Android, optional | the upload certificate's SHA-256 as Play Console shows it; any other signer then fails |

`STORE_ARTIFACT_AGE_RECIPIENT` is no longer used; delete it from the Environment if it was created.

How to make the keystore, `google-services.json` and the Apple key is unchanged from #547: see
`docs/mobile/android-release-signing.md` (keystore on a trusted device, never the development Mac) and
§3.4 above.

## 4. Running it

1. The lead (as `jawwid-bot`) dispatches the run from `main` with the commit (the **current head** of
   `main`; if `main` moves before the dispatch, use the new head), platform and version.
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
  its override refusal is gone; or its track-answer check (exactly one draft of exactly
  `[versionCode]`, no other release carrying it, every release a draft or `completed`) is not on its
  pinned lines;
- any of `production`, `beta`, `alpha`, `rollout`, `completed`, notarization (`notarize`/`notarise`,
  `notarytool`), `iTMSTransporter`, `submit…`, `appStoreVersionSubmissions`, `reviewSubmissions`,
  `releaseType` appears in the workflow or `scripts/mobile/` (plus `inProgress`, `halted`,
  `userFraction` in `play-upload.sh`), except on the listed lines (the Sentry environment default, the
  `aps-environment` check, the Xcode selection that skips pre-release Xcode, the two lines that find
  Transporter, the one `play-upload.sh` line that accepts an earlier `completed` release) and the word
  `production` in `build-store.sh` (its production-host check);
- `upload-artifact` appears;
- an action is not pinned to a full commit SHA;
- an expression (`${{ … }}`) is written inside a `run` block;
- a script in `scripts/mobile/` other than `play-upload.sh` talks to the Play Developer API, or anything
  calls the App Store Connect API directly;
- **R1:** there is more than one `-exportArchive`, an export with destination `upload`, `uploadSymbols`
  not exactly once and false; `altool` on any code line but its four pinned ones (`xcrun altool
  --help`, the two `--upload-package` uploads of `"$VERIFIED_IPA"` (with and without `--apple-id` and
  the bundle flags) and the `--upload-app` upload of it, with exactly the flags of §1), so every other
  altool mode (`--validate-app`, `--list-apps`, any `--notarize…`, …) is refused; `xcrun` on any other line; `altool` or `xcrun` in `scripts/mobile/`; `iTMSTransporter` named
  anywhere but the two lines that find it, or a Transporter mode other than `-m upload`; anything but
  exactly one line per uploader, all in the `ios` job, each uploading `"$VERIFIED_IPA"` and each
  **immediately** preceded by the SHA-256 re-check; the verification step not recording
  `VERIFIED_IPA_SHA256` or not making the `.ipa` read-only, or the upload step not checking it is still
  read-only before the uploads; success not requiring exit status 0 **and** the uploader's success line
  (`No errors uploading` or `UPLOAD SUCCEEDED` for both altool modes, `uploaded successfully` for Transporter); or the iOS
  always-cleanup not deleting the key copied for the uploader;
- **R2:** `google-github-actions/auth` appears anywhere but once in the `android` job, or before that
  job's identity assertions; `preflight` or `android` does not assert the repository id `1362573850`,
  owner id `183662661`, repository, `refs/heads/main` and the workflow ref; `android` or `ios` is not in
  `store-release` (the id-token rule above still holds);
- **R3:** `SENTRY_AUTH_TOKEN` appears anywhere but the step `env` lines and the presence checks (or at
  all in `scripts/mobile/`); `auth-token`, a `debug`/`trace` log level, `set -x`/`xtrace`, a source upload
  flag (`--include-sources`, source maps or bundles), `.sentryclirc` or `sentry-cli info/login/config`
  appears; sentry-cli is called other than through the output-capturing helper, or the helper runs
  anything but `debug-files upload`/`upload-proguard` on one path; a Sentry step lacks
  `SENTRY_LOG_LEVEL: warn`; or an always-cleanup does not delete `build/symbols` and
  `$RUNNER_TEMP/sentry-out`;
- **P2-2:** a Sentry step does not, before its first upload, unset the planted variables (its pinned
  `compgen -e` line), set `SENTRY_LOAD_DOTENV=0`, remove and re-create `$RUNNER_TEMP/sentry-out` (its
  pinned `rm -rf … mkdir -m 700 … cd` line) and refuse a `.sentryclirc` in a parent directory (its
  pinned line, the only place that file name may appear); or `SENTRY_PROPERTIES`, `SENTRY_CONFIG`,
  `SENTRY_DOTENV…`, `SENTRYCLI_…` or `SENTRY_LOAD_DOTENV` other than `=0` appears;
- **P2-1:** preflight does not refuse a `ref` other than `GITHUB_SHA` before it outputs the commit, or
  the `android` job does not assert `git rev-parse HEAD` equals `GITHUB_SHA` before the build and the
  Google sign-in.

Each rule has at least one mutation in the selftest.

### 5.3 Tests

`test/scripts/play_upload_script_test.dart` runs the real `play-upload.sh` with bash against a stand-in
`curl` that records every call and answers like Google: the happy path makes exactly insert → upload →
tracks.update (internal, draft, the right name and versionCode) → commit, each with the token on stdin;
every override is refused before any call; the token never appears in the output, on a curl command line
or in curl's environment; a failing upload, track update or commit deletes the edit and exits non-zero;
a versionCode mismatch is refused; the "package not found" answer prints the STOP message; a track answer
with an earlier `completed` release beside the draft is accepted and committed, while one with an
`inProgress`, `halted` or unknown-status release, a `completed` release carrying the same versionCode,
a second draft of it, a draft with extra versionCodes, no draft of ours or another track deletes the edit
and never commits. It also checks
`install-sentry-cli.sh` refuses a download with the wrong SHA-256.
`test/scripts/build_store_script_test.dart` still covers `build-store.sh`.

## 6. Risks and unverified points

1. **Secrets in GitHub.** The keystore, its passwords, the `.p8` and the Sentry auth token live in
   Environment secrets of a public repository. No Google key exists at all. Mitigations: Environment-only
   secrets, owner approval, `main` only, no admin bypass (read back by preflight), manual trigger only,
   every action pinned by SHA, inputs only through `env`, `persist-credentials: false`, no Flutter cache,
   the guard of §5.2.
2. **Google access.** `id-token: write` is on the Android job only, and only it signs in. A Google token
   is minted only for a job of the repository with id `1362573850` (owner id `183662661`), in
   `store-release`, on `refs/heads/main`, running this workflow file from `main` (the provider condition,
   §3.2), after your approval; it lives 30 minutes (room for a large bundle upload) and carries only the `androidpublisher` scope. In Play Console the
   service account can release to testing tracks only; the script can only make an internal draft.
3. **Apple access.** The App Store Connect key can do whatever its role allows (App Manager can submit
   for review and release versions in App Store Connect). The workflow never does: it only runs
   `xcodebuild` archive/export and altool (or, failing it, Transporter) in an upload mode, and the guard
   refuses any submission or release call and any other altool or Transporter mode. "Manually release
   this version" (§3.4) is the second lock.
4. **Logs.** Logs are readable by any logged-in GitHub user. Values pass through `env`, are never echoed,
   and the scripts never use `set -x`. The `xcodebuild` and uploader logs (the former lists the base64
   dart-defines that carry the Sentry DSN) stay on the runner; only error/result lines are printed.
   sentry-cli's output is never printed (§1, "Sentry and the log"). `play-upload.sh` prints only status
   codes. No build output is kept as an artifact.
5. **Apple, UNVERIFIED until the first run:** that Xcode 26 still cloud-signs with the WWDC21 flags; that
   the archive's development signing works on a runner with no Apple account (`-allowProvisioningUpdates`
   may create development certificates that accumulate; revoke the CI-created ones periodically); that
   App Manager is enough (§3.4); that `--split-debug-info` is honoured through `--config-only` (the job
   fails clearly if not); and everything about altool listed in §1 ("Why one export and altool").
   **Residual gap of R1:** the equivalence is proven up to the moment the uploader reads the file
   (SHA-256 checked on the line before); what Apple stores after processing is not read back, because
   nothing in the workflow may call the App Store Connect API. **If altool's flags are wrong on
   `macos-26`**, the job fails at the upload step and the lead corrects the pinned line (a reviewed
   workflow and guard change); a second export is not an option under R1.
   **If the iOS job fails:** read the printed `*** Error` / `error:` / `ERROR ITMS-` lines; "No Accounts"/"not
   authorized" points to the key's role; "No profiles"/"requires a provisioning profile" to provisioning;
   "already been uploaded" or "bundle version" to a reused `build_number`. Fix it in the Apple account;
   never weaken the verification.
6. **Google, UNVERIFIED until the first run:** the `environment` claim (§3.2), the token permission
   (§3.2), the Play permission, the first-upload rule and draft-only behaviour (§3.3).
7. **Code that runs with the secrets, and with the Google token (P2-1, RESIDUAL).** After approval, the
   build commit's build scripts, Gradle, Swift packages, CocoaPods, Flutter and pub packages run with the
   signing secrets in reach. In the `android` job they also run in the job that has `id-token: write`:
   any step of that job can ask GitHub for the job's OIDC token (the runner gives every step the request
   URL and token) and exchange it at Google exactly as the sign-in step does, so **build-time code from
   the build commit could obtain a 30-minute Play token** and could also change what later steps of the
   job run (for example through `GITHUB_ENV`/`GITHUB_PATH`, or a process left running). The Play service
   account can still only act on testing tracks (§3.3).

   *Why the build and the upload share a job.* The safe split would be a build job without `id-token`
   and a separate `android-upload` job (Environment `store-release`, `id-token: write` only there) that
   never checks out or runs the build commit's code. But the upload job needs the verified `.aab`, and
   the only ways GitHub hands a file from one job to another are artifacts and caches, both refused
   here (no build output is kept on GitHub; a cache can be written by other workflows). Signing in
   **before** the build does not help either: the token would then sit in the job while the build runs.
   So no clean separation exists today.

   *What limits it.* Preflight requires `ref` to equal `GITHUB_SHA`, i.e. the **head of `main` at
   dispatch**, the very commit the workflow file runs from, and the `android` job asserts its checkout is
   that commit before any of its code runs. So only code that is already on `main`, reviewed and merged
   under its Code Owner rules, ever runs with the token; an older commit (built with code that the
   current guards and reviews never saw) cannot be selected. The owner's approval of each run is the
   second lock. The guard (§5.2, P2-1) keeps both checks. Review the head of `main` before you approve.
   The upload helpers come from the workflow's own commit (§1).
8. **Cost:** standard GitHub-hosted runners, including `macos-26`, are free for a public repository (H1;
   the macOS wording is UNVERIFIED there). The Google Cloud project, Workload Identity Federation and the
   Play Developer API have no charge for this use (UNVERIFIED; check the project's billing page).

## 7. Follow-up items

1. **Android de-obfuscation in Sentry (P2-3).** Make the app declare `io.sentry.proguard-uuid` (add the
   Sentry Android Gradle plugin, or write the same UUID into the manifest and pass it to
   `upload-proguard`), so Java/Kotlin frames are de-obfuscated with the mapping files this workflow
   already uploads (§3.5). It changes the Android build files, so it is its own reviewed change.
2. **altool flags (R1).** After the first iOS run, record which uploader ran (the run summary names it)
   and which of the UNVERIFIED points in §1 held; keep only the `--upload-package` form Xcode 26
   actually needs, in the workflow and the guard together.
3. **Separate Android upload job (P2-1).** If a way appears to hand the verified `.aab` to a second job
   without a GitHub artifact or cache (for example a short-lived, owner-approved private store the
   upload job reads by its SHA-256), move the Google sign-in and `play-upload.sh` into an
   `android-upload` job that never checks out the build commit, and drop `id-token: write` from the
   build job.

## 8. Not run locally

Written under the machine rule: no workflow, script, test or build was run. CI (the guard's selftest and
check, and the Dart tests) and the first approved runs are the evidence.


**First-run note (iOS).** If the first iOS upload fails with an altool error about `--apple-id` or a `--bundle-*` flag, do not re-run. Tell the lead; the fix is to change the rule that decides whether those flags are passed (today: when `altool --help` names `--apple-id`).
