# Release readiness in CI (LR-50, LR-51, LR-52, LR-58/LR-73)

**Workflow:** `.github/workflows/release-readiness.yml` ("Release readiness").
**Runs on:** every pull request that touches `android/**`, `ios/**`, `pubspec.*`, `lib/**`,
`scripts/mobile/**` or the workflow itself, and by hand (`workflow_dispatch`).
**Evidence:** two text artifacts per run, `release-readiness-android-report` and
`release-readiness-ios-report`. Every check is one line starting with `PASS`, `FAIL` or `NOT VERIFIED`;
the other lines (tool versions, hashes, values read) are context.

This is evidence gathered **before any real signing exists**. Nothing it builds is for distribution,
and nothing it builds leaves the runner: only the text reports are uploaded.

## How the builds are made

| | Android | iOS |
|---|---|---|
| Runner | `ubuntu-latest`, JDK 17 preinstalled | `macos-26`, Xcode 26 selected with `xcode-select` |
| Flutter | 3.47.2 (same pin as `ci.yml`) | 3.47.2 |
| Build | `scripts/mobile/build-store.sh android` (the real store path) | `build-store.sh check`, then `flutter build ios --release --no-codesign` with the script's `--dart-define` set |
| Signing | a throwaway key made in the job (random password, masked) | none (`--no-codesign`) |
| Firebase | a placeholder `google-services.json`, project `ci-not-for-distribution` | not used on iOS |
| URLs, DSN | placeholders on the reserved `.invalid` domain | the same |

`android/app/build.gradle.kts` refuses a release build without `android/key.properties` and
`android/app/google-services.json`, so the job creates throwaway ones. They exist only on the runner.
The iOS build cannot use `build-store.sh ios` because that runs `flutter build ipa`, which must sign;
its `--dart-define` list is repeated in the workflow and must be kept in step with the script.

## What each check proves

| Item | Check | Proves |
|---|---|---|
| LR-50 | `aapt2 dump badging` on a universal APK made from the AAB by `bundletool` | the packaged manifest says `targetSdkVersion` 36 and `minSdkVersion` (`sdkVersion`) 26, for package `com.jawwid.jawwid_chat` |
| LR-51 | `readelf -lW` on every `base/lib/**/*.so` inside the AAB | every 64-bit (`arm64-v8a`, `x86_64`) ELF `LOAD` segment has `p_align` of at least 16 KB (0x4000), so the libraries load on 16 KB-page devices. Play's rule covers 64-bit ABIs only; 32-bit libraries are listed as `INFO` |
| Data safety | `aapt2 dump permissions` on the universal APK | the merged manifest (with every library's permissions) has no `AD_ID`, matching "Advertising ID: not collected"; the full permission list is in the report |
| (tests) | `./gradlew :app:testDebugUnitTest`, results read from `build/app/test-results` | the Android JVM unit tests under `android/app/src/test` ran (at least one, not skipped) and passed; no other workflow runs them. A commit with no such tests (today's `main`; they arrive with #449 and #524) is `NOT VERIFIED`, not a pass |
| LR-51 | `zipalign -c -P 16 -v 4` on the universal APK (build-tools 35+) | uncompressed native libraries start on a 16 KB boundary inside the APK |
| LR-52 | `plutil` on `Runner.app/Info.plist` | `DTXcode` is 2600 or more and `DTSDKName` starts with `iphoneos26`: the app was built with Xcode 26 and the iOS 26 SDK |
| LR-58/LR-73 | `Runner.app/PrivacyInfo.xcprivacy` exists and passes `plutil -lint` | the privacy manifest is copied into the built app and is a valid property list |
| (identity) | `CFBundleIdentifier`, `ITSAppUsesNonExemptEncryption` | the built app is `com.jawwid.jawwidChat` and declares no non-exempt encryption |

Any mismatch is a `FAIL` line and fails the job.

## What it does NOT prove

- **No real signing.** The Android build is signed with a throwaway key; the iOS app is not signed.
  Nothing here shows that the upload key, the Apple Distribution certificate or the provisioning
  profile exist or work (see `docs/release/signed-build-options.md`).
- **No store upload or store-side processing.** Play Console and App Store Connect run their own checks
  (Play's 16 KB check, Apple's privacy-manifest and SDK checks, review). A pass here is a strong
  indicator, not their verdict.
- **Not the production configuration.** The URLs, Sentry DSN and Firebase project are placeholders, so
  the app built here cannot reach any server and push cannot work.
- **The privacy manifest's content.** `plutil -lint` proves the file is well-formed, not that the
  declared data types and required-reason APIs are complete or correct. Third-party SDK manifests
  inside frameworks are not inspected.
- **Device behaviour.** Nothing is installed or run on a device or emulator.
- **Play's split APKs.** The checks use a universal APK. Play delivers split APKs built by its own
  bundletool; the ELF check reads the AAB's libraries directly, which covers both.
- **Compressed native libraries.** `zipalign -P 16` concerns libraries stored uncompressed (the default
  for this app's min SDK). If a library were stored compressed, the ELF check still applies.

## `NOT VERIFIED`

A check that cannot run reliably is reported `NOT VERIFIED`, with a workflow warning, and never as
`PASS`. bundletool 1.18.3 is pinned by the SHA-256 GitHub publishes for its release asset; a jar that
does not match is never run, and that is a `FAIL`. `NOT VERIFIED` can happen for:

- **zipalign** if the runner's newest Android build-tools are older than 35 (no `-P` option).
