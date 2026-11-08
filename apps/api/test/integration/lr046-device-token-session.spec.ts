/**
 * LR-46: a push token belongs to the SESSION that registered it.
 *
 * Over real HTTP, on the real database (the 20261109120000 migration):
 *
 *   - registering a token stamps the caller's current session on it;
 *   - ending a session (sign-out, "sign out the others", a password change,
 *     refresh-token reuse, or any direct revocation of the row) deactivates
 *     exactly that session's tokens -- another session's stay active;
 *   - a refresh rotation (and the password change's renewal of the current
 *     session) is the same sign-in continuing: the token follows the successor
 *     session and stays active;
 *   - a token whose current owner's session is still live cannot be taken by
 *     another account (409 DEVICE_TOKEN_IN_USE, nothing changes); once that
 *     session has ended, another account on the same phone may register it;
 *   - a token row from before the migration (no session) keeps today's
 *     behaviour: any account may rebind it.
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
const PASSWORD = 'lr46-http-spec-password-1';
const DOMAIN = 'lr46http.qa.jawwid.test';
const TOKEN_PREFIX = 'lr046-';

const g = buildGraph();
let app: INestApplication;
let base: string;
let m: SeedManifest;
let orgId: string;

interface Login {
  status: number;
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

const ios = { device: { platform: 'ios', name: 'iPhone', appVersion: '2.3.0' } };
const android = { device: { platform: 'android', name: 'Pixel' } };

async function call(token: string | null, method: string, path: string, body?: unknown) {
  const send = body !== undefined && method !== 'GET';
  const headers: Record<string, string> = send ? { 'content-type': 'application/json' } : {};
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(`${base}${path}`, { method, headers, body: send ? JSON.stringify(body) : undefined });
  const json = (await r.json().catch(() => ({}))) as { error?: { code?: string } } & Record<string, unknown>;
  return { status: r.status, code: json.error?.code, json };
}

function asLogin(r: Awaited<ReturnType<typeof call>>): Login {
  const json = r.json as { accessToken?: string; refreshToken?: string; session?: { id: string } };
  return {
    status: r.status,
    accessToken: json.accessToken ?? '',
    refreshToken: json.refreshToken ?? '',
    sessionId: json.session?.id ?? '',
  };
}

async function login(subject: string, device: Record<string, unknown> = ios, password = PASSWORD): Promise<Login> {
  const r = asLogin(await call(null, 'POST', '/auth/login', { username: subject, password, ...device }));
  expect(r.status).toBe(200);
  expect(r.sessionId).toBeTruthy();
  return r;
}

const newToken = () => `${TOKEN_PREFIX}${randomUUID()}`;

function register(accessToken: string, token: string, platform = 'ios') {
  return call(accessToken, 'POST', '/notifications/devices', { token, platform });
}

const row = (token: string) => g.prisma.deviceToken.findUniqueOrThrow({ where: { token } });

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.deviceToken.deleteMany({ where: { token: { startsWith: TOKEN_PREFIX } } });
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'lr46h-%'`);

  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'lr46h-${orgId.slice(0, 8)}', 'LR-46 HTTP QA academy')`,
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
  await g.prisma.deviceToken.deleteMany({ where: { token: { startsWith: TOKEN_PREFIX } } });
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'lr46h-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
});

describe('LR-46 (a): a session that ends stops its pushes', () => {
  it('registering stamps the caller\'s current session on the token', async () => {
    const parent = m.families[0]!.parent;
    const phone = await login(parent.subject, ios);
    const token = newToken();
    expect((await register(phone.accessToken, token)).status).toBe(201);
    expect(await row(token)).toMatchObject({ actorId: parent.id, sessionId: phone.sessionId, isActive: true });
  });

  it('signing out deactivates that session\'s tokens only; another session\'s stay active', async () => {
    const parent = m.families[0]!.parent;
    const phone = await login(parent.subject, ios);
    const tablet = await login(parent.subject, android);
    const phoneToken = newToken();
    const tabletToken = newToken();
    expect((await register(phone.accessToken, phoneToken)).status).toBe(201);
    expect((await register(tablet.accessToken, tabletToken, 'android')).status).toBe(201);

    expect((await call(phone.accessToken, 'POST', '/auth/logout')).status).toBe(200);

    expect((await row(phoneToken)).isActive).toBe(false);
    expect((await row(tabletToken)).isActive).toBe(true);
  });

  it('a remote sign-out of another session ("Devices & sessions") deactivates the lost phone\'s token', async () => {
    const parent = m.families[1]!.parent;
    const lost = await login(parent.subject, ios);
    const here = await login(parent.subject, android);
    const lostToken = newToken();
    const hereToken = newToken();
    await register(lost.accessToken, lostToken);
    await register(here.accessToken, hereToken, 'android');

    expect((await call(here.accessToken, 'POST', `/me/sessions/${lost.sessionId}/revoke`)).status).toBe(200);

    expect((await row(lostToken)).isActive).toBe(false);
    expect((await row(hereToken)).isActive).toBe(true);
  });

  it('a refresh rotation is the same sign-in: the token follows the successor session and stays active', async () => {
    const parent = m.families[2]!.parent;
    const phone = await login(parent.subject, ios);
    const token = newToken();
    await register(phone.accessToken, token);

    const renewed = asLogin(await call(null, 'POST', '/auth/refresh', { refreshToken: phone.refreshToken }));
    expect(renewed.status).toBe(200);
    expect(renewed.sessionId).not.toBe(phone.sessionId);

    expect(await row(token)).toMatchObject({ sessionId: renewed.sessionId, isActive: true });

    // ...and signing the successor out still reaches it.
    expect((await call(renewed.accessToken, 'POST', '/auth/logout')).status).toBe(200);
    expect((await row(token)).isActive).toBe(false);
  });

  it('refresh-token reuse revokes every session, and every session\'s tokens go with them', async () => {
    const parent = m.families[2]!.parent;
    const phone = await login(parent.subject, ios);
    const tablet = await login(parent.subject, android);
    const phoneToken = newToken();
    const tabletToken = newToken();
    await register(phone.accessToken, phoneToken);
    await register(tablet.accessToken, tabletToken, 'android');

    const rotated = await call(null, 'POST', '/auth/refresh', { refreshToken: phone.refreshToken });
    expect(rotated.status).toBe(200);
    // The rotated token presented again: theft, so the whole account is signed out.
    expect((await call(null, 'POST', '/auth/refresh', { refreshToken: phone.refreshToken })).status).toBe(401);

    expect((await row(phoneToken)).isActive).toBe(false);
    expect((await row(tabletToken)).isActive).toBe(false);
  });

  it('a password change: the other sessions\' tokens are deactivated; this device\'s follows its renewed session', async () => {
    const parent = m.families[3]!.parent;
    const here = await login(parent.subject, ios);
    const elsewhere = await login(parent.subject, android);
    const hereToken = newToken();
    const elsewhereToken = newToken();
    await register(here.accessToken, hereToken);
    await register(elsewhere.accessToken, elsewhereToken, 'android');

    const changed = await call(here.accessToken, 'POST', '/auth/password/change', {
      currentPassword: PASSWORD,
      newPassword: 'lr46-http-spec-password-2',
    });
    expect(changed.status).toBe(200);
    const next = asLogin(changed);

    expect((await row(elsewhereToken)).isActive).toBe(false);
    expect(await row(hereToken)).toMatchObject({ sessionId: next.sessionId, isActive: true });
  });

  it('any revocation of the session row (administrator, suspension, tooling) deactivates its tokens', async () => {
    const parent = m.families[4]!.parent;
    const phone = await login(parent.subject, ios);
    const token = newToken();
    await register(phone.accessToken, token);

    await g.prisma.session.update({
      where: { id: phone.sessionId },
      data: { revokedAt: new Date(), revokedReason: 'lr46: revoked directly' },
    });

    expect((await row(token)).isActive).toBe(false);
  });
});

describe('LR-46 (b): a token cannot be taken from a live session', () => {
  it('another account registering a token whose owner\'s session is live is refused (409) and nothing moves', async () => {
    const owner = m.families[5]!.parent;
    const other = m.families[6]!.parent;
    const ownerLogin = await login(owner.subject, ios);
    const otherLogin = await login(other.subject, ios);
    const token = newToken();
    await register(ownerLogin.accessToken, token);

    const taken = await register(otherLogin.accessToken, token);
    expect(taken.status).toBe(409);
    expect(taken.code).toBe(CommErrorCode.DEVICE_TOKEN_IN_USE);

    expect(await row(token)).toMatchObject({ actorId: owner.id, sessionId: ownerLogin.sessionId, isActive: true });
  });

  it('after the owner signs out, another account on the same phone may register it', async () => {
    const owner = m.families[5]!.parent;
    const other = m.families[6]!.parent;
    const ownerLogin = await login(owner.subject, ios);
    const token = newToken();
    await register(ownerLogin.accessToken, token);
    expect((await call(ownerLogin.accessToken, 'POST', '/auth/logout')).status).toBe(200);

    const otherLogin = await login(other.subject, ios);
    expect((await register(otherLogin.accessToken, token)).status).toBe(201);
    expect(await row(token)).toMatchObject({ actorId: other.id, sessionId: otherLogin.sessionId, isActive: true });
  });

  it('the same account re-registering from a new session moves the token to that session', async () => {
    const owner = m.families[5]!.parent;
    const first = await login(owner.subject, ios);
    const second = await login(owner.subject, ios);
    const token = newToken();
    await register(first.accessToken, token);

    expect((await register(second.accessToken, token)).status).toBe(201);
    expect(await row(token)).toMatchObject({ actorId: owner.id, sessionId: second.sessionId, isActive: true });
  });

  it('a token row from before LR-46 (no session) keeps today\'s behaviour: it is rebindable', async () => {
    const owner = m.families[5]!.parent;
    const other = m.families[6]!.parent;
    const token = newToken();
    await g.prisma.deviceToken.create({ data: { organizationId: orgId, actorId: owner.id, token, platform: 'ios' } });

    const otherLogin = await login(other.subject, ios);
    expect((await register(otherLogin.accessToken, token)).status).toBe(201);
    expect(await row(token)).toMatchObject({ actorId: other.id, sessionId: otherLogin.sessionId, isActive: true });
  });
});
