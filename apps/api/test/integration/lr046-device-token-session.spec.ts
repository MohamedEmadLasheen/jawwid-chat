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
 *     behaviour: any account may rebind it;
 *   - (review of #537) a registration that passed authenticate() but whose
 *     session ends before it commits -- revoked, or rotated by a refresh --
 *     is refused (401) and binds nothing, whichever commits first; the
 *     session is locked before the token row;
 *   - (review of #537) a push is never sent to a token whose bound session is
 *     no longer live (revoked or expired); an unbound row is still pushed to.
 *
 * Synthetic people only (G-20).
 */
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import { PlatformModule } from '@platform/platform.module';
import { AuthModule } from '@platform/auth/auth.module';
import { AuthError, AuthErrorCode } from '@platform/auth/auth.errors';
import { hashPassword } from '@platform/auth/password';
import { CommErrorCode } from '@platform/errors';
import { PrismaService } from '@platform/prisma.service';
import { NotificationService } from '@communication/notifications/notification.service';
import type { PushProvider } from '@communication/notifications/push.provider';
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

// -- races (review of #537) ---------------------------------------------------
/** A second pool: a writer holding its own transaction on its own connection. */
const writer = new PrismaService();

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
async function waitUntil(cond: () => Promise<boolean>, what: string, withinMs = 10_000) {
  const end = Date.now() + withinMs;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}
const lockWaiters = async () =>
  Number((await g.prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`select count(*) as n from pg_locks where not granted`))[0]!.n);

/**
 * A revocation of `sessionId` written and NOT yet committed -- the moment a
 * sign-out (or a refresh's `revoke(..., 'rotated')`) holds the session row.
 * Its trigger has already run inside it, for a reason the trigger acts on.
 */
async function heldRevocation(sessionId: string, reason: string) {
  const written = deferred();
  const commit = deferred();
  const done = writer.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `update chat.session set revoked_at = now(), revoked_reason = $1 where id = $2::uuid and revoked_at is null`,
      reason,
      sessionId,
    );
    written.resolve();
    await commit.promise;
  }, { timeout: 20_000 });
  await written.promise;
  return { commit: async () => { commit.resolve(); await done; } };
}

/**
 * The registration exactly as the controller makes it, for a request whose
 * authenticate() has ALREADY passed on `sessionId`: what happens next is the
 * race. Resolves to the refusal's code, or 'ok'.
 */
function lateRegister(actorId: string, sessionId: string, token: string): Promise<string> {
  return g.notifications
    .registerDevice({ actorId, sessionId, token, platform: 'ios' })
    .then(() => 'ok')
    .catch((e: unknown) => (e instanceof AuthError ? e.code : `unexpected: ${String(e)}`));
}

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
  await writer.$disconnect();
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

/** Ends a session by expiry alone: no revocation, so no trigger fires. */
const expireSession = (sessionId: string) =>
  g.prisma.$executeRawUnsafe(
    `update chat.session
        set authenticated_at = now() - interval '2 hours', created_at = now() - interval '2 hours',
            expires_at = now() - interval '1 hour'
      where id = $1::uuid`,
    sessionId,
  );

