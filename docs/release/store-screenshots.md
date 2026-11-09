# Store screenshots (LR-09j)

**Launch item LR-09j. 2026-11-09.** How to take the App Store and Google Play screenshots again and again, in Arabic
and English, **without a server and without real people** (LR-10). The shot list and captions are in
[`store-console/listing-copy.md` §9](store-console/listing-copy.md); this file is the machine that takes them.

| Part | File |
|---|---|
| The test that drives the real app and takes the shots | `integration_test/store_screenshots_test.dart` |
| The synthetic people, chats, calls and lessons | `integration_test/screenshot_fixtures.dart` |
| The fakes the app runs on (no server, no microphone, no CallKit) | `integration_test/screenshot_fakes.dart` |
| The host side that saves each PNG | `test_driver/integration_test.dart` |
| The script: simulator / emulator, status bar, size check, JPEG copies | `scripts/mobile/screenshots/capture.sh` |

## 1. What the run does

It pumps the **real app** (`JawwidApp`, its router, the app-lock and Terms gates, the call presenter) exactly as
`lib/main.dart` does. It uses the development fixture composition (`lib/app/bootstrap.dart`, `_fakeOverrides`) with the
data swapped for `screenshot_fixtures.dart`. Nothing in `lib/` changes for screenshots. Then, for each language (Arabic
first, then English), it:

1. signs in as a returning user, so there is no sign-in screen and no first-run App lock offer;
2. fixes the app language (`localeOverrideProvider`) and the light theme;
3. moves through the screens with the app's own router and calls `takeScreenshot` on each one;
4. for the call, sends the frame the server sends when the teacher starts the lesson call in the family group
   (`call.incoming`), and the parent answers it. The call joins a silent fake room, not LiveKit.

Every language is a separate test, so each starts from a clean app.

## 2. The shots

Per platform and per language (`<platform>/<ar|en>/<file>.png`):

| File | Screen | Account | Route | listing-copy §9.2 |
|---|---|---|---|---|
| `01_chats` | Chats list: the child's group (pinned), a second child's group, the supervisor, Jawwid support | Parent | `/chats` | 1 |
| `02_conversation_parent` | The family group: supervisor, teacher and parent messages | Parent | `/chats/c_group_1` | 2 |
| `03_calls` | Calls: two lesson calls in the group, a call with the supervisor, a missed call | Parent | `/calls` | (extra) |
| `04_schedule_parent` | The child's schedule: weekly times (Mon, Wed, Fri 16:00) and the coming lessons | Parent | `/children/l_shot_1/schedule` | 4 |
| `05_settings` | Settings (App lock, Language, ...) | Parent | `/settings` | 6 |
| `06_delete_account` | Delete account | Parent | `/settings/delete-account` | 6 |
| `07_call` | The lesson call, live: the teacher's name, the timer, mute / speaker / end | Parent | `/call` | 3 |
| `08_chats_teacher` | The teacher's chats | Teacher | `/chats` | (extra) |
| `09_conversation_teacher` | The same family group, as the teacher reads it | Teacher | `/chats/c_group_1` | (extra) |
| `10_schedule_teacher` | The teacher's Schedule tab: this month's numbers and the coming lessons | Teacher | `/schedule` | 8 |

That is 10 per language and 20 per platform. Pick up to 10 per language for Apple and up to 8 for Play (§3). Shot 5
of listing-copy (the pay sheet) is **not** taken: the review cohort has nothing to pay, and the payment tab name waits
on LR-15. Shot 7 (lesson report) is not taken either, because its content needs the owner's approval.

### The data (LR-10, G-20)

- **Every person is invented for these shots:** the parent "Huda Salem / هدى سالم", the children "Yahya / يحيى",
  "Salma / سلمى" and "Omar / عمر", the teacher "Hassan Mourad / حسن مراد", and the supervisor "Nada Fawzi / ندى فوزي".
  The teacher and supervisor match the review cohort's English names (`review-accounts.md`). The parent does not: the
  Arabic form of the cohort parent's first name is on the G-20 guard list, and the guard scans `integration_test/`.
- **No photo of anybody.** No `avatarUrl` is set anywhere, so every avatar is initials. There is no child imagery.
- **No Quran text, no lesson content, no prices.** The messages are everyday academy talk, written separately in each
  language (not machine-translated on the fly).
- The sign-in identity is on `example.com`, a domain reserved for examples.
- Times: the chats are anchored at **09:41 today** on the device (the same time as the status bar). Lessons are in
  the 7 days after the run, so they are always "coming", whatever day the run happens.

## 3. Sizes, and where they come from

