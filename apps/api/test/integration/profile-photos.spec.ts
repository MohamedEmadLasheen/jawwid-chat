/**
 * Profile photos in chat, end to end against the real schema (owner decision
 * 2026-10-19: everyone, WhatsApp-style, children included).
 *
 *   A. a parent sets their own photo; the group shows it to its members, and
 *      the link serves the stored bytes
 *   B. a parent sets their child's photo; the database's key CHECK holds it
 *      to the child's own prefix
 *   C. a staff photo reaches a PARENT through a message they can read -- not
 *      through the staff directory's rule
 *   D. the same link stops working when the reader leaves the conversation,
 *      and a reader of another conversation is never served
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalFsBlobStore } from '@communication/attachments/blob-store';
import { SignedLocalObjectStorage } from '@communication/attachments/object-storage';
import { MediaController } from '@communication/api/media.controller';
import { AvatarService } from '@communication/profile/avatar.service';
import { PrismaAuditService } from '@platform/audit.service';
import { png } from '../support/images';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;
let groupId: string;
let root: string;
let media: MediaController;
let avatars: AvatarService;
const originalRoot = process.env.STORAGE_LOCAL_ROOT;
const photo = png(256, 256);

function fakeRes() {
  const state = { status: 0, headers: {} as Record<string, string>, body: Buffer.alloc(0) as Buffer };
  const res = {
    status(code: number) { state.status = code; return res; },
    setHeader(name: string, value: string) { state.headers[name] = value; },
    send(body?: string | Buffer) { state.body = Buffer.isBuffer(body) ? body : Buffer.from(body ?? ''); },
    write(chunk: Uint8Array) { state.body = Buffer.concat([state.body, Buffer.from(chunk)]); return true; },
    end() {},
  };
  return { res, state };
}

/** Fetch a /media/avatars link exactly as the route would. */
async function fetchAvatar(url: string) {
  const u = new URL(url, 'http://api.test');
  const id = u.pathname.split('/').pop()!;
  const r = fakeRes();
  await media.avatar(id, u.searchParams.get('v')!, u.searchParams.get('a')!, u.searchParams.get('e')!, u.searchParams.get('s')!, { headers: {} }, r.res);
  return r.state;
}

/** Upload real PNG bytes through the two-step flow and commit them. */
async function setPhoto(actorId: string, target: { kind: 'self' } | { kind: 'child'; learnerId: string }) {
  const grant = await avatars.authorizeUpload(actorId, target, { mimeType: 'image/png', byteSize: photo.length });
  await new LocalFsBlobStore().put(grant.objectKey, 'image/png', photo);
  const out = await avatars.commit(actorId, target, { objectKey: grant.objectKey });
  return { objectKey: grant.objectKey, avatarUrl: out.avatarUrl };
}

beforeAll(async () => { await g.prisma.$connect(); });
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
  if (originalRoot === undefined) delete process.env.STORAGE_LOCAL_ROOT;
  else process.env.STORAGE_LOCAL_ROOT = originalRoot;
});
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'jawwid-photos-'));
  process.env.STORAGE_LOCAL_ROOT = root;
  const storage = new SignedLocalObjectStorage();
  avatars = new AvatarService(g.prisma, g.conversations, storage, new PrismaAuditService());
  media = new MediaController(g.prisma, g.messages, storage, g.stories, avatars);
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  groupId = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('A · a parent sets their own photo, and the group sees it', () => {
  it('commits under the parent prefix, audits it, and every member gets a working link', async () => {
    const { objectKey, avatarUrl } = await setPhoto(s.parentId, { kind: 'self' });
    expect(objectKey.startsWith(`avatars/contact/${s.parentId}/`)).toBe(true);
    const row = await g.prisma.contact.findUnique({ where: { id: s.parentId } });
    expect(row?.avatarObjectKey).toBe(objectKey);
    const audit = await g.prisma.$queryRawUnsafe<Array<{ action: string }>>(
      `select action from chat.audit_log where entity = 'contact' and entity_id = '${s.parentId}'::uuid`,
    );
    expect(audit.map((a) => a.action)).toContain('profile_photo.set');

    // The owner's own link serves the bytes.
    const own = await fetchAvatar(avatarUrl!);
    expect(own.status).toBe(200);
    expect(Buffer.compare(own.body, photo)).toBe(0);
    expect(own.headers['Content-Type']).toBe('image/png');

    // The teacher, a member of the group, sees the parent among the members.
    const { members } = await g.conversations.readWithMembers(groupId, s.teacherId);
    const parent = members.find((m) => m.actorId === s.parentId)!;
    expect(parent.avatarUrl).toContain(`/media/avatars/contact.${s.parentId}.${groupId}`);
    expect(parent.avatarUrl).not.toContain(objectKey);
    const seen = await fetchAvatar(parent.avatarUrl!);
    expect(seen.status).toBe(200);
    expect(Buffer.compare(seen.body, photo)).toBe(0);
  });

  it('a member with no photo carries null, never a link to nothing', async () => {
    const { members } = await g.conversations.readWithMembers(groupId, s.parentId);
    expect(members.find((m) => m.actorId === s.teacherId)?.avatarUrl).toBeNull();
  });
});

