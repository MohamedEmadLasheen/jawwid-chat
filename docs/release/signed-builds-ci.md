# Signed store builds in GitHub Actions (LR-76, option (c))

**Workflow:** `.github/workflows/release-store-builds.yml` ("Release store builds").
**Risk:** High. The workflow will hold signing material. It is a Code Owner path: the owner approves the
merge. **No key exists or is created by this change.** Creating each key below is a separate owner
decision.
**Background:** `docs/release/signed-build-options.md` (option (c), the GitHub facts H1–H9) and
`docs/release/signing-on-existing-mac.md` (C1: cloud signing with an App Store Connect key).

## 1. What it does

Started by hand (`workflow_dispatch`) from `main`, with four inputs:

| Input | Meaning |
|---|---|
| `ref` | the full 40-character SHA of a commit **already on `main`** |
| `platform` | `both`, `android` or `ios` |
| `build_name` | the version users see, `x.y.z` (`BUILD_NAME`) |
| `build_number` | a positive integer higher than the last upload (`BUILD_NUMBER`) |

`build_name` is a fourth input beyond the brief's three: `scripts/mobile/build-store.sh` refuses to build
without `BUILD_NAME` and does not use `pubspec.yaml`'s version.

1. **Preflight** (no Environment, no secrets; token permissions `contents: read` and `actions: read`):
   refuses unless
   - the run started from `main`, `ref` is a full SHA that is an ancestor of `origin/main` (as
     `deploy-production.yml` checks its tag), and the version inputs are well-formed;
   - the workflow's pinned `age` SHA-256 values are filled in (§5.1);
   - the `store-release` Environment, read through the API
     (`GET /repos/{repo}/environments/store-release` and its `deployment-branch-policies`), has at least
     one required reviewer, *Selected branches and tags* with exactly one rule, the branch `main`, and
     "Allow administrators to bypass" **off** (`can_admins_bypass: false`). Anything it cannot read, or
     does not recognise, is a refusal. Its summary lists the reviewers and the prevent-self-review setting.

   A bad request, or an Environment that is missing or unprotected, fails before anyone is asked to
   approve it, so no secret is ever released from an Environment that nobody guards.
2. **Android** (`ubuntu-latest`, Environment `store-release`): waits for the owner's approval, then
   - fails, naming each one, if any Android secret is missing, or `STORE_ARTIFACT_AGE_RECIPIENT` is not an
     age public key;
   - installs `age` (pinned version, download checked against its SHA-256);
   - decodes the upload keystore into `RUNNER_TEMP` (mode 600) and checks that it opens with the password
     and contains the alias; decodes `google-services.json` and checks it is for `com.jawwid.jawwid_chat`;
   - writes `android/key.properties` and `android/app/google-services.json` (mode 600, git-ignored), where
     `android/app/build.gradle.kts` looks for them;
   - runs `scripts/mobile/build-store.sh android`, the same script and checks as a local store build;
   - verifies the `.aab` with `jarsigner -verify`, and that `keytool -printcert -jarfile` shows exactly one
     signer whose SHA-256 is the upload key's (and, if set, the pinned `ANDROID_UPLOAD_CERT_SHA256`);
   - packs the `.aab` and its Dart symbols into one tar file, **encrypts it with `age` to your public key**,
     and uploads only the encrypted file, as an artifact kept **1 day**;
   - always deletes the keystore, `key.properties`, `google-services.json` and the unencrypted outputs,
     even after a failure.
