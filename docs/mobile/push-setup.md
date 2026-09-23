# Push setup

What a deployment needs before a parent's phone can buzz, and what happens
until then.

## Until then

**The app builds and runs without any of this.** A checkout with no Firebase
credentials starts normally, `FirebasePushTokens.initialise()` returns false,
`pushTokensProvider` stays inert, and notifications still reach the parent
in-app and over realtime. Push is a channel; losing it is a degradation, not a
broken product. That is deliberate — the alternative is every fresh clone
failing to build Android until somebody is handed a secret.

`android/app/build.gradle.kts` prints a line saying so on every build without
`google-services.json`.

## Platforms

Android and iOS. There is no web target (`.metadata` lists `android` and `ios`
only), which is why FCM alone is sufficient: iOS is served through FCM's own
APNs bridge, so a second push integration would mean a second set of
credentials, a second token table and a second set of failure modes for nothing.

## 1. Firebase project

One project, two apps registered in it:

| App | Identifier |
|---|---|
| Android | `com.jawwid.jawwid_chat` |
| iOS | the value of `PRODUCT_BUNDLE_IDENTIFIER` in `ios/Runner.xcodeproj` |

## 2. Client credentials

| File | Where it goes | Tracked? |
|---|---|---|
| `google-services.json` | `android/app/` | No — already in `.gitignore` |
| `GoogleService-Info.plist` | `ios/Runner/` (add to the Xcode target) | No — already in `.gitignore` |

Neither is a secret in the "can leak money" sense, but both identify the
project and neither belongs in a public repository, which is why the Gradle
plugin is applied conditionally rather than required.

## 3. APNs, for iOS

FCM sends to Apple on your behalf and needs the authority to do it:

1. An APNs **Auth Key** (`.p8`) from the Apple Developer account, with its Key
   ID and Team ID.
2. Uploaded to Firebase → Project settings → Cloud Messaging → APNs
   Authentication Key.
3. The **Push Notifications** capability and the **Background Modes →
   Remote notifications** capability on the Runner target.

`Info.plist` already declares `UIBackgroundModes: remote-notification`, which is
what makes `content-available` in the payload wake a backgrounded app. Without
it iOS shows the notification on the lock screen but never hands it to the app,
so the badge and the centre stay stale until the parent opens it by hand.

## 4. Server credentials

The backend sends through FCM HTTP v1 and needs a service account:

1. Firebase → Project settings → Service accounts → Generate new private key.
2. Set, per `infra/env/manifest.tsv`:

   | Variable | Value |
   |---|---|
   | `FCM_PROJECT_ID` | the Firebase project id |
   | `FCM_SERVICE_ACCOUNT_JSON` | the downloaded JSON, **pasted unmodified** |

Paste the file whole. Taking it apart into separate variables is how the PEM's
newlines get mangled, and a mangled key fails at the token exchange with an
error that looks nothing like "your key is wrong".

Half-configured **throws at startup** rather than falling back to the logging
provider: a deployment that looks wired and silently delivers nothing is the
worst outcome for a product whose promise is that the parent finds out.

## 5. Android notification channel

`AndroidManifest.xml` names `jawwid_default` as the default channel. Android
silently drops a notification naming a channel that does not exist, so a payload
that arrives with no channel of its own lands there rather than nowhere.

## What to check when push does not arrive

In this order, because each rules out the one below:

1. **Is a token registered?** `chat.device_token` for that actor, `is_active`.
   No row means the device never reported one — permission refused, no Play
   Services, or an iOS build that asked for the FCM token before APNs was ready.
2. **Was a delivery attempted?** `chat.notification_delivery` for that
   notification. A `skipped` row carries its reason: `RECIPIENT_ACTIVE` (they
   were reading the thread), `PREFERENCE_OFF` (they muted the category),
   `CONVERSATION_MUTED`, `GROUPED` (a burst), `NO_DEVICE_TOKEN`.
3. **Did it fail?** `error_code` on the delivery row. `UNREGISTERED` means the
   device is genuinely gone and the token was deactivated. `FCM_UNAUTHORIZED`
   means the service account is wrong or expired — and note that this never
   deactivates a token, because credentials lapsing must not wipe every device
   in the academy.
4. **`chat.notification_operations`** joins all of the above into one row per
   delivery. It carries no title or body: support diagnoses delivery, it does
   not read families' messages.
