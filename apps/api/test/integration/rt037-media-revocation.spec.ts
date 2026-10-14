/**
 * RT-037 -- credentials issued before a deactivation must not keep working
 * after it: attachment and story media, call rooms, push notifications; and
 * the same rules whichever account started the operation.
 *
 * Deterministic throughout (direct calls, row state, no timing). Sections:
 *   A. attachment media route  -- access-time authorization on every request
 *   B. story media route       -- the same, for story media
 *   C. call rooms              -- removal on confirmation; join-time enforcement
 *   D. push payloads           -- no message content, URL, key or token
 *   E. cross-account           -- operations started by OTHER (live) accounts
 *   F. the service_role grant  -- exactly one function, nothing else
 *   G. a REAL LiveKit server   -- skipped (and reported) unless LIVEKIT_REAL_URL is set
 */
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { Reflector } from '@nestjs/core';
import { LocalFsBlobStore } from '@communication/attachments/blob-store';
import { SignedLocalObjectStorage } from '@communication/attachments/object-storage';
import { MediaController } from '@communication/api/media.controller';
import { LiveKitWebhookController } from '@communication/api/livekit-webhook.controller';
import { LiveKitWebhookVerifier } from '@communication/calls/livekit-webhook.verifier';
import { MediaPresenceService } from '@communication/calls/media-presence.service';
import { LiveKitRoomControl, type MediaRoomControl } from '@communication/calls/media-room-control';
import { LiveKitTokenIssuer } from '@communication/calls/media-token';
import { OutboxService } from '@communication/outbox/outbox.service';
import { NotificationService } from '@communication/notifications/notification.service';
import { TemplateService } from '@communication/notifications/template.service';
import { QuietHoursService } from '@communication/notifications/quiet-hours.service';
import type { PushMessage, PushProvider } from '@communication/notifications/push.provider';
import { RevocationConfirmer } from '@communication/realtime/revocation-confirmer.service';
import { AuthenticatedGuard, PUBLIC_ROUTE } from '@platform/auth/auth.guard';
import { MediaUrlSigner } from '@platform/media-url';
import { NO_REALTIME_REVOCATION, RealtimeRevocationHub } from '@platform/realtime-revocation';
import { StoryAudienceKind } from '@communication/contracts/vocab';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;
let groupId: string;
let root: string;
let media: MediaController;
const originalRoot = process.env.STORAGE_LOCAL_ROOT;
const exec = (sql: string) => g.prisma.$executeRawUnsafe(sql);
const q = <T>(sql: string) => g.prisma.$queryRawUnsafe<T[]>(sql);

// ---------------------------------------------------------------------------
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
function partsOf(url: string) {
  const u = new URL(url, 'http://api.test');
  const [, , kind, id] = u.pathname.replace('/api/v1', '').split('/');
  return { kind, id, v: u.searchParams.get('v')!, a: u.searchParams.get('a')!, e: u.searchParams.get('e')!, s: u.searchParams.get('s')! };
}
async function fetchLink(url: string, headers: Record<string, string> = {}) {
  const p = partsOf(url);
  const r = fakeRes();
  if (p.kind === 'attachments') await media.attachment(p.id, p.v, p.a, p.e, p.s, { headers }, r.res);
  else await media.story(p.id, p.v, p.a, p.e, p.s, { headers }, r.res);
  return r.state;
}
const bytes = Buffer.from(Array.from({ length: 2048 }, (_, i) => (i * 17 + 3) % 256));

async function account(table: 'contact' | 'staff' | 'teacher', principalId: string, kind: string): Promise<string> {
  const id = randomUUID();
  await exec(`insert into chat.account (id, subject, kind, status, is_active) values ('${id}'::uuid, 'rt037-${id}', '${kind}', 'active', true)`);
  await exec(`update chat.${table} set account_id = '${id}'::uuid where id = '${principalId}'::uuid`);
  return id;
}

