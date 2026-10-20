/**
 * Profile photos for everyone in a chat (owner decision 2026-10-19,
 * WhatsApp-style): the two decisions that matter are WHOSE FACE YOU CAN WEAR
 * (the write path's key and bytes) and WHOSE FACE YOU CAN SEE (the per-request
 * read rule). Both are exercised here against fakes of exactly the reads the
 * service makes; the database's own CHECK constraint and the live routes are
 * covered by the integration specs.
 */
import { randomUUID } from 'node:crypto';
import { AvatarService } from '../../../src/communication/profile/avatar.service';
import { signAvatar } from '../../../src/communication/profile/avatar-urls';
import { avatarKeyOf } from '../../../src/platform/avatar-keys';
import { MediaUrlSigner } from '../../../src/platform/media-url';
import { CommError, CommErrorCode } from '../../../src/platform/errors';
import type { Actor } from '../../../src/platform/types';
import { png } from '../../support/images';

const ORG = randomUUID();
const OTHER_ORG = randomUUID();
const FAMILY = randomUUID();
const OTHER_FAMILY = randomUUID();

const key = (kind: string, id: string) => `avatars/${kind}/${id}/${randomUUID()}`;

function actor(kind: Actor['kind'], over: Partial<Actor> = {}): Actor {
  return { actorId: randomUUID(), kind, displayName: kind, locale: 'en', isActive: true, organizationId: ORG, ...over };
}

interface Row { id: string; organizationId: string; familyId: string | null; avatarObjectKey: string | null }

