import { Logger } from '@nestjs/common';
import { JWT } from 'google-auth-library';
import type { PushMessage, PushProvider, PushResult } from './push.provider';

/**
 * FCM HTTP v1, behind the existing [PushProvider] seam.
 *
 * NOTHING ELSE IN THE DOMAIN CHANGES — same scheduling, dedupe, claim, retry and
 * token-deactivation path as before. See `apns.provider.ts` for the same note.
 *
 * ## Why `google-auth-library` and not `firebase-admin`
 *
 * FCM v1 authenticates with an OAuth2 access token obtained by signing a
 * service-account JWT. That signing is the part AD-1 forbids hand-rolling, and
 * this library is exactly that part — while `firebase-admin` would drag
 * Firestore, Realtime Database, Storage, Auth and App Check into a service that
 * needs one HTTPS POST. The send itself is a `fetch` against the documented
 * endpoint. See `docs/release/w8-dependency-log.md`.
 *
 * ## Data-only, always
 *
 * Every message sent here is data-only: no `notification` block. The client
 * decides what to display, which is what lets an Android call push wake the app
 * and be handled rather than drawn as a banner it cannot act on. `priority:
 * high` so a call is delivered while the device is dozing.
 *
 * ## There is no VoIP channel on Android
 *
 * FCM has no PushKit equivalent, so `message.isVoip` is false for every Android
 * token and is not consulted here. The routing that keeps call and non-call
 * traffic apart lives in `call-push-routing.ts`, not in a provider.
 */
export interface FcmConfig {
  projectId: string;
  clientEmail: string;
  /** The service account's private key, PEM contents. */
  privateKey: string;
}

/**
 * The v1 errors that mean this token is finished.
 *
 * Narrow on purpose: `UNAVAILABLE`, `INTERNAL`, `QUOTA_EXCEEDED` and a network
 * failure are transient and must leave the device active, or a momentary FCM
 * outage would quietly unregister every phone in the system.
 */
const PERMANENTLY_INVALID: ReadonlySet<string> = new Set([
  'UNREGISTERED',
  'INVALID_ARGUMENT',
  'SENDER_ID_MISMATCH',
]);

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

export class FcmPushProvider implements PushProvider {
  private readonly log = new Logger(FcmPushProvider.name);
  private readonly auth: JWT;
  private readonly endpoint: string;

  constructor(config: FcmConfig, auth?: JWT) {
    this.auth =
      auth ??
      new JWT({
        email: config.clientEmail,
        key: config.privateKey,
        scopes: [SCOPE],
      });
    this.endpoint = `https://fcm.googleapis.com/v1/projects/${config.projectId}/messages:send`;
  }

  async send(message: PushMessage): Promise<PushResult> {
    let token: string | null | undefined;
    try {
      // The library caches and refreshes this; it is not minted per message.
      ({ token } = await this.auth.getAccessToken());
    } catch {
      // Could not authenticate to FCM. Transient as far as the device is
      // concerned: never deactivate a token because OUR credentials failed.
      this.log.warn('fcm: could not obtain an access token');
      return { ok: false, failureCode: 'FCM_AUTH' };
    }
    if (!token) return { ok: false, failureCode: 'FCM_AUTH' };

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token: message.token,
            // DATA ONLY. No `notification` block: the client decides what to
            // show, and a call push must reach code rather than a banner.
            data: message.data,
            android: { priority: 'high' },
          },
        }),
      });
    } catch {
      this.log.warn('fcm: send failed before a response was received');
      return { ok: false, failureCode: 'FCM_TRANSPORT' };
    }

    if (response.ok) return { ok: true };

    const status = response.status;
    let reason = 'UNKNOWN';
    try {
      const body = (await response.json()) as {
        error?: { status?: string; details?: { errorCode?: string }[] };
      };
      reason =
        body.error?.details?.find((d) => d.errorCode)?.errorCode ??
        body.error?.status ??
        'UNKNOWN';
    } catch {
      // A body we cannot read is still a failure; the status carries enough.
    }

    // The reason only, never the payload: this is the one place a call id or a
    // recipient could reach a log.
    this.log.warn(`fcm: refused (${status} ${reason})`);

    // 404 is v1's "this token no longer exists"; 400 INVALID_ARGUMENT is a
    // malformed or foreign token. 401/403 are OUR credentials and must never
    // deactivate a device; 429 and 5xx are transient.
    const tokenInvalid =
      PERMANENTLY_INVALID.has(reason) || status === 404;

    return { ok: false, tokenInvalid, failureCode: `FCM_${reason}` };
  }
}
