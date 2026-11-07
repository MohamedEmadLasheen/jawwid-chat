# Push notifications: Firebase (Android) and APNs (iOS) setup

What has to exist outside this repository before a real phone receives a Jawwid push, and how
to check each piece. Written 2026-11-03 for the PD-32 amendment (feedback replies) and the
ordinary-push handling on `claude/pd032-feedback-reply-notifications`.

**Nothing here is done by an agent without the owner's explicit approval:** creating or changing
a Firebase or Google Cloud project, creating keys, uploading credentials, or changing any
server's secrets. Credentials never go into git, briefs, logs or chat.

## 0. The identifiers (verified in the repository)

| What | Value | Where it is set |
|---|---|---|
| Android application id (Firebase "package name") | `com.jawwid.jawwid_chat` | `android/app/build.gradle.kts` (`applicationId`, `namespace`) |
| iOS bundle id | `com.jawwid.jawwidChat` | `ios/Runner.xcodeproj` (`PRODUCT_BUNDLE_IDENTIFIER`, Runner target) |
| Apple team | `KX683HAR3Y` | `ios/Runner.xcodeproj` (`DEVELOPMENT_TEAM`), automatic signing |

The two ids differ (`jawwid_chat` and `jawwidChat`), so don't copy one platform's id into the other.

## 1. Android: Firebase Cloud Messaging

### 1.1 Create the Firebase project (owner)
1. Go to <https://console.firebase.google.com>, choose **Add project**, and name it, for
   example, `jawwid-chat`. Google Analytics is **not** needed; turn it off.
2. Under **Project settings → Cloud Messaging**, make sure **Firebase Cloud Messaging API (V1)**
   is enabled. The server uses only the v1 HTTP API (`fcm.provider.ts`). The legacy server key
   is not used.

### 1.2 Register the Android app
1. **Project settings → General → Your apps → Add app → Android.**
2. **Android package name:** `com.jawwid.jawwid_chat`, exactly. It must match `applicationId`
   in `android/app/build.gradle.kts`. FCM refuses delivery to an app whose package differs.
3. App nickname: optional (for example "Jawwid Android").
4. **Debug signing certificate SHA-1:** not needed for FCM. Leave it empty.
5. **Download `google-services.json`.** Skip the console's Gradle instructions: the plugin and
   `firebase-messaging` are already configured (§1.4).

### 1.3 Place `google-services.json`
- Put it at `android/app/google-services.json`. That path is in `.gitignore`. **Never commit it.**
- Check that it is the right file:
  ```
  python3 -c "import json;d=json.load(open('android/app/google-services.json'));print([c['client_info']['android_client_info']['package_name'] for c in d['client']], d['project_info']['project_id'])"
  ```
  It must print `['com.jawwid.jawwid_chat']` and the project id. That project id is `FCM_PROJECT_ID`.
- For CI and release builds, inject the file from the secret store at build time. It is not a
  server secret, but it identifies the project and stays out of git.

### 1.4 What the build does with it
- `android/settings.gradle.kts` declares `com.google.gms.google-services` 4.4.2.
- `android/app/build.gradle.kts` applies the plugin **only when the file exists**. Without the
  file, the app still builds and simply gets no push: no token is reported.
- `firebase-messaging` comes through the Firebase BoM, with no Analytics.
- To verify after placing the file:
  ```
  flutter build apk --debug
  find build/app -path '*GoogleServices*' -name values.xml | xargs grep -h project_id
  ```
  This must print your project id. It was verified on 2026-11-03 with a placeholder file (AGP 9.1).

### 1.5 Server: `FCM_PROJECT_ID` and `FCM_SERVICE_ACCOUNT_JSON` (owner)
1. Open Google Cloud console → the same project → **IAM & Admin → Service accounts → Create**,
   for example `jawwid-fcm-sender`.
2. Grant it **one role**: *Firebase Cloud Messaging API Admin*
   (`roles/firebasecloudmessaging.admin`). Give it nothing broader. In particular, not Editor
   or Owner.
3. On that service account, go to **Keys → Add key → JSON**. You download the file once. Treat
   it as a password.
4. The server variables (`infra/env/manifest.tsv`; required in production, optional in QA and
   staging):

   | Variable | Value |
   |---|---|
   | `FCM_PROJECT_ID` | `project_id` from the JSON (the same as in `google-services.json`) |
   | `FCM_SERVICE_ACCOUNT_JSON` | The **whole** JSON document, verbatim, as one value. The server parses it and needs `client_email` and `private_key` (`push.provider.selector.ts`). |

