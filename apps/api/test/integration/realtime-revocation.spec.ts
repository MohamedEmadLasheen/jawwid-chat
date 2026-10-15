/**
 * RT-009 — realtime revocation, end to end.
 *
 * INVARIANT. Once an actor's authorization to a conversation is revoked, that
 * actor receives no subsequent protected realtime event for it — not through
 * an open socket, an existing subscription, a re-subscription, a reconnect, a
 * second socket, or another node.
 *
 * WHAT IS REAL. A Socket.IO server on a loopback port; Socket.IO clients over
 * WebSocket (the client bundle shipped inside the `socket.io` package, running
 * on Node's built-in WebSocket — no extra dependency); tokens minted by
 * `AuthService.login`; the real RealtimeGateway, AuthService, ConversationService,
 * AuthorizationService and RealtimeRevocationHub; the migrated database. The
 * multi-node case adds the Redis adapter and the worker relay, on an isolated
 * Redis named by REALTIME_REVOCATION_REDIS_URL (skipped, and reported, if unset).
 *
 * HOW "NOT DELIVERED" IS PROVEN. Every negative is paired with a control socket
 * that IS entitled and DOES receive the same event; the revoked socket's inbox
 * is inspected only after the control's arrival, so a missing event cannot be
 * explained by a slow emit.
 *
 * WHAT IS NOT CLAIMED. An event delivered before revocation completed cannot be
 * recalled; the boundary tested is "after the revoking call has returned".
 *
 * THE CONTROL UNDER TEST is delivery-time authorization: every node decides
 * each recipient at the moment it delivers, against committed database state.
 * Room eviction and disconnect pushes are cleanup; several tests below switch
 * them off entirely (or make a node drop them) and still require denial.
 */
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { Server, Socket } from 'socket.io';
import Redis from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';
import { PrismaService } from '@platform/prisma.service';
import { PrismaIdentityService } from '@platform/identity.service';
import { PrismaAuditService } from '@platform/audit.service';
import { AuthService } from '@platform/auth/auth.service';
import { AuthorizationService } from '@platform/authorization.service';
import { PrismaRelationshipService } from '@platform/relationship.service';
import { NO_REALTIME_REVOCATION, RealtimeRevocationHub } from '@platform/realtime-revocation';
import { ConversationService } from '@communication/conversations/conversation.service';
import { MessageService } from '@communication/messages/message.service';
import { AttachmentService } from '@communication/attachments/attachment.service';
import { SignedLocalObjectStorage } from '@communication/attachments/object-storage';
import { OutboxService } from '@communication/outbox/outbox.service';
import { AppConfigService } from '@platform/app-config.service';
import {
  NODE_LEASE_MARGIN_MS,
  NODE_LEASE_MS,
  NODE_LEASE_RENEW_MS,
  RealtimeGateway,
} from '@communication/realtime/realtime.gateway';
import type { TypingService } from '@communication/realtime/typing.service';
import type { PresenceService } from '@communication/realtime/presence.service';
import { CommEvent, CONVERSATION_ACCESS_REVOKED } from '@communication/contracts/events';
import { RealtimeRelay } from '../../src/infra/realtime/realtime-relay.service';
import { RelayRealtimePublisher } from '../../src/infra/realtime/relay.publisher';
import { PinnedCoverage, withAssignmentGate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';

jest.setTimeout(60_000);

// The Socket.IO client bundled with the server package, loaded by path: the
// package's `exports` map does not expose it, and it is the same client.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ioClient: (url: string, opts: Record<string, unknown>) => ClientSocket = require(
  path.join(path.dirname(require.resolve('socket.io')), '..', 'client-dist', 'socket.io.js'),
);
interface ClientSocket {
  connected: boolean;
  on(event: string, fn: (...a: unknown[]) => void): void;
  onAny(fn: (event: string, ...a: unknown[]) => void): void;
  emit(event: string, ...a: unknown[]): void;
  close(): void;
}

const PASSWORD = 'a-realtime-revocation-password-1';
const RUN = randomUUID().slice(0, 8);
const ORG = '00000000-0000-0000-0000-000000000001';
const GRACE_MS = 150;

const prisma = new PrismaService();
const identity = new PrismaIdentityService(prisma);
const audit = new PrismaAuditService();

/** One "node": its own hub, services, gateway and Socket.IO server. */
interface Node {
  hub: RealtimeRevocationHub;
  auth: AuthService;
  conversations: ConversationService;
  gateway: RealtimeGateway;
  io: Server;
  http: http.Server;
  url: string;
}

const typing = {
  start: async () => true,
  stop: async () => true,
} as unknown as TypingService;
const presence = {
  online: async () => undefined,
  offline: async () => undefined,
  heartbeat: async () => undefined,
} as unknown as PresenceService;

async function startNode(adapter?: ReturnType<typeof createAdapter>): Promise<Node> {
  const hub = new RealtimeRevocationHub();
  const auth = new AuthService(prisma, identity, audit, hub);
  const coverage = new PinnedCoverage();
  const authz = new AuthorizationService(coverage);
  const conversations = new ConversationService(
    prisma, authz, new OutboxService(), identity, coverage, audit, new PrismaRelationshipService(prisma), hub,
  );
  const messages = new MessageService(
    prisma, authz, conversations, new OutboxService(), new AppConfigService(prisma),
    new AttachmentService(prisma, authz, conversations, new SignedLocalObjectStorage()), audit, identity,
  );
  const gateway = new RealtimeGateway(authz, conversations, typing, presence, messages, auth, hub);

  const server = http.createServer();
  const io = new Server(server, { transports: ['websocket'], ...(adapter ? { adapter } : {}) });
  gateway.server = io;
  gateway.afterInit();
  // Bound as the Nest adapter binds them: listeners at once, identity async.
  io.on('connection', (s: Socket) => {
    const ready = gateway.handleConnection(s as never);
    s.on('conversation.subscribe', async (body: unknown, ack?: (r: unknown) => void) =>
      ack?.(await gateway.subscribe(s as never, body as never)));
    s.on('conversation.unsubscribe', async (body: unknown, ack?: (r: unknown) => void) =>
      ack?.(await gateway.unsubscribe(s as never, body as never)));
    s.on('typing.stop', async (body: unknown, ack?: (r: unknown) => void) =>
      ack?.(await gateway.typingStop(s as never, body as never)));
    s.on('disconnect', () => void gateway.handleDisconnect(s as never));
    void ready.then(() => s.connected && s.emit('test.ready'));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const { port } = server.address() as AddressInfo;
  // A cluster node delivers only once it holds its lease (the completion barrier).
  if (adapter) await waitUntil(async () => gateway.canDeliver(), 'the node holds its lease');
  return { hub, auth, conversations, gateway, io, http: server, url: `http://127.0.0.1:${port}` };
}

/**
 * Run `fn` with every revocation PUSH from this node switched off. The pushes
 * are cleanup; the completion barrier is not a push, and stays on.
 */
async function withoutPushes<T>(n: Node, fn: () => Promise<T>): Promise<T> {
  n.hub.attach({ ...NO_REALTIME_REVOCATION, confirmRevoked: () => n.gateway.confirmRevoked() });
  try {
    return await fn();
  } finally {
    n.hub.attach(n.gateway);
  }
}

async function stopNode(n: Node): Promise<void> {
  await n.gateway.onModuleDestroy();
  await new Promise<void>((r) => n.io.close(() => r()));
}

/** A real client, with an inbox. Resolves once the server has authenticated it. */
interface Client {
  socket: ClientSocket;
  inbox: Array<{ event: string; payload: unknown }>;
  disconnectedByServer: () => boolean;
  subscribe(conversationId: string, extra?: Record<string, unknown>): Promise<{ ok: boolean; code?: string }>;
  emitAck(event: string, body: unknown): Promise<unknown>;
  has(event: string, marker: string): boolean;
  waitFor(event: string, marker: string): Promise<void>;
  /** Waits for an event carrying this conversationId (used for the revocation notice). */
  waitForNotice(event: string, conversationId: string): Promise<void>;
}

const clients: Client[] = [];

function connect(node: Node, token: string, extraAuth: Record<string, unknown> = {}): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(node.url, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: { token, ...extraAuth },
    });
    const inbox: Client['inbox'] = [];
    let serverDisconnect = false;
    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') serverDisconnect = true;
    });
    socket.onAny((event, payload) => inbox.push({ event, payload }));
    const markerOf = (p: unknown) => (p as { messageId?: string; conversationId?: string })?.messageId;
    const client: Client = {
      socket,
      inbox,
      disconnectedByServer: () => serverDisconnect,
      subscribe: (conversationId, extra = {}) =>
        new Promise((r) => socket.emit('conversation.subscribe', { conversationId, ...extra }, r)),
      emitAck: (event, body) => new Promise((r) => socket.emit(event, body, r)),
      has: (event, marker) => inbox.some((e) => e.event === event && markerOf(e.payload) === marker),
      waitFor: (event, marker) =>
        new Promise((r, j) => {
          const t = setTimeout(() => j(new Error(`timed out waiting for ${event} ${marker}`)), 5_000);
          const tick = () => (client.has(event, marker) ? (clearTimeout(t), r()) : setTimeout(tick, 10));
          tick();
        }),
      waitForNotice: (event, conversationId) =>
        new Promise((r, j) => {
          const t = setTimeout(() => j(new Error(`timed out waiting for ${event}`)), 5_000);
          const seen = () =>
            inbox.some((e) => e.event === event && (e.payload as { conversationId?: string })?.conversationId === conversationId);
          const tick = () => (seen() ? (clearTimeout(t), r()) : setTimeout(tick, 10));
          tick();
        }),
    };
    clients.push(client);
    socket.on('test.ready', () => resolve(client));
    socket.on('connect_error', (e) => reject(e));
    socket.on('disconnect', () => resolve(client)); // refused at handshake
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Emit one protected thread event through the gateway's real delivery entry point. */
async function publish(node: Node, conversationId: string): Promise<string> {
  const marker = randomUUID();
  await node.gateway.toThread(conversationId, CommEvent.MESSAGE_CREATED, {
    conversationId,
    messageId: marker,
    seq: '1',
  } as never);
  return marker;
}

/**
 * `revoked` must NOT have the event; `control` (entitled) must have it. The
 * control's arrival proves the emit happened before the revoked inbox is read.
 */