| Store | What the run makes | Source |
|---|---|---|
| Apple, iPhone | **1320 × 2868** portrait, on an **iPhone 17 Pro Max** simulator (`IOS_DEVICE_TYPE`; iPhone 16 Pro Max is the same size) | Apple, [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/), read on 2026-11-09 |
| Google Play, phone | **1080 × 1920** portrait (9:16), on an emulator with the `pixel` hardware profile | [Play: preview assets](https://support.google.com/googleplay/android-developer/answer/9866151). **Not readable from this machine on 2026-11-09**; the rules below are the long-standing ones already in listing-copy §9.1 |

**Apple (read on 2026-11-09).** The page names device rows, not inches. The "6.9-inch" class is **"iPhone with Dynamic
Island (large display)"**. It accepts portrait 1260 × 2736, 1290 × 2796 and **1320 × 2868**, and it lists iPhone 18 Pro
Max, 17 Pro Max, 16 Pro Max, 16 Plus, 15 Pro Max, 15 Plus and 14 Pro Max. The formats are .jpeg, .jpg or .png, and
"Images can't include alpha channels or transparencies". Each device size takes 1 to 10 screenshots.
**Re-check one point on the page before upload:** our reading of the "Required device sizes" section may say Apple
requires at least one screenshot for **"iPhone with Dynamic Island (medium display)"**. That part of the page came to
us summarized rather than word for word. If App Store Connect asks for that slot, run again with the matching simulator
and size:
`IOS_DEVICE_TYPE=… IOS_EXPECT_WIDTH=… IOS_EXPECT_HEIGHT=… bash scripts/mobile/screenshots/capture.sh ios`.

**Play (unverified today, re-read the page).** Phone screenshots are PNG or JPEG with no alpha, up to 8 MB each. Each
side is 320 to 3840 px, and the long side is at most twice the short side. Play takes 2 to 8 per device type, and asks
for at least 1080 px on the short side to be eligible for its recommendations. 1080 × 1920 meets all of these. The
1080 × 2400 of a modern Pixel would not, because its long side is more than twice the short side.

**Transparency.** The device returns PNGs with an alpha channel, which both stores refuse. The script therefore also
writes **JPEG copies (quality 100, no alpha) under `upload/`**. Upload those.

## 4. How to run

The script runs Flutter on a simulator or emulator, so run it on a machine where that is allowed (the release Mac or
CI). It is not run on shared development machines.

```bash
# iOS (macOS with Xcode and an iOS simulator runtime that has the iPhone 17 Pro Max)
bash scripts/mobile/screenshots/capture.sh ios

# Android (ANDROID_HOME set; the emulator, platform-tools and the system image installed:
#   sdkmanager "system-images;android-35;google_apis;arm64-v8a"   (x86_64 on an Intel host / Linux CI))
bash scripts/mobile/screenshots/capture.sh android
```

- **Output:** `build/store_screenshots/<UTC timestamp>/` (not committed). It holds `ios/` or `android/` with
  `ar/` and `en/` PNGs, plus `upload/` with the JPEG copies. Set `JAWWID_SCREENSHOT_DIR` to choose the folder.
- **What the script does:**
  - **iOS:** creates its own simulator, sets it to light mode, sets Apple's clean status bar (9:41, full signal, full
    battery), runs the test, checks the PNGs, then deletes the simulator.
  - **Android:** creates the `jawwid_shots` AVD once (profile `pixel`), boots it on console port 5580 (headless), and
    checks the size is 1080x1920. It turns on System UI demo mode (09:41, full battery and Wi-Fi, no notification
    icons), runs the test, checks the PNGs, and stops **only that emulator, by its serial**.
- **It fails** if a shot is missing (fewer than 20), if a shot has the wrong size, or if the test fails.
- By hand, on a device that is already running (no status bar or size handling):
  `flutter drive --driver=test_driver/integration_test.dart --target=integration_test/store_screenshots_test.dart -d <device>`.
- `flutter test` does **not** run this (it lives outside `test/`). `flutter analyze` does check it.

### In CI (not wired yet)

Wiring this into CI is a `.github/` change and needs a Code Owner PR. The proposed job, run on demand
(`workflow_dispatch`) and on release tags, not on every push:

- **iOS:** `runs-on: macos-15` (or the newest macOS image whose Xcode has the iPhone 17 Pro Max simulator), the pinned
  `subosito/flutter-action` already used in `ci.yml`, then `bash scripts/mobile/screenshots/capture.sh ios`.
- **Android:** `runs-on: ubuntu-latest` with KVM enabled (the usual `udev` rule for `/dev/kvm`). Install the
  `x86_64` system image and the emulator with `sdkmanager`, then run `bash scripts/mobile/screenshots/capture.sh android`.
- Both jobs upload `build/store_screenshots/` as an artifact (`actions/upload-artifact`, kept 14 days). Nothing is
  uploaded to a store from CI.

## 5. What the owner checks before uploading

- [ ] **Run on the release-candidate commit**, so the screenshots match the build under review.
- [ ] **Every screen reads right in Arabic** (right to left, no clipped text, no English left in an Arabic shot), and
      the same for English. A native speaker reads the Arabic messages.
- [ ] **No real person:** only the synthetic names in §2, initials avatars, no child photo, no face.
- [ ] **No Quran text and no lesson content** on any screen.
- [ ] **The bottom bar does not say "Subscriptions" / «الاشتراكات»** (LR-15). Shots 01, 03, 05 and 08 show the
      parent's or teacher's tab bar. Until the rename is merged, do not upload a parent shot with that tab visible, or
      crop it out (listing-copy §9.2).
- [ ] **No debug banner, no keyboard, no system dialog** (microphone, notifications) and no CallKit screen over the
      app.
- [ ] **The status bar is clean:** 9:41, full battery, full signal.
- [ ] **The call shot (07)** shows the teacher's name and a running timer, not "Connecting…".
- [ ] **The Delete account shot (06)** shows the screen as a user meets it, with no error message.
- [ ] **Sizes:** the script's check passed (1320 × 2868 for iOS, 1080 × 1920 for Android). Upload the **JPEG copies
      from `upload/`**, not the PNGs.
- [ ] **Apple's required slot:** in App Store Connect, the upload is accepted for the iPhone slot it asks for (see §3,
      the "medium display" point).
- [ ] **Captions,** if any, use only the claims in listing-copy §5.3.
