# LR-76: where the signed store builds are made (decision paper)

**Status:** for the owner's decision. Documents only; nothing here changes code, workflows or secrets.
**Date:** 2026-11-08. **Risk of this paper:** Low. **Risk of acting on option (c):** High (see §5).
**Roles:** release manager and security reviewer (builder session), for the engineering lead.

## 1. The question

A store build has to be **signed** on some machine:
- iOS: an Apple Distribution certificate and an App Store provisioning profile for `com.jawwid.jawwidChat`,
  team `KX683HAR3Y`.
- Android: the **upload key**. Google keeps the app signing key under Play App Signing.

Which machine, and where do the private keys live?

Today none of this exists:
- `docs/release/store-readiness-2026-11-03.md` blocker 5: "No iOS Distribution certificate and no App
  Store profile: `xcodebuild -exportArchive` fails". Its next step belongs to the owner (Apple account).
- No upload keystore is known to exist.
- `.github/workflows/` has no release-build workflow. It has `ci.yml`, two deploy workflows, two backup
  workflows, `livekit-probe.yml` and `storage-versioning.yml`.

**Constraint: the machine rule.** The owner's rule bars running project code on the owner's Mac until its
security is settled. The repository's docs have no record of the incident behind the rule, so this paper
says nothing about it beyond the rule itself. "Settled" is the owner's judgement.

**Constraint: the repository is public on GitHub.** Anything committed, and anything a workflow prints,
should be treated as visible to everyone.

## 2. What a build needs, whichever option is chosen

These come from the repository: `scripts/mobile/build-store.sh`, `docs/mobile/store-builds.md`,
`docs/mobile/android-release-signing.md` and `android/app/build.gradle.kts`.

| Input | Secret? | Notes |
|---|---|---|
| `BUILD_NAME`, `BUILD_NUMBER` | no | `x.y.z`; the number must be higher than the last upload |
| `API_BASE_URL` (production host, `/api/v1`) | no | the script refuses staging, dev, IP and similar hosts |
| `PRIVACY_POLICY_URL`, `TERMS_URL`, `SUPPORT_URL`, `SUPPORT_EMAIL` | no | the owner's hosted texts |
| `LESSONS_ORIGIN` | no | optional |
| `SENTRY_DSN` | not a secret, but not printed | without it the script refuses to build |
| iOS distribution certificate and its private key, plus the App Store profile | **yes (the key)** | Xcode automatic signing, team `KX683HAR3Y`, `RunnerRelease.entitlements` |
| Android upload keystore (`.jks`), its passwords, `android/key.properties` | **yes** | git-ignored; a release build fails without it and never falls back to the debug key |
| `android/app/google-services.json` | config, not a signing key | the Gradle guard refuses a release build without it (Firebase, push) |
| Sentry auth token (debug-symbol upload) | **yes** | used by hand after the build (`store-builds.md`, "Debug symbols") |

Every option needs the same pinned toolchain: Flutter, Xcode and a JDK. Every option should build from
a **tagged commit on `main`** and keep `build/symbols/…` and the dSYMs for Sentry.

## 3. Verified external facts used below

Each fact was read on the official page on 2026-11-08. **UNVERIFIED** marks anything that could not be
confirmed there.

**Apple**
- A1. "Cloud-managed certificates are associated with your Apple Developer Program membership and
  managed remotely." <https://developer.apple.com/help/account/certificates/cloud-managed-certificates/>
- A2. "Xcode 13 or later will cloud sign any apps or software for distribution if you're using the Xcode
  Organizer archive and distribution workflow, and a local signing certificate is not found." (same URL)
- A3. Managing and rotating cloud-managed certificates: "Required role: Account Holder or Admin."
  (same URL)
- A4. The roles table lists "Create other cloud-managed certificate types" and, in App Store Connect,
  "Manage access to other cloud-managed certificates". Its footnotes include "Granted as a separate
  permission in Users and Access." and "Requires Xcode Automatic Signing."
  <https://developer.apple.com/help/account/access/roles/>
  **UNVERIFIED:** which of Developer or App Manager gets that permission. The table could not be read
  reliably.
- A5. **UNVERIFIED:** whether `xcodebuild -exportArchive` with `-allowProvisioningUpdates` and an App Store
  Connect API key (`-authenticationKeyPath/-ID/-IssuerID`) uses cloud signing. Only the Organizer workflow
  is documented (A2). `flutter build ipa` exports through `xcodebuild`.