/** A published image message in the Student Group, from staff, with real stored bytes. */
async function imageMessage(senderId = s.ownerId, conversationId = groupId) {
  const auth = await g.attachments.authorizeUpload({ conversationId, actorId: senderId, kind: 'image', mimeType: 'image/png', byteSize: bytes.length });
  await new LocalFsBlobStore().put(auth.objectKey, 'image/png', bytes);
  const sent = await g.messages.send({
    conversationId, senderId, type: 'image', clientMessageId: randomUUID(),
    attachments: [{ kind: 'image', objectKey: auth.objectKey, mimeType: 'image/png', byteSize: bytes.length }],
  });
  return sent;
}
/** The link the READ path hands `actorId` for that message's attachment. */
async function linkFor(actorId: string, messageId: string, conversationId = groupId) {
  const page = await g.messages.list({ conversationId, actorId });
  const m = page.messages.find((x) => x.id === messageId);
  return m!.attachments[0].url!;
}

beforeAll(async () => { await g.prisma.$connect(); });
afterAll(async () => {
  await truncate(g.prisma);
  await exec(`delete from chat.account where subject like 'rt037-%'`);
  await g.prisma.$disconnect();
  if (originalRoot === undefined) delete process.env.STORAGE_LOCAL_ROOT;
  else process.env.STORAGE_LOCAL_ROOT = originalRoot;
});
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'jawwid-rt037-'));
  process.env.STORAGE_LOCAL_ROOT = root;
  media = new MediaController(g.prisma, g.messages, new SignedLocalObjectStorage(), g.stories);
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  groupId = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

