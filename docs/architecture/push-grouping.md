# Push grouping: which push replaces which (LR-11b)

One rule decides which pushes replace each other on a device. iOS applies it today as the
`apns-collapse-id` header. Android notification tags (#449) must use the same key, so both
platforms group the same way.

The rule lives in code in one place: `pushGroupKey` in
`apps/api/src/communication/notifications/push-grouping.ts`. Use that function. Do not write
the rule a second time.

## The rule

| Push | Group |
|---|---|
| Held (summary) chat push (`variables.held = true`) | Its own fixed group, `held-chats`. A newer summary replaces an older one. It never replaces, and is never replaced by, one chat's own banner. |
| Any other push with a call id in `data` | Event type + call |
| Any other push with a conversation id in `data` | Event type + conversation |
| No event type, or neither id | No key. It is never merged with anything. |

The event type is part of the key on purpose. Only pushes with the **same event type** in the
**same chat** replace each other. A missed call (`call_missed`), a lost connection
(`call_connection_lost`), a reminder or a mention (`mention_created`) in a chat never replaces
that chat's message banner (`message_published`), and a message never replaces them.

## The key

The key is `sha256("jawwid-push:" + group)`, cut to the first 32 hex characters. For example,
the group `message_published:conversation:<id>` becomes a 32-character key. APNs allows up to
64 bytes. No raw id goes into a header, and the same group always gives the same key.

The key is not an HMAC. No existing server secret serves this kind of purpose. The value goes
only to Apple and Google, and it tells nothing to someone who does not already have the chat id.

VoIP (PushKit) pushes never carry a collapse id.