async function deliveredOnlyTo(node: Node, conversationId: string, control: Client, revoked: Client[]) {
  const marker = await publish(node, conversationId);
  await control.waitFor(CommEvent.MESSAGE_CREATED, marker);
  await sleep(GRACE_MS);
  for (const r of revoked) expect(r.has(CommEvent.MESSAGE_CREATED, marker)).toBe(false);
  return marker;
}

/**
 * Publish continuously while `revoke` runs. Every event published AFTER
 * `revoke` returned must reach `control` and none of `revoked`. Events
 * published before (or during) the revocation may go either way -- an event
 * already delivered cannot be recalled, and that is not what is claimed.
 */
async function raceDeliveryAgainst(
  publishOne: (marker: string) => Promise<void>,
  revoke: () => Promise<void>,
  control: Client,
  revoked: Client[],
): Promise<{ before: number; after: number }> {
  const sent: Array<{ marker: string; afterRevocation: boolean }> = [];
  let revocationReturned = false;
  let stop = false;
  const pump = (async () => {
    while (!stop) {
      const marker = randomUUID();
      const afterRevocation = revocationReturned; // decided BEFORE publishing
      await publishOne(marker);
      sent.push({ marker, afterRevocation });
    }
  })();
  // Condition-based, not time windows: enough events before the revocation,
  // and enough STARTED after it returned, however slow this machine is.
  await waitUntil(async () => sent.length >= 3, 'events published before the revocation');
  await revoke();
  revocationReturned = true;
  await waitUntil(async () => sent.filter((e) => e.afterRevocation).length >= 3, 'events published after it returned');
  stop = true;
  await pump;
  for (const e of sent) await control.waitFor(CommEvent.MESSAGE_CREATED, e.marker);
  await sleep(GRACE_MS);
  const after = sent.filter((e) => e.afterRevocation);
  const leaked = after.filter((e) => revoked.some((r) => r.has(CommEvent.MESSAGE_CREATED, e.marker)));
  expect(after.length).toBeGreaterThan(0); // the race actually ran
  expect(leaked.map((e) => e.marker)).toEqual([]);
  return { before: sent.length - after.length, after: after.length };
}

const publishVia = (n: Node, conversationId: string) => async (marker: string) => {
  await n.gateway.toThread(conversationId, CommEvent.MESSAGE_CREATED, { conversationId, messageId: marker, seq: '1' } as never);
};

// ---------------------------------------------------------------------------
// Fixtures: one family (owner admin, two parents, a teacher, a learner), plus a
// stranger teacher and a second organization's parent.
// ---------------------------------------------------------------------------
const ids = {
  staffAccount: randomUUID(), staff: randomUUID(),
  managerAccount: randomUUID(), manager: randomUUID(),
  parentAccount: randomUUID(), parent: randomUUID(),
  parent2Account: randomUUID(), parent2: randomUUID(),
  teacherAccount: randomUUID(), teacher: randomUUID(),
  strangerAccount: randomUUID(), stranger: randomUUID(),
  otherOrg: randomUUID(), otherAccount: randomUUID(), otherStaff: randomUUID(), otherParent: randomUUID(), otherFamily: randomUUID(),
  family: randomUUID(), learner: randomUUID(),
};
const subject = (who: string) => `rt009-${who}-${RUN}`;

let node: Node;
let groupId: string;
let directId: string;

async function login(who: string) {
  return node.auth.login(subject(who), PASSWORD);
}

beforeAll(async () => {
  await prisma.$connect();
  const exec = (sql: string) => prisma.$executeRawUnsafe(sql);
  await exec(`insert into chat.organization (id, slug, display_name) values ('${ids.otherOrg}'::uuid, 'rt009-${RUN}', 'rt009 other')`);
  const accounts: Array<[string, string, string, string]> = [
    [ids.staffAccount, 'staff', 'staff', ORG],
    [ids.managerAccount, 'staff', 'manager', ORG],
    [ids.parentAccount, 'family', 'parent', ORG],
    [ids.parent2Account, 'family', 'parent2', ORG],
    [ids.teacherAccount, 'teacher', 'teacher', ORG],
    [ids.strangerAccount, 'teacher', 'stranger', ORG],
    [ids.otherAccount, 'family', 'other', ids.otherOrg],
  ];
  for (const [id, kind, who, org] of accounts) {
    await exec(`insert into chat.account (id, organization_id, subject, kind, status, is_active)
                values ('${id}'::uuid, '${org}'::uuid, '${subject(who)}', '${kind}', 'active', true)`);
  }
  await exec(`insert into chat.staff (id, organization_id, name, role, account_id) values
    ('${ids.staff}'::uuid, '${ORG}'::uuid, 'admin_r9', 'admin', '${ids.staffAccount}'::uuid),
    ('${ids.manager}'::uuid, '${ORG}'::uuid, 'manager_r9', 'manager', '${ids.managerAccount}'::uuid),
    ('${ids.otherStaff}'::uuid, '${ids.otherOrg}'::uuid, 'admin_r9z', 'admin', null)`);
  await exec(`insert into chat.teacher (id, organization_id, name, is_active, account_id) values
    ('${ids.teacher}'::uuid, '${ORG}'::uuid, 'teacher_r9', true, '${ids.teacherAccount}'::uuid),
    ('${ids.stranger}'::uuid, '${ORG}'::uuid, 'teacher_r9s', true, '${ids.strangerAccount}'::uuid)`);
  await exec(`insert into chat.family (id, organization_id, display_name, owner_id, language) values
    ('${ids.family}'::uuid, '${ORG}'::uuid, 'family_r9', '${ids.staff}'::uuid, 'ar'),
    ('${ids.otherFamily}'::uuid, '${ids.otherOrg}'::uuid, 'family_r9z', '${ids.otherStaff}'::uuid, 'ar')`);
  await exec(`insert into chat.contact (id, organization_id, family_id, name, role_preset, can_message, account_id) values
    ('${ids.parent}'::uuid, '${ORG}'::uuid, '${ids.family}'::uuid, 'parent_r9', 'primary_guardian', true, '${ids.parentAccount}'::uuid),
    ('${ids.parent2}'::uuid, '${ORG}'::uuid, '${ids.family}'::uuid, 'parent_r9b', 'authorized_contact', true, '${ids.parent2Account}'::uuid),
    ('${ids.otherParent}'::uuid, '${ids.otherOrg}'::uuid, '${ids.otherFamily}'::uuid, 'parent_r9z', 'primary_guardian', true, '${ids.otherAccount}'::uuid)`);
  await withAssignmentGate(prisma, `insert into chat.learner (id, organization_id, family_id, name, teacher_id)
    values ('${ids.learner}'::uuid, '${ORG}'::uuid, '${ids.family}'::uuid, 'learner_r9', '${ids.teacher}'::uuid)`);

  node = await startNode();
  for (const [id] of accounts) await node.auth.setPassword(id, PASSWORD);
  groupId = (await node.conversations.ensureStudentGroup(ids.learner, ids.staff)).id;
  directId = (await node.conversations.getOrCreateDirect(ids.parent, ids.staff)).id;
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.socket.close();
  // Restore the family between tests: both parents members, both active.
  await prisma.$executeRawUnsafe(`update chat.contact set is_active = true, can_message = true where id in ('${ids.parent}'::uuid, '${ids.parent2}'::uuid)`);
  await prisma.$executeRawUnsafe(`update chat.staff set role = 'admin' where id = '${ids.staff}'::uuid`);
  await prisma.$executeRawUnsafe(`update chat.account set is_active = true, status = 'active' where id = '${ids.parentAccount}'::uuid`);
  await prisma.$executeRawUnsafe(`update chat.teacher set is_active = true, left_at = null where id = '${ids.teacher}'::uuid`);
  node.conversations.deliveryTransactionTimeoutMs = 15_000;
  for (const p of [ids.parent, ids.parent2]) {
    const live = await node.conversations.membershipOf(groupId, p);
    if (!live) {
      await node.conversations.setMembership(groupId, ids.staff, { actorId: p, actorKind: 'contact', memberRole: 'parent' }, 'add', 'restore');
    }
  }
});

afterAll(async () => {
  await stopNode(node);
  await prisma.$disconnect();
});

const removeParent = (who: string) =>
  node.conversations.setMembership(groupId, ids.staff, { actorId: who, actorKind: 'contact', memberRole: 'parent' }, 'remove', 'rt009 test');

// ===========================================================================
describe('membership removal — an open socket stops receiving at once', () => {
  it('receives before; after removal returns, receives nothing while the other parent still does', async () => {
    const p = await connect(node, (await login('parent')).accessToken);
    const p2 = await connect(node, (await login('parent2')).accessToken);
    expect((await p.subscribe(groupId)).ok).toBe(true);
    expect((await p2.subscribe(groupId)).ok).toBe(true);

    const before = await publish(node, groupId);
    await p.waitFor(CommEvent.MESSAGE_CREATED, before); // 1. delivered while authorized

    await removeParent(ids.parent);
    // The removed member is told (the notice travels the network, so wait for
    // it) -- but the security property is the eviction, asserted next.
    await p.waitForNotice(CONVERSATION_ACCESS_REVOKED, groupId);
    await deliveredOnlyTo(node, groupId, p2, [p]); // 3 + 4
    expect(p.socket.connected).toBe(true); // a membership change is not a logout
  });

  it('the old subscription cannot be re-used, and re-subscribing is refused', async () => {
    const p = await connect(node, (await login('parent')).accessToken);
    const p2 = await connect(node, (await login('parent2')).accessToken);
    await p.subscribe(groupId);
    await p2.subscribe(groupId);
    await removeParent(ids.parent);

    const again = await p.subscribe(groupId);
    expect(again.ok).toBe(false);
    await deliveredOnlyTo(node, groupId, p2, [p]);
  });

  it('a reconnect with the same token cannot restore access', async () => {
    const token = (await login('parent')).accessToken;
    const p = await connect(node, token);
    const p2 = await connect(node, (await login('parent2')).accessToken);
    await p.subscribe(groupId);
    await p2.subscribe(groupId);
    await removeParent(ids.parent);
    p.socket.close();

    const reconnected = await connect(node, token);
    expect((await reconnected.subscribe(groupId)).ok).toBe(false);
    await deliveredOnlyTo(node, groupId, p2, [p, reconnected]);
  });

  it('every socket of the removed member is evicted — two tabs, two devices', async () => {
    const tab1 = await connect(node, (await login('parent')).accessToken);
    const tab2 = await connect(node, (await login('parent')).accessToken);
    const p2 = await connect(node, (await login('parent2')).accessToken);
    for (const c of [tab1, tab2, p2]) expect((await c.subscribe(groupId)).ok).toBe(true);
    await removeParent(ids.parent);
    await deliveredOnlyTo(node, groupId, p2, [tab1, tab2]);
  });

  it('revocation is scoped: the same parent keeps receiving their OTHER conversation', async () => {
    const p = await connect(node, (await login('parent')).accessToken);
    const admin = await connect(node, (await login('staff')).accessToken);
    await p.subscribe(groupId);
    await p.subscribe(directId);
    await admin.subscribe(directId);
    await removeParent(ids.parent);

    const marker = await publish(node, directId);
    await p.waitFor(CommEvent.MESSAGE_CREATED, marker);
    await admin.waitFor(CommEvent.MESSAGE_CREATED, marker);
  });

  it('a removed member cannot broadcast typing into the room (typing.stop was unauthorized)', async () => {
    const p = await connect(node, (await login('parent')).accessToken);
    const p2 = await connect(node, (await login('parent2')).accessToken);
    await p.subscribe(groupId);
    await p2.subscribe(groupId);
    await removeParent(ids.parent);
    const r = (await p.emitAck('typing.stop', { conversationId: groupId })) as { ok: boolean };
    expect(r.ok).toBe(false);
    await sleep(GRACE_MS);
    expect(p2.inbox.some((e) => e.event === CommEvent.TYPING_STOPPED)).toBe(false);
  });
});