// ===========================================================================
describe('A · attachment media: authorized at ACCESS time, not when the link was minted', () => {
  it('control: the reader gets exactly the stored bytes; a Range request gets exactly that slice', async () => {
    const m = await imageMessage();
    const url = await linkFor(s.parentId, m.id);
    expect(url).not.toContain('/storage/'); // never a storage URL
    const full = await fetchLink(url);
    expect(full.status).toBe(200);
    expect(Buffer.compare(full.body, bytes)).toBe(0);
    expect(full.headers['Content-Type']).toBe('image/png');
    expect(full.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(full.headers['Cache-Control']).toBe('private, no-store');
    const part = await fetchLink(url, { range: 'bytes=100-199' });
    expect(part.status).toBe(206);
    expect(part.headers['Content-Range']).toBe(`bytes 100-199/${bytes.length}`);
    expect(Buffer.compare(part.body, bytes.subarray(100, 200))).toBe(0);
  });

  it('the SAME link stops working the moment its reader is deactivated (raw SQL), and works again on re-activation', async () => {
    const m = await imageMessage();
    const url = await linkFor(s.parentId, m.id);
    expect((await fetchLink(url)).status).toBe(200);
    await exec(`update chat.contact set is_active = false where id = '${s.parentId}'::uuid`);
    const refused = await fetchLink(url);
    expect(refused.status).toBe(403);
    expect(refused.body.includes(bytes.subarray(0, 64))).toBe(false);
    await exec(`update chat.contact set is_active = true where id = '${s.parentId}'::uuid`);
    expect((await fetchLink(url)).status).toBe(200); // a live check, not a cached verdict
  });

  it('a suspended LOGIN (principal still active) is enough to refuse', async () => {
    const acct = await account('contact', s.parentId, 'family');
    const m = await imageMessage();
    const url = await linkFor(s.parentId, m.id);
    await exec(`update chat.account set is_active = false, status = 'suspended' where id = '${acct}'::uuid`);
    expect((await fetchLink(url)).status).toBe(403);
  });

  it('removed from the conversation, the message deleted for everyone, or deleted for me: refused (reads as absent)', async () => {
    const m1 = await imageMessage();
    const removedUrl = await linkFor(s.parentId, m1.id);
    await g.conversations.setMembership(groupId, s.ownerId, { actorId: s.parentId, actorKind: 'contact', memberRole: 'parent' }, 'remove', 'rt037');
    expect((await fetchLink(removedUrl)).status).toBe(403);

    const m2 = await imageMessage();
    const otherUrl = await linkFor(s.otherParentId, m2.id);
    await exec(`update chat.message set deleted_for_all = true, deleted_at = now() where id = '${m2.id}'::uuid`);
    expect((await fetchLink(otherUrl)).status).toBe(404);

    const m3 = await imageMessage();
    const hiddenUrl = await linkFor(s.otherParentId, m3.id);
    await exec(`insert into chat.message_hidden_for (message_id, actor_id) values ('${m3.id}'::uuid, '${s.otherParentId}'::uuid)`);
    expect((await fetchLink(hiddenUrl)).status).toBe(404);
  });

  it('the link is bound: another actor, another attachment, another variant, an expired or forged signature -- all refused', async () => {
    const m = await imageMessage();
    const m2 = await imageMessage();
    const url = await linkFor(s.parentId, m.id);
    const p = partsOf(url);
    const other = partsOf(await linkFor(s.parentId, m2.id));
    const run = async (id: string, v: string, a: string, e: string, sig: string) => {
      const r = fakeRes(); await media.attachment(id, v, a, e, sig, { headers: {} }, r.res); return r.state.status;
    };
    expect(await run(p.id, p.v, s.otherParentId, p.e, p.s)).toBe(403); // someone else's id under my signature
    expect(await run(other.id, p.v, p.a, p.e, p.s)).toBe(403); // another attachment
    expect(await run(p.id, 't', p.a, p.e, p.s)).toBe(403); // another variant
    expect(await run(p.id, p.v, p.a, String(Number(p.e) + 60), p.s)).toBe(403); // extended expiry
    expect(await run(p.id, p.v, p.a, p.e, p.s.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))).toBe(403);
    const expired = new MediaUrlSigner().url('attachments', p.id, 'o', p.a, -1);
    expect((await fetchLink(expired)).status).toBe(403);
  });

  it('a validly SIGNED link for someone who may not read the message is still refused (signature is not the decision)', async () => {
    const m = await imageMessage();
    const attachmentId = (await g.prisma.messageAttachment.findFirstOrThrow({ where: { messageId: m.id } })).id;
    // Minted directly with the server key: the only thing it lacks is authorization.
    const forUnrelated = new MediaUrlSigner().url('attachments', attachmentId, 'o', s.unrelatedTeacherId, 300);
    expect((await fetchLink(forUnrelated)).status).toBe(403);
    // Another tenant: a contact of organization B.
    const orgB = randomUUID();
    await exec(`insert into chat.organization (id, slug, display_name) values ('${orgB}'::uuid, 'rt037-${orgB.slice(0, 8)}', 'B')`);
    const staffB = randomUUID(); const famB = randomUUID(); const parentB = randomUUID();
    await exec(`insert into chat.staff (id, organization_id, name, role) values ('${staffB}'::uuid, '${orgB}'::uuid, 'b_admin', 'admin')`);
    await exec(`insert into chat.family (id, organization_id, display_name, owner_id) values ('${famB}'::uuid, '${orgB}'::uuid, 'fam_b', '${staffB}'::uuid)`);
    await exec(`insert into chat.contact (id, organization_id, family_id, name, role_preset, can_message) values ('${parentB}'::uuid, '${orgB}'::uuid, '${famB}'::uuid, 'parent_b', 'primary_guardian', true)`);
    for (const actor of [parentB, staffB]) {
      const status = (await fetchLink(new MediaUrlSigner().url('attachments', attachmentId, 'o', actor, 300))).status;
      expect([403, 404]).toContain(status);
    }
  });

  it('per-reader: one reader deactivated does not affect another reader of the same attachment', async () => {
    const m = await imageMessage();
    const mine = await linkFor(s.parentId, m.id);
    const theirs = await linkFor(s.otherParentId, m.id);
    await exec(`update chat.contact set is_active = false where id = '${s.parentId}'::uuid`);
    expect((await fetchLink(mine)).status).toBe(403);
    expect((await fetchLink(theirs)).status).toBe(200);
  });
});

