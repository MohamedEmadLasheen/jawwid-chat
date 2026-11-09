# Store builds (PD-56)

Build the App Store and Google Play binaries **only** with
`scripts/mobile/build-store.sh`. Before it builds anything, it refuses to run
unless every value a store build must carry is set and is `https`. A store
build can therefore never ship without its privacy and terms links.

## The command

```bash
BUILD_NAME=1.0.1 BUILD_NUMBER=2 \
SENTRY_DSN='<the app DSN>' \
API_BASE_URL=https://api.jawwid.com/api/v1 \
PRIVACY_POLICY_URL='https://example.org/{lang}/privacy' \
TERMS_URL='https://example.org/{lang}/terms' \
SUPPORT_URL='https://example.org/{lang}/help' \
SUPPORT_EMAIL=support@example.org \
LESSONS_ORIGIN=https://lessons.example.org \
scripts/mobile/build-store.sh ios
```

Use `android` instead of `ios` for Google Play, or `check` to run only the checks.

| Variable | Required | Meaning |
|---|---|---|
| `BUILD_NAME` | yes | the version shown to users, `x.y.z` digits only; passed as `--build-name`. `pubspec.yaml`'s version is not used |
| `BUILD_NUMBER` | yes | a positive integer, higher than the last upload to App Store Connect / Play (they refuse a repeat); passed as `--build-number` |
| `API_BASE_URL` | yes | the production API, https, ending in `/api/v1`; compiled in (`JAWWID_API_BASE_URL`). The host is refused if any label (split on `.` and `-`) is staging, stage, dev, develop, test, testing, qa, uat, sandbox, preview, local, localhost, example, ngrok or internal, or if it is an IP literal or has user info. The accepted host is printed in the summary |
| `PRIVACY_POLICY_URL` | yes | the owner's privacy policy; `{lang}` becomes `ar` or `en` |
| `TERMS_URL` | yes | the owner's terms of use; `{lang}` as above |
| `SUPPORT_URL` | yes | the support / help page (Apple 1.2 and 1.5: published contact information); an https URL, `{lang}` as above. The app shows it as "Help and support" in Settings and under the sign-in form |
| `SUPPORT_EMAIL` | yes | the support address, like `support@example.org`. The app shows it as "Contact support" (opens the mail app) in Settings and under the sign-in form, and names it where a person cannot be blocked |
| `LESSONS_ORIGIN` | no | PD-29 lesson audio (`JAWWID_LESSONS_ORIGIN`); unset means no audio. If set, the same host rule as `API_BASE_URL` applies |
| `SENTRY_DSN` | yes | the app's Sentry DSN (S-07), https. A store build without it is refused. The script never prints it |
| `SENTRY_ENVIRONMENT` | no | the Sentry environment; `production` by default |

The script refuses to start when `SUPPORT_URL` is missing or not
https, or `SUPPORT_EMAIL` is missing or not an address. A non-store build (a plain
`flutter run`, `scripts/mobile/build-teacher-web.sh`) may leave them unset: the app then hides
the matching row instead of showing a broken one.

- **`ios`** runs `flutter build ipa --release`. Xcode signs with team
  `KX683HAR3Y` and `Runner/RunnerRelease.entitlements` (`aps-environment`
  `production`); Debug and Profile keep `Runner.entitlements` (`development`).
- **`android`** runs `flutter build appbundle --release`. It needs
  `android/key.properties`, which is never committed; without it the script
  stops before building. The release `signingConfig` is store-compliance PR-D.

## Debug symbols (LR-22)

The build passes `--split-debug-info=build/symbols/<ios|android>/<BUILD_NAME>+<BUILD_NUMBER>`
(no `--obfuscate`), so Dart stack traces in Sentry are only readable with those symbols. Keep the
folder for every build you ship, and for iOS also the dSYMs
(`build/ios/archive/Runner.xcarchive/dSYMs`). The script prints both locations when it finishes.

**CI builds** (`.github/workflows/release-store-builds.yml`, `docs/release/signed-builds-ci.md`) upload
them automatically, **before** the store upload so a failure stops the release: sentry-cli 3.8.2
(SHA-256 pinned, `scripts/mobile/install-sentry-cli.sh`) with the `store-release` Environment's
`SENTRY_AUTH_TOKEN` secret and `SENTRY_ORG` / `SENTRY_PROJECT` (and optional `SENTRY_URL`) variables,
all passed through the environment:

- Android: `sentry-cli debug-files upload build/symbols/android/<BUILD_NAME>+<BUILD_NUMBER>`, and
  `sentry-cli upload-proguard build/app/outputs/mapping/release/mapping.txt` when the R8 mapping file
  exists (the 3.x command names are UNVERIFIED; a wrong one fails the job before any upload);
- iOS: `sentry-cli debug-files upload` on the archive's `dSYMs` and on
  `build/symbols/ios/<BUILD_NAME>+<BUILD_NUMBER>`.

For a build made by hand, upload them yourself, with your own Sentry auth token in your shell (never in
the repo or the script). `ORG` and `PROJECT` are the Sentry organisation and project slugs:

```bash
export SENTRY_AUTH_TOKEN=...   # yours; do not commit or paste it anywhere
sentry-cli debug-files upload --org ORG --project PROJECT \
  build/ios/archive/Runner.xcarchive/dSYMs
sentry-cli debug-files upload --org ORG --project PROJECT \
  build/symbols/ios/1.0.1+2
sentry-cli debug-files upload --org ORG --project PROJECT \
  build/symbols/android/1.0.1+2
```

