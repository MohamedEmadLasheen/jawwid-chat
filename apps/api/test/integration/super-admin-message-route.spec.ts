/**
 * `super_admin` in a family conversation -- proven at the ROUTE.
 *
 * PD-8 (owner decision 2026-10-15) REVERSED the 2026-10-14 rule this file used
 * to pin: the super admin now has full read AND write in every conversation of
 * its organization. A genuinely authenticated super_admin (bootstrapped the
 * supported way, logged in over HTTP) posts into a live Student Group through
 * POST /api/v1/conversations/:id/messages, reads it back over the same route,
 * and the realtime gateway admits its subscription. The unit spec
 * (test/unit/admin/super-admin-authorization.spec.ts) proves the decision;
 * org-scope-pd8.spec.ts proves the boundary (never another organization's).
 * Synthetic fixtures only.
 */
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PlatformModule } from '@platform/platform.module';
import { AuthModule } from '@platform/auth/auth.module';
import { CommunicationModule } from '@communication/communication.module';
import { CommErrorFilter } from '@communication/api/http-exception.filter';
import { RealtimeGateway } from '@communication/realtime/realtime.gateway';
import { room } from '@communication/contracts/events';
import { REDIS_CLIENT } from '@communication/realtime/redis.provider';
import type Redis from 'ioredis';
import { applyInfrastructure } from '../../src/infra/http/bootstrap';
import { bootstrapSuperAdmin } from '../../src/cli/super-admin-bootstrap';
import { buildGraph, seed, truncate, Scenario } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(60_000);

const PASSWORD = 'a-super-admin-route-password-1';
const DOMAIN = 'samroute.qa.jawwid.test';

const g = buildGraph();
let s: Scenario;
let app: INestApplication;
let base: string;
let email: string;
let groupId: string;

/** A socket that records what the gateway did to it (as realtime-authentication.spec). */
class FakeSocket {
  readonly id = `sock-${randomUUID()}`;
  readonly rooms: string[] = [];
  disconnected = false;
  actor?: unknown;
  accountId?: string;
  sessionId?: string;
  constructor(readonly handshake: { auth?: Record<string, unknown>; headers?: Record<string, unknown> }) {
    this.handshake.headers ??= {};
  }
  async join(name: string): Promise<void> {
    this.rooms.push(name);
  }
  async leave(name: string): Promise<void> {
    const i = this.rooms.indexOf(name);
    if (i >= 0) this.rooms.splice(i, 1);
  }
  disconnect(): void {
    this.disconnected = true;
  }
}

async function login(username: string, password: string): Promise<string> {
  const r = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  expect(r.status).toBeLessThan(300);
  return ((await r.json()) as { accessToken: string }).accessToken;
}

const footprint = async () => ({
  messages: await g.prisma.message.count({ where: { conversationId: groupId } }),
  approvals: await g.prisma.messageApproval.count(),
  outbox: await g.prisma.outboxEvent.count(),
});

beforeAll(async () => {
  await g.prisma.$connect();
  const moduleRef = await Test.createTestingModule({
    imports: [PlatformModule, AuthModule, CommunicationModule],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false, rawBody: true });
  // As main.ts: the prefix, the global CommError filter, the infrastructure.
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] });
  app.useGlobalFilters(new CommErrorFilter());
  applyInfrastructure(app);
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/api/v1`;
});

afterAll(async () => {
  // The presence connection (REDIS_CLIENT) is opened by the gateway test's
  // handshake. app.close() itself must end it (RedisClientShutdown): if it did
  // not, this suite's jest process would never exit.
  const presence = app.get<Redis>(REDIS_CLIENT);
  await app.close();
  // QUIT resolves on the server's reply; the status turns 'end' when the socket closes.
  for (let i = 0; i < 40 && presence.status !== 'end'; i++) await new Promise((r) => setTimeout(r, 50));
  expect(presence.status).toBe('end');
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$disconnect();
});

beforeEach(async () => {
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  groupId = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;
  email = `sa-${randomUUID().slice(0, 8)}@${DOMAIN}`;
  await bootstrapSuperAdmin(g.prisma, { email, password: PASSWORD, displayName: 'owner_o' });
});

describe('POST /conversations/:id/messages as super_admin', () => {
  it('the token is genuine: /me answers 200 as super_admin (the refusal below is authorization, not authentication)', async () => {
    const token = await login(email, PASSWORD);
    const me = await fetch(`${base}/me`, { headers: { authorization: `Bearer ${token}` } });
    expect(me.status).toBe(200);
    expect(JSON.stringify(await me.json())).toContain('super_admin');
  });

  // PD-8 (owner decision 2026-10-15): the super admin has FULL read and write
  // in every conversation of its organization. These three cases asserted the
  // 2026-10-14 refusal; they now assert the reversal, through the real route.

  it('posts into the group: 201, persisted once, attributed as a step-in (assist)', async () => {
    const token = await login(email, PASSWORD);
    const before = await footprint();

    const r = await fetch(`${base}/conversations/${groupId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ type: 'text', body: 'super admin route probe', clientMessageId: randomUUID() }),
    });
    expect(r.status).toBe(201);
    const rows = await g.prisma.message.findMany({ where: { body: 'super admin route probe' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].onBehalfMode).toBe('assist');
    expect(rows[0].moderation).toBe('published');
    expect(await footprint()).not.toEqual(before);
  });

  it('reads the group over the same route', async () => {
    const token = await login(email, PASSWORD);
    const r = await fetch(`${base}/conversations/${groupId}/messages`, { headers: { authorization: `Bearer ${token}` } });
    expect(r.status).toBe(200);
  });

  it('the realtime gateway admits its subscription to the group', async () => {
    const token = await login(email, PASSWORD);
    const gateway = app.get(RealtimeGateway);
    const socket = new FakeSocket({ auth: { token } });
    await gateway.handleConnection(socket as never);
    expect(socket.disconnected).toBe(false);

    const ack = await gateway.subscribe(socket as never, { conversationId: groupId });
    expect(ack).toEqual(expect.objectContaining({ ok: true }));
    expect(socket.rooms).toContain(room.conversation(groupId));
  });
});
