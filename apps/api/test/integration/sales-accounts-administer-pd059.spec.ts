/**
 * PD-59 (owner decision 2026-11-21): a Sales representative -- and the Sales manager -- do not administer
 * family login accounts, not even those of a family they own. Over real HTTP on the real database (the
 * migration chain, the global bearer guard, the real routes and guards). Synthetic people only.
 *
 *   - Sales representative A OWNS a converted family (chat.family_sales_owner, set by the Sales manager as
 *     the product does). Every /admin/accounts route, the family-access grants and the support-session
 *     start answer 403 for them, for their own family and for another's. Nothing is written.
 *   - The Sales manager gets the same refusals (decision recorded in docs/admin/pd059-sales-accounts-administer.md).
 *   - Operations (supervisor of the family, and the Operations manager) and the super admin keep every act.
 *   - The Sales hand-over that legitimately matters is NOT lost: a representative still holds
 *     new_students.manage (the first sign-in e-mail goes through the intake route, not through Accounts).
 *   - The database mirror of the bundles agrees (chat.legacy_permission_bundle).
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
const PASSWORD = 'pd59-accounts-spec-password-1';
const DOMAIN = 'pd59acc.qa.jawwid.test';

const g = buildGraph();
let app: INestApplication;
let base: string;
let m: SeedManifest;
let orgId: string;

const who: Record<string, { id: string; subject: string }> = {};
const tokens = new Map<string, string>();
let ownedFamily: SeedManifest['families'][number]; // owned by rep A
let otherFamily: SeedManifest['families'][number]; // owned by rep B

async function tokenFor(subject: string): Promise<string> {
  if (!tokens.has(subject)) tokens.set(subject, (await app.get(AuthService).login(subject, PASSWORD)).accessToken);
  return tokens.get(subject)!;
}

type Res = { status: number; code?: string; json: any };
async function http(actor: string, method: string, path: string, body?: unknown): Promise<Res> {
  const send = body !== undefined && method !== 'GET';
  const headers: Record<string, string> = send ? { 'content-type': 'application/json' } : {};
  headers.authorization = `Bearer ${await tokenFor(who[actor]!.subject)}`;
  const r = await fetch(`${base}${path}`, { method, headers, body: send ? JSON.stringify(body) : undefined });
  const json = (await r.json().catch(() => ({}))) as any;
  return { status: r.status, code: json?.error?.code, json };
}

const accountIdOf = async (subject: string) =>
  (await g.prisma.account.findUniqueOrThrow({ where: { subject }, select: { id: true } })).id;

/** A Sales representative: a staff member of role admin, a member of the Sales department. */
async function salesRep(key: string): Promise<void> {
  const subject = `${key}@${DOMAIN}`;
  const account = await g.prisma.account.create({ data: { organizationId: orgId, subject, kind: 'staff', status: 'active', isActive: true } });
  await g.prisma.accountCredential.create({ data: { accountId: account.id, passwordHash: await hashPassword(PASSWORD) } });
  const s = await g.prisma.staff.create({ data: { organizationId: orgId, name: key, role: 'admin', isActive: true, accountId: account.id } });
  await g.prisma.$executeRawUnsafe(
    `insert into chat.department_member (staff_id, organization_id, department_id, position) values ($1::uuid, $2::uuid, $3::uuid, 'supervisor')`,
    s.id, orgId, m.departments.sales,
  );
  who[key] = { id: s.id, subject };
}

