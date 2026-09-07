import { Injectable, Logger } from '@nestjs/common';
import { createSign } from 'node:crypto';
import type { PushMessage, PushProvider, PushResult } from './push.provider';
import { base64Url } from './fcm.provider';

/** Injectable so the payload, the headers and the error mapping are testable. */
export type ApnsSend = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ status: number; text: () => Promise<string> }>;

/**
 * iOS push, through APNs' HTTP/2 provider API with token-based authentication.
 *
 * ## Tokens, not certificates
 *
 * A `.p8` signing key with a key id and a team id, rather than a per-app
 * certificate. Certificates expire annually and are per-environment and
 * per-bundle; a token key does not expire, covers every app for the team, and
 * is one secret to rotate instead of a renewal calendar. Apple has recommended
 * it since 2016.
 *
 * ## Environment separation is not optional
 *
 * A token minted for a device registered against the sandbox gateway is
 * rejected by the production gateway with `BadDeviceToken`, and the other way
 * round. That is the single most common way a working push pipeline appears
 * broken after a release, so the host comes from configuration and has no
 * default: an unset `APNS_ENVIRONMENT` is a startup failure, not a guess.
 *
 * ## Two topics, one key
 *
 * A VoIP push goes to `<bundle>.voip` with `apns-push-type: voip`, and an
 * ordinary alert to `<bundle>` with `apns-push-type: alert`. Sending a VoIP
 * payload on the alert topic silently fails to raise CallKit, and iOS
 * terminates an app that receives a VoIP push and does not report a call.
 */
@Injectable()
export class ApnsPushProvider implements PushProvider {
  private readonly log = new Logger(ApnsPushProvider.name);

  private readonly keyId: string;
  private readonly teamId: string;
  private readonly privateKey: string;
  private readonly bundleId: string;
  private readonly host: string;
  private readonly http: ApnsSend;

  /** Apple asks that a provider token be reused for at least 20 minutes and refreshed within 60. */
  private token: { value: string; mintedAt: number } | null = null;

  constructor(http?: ApnsSend) {
    const config = ApnsPushProvider.requireConfig();
    this.keyId = config.keyId;
    this.teamId = config.teamId;
    this.privateKey = config.privateKey;
    this.bundleId = config.bundleId;
    this.host = config.host;
    this.http =
      http ??
      (async (url, init) => {
        const response = await fetch(url, init);
        return { status: response.status, text: () => response.text() };
      });
  }

  static isConfigured(): boolean {
    return Boolean(
      process.env.APNS_KEY_ID &&
        process.env.APNS_TEAM_ID &&
        process.env.APNS_PRIVATE_KEY &&
        process.env.APNS_BUNDLE_ID &&
        process.env.APNS_ENVIRONMENT,
    );
  }

  private static requireConfig() {
    const keyId = process.env.APNS_KEY_ID;
    const teamId = process.env.APNS_TEAM_ID;
    const privateKey = process.env.APNS_PRIVATE_KEY;
    const bundleId = process.env.APNS_BUNDLE_ID;
    const environment = process.env.APNS_ENVIRONMENT;

    if (!keyId || !teamId || !privateKey || !bundleId || !environment) {
      throw new Error(
        'ApnsPushProvider requires APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY, ' +
          'APNS_BUNDLE_ID and APNS_ENVIRONMENT',
      );
    }
    if (environment !== 'production' && environment !== 'sandbox') {
      throw new Error(`APNS_ENVIRONMENT must be production or sandbox; got ${environment}`);
    }

    return {
      keyId,
      teamId,
      // Tolerates the escaped form a single-line secret store produces.
      privateKey: privateKey.replace(/\\n/g, '\n'),
      bundleId,
      host:
        environment === 'production'
          ? 'https://api.push.apple.com'
          : 'https://api.sandbox.push.apple.com',
    };
  }

  async send(message: PushMessage): Promise<PushResult> {
    const headers: Record<string, string> = {
      authorization: `bearer ${this.providerToken()}`,
      'apns-topic': message.isVoip ? `${this.bundleId}.voip` : this.bundleId,
      'apns-push-type': message.isVoip ? 'voip' : 'alert',
      'apns-priority': message.priority === 'low' ? '5' : '10',
      'content-type': 'application/json',
    };
    // A VoIP push must not be collapsed or grouped: each incoming call is its
    // own event, and replacing one with another would drop a call.
    if (!message.isVoip) {
      if (message.collapseId) headers['apns-collapse-id'] = message.collapseId;
    }

    const response = await this.http(`${this.host}/3/device/${message.token}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(this.payload(message)),
    });

    if (response.status === 200) return { ok: true };

    const body = await response.text();
    let reason = '';
    try {
      reason = (JSON.parse(body) as { reason?: string }).reason ?? '';
    } catch {
      reason = '';
    }

    // 410 Gone, and BadDeviceToken, are Apple saying the token is dead: the app
    // was removed, or it was registered against the other environment. Both
    // mean stop spending attempts on it.
    const tokenInvalid =
      response.status === 410 ||
      reason === 'BadDeviceToken' ||
      reason === 'Unregistered' ||
      reason === 'DeviceTokenNotForTopic';

    // The reason code, never the body and never the token.
    this.log.warn(`apns rejected a push with ${response.status} ${reason}`);

    return { ok: false, tokenInvalid, failureCode: `APNS_${reason || response.status}` };
  }

  private payload(message: PushMessage): Record<string, unknown> {
    if (message.isVoip) {
      // A VoIP payload carries NO `aps.alert`: CallKit renders the incoming
      // call, and an alert as well would show a banner behind the call screen.
      return { ...message.data };
    }

    return {
      aps: {
        alert: { title: message.title, body: message.body },
        sound: message.priority === 'critical' ? 'default' : 'default',
        // One conversation, one group in Notification Center.
        'thread-id': message.threadId,
        // So the app can update the badge without a round trip it cannot make
        // while it is not running.
        'mutable-content': 1,
      },
      ...message.data,
    };
  }

  /**
   * The provider authentication token: an ES256 JWT over the key id and team id.
   *
   * Reused rather than minted per push. Apple rate-limits providers that mint a
   * new token for every request (`TooManyProviderTokenUpdates`), which on a
   * busy send looks like APNs randomly refusing valid pushes.
   */
  private providerToken(): string {
    const fiftyMinutes = 50 * 60 * 1000;
    if (this.token && Date.now() - this.token.mintedAt < fiftyMinutes) {
      return this.token.value;
    }

    const header = { alg: 'ES256', kid: this.keyId };
    const claims = { iss: this.teamId, iat: Math.floor(Date.now() / 1000) };
    const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(
      JSON.stringify(claims),
    )}`;

    // dsaEncoding matters: APNs requires the raw r||s form, and Node's default
    // is DER. A DER signature is well-formed, verifies nowhere, and is rejected
    // as InvalidProviderToken -- which reads as a wrong key rather than a
    // wrong encoding.
    const signature = createSign('SHA256')
      .update(signingInput)
      .sign({ key: this.privateKey, dsaEncoding: 'ieee-p1363' })
      .toString('base64url');

    const value = `${signingInput}.${signature}`;
    this.token = { value, mintedAt: Date.now() };
    return value;
  }
}
