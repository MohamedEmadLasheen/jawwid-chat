/**
 * Staff and teacher profile photos, and the sender avatar on a group message.
 *
 * Avatars existed only for contacts and learners. A parent's group chat shows messages from
 * their teacher and from an admin, so the two kinds that most needed a face were the two
 * that could not have one. This covers the capability that closes that, and — more
 * importantly — the boundary around it.
 *
 * ## The shape of the authorization argument
 *
 * There is no "can A edit B?" check to test, because **no avatar endpoint accepts a target
 * id**. The row written is the one the bearer token resolves to. So the cross-user tests
 * here do not assert a refusal; they assert that acting as A leaves B's row untouched,
 * which is the stronger claim: the request cannot be expressed, so there is no rule to get
 * wrong later.
 *
 * ## What it must never become
 *
 * A name and a face must come from ONE identity lookup. A message that reads "QA Teacher"
 * over the admin's photo would be a worse defect than no photo at all, and the last group
 * here pins that they are resolved together.
 */
import { CommError, CommErrorCode } from '@platform/errors';
import { ActorKind } from '@communication/contracts/vocab';
import {
  buildGraph,
  seed,
  seedSecondFamily,
  truncate,
  Scenario,
} from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
const prisma = g.prisma;
const profile = g.profile;
let s: Scenario;

/** Well-formed keys in the only prefix the server accepts. */
const KEY_A = 'avatars/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const KEY_B = 'avatars/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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
});

const teacherKey = (id: string) =>
  prisma.teacher.findUniqueOrThrow({ where: { id } }).then((r) => r.avatarObjectKey);
const staffKey = (id: string) =>
  prisma.staff.findUniqueOrThrow({ where: { id } }).then((r) => r.avatarObjectKey);
const contactKey = (id: string) =>
  prisma.contact.findUniqueOrThrow({ where: { id } }).then((r) => r.avatarObjectKey);

