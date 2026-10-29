/**
 * PD-39 PR-1 over HTTP (review of #279): what only the wire shows.
 *
 *   - a teacher's routes are @NotForStaff: PermissionGuard refuses staff;
 *   - /teacher-boards needs whiteboards.view (an Operations supervisor has
 *     none) and then the service narrows to the teacher's own readers;
 *   - the page autosave carries up to 512 KB: its route alone takes a 600 KB
 *     body (the default 100 KB would make a growing page unsaveable), and a
 *     larger body is a 413;
 *   - board writes are rate limited (429 COMMON.RATE_LIMITED);
 *   - another organization's people get 404, however the id was learnt.
 *
 * Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import { PlatformModule } from '@platform/platform.module';
import { AuthModule } from '@platform/auth/auth.module';
import { AuthService } from '@platform/auth/auth.service';
import { hashPassword } from '@platform/auth/password';
import { CommunicationModule } from '@communication/communication.module';
import { CommErrorFilter } from '@communication/api/http-exception.filter';
import { REDIS_CLIENT } from '@communication/realtime/redis.provider';
import { applyInfrastructure } from '../../src/infra/http/bootstrap';
import { WhiteboardModule } from '../../src/whiteboards/whiteboard.module';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const PASSWORD = 'pd39-whiteboard-spec-password-1';
const DOMAIN = 'pd39wb.qa.jawwid.test';
const OTHER_DOMAIN = 'pd39wbother.qa.jawwid.test';
const SLUG = 'pd39w-';
const THROTTLE_KEY = 'abuse.throttle.whiteboard_write_actor';

const g = buildGraph();
let m: SeedManifest;
let other: SeedManifest;
let app: INestApplication;
let base: string;
let throttleBefore: unknown;

const tokens = new Map<string, string>();
async function tokenFor(subject: string): Promise<string> {
  if (!tokens.has(subject)) tokens.set(subject, (await app.get(AuthService).login(subject, PASSWORD)).accessToken);
  return tokens.get(subject)!;
}

async function http(subject: string | null, method: string, path: string, body?: unknown, raw?: string) {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(subject ? { authorization: `Bearer ${await tokenFor(subject)}` } : {}),
      ...(body !== undefined || raw !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await r.text();
  let json: Record<string, any> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, any>) : {};
  } catch {
    json = {};
  }
  return { status: r.status, code: json.error?.code as string | undefined, json };
}

async function seedOrg(slug: string, domain: string): Promise<SeedManifest> {
  const organizationId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${organizationId}'::uuid, '${slug}${organizationId.slice(0, 8)}', 'PD-39 QA academy')`,
  );
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    const account = await tx.account.create({ data: { organizationId, subject: `owner@${domain}`, kind: 'staff', status: 'active', isActive: true } });
    await tx.accountCredential.create({ data: { accountId: account.id, passwordHash: await hashPassword(PASSWORD) } });
    await tx.staff.create({ data: { organizationId, name: 'QA Organization Owner', role: 'super_admin', isActive: true, accountId: account.id } });
  });
  return seedOrgChat(g.prisma, { organizationId, emailDomain: domain, password: PASSWORD, passwordHash: await hashPassword(PASSWORD), messages: false });
}

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  for (const d of [DOMAIN, OTHER_DOMAIN]) await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${d}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like '${SLUG}%'`);
  m = await seedOrg(SLUG, DOMAIN);
  other = await seedOrg(`${SLUG}o-`, OTHER_DOMAIN);
  throttleBefore = (await g.prisma.$queryRaw<Array<{ value: unknown }>>`SELECT value FROM chat.config WHERE key = ${THROTTLE_KEY}`)[0]?.value;

  process.env.REDIS_URL = REDIS_URL;
  const moduleRef = await Test.createTestingModule({ imports: [PlatformModule, AuthModule, CommunicationModule, WhiteboardModule] }).compile();
  app = moduleRef.createNestApplication({ logger: false, rawBody: true });
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] });
  app.useGlobalFilters(new CommErrorFilter());
  applyInfrastructure(app);
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/api/v1`;
});

afterAll(async () => {
  await g.prisma.$executeRaw`UPDATE chat.config SET value = ${JSON.stringify(throttleBefore ?? 240)}::jsonb WHERE key = ${THROTTLE_KEY}`;
  const presence = app?.get<Redis>(REDIS_CLIENT);
  await app?.close();
  for (let i = 0; i < 40 && presence && presence.status !== 'end'; i++) await new Promise((r) => setTimeout(r, 50));
  await truncate(g.prisma);
  for (const d of [DOMAIN, OTHER_DOMAIN]) await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${d}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like '${SLUG}%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
});

/** m.teachers[0] is supervised by m.teacherSupervisors[0] (the seed's first five teachers). */
const owner = () => m.teachers[0]!;
const newBoard = async (subject = owner().subject) => {
  const r = await http(subject, 'POST', '/whiteboards', { title: 'Lesson board' });
  expect(r.status).toBe(201);
  return r.json as { id: string; revision: number; pages: Array<{ id: string }> };
};

