#!/usr/bin/env bash
# W56: release evidence read from the SIGNED store artifacts, before they leave the runner
# (LR-50, LR-51, LR-52, LR-58, LR-73). The same checks as the release-readiness workflow of #523,
# applied to the bytes .github/workflows/release-store-builds.yml is about to upload.
#
#   bash scripts/mobile/verify-store-artifact.sh android <app-release.aab> <bundletool.jar> <build name> <build number>
#   bash scripts/mobile/verify-store-artifact.sh ios <Runner.app unpacked from the signed .ipa> <source PrivacyInfo.xcprivacy>
#
# Android (bundletool `dump manifest` of the bundle's own manifest; readelf on every native library):
#   - package com.jawwid.jawwid_chat, versionName / versionCode = the build name / number;
#   - LR-50: targetSdkVersion 36 and minSdkVersion 26;
#   - LR-51: every LOAD segment of every 64-bit native library (arm64-v8a, x86_64, any ABI not known
#     to be 32-bit) aligned to at least 16 KB; arm64-v8a libflutter.so and libapp.so present. 32-bit
#     libraries are reported, not failed (Play's 16 KB rule covers 64-bit ABIs only);
#   - Data safety: no com.google.android.gms.permission.AD_ID (the drafted declaration says the app
#     collects no Advertising ID), trusted only if the dump also lists android.permission.INTERNET.
# iOS (plutil on the app's Info.plist and PrivacyInfo.xcprivacy):
#   - LR-52: DTXcode 2600 or later, DTSDKName iphoneos26;
#   - ITSAppUsesNonExemptEncryption false; UIBackgroundModes exactly audio and voip;
#   - LR-58: PrivacyInfo.xcprivacy in the app, plutil -lint clean, NSPrivacyTracking false, and every
#     required-reason API category below declared with its reason (every entry has a reason);
#   - LR-73: its collected data types are exactly those of ios/Runner/PrivacyInfo.xcprivacy.
#
# Prints a Markdown evidence table on stdout: only the checked values, never a file's contents.
# Exit 0 when every check passes, 1 when any fails (the caller then uploads nothing), 2 on bad usage.
# The tools are found on PATH (java, or $JAVA_HOME/bin/java; unzip; readelf; plutil).
set -uo pipefail

readonly PACKAGE='com.jawwid.jawwid_chat'
readonly TARGET_SDK='36'
readonly MIN_SDK='26'
readonly PAGE_BYTES='16384'
readonly AD_ID='com.google.android.gms.permission.AD_ID'
readonly DTXCODE_MIN='2600'
readonly SDK_RX='^iphoneos26(\.[0-9]+)*$'
readonly BACKGROUND_MODES='audio voip'
# category=reason, as ios/Runner/PrivacyInfo.xcprivacy declares them (test/scripts keeps the two in step).
readonly REQUIRED_REASONS='NSPrivacyAccessedAPICategoryUserDefaults=CA92.1 NSPrivacyAccessedAPICategoryFileTimestamp=C617.1 NSPrivacyAccessedAPICategorySystemBootTime=35F9.1'
readonly MAX_ENTRIES=200

usage() {
  echo "usage: $0 android <aab> <bundletool.jar> <x.y.z> <build number> | ios <Runner.app> <source PrivacyInfo.xcprivacy>" >&2
  exit 2
}

bad=0
W=''
trap '[ -z "$W" ] || rm -rf "$W"' EXIT

# One cell: no line breaks, pipes or backticks, cut short.
cell() { printf '%s' "$1" | tr '\r\n|`' '    ' | sed 's/^ *//; s/ *$//' | cut -c1-200; }
row() { # result, check, expected, found
  [ "$1" = FAIL ] && bad=1
  printf '| %s | %s | %s | %s |\n' "$(cell "$2")" "$(cell "$3")" "$(cell "$4")" "$1"
}
head_table() { printf '### %s\n\n| check | expected | found | result |\n|---|---|---|---|\n' "$1"; }
same() { # result row: PASS when found = expected
  if [ "$3" = "$2" ]; then row PASS "$1" "$2" "$3"; else row FAIL "$1" "$2" "${3:-nothing}"; fi
}

