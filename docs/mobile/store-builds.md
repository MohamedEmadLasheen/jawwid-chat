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
    other user content, user id, device id;
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