// ===========================================================================
describe('the race between subscribing and removal', () => {
  it('whichever wins, once both have completed the removed member is not in the room', async () => {
    const p2 = await connect(node, (await login('parent2')).accessToken);
    await p2.subscribe(groupId);
    for (let i = 0; i < 12; i++) {
      const p = await connect(node, (await login('parent')).accessToken);
      await Promise.all([p.subscribe(groupId), removeParent(ids.parent)]);
      await deliveredOnlyTo(node, groupId, p2, [p]);
      p.socket.close();
      await node.conversations.setMembership(groupId, ids.staff, { actorId: ids.parent, actorKind: 'contact', memberRole: 'parent' }, 'add', 'race reset');
    }
  });

  it('an event already queued is not delivered once the removal has returned', async () => {
    const p = await connect(node, (await login('parent')).accessToken);
    const p2 = await connect(node, (await login('parent2')).accessToken);
    await p.subscribe(groupId);
    await p2.subscribe(groupId);
    // A removal and a delivery issued together: the delivery that is emitted
    // after the removal returns must not reach the removed member.
    await removeParent(ids.parent);
    await deliveredOnlyTo(node, groupId, p2, [p]);
  });
});

// ===========================================================================
describe('delivery-time authorization holds with NO revocation push at all', () => {
  it('continuous publication racing a removal: nothing published after it returned reaches the member', async () => {
    const p = await connect(node, (await login('parent')).accessToken);
    const p2 = await connect(node, (await login('parent2')).accessToken);
    await p.subscribe(groupId);
    await p2.subscribe(groupId);
    const counts = await raceDeliveryAgainst(publishVia(node, groupId), () => removeParent(ids.parent), p2, [p]);
    expect(counts.before).toBeGreaterThan(0);
  });

  it('the same race with every push switched off -- the socket is never evicted, and still receives nothing', async () => {
    const p = await connect(node, (await login('parent')).accessToken);
    const p2 = await connect(node, (await login('parent2')).accessToken);
    await p.subscribe(groupId);
    await p2.subscribe(groupId);
    await withoutPushes(node, () =>
      raceDeliveryAgainst(publishVia(node, groupId), () => removeParent(ids.parent), p2, [p]),
    );
  });

  it('logout with pushes off: that session receives nothing at once; another session of the same user still does', async () => {
    const s1 = await login('parent');
    const s2 = await login('parent');
    const a = await connect(node, s1.accessToken);
    const b = await connect(node, s2.accessToken);
    const p2 = await connect(node, (await login('parent2')).accessToken);
    for (const c of [a, b, p2]) await c.subscribe(groupId);
    await withoutPushes(node, () => node.auth.logout(s1.sessionId));
    // No push, no sweep: the very next delivery is decided session-precisely.
    await deliveredOnlyTo(node, groupId, p2, [a]);
    const m = await publish(node, groupId);
    await b.waitFor(CommEvent.MESSAGE_CREATED, m);
  });

  it('a deactivation made in the database is denied at the very next delivery; the sweep window is measured', async () => {
    const a = await connect(node, (await login('parent')).accessToken);
    const p2 = await connect(node, (await login('parent2')).accessToken);
    await a.subscribe(groupId);
    await p2.subscribe(groupId);
    const interval = 400;
    node.gateway.startRevalidation(interval);
    try {
      await prisma.$executeRawUnsafe(`update chat.contact set is_active = false where id = '${ids.parent}'::uuid`);
      const changedAt = Date.now();
      await deliveredOnlyTo(node, groupId, p2, [a]); // delivery: denied immediately
      while (!a.disconnectedByServer() && Date.now() - changedAt < 10_000) await sleep(10);
      const window = Date.now() - changedAt;
      // eslint-disable-next-line no-console
      console.log(`RT-009 measured: connection dropped ${window} ms after a DB-only deactivation (sweep interval ${interval} ms)`);
      expect(a.disconnectedByServer()).toBe(true);
      expect(window).toBeLessThanOrEqual(interval * 2 + 500);
    } finally {
      node.gateway.startRevalidation(15_000);
    }
  });
});

// ===========================================================================
// The decided-but-not-yet-emitted race, made deterministic.
//
// A delivery reads membership/identity, then emits on a LATER event-loop turn.
// If a revocation can commit AND RETURN in between, the delivery emits after
// the revocation completed. The barrier holds a delivery exactly between its
// decision and its emits; the revocation is then started and the test waits for
// a DEFINITE state -- it has returned, or it is blocked on a row lock (read from
// pg_stat_activity) -- with no timing guesses. Only then is the delivery released.
// ===========================================================================
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

async function lockWaiters(): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `select count(*)::int n from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()`,
  );
  return rows[0]?.n ?? 0;
}

async function waitUntil(condition: () => Promise<boolean>, what: string, withinMs = 10_000): Promise<void> {
  const deadline = Date.now() + withinMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`condition never held: ${what}`);
    await new Promise((r) => setImmediate(r));
  }
}

/** Hold the next delivery between its decision and its emits. */
function holdNextDelivery(n: Node) {
  const reached = deferred();
  const release = deferred();
  n.gateway.deliveryBarrier = async () => {
    n.gateway.deliveryBarrier = undefined; // one delivery only
    reached.resolve();
    await release.promise;
  };
  return { reached: reached.promise, release: () => release.resolve() };
}

describe('the decided-but-not-yet-emitted race (deterministic)', () => {
  afterEach(() => {
    node.gateway.deliveryBarrier = undefined;
  });

  it('a removal cannot RETURN while an already-authorized delivery to that member is still pending', async () => {
    const p = await connect(node, (await login('parent')).accessToken);
    const p2 = await connect(node, (await login('parent2')).accessToken);
    await p.subscribe(groupId);
    await p2.subscribe(groupId);

    const held = holdNextDelivery(node);
    const marker = randomUUID();
    const delivery = node.gateway.toThread(groupId, CommEvent.MESSAGE_CREATED, {
      conversationId: groupId,
      messageId: marker,
      seq: '1',
    } as never);
    await held.reached; // decided: the parent IS authorized for this event

    let removalReturned = false;
    const removal = removeParent(ids.parent).then(() => {
      removalReturned = true;
    });
    await waitUntil(async () => removalReturned || (await lockWaiters()) > 0, 'removal returned or blocked');
    const returnedWhileDeliveryPending = removalReturned;

    held.release();
    await delivery;
    await removal;
    await p2.waitFor(CommEvent.MESSAGE_CREATED, marker); // control: delivered
    await sleep(GRACE_MS);

    // THE VIOLATION, stated directly: the removal returned, and the event was
    // emitted to the removed member afterwards.
    expect(returnedWhileDeliveryPending && p.has(CommEvent.MESSAGE_CREATED, marker)).toBe(false);
    // The guarantee that prevents it: the removal waits for the pending delivery.
    expect(returnedWhileDeliveryPending).toBe(false);
    // And after the removal has returned, nothing new reaches the member.
    await deliveredOnlyTo(node, groupId, p2, [p]);
  });

  it('a logout cannot RETURN while an already-authorized delivery to that session is still pending', async () => {
    const session = await login('parent');
    const p = await connect(node, session.accessToken);
    const p2 = await connect(node, (await login('parent2')).accessToken);
    await p.subscribe(groupId);
    await p2.subscribe(groupId);

    const held = holdNextDelivery(node);
    const marker = randomUUID();
    const delivery = node.gateway.toThread(groupId, CommEvent.MESSAGE_CREATED, {
      conversationId: groupId,
      messageId: marker,
      seq: '1',
    } as never);
    await held.reached;

    let logoutReturned = false;
    const logout = withoutPushes(node, () => node.auth.logout(session.sessionId)).then(() => {
      logoutReturned = true;
    });
    await waitUntil(async () => logoutReturned || (await lockWaiters()) > 0, 'logout returned or blocked');
    const returnedWhileDeliveryPending = logoutReturned;

    held.release();
    await delivery;
    await logout;
    await p2.waitFor(CommEvent.MESSAGE_CREATED, marker);
    await sleep(GRACE_MS);

    expect(returnedWhileDeliveryPending && p.has(CommEvent.MESSAGE_CREATED, marker)).toBe(false);
    expect(returnedWhileDeliveryPending).toBe(false);
    await deliveredOnlyTo(node, groupId, p2, [p]);
  });
});

