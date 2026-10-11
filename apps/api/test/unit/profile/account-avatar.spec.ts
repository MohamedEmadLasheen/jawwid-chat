import { ProfileService } from '@communication/profile/profile.service';
import { CommErrorCode } from '@platform/errors';
import { ActorKind } from '@communication/contracts/vocab';
import type { Actor } from '@platform/types';

/**
 * Account Avatar authorization, at the two decisions that matter.
 *
 * 1. WHOSE photo a route can touch. Every avatar route resolves the actor from the bearer
 *    token and takes no target, so "somebody else's photo" is not a request the API can
 *    express. These tests hold that by construction rather than by inspection.
 *
 * 2. WHICH KEY a caller may commit. A presigned read URL carries its object key in the
 *    path, and this feature deliberately shows other people's avatars — so a key lifted
 *    out of a URL must not be claimable as your own photo.
 *
 * A double rather than a database: both decisions are made in this service from the
 * resolved actor, so a real Postgres would add latency and truncation risk without adding
 * coverage. The authorization that DOES need a database — RLS, cross-family reads — is
 * integration territory.
 */

const ORG = '00000000-0000-0000-0000-0000000000aa';
const CONTACT_ID = '11111111-1111-1111-1111-111111111111';
const STAFF_ID = '22222222-2222-2222-2222-222222222222';
const FAMILY_ID = '33333333-3333-3333-3333-333333333333';

function contactActor(overrides: Partial<Actor> = {}): Actor {
  return {
    actorId: CONTACT_ID,
    kind: ActorKind.CONTACT,
    displayName: 'ولي أمر',
    locale: 'ar',
    isActive: true,
    familyId: FAMILY_ID,
    canMessage: true,
    organizationId: ORG,
    ...overrides,
  };
}

/** Answers the few reads the avatar paths make, and nothing else. */
function buildService(options: {
  actor?: Actor | null;
  avatarObjectKey?: string | null;
  signed?: string;
} = {}) {
  const actor = options.actor === undefined ? contactActor() : options.actor;
  const row = {
    id: CONTACT_ID,
    name: 'ولي أمر',
    familyId: FAMILY_ID,
    accountId: null,
    relationship: null,
    avatarObjectKey: options.avatarObjectKey ?? null,
  };

  const writes: { table: string; data: unknown }[] = [];

  const prisma = {
    contact: {
      findFirst: async () => row,
      update: async (args: { data: unknown }) => {
        writes.push({ table: 'contact', data: args.data });
        return row;
      },
    },
    staff: { findFirst: async () => null, update: async () => row },
    teacher: { findFirst: async () => null, update: async () => row },
    learner: { findFirst: async () => null, findMany: async () => [] },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    auditLog: { create: async () => ({}) },
  };

  const identity = { resolveActor: async () => actor };
  const storage = {
    signedReadUrl: async (objectKey: string) =>
      options.signed ?? `http://storage.test/${objectKey}?X-Amz-Signature=sig`,
    authorizeUpload: async (params: { prefix: string }) => ({
      objectKey: `${params.prefix}/44444444-4444-4444-4444-444444444444`,
      uploadUrl: 'http://storage.test/upload',
      uploadToken: null,
      expiresAt: new Date().toISOString(),
    }),
  };
  const audit = { audit: async () => {}, event: async () => {} };

  const service = new ProfileService(
    prisma as never,
    identity as never,
    storage as never,
    audit as never,
  );
  return { service, writes };
}

