/**
 * The teacher professional profile, at the service boundary.
 *
 * WHAT THIS FILE IS FOR. db/tests/teacher_profile_rls.sql already proves the
 * database refuses the dangerous states with the application out of the picture.
 * This suite asserts the thing that file cannot: that the SERVICE reaches those
 * states only by the intended route, and refuses with a usable error rather than
 * by tripping a constraint. Where both layers enforce a rule, both are asserted
 * on purpose -- a service check is one new call site away from being skipped,
 * and a database check is the thing that survives that.
 *
 * THE ASSERTION THE FEATURE TURNS ON is "a family still reads the published
 * revision while the next one is in review" (`publishedProfile` during review).
 * If that breaks, families are watching teachers edit.
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

/** Code of the CommError a call threw, or null when it resolved. */
async function codeOf(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'UNTYPED';
  }
}

/** A teacher with an approved, published revision carrying one approved cert. */
async function publishProfile(teacherId: string, bio: string): Promise<string> {
  await g.teacherProfiles.saveDraft(teacherId, { bio, specialization: 'Tajweed' });

  const authorization = await g.teacherProfiles.authorizeCertificateUpload(teacherId, {
    mimeType: 'application/pdf',
    byteSize: 1000,
  });
  await g.teacherProfiles.addCertificate(teacherId, {
    title: 'Ijazah',
    mimeType: 'application/pdf',
    byteSize: 1000,
    uploadToken: authorization.uploadToken,
  });
  await g.teacherProfiles.submit(teacherId);

  const queue = await g.teacherProfiles.reviewQueue(s.ownerId);
  const item = queue.find((r) => r.bio === bio)!;
  for (const certificate of item.certificates) {
    await g.teacherProfiles.decideCertificate(s.ownerId, certificate.id, { approved: true });
  }
  await g.teacherProfiles.approve(s.ownerId, item.revisionId);
  return item.revisionId;
}

describe('ownership is derived from the session, never from the caller', () => {
  it('a teacher editing reaches only their own profile', async () => {
    await g.teacherProfiles.saveDraft(s.teacherId, { bio: 'mine' });
    await g.teacherProfiles.saveDraft(s.newTeacherId, { bio: 'theirs' });

    const mine = await g.teacherProfiles.myProfile(s.teacherId);
    const theirs = await g.teacherProfiles.myProfile(s.newTeacherId);

    expect(mine.draft?.bio).toBe('mine');
    expect(theirs.draft?.bio).toBe('theirs');
  });

  it('an ADMIN has no professional profile to edit', async () => {
    expect(await codeOf(() => g.teacherProfiles.myProfile(s.ownerId))).toBe(
      CommErrorCode.TEACHER_PROFILE_NOT_A_TEACHER,
    );
    expect(await codeOf(() => g.teacherProfiles.saveDraft(s.ownerId, { bio: 'x' }))).toBe(
      CommErrorCode.TEACHER_PROFILE_NOT_A_TEACHER,
    );
  });

  it('a PARENT has no professional profile to edit', async () => {
    expect(await codeOf(() => g.teacherProfiles.saveDraft(s.parentId, { bio: 'x' }))).toBe(
      CommErrorCode.TEACHER_PROFILE_NOT_A_TEACHER,
    );
  });

  it('a teacher cannot remove another teacher’s certificate', async () => {
    await publishProfile(s.newTeacherId, 'victim');
    const victim = await g.teacherProfiles.myProfile(s.newTeacherId);
    const certificateId = victim.published!.certificates[0].id;

    await g.teacherProfiles.saveDraft(s.teacherId, { bio: 'attacker' });
    expect(
      await codeOf(() => g.teacherProfiles.removeCertificate(s.teacherId, certificateId)),
    ).toBe(CommErrorCode.TEACHER_CERTIFICATE_NOT_FOUND);
  });

  it('a teacher cannot attach a file uploaded under another teacher’s prefix', async () => {
    const theirs = await g.teacherProfiles.authorizeCertificateUpload(s.newTeacherId, {
      mimeType: 'application/pdf',
      byteSize: 100,
    });

    // The token is the other teacher's object key. Handing it back as our own is
    // the whole attack, and the prefix check is what refuses it.
    expect(
      await codeOf(() =>
        g.teacherProfiles.addCertificate(s.teacherId, {
          title: 'Not mine',
          mimeType: 'application/pdf',
          byteSize: 100,
          uploadToken: theirs.uploadToken,
        }),
      ),
    ).toBe(CommErrorCode.TEACHER_CERTIFICATE_NOT_FOUND);
  });
});

