/**
 * PD-37 P1a-1 over real Socket.IO clients: typing and ticks reach only the
 * people they are for, and RT-009 still decides who may have them at all.
 *
 *   - "is typing" comes only from a SEATED member (live, not silent, not
 *     observer) and reaches only seated members -- never the manager who reads
 *     the group through PD-8 standing without a seat.
 *   - `message.status` (an audience of one) reaches its author only, and not
 *     even them once they have lost access.
 *
 * A lean single-node copy of realtime-revocation.spec's harness (which is
 * protected, so it is not edited here): one family -- a supervisor admin (a
 * member), two parents, a teacher -- and the department's manager.
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
import { CommEvent } from '@communication/contracts/events';
import { decodeEnvelope } from '../../src/infra/realtime/realtime-channel';
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
  onAny(fn: (event: string, ...a: unknown[]) => void): void;
  emit(event: string, ...a: unknown[]): void;
  close(): void;
}

const PASSWORD = 'a-pd037-realtime-audience-password';
const RUN = randomUUID().slice(0, 8);
const ORG = '00000000-0000-0000-0000-000000000001';
const GRACE_MS = 150;

const prisma = new PrismaService();
const identity = new PrismaIdentityService(prisma);
const audit = new PrismaAuditService();

// Typing's Redis debounce is TypingService's own concern; here every ping is new.
const typing = { start: async () => true, stop: async () => true } as unknown as TypingService;
const presence = {
  online: async () => undefined,
  offline: async () => undefined,
  heartbeat: async () => undefined,
} as unknown as PresenceService;

interface Client {
  socket: ClientSocket;
  inbox: Array<{ event: string; payload: unknown }>;
  subscribe(conversationId: string): Promise<{ ok: boolean }>;
  emitAck(event: string, body: unknown): Promise<{ ok: boolean }>;
  got(event: string, pred?: (p: Record<string, unknown>) => boolean): boolean;
  waitFor(event: string, pred?: (p: Record<string, unknown>) => boolean): Promise<void>;
}

const clients: Client[] = [];
let gateway: RealtimeGateway;
let conversations: ConversationService;
let auth: AuthService;
let io: Server;
let url: string;

function connect(token: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(url, { transports: ['websocket'], forceNew: true, reconnection: false, auth: { token } });
    const inbox: Client['inbox'] = [];
    socket.onAny((event, payload) => inbox.push({ event, payload }));
    const got: Client['got'] = (event, pred) =>
      inbox.some((e) => e.event === event && (!pred || pred(e.payload as Record<string, unknown>)));
    const client: Client = {
      socket,
      inbox,
      subscribe: (conversationId) => new Promise((r) => socket.emit('conversation.subscribe', { conversationId }, r)),
      emitAck: (event, body) => new Promise((r) => socket.emit(event, body, r)),
      got,
      waitFor: (event, pred) =>
        new Promise((r, j) => {
          const t = setTimeout(() => j(new Error(`timed out waiting for ${event}`)), 5_000);
          const tick = () => (got(event, pred) ? (clearTimeout(t), r()) : setTimeout(tick, 10));
          tick();
        }),
    };
    clients.push(client);
    socket.on('test.ready', () => resolve(client));
    socket.on('connect_error', (e) => reject(e));
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ids = {
  staffAccount: randomUUID(), staff: randomUUID(),
  managerAccount: randomUUID(), manager: randomUUID(),
  parentAccount: randomUUID(), parent: randomUUID(),
  parent2Account: randomUUID(), parent2: randomUUID(),
  teacherAccount: randomUUID(), teacher: randomUUID(),
  family: randomUUID(), learner: randomUUID(),
};
const subject = (who: string) => `pd037-${who}-${RUN}`;
let groupId: string;

async function as(who: 'staff' | 'manager' | 'parent' | 'parent2' | 'teacher'): Promise<Client> {
  const c = await connect((await auth.login(subject(who), PASSWORD)).accessToken);
  expect((await c.subscribe(groupId)).ok).toBe(true);
  return c;
}

beforeAll(async () => {
  await prisma.$connect();
  const exec = (sql: string) => prisma.$executeRawUnsafe(sql);
  const accounts: Array<[string, string, string]> = [
    [ids.staffAccount, 'staff', 'staff'],
    [ids.managerAccount, 'staff', 'manager'],
    [ids.parentAccount, 'family', 'parent'],
    [ids.parent2Account, 'family', 'parent2'],
    [ids.teacherAccount, 'teacher', 'teacher'],
  ];
  for (const [id, kind, who] of accounts) {
    await exec(`insert into chat.account (id, organization_id, subject, kind, status, is_active)
                values ('${id}'::uuid, '${ORG}'::uuid, '${subject(who)}', '${kind}', 'active', true)`);
  }
  await exec(`insert into chat.staff (id, organization_id, name, role, account_id) values
    ('${ids.staff}'::uuid, '${ORG}'::uuid, 'admin_p37', 'admin', '${ids.staffAccount}'::uuid),
    ('${ids.manager}'::uuid, '${ORG}'::uuid, 'manager_p37', 'manager', '${ids.managerAccount}'::uuid)`);
  await exec(`insert into chat.teacher (id, organization_id, name, is_active, account_id) values
    ('${ids.teacher}'::uuid, '${ORG}'::uuid, 'teacher_p37', true, '${ids.teacherAccount}'::uuid)`);
  await exec(`insert into chat.family (id, organization_id, display_name, owner_id, language) values
    ('${ids.family}'::uuid, '${ORG}'::uuid, 'family_p37', '${ids.staff}'::uuid, 'ar')`);
  await exec(`insert into chat.contact (id, organization_id, family_id, name, role_preset, can_message, account_id) values
    ('${ids.parent}'::uuid, '${ORG}'::uuid, '${ids.family}'::uuid, 'parent_p37', 'primary_guardian', true, '${ids.parentAccount}'::uuid),
    ('${ids.parent2}'::uuid, '${ORG}'::uuid, '${ids.family}'::uuid, 'parent_p37b', 'authorized_contact', true, '${ids.parent2Account}'::uuid)`);
  await withAssignmentGate(prisma, `insert into chat.learner (id, organization_id, family_id, name, teacher_id)
    values ('${ids.learner}'::uuid, '${ORG}'::uuid, '${ids.family}'::uuid, 'learner_p37', '${ids.teacher}'::uuid)`);
  // PD-8: the admin supervises the child; the manager runs their department.
  await supervise(prisma, ids.staff, [ids.learner], { managerId: ids.manager });

  const hub = new RealtimeRevocationHub();
  auth = new AuthService(prisma, identity, audit, hub);
  const coverage = new PinnedCoverage();
  const authz = new AuthorizationService(coverage, new SqlStaffScope(prisma));
  conversations = new ConversationService(
    prisma, authz, new OutboxService(), identity, coverage, audit, new PrismaRelationshipService(prisma), hub,
  );
  const messages = new MessageService(
    prisma, authz, conversations, new OutboxService(), new AppConfigService(prisma),
    new AttachmentService(prisma, authz, conversations, new SignedLocalObjectStorage()), audit, identity,
  );
  gateway = new RealtimeGateway(authz, conversations, typing, presence, messages, auth, hub);
  const server = http.createServer();
  io = new Server(server, { transports: ['websocket'] });
  gateway.server = io;
  gateway.afterInit();
  io.on('connection', (s: Socket) => {
    const ready = gateway.handleConnection(s as never);
    s.on('conversation.subscribe', async (body: unknown, ack?: (r: unknown) => void) =>
      ack?.(await gateway.subscribe(s as never, body as never)));
    s.on('typing.start', async (body: unknown, ack?: (r: unknown) => void) =>
      ack?.(await gateway.typingStart(s as never, body as never)));
    s.on('typing.stop', async (body: unknown, ack?: (r: unknown) => void) =>
      ack?.(await gateway.typingStop(s as never, body as never)));
    s.on('message.delivered', async (body: unknown, ack?: (r: unknown) => void) =>
      ack?.(await gateway.delivered(s as never, body as never)));
    s.on('disconnect', () => void gateway.handleDisconnect(s as never));
    void ready.then(() => s.connected && s.emit('test.ready'));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  for (const [id] of accounts) await auth.setPassword(id, PASSWORD);
  groupId = (await conversations.ensureStudentGroup(ids.learner, ids.staff)).id;
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.socket.close();
  await prisma.$executeRawUnsafe(
    `update chat.conversation_member set is_silent = false where conversation_id = '${groupId}'::uuid`,
  );
  const live = await conversations.membershipOf(groupId, ids.parent);
  if (!live) {
    await conversations.setMembership(groupId, ids.staff, { actorId: ids.parent, actorKind: 'contact', memberRole: 'parent' }, 'add', 'restore');
  }
});

afterAll(async () => {
  await gateway.onModuleDestroy();
  await new Promise<void>((r) => io.close(() => r()));
  await prisma.$disconnect();
});

const fromParent = (p: Record<string, unknown>) => p.actorId === ids.parent;

describe('PD-37: typing is between seated members only', () => {
  it("a parent's typing reaches the seated members and never the manager reading with standing", async () => {
    const [parent, parent2, teacher, staff, manager] = await Promise.all([
      as('parent'), as('parent2'), as('teacher'), as('staff'), as('manager'),
    ]);
    expect((await parent.emitAck('typing.start', { conversationId: groupId })).ok).toBe(true);
    for (const c of [parent2, teacher, staff]) await c.waitFor(CommEvent.TYPING_STARTED, fromParent);
    await sleep(GRACE_MS);
    expect(manager.got(CommEvent.TYPING_STARTED)).toBe(false);
    expect(parent.got(CommEvent.TYPING_STARTED)).toBe(false); // never echoed to the typist

    expect((await parent.emitAck('typing.stop', { conversationId: groupId })).ok).toBe(true);
    await parent2.waitFor(CommEvent.TYPING_STOPPED, fromParent);
    await sleep(GRACE_MS);
    expect(manager.got(CommEvent.TYPING_STOPPED)).toBe(false);
  });

  it('the manager, reading without a seat, cannot type into the group', async () => {
    const [parent2, manager] = await Promise.all([as('parent2'), as('manager')]);
    expect((await manager.emitAck('typing.start', { conversationId: groupId })).ok).toBe(false);
    await sleep(GRACE_MS);
    expect(parent2.got(CommEvent.TYPING_STARTED)).toBe(false);
  });

  it('a silent member neither types nor sees typing', async () => {
    await prisma.$executeRawUnsafe(
      `update chat.conversation_member set is_silent = true
        where conversation_id = '${groupId}'::uuid and actor_id = '${ids.parent2}'::uuid and left_at is null`,
    );
    const [parent, parent2, teacher] = await Promise.all([as('parent'), as('parent2'), as('teacher')]);
    expect((await parent2.emitAck('typing.start', { conversationId: groupId })).ok).toBe(false);
    expect((await parent.emitAck('typing.start', { conversationId: groupId })).ok).toBe(true);
    await teacher.waitFor(CommEvent.TYPING_STARTED, fromParent);
    await sleep(GRACE_MS);
    expect(parent2.got(CommEvent.TYPING_STARTED)).toBe(false);
    expect(parent.got(CommEvent.TYPING_STARTED)).toBe(false);
  });
});

describe('PD-37: a stop always gets through', () => {
  it('a typist silenced mid-word can still clear "typing…" for everyone else', async () => {
    const [parent, teacher] = await Promise.all([as('parent'), as('teacher')]);
    expect((await parent.emitAck('typing.start', { conversationId: groupId })).ok).toBe(true);
    await teacher.waitFor(CommEvent.TYPING_STARTED, fromParent);
    await prisma.$executeRawUnsafe(
      `update chat.conversation_member set is_silent = true
        where conversation_id = '${groupId}'::uuid and actor_id = '${ids.parent}'::uuid and left_at is null`,
    );
    expect((await parent.emitAck('typing.stop', { conversationId: groupId })).ok).toBe(true);
    await teacher.waitFor(CommEvent.TYPING_STOPPED, fromParent);
  });
});

describe('PD-37: the socket cursor spends the same budget as HTTP', () => {
  it('over budget, message.delivered { conversationId, upToSeq } is refused', async () => {
    const parent = await as('parent');
    const internals = gateway as unknown as { rateLimits?: unknown };
    const reserved: string[] = [];
    internals.rateLimits = {
      reserve: async (keys: string[]) => {
        reserved.push(...keys);
        return { exceeded: 1, retryAfterSeconds: 30 };
      },
      drop: async () => undefined,
    };
    try {
      const r = await parent.emitAck('message.delivered', { conversationId: groupId, upToSeq: '1' });
      expect(r.ok).toBe(false);
      expect(reserved.length).toBe(1);
      expect(reserved[0]).toMatch(/receipt_cursor_actor/);
    } finally {
      internals.rateLimits = undefined;
    }
    // Within budget (no store: fails open, as the HTTP guard does) it goes through.
    expect((await parent.emitAck('message.delivered', { conversationId: groupId, upToSeq: '1' })).ok).toBe(true);
  });
});

describe('PD-37: message.status reaches its author only, and only while they may read', () => {
  const status = (marker: string) => ({
    conversationId: groupId,
    items: [{ messageId: marker, seq: '1', status: 'read' as const }],
  });
  const carries = (marker: string) => (p: Record<string, unknown>) =>
    (p.items as Array<{ messageId: string }> | undefined)?.some((i) => i.messageId === marker) ?? false;

  it('an audience of one: nobody else in the room receives it', async () => {
    const [parent, parent2, teacher, staff, manager] = await Promise.all([
      as('parent'), as('parent2'), as('teacher'), as('staff'), as('manager'),
    ]);
    const marker = randomUUID();
    await gateway.toThreadAudience(groupId, CommEvent.MESSAGE_STATUS, status(marker), { onlyActors: [ids.parent] });
    await parent.waitFor(CommEvent.MESSAGE_STATUS, carries(marker));
    await sleep(GRACE_MS);
    for (const c of [parent2, teacher, staff, manager]) expect(c.got(CommEvent.MESSAGE_STATUS)).toBe(false);
  });

  it('one delivery for many authors: each receives only their OWN payload', async () => {
    const [parent, teacher, parent2] = await Promise.all([as('parent'), as('teacher'), as('parent2')]);
    const forParent = randomUUID();
    const forTeacher = randomUUID();
    await gateway.toThreadAudience(groupId, CommEvent.MESSAGE_STATUS, { conversationId: groupId, items: [] }, {
      onlyActors: [ids.parent, ids.teacher],
      perActor: { [ids.parent]: status(forParent), [ids.teacher]: status(forTeacher) },
    });
    await parent.waitFor(CommEvent.MESSAGE_STATUS, carries(forParent));
    await teacher.waitFor(CommEvent.MESSAGE_STATUS, carries(forTeacher));
    await sleep(GRACE_MS);
    expect(parent.got(CommEvent.MESSAGE_STATUS, carries(forTeacher))).toBe(false);
    expect(teacher.got(CommEvent.MESSAGE_STATUS, carries(forParent))).toBe(false);
    expect(parent2.got(CommEvent.MESSAGE_STATUS)).toBe(false);
  });

  it('RT-009 still applies: a removed author receives nothing, and is not mistaken for in-audience', async () => {
    const [parent, parent2] = await Promise.all([as('parent'), as('parent2')]);
    await conversations.setMembership(
      groupId, ids.staff, { actorId: ids.parent, actorKind: 'contact', memberRole: 'parent' }, 'remove', 'pd037 test',
    );
    const marker = randomUUID();
    await gateway.toThreadAudience(groupId, CommEvent.MESSAGE_STATUS, status(marker), { onlyActors: [ids.parent] });
    // A control delivery to the whole room proves the emits have happened.
    const control = randomUUID();
    await gateway.toThread(groupId, CommEvent.MESSAGE_CREATED, { conversationId: groupId, messageId: control, seq: '9' } as never);
    await parent2.waitFor(CommEvent.MESSAGE_CREATED, (p) => p.messageId === control);
    await sleep(GRACE_MS);
    expect(parent.got(CommEvent.MESSAGE_STATUS)).toBe(false);
    expect(parent2.got(CommEvent.MESSAGE_STATUS)).toBe(false);
  });
});

describe('PD-37: the worker relay never widens an audience', () => {
  it('a room-audience envelope without a usable audience is discarded, not delivered to the room', () => {
    const base = { target: 'room-audience', ids: [groupId], event: CommEvent.MESSAGE_STATUS, payload: {} };
    expect(decodeEnvelope(JSON.stringify(base))).toBeNull();
    expect(decodeEnvelope(JSON.stringify({ ...base, audience: {} }))).toBeNull();
    expect(decodeEnvelope(JSON.stringify({ ...base, audience: { onlyActors: 'x' } }))).toBeNull();
    expect(decodeEnvelope(JSON.stringify({ ...base, audience: { onlyActors: [ids.parent] } }))?.audience).toEqual({
      onlyActors: [ids.parent],
    });
    expect(decodeEnvelope(JSON.stringify({ ...base, audience: { countableOnly: true } }))).not.toBeNull();
  });
});