# ---------------------------------------------------------------- Android
android() {
  local aab="$1" bt="$2" name="$3" number="$4"
  local java="${JAVA_HOME:+$JAVA_HOME/bin/}java"
  head_table "Release evidence: signed Android App Bundle $name+$number"
  [ -f "$aab" ] || { row FAIL "App Bundle" "$aab" "missing"; return; }
  [ -f "$bt" ] || { row FAIL "bundletool" "the pinned jar" "missing"; return; }

  mf() { # xpath -> the values, one per line ("<unreadable>" if bundletool fails)
    "$java" -jar "$bt" dump manifest --bundle="$aab" --xpath="$1" 2> /dev/null | tr -d '\r' || echo '<unreadable>'
  }
  one() { mf "$1" | tr -d '[:space:]'; }
  same "package" "$PACKAGE" "$(one /manifest/@package)"
  same "versionName" "$name" "$(one /manifest/@android:versionName)"
  same "versionCode" "$number" "$(one /manifest/@android:versionCode)"
  same "LR-50 targetSdkVersion" "$TARGET_SDK" "$(one /manifest/uses-sdk/@android:targetSdkVersion)"
  same "LR-50 minSdkVersion" "$MIN_SDK" "$(one /manifest/uses-sdk/@android:minSdkVersion)"

  local perms
  perms="$( { mf /manifest/uses-permission/@android:name; mf /manifest/uses-permission-sdk-23/@android:name; } \
    | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | grep -v '^$' | LC_ALL=C sort -u)"
  if ! grep -qx 'android.permission.INTERNET' <<< "$perms"; then
    row FAIL "Data safety: no AD_ID permission" "absent" "the manifest dump did not list this app's permissions; not checked"
  elif grep -qx "$AD_ID" <<< "$perms"; then
    row FAIL "Data safety: no AD_ID permission" "absent" "$AD_ID requested"
  else
    row PASS "Data safety: no AD_ID permission" "absent" "absent ($(grep -c . <<< "$perms") permissions listed)"
  fi

  # LR-51: the native libraries exactly as they sit in the signed bundle.
  W="$(mktemp -d)" || { row FAIL "LR-51 native libraries" "readable" "no temporary directory"; return; }
  unzip -q -o "$aab" 'base/lib/*' -d "$W" > /dev/null 2>&1 || true
  local so rel abi aligns a lo least n64=0 n32=0 low32=0 low64='' unread='' min64=''
  while IFS= read -r so; do
    rel="${so#"$W"/base/lib/}"; abi="${rel%%/*}"
    aligns="$(readelf -lW "$so" 2> /dev/null | awk '$1 == "LOAD" { print $NF }')"
    if [ -z "$aligns" ]; then unread="$unread $rel"; continue; fi
    lo=''; least=''
    while IFS= read -r a; do
      # Validated before arithmetic: only a hex or decimal number is ever evaluated.
      if [[ "$a" =~ ^(0x[0-9a-fA-F]+|[0-9]+)$ ]] && [ $((a)) -ge "$PAGE_BYTES" ]; then
        if [ -z "$least" ] || [ $((a)) -lt "$least" ]; then least=$((a)); fi
      else lo="$lo $a"; fi
    done <<< "$aligns"
    case "$abi" in
      armeabi-v7a | x86) n32=$((n32 + 1)); [ -z "$lo" ] || low32=$((low32 + 1)) ;;
      *)
        n64=$((n64 + 1)); [ -z "$lo" ] || low64="$low64 $rel:$lo"
        if [ -n "$least" ] && { [ -z "$min64" ] || [ "$least" -lt "$min64" ]; }; then min64="$least"; fi ;;
    esac
  done < <(find "$W/base/lib" -type f -name '*.so' 2> /dev/null | LC_ALL=C sort)
  local want16='every LOAD p_align >= 16384 (16 KB)'
  if [ -n "$unread" ]; then row FAIL "LR-51 ELF alignment" "$want16" "LOAD segments unreadable:$unread"; fi
  if [ "$n64" -eq 0 ]; then
    row FAIL "LR-51 ELF alignment, 64-bit" "$want16" "no 64-bit native library in the bundle"
  elif [ -n "$low64" ]; then
    row FAIL "LR-51 ELF alignment, 64-bit" "$want16" "below 16 KB:$low64"
  elif [ -z "$unread" ]; then
    row PASS "LR-51 ELF alignment, 64-bit" "$want16" "$n64 libraries, smallest p_align $min64"
  fi
  local f missing=''
  for f in libflutter.so libapp.so; do [ -f "$W/base/lib/arm64-v8a/$f" ] || missing="$missing $f"; done
  if [ -z "$missing" ]; then row PASS "arm64-v8a Flutter libraries" "libflutter.so, libapp.so" "present"
  else row FAIL "arm64-v8a Flutter libraries" "libflutter.so, libapp.so" "missing:$missing"; fi
  [ "$n32" -eq 0 ] || row INFO "32-bit libraries (not covered by the 16 KB rule)" "reported only" "$n32 libraries, $low32 below 16 KB"
}