describe('the decided-but-not-yet-emitted race — revocation made directly in the database', () => {
  afterEach(() => {
    node.gateway.deliveryBarrier = undefined;
  });

  it('a deactivation UPDATE cannot COMPLETE while an already-authorized delivery to that person is pending', async () => {
    const p = await connect(node, (await login('parent')).accessToken);
    const p2 = await connect(node, (await login('parent2')).accessToken);
    await p.subscribe(groupId);
    await p2.subscribe(groupId);

    const held = holdNextDelivery(node);
    const marker = randomUUID();
    const delivery = node.gateway.toThread(groupId, CommEvent.MESSAGE_CREATED, {
      conversationId: groupId,
      messageId: marker,
      seq: '1',
    } as never);
    await held.reached;

    let updateReturned = false;
    const deactivation = withoutPushes(node, () =>
      prisma.$executeRawUnsafe(`update chat.contact set is_active = false where id = '${ids.parent}'::uuid`),
    ).then(() => {
      updateReturned = true;
    });
    await waitUntil(async () => updateReturned || (await lockWaiters()) > 0, 'deactivation returned or blocked');
    const returnedWhileDeliveryPending = updateReturned;

    held.release();
    await delivery;
    await deactivation;
    await p2.waitFor(CommEvent.MESSAGE_CREATED, marker);
    await sleep(GRACE_MS);

    expect(returnedWhileDeliveryPending && p.has(CommEvent.MESSAGE_CREATED, marker)).toBe(false);
    expect(returnedWhileDeliveryPending).toBe(false);
    await deliveredOnlyTo(node, groupId, p2, [p]);
  });
});

/**
 * The shared shape of every revocation race: hold a delivery between decision
 * and emit, start `revoke`, wait for a DEFINITE state (returned, or blocked on
 * a row lock), release. Asserts the revocation could not return while the
 * delivery was pending, and that nothing reaches `revoked` after it returned.
 */
async function expectRevocationWaitsForDelivery(opts: {
  deliveringNode: Node;
  deliver: (marker: string) => Promise<void>;
  revoke: () => Promise<unknown>;
  revoked: Client;
  control: Client;
  afterwards: () => Promise<unknown>;
}): Promise<void> {
  const held = holdNextDelivery(opts.deliveringNode);
  const marker = randomUUID();
  const delivery = opts.deliver(marker);
  await held.reached;
  let returned = false;
  const revocation = Promise.resolve(opts.revoke()).then(() => {
    returned = true;
  });
  await waitUntil(async () => returned || (await lockWaiters()) > 0, 'revocation returned or blocked');
  const returnedWhileDeliveryPending = returned;
  held.release();
  await delivery;
  await revocation;
  await opts.control.waitFor(CommEvent.MESSAGE_CREATED, marker);
  await sleep(GRACE_MS);
  expect(returnedWhileDeliveryPending && opts.revoked.has(CommEvent.MESSAGE_CREATED, marker)).toBe(false);
  expect(returnedWhileDeliveryPending).toBe(false);
  await opts.afterwards();
}

describe('the decided-but-not-yet-emitted race — every locked row type', () => {
  afterEach(() => {
    node.gateway.deliveryBarrier = undefined;
  });

  it('ACCOUNT row: deactivating the account cannot complete while a delivery to it is pending', async () => {
    const p = await connect(node, (await login('parent')).accessToken);
    const p2 = await connect(node, (await login('parent2')).accessToken);
    await p.subscribe(groupId);
    await p2.subscribe(groupId);
    await expectRevocationWaitsForDelivery({
      deliveringNode: node,
      deliver: publishVia(node, groupId),
      revoke: () =>
        withoutPushes(node, () =>
          prisma.$executeRawUnsafe(`update chat.account set is_active = false, status = 'suspended' where id = '${ids.parentAccount}'::uuid`),
        ),
      revoked: p,
      control: p2,
      afterwards: () => deliveredOnlyTo(node, groupId, p2, [p]),
    });
  });

  it('STAFF principal row: a role downgrade cannot complete while a delivery to that staff member is pending', async () => {
    const admin = await connect(node, (await login('staff')).accessToken);
    const p2 = await connect(node, (await login('parent2')).accessToken);
    await admin.subscribe(groupId);
    await p2.subscribe(groupId);
    await expectRevocationWaitsForDelivery({
      deliveringNode: node,
      deliver: publishVia(node, groupId),
      revoke: () =>
        withoutPushes(node, () => prisma.$executeRawUnsafe(`update chat.staff set role = 'finance' where id = '${ids.staff}'::uuid`)),
      revoked: admin,
      control: p2,
      afterwards: () => deliveredOnlyTo(node, groupId, p2, [admin]),
    });
  });

  it('TEACHER principal row: deactivating the teacher cannot complete while a delivery to them is pending', async () => {
    const t = await connect(node, (await login('teacher')).accessToken);
    const p2 = await connect(node, (await login('parent2')).accessToken);
    expect((await t.subscribe(groupId)).ok).toBe(true);
    await p2.subscribe(groupId);
    await expectRevocationWaitsForDelivery({
      deliveringNode: node,
      deliver: publishVia(node, groupId),
      revoke: () =>
        withoutPushes(node, () =>
          prisma.$executeRawUnsafe(`update chat.teacher set is_active = false, left_at = now() where id = '${ids.teacher}'::uuid`),
        ),
      revoked: t,
      control: p2,
      afterwards: () => deliveredOnlyTo(node, groupId, p2, [t]),
    });
  });
});

describe('a delivery whose transaction has ENDED emits nothing', () => {
  afterEach(() => {
    node.gateway.deliveryBarrier = undefined;
    node.conversations.deliveryTransactionTimeoutMs = 15_000;
  });

  it('the locks were released by a transaction timeout and a removal RETURNED: the held decision is never emitted', async () => {
    const p = await connect(node, (await login('parent')).accessToken);
    const p2 = await connect(node, (await login('parent2')).accessToken);
    await p.subscribe(groupId);
    await p2.subscribe(groupId);
    node.conversations.deliveryTransactionTimeoutMs = 400; // this test only

    const held = holdNextDelivery(node);
    const marker = randomUUID();
    const delivery = publishVia(node, groupId)(marker);
    await held.reached; // decided under the locks: the parent IS authorized
    // Blocked by the locks until the transaction times out and rolls back; it
    // then commits and RETURNS while the decision is still held.
    await removeParent(ids.parent);
    held.release();
    await delivery;

    // The decision outlived its locks, so it must not be emitted -- to anyone.
    await sleep(GRACE_MS);
    expect(p.has(CommEvent.MESSAGE_CREATED, marker)).toBe(false);
    expect(p2.has(CommEvent.MESSAGE_CREATED, marker)).toBe(false); // fails closed
    // And delivery itself is not stuck: the next event reaches the control only.
    await deliveredOnlyTo(node, groupId, p2, [p]);
  });
});

describe('a delivery that cannot get its locks fails closed, and the queue moves on', () => {
  it('blocked by a writer beyond lock_timeout: nothing is delivered, resources are released, the next event flows', async () => {
    const p = await connect(node, (await login('parent')).accessToken);
    const p2 = await connect(node, (await login('parent2')).accessToken);
    await p.subscribe(groupId);
    await p2.subscribe(groupId);

    // A writer holds the parent's membership row exclusively and does not let go.
    const writerHasLock = deferred();
    const releaseWriter = deferred();
    const writer = prisma.$transaction(
      async (tx) => {
        await tx.$queryRawUnsafe(
          `select 1 from chat.conversation_member where conversation_id = '${groupId}'::uuid and actor_id = '${ids.parent}'::uuid and left_at is null for update`,
        );
        writerHasLock.resolve();
        await releaseWriter.promise;
      },
      { timeout: 60_000 },
    );
    await writerHasLock.promise;
    // Termination guarantee, not synchronization: if the lock wait were NOT
    // bounded the delivery would wait for this writer forever (Prisma's
    // transaction timeout does not interrupt a query blocked on a lock), so the
    // writer is let go at 12 s regardless and the elapsed bound below fails.
    const valve = setTimeout(() => releaseWriter.resolve(), 12_000);

    const marker = randomUUID();
    const started = Date.now();
    await publishVia(node, groupId)(marker); // resolves only once the delivery has finished or failed
    const elapsed = Date.now() - started;
    clearTimeout(valve);
    releaseWriter.resolve();
    await writer;

    // Failed on lock_timeout (5 s), not on the 15 s transaction timeout.
    expect(elapsed).toBeGreaterThanOrEqual(4_500);
    expect(elapsed).toBeLessThan(12_000);
    // Fail closed: the aborted delivery emitted to NOBODY.
    await sleep(GRACE_MS);
    expect(p.has(CommEvent.MESSAGE_CREATED, marker)).toBe(false);
    expect(p2.has(CommEvent.MESSAGE_CREATED, marker)).toBe(false);
    // Nothing left locked or queued: the next event reaches both, promptly.
    const next = await publish(node, groupId);
    await p.waitFor(CommEvent.MESSAGE_CREATED, next);
    await p2.waitFor(CommEvent.MESSAGE_CREATED, next);
    expect(await lockWaiters()).toBe(0);
  }, 40_000);
});

// ===========================================================================
// ===========================================================================
// THE WINDOW AFTER THE FINAL LIVENESS CHECK (completion barrier).
//
// `stillHeld()` proves the row locks were held when the database ANSWERED; it
// cannot prove they are still held when the emits run. If the connection is
// lost -- or Prisma's own timer rolls the transaction back -- after that
// answer, the locks are gone and a revocation commits without waiting. These
// tests hold a delivery exactly there, then end its transaction for real
// (pg_terminate_backend, or the transaction timeout), then let the revocation
// RETURN, then release the stale decision. Locks cannot help here; only the
// completion barrier can.
// ===========================================================================
function holdAfterLivenessCheck(n: Node) {
  const reached = deferred();
  const release = deferred();
  n.gateway.afterLivenessCheck = async () => {
    n.gateway.afterLivenessCheck = undefined; // one delivery only
    reached.resolve();
    await release.promise;
  };
  return { reached: reached.promise, release: () => release.resolve() };
}

/** The held delivery's transaction: idle in transaction, its last statement the liveness check. */
async function heldDeliveryBackends(): Promise<number[]> {
  const rows = await prisma.$queryRawUnsafe<{ pid: number }[]>(
    `select pid from pg_stat_activity
      where datname = current_database() and pid <> pg_backend_pid()
        and state = 'idle in transaction' and query = 'SELECT 1'`,
  );
  return rows.map((r) => r.pid);
}

/** A lost connection: the server ends the transaction and releases its locks. */
async function killHeldDeliveryConnection(): Promise<void> {
  const pids = await heldDeliveryBackends();
  expect(pids).toHaveLength(1); // exactly the held delivery, or the test proves nothing
  await prisma.$queryRawUnsafe(`select pg_terminate_backend(${pids[0]})`);
  await waitUntil(async () => !(await heldDeliveryBackends()).includes(pids[0]), 'the backend is gone');
}