- A6. **UNVERIFIED:** where Apple keeps a cloud-managed certificate's private key, and whether it can be
  downloaded. The page says only "managed remotely".
- A7. "Distribution certificates belong to the team and only one type of each distribution certificate
  (with the exception of Developer ID certificates) is allowed per team." Also: "Only the Account Holder
  or Admin role can create distribution certificates."
  <https://developer.apple.com/help/account/reference/certificate-types>
- A8. Apple Developer Program: "$99 annual membership" (currency shown only as "$").
  <https://developer.apple.com/programs/>
- A9. Xcode Cloud: "25 compute hours/month", "Included with Apple Developer Program membership".
  Paid tiers: 100 h at US$49.99/month, 250 h at US$99.99, 1000 h at US$399.99, 10000 h at US$3999.99.
  Unused hours do not roll over. It requires Xcode 15 or later.
  <https://developer.apple.com/xcode-cloud/>, <https://developer.apple.com/xcode-cloud/get-started/>
- A10. **UNVERIFIED:** how Xcode Cloud signs (no signing text on its overview, get-started or security
  pages), and whether it builds Flutter apps through a `ci_post_clone.sh` script.
  <https://developer.apple.com/documentation/xcode/writing-custom-build-scripts> returned no body text.
  Apple's Xcode Cloud pages do not mention Flutter.
- A11. **UNVERIFIED:** the App Store Connect API key rules (which roles, and whether the key downloads
  only once). <https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api>
  returned no body text.
- A12. **UNVERIFIED:** whether revoking a distribution certificate affects apps already on the App Store.
  Not checked.

**Google**
- G1. "With Play App Signing, Google manages and protects your app's signing key." You sign uploads with
  the upload key, which you must keep secure. For the upload key: "If compromised or lost, Google can reset
  it for you." <https://support.google.com/googleplay/android-developer/answer/9842756>
- G2. Reset: "If you lose your upload key or suspect that it was compromised, you are not locked out of
  your app." The steps: create a new key, export its certificate to PEM, then Play app signing → Upload
  key certificate → **Request upload key reset**. (same URL)
  **UNVERIFIED:** who may request the reset (the page says configuring Play App Signing needs admin
  permission), and how long until the new key works. The page states no waiting period.
- G3. For new apps: "Your app will be automatically enrolled in quantum-ready, hybrid signing with
  Google-generated keys." **UNVERIFIED:** whether Play App
  Signing is mandatory. The page has no "mandatory" wording. (same URL)
- G4. "There is a US$25 one-time registration fee."
  <https://support.google.com/googleplay/android-developer/answer/6112435>
- G5. Flutter: keep the keystore and `key.properties` private and never in public source control.
  <https://docs.flutter.dev/deployment/android>
  The iOS page: "You can create new IPAs with the same options without launching Xcode by running
  `flutter build ipa --export-options-plist=path/to/ExportOptions.plist`." Also: "You'll need to generate
  an App Store Connect API Key with App Manager access to automate operations with App Store Connect."
  <https://docs.flutter.dev/deployment/ios>

**GitHub**
- H1. "The use of standard GitHub-hosted runners is free: * In public repositories …" and "Larger runners
  are billed for public repositories." The listed rates are macOS 3/4-core "$0.062" per minute and Linux
  2-core "$0.006" per minute (these matter only if the repository becomes private).
  <https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions>
  **UNVERIFIED:** that the free-runner sentence names macOS. It says "standard GitHub-hosted runners".
- H2. "With the exception of `GITHUB_TOKEN`, secrets are not passed to the runner when a workflow is
  triggered from a forked repository." "You can use Base64 encoding to store small binary blobs as
  secrets." The page's "does not redact" warning applies **only** to its large-secret workaround: "When
  using this workaround, GitHub does not redact secrets that are printed in logs." This paper does not use
  that workaround.
  <https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions>
- H3. "Secrets are limited to 48 KB in size."; the limit is 100 environment secrets.
  <https://docs.github.com/en/actions/reference/security/secrets>
