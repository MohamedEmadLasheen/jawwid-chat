# Store builds (PD-56)

Build the App Store and Google Play binaries **only** with
`scripts/mobile/build-store.sh`. Before it builds anything, it refuses to run
unless every value a store build must carry is set and is `https`. A store
build can therefore never ship without its privacy and terms links.

## The command

```bash
API_BASE_URL=https://api.example.org/api/v1 \
PRIVACY_POLICY_URL='https://example.org/{lang}/privacy' \
TERMS_URL='https://example.org/{lang}/terms' \
LESSONS_ORIGIN=https://lessons.example.org \
scripts/mobile/build-store.sh ios
```

Use `android` instead of `ios` for Google Play, or `check` to run only the checks.

| Variable | Required | Meaning |
|---|---|---|
| `API_BASE_URL` | yes | the production API, ending in `/api/v1`; compiled in (`JAWWID_API_BASE_URL`) |
| `PRIVACY_POLICY_URL` | yes | the owner's privacy policy; `{lang}` becomes `ar` or `en` |
| `TERMS_URL` | yes | the owner's terms of use; `{lang}` as above |
| `LESSONS_ORIGIN` | no | PD-29 lesson audio (`JAWWID_LESSONS_ORIGIN`); unset means no audio |
| `SENTRY_DSN` | no, but set it for the store | the app's Sentry DSN (S-07); unset means the build reports no crashes, and the script warns |
| `SENTRY_ENVIRONMENT` | no | the Sentry environment; `production` by default |

None of these is a secret.

- **`ios`** runs `flutter build ipa --release`. Xcode signs with team
  `KX683HAR3Y` and `Runner/RunnerRelease.entitlements` (`aps-environment`
  `production`); Debug and Profile keep `Runner.entitlements` (`development`).
- **`android`** runs `flutter build appbundle --release`. It needs
  `android/key.properties`, which is never committed; without it the script
  stops before building. The release `signingConfig` is store-compliance PR-D.

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
- Background modes: `voip`, `remote-notification` and `audio` (calls).
- Notification permission: asked when push registration starts, which is when a
  session begins (after sign-in), never at launch (`AppDelegate.startRegistering`).

## What the Android build carries

- `android:allowBackup="false"`: no cloud backup or device transfer of the
  session or preferences.
- Merged release permissions (checked 2026-11-03 from a built AAB): INTERNET,
  ACCESS_NETWORK_STATE, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS, POST_NOTIFICATIONS,
  USE_BIOMETRIC, USE_FINGERPRINT, WAKE_LOCK. No camera, storage, media, location,
  foreground-service or exact-alarm permission, so no Play permission declaration
  form is needed.
- Every native library is 16 KB page aligned (Play's requirement for target SDK 35+).
- Every usage string in Arabic and English (`ar.lproj` and `en.lproj`
  `InfoPlist.strings`).

## Store listings

| Store | Field | Value |
|---|---|---|
| both | privacy policy URL | `PRIVACY_POLICY_URL` with `{lang}` filled in |
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