5. **Where it goes:** production and staging go in the deployment's secret store. The local QA
   stack uses `~/.jawwid-qa/server.secrets.env` (chmod 600), read by `~/jawwid-qa-env/compose.yml`.
   Never put it in `qa.env`, `compose.yml` or git.
6. **Check:** the API refuses to start when only one of the two is set, and the error names the
   missing one. With neither set, it runs on the logging provider and sends nothing. This is the
   QA stack's state on 2026-11-03.

## 2. iOS: APNs

### 2.1 Already in place (verified 2026-11-03)

| Check | State |
|---|---|
| `aps-environment` in `ios/Runner/Runner.entitlements` (Debug, Profile) | `development` |
| `aps-environment` in `ios/Runner/RunnerRelease.entitlements` (Release) | `production` |
| `UIBackgroundModes` in `Info.plist` | `voip`, `remote-notification`, `audio` |
| Installed provisioning profile | "iOS Team Provisioning Profile: com.jawwid.jawwidChat", team `KX683HAR3Y`, `aps-environment = development`, expires 2027-10-17, includes the owner's iPhone 16 Pro Max |
| Signing identities on this Mac | 2 valid "Apple Development" identities |

So the Push Notifications capability is on the App ID, at least for development. A **Release**
(TestFlight or App Store) build needs a distribution profile carrying `production`. Xcode's
automatic signing creates it when that build is first archived.

### 2.2 The APNs key (owner)
1. In <https://developer.apple.com/account> go to **Certificates, Identifiers & Profiles →
   Keys → +**. Name it, for example, `Jawwid APNs`, and tick **Apple Push Notifications service
   (APNs)**. For the environment, choose **Sandbox & Production**.
2. Download the `.p8` file. Apple lets you download it **once**. Note the **Key ID**.
3. One key serves every app of the team, both environments, and VoIP. It does not expire.

### 2.3 Server variables

| Variable | Value |
|---|---|
| `APNS_KEY_ID` | The key's Key ID |
| `APNS_TEAM_ID` | `KX683HAR3Y` |
| `APNS_BUNDLE_ID` | `com.jawwid.jawwidChat` (the alert topic; VoIP adds `.voip`) |
| `APNS_PRIVATE_KEY` | The `.p8` file's contents, including the BEGIN/END lines |
| `APNS_PRODUCTION` | `false` for builds from Xcode or `flutter run`/`flutter install`, which get **sandbox** tokens. `true` only for TestFlight or App Store builds. Only the exact string `true` selects production. |
| `APNS_VOIP_ENABLED` | Leave unset. It gates call pushes, which are outside this test. |

A sandbox token sent to production (or the other way round) is rejected or dropped. For a
device test with a development build, **QA must use `APNS_PRODUCTION=false`**. All five
`APNS_*` variables are required together; a partial set stops the API at startup.

## 3. Real-device test plan (after §1 and §2 are in place)

**Environment:** the local QA stack only (`~/jawwid-qa-env`, `APP_ENV=staging`, synthetic
accounts), rebuilt from this branch so it carries migration `20261107100000`. The phone reaches
it over the private tailnet.

For each phone (Android, and the iPhone 16 Pro Max), and for each of **foreground**,
**background** (Home pressed) and **terminated** (swiped away):

| # | Action (Admin Web, as a synthetic Teachers-department user) | Expect on the phone (synthetic parent) |
|---|---|---|
| 1 | First reply to the parent's praise | "The administration has replied to your feedback." Tap: that item opens, its reply is shown, and the unread dot clears. |
| 2 | Edit that reply | Nothing |
| 3 | Take the parent's complaint | "Your complaint has been received and is being reviewed." Tap: that complaint opens. |
| 4 | Resolve a complaint that has a reply | "…resolved. You can view the administration's reply." |
| 5 | Resolve a complaint with no reply | "…addressed and closed." |
| 6 | The same while the app is **open** | iOS: a banner. Android: a notification. Tap behaves as above. Chat messages are not drawn while the app is open. |
| 7 | Sign out, then sign in as another synthetic parent and tap an old notification | Nothing from the first account (the tray is cleared on sign-out). An old link reads "no longer available". |
| 8 | A call to the parent | Unchanged from before this branch |

Also check the parent's Arabic (family language `ar`) and English wording.

## 4. Never
- Commit `google-services.json`, a service-account JSON or a `.p8` file.
- Put any of them in `qa.env`, `compose.yml`, a brief, a log or a chat message.
- Grant the FCM service account more than the one role.
- Point a development build at `APNS_PRODUCTION=true`.
