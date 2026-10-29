/**
 * PD-17 over real HTTP: real logins, the global bearer guard, the real routes.
 * What the service specs cannot prove: a teacher's own token, sent straight to
 * the API, reaches no Parent Profile and no family's money by any route, and
 * reaches the Student Profile of their own student only.
 *
 * Synthetic people only (G-20).
 */
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import { PlatformModule } from '@platform/platform.module';
import { AuthModule } from '@platform/auth/auth.module';
import { AuthService } from '@platform/auth/auth.service';
import { hashPassword } from '@platform/auth/password';
import { CommErrorCode } from '@platform/errors';
import { CommunicationModule } from '@communication/communication.module';
import { CommErrorFilter } from '@communication/api/http-exception.filter';
import { REDIS_CLIENT } from '@communication/realtime/redis.provider';
import { applyInfrastructure } from '../../src/infra/http/bootstrap';
import { LessonModule } from '../../src/lessons/lesson.module';
import { BillingModule } from '../../src/billing/billing.module';
import { ParentRecordModule } from '../../src/parent-profile/parent-record.module';
import { GeoModule } from '../../src/geo/geo.module';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const PASSWORD = 'pd17-http-spec-password-1';
const DOMAIN = 'pd17http.qa.jawwid.test';

const g = buildGraph();
let app: INestApplication;
let base: string;
let m: SeedManifest;
let orgId: string;

const tokens = new Map<string, string>();
async function tokenFor(subject: string): Promise<string> {
  if (!tokens.has(subject)) tokens.set(subject, (await app.get(AuthService).login(subject, PASSWORD)).accessToken);
  return tokens.get(subject)!;
}

async function http(subject: string | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = body ? { 'content-type': 'application/json' } : {};
  if (subject) headers.authorization = `Bearer ${await tokenFor(subject)}`;
  const r = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = (await r.json().catch(() => ({}))) as { error?: { code?: string } } & Record<string, unknown>;
  return { status: r.status, code: json.error?.code, json };
}

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd17h-%'`);

  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd17h-${orgId.slice(0, 8)}', 'PD-17 HTTP QA academy')`,
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
    imports: [PlatformModule, AuthModule, CommunicationModule, LessonModule, BillingModule, ParentRecordModule, GeoModule],
  }).compile();
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
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd17h-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
});