## What the iOS build carries

- `ios/Runner/PrivacyInfo.xcprivacy`:
  - no tracking;
  - the collected data types, all linked to the account and used for the
    app's function: name, e-mail, coarse location, photos and videos, audio,
    other user content, user id, device id, crash data (Sentry, with a hash of
    the actor id);
  - the required-reason APIs: UserDefaults `CA92.1`, file timestamp `C617.1`
    and system boot time `35F9.1`. The last is `flutter_webrtc`'s
    `mach_absolute_time`. Five plugins ship no manifest of their own:
    audio_session, flutter_webrtc, just_audio, livekit_client and
    path_provider_foundation.
- **App Store Connect's privacy label must say the same as the manifest.**
  When a data type is added to the app, update both.
- `ITSAppUsesNonExemptEncryption = false`: only the system's exempt TLS and
  WebRTC's DTLS-SRTP are used, so no export-compliance question is asked per
  build.
- iPhone only for Phase 1 (`TARGETED_DEVICE_FAMILY = 1`; the department
  head's decision, 2026-11-02).
- Background modes: `voip` and `audio` (calls). No `remote-notification`: the server sends iOS no silent push (LR-24, #531).
- Notification permission: asked when push registration starts, which is when a
  session begins (after sign-in), never at launch (`AppDelegate.startRegistering`).
  The push PRs (#449 with #408) replace this: the app explains first and asks only
  after "Turn on".
- `NSPhotoLibraryAddUsageDescription`: the share sheet's "Save Image" for a board
  exported as PNG needs it, or iOS terminates the app.
- Every usage string in Arabic and English (`ar.lproj` and `en.lproj`
  `InfoPlist.strings`).

## What the Android build carries

- `android:allowBackup="false"`: no cloud backup or device transfer of the
  session or preferences.
- Merged release permissions (checked 2026-11-03 from a built AAB): INTERNET,
  ACCESS_NETWORK_STATE, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS, POST_NOTIFICATIONS,
  USE_BIOMETRIC, USE_FINGERPRINT, WAKE_LOCK. No camera, storage, media, location,
  foreground-service or exact-alarm permission, so no Play permission declaration
  form is needed.
- Every native library is 16 KB page aligned (Play's requirement for target SDK 35+).
- Push notifications are not in this build line: Android FCM, the call ring, and
  notification display and taps are PRs #408, #411 and #449. When #408 lands:
  - a release build needs `android/app/google-services.json` (its Gradle guard
    refuses to build without it);
  - the manifest gains `USE_FULL_SCREEN_INTENT`, which needs the Play Console
    full-screen-intent declaration.
  - With #411, a call foreground service (type `microphone` only; LR-14 removed `phoneCall`
    because the app has no Telecom ConnectionService), which needs the
    foreground-service declaration and a video.

## Store listings

| Store | Field | Value |
|---|---|---|
| both | privacy policy URL | `PRIVACY_POLICY_URL` with `{lang}` filled in |
| App Store | support URL | `SUPPORT_URL` with `{lang}` filled in |
| both | support / contact e-mail | `SUPPORT_EMAIL` |
| Google Play | account deletion URL | `<API origin>/api/v1/account-deletion`; `?lang=en` for English |
| App Store | account deletion | in the app: Settings → Delete account (parents and teachers) |

Before a store build is submitted, release-qa checks a signed build on a real
iPhone.

## App icon and launch screen (PD-56 PR-G)

The owner (2026-11-03): use the official Jawwid logo, preserve its design and colours, and
invent nothing. So the icons are composed from the original
(`assets/brand/source/jawwid-logo-original.jpg`, sha256 `32907c53…0dd90cec`). The only
operations are: trim the white margin, scale with Lanczos, centre on the logo's own white, and
make near-white pixels transparent for the Android layers. No logo pixel changes colour.

| Output | From |
|---|---|
| iOS AppIcon (every size, 1024 opaque) | `assets/brand/app-icon-1024.png` (the lockup at 78% width on white) |
| Android launcher and adaptive icon (white background) | `assets/brand/adaptive-foreground-1024.png` (the lockup inside the 66% safe circle) |
| Google Play listing icon (upload by hand) | `assets/brand/play-store-icon-512.png` |
| Launch screen, iOS and Android, light and dark (white: the logo has no dark-background version) | `assets/brand/splash-logo.png`, `splash-android12-1152.png` |

To regenerate after a new logo (Pillow in a virtualenv):

```bash
python3 scripts/brand/make-app-icons.py
dart run flutter_launcher_icons
dart run flutter_native_splash:create
```

Then restore `ios/Runner/Info.plist` and `ios/Runner.xcodeproj/project.pbxproj`. Both tools
rewrite them needlessly: the splash tool re-indents the plist, and the icon tool sets
`ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS` to `AppIcon`.

`bash scripts/qa/guards.sh app-icons` fails if any icon or launch image is Flutter's template,
or if the 1024 icon has an alpha channel.

**The 1024 is soft.** The source logo is only 348×126 px of artwork, so the 1024 icon is a
~2.3× upscale. A vector (SVG) or high-resolution original from the owner would make the store
artwork crisp. Rerun the three commands above with it as the source.