3. **iOS** (`macos-26`, Xcode 26 selected explicitly, Environment `store-release`): waits for approval, then
   - fails, naming each one, if any iOS secret is missing, or `STORE_ARTIFACT_AGE_RECIPIENT` is not an age
     public key;
   - installs `age` (pinned version, download checked against its SHA-256);
   - decodes the App Store Connect `.p8` key into `RUNNER_TEMP` (mode 600) and checks with
     `openssl pkey -noout` that it parses as a private key (nothing is printed);
   - runs `scripts/mobile/build-store.sh ios-config` (see §5): the same checks and `--dart-define` set as a
     local store build, written into the Xcode project without building;
   - `xcodebuild archive`, then `xcodebuild -exportArchive` (method `app-store-connect`, destination
     `export`), both with `-allowProvisioningUpdates` and `-authenticationKeyPath/-ID/-IssuerID`, so Apple
     **cloud-signs**; no `.p12` or provisioning profile is stored anywhere;
   - verifies the `.ipa`: `codesign --verify --deep --strict`; a distribution certificate; team
     `KX683HAR3Y`; `get-task-allow` false; `aps-environment` production; an App Store profile (no device
     list); bundle id, version and build number; Dart symbols and dSYMs present;
   - packs the `.ipa`, Dart symbols and dSYMs into one tar file, **encrypts it with `age` to your public
     key**, and uploads only the encrypted file, as an artifact kept **1 day**;
   - always deletes the `.p8`, the build logs and the unencrypted outputs.

Both signing jobs install Flutter **without** the shared cache (`cache: false`), so they never restore a
cache written by another workflow.

Each job's summary shows what was verified (for Android, the upload certificate's SHA-256).

## 2. What it does not do

- It does **not** upload to Google Play or App Store Connect / TestFlight. The owner does that (§4).
- It does **not** upload symbols to Sentry. Download the artifact and use `docs/mobile/store-builds.md`,
  "Debug symbols", with your own Sentry token (no Sentry auth token is given to this workflow).
- It does **not** create, rotate or download any key, certificate or profile on its own behalf, except
  what `xcodebuild -allowProvisioningUpdates` does in the Apple account (§6, risk 4).
- It never runs on a pull request, a push, or another workflow's completion. Nobody may add such triggers.
- It does not tag the commit or record the release anywhere but the run summary.

## 3. What the owner must create (only after approving each item)

### 3.1 The `store-release` Environment

Settings → Environments → **New environment** → `store-release`. **If `store-release` is already in the
list, open it and edit it instead**: GitHub creates an Environment by itself, with no protection at all,
the first time any run names it, so an existing one proves nothing. Either way, confirm all of these
before you paste in any secret:
- **Required reviewers:** yourself.
- **Prevent self-review:** see "Who starts a run" below.
- **Deployment branches and tags:** *Selected branches and tags* → add exactly one rule, the branch
  `main` (no other rule, no wildcard).
- **Deselect "Allow administrators to bypass configured protection rules".**

The workflow's preflight reads these three settings and refuses to run without them (§1). That check
is **UNVERIFIED** until the first run: GitHub's documentation says read access is enough for these
endpoints and lists the fine-grained permission as "Actions: read", which is what the preflight job's
token is given, but it was not run under the machine rule. If the first run stops with "Could not read
the store-release Environment with the job token" although the Environment exists, the token cannot
read it: check the three settings above by eye on the Environment's page, tell the lead, and the lead
will propose a reviewed change to the check. Do not approve a run while that check fails.
- Put every secret and variable below in **this Environment**, never in repository secrets. Anyone with
  write access (including `jawwid-bot`, the account agent sessions use) can read repository secrets
  through a workflow on their own branch (options paper H4); Environment secrets are released only after
  your approval, and only to runs from `main`.

**Who starts a run** (options paper §4 (c)): with Prevent self-review **on**, you cannot approve a run you
started, so a run is dispatched by `jawwid-bot` (asked by the lead) and approved by you. With it **off**,
you may dispatch and approve yourself. The lead recommends **on**: an agent can then ask for a build but
never approve one. Each platform job asks for approval separately; one review screen approves both.

### 3.2 Environment secrets (names only; you paste every value yourself in the GitHub UI)