describe('copy-on-write', () => {
  it('editing an approved profile opens a NEW revision and leaves the published one alone', async () => {
    await publishProfile(s.teacherId, 'v1');

    await g.teacherProfiles.saveDraft(s.teacherId, { bio: 'v2' });
    const view = await g.teacherProfiles.myProfile(s.teacherId);

    expect(view.published?.bio).toBe('v1');
    expect(view.draft?.bio).toBe('v2');
    expect(view.draft?.revisionNumber).toBe(2);
    expect(view.draft?.state).toBe('draft');
  });

  it('carries approved certificates forward without re-reviewing them', async () => {
    await publishProfile(s.teacherId, 'v1');
    await g.teacherProfiles.saveDraft(s.teacherId, { bio: 'v2' });

    const view = await g.teacherProfiles.myProfile(s.teacherId);
    expect(view.draft?.certificates).toHaveLength(1);
    expect(view.draft?.certificates[0].state).toBe('approved');
    // A different claim row -- the file is cited twice, not copied.
    expect(view.draft?.certificates[0].id).not.toBe(view.published?.certificates[0].id);
  });

  it('a family keeps reading the PUBLISHED revision while the next is in review', async () => {
    await publishProfile(s.teacherId, 'v1');
    await g.teacherProfiles.saveDraft(s.teacherId, { bio: 'v2 not yet approved' });
    await g.teacherProfiles.submit(s.teacherId);

    const published = await g.teacherProfiles.publishedProfile(s.teacherId);
    expect(published?.bio).toBe('v1');
  });

  it('a family reads nothing for a teacher who has never been approved', async () => {
    await g.teacherProfiles.saveDraft(s.teacherId, { bio: 'never approved' });
    await g.teacherProfiles.submit(s.teacherId);

    expect(await g.teacherProfiles.publishedProfile(s.teacherId)).toBeNull();
  });
});

describe('an approved revision is immutable', () => {
  it('the published revision is untouched by a later edit, and the draft carries it', async () => {
    const revisionId = await publishProfile(s.teacherId, 'v1');
    await g.teacherProfiles.saveDraft(s.teacherId, { bio: 'v2' });

    const row = await g.prisma.teacherProfileRevision.findUnique({ where: { id: revisionId } });
    expect(row?.bio).toBe('v1');
    expect(row?.state).toBe('approved');
  });

  it('the DATABASE refuses a direct content write to an approved revision', async () => {
    const revisionId = await publishProfile(s.teacherId, 'v1');

    // Not reachable through the service -- which is the point. This asserts the
    // backstop that survives a future call site the service does not have.
    await expect(
      g.prisma.teacherProfileRevision.update({
        where: { id: revisionId },
        data: { bio: 'rewritten' },
      }),
    ).rejects.toThrow();
  });
});

