/**
 * PD-52 over real HTTP (review of #369):
 *   - a key without a basis opens nothing: a specialist granted every
 *     teacher_grants key is refused page B's reads, the void, and a take or
 *     reply on a parent's complaint;
 *   - GET /teacher-records/access answers a parent, a teacher and Sales with
 *     nothing offered (200, never an error).
 *
 * Synthetic people only (G-20).
 */
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import { PlatformModule } from '@platform/platform.module';
import { AuthModule } from '@platform/auth/auth.module';
import { hashPassword } from '@platform/auth/password';
import { CommErrorCode } from '@platform/errors';
import { CommunicationModule } from '@communication/communication.module';
import { CommErrorFilter } from '@communication/api/http-exception.filter';
import { REDIS_CLIENT } from '@communication/realtime/redis.provider';
import { applyInfrastructure } from '../../src/infra/http/bootstrap';
import { TeacherFileModule } from '../../src/teacher-file/teacher-file.module';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const PASSWORD = 'pd52-records-spec-password-1';
const DOMAIN = 'pd52records.qa.jawwid.test';

const g = buildGraph();
let app: INestApplication;
let base: string;
let m: SeedManifest;
let orgId: string;
let specialist: { id: string; subject: string };

async function login(subject: string): Promise<string> {
  const r = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: subject, password: PASSWORD }),
  });
  return ((await r.json()) as { accessToken: string }).accessToken;
}
async function call(token: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await r.json().catch(() => ({}))) as { error?: { code?: string } } & Record<string, unknown>;
  return { status: r.status, code: json.error?.code, json };
}

const NOTHING = {
  basis: null,
  attendance: { view: false, record: false, decide: false },
  grants: { view: false, record: false },
  leaveBalance: false,
  amounts: false,
  opensFile: false,
};

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd52r-%'`);

  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd52r-${orgId.slice(0, 8)}', 'PD-52 QA academy')`,
  );
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    const account = await tx.account.create({
      data: { organizationId: orgId, subject: `owner@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true },
    });
    await tx.accountCredential.create({ data: { accountId: account.id, passwordHash: await hashPassword(PASSWORD) } });
    await tx.staff.create({ data: { organizationId: orgId, name: 'QA Organization Owner', role: 'super_admin', isActive: true, accountId: account.id } });
  });
  m = await seedOrgChat(g.prisma, { organizationId: orgId, emailDomain: DOMAIN, password: PASSWORD, passwordHash: await hashPassword(PASSWORD), messages: false });

  // A specialist holding every page-B key through a role, and no basis at all.
  const account = await g.prisma.account.create({
    data: { organizationId: orgId, subject: `grants@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true },
  });
  await g.prisma.accountCredential.create({ data: { accountId: account.id, passwordHash: await hashPassword(PASSWORD) } });
  const staff = await g.prisma.staff.create({ data: { organizationId: orgId, name: 'QA Grants Clerk', role: 'specialist', isActive: true, accountId: account.id } });
  specialist = { id: staff.id, subject: account.subject };
  const [{ id: role }] = await g.prisma.$queryRaw<Array<{ id: string }>>`
    SELECT chat.define_access_role('pd52_grants', 'Grants (en)', 'Grants (ar)', null, 'specialist',
      ARRAY['teacher_grants.view', 'teacher_grants.record']::text[], 'spec', ${m.superAdmin.id}::uuid)::text AS id`;
  await g.prisma.$queryRaw`SELECT chat.grant_access_role(${specialist.id}::uuid, ${role}::uuid, 'spec', ${m.superAdmin.id}::uuid)`;

  process.env.REDIS_URL = REDIS_URL;
  const moduleRef = await Test.createTestingModule({ imports: [PlatformModule, AuthModule, CommunicationModule, TeacherFileModule] }).compile();
  app = moduleRef.createNestApplication({ logger: false, rawBody: true });
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] });
  app.useGlobalFilters(new CommErrorFilter());
  applyInfrastructure(app);
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/api/v1`;
});

afterAll(async () => {
  const presence = app?.get<Redis>(REDIS_CLIENT);
  await app?.close();
  for (let i = 0; i < 40 && presence && presence.status !== 'end'; i++) await new Promise((r) => setTimeout(r, 50));
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd52r-%'`);
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
  await g.prisma.$disconnect();
});

