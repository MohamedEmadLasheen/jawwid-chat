/**
 * PD-21 impersonation ("support sessions") over real HTTP: real logins, the
 * global bearer guard, the real routes, the real database rules.
 *
 *   - the super admin and Operations open a parent's account, the super admin
 *     and the Teachers department a teacher's (PD-40); never a staff account;
 *   - on the support token the administrator IS the person for reads, may
 *     send a message -- labelled "sent by support" to every reader -- and may
 *     change the person's own profile; everything else that would act in the
 *     person's name (receipts, calls, devices, logout, ...) is refused;
 *   - every request is recorded, every audit row and message is stamped;
 *   - the support session dies on Exit, with the administrator's own session,
 *     and with the administrator's account;
 *   - it has no refresh token, and only its administrator may re-token it.
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
import { ScheduledCallModule } from '../../src/scheduled-calls/scheduled-call.module';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const PASSWORD = 'pd21-imp-spec-password-1';
const DOMAIN = 'pd21imp.qa.jawwid.test';

const g = buildGraph();
let app: INestApplication;
let base: string;
let m: SeedManifest;
let orgId: string;

async function login(subject: string) {
  const r = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: subject, password: PASSWORD }),
  });
  const json = (await r.json()) as { accessToken: string; refreshToken: string };
  if (r.status !== 200) throw new Error(`login ${subject}: ${r.status}`);
  return json;
}

async function call(token: string | null, method: string, path: string, body?: unknown) {
  const send = body !== undefined && method !== 'GET';
  const headers: Record<string, string> = send ? { 'content-type': 'application/json' } : {};
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(`${base}${path}`, { method, headers, body: send ? JSON.stringify(body) : undefined });
  const json = (await r.json().catch(() => ({}))) as { error?: { code?: string } } & Record<string, any>;
  return { status: r.status, code: json.error?.code, json };
}

/**
 * ADMIN-002: an Operations member administers only the parent accounts of the
 * families they reach -- a family with a child they supervise (or an active
 * backup's). Fails loudly if the seed's plan ever moves the family away.
 */
function familyReachedBy(staff: { id: string }, index: number, via?: { id: string }): SeedManifest['families'][number] {
  const family = m.families[index]!;
  const supervisorId = (via ?? staff).id;
  if (!family.children.some((c) => c.supervisorId === supervisorId)) {
    throw new Error(`seed family ${index} has no child supervised by ${supervisorId}`);
  }
  return family;
}

const accountIdOf = async (subject: string) =>
  (await g.prisma.account.findUniqueOrThrow({ where: { subject }, select: { id: true } })).id;

async function start(adminToken: string, subject: string, reason = 'parent cannot find the lesson card') {
  return call(adminToken, 'POST', '/admin/impersonations', { accountId: await accountIdOf(subject), reason });
}

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd21i-%'`);

  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd21i-${orgId.slice(0, 8)}', 'PD-21 impersonation QA academy')`,
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
    imports: [PlatformModule, AuthModule, CommunicationModule, AccountAdminModule, ScheduledCallModule],
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
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd21i-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
});

