/**
 * PD-37: typing over real HTTP, through the real app -- the global guards, the
 * real TypingService on Redis, the `typing_actor` budget -- to a real socket.
 *
 *   - The debounce holds over HTTP too: a burst of "typing" pings from one
 *     person reaches the others as ONE `typing.started`, and one stop as one
 *     `typing.stopped`.
 *   - The budget: past `abuse.throttle.typing_actor` (40) pings in the window,
 *     the route answers 429 COMMON.RATE_LIMITED.
 *
 * Requires Redis: AUTH_TEST_REDIS_URL / REDIS_URL, your own instance.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import { PlatformModule } from '@platform/platform.module';
import { AuthModule } from '@platform/auth/auth.module';
import { hashPassword } from '@platform/auth/password';
import { CommunicationModule } from '@communication/communication.module';
import { CommErrorFilter } from '@communication/api/http-exception.filter';
import { REDIS_CLIENT } from '@communication/realtime/redis.provider';
import { CommEvent } from '@communication/contracts/events';
import { applyInfrastructure } from '../../src/infra/http/bootstrap';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

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

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const PASSWORD = 'pd37-typing-http-password-1';
const DOMAIN = 'pd37typing.qa.jawwid.test';

const g = buildGraph();
let app: INestApplication;
let origin: string;
let base: string;
let m: SeedManifest;
const sockets: ClientSocket[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function login(subject: string): Promise<string> {
  const r = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: subject, password: PASSWORD }),
  });
  if (r.status !== 200) throw new Error(`login ${subject}: ${r.status}`);
  return ((await r.json()) as { accessToken: string }).accessToken;
}

async function ping(token: string, conversationId: string, typing: boolean) {
  const r = await fetch(`${base}/conversations/${conversationId}/typing`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ typing }),
  });
  const json = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: { code?: string } };
  return { status: r.status, ok: json.ok, code: json.error?.code };
}

/** A socket subscribed to [conversationId], recording every frame it receives. */
async function listener(token: string, conversationId: string) {
  const socket = ioClient(origin, { transports: ['websocket'], forceNew: true, reconnection: false, auth: { token } });
  sockets.push(socket);
  const inbox: Array<{ event: string; payload: Record<string, unknown> }> = [];
  socket.onAny((event, payload) => inbox.push({ event, payload: payload as Record<string, unknown> }));
  await new Promise<void>((resolve, reject) => {
    socket.on('connect', () => resolve());
    socket.on('connect_error', (e) => reject(e));
  });
  // Retried on COMM.UNKNOWN_ACTOR, as both clients do: until the handshake
  // binds the identity before `connect` (#276), a subscribe sent at once can
  // arrive before the socket knows who it is.
  let answer: { ok: boolean; code?: string } = { ok: false };
  for (let attempt = 0; attempt < 10; attempt++) {
    answer = await new Promise((r) => socket.emit('conversation.subscribe', { conversationId }, r));
    if (answer.ok || answer.code !== 'COMM.UNKNOWN_ACTOR') break;
    await sleep(100);
  }
  if (!answer.ok) throw new Error(`the listener could not subscribe: ${answer.code}`);
  return inbox;
}

/** A family with a student group, and that group's teacher. */
function groupFixture() {
  const family = m.families.find((f) => f.groups.length > 0 && f.groups[0]!.teacherIds.length > 0);
  if (!family) throw new Error('the seed has no family with a student group');
  const group = family.groups[0]!;
  const teacher = m.teachers.find((t) => t.id === group.teacherIds[0]);
  if (!teacher) throw new Error("the group's teacher is not in the seed");
  return { family, group, teacher };
}

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd37t-%'`);

  const orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd37t-${orgId.slice(0, 8)}', 'PD-37 typing QA academy')`,
  );
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    const account = await tx.account.create({
      data: { organizationId: orgId, subject: `owner@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true },
    });
    await tx.accountCredential.create({ data: { accountId: account.id, passwordHash: await hashPassword(PASSWORD) } });
    await tx.staff.create({
      data: { organizationId: orgId, name: 'QA Organization Owner', role: 'super_admin', isActive: true, accountId: account.id },
    });
  });
  m = await seedOrgChat(g.prisma, {
    organizationId: orgId,
    emailDomain: DOMAIN,
    password: PASSWORD,
    passwordHash: await hashPassword(PASSWORD),
    messages: false,
  });

  process.env.REDIS_URL = REDIS_URL;
  const moduleRef = await Test.createTestingModule({
    imports: [PlatformModule, AuthModule, CommunicationModule],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false, rawBody: true });
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] });
  app.useGlobalFilters(new CommErrorFilter());
  applyInfrastructure(app);
  await app.listen(0, '127.0.0.1');
  origin = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  base = `${origin}/api/v1`;
});

afterEach(() => {
  for (const s of sockets.splice(0)) s.close();
});

afterAll(async () => {
  const redis = app?.get<Redis>(REDIS_CLIENT);
  await app?.close();
  for (let i = 0; i < 40 && redis && redis.status !== 'end'; i++) await sleep(50);
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd37t-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
});

describe('PD-37: typing over real HTTP', () => {
  it('a burst of pings is ONE "typing" for the others (the Redis debounce), and one stop is one stop', async () => {
    const { family, group, teacher } = groupFixture();
    const inbox = await listener(await login(teacher.subject), group.conversationId);
    const parent = await login(family.parent.subject);

    for (let i = 0; i < 5; i++) expect(await ping(parent, group.conversationId, true)).toMatchObject({ status: 201, ok: true });
    await sleep(300);
    const fromParent = (event: string) =>
      inbox.filter((e) => e.event === event && e.payload.actorId === family.parent.id).length;
    expect(fromParent(CommEvent.TYPING_STARTED)).toBe(1);

    expect(await ping(parent, group.conversationId, false)).toMatchObject({ status: 201, ok: true });
    expect(await ping(parent, group.conversationId, false)).toMatchObject({ status: 201, ok: true });
    await sleep(300);
    expect(fromParent(CommEvent.TYPING_STOPPED)).toBe(1);
  });

  it('past the typing_actor budget (40 in the window) the route answers 429', async () => {
    const { group, teacher } = groupFixture();
    const token = await login(teacher.subject);
    const answers: number[] = [];
    for (let i = 0; i < 41; i++) answers.push((await ping(token, group.conversationId, i % 2 === 0)).status);
    expect(answers.slice(0, 40).every((s) => s === 201)).toBe(true);
    const refused = await ping(token, group.conversationId, true);
    expect(answers[40]).toBe(429);
    expect(refused).toMatchObject({ status: 429, code: 'COMMON.RATE_LIMITED' });
  });
});