/** The Sales manager assigns the family's owner, as the product does. */
const own = (family: SeedManifest['families'][number], rep: string) =>
  g.prisma.$executeRawUnsafe(
    `insert into chat.family_sales_owner (family_id, organization_id, staff_id, assigned_by) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid)`,
    family.id, orgId, who[rep]!.id, who.salesManager!.id,
  );

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd59acc-%'`);
  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'pd59acc-${orgId.slice(0, 8)}', 'PD-59 accounts QA academy')`,
  );
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    const account = await tx.account.create({ data: { organizationId: orgId, subject: `owner@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true } });
    await tx.accountCredential.create({ data: { accountId: account.id, passwordHash: await hashPassword(PASSWORD) } });
    await tx.staff.create({ data: { organizationId: orgId, name: 'QA Organization Owner', role: 'super_admin', isActive: true, accountId: account.id } });
  });
  m = await seedOrgChat(g.prisma, {
    organizationId: orgId, emailDomain: DOMAIN, password: PASSWORD, passwordHash: await hashPassword(PASSWORD), messages: false,
  });
  who.superAdmin = { id: m.superAdmin.id, subject: m.superAdmin.subject };
  who.salesManager = { id: m.salesManager.id, subject: m.salesManager.subject };
  who.opsManager = { id: m.operationsManager.id, subject: m.operationsManager.subject };
  who.ops = { id: m.supervisors[0]!.id, subject: m.supervisors[0]!.subject };
  await salesRep('repA');
  await salesRep('repB');

  // A family the Operations supervisor reaches (supervises a child of), owned by rep A; and one owned by rep B.
  ownedFamily = m.families.find((f) => f.children.some((c) => c.supervisorId === m.supervisors[0]!.id))!;
  otherFamily = m.families.find((f) => f.id !== ownedFamily.id && !f.children.some((c) => c.supervisorId === m.supervisors[0]!.id))!;
  await own(ownedFamily, 'repA');
  await own(otherFamily, 'repB');

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
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd59acc-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
});