- H4. `pull_request_target` workflows "are privileged … may have repository write access and access to
  referenced secrets". "Avoid using the `pull_request_target` and `workflow_run` workflow triggers with
  untrusted pull requests or code content." "A workflow job cannot access environment secrets until
  approval is granted by a reviewer."
  On redaction: "Because there are multiple ways a secret value can be transformed, automatic redaction is
  not guaranteed." Also: "If your secret is transformed in some way (such as Base64 or URL-encoded)", and
  "Structured data can cause secret redaction within logs to fail".
  On access: "Any user with write access to your repository has read access to all secrets configured in
  your repository."
  <https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions>
- H5. "By default, all first-time contributors require approval to run workflows". After one merged
  commit or PR, a user "will not require approval". `pull_request_target` runs "regardless of approval
  settings".
  <https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository>
- H6. Environments:
  - "Users with GitHub Free plans can only configure environments for public repositories."
  - Required reviewers: "up to 6 people or teams", and one approval is enough.
  - An optional **Prevent self-review**: "to prevent users from approving workflows runs that they
    triggered, select Prevent self-review."
  - Optional allowed branches and tags.
  - Jobs "can only access these secrets after any configured rules (for example, required reviewers) pass".
  <https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-deployments/managing-environments-for-deployment>
- H7. GitHub-hosted runners "are isolated virtual machines that are automatically destroyed at the end of
  the job execution". GitHub's own Apple signing recipe:
  - store the base64 `.p12`, its password and the profile as secrets;
  - import them into a new temporary keychain;
  - delete the keychain in an `always()` step (needed on self-hosted runners).
  <https://docs.github.com/en/actions/use-cases-and-examples/deploying/installing-an-apple-certificate-on-macos-runners-for-xcode-development>
- H8. "You must be logged in to a GitHub account to view workflow run information, including for public
  repositories." Viewing and downloading logs and artifacts: "Read access to the repository is required to
  perform these steps." In a public repository every logged-in user has read access, so the logs and
  artifacts are readable by **any logged-in GitHub user**.
  <https://docs.github.com/en/actions/monitoring-and-troubleshooting-workflows/monitoring-workflows/using-workflow-run-logs>

## 4. The options

### (a) This Mac, after the owner settles its security

| | iOS | Android |
|---|---|---|
| Where the private key lives | The login keychain of this Mac (a downloaded distribution certificate and its key). With cloud signing from the Organizer (A2), the distribution key may not need to sit on this Mac (A6 unverified). | `jawwid-upload.jks` on this Mac's disk, with its passwords in the owner's password manager (`android-release-signing.md`) |
| Who could misuse it | Anything that runs as the owner's user on this Mac: any residual malware if "settled" was wrong, and **every AI agent session (Claude, Codex) that runs shell commands here**. Every worktree and session on this Mac shares the user account. Also anyone holding the Apple ID session. | Same. A stolen upload key alone cannot replace the app on users' phones (G1). It lets the thief upload builds only if they also hold Play Console access. The key can be reset (G2). |
| Setup time (estimate) | Hours after "settled": Xcode is already set up for team `KX683HAR3Y` | About an hour: generate the key, write `key.properties`, add `google-services.json` |
| Money (verified) | Apple Developer Program $99/year (A8), presumably already paid | Play registration US$25 once (G4), if not already paid |
| Blocked by | the machine rule, until the owner says it is settled | same |

What the owner must do:
1. Decide, on their own criteria, that this Mac is settled, and say so in writing (the date and what was done).
2. As Account Holder or Admin (A7), create the Apple Distribution certificate in Xcode → Settings →
   Accounts → Manage Certificates, or rely on cloud signing from the Organizer (A2).
3. Create the app record in App Store Connect (`store-readiness-2026-11-03.md` §4).
4. Generate the upload key with the `keytool` line in `android-release-signing.md`, and store the `.jks`
   and its passwords in the password manager.
5. Run `scripts/mobile/build-store.sh ios` and `… android` from a tagged `main` commit, or let a session
   do it once the rule is lifted.

Weakness: it puts long-lived signing keys on the machine where agents run code all day. That is the very
machine the rule exists to protect.

### (b) A separate clean Mac the owner controls

