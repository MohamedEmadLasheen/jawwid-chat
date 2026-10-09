import { randomUUID } from 'node:crypto';
import { CommError, CommErrorCode } from '../../platform/errors';

/**
 * What an object key is, and what it is NOT. Owner: AI #7.
 *
 * ## An object key is a name, never a capability
 *
 * The bucket is private in every environment (ADR-005), so the only way to read
 * an object is a signed URL this API issues. That makes the signing call the
 * real access-control decision, and it makes this invariant load-bearing:
 *
 *   > **Knowing an object key must never be sufficient to obtain a signed URL
 *   > or otherwise read an object.**
 *
 * The key is a namespaced name — `conversations/<conversationId>/<uuid>` — and
 * the namespace is the conversation that authorized the upload. But a key
 * arrives from the CLIENT on `POST /conversations/:id/messages`, so the
 * namespace inside it is a claim, not a fact. It is checked here against the
 * conversation the server has stored for the message, and never trusted on its
 * own.
 *
 * This module is deliberately storage-agnostic. The rule must hold identically
 * whether OBJECT_STORAGE is the local reference implementation or S3: both
 * sign whatever key they are handed, so neither can be the place the decision
 * is made.
 */

/** The single namespace segment every attachment key begins with. */
const CONVERSATION_PREFIX = 'conversations';

/** The namespace segment every profile-photo key begins with. */
const AVATAR_PREFIX = 'avatars';

/**
 * The one place a key's shape is checked.
 *
 * Rejects absolute keys, traversal segments, backslashes, control characters
 * and NUL. NUL matters because it truncates a key in some clients, so
 * `a/b%00.png` and `a/b` can be the same object for one participant and
 * different objects for another.
 */
export function assertSafeObjectKey(objectKey: string): string {
  if (typeof objectKey !== 'string' || objectKey.length === 0 || objectKey.length > 1024) {
    throw new Error('object key must be a non-empty string of at most 1024 characters');
  }
  if (objectKey.startsWith('/') || objectKey.includes('\\')) {
    throw new Error('object key must be relative and must not contain backslashes');
  }
  if (/[\u0000-\u001f\u007f]/.test(objectKey)) {
    throw new Error('object key must not contain control characters');
  }
  if (
    objectKey.split('/').some((segment) => segment === '..' || segment === '.' || segment === '')
  ) {
    throw new Error('object key must not contain empty or traversal segments');
  }
  return objectKey;
}

function assertSafePrefix(prefix: string): string {
  if (!prefix || prefix.startsWith('/') || prefix.endsWith('/')) {
    throw new Error('object key prefix must be a non-empty relative path');
  }
  return assertSafeObjectKey(prefix);
}

/** Build a key inside a prefix. The final segment is always server-generated. */
export function buildObjectKey(prefix: string): string {
  return assertSafeObjectKey(`${assertSafePrefix(prefix)}/${randomUUID()}`);
}

/** The namespace an upload authorized for [conversationId] may write into. */
export function conversationPrefix(conversationId: string): string {
  return `${CONVERSATION_PREFIX}/${conversationId}`;
}

/**
 * Whether [objectKey] names an object inside [conversationId]'s namespace.
 *
 * Exact structural match, not `startsWith`. A prefix test accepts
 * `conversations/<idA><idB>/x` for conversation `<idA>` whenever one id is a
 * prefix of another, and accepts `conversations/<id>/a/../../<other>/x` unless
 * something else rejected the traversal first. Splitting into segments and
 * requiring exactly three — `conversations`, the id, one object segment —
 * makes both unrepresentable rather than filtered.
 *
 * [conversationId] must come from the database, never from the request.
 */
export function objectKeyBelongsToConversation(
  conversationId: string,
  objectKey: string,
): boolean {
  if (!conversationId) return false;

  try {
    assertSafeObjectKey(objectKey);
  } catch {
    return false;
  }

  const segments = objectKey.split('/');
  return (
    segments.length === 3 &&
    segments[0] === CONVERSATION_PREFIX &&
    segments[1] === conversationId
  );
}

/**
 * Refuse a key that does not belong to [conversationId].
 *
 * `ATTACHMENT_NOT_IN_CONVERSATION` is a policy refusal, 403, and terminal: a
 * client that retries with the same key will be refused again. The message
 * deliberately does not echo the key back — the caller supplied it, and
 * repeating a foreign key in an error is a small oracle.
 */
export function assertObjectKeyBelongsToConversation(
  conversationId: string,
  objectKey: string,
): void {
  if (!objectKeyBelongsToConversation(conversationId, objectKey)) {
    throw new CommError(
      CommErrorCode.ATTACHMENT_NOT_IN_CONVERSATION,
      'this attachment does not belong to this conversation',
      403,
    );
  }
}

// ---------------------------------------------------------------- avatars

/**
 * The namespace an upload authorized for a contact of [familyId] may write into.
 *
 * Keyed on the FAMILY and not the contact, because a family's photos have two kinds of
 * subject -- the parents themselves and their children -- and either co-parent may set
 * either. A contact-keyed namespace would make a photo uploaded by one parent unusable by
 * the other for the same child, which is not the permission model.
 */
export function avatarPrefix(familyId: string): string {
  return `${AVATAR_PREFIX}/${familyId}`;
}

/**
 * Whether [objectKey] names an object inside [familyId]'s photo namespace.
 *
 * ## Why this has to exist
 *
 * The invariant at the top of this file -- knowing a key must never be enough to read an
 * object -- held for attachments, which are checked against the conversation the server
 * stored, and did NOT hold for profile photos. An avatar key was validated for SHAPE only:
 * `avatars/<something safe>`. That refused traversal and every other prefix, so a parent
 * could not aim their row at story media or somebody's attachment -- but WITHIN `avatars/`
 * any key was accepted. A parent who had somehow seen another family's key could set it as
 * their own photo and have this API sign reads of it for them indefinitely, turning a
 * five-minute disclosure of one URL into a permanent one. The closure QA demonstrated it
 * end to end before this function existed.
 *
 * Exact structural match for the same reasons the conversation check gives: exactly three
 * segments, so neither a `startsWith` collision between two ids nor a traversal that
 * re-enters another namespace is representable.
 *
 * [familyId] must come from the database -- resolved from the caller's token -- never from
 * the request.
 */
export function objectKeyBelongsToFamily(familyId: string, objectKey: string): boolean {
  if (!familyId) return false;

  try {
    assertSafeObjectKey(objectKey);
  } catch {
    return false;
  }

  const segments = objectKey.split('/');
  return (
    segments.length === 3 && segments[0] === AVATAR_PREFIX && segments[1] === familyId
  );
}
