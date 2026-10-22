/**
 * PD-20 over real HTTP: real logins, the global bearer guard, the real routes,
 * the real database rules.
 *
 *   - password reset: the administrator gets a one-time code and never a
 *     password; the person sets their own; every old session dies with it;
 *   - suspend: the next request is refused and login says ACCOUNT_DISABLED;
 *   - reactivate: login works again, and NO old session or refresh token
 *     comes back to life;
 *   - who may: any staff role for parents and teachers; staff only by the super
 *     admin; never the super admin or oneself; parents and teachers never;
 *   - every action leaves its audit row, with the administrator and the reason.
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
import { AuthErrorCode } from '@platform/auth/auth.errors';
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
const PASSWORD = 'pd20-http-spec-password-1';
const NEW_PASSWORD = 'pd20-chosen-by-the-person-2';
const DOMAIN = 'pd20http.qa.jawwid.test';

const g = buildGraph();
let app: INestApplication;
let base: string;
let m: SeedManifest;
let orgId: string;

/** A fresh login every time: these tests revoke sessions on purpose. */
async function login(subject: string, password = PASSWORD) {
  const r = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: subject, password }),
  });
  const json = (await r.json().catch(() => ({}))) as { accessToken?: string; refreshToken?: string; error?: { code?: string } };
  return { status: r.status, code: json.error?.code, accessToken: json.accessToken ?? '', refreshToken: json.refreshToken ?? '' };
}

const staffTokens = new Map<string, string>();
async function staffToken(subject: string): Promise<string> {
  if (!staffTokens.has(subject)) staffTokens.set(subject, (await app.get(AuthService).login(subject, PASSWORD)).accessToken);
  return staffTokens.get(subject)!;
}

async function call(token: string | null, method: string, path: string, body?: unknown) {
  const send = body !== undefined && method !== 'GET';
  const headers: Record<string, string> = send ? { 'content-type': 'application/json' } : {};
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(`${base}${path}`, { method, headers, body: send ? JSON.stringify(body) : undefined });
  const json = (await r.json().catch(() => ({}))) as { error?: { code?: string } } & Record<string, unknown>;
  return { status: r.status, code: json.error?.code, json };
}
const as = async (subject: string, method: string, path: string, body?: unknown) =>
  call(await staffToken(subject), method, path, body);

async function accountIdOf(subject: string): Promise<string> {
  return (await g.prisma.account.findUniqueOrThrow({ where: { subject }, select: { id: true } })).id;
}

async function audits(entityId: string, action: string) {
  return g.prisma.auditLog.findMany({ where: { entity: 'account', entityId, action }, orderBy: { id: 'asc' } });
}

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd20h-%'`);

  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd20h-${orgId.slice(0, 8)}', 'PD-20 HTTP QA academy')`,
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
  // chat.staff truncates CASCADE, which takes chat.password_reset_code with it.
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd20h-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
});

