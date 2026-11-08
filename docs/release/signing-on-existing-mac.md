# LR-76 follow-up: signing store builds on the existing Mac (no second Mac)

**Status:** for the owner's decision. Documents only; nothing here creates a user, key, certificate,
secret or workflow.
**Date:** 2026-11-08. **Risk of this paper:** Low.
**Roles:** security reviewer and release manager (builder session), for the engineering lead.
**Builds on:** `docs/release/signed-build-options.md` (branch `claude/lr76-signed-build-options`, "the
options paper"). Its facts A1–A12, G1–G5 and H1–H8 and its options (a)–(d) are not repeated here.
This paper answers one new question: the owner has **no second Mac**, so option (b) of the options paper
is unavailable. What is the safest way to sign on the Mac we have?

## 1. Facts about this Mac (from the brief, not re-checked here)

- The owner is the Apple **Account Holder** on team `KX683HAR3Y`.
- On 2026-10-24 an internal triage classed this Mac as **"INFECTED-EVIDENCE"**:
  - on 2026-10-06 an agent session ran a malicious loader from another project's code (a blockchain-C2
    chain loader);
  - stage-2 files appeared in the user's home (`~/.node_modules`), followed by an unexplained `pip`
    network call;
  - the triage recommended **credential rotation and an OS reinstall**. The owner has not decided yet.
- All agents (Claude, Codex) run as the owner's macOS user, which is an **administrator**.
- Nobody has shown how far the malware got. It is **not known** whether it obtained root, persisted, or
  read the owner's browser sessions, keychain or tokens. This paper therefore assumes it may have.

## 2. New verified facts (read on the official page on 2026-11-08)

**UNVERIFIED** marks anything the official page did not say. "(summary)" marks a fact read only from a
summary of a long page that the fetch tool truncated; re-check those on the live page before relying on
the exact wording.

**macOS users, keychains, FileVault**
- M1. "Standard users can install apps and change their own settings, but can't add other users or change
  other users' settings." "An administrator can add and manage other users, install apps, and change
  settings." <https://support.apple.com/guide/mac-help/change-users-groups-settings-mtusr001/mac>
- M2. On File Sharing: "The Public folder of each user with an account on your Mac is shared
  automatically." and "A user with an administrator account can access your entire Mac."
  <https://support.apple.com/guide/mac-help/set-up-file-sharing-on-mac-mh17131/mac>
- M3. "Permission settings determine who can view and alter files on the computer." "An administrator can
  control permissions for individual users on a single Mac."
  <https://support.apple.com/guide/mac-help/change-permissions-for-files-folders-or-disks-mchlp1203/mac>
- M4. "An initial default keychain is created for each Mac user, though users can create other keychains
  for specific purposes." "the securityd daemon determines which keychain items each process or app can
  access". <https://support.apple.com/guide/security/keychain-data-protection-secb0694df1a/web>
- M5. "When you create a user, their keychain password is set to match their login password." "The
  keychain password is available only to the user and not the administrator."
  <https://support.apple.com/guide/keychain-access/about-your-keychain-password-mchlp1086/mac>
- M6. "If an app is changed or infected by a virus after being granted access to your keychain, the app is
  no longer trusted, and you must grant access again."
  <https://support.apple.com/guide/keychain-access/if-a-trusted-app-asks-for-keychain-access-kyca1331/mac>
- M7. FileVault: "to secure all data at rest". "Without valid login credentials or a cryptographic
  recovery key, the internal APFS volumes remain encrypted". "To set up FileVault, you must be an
  administrator." Other users are enabled with their own login password ("Enable Users").
  <https://support.apple.com/guide/security/volume-encryption-with-filevault-sec4c6dc1b6e/web>,
  <https://support.apple.com/guide/mac-help/protect-data-on-your-mac-with-filevault-mh11785/mac>
- M8. System Integrity Protection limits writes to "critical system files" "regardless of whether that
  process is running sandboxed or with administrative privileges".
  <https://support.apple.com/guide/security/system-integrity-protection-secb7ea06b49/web>
- M9. Lock screen: "Require password after screen saver begins or display is turned off"; "When the Mac
  wakes, a user login password must be entered before the Mac can be used."
  <https://support.apple.com/guide/mac-help/change-lock-screen-settings-on-mac-mh11784/mac>
- M10. Fast user switching lets several users be "logged in at the same time".
  <https://support.apple.com/guide/mac-help/switch-quickly-between-users-mchlp2439/mac>
