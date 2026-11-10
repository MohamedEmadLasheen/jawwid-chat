#!/usr/bin/env bash
# LR-09j: take the store screenshots on a simulator / emulator, with no server and
# no real person (synthetic data from integration_test/screenshot_fixtures.dart).
#
#   bash scripts/store-screenshots/capture.sh ios       # iPhone 6.9" class, 1320 x 2868 (macOS + Xcode)
#   bash scripts/store-screenshots/capture.sh android   # Play phone, 1080 x 1920 (Android SDK + emulator)
#
# Output: $JAWWID_SCREENSHOT_DIR (default build/store_screenshots/<UTC timestamp>), as
#   <platform>/<ar|en>/<NN>_<screen>.png   -- 10 shots per language, 20 per platform.
# The run fails if any PNG is missing or not the expected size.
# Each PNG is the whole device screen, captured by `xcrun simctl io ... screenshot` /
# `adb exec-out screencap -p` while the test waits on that screen, so the clean
# status bar set below is in the image. If that capture fails the in-app screenshot
# (no status bar) is used instead; <platform>/capture-methods.txt and the end of the
# run say which files that happened to.
#
# It creates its OWN device and removes / stops only that device:
#   ios      a new simulator named jawwid-shots-<pid>, deleted at the end.
#   android  the AVD $ANDROID_AVD (default jawwid_shots, created once with the
#            "pixel" profile = 1080 x 1920) on console port $ANDROID_EMULATOR_PORT
#            (default 5580); only that emulator is stopped, by its serial.
#
# Options (environment):
#   FLUTTER                 flutter binary (default: `flutter` on PATH, then ~/development/flutter/bin/flutter)
#   IOS_DEVICE_TYPE         simctl device type (default com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max;
#                           iPhone-16-Pro-Max is the same 1320 x 2868)
#   IOS_EXPECT_WIDTH/HEIGHT the size the iOS shots must be (default 1320 / 2868); change both
#                           together with IOS_DEVICE_TYPE if another slot is needed
#   ANDROID_HOME            Android SDK (or ANDROID_SDK_ROOT)
#   ANDROID_SYSTEM_IMAGE    default system-images;android-35;google_apis;<x86_64|arm64-v8a by host>; must be installed
#
# Not wired into CI yet (that is a Code Owner change to .github/); see
# docs/release/store-screenshots.md for the job to add.
set -euo pipefail

TARGET="${1:-}"
case "$TARGET" in
  ios | android) : ;;
  *) echo "usage: $0 ios|android" >&2; exit 2 ;;
esac

