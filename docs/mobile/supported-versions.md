# Supported OS versions

| Platform | Minimum | Where it is set | Why |
|---|---|---|---|
| iOS | **15.0** | `IPHONEOS_DEPLOYMENT_TARGET` in `ios/Runner.xcodeproj` | iPhone only for Phase 1 (`TARGETED_DEVICE_FAMILY = 1`) |
| Android | **8.0 (API 26)** | `minSdk` in `android/app/build.gradle.kts` | PD-56, the department head's decision of 2026-11-02: Sentry's SDK (crash reporting) needs API 26, and Android 7.x is a very small share of devices. Before this it was API 24 |

The store listings should say the same: "Requires iOS 15.0 or later" (App Store,
automatic) and Android 8.0+ (Google Play, from the bundle).