# ---------------------------------------------------------------- iOS
pl() { plutil -extract "$2" raw -o - "$1" 2> /dev/null; } # file, key path

# The values of an array of strings at a key path, one per line.
pl_list() {
  local i=0 v
  while [ "$i" -lt "$MAX_ENTRIES" ] && v="$(pl "$1" "$2.$i")"; do printf '%s\n' "$v"; i=$((i + 1)); done
}

# NSPrivacyCollectedDataTypes: the type names, sorted.
collected_types() {
  local i=0 v
  while [ "$i" -lt "$MAX_ENTRIES" ] && v="$(pl "$1" "NSPrivacyCollectedDataTypes.$i.NSPrivacyCollectedDataType")"; do
    printf '%s\n' "$v"; i=$((i + 1))
  done | LC_ALL=C sort
}

# NSPrivacyAccessedAPITypes: "category=reason" per declared reason, and "category=" for an entry without one.
accessed_reasons() {
  local i=0 cat r
  while [ "$i" -lt "$MAX_ENTRIES" ] && cat="$(pl "$1" "NSPrivacyAccessedAPITypes.$i.NSPrivacyAccessedAPIType")"; do
    r="$(pl_list "$1" "NSPrivacyAccessedAPITypes.$i.NSPrivacyAccessedAPITypeReasons")"
    if [ -z "$r" ]; then printf '%s=\n' "$cat"; else printf '%s\n' "$r" | awk -v c="$cat" '{ print c "=" $0 }'; fi
    i=$((i + 1))
  done | LC_ALL=C sort -u
}

