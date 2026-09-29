import { Logger } from '@nestjs/common';
import apn from '@parse/node-apn';
import type { PushMessage, PushProvider, PushResult } from './push.provider';

/**
 * APNs, behind the existing [PushProvider] seam.
 *
 * NOTHING ELSE IN THE DOMAIN CHANGES. `NotificationService` still schedules,
 * dedupes, renders, claims, retries and deactivates exactly as it did; this only
 * replaces "log it" with "send it". There is no second delivery path and no
 * second queue.
 *
 * ## Two different pushes, and the difference matters
 *
 * A VOIP push is a PushKit delivery. It has no alert, no sound and no badge —
 * it is a wake-up carrying data, and iOS requires the app to report an incoming
 * call to CallKit almost immediately or be terminated. `apns-push-type: voip`,
 * priority 10, and the topic must be the bundle id with `.voip` appended.
 *
 * An ALERT push is an ordinary notification with a title and a body.
 *
 * Which one a device gets is not decided here — `call-push-routing.ts` decides
 * whether a token may receive a notification at all, and `message.isVoip` is the
 * token's own kind.
 *
 * ## The SDK does the part that must not be hand-written
 *
 * A provider JWT signed with ES256, rotated on Apple's schedule, over a
 * long-lived HTTP/2 connection. See `docs/release/w8-dependency-log.md`.
 *
 * ## Nothing here authorizes anything
 *
 * It receives a destination token, a title, a body and a small data map, and
 * sends them. It never sees a Jawwid actor, never reads a call, and never
 * decides who may be notified — that was settled from the call record before
 * the notification was scheduled.
 */
export interface ApnsConfig {
  keyId: string;
  teamId: string;
  /** The signing key's PEM contents. Never a path in production config. */
  key: string;
  /** The app's bundle identifier. `.voip` is appended for PushKit. */
  bundleId: string;
  production: boolean;
}

/**
 * Reasons Apple gives for a token that will never work again.
 *
 * Mapped narrowly and deliberately: a transient failure must NOT deactivate a
 * device. `TooManyRequests`, `InternalServerError`, `ServiceUnavailable` and a
 * dropped connection are all retried by `NotificationService.fail`'s backoff,
 * and a token deactivated on one of those would silently stop a working phone
 * from ever ringing again.
 */
const PERMANENTLY_INVALID: ReadonlySet<string> = new Set([
  'BadDeviceToken',
  'Unregistered',
  'DeviceTokenNotForTopic',
  'TopicDisallowed',
]);

export class ApnsPushProvider implements PushProvider {
  private readonly log = new Logger(ApnsPushProvider.name);

  constructor(
    private readonly config: ApnsConfig,
    private readonly provider = new apn.Provider({
      token: {
        key: config.key,
        keyId: config.keyId,
        teamId: config.teamId,
      },
      production: config.production,
    }),
  ) {}

  async send(message: PushMessage): Promise<PushResult> {
    const notification = new apn.Notification();

    // The topic IS the routing: a VoIP push must go to `<bundle>.voip`, and
    // sending one to the plain bundle id is refused as DeviceTokenNotForTopic.
    notification.topic = message.isVoip
      ? `${this.config.bundleId}.voip`
      : this.config.bundleId;
    notification.pushType = message.isVoip ? 'voip' : 'alert';
    notification.priority = 10;

    if (message.isVoip) {
      // NO ALERT, NO SOUND, NO BADGE. A PushKit payload is data the app is
      // woken to act on; anything user-visible here would be a second
      // notification beside the call screen.
      notification.rawPayload = { ...message.data };
    } else {
      notification.alert = { title: message.title, body: message.body };
      notification.sound = 'default';
      notification.payload = { ...message.data };
    }

    let responses;
    try {
      responses = await this.provider.send(notification, message.token);
    } catch (error) {
      // A transport failure is not a dead token. Retried with backoff by the
      // caller; the device stays active.
      this.log.warn('apns: send failed before a response was received');
      return { ok: false, failureCode: 'APNS_TRANSPORT' };
    }

    if (responses.sent.length > 0) return { ok: true };

    const failure = responses.failed[0];
    const reason = failure?.response?.reason ?? 'UNKNOWN';
    // The reason only. A response can echo the payload, and this is the one
    // place a call id or a recipient could reach a log.
    this.log.warn(`apns: refused (${reason})`);

    return {
      ok: false,
      tokenInvalid: PERMANENTLY_INVALID.has(reason),
      failureCode: `APNS_${reason}`,
    };
  }

  /** Closes the HTTP/2 connection. Called on shutdown. */
  async shutdown(): Promise<void> {
    this.provider.shutdown();
  }
}