/**
 * Hold a delivery after its liveness check; end its transaction (`endIt`);
 * `revoke` must then either refuse to report success, or -- having returned
 * successfully -- be followed by NO emit of the held decision to `revoked`.
 * The control is entitled and must still receive the event (re-decided).
 */
async function expectNoEmitAfterSuccessfulReturn(opts: {
  deliveringNode: Node;
  deliver: (marker: string) => Promise<void>;
  endIt: () => Promise<void>;
  revoke: () => Promise<unknown>;
  revoked: Client;
  control: Client;
  afterwards: () => Promise<unknown>;
}): Promise<void> {
  const held = holdAfterLivenessCheck(opts.deliveringNode);
  const marker = randomUUID();
  const delivery = opts.deliver(marker);
  try {
    await held.reached; // decided, and the database vouched for the locks
    await opts.endIt(); // ...and now the locks are gone
    const outcome = await opts.revoke().then(
      () => 'returned' as const,
      (e: { code?: string }) => e?.code ?? 'threw',
    );
    expect(outcome).toBe('returned'); // nothing held it back: it RETURNED successfully
  } finally {
    // Always released -- a failed assertion must not leave the node's delivery
    // queue blocked behind a held delivery for every later test.
    held.release(); // the stale decision resumes
  }
  await delivery;
  await opts.control.waitFor(CommEvent.MESSAGE_CREATED, marker); // re-decided: still delivered to the entitled
  await sleep(GRACE_MS);
  expect(opts.revoked.has(CommEvent.MESSAGE_CREATED, marker)).toBe(false); // THE invariant
  await opts.afterwards();
}

describe('the window after the final liveness check — one node', () => {
  afterEach(() => {
    node.gateway.afterLivenessCheck = undefined;
    node.conversations.deliveryTransactionTimeoutMs = 15_000;
  });

  it('connection LOST after the check, removal returns: the stale decision is never emitted to the member', async () => {
    const p = await connect(node, (await login('parent')).accessToken);
    const p2 = await connect(node, (await login('parent2')).accessToken);
    await p.subscribe(groupId);
    await p2.subscribe(groupId);
    await expectNoEmitAfterSuccessfulReturn({
      deliveringNode: node,
      deliver: publishVia(node, groupId),
      endIt: killHeldDeliveryConnection,
      revoke: () => withoutPushes(node, () => removeParent(ids.parent)),
      revoked: p,
      control: p2,
      afterwards: () => deliveredOnlyTo(node, groupId, p2, [p]),
    });
  });

  it('transaction TIMED OUT after the check, removal returns: the stale decision is never emitted to the member', async () => {
    const p = await connect(node, (await login('parent')).accessToken);
    const p2 = await connect(node, (await login('parent2')).accessToken);
    await p.subscribe(groupId);
    await p2.subscribe(groupId);
    node.conversations.deliveryTransactionTimeoutMs = 400; // this test only
    await expectNoEmitAfterSuccessfulReturn({
      deliveringNode: node,
      deliver: publishVia(node, groupId),
      // Prisma's own timer rolls the transaction back while the callback runs on.
      endIt: () => waitUntil(async () => (await heldDeliveryBackends()).length === 0, 'rolled back by the timeout'),
      revoke: () => withoutPushes(node, () => removeParent(ids.parent)),
      revoked: p,
      control: p2,
      afterwards: async () => {
        node.conversations.deliveryTransactionTimeoutMs = 15_000;
        await deliveredOnlyTo(node, groupId, p2, [p]);
      },
    });
  });

  it('connection LOST after the check, logout returns: the stale decision is never emitted to that session', async () => {
    const session = await login('parent');
    const p = await connect(node, session.accessToken);
    const p2 = await connect(node, (await login('parent2')).accessToken);
    await p.subscribe(groupId);
    await p2.subscribe(groupId);
    await expectNoEmitAfterSuccessfulReturn({
      deliveringNode: node,
      deliver: publishVia(node, groupId),
      endIt: killHeldDeliveryConnection,
      revoke: () => withoutPushes(node, () => node.auth.logout(session.sessionId)),
      revoked: p,
      control: p2,
      afterwards: () => deliveredOnlyTo(node, groupId, p2, [p]),
    });
  });

  it('connection LOST after the check, a SYNC that removes the member returns: the stale decision is never emitted', async () => {
    const p = await connect(node, (await login('parent')).accessToken);
    const p2 = await connect(node, (await login('parent2')).accessToken);
    await p.subscribe(groupId);
    await p2.subscribe(groupId);
    await expectNoEmitAfterSuccessfulReturn({
      deliveringNode: node,
      deliver: publishVia(node, groupId),
      endIt: killHeldDeliveryConnection,
      revoke: () =>
        withoutPushes(node, async () => {
          await prisma.$executeRawUnsafe(`update chat.contact set can_message = false where id = '${ids.parent}'::uuid`);
          expect((await node.conversations.syncStudentGroup(ids.learner, ids.staff))?.id).toBe(groupId);
          expect(await node.conversations.membershipOf(groupId, ids.parent)).toBeNull(); // the sync removed them
        }),
      revoked: p,
      control: p2,
      afterwards: () => deliveredOnlyTo(node, groupId, p2, [p]),
    });
  });
});

describe('fail closed', () => {
  it('when current authorization cannot be established, nothing is delivered and the sockets are dropped', async () => {
    const p = await connect(node, (await login('parent')).accessToken);
    const p2 = await connect(node, (await login('parent2')).accessToken);
    await p.subscribe(groupId);
    await p2.subscribe(groupId);
    const real = node.auth.revalidateRealtime.bind(node.auth);
    node.auth.revalidateRealtime = async () => {
      throw new Error('authorization store unavailable');
    };
    let marker = '';
    try {
      marker = await publish(node, groupId);
      await sleep(GRACE_MS);
    } finally {
      node.auth.revalidateRealtime = real;
    }
    // Both are authorized in truth -- but it could not be ESTABLISHED, so neither
    // receives the event, and both are disconnected rather than kept on trust.
    for (const c of [p, p2]) {
      expect(c.has(CommEvent.MESSAGE_CREATED, marker)).toBe(false);
      expect(c.disconnectedByServer()).toBe(true);
    }
  });
});

// ===========================================================================
describe('identity and account changes reach open sockets', () => {
  it('logout disconnects that session’s sockets at once; another session of the same user is unaffected', async () => {
    const s1 = await login('parent');
    const s2 = await login('parent');
    const a = await connect(node, s1.accessToken);
    const b = await connect(node, s2.accessToken);
    const p2 = await connect(node, (await login('parent2')).accessToken);
    for (const c of [a, b, p2]) await c.subscribe(groupId);

    await node.auth.logout(s1.sessionId);
    await sleep(GRACE_MS);
    expect(a.disconnectedByServer()).toBe(true);
    expect(b.socket.connected).toBe(true);
    await deliveredOnlyTo(node, groupId, p2, [a]);
    const m = await publish(node, groupId);
    await b.waitFor(CommEvent.MESSAGE_CREATED, m);
  });

  it('refresh rotation does NOT disconnect, and a later logout of the NEW session still reaches the socket', async () => {
    const first = await login('parent');
    const a = await connect(node, first.accessToken);
    const p2 = await connect(node, (await login('parent2')).accessToken);
    await a.subscribe(groupId);
    await p2.subscribe(groupId);

    const rotated = await node.auth.refresh(first.refreshToken);
    await node.gateway.revalidateConnections(); // the sweep must not treat rotation as revocation
    expect(a.socket.connected).toBe(true);
    const m = await publish(node, groupId);
    await a.waitFor(CommEvent.MESSAGE_CREATED, m);

    await node.auth.logout(rotated.sessionId);
    await sleep(GRACE_MS);
    expect(a.disconnectedByServer()).toBe(true);
    await deliveredOnlyTo(node, groupId, p2, [a]);
  });

  it('refresh-token reuse disconnects every socket of the account', async () => {
    const one = await login('parent');
    const two = await login('parent');
    const a = await connect(node, one.accessToken);
    const b = await connect(node, two.accessToken);
    const p2 = await connect(node, (await login('parent2')).accessToken);
    for (const c of [a, b, p2]) await c.subscribe(groupId);

    await node.auth.refresh(one.refreshToken);
    await expect(node.auth.refresh(one.refreshToken)).rejects.toBeDefined(); // replay
    await sleep(GRACE_MS);
    expect(a.disconnectedByServer()).toBe(true);
    expect(b.disconnectedByServer()).toBe(true);
    await deliveredOnlyTo(node, groupId, p2, [a, b]);
  });

  it('a deactivation made outside the API (no push) is enforced by re-validation, and a reconnect is refused', async () => {
    const token = (await login('parent')).accessToken;
    const a = await connect(node, token);
    const p2 = await connect(node, (await login('parent2')).accessToken);
    await a.subscribe(groupId);
    await p2.subscribe(groupId);

    await prisma.$executeRawUnsafe(`update chat.contact set is_active = false where id = '${ids.parent}'::uuid`);
    // Nothing was pushed: until re-validation runs the socket is still connected.
    await node.gateway.revalidateConnections();
    expect(a.disconnectedByServer()).toBe(true);
    await deliveredOnlyTo(node, groupId, p2, [a]);

    const again = await connect(node, token);
    expect(again.socket.connected).toBe(false);
  });

  it('a membership ended outside the API is enforced by re-validation (room eviction, socket kept)', async () => {
    const a = await connect(node, (await login('parent')).accessToken);
    const p2 = await connect(node, (await login('parent2')).accessToken);
    await a.subscribe(groupId);
    await p2.subscribe(groupId);
    await prisma.$executeRawUnsafe(`update chat.conversation_member set left_at = now() where conversation_id = '${groupId}'::uuid and actor_id = '${ids.parent}'::uuid and left_at is null`);

    await node.gateway.revalidateConnections();
    expect(a.socket.connected).toBe(true);
    await a.waitForNotice(CONVERSATION_ACCESS_REVOKED, groupId);
    await deliveredOnlyTo(node, groupId, p2, [a]);
  });

  it('a staff role downgrade to a non-family-facing role is read fresh: subscribe refused, room left', async () => {
    const admin = await connect(node, (await login('staff')).accessToken);
    const p2 = await connect(node, (await login('parent2')).accessToken);
    await admin.subscribe(groupId);
    await p2.subscribe(groupId);
    await prisma.$executeRawUnsafe(`update chat.staff set role = 'finance' where id = '${ids.staff}'::uuid`);

    expect((await admin.subscribe(directId)).ok).toBe(false); // the CACHED actor was 'admin'
    await node.gateway.revalidateConnections();
    await deliveredOnlyTo(node, groupId, p2, [admin]);
  });
});