| Secret | What it is |
|---|---|
| `ANDROID_UPLOAD_KEYSTORE_BASE64` | the upload keystore file, base64 on a single line (`base64 -i upload.jks` on a Mac, `base64 -w0 upload.jks` on Linux) |
| `ANDROID_UPLOAD_KEYSTORE_PASSWORD` | its store password |
| `ANDROID_UPLOAD_KEY_ALIAS` | the key's alias (`jawwid-upload` if made as in §3.4) |
| `ANDROID_UPLOAD_KEY_PASSWORD` | the key's password (with a PKCS12 keystore, the same as the store password) |
| `GOOGLE_SERVICES_JSON_BASE64` | Firebase `google-services.json` for `com.jawwid.jawwid_chat`, base64 on a single line |
| `ASC_API_KEY_ID` | App Store Connect API key ID |
| `ASC_API_ISSUER_ID` | the issuer ID shown above the keys list (a UUID) |
| `ASC_API_KEY_P8_BASE64` | the downloaded `AuthKey_<ID>.p8`, base64 on a single line |
| `SENTRY_DSN` | the app's Sentry DSN (compiled into the app; never printed) |

Use passwords of **letters and digits only**, and an alias of letters, digits, `.`, `_` or `-`: they are
written into a Java properties file, and the workflow refuses anything else rather than escape it.
Base64 on a single line keeps GitHub's log masking simple (it masks secret values line by line); a
wrapped value still decodes, because line breaks are stripped first.

### 3.3 Environment variables (not secret; the names `build-store.sh` reads)

`API_BASE_URL` (production host, ending `/api/v1`), `PRIVACY_POLICY_URL`, `TERMS_URL`, `SUPPORT_URL`,
`SUPPORT_EMAIL`; optional `LESSONS_ORIGIN`, `SENTRY_ENVIRONMENT` (default `production`) and
`ANDROID_UPLOAD_CERT_SHA256` (the upload certificate's SHA-256 as Play Console shows it; when set, a
build signed by any other key fails). The script refuses staging, dev, IP and similar hosts.

**Required:** `STORE_ARTIFACT_AGE_RECIPIENT`, your age **public** key (`age1…`, §3.4). Every artifact is
encrypted to it; without it nothing is built. It is a variable, not a secret: a public key reveals
nothing, and the private half never leaves your trusted device.

### 3.4 How to make each secret, when you approve it

- **Android upload keystore.** On a **trusted device** (not a machine under the machine rule), with a JDK:
  use the `keytool -genkeypair … -alias jawwid-upload …` line in `docs/mobile/android-release-signing.md`
  (alias `jawwid-upload`, which then goes in `ANDROID_UPLOAD_KEY_ALIAS`). Keep the `.jks` and its
  password in your password manager plus one offline encrypted copy (`signing-on-existing-mac.md` §6).
  With Play App Signing (Google holds the app signing key), a lost or leaked upload key can be reset
  (options paper G1, G2). Record its SHA-256
  (`keytool -list -v -keystore jawwid-upload.jks -alias jawwid-upload`) as
  `ANDROID_UPLOAD_CERT_SHA256`.
- **`google-services.json`.** Firebase console → Project settings → Your apps → Android
  (`com.jawwid.jawwid_chat`) → download.
- **App Store Connect API key.** App Store Connect → Users and Access → Integrations → App Store Connect API
  → Team Keys → generate. A team key needs Account Holder or Admin to create; its access level cannot be
  changed afterwards, and the `.p8` downloads **once** (`signing-on-existing-mac.md` C3).
  **Choose App Manager first** (the lowest role the Flutter docs name for automation, options paper G5).
  Only if the first run fails with a permission error at archive or export, revoke it and make an
  **Admin** key: an Admin key can do almost everything an Admin can, including managing users, so it is a
  much bigger secret. Whether App Manager suffices for cloud signing is **UNVERIFIED** (§6).
- Cloud signing for App Store distribution needs an Admin or Account Holder, or the "Access to Cloud
  Managed Distribution Certificate" permission (C1, C2). Check this for the key's role if export fails.
