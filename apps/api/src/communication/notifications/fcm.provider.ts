import { Injectable, Logger } from '@nestjs/common';
import { createSign } from 'node:crypto';
import type { PushMessage, PushProvider, PushResult } from './push.provider';

/** Just enough of a Google service-account key file. */
interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

/** Injectable so the payload and the error mapping are testable without Google. */
export type HttpSend = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ status: number; text: () => Promise<string> }>;

/**
 * Android push, through Firebase Cloud Messaging's HTTP v1 API.
 *
 * ## Why not firebase-admin
 *
 * The same reasoning `S3ObjectStorage` records for the AWS SDK. What is needed
 * here is one OAuth2 assertion and one POST; `firebase-admin` brings the whole
 * Firebase surface — Firestore, Auth, Storage, RTDB — for it. A dependency that
 * large earns its place by doing something hard, and a signed JWT against
 * `node:crypto` is not that.
 *
 * ## The legacy API is not an option
 *
 * The `/fcm/send` server-key endpoint was decommissioned in 2024. HTTP v1 with
 * a service-account assertion is the only thing that works, and it is also the
 * only one where the credential is scoped and rotatable.
 *
 * ## Data messages, not notification messages
 *
 * The payload carries BOTH a `notification` block and a `data` block. The
 * notification block is what Android's system tray renders when the app is not
 * running, and the data block is what the app reads to route the tap. Sending
 * only data would mean nothing is displayed when the app is killed — which is
 * exactly when a notification matters most.
 */
@Injectable()
export class FcmPushProvider implements PushProvider {
  private readonly log = new Logger(FcmPushProvider.name);
  private readonly account: ServiceAccount;
  private readonly http: HttpSend;

  /** Cached access token and the instant it stops being usable. */
  private token: { value: string; expiresAt: number } | null = null;

  constructor(http?: HttpSend) {
    this.account = FcmPushProvider.requireServiceAccount();
    this.http =
      http ??
      (async (url, init) => {
        const response = await fetch(url, init);
        return { status: response.status, text: () => response.text() };
      });
  }

  /**
   * Whether this process is configured for FCM.
   *
   * The module reads this to choose a provider, so a developer with no Firebase
   * project still gets the logging provider rather than a boot failure — while
   * a deployment, where the variable is required, gets the real one.
   */
  static isConfigured(): boolean {
    return Boolean(process.env.FCM_SERVICE_ACCOUNT_JSON);
  }

  private static requireServiceAccount(): ServiceAccount {
    const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
    if (!raw) {
      // No default and no fallback. A committed service account is a
      // credential in the repository.
      throw new Error('FCM_SERVICE_ACCOUNT_JSON is not set');
    }
    const parsed = JSON.parse(raw) as ServiceAccount;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      throw new Error(
        'FCM_SERVICE_ACCOUNT_JSON must contain project_id, client_email and private_key',
      );
    }
    return parsed;
  }

  async send(message: PushMessage): Promise<PushResult> {
    const accessToken = await this.accessToken();
    const url = `https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`;

    const response = await this.http(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ message: this.payload(message) }),
    });

    if (response.status >= 200 && response.status < 300) return { ok: true };

    const body = await response.text();

    // UNREGISTERED / INVALID_ARGUMENT on the token mean the app was
    // uninstalled or the token was reissued. Saying so lets the caller retire
    // the row, which is what stops every future notification for this person
    // spending an attempt on a device that no longer exists.
    const tokenInvalid =
      response.status === 404 ||
      (response.status === 400 && /registration.token|invalid.argument/i.test(body));

    // Never the body: an FCM error echoes the registration token it rejected,
    // and a token is a routing capability for somebody's device.
    this.log.warn(`fcm rejected a push with ${response.status}`);

    return {
      ok: false,
      tokenInvalid,
      failureCode: `FCM_${response.status}`,
    };
  }

  /** The FCM v1 message body. */
  private payload(message: PushMessage): Record<string, unknown> {
    return {
      token: message.token,
      // Rendered by the system tray when the app is not running.
      notification: { title: message.title, body: message.body },
      // Read by the app to route the tap. Every value must be a string: FCM
      // rejects a data map with non-string values, and the failure is a 400
      // that does not say which key.
      data: Object.fromEntries(
        Object.entries(message.data).map(([k, v]) => [k, String(v)]),
      ),
      android: {
        priority: message.priority === 'critical' || message.priority === 'high'
          ? 'high'
          : 'normal',
        // Replaces rather than stacks: this is what makes an at-least-once
        // redelivery invisible to the user.
        collapse_key: message.collapseId,
        notification: {
          // One conversation, one stack in the shade.
          tag: message.threadId,
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
    };
  }

  /**
   * An OAuth2 access token for the service account.
   *
   * Cached with a sixty-second safety margin: a token that expires while a
   * batch is in flight fails the rest of the batch for a reason unrelated to
   * any of those notifications.
   */
  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) {
      return this.token.value;
    }

    const tokenUri = this.account.token_uri ?? 'https://oauth2.googleapis.com/token';
    const assertion = this.assertion(tokenUri);

    const response = await this.http(tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`FCM token exchange failed with ${response.status}`);
    }

    const parsed = JSON.parse(await response.text()) as {
      access_token: string;
      expires_in: number;
    };
    this.token = {
      value: parsed.access_token,
      expiresAt: Date.now() + parsed.expires_in * 1000,
    };
    return parsed.access_token;
  }

  /** RS256 JWT, signed with the service account's private key. */
  private assertion(audience: string): string {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claims = {
      iss: this.account.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: audience,
      iat: now,
      exp: now + 3600,
    };

    const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(
      JSON.stringify(claims),
    )}`;
    const signature = createSign('RSA-SHA256')
      .update(signingInput)
      .sign(this.account.private_key)
      .toString('base64url');

    return `${signingInput}.${signature}`;
  }
}

export function base64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}