ios() {
  local app="$1" src="$2"
  local P="$app/Info.plist" M="$app/PrivacyInfo.xcprivacy"
  head_table "Release evidence: signed iOS app ($(basename "$app"))"
  [ -f "$P" ] || { row FAIL "Info.plist" "in the app" "missing"; return; }

  local dtx sdk enc modes
  dtx="$(pl "$P" DTXcode)" || dtx=''
  if [[ "$dtx" =~ ^[0-9]{1,6}$ ]] && [ "$((10#$dtx))" -ge "$DTXCODE_MIN" ]; then row PASS "LR-52 DTXcode" ">= $DTXCODE_MIN (Xcode 26)" "$dtx"
  else row FAIL "LR-52 DTXcode" ">= $DTXCODE_MIN (Xcode 26)" "${dtx:-nothing}"; fi
  sdk="$(pl "$P" DTSDKName)" || sdk=''
  if [[ "$sdk" =~ $SDK_RX ]]; then row PASS "LR-52 DTSDKName" "iphoneos26 (iOS 26 SDK)" "$sdk"
  else row FAIL "LR-52 DTSDKName" "iphoneos26 (iOS 26 SDK)" "${sdk:-nothing}"; fi
  enc="$(pl "$P" ITSAppUsesNonExemptEncryption)" || enc=''
  same "ITSAppUsesNonExemptEncryption" "false" "$enc"
  modes="$(pl_list "$P" UIBackgroundModes | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')"
  same "UIBackgroundModes (exactly)" "$BACKGROUND_MODES" "$modes"

  if [ ! -f "$M" ]; then row FAIL "LR-58 PrivacyInfo.xcprivacy" "in the app" "missing"; return; fi
  if plutil -lint "$M" > /dev/null 2>&1; then row PASS "LR-58 PrivacyInfo.xcprivacy" "in the app, plutil -lint OK" "present, OK"
  else row FAIL "LR-58 PrivacyInfo.xcprivacy" "in the app, plutil -lint OK" "present, lint fails"; return; fi
  local tracking; tracking="$(pl "$M" NSPrivacyTracking)" || tracking=''
  same "LR-58 NSPrivacyTracking" "false" "$tracking"

  local declared pair missing='' empty
  declared="$(accessed_reasons "$M")"
  for pair in $REQUIRED_REASONS; do grep -qxF "$pair" <<< "$declared" || missing="$missing ${pair#NSPrivacyAccessedAPICategory}"; done
  empty="$(grep '=$' <<< "$declared" | sed 's/^NSPrivacyAccessedAPICategory//; s/=$//' | tr '\n' ' ')"
  local want_rr; want_rr="$(printf '%s\n' $REQUIRED_REASONS | sed 's/^NSPrivacyAccessedAPICategory//' | tr '\n' ' ' | sed 's/ $//')"
  local got_rr; got_rr="$(grep -v '=$' <<< "$declared" | sed 's/^NSPrivacyAccessedAPICategory//' | tr '\n' ' ' | sed 's/ $//')"
  if [ -n "$missing" ]; then row FAIL "LR-58 required-reason APIs" "$want_rr" "missing:$missing"
  elif [ -n "$empty" ]; then row FAIL "LR-58 required-reason APIs" "every entry has a reason" "no reason: $empty"
  else row PASS "LR-58 required-reason APIs" "$want_rr" "$got_rr"; fi

  local built wanted
  built="$(collected_types "$M")"
  if [ ! -f "$src" ]; then row FAIL "LR-73 collected data types" "as $src" "the source manifest is missing"; return; fi
  wanted="$(collected_types "$src")"
  if [ -z "$wanted" ]; then row FAIL "LR-73 collected data types" "as $src" "the source manifest declares none"
  elif [ "$built" = "$wanted" ]; then row PASS "LR-73 collected data types" "the $(grep -c . <<< "$wanted") of the source manifest" "the same $(grep -c . <<< "$built")"
  else
    local diff_types
    diff_types="$(diff <(printf '%s\n' "$wanted") <(printf '%s\n' "$built") | sed -n 's/^< NSPrivacyCollectedDataType/-/p; s/^> NSPrivacyCollectedDataType/+/p' | tr '\n' ' ')"
    row FAIL "LR-73 collected data types" "the $(grep -c . <<< "$wanted") of the source manifest" "differs: $diff_types"
  fi
}

case "${1:-}" in
  android)
    [ "$#" -eq 5 ] || usage
    [[ "$4" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] && [[ "$5" =~ ^[1-9][0-9]*$ ]] || usage
    android "$2" "$3" "$4" "$5" ;;
  ios)
    [ "$#" -eq 3 ] || usage
    ios "$2" "$3" ;;
  *) usage ;;
esac
echo
if [ "$bad" -eq 0 ]; then echo "Every check passed."; else echo "**A check FAILED: nothing is uploaded.**"; fi
exit "$bad"