describe('PD-52 over HTTP', () => {
  it('a key without a basis opens nothing: page B reads, the void, and a take or reply on a complaint are refused', async () => {
    const family = m.families[0]!;
    const child = family.children[0]!;
    const parentToken = await login(family.parent.subject);
    const filed = await call(parentToken, 'POST', '/me/feedback', { learnerId: child.id, category: 'complaint', body: 'The lesson was cut short.' });
    expect(filed.status).toBe(201);
    const feedbackId = (filed.json as { id: string }).id;

    const token = await login(specialist.subject);
    expect((await call(token, 'GET', '/teacher-records/access')).json).toEqual(NOTHING);
    for (const [method, path, body] of [
      ['GET', '/teacher-records/testimonials'],
      ['GET', `/teacher-records/teachers/${child.teacherId}/summary`],
      ['GET', '/teacher-files/rewards'],
      ['POST', `/teachers/${child.teacherId}/testimonials`, { body: 'x', source: 'other' }],
      ['POST', `/teacher-records/entries/${randomUUID()}/void`, { reason: 'x' }],
      ['POST', `/parent-feedback/${feedbackId}/take`],
      ['POST', `/parent-feedback/${feedbackId}/reply`, { response: 'Thank you.' }],
    ] as Array<[string, string, unknown?]>) {
      const r = await call(token, method, path, body);
      expect({ path, status: r.status }).toEqual({ path, status: 403 });
      expect([CommErrorCode.TEACHER_FILE_DENIED, CommErrorCode.PERMISSION_DENIED, CommErrorCode.FEEDBACK_DENIED]).toContain(r.code);
    }
    // Nothing moved.
    expect((await g.prisma.parentFeedback.findUniqueOrThrow({ where: { id: feedbackId } })).status).toBe('received');
  });

  it('GET /teacher-records/access offers a parent, a teacher and Sales nothing', async () => {
    for (const subject of [m.families[0]!.parent.subject, m.teachers[0]!.subject, m.salesManager.subject]) {
      const r = await call(await login(subject), 'GET', '/teacher-records/access');
      expect({ subject, status: r.status, json: r.json }).toEqual({ subject, status: 200, json: NOTHING });
    }
    const owner = await call(await login(m.superAdmin.subject), 'GET', '/teacher-records/access');
    expect(owner.json).toMatchObject({ basis: 'super_admin', attendance: { decide: true }, grants: { record: true } });
  });

  it('review of #374: a grants-only caller WITH a basis gets page B\'s sections and categories only', async () => {
    const tsup = m.teacherSupervisors[0]!;
    const family = m.families[0]!;
    const child = family.children[0]!;
    const parentToken = await login(family.parent.subject);
    expect((await call(parentToken, 'POST', '/me/feedback', { learnerId: child.id, category: 'praise', body: 'Kind.' })).status).toBe(201);
    expect((await call(parentToken, 'POST', '/me/feedback', { learnerId: child.id, category: 'suggestion', body: 'More homework.' })).status).toBe(201);

    const trimmed = ['teacher_supervision.view', 'teacher_supervision.record', 'teacher_attendance.view', 'teacher_attendance.record', 'teacher_attendance.decide'];
    const flip = `select set_config('chat.pd040_catalogue_change', 'on', true)`;
    await g.prisma.$transaction([
      g.prisma.$executeRawUnsafe(flip),
      g.prisma.$executeRawUnsafe(`delete from chat.legacy_permission_bundle where tier = 'supervisor' and department_kind = 'teachers' and permission_key = any($1::text[])`, trimmed),
    ]);
    try {
      const token = await login(tsup.subject);
      expect((await call(token, 'GET', '/teacher-records/access')).json).toMatchObject({ basis: 'teachers', attendance: { view: false }, grants: { view: true } });
      const strip = await call(token, 'GET', `/teacher-records/teachers/${child.teacherId}/summary`);
      expect(strip.status).toBe(200);
      expect(strip.json).toMatchObject({ away: null, ladder: null, openComplaints: null, grants: expect.any(Number), testimonials: expect.any(Number) });
      const list = await call(token, 'GET', '/parent-feedback');
      expect(list.status).toBe(200);
      expect([...new Set((list.json.feedback as Array<{ category: string }>).map((f) => f.category))]).toEqual(['praise']);
      expect((await call(token, 'GET', '/parent-feedback?category=suggestion')).status).toBe(403);
    } finally {
      await g.prisma.$transaction([
        g.prisma.$executeRawUnsafe(flip),
        g.prisma.$executeRawUnsafe(
          `insert into chat.legacy_permission_bundle (tier, department_kind, permission_key) select 'supervisor', 'teachers', k from unnest($1::text[]) k on conflict do nothing`,
          trimmed,
        ),
      ]);
    }
  });
});