describe('PD-21: who may open a support session', () => {
  it('every route is behind the bearer guard', async () => {
    for (const [method, path] of [
      ['POST', '/admin/impersonations'],
      ['GET', '/admin/impersonations'],
      ['POST', `/admin/impersonations/${randomUUID()}/token`],
      ['POST', `/admin/impersonations/${randomUUID()}/end`],
      ['GET', `/admin/impersonations/${randomUUID()}/actions`],
    ] as const) {
      expect((await call(null, method, path, {})).status).toBe(401);
    }
  });

  it('a parent and a teacher open nobody\'s account', async () => {
    for (const subject of [m.families[0]!.parent.subject, m.teachers[0]!.subject]) {
      const token = (await login(subject)).accessToken;
      const r = await start(token, m.families[1]!.parent.subject);
      expect({ status: r.status, code: r.code }).toEqual({ status: 403, code: CommErrorCode.ACCOUNT_ADMIN_DENIED });
    }
  });

  it('PD-40: only the department that administers the account opens it', async () => {
    const parent = m.families[1]!.parent.subject;
    const teacherSubject = m.teachers[1]!.subject;
    for (const [who, subject] of [
      ['Sales manager on a parent', m.salesManager.subject],
      ['Teachers manager on a parent', m.teachersManager.subject],
      ['Teachers supervisor on a parent', m.teacherSupervisors[0]!.subject],
    ] as const) {
      const r = await start((await login(subject)).accessToken, parent);
      expect({ who, status: r.status, code: r.code }).toEqual({ who, status: 403, code: CommErrorCode.ACCOUNT_ADMIN_DENIED });
    }
    for (const [who, subject] of [
      ['Operations manager on a teacher', m.operationsManager.subject],
      ['Operations supervisor on a teacher', m.supervisors[0]!.subject],
    ] as const) {
      const r = await start((await login(subject)).accessToken, teacherSubject);
      expect({ who, status: r.status, code: r.code }).toEqual({ who, status: 403, code: CommErrorCode.ACCOUNT_ADMIN_DENIED });
    }
    expect(await g.prisma.impersonationSession.count({ where: { organizationId: orgId } })).toBe(0);
  });

  it('a staff account is never opened -- not even by the super admin; a suspended one cannot be', async () => {
    const owner = (await login(m.superAdmin.subject)).accessToken;
    const r = await start(owner, m.supervisors[0]!.subject);
    expect({ status: r.status, code: r.code }).toEqual({ status: 403, code: CommErrorCode.ACCOUNT_ADMIN_DENIED });

    const parent = m.families[6]!.parent.subject;
    await g.prisma.$queryRaw`select chat.deactivate_principal('account', ${await accountIdOf(parent)}::uuid, 'test', null, 'suspended')::text`;
    const s = await start(owner, parent);
    expect({ status: s.status, code: s.code }).toEqual({ status: 409, code: CommErrorCode.ACCOUNT_ADMIN_STATE });
    expect(await g.prisma.impersonationSession.count({ where: { organizationId: orgId } })).toBe(0);
  });
});

