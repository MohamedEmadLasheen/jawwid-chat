import { Injectable, Logger } from '@nestjs/common';
import { createSign } from 'node:crypto';
import type { PushMessage, PushProvider, PushResult } from './push.provider';

/**
 * Firebase Cloud Messaging, HTTP v1.
 *
 * FCM is the only push transport that serves all three platforms this product
 * targets -- Android, iOS (through APNs) and web -- so it is the one the device
 * model was already built around: chat.device_token carries a platform and a
 * VoIP flag, which are exactly FCM's two axes.
 *
 * NO SDK. The same reasoning as LiveKitTokenIssuer: HTTP v1 is a service-account
 * JWT exchanged for an access token and then one POST per token. firebase-admin
 * would add a large dependency, its own credential discovery and its own
 * retry policy -- a second, weaker copy of the retry policy DeliveryService
 * already owns.
 *
 * WHAT THIS CLASS DOES NOT DO. It does not retry, does not decide whether a
 * failure is worth retrying, and does not touch the database. It reports an
 * outcome; DeliveryService owns the backoff, the attempt budget and the token
 * deactivation. Keeping those out of here is what stops two retry loops from
 * existing.
 */

/** Everything FCM needs, and nothing else. */
export interface FcmConfig {
  projectId: string;
  clientEmail: string;
  /** PEM. Newlines may arrive escaped from an environment variable. */
  privateKey: string;
}

/** Seam, so the tests never open a socket. */
export type HttpPost = (
  url: string,
  init: { headers: Record<string, string>; body: string },
) => Promise<{ status: number; body: string }>;

/**
 * Reads FCM_PROJECT_ID and FCM_SERVICE_ACCOUNT_JSON.
 *
 * Those two names were already declared in infra/env/manifest.tsv, reserved for
 * exactly this, so this uses them rather than introducing a second spelling of
 * the same credentials. The JSON is the file Google hands out unmodified, which
 * means an operator pastes what they downloaded instead of taking it apart into
 * three variables and getting the PEM's newlines wrong.
 *
 * Returns null when unconfigured, and the module binds the logging provider
 * instead. Half-configured counts as unconfigured: a deployment that looks
 * wired and silently delivers nothing is the worst outcome for a product whose
 * promise is that the parent finds out.
 */
export function fcmConfigFromEnvironment(): FcmConfig | null {
  const projectId = process.env.FCM_PROJECT_ID ?? '';
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON ?? '';
  if (!projectId || !raw) return null;

  let parsed: { client_email?: string; private_key?: string; project_id?: string };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    // Thrown rather than returned as null: silently falling back to "log and do
    // not send" because a secret was pasted wrong is precisely the failure this
    // whole file exists to prevent.
    throw new Error('FCM_SERVICE_ACCOUNT_JSON is not valid JSON');
  }

  const clientEmail = parsed.client_email ?? '';
  // A PEM that has been through an environment variable almost always arrives
  // with its newlines escaped.
  const privateKey = (parsed.private_key ?? '').replace(/\\n/g, '\n');
  if (!clientEmail || !privateKey) {
    throw new Error(
      'FCM_SERVICE_ACCOUNT_JSON is missing client_email or private_key',
    );
  }

  if (parsed.project_id && parsed.project_id !== projectId) {
    // Two sources of truth that disagree: the sends would go to whichever one
    // this file happened to prefer, which is not something to guess at.
    throw new Error(
      'FCM_PROJECT_ID does not match the project_id in FCM_SERVICE_ACCOUNT_JSON',
    );
  }

  return { projectId, clientEmail, privateKey };
}

const OAUTH_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64url');

/**
 * FCM error codes that mean THIS TOKEN is permanently dead.
 *
 * Deliberately a short, explicit list. Everything else -- including every
 * authentication and quota failure -- is treated as a problem with us, not with
 * the device. Getting that backwards is the outage that deactivates every
 * device token in the academy because a service account expired, and it cannot
 * be undone: the tokens are gone and only a reinstall brings them back.
 */
const DEAD_TOKEN_CODES: ReadonlySet<string> = new Set([
  'UNREGISTERED',
  'INVALID_ARGUMENT',
  'SENDER_ID_MISMATCH',
]);

@Injectable()
export class FcmPushProvider implements PushProvider {
  private readonly log = new Logger(FcmPushProvider.name);

  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;

  constructor(
    private readonly config: FcmConfig,
    private readonly post: HttpPost = defaultPost,
    private readonly now: () => number = Date.now,
  ) {}

