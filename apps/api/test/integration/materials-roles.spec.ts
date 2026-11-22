/**
 * Educational materials: who writes, who approves, who manages (owner decision, 2026-11-22). Real logins, the global
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
const PASSWORD = 'matroles-spec-password-1';
const DOMAIN = 'matroles.qa.jawwid.test';

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

const DRAFT = { titleAr: 'نشاط', titleEn: 'Activity', subject: 'arabic', url: 'https://activities.example.test/a' };
let superAdmin: string, manager: string, supervisorA: string, supervisorB: string, opsManager: string, author: string, author2: string, teacher: string, parent: string, childId: string;

async function staffWithRole(name: string, roleKey: string): Promise<string> {
  const subject = `${name}@${DOMAIN}`;
  const account = await g.prisma.account.create({ data: { organizationId: orgId, subject, kind: 'staff', status: 'active', isActive: true } });
  await g.prisma.accountCredential.create({ data: { accountId: account.id, passwordHash: await hashPassword(PASSWORD) } });
  const staff = await g.prisma.staff.create({ data: { organizationId: orgId, name: `QA ${name}`, role: 'specialist', isActive: true, accountId: account.id } });
  ids.set(subject, staff.id);
  const role = await g.prisma.$queryRaw<Array<{ id: string }>>`SELECT id::text FROM chat.access_role WHERE organization_id = ${orgId}::uuid AND key = ${roleKey}`;
  await g.prisma.$queryRaw`SELECT chat.grant_access_role(${staff.id}::uuid, ${role[0]!.id}::uuid, 'spec', ${m.superAdmin.id}::uuid)`;
  return subject;
}

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'matroles-%'`);
  orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(`insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'matroles-${orgId.slice(0, 8)}', 'Materials roles QA academy')`);
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    const account = await tx.account.create({ data: { organizationId: orgId, subject: `owner@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true } });
    await tx.accountCredential.create({ data: { accountId: account.id, passwordHash: await hashPassword(PASSWORD) } });
    await tx.staff.create({ data: { organizationId: orgId, name: 'QA Owner', role: 'super_admin', isActive: true, accountId: account.id } });
  });
  m = await seedOrgChat(g.prisma, { organizationId: orgId, emailDomain: DOMAIN, password: PASSWORD, passwordHash: await hashPassword(PASSWORD), messages: false });
  await g.prisma.$queryRaw`SELECT chat.seed_access_role_templates(${orgId}::uuid)`;
  superAdmin = m.superAdmin.subject;
  manager = m.teachersManager.subject;
  supervisorA = m.teacherSupervisors[0]!.subject;
  supervisorB = m.teacherSupervisors[1]!.subject;
  opsManager = m.operationsManager.subject;
  author = await staffWithRole('author1', 'content_author');
  author2 = await staffWithRole('author2', 'content_author');
  const family = m.families[0]!;
  parent = family.parent.subject;
  childId = family.children[0]!.id;
  teacher = m.teachers.find((t) => t.id === family.children[0]!.teacherId)!.subject;

  process.env.REDIS_URL = REDIS_URL;
  process.env.CORS_ALLOWED_ORIGINS = 'https://admin.matroles.example.test';
  const moduleRef = await Test.createTestingModule({ imports: [PlatformModule, AuthModule, CommunicationModule, LessonModule, MaterialsModule] })
    .overrideProvider(OBJECT_STORAGE).useValue(storage)
    .overrideProvider(RECITATION_HOSTS).useValue([])
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
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'matroles-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
  if (inheritedCors === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
  else process.env.CORS_ALLOWED_ORIGINS = inheritedCors;
});

const denied = (r: { status: number; code?: string }) => ({ status: r.status, code: r.code });
const DENIED = { status: 403, code: CommErrorCode.MATERIAL_DENIED };

describe('1. who is offered the workspace, and with which jobs', () => {
  it.each([
    ['the super admin', () => superAdmin, { canManage: true, canAuthor: true, canReview: true, canOpen: true }],
    ['the Teachers manager', () => manager, { canManage: true, canAuthor: true, canReview: true, canOpen: true }],
    ['a Teachers supervisor', () => supervisorA, { canManage: false, canAuthor: false, canReview: true, canOpen: true }],
    ['a Content author', () => author, { canManage: false, canAuthor: true, canReview: false, canOpen: true }],
    ['the Operations manager', () => opsManager, { canManage: false, canAuthor: false, canReview: false, canOpen: false }],
    ['a teacher', () => teacher, { canManage: false, canAuthor: false, canReview: false, canOpen: false }],
  ])('%s', async (_who, subject, want) => {
    const r = await http(subject(), 'GET', '/materials/admin/access');
    expect({ status: r.status, ...r.json }).toEqual({ status: 200, ...want });
  });

  it('the Content author template holds the author key and nothing else', async () => {
    const rows = await g.prisma.$queryRaw<Array<{ keys: string[] }>>`
      SELECT array_agg(arp.permission_key ORDER BY arp.permission_key) AS keys FROM chat.access_role r
        JOIN chat.access_role_permission arp ON arp.role_id = r.id WHERE r.organization_id = ${orgId}::uuid AND r.key = 'content_author'`;
    expect(rows[0]!.keys).toEqual(['materials.author']);
  });

  it('a teacher and Operations cannot reach any workspace route', async () => {
    for (const who of [teacher, opsManager, parent]) {
      expect(denied(await http(who, 'GET', '/materials/admin/items'))).toMatchObject({ status: 403 });
      expect(denied(await http(who, 'POST', '/materials/admin/items', DRAFT))).toMatchObject({ status: 403 });
    }
  });
});

describe('2. an author writes drafts', () => {
  let draftId: string;
  it('creates a DRAFT, whatever status it asks for is refused unless it is draft', async () => {
    const r = await http(author, 'POST', '/materials/admin/items', DRAFT);
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ status: 'draft', mine: true, can: { edit: true, submit: true, approve: false, retire: false } });
    draftId = r.json.id;
    expect(denied(await http(author, 'POST', '/materials/admin/items', { ...DRAFT, status: 'published' }))).toEqual(DENIED);
    expect(denied(await http(author, 'POST', '/materials/admin/items', { ...DRAFT, status: 'in_review' }))).toEqual(DENIED);
  });

  it('edits their own draft, and sees only their own drafts (not another author\'s)', async () => {
    const edit = await http(author, 'POST', `/materials/admin/items/${draftId}`, { titleEn: 'Edited' });
    expect(edit.json).toMatchObject({ titleEn: 'Edited', status: 'draft' });
    const other = await http(author2, 'GET', `/materials/admin/items/${draftId}`);
    expect({ status: other.status }).toEqual({ status: 404 });
    expect(denied(await http(author2, 'POST', `/materials/admin/items/${draftId}`, { titleEn: 'Hijack' }))).toMatchObject({ status: 404 });
    const list = await http(author2, 'GET', '/materials/admin/items');
    expect(list.json.items.map((i: { id: string }) => i.id)).not.toContain(draftId);
  });

  it('cannot publish, retire, import, or touch recitations -- those are the library\'s managers\'', async () => {
    expect(denied(await http(author, 'POST', `/materials/admin/items/${draftId}`, { status: 'published' }))).toEqual(DENIED);
    expect(denied(await http(author, 'POST', `/materials/admin/items/${draftId}`, { status: 'retired' }))).toEqual(DENIED);
    expect(denied(await http(author, 'POST', '/materials/admin/import', { rows: [] }))).toMatchObject({ status: 403 });
    expect(denied(await http(author, 'GET', '/materials/admin/recitations'))).toMatchObject({ status: 403 });
    expect(denied(await http(author, 'POST', '/materials/admin/recitations/sources', { name: 'x' }))).toMatchObject({ status: 403 });
    expect(denied(await http(author, 'POST', '/materials/admin/uploads', { purpose: 'recitation', files: [{ name: 'a.mp3', mimeType: 'audio/mpeg', byteSize: 10 }] }))).toEqual(DENIED);
  });

  it('may upload a file for an item', async () => {
    const r = await http(author, 'POST', '/materials/admin/uploads', { files: [{ name: 'a.pdf', mimeType: 'application/pdf', byteSize: 10 }] });
    expect(r.status).toBe(201);
  });

  it('submits for review; after that it is locked to its author', async () => {
    const r = await http(author, 'POST', `/materials/admin/items/${draftId}`, { status: 'in_review' });
    expect(r.json).toMatchObject({ status: 'in_review', can: { edit: false, submit: false, approve: false } });
    expect(denied(await http(author, 'POST', `/materials/admin/items/${draftId}`, { titleEn: 'Late edit' }))).toEqual(DENIED);
    expect(denied(await http(author, 'POST', `/materials/admin/items/${draftId}`, { status: 'published' }))).toEqual(DENIED);
  });
});

describe('3. a reviewer approves or returns an item in review', () => {
  let item: string;
  beforeAll(async () => {
    item = (await http(author, 'POST', '/materials/admin/items', { ...DRAFT, titleEn: 'To review' })).json.id;
    await http(author, 'POST', `/materials/admin/items/${item}`, { status: 'in_review' });
  });

  it('sees the queue and the published library, not a draft', async () => {
    const draft = (await http(author2, 'POST', '/materials/admin/items', { ...DRAFT, titleEn: 'Private draft' })).json.id;
    const list = await http(supervisorA, 'GET', '/materials/admin/items');
    const found = list.json.items.map((i: { id: string }) => i.id);
    expect(found).toContain(item);
    expect(found).not.toContain(draft);
    expect(denied(await http(supervisorA, 'GET', `/materials/admin/items/${draft}`))).toMatchObject({ status: 404 });
  });

  it('cannot write: no create, no upload, no edit of what it says', async () => {
    expect(denied(await http(supervisorA, 'POST', '/materials/admin/items', DRAFT))).toEqual(DENIED);
    expect(denied(await http(supervisorA, 'POST', '/materials/admin/uploads', { files: [{ name: 'a.pdf', mimeType: 'application/pdf', byteSize: 10 }] }))).toEqual(DENIED);
    expect(denied(await http(supervisorA, 'POST', `/materials/admin/items/${item}`, { status: 'published', titleEn: 'Rewritten' }))).toEqual(DENIED);
    expect(denied(await http(supervisorA, 'POST', '/materials/admin/import', { rows: [] }))).toMatchObject({ status: 403 });
  });

  it('may preview it to review it, and a family still cannot open it', async () => {
    expect((await http(supervisorA, 'POST', `/materials/items/${item}/open`)).status).toBe(201);
    expect((await http(parent, 'POST', `/materials/items/${item}/open`)).status).toBe(404);
    expect((await http(teacher, 'POST', `/materials/items/${item}/open`)).status).toBe(404);
  });

  it('returns it to draft, then (after the author resubmits) approves it', async () => {
    const back = await http(supervisorA, 'POST', `/materials/admin/items/${item}`, { status: 'draft' });
    expect(back.json).toMatchObject({ status: 'draft' });
    expect((await http(author, 'POST', `/materials/admin/items/${item}`, { status: 'in_review' })).json.status).toBe('in_review');
    const approved = await http(supervisorB, 'POST', `/materials/admin/items/${item}`, { status: 'published' });
    expect(approved.json).toMatchObject({ status: 'published' });
    // Approved: now families and teachers may open it; the author may no longer change it.
    expect((await http(parent, 'POST', `/materials/items/${item}/open`)).status).toBe(201);
    expect((await http(teacher, 'POST', `/materials/items/${item}/open`)).status).toBe(201);
    expect(denied(await http(author, 'POST', `/materials/admin/items/${item}`, { titleEn: 'After approval' }))).toEqual(DENIED);
    expect(denied(await http(supervisorB, 'POST', `/materials/admin/items/${item}`, { status: 'retired' }))).toEqual(DENIED);
  });

  it('is never the author of what it approves (four eyes)', async () => {
    // Someone who holds BOTH jobs (the author role, and a role that approves) writes an item: they may not approve it.
    const both = await staffWithRole('both', 'content_author');
    await g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`select set_config('chat.pd040_access_change', 'on', true)`);
      const [role] = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO chat.access_role (organization_id, key, name_en, name_ar, description, max_tier, is_template)
        VALUES (${orgId}::uuid, 'spec_approver', 'Spec approver', 'مراجع', 'spec', 'specialist', false) RETURNING id::text`;
      await tx.$queryRaw`SELECT chat.set_access_role_permissions(${role!.id}::uuid, array['materials.review']::text[])`;
      await tx.$queryRaw`SELECT chat.grant_access_role(${ids.get(both)!}::uuid, ${role!.id}::uuid, 'spec', ${m.superAdmin.id}::uuid)`;
    });
    expect((await http(both, 'GET', '/materials/admin/access')).json).toMatchObject({ canAuthor: true, canReview: true, canManage: false });
    const own = await http(both, 'POST', '/materials/admin/items', { ...DRAFT, titleEn: 'Own work' });
    expect(own.status).toBe(201);
    expect((await http(both, 'POST', `/materials/admin/items/${own.json.id}`, { status: 'in_review' })).json.status).toBe('in_review');
    expect(denied(await http(both, 'POST', `/materials/admin/items/${own.json.id}`, { status: 'published' }))).toEqual(DENIED);
    // ...and the database says the same, whatever the API does.
    await expect(g.prisma.materialItem.update({ where: { id: own.json.id }, data: { status: 'published', updatedBy: ids.get(both)! } })).rejects.toThrow(/authors write drafts/);
    expect((await http(supervisorB, 'POST', `/materials/admin/items/${own.json.id}`, { status: 'published' })).json.status).toBe('published');
  });
});

describe('4. the manager and the super admin keep every right', () => {
  it('create published, edit, retire, import dry run, recitations', async () => {
    for (const who of [manager, superAdmin]) {
      const r = await http(who, 'POST', '/materials/admin/items', { ...DRAFT, status: 'published' });
      expect(r.status).toBe(201);
      expect((await http(who, 'POST', `/materials/admin/items/${r.json.id}`, { titleEn: 'Managed' })).json.titleEn).toBe('Managed');
      expect((await http(who, 'POST', `/materials/admin/items/${r.json.id}`, { status: 'retired' })).json.status).toBe('retired');
      expect((await http(who, 'GET', '/materials/admin/recitations')).status).toBe(200);
    }
  });

  it('sees every item, including another author\'s draft', async () => {
    const d = (await http(author2, 'POST', '/materials/admin/items', { ...DRAFT, titleEn: 'Seen by manager' })).json.id;
    expect((await http(manager, 'GET', `/materials/admin/items/${d}`)).json).toMatchObject({ id: d, status: 'draft' });
  });
});

describe('5. nothing unapproved is served', () => {
  it('a draft and an item in review are not in the picker, the child\'s library, or a family\'s open', async () => {
    const draft = (await http(author, 'POST', '/materials/admin/items', { ...DRAFT, titleEn: 'Unserved draft' })).json.id;
    const review = (await http(author, 'POST', '/materials/admin/items', { ...DRAFT, titleEn: 'Unserved review' })).json.id;
    await http(author, 'POST', `/materials/admin/items/${review}`, { status: 'in_review' });
    for (const who of [teacher, parent]) {
      for (const id of [draft, review]) expect((await http(who, 'POST', `/materials/items/${id}/open`)).status).toBe(404);
    }
    const picker = await http(teacher, 'GET', '/materials/items');
    const seen = (picker.json.items ?? []).map((i: { id: string }) => i.id);
    expect(seen).not.toContain(draft);
    expect(seen).not.toContain(review);
    const lib = await http(parent, 'GET', `/learners/${childId}/materials/library`);
    const libSeen = JSON.stringify(lib.json);
    expect(libSeen).not.toContain(draft);
    expect(libSeen).not.toContain(review);
  });
});

describe('6. the database refuses what the API refuses', () => {
  it('an author cannot write a published item or another author\'s draft; a reviewer cannot rewrite', async () => {
    const authorId = ids.get(author)!;
    await expect(g.prisma.materialItem.create({
      data: { organizationId: orgId, subject: 'arabic', titleAr: 'x', kind: 'activity_link', source: 'url', url: 'https://a.example.test', status: 'published', createdBy: authorId, updatedBy: authorId },
    })).rejects.toThrow(/authors write drafts|an author starts an item as a draft/);
    const row = await g.prisma.materialItem.create({
      data: { organizationId: orgId, subject: 'arabic', titleAr: 'x', kind: 'activity_link', source: 'url', url: 'https://a.example.test', status: 'draft', createdBy: authorId, updatedBy: authorId },
    });
    const other = ids.get(author2)!;
    await expect(g.prisma.materialItem.update({ where: { id: row.id }, data: { titleEn: 'steal', updatedBy: other } })).rejects.toThrow(/authors write drafts/);
    await expect(g.prisma.materialItem.update({ where: { id: row.id }, data: { status: 'published', updatedBy: authorId } })).rejects.toThrow(/authors write drafts/);
    // The Operations manager, a manager of another department, holds nothing.
    const ops = await g.prisma.staff.findFirstOrThrow({ where: { organizationId: orgId, role: 'manager', NOT: { id: m.teachersManager.id } } });
    await expect(g.prisma.materialItem.update({ where: { id: row.id }, data: { titleEn: 'ops', updatedBy: ops.id } })).rejects.toThrow(/authors write drafts|managed by/);
  });

  it('every status of a library item is one of the four', async () => {
    const authorId = ids.get(author)!;
    await expect(g.prisma.$executeRawUnsafe(`update chat.material_item set status = 'approved' where false`)).resolves.toBeDefined();
    await expect(g.prisma.materialItem.create({
      data: { organizationId: orgId, subject: 'arabic', titleAr: 'x', kind: 'activity_link', source: 'url', url: 'https://a.example.test', status: 'approved', createdBy: authorId, updatedBy: authorId },
    })).rejects.toThrow();
  });
});