- **The artifact key (age).** On the **trusted device** where you will open the builds, install age
  (`brew install age` on a Mac) and run `age-keygen -o jawwid-store-artifacts.agekey`. It prints
  `Public key: age1…`: paste that line's `age1…` value into the Environment **variable**
  `STORE_ARTIFACT_AGE_RECIPIENT`. The `.agekey` file is the private half: keep it on that device (mode
  600) plus a copy in your password manager, and never put it in GitHub or on a machine under the
  machine rule. Losing it only means re-running a build after making a new key; a leaked one only
  exposes builds made while it was in use, so then make a new key and replace the variable.

## 4. Running it, and what the owner does with the result

1. The lead (as `jawwid-bot`) dispatches the run from `main` with the commit, platform and version.
2. You review the pending run (Actions → the run → **Review deployments**): check the commit, the
   version and the Environment settings in the Preflight summary, then approve `store-release`.
3. When it is green, download the artifact(s) to your trusted device **within 1 day** (they then
   expire), and delete them from the run (the run page → Artifacts → the bin icon) once downloaded.
4. **Decrypt on the trusted device.** GitHub delivers each artifact as a `.zip` holding one
   `jawwid-<platform>-<version>+<build>.tar.age`:
   ```sh
   unzip android-aab-1.2.3-45.zip
   age --decrypt -i ~/path/to/jawwid-store-artifacts.agekey \
     -o jawwid-android-1.2.3+45.tar jawwid-android-1.2.3+45.tar.age
   mkdir jawwid-android-1.2.3+45 && tar -xf jawwid-android-1.2.3+45.tar -C jawwid-android-1.2.3+45
   ```
   The folder then holds the `.aab` (or `.ipa`) and `symbols/`. If `age` says "no identity matched any of
   the recipients", the build was encrypted to a different public key: compare the `age1…` value in the
   job summary with your key file's `# public key:` line.
5. **Android:** in Play Console → your app → Testing → Internal testing → Create new release → upload the
   `.aab`. First compare the SHA-256 in the run summary with App integrity → Upload key certificate.
6. **iOS:** upload the `.ipa` with Apple's **Transporter** app (Mac App Store), signed in with your Apple
   ID; or `xcrun altool --upload-app -f <ipa> -t ios --apiKey <ID> --apiIssuer <issuer>` with a key file on
   your own trusted machine (`altool`'s upload is **UNVERIFIED** on Xcode 26; Transporter is the safer
   default). It then appears in App Store Connect → TestFlight after processing.
7. Upload the symbols to Sentry (`docs/mobile/store-builds.md`, "Debug symbols"). Keep them for every
   build you ship; the artifact copy expires.

## 5. The change to `scripts/mobile/build-store.sh`

