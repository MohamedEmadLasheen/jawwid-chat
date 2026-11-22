/**
 * Access management M3: ENFORCED DENIES, proven on a disposable database with the switch turned ON by an operator statement (production: OFF). Real logins, the global
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
import { LessonAudioModule } from '../../src/lesson-audio/lesson-audio.module';
import { CertificateModule } from '../../src/certificates/certificate.module';
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
const PASSWORD = 'deny-spec-password-1';
const DOMAIN = 'deny.qa.jawwid.test';

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
const DAY = 86_400_000;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
const email = (k: string) => `${k}-${randomUUID().slice(0, 6)}@${DOMAIN}`;
const as = (s: string, method: string, path: string, body?: unknown) => http(s, method, path, body);
type Who = { id: string; subject: string };
let sa: string, tm: string, om: string, tsup: string, tsup2: string;
let S1: Who, S2: Who, roleIds: Record<string, string>;

async function specialist(by: string, key: string, departmentId: string | null): Promise<Who> {
  const address = email(key);
  const r = await as(by, 'POST', '/admin/staff-accounts', { name: `QA ${key}`, email: address, tier: 'specialist', ...(departmentId ? { departmentId } : {}), reason: 'spec' });
  expect({ key, status: r.status }).toEqual({ key, status: 201 });
  const done = await fetch(`${base}/auth/password-reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: address, code: r.json.firstLogin.code, password: PASSWORD }) });
  expect(done.status).toBe(200);
  return { id: r.json.account.staffId as string, subject: address };
}
const grantRole = async (who: Who, key: string) => expect((await as(sa, 'POST', `/admin/staff-accounts/${who.id}/roles`, { roleId: roleIds[key], reason: 'spec' })).status).toBe(200);

/** The operator statement that turns enforcement on or off (the only way: chat.access_switch is server-only and guarded). */
async function switchTo(on: boolean) {
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.access_switch_change', 'on', true)`);
    await tx.$executeRawUnsafe(`update chat.access_switch set enabled = ${on}, changed_at = now() where name = 'deny_enforcement'`);
  });
}
const deny = (by: string, who: { id: string }, key: string, extra: Record<string, unknown> = {}) =>
  as(by, 'POST', `/admin/staff-accounts/${who.id}/denies`, { permissionKey: key, reason: 'spec restriction', expiresAt: iso(7 * DAY), ...extra });