describe('PD-20: who may', () => {
  it('every route is behind the bearer guard', async () => {
    const id = await accountIdOf(m.families[0]!.parent.subject);
    for (const [method, path] of [
      ['GET', '/admin/accounts'],
      ['GET', `/admin/accounts/${id}`],
      ['POST', `/admin/accounts/${id}/password-reset`],
      ['POST', `/admin/accounts/${id}/suspend`],
      ['POST', `/admin/accounts/${id}/reactivate`],
    ] as const) {
      expect((await call(null, method, path, { reason: 'x' })).status).toBe(401);
    }
  });

  it('a parent and a teacher reach no route, whatever account they name', async () => {
    const parent = m.families[0]!.parent;
    const teacher = m.teachers[0]!;
    const other = await accountIdOf(m.families[1]!.parent.subject);
    for (const subject of [parent.subject, teacher.subject]) {
      const token = (await login(subject)).accessToken;
      for (const [method, path] of [
        ['GET', '/admin/accounts'],
        ['GET', `/admin/accounts/${other}`],
        ['POST', `/admin/accounts/${other}/password-reset`],
        ['POST', `/admin/accounts/${other}/suspend`],
        ['POST', `/admin/accounts/${other}/reactivate`],
      ] as const) {
        const r = await call(token, method, path, { reason: 'probing' });
        expect({ subject, path, status: r.status, code: r.code }).toEqual({ subject, path, status: 403, code: CommErrorCode.ACCOUNT_ADMIN_DENIED });
      }
    }
    expect(await g.prisma.passwordResetCode.count({ where: { organizationId: orgId } })).toBe(0);
  });

  it('an ordinary staff member lists parents and teachers -- never staff, never the super admin -- and finds a family by a child\'s name', async () => {
    const supervisor = m.supervisors[0]!;
    const all = await as(supervisor.subject, 'GET', '/admin/accounts');
    expect(all.status).toBe(200);
    const accounts = all.json.accounts as Array<{ kind: string; name: string; children: string[]; allowed: Record<string, boolean> }>;
    expect(accounts.length).toBeGreaterThan(0);
    expect(new Set(accounts.map((a) => a.kind))).toEqual(new Set(['family', 'teacher']));
    expect(JSON.stringify(all.json)).not.toMatch(/@|passwordHash|password_hash|codeHash|"subject"/i);
    for (const a of accounts) expect(a.allowed).toEqual({ resetPassword: true, suspend: true, reactivate: false });

    const child = m.families[2]!.children[0]!;
    const found = await as(supervisor.subject, 'GET', `/admin/accounts?q=${encodeURIComponent(child.name)}`);
    const hits = found.json.accounts as Array<{ kind: string; children: string[] }>;
    expect(hits.some((a) => a.kind === 'family' && a.children.includes(child.name))).toBe(true);

    // Asking for staff is not a way round it.
    const staff = await as(supervisor.subject, 'GET', '/admin/accounts?kind=staff');
    expect((staff.json.accounts as Array<{ kind: string }>).every((a) => a.kind !== 'staff')).toBe(true);
  });

  it('the super admin also lists staff -- but not their own account', async () => {
    const r = await as(m.superAdmin.subject, 'GET', '/admin/accounts?kind=staff');
    const accounts = r.json.accounts as Array<{ kind: string; staffRole: string }>;
    expect(accounts.length).toBeGreaterThan(0);
    expect(accounts.every((a) => a.kind === 'staff' && a.staffRole !== 'super_admin')).toBe(true);
  });

  it('only the super admin acts on a staff account; nobody on the super admin\'s or their own', async () => {
    const supervisorAccount = await accountIdOf(m.supervisors[1]!.subject);
    const ownerAccount = await accountIdOf(m.superAdmin.subject);
    const managerAccount = await accountIdOf(m.operationsManager.subject);

    for (const subject of [m.operationsManager.subject, m.salesManager.subject, m.supervisors[0]!.subject]) {
      const r = await as(subject, 'POST', `/admin/accounts/${supervisorAccount}/password-reset`, { reason: 'try' });
      expect({ subject, status: r.status, code: r.code }).toEqual({ subject, status: 403, code: CommErrorCode.ACCOUNT_ADMIN_DENIED });
      const s = await as(subject, 'POST', `/admin/accounts/${ownerAccount}/suspend`, { reason: 'try' });
      expect(s.status).toBe(403);
    }
    const self = await as(m.operationsManager.subject, 'POST', `/admin/accounts/${managerAccount}/suspend`, { reason: 'me' });
    expect(self.status).toBe(403);
    const owner = await as(m.superAdmin.subject, 'POST', `/admin/accounts/${ownerAccount}/password-reset`, { reason: 'me' });
    expect({ status: owner.status, code: owner.code }).toEqual({ status: 403, code: CommErrorCode.ACCOUNT_ADMIN_DENIED });

    const allowed = await as(m.superAdmin.subject, 'POST', `/admin/accounts/${supervisorAccount}/password-reset`, { reason: 'forgot it' });
    expect(allowed.status).toBe(201);
  });

  it('an unknown or malformed id is 404, a missing reason 400', async () => {
    const supervisor = m.supervisors[0]!.subject;
    expect((await as(supervisor, 'POST', `/admin/accounts/${randomUUID()}/suspend`, { reason: 'x' })).code).toBe(CommErrorCode.ACCOUNT_ADMIN_NOT_FOUND);
    expect((await as(supervisor, 'POST', '/admin/accounts/not-a-uuid/suspend', { reason: 'x' })).status).toBe(404);
    const id = await accountIdOf(m.families[0]!.parent.subject);
    expect((await as(supervisor, 'POST', `/admin/accounts/${id}/suspend`, {})).status).toBe(400);
    expect((await as(supervisor, 'POST', `/admin/accounts/${id}/password-reset`, { reason: '   ' })).status).toBe(400);
  });
});