// ===========================================================================
describe('B · story media: the same access-time rule', () => {
  async function storyWithMedia(): Promise<{ id: string; key: string }> {
    const key = `stories/${randomUUID()}`;
    await new LocalFsBlobStore().put(key, 'image/png', bytes);
    const draft = await g.stories.create(s.ownerId, {
      body: 'hello', mediaObjectKey: key, mediaKind: 'image', mediaMime: 'image/png',
      audiences: [{ kind: StoryAudienceKind.ALL_FAMILIES }],
    } as never);
    await g.stories.publish(draft.id, s.ownerId);
    return { id: draft.id, key };
  }

  it('a recipient reads it; deactivated, the same link is refused; a deleted story is refused', async () => {
    const st = await storyWithMedia();
    const url = (await g.stories.feed(s.parentId)).find((x) => x.id === st.id)!.mediaUrl!;
    expect(url).not.toContain('/storage/');
    const ok = await fetchLink(url);
    expect(ok.status).toBe(200);
    expect(Buffer.compare(ok.body, bytes)).toBe(0);
    await exec(`update chat.contact set is_active = false where id = '${s.parentId}'::uuid`);
    expect((await fetchLink(url)).status).toBe(403);
    await exec(`update chat.contact set is_active = true where id = '${s.parentId}'::uuid`);
    await g.stories.remove(st.id, s.ownerId, 'rt037: removed by the publisher');
    expect((await fetchLink(url)).status).toBe(404);
  });

  it('expiry is re-checked at access: a link minted before expires_at stops at expires_at', async () => {
    const st = await storyWithMedia();
    const url = (await g.stories.feed(s.parentId)).find((x) => x.id === st.id)!.mediaUrl!;
    await exec(`update chat.story set expires_at = now() - interval '1 second' where id = '${st.id}'::uuid`);
    expect((await fetchLink(url)).status).toBe(404);
  });

  it('a signed link for a non-recipient (a teacher outside the audience) is refused; the publisher may read a draft', async () => {
    const st = await storyWithMedia();
    expect((await fetchLink(new MediaUrlSigner().url('stories', st.id, 'o', s.unrelatedTeacherId, 300))).status).toBe(404);
    const key = `stories/${randomUUID()}`;
    await new LocalFsBlobStore().put(key, 'image/png', bytes);
    const draft = await g.stories.create(s.ownerId, { body: 'd', mediaObjectKey: key, mediaKind: 'image', mediaMime: 'image/png', audiences: [{ kind: StoryAudienceKind.ALL_FAMILIES }] } as never);
    expect(draft.mediaUrl).toBeTruthy();
    expect((await fetchLink(draft.mediaUrl!)).status).toBe(200);
    expect((await fetchLink(new MediaUrlSigner().url('stories', draft.id, 'o', s.parentId, 300))).status).toBe(404); // not published
  });
});

// ===========================================================================
class FakeRooms implements MediaRoomControl {
  configured = true;
  removed: Array<[string, string]> = [];
  failWith: Error | null = null;
  present = new Set<string>(); // `${room}|${identity}`
  async removeParticipant(room: string, identity: string): Promise<'removed' | 'absent'> {
    if (this.failWith) throw this.failWith;
    this.removed.push([room, identity]);
    return this.present.delete(`${room}|${identity}`) ? 'removed' : 'absent';
  }
}
function barrierHub() {
  const hub = new RealtimeRevocationHub();
  hub.attach({ ...NO_REALTIME_REVOCATION, confirmRevoked: async () => undefined });
  return hub;
}
const journal = (principalId: string) =>
  q<{ confirmed_at: Date | null; last_error: string | null }>(`select confirmed_at, last_error from chat.principal_revocation where principal_id = '${principalId}'::uuid`);