describe('B · a child photo, set by a parent', () => {
  it("lands under the child's own prefix and is shown on the child's group", async () => {
    const { objectKey } = await setPhoto(s.parentId, { kind: 'child', learnerId: s.learnerId });
    expect(objectKey.startsWith(`avatars/learner/${s.learnerId}/`)).toBe(true);
    const list = await g.prisma.learner.findUnique({ where: { id: s.learnerId } });
    expect(list?.avatarObjectKey).toBe(objectKey);
    // A teacher of the group reaches it through the group.
    const { signAvatar } = await import('@communication/profile/avatar-urls');
    const url = signAvatar('learner', s.learnerId, groupId, s.teacherId, objectKey)!;
    expect((await fetchAvatar(url)).status).toBe(200);
    // ...and an unrelated teacher cannot, even with a correctly signed link of their own.
    const outsider = signAvatar('learner', s.learnerId, groupId, s.unrelatedTeacherId, objectKey)!;
    expect((await fetchAvatar(outsider)).status).toBe(404);
  });

  it("the database itself refuses a child's photo under the parent's prefix", async () => {
    const wrong = `avatars/contact/${s.parentId}/${randomUUID()}`;
    await expect(
      g.prisma.learner.update({ where: { id: s.learnerId }, data: { avatarObjectKey: wrong } }),
    ).rejects.toThrow();
  });
});

describe("B2 · a family group is pictured by its one child", () => {
  it('signs the linked child as the group picture, and only for a group about exactly one child', async () => {
    const { objectKey } = await setPhoto(s.parentId, { kind: 'child', learnerId: s.learnerId });
    const one = await g.conversations.createFamilyGroup(s.ownerId, { learnerIds: [s.learnerId], contactIds: [s.parentId], teacherIds: [] });
    const two = await g.conversations.createFamilyGroup(s.ownerId, { learnerIds: [s.learnerId, s.secondLearnerId], contactIds: [s.parentId], teacherIds: [] });
    const children = await g.conversations.soleChildOf([{ id: one.id }, { id: two.id }]);
    expect(children.get(one.id)).toEqual({ id: s.learnerId, avatarObjectKey: objectKey });
    expect(children.has(two.id)).toBe(false);
    // The parent, a member, is served the picture through that group.
    const { signAvatar } = await import('@communication/profile/avatar-urls');
    expect((await fetchAvatar(signAvatar('learner', s.learnerId, one.id, s.parentId, objectKey)!)).status).toBe(200);
  });
});

describe('C · a staff photo reaches a parent through a message they can read', () => {
  it("is signed on the message's author and served to the parent", async () => {
    const key = `avatars/staff/${s.ownerId}/${randomUUID()}`;
    await new LocalFsBlobStore().put(key, 'image/png', photo);
    await g.prisma.$executeRawUnsafe(`update chat.staff set avatar_object_key = '${key}' where id = '${s.ownerId}'::uuid`);
    const sent = await g.messages.send({ conversationId: groupId, senderId: s.ownerId, type: 'text', body: 'welcome', clientMessageId: randomUUID() });
    const page = await g.messages.list({ conversationId: groupId, actorId: s.parentId });
    const m = page.messages.find((x) => x.id === sent.id)!;
    expect(m.authorAvatarUrl).toContain(`/media/avatars/staff.${s.ownerId}.${groupId}`);
    expect((await fetchAvatar(m.authorAvatarUrl!)).status).toBe(200);
  });
});

describe('D · the link is not the authorization', () => {
  it('stops serving the moment the reader leaves the conversation', async () => {
    const { members } = await (async () => {
      await setPhoto(s.parentId, { kind: 'self' });
      return g.conversations.readWithMembers(groupId, s.teacherId);
    })();
    const url = members.find((m) => m.actorId === s.parentId)!.avatarUrl!;
    expect((await fetchAvatar(url)).status).toBe(200);
    await g.prisma.conversationMember.updateMany({
      where: { conversationId: groupId, actorId: s.teacherId },
      data: { leftAt: new Date() },
    });
    expect((await fetchAvatar(url)).status).toBe(404);
  });

  it('a tampered link (another target, same signature) is refused', async () => {
    const { avatarUrl } = await setPhoto(s.parentId, { kind: 'self' });
    const forged = avatarUrl!.replace(`contact.${s.parentId}.self`, `contact.${s.otherParentId}.self`);
    expect((await fetchAvatar(forged)).status).toBe(403);
  });
});
