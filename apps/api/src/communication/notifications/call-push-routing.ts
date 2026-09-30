/**
 * WHICH DEVICE A NOTIFICATION MAY REACH, and what a call push may carry.
 *
 * One module, three pure functions, no I/O. Everything about "is this a call,
 * and may this token receive it" lives here so the rule is stated once and can
 * be tested without a database, a provider or a device.
 *
 * ## The guarantee this exists for
 *
 * A **VoIP token must never receive a non-call payload.** On iOS a PushKit
 * delivery that does not immediately report a call to CallKit does not merely
 * fail — the system terminates the app, and repeat offences revoke the VoIP
 * entitlement. Sending a new-message notification to a VoIP token is therefore
 * a crash loop and an App Review rejection, not an inefficiency.
 *
 * Before this module, `NotificationService.deliver` sent every notification to
 * every active token of the recipient, so exactly that happened.
 *
 * ## Why `eventType` and not priority or quiet hours
 *
 * `incoming_call` and `group_call_started` are also the only rules with
 * `priority = 'critical'` and `respect_quiet_hours = false`, so either would
 * work today and both would be wrong tomorrow: they describe how urgent a
 * notification is, not what it is. A future critical non-call rule would
 * silently start routing to PushKit. `event_type` names the thing itself.
 */

/**
 * The event types that mean "a call is ringing". From the seeded rules:
 * `incoming_call → call_started` and `group_call_started → group_call_started`.
 *
 * `call_missed` is deliberately NOT here. A missed call is an ordinary
 * notification about something that already finished: there is no call to
 * report to CallKit, so a PushKit delivery for it would be the exact violation
 * described above.
 */
export const CALL_EVENT_TYPES: ReadonlySet<string> = new Set([
  'call_started',
  'group_call_started',
]);

export function isCallNotification(eventType: string): boolean {
  return CALL_EVENT_TYPES.has(eventType);
}

/** The shape of a device row this module needs. Nothing else is consulted. */
export interface RoutableToken {
  platform: string;
  isVoip: boolean;
}

/**
 * May this notification be delivered to this device?
 *
 * ```
 *   VoIP token (iOS PushKit)   call only            — the absolute guarantee
 *   iOS standard token         non-call only        — the call goes to PushKit
 *   Android / web token        anything             — FCM has no VoIP channel
 * ```
 *
 * ## Why a call is not "VoIP tokens only"
 *
 * The one-line version of this rule would be `isVoip === isCall`, and it would
 * silently break Android: FCM has no VoIP channel at all, so every Android
 * token has `is_voip = false` and no Android device would ever be told about a
 * call. The PRD requires FCM for Android calls (§12), so the rule is stated as
 * what it actually is — a constraint on the **VoIP** channel, not a symmetry.
 *
 * ## Why an iOS standard token does not also get the call
 *
 * It would ring twice: once as a CallKit screen from the VoIP push and once as
 * a banner. Apple's guidance is that the VoIP push is the call on iOS.
 *
 * An iOS device holding only a standard token therefore receives no call push.
 * That is correct rather than unfortunate: an incoming-call banner with no
 * CallKit screen behind it is the degraded experience the platform rules exist
 * to prevent, and W8-W1 does not ship one.
 */
export function mayDeliverTo(isCall: boolean, token: RoutableToken): boolean {
  if (token.isVoip) return isCall;
  if (token.platform === 'ios') return !isCall;
  return true;
}

/**
 * The call this notification is about, or null.
 *
 * ## Where the id comes from, and why it is read out of the dedupe key
 *
 * `chat.notification` has no `call_id` column and W8-W1 adds no migration. The
 * producers that schedule call notifications are frozen — `notifyIncomingCall`
 * and `notifyMissedCall` are correct and must not be touched — so the id cannot
 * be added to `variables` either. It is, however, already present: those
 * producers build the dedupe key as
 *
 *   `${ruleKey}:${callId}:${recipientActorId}`
 *
 * and that key is the deduplication contract, which makes it the most stable
 * string in the pipeline rather than an incidental one.
 *
 * ## It is parsed defensively, and only for calls
 *
 * The middle segment must be a uuid and there must be exactly three segments.
 * Anything else yields null and the payload simply carries no `callId` — a push
 * that wakes the app is still useful, and a malformed id in a payload the
 * native layer trusts would be worse than an absent one. Other rules (
 * `new_message:${messageId}:${actorId}`, the reminder keys) are never parsed,
 * because the caller only asks about call event types.
 *
 * Recorded as a carry-forward: a `call_id` column would be cleaner, and it needs
 * a migration nobody has authorized.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function callIdFromDedupeKey(dedupeKey: string): string | null {
  const parts = dedupeKey.split(':');
  if (parts.length !== 3) return null;
  const candidate = parts[1];
  return UUID.test(candidate) ? candidate : null;
}

/**
 * The `data` a device receives.
 *
 * MINIMAL BY CONSTRUCTION. Four keys at most, and `callId` only for a call.
 * Everything else the client fetches over the authenticated API.
 *
 * `callId` IS NOT A CAPABILITY. It exists because the native call layer must
 * report a specific call to CallKit and later correlate an accept or a decline
 * to it. It is never rendered, and it authorizes nothing: `POST
 * /calls/:id/accept`, `/decline` and `/end` each re-run the full server-side
 * chain, and `POST /calls/:id/token` is the only route to media. Someone
 * holding a call id and no session can do nothing with it.
 *
 * What may never appear here, and cannot: a LiveKit token, a room name, an
 * access token, any media credential, or a contact channel. This function
 * builds the object; it does not copy one.
 */
export function buildPushData(input: {
  eventType: string;
  notificationId: string;
  conversationId?: string | null;
  dedupeKey: string;
}): Record<string, string> {
  const isCall = isCallNotification(input.eventType);
  const callId = isCall ? callIdFromDedupeKey(input.dedupeKey) : null;

  return {
    eventType: input.eventType,
    notificationId: input.notificationId,
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    ...(callId ? { callId } : {}),
  };
}