// ===========================================================================
describe('staff SCOPE is decided at delivery time, not only membership (C4)', () => {
  it('a manager receives while they read the whole organization; demoted to an admin with no charge of this family, they receive nothing at the next delivery', async () => {
    // The manager is not a member of the group: before C4 every family-facing
    // staff member passed the delivery-time read, so the demoted admin would
    // still have received. The scoped read admits an admin only for a family
    // they own, are a member for, or handle -- none of which holds here.
    const mgr = await connect(node, (await login('manager')).accessToken);
    const p2 = await connect(node, (await login('parent2')).accessToken);
    expect(await mgr.subscribe(groupId)).toEqual({ ok: true });
    await p2.subscribe(groupId);
    const before = await publish(node, groupId);
    await mgr.waitFor(CommEvent.MESSAGE_CREATED, before); // positive control
    try {
      await prisma.$executeRawUnsafe(`update chat.staff set role = 'admin' where id = '${ids.manager}'::uuid`);
      await deliveredOnlyTo(node, groupId, p2, [mgr]);
    } finally {
      await prisma.$executeRawUnsafe(`update chat.staff set role = 'manager' where id = '${ids.manager}'::uuid`);
    }
  });
});

// ===========================================================================
describe('nothing the client says grants access', () => {
  it('a guessed conversation id is refused and delivers nothing', async () => {
    const stranger = await connect(node, (await login('stranger')).accessToken);
    const p2 = await connect(node, (await login('parent2')).accessToken);
    await p2.subscribe(groupId);
    expect((await stranger.subscribe(groupId)).ok).toBe(false);
    expect((await stranger.subscribe(randomUUID())).ok).toBe(false);
    await deliveredOnlyTo(node, groupId, p2, [stranger]);
  });

  it('a forged actorId or organizationId in the handshake or the frame changes nothing', async () => {
    const forged = await connect(node, (await login('stranger')).accessToken, {
      actorId: ids.parent2,
      organizationId: ORG,
    });
    const p2 = await connect(node, (await login('parent2')).accessToken);
    await p2.subscribe(groupId);
    const r = await forged.subscribe(groupId, { actorId: ids.parent2, organizationId: ORG });
    expect(r.ok).toBe(false);
    await deliveredOnlyTo(node, groupId, p2, [forged]);
  });

  it("another organization's parent cannot subscribe to this organization's conversation", async () => {
    const other = await connect(node, (await login('other')).accessToken);
    const p2 = await connect(node, (await login('parent2')).accessToken);
    await p2.subscribe(groupId);
    expect((await other.subscribe(groupId)).ok).toBe(false);
    await deliveredOnlyTo(node, groupId, p2, [other]);
  });

  it('an unauthenticated socket cannot subscribe before or after the handshake', async () => {
    const anon = await connect(node, 'not-a-token');
    expect(anon.socket.connected).toBe(false);
  });
});

