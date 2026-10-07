/**
 * The teacher professional profile (V2), at the service boundary.
 *
 * WHAT CHANGED, AND WHAT THAT MEANS FOR THIS FILE. V1 was a revision model
 * behind an admin approval workflow, and the assertion the feature turned on was
 * "a family still reads the published revision while the next one is in review".
 * V2 deletes that question: the teacher saves and the save IS the publish. So
 * the keystone assertion is now its opposite -- **a save is immediately the
 * profile a third party reads**, with nothing in between.
 *
 * What did NOT change is credential trust. A certificate does not become
 * verified by being uploaded, so the review assertions survive intact, and the
 * ones worth the most are the refusals: a teacher cannot decide their own
 * credential, and editing a claim drops the decision that was made about the old
 * one.
 *
 * Where both layers enforce a rule, both are asserted on purpose -- a service
 * check is one new call site away from being skipped, and a database check is
 * the thing that survives that.
 */
import { CommErrorCode } from '@platform/errors';
import { Scenario, buildGraph, seed, truncate } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
});

/** `chat.audit_log.id` is a bigint, which JSON.stringify refuses outright. */
function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v));
}

/** Code of the CommError a call threw, or null when it resolved. */
async function codeOf(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'UNTYPED';
  }
}

/** Attach a credential the way the client does: authorize, then claim. */
async function attachCertificate(
  teacherId: string,
  title: string,
): Promise<string> {
  const authorization = await g.teacherProfiles.authorizeCertificateUpload(teacherId, {
    mimeType: 'application/pdf',
    byteSize: 1024,
  });
  const profile = await g.teacherProfiles.addCertificate(teacherId, {
    title,
    mimeType: 'application/pdf',
    byteSize: 1024,
    uploadToken: authorization.uploadToken,
  });
  return profile.certificates.find((c) => c.title === title)!.id;
}

async function attachPhoto(teacherId: string, bytes = 2048) {
  const authorization = await g.teacherProfiles.authorizePhotoUpload(teacherId, {
    mimeType: 'image/jpeg',
    byteSize: bytes,
  });
  return g.teacherProfiles.setPhoto(teacherId, {
    uploadToken: authorization.uploadToken,
    mimeType: 'image/jpeg',
    byteSize: bytes,
  });
}