describe('approval is one transaction', () => {
  it('promotes, supersedes and moves the pointer together', async () => {
    const first = await publishProfile(s.teacherId, 'v1');
    await g.teacherProfiles.saveDraft(s.teacherId, { bio: 'v2' });
    await g.teacherProfiles.submit(s.teacherId);

    const queue = await g.teacherProfiles.reviewQueue(s.ownerId);
    const second = queue[0].revisionId;
    await g.teacherProfiles.approve(s.ownerId, second);

    const profile = await g.prisma.teacherProfessionalProfile.findUnique({
      where: { teacherId: s.teacherId },
    });
    const old = await g.prisma.teacherProfileRevision.findUnique({ where: { id: first } });

    expect(profile?.publishedRevisionId).toBe(second);
    expect(profile?.draftRevisionId).toBeNull();
    expect(old?.state).toBe('superseded');
    expect((await g.teacherProfiles.publishedProfile(s.teacherId))?.bio).toBe('v2');
  });

  it('a revision that was never submitted cannot be approved', async () => {
    await g.teacherProfiles.saveDraft(s.teacherId, { bio: 'draft only' });
    const profile = await g.prisma.teacherProfessionalProfile.findUnique({
      where: { teacherId: s.teacherId },
    });

    expect(
      await codeOf(() => g.teacherProfiles.approve(s.ownerId, profile!.draftRevisionId!)),
    ).toBe(CommErrorCode.TEACHER_PROFILE_NOT_SUBMITTED);
  });

  it('a second approval of the same revision is refused, not applied twice', async () => {
    await g.teacherProfiles.saveDraft(s.teacherId, { bio: 'once' });
    await g.teacherProfiles.submit(s.teacherId);
    const queue = await g.teacherProfiles.reviewQueue(s.ownerId);
    const revisionId = queue[0].revisionId;

    await g.teacherProfiles.approve(s.ownerId, revisionId);
    expect(await codeOf(() => g.teacherProfiles.approve(s.ownerId, revisionId))).toBe(
      CommErrorCode.TEACHER_PROFILE_NOT_SUBMITTED,
    );
  });
});

describe('the certificate gate', () => {
  it('blocks approval while a credential is undecided', async () => {
    await g.teacherProfiles.saveDraft(s.teacherId, { bio: 'with a cert' });
    const authorization = await g.teacherProfiles.authorizeCertificateUpload(s.teacherId, {
      mimeType: 'application/pdf',
      byteSize: 500,
    });
    await g.teacherProfiles.addCertificate(s.teacherId, {
      title: 'Unread',
      mimeType: 'application/pdf',
      byteSize: 500,
      uploadToken: authorization.uploadToken,
    });
    await g.teacherProfiles.submit(s.teacherId);

    const queue = await g.teacherProfiles.reviewQueue(s.ownerId);
    expect(queue[0].pendingCertificates).toBe(1);
    expect(await codeOf(() => g.teacherProfiles.approve(s.ownerId, queue[0].revisionId))).toBe(
      CommErrorCode.TEACHER_PROFILE_CERTIFICATES_UNDECIDED,
    );
  });

  it('a REJECTED credential satisfies the gate but never reaches a family', async () => {
    await g.teacherProfiles.saveDraft(s.teacherId, { bio: 'one good one bad' });
    for (const title of ['Good', 'Bad']) {
      const authorization = await g.teacherProfiles.authorizeCertificateUpload(s.teacherId, {
        mimeType: 'application/pdf',
        byteSize: 500,
      });
      await g.teacherProfiles.addCertificate(s.teacherId, {
        title,
        mimeType: 'application/pdf',
        byteSize: 500,
        uploadToken: authorization.uploadToken,
      });
    }
    await g.teacherProfiles.submit(s.teacherId);

    const queue = await g.teacherProfiles.reviewQueue(s.ownerId);
    for (const certificate of queue[0].certificates) {
      await g.teacherProfiles.decideCertificate(s.ownerId, certificate.id, {
        approved: certificate.title === 'Good',
        note: certificate.title === 'Good' ? undefined : 'Unreadable scan.',
      });
    }
    await g.teacherProfiles.approve(s.ownerId, queue[0].revisionId);

    const published = await g.teacherProfiles.publishedProfile(s.teacherId);
    expect(published?.certificates.map((c) => c.title)).toEqual(['Good']);
  });

  it('refuses a disallowed type and an oversized file before any row exists', async () => {
    expect(
      await codeOf(() =>
        g.teacherProfiles.authorizeCertificateUpload(s.teacherId, {
          mimeType: 'application/x-msdownload',
          byteSize: 10,
        }),
      ),
    ).toBe(CommErrorCode.TEACHER_CERTIFICATE_INVALID_TYPE);

    expect(
      await codeOf(() =>
        g.teacherProfiles.authorizeCertificateUpload(s.teacherId, {
          mimeType: 'application/pdf',
          byteSize: 20 * 1024 * 1024,
        }),
      ),
    ).toBe(CommErrorCode.TEACHER_CERTIFICATE_TOO_LARGE);
  });
});

