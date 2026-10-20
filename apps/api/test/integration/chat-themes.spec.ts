/**
 * Chat themes (owner decisions 2026-10-20: PRIVATE to the viewer; presets plus
 * the viewer's own photo; stored on the server).
 *
 *   A. a preset is the viewer's own: nobody else's chat changes
 *   B. a wallpaper photo: own prefix only, real image only, replaced and
 *      removed objects are deleted
 *   C. a wallpaper is served to its OWNER only, and only while they can read
 *   D. the database refuses a key that names another viewer or chat
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { LocalFsBlobStore } from '@communication/attachments/blob-store';
import { ConversationController } from '@communication/api/conversation.controller';
import { MediaController } from '@communication/api/media.controller';
import { ChatThemeService } from '@communication/themes/chat-theme.service';
import { CommErrorCode } from '@platform/errors';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

// The graph's storage reads its root when it is built.
const originalRoot = process.env.STORAGE_LOCAL_ROOT;
const root = mkdtempSync(join(tmpdir(), 'jawwid-themes-'));
process.env.STORAGE_LOCAL_ROOT = root;
const g = buildGraph();
let s: Scenario;
let groupId: string;
let themes: ChatThemeService;
let controller: ConversationController;
const blobs = () => new LocalFsBlobStore();

/** A real PNG of the given size (solid colour), so the server's inspection sees a true image. */
function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x7a)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function uploadWallpaper(actorId: string, conversationId: string, bytes: Buffer): Promise<string> {
  const auth = await themes.authorizeWallpaperUpload(actorId, conversationId, { mimeType: 'image/png', byteSize: bytes.length });
  await blobs().put(auth.objectKey, 'image/png', bytes);
  return auth.objectKey;
}

const stateOf = async (actorId: string, conversationId = groupId) =>
  (await controller.list(actorId)).conversations.find((c) => c.id === conversationId)!.viewerState!;
const code = (c: CommErrorCode) => expect.objectContaining({ code: c });

beforeAll(async () => { await g.prisma.$connect(); });
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
  rmSync(root, { recursive: true, force: true });
  if (originalRoot === undefined) delete process.env.STORAGE_LOCAL_ROOT;
  else process.env.STORAGE_LOCAL_ROOT = originalRoot;
});
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  groupId = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;
  themes = new ChatThemeService(g.prisma, g.conversations, g.storage);
  controller = new ConversationController(g.conversations, g.messages, g.calls, g.authz);
});

describe('A · a preset is the viewer\'s own', () => {
  it('sets, changes and clears the caller\'s theme; nobody else\'s view changes', async () => {
    await themes.setTheme(s.parentId, groupId, 'sand');
    expect((await stateOf(s.parentId)).theme).toBe('sand');
    expect((await stateOf(s.ownerId)).theme).toBeNull();

    await expect(themes.setTheme(s.ownerId, groupId, 'night_mode')).rejects.toEqual(code(CommErrorCode.CHAT_THEME_INVALID));
    // An absent field is refused; only an explicit null resets (review fix, PR #72).
    await themes.setTheme(s.ownerId, groupId, 'sand');
    await expect(themes.setTheme(s.ownerId, groupId, undefined)).rejects.toEqual(code(CommErrorCode.CHAT_THEME_INVALID));
    expect((await stateOf(s.ownerId)).theme).toBe('sand');
    await themes.setTheme(s.parentId, groupId, null);
    expect((await stateOf(s.parentId)).theme).toBeNull();
  });

  it('cannot theme a chat one cannot open', async () => {
    await expect(themes.setTheme(s.unrelatedTeacherId, groupId, 'sky')).rejects.toBeTruthy();
    expect(await g.prisma.conversationParticipantState.count({ where: { actorId: s.unrelatedTeacherId } })).toBe(0);
  });
});

