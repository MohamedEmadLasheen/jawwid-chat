# iOS background modes: what uses each, and the App Review justification

**Launch item LR-24.** Draft, 2026-11-09, written from the code on `main` @ `bc47d376`, with open
pull requests #449 and #524 checked through their diffs. App Review checks each background mode against
Guideline 2.5.4: an app may use background services only for their intended purpose (read word for word
on 2026-11-09).

`ios/Runner/Info.plist:44-51` declares three modes:

```xml
<key>UIBackgroundModes</key>
<array>
    <string>voip</string>
    <string>remote-notification</string>
    <string>audio</string>
</array>
```

## Summary

| Mode | Used on `main`? | Status |
|---|---|---|
| `voip` | Yes. PushKit with a CallKit report | **Justified**, if production turns on VoIP delivery (see the note) |
| `audio` | Yes. A voice call's microphone and speaker through LiveKit | **Justified**. Not verified on a device |
| `remote-notification` | **No.** Nothing on `main` uses it, and #449 does not add a use | **OPEN.** Recommendation: remove it |

---

## 1. `voip`

**Feature:** incoming voice calls (calls in a chat, and live lessons) ring on the iPhone's system call
screen while the app is in the background or closed.

**Where in the code (`main`):**
- `ios/Runner/AppDelegate.swift:128-139`: `startRegistering()` creates a `PKPushRegistry` for
  `.voIP` when a session starts, never at launch.
- `ios/Runner/AppDelegate.swift:183-190`: the PushKit token is reported to the server with kind `voip`.
- `ios/Runner/AppDelegate.swift:215-235`: on a VoIP push, the call is reported to CallKit first, and the
  Flutter engine starts only after that (`callKit.reportIncoming`, then `ensureEngine()`).
- `ios/Runner/CallKitBridge.swift:174`: `provider.reportNewIncomingCall`. Lines `:256-278` send Answer
  and End to Dart, which sends the same request as the in-app buttons.
- Server: `apps/api/src/communication/notifications/apns.provider.ts:84-87`. A VoIP push goes to
  `<bundle>.voip` with `apns-push-type: voip` and has no alert.

**Justification for App Review (one sentence):**
> Jawwid is used for live voice calls between parents, teachers and the academy, and the VoIP mode lets
> an incoming call wake the app through PushKit so it is reported immediately to CallKit and shown on
> the system call screen.

**Note (blocks the claim on a real build):** the server does not send VoIP pushes to Apple unless
`APNS_VOIP_ENABLED=true` (`apps/api/src/communication/notifications/push.provider.selector.ts:51-67`,
default off). The CallKit path the gate waited for ("W8-W3") is on `main` (`CallKitBridge.swift`). The
comment at `Info.plist:39-43` still says "until it exists", which is out of date. **Before submitting:**
the release owner turns the gate on in production and checks on a device that a closed iPhone rings
(`review-notes.md` §4 check 4). If the gate stays off, the submitted app declares `voip` and never
receives a VoIP push. A reviewer who calls the review iPhone would then see no ring.

## 2. `audio`

**Feature:** during a voice call or a live lesson, the microphone and the other person's voice continue
when the user locks the screen or switches to another app (PD-56).

**Where in the code (`main`):**
- `ios/Runner/Info.plist:48-50`: the mode, with its PD-56 comment.
- `lib/core/call_media/livekit_media_room.dart:35-42`: `connect` joins the LiveKit room. Lines
  `:85-97` (`setMicrophoneEnabled`) publish the microphone track. The audio session itself is set up
  by `livekit_client` and its WebRTC plugin, not by app code (`pubspec.yaml:38`). The app's own code
  does not touch `AVAudioSession` (`ios/Runner/CallKitBridge.swift:280-290`).
- Android's equivalent is `CallForegroundService` (`android/app/src/main/AndroidManifest.xml:72-76`).

**Justification for App Review (one sentence):**
> The audio mode keeps an ongoing voice call's microphone and speaker running while the user locks the
> screen or switches app; the app plays no audio in the background when no call is in progress.

**Not verified:**
- That the audio continues on a locked iPhone. No device test was run (machine rule), and
  `livekit_media_room.dart:17-21` says the adapter had not joined a real room when it was written.
- Whether LiveKit must wait for CallKit's `didActivate` (`CallKitBridge.swift:280-288`, decision D-5).
  For an answered CallKit call, this can decide whether there is sound at all.
- Check both before submitting (`review-notes.md` §4 check 5).
- "No background audio outside a call": the other audio players (voice messages, lesson audio,
  `lib/features/rewards/application/reward_feed.dart:134`) were not checked for whether they keep
  playing in the background. If one does, that is an intended use of `audio` too, but say so in the
  sentence above.

## 3. `remote-notification`: **OPEN**

**Use on `main`: none found.**
- `remote-notification` lets a **silent** push (`content-available: 1`) wake the app in the
  background. It is received by `application(_:didReceiveRemoteNotification:fetchCompletionHandler:)`.
- Nothing in `ios/` implements that method on `main`.
- No plugin in `pubspec.yaml` receives such pushes for the app: there is no `firebase_messaging` on iOS.
- The server never sends a silent push. `apns.provider.ts:87` sets the push type to `voip` or `alert`
  only, and an alert push has a title, a body and a sound (`:96-98`).
- The comment at `Info.plist:39-40` says the mode "does the same for a data push". No data push is sent
  to iOS.

**#449 does not add a use.** The tracker said `remote-notification` depends on #449 (and LR-11). #449
changes `ios/Runner/AppDelegate.swift` only. Checked with `git diff origin/main...origin/claude/pd032-feedback-reply-notifications -- ios/Runner/AppDelegate.swift`. It adds:
- `UNUserNotificationCenter` delegate methods: `willPresent`, to show an ordinary push as a banner while
  the app is open, and `didReceive`, to route a tap.
- A `jawwid/push_opens` channel.

Neither delegate method needs a background mode: iOS draws alert pushes itself and delivers the tap
when the user opens the app. #449 does not change `Info.plist` or the APNs payload. #524 touches no
`ios/` file.

**Not verified: LR-11b.** The tracker's LR-11b code lives in an uncommitted tree outside the repository
and was not read. If LR-11b adds a silent push (for example, to clear a notification read on another
device), that would be the use, and this section changes.

**Recommendation (for the lead):** remove `remote-notification` from `Info.plist` in a small Mobile
ticket before submission, and correct the comment at `:39-43`. The reason: App Review rejects a declared
mode with no matching feature under 2.5.4. Removing it changes nothing a user sees, because:
- ordinary pushes are alert pushes;
- calls are VoIP pushes;
- registering for remote notifications (`AppDelegate.swift:131`) needs no background mode.

Keep the mode only if a silent-push feature is planned for this release. In that case, its handler is
the PR that adds the feature, and the sentence for App Review would be:
> The remote-notification mode lets a silent push refresh {{WHAT}} in the background so it is current
> when the user opens the app.

---

## Where App Review asks

App Store Connect asks for no separate form for background modes. A reviewer checks them against the
app. If asked (or if the Notes have room), paste the sentences from §1 and §2. The review notes in
`review-notes.md` §2 already describe both uses in plain words: "rings, also when the app is closed
(CallKit on iPhone)" and "the audio continues when the app goes to the background or the screen locks".