describe('C · call rooms', () => {
  it('a confirmed deactivation empties every LIVE call room the person is a participant of -- ringing or active, joined or not -- and no ended one', async () => {
    // An ENDED group call the parent was seated in -- must not be touched.
    const ended = await g.calls.start(groupId, s.teacherId);
    expect((await g.prisma.callParticipant.findMany({ where: { callId: ended.callId } })).map((p) => p.actorId)).toContain(s.parentId);
    await g.calls.end(ended.callId, s.teacherId);
    // A RINGING group call (never joined) and an ACTIVE direct call (joined).
    const ringing = await g.calls.start(groupId, s.teacherId);
    const active = await g.calls.start((await g.conversations.getOrCreateDirect(s.parentId, s.ownerId)).id, s.ownerId);
    await g.calls.accept(active.callId, s.parentId);
    const rooms = new FakeRooms();
    rooms.present.add(`${active.roomName}|${s.parentId}`);

    await exec(`update chat.contact set is_active = false where id = '${s.parentId}'::uuid`);
    expect(await new RevocationConfirmer(g.prisma, barrierHub(), rooms).confirmPending()).toBe(1);

    const touched = rooms.removed.map(([room, id]) => `${room}|${id}`).sort();
    expect(touched).toEqual([`${active.roomName}|${s.parentId}`, `${ringing.roomName}|${s.parentId}`].sort());
    expect((await journal(s.parentId))[0].confirmed_at).not.toBeNull();
  });

  it('an ACCOUNT revocation reaches the person behind it', async () => {
    const acct = await account('contact', s.parentId, 'family');
    const call = await g.calls.start(groupId, s.teacherId);
    const rooms = new FakeRooms();
    await exec(`update chat.account set is_active = false, status = 'suspended' where id = '${acct}'::uuid`);
    expect(await new RevocationConfirmer(g.prisma, barrierHub(), rooms).confirmPending()).toBe(1);
    expect(rooms.removed).toContainEqual([call.roomName, s.parentId]);
  });

  it('a room that cannot be emptied keeps the deactivation UNCONFIRMED; it is confirmed once the media server answers', async () => {
    await g.calls.start(groupId, s.teacherId);
    const rooms = new FakeRooms();
    rooms.failWith = Object.assign(new Error('twirp 503'), { name: 'TwirpError' });
    await exec(`update chat.contact set is_active = false where id = '${s.parentId}'::uuid`);
    const confirmer = new RevocationConfirmer(g.prisma, barrierHub(), rooms);
    expect(await confirmer.confirmPending()).toBe(0);
    expect((await journal(s.parentId))[0]).toMatchObject({ confirmed_at: null, last_error: expect.stringMatching(/^media: /) });
    rooms.failWith = null;
    expect(await confirmer.confirmPending()).toBe(1);
  });

  // --- join-time enforcement (LiveKit participant_joined) -------------------
  const KEY = process.env.LIVEKIT_API_KEY!;
  const SECRET = process.env.LIVEKIT_API_SECRET!;
  async function signedJoin(roomName: string, identity: string) {
    const raw = JSON.stringify({ event: 'participant_joined', createdAt: Math.floor(Date.now() / 1000), id: randomUUID(), room: { name: roomName, sid: 'RM_x' }, participant: { identity, name: 'x' } });
    const t = new AccessToken(KEY, SECRET); t.sha256 = createHash('sha256').update(raw).digest('base64');
    return { raw, auth: await t.toJwt() };
  }
  const controllerWith = (rooms: MediaRoomControl) =>
    new LiveKitWebhookController(new LiveKitWebhookVerifier(), new MediaPresenceService(g.prisma, new OutboxService()), g.prisma, rooms);

  it('a join by someone no longer live (an earlier token, or one LiveKit refreshed) is undone at once; a live participant is left alone', async () => {
    const call = await g.calls.start(groupId, s.teacherId);
    const rooms = new FakeRooms();
    const ctl = controllerWith(rooms);
    let j = await signedJoin(call.roomName, s.parentId);
    await ctl.webhook({ rawBody: Buffer.from(j.raw) }, j.auth);
    expect(rooms.removed).toEqual([]); // live: nothing undone

    await exec(`update chat.contact set is_active = false where id = '${s.parentId}'::uuid`);
    j = await signedJoin(call.roomName, s.parentId);
    await expect(ctl.webhook({ rawBody: Buffer.from(j.raw) }, j.auth)).resolves.toEqual({ ok: true });
    expect(rooms.removed).toEqual([[call.roomName, s.parentId]]);
  });

  it('if the join cannot be undone the webhook answers 503, so LiveKit delivers it again; an unsigned one changes nothing', async () => {
    const call = await g.calls.start(groupId, s.teacherId);
    await exec(`update chat.contact set is_active = false where id = '${s.parentId}'::uuid`);
    const rooms = new FakeRooms();
    rooms.failWith = new Error('down');
    const j = await signedJoin(call.roomName, s.parentId);
    await expect(controllerWith(rooms).webhook({ rawBody: Buffer.from(j.raw) }, j.auth)).rejects.toMatchObject({ status: 503 });
    rooms.failWith = null;
    await expect(controllerWith(rooms).webhook({ rawBody: Buffer.from(j.raw) }, 'not-a-signature')).rejects.toMatchObject({ status: 401 });
    expect(rooms.removed).toEqual([]);
  });

  it('the bearer guard lets LiveKit and media links through (they carry their own signatures); a user route still needs a token', async () => {
    const reflector = new Reflector();
    for (const ctl of [LiveKitWebhookController, MediaController]) {
      expect(reflector.get(PUBLIC_ROUTE, ctl)).toBe(true);
    }
    const guard = new AuthenticatedGuard({ authenticate: async () => null } as never, reflector);
    const ctx = (cls: unknown) => ({
      getType: () => 'http', getHandler: () => () => undefined, getClass: () => cls,
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
    }) as never;
    await expect(guard.canActivate(ctx(LiveKitWebhookController))).resolves.toBe(true);
    await expect(guard.canActivate(ctx(MediaController))).resolves.toBe(true);
    class UserRoute {}
    await expect(guard.canActivate(ctx(UserRoute))).rejects.toBeDefined();
  });
});

