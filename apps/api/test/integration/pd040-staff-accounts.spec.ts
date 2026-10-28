/**
 * PD-40 PR-3 over real HTTP and the real database: staff accounts from
 * creation to first sign-in and day-to-day management, under the owner's six
 * safeguards (2026-10-28, plan §13).
 *
 *   S1  the super admin creates any tier but super admin; a department manager
 *       creates specialists of their own department only;
 *   S2  a manager grants a role only if it is a specialist role, to a
 *       specialist of their department, holding only keys the manager holds
 *       and may delegate -- refused in the API and, tried directly, in SQL;
 *   S3  the first sign-in code: 72 h, shown once, never in the audit trail,
 *       a reissue kills the old one, completing it activates the account;
 *   S4  a role never holds a super-admin-only key;
 *   S5  creation, every grant and every code are audited.
 *
 * Synthetic people only (G-20).
 */
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
import { StaffAccountsModule } from '../../src/staff-accounts/staff-accounts.module';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';
import { randomUUID } from 'node:crypto';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const PASSWORD = 'pd40-staff-spec-password-1';
const DOMAIN = 'pd40staff.qa.jawwid.test';

const g = buildGraph();
let app: INestApplication;
let base: string;
let m: SeedManifest;
let orgId: string;
const tokens = new Map<string, string>();

async function login(subject: string, password = PASSWORD): Promise<{ status: number; token: string }> {
  const r = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: subject, password }),
  });
  const json = (await r.json().catch(() => ({}))) as { accessToken?: string };
  return { status: r.status, token: json.accessToken ?? '' };
}
async function token(subject: string): Promise<string> {
  if (!tokens.has(subject)) tokens.set(subject, (await login(subject)).token);
  return tokens.get(subject)!;
}
async function call(tok: string | null, method: string, path: string, body?: unknown) {
  const send = body !== undefined && method !== 'GET';
  const headers: Record<string, string> = send ? { 'content-type': 'application/json' } : {};
  if (tok) headers.authorization = `Bearer ${tok}`;
  const r = await fetch(`${base}${path}`, { method, headers, body: send ? JSON.stringify(body) : undefined });
  const json = (await r.json().catch(() => ({}))) as Record<string, any>;
  return { status: r.status, code: json.error?.code as string | undefined, json };
}
const as = async (subject: string, method: string, path: string, body?: unknown) => call(await token(subject), method, path, body);

const email = (key: string) => `${key}-${randomUUID().slice(0, 6)}@${DOMAIN}`;
async function defineRole(key: string, permissions: string[], maxTier = 'specialist') {
  const r = await as(m.superAdmin.subject, 'POST', '/admin/access-roles', {
    key, nameEn: key, nameAr: key, maxTier, permissions, reason: 'spec',
  });
  expect({ key, status: r.status }).toEqual({ key, status: 201 });
  return r.json.role.id as string;
}
async function audits(entityId: string, action: string) {
  return g.prisma.auditLog.findMany({ where: { entityId, action }, orderBy: { id: 'asc' } });
}

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd40s-%'`);
  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd40s-${orgId.slice(0, 8)}', 'PD-40 staff QA academy')`,
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

  process.env.REDIS_URL = REDIS_URL;
  const moduleRef = await Test.createTestingModule({
    imports: [PlatformModule, AuthModule, CommunicationModule, AccountAdminModule, StaffAccountsModule],
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
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd40s-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
});