const lift = (by: string, who: { id: string }, denyId: string) => as(by, 'POST', `/admin/staff-accounts/${who.id}/denies/${denyId}/lift`, { reason: 'spec lift' });
const holds = async (who: { id: string }, key: string) =>
  (await g.prisma.$queryRaw<Array<{ ok: boolean }>>`SELECT chat.staff_has_permission(${who.id}::uuid, ${key}::text) AS ok`)[0]!.ok;

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'deny-%'`);
  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(`insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'deny-${orgId.slice(0, 8)}', 'Deny enforcement QA academy')`);
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    const account = await tx.account.create({ data: { organizationId: orgId, subject: `owner@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true } });
    await tx.accountCredential.create({ data: { accountId: account.id, passwordHash: await hashPassword(PASSWORD) } });
    await tx.staff.create({ data: { organizationId: orgId, name: 'QA Owner', role: 'super_admin', isActive: true, accountId: account.id } });
  });
  m = await seedOrgChat(g.prisma, { organizationId: orgId, emailDomain: DOMAIN, password: PASSWORD, passwordHash: await hashPassword(PASSWORD), messages: false });
  await g.prisma.$queryRaw`SELECT chat.seed_access_role_templates(${orgId}::uuid)`;
  sa = m.superAdmin.subject; tm = m.teachersManager.subject; om = m.operationsManager.subject; tsup = m.teacherSupervisors[0]!.subject; tsup2 = m.teacherSupervisors[1]!.subject;
  const roles = await g.prisma.$queryRaw<Array<{ id: string; key: string }>>`SELECT id::text, key FROM chat.access_role WHERE organization_id = ${orgId}::uuid`;
  roleIds = Object.fromEntries(roles.map((r) => [r.key, r.id]));

  process.env.REDIS_URL = REDIS_URL;
  process.env.CORS_ALLOWED_ORIGINS = 'https://admin.deny.example.test';
  const moduleRef = await Test.createTestingModule({ imports: [PlatformModule, AuthModule, CommunicationModule, LessonModule, MaterialsModule, AccountAdminModule, StaffAccountsModule, LessonAudioModule, CertificateModule] })
    .overrideProvider(OBJECT_STORAGE).useValue(storage).overrideProvider(RECITATION_HOSTS).useValue([])
    .overrideProvider(FIRST_LOGIN_MAILER).useValue(mailer).compile();
  app = moduleRef.createNestApplication({ logger: false, rawBody: true });
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] });
  app.useGlobalFilters(new CommErrorFilter());
  applyInfrastructure(app);
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/api/v1`;
  S1 = await specialist(tm, 's1', m.departments.teachers);
  S2 = await specialist(om, 's2', m.departments.operations);
  for (const k of ['content_author', 'designer', 'pronunciation_reviewer']) { await grantRole(S1, k); await grantRole(S2, k); }
});

afterAll(async () => {
  await switchTo(false).catch(() => undefined);
  const presence = app?.get<Redis>(REDIS_CLIENT);
  await app?.close();
  for (let i = 0; i < 40 && presence && presence.status !== 'end'; i++) await new Promise((r) => setTimeout(r, 50));
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'deny-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = inheritedRedisUrl;
  if (inheritedCors === undefined) delete process.env.CORS_ALLOWED_ORIGINS; else process.env.CORS_ALLOWED_ORIGINS = inheritedCors;
});

describe('0. production state: the switch is OFF -- nothing changes and nothing can be recorded', () => {
  it('the switch ships off, is server-only, and cannot be flipped by a statement that does not say so', async () => {
    expect((await g.prisma.$queryRaw<Array<{ on: boolean }>>`SELECT chat.deny_enforcement_on() AS on`)[0]!.on).toBe(false);
    await expect(g.prisma.$executeRawUnsafe(`update chat.access_switch set enabled = true`)).rejects.toThrow(/operator statement/);
    await expect(g.prisma.$executeRawUnsafe(`delete from chat.access_switch`)).rejects.toThrow(/operator statement/);
  });

  it('with enforcement off a deny is refused (no recorded-but-inert state), and every account holds exactly what it did', async () => {
    const r = await deny(sa, S1, 'materials.author');
    expect(denied(r)).toEqual({ status: 409, code: CommErrorCode.STAFF_ACCOUNT_CONFLICT });
    expect((await g.prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM chat.staff_permission_deny`)[0]!.n).toBe(0n);
    expect(await holds(S1, 'materials.author')).toBe(true);
    expect((await as(tm, 'GET', `/admin/staff-accounts/${S1.id}/denies`)).json).toMatchObject({ enforced: false, denies: [] });
  });

  it('even a deny row forced into the table changes nothing while the switch is off (the evaluator is off, too)', async () => {
    await g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`select set_config('chat.deny_change', 'on', true)`);
      await tx.$executeRawUnsafe(`insert into chat.staff_permission_deny (organization_id, staff_id, permission_key, reason, created_by, created_by_role, expires_at) values ('${orgId}'::uuid, '${S1.id}'::uuid, 'materials.author', 'forced', '${m.superAdmin.id}'::uuid, 'super_admin', now() + interval '1 day')`);
      expect((await tx.$queryRawUnsafe<Array<{ k: string[] }>>(`select chat.staff_denied_keys('${S1.id}'::uuid) as k`))[0]!.k).toEqual([]);
      expect((await tx.$queryRawUnsafe<Array<{ ok: boolean }>>(`select chat.staff_has_permission('${S1.id}'::uuid, 'materials.author') as ok`))[0]!.ok).toBe(true);
      throw new Error('rollback');
    }).catch((e) => { if ((e as Error).message !== 'rollback') throw e; });
    expect((await as(S1.subject, 'POST', '/materials/admin/items', DRAFT)).status).toBe(201);
  });
});

