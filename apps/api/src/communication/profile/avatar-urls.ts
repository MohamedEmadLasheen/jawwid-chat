import type { ObjectStorage } from '../attachments/object-storage';

/**
 * Turning a stored avatar key into something a client may fetch.
 *
 * ## Why this is a function and not a field
 *
 * `chat.contact.avatar_object_key` is a NAME. Holding it reads nothing: the read is minted
 * here, per request, short-lived, by the party that has already decided the caller is
 * entitled to see this person. That decision is the access control -- the key is not -- so
 * signing has to happen at the point where the entitlement is known, and that is why a
 * signed URL is never stored, cached, or put in a column next to the key.
 *
 * ## Why it lives in `communication` rather than in the directory
 *
 * `PrismaDirectoryService` sits in `platform`, which never imports `communication`, and the
 * [ObjectStorage] seam is a communication provider. The directory therefore resolves what
 * an actor IS -- name, kind, avatar key -- and this layer resolves what the caller may SEE.
 *
 * ## One rule, one place
 *
 * `ProfileService` signs the parent's own photo through the same two functions. There is
 * deliberately no second TTL, no second bucket, and no second notion of what an avatar URL
 * is: a parent must not see a fresher photo of themselves in their own profile than their
 * teacher sees of them in Group Info.
 */

/**
 * How long a signed avatar read stays valid.
 *
 * Shared with attachments and stories via the same environment variable, because a photo
 * is not a special kind of object -- it is an object.
 */
export function avatarReadTtlSeconds(): number {
  const configured = Number(process.env.STORAGE_SIGNED_URL_TTL_SECONDS ?? 300);
  return Number.isFinite(configured) && configured > 0 ? configured : 300;
}

/** One key to one short-lived URL. Null in, null out: no photo is not an error. */
export function signAvatar(
  storage: ObjectStorage,
  objectKey: string | null,
): Promise<string | null> {
  if (!objectKey) return Promise.resolve(null);
  return storage.signedReadUrl(objectKey, avatarReadTtlSeconds());
}