describe('who reaches which route', () => {
  it("a teacher's routes refuse staff; /teacher-boards refuses a holder without the key and narrows the rest", async () => {
    const b = await newBoard();
    // @NotForStaff: refused before the service, whoever the staff member is.
    for (const staff of [m.superAdmin, m.teachersManager, m.teacherSupervisors[0]!]) {
      expect((await http(staff.subject, 'GET', '/whiteboards')).status).toBe(403);
      expect((await http(staff.subject, 'GET', `/whiteboards/${b.id}`)).status).toBe(403);
    }
    // PermissionGuard: an Operations supervisor holds no whiteboards key.
    expect((await http(m.supervisors[0]!.subject, 'GET', `/teacher-boards/${b.id}`)).status).toBe(403);
    // The key opens the door; the service narrows to the teacher's own readers.
    expect((await http(m.teacherSupervisors[0]!.subject, 'GET', `/teacher-boards/${b.id}`)).status).toBe(200);
    expect((await http(m.teachersManager.subject, 'GET', `/teacher-boards?teacherId=${owner().id}`)).status).toBe(200);
    const notTheirs = await http(m.teacherSupervisors[1]!.subject, 'GET', `/teacher-boards/${b.id}`);
    expect([notTheirs.status, notTheirs.code]).toEqual([404, 'COMM.WHITEBOARD_NOT_FOUND']);
    // Another teacher of the same academy.
    const otherTeacher = await http(m.teachers[1]!.subject, 'GET', `/whiteboards/${b.id}`);
    expect([otherTeacher.status, otherTeacher.code]).toEqual([404, 'COMM.WHITEBOARD_NOT_FOUND']);
  });

  it("another organization's teacher, Teachers Manager and super admin get 404", async () => {
    const b = await newBoard();
    expect((await http(other.teachers[0]!.subject, 'GET', `/whiteboards/${b.id}`)).status).toBe(404);
    expect((await http(other.teachers[0]!.subject, 'POST', `/whiteboards/${b.id}/rename`, { revision: 1, title: 'x' })).status).toBe(404);
    for (const staff of [other.teachersManager, other.superAdmin]) {
      expect((await http(staff.subject, 'GET', `/teacher-boards/${b.id}`)).status).toBe(404);
      expect((await http(staff.subject, 'GET', `/teacher-boards?teacherId=${owner().id}`)).status).toBe(404);
    }
  });
});

describe('the page autosave', () => {
  it('saves a page of ~500 KB (over the default 100 KB body limit); a body over 600 KB is a 413', async () => {
    const b = await newBoard();
    const elements = Array.from({ length: 250 }, (_, i) => ({ id: `t${i}`, kind: 'text', text: 'ب'.repeat(990) }));
    const document = { v: 1, elements };
    expect(Buffer.byteLength(JSON.stringify(document))).toBeGreaterThan(450 * 1024);
    const saved = await http(owner().subject, 'POST', `/whiteboards/${b.id}/pages/${b.pages[0]!.id}`, { revision: b.revision, document });
    expect(saved.status).toBe(200);
    expect(saved.json.revision).toBe(b.revision + 1);

    const huge = JSON.stringify({ revision: saved.json.revision, document: { v: 1, elements: [{ id: 'x', kind: 'text', text: 'x'.repeat(700 * 1024) }] } });
    const refused = await http(owner().subject, 'POST', `/whiteboards/${b.id}/pages/${b.pages[0]!.id}`, undefined, huge);
    expect(refused.status).toBe(413);
    const reopened = await http(owner().subject, 'GET', `/whiteboards/${b.id}`);
    expect(reopened.json.revision).toBe(saved.json.revision);
  });

  it('other routes keep the default limit', async () => {
    const b = await newBoard();
    const big = JSON.stringify({ revision: b.revision, title: 'x'.repeat(200 * 1024) });
    expect((await http(owner().subject, 'POST', `/whiteboards/${b.id}/rename`, undefined, big)).status).toBe(413);
  });
});

describe('the write rate limit', () => {
  it('answers 429 COMMON.RATE_LIMITED past the configured budget', async () => {
    const teacher = m.teachers[2]!;
    const b = await newBoard(teacher.subject);
    await g.prisma.$executeRaw`UPDATE chat.config SET value = '3'::jsonb WHERE key = ${THROTTLE_KEY}`;
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) {
        const r = await http(teacher.subject, 'POST', `/whiteboards/${b.id}/rename`, { revision: b.revision + i, title: `t${i}` });
        statuses.push(r.status);
        if (r.status === 429) expect(r.code).toBe('COMMON.RATE_LIMITED');
      }
      expect(statuses).toContain(429);
    } finally {
      await g.prisma.$executeRaw`UPDATE chat.config SET value = ${JSON.stringify(throttleBefore ?? 240)}::jsonb WHERE key = ${THROTTLE_KEY}`;
    }
  });
});