- M11. Erase All Content and Settings: "erase all of your data, settings, and apps, while maintaining the
  operating system currently installed". It "requires macOS Monterey 12 or later" and an Apple silicon or
  T2 Mac. <https://support.apple.com/en-us/102664>
- **UNVERIFIED on an official page today:**
  - that an administrator can become root with `sudo` and so read every user's files. This is standard
    Unix behaviour on macOS, but no Apple page fetched today says it. This paper relies on it;
  - the Keychain Access steps to create a new keychain, set it to lock after inactivity or on sleep, and
    the Access Control tab labels ("Allow all applications…", "Confirm before allowing access", "Always
    allow access by these applications"). The current Keychain Access guide has no such articles;
  - Apple's steps to reinstall macOS from macOS Recovery (not fetched).

**Apple signing and App Store Connect**
- C1. WWDC21 "Distribute apps in Xcode with cloud signing" (Apple's session transcript, 2021, not reference
  documentation): <https://developer.apple.com/videos/play/wwdc2021/10204/>
  - "Anyone with an Admin or Account Holder role on App Store Connect can cloud sign for App Store Connect
    distribution by default."
  - A Developer needs "the Access to Cloud Managed Distribution Certificate checkbox".
  - "The xcodebuild -exportArchive command is used to automate distribution, and it takes in an archive,
    export options plist, and credentials." "I'll need to ensure xcodebuild has access to valid
    credentials in order to successfully cloud sign and upload to the App Store."
  - "New in Xcode 13, you can use App Store Connect keys to sign in to xcodebuild without ever signing
    into Xcode." The flags are `-authenticationKeyIssuerID`, `-authenticationKeyID` and
    `-authenticationKeyPath`, and "xcodebuild still requires allow provisioning updates".
  - This **answers the options paper's A5 in principle**: `xcodebuild -exportArchive` with
    `-allowProvisioningUpdates` and an App Store Connect key can cloud-sign. **UNVERIFIED:** that it still
    works this way in the current Xcode (the Xcode 13 release notes page returned no text), which key role
    is enough, and that `flutter build ipa` / our build script passes these flags (it does not today;
    a test export is needed).
- C2. The cloud-managed certificates page: "Additional permissions are available in App Store Connect to
  enable Admins and Developers to sign apps and software with these certificates." Managing them:
  "Required role: Account Holder or Admin."
  <https://developer.apple.com/help/account/certificates/cloud-managed-certificates/>
  **UNVERIFIED:** whether the current role table still gives Admin cloud signing by default (the WWDC21
  quote above says so; the current table could not be read column by column).
- C3. App Store Connect API keys (summary):
  <https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api>
  - team keys: "Required role: Account Holder or Admin."; individual keys can be made by more roles;
  - "API keys are private and can only be downloaded once.";
  - for a team key, "Under Access, select the role permissions"; "Once you generate an API key, you can't
    edit its name or access level.";
  - revoke: Users and Access → Integrations → Edit → "Revoke Key"; "An API key can't be reinstated once
    it's been revoked."
  - **UNVERIFIED:** whether revocation takes effect immediately.
- C4. Revoking a certificate: "Required role: Account Holder or Admin." "Provisioning profiles that contain
  a revoked certificate become invalid."
  <https://developer.apple.com/help/account/certificates/revoke-a-certificate>. For App Store
  distribution: "If your Apple Developer Program membership is valid, your existing apps on the App Store
  won't be affected." <https://developer.apple.com/support/certificates/> (this closes the options paper's
  A12).

**Google Play**
- P1. Play Console: the account owner is "The first registered account in Play Console." and "Has full
  access to Play Console." A separate permission covers "Use Play App Signing to sign APKs."
  <https://support.google.com/googleplay/android-developer/answer/9844686>
- P2. "To configure Play App Signing, you must have admin permission." The upload key holder is "You (Keep
  this secure!)". Reset: "In the 'Upload key certificate' section, click **Request upload key reset**."
  and "Enter the reason for the reset." <https://support.google.com/googleplay/android-developer/answer/9842756>
  **UNVERIFIED:** which permission may request the reset (the page does not say; the account owner, who has
  full access per P1, should be able to), how long until the new key works, and any backup advice (the
  page gives none).