fail() { echo "capture: $*" >&2; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

FLUTTER="${FLUTTER:-$(command -v flutter || echo "$HOME/development/flutter/bin/flutter")}"
[ -x "$FLUTTER" ] || fail "flutter not found (set FLUTTER=/path/to/flutter)"

OUT="${JAWWID_SCREENSHOT_DIR:-build/store_screenshots/$(date -u +%Y%m%d-%H%M%S)}"
export JAWWID_SCREENSHOT_DIR="$OUT"
mkdir -p "$OUT"

# 2 roles x screens: parent 7 + teacher 3 = 10 per language.
EXPECTED_PER_PLATFORM=20

"$FLUTTER" pub get

# Each shot is captured by the platform tool (whole screen, status bar included):
# the test waits on each screen and the driver (test_driver/integration_test.dart)
# runs simctl / screencap on THIS run's device, then lets the test go on. If that
# capture fails, the test falls back to integration_test's in-app screenshot (no
# status bar). <platform>/capture-methods.txt records which one each file used.
drive() { # platform device-id [adb]
  local platform="$1" device="$2"
  mkdir -p "$OUT/$platform"
  : >"$OUT/$platform/capture-methods.txt"
  JAWWID_SHOT_TOOL="$platform" JAWWID_SHOT_DEVICE="$device" JAWWID_ADB="${3:-}" \
  "$FLUTTER" drive \
    --no-pub \
    --driver=test_driver/integration_test.dart \
    --target=integration_test/store_screenshots_test.dart \
    -d "$device"
}

# Says, per file, how it was captured (the last line for a name wins: a late
# platform capture can be overwritten by the fallback). Warns, without failing,
# about any in-app fallback, because those have no system status bar.
report_methods() { # platform
  local manifest="$OUT/$1/capture-methods.txt" platform_n fallback
  [ -s "$manifest" ] || { echo "capture: WARNING: no capture record in $manifest" >&2; return 0; }
  platform_n="$(awk -F'\t' '{m[$1]=$2} END {n=0; for (k in m) if (m[k]=="platform") n++; print n}' "$manifest")"
  fallback="$(awk -F'\t' '{m[$1]=$2} END {for (k in m) if (m[k]!="platform") print k}' "$manifest" | sort)"
  echo "capture: $platform_n shots captured by the platform tool (status bar included)"
  if [ -n "$fallback" ]; then
    echo "capture: WARNING: these used the in-app fallback and have NO system status bar:" >&2
    # shellcheck disable=SC2086  # one name per word; names are [A-Za-z0-9_/-] only
    printf '  %s\n' $fallback >&2
  fi
}

check_shots() { # dir width height
  local dir="$1" want="$2x$3" count=0 bad=0 f dims
  [ -d "$dir" ] || fail "no screenshots were written to $dir"
  while IFS= read -r f; do
    count=$((count + 1))
    dims="$(file "$f" | sed -n 's/.*PNG image data, \([0-9]*\) x \([0-9]*\).*/\1x\2/p')"
    if [ "$dims" != "$want" ]; then
      echo "capture: $f is ${dims:-not a PNG}, expected $want" >&2
      bad=1
    fi
  done < <(find "$dir" -type f -name '*.png' | sort)
  [ "$count" -eq "$EXPECTED_PER_PLATFORM" ] || { echo "capture: $count screenshots in $dir, expected $EXPECTED_PER_PLATFORM" >&2; bad=1; }
  [ "$bad" -eq 0 ] || fail "screenshot check failed"
  echo "capture: $count screenshots, all $want, in $dir"
}

# Both stores refuse transparency (Apple: no alpha channel; Play: JPEG or 24-bit PNG).
# The device's PNGs carry an alpha channel, so the files to upload are JPEG copies,
# quality 100, under <out>/upload/<platform>/. Uses macOS `sips`, else ImageMagick.
export_jpeg() { # platform
  local src="$OUT/$1" dst="$OUT/upload/$1" f rel target
  while IFS= read -r f; do
    rel="${f#"$src"/}"
    target="$dst/${rel%.png}.jpg"
    mkdir -p "$(dirname "$target")"
    if command -v sips >/dev/null; then
      sips -s format jpeg -s formatOptions 100 "$f" --out "$target" >/dev/null
    elif command -v magick >/dev/null; then
      magick "$f" -background white -alpha remove -alpha off -quality 100 "$target"
    elif command -v convert >/dev/null; then
      convert "$f" -background white -alpha remove -alpha off -quality 100 "$target"
    else
      echo "capture: neither sips nor ImageMagick found: convert $src to JPEG (no alpha) before upload" >&2
      return 0
    fi
  done < <(find "$src" -type f -name '*.png' | sort)
  echo "capture: upload copies (JPEG, no alpha) in $dst"
}

capture_ios() {
  command -v xcrun >/dev/null || fail "xcrun not found (iOS needs macOS with Xcode)"
  local type="${IOS_DEVICE_TYPE:-com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max}"
  local udid
  udid="$(xcrun simctl create "jawwid-shots-$$" "$type")" || fail "could not create a simulator of type $type"
  # shellcheck disable=SC2064  # expand udid now: this run's simulator, nobody else's
  trap "xcrun simctl shutdown '$udid' >/dev/null 2>&1 || true; xcrun simctl delete '$udid' >/dev/null 2>&1 || true" EXIT
  xcrun simctl boot "$udid"
  xcrun simctl bootstatus "$udid" -b >/dev/null
  xcrun simctl ui "$udid" appearance light
  # Apple's own clean status bar: 9:41, full signal, full battery.
  xcrun simctl status_bar "$udid" override --time "9:41" \
    --dataNetwork wifi --wifiMode active --wifiBars 3 \
    --cellularMode active --cellularBars 4 \
    --batteryState charged --batteryLevel 100
  drive ios "$udid"
  check_shots "$OUT/ios" "${IOS_EXPECT_WIDTH:-1320}" "${IOS_EXPECT_HEIGHT:-2868}"
  report_methods ios
  export_jpeg ios
}

capture_android() {
  local sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
  [ -n "$sdk" ] || fail "set ANDROID_HOME to the Android SDK"
  local adb="$sdk/platform-tools/adb" emulator="$sdk/emulator/emulator"
  local avdmanager="$sdk/cmdline-tools/latest/bin/avdmanager"
  local abi
  case "$(uname -m)" in
    arm64 | aarch64) abi="arm64-v8a" ;;
    *) abi="x86_64" ;;
  esac
  local image="${ANDROID_SYSTEM_IMAGE:-system-images;android-35;google_apis;$abi}"
  local avd="${ANDROID_AVD:-jawwid_shots}"
  local port="${ANDROID_EMULATOR_PORT:-5580}"
  local serial="emulator-$port"
  [ -x "$adb" ] && [ -x "$emulator" ] || fail "adb / emulator not found under $sdk"

  if ! "$emulator" -list-avds | grep -qx "$avd"; then
    [ -x "$avdmanager" ] || fail "avdmanager not found; install cmdline-tools, or create the AVD $avd (profile 'pixel')"
    # "pixel" is the 1080 x 1920 hardware profile: 9:16, the size Play recommends.
    echo no | "$avdmanager" create avd -n "$avd" -k "$image" -d pixel
  fi
  if "$adb" devices | grep -q "^$serial[[:space:]]"; then
    fail "$serial is already running; set ANDROID_EMULATOR_PORT to a free even port"
  fi

  "$emulator" -avd "$avd" -port "$port" -no-window -no-audio -no-boot-anim -no-snapshot \
    -gpu swiftshader_indirect >/dev/null 2>&1 &
  local pid=$!
  # shellcheck disable=SC2064  # expand now: stop THIS emulator only, by serial, then by our own PID
  trap "'$adb' -s '$serial' emu kill >/dev/null 2>&1 || kill '$pid' >/dev/null 2>&1 || true" EXIT

  "$adb" -s "$serial" wait-for-device
  local waited=0
  until [ "$("$adb" -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
    waited=$((waited + 2))
    [ "$waited" -lt 600 ] || fail "$serial did not finish booting in 10 minutes"
    sleep 2
  done

  local size
  size="$("$adb" -s "$serial" shell wm size | tr -d '\r' | sed -n 's/^Physical size: //p')"
  [ "$size" = "1080x1920" ] || fail "$avd is $size, expected 1080x1920 (create it with -d pixel)"

  # System UI demo mode: a clean status bar (09:41, full battery and Wi-Fi, no notifications).
  local sh=("$adb" -s "$serial" shell)
  "${sh[@]}" settings put global sysui_demo_allowed 1
  "${sh[@]}" am broadcast -a com.android.systemui.demo -e command enter >/dev/null
  "${sh[@]}" am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941 >/dev/null
  "${sh[@]}" am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false >/dev/null
  "${sh[@]}" am broadcast -a com.android.systemui.demo -e command network -e wifi show -e level 4 -e mobile show -e level 4 >/dev/null
  "${sh[@]}" am broadcast -a com.android.systemui.demo -e command notifications -e visible false >/dev/null
  "${sh[@]}" cmd uimode night no >/dev/null || true

  drive android "$serial" "$adb"
  check_shots "$OUT/android" 1080 1920
  report_methods android
  export_jpeg android
}

case "$TARGET" in
  ios) capture_ios ;;
  android) capture_android ;;
esac
