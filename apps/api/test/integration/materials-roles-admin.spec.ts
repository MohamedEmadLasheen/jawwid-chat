/**
 * Content author role management and the materials lifecycle's audit trail (pre-merge audit). Real logins, the global
 * bearer guard, the real routes and the real database triggers (supabase/migrations/20261122100000_chat_materials_author_review.sql).
 *
 *   1. who is offered the workspace, and with which jobs (GET /materials/admin/access)
 *   2. an author writes DRAFTS, edits only their own, submits them; cannot publish, retire, import or touch recitations
 *   3. a reviewer (a Teachers supervisor) approves or returns an item IN REVIEW -- never their own, never rewriting it
 *   4. the manager keeps every right; Operations and a teacher have none
 *   5. what has not been approved is never served: not to a family, not to a teacher, not to a report picker
 *   6. the database refuses what the API would refuse (a direct write)
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
import { OBJECT_STORAGE } from '@platform/tokens';
import { RECITATION_HOSTS } from '../../src/materials/recitation-hosts';
import { CommunicationModule } from '@communication/communication.module';
import { CommErrorFilter } from '@communication/api/http-exception.filter';
import { REDIS_CLIENT } from '@communication/realtime/redis.provider';
import type { ObjectStorage } from '@communication/attachments/object-storage';
import { applyInfrastructure } from '../../src/infra/http/bootstrap';
import { LessonModule } from '../../src/lessons/lesson.module';
import { AccountAdminModule } from '../../src/account-admin/account-admin.module';
import { FIRST_LOGIN_MAILER, type MailSender } from '../../src/account-recovery/recovery-delivery';
import { StaffAccountsModule } from '../../src/staff-accounts/staff-accounts.module';
import { MaterialsModule } from '../../src/materials/materials.module';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildGraph, truncate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';
jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const inheritedCors = process.env.CORS_ALLOWED_ORIGINS;
const PASSWORD = 'matadm-spec-password-1';
const DOMAIN = 'matadm.qa.jawwid.test';

/** Storage is not what is under test: a grant is recorded, nothing is read back. */
const storage = {
  async authorizeUpload(p: { prefix: string; mimeType: string; byteSize: number }) {
    const objectKey = `${p.prefix}/${randomUUID()}`;
    return { objectKey, uploadUrl: `https://storage.example.test/${objectKey}`, method: 'PUT' as const, headers: {}, expiresAt: new Date(Date.now() + 300_000) };
  },
} as unknown as ObjectStorage;

const g = buildGraph();
let app: INestApplication;
let base: string;
let m: SeedManifest;
let orgId: string;
const tokens = new Map<string, string>();
const ids = new Map<string, string>();

async function http(subject: string | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = body ? { 'content-type': 'application/json' } : {};
  if (subject) {
    if (!tokens.has(subject)) tokens.set(subject, (await app.get(AuthService).login(subject, PASSWORD)).accessToken);
    headers.authorization = `Bearer ${tokens.get(subject)!}`;
  }
  const r = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = (await r.json().catch(() => ({}))) as { error?: { code?: string; message?: string } } & Record<string, any>;
  return { status: r.status, code: json.error?.code, json };
}


const denied = (r: { status: number; code?: string }) => ({ status: r.status, code: r.code });
const mailer: MailSender = { async send() { return false; } } as unknown as MailSender;
const DRAFT = { titleAr: 'نشاط', titleEn: 'Activity', subject: 'arabic', url: 'https://activities.example.test/a' };
let superAdmin: string, tm: string, om: string, tsup: string, roleId: string;
let tDeptSpecialist: { id: string; subject: string }, oDeptSpecialist: { id: string; subject: string }, freeSpecialist: { id: string; subject: string };
const email = (k: string) => `${k}-${randomUUID().slice(0, 6)}@${DOMAIN}`;
const as = (s: string, method: string, path: string, body?: unknown) => http(s, method, path, body);