describe('PD-40 S4: roles', () => {
  it('a role never holds a super-admin-only key; only the super admin defines one', async () => {
    for (const key of ['admin.inspect', 'org.departments', 'accounts.support_session', 'staff_accounts.create', 'access_roles.manage']) {
      const r = await as(m.superAdmin.subject, 'POST', '/admin/access-roles', {
        key: `bad_${key.replace(/\W/g, '_')}`, nameEn: 'x', nameAr: 'x', maxTier: 'specialist', permissions: ['certificates.view', key], reason: 'spec',
      });
      expect({ key, status: r.status, code: r.code }).toEqual({ key, status: 400, code: CommErrorCode.ACCESS_ROLE_INVALID });
    }
    const manager = await as(m.operationsManager.subject, 'POST', '/admin/access-roles', {
      key: 'by_manager', nameEn: 'x', nameAr: 'x', maxTier: 'specialist', permissions: ['billing.view'], reason: 'spec',
    });
    expect(manager.status).toBe(403);
  });

  it('the catalogue says which keys go in roles and which a manager may delegate', async () => {
    const r = await as(m.superAdmin.subject, 'GET', '/admin/permissions');
    const byKey = new Map((r.json.permissions as Array<{ key: string; inRoles: boolean; delegable: boolean }>).map((p) => [p.key, p]));
    expect(byKey.get('admin.inspect')).toMatchObject({ inRoles: false });
    expect(byKey.get('certificates.view')).toMatchObject({ inRoles: true, delegable: true });
    expect(byKey.get('parents.edit')).toMatchObject({ inRoles: true, delegable: false });
  });
});

describe('PD-40: the Designer, end to end (S1, S3, S5)', () => {
  it('the super admin creates it; the code is shown once, never audited; completing it activates; it opens Certificates only', async () => {
    const designer = await defineRole('designer', ['certificates.view', 'certificates.design']);
    const address = email('designer');
    const created = await as(m.superAdmin.subject, 'POST', '/admin/staff-accounts', {
      name: 'QA Designer', email: address, tier: 'specialist', roleIds: [designer], reason: 'the certificates designer',
    });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({
      account: { tier: 'specialist', status: 'provisioned', departmentId: null, setupPending: true },
      signIn: address,
      firstLogin: { code: expect.stringMatching(/^[0-9]{6}$/), expiresAt: expect.any(String), emailed: false },
    });
    expect(new Date(created.json.firstLogin.expiresAt).getTime() - Date.now()).toBeGreaterThan(71 * 3_600_000);
    const staffId = created.json.account.staffId as string;
    const accountId = created.json.account.accountId as string;

    // S5: creation, the grant and the code -- and the code itself nowhere.
    expect(await audits(staffId, 'staff.account_created')).toHaveLength(1);
    expect(await audits(staffId, 'staff.access_role_granted')).toHaveLength(1);
    expect(await audits(accountId, 'account.first_login_code_issued')).toHaveLength(1);
    const trail = JSON.stringify(await g.prisma.auditLog.findMany({ where: { entityId: { in: [staffId, accountId] } } }));
    expect(trail).not.toContain(created.json.firstLogin.code);
    expect(trail).not.toContain(address);

    // Before the first sign-in nothing logs in.
    expect((await login(address, 'any-password')).status).toBe(401);
    const done = await call(null, 'POST', '/auth/password-reset', { username: address, code: created.json.firstLogin.code, password: 'abcd' });
    expect(done.status).toBe(200);
    expect(await g.prisma.account.findUniqueOrThrow({ where: { id: accountId } })).toMatchObject({ status: 'active', isActive: true });
    // The code is spent.
    expect((await call(null, 'POST', '/auth/password-reset', { username: address, code: created.json.firstLogin.code, password: 'efgh' })).status).toBe(401);

    const signedIn = await login(address, 'abcd');
    expect(signedIn.status).toBe(200);
    const me = await call(signedIn.token, 'GET', '/me');
    expect(me.json).toMatchObject({ staffRole: 'specialist', permissions: ['certificates.design', 'certificates.view'] });
    for (const path of ['/admin/staff-accounts', '/admin/accounts', '/conversations', '/parent-profiles']) {
      const r = await call(signedIn.token, 'GET', path);
      expect({ path, status: r.status, code: r.code }).toEqual({ path, status: 403, code: CommErrorCode.PERMISSION_DENIED });
    }
  });

  it('nobody creates a super admin, and a sign-in e-mail is used once', async () => {
    const r = await as(m.superAdmin.subject, 'POST', '/admin/staff-accounts', { name: 'x', email: email('sa'), tier: 'super_admin', reason: 'spec' });
    expect({ status: r.status, code: r.code }).toEqual({ status: 400, code: CommErrorCode.STAFF_ACCOUNT_INVALID });
    const taken = await as(m.superAdmin.subject, 'POST', '/admin/staff-accounts', {
      name: 'x', email: m.supervisors[0]!.subject, tier: 'specialist', reason: 'spec',
    });
    expect({ status: taken.status, code: taken.code }).toEqual({ status: 409, code: CommErrorCode.STAFF_ACCOUNT_CONFLICT });
  });

  it('a reissue kills the old code and is audited with what it supersedes', async () => {
    const created = await as(m.superAdmin.subject, 'POST', '/admin/staff-accounts', {
      name: 'QA Reissue', email: email('reissue'), tier: 'specialist', reason: 'spec',
    });
    const staffId = created.json.account.staffId as string;
    const again = await as(m.superAdmin.subject, 'POST', `/admin/staff-accounts/${staffId}/setup-code`, { reason: 'lost the e-mail' });
    expect(again.status).toBe(201);
    expect(again.json.firstLogin.code).toMatch(/^[0-9]{6}$/);
    const old = await call(null, 'POST', '/auth/password-reset', {
      username: created.json.signIn, code: created.json.firstLogin.code, password: 'abcd',
    });
    if (created.json.firstLogin.code !== again.json.firstLogin.code) expect(old.status).toBe(401);
    const issued = await audits(created.json.account.accountId as string, 'account.first_login_code_issued');
    expect(issued).toHaveLength(2);
    expect((issued[1]!.after as { supersedes: string[] }).supersedes).toHaveLength(1);
  });
});

