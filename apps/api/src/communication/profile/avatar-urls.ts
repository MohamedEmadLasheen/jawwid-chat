import { createHash } from 'node:crypto';
import { MediaUrlSigner } from '../../platform/media-url';
import type { AvatarKind } from '../../platform/avatar-keys';

/**
 * Profile-photo links, as every chat payload carries them (RT-037).
 *
 * A link is `GET /media/avatars/<kind>.<id>.<context>`, signed for ONE viewer.
 * `context` is the conversation the viewer is looking at, or `self` (their own
 * photo, or their own child's). The signature is not the authorization: each
 * request re-decides, at that moment, that the viewer may still read that
 * conversation and that the person or child is part of it
 * (AvatarService.authorizeAvatarRead). No object key, no storage URL and no
 * bearer token ever reaches a client.
 *
 * Expiry is bucketed, so a list re-read every minute hands out the SAME url
 * for an hour and the client's image cache keeps the picture. The `k` suffix
 * is a short fingerprint of the stored object: a new photo is a new url, and
 * no cache can show the old one. It is not signed and grants nothing.
 */
const signer = new MediaUrlSigner();

export type AvatarContext = string; // a conversation id, or 'self'

export function avatarMediaId(kind: AvatarKind, id: string, context: AvatarContext): string {
  return `${kind}.${id}.${context}`;
}

export function signAvatar(
  kind: AvatarKind,
  id: string,
  context: AvatarContext,
  viewerId: string,
  objectKey: string | null | undefined,
  now = Date.now(),
): string | null {
  if (!objectKey) return null;
  const url = signer.urlBucketed('avatars', avatarMediaId(kind, id, context), 'o', viewerId, 3600, now);
  return `${url}&k=${createHash('sha256').update(objectKey).digest('hex').slice(0, 8)}`;
}

/** The photo of an actor (staff, parent, teacher) as one viewer sees it in one context. */
export function signActorAvatar(
  actor: { actorId: string; kind: string; avatarObjectKey?: string | null } | null | undefined,
  context: AvatarContext,
  viewerId: string,
): string | null {
  if (!actor || (actor.kind !== 'staff' && actor.kind !== 'contact' && actor.kind !== 'teacher')) return null;
  return signAvatar(actor.kind, actor.actorId, context, viewerId, actor.avatarObjectKey);
}