**GitHub**
- H9. "each GitHub-hosted runner is a new virtual machine (VM) hosted by GitHub"; macOS runners exist.
  <https://docs.github.com/en/actions/using-github-hosted-runners/using-github-hosted-runners/about-github-hosted-runners>
  Hardening: GitHub-hosted runners "execute code within ephemeral and clean isolated virtual machines";
  "Pin actions to a full-length commit SHA".
  <https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions>
  **UNVERIFIED:** which Xcode versions the current macOS image has (listed in `actions/runner-images`, not
  fetched).

## 3. The two separate problems

Keeping the **keys** away from agents and malware is one problem. Knowing that the **binary** is what we
meant to ship is another. A dedicated user answers some of the first, and none of the second.

- **Key theft.** The Android upload key is recoverable (options paper G1/G2; P2). An iOS cloud-managed
  certificate has no local private key to steal (options paper A2; C1). The real iOS secrets become the
  owner's **Apple ID session** and any **App Store Connect API key**: whoever holds either can cloud-sign
  and upload (C1).
- **Build tampering.** Malware that can write to Xcode, Flutter, CocoaPods, Gradle caches, the repository
  checkout, or the signing user's processes can put its own code into the app **before** it is signed. The
  signature then vouches for the malware. This is the worse outcome: it ships to users' phones under our
  name, and no key rotation undoes it.
- **Account takeover.** Every option needs the owner's Apple, Google and GitHub accounts. If those
  sessions or passwords were taken from this Mac, an attacker can sign or approve releases without
  touching our keys. **Credential rotation, from a trusted device, is a precondition of every option
  below**, not only of the "reinstall" ones.

## 4. Evaluation of each measure

### 4.1 A dedicated Standard (non-admin) macOS user for release signing

What macOS separates between users:
- Each user has their own default (login) keychain, protected by that user's password, which "is available
  only to the user and not the administrator" (M4, M5).
- File permissions decide who can read whose files (M3). By default another user's Public folder is
  shared, not their whole home (M2). **UNVERIFIED:** Apple does not state today's default home-folder mode;
  the lead should check it after creating the user (`ls -ld /Users/<signing-user>`; expect no read access for
  others).
- A Standard user cannot change other users or system-wide settings (M1).
- FileVault protects the disk at rest: when the Mac is off, nothing is readable without a password or the
  recovery key (M7). It does **not** protect one logged-in user from another; while the Mac runs, the disk is
  unlocked for every process.

What it does **not** protect against:
- **Malware running as the admin user.** An administrator "can access your entire Mac" over the network
  (M2), controls permissions (M3) and, with `sudo`, becomes root (UNVERIFIED on an Apple page; standard
  behaviour). Root can read the signing user's files, attach to its processes and record its keystrokes.
  Whether the 2026-10-06 malware already has the admin password or root is **unknown**.
- **Root-level persistence.** SIP protects critical system files even from admin processes (M8), but not
  `/Applications`, `/Library`, `/usr/local` or `/opt/homebrew`. Software in those shared places (Xcode,
  Homebrew, CocoaPods, a shared JDK) is used by **both** users.
- **A compromised toolchain.** If Xcode, Flutter, Gradle, CocoaPods or a cached dependency was modified, the
  signing user builds with the modified tool. A separate user does not give a separate toolchain unless the
  signing user installs its own Flutter and caches in its own home.
- **The keychain password vs a keylogger.** The keychain is only as safe as its password while it is
  typed on a machine that may log keys.

Verdict: a dedicated Standard user is a **good second wall on a clean Mac**. On this Mac as it is, it stops
only user-level malware that never got the admin password, and nobody can say that is the case.

### 4.2 A separate password-protected keychain and item access control

- macOS lets a user create extra keychains "for specific purposes" (M4), and `securityd` decides which app
  may use each item (M4). An item whose app changes must be granted again (M6).
- Use: put any **local** signing identity (only if cloud signing is not used) in a separate keychain with
  its own long password, not the login password, set to lock after a few minutes and on sleep, and limit
  the private key's access to `codesign` / Xcode with "Confirm before allowing access" (these UI steps are
  **UNVERIFIED**, see §2).
- Limit: this guards against **other user-level apps silently** using the key. It does not guard against
  root, a keylogger, or a modified `codesign`/Xcode, which is exactly the app we would have allowed.
- With cloud signing there is no local distribution private key, so this measure matters mainly if the
  owner later exports a `.p12`. The Android upload keystore is a file (`.jks`) with its own passwords, not
  a keychain item.

