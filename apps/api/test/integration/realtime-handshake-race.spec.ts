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
 * Wired as the Nest adapter wires a gateway: `afterInit` on the server,
 * listeners bound at once on `connection`, `handleConnection` not awaited. No
 * "test.ready" wait -- the client acts on `connect`, as real clients do.
 * Authentication is slowed down, so the old window is wide and certain.
 */
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
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
import type { PresenceService } from '@communication/realtime/presence.service';
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
const presence = {
  online: async () => false,
  offline: async () => undefined,
  heartbeat: async () => undefined,
} as unknown as PresenceService;

const ids = {
  staffAccount: randomUUID(), staff: randomUUID(),
  parentAccount: randomUUID(), parent: randomUUID(),
  teacherAccount: randomUUID(), teacher: randomUUID(),
  family: randomUUID(), learner: randomUUID(),
};
const subject = (who: string) => `race-${who}-${RUN}`;

let auth: AuthService;
let url: string;
let io: Server;
let server: http.Server;
let groupId: string;
let authentications = 0;
const sockets: ClientSocket[] = [];

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
  auth = new AuthService(prisma, identity, audit, hub);
  // The handshake's token check, slowed down and counted. Every other caller
  // (revalidation, HTTP) is untouched.
  const authenticate = auth.authenticate.bind(auth);
  auth.authenticate = async (token: string) => {
    authentications++;
    await new Promise((r) => setTimeout(r, AUTH_DELAY_MS));
    return authenticate(token);
  };
  const coverage = new PinnedCoverage();
  const authz = new AuthorizationService(coverage, new SqlStaffScope(prisma));
  const conversations = new ConversationService(
    prisma, authz, new OutboxService(), identity, coverage, audit, new PrismaRelationshipService(prisma), hub,
  );
  const messages = new MessageService(
    prisma, authz, conversations, new OutboxService(), new AppConfigService(prisma),
    new AttachmentService(prisma, authz, conversations, new SignedLocalObjectStorage()), audit, identity,
  );
  const gateway = new RealtimeGateway(authz, conversations, typing, presence, messages, auth, hub);
  server = http.createServer();
  io = new Server(server, { transports: ['websocket'] });
  gateway.server = io;
  gateway.afterInit();
  io.on('connection', (s: Socket) => {
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
});

afterAll(async () => {
  io?.close();
  await new Promise((r) => server?.close(r));
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