// ---------------------------------------------------------------------------
describe('a teacher owns their own photo', () => {
  it('sets, replaces, then removes it', async () => {
    const set = await profile.setAvatar(s.teacherId, KEY_A);
    expect(set.avatarUrl).toBeTruthy();
    expect(await teacherKey(s.teacherId)).toBe(KEY_A);

    const replaced = await profile.setAvatar(s.teacherId, KEY_B);
    expect(replaced.avatarUrl).toBeTruthy();
    expect(await teacherKey(s.teacherId)).toBe(KEY_B);

    const removed = await profile.removeAvatar(s.teacherId);
    expect(removed.avatarUrl).toBeNull();
    expect(await teacherKey(s.teacherId)).toBeNull();
  });

  it('reads its own name and photo back', async () => {
    await profile.setAvatar(s.teacherId, KEY_A);
    const mine = await profile.myAvatar(s.teacherId);

    expect(mine.displayName).toBeTruthy();
    expect(mine.avatarUrl).toMatch(/^https?:\/\//);
    // A signed URL, never the key.
    expect(mine.avatarUrl).not.toBe(KEY_A);
  });

  it('removing when there is no photo is a no-op, not an error', async () => {
    await expect(profile.removeAvatar(s.teacherId)).resolves.toMatchObject({ avatarUrl: null });
  });
});

// ---------------------------------------------------------------------------
describe('a staff member owns their own photo', () => {
  it('sets, replaces, then removes it', async () => {
    await profile.setAvatar(s.ownerId, KEY_A);
    expect(await staffKey(s.ownerId)).toBe(KEY_A);

    await profile.setAvatar(s.ownerId, KEY_B);
    expect(await staffKey(s.ownerId)).toBe(KEY_B);

    await profile.removeAvatar(s.ownerId);
    expect(await staffKey(s.ownerId)).toBeNull();
  });

  it('reads its own name and photo back', async () => {
    await profile.setAvatar(s.ownerId, KEY_A);
    await expect(profile.myAvatar(s.ownerId)).resolves.toMatchObject({
      displayName: expect.any(String),
    });
  });
});

// ---------------------------------------------------------------------------
/**
 * No endpoint takes a target, so each of these acts as one principal and proves another
 * principal's row did not move. That is the whole boundary.
 */
describe('nobody can reach anybody else\'s photo', () => {
  it('a teacher acting for themselves does not touch another teacher', async () => {
    await profile.setAvatar(s.unrelatedTeacherId, KEY_B);

    await profile.setAvatar(s.teacherId, KEY_A);

    expect(await teacherKey(s.teacherId)).toBe(KEY_A);
    expect(await teacherKey(s.unrelatedTeacherId)).toBe(KEY_B);
  });

  it('a staff member does not touch another staff member', async () => {
    await profile.setAvatar(s.otherAdminId, KEY_B);

    await profile.setAvatar(s.ownerId, KEY_A);

    expect(await staffKey(s.ownerId)).toBe(KEY_A);
    expect(await staffKey(s.otherAdminId)).toBe(KEY_B);
  });

  it('a teacher does not touch a staff member, and vice versa', async () => {
    await profile.setAvatar(s.ownerId, KEY_B);
    await profile.setAvatar(s.teacherId, KEY_A);

    expect(await staffKey(s.ownerId)).toBe(KEY_B);
    expect(await teacherKey(s.teacherId)).toBe(KEY_A);

    await profile.removeAvatar(s.teacherId);
    // Removing the teacher's photo left the admin's alone.
    expect(await staffKey(s.ownerId)).toBe(KEY_B);
  });

  it('a parent does not touch a teacher or a staff member', async () => {
    await profile.setAvatar(s.teacherId, KEY_A);
    await profile.setAvatar(s.ownerId, KEY_A);

    await profile.setAvatar(s.parentId, KEY_B);

    expect(await contactKey(s.parentId)).toBe(KEY_B);
    expect(await teacherKey(s.teacherId)).toBe(KEY_A);
    expect(await staffKey(s.ownerId)).toBe(KEY_A);
  });

  it('a teacher cannot remove a parent\'s photo', async () => {
    await profile.setAvatar(s.parentId, KEY_A);

    await profile.removeAvatar(s.teacherId);

    expect(await contactKey(s.parentId)).toBe(KEY_A);
  });

  it('an unknown actor is refused, not silently ignored', async () => {
    // Stands in for unauthenticated: the guard resolves no actor, so the service never sees
    // an id it could act on. A random uuid -- NOT the all-zeros one, which is the system
    // actor and a different (also refused) case, below.
    const nobody = '9f1c0d2e-7b3a-4c5d-8e6f-0a1b2c3d4e5f';
    await expect(profile.setAvatar(nobody, KEY_A)).rejects.toMatchObject({
      code: CommErrorCode.UNKNOWN_ACTOR,
    });
    await expect(profile.myAvatar(nobody)).rejects.toMatchObject({
      code: CommErrorCode.UNKNOWN_ACTOR,
    });
  });

  it('the system actor owns no photo', async () => {
    // It is a constant, not a row. Resolving it must not fall through to a table.
    await expect(
      profile.setAvatar('00000000-0000-0000-0000-000000000000', KEY_A),
    ).rejects.toMatchObject({ code: CommErrorCode.PROFILE_NOT_AVAILABLE });
  });

  it('a learner is not a principal and owns nothing through this route', async () => {
    await expect(profile.setAvatar(s.learnerId, KEY_A)).rejects.toBeInstanceOf(CommError);
    expect(
      (await prisma.learner.findUniqueOrThrow({ where: { id: s.learnerId } })).avatarObjectKey,
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('the object key is validated for staff and teachers too', () => {
  for (const key of [
    'stories/abc',
    '../avatars/abc',
    'avatars/../../etc/passwd',
    'avatars//abc',
    'conversations/x/y',
    'avatars/',
    '',
    'https://evil.test/avatars/abc',
  ]) {
    it(`refuses ${JSON.stringify(key)} from a teacher`, async () => {
      await expect(profile.setAvatar(s.teacherId, key)).rejects.toMatchObject({
        code: CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED,
      });
      expect(await teacherKey(s.teacherId)).toBeNull();
    });
  }

  it('refuses a key outside the prefix from a staff member', async () => {
    await expect(profile.setAvatar(s.ownerId, 'stories/not-mine')).rejects.toBeInstanceOf(
      CommError,
    );
    expect(await staffKey(s.ownerId)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('the directory resolves the new keys', () => {
  it('returns a key for every kind that can hold one, and null for the rest', async () => {
    await profile.setAvatar(s.teacherId, KEY_A);
    await profile.setAvatar(s.ownerId, KEY_B);

    const resolved = await g.directory.resolveMany([
      { actorId: s.teacherId, actorKind: ActorKind.TEACHER },
      { actorId: s.ownerId, actorKind: ActorKind.STAFF },
      { actorId: s.parentId, actorKind: ActorKind.CONTACT },
    ]);

    expect(resolved.get(s.teacherId)!.avatarObjectKey).toBe(KEY_A);
    expect(resolved.get(s.ownerId)!.avatarObjectKey).toBe(KEY_B);
    expect(resolved.get(s.parentId)!.avatarObjectKey).toBeNull();
  });

  it('hands out a KEY and never a url -- signing stays the caller\'s act', async () => {
    await profile.setAvatar(s.teacherId, KEY_A);

    const resolved = await g.directory.resolveMany([
      { actorId: s.teacherId, actorKind: ActorKind.TEACHER },
    ]);
    const key = resolved.get(s.teacherId)!.avatarObjectKey!;

    expect(key).not.toMatch(/^https?:/);
    expect(key).not.toMatch(/sig=/);
  });
});

// ---------------------------------------------------------------------------
/**
 * `chat.teacher` projects a Core teacher, but `avatar_object_key` is Chat's own. These guard
 * the ownership split described in `20261005160000_chat_staff_teacher_avatars.sql`.
 */
describe('teacher projection safety', () => {
  it('a Core-style projection update does not clear the Chat-owned photo', async () => {
    await profile.setAvatar(s.teacherId, KEY_A);

    // Exactly the columns an ingestion path owns, enumerated -- which is the rule the
    // migration states. The avatar is not among them and must survive.
    await prisma.teacher.update({
      where: { id: s.teacherId },
      data: {
        name: 'teacher_c_renamed_by_core',
        coreTeacherId: '11111111-1111-4111-8111-111111111111',
        syncedAt: new Date(),
        isActive: true,
      },
    });

    const row = await prisma.teacher.findUniqueOrThrow({ where: { id: s.teacherId } });
    expect(row.avatarObjectKey).toBe(KEY_A);
    expect(row.name).toBe('teacher_c_renamed_by_core');
    expect(row.syncedAt).not.toBeNull();
  });

  it('no production code writes chat.teacher, so nothing can clobber it today', () => {
    // A guard against the future, not a behaviour test. If an ingestion path is added, this
    // fails and whoever adds it has to read the ownership rule and enumerate its columns.
    //
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    const hits = execSync(
      "grep -rn 'prisma\\.teacher\\.\\(create\\|update\\|upsert\\|createMany\\|updateMany\\)' src || true",
      { cwd: `${__dirname}/../..`, encoding: 'utf8' },
    ).trim();

    expect(hits).toBe('');
  });
});

// ---------------------------------------------------------------------------
describe('a message carries its sender\'s face, from the same identity as the name', () => {
  async function groupWithMessages() {
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
    await g.messages.send({ conversationId: group.id, senderId: s.ownerId, body: 'from admin' });
    await g.messages.send({ conversationId: group.id, senderId: s.parentId, body: 'from parent' });
    return group;
  }

  it('an admin-authored message carries the admin photo', async () => {
    await profile.setAvatar(s.ownerId, KEY_A);
    const group = await groupWithMessages();

    const { messages } = await g.messages.list({
      conversationId: group.id,
      actorId: s.parentId,
    });
    const fromAdmin = messages.find((m) => m.authorId === s.ownerId)!;

    expect(fromAdmin.authorAvatarUrl).toMatch(/^https?:\/\//);
    expect(fromAdmin.authorName).toBeTruthy();
  });

  it('a sender with no photo is null, which draws initials', async () => {
    const group = await groupWithMessages();

    const { messages } = await g.messages.list({
      conversationId: group.id,
      actorId: s.parentId,
    });

    for (const m of messages) {
      expect(m.authorAvatarUrl).toBeNull();
      // The name is unaffected by the absence of a photo.
      if (m.authorId) expect(m.authorName).toBeTruthy();
    }
  });

  it('the name and the photo cannot come from different people', async () => {
    await profile.setAvatar(s.ownerId, KEY_A);
    await profile.setAvatar(s.parentId, KEY_B);
    const group = await groupWithMessages();

    const { messages } = await g.messages.list({
      conversationId: group.id,
      actorId: s.parentId,
    });

    const admin = messages.find((m) => m.authorId === s.ownerId)!;
    const parent = messages.find((m) => m.authorId === s.parentId)!;

    // Each author's url is signed over THEIR key. Compare the object paths, since the
    // signatures differ per minting.
    expect(new URL(admin.authorAvatarUrl!).pathname).toContain(encodeURIComponent(KEY_A));
    expect(new URL(parent.authorAvatarUrl!).pathname).toContain(encodeURIComponent(KEY_B));
    expect(admin.authorAvatarUrl).not.toBe(parent.authorAvatarUrl);
  });

  it('no object key reaches the client, at any depth', async () => {
    await profile.setAvatar(s.ownerId, KEY_A);
    const group = await groupWithMessages();

    const { messages } = await g.messages.list({
      conversationId: group.id,
      actorId: s.parentId,
    });

    const json = JSON.stringify(messages);
    expect(json).not.toMatch(/avatarObjectKey/);
    expect(json).not.toMatch(/"avatars\//);
  });

  it('a system message is not given a sender photo', async () => {
    await profile.setAvatar(s.ownerId, KEY_A);
    const group = await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);

    const { messages } = await g.messages.list({
      conversationId: group.id,
      actorId: s.parentId,
    });

    for (const m of messages.filter((x) => x.authorKind === 'system' || x.type === 'system')) {
      expect(m.authorAvatarUrl).toBeNull();
    }
  });

  it('VISIBILITY FIRST: an outsider cannot read the page, so nothing is signed for them',
    async () => {
      const other = await seedSecondFamily(prisma);
      await profile.setAvatar(s.ownerId, KEY_A);
      const group = await groupWithMessages();

      // Refused before any author is resolved or signed. An id appearing in a message is
      // never on its own a reason to mint a URL.
      await expect(
        g.messages.list({ conversationId: group.id, actorId: other.parentId }),
      ).rejects.toBeInstanceOf(CommError);
    });
});