### 4.3 Apple cloud-managed distribution certificates

- **Who has access by default:** Account Holder and Admin can cloud-sign for App Store distribution by
  default; Developers need the extra "Access to Cloud Managed Distribution Certificate" permission (C1,
  C2). The owner, as Account Holder, can use it directly.
- **Organizer:** Xcode 13 or later cloud-signs from Organizer → Distribute App when no local certificate is
  found (options paper A2). No distribution private key is kept on the Mac.
- **Command line:** `xcodebuild -exportArchive -allowProvisioningUpdates` with
  `-authenticationKeyPath`, `-authenticationKeyID` and `-authenticationKeyIssuerID` can cloud-sign and
  upload, per Apple's WWDC21 session (C1). This resolves the options paper's A5 in principle. **UNVERIFIED:**
  current-Xcode behaviour and the minimum key role. Test it once (§8 step 9) and record the result.
- **What an API key allows:** a team key carries the role permissions chosen when it is made, which cannot
  be edited later (C3). An Admin-level key can do almost anything an Admin can, including managing users
  (**UNVERIFIED** in detail). Choose the **lowest** role that a test export proves sufficient; try App
  Manager first (the Flutter docs name App Manager for automation, options paper G5), and only if that
  fails, Admin.
- **Revoking:** Account Holder or Admin, Users and Access → Integrations → Revoke Key; it cannot be
  reinstated (C3). Revoking a distribution certificate does not affect apps already on the App Store (C4).
- **Residual risk:** the Apple ID session in Xcode, or the `.p8` key file, *is* the signing power. Keep
  the `.p8` out of the main user entirely.

### 4.4 Android: Play App Signing and the upload key

- Google holds the app signing key; we hold only the upload key, which Google can reset if lost or leaked
  (options paper G1, G2; P2).
- Reset: make a new key, export its certificate to PEM, then Play Console → Play app signing → Upload key
  certificate → **Request upload key reset**, with a reason (P2). Who may ask: **UNVERIFIED**; the owner as
  account owner has full access (P1). Waiting time: **UNVERIFIED**.
- Where to keep it: the `.jks` lives only in the signing user's home (for example
  `~/release/jawwid-upload.jks`, mode 600), its two passwords only in the password manager. Never in the
  repository, never in the main user, never in a synced folder.
- Backup: §6.
- Because the key is resettable, a leak is an inconvenience, not a disaster. Build tampering (§3) is
  still the real Android risk.

### 4.5 Keeping agents away from the signing user

