import type { ObjectStorage } from '../attachments/object-storage';
import { actorRefKey, type ResolvedActors } from '../../platform/identity.service';

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
 * ## Why it lives in `communication` rather than beside the resolver
 *
 * `IdentityService` sits in `platform`, which never imports `communication`, and the
 * [ObjectStorage] seam is a communication provider. The resolver therefore answers what an
 * actor IS -- name, kind, avatar key -- and this layer answers what the caller may SEE.
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

/**
 * Sign a batch of avatar keys that are ALREADY keyed the way the reader will look them up.
 *
 * One signing implementation, two callers — resolved actors and conversation members —
 * because two implementations would eventually disagree about what "no photo" means.
 *
 * An entry exists ONLY for a key that signed successfully, so a caller reading
 * `.get(k) ?? null` gets null for "no photo" without telling it apart from "not resolved".
 *
 * Adds NO authorization and is not a place to put any: it signs what it is given, which is
 * why every call site sits behind a membership or family check.
 */
export async function signAvatarsByKey(
  storage: ObjectStorage,
  entries: Iterable<readonly [string, string | null | undefined]>,
): Promise<Map<string, string>> {
  const withPhotos = [...entries].filter(([, objectKey]) => objectKey);
  if (withPhotos.length === 0) return new Map();

  // In parallel: a group of thirty members must not cost thirty sequential signings.
  const signed = await Promise.all(
    withPhotos.map(([, objectKey]) => signAvatar(storage, objectKey ?? null)),
  );

  const urls = new Map<string, string>();
  withPhotos.forEach(([key], index) => {
    const url = signed[index];
    if (url) urls.set(key, url);
  });
  return urls;
}

/**
 * Sign the photos of already-resolved actors, keyed by the SAME `actorRefKey` the resolver
 * keys its own map on — so no caller invents a second spelling.
 *
 * That matters more than it looks: `chat.staff`, `chat.contact` and `chat.teacher` have
 * independently generated uuids, so an id alone names nobody. `STAFF:x` and `TEACHER:x` are
 * different actors, and a map keyed on the id alone would hand one person's face to another.
 */
export function signActorAvatars(
  storage: ObjectStorage,
  actors: ResolvedActors,
): Promise<Map<string, string>> {
  return signAvatarsByKey(
    storage,
    [...actors.entries()].map(([key, actor]) => [key, actor.avatarObjectKey] as const),
  );
}

/** The same, for the members of one conversation. */
export function signMemberAvatars(
  storage: ObjectStorage,
  members: readonly {
    actorId: string;
    actorKind: string;
    avatarObjectKey: string | null;
  }[],
): Promise<Map<string, string>> {
  return signAvatarsByKey(
    storage,
    members.map(
      (m) =>
        [actorRefKey({ actorId: m.actorId, actorKind: m.actorKind }), m.avatarObjectKey] as const,
    ),
  );
}