describe('B · a wallpaper photo', () => {
  it('commits a real image under the caller\'s own prefix; replacing and removing delete the old object', async () => {
    const first = await uploadWallpaper(s.parentId, groupId, png(400, 300));
    expect(first.startsWith(`wallpapers/${s.parentId}/${groupId}/`)).toBe(true);
    const { wallpaperUrl } = await themes.commitWallpaper(s.parentId, groupId, { objectKey: first });
    expect(wallpaperUrl).toMatch(new RegExp(`/media/wallpapers/${groupId}\\?`));
    expect((await stateOf(s.parentId)).wallpaperUrl).toBeTruthy();
    expect((await stateOf(s.ownerId)).wallpaperUrl).toBeNull();

    const second = await uploadWallpaper(s.parentId, groupId, png(300, 400));
    await themes.commitWallpaper(s.parentId, groupId, { objectKey: second });
    expect(await blobs().get(first)).toBeNull();
    expect(await blobs().get(second)).not.toBeNull();

    await themes.removeWallpaper(s.parentId, groupId);
    expect(await blobs().get(second)).toBeNull();
    expect((await stateOf(s.parentId)).wallpaperUrl).toBeNull();
  });

  it('refuses another viewer\'s key, and a file that is not an acceptable image (which is deleted)', async () => {
    const parents = await uploadWallpaper(s.parentId, groupId, png(400, 300));
    await expect(themes.commitWallpaper(s.ownerId, groupId, { objectKey: parents })).rejects.toEqual(code(CommErrorCode.CHAT_THEME_INVALID));

    // Each refusal has its own code, so the clients can word it (review fix, PR #72).
    const tiny = await uploadWallpaper(s.ownerId, groupId, png(50, 50));
    await expect(themes.commitWallpaper(s.ownerId, groupId, { objectKey: tiny })).rejects.toEqual(code(CommErrorCode.CHAT_WALLPAPER_DIMENSIONS));
    expect(await blobs().get(tiny)).toBeNull();

    await expect(themes.authorizeWallpaperUpload(s.ownerId, groupId, { mimeType: 'image/gif', byteSize: 10 })).rejects.toEqual(
      code(CommErrorCode.CHAT_WALLPAPER_TYPE),
    );
    await expect(themes.authorizeWallpaperUpload(s.ownerId, groupId, { mimeType: 'image/png', byteSize: 5 * 1024 * 1024 })).rejects.toEqual(
      code(CommErrorCode.CHAT_WALLPAPER_TOO_LARGE),
    );
  });

  it('uploads never committed do not pile up: one pending upload per viewer and chat (review fix, PR #72)', async () => {
    const keys: string[] = [];
    for (let i = 0; i < 3; i += 1) keys.push(await uploadWallpaper(s.parentId, groupId, png(400, 300)));
    // Each new authorization deleted the previous, never-committed object.
    expect(await blobs().get(keys[0]!)).toBeNull();
    expect(await blobs().get(keys[1]!)).toBeNull();
    expect(await blobs().get(keys[2]!)).not.toBeNull();
    // Only the pending one can be committed.
    await expect(themes.commitWallpaper(s.parentId, groupId, { objectKey: keys[1]! })).rejects.toEqual(code(CommErrorCode.CHAT_THEME_INVALID));
    await themes.commitWallpaper(s.parentId, groupId, { objectKey: keys[2]! });
    const row = await g.prisma.conversationParticipantState.findUniqueOrThrow({
      where: { conversationId_actorId: { conversationId: groupId, actorId: s.parentId } },
    });
    expect(row.wallpaperObjectKey).toBe(keys[2]);
    expect(row.wallpaperPendingKey).toBeNull();
    // Committing the wallpaper already in use is a no-op, not an error.
    await expect(themes.commitWallpaper(s.parentId, groupId, { objectKey: keys[2]! })).resolves.toEqual({ wallpaperUrl: expect.any(String) });
  });

  it('two commits at once leave no object behind (review fix, PR #72)', async () => {
    const first = await uploadWallpaper(s.parentId, groupId, png(400, 300));
    await themes.commitWallpaper(s.parentId, groupId, { objectKey: first });
    const next = await uploadWallpaper(s.parentId, groupId, png(300, 400));
    const results = await Promise.allSettled([
      themes.commitWallpaper(s.parentId, groupId, { objectKey: next }),
      themes.commitWallpaper(s.parentId, groupId, { objectKey: next }),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await blobs().get(first)).toBeNull(); // the replaced wallpaper, deleted exactly once
    expect(await blobs().get(next)).not.toBeNull();
    const row = await g.prisma.conversationParticipantState.findUniqueOrThrow({
      where: { conversationId_actorId: { conversationId: groupId, actorId: s.parentId } },
    });
    expect([row.wallpaperObjectKey, row.wallpaperPendingKey]).toEqual([next, null]);
  });
});

describe('C · served to its owner only, while they can read the chat', () => {
  it('the owner\'s link resolves; another member of the same chat gets nothing', async () => {
    const key = await uploadWallpaper(s.parentId, groupId, png(400, 300));
    await themes.commitWallpaper(s.parentId, groupId, { objectKey: key });
    await expect(themes.authorizeWallpaperRead(s.parentId, groupId)).resolves.toEqual({ objectKey: key });
    // The signature binds the viewer; a colleague's own "wallpaper" for the chat is theirs, not the parent's.
    await expect(themes.authorizeWallpaperRead(s.ownerId, groupId)).rejects.toEqual(code(CommErrorCode.CHAT_WALLPAPER_NOT_FOUND));
    await expect(themes.authorizeWallpaperRead(s.unrelatedTeacherId, groupId)).rejects.toEqual(code(CommErrorCode.CHAT_WALLPAPER_NOT_FOUND));
  });

  it('is served for the owner\'s private cache, unlike other media (review fix, PR #72)', async () => {
    const key = await uploadWallpaper(s.parentId, groupId, png(400, 300));
    const { wallpaperUrl } = await themes.commitWallpaper(s.parentId, groupId, { objectKey: key });
    const u = new URL(wallpaperUrl, 'http://api.test');
    const state = { status: 0, headers: {} as Record<string, string> };
    const res = {
      status(c: number) { state.status = c; return res; },
      setHeader(n: string, v: string) { state.headers[n] = v; },
      send() {},
      write() { return true; },
      end() {},
    };
    const media = new MediaController(g.prisma, g.messages, g.storage, g.stories, undefined, themes);
    await media.wallpaper(groupId, u.searchParams.get('v')!, u.searchParams.get('a')!, u.searchParams.get('e')!, u.searchParams.get('s')!, { headers: {} }, res as never);
    expect(state.headers['Cache-Control']).toBe('private, max-age=3600');
  });

  it('stops serving once the owner can no longer read the chat', async () => {
    const key = await uploadWallpaper(s.parentId, groupId, png(400, 300));
    await themes.commitWallpaper(s.parentId, groupId, { objectKey: key });
    await g.prisma.conversationMember.updateMany({ where: { conversationId: groupId, actorId: s.parentId }, data: { leftAt: new Date() } });
    await expect(themes.authorizeWallpaperRead(s.parentId, groupId)).rejects.toEqual(code(CommErrorCode.CHAT_WALLPAPER_NOT_FOUND));
  });
});

describe('D · the database backstop', () => {
  it('refuses a stored key that names another viewer or another chat, and an unknown preset', async () => {
    await themes.setTheme(s.ownerId, groupId, 'sky');
    const other = (await g.conversations.getOrCreateDirect(s.ownerId, s.parentId)).id;
    const forged = `wallpapers/${s.parentId}/${groupId}/00000000-0000-4000-8000-000000000000`;
    await expect(
      g.prisma.conversationParticipantState.update({
        where: { conversationId_actorId: { conversationId: groupId, actorId: s.ownerId } },
        data: { wallpaperObjectKey: forged },
      }),
    ).rejects.toBeTruthy();
    const otherChat = `wallpapers/${s.ownerId}/${other}/00000000-0000-4000-8000-000000000000`;
    await expect(
      g.prisma.conversationParticipantState.update({
        where: { conversationId_actorId: { conversationId: groupId, actorId: s.ownerId } },
        data: { wallpaperObjectKey: otherChat },
      }),
    ).rejects.toBeTruthy();
    await expect(
      g.prisma.conversationParticipantState.update({
        where: { conversationId_actorId: { conversationId: groupId, actorId: s.ownerId } },
        data: { theme: 'neon' },
      }),
    ).rejects.toBeTruthy();
  });
});