describe('who may review', () => {
  it('a teacher cannot approve their own revision', async () => {
    await g.teacherProfiles.saveDraft(s.teacherId, { bio: 'self approve' });
    await g.teacherProfiles.submit(s.teacherId);
    const queue = await g.teacherProfiles.reviewQueue(s.ownerId);

    expect(await codeOf(() => g.teacherProfiles.approve(s.teacherId, queue[0].revisionId))).toBe(
      CommErrorCode.TEACHER_PROFILE_CANNOT_REVIEW,
    );
  });

  it('a parent cannot reach the review queue at all', async () => {
    expect(await codeOf(() => g.teacherProfiles.reviewQueue(s.parentId))).toBe(
      CommErrorCode.TEACHER_PROFILE_CANNOT_REVIEW,
    );
  });

  it('another teacher cannot approve a colleague’s revision', async () => {
    await g.teacherProfiles.saveDraft(s.teacherId, { bio: 'colleague' });
    await g.teacherProfiles.submit(s.teacherId);
    const queue = await g.teacherProfiles.reviewQueue(s.ownerId);

    expect(
      await codeOf(() => g.teacherProfiles.approve(s.newTeacherId, queue[0].revisionId)),
    ).toBe(CommErrorCode.TEACHER_PROFILE_CANNOT_REVIEW);
  });

  it('a manager may review', async () => {
    await g.teacherProfiles.saveDraft(s.teacherId, { bio: 'manager reviews' });
    await g.teacherProfiles.submit(s.teacherId);
    const queue = await g.teacherProfiles.reviewQueue(s.managerId);

    await expect(
      g.teacherProfiles.approve(s.managerId, queue[0].revisionId),
    ).resolves.toBeDefined();
  });

  it('request-changes demands a note, and leaves the published version live', async () => {
    await publishProfile(s.teacherId, 'live');
    await g.teacherProfiles.saveDraft(s.teacherId, { bio: 'needs work' });
    await g.teacherProfiles.submit(s.teacherId);
    const queue = await g.teacherProfiles.reviewQueue(s.ownerId);

    expect(
      await codeOf(() => g.teacherProfiles.requestChanges(s.ownerId, queue[0].revisionId, '  ')),
    ).toBe(CommErrorCode.TEACHER_PROFILE_REVIEW_NOTE_REQUIRED);

    await g.teacherProfiles.requestChanges(s.ownerId, queue[0].revisionId, 'Add your ijazah.');

    const mine = await g.teacherProfiles.myProfile(s.teacherId);
    expect(mine.draft?.state).toBe('changes_requested');
    expect(mine.draft?.reviewNote).toBe('Add your ijazah.');
    expect((await g.teacherProfiles.publishedProfile(s.teacherId))?.bio).toBe('live');
  });
});