describe('PD-21: acting as the person', () => {
  it('reads as the parent, sends a LABELLED message, and records everything', async () => {
    const admin = (await login(m.supervisors[0]!.subject)).accessToken;
    const family = m.families[0]!;
    const opened = await start(admin, family.parent.subject);
    expect(opened.status).toBe(201);
    expect(opened.json).not.toHaveProperty('refreshToken');
    const support = opened.json.accessToken as string;
    const impersonationId = opened.json.session.id as string;
    expect(opened.json.session).toMatchObject({ target: { kind: 'family', actorId: family.parent.id }, staff: { id: m.supervisors[0]!.id } });

    // Reads as the parent.
    const me = await call(support, 'GET', '/me');
    expect(me.json).toMatchObject({ actorId: family.parent.id, kind: 'contact' });
    const list = await call(support, 'GET', '/conversations');
    expect(list.status).toBe(200);
    const conversationId = family.directs[0]?.conversationId ?? (list.json.conversations as Array<{ id: string }>)[0]!.id;

    // Reading sends no receipt.
    const receiptsBefore = await g.prisma.messageReceipt.count();
    expect((await call(support, 'GET', `/conversations/${conversationId}/messages`)).status).toBe(200);
    expect(await g.prisma.messageReceipt.count()).toBe(receiptsBefore);

    // Sends -- labelled.
    const sent = await call(support, 'POST', `/conversations/${conversationId}/messages`, {
      type: 'text', body: 'Sent for the parent by support', visibility: 'customer', clientMessageId: randomUUID(),
    });
    expect(sent.status).toBe(201);
    expect(sent.json).toMatchObject({ authorId: family.parent.id, sentBySupport: true });
    const row = await g.prisma.message.findUniqueOrThrow({ where: { id: sent.json.id as string } });
    expect(row.impersonationId).toBe(impersonationId);

    // Every other reader sees the label too.
    const ownerToken = (await login(m.superAdmin.subject)).accessToken;
    const seen = await call(ownerToken, 'GET', `/conversations/${conversationId}/messages`);
    const copy = (seen.json.messages as Array<{ id: string; sentBySupport: boolean }>).find((x) => x.id === sent.json.id);
    expect(copy?.sentBySupport).toBe(true);

    // The parent's own message is not labelled.
    const own = await call((await login(family.parent.subject)).accessToken, 'POST', `/conversations/${conversationId}/messages`, {
      type: 'text', body: 'My own words', visibility: 'customer', clientMessageId: randomUUID(),
    });
    expect(own.json.sentBySupport).toBe(false);

    // A profile change is the person's, stamped with the support session.
    const renamed = await call(support, 'PATCH', '/me/profile', { about: 'Prefers Arabic' });
    expect(renamed.status).toBe(200);
    const stamped = await g.prisma.auditLog.findMany({ where: { impersonationId, NOT: { action: { startsWith: 'impersonation.' } } } });
    expect(stamped.length).toBeGreaterThan(0);

    // The trail: every request, refusals included, never a body.
    await call(support, 'POST', '/calls', { conversationId });
    const trail = await call(admin, 'GET', `/admin/impersonations/${impersonationId}/actions`);
    const actions = trail.json.actions as Array<{ method: string; route: string; status: number }>;
    expect(actions).toEqual(
      expect.arrayContaining([
        { method: 'GET', route: '/me', status: 200, at: expect.any(String) },
        { method: 'POST', route: '/conversations/:conversationId/messages', status: 201, at: expect.any(String) },
        { method: 'PATCH', route: '/me/profile', status: 200, at: expect.any(String) },
        { method: 'POST', route: '/calls', status: 403, at: expect.any(String) },
      ]),
    );
    expect(JSON.stringify(actions)).not.toContain('Sent for the parent by support');
    expect(await g.prisma.auditLog.count({ where: { action: 'impersonation.started', entityId: await accountIdOf(family.parent.subject), actorId: m.supervisors[0]!.id } })).toBe(1);

    await call(admin, 'POST', `/admin/impersonations/${impersonationId}/end`);
  });

  it('refuses whatever would act in the person\'s name where others see it', async () => {
    const admin = (await login(m.operationsManager.subject)).accessToken;
    const family = m.families[1]!;
    const opened = await start(admin, family.parent.subject);
    const support = opened.json.accessToken as string;
    const conversationId = (await call(support, 'GET', '/conversations')).json.conversations[0].id as string;
    const messages = (await call(support, 'GET', `/conversations/${conversationId}/messages`)).json.messages as Array<{ id: string }>;
    const messageId = messages[0]?.id ?? randomUUID();

    for (const [method, path, body] of [
      ['POST', `/conversations/${conversationId}/messages/read`, { upToSeq: '1' }],
      ['POST', `/conversations/${conversationId}/messages/${messageId}/delivered`, {}],
      ['POST', `/conversations/${conversationId}/messages/${messageId}/reactions`, { emoji: '👍' }],
      ['POST', `/conversations/${conversationId}/messages/${messageId}/pin`, {}],
      ['PATCH', `/conversations/${conversationId}/messages/${messageId}`, { body: 'x' }],
      ['DELETE', `/conversations/${conversationId}/messages/${messageId}`, { reason: 'x' }],
      ['POST', `/conversations/${conversationId}/messages/forward`, { messageIds: [messageId], toConversationIds: [conversationId] }],
      ['POST', '/calls', { conversationId }],
      ['POST', '/scheduled-calls', { conversationId }],
      ['POST', '/notifications/devices', { token: 'x', platform: 'ios' }],
      ['POST', `/stories/${randomUUID()}/view`, {}],
      ['POST', '/conversations/direct', { withActorId: randomUUID() }],
      ['POST', '/auth/logout', {}],
    ] as const) {
      const r = await call(support, method, path, body);
      expect({ method, path, status: r.status, code: r.code }).toEqual({
        method, path, status: 403, code: CommErrorCode.SUPPORT_SESSION_FORBIDDEN,
      });
    }
    // The support session is still alive after all that.
    expect((await call(support, 'GET', '/me')).status).toBe(200);
    // And the administrator surfaces are closed to it: its actor is the parent.
    const r = await call(support, 'GET', '/admin/accounts');
    expect(r.code).toBe(CommErrorCode.ACCOUNT_ADMIN_DENIED);
    await call(admin, 'POST', `/admin/impersonations/${opened.json.session.id}/end`);
  });

  it('a teacher account opens too', async () => {
    const admin = (await login(m.teachersManager.subject)).accessToken;
    const teacher = m.teachers[0]!;
    const opened = await start(admin, teacher.subject, 'teacher cannot see their certificates');
    expect(opened.status).toBe(201);
    const me = await call(opened.json.accessToken as string, 'GET', '/me');
    expect(me.json).toMatchObject({ actorId: teacher.id, kind: 'teacher' });
    await call(admin, 'POST', `/admin/impersonations/${opened.json.session.id}/end`);
  });
});

