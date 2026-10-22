/**
 * PD-23 over real HTTP, on the real database (the 20261022130000 migration):
 *
 *   - login writes the policy: client, remembered, authenticated_at, and an
 *     expires_at inside the role's limits; the super admin is never kept
 *     signed in; refresh copies authenticated_at forward;
 *   - Devices & sessions: a person lists their own live sessions, ends another
 *     one, ends all the others, and ends the current one (= sign out); never
 *     another account's; a support session can read but not end anything;
 *   - administrators: list and end an account's sessions under the PD-21 rule,
 *     with a reason, audited; parents and teachers reach none of it.
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
import { AccountAdminModule } from '../../src/account-admin/account-admin.module';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const PASSWORD = 'pd23-http-spec-password-1';
const DOMAIN = 'pd23http.qa.jawwid.test';
const HOUR = 3600_000;
const DAY = 24 * HOUR;

const g = buildGraph();
let app: INestApplication;
let base: string;
let m: SeedManifest;
let orgId: string;

interface Login {
  status: number;
  code?: string;
  accessToken: string;
  refreshToken: string;
  session: { id: string; remembered: boolean; expiresAt: string; absoluteExpiresAt: string | null };
}

async function login(subject: string, extra: Record<string, unknown> = {}): Promise<Login> {
  const r = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: subject, password: PASSWORD, ...extra }),
  });
  const json = (await r.json().catch(() => ({}))) as Partial<Login> & { error?: { code?: string } };
  return {
    status: r.status,
    code: json.error?.code,
    accessToken: json.accessToken ?? '',
    refreshToken: json.refreshToken ?? '',
    session: json.session as Login['session'],
  };
}

async function call(token: string | null, method: string, path: string, body?: unknown) {
  const send = body !== undefined && method !== 'GET';
  const headers: Record<string, string> = send ? { 'content-type': 'application/json' } : {};
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(`${base}${path}`, { method, headers, body: send ? JSON.stringify(body) : undefined });
  const json = (await r.json().catch(() => ({}))) as { error?: { code?: string } } & Record<string, unknown>;
  return { status: r.status, code: json.error?.code, json };
}

async function accountIdOf(subject: string): Promise<string> {
  return (await g.prisma.account.findUniqueOrThrow({ where: { subject }, select: { id: true } })).id;
}

function near(iso: string | null | undefined, expectedMs: number) {
  expect(iso).toBeTruthy();
  expect(Math.abs(new Date(iso!).getTime() - expectedMs)).toBeLessThan(60_000);
}

const ios = { device: { platform: 'ios', name: 'iPhone', appVersion: '2.3.0' } };
const android = { device: { platform: 'android', name: 'Pixel' } };
const web = { device: { platform: 'web', name: 'Chrome on macOS' } };

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd23h-%'`);

  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd23h-${orgId.slice(0, 8)}', 'PD-23 HTTP QA academy')`,
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
    imports: [PlatformModule, AuthModule, CommunicationModule, AccountAdminModule],
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
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd23h-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
});

describe('PD-23: the policy is written at login and carried by refresh', () => {
  it('a parent on the app: 30 days idle, no absolute limit, never "remembered"', async () => {
    const r = await login(m.families[0]!.parent.subject, { ...ios, remember: true });
    expect(r.status).toBe(200);
    expect(r.session.remembered).toBe(false);
    near(r.session.expiresAt, Date.now() + 30 * DAY);
    expect(r.session.absoluteExpiresAt).toBeNull();
    const row = await g.prisma.session.findUniqueOrThrow({ where: { id: r.session.id } });
    expect(row).toMatchObject({ client: 'app', remembered: false });
  });

  it('staff on the web: kept signed in = 7 d / 30 d; this tab only = 12 h / 7 d', async () => {
    const kept = await login(m.supervisors[0]!.subject, { ...web, remember: true });
    expect(kept.session.remembered).toBe(true);
    near(kept.session.expiresAt, Date.now() + 7 * DAY);
    near(kept.session.absoluteExpiresAt, Date.now() + 30 * DAY);

    const tab = await login(m.supervisors[0]!.subject, web);
    expect(tab.session.remembered).toBe(false);
    near(tab.session.expiresAt, Date.now() + 12 * HOUR);
    near(tab.session.absoluteExpiresAt, Date.now() + 7 * DAY);
  });

  it('the super admin asks to be kept signed in and is not', async () => {
    const r = await login(m.superAdmin.subject, { ...web, remember: true });
    expect(r.status).toBe(200);
    expect(r.session.remembered).toBe(false);
    near(r.session.expiresAt, Date.now() + 12 * HOUR);
    const row = await g.prisma.session.findUniqueOrThrow({ where: { id: r.session.id } });
    expect(row.remembered).toBe(false);
  });

  it('the database refuses a remembered app session outright', async () => {
    const r = await login(m.families[0]!.parent.subject, ios);
    await expect(
      g.prisma.$executeRawUnsafe(`update chat.session set remembered = true where id = '${r.session.id}'::uuid`),
    ).rejects.toThrow(/session_remembered_only_on_web/);
  });

  it('refresh copies the login time forward and keeps the remember flag', async () => {
    const first = await login(m.supervisors[1]!.subject, { ...web, remember: true });
    const firstRow = await g.prisma.session.findUniqueOrThrow({ where: { id: first.session.id } });
    const refreshed = await call(null, 'POST', '/auth/refresh', { refreshToken: first.refreshToken });
    expect(refreshed.status).toBe(200);
    const session = refreshed.json.session as Login['session'];
    expect(session.remembered).toBe(true);
    const next = await g.prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(next.authenticatedAt.getTime()).toBe(firstRow.authenticatedAt.getTime());
    expect(next).toMatchObject({ client: 'web', remembered: true });
  });
});

describe('PD-23: a person\'s own devices & sessions', () => {
  it('lists live sessions, current first, with no token material and no support session', async () => {
    const parent = m.families[1]!.parent.subject;
    const phone = await login(parent, ios);
    const tablet = await login(parent, android);

    const r = await call(tablet.accessToken, 'GET', '/me/sessions');
    expect(r.status).toBe(200);
    const sessions = r.json.sessions as Array<Record<string, unknown>>;
    expect(sessions[0]).toMatchObject({ id: tablet.session.id, current: true, platform: 'android', deviceName: 'Pixel' });
    expect(sessions.find((s) => s.id === phone.session.id)).toMatchObject({ current: false, platform: 'ios', appVersion: '2.3.0' });
    expect(Object.keys(sessions[0]!).sort()).toEqual(
      ['appVersion', 'current', 'deviceName', 'expiresAt', 'id', 'lastSeenAt', 'platform', 'remembered', 'signedInAt'],
    );
    expect(JSON.stringify(r.json)).not.toMatch(/refreshTokenHash|ipHash|userAgent|@/);
  });

  it('ends another session, which then dies on its next request and refresh', async () => {
    const parent = m.families[2]!.parent.subject;
    const here = await login(parent, ios);
    const there = await login(parent, android);

    expect((await call(here.accessToken, 'POST', `/me/sessions/${there.session.id}/revoke`)).status).toBe(200);
    expect((await call(there.accessToken, 'GET', '/me')).status).toBe(401);
    expect((await call(null, 'POST', '/auth/refresh', { refreshToken: there.refreshToken })).status).toBe(401);
    // ...and that is not read as token theft: this device is still signed in.
    expect((await call(here.accessToken, 'GET', '/me')).status).toBe(200);
    const row = await g.prisma.session.findUniqueOrThrow({ where: { id: there.session.id } });
    expect(row).toMatchObject({ revokedReason: 'signed out from another device', revokedBy: await accountIdOf(parent) });
  });

  it('another account\'s session id is answered exactly like a made-up one', async () => {
    const victim = await login(m.families[3]!.parent.subject, ios);
    const prober = await login(m.families[4]!.parent.subject, ios);
    const foreign = await call(prober.accessToken, 'POST', `/me/sessions/${victim.session.id}/revoke`);
    const unknown = await call(prober.accessToken, 'POST', `/me/sessions/${randomUUID()}/revoke`);
    expect({ status: foreign.status, code: foreign.code }).toEqual({ status: 404, code: CommErrorCode.SESSION_NOT_FOUND });
    expect({ status: unknown.status, code: unknown.code }).toEqual({ status: 404, code: CommErrorCode.SESSION_NOT_FOUND });
    expect((await call(victim.accessToken, 'GET', '/me')).status).toBe(200);
  });

  it('"sign out all other devices" keeps this one; ending the current one is signing out', async () => {
    const teacher = m.teachers[0]!.subject;
    const a = await login(teacher, ios);
    const b = await login(teacher, android);
    const here = await login(teacher, ios);

    const r = await call(here.accessToken, 'POST', '/me/sessions/revoke-others');
    expect(r.status).toBe(200);
    expect(r.json.revoked).toBeGreaterThanOrEqual(2);
    expect((await call(a.accessToken, 'GET', '/me')).status).toBe(401);
    expect((await call(b.accessToken, 'GET', '/me')).status).toBe(401);
    const list = await call(here.accessToken, 'GET', '/me/sessions');
    expect((list.json.sessions as Array<{ id: string }>).map((s) => s.id)).toEqual([here.session.id]);

    expect((await call(here.accessToken, 'POST', `/me/sessions/${here.session.id}/revoke`)).status).toBe(200);
    expect((await call(here.accessToken, 'GET', '/me')).status).toBe(401);
  });

  it('every route is behind the bearer guard', async () => {
    expect((await call(null, 'GET', '/me/sessions')).status).toBe(401);
    expect((await call(null, 'POST', `/me/sessions/${randomUUID()}/revoke`)).status).toBe(401);
    expect((await call(null, 'POST', '/me/sessions/revoke-others')).status).toBe(401);
  });

  it('a support session (PD-21) is not listed and may not end the person\'s sessions', async () => {
    const parent = m.families[5]!.parent.subject;
    const own = await login(parent, ios);
    const admin = (await login(m.supervisors[0]!.subject, web)).accessToken;
    const opened = await call(admin, 'POST', '/admin/impersonations', { accountId: await accountIdOf(parent), reason: 'help with the app' });
    expect(opened.status).toBe(201);
    const support = opened.json.accessToken as string;

    const seen = await call(own.accessToken, 'GET', '/me/sessions');
    const ids = (seen.json.sessions as Array<{ id: string }>).map((s) => s.id);
    const supportSession = await g.prisma.session.findFirstOrThrow({ where: { impersonationId: (opened.json.session as { id: string }).id } });
    expect(ids).not.toContain(supportSession.id);

    expect((await call(support, 'POST', '/me/sessions/revoke-others')).status).toBe(403);
    expect((await call(support, 'POST', `/me/sessions/${own.session.id}/revoke`)).status).toBe(403);
    expect((await call(own.accessToken, 'GET', '/me')).status).toBe(200);
  });
});

describe('PD-23: an administrator ends an account\'s sessions', () => {
  it('lists them and ends one with a reason, audited', async () => {
    const parent = m.families[6]!.parent.subject;
    const accountId = await accountIdOf(parent);
    const phone = await login(parent, ios);
    const supervisor = (await login(m.supervisors[0]!.subject, web)).accessToken;

    const list = await call(supervisor, 'GET', `/admin/accounts/${accountId}/sessions`);
    expect(list.status).toBe(200);
    const sessions = list.json.sessions as Array<{ id: string; current: boolean }>;
    expect(sessions.some((s) => s.id === phone.session.id)).toBe(true);
    expect(sessions.every((s) => s.current === false)).toBe(true);

    expect((await call(supervisor, 'POST', `/admin/accounts/${accountId}/sessions/${phone.session.id}/revoke`, {})).status).toBe(400);
    const ended = await call(supervisor, 'POST', `/admin/accounts/${accountId}/sessions/${phone.session.id}/revoke`, { reason: 'lost phone' });
    expect(ended.status).toBe(200);
    expect((await call(phone.accessToken, 'GET', '/me')).status).toBe(401);
    const row = await g.prisma.session.findUniqueOrThrow({ where: { id: phone.session.id } });
    expect(row.revokedReason).toBe('signed out by an administrator: lost phone');
    const audit = await g.prisma.auditLog.findFirst({ where: { entity: 'session', entityId: phone.session.id, action: 'session.revoked' } });
    expect(audit).toMatchObject({ actorId: m.supervisors[0]!.id, reason: 'signed out by an administrator: lost phone' });

    // A session of ANOTHER account, named under this one, is not found.
    const other = await login(m.families[7]!.parent.subject, ios);
    const cross = await call(supervisor, 'POST', `/admin/accounts/${accountId}/sessions/${other.session.id}/revoke`, { reason: 'x' });
    expect({ status: cross.status, code: cross.code }).toEqual({ status: 404, code: CommErrorCode.SESSION_NOT_FOUND });
    expect((await call(other.accessToken, 'GET', '/me')).status).toBe(200);
  });

  it('ends all of them; the account stays active and can sign in again', async () => {
    const teacher = m.teachers[1]!.subject;
    const accountId = await accountIdOf(teacher);
    const a = await login(teacher, ios);
    const b = await login(teacher, android);
    const manager = (await login(m.operationsManager.subject, web)).accessToken;

    const r = await call(manager, 'POST', `/admin/accounts/${accountId}/sessions/revoke-all`, { reason: 'shared device' });
    expect(r.status).toBe(200);
    expect(r.json.revoked).toBeGreaterThanOrEqual(2);
    expect((await call(a.accessToken, 'GET', '/me')).status).toBe(401);
    expect((await call(b.accessToken, 'GET', '/me')).status).toBe(401);
    expect((await login(teacher, ios)).status).toBe(200);
  });

  it('follows the PD-21 rule: parents and teachers never; staff accounts only by the super admin; never the super admin', async () => {
    const target = await accountIdOf(m.families[8]!.parent.subject);
    for (const subject of [m.families[0]!.parent.subject, m.teachers[0]!.subject]) {
      const token = (await login(subject, ios)).accessToken;
      for (const [method, path] of [
        ['GET', `/admin/accounts/${target}/sessions`],
        ['POST', `/admin/accounts/${target}/sessions/revoke-all`],
        ['POST', `/admin/accounts/${target}/sessions/${randomUUID()}/revoke`],
      ] as const) {
        const r = await call(token, method, path, { reason: 'probing' });
        expect({ subject, path, status: r.status, code: r.code }).toEqual({ subject, path, status: 403, code: CommErrorCode.ACCOUNT_ADMIN_DENIED });
      }
    }

    const supervisorAccount = await accountIdOf(m.supervisors[1]!.subject);
    const ownerAccount = await accountIdOf(m.superAdmin.subject);
    const manager = (await login(m.operationsManager.subject, web)).accessToken;
    expect((await call(manager, 'GET', `/admin/accounts/${supervisorAccount}/sessions`)).code).toBe(CommErrorCode.ACCOUNT_ADMIN_DENIED);
    const owner = (await login(m.superAdmin.subject, web)).accessToken;
    expect((await call(owner, 'GET', `/admin/accounts/${supervisorAccount}/sessions`)).status).toBe(200);
    expect((await call(owner, 'POST', `/admin/accounts/${ownerAccount}/sessions/revoke-all`, { reason: 'x' })).code).toBe(
      CommErrorCode.ACCOUNT_ADMIN_DENIED,
    );
    expect((await call(manager, 'POST', `/admin/accounts/${ownerAccount}/sessions/revoke-all`, { reason: 'x' })).code).toBe(
      CommErrorCode.ACCOUNT_ADMIN_DENIED,
    );
  });
});
