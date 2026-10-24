import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * PD-29: the token in a package's play URL,
 *
 *   /api/v1/materials/play/<itemId>/<token>/<path inside the package>
 *
 * It sits in the PATH, not the query, so the package's own relative URLs
 * (`js/app.js`, `../img/a.png` inside the package) resolve under the same
 * token and keep working. It binds one item, one package (its object key),
 * one viewer and an expiry (30 minutes) -- and, like every RT-037 link, it is not the
 * authorization: each file request re-checks that the viewer is live and the
 * item still published.
 *
 * KEY SEPARATION. The key is purpose-bound: HMAC(JWT_ACCESS_SECRET,
 * "jawwid/pd029/play-token/v1"). It is never JWT_ACCESS_SECRET itself, so a
 * play token can never be confused with, or used to forge, an access token, a
 * media URL or anything else signed from that secret -- and vice versa.
 */
export const PLAY_TOKEN_LABEL = 'jawwid/pd029/play-token/v1';
/** Short: a package that navigates itself could show its own URL, token included. */
export const PLAY_TOKEN_TTL_SECONDS = 30 * 60;

export interface PlayClaims {
  itemId: string;
  objectKey: string;
  actorId: string;
  expires: number; // unix seconds
}

export class PlayTokenSigner {
  private key?: Buffer;

  constructor(private readonly secretOf: () => string | undefined = () => process.env.JWT_ACCESS_SECRET) {}

  private keyOrThrow(): Buffer {
    if (this.key) return this.key;
    const secret = this.secretOf();
    if (!secret || secret.length < 32) throw new Error('JWT_ACCESS_SECRET must be set (>= 32 chars) to sign play links');
    this.key = createHmac('sha256', secret).update(PLAY_TOKEN_LABEL).digest();
    return this.key;
  }

  private mac(c: Omit<PlayClaims, 'expires'> & { expires: number }): string {
    return createHmac('sha256', this.keyOrThrow())
      .update(`${c.itemId}\n${c.objectKey}\n${c.actorId}\n${c.expires}`)
      .digest('base64url');
  }

  /** `<actorId>.<expires>.<mac>` -- URL-safe, no slash. */
  sign(itemId: string, objectKey: string, actorId: string, ttlSeconds = PLAY_TOKEN_TTL_SECONDS, now = Date.now()): string {
    const expires = Math.floor(now / 1000) + ttlSeconds;
    return `${actorId}.${expires}.${this.mac({ itemId, objectKey, actorId, expires })}`;
  }

  /** The viewer a token names, if it is genuine, unexpired and for this item's current package; else null. */
  verify(token: string, itemId: string, objectKey: string, now = Date.now()): { actorId: string; expires: number } | null {
    const parts = String(token ?? '').split('.');
    if (parts.length !== 3) return null;
    const [actorId, rawExpires, sig] = parts as [string, string, string];
    if (!/^[0-9a-f-]{36}$/i.test(actorId) || !/^\d{1,12}$/.test(rawExpires)) return null;
    const expires = Number(rawExpires);
    if (expires < Math.floor(now / 1000)) return null;
    const expected = Buffer.from(this.mac({ itemId, objectKey, actorId, expires }));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    return { actorId, expires };
  }
}