function world() {
  const rows: Record<'staff' | 'teacher' | 'contact' | 'learner', Map<string, Row>> = {
    staff: new Map(), teacher: new Map(), contact: new Map(), learner: new Map(),
  };
  const actors = new Map<string, Actor>();
  const conversations = new Map<string, { id: string; organizationId: string; learnerId: string | null }>();
  const readable = new Set<string>(); // `${viewer}:${conversation}`
  const members: Array<{ conversationId: string; actorId: string; actorKind: string }> = [];
  const authored: Array<{ conversationId: string; authorId: string; authorType: string }> = [];
  const linkedLearners: Array<{ conversationId: string; learnerId: string }> = [];
  const stored = new Map<string, { head: Buffer; byteSize: number; contentType: string }>();
  const deleted: string[] = [];
  const audits: unknown[] = [];
  const updates: Array<{ kind: string; where: unknown; data: unknown }> = [];

  const table = (kind: keyof typeof rows) => ({
    findUnique: async ({ where }: { where: { id: string } }) => rows[kind].get(where.id) ?? null,
    updateMany: async ({ where, data }: { where: { id: string }; data: { avatarObjectKey: string | null } }) => {
      updates.push({ kind, where, data });
      const r = rows[kind].get(where.id);
      if (!r) return { count: 0 };
      r.avatarObjectKey = data.avatarObjectKey;
      return { count: 1 };
    },
  });
  const prisma = {
    staff: table('staff'),
    teacher: table('teacher'),
    contact: table('contact'),
    learner: { ...table('learner'), findMany: async () => [] },
    conversationLearner: {
      findFirst: async ({ where }: { where: { conversationId: string; learnerId: string } }) =>
        linkedLearners.find((l) => l.conversationId === where.conversationId && l.learnerId === where.learnerId) ?? null,
    },
    conversationMember: {
      findFirst: async ({ where }: { where: { conversationId: string; actorId: string; actorKind: string } }) =>
        members.find((m) => m.conversationId === where.conversationId && m.actorId === where.actorId && m.actorKind === where.actorKind) ?? null,
    },
    message: {
      findFirst: async ({ where }: { where: { conversationId: string; authorId: string; authorType: string } }) =>
        authored.find((m) => m.conversationId === where.conversationId && m.authorId === where.authorId && m.authorType === where.authorType) ?? null,
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  };
  const conversationService = {
    requireActor: async (id: string) => {
      const a = actors.get(id);
      if (!a) throw new CommError(CommErrorCode.UNKNOWN_ACTOR, 'unknown', 401);
      return a;
    },
    requireConversation: async (id: string) => {
      const c = conversations.get(id);
      if (!c) throw new CommError(CommErrorCode.CONVERSATION_NOT_FOUND, 'nope', 404);
      return c;
    },
    membershipOf: async () => null,
    canReadResolved: async (viewer: Actor, conv: { id: string }) => ({ allowed: readable.has(`${viewer.actorId}:${conv.id}`) }),
  };
  const storage = {
    authorizeUpload: async ({ prefix }: { prefix: string }) => ({ objectKey: `${prefix}/${randomUUID()}`, uploadUrl: 'x', method: 'PUT', headers: {}, expiresAt: '' }),
    readHead: async (k: string) => stored.get(k) ?? null,
    delete: async (k: string) => void deleted.push(k),
  };
  const audit = { audit: async (_tx: unknown, input: unknown) => void audits.push(input), event: async () => undefined };
  const service = new AvatarService(prisma as never, conversationService as never, storage as never, audit as never);

  const person = (kind: 'staff' | 'teacher' | 'contact', over: Partial<Actor> = {}, photo = true) => {
    const a = actor(kind, over);
    actors.set(a.actorId, a);
    rows[kind].set(a.actorId, {
      id: a.actorId,
      organizationId: a.organizationId!,
      familyId: a.familyId ?? null,
      avatarObjectKey: photo ? key(kind, a.actorId) : null,
    });
    return a;
  };
  const child = (familyId: string, photo = true) => {
    const id = randomUUID();
    rows.learner.set(id, { id, organizationId: ORG, familyId, avatarObjectKey: photo ? key('learner', id) : null });
    return id;
  };
  const conversation = (learnerId: string | null = null, organizationId = ORG) => {
    const id = randomUUID();
    conversations.set(id, { id, organizationId, learnerId });
    return id;
  };
  return { service, rows, readable, members, authored, linkedLearners, stored, deleted, audits, updates, person, child, conversation };
}

const notFound = expect.objectContaining({ code: CommErrorCode.PROFILE_PHOTO_NOT_FOUND, status: 404 });

describe('avatar keys are structural', () => {
  const id = randomUUID();
  it('accepts exactly avatars/<kind>/<owner>/<uuid>', () => {
    expect(avatarKeyOf('contact', id, `avatars/contact/${id}/${randomUUID()}`)).toBe(true);
  });
  it.each([
    ['another owner', `avatars/contact/${randomUUID()}/${randomUUID()}`],
    ['a suffix on the owner id', `avatars/contact/${id}x/${randomUUID()}`],
    ['another kind', `avatars/teacher/${id}/${randomUUID()}`],
    ['a child photo under the parent prefix', `avatars/contact/${id}/${randomUUID()}`.replace('contact', 'learner').replace(id, randomUUID())],
    ['a flat legacy key', `avatars/${randomUUID()}`],
    ['traversal', `avatars/contact/${id}/../${randomUUID()}`],
    ['not a uuid', `avatars/contact/${id}/photo.jpg`],
  ])('refuses %s', (_label, k) => {
    expect(avatarKeyOf('contact', id, k)).toBe(false);
  });
});

describe('avatar links', () => {
  const viewer = randomUUID();
  const target = randomUUID();
  const conv = randomUUID();
  const k1 = key('teacher', target);

  it('are absent without a photo', () => {
    expect(signAvatar('teacher', target, conv, viewer, null)).toBeNull();
  });

  it('stay the same url for a whole bucket, so an image cache keeps the picture', () => {
    const t0 = Date.UTC(2026, 9, 19, 10, 5);
    expect(signAvatar('teacher', target, conv, viewer, k1, t0)).toBe(signAvatar('teacher', target, conv, viewer, k1, t0 + 40 * 60_000));
  });

  it('change when the photo changes, and verify as an avatars link for that viewer only', () => {
    const t0 = Date.now();
    const a = signAvatar('teacher', target, conv, viewer, k1, t0)!;
    const b = signAvatar('teacher', target, conv, viewer, key('teacher', target), t0)!;
    expect(a).not.toBe(b);
    const u = new URL(a, 'http://x');
    expect(u.pathname).toMatch(new RegExp(`/media/avatars/teacher\\.${target}\\.${conv}$`));
    const claims = {
      kind: 'avatars' as const,
      attachmentId: `teacher.${target}.${conv}`,
      variant: 'o' as const,
      actorId: u.searchParams.get('a')!,
      expires: Number(u.searchParams.get('e')),
      sig: u.searchParams.get('s')!,
    };
    const signer = new MediaUrlSigner();
    expect(signer.verify(claims)).toBe(true);
    expect(signer.verify({ ...claims, actorId: randomUUID() })).toBe(false);
    expect(signer.verify({ ...claims, attachmentId: `teacher.${randomUUID()}.${conv}` })).toBe(false);
    // The object key itself never appears in the link.
    expect(a).not.toContain(k1);
  });
});

describe('who may SEE a photo -- decided per request', () => {
  it('a member of a conversation sees a fellow member, including staff (WhatsApp-style)', async () => {
    const w = world();
    const parent = w.person('contact', { familyId: FAMILY });
    const admin = w.person('staff');
    const conv = w.conversation();
    w.readable.add(`${parent.actorId}:${conv}`);
    w.members.push({ conversationId: conv, actorId: admin.actorId, actorKind: 'staff' });
    await expect(w.service.authorizeAvatarRead(parent.actorId, `staff.${admin.actorId}.${conv}`)).resolves.toEqual({
      objectKey: w.rows.staff.get(admin.actorId)!.avatarObjectKey,
    });
  });

  it('an author who was never a member (a super admin stepping in) is visible where they wrote', async () => {
    const w = world();
    const parent = w.person('contact', { familyId: FAMILY });
    const owner = w.person('staff');
    const conv = w.conversation();
    w.readable.add(`${parent.actorId}:${conv}`);
    w.authored.push({ conversationId: conv, authorId: owner.actorId, authorType: 'staff' });
    await expect(w.service.authorizeAvatarRead(parent.actorId, `staff.${owner.actorId}.${conv}`)).resolves.toBeTruthy();
  });

  it('a conversation the viewer cannot read (anymore) shows nothing', async () => {
    const w = world();
    const parent = w.person('contact', { familyId: FAMILY });
    const teacher = w.person('teacher');
    const conv = w.conversation();
    w.members.push({ conversationId: conv, actorId: teacher.actorId, actorKind: 'teacher' });
    await expect(w.service.authorizeAvatarRead(parent.actorId, `teacher.${teacher.actorId}.${conv}`)).rejects.toEqual(notFound);
  });

  it('someone who is not part of that conversation is not shown through it', async () => {
    const w = world();
    const parent = w.person('contact', { familyId: FAMILY });
    const stranger = w.person('teacher');
    const conv = w.conversation();
    w.readable.add(`${parent.actorId}:${conv}`);
    await expect(w.service.authorizeAvatarRead(parent.actorId, `teacher.${stranger.actorId}.${conv}`)).rejects.toEqual(notFound);
  });

  it('a person of another organization is never shown, even if a row says they were a member', async () => {
    const w = world();
    const parent = w.person('contact', { familyId: FAMILY });
    const foreign = w.person('teacher', { organizationId: OTHER_ORG });
    const conv = w.conversation();
    w.readable.add(`${parent.actorId}:${conv}`);
    w.members.push({ conversationId: conv, actorId: foreign.actorId, actorKind: 'teacher' });
    await expect(w.service.authorizeAvatarRead(parent.actorId, `teacher.${foreign.actorId}.${conv}`)).rejects.toEqual(notFound);
  });

  it('a child is shown in the group about them -- the student group, or a family group that links them', async () => {
    const w = world();
    const teacher = w.person('teacher');
    const kid = w.child(FAMILY);
    const studentGroup = w.conversation(kid);
    const familyGroup = w.conversation();
    w.linkedLearners.push({ conversationId: familyGroup, learnerId: kid });
    w.readable.add(`${teacher.actorId}:${studentGroup}`).add(`${teacher.actorId}:${familyGroup}`);
    await expect(w.service.authorizeAvatarRead(teacher.actorId, `learner.${kid}.${studentGroup}`)).resolves.toBeTruthy();
    await expect(w.service.authorizeAvatarRead(teacher.actorId, `learner.${kid}.${familyGroup}`)).resolves.toBeTruthy();
    const unrelated = w.conversation();
    w.readable.add(`${teacher.actorId}:${unrelated}`);
    await expect(w.service.authorizeAvatarRead(teacher.actorId, `learner.${kid}.${unrelated}`)).rejects.toEqual(notFound);
  });

  it('`self` is your own photo or your own child, nobody else', async () => {
    const w = world();
    const parent = w.person('contact', { familyId: FAMILY });
    const other = w.person('contact', { familyId: OTHER_FAMILY });
    const mine = w.child(FAMILY);
    const theirs = w.child(OTHER_FAMILY);
    await expect(w.service.authorizeAvatarRead(parent.actorId, `contact.${parent.actorId}.self`)).resolves.toBeTruthy();
    await expect(w.service.authorizeAvatarRead(parent.actorId, `learner.${mine}.self`)).resolves.toBeTruthy();
    await expect(w.service.authorizeAvatarRead(parent.actorId, `contact.${other.actorId}.self`)).rejects.toEqual(notFound);
    await expect(w.service.authorizeAvatarRead(parent.actorId, `learner.${theirs}.self`)).rejects.toEqual(notFound);
  });

  it('a malformed id or a stored key outside its owner prefix reads as absent', async () => {
    const w = world();
    const parent = w.person('contact', { familyId: FAMILY });
    w.rows.contact.get(parent.actorId)!.avatarObjectKey = key('contact', randomUUID());
    await expect(w.service.authorizeAvatarRead(parent.actorId, `contact.${parent.actorId}.self`)).rejects.toEqual(notFound);
    await expect(w.service.authorizeAvatarRead(parent.actorId, 'contact.not-a-uuid.self')).rejects.toEqual(notFound);
    await expect(w.service.authorizeAvatarRead(parent.actorId, `wizard.${parent.actorId}.self`)).rejects.toEqual(notFound);
  });
});

describe('whose face you can WEAR -- the write path', () => {
  const goodPhoto = () => {
    const bytes = png(256, 256);
    return { head: bytes, byteSize: bytes.length, contentType: 'image/png' };
  };

  it('a teacher uploads under their own prefix; staff are sent to their staff profile', async () => {
    const w = world();
    const teacher = w.person('teacher', {}, false);
    const grant = await w.service.authorizeUpload(teacher.actorId, { kind: 'self' }, { mimeType: 'image/png', byteSize: 1000 });
    expect(grant.objectKey.startsWith(`avatars/teacher/${teacher.actorId}/`)).toBe(true);
    const admin = w.person('staff');
    await expect(w.service.authorizeUpload(admin.actorId, { kind: 'self' }, { mimeType: 'image/png', byteSize: 1000 })).rejects.toEqual(
      expect.objectContaining({ code: CommErrorCode.PROFILE_PHOTO_DENIED, status: 403 }),
    );
  });

  it('refuses a type or size outside the photo rules before anything is issued', async () => {
    const w = world();
    const parent = w.person('contact', { familyId: FAMILY }, false);
    const invalid = expect.objectContaining({ code: CommErrorCode.PROFILE_PHOTO_INVALID, status: 400 });
    await expect(w.service.authorizeUpload(parent.actorId, { kind: 'self' }, { mimeType: 'image/gif', byteSize: 10 })).rejects.toEqual(invalid);
    await expect(w.service.authorizeUpload(parent.actorId, { kind: 'self' }, { mimeType: 'image/png', byteSize: 3 * 1024 * 1024 })).rejects.toEqual(invalid);
  });

  it('a key lifted from someone else is never worn, and nothing is read or written', async () => {
    const w = world();
    const parent = w.person('contact', { familyId: FAMILY }, false);
    const victim = w.person('contact', { familyId: OTHER_FAMILY });
    const lifted = w.rows.contact.get(victim.actorId)!.avatarObjectKey!;
    w.stored.set(lifted, goodPhoto());
    await expect(w.service.commit(parent.actorId, { kind: 'self' }, { objectKey: lifted })).rejects.toEqual(
      expect.objectContaining({ code: CommErrorCode.PROFILE_PHOTO_INVALID }),
    );
    expect(w.updates).toHaveLength(0);
    expect(w.deleted).toHaveLength(0);
  });

  it("a child's photo must sit under the child's own prefix, not the parent's", async () => {
    const w = world();
    const parent = w.person('contact', { familyId: FAMILY }, false);
    const kid = w.child(FAMILY, false);
    const underParent = key('contact', parent.actorId);
    w.stored.set(underParent, goodPhoto());
    await expect(w.service.commit(parent.actorId, { kind: 'child', learnerId: kid }, { objectKey: underParent })).rejects.toEqual(
      expect.objectContaining({ code: CommErrorCode.PROFILE_PHOTO_INVALID }),
    );
    const grant = await w.service.authorizeUpload(parent.actorId, { kind: 'child', learnerId: kid }, { mimeType: 'image/png', byteSize: 900 });
    expect(grant.objectKey.startsWith(`avatars/learner/${kid}/`)).toBe(true);
  });

  it("another family's child, or a child seen by a teacher, cannot be changed", async () => {
    const w = world();
    const parent = w.person('contact', { familyId: FAMILY });
    const teacher = w.person('teacher');
    const theirs = w.child(OTHER_FAMILY);
    await expect(w.service.authorizeUpload(parent.actorId, { kind: 'child', learnerId: theirs }, { mimeType: 'image/png', byteSize: 9 })).rejects.toEqual(notFound);
    await expect(w.service.remove(teacher.actorId, { kind: 'child', learnerId: theirs })).rejects.toEqual(notFound);
    expect(w.rows.learner.get(theirs)!.avatarObjectKey).not.toBeNull();
  });

  it('commits a real photo: one column, one audit row, the old object deleted, a link for the owner', async () => {
    const w = world();
    const parent = w.person('contact', { familyId: FAMILY });
    const previous = w.rows.contact.get(parent.actorId)!.avatarObjectKey!;
    const next = key('contact', parent.actorId);
    w.stored.set(next, goodPhoto());
    const out = await w.service.commit(parent.actorId, { kind: 'self' }, { objectKey: next });
    expect(w.rows.contact.get(parent.actorId)!.avatarObjectKey).toBe(next);
    expect(w.updates).toEqual([{ kind: 'contact', where: { id: parent.actorId, organizationId: ORG }, data: { avatarObjectKey: next } }]);
    expect(w.audits).toEqual([expect.objectContaining({ action: 'profile_photo.set', entity: 'contact', entityId: parent.actorId })]);
    expect(w.deleted).toEqual([previous]);
    expect(out.avatarUrl).toContain(`/media/avatars/contact.${parent.actorId}.self`);
  });

  it('judges the stored bytes, not the claim: a non-image is deleted and refused', async () => {
    const w = world();
    const parent = w.person('contact', { familyId: FAMILY }, false);
    const k = key('contact', parent.actorId);
    w.stored.set(k, { head: Buffer.from('not an image at all'), byteSize: 19, contentType: 'image/png' });
    await expect(w.service.commit(parent.actorId, { kind: 'self' }, { objectKey: k })).rejects.toEqual(
      expect.objectContaining({ code: CommErrorCode.PROFILE_PHOTO_INVALID }),
    );
    expect(w.deleted).toEqual([k]);
    expect(w.rows.contact.get(parent.actorId)!.avatarObjectKey).toBeNull();
  });
});
