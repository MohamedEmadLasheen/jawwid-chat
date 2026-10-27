/**
 * PD-40 PR-2 against the real database and over real HTTP.
 *
 *   - chat.permission and chat.legacy_permission_bundle are the TypeScript
 *     catalogue and bundles, row for row;
 *   - chat.staff_access_profile answers what PermissionGuard expects for every
 *     kind of seeded account, and exactly the granted keys for a specialist;
 *   - only the super admin defines roles; grants refuse oneself, the super
 *     admin, a tier above the role, an archived role, and anyone but the super
 *     admin until PR-3 hands out staff_accounts.manage (H1-H8);
 *   - nothing writes the role tables or the catalogue directly;
 *   - every change is audited once, with its keys;
 *   - over HTTP a specialist is refused every page it does not hold even in
 *     shadow mode, and GET /me returns its keys.
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
import { PERMISSIONS } from '@platform/permissions/catalogue';
import { legacyBundle, legacyBundleNames, type LegacyTier, type StaffPlacement } from '@platform/permissions/legacy-bundles';
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
const PASSWORD = 'pd40-access-spec-password-1';
const DOMAIN = 'pd40access.qa.jawwid.test';

const g = buildGraph();
let app: INestApplication;
let base: string;
let m: SeedManifest;
let orgId: string;
let designer: { id: string; subject: string };

async function sqlError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return String((e as Error).message ?? e);
  }
}

const profile = async (staffId: string) =>
  (
    await g.prisma.$queryRaw<Array<{ tier: string | null; department_kind: string | null; placement: string | null; permissions: string[] }>>`
      SELECT tier, department_kind, placement, permissions FROM chat.staff_access_profile(${staffId}::uuid)`
  )[0]!;

const define = (actor: string, key: string, permissions: string[], maxTier = 'specialist') =>
  g.prisma.$queryRaw<Array<{ id: string }>>`
    SELECT chat.define_access_role(${key}, ${key + ' (en)'}, ${key + ' (ar)'}, null, ${maxTier}, ${permissions}::text[], 'spec', ${actor}::uuid)::text AS id`.then(
    (r) => r[0]!.id,
  );
const grant = (actor: string, staff: string, role: string) =>
  g.prisma.$queryRaw<Array<{ added: boolean }>>`
    SELECT chat.grant_access_role(${staff}::uuid, ${role}::uuid, 'spec', ${actor}::uuid) AS added`.then((r) => r[0]!.added);
const revoke = (actor: string, staff: string, role: string) =>
  g.prisma.$queryRaw<Array<{ removed: boolean }>>`
    SELECT chat.revoke_access_role(${staff}::uuid, ${role}::uuid, 'spec', ${actor}::uuid) AS removed`.then((r) => r[0]!.removed);

async function login(subject: string): Promise<string> {
  const r = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: subject, password: PASSWORD }),
  });
  return ((await r.json()) as { accessToken: string }).accessToken;
}
async function call(token: string, method: string, path: string) {
  const r = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}` } });
  const json = (await r.json().catch(() => ({}))) as { error?: { code?: string } } & Record<string, unknown>;
  return { status: r.status, code: json.error?.code, json };
}

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd40a-%'`);

  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd40a-${orgId.slice(0, 8)}', 'PD-40 QA academy')`,
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

  // A specialist: a staff account with no implicit power (the Designer's tier).
  const account = await g.prisma.account.create({
    data: { organizationId: orgId, subject: `designer@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true },
  });
  await g.prisma.accountCredential.create({ data: { accountId: account.id, passwordHash: await hashPassword(PASSWORD) } });
  const staff = await g.prisma.staff.create({ data: { organizationId: orgId, name: 'QA Designer', role: 'specialist', isActive: true, accountId: account.id } });
  designer = { id: staff.id, subject: account.subject };

  process.env.REDIS_URL = REDIS_URL;
  const moduleRef = await Test.createTestingModule({ imports: [PlatformModule, AuthModule, CommunicationModule, AccountAdminModule] }).compile();
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
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd40a-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
});

describe('PD-40: the catalogue and the bundles in the database', () => {
  it('chat.permission is the TypeScript catalogue, row for row', async () => {
    const rows = await g.prisma.$queryRaw<Array<{ key: string; risk: string; delegable: boolean }>>`
      SELECT key, risk, delegable FROM chat.permission ORDER BY key`;
    expect(rows).toEqual(
      PERMISSIONS.map((p) => ({ key: p.key, risk: p.risk, delegable: p.delegable })).sort((a, b) => a.key.localeCompare(b.key)),
    );
  });

  it('chat.legacy_permission_bundle is legacy-bundles.ts, row for row', async () => {
    const rows = await g.prisma.$queryRaw<Array<{ b: string }>>`
      SELECT tier || ':' || department_kind || ':' || permission_key AS b FROM chat.legacy_permission_bundle ORDER BY 1`;
    const want: string[] = [];
    for (const name of legacyBundleNames()) {
      if (name === 'super_admin') continue;
      const [tier, kind] = name.split(':') as [LegacyTier, string];
      const placement: StaffPlacement = kind === 'none' ? { kind: null, position: null } : { kind: kind as StaffPlacement['kind'], position: tier === 'manager' ? 'manager' : 'member' };
      for (const key of legacyBundle(tier, placement)) want.push(`${name}:${key}`);
    }
    expect(rows.map((r) => r.b)).toEqual(want.sort());
  });

  it('staff_access_profile answers the legacy bundle of each seeded account', async () => {
    const all = PERMISSIONS.map((p) => p.key).sort();
    expect(await profile(m.superAdmin.id)).toEqual({ tier: 'super_admin', department_kind: null, placement: null, permissions: all });
    for (const [who, id, tier, kind, position] of [
      ['Operations manager', m.operationsManager.id, 'manager', 'operations', 'manager'],
      ['Teachers manager', m.teachersManager.id, 'manager', 'teachers', 'manager'],
      ['Sales manager', m.salesManager.id, 'manager', 'sales', 'manager'],
      ['Operations supervisor', m.supervisors[0]!.id, 'supervisor', 'operations', 'member'],
      ['Teachers supervisor', m.teacherSupervisors[0]!.id, 'supervisor', 'teachers', 'member'],
    ] as const) {
      const want = [...legacyBundle(tier, { kind, position })].sort();
      expect({ who, ...(await profile(id)) }).toEqual({ who, tier, department_kind: kind, placement: position, permissions: want });
    }
    expect(await profile(designer.id)).toEqual({ tier: 'specialist', department_kind: null, placement: null, permissions: [] });
  });

  it('nothing changes the catalogue or the bundles outside a migration', async () => {
    expect(await sqlError(g.prisma.$executeRawUnsafe(`update chat.permission set delegable = true where key = 'chat.use'`))).toMatch(/only by migration/);
    expect(await sqlError(g.prisma.$executeRawUnsafe(`insert into chat.legacy_permission_bundle values ('supervisor', 'none', 'billing.verify')`))).toMatch(/only by migration/);
  });
});

describe('PD-40: roles and grants', () => {
  let designerRole: string;

  it('only the super admin defines a role', async () => {
    designerRole = await define(m.superAdmin.id, 'designer', ['certificates.view', 'certificates.design']);
    for (const actor of [m.operationsManager.id, m.supervisors[0]!.id, designer.id]) {
      expect(await sqlError(define(actor, `role_${actor.slice(0, 6)}`, ['certificates.view']))).toMatch(/only the super admin defines/);
    }
    expect(await sqlError(define(m.superAdmin.id, 'bad_keys', ['certificates.view', 'certificates.everything']))).toMatch(/unknown permission/);
    expect(await sqlError(define(m.superAdmin.id, 'empty', []))).toMatch(/at least one permission/);
    const created = await g.prisma.auditLog.findMany({ where: { action: 'access_role.created', entityId: designerRole } });
    expect(created).toHaveLength(1);
    expect(created[0]!.after).toMatchObject({ key: 'designer', permissions: ['certificates.design', 'certificates.view'] });
  });

  it('a granted specialist holds exactly the role\'s keys; the grant is audited once and idempotent', async () => {
    expect(await grant(m.superAdmin.id, designer.id, designerRole)).toBe(true);
    expect(await grant(m.superAdmin.id, designer.id, designerRole)).toBe(false);
    expect((await profile(designer.id)).permissions).toEqual(['certificates.design', 'certificates.view']);
    const granted = await g.prisma.auditLog.findMany({ where: { action: 'staff.access_role_granted', entityId: designer.id } });
    expect(granted).toHaveLength(1);
    expect(granted[0]).toMatchObject({ actorId: m.superAdmin.id, reason: 'spec' });
  });

  it('refuses oneself, the super admin, a tier above the role, and every grantor but the super admin (H1, H3, H8)', async () => {
    expect(await sqlError(grant(m.superAdmin.id, m.superAdmin.id, designerRole))).toMatch(/own access/);
    const managerRole = await define(m.superAdmin.id, 'ops_extra', ['certificates.view'], 'manager');
    expect(await sqlError(grant(m.superAdmin.id, m.superAdmin.id, managerRole))).toMatch(/own access/);
    // A specialist-tier role is never granted to a supervisor or a manager.
    expect(await sqlError(grant(m.superAdmin.id, m.supervisors[0]!.id, designerRole))).toMatch(/granted up to a specialist/);
    expect(await sqlError(grant(m.superAdmin.id, m.operationsManager.id, designerRole))).toMatch(/granted up to a specialist/);
    // Until PR-3 hands out staff_accounts.manage, a manager grants nothing -- not even in their own department.
    expect(await sqlError(grant(m.operationsManager.id, m.supervisors[0]!.id, managerRole))).toMatch(/only the super admin changes/);
    expect(await sqlError(grant(m.operationsManager.id, designer.id, designerRole))).toMatch(/only the super admin changes/);
    expect(await sqlError(revoke(m.operationsManager.id, designer.id, designerRole))).toMatch(/only the super admin changes/);
    // The super admin may widen a legacy account up to the role's tier.
    expect(await grant(m.superAdmin.id, m.operationsManager.id, managerRole)).toBe(true);
    expect((await profile(m.operationsManager.id)).permissions).toContain('certificates.view');
  });

  it('nothing writes a grant or a role directly', async () => {
    const insert = `insert into chat.staff_access_role (staff_id, role_id, reason) values ('${m.supervisors[1]!.id}'::uuid, '${designerRole}'::uuid, 'direct')`;
    expect(await sqlError(g.prisma.$executeRawUnsafe(insert))).toMatch(/changed only through chat.define_access_role/);
    expect(await sqlError(g.prisma.$executeRawUnsafe(`delete from chat.staff_access_role where role_id = '${designerRole}'::uuid`))).toMatch(
      /changed only through/,
    );
    expect(await sqlError(g.prisma.$executeRawUnsafe(`insert into chat.access_role_permission values ('${designerRole}'::uuid, 'billing.verify')`))).toMatch(
      /changed only through/,
    );
    expect((await profile(designer.id)).permissions).toEqual(['certificates.design', 'certificates.view']);
  });

  it('archiving stops new grants and keeps existing ones; revoking removes the keys, once', async () => {
    const other = await g.prisma.staff.create({ data: { organizationId: orgId, name: 'QA Second Specialist', role: 'specialist', isActive: true } });
    await g.prisma.$queryRaw`SELECT chat.archive_access_role(${designerRole}::uuid, 'spec', ${m.superAdmin.id}::uuid)`;
    expect(await sqlError(grant(m.superAdmin.id, other.id, designerRole))).toMatch(/archived role/);
    expect((await profile(designer.id)).permissions).toEqual(['certificates.design', 'certificates.view']);

    expect(await revoke(m.superAdmin.id, designer.id, designerRole)).toBe(true);
    expect(await revoke(m.superAdmin.id, designer.id, designerRole)).toBe(false);
    expect((await profile(designer.id)).permissions).toEqual([]);
    const revoked = await g.prisma.auditLog.findMany({ where: { action: 'staff.access_role_revoked', entityId: designer.id } });
    expect(revoked).toHaveLength(1);
    expect(revoked[0]!.before).toMatchObject({ roleKey: 'designer', permissions: ['certificates.design', 'certificates.view'] });
  });
});

describe('PD-40: over HTTP', () => {
  it('a specialist is refused every page it does not hold -- even in shadow mode -- and GET /me lists its keys', async () => {
    const role = await define(m.superAdmin.id, 'designer_http', ['certificates.view', 'certificates.design']);
    await grant(m.superAdmin.id, designer.id, role);
    const token = await login(designer.subject);

    const me = await call(token, 'GET', '/me');
    expect(me.status).toBe(200);
    expect(me.json).toMatchObject({ staffRole: 'specialist', permissions: ['certificates.design', 'certificates.view'] });

    for (const path of ['/admin/accounts', '/admin/overview', '/conversations']) {
      const r = await call(token, 'GET', path);
      expect({ path, status: r.status, code: r.code }).toEqual({ path, status: 403, code: CommErrorCode.PERMISSION_DENIED });
    }
  });

  it('an existing account is unchanged: the super admin and a supervisor still reach their pages', async () => {
    const owner = await login(m.superAdmin.subject);
    expect((await call(owner, 'GET', '/admin/overview')).status).toBe(200);
    const supervisor = await login(m.supervisors[0]!.subject);
    expect((await call(supervisor, 'GET', '/admin/accounts')).status).toBe(200);
    const me = await call(supervisor, 'GET', '/me');
    expect(me.json.permissions).toEqual([...legacyBundle('supervisor', { kind: 'operations', position: 'member' })].sort());
  });
});