// ===========================================================================
describe('D · push payloads carry no message content, link, key or token', () => {
  it('a message with a secret body and an attachment produces a push with neither', async () => {
    const pushes: PushMessage[] = [];
    const push: PushProvider = { send: async (m) => { pushes.push(m); return { ok: true }; } } as PushProvider;
    const notifications = new NotificationService(g.prisma, new TemplateService(g.prisma), new QuietHoursService(g.prisma), g.config, push);
    await notifications.registerDevice({ actorId: s.parentId, token: `rt037-${randomUUID()}`, platform: 'android', isVoip: false });
    const secret = `TOP-SECRET-${randomUUID()}`;
    const auth = await g.attachments.authorizeUpload({ conversationId: groupId, actorId: s.ownerId, kind: 'image', mimeType: 'image/png', byteSize: bytes.length });
    await g.messages.send({ conversationId: groupId, senderId: s.ownerId, type: 'image', body: secret, clientMessageId: randomUUID(),
      attachments: [{ kind: 'image', objectKey: auth.objectKey, mimeType: 'image/png', byteSize: bytes.length }] });
    const worker = new (g.outboxWorker.constructor as never as new (...a: unknown[]) => typeof g.outboxWorker)(g.prisma, notifications, { toThread: async () => undefined, toUsers: async () => undefined }, g.identity);
    await worker.drain();
    await notifications.dispatchDue();
    expect(pushes.length).toBeGreaterThan(0);
    for (const p of pushes) {
      const all = JSON.stringify(p);
      expect(all).not.toContain(secret);
      expect(all).not.toContain(auth.objectKey);
      expect(all).not.toMatch(/\/media\/|\/storage\/|access_token|Bearer/);
      expect(Object.keys(p.data).sort()).toEqual(expect.arrayContaining(['eventType', 'notificationId']));
      expect(Object.keys(p.data).every((k) => ['eventType', 'notificationId', 'conversationId', 'callId'].includes(k))).toBe(true);
    }
  });
});

describe('D2 · push privacy: no sender or caller name on the lock screen (owner decision, W8-W1 reopen)', () => {
  async function pushesFor(fn: () => Promise<unknown>) {
    const pushes: PushMessage[] = [];
    const push: PushProvider = { send: async (m) => { pushes.push(m); return { ok: true }; } } as PushProvider;
    const notifications = new NotificationService(g.prisma, new TemplateService(g.prisma), new QuietHoursService(g.prisma), g.config, push);
    for (const who of [s.parentId, s.otherParentId]) {
      await notifications.registerDevice({ actorId: who, token: `rt037-${randomUUID()}`, platform: 'android', isVoip: false });
    }
    await fn();
    const worker = new (g.outboxWorker.constructor as never as new (...a: unknown[]) => typeof g.outboxWorker)(g.prisma, notifications, { toThread: async () => undefined, toUsers: async () => undefined }, g.identity);
    await worker.drain();
    await notifications.dispatchDue(new Date(Date.now() + 24 * 3_600_000)); // past any quiet-hours deferral
    return pushes;
  }
  const names = async () => (await q<{ name: string }>(`select name from chat.staff union all select name from chat.teacher union all select name from chat.contact`)).map((r) => r.name);

  it('message, group-call and missed-call pushes reach their recipients and name nobody; no placeholder is left unrendered', async () => {
    const pushes = await pushesFor(async () => {
      await g.messages.send({ conversationId: groupId, senderId: s.ownerId, body: 'hello there', clientMessageId: randomUUID() });
      const call = await g.calls.start(groupId, s.teacherId);
      await g.calls.end(call.callId, s.teacherId);
    });
    expect(pushes.length).toBeGreaterThanOrEqual(2); // legitimate recipients still receive
    const everyName = await names();
    for (const p of pushes) {
      for (const n of everyName) expect(`${p.title}\n${p.body}`).not.toContain(n);
      expect(`${p.title}${p.body}`).not.toMatch(/\{[a-z_]+\}/);
      expect(JSON.stringify(p.data)).not.toMatch(/name|preview|body/i);
    }
    // Nor is a name STORED for later rendering.
    const stored = await q<{ v: string }>(`select variables::text as v from chat.notification`);
    for (const r of stored) expect(r.v).not.toMatch(/sender_name|caller_name/);
  });
});