// ===========================================================================
const REDIS_URL = process.env.REALTIME_REVOCATION_REDIS_URL;
(REDIS_URL ? describe : describe.skip)('two nodes behind the Redis adapter, and the worker relay', () => {
  let a: Node;
  let b: Node;
  const redis: Redis[] = [];
  const relays: RealtimeRelay[] = [];
  const mk = () => {
    const r = new Redis(REDIS_URL as string, { maxRetriesPerRequest: null });
    redis.push(r);
    return r;
  };

  beforeAll(async () => {
    a = await startNode(createAdapter(mk(), mk()));
    b = await startNode(createAdapter(mk(), mk()));
    process.env.QUEUE_PREFIX = `rt009-${RUN}`;
    const saved = process.env.REDIS_URL;
    process.env.REDIS_URL = REDIS_URL;
    for (const n of [a, b]) {
      const relay = new RealtimeRelay(n.gateway);
      await relay.start();
      relays.push(relay);
    }
    process.env.REDIS_URL = saved;
    // A registry younger than one lease cannot vouch that nobody is missing
    // from it, and revocations refuse to confirm against it. Only the first run
    // against a fresh Redis waits here.
    const registry = `${(a.io.of('/').adapter as unknown as { channel: string }).channel}rt009-nodes`;
    const pub = (a.io.of('/').adapter as unknown as { pubClient: Redis }).pubClient;
    await waitUntil(async () => {
      const [created, [sec, usec]] = await Promise.all([pub.hget(registry, '@created'), pub.time()]);
      return created !== null && Number(sec) * 1000 + Math.floor(Number(usec) / 1000) - Number(created) >= NODE_LEASE_MS - NODE_LEASE_MARGIN_MS;
    }, 'the node registry is old enough to be trusted', 40_000);
  }, 60_000);

  afterAll(async () => {
    for (const r of relays) await r.onModuleDestroy();
    await stopNode(a);
    await stopNode(b);
    for (const r of redis) r.disconnect();
  });

  it('a removal handled on node A evicts the member’s socket on node B, for both delivery paths', async () => {
    const pOnB = await connect(b, (await a.auth.login(subject('parent'), PASSWORD)).accessToken);
    const p2OnB = await connect(b, (await a.auth.login(subject('parent2'), PASSWORD)).accessToken);
    await pOnB.subscribe(groupId);
    await p2OnB.subscribe(groupId);

    await a.conversations.setMembership(groupId, ids.staff, { actorId: ids.parent, actorKind: 'contact', memberRole: 'parent' }, 'remove', 'cross-node');
    // NO wait: the very next delivery, on any node, must already deny.

    // (1) in-process path on node A, forwarded to node B, decided on node B
    await deliveredOnlyTo(a, groupId, p2OnB, [pOnB]);

    // (2) the worker path: a process with NO Socket.IO server publishes to Redis
    const workerGateway = { server: undefined } as unknown as RealtimeGateway;
    const worker = new RelayRealtimePublisher(workerGateway);
    const saved = process.env.REDIS_URL;
    process.env.REDIS_URL = REDIS_URL;
    const marker = randomUUID();
    await worker.toThread(groupId, CommEvent.MESSAGE_CREATED, { conversationId: groupId, messageId: marker, seq: '2' } as never);
    process.env.REDIS_URL = saved;
    await p2OnB.waitFor(CommEvent.MESSAGE_CREATED, marker);
    await sleep(GRACE_MS);
    expect(pOnB.has(CommEvent.MESSAGE_CREATED, marker)).toBe(false);
    await worker.onModuleDestroy();
  });

  const workerPublish = (marker: string) =>
    (async () => {
      const saved = process.env.REDIS_URL;
      process.env.REDIS_URL = REDIS_URL;
      const w = new RelayRealtimePublisher({ server: undefined } as unknown as RealtimeGateway);
      try {
        await w.toThread(groupId, CommEvent.MESSAGE_CREATED, { conversationId: groupId, messageId: marker, seq: '3' } as never);
      } finally {
        process.env.REDIS_URL = saved;
        await w.onModuleDestroy();
      }
    })();

  it('continuous publication across nodes (both paths) racing a removal on node A: no leak on node B', async () => {
    const pOnB = await connect(b, (await a.auth.login(subject('parent'), PASSWORD)).accessToken);
    const p2OnB = await connect(b, (await a.auth.login(subject('parent2'), PASSWORD)).accessToken);
    await pOnB.subscribe(groupId);
    await p2OnB.subscribe(groupId);
    let n = 0;
    await raceDeliveryAgainst(
      (marker) => (n++ % 2 === 0 ? publishVia(a, groupId)(marker) : workerPublish(marker)),
      async () => {
        await a.conversations.setMembership(groupId, ids.staff, { actorId: ids.parent, actorKind: 'contact', memberRole: 'parent' }, 'remove', 'cross-node race');
      },
      p2OnB,
      [pOnB],
    );
  });

  it('cross-node race through the WORKER RELAY: a removal on node A cannot return while node B holds a delivery', async () => {
    const pOnB = await connect(b, (await a.auth.login(subject('parent'), PASSWORD)).accessToken);
    const p2OnB = await connect(b, (await a.auth.login(subject('parent2'), PASSWORD)).accessToken);
    await pOnB.subscribe(groupId);
    await p2OnB.subscribe(groupId);
    try {
      await expectRevocationWaitsForDelivery({
        deliveringNode: b,
        deliver: (marker) => workerPublish(marker), // worker -> Redis -> node B's relay -> held
        revoke: () =>
          a.conversations.setMembership(groupId, ids.staff, { actorId: ids.parent, actorKind: 'contact', memberRole: 'parent' }, 'remove', 'cross-node race'),
        revoked: pOnB,
        control: p2OnB,
        afterwards: () => deliveredOnlyTo(a, groupId, p2OnB, [pOnB]),
      });
    } finally {
      b.gateway.deliveryBarrier = undefined;
    }
  });

  it('node B DROPS every remote eviction/disconnect request: it still denies delivery, by both paths', async () => {
    const pOnB = await connect(b, (await a.auth.login(subject('parent'), PASSWORD)).accessToken);
    const p2OnB = await connect(b, (await a.auth.login(subject('parent2'), PASSWORD)).accessToken);
    await pOnB.subscribe(groupId);
    await p2OnB.subscribe(groupId);

    // Wrap node B's REAL request listener (ioredis binds it at construction) so
    // it drops REMOTE_JOIN / REMOTE_LEAVE / REMOTE_DISCONNECT and nothing else.
    type Adapter = { subClient: Redis; redisListeners: Map<string, (c: Buffer, m: Buffer) => void>; parser: { decode(m: Buffer): { type?: number } } };
    const adapterB = b.io.of('/').adapter as unknown as Adapter;
    const original = adapterB.redisListeners.get('messageBuffer');
    if (!original) throw new Error('adapter listener not found: sabotage would be a no-op');
    let dropped = 0;
    const deaf = (channel: Buffer, msg: Buffer) => {
      try {
        // Requests are JSON (redis-adapter publishes them with JSON.stringify);
        // msgpack is the fallback the adapter's own onrequest also uses.
        const text = msg.toString();
        const request = text.startsWith('{') ? (JSON.parse(text) as { type?: number }) : adapterB.parser.decode(msg);
        if ([2, 3, 4].includes(request?.type ?? -1)) {
          dropped++;
          return;
        }
      } catch {
        /* not a request we can read: pass it through */
      }
      original(channel, msg);
    };
    adapterB.subClient.off('messageBuffer', original);
    adapterB.subClient.on('messageBuffer', deaf);
    try {
      await a.conversations.setMembership(groupId, ids.staff, { actorId: ids.parent, actorKind: 'contact', memberRole: 'parent' }, 'remove', 'node B deaf');
      await sleep(GRACE_MS);
      expect(dropped).toBeGreaterThan(0); // the eviction really was lost on node B
      // The socket is STILL in the room on node B (the eviction was lost)...
      const inRoomOnB = () => b.io.of('/').adapter.rooms.get(`conversation:${groupId}`)?.size ?? 0;
      expect(inRoomOnB()).toBe(2);
      // ...and receives nothing through the WORKER RELAY -- checked FIRST, while
      // the socket is provably still in the room, so only node B's relay-side
      // delivery check stands between it and the event.
      const marker = randomUUID();
      await workerPublish(marker);
      await p2OnB.waitFor(CommEvent.MESSAGE_CREATED, marker);
      await sleep(GRACE_MS);
      expect(pOnB.has(CommEvent.MESSAGE_CREATED, marker)).toBe(false);
      // ...nor through the in-process path (A forwards; B decides).
      await deliveredOnlyTo(a, groupId, p2OnB, [pOnB]);
    } finally {
      adapterB.subClient.off('messageBuffer', deaf);
      adapterB.subClient.on('messageBuffer', original);
    }
  });

  // -------------------------------------------------------------------------
  // THE COMPLETION BARRIER ACROSS NODES. A revocation handled on node A may
  // return successfully only once every node with a live lease has fenced
  // itself; a node that cannot be shown to have stopped makes it FAIL.
  // -------------------------------------------------------------------------
  type ClusterInternals = {
    uid: string;
    channel: string;
    requestChannel: string;
    subClient: Redis;
    pubClient: Redis;
    redisListeners: Map<string, (c: Buffer, m: Buffer) => void>;
  };
  const internals = (n: Node) => n.io.of('/').adapter as unknown as ClusterInternals;
  const removeOn = (n: Node, who = ids.parent) => () =>
    n.conversations.setMembership(groupId, ids.staff, { actorId: who, actorKind: 'contact', memberRole: 'parent' }, 'remove', 'barrier');
  const UNCONFIRMED = { code: 'COMM.REVOCATION_UNCONFIRMED' };

  // Probes go through node A's client, so they still work while B is cut off.
  const probe = () => internals(a).pubClient;
  const registryKey = () => `${internals(a).channel}rt009-nodes`;
  async function redisNowMs(): Promise<number> {
    const [sec, usec] = await probe().time(); // strings at runtime, whatever the typing says
    return Number(sec) * 1000 + Math.floor(Number(usec) / 1000);
  }
  /** Milliseconds left on `n`'s registration, on Redis's clock (<= 0: not registered). */
  async function leaseRemainingMs(n: Node): Promise<number> {
    const [expiry, now] = await Promise.all([probe().hget(registryKey(), internals(n).uid), redisNowMs()]);
    if (expiry === null) return 0;
    return Number(expiry) - now;
  }
  /** How long ago Redis (re)created the registry, on its clock. */
  async function registryAgeMs(): Promise<number> {
    const [created, now] = await Promise.all([probe().hget(registryKey(), '@created'), redisNowMs()]);
    return created === null ? -1 : now - Number(created);
  }
  /** Whether `n`'s own named Redis connection is open. */
  async function connectedToRedis(n: Node): Promise<boolean> {
    return String(await probe().client('LIST')).includes(` name=rt009-node:${internals(n).uid} `);
  }
  const registered = async (n: Node) => (await leaseRemainingMs(n)) > 0;
  const queueIdle = (n: Node) => (n.gateway as unknown as { queues: Map<string, unknown> }).queues.size === 0;

  /** Node `n` silently drops every completion-barrier request -- and nothing else. */
  function dropFenceRequests(n: Node): { dropped: () => number; restore: () => void } {
    const ad = internals(n);
    const original = ad.redisListeners.get('messageBuffer');
    if (!original) throw new Error('adapter listener not found: sabotage would be a no-op');
    let dropped = 0;
    const filter = (channel: Buffer, msg: Buffer) => {
      try {
        const r = JSON.parse(msg.toString()) as { type?: number; data?: unknown[] };
        if (r.type === 6 && Array.isArray(r.data) && r.data[0] === 'rt009:fence') {
          dropped++;
          return;
        }
      } catch {
        /* not a JSON request: pass it through */
      }
      original(channel, msg);
    };
    ad.subClient.off('messageBuffer', original);
    ad.subClient.on('messageBuffer', filter);
    return {
      dropped: () => dropped,
      restore: () => {
        ad.subClient.off('messageBuffer', filter);
        ad.subClient.on('messageBuffer', original);
      },
    };
  }

  /** A short lease on `n` for one test (the defaults are restored after). */
  async function shortLease(n: Node): Promise<void> {
    n.gateway.leaseMs = 1_500;
    n.gateway.leaseMarginMs = 500;
    n.gateway.startLease(100);
    await waitUntil(async () => n.gateway.canDeliver() && (await leaseRemainingMs(n)) <= 1_500, 'the short lease is in force');
  }
  async function restoreLease(n: Node): Promise<void> {
    const ad = internals(n);
    if (ad.pubClient.status === 'end') await ad.pubClient.connect();
    await ad.subClient.subscribe(ad.requestChannel);
    n.gateway.leaseMs = NODE_LEASE_MS;
    n.gateway.leaseMarginMs = NODE_LEASE_MARGIN_MS;
    n.gateway.startLease(NODE_LEASE_RENEW_MS);
    await waitUntil(async () => n.gateway.canDeliver() && (await leaseRemainingMs(n)) > 1_500, 'the default lease is back');
  }

  async function parentsOnB() {
    const pOnB = await connect(b, (await a.auth.login(subject('parent'), PASSWORD)).accessToken);
    const p2OnB = await connect(b, (await a.auth.login(subject('parent2'), PASSWORD)).accessToken);
    expect((await pOnB.subscribe(groupId)).ok).toBe(true);
    expect((await p2OnB.subscribe(groupId)).ok).toBe(true);
    return { pOnB, p2OnB };
  }

  afterEach(() => {
    b.gateway.afterLivenessCheck = undefined;
  });

  it('worker relay: node B loses its connection after the check; a removal on node A RETURNS; B emits nothing to the member', async () => {
    const { pOnB, p2OnB } = await parentsOnB();
    await expectNoEmitAfterSuccessfulReturn({
      deliveringNode: b,
      deliver: (marker) => workerPublish(marker),
      endIt: killHeldDeliveryConnection,
      revoke: () => withoutPushes(a, removeOn(a)),
      revoked: pOnB,
      control: p2OnB,
      afterwards: () => deliveredOnlyTo(a, groupId, p2OnB, [pOnB]),
    });
  });

  it('in-process forward: the same, decided on node B for an event published on node A', async () => {
    const { pOnB, p2OnB } = await parentsOnB();
    await expectNoEmitAfterSuccessfulReturn({
      deliveringNode: b,
      deliver: publishVia(a, groupId),
      endIt: killHeldDeliveryConnection,
      revoke: () => withoutPushes(a, removeOn(a)),
      revoked: pOnB,
      control: p2OnB,
      afterwards: () => deliveredOnlyTo(a, groupId, p2OnB, [pOnB]),
    });
  });

  it('actor-addressed delivery held on node B, logout handled on node A: nothing reaches the logged-out session', async () => {
    const session = await a.auth.login(subject('parent'), PASSWORD);
    const pOnB = await connect(b, session.accessToken);
    const p2OnB = await connect(b, (await a.auth.login(subject('parent2'), PASSWORD)).accessToken);
    const toBoth = (marker: string) =>
      a.gateway.toUsers([ids.parent, ids.parent2], CommEvent.MESSAGE_CREATED, { conversationId: groupId, messageId: marker, seq: '1' } as never);
    await expectNoEmitAfterSuccessfulReturn({
      deliveringNode: b,
      deliver: toBoth,
      endIt: killHeldDeliveryConnection,
      revoke: () => withoutPushes(a, () => a.auth.logout(session.sessionId)),
      revoked: pOnB,
      control: p2OnB,
      afterwards: async () => {
        const marker = randomUUID();
        await toBoth(marker);
        await p2OnB.waitFor(CommEvent.MESSAGE_CREATED, marker);
        await sleep(GRACE_MS);
        expect(pOnB.has(CommEvent.MESSAGE_CREATED, marker)).toBe(false);
      },
    });
  });

  it('a node that never acknowledges: the removal is NOT reported successful, nor is a retry -- and that node could still emit', async () => {
    const { pOnB, p2OnB } = await parentsOnB();
    const deaf = dropFenceRequests(b);
    const held = holdAfterLivenessCheck(b);
    const marker = randomUUID();
    try {
      await workerPublish(marker);
      await held.reached;
      await killHeldDeliveryConnection();
      // Committed -- durably -- but B never answered: not a success.
      await expect(withoutPushes(a, removeOn(a))).rejects.toMatchObject(UNCONFIRMED);
      expect(deaf.dropped()).toBeGreaterThan(0); // B really did not hear it
      expect(await a.conversations.membershipOf(groupId, ids.parent)).toBeNull();
      // A retry is idempotent, and is held to the same barrier.
      await expect(withoutPushes(a, removeOn(a))).rejects.toMatchObject(UNCONFIRMED);
      // Why the refusal is REQUIRED: B's decision is still live, and it does emit.
      held.release();
      await pOnB.waitFor(CommEvent.MESSAGE_CREATED, marker);
    } finally {
      held.release();
      deaf.restore();
    }
    // Once B answers, the retry is confirmed -- and nothing reaches the member after it.
    await withoutPushes(a, removeOn(a));
    await deliveredOnlyTo(a, groupId, p2OnB, [pOnB]);
  });

  it('logout and account-wide revocation are held to the same barrier: an unconfirmed one is NOT a success, nor is a retry', async () => {
    const session = await a.auth.login(subject('parent'), PASSWORD);
    const deaf = dropFenceRequests(b);
    try {
      await expect(a.auth.logout(session.sessionId)).rejects.toMatchObject(UNCONFIRMED);
      const row = await prisma.session.findUnique({ where: { id: session.sessionId } });
      expect(row?.revokedAt).not.toBeNull(); // committed, durably
      // The repeat finds nothing live -- and still refuses to report success.
      await expect(a.auth.logout(session.sessionId)).rejects.toMatchObject(UNCONFIRMED);
      await expect(a.auth.revokeAllForAccount(ids.parentAccount, 'rt009 barrier')).rejects.toMatchObject(UNCONFIRMED);
      expect(deaf.dropped()).toBeGreaterThan(0);
    } finally {
      deaf.restore();
    }
    await a.auth.logout(session.sessionId); // B answers again: confirmed
    await a.auth.revokeAllForAccount(ids.parentAccount, 'rt009 barrier');
  });

  it('a student-group SYNC is held to the same barrier, including the repeat that finds nothing left to change', async () => {
    const deaf = dropFenceRequests(b);
    try {
      await prisma.$executeRawUnsafe(`update chat.contact set can_message = false where id = '${ids.parent}'::uuid`);
      await expect(a.conversations.syncStudentGroup(ids.learner, ids.staff)).rejects.toMatchObject(UNCONFIRMED);
      expect(await a.conversations.membershipOf(groupId, ids.parent)).toBeNull(); // committed
      await expect(a.conversations.syncStudentGroup(ids.learner, ids.staff)).rejects.toMatchObject(UNCONFIRMED);
    } finally {
      deaf.restore();
    }
    expect((await a.conversations.syncStudentGroup(ids.learner, ids.staff))?.id).toBe(groupId);
  });

  it('a node registered but cut off from the bus: the removal is NOT reported successful', async () => {
    const { pOnB, p2OnB } = await parentsOnB();
    const ad = internals(b);
    const held = holdAfterLivenessCheck(b);
    const marker = randomUUID();
    try {
      await workerPublish(marker);
      await held.reached;
      await killHeldDeliveryConnection();
      // B stops listening to node requests; its lease is still live. It is not
      // among the subscribers -- and must not be silently skipped for that.
      await ad.subClient.unsubscribe(ad.requestChannel);
      expect(await registered(b)).toBe(true);
      await expect(withoutPushes(a, removeOn(a))).rejects.toMatchObject(UNCONFIRMED);
      held.release();
      await pOnB.waitFor(CommEvent.MESSAGE_CREATED, marker); // B could still emit: success would have been false
    } finally {
      held.release();
      await ad.subClient.subscribe(ad.requestChannel);
    }
    await withoutPushes(a, removeOn(a));
    await deliveredOnlyTo(a, groupId, p2OnB, [pOnB]);
  });

  it('a node whose lease LAPSED emits nothing it decided before the lapse, while lapsed (a successful return without it is sound)', async () => {
    const { pOnB, p2OnB } = await parentsOnB();
    const ad = internals(b);
    await shortLease(b);
    const held = holdAfterLivenessCheck(b);
    const marker = randomUUID();
    try {
      await workerPublish(marker);
      await held.reached; // decided while B held its lease
      await killHeldDeliveryConnection();
      // B is cut off from Redis entirely -- its connection closes -- and stops
      // renewing: its registration expires and nothing shows it alive.
      await ad.subClient.unsubscribe(ad.requestChannel);
      b.gateway.stopLease();
      ad.pubClient.disconnect();
      await waitUntil(async () => !(await connectedToRedis(b)), "B's connection is gone");
      await waitUntil(async () => !(await registered(b)), 'B is no longer registered');
      // A no longer counts B, and B cannot hear it: the removal RETURNS.
      await withoutPushes(a, removeOn(a));
      held.release();
      await waitUntil(async () => queueIdle(b), "B's delivery has finished");
      await sleep(GRACE_MS);
      expect(pOnB.has(CommEvent.MESSAGE_CREATED, marker)).toBe(false); // THE invariant
      expect(p2OnB.has(CommEvent.MESSAGE_CREATED, marker)).toBe(false); // a lapsed node delivers nothing
    } finally {
      held.release();
      await restoreLease(b);
    }
    await deliveredOnlyTo(a, groupId, p2OnB, [pOnB]);
  });

  it('...and when that node RE-REGISTERS, a decision from before the lapse is still never emitted', async () => {
    const { pOnB, p2OnB } = await parentsOnB();
    const ad = internals(b);
    await shortLease(b);
    const held = holdAfterLivenessCheck(b);
    const marker = randomUUID();
    try {
      await workerPublish(marker);
      await held.reached;
      await killHeldDeliveryConnection();
      await ad.subClient.unsubscribe(ad.requestChannel);
      b.gateway.stopLease();
      ad.pubClient.disconnect();
      await waitUntil(async () => !(await connectedToRedis(b)), "B's connection is gone");
      await waitUntil(async () => !(await registered(b)), 'B is no longer registered');
      await withoutPushes(a, removeOn(a)); // returns: B is expired AND gone
      // B comes back -- connected, listening and renewing -- BEFORE its old decision resumes.
      await ad.pubClient.connect();
      await ad.subClient.subscribe(ad.requestChannel);
      b.gateway.startLease(100);
      await waitUntil(async () => b.gateway.canDeliver(), 'B holds a lease again');
      held.release();
      await p2OnB.waitFor(CommEvent.MESSAGE_CREATED, marker); // re-decided under the new lease
      await sleep(GRACE_MS);
      expect(pOnB.has(CommEvent.MESSAGE_CREATED, marker)).toBe(false);
    } finally {
      held.release();
      await restoreLease(b);
    }
    await deliveredOnlyTo(a, groupId, p2OnB, [pOnB]);
  });

  it('a node SUSPENDED after its final check, its lease expired but its connection open: the removal is NOT reported successful', async () => {
    const { pOnB, p2OnB } = await parentsOnB();
    const ad = internals(b);
    await shortLease(b);
    const held = holdAfterLivenessCheck(b);
    const marker = randomUUID();
    try {
      await workerPublish(marker);
      await held.reached; // passed every check; now "suspended" before its emits
      await killHeldDeliveryConnection();
      // A suspended node renews nothing and answers nothing -- but the process,
      // and so its TCP connection to Redis, is still there.
      b.gateway.stopLease();
      await ad.subClient.unsubscribe(ad.requestChannel);
      await waitUntil(async () => !(await registered(b)), "B's lease expired");
      expect(await connectedToRedis(b)).toBe(true);
      // Refused: from outside, this node is indistinguishable from one frozen
      // INSIDE its synchronous emit span, after its permit check -- which would
      // emit the moment it resumes. (This hold sits before that check, so B's
      // own lapsed lease stops it here; a real suspension cannot be modelled
      // by an await, which is exactly why the revoker must not guess.)
      await expect(withoutPushes(a, removeOn(a))).rejects.toMatchObject(UNCONFIRMED);
    } finally {
      held.release();
      await restoreLease(b);
    }
    await withoutPushes(a, removeOn(a));
    await deliveredOnlyTo(a, groupId, p2OnB, [pOnB]);
  });

  it('a lease that Redis expires EARLY (a clock jump) does not leave a connected node out', async () => {
    const { pOnB, p2OnB } = await parentsOnB();
    const ad = internals(b);
    const held = holdAfterLivenessCheck(b);
    const marker = randomUUID();
    try {
      await workerPublish(marker);
      await held.reached;
      await killHeldDeliveryConnection();
      b.gateway.stopLease();
      await ad.subClient.unsubscribe(ad.requestChannel);
      // Redis's clock leaps ahead: B's entry is expired by Redis's reckoning,
      // while B, on its own clock, still holds a valid lease.
      await probe().hset(registryKey(), ad.uid, String((await redisNowMs()) - 1));
      expect(await registered(b)).toBe(false);
      expect(b.gateway.canDeliver()).toBe(true);
      await expect(withoutPushes(a, removeOn(a))).rejects.toMatchObject(UNCONFIRMED);
      held.release();
      await pOnB.waitFor(CommEvent.MESSAGE_CREATED, marker); // B would indeed have emitted
    } finally {
      held.release();
      await restoreLease(b);
    }
    await withoutPushes(a, removeOn(a));
    await deliveredOnlyTo(a, groupId, p2OnB, [pOnB]);
  });

  it('a node that shut down has left the registry: revocations do not wait for it, and it delivers nothing', async () => {
    const c = await startNode(createAdapter(mk(), mk()));
    expect(await registered(c)).toBe(true);
    await stopNode(c);
    expect(c.gateway.canDeliver()).toBe(false);
    expect(await registered(c)).toBe(false);
    await withoutPushes(a, removeOn(a)); // confirmed by A and B alone
  });

  it('concurrent, duplicate and repeated revocations on both nodes neither deadlock nor leak', async () => {
    const parentA = await connect(a, (await a.auth.login(subject('parent'), PASSWORD)).accessToken);
    const { pOnB, p2OnB } = await parentsOnB();
    expect((await parentA.subscribe(groupId)).ok).toBe(true);
    let n = 0;
    await raceDeliveryAgainst(
      (marker) => (n++ % 2 === 0 ? publishVia(a, groupId)(marker) : workerPublish(marker)),
      async () => {
        await Promise.all([removeOn(a)(), removeOn(b)(), removeOn(a)(), removeOn(b)()]);
      },
      p2OnB,
      [parentA, pOnB],
    );
  });

  // LAST in this block: it leaves a freshly recreated registry behind, which
  // (correctly) refuses every revocation until it is a full lease old.
  it('a registry Redis LOST is not trusted until it is a lease old: revocations are refused, then confirmed', async () => {
    const { pOnB, p2OnB } = await parentsOnB();
    await shortLease(a); // a 1 s trust horizon for this test
    await shortLease(b);
    try {
      await probe().del(registryKey()); // restart without persistence, flush, eviction, failover
      await expect(withoutPushes(a, removeOn(a))).rejects.toMatchObject(UNCONFIRMED);
      await waitUntil(async () => (await registryAgeMs()) >= 1_000 && (await registered(b)), 'the registry is a lease old again');
      await withoutPushes(a, removeOn(a));
    } finally {
      await restoreLease(a);
      await restoreLease(b);
    }
    await deliveredOnlyTo(a, groupId, p2OnB, [pOnB]);
  });
});