describe('PD-21: a support session ends', () => {
  it('on Exit: its token is refused at once, the record says how, and Exit is idempotent', async () => {
    const admin = (await login(m.supervisors[1]!.subject)).accessToken;
    const opened = await start(admin, familyReachedBy(m.supervisors[1]!, 13).parent.subject);
    const support = opened.json.accessToken as string;
    expect((await call(support, 'GET', '/me')).status).toBe(200);

    const ended = await call(admin, 'POST', `/admin/impersonations/${opened.json.session.id}/end`);
    expect(ended.status).toBe(200);
    expect(ended.json).toMatchObject({ endedReason: 'ended by the administrator' });
    expect(ended.json.endedAt).toEqual(expect.any(String));
    expect((await call(support, 'GET', '/me')).status).toBe(401);
    expect((await call(admin, 'POST', `/admin/impersonations/${opened.json.session.id}/end`)).status).toBe(200);
    expect(await g.prisma.auditLog.count({ where: { action: 'impersonation.ended', impersonationId: opened.json.session.id as string } })).toBe(1);
    // And it cannot be re-tokened.
    const again = await call(admin, 'POST', `/admin/impersonations/${opened.json.session.id}/token`);
    expect(again.code).toBe(CommErrorCode.IMPERSONATION_ENDED);
  });

  it('NOT when the administrator\'s own token is refreshed: it follows the rotated session', async () => {
    const adminLogin = await login(m.supervisors[1]!.subject);
    const opened = await start(adminLogin.accessToken, familyReachedBy(m.supervisors[1]!, 17).parent.subject);
    const support = opened.json.accessToken as string;
    const refreshed = await call(null, 'POST', '/auth/refresh', { refreshToken: adminLogin.refreshToken });
    expect(refreshed.status).toBe(200);
    expect((await call(support, 'GET', '/me')).status).toBe(200);
    const row = await g.prisma.impersonationSession.findUniqueOrThrow({ where: { id: opened.json.session.id as string } });
    expect(row.endedAt).toBeNull();
    expect(row.staffSessionId).toBe(refreshed.json.session.id);
    // And the refreshed administrator still ends it.
    expect((await call(refreshed.json.accessToken as string, 'POST', `/admin/impersonations/${opened.json.session.id}/end`)).status).toBe(200);
    expect((await call(support, 'GET', '/me')).status).toBe(401);
  });

  it('with the administrator\'s own session: signing out ends it', async () => {
    const adminLogin = await login(m.supervisors[2]!.subject);
    const opened = await start(adminLogin.accessToken, familyReachedBy(m.supervisors[2]!, 10).parent.subject);
    const support = opened.json.accessToken as string;
    expect((await call(support, 'GET', '/me')).status).toBe(200);
    expect((await call(adminLogin.accessToken, 'POST', '/auth/logout', {})).status).toBe(200);
    expect((await call(support, 'GET', '/me')).status).toBe(401);
  });

  it('with the administrator\'s account: suspending them ends it', async () => {
    const supervisor = m.supervisors[3] ?? m.supervisors[0]!;
    const adminLogin = await login(supervisor.subject);
    const opened = await start(adminLogin.accessToken, familyReachedBy(supervisor, 19).parent.subject);
    const support = opened.json.accessToken as string;
    expect((await call(support, 'GET', '/me')).status).toBe(200);
    const owner = (await login(m.superAdmin.subject)).accessToken;
    expect((await call(owner, 'POST', `/admin/accounts/${await accountIdOf(supervisor.subject)}/suspend`, { reason: 'test' })).status).toBe(200);
    expect((await call(support, 'GET', '/me')).status).toBe(401);
    await call(owner, 'POST', `/admin/accounts/${await accountIdOf(supervisor.subject)}/reactivate`, { reason: 'test' });
  });

  it('when another one starts (one per administrator); only its administrator may re-token it; it has no refresh token', async () => {
    // The seed's one active backup arrangement: backups[1] stands in for supervisors[2].
    const adminA = (await login(m.backups[1]!.subject)).accessToken;
    const first = await start(adminA, familyReachedBy(m.backups[1]!, 14, m.supervisors[2]!).parent.subject);
    const second = await start(adminA, familyReachedBy(m.backups[1]!, 18, m.supervisors[2]!).parent.subject);
    expect((await call(first.json.accessToken as string, 'GET', '/me')).status).toBe(401);
    expect((await call(second.json.accessToken as string, 'GET', '/me')).status).toBe(200);
    const firstRow = await g.prisma.impersonationSession.findUniqueOrThrow({ where: { id: first.json.session.id as string } });
    expect(firstRow.endedReason).toBe('superseded by a new support session');

    // Someone else's support session is not found.
    const adminB = (await login(m.operationsManager.subject)).accessToken;
    expect((await call(adminB, 'POST', `/admin/impersonations/${second.json.session.id}/token`)).code).toBe(CommErrorCode.IMPERSONATION_NOT_FOUND);
    expect((await call(adminB, 'POST', `/admin/impersonations/${second.json.session.id}/end`)).code).toBe(CommErrorCode.IMPERSONATION_NOT_FOUND);

    // Re-tokening extends it, never past the hour.
    const again = await call(adminA, 'POST', `/admin/impersonations/${second.json.session.id}/token`);
    expect(again.status).toBe(200);
    expect(new Date(again.json.session.expiresAt).getTime()).toBeLessThanOrEqual(new Date(again.json.session.endsAtLatest).getTime());

    // The support session's chat.session row cannot be refreshed: its token was never issued.
    const row = await g.prisma.session.findFirstOrThrow({ where: { impersonationId: second.json.session.id as string } });
    expect(row.impersonationId).toBe(second.json.session.id);
    await call(adminA, 'POST', `/admin/impersonations/${second.json.session.id}/end`);
  });

  it('the database refuses a support session the API would refuse', async () => {
    const staff = m.supervisors[0]!;
    const staffAccount = await accountIdOf(staff.subject);
    const session = await g.prisma.session.create({
      data: { organizationId: orgId, accountId: staffAccount, refreshTokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
    });
    const insert = (over: Record<string, unknown>) =>
      g.prisma.impersonationSession.create({
        data: {
          organizationId: orgId,
          staffId: staff.id,
          staffAccountId: staffAccount,
          staffSessionId: session.id,
          targetAccountId: staffAccount,
          targetKind: 'family',
          reason: 'direct',
          expiresAt: new Date(Date.now() + 10 * 60_000),
          ...over,
        } as never,
      });
    // A staff account as target.
    await expect(insert({ targetAccountId: await accountIdOf(m.supervisors[1]!.subject) })).rejects.toThrow();
    // Longer than an hour.
    await expect(insert({ targetAccountId: await accountIdOf(m.families[0]!.parent.subject), expiresAt: new Date(Date.now() + 2 * 3_600_000) })).rejects.toThrow(/at most an hour/);
    const ok = await insert({ targetAccountId: await accountIdOf(m.families[0]!.parent.subject) });
    await expect(g.prisma.impersonationSession.delete({ where: { id: ok.id } })).rejects.toThrow(/never deleted/);
    await expect(g.prisma.impersonationSession.update({ where: { id: ok.id }, data: { reason: 'rewritten' } })).rejects.toThrow(/identity never changes/);
  });

  it('the record: the super admin sees every support session; a staff member only their own', async () => {
    const owner = (await login(m.superAdmin.subject)).accessToken;
    const all = await call(owner, 'GET', '/admin/impersonations');
    const allIds = (all.json.sessions as Array<{ staff: { id: string } }>).map((s) => s.staff.id);
    expect(new Set(allIds).size).toBeGreaterThan(1);

    const mine = await call((await login(m.supervisors[0]!.subject)).accessToken, 'GET', '/admin/impersonations');
    expect((mine.json.sessions as Array<{ staff: { id: string } }>).every((s) => s.staff.id === m.supervisors[0]!.id)).toBe(true);
  });
});
