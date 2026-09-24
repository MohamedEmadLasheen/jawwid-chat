# Manual device verification checklist

The one thing no amount of work in CI closes. Run it once per platform per
release candidate, on a **physical** handset, and record the result.

Nothing on this list has been run yet. The engineering milestone is complete
and this gate is open; they are separate statuses and neither implies the other.

## Before you start

1. `google-services.json` → `android/app/`
2. `GoogleService-Info.plist` → `ios/Runner/`
3. The APNs key uploaded to the Firebase project (iOS push does not work
   without it, and the failure is silent)
4. FCM service-account variables set on the API — see `infra/env/manifest.tsv`
5. A second account to send from, and a staff account to publish from

The simulator cannot receive remote push. iOS must be a real device.

## Part 1 — platform mechanics

Record each as PASS / FAIL / BLOCKED, per platform, with the build number.

| # | Check | Android | iOS |
|---|---|---|---|
| 1 | App in the **foreground** → the notification arrives (in-app; no OS banner is expected) | A1 | I1 |
| 2 | App in the **background** → the notification arrives and is shown by the OS | A2 | I2 |
| 3 | App **terminated** (force-stopped / swiped away) → the notification still arrives | A3 | I3 |
| 4 | **Tap** the notification → the correct destination opens, from each of the three states above | A4 | I4 |
| 5 | **Token refresh** → the backend has the new token and the old one is gone | A5 | I5 |
| 6 | **Sign out** → that device stops receiving this user's notifications immediately | A6 | I6 |
| 7 | **Two devices** → both receive it; reading on one clears the badge on the other with no restart | A7 | I7 |
| 8 | **Offline → reconnect** → everything missed is present, once, and the badge is correct | A8 | I8 |

**iOS only:** an incoming call must ring through CallKit while the app is
terminated. That is the VoIP path, and it is separate from ordinary push.

## Part 2 — real business scenarios

Do not verify with a generic test push. A generic push proves Firebase works;
these prove the product works. Use the real app, real accounts, real actions.

| # | Action | Expected type | What to check beyond "it arrived" |
|---|---|---|---|
| 1 | Teacher sends a **text message** to a parent | `MESSAGE_RECEIVED` | The lock screen shows the neutral line, **not** the message body. Tapping opens the thread at that message |
| 2 | Teacher sends a **voice message** | `VOICE_MESSAGE_RECEIVED` | It says it is a voice message. Tapping opens at the voice message |
| 3 | Teacher calls and the parent does not answer | `MISSED_CALL` | Arrives whether the caller hung up or the ring timed out — and exactly once either way |
| 4 | Admin moves **Ahmed's** class | `CLASS_SCHEDULE_CHANGED` | Names Ahmed, and the body carries the old time and the new one. Move it a second time: the first notification still says what it said |
| 5 | Admin publishes an **important announcement** to parents | `IMPORTANT_ANNOUNCEMENT` | Arrives on every targeted parent's device, in their family's language. Tapping opens the announcement |

For a parent of more than one child, run 1 and 4 against two different children
and confirm each notification names the right one.

## Part 3 — after each run

Check `chat.notification_delivery`:

- one row per device per notification,
- `status = 'sent'` once the provider accepted it,
- `delivered` only after the app reported it — never inferred,
- `skip_reason` present and correct wherever a push did not go
  (`RECIPIENT_ACTIVE`, `PREFERENCE_OFF`, `NO_DEVICE_TOKEN`, `GROUPED`).

## Recording the result

Keep Android and iOS results **separate**. "Push works" is not a result;
"A1–A8 PASS on Pixel 7, Android 14, build 412" is.

Until both columns are complete, the platform's status stays:

```
PHYSICAL DEVICE VERIFICATION — PENDING
```
