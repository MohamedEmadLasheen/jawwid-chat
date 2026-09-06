import { Injectable } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';

/**
 * PLATFORM SEAM for the media server.
 *
 * The engine never lets a client choose a room. It hands this issuer a room
 * name the server minted and an identity the server resolved, and gets back a
 * short-lived token.
 */
export interface MediaGrant {
  roomName: string;
  identity: string;
  /** Display name only. Never a phone number. */
  name: string;
  canPublish: boolean;
  ttlSeconds: number;
}

export interface MediaTokenIssuer {
  issue(grant: MediaGrant): Promise<{ token: string; url: string; expiresAt: string }>;
}

const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * LiveKit access tokens are HS256 JWTs signed with the project API secret, so
 * this issues a real one without pulling in the server SDK.
 *
 * The token grants exactly one room, for one identity, for a short window. It
 * cannot be replayed into another room because the room is inside the signed
 * payload.
 */
@Injectable()
export class LiveKitTokenIssuer implements MediaTokenIssuer {
  private readonly apiKey = process.env.LIVEKIT_API_KEY ?? '';
  private readonly apiSecret = process.env.LIVEKIT_API_SECRET ?? '';
  private readonly url = process.env.LIVEKIT_URL ?? '';

  async issue(grant: MediaGrant): Promise<{ token: string; url: string; expiresAt: string }> {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error(
        'LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set to issue call tokens',
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const exp = now + grant.ttlSeconds;

    const header = { alg: 'HS256', typ: 'JWT' };
    const payload = {
      iss: this.apiKey,
      sub: grant.identity,
      jti: randomUUID(),
      nbf: now - 5,
      exp,
      name: grant.name,
      video: {
        room: grant.roomName,
        roomJoin: true,
        // A participant may never create or list rooms; the server owns the
        // room lifecycle.
        roomCreate: false,
        roomList: false,
        canPublish: grant.canPublish,
        canSubscribe: true,
        canPublishData: true,
      },
    };

    const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
    const signature = b64url(
      createHmac('sha256', this.apiSecret).update(signingInput).digest(),
    );

    return {
      token: `${signingInput}.${signature}`,
      url: this.url,
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }
}