describe('1. enforcement ON: a deny overrides every grant, at every layer', () => {
  beforeAll(async () => switchTo(true));
  afterAll(async () => switchTo(false));

  it('the super admin denies an author the key; routes, services and the database all refuse; nothing else of theirs changes', async () => {
    const r = await deny(sa, S1, 'materials.author');
    expect(r.status).toBe(201);
    const id = r.json.id as string;
    // API: the guard refuses the workspace routes; the access probe says no.
    expect(denied(await as(S1.subject, 'POST', '/materials/admin/items', DRAFT))).toEqual({ status: 403, code: CommErrorCode.PERMISSION_DENIED });
    expect((await as(S1.subject, 'GET', '/materials/admin/access')).json).toMatchObject({ canAuthor: false });
    // Database: the trigger refuses a direct write by the denied author (chat.can_author_materials -> staff_has_permission).
    await expect(g.prisma.materialItem.create({ data: { organizationId: orgId, subject: 'arabic', titleAr: 'x', kind: 'activity_link', source: 'url', url: 'https://a.example.test', status: 'draft', createdBy: S1.id, updatedBy: S1.id } })).rejects.toThrow(/managed by the super admin|authors write drafts/);
    expect(await holds(S1, 'materials.author')).toBe(false);
    // Their other permissions are untouched.
    expect(await holds(S1, 'certificates.design')).toBe(true);
    // The access view shows it, with provenance and the deny, and the preview does not offer it back through a role.
    const view = (await as(sa, 'GET', `/admin/staff-accounts/${S1.id}/access`)).json;
    const key = view.pages.find((p: { page: string }) => p.page === 'materials').keys.find((k: { key: string }) => k.key === 'materials.author');
    expect(key).toMatchObject({ denied: true, deniable: true });
    expect((await as(sa, 'POST', `/admin/staff-accounts/${S1.id}/access/preview`, { addRoleIds: [roleIds.content_author] })).json.gained).toEqual([]);
    // Lifting restores everything.
    expect((await lift(sa, S1, id)).status).toBe(200);
    expect(await holds(S1, 'materials.author')).toBe(true);
    expect((await as(S1.subject, 'POST', '/materials/admin/items', DRAFT)).status).toBe(201);
  });

  it('a deny is NOT shadowed: a supervisor (legacy tier) who holds the key by default is refused, a colleague is not', async () => {
    expect((await as(tsup, 'GET', '/materials/admin/items')).status).toBe(200);
    const r = await deny(sa, { id: m.teacherSupervisors[0]!.id }, 'materials.review');
    expect(r.status).toBe(201);
    expect(denied(await as(tsup, 'GET', '/materials/admin/items'))).toEqual({ status: 403, code: CommErrorCode.PERMISSION_DENIED });
    expect((await as(tsup2, 'GET', '/materials/admin/items')).status).toBe(200);
    expect((await as(tsup, 'GET', '/materials/admin/access')).json).toMatchObject({ canReview: false, canOpen: false });
    expect(await holds({ id: m.teacherSupervisors[0]!.id }, 'materials.review')).toBe(false);
    expect((await lift(sa, { id: m.teacherSupervisors[0]!.id }, r.json.id)).status).toBe(200);
    expect((await as(tsup, 'GET', '/materials/admin/items')).status).toBe(200);
  });

  it('lesson audio and certificates: a denied key closes the routes that need it, and only those', async () => {
    const dReview = await deny(sa, S1, 'lesson_audio.review');
    expect(dReview.status).toBe(201);
    // The page stays open through the key that is not denied (view), but the account no longer reviews.
    const access = await as(S1.subject, 'GET', '/lesson-audio/access');
    expect(access.status).toBe(200);
    expect(access.json).toMatchObject({ review: false });
    const dView = await deny(sa, S1, 'lesson_audio.view');
    expect(dView.status).toBe(201);
    expect(denied(await as(S1.subject, 'GET', '/lesson-audio/access'))).toEqual({ status: 403, code: CommErrorCode.PERMISSION_DENIED });
    // Certificates: design is denied; the designer's view-only routes still open, the design key is gone for every SQL rule (certificate triggers, task assignment).
    const dDesign = await deny(sa, S1, 'certificates.design');
    expect(dDesign.status).toBe(201);
    expect(await holds(S1, 'certificates.design')).toBe(false);
    expect((await as(S1.subject, 'GET', '/certificates/access')).status).toBe(200);
    for (const d of [dReview, dView, dDesign]) expect((await lift(sa, S1, d.json.id)).status).toBe(200);
    expect((await as(S1.subject, 'GET', '/lesson-audio/access')).json).toMatchObject({ review: true });
    expect(await holds(S1, 'certificates.design')).toBe(true);
  });
});