describe('PD-17 over HTTP', () => {
  it('every route is behind the bearer guard', async () => {
    const f = m.families[0]!;
    expect((await http(null, 'GET', '/parent-profiles')).status).toBe(401);
    expect((await http(null, 'GET', `/parent-profiles/${f.parent.id}`)).status).toBe(401);
    expect((await http(null, 'GET', `/families/${f.id}/billing`)).status).toBe(401);
    expect((await http(null, 'GET', `/learners/${f.children[0]!.id}/profile`)).status).toBe(401);
  });

  it('a teacher\'s own token reaches no Parent Profile and no money, by any route', async () => {
    const f = m.families[0]!;
    const child = f.children[0]!;
    const teacher = m.teachers.find((t) => t.id === child.teacherId)!;
    const created = await http(m.superAdmin.subject, 'POST', `/families/${f.id}/instalments`, {
      label: 'Fees', amountMinor: 50000, currency: 'AED', firstDueDate: '2026-11-01',
    });
    expect(created.status).toBe(201);
    const instalmentId = (created.json.instalments as Array<{ id: string }>)[0]!.id;

    const routes: Array<[string, string, unknown?]> = [
      ['GET', '/parent-profiles'],
      ['GET', `/parent-profiles/${f.parent.id}`],
      ['POST', `/parent-profiles/${f.parent.id}`, { phone: '+971 50 000 0000' }],
      ['POST', `/parent-profiles/${f.parent.id}/avatar/upload`, { mimeType: 'image/png', byteSize: 100 }],
      ['POST', `/parent-profiles/${f.parent.id}/avatar`, { objectKey: `avatars/contact/${f.parent.id}/${randomUUID()}` }],
      ['DELETE', `/parent-profiles/${f.parent.id}/avatar`],
      ['GET', `/families/${f.id}/billing`],
      ['POST', `/families/${f.id}/billing`, { paymentMethod: 'invoice' }],
      ['POST', `/families/${f.id}/instalments`, { label: 'x', amountMinor: 1, currency: 'AED', firstDueDate: '2026-11-01' }],
      ['POST', `/instalments/${instalmentId}/payment`, { paidOn: '2026-10-01', method: 'invoice' }],
      ['POST', `/instalments/${instalmentId}/void`, { reason: 'no' }],
      ['GET', '/instalments'],
    ];
    for (const [method, path, body] of routes) {
      const r = await http(teacher.subject, method, path, body);
      expect({ method, path, status: r.status, code: r.code }).toEqual({
        method,
        path,
        status: 403,
        code: path.startsWith('/parent-profiles') ? CommErrorCode.PARENT_PROFILE_DENIED : CommErrorCode.BILLING_DENIED,
      });
    }
    // A teacher has no "own payments" either.
    const own = await http(teacher.subject, 'GET', '/me/billing');
    expect({ status: own.status, code: own.code }).toEqual({ status: 403, code: CommErrorCode.BILLING_DENIED });
    const probe = await http(teacher.subject, 'GET', '/instalments/access');
    expect(probe.json).toMatchObject({ billingReader: false });
    // Nothing a teacher sent changed anything.
    expect(await g.prisma.parentFile.findUnique({ where: { contactId: f.parent.id } })).toBeNull();
    expect((await g.prisma.familyInstalment.findUniqueOrThrow({ where: { id: instalmentId } })).paidOn).toBeNull();
  });

  it('the teacher opens their own student\'s profile -- and not another teacher\'s student', async () => {
    const child = m.families[0]!.children[0]!;
    const teacher = m.teachers.find((t) => t.id === child.teacherId)!;
    const own = await http(teacher.subject, 'GET', `/learners/${child.id}/profile`);
    expect(own.status).toBe(200);
    expect(own.json).toMatchObject({ id: child.id, name: child.name, viewer: 'teacher' });
    expect(own.json).not.toHaveProperty('family');
    expect(own.json).not.toHaveProperty('birthDate');

    const foreign = m.families.flatMap((f) => f.children).find((c) => c.teacherId !== teacher.id)!;
    const other = await http(teacher.subject, 'GET', `/learners/${foreign.id}/profile`);
    expect(other.status).toBe(404);
  });

  it('a parent reads their own payments over HTTP, and no family\'s through the staff routes', async () => {
    const f = m.families[0]!;
    const mine = await http(f.parent.subject, 'GET', '/me/billing');
    expect(mine.status).toBe(200);
    expect(mine.json).toHaveProperty('instalments');
    for (const path of [`/families/${f.id}/billing`, `/parent-profiles/${f.parent.id}`, '/instalments']) {
      expect((await http(f.parent.subject, 'GET', path)).status).toBe(403);
    }
  });

  it('the administration opens both', async () => {
    const f = m.families[0]!;
    const parent = await http(m.operationsManager.subject, 'GET', `/parent-profiles/${f.parent.id}`);
    expect(parent.status).toBe(200);
    expect(parent.json).toMatchObject({ id: f.parent.id, childrenCount: f.children.length });
    const money = await http(m.operationsManager.subject, 'GET', `/families/${f.id}/billing`);
    expect(money.status).toBe(200);
    const student = await http(m.superAdmin.subject, 'GET', `/learners/${f.children[0]!.id}/profile`);
    expect(student.status).toBe(200);
    expect(student.json).toMatchObject({ viewer: 'staff', family: { id: f.id } });
  });

  it('PD-20: a Sales token does everything the app\'s Payments tab asks, over HTTP', async () => {
    const f = m.families[0]!;
    const sales = m.salesManager.subject;
    const access = await http(sales, 'GET', '/lessons/access');
    expect(access.json).toMatchObject({ sales: true });
    const me = await http(sales, 'GET', '/me');
    expect(me.json).toMatchObject({ kind: 'staff', staffRole: 'manager' });

    const list = await http(sales, 'GET', `/parent-profiles?q=${encodeURIComponent(f.parent.name.split(' ')[0]!)}`);
    expect(list.status).toBe(200);
    const item = (list.json.items as Array<Record<string, unknown>>).find((p) => p.id === f.parent.id)!;
    // The list carries no contact channel: the app never asks for the detail route.
    // PD-45: a family's location is not one (plan §4); Sales read it, as PD-17 allows.
    expect(Object.keys(item).sort()).toEqual(['avatarUrl', 'childrenCount', 'family', 'id', 'location', 'name']);
    expect(Object.keys(item.location as object).sort()).toEqual(['countryCode', 'subdivisionCode']);

    const created = await http(m.superAdmin.subject, 'POST', `/families/${f.id}/instalments`, {
      label: 'Sales app fees', amountMinor: 70000, currency: 'AED', firstDueDate: '2026-10-01',
    });
    const id = (created.json.instalments as Array<{ id: string; label: string }>).find((i) => i.label === 'Sales app fees')!.id;
    const billing = await http(sales, 'GET', `/families/${f.id}/billing`);
    expect(billing.json).toMatchObject({ canRecord: true });
    const paid = await http(sales, 'POST', `/instalments/${id}/payment`, { paidOn: '2026-10-02', method: 'bank_transfer', reference: 'TRX-1' });
    expect(paid.status).toBe(201);
    expect(await http(sales, 'POST', `/instalments/${id}/payment`, { paidOn: '2026-10-02', method: 'bank_transfer' })).toMatchObject({
      status: 409,
      code: CommErrorCode.BILLING_STATE,
    });
    const voided = await http(sales, 'POST', `/instalments/${id}/void`, { reason: 'recorded on the wrong family' });
    expect(voided.status).toBe(201);
    // Sales never edits the contact record, from any client.
    expect((await http(sales, 'POST', `/parent-profiles/${f.parent.id}`, { region: 'x' })).status).toBe(403);
  });
});

