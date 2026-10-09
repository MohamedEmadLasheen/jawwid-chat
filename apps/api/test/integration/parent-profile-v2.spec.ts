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
import { SignedLocalObjectStorage } from '@communication/attachments/object-storage';
import { buildGraph, seed, truncate, withAssignmentGate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
const prisma = g.prisma;
let profile: ParentProfileService;
let s: Scenario;

/**
 * Well-formed keys in the only namespace the server will sign for a given SUBJECT.
 *
 * The subject is part of the key -- `avatars/<kind>/<id>/<leaf>` -- because that is what
 * makes a key one subject's to use: see `objectKeyBelongsToSubject`. A key is therefore
 * written relative to whose photo it is, and a parent's key is not valid for their child
 * or anybody else's.
 */
const keyFor = (
  kind: 'contacts' | 'learners',
  subjectId: string,
  leaf = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
) => `avatars/${kind}/${subjectId}/${leaf}`;

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
  profile = new ParentProfileService(
    prisma,
    new PrismaIdentityService(prisma),
    new SignedLocalObjectStorage(),
    new PrismaAuditService(),
  );
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
    await profile.setAvatar(s.parentId, keyFor('contacts', s.parentId));
    await profile.setChildAvatar(s.parentId, s.learnerId, keyFor('learners', s.learnerId, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));

    const json = JSON.stringify(await profile.me(s.parentId));
    expect(json).not.toMatch(/avatarObjectKey/);
    expect(json).not.toMatch(/"avatars\//);
    // What it DOES carry is a signed, expiring url.
    expect(json).toMatch(/sig=/);
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

  it('a parent cannot set another family\'s child photo or About', async () => {
    const other = await seedOtherFamily();

    await expect(
      profile.setChildAvatar(s.parentId, other.learnerId, keyFor('learners', other.learnerId)),
    ).rejects.toBeInstanceOf(CommError);
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
describe('photos', () => {
  it('set, replace and remove the parent\'s own', async () => {
    const set = await profile.setAvatar(s.parentId, keyFor('contacts', s.parentId));
    expect(set.avatarUrl).toMatch(/^https?:\/\//);
    expect((await contactProfile(s.parentId))?.avatarObjectKey).toBe(keyFor('contacts', s.parentId));

    await profile.setAvatar(s.parentId, keyFor('contacts', s.parentId, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));
    expect((await contactProfile(s.parentId))?.avatarObjectKey).toBe(keyFor('contacts', s.parentId, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));

    const removed = await profile.removeAvatar(s.parentId);
    expect(removed.avatarUrl).toBeNull();
    expect((await contactProfile(s.parentId))?.avatarObjectKey).toBeNull();
  });

  it('set, replace and remove a child\'s', async () => {
    await profile.setChildAvatar(s.parentId, s.learnerId, keyFor('learners', s.learnerId));
    expect((await learnerProfile(s.learnerId))?.avatarObjectKey).toBe(keyFor('learners', s.learnerId));

    await profile.removeChildAvatar(s.parentId, s.learnerId);
    expect((await learnerProfile(s.learnerId))?.avatarObjectKey).toBeNull();
  });

  it('removing when there is no photo is a no-op, not an error', async () => {
    await expect(profile.removeAvatar(s.parentId)).resolves.toMatchObject({ avatarUrl: null });
    await expect(
      profile.removeChildAvatar(s.parentId, s.learnerId),
    ).resolves.toBeDefined();
  });

  it('the read is a SIGNED, expiring url -- never the key', async () => {
    await profile.setAvatar(s.parentId, keyFor('contacts', s.parentId));
    const url = (await profile.me(s.parentId)).avatarUrl!;

    expect(url).toMatch(/sig=/);
    expect(url).toMatch(/expires=/);
    expect(url).not.toBe(keyFor('contacts', s.parentId));
  });

  it('removal leaves the stored object alone -- retention is a separate concern', async () => {
    await profile.setAvatar(s.parentId, keyFor('contacts', s.parentId));
    await profile.removeAvatar(s.parentId);
    // Nulling the key is what makes it unreachable; the bytes are not this service's to
    // reclaim, and deleting them here would make a mis-click irreversible.
    expect((await contactProfile(s.parentId))?.avatarObjectKey).toBeNull();
  });

  describe('the upload grant is a server-side control', () => {
    it('authorizes a real image', async () => {
      const auth = await profile.authorizeAvatarUpload(s.parentId, {
        mimeType: 'image/jpeg',
        byteSize: 120_000,
      });
      expect(auth.objectKey).toMatch(/^avatars\//);
      expect(auth.uploadUrl).toBeTruthy();
    });

    for (const mimeType of ['application/pdf', 'text/html', 'image/svg+xml', 'video/mp4', '', 'image/gif']) {
      it(`refuses ${mimeType || '(empty)'}`, async () => {
        // image/svg+xml is scriptable; gif is simply not in the allowed set.
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

    it('a teacher mints a grant for their OWN photo, in their own namespace', async () => {
      // This used to be a refusal, and the change is deliberate: every kind of account has
      // a face. What a teacher still cannot do is reach a PARENT profile or a learner --
      // asserted immediately below, because "they can now do something" is only safe
      // alongside "and still cannot do these".
      const grant = await profile.authorizeAvatarUpload(s.teacherId, {
        mimeType: 'image/jpeg',
        byteSize: 1000,
      });

      expect(grant.objectKey.startsWith(`avatars/teachers/${s.teacherId}/`)).toBe(true);
    });

    it('a teacher still has no parent profile and no reach into a family', async () => {
      await expect(profile.me(s.teacherId)).rejects.toMatchObject({
        code: CommErrorCode.PROFILE_NOT_AVAILABLE,
      });
      await expect(
        profile.updateMe(s.teacherId, { name: 'Taken Over' }),
      ).rejects.toMatchObject({ code: CommErrorCode.PROFILE_NOT_AVAILABLE });
      await expect(
        profile.updateChild(s.teacherId, s.learnerId, { name: 'Taken Over' }),
      ).rejects.toMatchObject({ code: CommErrorCode.PROFILE_NOT_AVAILABLE });
      await expect(
        profile.setChildAvatar(s.teacherId, s.learnerId, 'avatars/learners/x/y'),
      ).rejects.toMatchObject({ code: CommErrorCode.PROFILE_NOT_AVAILABLE });
      // And cannot ask for a grant against somebody's child either.
      await expect(
        profile.authorizeAvatarUpload(s.teacherId, {
          mimeType: 'image/jpeg',
          byteSize: 1000,
          learnerId: s.learnerId,
        }),
      ).rejects.toMatchObject({ code: CommErrorCode.PROFILE_NOT_AVAILABLE });
    });

    it("a teacher's photo round-trips, and is keyed on the teacher", async () => {
      const grant = await profile.authorizeAvatarUpload(s.teacherId, {
        mimeType: 'image/jpeg',
        byteSize: 1000,
      });

      const saved = await profile.setAvatar(s.teacherId, grant.objectKey);
      expect(saved.avatarUrl).toBeTruthy();
      // No family, so no children -- the same DTO, honestly empty rather than absent.
      expect(saved.children).toEqual([]);

      const reread = await profile.myAvatar(s.teacherId);
      expect(reread.avatarUrl).toBeTruthy();

      const cleared = await profile.removeAvatar(s.teacherId);
      expect(cleared.avatarUrl).toBeNull();
    });

    it("a teacher cannot claim a CONTACT's key, nor a contact a teacher's", async () => {
      // The namespace is what makes this structural rather than a rule someone remembers.
      const mine = await profile.authorizeAvatarUpload(s.parentId, {
        mimeType: 'image/jpeg',
        byteSize: 1000,
      });
      const theirs = await profile.authorizeAvatarUpload(s.teacherId, {
        mimeType: 'image/jpeg',
        byteSize: 1000,
      });

      await expect(profile.setAvatar(s.teacherId, mine.objectKey)).rejects.toMatchObject({
        code: CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED,
      });
      await expect(profile.setAvatar(s.parentId, theirs.objectKey)).rejects.toMatchObject({
        code: CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED,
      });
    });

    it('an avatar key never lands on an identity row', async () => {
      // The whole reason these are sibling tables. If a future change moved the column back
      // onto chat.teacher, this is what would catch it.
      const grant = await profile.authorizeAvatarUpload(s.teacherId, {
        mimeType: 'image/jpeg',
        byteSize: 1000,
      });
      await profile.setAvatar(s.teacherId, grant.objectKey);

      const columns = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
        `select table_name from information_schema.columns
          where table_schema = 'chat'
            and column_name = 'avatar_object_key'
          order by table_name`,
      );

      expect(columns.map((c) => c.table_name)).toEqual([
        'contact_profile',
        'learner_profile',
        'staff_profile',
        'teacher_profile',
      ]);
    });
  });

  describe('an object key outside our prefix is refused', () => {
    for (const key of [
      'stories/not-mine',
      '../avatars/abc',
      'avatars/../../etc/passwd',
      'avatars//abc',
      'conversations/x/y',
      'avatars/',
      '',
      'https://evil.test/avatars/abc',
      // Two segments: the shape before the namespace existed.
      'avatars/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      // Three segments: the FAMILY-scoped shape this namespace replaced. Well-formed once,
      // meaningless now, and refused rather than quietly reinterpreted.
      'avatars/ffffffff-ffff-4fff-8fff-ffffffffffff/abc',
      // Four segments, but an unknown kind.
      'avatars/families/ffffffff-ffff-4fff-8fff-ffffffffffff/abc',
      // Four segments, right kind, somebody else's id.
      'avatars/contacts/ffffffff-ffff-4fff-8fff-ffffffffffff/abc',
      // A traversal that tries to re-enter another namespace from inside ours.
      'avatars/x/../../stories/abc',
    ]) {
      it(`refuses ${JSON.stringify(key)}`, async () => {
        // Without this a caller could point their row at somebody else's media and have the
        // server sign it for them on the next read.
        await expect(profile.setAvatar(s.parentId, key)).rejects.toMatchObject({
          code: CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED,
        });
        await expect(
          profile.setChildAvatar(s.parentId, s.learnerId, key),
        ).rejects.toBeInstanceOf(CommError);
      });
    }
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

  it('records that a photo changed, WITHOUT the key or a url', async () => {
    await profile.setAvatar(s.parentId, keyFor('contacts', s.parentId));
    const [row] = await rows('profile.avatar.set');

    expect(JSON.stringify(row?.after)).toContain('hasPhoto');
    // A key is a storage detail and a signed url is a credential. Neither belongs here.
    expect(JSON.stringify(row?.after)).not.toContain('avatars/');
    expect(JSON.stringify(row?.after)).not.toContain('sig=');
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
    expect(names).toEqual(
      expect.arrayContaining(['about', 'avatar_object_key', 'organization_id']),
    );
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
  describe("another family's photo object cannot be claimed as our own", () => {
    /**
     * The gap this closes, found by the closure QA against a running API.
     *
     * An avatar key used to be checked for SHAPE only, so any well-formed key under
     * `avatars/` was accepted. Family B could therefore take family A's key -- from a signed
     * URL that had leaked into a ticket, a log or a screenshot -- set it as their own photo,
     * and have this API mint fresh read URLs for it on every request: a five-minute
     * disclosure escalated into a permanent one, and another family's photo shown as theirs.
     *
     * The keys below are the REAL thing -- minted by the server for each family -- so this
     * tests the boundary rather than a guess at what a key looks like.
     */
    it("refuses a key minted for a different family, for a parent's own photo", async () => {
      const other = await seedOtherFamily();
      const theirs = await profile.authorizeAvatarUpload(other.parentId, {
        mimeType: 'image/jpeg',
        byteSize: 1000,
      });

      await expect(profile.setAvatar(s.parentId, theirs.objectKey)).rejects.toMatchObject({
        code: CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED,
      });
    });

    it("refuses a key minted for a different family, for a child's photo", async () => {
      const other = await seedOtherFamily();
      const theirs = await profile.authorizeAvatarUpload(other.parentId, {
        mimeType: 'image/jpeg',
        byteSize: 1000,
      });

      await expect(
        profile.setChildAvatar(s.parentId, s.learnerId, theirs.objectKey),
      ).rejects.toMatchObject({ code: CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED });
    });

    it('the refusal is symmetric', async () => {
      const other = await seedOtherFamily();
      const ours = await profile.authorizeAvatarUpload(s.parentId, {
        mimeType: 'image/jpeg',
        byteSize: 1000,
      });

      await expect(profile.setAvatar(other.parentId, ours.objectKey)).rejects.toMatchObject({
        code: CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED,
      });
    });

    it('a key the server minted for US is accepted, so the rule is not simply "refuse"', async () => {
      // The positive control. Without it, a validator that rejected everything would pass
      // every assertion above.
      const ours = await profile.authorizeAvatarUpload(s.parentId, {
        mimeType: 'image/jpeg',
        byteSize: 1000,
      });

      const saved = await profile.setAvatar(s.parentId, ours.objectKey);
      expect(saved.avatarUrl).toBeTruthy();
    });

    it('a grant names its SUBJECT, and no other', async () => {
      const other = await seedOtherFamily();

      const mine = await profile.authorizeAvatarUpload(s.parentId, {
        mimeType: 'image/jpeg',
        byteSize: 1000,
      });
      const myChild = await profile.authorizeAvatarUpload(s.parentId, {
        mimeType: 'image/jpeg',
        byteSize: 1000,
        learnerId: s.learnerId,
      });
      const theirs = await profile.authorizeAvatarUpload(other.parentId, {
        mimeType: 'image/jpeg',
        byteSize: 1000,
      });

      expect(mine.objectKey.startsWith(`avatars/contacts/${s.parentId}/`)).toBe(true);
      expect(myChild.objectKey.startsWith(`avatars/learners/${s.learnerId}/`)).toBe(true);
      expect(theirs.objectKey.startsWith(`avatars/contacts/${other.parentId}/`)).toBe(true);

      // No key carries a family id at all any more: the namespace names whose photo it is,
      // not who is allowed to change it.
      for (const key of [mine.objectKey, myChild.objectKey, theirs.objectKey]) {
        expect(key).not.toContain(s.familyId);
        expect(key).not.toContain(other.familyId);
      }
      // And my own key is not usable for my own child, which is the point of subject
      // scoping -- the family-scoped version could not tell these apart.
      await expect(
        profile.setChildAvatar(s.parentId, s.learnerId, mine.objectKey),
      ).rejects.toMatchObject({ code: CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED });
    });

    it("a grant is refused for a learner that is not the caller's", async () => {
      // Refused at AUTHORIZE, before a key exists, rather than at commit. One round trip
      // earlier, and the same code either way so it still confirms nothing.
      const other = await seedOtherFamily();

      await expect(
        profile.authorizeAvatarUpload(s.parentId, {
          mimeType: 'image/jpeg',
          byteSize: 1000,
          learnerId: other.learnerId,
        }),
      ).rejects.toMatchObject({ code: CommErrorCode.LEARNER_NOT_IN_FAMILY });
    });

    it('a co-parent may commit a key the other parent minted for the same child', async () => {
      // Subject scoping keys a child's photo on the CHILD, so it does not matter which
      // guardian obtained the grant. Either may set it, which is the permission model --
      // and the earlier family-scoped namespace got this right only by accident, because
      // both parents happened to share a family id.
      const minted = await profile.authorizeAvatarUpload(s.parentId, {
        mimeType: 'image/jpeg',
        byteSize: 1000,
        learnerId: s.learnerId,
      });

      const saved = await profile.setChildAvatar(
        s.otherParentId,
        s.learnerId,
        minted.objectKey,
      );
      expect(saved.children.find((c) => c.id === s.learnerId)?.avatarUrl).toBeTruthy();
    });
  });
});