// ===========================================================================
describe('E · cross-account: operations started by OTHER, live accounts follow the same revocation', () => {
  it('a call started by a live teacher neither rings nor seats a deactivated parent; the live parent is seated', async () => {
    await exec(`update chat.contact set is_active = false where id = '${s.parentId}'::uuid`);
    const call = await g.calls.start(groupId, s.teacherId);
    const seated = (await g.prisma.callParticipant.findMany({ where: { callId: call.callId } })).map((p) => p.actorId);
    expect(seated).not.toContain(s.parentId);
    expect(seated).toContain(s.otherParentId);
  });

  it('a live admin\'s message schedules nothing for a deactivated member, and their earlier media link is refused', async () => {
    const m0 = await imageMessage();
    const earlier = await linkFor(s.parentId, m0.id);
    await exec(`update chat.contact set is_active = false where id = '${s.parentId}'::uuid`);
    await imageMessage(); // from the live owner
    const worker = g.outboxWorker;
    await worker.drain();
    const forParent = await g.prisma.notification.count({ where: { recipientId: s.parentId, status: 'scheduled' } });
    expect(forParent).toBe(0);
    expect((await fetchLink(earlier)).status).toBe(403);
  });
});

// ===========================================================================
describe('F · the service_role grant: exactly EXECUTE on chat.invoking_role(), nothing else', () => {
  it('the function ACL is the owner, authenticated and service_role -- no PUBLIC, no anon, no chat_app entry of its own', async () => {
    const [row] = await q<{ acl: string }>(`select proacl::text as acl from pg_proc where oid = 'chat.invoking_role()'::regprocedure`);
    const grantees = row.acl.replace(/[{}]/g, '').split(',').map((e) => e.split('=')[0]).filter(Boolean).sort();
    const [owner] = await q<{ o: string }>(`select pg_get_userbyid(proowner)::text as o from pg_proc where oid = 'chat.invoking_role()'::regprocedure`);
    expect(grantees).toEqual([owner.o, 'authenticated', 'service_role'].sort());
  });

  it('it is the function grant the server-side path needs, and it raises nobody: chat_app stays a request role; service_role gains no table privilege', async () => {
    const asRole = async (role: string) => g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`set local role ${role}`);
      return (await tx.$queryRawUnsafe<{ v: boolean }[]>(`select chat.caller_is_server_side() as v`))[0].v;
    });
    expect(await asRole('service_role')).toBe(true);
    expect(await asRole('chat_app')).toBe(false);
    expect(await asRole('authenticated')).toBe(false);
    const [m] = await q<{ svc: boolean; owner: boolean }>(
      `select pg_has_role('chat_app', 'service_role', 'MEMBER') as svc,
              pg_has_role('chat_app', (select relowner from pg_class where oid = 'chat.family'::regclass), 'MEMBER') as owner`);
    expect(m).toEqual({ svc: false, owner: false });
    // What this migration grants to service_role, read from the file itself.
    const sql = readFileSync(join(__dirname, '../../../../supabase/migrations/20261014150000_chat_rt032_revocation_journal.sql'), 'utf8');
    const grants = [...sql.matchAll(/^grant\s+([^;]+?)\s+to\s+service_role;/gim)].map((x) => x[1].replace(/\s+/g, ' '));
    expect(grants).toEqual([
      'execute on function chat.invoking_role()',
      'select, insert on chat.principal_revocation',
      'update (confirmed_at, confirmed_by, attempts, claimed_until, claimed_by, last_error) on chat.principal_revocation',
      'execute on function chat.deactivate_principal(text, uuid, text, uuid, text)',
    ]);
  });
});