describe('PD-45: the country and subdivision lists over HTTP', () => {
  it('are behind the bearer guard, and any signed-in account reads them: staff, a teacher, a parent', async () => {
    expect((await http(null, 'GET', '/geo/countries')).status).toBe(401);
    expect((await http(null, 'GET', '/geo/countries/EG/subdivisions')).status).toBe(401);
    const f = m.families[0]!;
    const teacher = m.teachers.find((t) => t.id === f.children[0]!.teacherId)!;
    for (const who of [m.superAdmin.subject, m.operationsManager.subject, teacher.subject, f.parent.subject]) {
      const countries = await http(who, 'GET', '/geo/countries');
      expect({ who, status: countries.status }).toEqual({ who, status: 200 });
      const list = countries.json.countries as Array<{ code: string; pinned: number | null }>;
      expect(list.find((c) => c.code === 'EG')).toMatchObject({ pinned: 0 });
      const eg = await http(who, 'GET', '/geo/countries/eg/subdivisions');
      expect(eg.status).toBe(200);
      expect((eg.json.subdivisions as unknown[]).length).toBe(27);
    }
  });

  it('refuse a code that is not a country, and may be kept a day', async () => {
    const bad = await http(m.superAdmin.subject, 'GET', '/geo/countries/UK/subdivisions');
    expect({ status: bad.status, code: bad.code }).toEqual({ status: 400, code: CommErrorCode.VALIDATION });
    const r = await fetch(`${base}/geo/countries`, { headers: { authorization: `Bearer ${await tokenFor(m.superAdmin.subject)}` } });
    expect(r.headers.get('cache-control')).toBe('private, max-age=86400');
  });
});