describe('GET /me/avatar/image resolves the caller, never a target (M1)', () => {
  it('redirects to a freshly signed url when the caller has a photo', async () => {
    const key = `avatars/contact/${CONTACT_ID}/p.jpg`;
    const { service } = buildService({ avatarObjectKey: key });

    const url = await service.myAvatarImageUrl(CONTACT_ID);

    expect(url).toContain('X-Amz-Signature');
    expect(url).toContain(key);
  });

  it('is a safe not-found when the caller has no photo', async () => {
    const { service } = buildService({ avatarObjectKey: null });

    await expect(service.myAvatarImageUrl(CONTACT_ID)).rejects.toMatchObject({
      code: CommErrorCode.AVATAR_NOT_FOUND,
      status: 404,
    });
  });

  it('refuses an actor that does not resolve -- no anonymous default', async () => {
    const { service } = buildService({ actor: null });

    await expect(service.myAvatarImageUrl(CONTACT_ID)).rejects.toMatchObject({
      code: CommErrorCode.UNKNOWN_ACTOR,
      status: 401,
    });
  });

  it('refuses a deactivated account', async () => {
    const { service } = buildService({
      actor: contactActor({ isActive: false }),
      avatarObjectKey: `avatars/contact/${CONTACT_ID}/p.jpg`,
    });

    await expect(service.myAvatarImageUrl(CONTACT_ID)).rejects.toMatchObject({
      code: CommErrorCode.ACTOR_INACTIVE,
      status: 403,
    });
  });
});

describe('an avatar key names its owner, so only its owner can claim it', () => {
  it('mints upload grants under the CALLER\'s own prefix', async () => {
    const { service } = buildService();

    const grant = await service.authorizeAvatarUpload(CONTACT_ID, {
      mimeType: 'image/jpeg',
      byteSize: 1024,
    });

    expect(grant.objectKey.startsWith(`avatars/contact/${CONTACT_ID}/`)).toBe(true);
  });

  it('accepts a key under the caller\'s own prefix', async () => {
    const { service, writes } = buildService();
    const mine = `avatars/contact/${CONTACT_ID}/p.jpg`;

    await service.setAvatar(CONTACT_ID, mine);

    expect(writes).toEqual([{ table: 'contact', data: { avatarObjectKey: mine } }]);
  });

  it('REFUSES another actor\'s key -- the impersonation this closes', async () => {
    // Exactly what a presigned URL leaks: its object key sits in the path, and this
    // feature shows other people's avatars on purpose. Claiming one would have let a
    // parent wear a teacher's face.
    const { service, writes } = buildService();
    const someoneElses = `avatars/staff/${STAFF_ID}/p.jpg`;

    await expect(service.setAvatar(CONTACT_ID, someoneElses)).rejects.toMatchObject({
      code: CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED,
      status: 400,
    });
    expect(writes).toEqual([]);
  });

  it('REFUSES a legacy flat key, which nobody was issued', async () => {
    const { service, writes } = buildService();

    await expect(
      service.setAvatar(CONTACT_ID, 'avatars/44444444-4444-4444-4444-444444444444'),
    ).rejects.toMatchObject({ code: CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED });
    expect(writes).toEqual([]);
  });

  it('REFUSES traversal and foreign prefixes', async () => {
    const { service } = buildService();
    for (const key of [
      `avatars/contact/${CONTACT_ID}/../../staff/${STAFF_ID}/p.jpg`,
      `attachments/${CONTACT_ID}/p.jpg`,
      `avatars/contact/${CONTACT_ID}`,
      '',
      'avatars/',
    ]) {
      await expect(service.setAvatar(CONTACT_ID, key)).rejects.toMatchObject({
        code: CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED,
      });
    }
  });

  it('still SERVES a legacy flat key that is already stored', async () => {
    // Reads are deliberately not subject to the claim check: keys written before the
    // prefix existed must keep resolving rather than breaking on upgrade.
    const legacy = 'avatars/55555555-5555-5555-5555-555555555555';
    const { service } = buildService({ avatarObjectKey: legacy });

    await expect(service.myAvatarImageUrl(CONTACT_ID)).resolves.toContain(legacy);
  });
});

describe('the upload grant still bounds type and size', () => {
  it('refuses a type that is not an image', async () => {
    const { service } = buildService();

    await expect(
      service.authorizeAvatarUpload(CONTACT_ID, {
        mimeType: 'application/pdf',
        byteSize: 1024,
      }),
    ).rejects.toMatchObject({ code: CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED });
  });

  it('refuses something larger than the cap', async () => {
    const { service } = buildService();

    await expect(
      service.authorizeAvatarUpload(CONTACT_ID, {
        mimeType: 'image/jpeg',
        byteSize: 9 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({ code: CommErrorCode.ATTACHMENT_TOO_LARGE });
  });
});
