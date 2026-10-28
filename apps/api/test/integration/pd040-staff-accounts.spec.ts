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
 *       a specialist holding MORE than that is the super admin's alone: no
 *       reset, no code, no suspension, no grant by the manager (review of
 *       #212, P1), and a role edit never widens a manager's grant (P2);
 *   S3  the first sign-in code: 72 h, shown once, never in the audit trail,
 *       a reissue kills the old one, completing it activates the account; a
 *       code a manager reissues or resets is e-mailed only, never returned;
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
import { FIRST_LOGIN_MAILER, type MailSender } from '../../src/account-recovery/recovery-delivery';
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

/** Stands in for SMTP. Off by default (no channel: emailed false), as in CI; a test turns it on and reads the code from the mail. */
const mail = { on: false, sent: [] as Array<{ to: string; subject: string; text: string }> };
const mailer: MailSender = {
  get available() {
    return mail.on;
  },
  async send(to, message) {
    mail.sent.push({ to, ...message });
  },
};
/** The code in the last message to `to`: alone on its line in every template. */
const mailedCode = (to: string) => [...mail.sent].reverse().find((x) => x.to === to)?.text.match(/^([0-9]{6})$/m)?.[1];

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
  // PD-40 PR-4: the migration seeded the organizations that existed then; this one is new.
  const seeded = await g.prisma.$queryRaw<Array<{ n: number }>>`SELECT chat.seed_access_role_templates(${orgId}::uuid) AS n`;
  expect(seeded[0]!.n).toBe(1);

  process.env.REDIS_URL = REDIS_URL;
  const moduleRef = await Test.createTestingModule({
    imports: [PlatformModule, AuthModule, CommunicationModule, AccountAdminModule, StaffAccountsModule],
  })
    .overrideProvider(FIRST_LOGIN_MAILER)
    .useValue(mailer)
    .compile();
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
  await g.prisma.$executeRawUnsafe(`delete from chat.department where organization_id in (select id from chat.organization where slug like 'pd40s-%')`);
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
  let designerTemplate: string;
  beforeAll(async () => {
    const rows = await g.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id FROM chat.access_role WHERE organization_id = ${orgId}::uuid AND key = 'designer' AND is_template`;
    designerTemplate = rows[0]!.id;
  });

  it('the template is seeded once, as a specialist role with exactly the two certificate keys (PR-4)', async () => {
    const again = await g.prisma.$queryRaw<Array<{ n: number }>>`SELECT chat.seed_access_role_templates(${orgId}::uuid) AS n`;
    expect(again[0]!.n).toBe(0);
    const roles = await as(m.superAdmin.subject, 'GET', '/admin/access-roles');
    expect((roles.json.roles as Array<{ key: string }>).filter((r) => r.key === 'designer')).toEqual([
      expect.objectContaining({ maxTier: 'specialist', permissions: ['certificates.design', 'certificates.view'], template: true, archived: false, grantable: true }),
    ]);
    const created = await g.prisma.auditLog.findMany({ where: { action: 'access_role.created', entityId: designerTemplate } });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ actorId: null, after: { key: 'designer', template: true } });
  });

  it('the Teachers manager may hand the Designer to a specialist of their department; the Operations manager may not (S1, H5)', async () => {
    const r = await as(m.teachersManager.subject, 'POST', '/admin/staff-accounts', {
      name: 'QA Teachers Designer', email: email('tch-designer'), tier: 'specialist', departmentId: m.departments.teachers, roleIds: [designerTemplate], reason: 'spec',
    });
    expect(r.status).toBe(201);
    expect(r.json.account.roles).toEqual([expect.objectContaining({ key: 'designer' })]);
    const ops = await as(m.operationsManager.subject, 'POST', '/admin/staff-accounts', {
      name: 'QA Ops Designer', email: email('ops-designer'), tier: 'specialist', departmentId: m.departments.operations, roleIds: [designerTemplate], reason: 'spec',
    });
    expect({ status: ops.status, code: ops.code }).toEqual({ status: 403, code: CommErrorCode.STAFF_ACCOUNT_DENIED });
  });

  it('the super admin creates it; the code is shown once, never audited; completing it activates; it opens Certificates only', async () => {
    const designer = designerTemplate;
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
    const trail = JSON.stringify(await g.prisma.auditLog.findMany({ where: { entityId: { in: [staffId, accountId] } } }), (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
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
    for (const path of ['/admin/staff-accounts', '/admin/accounts', '/conversations', '/admin/access-roles']) {
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
  let otherOrgDept: string;
  let readOnlyRole: string;
  let ownSpecialist: { staffId: string; accountId: string };
  const accountOf = async (staffId: string) =>
    (await g.prisma.staff.findUniqueOrThrow({ where: { id: staffId }, select: { accountId: true } })).accountId as string;
  /** A reset or first sign-in code row, written directly: the guard is the only judge. */
  const codeRow = (accountId: string, issuer: string, purpose: 'reset' | 'first_login') =>
    g.prisma.$executeRawUnsafe(
      `insert into chat.password_reset_code (organization_id, account_id, issued_by, channel, purpose, code_hash, reason, expires_at)
       values ('${orgId}'::uuid, '${accountId}'::uuid, '${issuer}'::uuid, 'admin', '${purpose}', 'x', 'direct', now() + interval '1 hour')`,
    );
  const mayAdminister = async (actor: string, target: string) =>
    (await g.prisma.$queryRaw<Array<{ ok: boolean }>>`SELECT chat.may_administer_staff_account(${actor}::uuid, ${target}::uuid) AS ok`)[0]!.ok;

  beforeAll(async () => {
    opsDept = m.departments.operations;
    teachersDept = m.departments.teachers;
    // Keys the Operations manager holds and may delegate (C3).
    readOnlyRole = await defineRole('ops_billing_reader', ['billing.view', 'subscriptions.view']);
    const otherOrg = randomUUID();
    await g.prisma.$executeRawUnsafe(
      `insert into chat.organization (id, slug, display_name) values ('${otherOrg}'::uuid, 'pd40s-o-${otherOrg.slice(0, 8)}', 'Another academy')`,
    );
    otherOrgDept = (
      await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `insert into chat.department (organization_id, kind, display_name) values ('${otherOrg}'::uuid, 'operations', 'Operations') returning id::text`,
      )
    )[0]!.id;
  });

  it('creates a specialist of the department they run, with a role they may grant', async () => {
    const r = await as(m.operationsManager.subject, 'POST', '/admin/staff-accounts', {
      name: 'QA Ops Accountant', email: email('ops-acc'), tier: 'specialist', departmentId: opsDept, roleIds: [readOnlyRole], reason: 'accounts help',
    });
    expect(r.status).toBe(201);
    expect(r.json.account).toMatchObject({ tier: 'specialist', departmentId: opsDept, roles: [expect.objectContaining({ key: 'ops_billing_reader' })] });
    // Creation keeps the owner's rule: the creator sees the code once (the subset holds by construction).
    expect(r.json.firstLogin.code).toMatch(/^[0-9]{6}$/);
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

  it('the database refuses the same creates when asked directly (S2)', async () => {
    const direct = (tier: string, departmentId: string | null) =>
      g.prisma.$queryRaw`SELECT chat.create_staff_account('x', ${email('sql')}::text, ${tier}::text, ${departmentId}::uuid, 'direct', ${m.operationsManager.id}::uuid)`;
    await expect(direct('admin', opsDept)).rejects.toThrow(/only the super admin creates supervisors and managers/);
    await expect(direct('coverage', opsDept)).rejects.toThrow(/only the super admin creates supervisors and managers/);
    await expect(direct('manager', opsDept)).rejects.toThrow(/only the super admin creates supervisors and managers/);
    await expect(direct('specialist', teachersDept)).rejects.toThrow(/creates accounts in the department they run only/);
    await expect(direct('specialist', otherOrgDept)).rejects.toThrow(/creates accounts in the department they run only/);
    await expect(direct('specialist', null)).rejects.toThrow(/creates accounts in the department they run only/);
    await expect(direct('super_admin', null)).rejects.toThrow(/the super admin is never created here/);
    // A supervisor is no manager, whatever they ask for.
    await expect(
      g.prisma.$queryRaw`SELECT chat.create_staff_account('x', ${email('sql')}::text, 'specialist', ${opsDept}::uuid, 'direct', ${m.supervisors[0]!.id}::uuid)`,
    ).rejects.toThrow(/only the super admin and department managers create staff accounts/);
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
    ).rejects.toThrow(/this role holds permissions you may not grant: certificates\.view/);
    await expect(
      g.prisma.$queryRaw`SELECT chat.grant_access_role(${ownSpecialist.staffId}::uuid, ${supervisory}::uuid, 'direct', ${m.operationsManager.id}::uuid)`,
    ).rejects.toThrow(/only the super admin grants a role above a specialist/);
    // And never to a supervisor of their department, even a role made for supervisors (C1).
    await expect(
      g.prisma.$queryRaw`SELECT chat.grant_access_role(${m.supervisors[0]!.id}::uuid, ${supervisory}::uuid, 'direct', ${m.operationsManager.id}::uuid)`,
    ).rejects.toThrow(/a manager changes the access of the specialists of their own department only/);
  });

  it("refuses a role edit that would widen a manager's grant past H5, naming the grant; narrowing is fine (P2)", async () => {
    const wider = await as(m.superAdmin.subject, 'POST', `/admin/access-roles/${readOnlyRole}`, {
      permissions: ['billing.view', 'billing.verify', 'subscriptions.view'], reason: 'spec',
    });
    expect({ status: wider.status, code: wider.code }).toEqual({ status: 409, code: CommErrorCode.ACCESS_ROLE_CONFLICT });
    expect(wider.json.error.message).toContain(ownSpecialist.staffId);
    expect(wider.json.error.message).toContain(m.operationsManager.id);
    const roles = await as(m.superAdmin.subject, 'GET', '/admin/access-roles');
    const role = (roles.json.roles as Array<{ id: string; permissions: string[] }>).find((x) => x.id === readOnlyRole)!;
    expect(role.permissions).toEqual(['billing.view', 'subscriptions.view']);
    // Removing a key never widens anyone; the same keys again change nothing.
    const same = await as(m.superAdmin.subject, 'POST', `/admin/access-roles/${readOnlyRole}`, {
      permissions: ['billing.view', 'subscriptions.view'], nameEn: 'Ops billing reader', reason: 'spec',
    });
    expect(same.status).toBe(200);
  });

  it("never reaches another department's specialist, a supervisor, a manager or the super admin -- in the API or the database", async () => {
    const other = await as(m.superAdmin.subject, 'POST', '/admin/staff-accounts', {
      name: 'QA Teachers Helper', email: email('tch-help'), tier: 'specialist', departmentId: teachersDept, reason: 'spec',
    });
    const otherId = other.json.account.staffId as string;
    const otherAccount = other.json.account.accountId as string;
    expect((await as(m.operationsManager.subject, 'GET', `/admin/staff-accounts/${otherId}`)).status).toBe(404);
    expect((await as(m.operationsManager.subject, 'POST', `/admin/staff-accounts/${otherId}/setup-code`, { reason: 'x' })).status).toBe(404);
    expect((await as(m.operationsManager.subject, 'GET', `/admin/staff-accounts/${m.supervisors[0]!.id}`)).status).toBe(404);
    const suspend = await as(m.operationsManager.subject, 'POST', `/admin/accounts/${otherAccount}/suspend`, { reason: 'x' });
    expect({ status: suspend.status, code: suspend.code }).toEqual({ status: 403, code: CommErrorCode.ACCOUNT_ADMIN_DENIED });

    // The reset-code guard agrees (C4): no code for another department's specialist, a manager, or the super admin.
    const managerAccount = await accountOf(m.teachersManager.id);
    const superAccount = await accountOf(m.superAdmin.id);
    const notTheirs = /only the super admin, or a manager for a specialist of their department, issues a staff member's code/;
    await expect(codeRow(otherAccount, m.operationsManager.id, 'first_login')).rejects.toThrow(notTheirs);
    await expect(codeRow(managerAccount, m.operationsManager.id, 'reset')).rejects.toThrow(notTheirs);
    await expect(codeRow(superAccount, m.operationsManager.id, 'reset')).rejects.toThrow(/the super admin's password is never reset by an administrator/);

    // Suspension and sign-out are the database's rule too (P2).
    await expect(
      g.prisma.$queryRaw`SELECT chat.deactivate_principal('account', ${managerAccount}::uuid, 'direct', ${m.operationsManager.id}::uuid, 'suspended')::text`,
    ).rejects.toThrow(/suspends or reactivates a staff account/);
    await token(m.teachersManager.subject); // a live session to end
    const managerOwn = await accountOf(m.operationsManager.id);
    await expect(
      g.prisma.$executeRaw`UPDATE chat.session SET revoked_at = now(), revoked_by = ${managerOwn}::uuid
                            WHERE account_id = ${managerAccount}::uuid AND revoked_at IS NULL`,
    ).rejects.toThrow(/signs a staff account out/);
    expect(await g.prisma.account.findUniqueOrThrow({ where: { id: managerAccount }, select: { status: true } })).toEqual({ status: 'active' });
  });

  it("a specialist the super admin granted more than the manager may grant is the super admin's alone (P1)", async () => {
    const r = await as(m.operationsManager.subject, 'POST', '/admin/staff-accounts', {
      name: 'QA Ops Verifier', email: email('ops-ver'), tier: 'specialist', departmentId: opsDept, reason: 'spec',
    });
    const widened = { staffId: r.json.account.staffId as string, accountId: r.json.account.accountId as string };
    // billing.verify: the Operations manager holds it, but may not delegate it.
    const verifier = await defineRole('ops_verifier', ['billing.verify']);
    expect((await as(m.superAdmin.subject, 'POST', `/admin/staff-accounts/${widened.staffId}/roles`, { roleId: verifier, reason: 'spec' })).status).toBe(200);
    expect(await mayAdminister(m.operationsManager.id, widened.staffId)).toBe(false);
    expect(await mayAdminister(m.superAdmin.id, widened.staffId)).toBe(true);
    // The super admin still administers them, and sees the code; the specialist signs in (an active account is the real risk).
    const sa = await as(m.superAdmin.subject, 'POST', `/admin/staff-accounts/${widened.staffId}/setup-code`, { reason: 'spec' });
    expect({ status: sa.status, code: sa.json.firstLogin?.code }).toEqual({ status: 201, code: expect.stringMatching(/^[0-9]{6}$/) });
    expect((await call(null, 'POST', '/auth/password-reset', { username: r.json.signIn, code: sa.json.firstLogin.code, password: 'abcd' })).status).toBe(200);

    // No reset (the way in), no code, no status change, no grant, not even a sight of them.
    const reset = await as(m.operationsManager.subject, 'POST', `/admin/accounts/${widened.accountId}/password-reset`, { reason: 'x' });
    expect({ status: reset.status, code: reset.code, plaintext: 'code' in reset.json }).toEqual({ status: 403, code: CommErrorCode.ACCOUNT_ADMIN_DENIED, plaintext: false });
    for (const [method, path, body] of [
      ['GET', `/admin/staff-accounts/${widened.staffId}`, undefined],
      ['POST', `/admin/staff-accounts/${widened.staffId}/setup-code`, { reason: 'x' }],
      ['POST', `/admin/staff-accounts/${widened.staffId}/roles`, { roleId: readOnlyRole, reason: 'x' }],
      ['POST', `/admin/staff-accounts/${widened.staffId}/roles/${verifier}/revoke`, { reason: 'x' }],
    ] as const) {
      const x = await as(m.operationsManager.subject, method, path, body);
      expect({ path, status: x.status }).toEqual({ path, status: 404 });
    }
    expect((await as(m.operationsManager.subject, 'POST', `/admin/accounts/${widened.accountId}/suspend`, { reason: 'x' })).status).toBe(403);
    const list = await as(m.operationsManager.subject, 'GET', '/admin/staff-accounts');
    expect((list.json.accounts as Array<{ staffId: string }>).map((a) => a.staffId)).not.toContain(widened.staffId);

    // The database says the same, whatever the caller skips.
    await expect(codeRow(widened.accountId, m.operationsManager.id, 'reset')).rejects.toThrow(
      /only the super admin, or a manager for a specialist of their department, issues a staff member's code/,
    );
    await expect(
      g.prisma.$queryRaw`SELECT chat.grant_access_role(${widened.staffId}::uuid, ${readOnlyRole}::uuid, 'direct', ${m.operationsManager.id}::uuid)`,
    ).rejects.toThrow(/while they hold nothing the manager may not grant/);
    await expect(
      g.prisma.$queryRaw`SELECT chat.deactivate_principal('account', ${widened.accountId}::uuid, 'direct', ${m.operationsManager.id}::uuid, 'suspended')::text`,
    ).rejects.toThrow(/suspends or reactivates a staff account/);
    expect(await g.prisma.account.findUniqueOrThrow({ where: { id: widened.accountId }, select: { status: true } })).toEqual({ status: 'active' });
  });

  it("their own specialist's codes go by e-mail only -- never returned -- and none is issued with e-mail off (P1)", async () => {
    const signIn = (await g.prisma.account.findUniqueOrThrow({ where: { id: ownSpecialist.accountId } })).subject;
    const codes = () => g.prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM chat.password_reset_code WHERE account_id = ${ownSpecialist.accountId}::uuid`;
    const before = (await codes())[0]!.n;
    const off = await as(m.operationsManager.subject, 'POST', `/admin/staff-accounts/${ownSpecialist.staffId}/setup-code`, { reason: 'a new code' });
    expect({ status: off.status, code: off.code }).toEqual({ status: 409, code: CommErrorCode.ACCOUNT_ADMIN_STATE });
    expect((await codes())[0]!.n).toBe(before); // the live code was not killed

    mail.on = true;
    try {
      const again = await as(m.operationsManager.subject, 'POST', `/admin/staff-accounts/${ownSpecialist.staffId}/setup-code`, { reason: 'a new code' });
      expect(again.status).toBe(201);
      expect(again.json.firstLogin).toEqual({ expiresAt: expect.any(String), emailed: true });
      const setup = mailedCode(signIn);
      expect(setup).toMatch(/^[0-9]{6}$/);
      expect((await call(null, 'POST', '/auth/password-reset', { username: signIn, code: setup, password: 'abcd' })).status).toBe(200);

      // A password reset of the now-active account: e-mailed, never in the response.
      const reset = await as(m.operationsManager.subject, 'POST', `/admin/accounts/${ownSpecialist.accountId}/password-reset`, { reason: 'forgot' });
      expect(reset.status).toBe(201);
      expect(reset.json).toEqual({ emailed: true, expiresAt: expect.any(String), expiresInMinutes: expect.any(Number), signedOutSessions: 0 });
      const resetCode = mailedCode(signIn);
      expect(resetCode).toMatch(/^[0-9]{6}$/);
      expect(JSON.stringify(reset.json)).not.toContain(resetCode);
      expect((await call(null, 'POST', '/auth/password-reset', { username: signIn, code: resetCode, password: 'efgh' })).status).toBe(200);
    } finally {
      mail.on = false;
    }

    // The super admin still sees a staff member's code.
    const sa = await as(m.superAdmin.subject, 'POST', `/admin/accounts/${ownSpecialist.accountId}/password-reset`, { reason: 'spec' });
    expect({ status: sa.status, code: sa.json.code }).toEqual({ status: 201, code: expect.stringMatching(/^[0-9]{6}$/) });
  });

  it('suspends and reactivates their own specialist -- and the database wants a named administrator to reactivate', async () => {
    expect((await as(m.operationsManager.subject, 'POST', `/admin/accounts/${ownSpecialist.accountId}/suspend`, { reason: 'leave' })).status).toBe(200);
    await expect(g.prisma.$queryRaw`SELECT chat.reactivate_account(${ownSpecialist.accountId}::uuid, 'direct')`).rejects.toThrow(
      /a staff account is reactivated by a named administrator/,
    );
    expect((await as(m.operationsManager.subject, 'POST', `/admin/accounts/${ownSpecialist.accountId}/reactivate`, { reason: 'back' })).status).toBe(200);
    // Never "open as" a staff account.
    expect((await as(m.operationsManager.subject, 'POST', '/admin/impersonations', { accountId: ownSpecialist.accountId, reason: 'x' })).status).toBe(403);
  });
});