describe('PD-20: password reset', () => {
  it('the administrator gets a code, never a password; the person sets their own; every old session ends', async () => {
    const parent = m.families[3]!.parent;
    const accountId = await accountIdOf(parent.subject);
    const before = await login(parent.subject);
    expect(before.status).toBe(200);

    const issued = await as(m.supervisors[0]!.subject, 'POST', `/admin/accounts/${accountId}/password-reset`, { reason: 'parent forgot the password' });
    expect(issued.status).toBe(201);
    const code = issued.json.code as string;
    expect(code).toMatch(/^[0-9]{6}$/);
    expect(Object.keys(issued.json).sort()).toEqual(['code', 'expiresAt', 'expiresInMinutes', 'signedOutSessions']);

    // Only the hash is stored; the plain code is nowhere in the row.
    const row = await g.prisma.passwordResetCode.findFirstOrThrow({ where: { accountId, usedAt: null, supersededAt: null } });
    expect(JSON.stringify(row)).not.toContain(code);
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);

    // Until the person finishes, the old password and session still work.
    expect((await call(before.accessToken, 'GET', '/me')).status).toBe(200);

    const done = await call(null, 'POST', '/auth/password-reset', { username: parent.subject, code, password: NEW_PASSWORD });
    expect(done.status).toBe(200);

    expect((await call(before.accessToken, 'GET', '/me')).status).toBe(401);
    const refresh = await call(null, 'POST', '/auth/refresh', { refreshToken: before.refreshToken });
    expect(refresh.status).toBe(401);
    expect((await login(parent.subject)).code).toBe(AuthErrorCode.INVALID_CREDENTIALS);
    expect((await login(parent.subject, NEW_PASSWORD)).status).toBe(200);

    // Spent: the same code never works twice.
    const again = await call(null, 'POST', '/auth/password-reset', { username: parent.subject, code, password: 'another-password-3' });
    expect({ status: again.status, code: again.code }).toEqual({ status: 401, code: AuthErrorCode.RESET_CODE_INVALID });

    const issuedAudit = await audits(accountId, 'account.password_reset_issued');
    expect(issuedAudit).toHaveLength(1);
    expect(issuedAudit[0]).toMatchObject({ actorId: m.supervisors[0]!.id, reason: 'parent forgot the password' });
    expect(JSON.stringify({ before: issuedAudit[0]!.before, after: issuedAudit[0]!.after, reason: issuedAudit[0]!.reason })).not.toContain(code);
    const completed = await audits(accountId, 'account.password_reset_completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]!.after).toMatchObject({ issuedBy: m.supervisors[0]!.id });
  });

  it('a wrong, unknown or expired code is one answer; five wrong tries spend the code', async () => {
    const teacher = m.teachers[1]!;
    const accountId = await accountIdOf(teacher.subject);
    const issued = await as(m.teachersManager.subject, 'POST', `/admin/accounts/${accountId}/password-reset`, { reason: 'locked out' });
    const code = issued.json.code as string;
    const wrong = code === '000000' ? '111111' : '000000';

    const unknown = await call(null, 'POST', '/auth/password-reset', { username: `nobody@${DOMAIN}`, code, password: NEW_PASSWORD });
    expect({ status: unknown.status, code: unknown.code }).toEqual({ status: 401, code: AuthErrorCode.RESET_CODE_INVALID });

    for (let i = 0; i < 5; i++) {
      const r = await call(null, 'POST', '/auth/password-reset', { username: teacher.subject, code: wrong, password: NEW_PASSWORD });
      expect(r.code).toBe(AuthErrorCode.RESET_CODE_INVALID);
    }
    // The right code no longer helps: it was spent by the fifth miss.
    const late = await call(null, 'POST', '/auth/password-reset', { username: teacher.subject, code, password: NEW_PASSWORD });
    expect(late.code).toBe(AuthErrorCode.RESET_CODE_INVALID);
    expect((await login(teacher.subject)).status).toBe(200);

    // An expired code is refused the same way.
    const fresh = await as(m.teachersManager.subject, 'POST', `/admin/accounts/${accountId}/password-reset`, { reason: 'again' });
    await g.prisma.$executeRawUnsafe(`alter table chat.password_reset_code disable trigger password_reset_code_is_coherent`);
    await g.prisma.$executeRawUnsafe(
      `update chat.password_reset_code set created_at = now() - interval '1 hour', expires_at = now() - interval '1 minute' where account_id = '${accountId}'::uuid and used_at is null and superseded_at is null`,
    );
    await g.prisma.$executeRawUnsafe(`alter table chat.password_reset_code enable trigger password_reset_code_is_coherent`);
    const expired = await call(null, 'POST', '/auth/password-reset', { username: teacher.subject, code: fresh.json.code, password: NEW_PASSWORD });
    expect(expired.code).toBe(AuthErrorCode.RESET_CODE_INVALID);

    const short = await call(null, 'POST', '/auth/password-reset', { username: teacher.subject, code: '123456', password: 'short' });
    expect(short.code).toBe(AuthErrorCode.PASSWORD_TOO_WEAK);
  });

  it('a new code supersedes the old one; "sign out everywhere" ends every session at once', async () => {
    const parent = m.families[4]!.parent;
    const accountId = await accountIdOf(parent.subject);
    const session = await login(parent.subject);
    const first = await as(m.operationsManager.subject, 'POST', `/admin/accounts/${accountId}/password-reset`, { reason: 'first' });
    const second = await as(m.operationsManager.subject, 'POST', `/admin/accounts/${accountId}/password-reset`, {
      reason: 'account may be compromised',
      signOutEverywhere: true,
    });
    expect(second.json.signedOutSessions).toBeGreaterThanOrEqual(1);
    expect((await call(session.accessToken, 'GET', '/me')).status).toBe(401);

    if (first.json.code !== second.json.code) {
      const old = await call(null, 'POST', '/auth/password-reset', { username: parent.subject, code: first.json.code, password: NEW_PASSWORD });
      expect(old.code).toBe(AuthErrorCode.RESET_CODE_INVALID);
    }
    const ok = await call(null, 'POST', '/auth/password-reset', { username: parent.subject, code: second.json.code, password: NEW_PASSWORD });
    expect(ok.status).toBe(200);
  });

  it('the database refuses what the API refuses: a non-super-admin issuing for staff, a self-issued code, a delete', async () => {
    const supervisor = m.supervisors[0]!;
    const staffTarget = await accountIdOf(m.supervisors[1]!.subject);
    const own = await accountIdOf(supervisor.subject);
    const insert = (accountId: string, issuedBy: string) =>
      g.prisma.passwordResetCode.create({
        data: { organizationId: orgId, accountId, issuedBy, codeHash: 'a'.repeat(64), reason: 'direct', expiresAt: new Date(Date.now() + 60_000) },
      });
    await expect(insert(staffTarget, supervisor.id)).rejects.toThrow(/only the super admin/);
    await expect(insert(own, supervisor.id)).rejects.toThrow(/their own password/);
    await expect(insert(await accountIdOf(m.superAdmin.subject), m.operationsManager.id)).rejects.toThrow(/super admin/);
    const any = await g.prisma.passwordResetCode.findFirstOrThrow({ where: { organizationId: orgId } });
    await expect(g.prisma.passwordResetCode.delete({ where: { id: any.id } })).rejects.toThrow(/never deleted/);
  });
});