describe('PD-59: Sales does not administer family login accounts', () => {
  it('the fixture is what the decision talks about: rep A owns the family, in the database', async () => {
    const [{ owns }] = await g.prisma.$queryRawUnsafe<Array<{ owns: boolean }>>(
      `select chat.staff_owns_family($1::uuid, $2::uuid) as owns`, who.repA!.id, ownedFamily.id,
    );
    expect(owns).toBe(true);
  });

  /**
   * PermissionGuard is in SHADOW mode (permission.guard.ts, PD-40 PR-6 flips it), so TODAY the enforcing
   * layer is AccountAdminService + canAdministerAccount (account-admin-policy.ts); the bundle row is what
   * the guard will refuse on once it enforces. This asserts the behaviour a caller sees now, whichever
   * layer gives it.
   */
  it.each([['repA'], ['repB'], ['salesManager']])('%s: no Accounts route serves anything, for an owned family or for another', async (actor) => {
    const refusals: unknown[] = [];
    for (const family of [ownedFamily, otherFamily]) {
      const id = await accountIdOf(family.parent.subject);
      // The list and the search are empty (administers: []), never a family account.
      for (const path of ['/admin/accounts', `/admin/accounts?q=${encodeURIComponent(family.parent.name)}`, '/admin/accounts?kind=family']) {
        const r = await http(actor, 'GET', path);
        expect({ path, status: r.status, accounts: r.json.accounts, administers: r.json.administers }).toEqual({ path, status: 200, accounts: [], administers: [] });
      }
      // A single account reads as not found; every act and the session list are refused.
      const read = await http(actor, 'GET', `/admin/accounts/${id}`);
      expect({ status: read.status, code: read.code }).toEqual({ status: 404, code: CommErrorCode.ACCOUNT_ADMIN_NOT_FOUND });
      for (const [method, path, body] of [
        ['POST', `/admin/accounts/${id}/password-reset`, { reason: 'try' }],
        ['POST', `/admin/accounts/${id}/suspend`, { reason: 'try' }],
        ['POST', `/admin/accounts/${id}/reactivate`, { reason: 'try' }],
        ['GET', `/admin/accounts/${id}/sessions`, undefined],
        ['POST', `/admin/accounts/${id}/sessions/revoke-all`, { reason: 'try' }],
        ['POST', `/admin/accounts/${id}/sessions/${randomUUID()}/revoke`, { reason: 'try' }],
        ['POST', '/admin/impersonations', { accountId: id, reason: 'try' }],
      ] as const) {
        const r = await http(actor, method, path, body);
        refusals.push({ method, path: path.replace(id, 'ID'), status: r.status, code: r.code });
        expect({ actor, method, path, status: r.status, code: r.code }).toEqual({ actor, method, path, status: 403, code: CommErrorCode.ACCOUNT_ADMIN_DENIED });
      }
    }
    // The exceptional family-access grants: nothing to see, nothing to give.
    const grants = await http(actor, 'GET', '/admin/family-access-grants');
    expect({ status: grants.status, grants: grants.json.grants, canGrant: grants.json.canGrant }).toEqual({ status: 200, grants: [], canGrant: false });
    const grant = await http(actor, 'POST', '/admin/family-access-grants', { familyId: ownedFamily.id, granteeId: who.ops!.id, purpose: 'try', hours: 1 });
    expect(grant.status).toBe(403);
    // Nothing was written.
    expect(await g.prisma.passwordResetCode.count({ where: { organizationId: orgId } })).toBe(0);
    expect(await g.prisma.impersonationSession.count({ where: { organizationId: orgId } })).toBe(0);
    expect(await g.prisma.auditLog.count({ where: { action: { startsWith: 'account.' } } })).toBe(0);
    expect(refusals.length).toBe(14);
  });

  it('the permission is absent from their effective permissions; the Sales hand-over keys stay', async () => {
    for (const actor of ['repA', 'salesManager']) {
      const me = await http(actor, 'GET', '/me');
      expect(me.status).toBe(200);
      const keys = me.json.permissions as string[];
      expect(keys).not.toContain('accounts.administer');
      expect(keys).not.toContain('accounts.support_session');
      // The legitimate Sales hand-over (first sign-in e-mail, contact record, payments) rests on these:
      expect(keys).toEqual(expect.arrayContaining(['new_students.manage', 'parents.edit', 'billing.record']));
    }
  });

  it('the database mirror agrees: no Sales bundle row grants accounts.administer', async () => {
    const rows = await g.prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `select count(*)::int as n from chat.legacy_permission_bundle where department_kind = 'sales' and permission_key = 'accounts.administer'`,
    );
    expect(rows[0]!.n).toBe(0);
  });

  it('Operations and the super admin keep every act on a family account (including one a rep owns)', async () => {
    const id = await accountIdOf(ownedFamily.parent.subject);
    const list = await http('ops', 'GET', '/admin/accounts');
    expect(list.status).toBe(200);
    expect(list.json.administers).toEqual(['family']);
    expect((await http('ops', 'GET', `/admin/accounts/${id}`)).status).toBe(200);
    expect((await http('ops', 'GET', `/admin/accounts/${id}/sessions`)).status).toBe(200);
    const opsReset = await http('ops', 'POST', `/admin/accounts/${id}/password-reset`, { reason: 'parent forgot the password' });
    expect(opsReset.status).toBe(201);
    expect(opsReset.json.code).toMatch(/^[0-9]{6}$/);

    const otherId = await accountIdOf(otherFamily.parent.subject);
    for (const actor of ['opsManager', 'superAdmin']) {
      expect((await http(actor, 'GET', `/admin/accounts/${otherId}`)).status).toBe(200);
      const reset = await http(actor, 'POST', `/admin/accounts/${otherId}/password-reset`, { reason: 'parent forgot the password' });
      expect({ actor, status: reset.status }).toEqual({ actor, status: 201 });
      expect((await http(actor, 'POST', `/admin/accounts/${otherId}/sessions/revoke-all`, { reason: 'lost phone' })).status).toBe(200);
    }
    expect((await http('superAdmin', 'POST', `/admin/accounts/${otherId}/suspend`, { reason: 'check' })).status).toBe(200);
    expect((await http('superAdmin', 'POST', `/admin/accounts/${otherId}/reactivate`, { reason: 'check done' })).status).toBe(200);
    // An Operations manager's code only ever came from an Operations or super-admin hand.
    expect(await g.prisma.passwordResetCode.count({ where: { accountId: id } })).toBe(1);
  });

  it('an owned family is refused exactly like a foreign one: ownership confers nothing', async () => {
    const own = await http('repA', 'POST', `/admin/accounts/${await accountIdOf(ownedFamily.parent.subject)}/password-reset`, { reason: 'try' });
    const foreign = await http('repA', 'POST', `/admin/accounts/${await accountIdOf(otherFamily.parent.subject)}/password-reset`, { reason: 'try' });
    expect({ status: own.status, code: own.code }).toEqual({ status: foreign.status, code: foreign.code });
    expect(own.status).toBe(403);
  });
});