  async send(message: PushMessage): Promise<PushResult> {
    let token: string;
    try {
      token = await this.authorize();
    } catch (error) {
      // Our credentials, not their device. Retryable, and emphatically not a
      // reason to deactivate anything.
      this.log.error(
        `FCM authorization failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return { ok: false, failureCode: 'FCM_AUTH_FAILED' };
    }

    const response = await this.post(
      `https://fcm.googleapis.com/v1/projects/${this.config.projectId}/messages:send`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ message: this.payload(message) }),
      },
    );

    if (response.status >= 200 && response.status < 300) return { ok: true };

    const code = FcmPushProvider.errorCode(response.body);

    if (DEAD_TOKEN_CODES.has(code)) {
      return { ok: false, tokenInvalid: true, failureCode: code };
    }

    // 401/403 is a credentials problem, 429 is quota, 5xx is theirs. None of
    // them says anything about the device, so none of them may kill a token.
    // Logged at error because each one means pushes are failing academy-wide.
    if (response.status === 401 || response.status === 403) {
      this.log.error(`FCM rejected our credentials (${response.status}/${code})`);
      return { ok: false, failureCode: 'FCM_UNAUTHORIZED' };
    }
    if (response.status === 429) return { ok: false, failureCode: 'FCM_QUOTA' };
    if (response.status >= 500) return { ok: false, failureCode: 'FCM_UNAVAILABLE' };

    return { ok: false, failureCode: code || `FCM_HTTP_${response.status}` };
  }

  /**
   * The message body.
   *
   * `title` and `body` are whatever DeliveryService decided may appear on a
   * lock screen -- for messaging types that is the academy's name and an empty
   * line, because the content stays behind authentication. Nothing is added
   * here that the caller did not pass.
   */
  private payload(message: PushMessage): Record<string, unknown> {
    const notification =
      message.title || message.body
        ? { title: message.title, body: message.body }
        : undefined;

    return {
      token: message.token,
      // Routing ids only. FCM data payloads are delivered to the app, logged by
      // the platform and readable from the device's notification store.
      data: message.data,
      ...(notification ? { notification } : {}),
      android: {
        // A VoIP push has to wake a sleeping device or the call never rings.
        priority: message.isVoip ? 'high' : 'normal',
        ...(message.isVoip ? {} : { ttl: '86400s' }),
      },
      apns: {
        headers: {
          'apns-priority': message.isVoip ? '10' : '5',
          // The VoIP topic and push type are what put the call on the CallKit
          // path rather than in the notification centre.
          ...(message.isVoip ? { 'apns-push-type': 'voip' } : {}),
        },
        payload: {
          aps: {
            // Without this a data-only push does not wake a backgrounded app,
            // and the in-app badge would not update until it is reopened.
            'content-available': 1,
            ...(message.isVoip ? { sound: 'default' } : {}),
          },
        },
      },
      webpush: {
        headers: { Urgency: message.isVoip ? 'high' : 'normal' },
      },
    };
  }

  /**
   * A service-account access token, cached until shortly before it expires.
   *
   * One exchange per hour rather than one per push: an academy-wide
   * announcement is tens of thousands of sends, and a token exchange on each
   * would be both slow and a good way to be rate-limited by Google.
   */
  private async authorize(): Promise<string> {
    // 60 seconds of slack, so a token does not expire mid-batch.
    if (this.accessToken && this.now() < this.accessTokenExpiresAt - 60_000) {
      return this.accessToken;
    }

    const issuedAt = Math.floor(this.now() / 1000);
    const claims = {
      iss: this.config.clientEmail,
      scope: SCOPE,
      aud: OAUTH_URL,
      iat: issuedAt,
      exp: issuedAt + 3600,
    };

    const signingInput =
      `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.` +
      `${b64url(JSON.stringify(claims))}`;
    const signature = createSign('RSA-SHA256')
      .update(signingInput)
      .sign(this.config.privateKey);
    const assertion = `${signingInput}.${b64url(signature)}`;

    const response = await this.post(OAUTH_URL, {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    });

    if (response.status < 200 || response.status >= 300) {
      // The response body can echo the assertion; never log it verbatim.
      throw new Error(`token exchange returned ${response.status}`);
    }

    const parsed = JSON.parse(response.body) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!parsed.access_token) throw new Error('token exchange returned no access_token');

    this.accessToken = parsed.access_token;
    this.accessTokenExpiresAt = this.now() + (parsed.expires_in ?? 3600) * 1000;
    return this.accessToken;
  }

  /**
   * FCM's own error code, or ''.
   *
   * A malformed body must not throw: a parse failure here would turn a
   * recoverable send failure into an exception that DeliveryService records as
   * a generic error, losing the one piece of diagnosis the response carried.
   */
  static errorCode(body: string): string {
    try {
      const parsed = JSON.parse(body) as {
        error?: { status?: string; details?: Array<{ errorCode?: string }> };
      };
      const detail = parsed.error?.details?.find((d) => d.errorCode)?.errorCode;
      return detail ?? parsed.error?.status ?? '';
    } catch {
      return '';
    }
  }
}

const defaultPost: HttpPost = async (url, init) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: init.headers,
    body: init.body,
  });
  return { status: response.status, body: await response.text() };
};
