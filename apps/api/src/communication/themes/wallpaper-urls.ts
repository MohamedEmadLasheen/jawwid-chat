import { createHash } from 'node:crypto';
import { MediaUrlSigner } from '../../platform/media-url';

const signer = new MediaUrlSigner();

/**
 * A viewer's own wallpaper link for one chat: signed for THEM (the media route
 * serves it to no one else, see ChatThemeService.authorizeWallpaperRead),
 * hour-bucketed so re-reading the chat list does not churn image caches, and
 * fingerprinted so a replaced photo is a new URL.
 */
export function signWallpaper(conversationId: string, viewerId: string, objectKey: string | null | undefined, now = Date.now()): string | null {
  if (!objectKey) return null;
  const url = signer.urlBucketed('wallpapers', conversationId, 'o', viewerId, 3600, now);
  return `${url}&k=${createHash('sha256').update(objectKey).digest('hex').slice(0, 8)}`;
}