describe('certificate files stay private', () => {
  it('the owning teacher and a reviewer each get a signed URL', async () => {
    await publishProfile(s.teacherId, 'files');
    const mine = await g.teacherProfiles.myProfile(s.teacherId);
    const certificateId = mine.published!.certificates[0].id;

    await expect(
      g.teacherProfiles.certificateDownloadUrl(s.teacherId, certificateId),
    ).resolves.toContain('http');
    await expect(
      g.teacherProfiles.certificateDownloadUrl(s.ownerId, certificateId),
    ).resolves.toContain('http');
  });

  it('a parent and an unrelated teacher are refused, and told nothing', async () => {
    await publishProfile(s.teacherId, 'files');
    const mine = await g.teacherProfiles.myProfile(s.teacherId);
    const certificateId = mine.published!.certificates[0].id;

    // The same code a missing certificate returns: whether this one exists is
    // not a fact an unauthorized caller gets to learn.
    expect(
      await codeOf(() => g.teacherProfiles.certificateDownloadUrl(s.parentId, certificateId)),
    ).toBe(CommErrorCode.TEACHER_CERTIFICATE_NOT_FOUND);
    expect(
      await codeOf(() =>
        g.teacherProfiles.certificateDownloadUrl(s.newTeacherId, certificateId),
      ),
    ).toBe(CommErrorCode.TEACHER_CERTIFICATE_NOT_FOUND);
  });

  it('NO object key appears in any teacher, reviewer or published response', async () => {
    await publishProfile(s.teacherId, 'no keys');
    await g.teacherProfiles.saveDraft(s.teacherId, { bio: 'next' });
    await g.teacherProfiles.submit(s.teacherId);

    const payloads = [
      await g.teacherProfiles.myProfile(s.teacherId),
      await g.teacherProfiles.reviewQueue(s.ownerId),
      await g.teacherProfiles.publishedProfile(s.teacherId),
    ];

    for (const payload of payloads) {
      const json = JSON.stringify(payload);
      expect(json).not.toContain('teacher-certificates/');
      expect(json).not.toContain('objectKey');
    }
  });

  it('no review metadata reaches the published read model', async () => {
    await publishProfile(s.teacherId, 'clean');
    await g.teacherProfiles.saveDraft(s.teacherId, { bio: 'next' });
    await g.teacherProfiles.submit(s.teacherId);
    const queue = await g.teacherProfiles.reviewQueue(s.ownerId);
    await g.teacherProfiles.requestChanges(s.ownerId, queue[0].revisionId, 'Secret reviewer note.');

    const json = JSON.stringify(await g.teacherProfiles.publishedProfile(s.teacherId));
    expect(json).not.toContain('Secret reviewer note.');
    expect(json).not.toContain('reviewNote');
    expect(json).not.toContain('state');
    expect(json).not.toContain('next');
  });
});

describe('concurrency', () => {
  it('two simultaneous first-edits leave exactly one open revision', async () => {
    // The partial unique index is the backstop; one of these may lose, and the
    // profile must still be coherent afterwards either way.
    await Promise.allSettled([
      g.teacherProfiles.saveDraft(s.teacherId, { bio: 'a' }),
      g.teacherProfiles.saveDraft(s.teacherId, { bio: 'b' }),
    ]);

    const open = await g.prisma.teacherProfileRevision.count({
      where: {
        profile: { teacherId: s.teacherId },
        state: { in: ['draft', 'pending_review', 'changes_requested'] },
      },
    });
    expect(open).toBe(1);
  });

  it('two simultaneous approvals publish exactly one revision', async () => {
    await g.teacherProfiles.saveDraft(s.teacherId, { bio: 'race' });
    await g.teacherProfiles.submit(s.teacherId);
    const queue = await g.teacherProfiles.reviewQueue(s.ownerId);
    const revisionId = queue[0].revisionId;

    const outcomes = await Promise.allSettled([
      g.teacherProfiles.approve(s.ownerId, revisionId),
      g.teacherProfiles.approve(s.otherAdminId, revisionId),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);

    const published = await g.prisma.teacherProfileRevision.count({
      where: { profile: { teacherId: s.teacherId }, state: 'approved' },
    });
    expect(published).toBe(1);
  });
});
