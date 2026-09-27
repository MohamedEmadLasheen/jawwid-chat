import { Injectable } from '@nestjs/common';
import { WebhookReceiver } from 'livekit-server-sdk';

/** The LiveKit webhook events this product consumes. Nothing else is handled. */
export const MEDIA_WEBHOOK_EVENTS = {
  PARTICIPANT_JOINED: 'participant_joined',
  PARTICIPANT_LEFT: 'participant_left',
} as const;

/** One verified webhook, reduced to what the reconciliation needs. */
export interface VerifiedMediaEvent {
  /** LiveKit's own event name, verbatim. */
  event: string;
  roomName: string | null;
  identity: string | null;
  /** The event's own timestamp. Never the moment it arrived here. */
  at: Date;
}

export class WebhookVerificationError extends Error {}

/**
 * THE WEBHOOK SEAM, and the only place a webhook is trusted.
 *
 * VERIFICATION IS THE OFFICIAL ONE. `WebhookReceiver` from
 * `livekit-server-sdk` checks the `Authorization` header — an HS256 JWT signed
 * with the project API secret — and then compares its `sha256` claim against a
 * hash of the RAW body, so a body edited in flight fails even with a valid
 * token. Standard JWT validity (signature, `exp`, `nbf`, algorithm) comes from
 * `jose` underneath.
 *
 * WHY THE SDK, when `media-token.ts` deliberately mints tokens without it. The
 * two are not the same risk. Minting is us signing something we control with a
 * secret we hold; verification is deciding whether an ATTACKER-CONTROLLED
 * request may change our database. Hand-rolling the second means hand-rolling
 * JWT verification — signature, expiry, algorithm confusion — and body-hash
 * comparison, which is exactly the code that is wrong in subtle ways. The
 * official verifier is one dependency against that.
 *
 * NOT A PARTICIPANT TOKEN. This verifies a credential LiveKit sends US, signed
 * with the API secret. A participant access token is a credential we send a
 * DEVICE. They are never interchangeable, and nothing here accepts one for the
 * other.
 *
 * NOTHING IS LOGGED HERE. Not the header, not the body, not the secret, not a
 * decoded claim. A verifier is the worst possible place for a diagnostic that
 * quotes its input.
 */
@Injectable()
export class LiveKitWebhookVerifier {
  private readonly apiKey = process.env.LIVEKIT_API_KEY ?? '';
  private readonly apiSecret = process.env.LIVEKIT_API_SECRET ?? '';

  private receiver: WebhookReceiver | null = null;

  /**
   * Verify and reduce. Throws [WebhookVerificationError] for anything it will
   * not vouch for — a missing header, a bad signature, a body that does not
   * match the hash, or a payload that is not JSON.
   *
   * The caller must pass the body EXACTLY as it arrived. A re-serialized object
   * hashes differently and would fail verification for the right reason but the
   * wrong cause, which is a confusing way to be secure.
   */
  async verify(rawBody: string, authorization?: string): Promise<VerifiedMediaEvent> {
    const receiver = this.receiverOrThrow();

    let event: Awaited<ReturnType<WebhookReceiver['receive']>>;
    try {
      // `skipAuth` is NOT passed. There is no configuration in this codebase
      // that turns verification off, deliberately: a flag like that is only
      // ever found in the position that disables it.
      event = await receiver.receive(rawBody, authorization);
    } catch (error) {
      // The SDK's message can quote the body hash. Only the category crosses
      // this boundary.
      throw new WebhookVerificationError('webhook verification failed');
    }

    // LiveKit sends seconds. A missing or zero timestamp is not defaulted to
    // "now": arrival time is not evidence of when something happened, and using
    // it would break the ordering rules the reconciliation depends on.
    const seconds = Number(event.createdAt ?? 0);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new WebhookVerificationError('webhook carried no usable timestamp');
    }

    return {
      event: event.event,
      roomName: event.room?.name ?? null,
      // The identity the server put in the token when it minted it. Not the
      // display name, and not metadata.
      identity: event.participant?.identity ?? null,
      at: new Date(seconds * 1000),
    };
  }

  /**
   * Configured, or nothing happens.
   *
   * Names only in the message. A misconfiguration must never quote the value it
   * was unhappy with — the same rule `media-token.ts` follows.
   */
  private receiverOrThrow(): WebhookReceiver {
    if (this.receiver) return this.receiver;

    const missing = [
      ['LIVEKIT_API_KEY', this.apiKey],
      ['LIVEKIT_API_SECRET', this.apiSecret],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);

    if (missing.length > 0) {
      throw new WebhookVerificationError(
        `LiveKit webhooks are not configured: ${missing.join(', ')} must be set`,
      );
    }

    this.receiver = new WebhookReceiver(this.apiKey, this.apiSecret);
    return this.receiver;
  }
}
