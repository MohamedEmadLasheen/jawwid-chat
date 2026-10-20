import { assertSafeObjectKey } from '../communication/attachments/object-key';

/**
 * Profile photos: one key shape for every kind of person and for children.
 *
 * `avatars/<kind>/<id of the row that holds it>/<uuid>` -- the shape the CHECK
 * constraints of 20261014130000_chat_avatar_key_format.sql enforce on every
 * avatar column. Checked STRUCTURALLY, never with `startsWith`: an object key
 * travels inside the signed URLs other people are shown, so a key lifted from
 * one of them must not be claimable as somebody else's photo, and
 * `avatars/contact/<idA><suffix>` must not pass for idA.
 */
export type AvatarKind = 'staff' | 'contact' | 'teacher' | 'learner';

export const AVATAR_KINDS: ReadonlySet<string> = new Set<AvatarKind>(['staff', 'contact', 'teacher', 'learner']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function avatarPrefixFor(kind: AvatarKind, ownerId: string): string {
  return `avatars/${kind}/${ownerId}`;
}

export function avatarKeyOf(kind: AvatarKind, ownerId: string, objectKey: string): boolean {
  try {
    assertSafeObjectKey(objectKey);
  } catch {
    return false;
  }
  const s = objectKey.split('/');
  return s.length === 4 && s[0] === 'avatars' && s[1] === kind && s[2] === ownerId && UUID.test(s[3]!);
}