// ===========================================================================
describe('saving is publishing', () => {
  it('a teacher who has never saved gets an empty profile and no row', async () => {
    const view = await g.teacherProfiles.myProfile(s.teacherId);

    expect(view.bio).toBeNull();
    expect(view.certificates).toEqual([]);
    expect(view.photoUrl).toBeNull();
    expect(view.updatedAt).toBeNull();
    // Opening the screen must not be a write.
    expect(await g.prisma.teacherProfessionalProfile.count()).toBe(0);
  });

  it('THE KEYSTONE: a saved profile is immediately what a third party reads', async () => {
    await g.teacherProfiles.saveProfile(s.teacherId, { bio: 'first' });
    expect((await g.teacherProfiles.publicProfile(s.teacherId))?.bio).toBe('first');

    // No submit, no approval, no pointer move. The second save is live too.
    await g.teacherProfiles.saveProfile(s.teacherId, { bio: 'second' });
    expect((await g.teacherProfiles.publicProfile(s.teacherId))?.bio).toBe('second');
    expect((await g.teacherProfiles.myProfile(s.teacherId)).bio).toBe('second');
  });

  it('saves every content field and dedupes languages', async () => {
    const view = await g.teacherProfiles.saveProfile(s.teacherId, {
      bio: 'bio text',
      specialization: 'Tajweed',
      qualifications: 'Ijazah',
      experience: 'ten years',
      languages: ['Arabic', 'English', 'Arabic'],
    });

    expect(view.specialization).toBe('Tajweed');
    expect(view.qualifications).toBe('Ijazah');
    expect(view.experience).toBe('ten years');
    expect(view.languages).toEqual(['Arabic', 'English']);
    expect(view.updatedAt).not.toBeNull();
  });

  it('blank content is stored as null, not as an empty string', async () => {
    const view = await g.teacherProfiles.saveProfile(s.teacherId, {
      bio: '   ',
      specialization: '',
    });
    expect(view.bio).toBeNull();
    expect(view.specialization).toBeNull();
  });

  it('refuses content past the ceiling the database also enforces', async () => {
    expect(
      await codeOf(() =>
        g.teacherProfiles.saveProfile(s.teacherId, { bio: 'x'.repeat(2001) }),
      ),
    ).toBe(CommErrorCode.TEACHER_PROFILE_INVALID_CONTENT);
    expect(
      await codeOf(() =>
        g.teacherProfiles.saveProfile(s.teacherId, {
          languages: Array.from({ length: 11 }, (_, i) => `l${i}`),
        }),
      ),
    ).toBe(CommErrorCode.TEACHER_PROFILE_INVALID_CONTENT);
  });

  it('a first save and a later save are the same action', async () => {
    await g.teacherProfiles.saveProfile(s.teacherId, { bio: 'a' });
    await g.teacherProfiles.saveProfile(s.teacherId, { bio: 'b' });
    // One row, not two: the upsert is what makes a first save idempotent.
    expect(await g.prisma.teacherProfessionalProfile.count()).toBe(1);
  });

  it('a non-teacher has no professional profile to save', async () => {
    expect(await codeOf(() => g.teacherProfiles.myProfile(s.ownerId))).toBe(
      CommErrorCode.TEACHER_PROFILE_NOT_A_TEACHER,
    );
    expect(await codeOf(() => g.teacherProfiles.saveProfile(s.parentId, { bio: 'x' }))).toBe(
      CommErrorCode.TEACHER_PROFILE_NOT_A_TEACHER,
    );
  });

  it('two teachers keep separate profiles', async () => {
    await g.teacherProfiles.saveProfile(s.teacherId, { bio: 'mine' });
    await g.teacherProfiles.saveProfile(s.newTeacherId, { bio: 'theirs' });

    expect((await g.teacherProfiles.myProfile(s.teacherId)).bio).toBe('mine');
    expect((await g.teacherProfiles.myProfile(s.newTeacherId)).bio).toBe('theirs');
  });

  it('records the save in the audit log', async () => {
    await g.teacherProfiles.saveProfile(s.teacherId, { bio: 'audited' });
    const rows = await g.prisma.auditLog.findMany({ where: { action: 'teacher_profile.saved' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].actorId).toBe(s.teacherId);
    expect(rows[0].reason).not.toBe('');
  });
});

// ===========================================================================
describe('there is no profile review workflow left', () => {
  it('the service exposes no submit, approve or request-changes', () => {
    const api = g.teacherProfiles as unknown as Record<string, unknown>;
    expect(api.submit).toBeUndefined();
    expect(api.approve).toBeUndefined();
    expect(api.requestChanges).toBeUndefined();
    expect(api.saveDraft).toBeUndefined();
  });

  it('the profile row carries no state and no revision pointer', async () => {
    await g.teacherProfiles.saveProfile(s.teacherId, { bio: 'x' });
    const row = (await g.prisma.teacherProfessionalProfile.findFirst())!;
    const columns = Object.keys(row);
    expect(columns).not.toContain('state');
    expect(columns).not.toContain('publishedRevisionId');
    expect(columns).not.toContain('draftRevisionId');
  });

  it('the revision table is gone from the database', async () => {
    const rows = await g.prisma.$queryRaw<{ n: bigint }[]>`
      select count(*)::bigint as n from information_schema.tables
       where table_schema = 'chat' and table_name = 'teacher_profile_revision'
    `;
    expect(Number(rows[0].n)).toBe(0);
  });

  it('a teacher view carries no review fields at all', async () => {
    const view = (await g.teacherProfiles.saveProfile(s.teacherId, {
      bio: 'x',
    })) as unknown as Record<string, unknown>;
    for (const field of ['state', 'submittedAt', 'approvedAt', 'reviewNote', 'published', 'draft']) {
      expect(view[field]).toBeUndefined();
    }
  });
});

// ===========================================================================
describe('the name is identity, not profile content', () => {
  it('the teacher sees their current authoritative name', async () => {
    const view = await g.teacherProfiles.myProfile(s.teacherId);
    expect(view.name).toBe('teacher_c');
    expect(view.role).toBe('teacher');
  });

  it('a rename writes chat.teacher and returns the new identity', async () => {
    const identity = await g.teacherProfiles.updateName(s.teacherId, 'الأستاذ محمد');

    expect(identity.name).toBe('الأستاذ محمد');
    const row = await g.prisma.teacher.findUniqueOrThrow({ where: { id: s.teacherId } });
    expect(row.name).toBe('الأستاذ محمد');
  });

  it('the renamed name is what the profile then renders', async () => {
    await g.teacherProfiles.saveProfile(s.teacherId, { bio: 'x' });
    await g.teacherProfiles.updateName(s.teacherId, 'Ustadh Ali');

    // Straight from the resolved actor, so a stale copy is not representable.
    expect((await g.teacherProfiles.myProfile(s.teacherId)).name).toBe('Ustadh Ali');
    expect((await g.teacherProfiles.publicProfile(s.teacherId))?.teacherName).toBe('Ustadh Ali');
  });

  it('no profile table gains a name column', async () => {
    const rows = await g.prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
      select table_name, column_name from information_schema.columns
       where table_schema = 'chat'
         and table_name like 'teacher_prof%'
         and column_name like '%name%'
    `;
    expect(rows).toEqual([]);
  });

  it('an empty or whitespace name is refused', async () => {
    expect(await codeOf(() => g.teacherProfiles.updateName(s.teacherId, ''))).toBe(
      CommErrorCode.TEACHER_NAME_INVALID,
    );
    expect(await codeOf(() => g.teacherProfiles.updateName(s.teacherId, '   '))).toBe(
      CommErrorCode.TEACHER_NAME_INVALID,
    );
    // And nothing was written.
    expect((await g.prisma.teacher.findUniqueOrThrow({ where: { id: s.teacherId } })).name).toBe(
      'teacher_c',
    );
  });

  it('an over-long name is refused', async () => {
    expect(await codeOf(() => g.teacherProfiles.updateName(s.teacherId, 'x'.repeat(121)))).toBe(
      CommErrorCode.TEACHER_NAME_INVALID,
    );
  });

  it('a pasted multi-line name becomes one tidy line rather than being refused',
      async () => {
    const identity = await g.teacherProfiles.updateName(s.teacherId, '  Ustadh\nAli\t ');
    expect(identity.name).toBe('Ustadh Ali');
  });

  it('collapses internal whitespace, so a name never renders with odd gaps',
      async () => {
    // A live QA run caught this: the server trimmed but did not collapse, so
    // "الأستاذ   محمد" was stored with three spaces -- and the Flutter fake,
    // which did collapse, was quietly describing a server that did not exist.
    const identity = await g.teacherProfiles.updateName(s.teacherId, '  الأستاذ   محمد  ');
    expect(identity.name).toBe('الأستاذ محمد');
  });

  it('TEACHER A CANNOT RENAME TEACHER B', async () => {
    // There is no parameter through which B could be named, so the proof is
    // that A's call moves A and leaves B untouched.
    await g.teacherProfiles.updateName(s.teacherId, 'Renamed A');

    expect((await g.prisma.teacher.findUniqueOrThrow({ where: { id: s.newTeacherId } })).name).toBe(
      'teacher_d',
    );
  });

  it('a non-teacher cannot rename anybody', async () => {
    expect(await codeOf(() => g.teacherProfiles.updateName(s.ownerId, 'hacked'))).toBe(
      CommErrorCode.TEACHER_PROFILE_NOT_A_TEACHER,
    );
    expect(await codeOf(() => g.teacherProfiles.updateName(s.parentId, 'hacked'))).toBe(
      CommErrorCode.TEACHER_PROFILE_NOT_A_TEACHER,
    );
  });

  it('records the rename, with both names, in the audit log', async () => {
    await g.teacherProfiles.updateName(s.teacherId, 'After');
    const rows = await g.prisma.auditLog.findMany({ where: { action: 'teacher.renamed' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].before).toEqual({ name: 'teacher_c' });
    expect(rows[0].after).toEqual({ name: 'After' });
  });

  it('a rename does not touch Jawwid Core linkage', async () => {
    const before = await g.prisma.teacher.findUniqueOrThrow({ where: { id: s.teacherId } });
    await g.teacherProfiles.updateName(s.teacherId, 'Renamed');
    const after = await g.prisma.teacher.findUniqueOrThrow({ where: { id: s.teacherId } });

    expect(after.coreTeacherId).toBe(before.coreTeacherId);
    expect(after.syncedAt).toEqual(before.syncedAt);
  });
});

// ===========================================================================
describe('the profile photo', () => {
  it('starts absent', async () => {
    expect((await g.teacherProfiles.myProfile(s.teacherId)).photoUrl).toBeNull();
  });

  it('upload authorization never returns a raw key as a URL field', async () => {
    const authorization = await g.teacherProfiles.authorizePhotoUpload(s.teacherId, {
      mimeType: 'image/jpeg',
      byteSize: 2048,
    });
    expect(authorization.uploadUrl).toContain('sig=');
    // The token IS the key, and it is the one field documented as opaque; what
    // matters is that it is scoped to this teacher.
    expect(authorization.uploadToken.startsWith(`teacher-photos/${s.teacherId}/`)).toBe(true);
  });

  it('a set photo is served as a time-bounded signed URL, never as a field',
      async () => {
    const view = await attachPhoto(s.teacherId);

    expect(view.photoUrl).not.toBeNull();
    expect(view.photoUrl).toContain('sig=');
    expect(view.photoUrl).toContain('expires=');

    // THE honest assertion, and the one worth having. A signed URL names the
    // object inside its path -- an S3 presigned URL does the same -- so
    // "the key is nowhere in the payload" would be false, and a test that
    // appeared to prove it would only be passing because the URL percent-encodes
    // the separators. A live QA run is what showed that up.
    //
    // What IS true: no field carries a key a client could read, keep, or hand
    // back naming a different object.
    const serialized = JSON.parse(JSON.stringify(view)) as Record<string, unknown>;
    expect(Object.keys(serialized)).not.toContain('photoObjectKey');
    expect(Object.keys(serialized)).not.toContain('objectKey');
    for (const certificate of view.certificates) {
      expect(Object.keys(certificate)).not.toContain('objectKey');
    }
  });

  it('replacing a photo keeps exactly one key on the row', async () => {
    const first = await g.prisma.teacherProfessionalProfile.findFirst();
    expect(first).toBeNull();

    await attachPhoto(s.teacherId, 2048);
    const afterFirst = await g.prisma.teacherProfessionalProfile.findFirstOrThrow();

    await attachPhoto(s.teacherId, 4096);
    const afterSecond = await g.prisma.teacherProfessionalProfile.findFirstOrThrow();

    expect(afterSecond.photoObjectKey).not.toBe(afterFirst.photoObjectKey);
    expect(Number(afterSecond.photoByteSize)).toBe(4096);
  });

  it('removing the photo clears every photo column, so the UI falls back', async () => {
    await attachPhoto(s.teacherId);
    const view = await g.teacherProfiles.removePhoto(s.teacherId);

    expect(view.photoUrl).toBeNull();
    const row = await g.prisma.teacherProfessionalProfile.findFirstOrThrow();
    expect(row.photoObjectKey).toBeNull();
    expect(row.photoMimeType).toBeNull();
    expect(row.photoByteSize).toBeNull();
    expect(row.photoUpdatedAt).toBeNull();
  });

  it('removing an absent photo is a clear refusal, not a silent success', async () => {
    expect(await codeOf(() => g.teacherProfiles.removePhoto(s.teacherId))).toBe(
      CommErrorCode.TEACHER_PROFILE_PHOTO_NOT_FOUND,
    );
  });

  it('refuses a type that cannot be displayed', async () => {
    for (const mimeType of ['application/pdf', 'image/heic', 'image/svg+xml', 'text/html']) {
      expect(
        await codeOf(() =>
          g.teacherProfiles.authorizePhotoUpload(s.teacherId, { mimeType, byteSize: 1024 }),
        ),
      ).toBe(CommErrorCode.TEACHER_PROFILE_PHOTO_INVALID_TYPE);
    }
  });

  it('refuses a photo over 5MB, and zero bytes', async () => {
    expect(
      await codeOf(() =>
        g.teacherProfiles.authorizePhotoUpload(s.teacherId, {
          mimeType: 'image/jpeg',
          byteSize: 5 * 1024 * 1024 + 1,
        }),
      ),
    ).toBe(CommErrorCode.TEACHER_PROFILE_PHOTO_TOO_LARGE);
    expect(
      await codeOf(() =>
        g.teacherProfiles.authorizePhotoUpload(s.teacherId, {
          mimeType: 'image/jpeg',
          byteSize: 0,
        }),
      ),
    ).toBe(CommErrorCode.TEACHER_PROFILE_PHOTO_TOO_LARGE);
  });

  it('TEACHER A CANNOT CLAIM TEACHER B’S UPLOAD AS THEIR PHOTO', async () => {
    const theirs = await g.teacherProfiles.authorizePhotoUpload(s.newTeacherId, {
      mimeType: 'image/jpeg',
      byteSize: 2048,
    });

    expect(
      await codeOf(() =>
        g.teacherProfiles.setPhoto(s.teacherId, {
          uploadToken: theirs.uploadToken,
          mimeType: 'image/jpeg',
          byteSize: 2048,
        }),
      ),
    ).toBe(CommErrorCode.TEACHER_CERTIFICATE_NOT_FOUND);
  });

  it('refuses a key that climbs out of its prefix', async () => {
    expect(
      await codeOf(() =>
        g.teacherProfiles.setPhoto(s.teacherId, {
          uploadToken: `teacher-photos/${s.teacherId}/../../etc/passwd`,
          mimeType: 'image/jpeg',
          byteSize: 2048,
        }),
      ),
    ).toBe(CommErrorCode.TEACHER_CERTIFICATE_NOT_FOUND);
  });

  it('a certificate upload token is not a photo token', async () => {
    const certificate = await g.teacherProfiles.authorizeCertificateUpload(s.teacherId, {
      mimeType: 'image/jpeg',
      byteSize: 2048,
    });
    expect(
      await codeOf(() =>
        g.teacherProfiles.setPhoto(s.teacherId, {
          uploadToken: certificate.uploadToken,
          mimeType: 'image/jpeg',
          byteSize: 2048,
        }),
      ),
    ).toBe(CommErrorCode.TEACHER_CERTIFICATE_NOT_FOUND);
  });

  it('a non-teacher cannot upload or remove a photo', async () => {
    expect(
      await codeOf(() =>
        g.teacherProfiles.authorizePhotoUpload(s.parentId, {
          mimeType: 'image/jpeg',
          byteSize: 1024,
        }),
      ),
    ).toBe(CommErrorCode.TEACHER_PROFILE_NOT_A_TEACHER);
    expect(await codeOf(() => g.teacherProfiles.removePhoto(s.ownerId))).toBe(
      CommErrorCode.TEACHER_PROFILE_NOT_A_TEACHER,
    );
  });

  it('never audits the object key', async () => {
    await attachPhoto(s.teacherId);
    const row = await g.prisma.teacherProfessionalProfile.findFirstOrThrow();
    const rows = await g.prisma.auditLog.findMany({
      where: { action: 'teacher_profile.photo_set' },
    });

    expect(rows).toHaveLength(1);
    expect(serialize(rows[0])).not.toContain(row.photoObjectKey!);
  });

  it('the public profile carries a signed photo URL and no key field', async () => {
    await g.teacherProfiles.saveProfile(s.teacherId, { bio: 'x' });
    await attachPhoto(s.teacherId);

    const view = await g.teacherProfiles.publicProfile(s.teacherId);
    expect(view!.photoUrl).toContain('sig=');
    expect(Object.keys(view as object)).not.toContain('photoObjectKey');
  });
});

// ===========================================================================
describe('certificates: a credential is not verified by being uploaded', () => {
  it('a new certificate is pending, not approved', async () => {
    await attachCertificate(s.teacherId, 'Ijazah');
    const view = await g.teacherProfiles.myProfile(s.teacherId);

    expect(view.certificates).toHaveLength(1);
    expect(view.certificates[0].state).toBe('pending');
  });

  it('a pending certificate is NOT part of the public profile', async () => {
    await g.teacherProfiles.saveProfile(s.teacherId, { bio: 'x' });
    await attachCertificate(s.teacherId, 'Unverified');

    expect((await g.teacherProfiles.publicProfile(s.teacherId))?.certificates).toEqual([]);
  });

  it('an approved certificate is, and carries no internals', async () => {
    await g.teacherProfiles.saveProfile(s.teacherId, { bio: 'x' });
    const id = await attachCertificate(s.teacherId, 'Ijazah');
    await g.teacherProfiles.decideCertificate(s.ownerId, id, { approved: true });

    const certificates = (await g.teacherProfiles.publicProfile(s.teacherId))!.certificates;
    expect(certificates).toEqual([
      { title: 'Ijazah', issuingOrganization: null, issuedOn: null },
    ]);
  });

  it('a rejected certificate is not published either', async () => {
    await g.teacherProfiles.saveProfile(s.teacherId, { bio: 'x' });
    const id = await attachCertificate(s.teacherId, 'Refused');
    await g.teacherProfiles.decideCertificate(s.ownerId, id, {
      approved: false,
      note: 'not legible',
    });

    expect((await g.teacherProfiles.publicProfile(s.teacherId))?.certificates).toEqual([]);
    expect((await g.teacherProfiles.myProfile(s.teacherId)).certificates[0].reviewNote).toBe(
      'not legible',
    );
  });

  it('A TEACHER CANNOT DECIDE THEIR OWN CERTIFICATE', async () => {
    const id = await attachCertificate(s.teacherId, 'Mine');

    expect(
      await codeOf(() =>
        g.teacherProfiles.decideCertificate(s.teacherId, id, { approved: true }),
      ),
    ).toBe(CommErrorCode.TEACHER_PROFILE_CANNOT_REVIEW);
    expect((await g.teacherProfiles.myProfile(s.teacherId)).certificates[0].state).toBe('pending');
  });

  it('a parent cannot decide one either', async () => {
    const id = await attachCertificate(s.teacherId, 'Mine');
    expect(
      await codeOf(() => g.teacherProfiles.decideCertificate(s.parentId, id, { approved: true })),
    ).toBe(CommErrorCode.TEACHER_PROFILE_CANNOT_REVIEW);
  });

  it('rejecting without a reason is refused', async () => {
    const id = await attachCertificate(s.teacherId, 'Mine');
    expect(
      await codeOf(() =>
        g.teacherProfiles.decideCertificate(s.ownerId, id, { approved: false, note: '  ' }),
      ),
    ).toBe(CommErrorCode.TEACHER_PROFILE_REVIEW_NOTE_REQUIRED);
  });

  it('EDITING A CLAIM DROPS THE DECISION MADE ABOUT THE OLD ONE', async () => {
    const id = await attachCertificate(s.teacherId, 'Ijazah in Tajweed, Al-Azhar');
    await g.teacherProfiles.decideCertificate(s.ownerId, id, { approved: true });
    expect((await g.teacherProfiles.myProfile(s.teacherId)).certificates[0].state).toBe('approved');

    // The approval was of a CLAIM, not of a file. Retitling must not inherit it.
    const view = await g.teacherProfiles.updateCertificate(s.teacherId, id, {
      title: 'Anything At All',
    });
    expect(view.certificates[0].title).toBe('Anything At All');
    expect(view.certificates[0].state).toBe('pending');
  });

  it('a metadata edit does not touch the stored object', async () => {
    const id = await attachCertificate(s.teacherId, 'Before');
    const before = await g.prisma.teacherProfileCertificate.findUniqueOrThrow({ where: { id } });

    await g.teacherProfiles.updateCertificate(s.teacherId, id, { title: 'After' });
    const after = await g.prisma.teacherProfileCertificate.findUniqueOrThrow({ where: { id } });

    // Same key, same bytes: a rename is not a substitution.
    expect(after.objectKey).toBe(before.objectKey);
    expect(after.byteSize).toBe(before.byteSize);
    expect(after.mimeType).toBe(before.mimeType);
  });

  it('a certificate edit does not disturb the profile content', async () => {
    await g.teacherProfiles.saveProfile(s.teacherId, { bio: 'untouched' });
    const id = await attachCertificate(s.teacherId, 'Cert');
    await g.teacherProfiles.updateCertificate(s.teacherId, id, { title: 'Renamed' });

    // In V1 this returned the whole profile to draft. There is no such coupling.
    expect((await g.teacherProfiles.myProfile(s.teacherId)).bio).toBe('untouched');
    expect((await g.teacherProfiles.publicProfile(s.teacherId))?.bio).toBe('untouched');
  });

  it('removing a certificate removes it from the profile', async () => {
    const id = await attachCertificate(s.teacherId, 'Gone');
    const view = await g.teacherProfiles.removeCertificate(s.teacherId, id);
    expect(view.certificates).toEqual([]);
  });

  it('TEACHER A CANNOT EDIT, REMOVE OR DOWNLOAD TEACHER B’S CERTIFICATE', async () => {
    const theirs = await attachCertificate(s.newTeacherId, 'Theirs');

    expect(
      await codeOf(() =>
        g.teacherProfiles.updateCertificate(s.teacherId, theirs, { title: 'Stolen' }),
      ),
    ).toBe(CommErrorCode.TEACHER_CERTIFICATE_NOT_FOUND);
    expect(await codeOf(() => g.teacherProfiles.removeCertificate(s.teacherId, theirs))).toBe(
      CommErrorCode.TEACHER_CERTIFICATE_NOT_FOUND,
    );
    expect(await codeOf(() => g.teacherProfiles.certificateDownloadUrl(s.teacherId, theirs))).toBe(
      CommErrorCode.TEACHER_CERTIFICATE_NOT_FOUND,
    );
  });

  it('a teacher cannot claim another teacher’s certificate upload', async () => {
    const theirs = await g.teacherProfiles.authorizeCertificateUpload(s.newTeacherId, {
      mimeType: 'application/pdf',
      byteSize: 1024,
    });
    expect(
      await codeOf(() =>
        g.teacherProfiles.addCertificate(s.teacherId, {
          title: 'Stolen',
          mimeType: 'application/pdf',
          byteSize: 1024,
          uploadToken: theirs.uploadToken,
        }),
      ),
    ).toBe(CommErrorCode.TEACHER_CERTIFICATE_NOT_FOUND);
  });

  it('refuses a disallowed certificate type and an oversized one', async () => {
    expect(
      await codeOf(() =>
        g.teacherProfiles.authorizeCertificateUpload(s.teacherId, {
          mimeType: 'text/html',
          byteSize: 10,
        }),
      ),
    ).toBe(CommErrorCode.TEACHER_CERTIFICATE_INVALID_TYPE);
    expect(
      await codeOf(() =>
        g.teacherProfiles.authorizeCertificateUpload(s.teacherId, {
          mimeType: 'application/pdf',
          byteSize: 10 * 1024 * 1024 + 1,
        }),
      ),
    ).toBe(CommErrorCode.TEACHER_CERTIFICATE_TOO_LARGE);
  });

  it('requires a title', async () => {
    const authorization = await g.teacherProfiles.authorizeCertificateUpload(s.teacherId, {
      mimeType: 'application/pdf',
      byteSize: 1024,
    });
    expect(
      await codeOf(() =>
        g.teacherProfiles.addCertificate(s.teacherId, {
          title: '   ',
          mimeType: 'application/pdf',
          byteSize: 1024,
          uploadToken: authorization.uploadToken,
        }),
      ),
    ).toBe(CommErrorCode.TEACHER_CERTIFICATE_INVALID_TYPE);
  });

  it('no certificate view ever carries the object key', async () => {
    await attachCertificate(s.teacherId, 'Cert');
    const mine = await g.teacherProfiles.myProfile(s.teacherId);
    const row = await g.prisma.teacherProfileCertificate.findFirstOrThrow();

    expect(JSON.stringify(mine)).not.toContain(row.objectKey);
    const queue = await g.teacherProfiles.certificateReviewQueue(s.ownerId);
    expect(JSON.stringify(queue)).not.toContain(row.objectKey);
  });
});

// ===========================================================================
describe('the certificate review queue', () => {
  it('lists only teachers with something pending', async () => {
    const id = await attachCertificate(s.teacherId, 'Pending one');
    await attachCertificate(s.newTeacherId, 'Pending two');

    expect(await g.teacherProfiles.certificateReviewQueue(s.ownerId)).toHaveLength(2);

    await g.teacherProfiles.decideCertificate(s.ownerId, id, { approved: true });
    const queue = await g.teacherProfiles.certificateReviewQueue(s.ownerId);
    expect(queue).toHaveLength(1);
    expect(queue[0].teacherName).toBe('teacher_d');
  });

  it('counts what is still pending and names no revision', async () => {
    await attachCertificate(s.teacherId, 'A');
    await attachCertificate(s.teacherId, 'B');

    const [item] = await g.teacherProfiles.certificateReviewQueue(s.ownerId);
    expect(item.pendingCertificates).toBe(2);
    expect((item as unknown as Record<string, unknown>).revisionId).toBeUndefined();
  });

  it('is refused to a teacher and to a parent', async () => {
    expect(await codeOf(() => g.teacherProfiles.certificateReviewQueue(s.teacherId))).toBe(
      CommErrorCode.TEACHER_PROFILE_CANNOT_REVIEW,
    );
    expect(await codeOf(() => g.teacherProfiles.certificateReviewQueue(s.parentId))).toBe(
      CommErrorCode.TEACHER_PROFILE_CANNOT_REVIEW,
    );
  });

  it('a manager may review', async () => {
    await attachCertificate(s.teacherId, 'Cert');
    expect(await g.teacherProfiles.certificateReviewQueue(s.managerId)).toHaveLength(1);
  });
});

// ===========================================================================
describe('certificate download authorization', () => {
  it('the owning teacher gets a fresh signed URL', async () => {
    const id = await attachCertificate(s.teacherId, 'Mine');
    const url = await g.teacherProfiles.certificateDownloadUrl(s.teacherId, id);
    expect(url).toContain('sig=');
  });

  it('a reviewer does too', async () => {
    const id = await attachCertificate(s.teacherId, 'Mine');
    expect(await g.teacherProfiles.certificateDownloadUrl(s.ownerId, id)).toContain('sig=');
  });

  it('A PARENT DOES NOT, even for an approved certificate', async () => {
    const id = await attachCertificate(s.teacherId, 'Mine');
    await g.teacherProfiles.decideCertificate(s.ownerId, id, { approved: true });

    expect(await codeOf(() => g.teacherProfiles.certificateDownloadUrl(s.parentId, id))).toBe(
      CommErrorCode.TEACHER_CERTIFICATE_NOT_FOUND,
    );
  });

  it('an unknown id is the same refusal as somebody else’s id', async () => {
    // Telling them apart would make this endpoint an oracle for certificate ids.
    const theirs = await attachCertificate(s.newTeacherId, 'Theirs');
    const unknown = '00000000-0000-0000-0000-000000000000';

    expect(await codeOf(() => g.teacherProfiles.certificateDownloadUrl(s.teacherId, unknown))).toBe(
      await codeOf(() => g.teacherProfiles.certificateDownloadUrl(s.teacherId, theirs)),
    );
  });
});

// ===========================================================================
describe('the public read model', () => {
  it('is null for a teacher who has never saved', async () => {
    expect(await g.teacherProfiles.publicProfile(s.teacherId)).toBeNull();
  });

  it('carries no id, no key, no review metadata and no reviewer', async () => {
    await g.teacherProfiles.saveProfile(s.teacherId, { bio: 'x' });
    const id = await attachCertificate(s.teacherId, 'Cert');
    await g.teacherProfiles.decideCertificate(s.ownerId, id, { approved: true });

    const view = await g.teacherProfiles.publicProfile(s.teacherId);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(id);
    expect(serialized).not.toContain('reviewedBy');
    expect(serialized).not.toContain('state');
    expect(serialized).not.toContain('objectKey');
  });
});

// ===========================================================================
describe('the certificate audit trail', () => {
  /**
   * WHY THIS BLOCK EXISTS. V1 shipped with NO certificate audit records at all
   * and nobody noticed, because nothing asserted them. V2 writes all five, which
   * was proved by hand against the QA database -- and a property proved by hand
   * is a property that regresses the next time somebody refactors the service.
   *
   * These run against the REAL `PrismaAuditService` the harness wires into
   * `TeacherProfileService` (harness.ts), writing to the real `chat.audit_log`.
   * Nothing is mocked: a test that asserts a mock was called proves the test
   * knows what the code does, not that the row reaches the database.
   */

  /** Every field the requirement names, in one place. */
  async function auditRowFor(action: string) {
    const rows = await g.prisma.auditLog.findMany({ where: { action } });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.entity).toBe('teacher_profile_certificate');
    expect(row.at).toBeInstanceOf(Date);
    // A reason is NOT NULL by design: a review-significant action without one is
    // a bug (audit.service.ts).
    expect(row.reason.trim().length).toBeGreaterThan(0);
    return row;
  }

  /**
   * The forbidden list, applied to the WHOLE row rather than to named fields --
   * `before`/`after` are free-form JSON, so a future change could put a key
   * somewhere this test did not think to look.
   */
  function expectNothingSensitive(row: unknown, objectKey: string) {
    const text = serialize(row);
    expect(text).not.toContain(objectKey);
    expect(text).not.toContain('teacher-certificates/');
    expect(text).not.toContain('teacher-photos/');
    expect(text).not.toContain('objectKey');
    expect(text).not.toContain('sig=');
    expect(text).not.toMatch(/bearer/i);
    expect(text).not.toContain('expires=');
    // A signing secret or an access key would arrive as one of these.
    expect(text).not.toMatch(/STORAGE_(SIGNING_SECRET|ACCESS_KEY|SECRET_KEY)/);
    expect(text).not.toMatch(/%PDF/);
  }

  it('1. ADDED: one row, by the teacher, naming the certificate', async () => {
    const id = await attachCertificate(s.teacherId, 'Ijazah in Tajweed');
    const row = await auditRowFor('teacher_profile.certificate_added');
    const stored = await g.prisma.teacherProfileCertificate.findUniqueOrThrow({
      where: { id },
    });

    expect(row.actorId).toBe(s.teacherId);
    expect(row.entityId).toBe(id);
    // Nothing existed before; the claim and its untrusted state exist after.
    expect(row.before).toBeNull();
    expect(row.after).toEqual({ title: 'Ijazah in Tajweed', state: 'pending' });
    expectNothingSensitive(row, stored.objectKey);
  });

  it('2. EDITED: one row, carrying the title change and the lost approval',
      async () => {
    const id = await attachCertificate(s.teacherId, 'Before');
    await g.teacherProfiles.decideCertificate(s.ownerId, id, { approved: true });
    await g.teacherProfiles.updateCertificate(s.teacherId, id, { title: 'After' });

    const row = await auditRowFor('teacher_profile.certificate_edited');
    const stored = await g.prisma.teacherProfileCertificate.findUniqueOrThrow({
      where: { id },
    });

    expect(row.actorId).toBe(s.teacherId);
    expect(row.entityId).toBe(id);
    // The audit is what makes the re-pend legible afterwards: approved -> pending
    // is the consequence a reviewer needs to be able to see.
    expect(row.before).toEqual({ title: 'Before', state: 'approved' });
    expect(row.after).toEqual({ title: 'After', state: 'pending' });
    expectNothingSensitive(row, stored.objectKey);
  });

  it('3. REMOVED: one row, naming what was removed, after the row is gone',
      async () => {
    const id = await attachCertificate(s.teacherId, 'Gone');
    const stored = await g.prisma.teacherProfileCertificate.findUniqueOrThrow({
      where: { id },
    });
    await g.teacherProfiles.removeCertificate(s.teacherId, id);

    const row = await auditRowFor('teacher_profile.certificate_removed');
    expect(row.actorId).toBe(s.teacherId);
    // The entityId still names a certificate that no longer exists -- which is
    // the whole point of an audit row and the reason it is not a foreign key.
    expect(row.entityId).toBe(id);
    expect(await g.prisma.teacherProfileCertificate.count({ where: { id } })).toBe(0);
    expect(row.before).toEqual({ title: 'Gone', state: 'pending' });
    expect(row.after).toBeNull();
    expectNothingSensitive(row, stored.objectKey);
  });

  it('4. APPROVED: one row, by the REVIEWER and not the owner', async () => {
    const id = await attachCertificate(s.teacherId, 'Ijazah');
    await g.teacherProfiles.decideCertificate(s.ownerId, id, { approved: true });

    const row = await auditRowFor('teacher_profile.certificate_approved');
    const stored = await g.prisma.teacherProfileCertificate.findUniqueOrThrow({
      where: { id },
    });

    // THE assertion that makes the trail worth keeping: the actor is the staff
    // member who decided, never the teacher who uploaded.
    expect(row.actorId).toBe(s.ownerId);
    expect(row.actorId).not.toBe(s.teacherId);
    expect(row.entityId).toBe(id);
    expect(row.before).toEqual({ state: 'pending' });
    expect(row.after).toEqual({ state: 'approved' });
    // An approval carries no reviewer words, so it says what it is rather than
    // leaving the NOT NULL reason empty.
    expect(row.reason).toBe('a reviewer approved this credential');
    expectNothingSensitive(row, stored.objectKey);
  });

  it('5. REJECTED: one row, carrying the reviewer’s own reason', async () => {
    const id = await attachCertificate(s.teacherId, 'Illegible');
    await g.teacherProfiles.decideCertificate(s.ownerId, id, {
      approved: false,
      note: 'the scan is not readable',
    });

    const row = await auditRowFor('teacher_profile.certificate_rejected');
    const stored = await g.prisma.teacherProfileCertificate.findUniqueOrThrow({
      where: { id },
    });

    expect(row.actorId).toBe(s.ownerId);
    expect(row.entityId).toBe(id);
    expect(row.before).toEqual({ state: 'pending' });
    expect(row.after).toEqual({ state: 'rejected' });
    expect(row.reason).toBe('the scan is not readable');
    expectNothingSensitive(row, stored.objectKey);
  });

  it('writes EXACTLY the expected event, and no other, per action', async () => {
    // A full lifecycle in order. Five actions in, five rows out: no duplicates
    // from a retry, and no event fired that nobody asked for.
    const id = await attachCertificate(s.teacherId, 'Lifecycle');
    await g.teacherProfiles.decideCertificate(s.ownerId, id, { approved: true });
    await g.teacherProfiles.updateCertificate(s.teacherId, id, { title: 'Renamed' });
    await g.teacherProfiles.decideCertificate(s.ownerId, id, {
      approved: false,
      note: 'no',
    });
    await g.teacherProfiles.removeCertificate(s.teacherId, id);

    const rows = await g.prisma.auditLog.findMany({
      where: { entity: 'teacher_profile_certificate' },
      orderBy: { id: 'asc' },
    });
    expect(rows.map((r) => r.action)).toEqual([
      'teacher_profile.certificate_added',
      'teacher_profile.certificate_approved',
      'teacher_profile.certificate_edited',
      'teacher_profile.certificate_rejected',
      'teacher_profile.certificate_removed',
    ]);
    expect(new Set(rows.map((r) => r.entityId))).toEqual(new Set([id]));
  });

  it('no certificate audit row anywhere carries sensitive data', async () => {
    const id = await attachCertificate(s.teacherId, 'Sweep');
    const stored = await g.prisma.teacherProfileCertificate.findUniqueOrThrow({
      where: { id },
    });
    await g.teacherProfiles.decideCertificate(s.ownerId, id, { approved: true });
    await g.teacherProfiles.updateCertificate(s.teacherId, id, { title: 'Swept' });
    await g.teacherProfiles.removeCertificate(s.teacherId, id);

    const rows = await g.prisma.auditLog.findMany();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expectNothingSensitive(row, stored.objectKey);
  });

  // -------------------------------------------------------------------------
  // Transactional behaviour
  // -------------------------------------------------------------------------

  it('ROLLBACK: an audit row written in a failed transaction does not survive',
      async () => {
    // The mechanism, with the REAL audit service and the REAL table. This is the
    // property every mutation above depends on: `audit(tx, …)` writes through
    // the transaction client it is handed, so the row shares that
    // transaction's fate.
    const before = await g.prisma.auditLog.count();

    await expect(
      g.prisma.$transaction(async (tx) => {
        await g.audit.audit(tx, {
          actorId: s.teacherId,
          action: 'teacher_profile.certificate_added',
          entity: 'teacher_profile_certificate',
          entityId: s.learnerId,
          before: null,
          after: { title: 'never committed', state: 'pending' },
          reason: 'a deliberately failed transaction',
        });
        // Prove the row is visible INSIDE the transaction, so the assertion
        // below is about the rollback and not about a write that never happened.
        expect(await tx.auditLog.count()).toBe(before + 1);
        throw new Error('the mutation failed after the audit write');
      }),
    ).rejects.toThrow('the mutation failed after the audit write');

    expect(await g.prisma.auditLog.count()).toBe(before);
  });

  it('a REFUSED decision leaves no audit row behind', async () => {
    const id = await attachCertificate(s.teacherId, 'Mine');
    const added = await g.prisma.auditLog.count();

    // Refused by the service AND, independently, by a database trigger.
    expect(
      await codeOf(() =>
        g.teacherProfiles.decideCertificate(s.teacherId, id, { approved: true }),
      ),
    ).toBe(CommErrorCode.TEACHER_PROFILE_CANNOT_REVIEW);

    expect(await g.prisma.auditLog.count()).toBe(added);
    expect(
      await g.prisma.auditLog.count({
        where: { action: 'teacher_profile.certificate_approved' },
      }),
    ).toBe(0);
  });

  it('a REFUSED rejection (no reason given) leaves no audit row behind', async () => {
    const id = await attachCertificate(s.teacherId, 'Mine');
    const added = await g.prisma.auditLog.count();

    expect(
      await codeOf(() =>
        g.teacherProfiles.decideCertificate(s.ownerId, id, { approved: false, note: ' ' }),
      ),
    ).toBe(CommErrorCode.TEACHER_PROFILE_REVIEW_NOTE_REQUIRED);

    expect(await g.prisma.auditLog.count()).toBe(added);
  });

  it('a REFUSED edit on somebody else’s certificate leaves no audit row',
      async () => {
    const theirs = await attachCertificate(s.newTeacherId, 'Theirs');
    const added = await g.prisma.auditLog.count();

    expect(
      await codeOf(() =>
        g.teacherProfiles.updateCertificate(s.teacherId, theirs, { title: 'Stolen' }),
      ),
    ).toBe(CommErrorCode.TEACHER_CERTIFICATE_NOT_FOUND);

    expect(await g.prisma.auditLog.count()).toBe(added);
    expect(
      await g.prisma.auditLog.count({
        where: { action: 'teacher_profile.certificate_edited' },
      }),
    ).toBe(0);
  });

  it('the audit write shares the mutation’s transaction, not a second one',
      async () => {
    // Asserted by consequence rather than by inspection: the row and the state
    // change are both present, and `at` sits inside the mutation's own window.
    const started = new Date();
    const id = await attachCertificate(s.teacherId, 'Together');
    await g.teacherProfiles.decideCertificate(s.ownerId, id, { approved: true });
    const finished = new Date();

    const row = await auditRowFor('teacher_profile.certificate_approved');
    const certificate = await g.prisma.teacherProfileCertificate.findUniqueOrThrow({
      where: { id },
    });

    expect(certificate.state).toBe('approved');
    expect(row.at.getTime()).toBeGreaterThanOrEqual(started.getTime() - 1000);
    expect(row.at.getTime()).toBeLessThanOrEqual(finished.getTime() + 1000);
  });
});