/** A specialist the managers created through the real endpoint, then activated so it can sign in. */
async function specialist(by: string, key: string, departmentId: string | null): Promise<{ id: string; subject: string }> {
  const address = email(key);
  const r = await as(by, 'POST', '/admin/staff-accounts', { name: `QA ${key}`, email: address, tier: 'specialist', ...(departmentId ? { departmentId } : {}), reason: 'spec' });
  expect({ key, status: r.status }).toEqual({ key, status: 201 });
  const id = r.json.account.staffId as string;
  // The real first sign-in: the code the creation returned (no mail channel here), exchanged for a password.
  const done = await fetch(`${base}/auth/password-reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: address, code: r.json.firstLogin.code, password: PASSWORD }) });
  expect(done.status).toBe(200);
  return { id, subject: address };
}

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'matadm-%'`);
  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(`insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'matadm-${orgId.slice(0, 8)}', 'Materials role admin QA academy')`);
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    const account = await tx.account.create({ data: { organizationId: orgId, subject: `owner@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true } });
    await tx.accountCredential.create({ data: { accountId: account.id, passwordHash: await hashPassword(PASSWORD) } });
    await tx.staff.create({ data: { organizationId: orgId, name: 'QA Owner', role: 'super_admin', isActive: true, accountId: account.id } });
  });
  m = await seedOrgChat(g.prisma, { organizationId: orgId, emailDomain: DOMAIN, password: PASSWORD, passwordHash: await hashPassword(PASSWORD), messages: false });
  await g.prisma.$queryRaw`SELECT chat.seed_access_role_templates(${orgId}::uuid)`;
  superAdmin = m.superAdmin.subject; tm = m.teachersManager.subject; om = m.operationsManager.subject; tsup = m.teacherSupervisors[0]!.subject;
  roleId = (await g.prisma.$queryRaw<Array<{ id: string }>>`SELECT id::text FROM chat.access_role WHERE organization_id = ${orgId}::uuid AND key = 'content_author'`)[0]!.id;

  process.env.REDIS_URL = REDIS_URL;
  process.env.CORS_ALLOWED_ORIGINS = 'https://admin.matadm.example.test';
  const moduleRef = await Test.createTestingModule({ imports: [PlatformModule, AuthModule, CommunicationModule, LessonModule, MaterialsModule, AccountAdminModule, StaffAccountsModule] })
    .overrideProvider(OBJECT_STORAGE).useValue(storage).overrideProvider(RECITATION_HOSTS).useValue([])
    .overrideProvider(FIRST_LOGIN_MAILER).useValue(mailer).compile();
  app = moduleRef.createNestApplication({ logger: false, rawBody: true });
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] });
  app.useGlobalFilters(new CommErrorFilter());
  applyInfrastructure(app);
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/api/v1`;
  tDeptSpecialist = await specialist(tm, 'tdept', m.departments.teachers);
  oDeptSpecialist = await specialist(om, 'odept', m.departments.operations);
  freeSpecialist = await specialist(superAdmin, 'free', null);
});

afterAll(async () => {
  const presence = app?.get<Redis>(REDIS_CLIENT);
  await app?.close();
  for (let i = 0; i < 40 && presence && presence.status !== 'end'; i++) await new Promise((r) => setTimeout(r, 50));
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'matadm-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = inheritedRedisUrl;
  if (inheritedCors === undefined) delete process.env.CORS_ALLOWED_ORIGINS; else process.env.CORS_ALLOWED_ORIGINS = inheritedCors;
});

const grant = (by: string, who: { id: string }) => as(by, 'POST', `/admin/staff-accounts/${who.id}/roles`, { roleId, reason: 'designated content author' });
const revoke = (by: string, who: { id: string }) => as(by, 'POST', `/admin/staff-accounts/${who.id}/roles/${roleId}/revoke`, { reason: 'no longer writing' });
const canAuthor = async (who: { subject: string }) => (await as(who.subject, 'GET', '/materials/admin/access')).json.canAuthor === true;
const DENIED_ACCOUNT = { status: 403, code: CommErrorCode.STAFF_ACCOUNT_DENIED };
/** An account outside the manager's own department is not even visible to them. */
const NOT_VISIBLE = { status: 404, code: CommErrorCode.STAFF_ACCOUNT_NOT_FOUND };

describe('1. who assigns and removes the Content author role (Admin Web: Staff accounts, no database edits)', () => {
  it('the role is in the catalogue for every organization, grantable by the super admin and the Teachers manager but not the Operations manager', async () => {
    const view = async (s: string) => ((await as(s, 'GET', '/admin/access-roles')).json.roles as Array<{ key: string; grantable: boolean; permissions: string[]; maxTier: string }>).find((r) => r.key === 'content_author');
    expect(await view(superAdmin)).toMatchObject({ grantable: true, permissions: ['materials.author'], maxTier: 'specialist' });
    expect(await view(tm)).toMatchObject({ grantable: true });
    expect(await view(om)).toMatchObject({ grantable: false });
  });

  it('the Teachers manager grants it to a specialist of the Teachers department, who can then write drafts; revoking takes it away', async () => {
    expect(await canAuthor(tDeptSpecialist)).toBe(false);
    expect(denied(await as(tDeptSpecialist.subject, 'POST', '/materials/admin/items', DRAFT))).toMatchObject({ status: 403 });
    expect((await grant(tm, tDeptSpecialist)).status).toBe(200);
    expect(await canAuthor(tDeptSpecialist)).toBe(true);
    expect((await as(tDeptSpecialist.subject, 'POST', '/materials/admin/items', DRAFT)).status).toBe(201);
    expect((await revoke(tm, tDeptSpecialist)).status).toBe(200);
    expect(await canAuthor(tDeptSpecialist)).toBe(false);
    expect(denied(await as(tDeptSpecialist.subject, 'POST', '/materials/admin/items', DRAFT))).toMatchObject({ status: 403 });
  });

  it('routine onboarding: the Teachers manager creates a new specialist already holding the role', async () => {
    const r = await as(tm, 'POST', '/admin/staff-accounts', { name: 'QA New Author', email: email('newauthor'), tier: 'specialist', departmentId: m.departments.teachers, roleIds: [roleId], reason: 'new content writer' });
    expect(r.status).toBe(201);
    expect(r.json.account.roles).toEqual([expect.objectContaining({ key: 'content_author' })]);
  });

  it('unauthorized managers cannot grant it: Operations (H3/H5), a Teachers supervisor, an author for another, a manager outside the specialist\'s department', async () => {
    expect(denied(await grant(om, oDeptSpecialist))).toEqual(DENIED_ACCOUNT);
    expect(denied(await grant(om, tDeptSpecialist))).toEqual(NOT_VISIBLE);
    expect(denied(await grant(tm, oDeptSpecialist))).toEqual(NOT_VISIBLE);
    // A supervisor holds no staff_accounts.manage: refused outright (and an account is invisible to anyone who may not manage it).
    expect([403, 404]).toContain((await grant(tsup, tDeptSpecialist)).status);
    await grant(superAdmin, tDeptSpecialist);
    expect([403, 404]).toContain((await grant(tDeptSpecialist.subject, freeSpecialist)).status);
    expect(await canAuthor(oDeptSpecialist)).toBe(false);
    expect(await canAuthor(freeSpecialist)).toBe(false);
  });

  it('a specialist with no department can only be designated by the super admin', async () => {
    expect(denied(await grant(tm, freeSpecialist))).toEqual(NOT_VISIBLE);
    expect((await grant(superAdmin, freeSpecialist)).status).toBe(200);
    expect(await canAuthor(freeSpecialist)).toBe(true);
    expect((await revoke(superAdmin, freeSpecialist)).status).toBe(200);
  });

  it('every grant and revoke is audited with who did it and when', async () => {
    const rows = await g.prisma.auditLog.findMany({ where: { entityId: tDeptSpecialist.id, action: { in: ['staff.access_role_granted', 'staff.access_role_revoked'] } }, orderBy: { id: 'asc' } });
    expect(rows.map((r) => r.action)).toEqual(['staff.access_role_granted', 'staff.access_role_revoked', 'staff.access_role_granted']);
    expect(rows.map((r) => r.actorId)).toEqual([m.teachersManager.id, m.teachersManager.id, m.superAdmin.id]);
    for (const r of rows) { expect(r.at).toBeInstanceOf(Date); expect(r.reason.length).toBeGreaterThan(0); }
  });
});

describe('2. the lifecycle, and what the audit trail says', () => {
  it('draft -> in review -> returned -> corrected -> resubmitted -> approved, each step by the right person, each audited with actor and time', async () => {
    const author = freeSpecialist; await grant(superAdmin, author);
    const reviewerA = tsup; const reviewerB = m.teacherSupervisors[1]!.subject;
    const created = await as(author.subject, 'POST', '/materials/admin/items', DRAFT);
    const id = created.json.id as string;
    const step = (s: string, body: object) => as(s, 'POST', `/materials/admin/items/${id}`, body);
    expect((await step(author.subject, { status: 'in_review' })).json.status).toBe('in_review');
    expect((await step(reviewerA, { status: 'draft' })).json.status).toBe('draft');
    expect((await step(author.subject, { titleEn: 'Corrected' })).json).toMatchObject({ titleEn: 'Corrected', status: 'draft' });
    expect((await step(author.subject, { status: 'in_review' })).json.status).toBe('in_review');
    expect((await step(reviewerB, { status: 'published' })).json.status).toBe('published');
    const rows = await g.prisma.auditLog.findMany({ where: { entityId: id, entity: 'material_item' }, orderBy: { id: 'asc' } });
    const authorId = author.id, a = m.teacherSupervisors[0]!.id, b = m.teacherSupervisors[1]!.id;
    expect(rows.map((r) => [r.action, (r.before as any)?.status ?? null, (r.after as any)?.status, r.actorId])).toEqual([
      ['material.created', null, 'draft', authorId],
      ['material.updated', 'draft', 'in_review', authorId],
      ['material.updated', 'in_review', 'draft', a],
      ['material.updated', 'draft', 'draft', authorId],
      ['material.updated', 'draft', 'in_review', authorId],
      ['material.updated', 'in_review', 'published', b],
    ]);
    for (const r of rows) { expect(r.at).toBeInstanceOf(Date); expect(r.reason.length).toBeGreaterThan(0); }
    // Time never runs backwards.
    expect(rows.map((r) => r.at.getTime())).toEqual([...rows.map((r) => r.at.getTime())].sort((x, y) => x - y));
  });

  it('the reviewer who returned an item may approve its resubmission, the author never; the author cannot touch it once published', async () => {
    const author = freeSpecialist;
    const id = (await as(author.subject, 'POST', '/materials/admin/items', { ...DRAFT, titleEn: 'Second' })).json.id as string;
    const step = (s: string, body: object) => as(s, 'POST', `/materials/admin/items/${id}`, body);
    await step(author.subject, { status: 'in_review' });
    expect(denied(await step(author.subject, { status: 'published' }))).toMatchObject({ status: 403 });
    await step(tsup, { status: 'draft' });
    await step(author.subject, { status: 'in_review' });
    expect((await step(tsup, { status: 'published' })).json.status).toBe('published');
    expect(denied(await step(author.subject, { titleEn: 'Too late' }))).toMatchObject({ status: 403 });
  });
});

describe('3. access management M1: the effective-access view (read-only) and its preview', () => {
  const view = (by: string, who: { id: string }) => as(by, 'GET', `/admin/staff-accounts/${who.id}/access`);
  const preview = (by: string, who: { id: string }, body: object) => as(by, 'POST', `/admin/staff-accounts/${who.id}/access/preview`, body);

  it('the view says what each staff member holds EXACTLY as the permission function does, for every staff member (and so no one is shown more or less)', async () => {
    const staff = await g.prisma.staff.findMany({ where: { organizationId: orgId }, select: { id: true } });
    expect(staff.length).toBeGreaterThan(10);
    for (const s of staff) {
      const [sources, profile] = await Promise.all([
        g.prisma.$queryRaw<Array<{ k: string }>>`SELECT DISTINCT permission_key AS k FROM chat.staff_access_sources(${s.id}::uuid) WHERE NOT denied ORDER BY 1`,
        g.prisma.$queryRaw<Array<{ k: string }>>`SELECT unnest(permissions) AS k FROM chat.staff_access_profile(${s.id}::uuid) ORDER BY 1`,
      ]);
      expect({ id: s.id, keys: sources.map((r) => r.k) }).toEqual({ id: s.id, keys: profile.map((r) => r.k) });
    }
  });

  it('shows provenance: a role with who granted it and why; a tier default; the super admin\'s own power', async () => {
    await grant(superAdmin, tDeptSpecialist);
    const r = await view(tm, tDeptSpecialist);
    expect(r.status).toBe(200);
    const materials = r.json.pages.find((p: { page: string }) => p.page === 'materials');
    expect(materials.keys).toEqual([
      expect.objectContaining({
        key: 'materials.author',
        sources: [expect.objectContaining({ type: 'role', roleKey: 'content_author', reason: 'designated content author', grantedBy: expect.objectContaining({ id: m.superAdmin.id }) })],
      }),
    ]);
    // A Teachers supervisor's review right is the tier-and-department default, not a role.
    const sup = await view(superAdmin, { id: m.teacherSupervisors[0]!.id });
    const review = sup.json.pages.find((p: { page: string }) => p.page === 'materials').keys.find((k: { key: string }) => k.key === 'materials.review');
    expect(review.sources).toEqual([{ type: 'tier_default' }]);
    // The super admin holds every key, all from the one source.
    const owner = await view(superAdmin, { id: m.teachersManager.id });
    expect(owner.status).toBe(200);
  });

  it('is visible only to who may see the account: the Teachers manager sees their department, not Operations\'; a supervisor and an author see nothing', async () => {
    expect((await view(tm, tDeptSpecialist)).status).toBe(200);
    expect(denied(await view(om, tDeptSpecialist))).toEqual(NOT_VISIBLE);
    expect(denied(await view(tm, oDeptSpecialist))).toEqual(NOT_VISIBLE);
    expect([403, 404]).toContain((await view(tsup, tDeptSpecialist)).status);
    expect([403, 404]).toContain((await view(tDeptSpecialist.subject, freeSpecialist)).status);
  });

  it('previews adding and removing a role without changing anything', async () => {
    const before = await g.prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM chat.staff_access_role`;
    const audits = await g.prisma.auditLog.count();
    const add = await preview(superAdmin, oDeptSpecialist, { addRoleIds: [roleId] });
    expect(add.status).toBe(200);
    expect(add.json).toMatchObject({ gained: ['materials.author'], lost: [], pagesGained: ['materials'], pagesLost: [] });
    const rm = await preview(superAdmin, tDeptSpecialist, { removeRoleIds: [roleId] });
    expect(rm.json).toMatchObject({ gained: [], lost: ['materials.author'], pagesLost: ['materials'] });
    expect((await preview(superAdmin, tDeptSpecialist, { addRoleIds: ['not-a-uuid'] })).status).toBe(400);
    const after = await g.prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM chat.staff_access_role`;
    expect(after[0]!.n).toBe(before[0]!.n);
    expect(await g.prisma.auditLog.count()).toBe(audits);
    // The Operations manager cannot preview for an account they cannot reach.
    expect(denied(await preview(om, tDeptSpecialist, { addRoleIds: [roleId] }))).toEqual(NOT_VISIBLE);
  });
});