Rules (the lead's, for the owner):
1. No Claude Code, Codex, Cursor, IDE AI plug-ins, or any agent CLI installed or run in the signing user.
   No `~/.claude`, no `~/.codex`, no MCP servers.
2. Before logging in to the signing user: **quit** every agent session and terminal in the main user and
   **log out** of the main user (Apple menu → Log Out), rather than fast-switching (M10), which keeps the
   main user's processes running beside the signing session.
3. Turn on "Require password after screen saver begins or display is turned off" with a short delay (M9),
   in both users.
4. No File Sharing, no shared folders between the users; leave the Public / Drop Box folders empty and
   unused (M2). Move nothing between users except the **public** repository, which the signing user clones
   itself from GitHub.
5. Never copy the keystore, a `.p12`, a `.p8` or their passwords into the main user, into the repository,
   into a chat with an agent, or into an agent brief.
6. The signing user installs its own Flutter (the version `ci.yml` pins) in its own home and uses fresh
   Gradle and CocoaPods caches, so it does not share the main user's `~/development/flutter` or caches.
   Xcode in `/Applications` is still shared (§4.1).
7. The signing user is never used for web browsing, email or anything else.

These rules reduce what **agents** can reach. They do not fix §3: they assume the host itself is clean.

## 5. Build integrity: the deciding factor

An infected host can change what it builds, wherever the keys live. Two ways out:

1. **Settle the Mac first**, as the triage recommended: back up documents only, erase, reinstall macOS,
   rotate credentials, and reinstall tools from official sources. Erase All Content and Settings removes
   "all of your data, settings, and apps" but keeps the installed OS (M11). Whether that meets the
   triage's "OS reinstall" bar is the triage owner's call; the stricter path is a macOS reinstall from
   Recovery (Apple steps **UNVERIFIED** today). Do **not** restore apps, `~/.node_modules`, shell dotfiles,
   `~/.npm`, `~/.cache`, `~/development` or other tool folders from a backup or with Migration Assistant:
   that would bring the infection back. Re-clone repositories from GitHub.
2. **Build on GitHub-hosted runners**: a new, ephemeral VM for each job (H9; options paper H7), signing
   with cloud certificates through an App Store Connect key (C1) and the Android upload keystore held as
   **environment** secrets. This is the options paper's **option (c)**, with the same High-risk owner
   approvals (options paper §5). C1 removes its main blocker (no `.p12` needs to exist), subject to the
   one test export. Note that the owner still approves runs and pastes secrets from **some** device: with
   unrotated credentials or a browser on an infected Mac, an attacker could do the same.

## 6. Backup and recovery

| Secret | Primary copy | Backup | If lost | If leaked |
|---|---|---|---|---|
| Android upload keystore (`.jks`) | signing user's home, mode 600 | password manager (as an attachment, if it supports files) **and** one offline encrypted copy (an encrypted disk image or encrypted USB stick, password in the password manager), kept off the Mac | upload key reset (P2) | upload key reset (P2); then rotate the Play Console passwords |
| Keystore and key passwords | password manager | the password manager's own emergency/recovery kit (offline) | the keystore is useless: reset (P2) | reset (P2) |
| iOS, cloud-managed certificate | Apple (C2) | **nothing to back up** | n/a | revoke/rotate (Account Holder or Admin, C2, C4) |
| iOS, local certificate (only if cloud signing is not used) | separate keychain (§4.2) | export as `.p12` with a strong password; store like the keystore | create a new one (Account Holder or Admin; one distribution certificate type per team, options paper A7) | revoke (C4); App Store apps unaffected |
| App Store Connect API key (`.p8`) | signing user only, or a GitHub environment secret for (C) | **none on purpose**: it downloads once (C3); if lost, revoke and make a new one | revoke, re-create | revoke at once (C3) |

## 7. Comparison

Owner-time figures are the lead's estimates, not measured. Money: only the verified figures of the options
paper are used; none of the options below needs new paid resources.

| | (A) Dedicated user on this Mac as it is | (B) Erase and reinstall, then dedicated user | (C) GitHub-hosted runners | (D) Separate Mac |
|---|---|---|---|---|
| Security | Weak: keys separated from user-level agents only. Build integrity rests on an unsettled host. | Good: clean OS and tools, keys outside the agents' user, cloud iOS signing. | Good to strong: a clean VM per build, no key on any Mac. New attack surface: the workflow, secrets, approvals on a public repository. | Strong (options paper (b)) |
| Residual risk | Root or admin-level persistence, keylogging, tampered Xcode/Flutter/caches; a signed malicious build. | Agents again run as admin in the main user beside the signing user; a future incident repeats the problem. Shared `/Applications` Xcode. | Owner's GitHub account and approval device; third-party actions (pin by SHA, H9); log leaks (options paper H4, H8); an Admin-level `.p8` in GitHub if a lower role fails. | Physical theft |
| Owner time (estimate) | About 1–2 hours: create the user, sign in, first build | About 1 day: backup, erase, reinstall, rotate credentials, reinstall tools, then ~2 hours for the user | About 1–2 hours of approvals and secret entry, after 2–3 days of agent engineering | n/a |
| Money (verified) | none new | none new | free standard runners in a public repository (options paper H1) | **unavailable**; not priced |
| Engineering effort | Small: a checklist | Small: a checklist; agent work resumes after the reinstall | Medium–High: workflow, Environment, test export with the API key; High-risk review | n/a |
| Unblocks LR-76 | Yes, but with a risk the lead does not accept | Yes | Yes | — |
| Unblocks LR-06, LR-07c, LR-48, LR-49, LR-08 | Those needing a signed build, at once (mapping **UNVERIFIED**, see options paper §6) | All needing a signed build, after about a day | All needing a signed build, after approval and setup | — |
| Also settles the machine rule for development | No | **Yes** | No | No |

## 8. Recommendation (the lead's recommendation, pending the owner's decision)

**Option (B) now; option (C) later for repeatable releases. Not (A).**

Why:
- (A) would sign a build on a host classed "INFECTED-EVIDENCE". A separate user does not stop root-level
  malware or a tampered toolchain (§4.1), and a signed malicious build is the one outcome we cannot undo.
- (B) does what the triage already recommended, costs no money, lifts the machine rule for **all**
  development as well, and takes about a day of the owner's time.
- (C) is the better long-term design but needs High-risk approvals and days of engineering; it also
  depends on the owner's accounts being rotated, which (B) does anyway.
- Credential rotation is required in every case (§3).

**Owner actions for (B), in order:**
1. **Decide** on the triage's recommendation (erase and reinstall plus rotation) and tell the lead.
2. **Back up documents only** (not apps, not tool folders, not dotfiles; see §5) to an external disk.
   Confirm every repository you care about is pushed to GitHub.
3. **Erase and reinstall macOS** (§5, M11; the stricter Recovery reinstall if the triage owner asks).
4. **Turn on FileVault** (M7) and the lock-screen password (M9). Keep the Mac on the latest macOS.
5. **Rotate credentials from the clean Mac**, not from the old system: Apple ID, Google (Play Console)
   account, GitHub account and its tokens, password-manager master password, and any API tokens the
   agents used. Sign out of other sessions where each service allows it. Revoke any existing App Store
   Connect API keys you do not recognise (Users and Access → Integrations, C3) and check Certificates,
   Identifiers & Profiles for certificates you did not make (revoke them, C4).
6. **Create the main admin user** for yourself and development, then a **Standard user** named for
   example `release` (Users & Groups, M1), with its own long password, and **Enable** it in FileVault (M7).
7. **In the `release` user only:** install Xcode from the App Store, Flutter (the version `ci.yml` pins)
   from flutter.dev into this user's home, CocoaPods and a JDK 17, as the options paper's (b) lists.
   Sign in to Xcode with your Account Holder Apple ID. Apply §4.5.
8. **iOS, first release:** in `release`, clone the repository, check out the release tag, run
   `scripts/mobile/build-store.sh ios` (or let the lead give the exact command), open
   `build/ios/archive/Runner.xcarchive`, and in Organizer choose **Distribute App** → App Store Connect.
   As Account Holder you can cloud-sign directly (C1, C2); no distribution certificate needs to be created
   or backed up. (The script's own export may fail without a local certificate; see options paper §7.)
9. **Optional, for (C) later:** in App Store Connect → Users and Access → Integrations, create a **team API
   key** with **App Manager** access (C3). Download the `.p8` **once**, inside `release` only. Run one test
   `xcodebuild -exportArchive -allowProvisioningUpdates -authenticationKeyPath … -authenticationKeyID …
   -authenticationKeyIssuerID …` (C1) and record whether App Manager is enough. If it is not, revoke it and
   decide whether an Admin key is acceptable.
10. **Android:** in `release`, generate the upload keystore with the `keytool` line in
    `docs/mobile/android-release-signing.md`, put `google-services.json` and `android/key.properties` in
    place, build with `scripts/mobile/build-store.sh android`, create the app in Play Console and keep **Play
    App Signing with a Google-generated key** (options paper G1, G3). Record the upload certificate's
    SHA-256.
11. **Back up** the keystore and passwords as in §6 (password manager plus one offline encrypted copy).
12. **Tell the lead** in writing that the Mac is reinstalled and credentials are rotated, with the date.
    The lead then lifts the machine rule, and agents work only in the main user.

**If the owner declines the reinstall:** the lead recommends option (C) instead, with credentials rotated
from a trusted device (a phone or another computer), and no release signing on this Mac at all. Option (A)
remains **not recommended**; if the owner still chooses it, it should be limited to Android test tracks
(resettable key) and never used for a production iOS or Play release.

**Owner-only permissions in this plan (Account Holder):** cloud signing for App Store distribution (C1);
creating, revoking and rotating certificates (C2, C4); creating and revoking team API keys (C3); granting
"Access to Cloud Managed Distribution Certificate" to others (C1). Play: account owner, full access (P1).

## 9. Open items (UNVERIFIED)

- The current Xcode's behaviour for `-exportArchive` with an API key and cloud signing, and the minimum key
  role (C1). Settled by step 9.
- Whether the current Apple role table still gives Admin cloud signing by default (C2).
- Which Play permission may request an upload key reset, and how long it takes (P2).
- Keychain Access UI steps for a separate keychain and per-app access (§2).
- Apple's macOS Recovery reinstall steps; the default home-folder permissions for a new user (§2, §4.1).
- The tracker mapping for LR-06, LR-07c, LR-48, LR-49 and LR-08 (options paper §6).
- Owner-time figures are estimates.