describe('PD-40 S1/S2: a department manager', () => {
  let opsDept: string;
  let teachersDept: string;
  let readOnlyRole: string;
  let ownSpecialist: { staffId: string; accountId: string };

  beforeAll(async () => {
    opsDept = m.departments.operations;
    teachersDept = m.departments.teachers;
    // Keys the Operations manager holds and may delegate (C3).
    readOnlyRole = await defineRole('ops_billing_reader', ['billing.view', 'subscriptions.view']);
  });

  it('creates a specialist of the department they run, with a role they may grant', async () => {
    const r = await as(m.operationsManager.subject, 'POST', '/admin/staff-accounts', {
      name: 'QA Ops Accountant', email: email('ops-acc'), tier: 'specialist', departmentId: opsDept, roleIds: [readOnlyRole], reason: 'accounts help',
    });
    expect(r.status).toBe(201);
    expect(r.json.account).toMatchObject({ tier: 'specialist', departmentId: opsDept, roles: [expect.objectContaining({ key: 'ops_billing_reader' })] });
    ownSpecialist = { staffId: r.json.account.staffId, accountId: r.json.account.accountId };
    const list = await as(m.operationsManager.subject, 'GET', '/admin/staff-accounts');
    expect((list.json.accounts as Array<{ staffId: string }>).map((a) => a.staffId)).toEqual([ownSpecialist.staffId]);
  });

  it('never creates a supervisor, a manager, or anyone outside their department -- and a refused create leaves nothing behind', async () => {
    for (const [tier, departmentId] of [['admin', opsDept], ['manager', opsDept], ['specialist', teachersDept], ['specialist', null]] as const) {
      const address = email('refused');
      const r = await as(m.operationsManager.subject, 'POST', '/admin/staff-accounts', { name: 'x', email: address, tier, departmentId, reason: 'spec' });
      expect({ tier, departmentId, status: r.status, code: r.code }).toEqual({ tier, departmentId, status: 403, code: CommErrorCode.STAFF_ACCOUNT_DENIED });
      expect(await g.prisma.account.count({ where: { subject: address } })).toBe(0);
    }
  });

  it('grants nothing beyond what they hold and may delegate, nor a supervisory role (H5, C1, C3)', async () => {
    const notHeld = await defineRole('designer_for_ops', ['certificates.view']); // the Teachers department's key
    const notDelegable = await defineRole('ops_contact_editor', ['parents.edit']);
    const supervisory = await defineRole('ops_supervisory', ['billing.view'], 'supervisor');
    for (const [label, roleId] of [['not held', notHeld], ['not delegable', notDelegable], ['supervisory', supervisory]] as const) {
      const r = await as(m.operationsManager.subject, 'POST', `/admin/staff-accounts/${ownSpecialist.staffId}/roles`, { roleId, reason: 'spec' });
      expect({ label, status: r.status, code: r.code }).toEqual({ label, status: 403, code: CommErrorCode.STAFF_ACCOUNT_DENIED });
    }
    // The same through SQL directly: the database refuses it too.
    await expect(
      g.prisma.$queryRaw`SELECT chat.grant_access_role(${ownSpecialist.staffId}::uuid, ${notHeld}::uuid, 'direct', ${m.operationsManager.id}::uuid)`,
    ).rejects.toThrow(/may not grant/);
    // And never to a supervisor of their department, whatever the role (C1).
    await expect(
      g.prisma.$queryRaw`SELECT chat.grant_access_role(${m.supervisors[0]!.id}::uuid, ${readOnlyRole}::uuid, 'direct', ${m.operationsManager.id}::uuid)`,
    ).rejects.toThrow();
  });

  it("never reaches another department's specialist, or a supervisor", async () => {
    const other = await as(m.superAdmin.subject, 'POST', '/admin/staff-accounts', {
      name: 'QA Teachers Helper', email: email('tch-help'), tier: 'specialist', departmentId: teachersDept, reason: 'spec',
    });
    const otherId = other.json.account.staffId as string;
    expect((await as(m.operationsManager.subject, 'GET', `/admin/staff-accounts/${otherId}`)).status).toBe(404);
    expect((await as(m.operationsManager.subject, 'POST', `/admin/staff-accounts/${otherId}/setup-code`, { reason: 'x' })).status).toBe(404);
    expect((await as(m.operationsManager.subject, 'GET', `/admin/staff-accounts/${m.supervisors[0]!.id}`)).status).toBe(404);
    const suspend = await as(m.operationsManager.subject, 'POST', `/admin/accounts/${other.json.account.accountId}/suspend`, { reason: 'x' });
    expect(suspend.status).toBe(403);
    // The reset-code guard agrees (C4): a manager issues no code for another department's specialist.
    await expect(
      g.prisma.$executeRawUnsafe(
        `insert into chat.password_reset_code (organization_id, account_id, issued_by, channel, purpose, code_hash, reason, expires_at)
         values ('${orgId}'::uuid, '${other.json.account.accountId}'::uuid, '${m.operationsManager.id}'::uuid, 'admin', 'first_login', 'x', 'direct', now() + interval '1 hour')`,
      ),
    ).rejects.toThrow();
  });

  it("reissues their own specialist's code and suspends and reactivates them (PD-21 for their department)", async () => {
    const again = await as(m.operationsManager.subject, 'POST', `/admin/staff-accounts/${ownSpecialist.staffId}/setup-code`, { reason: 'a new code' });
    expect(again.status).toBe(201);
    const signIn = (await g.prisma.account.findUniqueOrThrow({ where: { id: ownSpecialist.accountId } })).subject;
    expect((await call(null, 'POST', '/auth/password-reset', { username: signIn, code: again.json.firstLogin.code, password: 'abcd' })).status).toBe(200);
    expect((await as(m.operationsManager.subject, 'POST', `/admin/accounts/${ownSpecialist.accountId}/suspend`, { reason: 'leave' })).status).toBe(200);
    expect((await as(m.operationsManager.subject, 'POST', `/admin/accounts/${ownSpecialist.accountId}/reactivate`, { reason: 'back' })).status).toBe(200);
    // Never "open as" a staff account.
    expect((await as(m.operationsManager.subject, 'POST', '/admin/impersonations', { accountId: ownSpecialist.accountId, reason: 'x' })).status).toBe(403);
  });
});