// ===========================================================================
// G. A REAL LiveKit server (livekit/livekit-server, local container). Skipped
// unless LIVEKIT_REAL_URL / _KEY / _SECRET name one; the skip is reported.
// ===========================================================================
const REAL = process.env.LIVEKIT_REAL_URL;
(REAL ? describe : describe.skip)('G · a REAL LiveKit server', () => {
  const saved = { url: process.env.LIVEKIT_URL, key: process.env.LIVEKIT_API_KEY, secret: process.env.LIVEKIT_API_SECRET };
  beforeEach(() => {
    process.env.LIVEKIT_URL = REAL;
    process.env.LIVEKIT_API_KEY = process.env.LIVEKIT_REAL_KEY;
    process.env.LIVEKIT_API_SECRET = process.env.LIVEKIT_REAL_SECRET;
  });
  afterEach(() => {
    process.env.LIVEKIT_URL = saved.url; process.env.LIVEKIT_API_KEY = saved.key; process.env.LIVEKIT_API_SECRET = saved.secret;
  });
  const control = () => new RoomServiceClient(REAL!.replace(/^ws/, 'http'), process.env.LIVEKIT_REAL_KEY!, process.env.LIVEKIT_REAL_SECRET!);
  const listed = async (room: string) => (await control().listParticipants(room).catch(() => [])).map((p) => p.identity);
  /** Joins over the signalling channel with a token OUR issuer minted. */
  async function join(token: string): Promise<{ closed: () => boolean; close: () => void }> {
    let closed = false;
    const ws = new WebSocket(`${REAL}/rtc?access_token=${token}&sdk=js&protocol=15&auto_subscribe=1`);
    await new Promise<void>((r) => { ws.onopen = () => r(); ws.onclose = () => { closed = true; r(); }; ws.onerror = () => undefined; });
    ws.addEventListener('close', () => { closed = true; });
    await new Promise((r) => setTimeout(r, 600));
    return { closed: () => closed, close: () => ws.close() };
  }
  const token = async (room: string, identity: string, ttl = 120) =>
    (await new LiveKitTokenIssuer().issue({ roomName: room, identity, name: 'n', canPublish: true, ttlSeconds: ttl })).token;

  it('room control: a participant joined with our token is removed (and disconnected); a repeat or an unknown room is "absent"', async () => {
    const room = `rt037-${randomUUID()}`;
    const who = randomUUID();
    const conn = await join(await token(room, who));
    expect(await listed(room)).toContain(who);
    const rc = new LiveKitRoomControl();
    expect(await rc.removeParticipant(room, who)).toBe('removed');
    await new Promise((r) => setTimeout(r, 500));
    expect(await listed(room)).not.toContain(who);
    expect(conn.closed()).toBe(true);
    expect(await rc.removeParticipant(room, who)).toBe('absent');
    expect(await rc.removeParticipant(`no-such-${randomUUID()}`, who)).toBe('absent');
  });

  it('room control fails CLOSED: bad credentials throw, they are never reported as a removal', async () => {
    process.env.LIVEKIT_API_SECRET = 'a-wrong-secret-that-is-long-enough-123456';
    await expect(new LiveKitRoomControl().removeParticipant('any', 'one')).rejects.toBeDefined();
  });

  it('tokens, independently: one room only; refused once past expiry (beyond LiveKit\'s ~60 s leeway)', async () => {
    const room = `rt037-${randomUUID()}`;
    const other = `rt037-${randomUUID()}`;
    const who = randomUUID();
    const c = await join(await token(room, who));
    expect(await listed(other)).not.toContain(who);
    expect(await listed(room)).toContain(who);
    c.close();
    const late = randomUUID();
    await join(await token(room, late, -120));
    expect(await listed(room)).not.toContain(late);
  });

  it('end to end: a deactivation confirmed by RevocationConfirmer takes the person out of the real room', async () => {
    const call = await g.calls.start(groupId, s.teacherId);
    const conn = await join(await token(call.roomName, s.parentId));
    expect(await listed(call.roomName)).toContain(s.parentId);
    await exec(`update chat.contact set is_active = false where id = '${s.parentId}'::uuid`);
    expect(await new RevocationConfirmer(g.prisma, barrierHub(), new LiveKitRoomControl()).confirmPending()).toBe(1);
    await new Promise((r) => setTimeout(r, 500));
    expect(await listed(call.roomName)).not.toContain(s.parentId);
    expect(conn.closed()).toBe(true);
  });
});
