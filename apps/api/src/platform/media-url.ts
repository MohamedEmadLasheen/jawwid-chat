import { createHmac, timingSafeEqual } from 'node:crypto';
import { currentRequestOrigin } from './request-origin';

/**
 * RT-037 -- the URL a client is given for an attachment.
 *
 * It points at THIS API (`GET /api/v1/media/attachments/:id`), never at the
 * storage bucket. It is signed and bound to one attachment, one variant and
 * ONE ACTOR, and expires -- but the signature is not the authorization. Every
 * request re-checks, at that moment, that the actor is live and may still read
 * the message, and only then streams the bytes. So a deactivation, a removal
 * from the conversation or a deletion takes effect on the next request; no
 * storage bearer URL ever leaves the server.
 *
 * Works in an <img>, an <a href> and a media player without a bearer header,
 * which is why the binding lives in the URL rather than in a header.
 */
export type MediaVariant = 'o' | 't'; // original, thumbnail
/**
 * What the link addresses: a message attachment, a story's media, a staff
 * profile photo (the staff directory's rule), or a profile photo seen in a
 * conversation (`avatars`: any kind of person, or a child -- see
 * communication/profile/avatar.service), or a viewer's own chat wallpaper
 * (`wallpapers`: served to its owner only -- communication/themes).
 */
export type MediaKind = 'attachments' | 'stories' | 'staff' | 'avatars' | 'wallpapers';

export interface MediaUrlClaims {
  kind: MediaKind;
  /** The attachment id or the story id. */
  attachmentId: string;
  variant: MediaVariant;
  actorId: string;
  expires: number; // unix seconds
  sig: string;
}

export class MediaUrlSigner {
  private key?: Buffer;

  /** Derived from JWT_ACCESS_SECRET (always required to boot), under its own label. */
  private keyOrThrow(): Buffer {
    if (this.key) return this.key;
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error('JWT_ACCESS_SECRET must be set (>= 32 chars) to sign media URLs');
    }
    this.key = createHmac('sha256', secret).update('jawwid:media-url:v1').digest();
    return this.key;
  }

  private mac(kind: MediaKind, id: string, variant: MediaVariant, actorId: string, expires: number): string {
    return createHmac('sha256', this.keyOrThrow())
      .update(`${kind}\n${id}\n${variant}\n${actorId}\n${expires}`)
      .digest('base64url');
  }

  /** `MEDIA_PUBLIC_BASE_URL` (absolute, ending in the API prefix) or this request's origin + /api/v1. */
  private base(): string {
    const configured = process.env.MEDIA_PUBLIC_BASE_URL?.trim();
    if (configured) return configured.replace(/\/+$/, '');
    const origin = currentRequestOrigin();
    return origin ? `${origin}/api/v1` : '/api/v1';
  }

  url(
    kind: MediaKind,
    id: string,
    variant: MediaVariant,
    actorId: string,
    ttlSeconds: number,
    now = Date.now(),
  ): string {
    const expires = Math.floor(now / 1000) + ttlSeconds;
    const sig = this.mac(kind, id, variant, actorId, expires);
    return `${this.base()}/media/${kind}/${id}?v=${variant}&a=${actorId}&e=${expires}&s=${sig}`;
  }

  /**
   * The same link, with its expiry rounded up to a bucket boundary, so every
   * signing within one bucket yields the SAME url. A conversation list re-read
   * every minute then hands out an unchanged avatar url and the client's image
   * cache keeps the picture instead of downloading it again. Safe because the
   * signature is not the authorization: every request is re-checked.
   */
  urlBucketed(
    kind: MediaKind,
    id: string,
    variant: MediaVariant,
    actorId: string,
    bucketSeconds = 3600,
    now = Date.now(),
  ): string {
    const nowSeconds = Math.floor(now / 1000);
    const expires = (Math.floor(nowSeconds / bucketSeconds) + 2) * bucketSeconds;
    const sig = this.mac(kind, id, variant, actorId, expires);
    return `${this.base()}/media/${kind}/${id}?v=${variant}&a=${actorId}&e=${expires}&s=${sig}`;
  }

  verify(c: MediaUrlClaims, now = Date.now()): boolean {
    if (c.kind !== 'attachments' && c.kind !== 'stories' && c.kind !== 'staff' && c.kind !== 'avatars' && c.kind !== 'wallpapers') return false;
    if (c.variant !== 'o' && c.variant !== 't') return false;
    if (!Number.isInteger(c.expires) || c.expires < Math.floor(now / 1000)) return false;
    const expected = Buffer.from(this.mac(c.kind, c.attachmentId, c.variant, c.actorId, c.expires));
    const given = Buffer.from(String(c.sig));
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
}
