/**
 * The parent's own profile, and the photos they may manage.
 *
 * The feature is small; the boundary is not. A parent can change a photo, and the whole
 * question is WHOSE. So the negative half of this file is the point: a second family
 * exists throughout, and every mutation is attempted across it.
 *
 * The property being proven is not "the UI hides the other family's children" — it is that
 * the server cannot be made to touch them, by any id the client is able to send.
 */
import { randomUUID } from 'node:crypto';
import { buildGraph, seed, truncate, withAssignmentGate, type Scenario } from './harness';
import { CommErrorCode } from '@platform/errors';

const g = buildGraph();
const { prisma, profile } = g;

let s: Scenario;

/** A completely separate family: its own contact, its own learner. */
let otherFamilyId: string;
let otherParentOfOtherFamily: string;
let otherFamilyLearnerId: string;

const KEY = 'avatars/parent-photo-1.jpg';
const OTHER_KEY = 'avatars/parent-photo-2.jpg';

beforeAll(async () => {
  await truncate(prisma);
  s = await seed(prisma);

  otherFamilyId = randomUUID();
  otherParentOfOtherFamily = randomUUID();
  otherFamilyLearnerId = randomUUID();

  await prisma.$executeRawUnsafe(
    `insert into chat.family (id, display_name, owner_id, language)
     values ('${otherFamilyId}'::uuid, 'family_other', '${s.otherAdminId}'::uuid, 'ar')`,
  );
  await prisma.$executeRawUnsafe(
    `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active)
     values ('${otherParentOfOtherFamily}'::uuid, '${otherFamilyId}'::uuid, 'parent_other',
             'primary_guardian', true, true)`,
  );
  await withAssignmentGate(
    prisma,
    `insert into chat.learner (id, family_id, name)
     values ('${otherFamilyLearnerId}'::uuid, '${otherFamilyId}'::uuid, 'learner_other')`,
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Photos only: the rest of the graph is seeded once and must stay stable.
  await prisma.$executeRawUnsafe(`update chat.contact set avatar_object_key = null`);
  await prisma.$executeRawUnsafe(`update chat.learner set avatar_object_key = null`);
});

// ---------------------------------------------------------------------------
describe('reading your own profile', () => {
  it('returns the caller, and the children of their family', async () => {
    const me = await profile.me(s.parentId);

    expect(me.displayName).toBe('parent_p');
    expect(me.children.map((c) => c.displayName)).toContain('learner_l');
    // Never anybody else's child.
    expect(me.children.map((c) => c.id)).not.toContain(otherFamilyLearnerId);
  });

  it('exposes no contact file, because there is none to expose', async () => {
    const me = await profile.me(s.parentId);

    // `chat.contact` has no phone or email column and the DTO must not grow one by
    // accident. A profile that cannot carry a phone number cannot leak one.
    expect(me).not.toHaveProperty('phone');
    expect(me).not.toHaveProperty('phoneNumber');
    expect(me).not.toHaveProperty('email');
    expect(JSON.stringify(me)).not.toMatch(/phone|msisdn/i);
  });

  it('exposes no internal identifiers beyond the children it must address', async () => {
    const me = await profile.me(s.parentId);

    expect(me).not.toHaveProperty('familyId');
    expect(me).not.toHaveProperty('accountId');
    expect(me).not.toHaveProperty('id');
    expect(me).not.toHaveProperty('avatarObjectKey');
    // The signed URL is a capability with a lifetime, not a storage path.
    expect(JSON.stringify(me)).not.toMatch(/avatarObjectKey/);
  });

  it('an unknown actor is refused', async () => {
    await expect(profile.me(randomUUID())).rejects.toMatchObject({
      code: CommErrorCode.UNKNOWN_ACTOR,
    });
  });

  it('a teacher has no parent profile', async () => {
    await expect(profile.me(s.teacherId)).rejects.toMatchObject({
      code: CommErrorCode.PROFILE_NOT_AVAILABLE,
    });
  });

  it('an admin has no parent profile either', async () => {
    await expect(profile.me(s.ownerId)).rejects.toMatchObject({
      code: CommErrorCode.PROFILE_NOT_AVAILABLE,
    });
  });
});

// ---------------------------------------------------------------------------
describe('your own photo', () => {
  it('set, replace, then remove', async () => {
    const set = await profile.setAvatar(s.parentId, KEY);
    expect(set.avatarUrl).toBeTruthy();

    const replaced = await profile.setAvatar(s.parentId, OTHER_KEY);
    expect(replaced.avatarUrl).toBeTruthy();
    expect(
      (await prisma.contact.findUniqueOrThrow({ where: { id: s.parentId } })).avatarObjectKey,
    ).toBe(OTHER_KEY);

    const removed = await profile.removeAvatar(s.parentId);
    expect(removed.avatarUrl).toBeNull();
    expect(
      (await prisma.contact.findUniqueOrThrow({ where: { id: s.parentId } })).avatarObjectKey,
    ).toBeNull();
  });

  it('removing when there is no photo is a no-op, not an error', async () => {
    await expect(profile.removeAvatar(s.parentId)).resolves.toMatchObject({ avatarUrl: null });
  });

  it('changing MY photo changes nobody else`s', async () => {
    await profile.setAvatar(s.parentId, KEY);

    const other = await prisma.contact.findUniqueOrThrow({
      where: { id: otherParentOfOtherFamily },
    });
    expect(other.avatarObjectKey).toBeNull();
  });

  it('the stored value is an object KEY, never a URL', async () => {
    await profile.setAvatar(s.parentId, KEY);
    const row = await prisma.contact.findUniqueOrThrow({ where: { id: s.parentId } });

    expect(row.avatarObjectKey).toBe(KEY);
    expect(row.avatarObjectKey).not.toMatch(/^https?:/);
  });
});

// ---------------------------------------------------------------------------
describe('upload authorization is a server-side control', () => {
  it('authorizes a real image', async () => {
    const auth = await profile.authorizeAvatarUpload(s.parentId, {
      mimeType: 'image/jpeg',
      byteSize: 120_000,
    });
    expect(auth.objectKey).toMatch(/^avatars\//);
    expect(auth.uploadUrl).toBeTruthy();
  });

  for (const mimeType of [
    'application/pdf',
    'text/html',
    'image/svg+xml', // scriptable
    'video/mp4',
    '',
  ]) {
    it(`refuses ${mimeType || '(empty)'}`, async () => {
      await expect(
        profile.authorizeAvatarUpload(s.parentId, { mimeType, byteSize: 1000 }),
      ).rejects.toMatchObject({ code: CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED });
    });
  }

  for (const byteSize of [0, -1, Number.NaN, 9 * 1024 * 1024]) {
    it(`refuses a byte size of ${byteSize}`, async () => {
      await expect(
        profile.authorizeAvatarUpload(s.parentId, { mimeType: 'image/jpeg', byteSize }),
      ).rejects.toMatchObject({ code: CommErrorCode.ATTACHMENT_TOO_LARGE });
    });
  }

  it("a teacher's own upload grant cannot move a PARENT's photo", async () => {
    // CONTRACT CHANGE, deliberately recorded here rather than deleted. A teacher may now
    // hold an upload grant, because teachers have their own profile photo
    // (`20261005160000_chat_staff_teacher_avatars.sql`). What must stay impossible is using
    // it against somebody else's row -- and that is now a STRONGER guarantee than the
    // refusal this test used to assert, because it is structural: the grant names no actor,
    // and `setAvatar` writes only the row the bearer token resolves to.
    const auth = await profile.authorizeAvatarUpload(s.teacherId, {
      mimeType: 'image/jpeg',
      byteSize: 1000,
    });
    expect(auth.objectKey).toMatch(/^avatars\//);

    const before = (
      await prisma.contact.findUniqueOrThrow({ where: { id: s.parentId } })
    ).avatarObjectKey;

    // The teacher commits the key. There is no parameter through which they could name the
    // parent, so the write lands on their own teacher row.
    await profile.setAvatar(s.teacherId, auth.objectKey);

    expect(
      (await prisma.contact.findUniqueOrThrow({ where: { id: s.parentId } })).avatarObjectKey,
    ).toBe(before);
    expect(
      (await prisma.teacher.findUniqueOrThrow({ where: { id: s.teacherId } })).avatarObjectKey,
    ).toBe(auth.objectKey);
  });

  it('a staff member may hold a grant too, and it lands on their own row', async () => {
    const auth = await profile.authorizeAvatarUpload(s.ownerId, {
      mimeType: 'image/png',
      byteSize: 2000,
    });
    await profile.setAvatar(s.ownerId, auth.objectKey);

    expect(
      (await prisma.staff.findUniqueOrThrow({ where: { id: s.ownerId } })).avatarObjectKey,
    ).toBe(auth.objectKey);
  });

  it('a key from outside the avatar prefix is refused', async () => {
    // Without this, a caller could point their row at somebody else's story media and
    // have the server sign it for them on the next read.
    for (const key of [
      'stories/someone-elses-media.jpg',
      'avatars/../stories/x.jpg',
      '/etc/passwd',
      'avatars/',
      '',
      'https://evil.example/x.jpg',
    ]) {
      await expect(profile.setAvatar(s.parentId, key)).rejects.toMatchObject({
        code: CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED,
      });
    }
    expect(
      (await prisma.contact.findUniqueOrThrow({ where: { id: s.parentId } })).avatarObjectKey,
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("a child's photo: only your own child", () => {
  it('an authorized parent can set, replace and remove it', async () => {
    const set = await profile.setChildAvatar(s.parentId, s.learnerId, KEY);
    expect(set.children.find((c) => c.id === s.learnerId)!.avatarUrl).toBeTruthy();

    await profile.setChildAvatar(s.parentId, s.learnerId, OTHER_KEY);
    expect(
      (await prisma.learner.findUniqueOrThrow({ where: { id: s.learnerId } })).avatarObjectKey,
    ).toBe(OTHER_KEY);

    const removed = await profile.removeChildAvatar(s.parentId, s.learnerId);
    expect(removed.children.find((c) => c.id === s.learnerId)!.avatarUrl).toBeNull();
  });

  it('a second contact in the SAME family may also manage the child', async () => {
    // Both are authorized contacts of that family; the boundary is the family, not a
    // single named guardian.
    await expect(
      profile.setChildAvatar(s.otherParentId, s.learnerId, KEY),
    ).resolves.toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // IDOR
  // -------------------------------------------------------------------------
  it("IDOR: a parent cannot set another family's child photo", async () => {
    await expect(
      profile.setChildAvatar(s.parentId, otherFamilyLearnerId, KEY),
    ).rejects.toMatchObject({ code: CommErrorCode.LEARNER_NOT_FOUND });

    expect(
      (await prisma.learner.findUniqueOrThrow({ where: { id: otherFamilyLearnerId } }))
        .avatarObjectKey,
    ).toBeNull();
  });

  it("IDOR: a parent cannot remove another family's child photo", async () => {
    await prisma.learner.update({
      where: { id: otherFamilyLearnerId },
      data: { avatarObjectKey: KEY },
    });

    await expect(
      profile.removeChildAvatar(s.parentId, otherFamilyLearnerId),
    ).rejects.toMatchObject({ code: CommErrorCode.LEARNER_NOT_FOUND });

    // Still there. The refusal is not cosmetic.
    expect(
      (await prisma.learner.findUniqueOrThrow({ where: { id: otherFamilyLearnerId } }))
        .avatarObjectKey,
    ).toBe(KEY);
  });

  it("IDOR: the other family's parent cannot touch THIS family's child", async () => {
    await expect(
      profile.setChildAvatar(otherParentOfOtherFamily, s.learnerId, KEY),
    ).rejects.toMatchObject({ code: CommErrorCode.LEARNER_NOT_FOUND });
  });

  it('a foreign child and a nonexistent child answer identically — no existence oracle', async () => {
    const foreign = await profile
      .setChildAvatar(s.parentId, otherFamilyLearnerId, KEY)
      .catch((e) => e);
    const absent = await profile.setChildAvatar(s.parentId, randomUUID(), KEY).catch((e) => e);

    expect(foreign.code).toBe(absent.code);
    expect(foreign.status).toBe(absent.status);
    expect(foreign.status).toBe(404);
  });

  it('a malformed learner id fails closed rather than throwing', async () => {
    for (const bad of ['', 'not-a-uuid', "' or 1=1 --", '../../etc/passwd']) {
      await expect(profile.setChildAvatar(s.parentId, bad, KEY)).rejects.toMatchObject({
        code: CommErrorCode.LEARNER_NOT_FOUND,
      });
    }
  });

  it('an inactive contact may manage nothing', async () => {
    await prisma.$executeRawUnsafe(
      `update chat.contact set is_active = false where id = '${s.parentId}'::uuid`,
    );
    try {
      await expect(profile.setChildAvatar(s.parentId, s.learnerId, KEY)).rejects.toBeDefined();
      await expect(profile.me(s.parentId)).rejects.toBeDefined();
    } finally {
      await prisma.$executeRawUnsafe(
        `update chat.contact set is_active = true where id = '${s.parentId}'::uuid`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
describe('nothing but the photo is reachable from here', () => {
  it('the academic record is untouched by a photo change', async () => {
    const before = await prisma.learner.findUniqueOrThrow({ where: { id: s.learnerId } });
    await profile.setChildAvatar(s.parentId, s.learnerId, KEY);
    const after = await prisma.learner.findUniqueOrThrow({ where: { id: s.learnerId } });

    // Everything the academy owns must be byte-identical: a parent may not reassign a
    // teacher, change a level, or move a schedule by uploading a picture.
    expect(after.teacherId).toBe(before.teacherId);
    expect(after.level).toBe(before.level);
    expect(after.name).toBe(before.name);
    expect(after.familyId).toBe(before.familyId);
    expect(after.nextClassAt).toEqual(before.nextClassAt);
    expect(after.organizationId).toBe(before.organizationId);
  });

  it("the contact's permission flags are untouched by a photo change", async () => {
    const before = await prisma.contact.findUniqueOrThrow({ where: { id: s.parentId } });
    await profile.setAvatar(s.parentId, KEY);
    const after = await prisma.contact.findUniqueOrThrow({ where: { id: s.parentId } });

    expect(after.canMessage).toBe(before.canMessage);
    expect(after.canManageBilling).toBe(before.canManageBilling);
    expect(after.canCancel).toBe(before.canCancel);
    expect(after.rolePreset).toBe(before.rolePreset);
    expect(after.familyId).toBe(before.familyId);
    expect(after.name).toBe(before.name);
  });

  it('a parent cannot create a child through this surface', () => {
    // There is no such method, and that is the assertion: the surface area is the
    // guarantee. A parent creating an academic record is not a thing this feature does.
    expect((profile as unknown as Record<string, unknown>).createChild).toBeUndefined();
    expect((profile as unknown as Record<string, unknown>).addChild).toBeUndefined();
  });

  it('there is no method that writes the sign-in identity', async () => {
    const before = await prisma.account.findFirst({
      where: { contacts: { some: { id: s.parentId } } },
      select: { subject: true },
    });

    await profile.setAvatar(s.parentId, KEY);

    const after = await prisma.account.findFirst({
      where: { contacts: { some: { id: s.parentId } } },
      select: { subject: true },
    });
    expect(after?.subject).toBe(before?.subject);
    expect((profile as unknown as Record<string, unknown>).setEmail).toBeUndefined();
    expect((profile as unknown as Record<string, unknown>).updateProfile).toBeUndefined();
  });
});
