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
    // The URL is checked alongside the credentials, and was not before. A
    // token minted against an empty URL is worse than a refusal: the client
    // receives a perfectly valid credential and nowhere to present it, and the
    // failure surfaces as a media timeout on a device instead of a
    // configuration error on the server.
    //
    // NAMES ONLY in the message. A misconfiguration error must never quote the
    // value it was unhappy with.
    const missing = [
      ['LIVEKIT_URL', this.url],
      ['LIVEKIT_API_KEY', this.apiKey],
      ['LIVEKIT_API_SECRET', this.apiSecret],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);

    if (missing.length > 0) {
      throw new Error(
        `LiveKit is not configured: ${missing.join(', ')} must be set to issue call tokens`,
      );
    }

    // LIVEKIT_URL is handed to the CLIENT, which connects with a WebSocket. A
    // LiveKit project has two faces at the same host -- wss:// for media
    // signalling, https:// for the RoomService control plane -- and an operator
    // copying the wrong one from the dashboard is an easy, silent mistake:
    // scripts/infra/livekit-probe.sh normalises wss:// to https:// for its own
    // request, so it would report the project VERIFIED while every client got a
    // URL it cannot connect to. Refusing here turns that into a server-side
    // configuration error instead of a mystery on a device.
    if (!/^wss?:\/\//.test(this.url)) {
      throw new Error(
        'LIVEKIT_URL must be a WebSocket URL (wss://…) — it is given to the ' +
          'client to connect with. The https:// form is the control-plane ' +
          'endpoint and is derived from it where needed.',
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
        // canPublishData is deliberately NOT granted. A voice call needs to
        // publish audio and subscribe to audio; the data channel is a second
        // messaging path, and this product already has one it authorizes
        // itself (the Socket.IO gateway, behind AuthorizationService). Granting
        // it here would open a channel between two participants that no
        // Jawwid rule governs. Add it back only for a feature that needs it.
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
