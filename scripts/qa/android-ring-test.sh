#!/usr/bin/env bash
# The killed-app incoming-call ring, on an Android emulator (store blocker
# S-05). Run by the CI job `android-ring` inside reactivecircus/android-emulator-runner,
# against a DEBUG build: DebugPushReceiver draws a push exactly as
# JawwidMessagingService would, without Firebase.
#
#   1  with the app's process killed, a call push posts a CallStyle notification
#      on the Calls channel, category call, with Answer and Decline
#   2  tapping Answer opens MainActivity and hands the call to the call bridge
#      (jawwid/call_native -> CallController, which then accepts it on the server)
#
# What this cannot show without a running API: the Flutter call screen after a
# successful accept. That is the owner's real-phone check before submission.
#
#   APK=build/app/outputs/flutter-apk/app-debug.apk scripts/qa/android-ring-test.sh
set -euo pipefail

PKG=com.jawwid.jawwid_chat
APK="${APK:-build/app/outputs/flutter-apk/app-debug.apk}"
OUT="${OUT:-android-ring}"
mkdir -p "$OUT"
fail() { echo "::error title=android-ring::$*"; adb logcat -d -s 'JawwidPush:*' 'AndroidRuntime:E' 'NotificationService:E' || true; adb logcat -d -b events | grep -E 'notification_(enqueue|cancel|canceled)' | grep -F "$PKG" || true; adb shell dumpsys notification --noredact > "$OUT/notifications.txt" || true; adb logcat -d > "$OUT/logcat.txt" || true; exit 1; }

adb wait-for-device
adb shell 'while [ "$(getprop sys.boot_completed)" != 1 ]; do sleep 1; done'
adb shell input keyevent 82 || true            # unlock the emulator's screen
adb install -r "$APK" >/dev/null
adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS
# "Killed" as a user kills it: opened once, sent home, its process killed --
# NOT force-stopped. A force-stopped app is in Android's stopped state, where
# neither this broadcast nor FCM itself is delivered (only a launch clears it),
# so force-stop tests a state no ring can leave, on any phone.
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null
sleep 8
adb shell input keyevent KEYCODE_HOME
sleep 2
# `am kill` kills only a process Android already counts as cached; right after
# Home it may not be yet, so ask again for a while. If it is still alive, end it
# from inside its own uid (run-as, a debug build): a plain process death, as the
# low-memory killer does it -- never force-stop.
kill_app() {
  for _ in $(seq 1 10); do
    adb shell am kill "$PKG"
    sleep 1
    adb shell pidof "$PKG" >/dev/null 2>&1 || break
  done
  if pid="$(adb shell pidof "$PKG" 2>/dev/null)" && [ -n "$pid" ]; then
    adb shell run-as "$PKG" kill -9 $pid || true
    sleep 2
  fi
  adb shell pidof "$PKG" >/dev/null 2>&1 && fail "the app's process is still running after am kill"
  adb shell dumpsys package "$PKG" | grep -q "stopped=true" && fail "the app is in the stopped state; a push could never reach it"
  return 0
}

send_call_push() {
  adb logcat -c
  adb shell am broadcast -n "$PKG/.DebugPushReceiver" \
    --es eventType call_started --es callId ci-call-1 --es conversationId ci-conversation-1 \
    --es title "CI caller" --es body "Incoming voice call" >/dev/null
}

# A cold start for a broadcast on a shared CI emulator can take well over 15 s
# (seen: 8 s before the process even started); the ring itself lasts 45 s.
dump=""
wait_for_ring() {
  for _ in $(seq 1 40); do
    dump="$(adb shell dumpsys notification --noredact)"
    grep -q "pkg=$PKG" <<<"$dump" && return 0
    sleep 1
  done
  return 1
}

# LR-78. Right after boot the emulator is still settling, and system_server's
# cached ApplicationInfo for the app can be stale when the ring is posted. For a
# CallStyle notification NotificationManagerService then rebuilds the builder
# (fixNotification -> recoverBuilder), refreshes that cache under the APP's
# binder identity, hits a SecurityException ("Requires ... NETWORK_STACK"),
# logs "Cannot fix notification" and silently drops the post -- while the app
# has already logged "posted". Only that exact system-side drop earns another
# push (bounded); anything else, or a third drop, still fails below.
dropped_by_system() {
  local log
  log="$(adb logcat -d)"
  grep -qF "caused update to cached ApplicationInfo for package $PKG" <<<"$log" \
    && grep -qF "NotificationService: Cannot fix notification" <<<"$log"
}

kill_app

# 1 ------------------------------------------------------------------------------
for push in 1 2 3; do
  send_call_push
  wait_for_ring && break
  dropped_by_system || break
  [ "$push" -lt 3 ] || break
  echo "::warning title=android-ring::push $push: the app posted the ring but Android dropped it (NotificationService 'Cannot fix notification' after a stale cached ApplicationInfo); killing the app and pushing again"
  kill_app
done
# A fresh emulator has no other app posting: the dump is this app's records.
grep -q "pkg=$PKG" <<<"$dump" || fail "no notification from $PKG after the call push"
record="$dump"
grep -q "jawwid_calls" <<<"$record" || fail "the notification is not on the Calls channel"
grep -qi "category=call" <<<"$record" || fail "the notification is not category=call"
grep -q 'CallStyle' <<<"$record" || fail "the notification is not a CallStyle notification"
grep -q '"Answer"' <<<"$record" || fail "no Answer action"
grep -q '"Decline"' <<<"$record" || fail "no Decline action"
echo "  ok  a killed app posts a CallStyle ring on the Calls channel with Answer and Decline"

# 2 ------------------------------------------------------------------------------
adb shell cmd statusbar expand-notifications
sleep 2
adb shell uiautomator dump /sdcard/ui.xml >/dev/null
adb pull /sdcard/ui.xml "$OUT/ui.xml" >/dev/null
bounds="$(grep -o 'text="Answer"[^>]*bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' "$OUT/ui.xml" | grep -o 'bounds="[^"]*"' | head -1)"
[ -n "$bounds" ] || bounds="$(grep -io 'text="answer"[^>]*bounds="[^"]*"' "$OUT/ui.xml" | grep -o 'bounds="[^"]*"' | head -1)"
[ -n "$bounds" ] || fail "the Answer button is not on screen in the expanded shade"
read -r x1 y1 x2 y2 < <(sed 's/[^0-9]/ /g' <<<"$bounds")
adb shell input tap $(( (x1 + x2) / 2 )) $(( (y1 + y2) / 2 ))

for _ in $(seq 1 20); do
  adb logcat -d -s JawwidPush:I | grep -q "call intent ANSWER_CALL handed to the call bridge" && break
  sleep 1
done
adb logcat -d -s JawwidPush:I | grep -q "call intent ANSWER_CALL handed to the call bridge" \
  || fail "Answer did not reach the call bridge"
adb shell dumpsys activity activities | grep -E "mResumedActivity|topResumedActivity" | grep -q "$PKG/.MainActivity" \
  || fail "Answer did not bring MainActivity to the front"
echo "  ok  Answer opens the app and hands the call to the call bridge"
echo "android-ring: pass"