| | iOS | Android |
|---|---|---|
| Where the private key lives | That Mac's keychain, or nowhere local if cloud signing from the Organizer is used (A2, A6 unverified) | That Mac's disk, plus a password-manager copy |
| Who could misuse it | Only people and software on that Mac. Keep it free of AI agent sessions and other projects: signing only, the repository cloned read-only, and Flutter, Xcode and a JDK from their official sources. Anyone who steals the machine while it is unlocked. | Same. Upload key risk is bounded by G1 and G2. |
| Setup time (estimate) | About a day: macOS update, Xcode, Flutter 3.47.2 (the version `ci.yml` pins), CocoaPods, signing in to the Apple team, then a first test archive | Same day; keytool comes with the JDK |
| Money | The machine itself. **No figure is quoted: not verified.** Free if the owner already has a spare Mac. Program fees as in (a). | as in (a) |
| Blocked by | getting a Mac | same |

What the owner must do:
1. Provide a Mac that has never run this repository or the other projects: freshly erased, or new. Make
   it a separate user account with FileVault on.
2. Install Xcode (App Store), Flutter (the version CI pins, from flutter.dev), CocoaPods and a JDK 17.
   The lead can supply an exact checklist.
3. Sign in to Xcode with the Apple ID that is Account Holder or Admin on team `KX683HAR3Y` (A3, A7).
4. Clone the public repository and check out the release tag.
5. Put `google-services.json` in `android/app/`. Generate the upload key there and write
   `android/key.properties`. Copy the `.jks` and its passwords into the password manager.
6. Run the build script for each platform with the production values from §2.
7. iOS: either export from Xcode Organizer (cloud-signed, A2), or create a distribution certificate (step
   2 of option (a)). Upload to TestFlight.
8. Android: upload the `.aab` in Play Console with Play App Signing on, and let Google generate the app
   signing key (G1, G3).
9. Keep the symbols and dSYMs. Upload them to Sentry with your own token (`store-builds.md`).

### (c) A GitHub Actions release workflow (GitHub-hosted runners, protected Environment)

The design:
- `workflow_dispatch` only, on `main` only.
- A `release` Environment with:
  - the owner as required reviewer, and Prevent self-review on (H6);
  - the deployment branch limited to `main` (H6);
  - the signing material as **environment** secrets, not repository secrets.
- iOS on a standard `macos` runner, Android on `ubuntu`.
- Never `pull_request_target` or `workflow_run` (H4).

**Who starts the run.** With the owner as the only required reviewer and Prevent self-review on, the owner
cannot approve a run they started themselves (H6). If the owner dispatches the run, nobody can approve it
and the release stalls. So one of these must be chosen:
- **`jawwid-bot` dispatches, the owner approves.** Agent sessions push and merge as `jawwid-bot`, which is
  not the owner. The consequence: the bot's write access can then **start** release runs, and any agent
  session can ask for one. Every run still waits for the owner's approval before it sees a secret (H4, H6).
- **The owner dispatches** and Prevent self-review is left **off**. Then the owner's own approval is the
  only gate.
- **Add a second human reviewer** who approves runs the owner starts.

This paper recommends the first: the owner then only approves, and an agent can never approve.

**Why environment secrets limited to `main` are mandatory, not a preference.** The hardening page says:
"Any user with write access to your repository has read access to all secrets configured in your
repository." (H4) `jawwid-bot`, the account every agent session uses, has **write** access (verified
by the lead on 2026-11-08: `gh api repos/MohamedEmadLasheen/jawwid-chat/collaborators/jawwid-bot/permission`
returns `write`, not `admin`). A signing key in
**repository** secrets could therefore be read by any agent through a workflow on its own branch, with no
approval. Environment secrets are released only after the required reviewer approves, and only to runs
from the allowed branch, `main` (H6). Nobody may later move a signing secret into repository secrets "for
convenience".