describe('LR-46 (review of #537): a registration racing the end of its session binds nothing', () => {
  // The request's authenticate() has passed on the session; the session then
  // ends before the registration's transaction. Driven at the service, with
  // the session the guard verified, because over HTTP the guard would refuse
  // the request before it reached the race.

  it('revoked after authenticate(), before the registration: refused (401), no row written', async () => {
    const parent = m.families[7]!.parent;
    const phone = await login(parent.subject, ios);
    const token = newToken();
    await g.prisma.session.update({
      where: { id: phone.sessionId },
      data: { revokedAt: new Date(), revokedReason: 'lr46: revoked mid-request' },
    });

    expect(await lateRegister(parent.id, phone.sessionId, token)).toBe(AuthErrorCode.UNAUTHENTICATED);
    expect(await g.prisma.deviceToken.findUnique({ where: { token } })).toBeNull();
  });

  it('expired after authenticate(), before the registration: refused (401), no row written', async () => {
    const parent = m.families[7]!.parent;
    const phone = await login(parent.subject, ios);
    const token = newToken();
    await expireSession(phone.sessionId);

    expect(await lateRegister(parent.id, phone.sessionId, token)).toBe(AuthErrorCode.UNAUTHENTICATED);
    expect(await g.prisma.deviceToken.findUnique({ where: { token } })).toBeNull();
  });

  it('rotated by a refresh after authenticate(): refused; the token stays on the successor, and signing it out still reaches it', async () => {
    const parent = m.families[7]!.parent;
    const phone = await login(parent.subject, ios);
    const token = newToken();
    expect((await register(phone.accessToken, token)).status).toBe(201);

    // authenticate() on S1 ... the app's refresh rotates S1 -> S2 and moves the token ...
    const renewed = asLogin(await call(null, 'POST', '/auth/refresh', { refreshToken: phone.refreshToken }));
    expect(renewed.status).toBe(200);
    expect(await row(token)).toMatchObject({ sessionId: renewed.sessionId, isActive: true });

    // ... and only then does the registration on S1 run. It used to rebind the
    // token to S1, a 'rotated' session the trigger never fires for.
    expect(await lateRegister(parent.id, phone.sessionId, token)).toBe(AuthErrorCode.UNAUTHENTICATED);
    expect(await row(token)).toMatchObject({ actorId: parent.id, sessionId: renewed.sessionId, isActive: true });

    expect((await call(renewed.accessToken, 'POST', '/auth/logout')).status).toBe(200);
    expect((await row(token)).isActive).toBe(false);
  });

  it('a sign-out holding the session row when the registration starts: the registration waits on the SESSION, then is refused; the token stays deactivated', async () => {
    const parent = m.families[7]!.parent;
    const phone = await login(parent.subject, ios);
    const token = newToken();
    expect((await register(phone.accessToken, token)).status).toBe(201);

    // The revocation has written (its trigger already deactivated the token) but not committed.
    const held = await heldRevocation(phone.sessionId, 'lr46: raced sign-out');
    const outcome = lateRegister(parent.id, phone.sessionId, token);
    await waitUntil(async () => (await lockWaiters()) > 0, 'the registration is blocked on the session row');
    await held.commit();

    // Before the fix the registration waited on the token row instead and,
    // once the revocation committed, set is_active = true on a revoked session.
    expect(await outcome).toBe(AuthErrorCode.UNAUTHENTICATED);
    expect(await row(token)).toMatchObject({ sessionId: phone.sessionId, isActive: false });
  });

  it('a refresh rotation holding the session row when the registration starts: refused, so nothing is bound to the rotated session', async () => {
    const parent = m.families[7]!.parent;
    const phone = await login(parent.subject, ios);
    const token = newToken();

    // 'rotated': the reason the trigger deliberately skips. Without the lock
    // the registration would not even wait, and would bind an active token
    // to a session that has ended.
    const held = await heldRevocation(phone.sessionId, 'rotated');
    const outcome = lateRegister(parent.id, phone.sessionId, token);
    await waitUntil(async () => (await lockWaiters()) > 0, 'the registration is blocked on the session row');
    await held.commit();

    expect(await outcome).toBe(AuthErrorCode.UNAUTHENTICATED);
    expect(await g.prisma.deviceToken.findUnique({ where: { token } })).toBeNull();
  });

  // The other order -- the registration commits first, the revocation after --
  // is the ordinary case: the revocation's trigger reaches the committed row
  // ("signing out deactivates that session's tokens", above).
});

describe('LR-46 (review of #537): a push is sent only to tokens whose session is live', () => {
  const sent: string[] = [];
  const push = {
    send: async (msg: { token: string }) => {
      sent.push(msg.token);
      return { ok: true };
    },
  } as unknown as PushProvider;
  let notifications: NotificationService;

  beforeAll(() => {
    notifications = new NotificationService(g.prisma, g.templates, g.quietHours, g.config, push);
  });

  it('skips a token bound to an expired or a revoked session; a live one and an unbound (pre-LR-46) one are pushed to', async () => {
    const parent = m.families[8]!.parent;
    const live = await login(parent.subject, ios);
    const expired = await login(parent.subject, ios);
    const stranded = await login(parent.subject, android);
    const liveToken = newToken();
    const expiredToken = newToken();
    const strandedToken = newToken();
    const unboundToken = newToken();
    expect((await register(live.accessToken, liveToken)).status).toBe(201);
    expect((await register(expired.accessToken, expiredToken)).status).toBe(201);
    expect((await register(stranded.accessToken, strandedToken, 'android')).status).toBe(201);
    await g.prisma.deviceToken.create({ data: { organizationId: orgId, actorId: parent.id, token: unboundToken, platform: 'ios' } });

    // Expired without ever being revoked: no trigger fires, the row stays active.
    await expireSession(expired.sessionId);
    // Revoked for a reason the trigger skips, with no successor to move to (a
    // rotation whose issue() then failed): the row stays active too.
    await g.prisma.session.update({
      where: { id: stranded.sessionId },
      data: { revokedAt: new Date(), revokedReason: 'rotated' },
    });
    expect((await row(expiredToken)).isActive).toBe(true);
    expect((await row(strandedToken)).isActive).toBe(true);

    sent.length = 0;
    await notifications.schedule({
      dedupeKey: `lr46:${randomUUID()}:${parent.id}`,
      templateKey: 'lesson_reminder_soon',
      eventType: 'lesson_scheduled',
      recipientId: parent.id,
      locale: 'en',
      variables: { startsAt: new Date('2026-12-10T15:00:00Z').toISOString() },
      scheduledAt: new Date(Date.now() - 1000),
      respectQuietHours: false,
    });
    await notifications.dispatchDue(new Date());

    const mine = new Set([liveToken, expiredToken, strandedToken, unboundToken]);
    expect(sent.filter((t) => mine.has(t)).sort()).toEqual([liveToken, unboundToken].sort());
  });
});
