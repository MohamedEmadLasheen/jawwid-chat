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
