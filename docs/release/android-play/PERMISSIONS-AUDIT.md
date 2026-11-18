# Android permissions audit: Jawwid Chat 1.0.0 (3)

> **Update 2026-11-18, child-directed review (only the parts relevant to permissions):** the 14 permissions are unchanged. Against the Families requirements in `verification-part-C.md`: no `AD_ID`, no location, no contacts and no camera permission (CONFIRMED from the merged manifest); the only Bluetooth permission is LiveKit's legacy `BLUETOOTH` for API 30 and below (low risk, no app code). Whether **Firebase Cloud Messaging, Sentry and LiveKit** are acceptable for a child-directed app is **UNVERIFIED**: Google's pages name none of them. Needed: each vendor's written statement and the Play SDK Index entry (read in the console), plus counsel.


Artifact: `run-44306602707-encrypted/app-release.aab`, SHA-256 `581032996e34e088e63f0d89f42c08084083bf7e22f14d1cba7d8ff89a903dfd` (matches the CI-verified value).
Source commit `2e41270151514df9dd560f79862d03f531b9f09d`. Manifest extracted with bundletool 1.18.3 (`dump manifest`; jar SHA-256 matched GitHub's published digest). Full merged manifest: `merged-manifest-1.0.0-3.xml`.

| # | Permission | Origin | Evidence | Needs a Play form? |
|---|---|---|---|---|
| 1 | INTERNET | App | app manifest | No (normal) |
| 2 | RECORD_AUDIO | App | app manifest | No (runtime prompt) |
| 3 | POST_NOTIFICATIONS | App (also declared by firebase-messaging) | app manifest; firebase-messaging AAR | No (runtime, Android 13+) |
| 4 | USE_BIOMETRIC | App (also local_auth_android) | app manifest; plugin manifest | No |
| 5 | USE_FULL_SCREEN_INTENT | App | app manifest | **Yes: full-screen intent declaration** |
| 6 | FOREGROUND_SERVICE | App | app manifest | No (normal) |
| 7 | FOREGROUND_SERVICE_MICROPHONE | App | app manifest; service type 0x80 = microphone | **Yes: foreground service declaration + video** |
| 8 | ACCESS_NETWORK_STATE | connectivity_plus and firebase-messaging | plugin manifest; AAR manifest | No (normal) |
| 9 | WAKE_LOCK | firebase-messaging | firebase-messaging AAR manifest (24.1.0 and 26.0.0 in the Gradle cache) | No (normal) |
| 10 | com.google.android.c2dm.permission.RECEIVE | firebase-messaging | same AAR manifest | No (push receive) |
| 11 | USE_FINGERPRINT | androidx.biometric 1.1.0 | AAR manifest | No (normal; deprecated alias) |
| 12 | MODIFY_AUDIO_SETTINGS | LiveKit audio routing (`com.github.davidliu:audioswitch`) | AAR manifest in the Gradle cache | No (normal) |
| 13 | BLUETOOTH (maxSdkVersion 30) | same LiveKit audioswitch library | same AAR manifest | No (normal, legacy API 30 and below only) |
| 14 | com.jawwid.jawwid_chat.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION | androidx.core | AAR manifest | No (app-private, signature level) |

Tracking and advertising: `com.google.android.gms.permission.AD_ID` is **absent** (grep count 0). Also absent: location, contacts, SMS, call log, camera, storage and media permissions, QUERY_ALL_PACKAGES.
Other manifest facts: `allowBackup=false`; no `debuggable`, `usesCleartextTraffic`, `networkSecurityConfig` or `testOnly`; no deep-link intent filters (the only launcher filter is MAIN/LAUNCHER); the only foreground service is `CallForegroundService`, type microphone; exported components are the launcher activity, Firebase's `FirebaseInstanceIdReceiver` (protected by the c2dm SEND permission) and AndroidX `ProfileInstallReceiver` (protected by DUMP).

## What must change in `play-declarations.md` §7
1. The sentence "`livekit_client` and `flutter_webrtc` add none" is **wrong for the release bundle**: LiveKit's audio library adds MODIFY_AUDIO_SETTINGS and BLUETOOTH (API 30 and below).
2. Add `USE_FINGERPRINT` (androidx.biometric) and the internal `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` (androidx.core) to the plugin table.
3. WAKE_LOCK and c2dm RECEIVE are now CONFIRMED from firebase-messaging's own manifest (were UNVERIFIED). POST_NOTIFICATIONS is also declared by firebase-messaging.
4. O-5 (advertising ID) and O-6 (merged-manifest permissions) can be closed: AD_ID is absent, and all 14 are explained above.
5. No new Play form is needed beyond the two already listed (foreground service, full-screen intent). The Data safety answers do not change from these permissions.

Not verified here: that each permission is used only as described (runtime behaviour), and the Play Console's own permission list after upload.
