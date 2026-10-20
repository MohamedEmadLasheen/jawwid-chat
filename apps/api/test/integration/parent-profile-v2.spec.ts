/**
 * Parent Profile V2: the parent's own name, About and photo, and each child's.
 *
 * ## What is actually worth testing here
 *
 * Not "a save works". The three ways this feature can be dangerous:
 *
 *  1. **Cross-parent and cross-family writes.** No route takes an owner id, so the test is
 *     not "is the check present" but "acting as A, did B's row move". Those assertions are
 *     stronger than a refusal: they prove the request cannot be expressed.
 *  2. **A second source of truth for names.** The whole point of the data model is that
 *     `chat.contact.name` and `chat.learner.name` stay authoritative, so these pin that a
 *     rename lands THERE and that the profile tables never acquire a name column.
 *  3. **An object key reaching a client, or being signed on somebody's behalf.** A key is a
 *     name; signing is the access decision.
 *
 * The database's RLS is the ORGANIZATION boundary only -- every policy in this schema is
 * written for staff under an actor context the runtime does not set. Parent isolation is an
 * application property, which is precisely why it is tested here against the real service
 * and the real database rather than asserted from a policy file.
 */
import { randomUUID } from 'node:crypto';
import { ParentProfileService } from '@communication/profile/parent-profile.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { PrismaIdentityService } from '@platform/identity.service';
import { PrismaAuditService } from '@platform/audit.service';
import { buildGraph, seed, truncate, withAssignmentGate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
const prisma = g.prisma;
let profile: ParentProfileService;
let s: Scenario;

/**
 * Well-formed keys in the only namespace the server will sign for a given family.
 *
 * The family id is PART of the key, because that is what makes a key one family's to use:
 * see `objectKeyBelongsToFamily`. A key is therefore written relative to a family rather
 * than as a constant -- a constant could only ever be right for one of them.
 */
/**
 * Give a contact or a learner an account photo the way `/me/avatar` leaves it: a key in the
 * shared avatar format on the identity row (the CHECK in 20261014130000 refuses any other).
 * That writer and its byte checks are AvatarService's, proved in profile-photos.spec.
 */
async function setAccountPhoto(kind: 'contact' | 'learner', id: string): Promise<string> {
  const key = `avatars/${kind}/${id}/${randomUUID()}`;
  if (kind === 'contact') await prisma.contact.update({ where: { id }, data: { avatarObjectKey: key } });
  else await prisma.learner.update({ where: { id }, data: { avatarObjectKey: key } });
  return key;
}

/** A whole second family, so cross-family denial is tested against real rows. */
interface OtherFamily {
  ownerId: string;
  familyId: string;
  parentId: string;
  teacherId: string;
  learnerId: string;
}

async function seedOtherFamily(): Promise<OtherFamily> {
  const ids: OtherFamily = {
    ownerId: randomUUID(),
    familyId: randomUUID(),
    parentId: randomUUID(),
    teacherId: randomUUID(),
    learnerId: randomUUID(),
  };
  await prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active)
     values ('${ids.ownerId}'::uuid, 'admin_z', 'admin', true)`,
  );
  await prisma.$executeRawUnsafe(
    `insert into chat.teacher (id, name, is_active)
     values ('${ids.teacherId}'::uuid, 'teacher_z', true)`,
  );
  await prisma.$executeRawUnsafe(
    `insert into chat.family (id, display_name, owner_id, language)
     values ('${ids.familyId}'::uuid, 'family_z', '${ids.ownerId}'::uuid, 'ar')`,
  );
  await prisma.$executeRawUnsafe(
    `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active)
     values ('${ids.parentId}'::uuid, '${ids.familyId}'::uuid, 'parent_z', 'primary_guardian', true, true)`,
  );
  await withAssignmentGate(
    prisma,
    `insert into chat.learner (id, family_id, name, teacher_id)
     values ('${ids.learnerId}'::uuid, '${ids.familyId}'::uuid, 'learner_z', '${ids.teacherId}'::uuid)`,
  );
  return ids;
}

const contactName = (id: string) =>
  prisma.contact.findUniqueOrThrow({ where: { id } }).then((r) => r.name);
const learnerName = (id: string) =>
  prisma.learner.findUniqueOrThrow({ where: { id } }).then((r) => r.name);
const contactProfile = (id: string) =>
  prisma.contactProfile.findUnique({ where: { contactId: id } });
const learnerProfile = (id: string) =>
  prisma.learnerProfile.findUnique({ where: { learnerId: id } });

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(prisma);
  s = await seed(prisma);
  g.coverage.onDutyId = s.ownerId;
  profile = new ParentProfileService(prisma, new PrismaIdentityService(prisma), new PrismaAuditService());
});

// ---------------------------------------------------------------------------
describe('reading your own profile', () => {
  it('returns the parent, their sign-in identity, and their family\'s children', async () => {
    const me = await profile.me(s.parentId);

    expect(me.displayName).toBe('parent_p');
    expect(me.about).toBeNull();
    expect(me.avatarUrl).toBeNull();
    // Both learners of the seeded family, named from chat.learner.
    expect(me.children.map((c) => c.displayName).sort()).toEqual(['learner_l', 'learner_m']);
    for (const child of me.children) {
      expect(child.about).toBeNull();
      expect(child.avatarUrl).toBeNull();
    }
  });

  it('shows no other family\'s children', async () => {
    const other = await seedOtherFamily();
    const me = await profile.me(s.parentId);

    expect(me.children.map((c) => c.id)).not.toContain(other.learnerId);
  });

  it('a teacher and an admin have no parent profile', async () => {
    for (const actor of [s.teacherId, s.ownerId]) {
      await expect(profile.me(actor)).rejects.toMatchObject({
        code: CommErrorCode.PROFILE_NOT_AVAILABLE,
      });
    }
  });

  it('an unknown actor is refused', async () => {
    await expect(profile.me(randomUUID())).rejects.toMatchObject({
      code: CommErrorCode.UNKNOWN_ACTOR,
    });
  });

  it('never exposes an object key, at any depth', async () => {
    const mine = await setAccountPhoto('contact', s.parentId);
    const child = await setAccountPhoto('learner', s.learnerId);

    const json = JSON.stringify(await profile.me(s.parentId));
    expect(json).not.toMatch(/avatarObjectKey/);
    expect(json).not.toContain(mine);
    expect(json).not.toContain(child);
    expect(json).not.toMatch(/"avatars\//);
  });

  it('the photos are the account photos, as the self links GET /me/photo hands out', async () => {
    await setAccountPhoto('contact', s.parentId);
    await setAccountPhoto('learner', s.learnerId);

    const view = await profile.me(s.parentId);
    const own = new URL(view.avatarUrl!, 'http://api.test');
    expect(own.pathname).toMatch(new RegExp(`/media/avatars/contact\\.${s.parentId}\\.self$`));
    expect(own.searchParams.get('a')).toBe(s.parentId);
    const kid = new URL(view.children.find((c) => c.id === s.learnerId)!.avatarUrl!, 'http://api.test');
    expect(kid.pathname).toMatch(new RegExp(`/media/avatars/learner\\.${s.learnerId}\\.self$`));
    expect(kid.searchParams.get('a')).toBe(s.parentId);
  });

  it('this service has no photo writer of its own', () => {
    const service = profile as unknown as Record<string, unknown>;
    for (const name of ['authorizeAvatarUpload', 'setAvatar', 'removeAvatar', 'setChildAvatar', 'removeChildAvatar']) {
      expect(service[name]).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
describe('the parent\'s own name and About', () => {
  it('a rename lands in chat.contact.name, and nowhere else', async () => {
    const after = await profile.updateMe(s.parentId, { name: 'أم أحمد' });

    expect(after.displayName).toBe('أم أحمد');
    expect(await contactName(s.parentId)).toBe('أم أحمد');
    // THE POINT OF THE DATA MODEL: the profile table has no name to drift.
    const row = await contactProfile(s.parentId);
    expect(row === null || !('name' in row)).toBe(true);
  });

  it('saves an About, and clears it with null', async () => {
    await profile.updateMe(s.parentId, { about: '  أم لطفلين، أحب القراءة.  ' });
    expect((await contactProfile(s.parentId))?.about).toBe('أم لطفلين، أحب القراءة.');

    const cleared = await profile.updateMe(s.parentId, { about: null });
    expect(cleared.about).toBeNull();
    expect((await contactProfile(s.parentId))?.about).toBeNull();
  });

  it('saves name and About together, in one call', async () => {
    const after = await profile.updateMe(s.parentId, { name: 'Sara', about: 'Hello' });
    expect(after.displayName).toBe('Sara');
    expect(after.about).toBe('Hello');
  });

  it('an omitted field is LEFT ALONE, not cleared', async () => {
    await profile.updateMe(s.parentId, { name: 'Sara', about: 'Keep me' });

    // Saving only the name must not wipe the About, or a one-field save becomes destructive.
    await profile.updateMe(s.parentId, { name: 'Sara Ali' });
    expect((await contactProfile(s.parentId))?.about).toBe('Keep me');

    await profile.updateMe(s.parentId, { about: 'New' });
    expect(await contactName(s.parentId)).toBe('Sara Ali');
  });

  it('refuses a blank, whitespace or absurd name, and does not write', async () => {
    for (const name of ['', '   ', '\n\t', 'x'.repeat(121)]) {
      await expect(profile.updateMe(s.parentId, { name })).rejects.toMatchObject({
        code: CommErrorCode.PROFILE_FIELD_INVALID,
      });
    }
    expect(await contactName(s.parentId)).toBe('parent_p');
  });

  it('collapses inner whitespace rather than storing it', async () => {
    await profile.updateMe(s.parentId, { name: '  Sara    Ali  ' });
    expect(await contactName(s.parentId)).toBe('Sara Ali');
  });

  it('refuses an over-long About, and does not write', async () => {
    await expect(
      profile.updateMe(s.parentId, { about: 'x'.repeat(1001) }),
    ).rejects.toMatchObject({ code: CommErrorCode.PROFILE_FIELD_INVALID });
    expect(await contactProfile(s.parentId)).toBeNull();
  });

  it('accepts an About exactly at the limit', async () => {
    await profile.updateMe(s.parentId, { about: 'x'.repeat(1000) });
    expect((await contactProfile(s.parentId))?.about?.length).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
describe('a child\'s name and About', () => {
  it('a rename lands in chat.learner.name', async () => {
    const after = await profile.updateChild(s.parentId, s.learnerId, { name: 'يوسف' });

    expect(await learnerName(s.learnerId)).toBe('يوسف');
    expect(after.children.find((c) => c.id === s.learnerId)?.displayName).toBe('يوسف');
  });

  it('saves a child About independently of the parent\'s', async () => {
    await profile.updateMe(s.parentId, { about: 'parent about' });
    await profile.updateChild(s.parentId, s.learnerId, { about: 'child about' });

    expect((await contactProfile(s.parentId))?.about).toBe('parent about');
    expect((await learnerProfile(s.learnerId))?.about).toBe('child about');
  });

  it('editing one child does not touch a sibling', async () => {
    const me = await profile.me(s.parentId);
    const [first, second] = me.children;

    await profile.updateChild(s.parentId, first.id, { name: 'Renamed', about: 'Mine' });

    expect(await learnerName(second.id)).toBe(second.displayName);
    expect(await learnerProfile(second.id)).toBeNull();
  });

  it('refuses an invalid child name, and does not write', async () => {
    await expect(
      profile.updateChild(s.parentId, s.learnerId, { name: '  ' }),
    ).rejects.toMatchObject({ code: CommErrorCode.PROFILE_FIELD_INVALID });
    expect(await learnerName(s.learnerId)).toBe('learner_l');
  });
});

// ---------------------------------------------------------------------------
/**
 * No route takes an owner id, so each of these acts as one principal and proves another's
 * row did not move. That is the whole boundary.
 */
describe('nobody can reach anybody else\'s profile', () => {
  it('a parent cannot rename another family\'s child', async () => {
    const other = await seedOtherFamily();

    await expect(
      profile.updateChild(s.parentId, other.learnerId, { name: 'hijacked' }),
    ).rejects.toMatchObject({ code: CommErrorCode.LEARNER_NOT_IN_FAMILY });

    expect(await learnerName(other.learnerId)).toBe('learner_z');
  });

  it('a parent cannot set another family\'s child About', async () => {
    const other = await seedOtherFamily();

    await expect(
      profile.updateChild(s.parentId, other.learnerId, { about: 'hijacked' }),
    ).rejects.toBeInstanceOf(CommError);

    expect(await learnerProfile(other.learnerId)).toBeNull();
  });

  it('the OTHER family\'s parent cannot touch ours either -- symmetry', async () => {
    const other = await seedOtherFamily();

    await expect(
      profile.updateChild(other.parentId, s.learnerId, { name: 'hijacked' }),
    ).rejects.toMatchObject({ code: CommErrorCode.LEARNER_NOT_IN_FAMILY });

    expect(await learnerName(s.learnerId)).toBe('learner_l');
  });

  it('renaming yourself leaves the OTHER parent of your own family alone', async () => {
    // Two contacts share a family here, which is the subtler case: same family, different
    // person. The write is keyed by the resolved actor, so the co-parent is untouched.
    await profile.updateMe(s.parentId, { name: 'Changed' });

    expect(await contactName(s.otherParentId)).toBe('parent_q');
    expect(await contactProfile(s.otherParentId)).toBeNull();
  });

  it('a co-parent of the SAME family may edit the shared child -- that is allowed', async () => {
    // Both guardians legitimately manage the same learner. Asserting this stops a future
    // tightening from breaking a real case while closing a cross-family one.
    await profile.updateChild(s.otherParentId, s.learnerId, { about: 'from the co-parent' });
    expect((await learnerProfile(s.learnerId))?.about).toBe('from the co-parent');
  });

  it('a nonexistent learner is refused the same way as somebody else\'s', async () => {
    // One code for both, so this is not an oracle for which ids exist.
    await expect(
      profile.updateChild(s.parentId, randomUUID(), { name: 'x' }),
    ).rejects.toMatchObject({ code: CommErrorCode.LEARNER_NOT_IN_FAMILY });
    await expect(
      profile.updateChild(s.parentId, 'not-a-uuid', { name: 'x' }),
    ).rejects.toMatchObject({ code: CommErrorCode.LEARNER_NOT_IN_FAMILY });
  });

  it('a teacher cannot use the parent routes at all', async () => {
    await expect(
      profile.updateChild(s.teacherId, s.learnerId, { name: 'teacher wrote this' }),
    ).rejects.toMatchObject({ code: CommErrorCode.PROFILE_NOT_AVAILABLE });
    await expect(profile.updateMe(s.teacherId, { about: 'x' })).rejects.toBeInstanceOf(
      CommError,
    );

    expect(await learnerName(s.learnerId)).toBe('learner_l');
  });

  it('an unknown actor writes nothing', async () => {
    await expect(
      profile.updateMe(randomUUID(), { name: 'ghost' }),
    ).rejects.toMatchObject({ code: CommErrorCode.UNKNOWN_ACTOR });
  });
});

// ---------------------------------------------------------------------------
describe('the audit trail', () => {
  const rows = (action: string) =>
    prisma.$queryRawUnsafe<Array<{ action: string; entity: string; after: unknown }>>(
      `select action, entity, after from chat.audit_log where action = '${action}' order by at desc`,
    );

  it('records a rename with the old and the new name', async () => {
    await profile.updateMe(s.parentId, { name: 'Renamed' });
    const [row] = await rows('profile.name.changed');

    expect(row?.entity).toBe('contact');
    expect(JSON.stringify(row?.after)).toContain('Renamed');
  });

  it('records a child rename against the learner', async () => {
    await profile.updateChild(s.parentId, s.learnerId, { name: 'Renamed' });
    const [row] = await rows('profile.child.name.changed');
    expect(row?.entity).toBe('learner');
  });

  it('records an About save by LENGTH, not by content', async () => {
    await profile.updateMe(s.parentId, { about: 'something private' });
    const [row] = await rows('profile.about.saved');

    expect(JSON.stringify(row?.after)).toContain('aboutLength');
    expect(JSON.stringify(row?.after)).not.toContain('something private');
  });

  it('writes nothing when a save changes nothing', async () => {
    await profile.updateMe(s.parentId, {});
    expect(await rows('profile.name.changed')).toHaveLength(0);
    expect(await rows('profile.about.saved')).toHaveLength(0);
  });

  it('writes no rename row when the name is submitted unchanged', async () => {
    await profile.updateMe(s.parentId, { name: 'parent_p' });
    expect(await rows('profile.name.changed')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('the name stays single-source-of-truth', () => {
  it('the profile tables have no name column at all', async () => {
    const cols = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `select column_name from information_schema.columns
        where table_schema = 'chat'
          and table_name in ('contact_profile','learner_profile')`,
    );
    const names = cols.map((c) => c.column_name);

    // Structural, not a convention: there is nowhere for a duplicate name to live.
    expect(names).not.toContain('name');
    expect(names).not.toContain('display_name');
    expect(names).toEqual(expect.arrayContaining(['about', 'organization_id']));
    // Nor a photo: that is the identity row's avatar_object_key, set through /me/avatar.
    expect(names).not.toContain('avatar_object_key');
  });

  it('a rename is visible to anything that reads the identity row', async () => {
    await profile.updateMe(s.parentId, { name: 'New Name' });
    await profile.updateChild(s.parentId, s.learnerId, { name: 'New Child' });

    // The directory is what names a message author and a group member, so this is the
    // propagation test: nothing caches a name, so nothing can be stale.
    const resolved = await g.identity.resolveActor(s.parentId);
    expect(resolved?.displayName).toBe('New Name');
    expect(await learnerName(s.learnerId)).toBe('New Child');
  });

  it("a profile row takes its subject's organization, whatever a writer sends", async () => {
    const elsewhere = randomUUID();
    await prisma.$executeRawUnsafe(
      `insert into chat.organization (id, slug, display_name) values ('${elsewhere}'::uuid, 'elsewhere-${elsewhere}', 'Elsewhere')`,
    );
    await prisma.contactProfile.create({
      data: { contactId: s.parentId, organizationId: elsewhere, about: 'x' },
    });
    await prisma.learnerProfile.create({
      data: { learnerId: s.learnerId, organizationId: elsewhere, about: 'y' },
    });
    const parent = await prisma.contact.findUniqueOrThrow({ where: { id: s.parentId } });
    const learner = await prisma.learner.findUniqueOrThrow({ where: { id: s.learnerId } });
    expect((await contactProfile(s.parentId))!.organizationId).toBe(parent.organizationId);
    expect((await learnerProfile(s.learnerId))!.organizationId).toBe(learner.organizationId);
  });
});