describe('PD-20: suspend and reactivate', () => {
  it('suspension refuses the next request and every login; reactivation revives nothing old', async () => {
    const teacher = m.teachers[2]!;
    const accountId = await accountIdOf(teacher.subject);
    const session = await login(teacher.subject);
    expect((await call(session.accessToken, 'GET', '/me')).status).toBe(200);

    const admin = m.supervisors[0]!;
    const suspended = await as(admin.subject, 'POST', `/admin/accounts/${accountId}/suspend`, { reason: 'left the academy for a term' });
    expect(suspended.status).toBe(200);
    expect(suspended.json).toMatchObject({ status: 'suspended', allowed: { suspend: false, reactivate: true } });

    expect((await call(session.accessToken, 'GET', '/me')).status).toBe(401);
    expect((await call(null, 'POST', '/auth/refresh', { refreshToken: session.refreshToken })).status).toBe(401);
    expect((await login(teacher.subject)).code).toBe(AuthErrorCode.ACCOUNT_DISABLED);

    const account = await g.prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account).toMatchObject({ status: 'suspended', isActive: false, deactivatedBy: await accountIdOf(admin.subject) });
    const journal = await g.prisma.$queryRaw<Array<{ transition: string }>>`
      select transition from chat.principal_revocation where account_id = ${accountId}::uuid order by recorded_at desc limit 1`;
    expect(journal[0]?.transition).toBe('suspended');

    // Idempotent: no second audit row.
    expect((await as(admin.subject, 'POST', `/admin/accounts/${accountId}/suspend`, { reason: 'again' })).status).toBe(200);
    expect(await audits(accountId, 'account.suspended')).toHaveLength(1);

    const back = await as(m.operationsManager.subject, 'POST', `/admin/accounts/${accountId}/reactivate`, { reason: 'returned' });
    expect(back.status).toBe(200);
    expect(back.json).toMatchObject({ status: 'active' });

    // The old session and refresh token stay dead.
    expect((await call(session.accessToken, 'GET', '/me')).status).toBe(401);
    expect((await call(null, 'POST', '/auth/refresh', { refreshToken: session.refreshToken })).status).toBe(401);
    expect((await login(teacher.subject)).status).toBe(200);

    expect(await audits(accountId, 'account.suspended')).toEqual([
      expect.objectContaining({ actorId: admin.id, reason: 'left the academy for a term' }),
    ]);
    expect(await audits(accountId, 'account.reactivated')).toEqual([
      expect.objectContaining({ actorId: m.operationsManager.id, reason: 'returned' }),
    ]);
  });

  it('reactivation never reverses an offboarding; an active account is left alone', async () => {
    const parent = m.families[5]!.parent;
    const accountId = await accountIdOf(parent.subject);
    const active = await as(m.salesManager.subject, 'POST', `/admin/accounts/${accountId}/reactivate`, { reason: 'noop' });
    expect(active.status).toBe(200);
    expect(await audits(accountId, 'account.reactivated')).toHaveLength(0);

    await g.prisma.$queryRaw`select chat.deactivate_principal('account', ${accountId}::uuid, 'offboarded', null, 'deactivated')::text`;
    const r = await as(m.salesManager.subject, 'POST', `/admin/accounts/${accountId}/reactivate`, { reason: 'try' });
    expect({ status: r.status, code: r.code }).toEqual({ status: 409, code: CommErrorCode.ACCOUNT_ADMIN_STATE });
    const s = await as(m.salesManager.subject, 'POST', `/admin/accounts/${accountId}/suspend`, { reason: 'try' });
    expect({ status: s.status, code: s.code }).toEqual({ status: 409, code: CommErrorCode.ACCOUNT_ADMIN_STATE });
    const reset = await as(m.salesManager.subject, 'POST', `/admin/accounts/${accountId}/password-reset`, { reason: 'try' });
    expect(reset.status).toBe(409);
  });

  it('the super admin suspends a staff member; that staff member is signed out at once', async () => {
    const supervisor = m.supervisors[2]!;
    const accountId = await accountIdOf(supervisor.subject);
    const session = await login(supervisor.subject);
    const r = await as(m.superAdmin.subject, 'POST', `/admin/accounts/${accountId}/suspend`, { reason: 'investigation' });
    expect(r.status).toBe(200);
    expect((await call(session.accessToken, 'GET', '/me')).status).toBe(401);
    expect((await login(supervisor.subject)).code).toBe(AuthErrorCode.ACCOUNT_DISABLED);
    await as(m.superAdmin.subject, 'POST', `/admin/accounts/${accountId}/reactivate`, { reason: 'cleared' });
  });
});