| | iOS | Android |
|---|---|---|
| Where the private key lives | GitHub environment secrets: the base64 `.p12`, its password, the profile (H7). Each secret is at most 48 KB (H3). The secrets are decrypted onto a fresh VM that is destroyed after the job (H7). The `.p12` must first be **made somewhere**: its private key comes from a CSR on some trusted machine. That leads back to (a) or (b), unless an App Store Connect API key with cloud signing works from `xcodebuild` (A5, **unverified**). GitHub's recipe (H7) only imports the `.p12` and profile into a keychain. This project uses `CODE_SIGN_STYLE = Automatic` (`ios/Runner.xcodeproj/project.pbxproj:460`, the Release configuration; Debug and Profile are Automatic too). A fresh runner not signed in to Apple therefore also needs one of: manual signing settings for the Release build; an `--export-options-plist` that names the profile (G5); or an App Store Connect API key with `-allowProvisioningUpdates` (how this behaves is unverified, A5). Without one, the first run is expected to fail at export. | Environment secrets: the base64 `.jks` and its passwords. The keystore is also generated somewhere first. |
| Who could misuse it | Anyone who can change workflow code that reaches `main` and then get the environment approved. Fork PRs do **not** receive secrets (H2), but `pull_request_target` would (H4, H5). Anyone with admin rights on the repository. Anyone with write access, if a signing secret were ever put in repository secrets: "Any user with write access to your repository has read access to all secrets configured in your repository." (H4) That includes `jawwid-bot` and so every agent session (see the design above). Any third-party action the workflow uses (pin by SHA). The logs, which any logged-in GitHub user can read (H8). GitHub redacts registered secrets, but "automatic redaction is not guaranteed" (H4). Values **derived** from a secret are the real risk: a base64-decoded `.p12`, a keychain or `security` dump, or a password echoed by `set -x`. The workflow must never print these. GitHub itself. | Same. Upload key risk is bounded by G1 and G2. |
| Setup time (estimate) | 2–3 days of engineering plus owner approvals, plus making the `.p12` (above). This includes solving export under automatic signing (above), which may take several runs. | Under a day after the keystore exists |
| Money (verified) | Standard GitHub-hosted runners are free in public repositories (H1). Larger runners are billed (H1). If the repository were made private, macOS minutes cost $0.062/min (H1). | Same; Linux $0.006/min if private (H1) |
| Blocked by | **owner approval** (see §5) and an existing `.p12` | owner approval and an existing keystore |

What the owner must do:
1. Approve, explicitly, adding `.github/workflows/release-build.yml` and creating the Environment and its
   secrets (§5).
2. In repository Settings → Environments, create `release`. Add yourself as required reviewer, turn on
   Prevent self-review, allow only `main`, and **deselect "Allow administrators to bypass configured
   protection rules"** (H6). Otherwise an administrator's run can skip the approval, and the claims
   above ("every run waits for the owner's approval", "an agent can never approve") hold only while
   no agent account is an administrator. Never give `jawwid-bot` admin.
3. Paste the secrets yourself in the GitHub UI: the `.p12` and its password, the profile, the keystore and
   its passwords, `google-services.json`, and `SENTRY_DSN`. Never through an agent.
4. Confirm the fork-PR setting "Require approval for all external contributors" (H5).
5. Approve each run when it asks. Do **not** start runs yourself while Prevent self-review is on: you could
   not approve them. Let `jawwid-bot` (an agent session) dispatch the run, or pick another choice from
   "Who starts the run" above.

Gain: the build is repeatable, from a known commit, on a throwaway VM, with no key on any agent's machine.
Cost: the keys live with GitHub; the setup is High risk; it cannot be the very first step.

### (d) Apple cloud-managed certificates, Xcode Cloud; Google Play App Signing with upload key reset

These change **where the key lives**. They are not separate build machines, and they combine with (a),
(b) or (c).

- **Apple cloud-managed distribution certificate.**
  - The Xcode Organizer flow (Archive → Distribute App) cloud-signs in Xcode 13 or later (A2).
  - The distribution private key then need not sit in the build Mac's keychain. Apple says only "managed
    remotely" (A1); where the key is kept and whether it can be downloaded is **unverified** (A6).
  - Managing these certificates needs Account Holder or Admin (A3). Other roles need a separately granted
    permission; which roles can be granted it is **unverified** (A4).
  - **Whether `flutter build ipa` (that is, `xcodebuild -exportArchive`) uses cloud signing from the command
    line is unverified (A5).** So for the first release, use the build script to archive, then export and
    upload from the Organizer. Alternatively, test the CLI export once and record the result.
  - Who could misuse it: anyone signed in to Xcode with the Admin Apple ID on that Mac, or anyone holding
    that Apple ID's credentials.