A new target, `ios-config`, runs every existing check and then
`flutter build ios --release --config-only` with the **same** `--build-name`, `--build-number`,
`--split-debug-info` and `DEFINES` as `ios`. It writes them into `ios/Flutter/Generated.xcconfig`; the
following `xcodebuild archive` compiles the Dart code with those values. It is needed because
`flutter build ipa` cannot pass the App Store Connect key flags to `xcodebuild`, and without it the
workflow would have to repeat the `--dart-define` list (as the unsigned readiness check does, "keep the
two in step"). The `ios`, `android` and `check` targets are unchanged. A commit older than this change has
no `ios-config`; the iOS job then stops with that message.

`test/scripts/build_store_script_test.dart` holds this to account: `ios-config` is an accepted target; it
refuses every bad value `ios` refuses, before Flutter is reached; and, run against a stand-in `flutter`
that records its arguments, its `flutter build ios --config-only` call receives exactly the same version,
symbols path and dart-defines as `ios`'s `flutter build ipa` call.

### 5.1 The pinned `age` download

The workflow's top-level `env` pins `AGE_VERSION` and the SHA-256 of the two release archives it
downloads (`age-<version>-linux-amd64.tar.gz` and `age-<version>-darwin-arm64.tar.gz`). A download whose
hash differs is refused, and preflight refuses to start while either hash is not filled in. To fill in
or bump them, copy each asset's `sha256:` digest from the release page on
`github.com/FiloSottile/age/releases` (or `gh api repos/FiloSottile/age/releases/tags/<version>` →
`assets[].digest`), and confirm it on a trusted device with `shasum -a 256 <file>`. This is a change to a
Code Owner path, so it needs the owner's approval like any other change to the workflow.

## 6. Risks and unverified points

1. **Secrets in GitHub.** The keystore, its passwords and the `.p8` live in GitHub Environment secrets on a
   public repository. Mitigations: Environment-only secrets, owner approval, `main` only, no admin
   bypass (all three read back by preflight, which refuses the run otherwise), no PR triggers, every
   action pinned to a full commit SHA (the same SHAs as `release-readiness.yml` in PR #523), `age` pinned
   by version and SHA-256, `permissions: contents: read` (plus `actions: read` for preflight only, to read
   the Environment), `persist-credentials: false`, no Flutter cache in the signing jobs. The preflight
   check is a point-in-time read: GitHub itself enforces the reviewer and branch rule again when each
   signing job starts.
2. **Logs and artifacts are readable by any logged-in GitHub user** (options paper H8). Values are passed
   through `env`, never echoed, and the scripts never use `set -x`. GitHub's redaction is not guaranteed
   for **derived** values (H4): the `xcodebuild` log lists build settings, including the base64
   dart-defines that contain the Sentry DSN, so that log is kept on the runner, only error lines are
   printed, and it is deleted. The **artifacts** can be downloaded by anyone logged in, so each is
   **encrypted with `age` to your public key** before upload; without your private key file the download
   is useless (it would otherwise expose an unreleased build and its unobfuscated Dart symbols). No new
   secret is needed for this. They are also kept only **1 day**, and §4 asks you to delete them once
   downloaded. Uploading straight to Play internal testing / TestFlight instead is a separate, later owner
   decision.
3. **Code that runs with the secrets.** After approval, the workflow file from `main` runs the build
   scripts, Gradle and its plugins, Swift packages, Flutter and pub packages **at the chosen commit**.
   Anything merged to `main` can therefore see the secrets once a run is approved: review the commit you
   approve, and keep `.github/workflows/` a Code Owner path.
4. **Apple, UNVERIFIED until the first run:**
   - that `xcodebuild` on Xcode 26 still cloud-signs with the WWDC21 flags (C1), and that no extra flag is
     needed;
   - that the **archive** step (development signing under `CODE_SIGN_STYLE` Automatic) succeeds on a
     runner with no Apple account: `-allowProvisioningUpdates` may create an Apple Development
     certificate and profile in the team, which may need a registered device or a higher key role;
   - whether each run creates a **new development certificate** (the runner's keychain is thrown away). If
     so they accumulate in Certificates, Identifiers & Profiles and can hit Apple's per-team limit; revoke
     the CI-created ones periodically (revoking does not affect App Store apps, C4);
   - that App Manager is enough (otherwise Admin, risk 1 grows);
   - that `--split-debug-info`'s relative path is honoured through `--config-only` (the job fails clearly
     if no Dart symbols appear).
   The job is designed to fail with a clear error, and to upload nothing, if any of these do not hold.
   **If the iOS job fails:** read the printed `error:` lines; "No Accounts"/"not authorized" points to the
   key's role or cloud-signing permission; "No profiles"/"requires a provisioning profile" points to
   provisioning (registered device, App ID capabilities such as Push). Fix in the Apple account; do not
   weaken the verification step.
5. **Android:** the AAB is signed with the **upload** key; Google re-signs with the app signing key. A
   wrong keystore is caught by the optional SHA-256 pin, and in any case by Play Console at upload.
6. **Cost:** standard GitHub-hosted runners, including `macos-26`, are free for a public repository (H1;
   the macOS wording is UNVERIFIED there). If the repository became private, macOS minutes are billed.

## 7. Not run locally

This change was written under the machine rule: no workflow, script or build was run. CI and the first
approved run are the evidence; the first run should be `platform: android` (fully verifiable) and then
`platform: ios` to settle the unverified Apple points above. The first run also settles whether the
job token can read the Environment's protection settings (§3.1).
