/**
 * The first frames after `connect` are answered as the person who connected.
 *
 * QA, Android (2026-10-27): the first `conversation.subscribe` was answered
 * `COMM.UNKNOWN_ACTOR` and the first `typing.start` `ok:false`, while the same
 * frames a second later were fine. Socket.IO tells the client `connect` as
 * soon as the connection exists; the gateway used to attach the actor only
 * afterwards, in `handleConnection` (which Nest does not await), so frames sent
 * on `connect` reached handlers with no actor. Both clients retried around it.
 *
 * Now the identity is bound in Socket.IO middleware, before `connect` is sent.
 * What must NOT change: a refused credential is still a server disconnect (a
 * client reads it as "unauthorized"), never a `connect_error` (an ordinary
 * drop it would retry), and the token is verified once per socket.
 *
 * Also pinned: a session that ends WHILE the handshake runs (a logout, a
 * refresh rotation) is refused, not connected under the old session; a
 * support session is refused through the middleware too; a handshake that
 * takes too long is dropped; a client that leaves mid-handshake leaves no
 * room or presence behind; and presence is recorded for the person who
 * connected (real PresenceService, real Redis).
 *
 * Wired as the Nest adapter wires a gateway: `afterInit` on the server,
 * listeners bound at once on `connection`, `handleConnection` not awaited. No
 * "test.ready" wait -- the client acts on `connect`, as real clients do.
 * Authentication is slowed down, so the old window is wide and certain.
 *
 * Requires Redis: AUTH_TEST_REDIS_URL / REDIS_URL, your own instance (CI's
 * service answers on the default).
 */
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import Redis from 'ioredis';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '@platform/prisma.service';
import { SqlStaffScope } from '@platform/staff-scope';
import { PrismaIdentityService } from '@platform/identity.service';
import { PrismaAuditService } from '@platform/audit.service';
import { AuthService } from '@platform/auth/auth.service';
import { AuthorizationService } from '@platform/authorization.service';
import { PrismaRelationshipService } from '@platform/relationship.service';
import { RealtimeRevocationHub } from '@platform/realtime-revocation';
import { ConversationService } from '@communication/conversations/conversation.service';
import { MessageService } from '@communication/messages/message.service';
import { AttachmentService } from '@communication/attachments/attachment.service';
import { SignedLocalObjectStorage } from '@communication/attachments/object-storage';
import { OutboxService } from '@communication/outbox/outbox.service';
import { AppConfigService } from '@platform/app-config.service';
import { RealtimeGateway } from '@communication/realtime/realtime.gateway';
import type { TypingService } from '@communication/realtime/typing.service';
import { PresenceService } from '@communication/realtime/presence.service';
import { room } from '@communication/contracts/events';
import { PinnedCoverage, supervise, withAssignmentGate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';

jest.setTimeout(60_000);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ioClient: (url: string, opts: Record<string, unknown>) => ClientSocket = require(
  path.join(path.dirname(require.resolve('socket.io')), '..', 'client-dist', 'socket.io.js'),
);
interface ClientSocket {
  on(event: string, fn: (...a: unknown[]) => void): void;
  emit(event: string, ...a: unknown[]): void;
  close(): void;
}

const PASSWORD = 'a-handshake-race-password-1';
const RUN = randomUUID().slice(0, 8);
const ORG = '00000000-0000-0000-0000-000000000001';
/** How long verifying a token takes here: a slow database, on purpose. */
const AUTH_DELAY_MS = 400;

const prisma = new PrismaService();
const identity = new PrismaIdentityService(prisma);
const audit = new PrismaAuditService();
const typing = { start: async () => true, stop: async () => true } as unknown as TypingService;
const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
let redis: Redis;
let presence: PresenceService;

const ids = {
  staffAccount: randomUUID(), staff: randomUUID(),
  parentAccount: randomUUID(), parent: randomUUID(),
  teacherAccount: randomUUID(), teacher: randomUUID(),
  family: randomUUID(), learner: randomUUID(),
};
const subject = (who: string) => `race-${who}-${RUN}`;

let auth: AuthService;
let gateway: RealtimeGateway;
let url: string;
let io: Server;
let server: http.Server;
let groupId: string;
let authentications = 0;
let connections = 0;
/** The real token check, unslowed and uncounted. */
let verify: AuthService['authenticate'];
/** Runs once the token has been verified, while the handshake is still going: a racing logout. */
let duringHandshake: (() => Promise<void>) | null = null;
const sockets: ClientSocket[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * How a connection attempt ends: the disconnect reason, `connect_error`, or
 * `connected` if it is still connected a moment after `connect`.
 */
function outcomeOf(token?: string): Promise<string> {
  return new Promise((resolve) => {
    const socket = ioClient(url, {
      transports: ['websocket'], forceNew: true, reconnection: false, ...(token ? { auth: { token } } : {}),
    });
    sockets.push(socket);
    socket.on('connect_error', () => resolve('connect_error'));
    socket.on('disconnect', (reason) => resolve(String(reason)));
    socket.on('connect', () => void sleep(500).then(() => resolve('connected')));
  });
}

const ack = (socket: ClientSocket, event: string, body: unknown) =>
  new Promise<{ ok: boolean; code?: string }>((r) => socket.emit(event, body, r));

/** Connects and, the moment `connect` arrives, sends [frames]. */
function connectAndSend(token: string, frames: Array<[string, unknown]>) {
  return new Promise<{ answers: Array<{ ok: boolean; code?: string }>; socket: ClientSocket }>((resolve, reject) => {
    const socket = ioClient(url, { transports: ['websocket'], forceNew: true, reconnection: false, auth: { token } });
    sockets.push(socket);
    socket.on('connect', () => {
      void Promise.all(frames.map(([event, body]) => ack(socket, event, body))).then((answers) =>
        resolve({ answers, socket }),
      );
    });
    socket.on('connect_error', (e) => reject(e));
  });
}

beforeAll(async () => {
  await prisma.$connect();
  const exec = (sql: string) => prisma.$executeRawUnsafe(sql);
  const accounts: Array<[string, string, string]> = [
    [ids.staffAccount, 'staff', 'staff'],
    [ids.parentAccount, 'family', 'parent'],
    [ids.teacherAccount, 'teacher', 'teacher'],
  ];
  for (const [id, kind, who] of accounts) {
    await exec(`insert into chat.account (id, organization_id, subject, kind, status, is_active)
                values ('${id}'::uuid, '${ORG}'::uuid, '${subject(who)}', '${kind}', 'active', true)`);
  }
  await exec(`insert into chat.staff (id, organization_id, name, role, account_id) values
    ('${ids.staff}'::uuid, '${ORG}'::uuid, 'admin_race', 'admin', '${ids.staffAccount}'::uuid)`);
  await exec(`insert into chat.teacher (id, organization_id, name, is_active, account_id) values
    ('${ids.teacher}'::uuid, '${ORG}'::uuid, 'teacher_race', true, '${ids.teacherAccount}'::uuid)`);
  await exec(`insert into chat.family (id, organization_id, display_name, owner_id, language) values
    ('${ids.family}'::uuid, '${ORG}'::uuid, 'family_race', '${ids.staff}'::uuid, 'ar')`);
  await exec(`insert into chat.contact (id, organization_id, family_id, name, role_preset, can_message, account_id) values
    ('${ids.parent}'::uuid, '${ORG}'::uuid, '${ids.family}'::uuid, 'parent_race', 'primary_guardian', true, '${ids.parentAccount}'::uuid)`);
  await withAssignmentGate(prisma, `insert into chat.learner (id, organization_id, family_id, name, teacher_id)
    values ('${ids.learner}'::uuid, '${ORG}'::uuid, '${ids.family}'::uuid, 'learner_race', '${ids.teacher}'::uuid)`);
  await supervise(prisma, ids.staff, [ids.learner]);

  const hub = new RealtimeRevocationHub();
  const coverage = new PinnedCoverage();
  const authz = new AuthorizationService(coverage, new SqlStaffScope(prisma));
  // With authz, as production wires it: without one every support session is refused.
  auth = new AuthService(prisma, identity, audit, hub, authz);
  // The handshake's token check, slowed down and counted. Every other caller
  // (revalidation, HTTP) is untouched.
  verify = auth.authenticate.bind(auth);
  auth.authenticate = async (token: string) => {
    authentications++;
    await sleep(AUTH_DELAY_MS);
    const answer = await verify(token);
    const racing = duringHandshake;
    duringHandshake = null;
    if (racing) await racing();
    return answer;
  };
  redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });
  presence = new PresenceService(redis, new AppConfigService(prisma));
  const conversations = new ConversationService(
    prisma, authz, new OutboxService(), identity, coverage, audit, new PrismaRelationshipService(prisma), hub,
  );
  const messages = new MessageService(
    prisma, authz, conversations, new OutboxService(), new AppConfigService(prisma),
    new AttachmentService(prisma, authz, conversations, new SignedLocalObjectStorage()), audit, identity,
  );
  gateway = new RealtimeGateway(authz, conversations, typing, presence, messages, auth, hub);
  server = http.createServer();
  io = new Server(server, { transports: ['websocket'] });
  gateway.server = io;
  gateway.afterInit();
  io.on('connection', (s: Socket) => {
    connections++;
    void gateway.handleConnection(s as never);
    s.on('conversation.subscribe', async (body: unknown, reply?: (r: unknown) => void) =>
      reply?.(await gateway.subscribe(s as never, body as never)));
    s.on('typing.start', async (body: unknown, reply?: (r: unknown) => void) =>
      reply?.(await gateway.typingStart(s as never, body as never)));
    s.on('disconnect', () => void gateway.handleDisconnect(s as never));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  for (const [id] of accounts) await auth.setPassword(id, PASSWORD);
  groupId = (await conversations.ensureStudentGroup(ids.learner, ids.staff)).id;
});

afterEach(() => {
  for (const s of sockets.splice(0)) s.close();
  duringHandshake = null;
  if (gateway) gateway.handshakeTimeoutMs = 10_000;
});

afterAll(async () => {
  io?.close();
  await new Promise((r) => server?.close(r));
  await redis?.quit();
  await prisma.$disconnect();
});

describe('the first frames after connect', () => {
  it('a subscribe and a typing.start sent ON connect are answered as the person who connected', async () => {
    const token = (await auth.login(subject('parent'), PASSWORD)).accessToken;
    const before = authentications;
    const { answers } = await connectAndSend(token, [
      ['conversation.subscribe', { conversationId: groupId }],
      ['typing.start', { conversationId: groupId }],
    ]);
    expect(answers).toEqual([{ ok: true }, { ok: true }]);
    // Bound once: the middleware's verification is the one handleConnection uses.
    expect(authentications - before).toBe(1);
  });

  it('a refused credential is still a SERVER disconnect -- never a connect_error', async () => {
    const outcome = await new Promise<string>((resolve) => {
      const socket = ioClient(url, {
        transports: ['websocket'], forceNew: true, reconnection: false, auth: { token: 'not-a-token' },
      });
      sockets.push(socket);
      socket.on('connect_error', () => resolve('connect_error'));
      socket.on('disconnect', (reason) => resolve(String(reason)));
    });
    expect(outcome).toBe('io server disconnect');
  });

  it('a support session (PD-21) is refused through the middleware too', async () => {
    const support = await openSupportSession();
    // The token really is a support session, so the refusal below is that rule.
    expect((await verify(support))?.impersonation).toBeDefined();
    expect(await outcomeOf(support)).toBe('io server disconnect');
  });

  it('no credential at all: the same', async () => {
    const outcome = await new Promise<string>((resolve) => {
      const socket = ioClient(url, { transports: ['websocket'], forceNew: true, reconnection: false });
      sockets.push(socket);
      socket.on('connect_error', () => resolve('connect_error'));
      socket.on('disconnect', (reason) => resolve(String(reason)));
    });
    expect(outcome).toBe('io server disconnect');
  });
});

describe('a session that ends while the handshake runs', () => {
  it('a logout between the token check and connect: refused, never connected under the ended session', async () => {
    const pair = await auth.login(subject('parent'), PASSWORD);
    duringHandshake = () => auth.logout(pair.sessionId);
    expect(await outcomeOf(pair.accessToken)).toBe('io server disconnect');
  });

  it('a refresh rotation in that window: the same -- the client reconnects with its new token', async () => {
    const pair = await auth.login(subject('parent'), PASSWORD);
    duringHandshake = async () => void (await auth.refresh(pair.refreshToken));
    expect(await outcomeOf(pair.accessToken)).toBe('io server disconnect');
  });
});

describe('a handshake that does not finish', () => {
  it('too slow: the transport is dropped (a retry), not a refusal, and nothing is bound', async () => {
    gateway.handshakeTimeoutMs = AUTH_DELAY_MS / 4;
    const token = (await auth.login(subject('parent'), PASSWORD)).accessToken;
    // The parent may still be in an earlier test's offline grace: what matters
    // is that THIS connection is never recorded.
    const before = await redis.zrange(`presence:conns:${ids.parent}`, 0, -1);
    expect(await outcomeOf(token)).toBe('transport close');
    await sleep(AUTH_DELAY_MS * 2); // the late token check finishes, harmlessly
    expect(await redis.zrange(`presence:conns:${ids.parent}`, 0, -1)).toEqual(before);
  });

  it('a client that leaves mid-handshake leaves no room, no connection and no presence behind', async () => {
    const token = (await auth.login(subject('staff'), PASSWORD)).accessToken;
    const before = connections;
    const socket = ioClient(url, { transports: ['websocket'], forceNew: true, reconnection: false, auth: { token } });
    sockets.push(socket);
    await sleep(AUTH_DELAY_MS / 2);
    socket.close(); // while the token is still being checked
    await sleep(AUTH_DELAY_MS * 2);
    expect(connections).toBe(before);
    expect(io.of('/').adapter.rooms.get(room.actor(ids.staff))?.size ?? 0).toBe(0);
    expect(await presence.isOnline(ids.staff)).toBe(false);
  });
});

describe('presence', () => {
  it('is recorded for the person who connected, under this connection, and for nobody else', async () => {
    const token = (await auth.login(subject('teacher'), PASSWORD)).accessToken;
    const { socket } = await connectAndSend(token, []);
    const id = (socket as unknown as { id: string }).id;
    await sleep(100);
    expect(await redis.zrange(`presence:conns:${ids.teacher}`, 0, -1)).toEqual([id]);
    expect(await presence.isOnline(ids.teacher)).toBe(true);
    expect(await presence.isOnline(ids.parent)).toBe(false);
    expect(await presence.isOnline(ids.staff)).toBe(false);
  });
});

/**
 * A real PD-21 support session on the parent's account, opened by the staff
 * member as ImpersonationService opens one (row, target session, token).
 */
async function openSupportSession(): Promise<string> {
  const admin = await verify((await auth.login(subject('staff'), PASSWORD)).accessToken);
  if (!admin) throw new Error('the staff fixture could not sign in');
  const expiresAt = new Date(Date.now() + 15 * 60_000);
  const sessionId = await prisma.$transaction(async (tx) => {
    const row = await tx.impersonationSession.create({
      data: {
        organizationId: ORG,
        staffId: ids.staff,
        staffAccountId: ids.staffAccount,
        staffSessionId: admin.sessionId,
        targetAccountId: ids.parentAccount,
        targetKind: 'family',
        reason: 'realtime handshake spec',
        expiresAt,
      },
      select: { id: true },
    });
    const sid = await auth.openSupportSessionInTx(tx, {
      impersonationId: row.id,
      account: { id: ids.parentAccount, organizationId: ORG },
      expiresAt,
    });
    await tx.impersonationSession.update({ where: { id: row.id }, data: { sessionId: sid } });
    return sid;
  });
  const parent = await verify((await auth.login(subject('parent'), PASSWORD)).accessToken);
  if (!parent) throw new Error('the parent fixture could not sign in');
  return auth.signSupportAccessToken({ subject: subject('parent'), organizationId: ORG }, parent.actor, sessionId).accessToken;
}