- **Xcode Cloud.** 25 compute hours a month are included with the membership (A9).
  - How it signs and whether it can build this Flutter app (a `ci_post_clone.sh` that installs Flutter)
    are both **unverified** (A10).
  - It also grants Apple access to the GitHub repository.
  - It is iOS only. Not a "within days" path; worth a later spike.
- **Google Play App Signing.** Google holds the app signing key (G1). The upload key we hold can be reset
  if lost or leaked (G2). Who may request a reset and how long it takes are unverified.
  - Consequence: the Android upload key is a **recoverable** secret.
  - So the bar for the Android signer can sit below the bar for the iOS signer.

What the owner must do (d):
1. On the build Mac, use Xcode Organizer's Distribute App so Apple cloud-signs, as Account Holder or Admin
   (A2, A3).
2. When creating the Play app, keep Play App Signing with a Google-generated key (G1, G3). Record the upload
   key's SHA-256 so a reset can be requested later (G2).
3. Decide later whether to try Xcode Cloud (A9, A10).

## 5. Why option (c) is High risk and needs the owner

AGENTS.md: no agent may change `.github/` workflows. CI is a Code Owner path (`.github/CODEOWNERS`).
Option (c) needs:
- a new workflow file;
- a new Environment with protection rules;
- signing secrets in GitHub.

All three are changes to repository protections and secrets on a **public** repository. Under the project's
rules that is High risk: the owner's explicit approval, Code Owner review, and secrets the owner enters
personally. Agents can draft the workflow only after that approval.

## 6. Tracker items

The tracker's text for LR-06, LR-07c, LR-08, LR-48 and LR-49 is **not in this repository**, so this paper
cannot quote it. The brief names them as the items a trusted signer unblocks. The table assumes each one
needs a signed store build. **The lead should check this mapping against the tracker.**

| Option | iOS items (signed `.ipa`, TestFlight) | Android items (signed `.aab`, Play) | When |
|---|---|---|---|
| (a) | all five that need a signed iOS build | all five that need a signed Android build | only after the owner settles the Mac |
| (b) | all | all | as soon as the clean Mac is set up (about a day) |
| (c) | all, **once a `.p12` exists** (made on (a) or (b), or via unverified CLI cloud signing) | all, once a keystore exists | after the owner approves and sets up the Environment |
| (d) | not a build machine; with (a) or (b) it removes the stored distribution key | sets the recovery path for the upload key | with whichever machine is chosen |

## 7. Recommendation (the lead's recommendation, pending the owner's decision)

**For the first release within days: option (b) plus (d).**
- The owner provides a separate clean Mac, used only for signing, with no AI agent sessions and no other
  projects on it.
- iOS: archive with `scripts/mobile/build-store.sh ios`, then distribute from the Xcode Organizer so Apple
  cloud-signs (A2). No distribution private key needs to be kept on disk (A6 still unverified).
  - `flutter build ipa` also tries to export. Without a distribution certificate that export may fail (**unverified**: the Flutter page does not say). The
    script runs under `set -euo pipefail`, so it then stops before printing where the symbols and dSYMs
    are. The files are still written: `build/symbols/ios/<BUILD_NAME>+<BUILD_NUMBER>` and
    `build/ios/archive/Runner.xcarchive/dSYMs`.
  - The archive is at `build/ios/archive/Runner.xcarchive`, not in the Organizer's own list. Open it by
    hand (double-click it, or `open` it) so the Organizer shows it, then choose Distribute App.
- Android: generate the upload key on that Mac, keep it in the password manager, and keep Play App
  Signing with a Google-held app signing key (G1), so a leaked upload key is recoverable (G2).

Why (b):
- It does not wait on the open security question about this Mac (a).
- It does not need High-risk repository changes before the first build (c).
- It keeps the keys away from the machine where agents run code.

**Fallbacks:**
- If no clean Mac can be had in days, option (a). The owner must first declare this Mac settled in
  writing, and no agent sessions should run while the keys are in use.
- **Later, for repeatable releases:** option (c), once the owner approves (§5). The `.p12` and keystore
  are then made on the clean Mac and entered in GitHub by the owner.
- Xcode Cloud only after a spike confirms Flutter builds and signing (A10).

**Assumptions to confirm:**
- The owner can obtain a spare Mac. No price is quoted here because none was verified.
- The tracker mapping in §6.
- Whether the owner's Apple ID is Account Holder or Admin on `KX683HAR3Y`.