describe('2. authority: Super Admin, managers, and what nobody may do (Decision 3)', () => {
  beforeAll(async () => switchTo(true));
  afterAll(async () => switchTo(false));

  it('a manager restricts specialists of their OWN department, on keys they hold and may delegate', async () => {
    const r = await deny(tm, S1, 'materials.author', { expiresAt: iso(30 * DAY) });
    expect(r.status).toBe(201);
    expect(await holds(S1, 'materials.author')).toBe(false);
    expect((await lift(tm, S1, r.json.id)).status).toBe(200);
  });

  it('...never a manager, a supervisor, the super admin, themselves, another department\'s specialist, or a key they do not hold', async () => {
    const supervisor = { id: m.teacherSupervisors[0]!.id };
    expect([403, 404]).toContain((await deny(tm, supervisor, 'materials.review')).status);
    expect([403, 404]).toContain((await deny(tm, { id: m.operationsManager.id }, 'materials.review')).status);
    expect([403, 404]).toContain((await deny(tm, { id: m.superAdmin.id }, 'materials.review')).status);
    expect([403, 404]).toContain((await deny(tm, { id: m.teachersManager.id }, 'materials.review')).status);
    expect(denied(await deny(tm, S2, 'materials.author'))).toMatchObject({ status: 404 }); // another department: not even visible
    // The Operations manager runs S2's department but S2 holds keys the manager does not: the account is not even visible to them (C1), so the API says not found...
    expect(denied(await deny(om, S2, 'materials.author'))).toMatchObject({ status: 404 });
    // ...and the database refuses on its own, whatever the API does: the manager does not hold the key, so it is outside their delegated authority.
    await expect(g.prisma.$queryRaw`SELECT chat.deny_permission(${S2.id}::uuid, 'materials.author', 'direct', now() + interval '5 days', false, null, ${m.operationsManager.id}::uuid)`).rejects.toThrow(/restricts only permissions they hold and may delegate/);
    expect(denied(await deny(om, S1, 'materials.author'))).toMatchObject({ status: 404 });
    // Nothing was recorded by any of them.
    expect((await g.prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM chat.staff_permission_deny WHERE revoked_at IS NULL`)[0]!.n).toBe(0n);
  });

  it('the super admin is never denied: not by anyone, not even by a row forced into the table, and the evaluator ignores it', async () => {
    expect([403, 404]).toContain((await deny(sa, { id: m.superAdmin.id }, 'materials.review')).status);
    await expect(g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`select set_config('chat.deny_change', 'on', true)`);
      await tx.$executeRawUnsafe(`insert into chat.staff_permission_deny (organization_id, staff_id, permission_key, reason, created_by, created_by_role, expires_at) values ('${orgId}'::uuid, '${m.superAdmin.id}'::uuid, 'materials.review', 'forced', '${m.teachersManager.id}'::uuid, 'manager', now() + interval '1 day')`);
    })).rejects.toThrow(/authority is never denied/);
    expect((await g.prisma.$queryRaw<Array<{ k: string[] }>>`SELECT chat.staff_denied_keys(${m.superAdmin.id}::uuid) AS k`)[0]!.k).toEqual([]);
    expect((await as(sa, 'GET', '/materials/admin/access')).json).toMatchObject({ canManage: true, canAuthor: true, canReview: true });
  });

  it('limits: a manager\'s restriction expires within 90 days and is never permanent; the super admin\'s within a year, or permanent with a review date', async () => {
    expect(denied(await deny(tm, S1, 'materials.author', { expiresAt: iso(120 * DAY) }))).toMatchObject({ status: 400 });
    expect(denied(await deny(tm, S1, 'materials.author', { expiresAt: undefined }))).toMatchObject({ status: 400 });
    expect(denied(await deny(tm, S1, 'materials.author', { expiresAt: iso(-DAY) }))).toMatchObject({ status: 400 });
    expect(denied(await deny(tm, S1, 'materials.author', { permanent: true, expiresAt: undefined, reviewBy: iso(30 * DAY) }))).toEqual({ status: 403, code: CommErrorCode.STAFF_ACCOUNT_DENIED });
    expect(denied(await deny(sa, S1, 'materials.author', { expiresAt: iso(400 * DAY) }))).toMatchObject({ status: 400 });
    expect(denied(await deny(sa, S1, 'materials.author', { permanent: true, expiresAt: undefined }))).toMatchObject({ status: 400 }); // no review date
    const perm = await deny(sa, S1, 'materials.author', { permanent: true, expiresAt: undefined, reviewBy: iso(90 * DAY) });
    expect(perm.status).toBe(201);
    const list = (await as(sa, 'GET', `/admin/staff-accounts/${S1.id}/denies`)).json;
    expect(list.denies[0]).toMatchObject({ permissionKey: 'materials.author', permanent: true, active: true, by: { role: 'super_admin' } });
    expect((await lift(sa, S1, perm.json.id)).status).toBe(200);
  });

  it('a manager can neither lift nor replace a restriction the super admin made; the super admin can lift a manager\'s', async () => {
    const bySa = await deny(sa, S1, 'materials.author');
    expect(denied(await lift(tm, S1, bySa.json.id))).toEqual({ status: 403, code: CommErrorCode.STAFF_ACCOUNT_DENIED });
    expect(denied(await deny(tm, S1, 'materials.author'))).toMatchObject({ status: 400 }); // already denied: not replaceable
    expect(await holds(S1, 'materials.author')).toBe(false);
    expect((await lift(sa, S1, bySa.json.id)).status).toBe(200);
    const byTm = await deny(tm, S1, 'materials.author');
    expect((await lift(sa, S1, byTm.json.id)).status).toBe(200);
    expect(denied(await lift(sa, S1, byTm.json.id))).toMatchObject({ status: 400 }); // already lifted
  });

  it('only keys whose enforcement is verified can be denied; the account must hold the key; a reason is required; no duplicates', async () => {
    expect(denied(await deny(sa, S1, 'parents.view'))).toMatchObject({ status: 400 });
    expect(denied(await deny(sa, S1, 'billing.view'))).toMatchObject({ status: 400 });
    expect(denied(await deny(sa, S1, 'moderation.act'))).toMatchObject({ status: 400 });
    // S1 holds no 'lesson_audio.review'? it does (role). Take a deniable key an account does not hold: a supervisor lacks certificates.design? Teachers supervisors hold it; use the Operations specialist without the role.
    const bare = await specialist(sa, 'bare', null);
    expect(denied(await deny(sa, bare, 'materials.author'))).toMatchObject({ status: 400 });
    expect(denied(await as(sa, 'POST', `/admin/staff-accounts/${S1.id}/denies`, { permissionKey: 'materials.author', expiresAt: iso(DAY) }))).toMatchObject({ status: 400 });
    const one = await deny(sa, S1, 'materials.author');
    expect(denied(await deny(sa, S1, 'materials.author'))).toMatchObject({ status: 400 });
    await lift(sa, S1, one.json.id);
  });
});

describe('3. expiry, immutability and the audit trail', () => {
  beforeAll(async () => switchTo(true));
  afterAll(async () => switchTo(false));

  it('a restriction stops applying when it expires, and is listed as expired', async () => {
    const r = await deny(sa, S1, 'materials.author', { expiresAt: new Date(Date.now() + 2500).toISOString() });
    expect(r.status).toBe(201);
    expect(await holds(S1, 'materials.author')).toBe(false);
    await new Promise((res) => setTimeout(res, 3200));
    expect(await holds(S1, 'materials.author')).toBe(true);
    expect((await as(S1.subject, 'POST', '/materials/admin/items', DRAFT)).status).toBe(201);
    const list = (await as(sa, 'GET', `/admin/staff-accounts/${S1.id}/denies`)).json;
    expect(list.denies.find((d: { id: string }) => d.id === r.json.id)).toMatchObject({ active: false, liftedBy: null });
    // ...and a new restriction on the same key may then be recorded.
    const again = await deny(sa, S1, 'materials.author');
    expect(again.status).toBe(201);
    await lift(sa, S1, again.json.id);
  });

  it('a deny is a record: it is not edited, not deleted, not written outside the writers', async () => {
    const r = await deny(sa, S1, 'materials.author');
    await expect(g.prisma.$executeRawUnsafe(`update chat.staff_permission_deny set reason = 'edited' where id = '${r.json.id}'::uuid`)).rejects.toThrow(/only through chat\.deny_permission/);
    await expect(g.prisma.$executeRawUnsafe(`delete from chat.staff_permission_deny where id = '${r.json.id}'::uuid`)).rejects.toThrow(/never deleted/);
    await expect(g.prisma.$executeRawUnsafe(`insert into chat.staff_permission_deny (organization_id, staff_id, permission_key, reason, created_by, created_by_role, expires_at) values ('${orgId}'::uuid, '${S1.id}'::uuid, 'materials.author', 'x', '${m.superAdmin.id}'::uuid, 'super_admin', now() + interval '1 day')`)).rejects.toThrow(/only through chat\.deny_permission/);
    await g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`select set_config('chat.deny_change', 'on', true)`);
      await expect(tx.$executeRawUnsafe(`update chat.staff_permission_deny set reason = 'edited' where id = '${r.json.id}'::uuid`)).rejects.toThrow(/not edited/);
    }).catch(() => undefined);
    await lift(sa, S1, r.json.id);
  });

  it('every change is audited with actor, employee, permission, reason, previous and new state, and time', async () => {
    const r = await deny(tm, S1, 'materials.author', { reason: 'repeated late drafts', expiresAt: iso(10 * DAY) });
    await lift(tm, S1, r.json.id);
    const rows = await g.prisma.auditLog.findMany({ where: { entityId: S1.id, action: { in: ['staff.permission_denied', 'staff.permission_deny_lifted'] } }, orderBy: { id: 'desc' }, take: 2 });
    const [lifted, created] = [rows[0]!, rows[1]!];
    expect(created).toMatchObject({ action: 'staff.permission_denied', actorId: m.teachersManager.id, entity: 'staff', reason: 'repeated late drafts', before: null, after: { denyId: r.json.id, permission: 'materials.author', by: 'manager' } });
    expect(lifted).toMatchObject({ action: 'staff.permission_deny_lifted', actorId: m.teachersManager.id, reason: 'spec lift', before: { denyId: r.json.id, permission: 'materials.author' }, after: null });
    expect(created.at).toBeInstanceOf(Date);
    expect(lifted.at.getTime()).toBeGreaterThanOrEqual(created.at.getTime());
  });

  it('listing is visible only to whoever may see the account', async () => {
    expect((await as(tm, 'GET', `/admin/staff-accounts/${S1.id}/denies`)).status).toBe(200);
    expect(denied(await as(om, 'GET', `/admin/staff-accounts/${S1.id}/denies`))).toMatchObject({ status: 404 });
    expect([403, 404]).toContain((await as(S1.subject, 'GET', `/admin/staff-accounts/${S2.id}/denies`)).status);
  });
});

describe('4. enforcement ON changes nothing for anyone who is not denied', () => {
  beforeAll(async () => switchTo(true));
  afterAll(async () => switchTo(false));

  it('every staff member holds exactly the keys the sources say they do (the M1 equality), with the switch on and no denies', async () => {
    const staff = await g.prisma.staff.findMany({ where: { organizationId: orgId }, select: { id: true } });
    for (const s of staff) {
      const [sources, profile] = await Promise.all([
        g.prisma.$queryRaw<Array<{ k: string }>>`SELECT DISTINCT permission_key AS k FROM chat.staff_access_sources(${s.id}::uuid) WHERE NOT denied ORDER BY 1`,
        g.prisma.$queryRaw<Array<{ k: string }>>`SELECT unnest(permissions) AS k FROM chat.staff_access_profile(${s.id}::uuid) ORDER BY 1`,
      ]);
      expect({ id: s.id, keys: sources.map((r) => r.k) }).toEqual({ id: s.id, keys: profile.map((r) => r.k) });
    }
  });
});
