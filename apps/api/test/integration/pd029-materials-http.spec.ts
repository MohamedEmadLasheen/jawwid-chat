/**
 * PD-29 Materials over real HTTP: real logins, the global bearer guard, the
 * real routes, the real database triggers. Storage is an in-memory double of
 * the ObjectStorage seam (the bytes a browser would PUT are placed in it).
 *
 *   1. who manages the library (super admin, Teachers manager) -- and who not
 *   2. items: a link, a file (real bytes checked), a package (validated)
 *   3. open: the access decision; a draft is the managers'; another tenant 404
 *   4. play: sandbox CSP, the index is the only namespace, the token binds
 *      item + package + viewer, every request re-checked, Range on stored entries
 *   5. bulk import: dry run writes nothing; commit is all-or-nothing; re-run
 *      updates by ref (no duplicates); files are matched to rows
 *   6. the report: practice + memorization, the card line, the child's page,
 *      edits keep history, the map is append-only, corrections need a reason
 *   7. the child's page: who may read it (PD-8), the age band, recitations
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
import { parseByteRange, type ObjectStorage, type StoredObject } from '@communication/attachments/object-storage';
import { applyInfrastructure } from '../../src/infra/http/bootstrap';
import { LessonModule } from '../../src/lessons/lesson.module';
import { MaterialsModule } from '../../src/materials/materials.module';
import { SURAHS } from '../../src/materials/quran-surahs';
import { seedOrgChat, type SeedManifest } from '../../src/cli/org-chat-seed';
import { buildZip, sampleActivity } from '../support/zip-fixture';
import { buildGraph, truncate } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const inheritedCors = process.env.CORS_ALLOWED_ORIGINS;
const inheritedSite = process.env.MATERIALS_SITE_BASE_URL;
const inheritedFrames = process.env.MATERIALS_FRAME_ORIGINS;
const SITE = 'https://lessons.pd29.example.test';
const PASSWORD = 'pd29-http-spec-password-1';
const DOMAIN = 'pd29http.qa.jawwid.test';
const DOMAIN2 = 'pd29http2.qa.jawwid.test';
const ADMIN_ORIGIN = 'https://admin.pd29.example.test';

/** The ObjectStorage seam, in memory: what the browser PUTs is placed here by `put`. */
class MemoryStorage implements ObjectStorage {
  readonly blobs = new Map<string, { mimeType: string; bytes: Buffer }>();
  reads: Array<string | undefined> = [];
  put(objectKey: string, mimeType: string, bytes: Buffer) {
    this.blobs.set(objectKey, { mimeType, bytes });
  }
  async authorizeUpload(p: { prefix: string; mimeType: string; byteSize: number }) {
    const objectKey = `${p.prefix}/${randomUUID()}`;
    return { objectKey, uploadUrl: `https://storage.pd29.example.test/${objectKey}`, method: 'PUT' as const, headers: { 'content-type': p.mimeType }, expiresAt: new Date(Date.now() + 300_000).toISOString() };
  }
  async signedReadUrl(objectKey: string, ttlSeconds: number) {
    return `https://storage.pd29.example.test/${objectKey}?ttl=${ttlSeconds}&sig=signed`;
  }
  async delete(objectKey: string) {
    this.blobs.delete(objectKey);
  }
  async copy(source: string, target: string) {
    const b = this.blobs.get(source);
    if (!b) return false;
    this.blobs.set(target, { mimeType: b.mimeType, bytes: Buffer.from(b.bytes) });
    return true;
  }
  async readHead(objectKey: string, maxBytes: number) {
    const b = this.blobs.get(objectKey);
    return b ? { head: b.bytes.subarray(0, maxBytes), byteSize: b.bytes.length, contentType: b.mimeType } : null;
  }
  async read(objectKey: string, rangeHeader?: string | string[]): Promise<StoredObject | 'unsatisfiable' | null> {
    this.reads.push(typeof rangeHeader === 'string' ? rangeHeader : undefined);
    const b = this.blobs.get(objectKey);
    if (!b) return null;
    const range = parseByteRange(rangeHeader, b.bytes.length);
    if (range === 'unsatisfiable') return 'unsatisfiable';
    return { mimeType: b.mimeType, size: b.bytes.length, range, body: range ? b.bytes.subarray(range.start, range.end + 1) : b.bytes };
  }
}

const g = buildGraph();
const storage = new MemoryStorage();
let app: INestApplication;
let base: string;
let m: SeedManifest;
let orgId: string;
let org2Owner: string;

const tokens = new Map<string, string>();
async function tokenFor(subject: string): Promise<string> {
  if (!tokens.has(subject)) tokens.set(subject, (await app.get(AuthService).login(subject, PASSWORD)).accessToken);
  return tokens.get(subject)!;
}

async function http(subject: string | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = body ? { 'content-type': 'application/json' } : {};
  if (subject) headers.authorization = `Bearer ${await tokenFor(subject)}`;
  const r = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = (await r.json().catch(() => ({}))) as { error?: { code?: string; message?: string } } & Record<string, any>;
  return { status: r.status, code: json.error?.code, json };
}

/** Grant + "browser PUT" of one file; returns its upload token. */
async function upload(subject: string, name: string, mimeType: string, bytes: Buffer, purpose: 'item' | 'recitation' = 'item'): Promise<string> {
  const r = await http(subject, 'POST', '/materials/admin/uploads', { purpose, files: [{ name, mimeType, byteSize: bytes.length }] });
  expect(r.status).toBe(201);
  const token = r.json.uploads[0].uploadToken as string;
  storage.put(token, mimeType, bytes);
  return token;
}

const MP3 = Buffer.concat([Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00'), Buffer.alloc(200, 1)]);
const PDF = Buffer.from('%PDF-1.7\n% synthetic\n');
const HOUR = 3_600_000;

// Seed people, resolved once.
let manager: string; // Teachers manager
let teacherSupervisor: string; // a member of the Teachers department
let opsManager: string;
let parent: string;
let childId: string;
let childName: string;
let teacher: string;
let teacherId: string;
let supervisor: string;
let otherTeacher: string;
let otherFamilyParent: string;

beforeAll(async () => {
  await g.prisma.$connect();
  await truncate(g.prisma);
  for (const d of [DOMAIN, DOMAIN2]) await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${d}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd29h-%'`);

  const makeOrg = async (domain: string, label: string) => {
    const id = randomUUID();
    await g.prisma.$executeRawUnsafe(
      `insert into chat.organization (id, slug, display_name) values ('${id}'::uuid, 'pd29h-${label}-${id.slice(0, 8)}', 'PD-29 HTTP QA academy ${label}')`,
    );
    await g.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
      const account = await tx.account.create({ data: { organizationId: id, subject: `owner@${domain}`, kind: 'staff', status: 'active', isActive: true } });
      await tx.accountCredential.create({ data: { accountId: account.id, passwordHash: await hashPassword(PASSWORD) } });
      await tx.staff.create({ data: { organizationId: id, name: `QA Owner ${label}`, role: 'super_admin', isActive: true, accountId: account.id } });
    });
    return id;
  };
  orgId = await makeOrg(DOMAIN, 'a');
  await makeOrg(DOMAIN2, 'b');
  org2Owner = `owner@${DOMAIN2}`;
  m = await seedOrgChat(g.prisma, { organizationId: orgId, emailDomain: DOMAIN, password: PASSWORD, passwordHash: await hashPassword(PASSWORD), messages: false });

  manager = m.teachersManager.subject;
  teacherSupervisor = m.teacherSupervisors[0]!.subject;
  opsManager = m.operationsManager.subject;
  const family = m.families[0]!;
  parent = family.parent.subject;
  childId = family.children[0]!.id;
  childName = family.children[0]!.name;
  teacherId = family.children[0]!.teacherId;
  teacher = m.teachers.find((t) => t.id === teacherId)!.subject;
  supervisor = m.supervisors.find((s) => s.id === family.children[0]!.supervisorId)!.subject;
  otherTeacher = m.teachers.find((t) => t.id !== teacherId)!.subject;
  otherFamilyParent = m.families.find((f) => f.children.every((c) => c.id !== childId))!.parent.subject;

  process.env.REDIS_URL = REDIS_URL;
  process.env.CORS_ALLOWED_ORIGINS = ADMIN_ORIGIN;
  process.env.MATERIALS_SITE_BASE_URL = SITE;
  process.env.MATERIALS_FRAME_ORIGINS = 'https://activities.example.test';
  const moduleRef = await Test.createTestingModule({
    imports: [PlatformModule, AuthModule, CommunicationModule, LessonModule, MaterialsModule],
  }).overrideProvider(OBJECT_STORAGE).useValue(storage)
    // One external host allowed, with a (test) licence record -- the code default allows none.
    .overrideProvider(RECITATION_HOSTS).useValue([{ host: 'audio.example.test', licence: { confirmedBy: 'test', confirmedAt: '2026-10-28', reference: 'spec' } }])
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
  for (const d of [DOMAIN, DOMAIN2]) await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${d}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'pd29h-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
  if (inheritedCors === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
  else process.env.CORS_ALLOWED_ORIGINS = inheritedCors;
  if (inheritedSite === undefined) delete process.env.MATERIALS_SITE_BASE_URL;
  else process.env.MATERIALS_SITE_BASE_URL = inheritedSite;
  if (inheritedFrames === undefined) delete process.env.MATERIALS_FRAME_ORIGINS;
  else process.env.MATERIALS_FRAME_ORIGINS = inheritedFrames;
});

async function linkItem(subject: string, extra: Record<string, unknown> = {}) {
  const r = await http(subject, 'POST', '/materials/admin/items', {
    titleAr: 'رابط نشاط', titleEn: 'Activity link', subject: 'arabic', url: 'https://activities.example.test/a', status: 'published', ...extra,
  });
  expect(r.status).toBe(201);
  return r.json as { id: string; status: string };
}

async function packageItem(subject = manager, zip = sampleActivity(), extra: Record<string, unknown> = {}) {
  const token = await upload(subject, 'game.zip', 'application/zip', zip);
  const r = await http(subject, 'POST', '/materials/admin/items', {
    titleAr: 'لعبة', subject: 'quran', strand: 'memorization', surah: 78, uploadToken: token, status: 'published', ...extra,
  });
  return r;
}

describe('1. who manages the library', () => {
  it('every route is behind the bearer guard', async () => {
    for (const [method, path] of [
      ['GET', '/materials/admin/items'], ['POST', '/materials/admin/items'], ['POST', '/materials/admin/import'],
      ['GET', '/materials/quran/surahs'], ['GET', `/learners/${childId}/materials/progress`], ['POST', `/materials/items/${randomUUID()}/open`],
    ] as const) {
      expect((await http(null, method, path, method === 'POST' ? {} : undefined)).status).toBe(401);
    }
  });

  it('the super admin and the Teachers manager manage it; a Teachers-department member, Operations, a teacher and a parent do not', async () => {
    expect((await http(m.superAdmin.subject, 'GET', '/materials/admin/items')).status).toBe(200);
    expect((await http(manager, 'GET', '/materials/admin/items')).status).toBe(200);
    for (const who of [teacherSupervisor, opsManager, teacher, parent]) {
      const r = await http(who, 'POST', '/materials/admin/items', { titleAr: 'x', subject: 'arabic', url: 'https://a.example.test' });
      expect({ who, status: r.status, code: r.code }).toEqual({ who, status: 403, code: CommErrorCode.MATERIAL_DENIED });
      expect((await http(who, 'POST', '/materials/admin/uploads', { files: [{ name: 'a.mp3', mimeType: 'audio/mpeg', byteSize: 10 }] })).status).toBe(403);
    }
  });

  it('the database refuses a library write by anyone else, whatever the API does', async () => {
    const teacherRow = await g.prisma.staff.findFirstOrThrow({ where: { organizationId: orgId, role: 'manager', NOT: { id: m.teachersManager.id } } });
    await expect(g.prisma.materialItem.create({
      data: { organizationId: orgId, subject: 'arabic', titleAr: 'x', kind: 'activity_link', source: 'url', url: 'https://a.example.test', createdBy: teacherRow.id, updatedBy: teacherRow.id },
    })).rejects.toThrow(/managed by the super admin or the Teachers manager/);
  });
});

describe('2. items', () => {
  it('a link item; https only', async () => {
    const item = await linkItem(manager);
    expect(item).toMatchObject({ kind: 'activity_link', source: 'url', url: 'https://activities.example.test/a', status: 'published' });
    const bad = await http(manager, 'POST', '/materials/admin/items', { titleAr: 'x', subject: 'arabic', url: 'javascript:alert(1)' });
    expect({ status: bad.status, code: bad.code }).toEqual({ status: 400, code: CommErrorCode.MATERIAL_INVALID });
  });

  it('a file item: its real bytes are checked; a renamed HTML page is refused; the object key is never returned', async () => {
    const token = await upload(manager, 'a.mp3', 'audio/mpeg', MP3);
    const ok = await http(manager, 'POST', '/materials/admin/items', { titleAr: 'تلاوة', subject: 'quran', strand: 'recitation', uploadToken: token });
    expect(ok.status).toBe(201);
    expect(ok.json).toMatchObject({ kind: 'audio', source: 'file', status: 'draft', mimeType: 'audio/mpeg', byteSize: MP3.length });
    expect(JSON.stringify(ok.json)).not.toContain(token);

    const fake = await upload(manager, 'b.mp3', 'audio/mpeg', Buffer.from('<html><script>alert(1)</script></html>'));
    const refused = await http(manager, 'POST', '/materials/admin/items', { titleAr: 'x', subject: 'quran', uploadToken: fake });
    expect({ status: refused.status, code: refused.code }).toEqual({ status: 400, code: CommErrorCode.MATERIAL_FILE_REFUSED });

    // A grant whose bytes never arrived.
    const grant = await http(manager, 'POST', '/materials/admin/uploads', { files: [{ name: 'c.pdf', mimeType: 'application/pdf', byteSize: 10 }] });
    const missing = await http(manager, 'POST', '/materials/admin/items', { titleAr: 'x', subject: 'arabic', uploadToken: grant.json.uploads[0].uploadToken });
    expect({ status: missing.status, code: missing.code }).toEqual({ status: 409, code: CommErrorCode.MATERIAL_NOT_UPLOADED });
  });

  it('an object key is a name, not a capability: another org\'s token, an invented key, a recitation upload', async () => {
    const theirs = await upload(org2Owner, 'x.pdf', 'application/pdf', PDF);
    const r1 = await http(manager, 'POST', '/materials/admin/items', { titleAr: 'x', subject: 'arabic', uploadToken: theirs });
    expect({ status: r1.status, code: r1.code }).toEqual({ status: 404, code: CommErrorCode.MATERIAL_NOT_FOUND });
    const invented = `materials/${orgId}/${randomUUID()}`;
    storage.put(invented, 'application/pdf', PDF);
    expect((await http(manager, 'POST', '/materials/admin/items', { titleAr: 'x', subject: 'arabic', uploadToken: invented })).status).toBe(404);
    const recitation = await upload(manager, 'r.mp3', 'audio/mpeg', MP3, 'recitation');
    expect((await http(manager, 'POST', '/materials/admin/items', { titleAr: 'x', subject: 'quran', uploadToken: recitation })).status).toBe(404);
  });

  it('a package item: validated and indexed; skipped files reported; a traversal path refuses it whole', async () => {
    const withJunk = buildZip([
      { name: 'index.html', data: '<p>hi</p>' }, { name: 'app.js', data: 'x' }, { name: 'backdoor.php', data: '<?php' },
    ]);
    const ok = await packageItem(manager, withJunk);
    expect(ok.status).toBe(201);
    expect(ok.json).toMatchObject({ kind: 'activity_package', source: 'package', packageEntry: 'index.html', skipped: ['backdoor.php'] });

    const evil = buildZip([{ name: 'index.html', data: 'x' }, { name: '../../escape.js', data: 'x' }]);
    const refused = await packageItem(manager, evil);
    expect({ status: refused.status, code: refused.code }).toEqual({ status: 400, code: CommErrorCode.MATERIAL_FILE_REFUSED });
    expect(refused.json.error?.message).toContain('leaves its folder');
  });

  it('edit: a field present changes, one left out stays; retire hides it from families; an item is never deleted', async () => {
    const item = await linkItem(manager);
    const r = await http(manager, 'POST', `/materials/admin/items/${item.id}`, { titleEn: 'Renamed', ageGroups: ['7-9'] });
    expect(r.json).toMatchObject({ titleAr: 'رابط نشاط', titleEn: 'Renamed', ageGroups: ['7-9'], status: 'published' });
    expect((await http(manager, 'POST', `/materials/admin/items/${item.id}`, { status: 'retired' })).json.status).toBe('retired');
    expect((await http(parent, 'POST', `/materials/items/${item.id}/open`)).status).toBe(404);
    await expect(g.prisma.$executeRawUnsafe(`delete from chat.material_item where id = '${item.id}'::uuid`)).rejects.toThrow(/never deleted/);
  });
});

describe('3. open: the access decision', () => {
  it('a family, a teacher and staff of the organization open a published item; a file gives a short-lived storage URL', async () => {
    const token = await upload(manager, 'p.pdf', 'application/pdf', PDF);
    const item = (await http(manager, 'POST', '/materials/admin/items', { titleAr: 'كتاب', subject: 'islamic_studies', uploadToken: token, status: 'published' })).json;
    for (const who of [parent, teacher, supervisor]) {
      const r = await http(who, 'POST', `/materials/items/${item.id}/open`);
      expect(r.status).toBe(201);
      expect(r.json).toMatchObject({ mode: 'file', presentation: 'file', kind: 'pdf', mimeType: 'application/pdf' });
      expect(r.json.url).toMatch(/^https:\/\/storage\.pd29\.example\.test\/.+\?ttl=3600&sig=/);
    }
    const link = await linkItem(manager);
    const openedLink = (await http(parent, 'POST', `/materials/items/${link.id}/open`)).json;
    expect(openedLink).toMatchObject({ mode: 'link', presentation: 'frame-site', url: 'https://activities.example.test/a' });
    // An allowlisted third-party frame is never handed Quran audio: only the lessons site is.
    expect(openedLink.audioEligible).toBeUndefined();
  });

  it('a draft is the managers\' preview only; another organization gets the same 404 as an unknown id', async () => {
    const draft = await linkItem(manager, { status: 'draft' });
    expect((await http(parent, 'POST', `/materials/items/${draft.id}/open`)).status).toBe(404);
    expect((await http(teacher, 'POST', `/materials/items/${draft.id}/open`)).status).toBe(404);
    expect((await http(manager, 'POST', `/materials/items/${draft.id}/open`)).status).toBe(201);
    const published = await linkItem(manager);
    const foreign = await http(org2Owner, 'POST', `/materials/items/${published.id}/open`);
    const unknown = await http(org2Owner, 'POST', `/materials/items/${randomUUID()}/open`);
    expect([foreign.status, foreign.code]).toEqual([404, CommErrorCode.MATERIAL_NOT_FOUND]);
    expect([unknown.status, unknown.code]).toEqual([foreign.status, foreign.code]);
  });
});

describe('4. play', () => {
  it('serves a package\'s files sandboxed: CSP sandbox without same-origin, nosniff, its own type, CORS for its opaque origin', async () => {
    const item = (await packageItem()).json;
    const open = await http(parent, 'POST', `/materials/items/${item.id}/open`);
    expect(open.json).toMatchObject({ mode: 'package', presentation: 'frame-isolated' });
    const url = open.json.url as string;
    expect(url).toMatch(new RegExp(`/api/v1/materials/play/${item.id}/[^/]+/index\\.html$`));

    const page = await fetch(url);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const csp = page.headers.get('content-security-policy')!;
    expect(csp).toMatch(/^sandbox allow-scripts allow-forms;/);
    expect(csp).not.toContain('allow-same-origin');
    expect(csp).toContain(`frame-ancestors ${ADMIN_ORIGIN}`);
    expect(page.headers.get('x-content-type-options')).toBe('nosniff');
    expect(page.headers.get('access-control-allow-origin')).toBe('*');
    expect(page.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(await page.text()).toContain('<h1>Activity</h1>');

    // Relative URLs resolve under the same token.
    const js = await fetch(new URL('js/app.js', url));
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(await js.text()).toBe('document.title = "activity";');
  });

  it('only the index exists: an unknown path, a traversal and an unindexed type are 404', async () => {
    const item = (await packageItem()).json;
    const url = (await http(parent, 'POST', `/materials/items/${item.id}/open`)).json.url as string;
    const root = url.replace(/index\.html$/, '');
    expect((await fetch(`${root}nope.js`)).status).toBe(404);
    expect((await fetch(`${root}..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
    expect((await fetch(`${root}js/..%2F..%2Findex.html`)).status).toBe(404);
  });

  it('the token binds item, package and viewer, and every request is re-checked', async () => {
    const item = (await packageItem()).json;
    const url = (await http(parent, 'POST', `/materials/items/${item.id}/open`)).json.url as string;
    const [, token] = /\/play\/[^/]+\/([^/]+)\//.exec(url)!;
    // Tampered.
    expect((await fetch(url.replace(token, `${token.slice(0, -2)}xx`))).status).toBe(403);
    // Another item.
    const other = (await packageItem()).json;
    expect((await fetch(url.replace(item.id, other.id))).status).toBe(403);
    // A new package replaces the old: the old token stops working.
    const newToken = await upload(manager, 'v2.zip', 'application/zip', sampleActivity());
    expect((await http(manager, 'POST', `/materials/admin/items/${item.id}`, { uploadToken: newToken })).status).toBe(201);
    expect((await fetch(url)).status).toBe(403);
    // Retired: refused on the next request, even with a fresh token.
    const fresh = (await http(parent, 'POST', `/materials/items/${other.id}/open`)).json.url as string;
    expect((await fetch(fresh)).status).toBe(200);
    await http(manager, 'POST', `/materials/admin/items/${other.id}`, { status: 'retired' });
    expect((await fetch(fresh)).status).toBe(404);
  });

  it('a stored entry honours Range, so media inside a package can seek', async () => {
    const zip = buildZip([{ name: 'index.html', data: 'x' }, { name: 'clip.mp4', data: Buffer.from('0123456789abcdef') }]);
    const item = (await packageItem(manager, zip)).json;
    const url = ((await http(parent, 'POST', `/materials/items/${item.id}/open`)).json.url as string).replace(/index\.html$/, 'clip.mp4');
    const r = await fetch(url, { headers: { range: 'bytes=4-7' } });
    expect(r.status).toBe(206);
    expect(r.headers.get('content-range')).toBe('bytes 4-7/16');
    expect(await r.text()).toBe('4567');
  });
});

describe('4b. pinning and presentation', () => {
  it('an upload is pinned at validation: bytes put under the grant afterwards are never served', async () => {
    const token = await upload(manager, 'p.pdf', 'application/pdf', PDF);
    const item = (await http(manager, 'POST', '/materials/admin/items', { titleAr: 'كتاب', subject: 'arabic', uploadToken: token, status: 'published' })).json;
    const row = await g.prisma.materialItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(row.objectKey).not.toBe(token);
    expect(row.objectKey).toMatch(new RegExp(`^materials/${orgId}/v/`));
    // The still-live grant is used to swap the bytes: same type, same length.
    storage.put(token, 'application/pdf', Buffer.from('%PDF-1.7\n% swapped!\n'));
    const open = await http(parent, 'POST', `/materials/items/${item.id}/open`);
    expect(open.json.url).toContain(row.objectKey!);
    expect(storage.blobs.get(row.objectKey!)!.bytes.equals(PDF)).toBe(true);

    // A package too: the play route serves the validated copy.
    const zipToken = await upload(manager, 'g.zip', 'application/zip', sampleActivity());
    const pkg = (await http(manager, 'POST', '/materials/admin/items', { titleAr: 'لعبة', subject: 'quran', uploadToken: zipToken, status: 'published' })).json;
    storage.put(zipToken, 'application/zip', buildZip([{ name: 'index.html', data: '<script>steal()</script>' }]));
    const url = (await http(parent, 'POST', `/materials/items/${pkg.id}/open`)).json.url as string;
    expect(await (await fetch(url)).text()).toContain('<h1>Activity</h1>');
  });

  it('a lesson of the lessons site stores its path; the configured base is joined when opened, framed from its own origin', async () => {
    const r = await http(manager, 'POST', '/materials/admin/import', {
      manifest: 'ref,title_ar,subject,strand,surah,path,status\r\n/lessons/quran/surah-78,سورة النبأ,quran,memorization,78,/lessons/quran/surah-78,published\r\n',
      dryRun: false,
    });
    expect(r.json).toMatchObject({ committed: true, summary: { create: 1 } });
    const row = await g.prisma.materialItem.findFirstOrThrow({ where: { organizationId: orgId, externalRef: '/lessons/quran/surah-78' } });
    expect(row).toMatchObject({ source: 'site', sitePath: '/lessons/quran/surah-78', url: null, kind: 'activity_link' });
    const open = await http(parent, 'POST', `/materials/items/${row.id}/open`);
    expect(open.json).toMatchObject({ mode: 'link', presentation: 'frame-site', url: `${SITE}/lessons/quran/surah-78`, audioEligible: true });
    // Re-importing the same path updates, never duplicates.
    await http(manager, 'POST', '/materials/admin/import', {
      manifest: 'ref,title_ar,subject,path\r\n/lessons/quran/surah-78,سورة النبأ (محدّثة),quran,/lessons/quran/surah-78\r\n', dryRun: false,
    });
    expect(await g.prisma.materialItem.count({ where: { organizationId: orgId, externalRef: '/lessons/quran/surah-78' } })).toBe(1);
    // The database refuses a site path that leaves the site.
    await expect(g.prisma.$executeRawUnsafe(`update chat.material_item set site_path = '//evil.test/x' where id = '${row.id}'::uuid`)).rejects.toThrow();
  });

  it('a link off the allowlist opens in the browser, never framed', async () => {
    const off = await linkItem(manager, { url: 'https://elsewhere.example.test/game' });
    expect((await http(parent, 'POST', `/materials/items/${off.id}/open`)).json).toMatchObject({ presentation: 'browser', url: 'https://elsewhere.example.test/game' });
  });

  it('a JSON manifest over 5 MB is refused before it is parsed', async () => {
    const r = await http(manager, 'POST', '/materials/admin/import', { format: 'json', manifest: `[${' '.repeat(5 * 1024 * 1024)}]` });
    expect([r.status, r.code]).toEqual([400, CommErrorCode.MATERIAL_INVALID]);
  });
});

describe('5. bulk import', () => {
  const csv = (rows: string[]) => ['ref,title_ar,title_en,subject,strand,kind,age_groups,surah,description,url,file,status', ...rows].join('\r\n');

  it('a dry run reports every row (create / update / error) and writes nothing', async () => {
    const before = await g.prisma.materialItem.count({ where: { organizationId: orgId } });
    const r = await http(manager, 'POST', '/materials/admin/import', {
      format: 'csv',
      manifest: csv([
        'imp-1,درس,Lesson,arabic,,,4-6|7-9,,,https://videos.example.test/1,,published',
        'imp-2,لعبة,,quran,memorization,,,78,,,naba.zip,',
        'imp-3,,,maths,,,1-3,,,,,',
        ',بلا مرجع,,islamic_studies,,,,,,https://x.example.test,,',
        'imp-1,مكرر,,arabic,,,,,,https://y.example.test,,',
      ]),
      files: [{ name: 'naba.zip', mimeType: 'application/zip', byteSize: 1000 }, { name: 'unused.pdf', mimeType: 'application/pdf', byteSize: 10 }],
    });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ dryRun: true, committed: false, unmatchedFiles: ['unused.pdf'] });
    expect(r.json.rows.map((x: any) => x.action)).toEqual(['create', 'create', 'error', 'create', 'error']);
    expect(r.json.rows[2].errors.length).toBeGreaterThanOrEqual(3);
    expect(r.json.rows[3].warnings[0]).toContain('no ref');
    expect(r.json.rows[4].errors[0]).toContain('appears twice');
    expect(await g.prisma.materialItem.count({ where: { organizationId: orgId } })).toBe(before);
  });

  it('commit is all-or-nothing, matches files to rows, and a re-run updates by ref instead of duplicating', async () => {
    const zip = sampleActivity();
    const files = [{ name: 'naba.zip', mimeType: 'application/zip', byteSize: zip.length }, { name: 'rec.mp3', mimeType: 'audio/mpeg', byteSize: MP3.length }];
    const manifest = csv([
      'bulk-1,فيديو,Video,arabic,,video,4-6,,,https://videos.example.test/1,,published',
      'bulk-2,لعبة النبأ,Naba game,quran,memorization,,7-9,78,,,naba.zip,published',
      'bulk-3,تلاوة,Recitation,quran,recitation,,,1,,,rec.mp3,',
    ]);
    const preview = await http(manager, 'POST', '/materials/admin/import', { manifest, files });
    expect(preview.json.summary).toMatchObject({ create: 3, update: 0, errors: 0 });

    // Not uploaded yet: the commit refuses, nothing written.
    const early = await http(manager, 'POST', '/materials/admin/import', { manifest, files, dryRun: false });
    expect(early.json.committed).toBe(false);
    expect(await g.prisma.materialItem.count({ where: { organizationId: orgId, externalRef: { startsWith: 'bulk-' } } })).toBe(0);

    const grants = await http(manager, 'POST', '/materials/admin/uploads', { files });
    const byName = new Map<string, string>(grants.json.uploads.map((u: any) => [u.name, u.uploadToken]));
    storage.put(byName.get('naba.zip')!, 'application/zip', zip);
    storage.put(byName.get('rec.mp3')!, 'audio/mpeg', MP3);
    const withTokens = files.map((f) => ({ ...f, uploadToken: byName.get(f.name) }));

    const done = await http(manager, 'POST', '/materials/admin/import', { manifest, files: withTokens, dryRun: false });
    expect(done.json).toMatchObject({ committed: true, summary: { create: 3, update: 0 } });
    const rows = await g.prisma.materialItem.findMany({ where: { organizationId: orgId, externalRef: { startsWith: 'bulk-' } }, orderBy: { externalRef: 'asc' } });
    expect(rows.map((r) => [r.externalRef, r.kind, r.source, r.status])).toEqual([
      ['bulk-1', 'video', 'url', 'published'],
      ['bulk-2', 'activity_package', 'package', 'published'],
      ['bulk-3', 'audio', 'file', 'draft'],
    ]);

    // Re-run with a changed title and no files: updates, keeps sources and statuses.
    const again = await http(manager, 'POST', '/materials/admin/import', {
      manifest: csv([
        'bulk-1,فيديو جديد,Video,arabic,,video,4-6,,,https://videos.example.test/1,,',
        'bulk-2,لعبة النبأ,Naba game,quran,memorization,,7-9,78,,,,',
        'bulk-3,تلاوة,Recitation,quran,recitation,,,1,,,,published',
      ]),
      dryRun: false,
    });
    expect(again.json).toMatchObject({ committed: true, summary: { create: 0, update: 3 } });
    const after = await g.prisma.materialItem.findMany({ where: { organizationId: orgId, externalRef: { startsWith: 'bulk-' } }, orderBy: { externalRef: 'asc' } });
    expect(after).toHaveLength(3);
    expect(after.map((r) => [r.titleAr, r.source, r.status])).toEqual([
      ['فيديو جديد', 'url', 'published'], ['لعبة النبأ', 'package', 'published'], ['تلاوة', 'file', 'published'],
    ]);
    expect(after.map((r) => r.id)).toEqual(rows.map((r) => r.id));
  });

  it('a JSON manifest works the same, and the template downloads', async () => {
    const r = await http(manager, 'POST', '/materials/admin/import', {
      manifest: [{ ref: 'json-1', titleAr: 'قيم', subject: 'islamic_studies', ageGroups: ['10-12'], url: 'https://values.example.test' }],
      dryRun: false,
    });
    expect(r.json).toMatchObject({ committed: true, summary: { create: 1 } });
    const t = await fetch(`${base}/materials/admin/import/template.csv`, { headers: { authorization: `Bearer ${await tokenFor(manager)}` } });
    expect(t.status).toBe(200);
    expect(await t.text()).toMatch(/^ref,title_ar,title_en,subject/);
    expect((await fetch(`${base}/materials/admin/import/template.csv`, { headers: { authorization: `Bearer ${await tokenFor(parent)}` } })).status).toBe(403);
  });
});

describe('6. the report: practice this week and the memorization map', () => {
  let lessonId: string;
  let itemId: string;

  beforeAll(async () => {
    itemId = (await linkItem(manager, { titleAr: 'لعبة الملك', subject: 'quran', surah: 67 })).id;
    const start = new Date(Date.now() + 3 * HOUR);
    const created = await http(manager, 'POST', '/lessons', { learnerId: childId, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + HOUR / 2).toISOString() });
    expect(created.status).toBe(201);
    lessonId = created.json.id;
    await g.prisma.$executeRawUnsafe(
      `update chat.lesson set starts_at = now() - interval '1 hour', ends_at = now() - interval '30 minutes' where id = $1::uuid and outcome is null`, lessonId,
    );
  });

  it('a staff member cannot mark the map from a report; a draft item cannot be practice', async () => {
    const draft = await linkItem(manager, { status: 'draft' });
    const r = await http(teacher, 'POST', `/lessons/${lessonId}/report`, { coveredTopics: ['revision'], practice: [{ itemId: draft.id }] });
    expect([r.status, r.code]).toEqual([404, CommErrorCode.MATERIAL_NOT_FOUND]);
    expect((await g.prisma.lesson.findUniqueOrThrow({ where: { id: lessonId } })).outcome).toBeNull();
  });

  it('the teacher reports with practice and surah statuses; the card says the practice; the child\'s page shows both', async () => {
    const r = await http(teacher, 'POST', `/lessons/${lessonId}/report`, {
      coveredTopics: ['new_memorization'], homework: 'Revise',
      practice: [{ surah: 67, ayahFrom: 1, ayahTo: 10 }, { itemId }],
      memorization: [{ surah: 78, status: 'memorized' }, { surah: 67, status: 'in_progress' }],
    });
    expect(r.status).toBe(201);
    const report = await g.prisma.lessonReport.findUniqueOrThrow({ where: { lessonId } });
    const card = await g.prisma.message.findUniqueOrThrow({ where: { id: report.messageId! }, include: { card: true } });
    expect(card.body).toMatch(/تدريب هذا الأسبوع|Practice this week/);
    expect((card.card!.payload as any).practice).toHaveLength(2);

    const practice = await http(parent, 'GET', `/learners/${childId}/materials/practice`);
    expect(practice.status).toBe(200);
    expect(practice.json.current).toBe(true);
    expect(practice.json.reports[0].practice).toEqual([
      expect.objectContaining({ kind: 'ayah_range', surah: 67, ayahFrom: 1, ayahTo: 10, nameEn: 'Al-Mulk' }),
      expect.objectContaining({ kind: 'item', item: expect.objectContaining({ id: itemId, mode: 'link' }) }),
    ]);
    expect(JSON.stringify(practice.json)).not.toContain('activities.example.test');

    // The map left the product (2026-10-26), but the marks a report carries are kept.
    const marks = await g.prisma.memorizationMark.findMany({ where: { learnerId: childId }, orderBy: { seq: 'asc' } });
    expect(marks.map((x) => [x.surah, x.status, x.source])).toEqual([[78, 'memorized', 'report'], [67, 'in_progress', 'report']]);
  });

  it('an edit replaces practice (the old rows are kept, withdrawn) and appends a mark only where the status changed', async () => {
    const r = await http(teacher, 'POST', `/lessons/${lessonId}/report/edit`, {
      coveredTopics: ['new_memorization'],
      practice: [{ surah: 67, ayahFrom: 11, ayahTo: 20 }],
      memorization: [{ surah: 78, status: 'memorized' }, { surah: 67, status: 'needs_revision' }],
    });
    expect(r.status).toBe(201);
    const rows = await g.prisma.lessonReportPractice.findMany({ where: { lessonId }, orderBy: { addedAt: 'asc' } });
    expect(rows.filter((x) => x.withdrawnAt === null).map((x) => [x.surah, x.ayahFrom, x.ayahTo])).toEqual([[67, 11, 20]]);
    expect(rows.filter((x) => x.withdrawnAt !== null)).toHaveLength(2);
    const marks = await g.prisma.memorizationMark.findMany({ where: { learnerId: childId }, orderBy: { seq: 'asc' } });
    expect(marks.map((x) => [x.surah, x.status, x.source])).toEqual([
      [78, 'memorized', 'report'], [67, 'in_progress', 'report'], [67, 'needs_revision', 'report_edit'],
    ]);
    // An edit that leaves practice out leaves it as it was.
    await http(teacher, 'POST', `/lessons/${lessonId}/report/edit`, { coveredTopics: ['revision'] });
    expect(await g.prisma.lessonReportPractice.count({ where: { lessonId, withdrawnAt: null } })).toBe(1);
  });

  it('the map is append-only in the database, and practice is never deleted', async () => {
    await expect(g.prisma.$executeRawUnsafe(`update chat.memorization_mark set status = 'not_started' where learner_id = '${childId}'::uuid`)).rejects.toThrow(/append-only/);
    await expect(g.prisma.$executeRawUnsafe(`delete from chat.memorization_mark where learner_id = '${childId}'::uuid`)).rejects.toThrow(/append-only/);
    await expect(g.prisma.$executeRawUnsafe(`delete from chat.lesson_report_practice where lesson_id = '${lessonId}'::uuid`)).rejects.toThrow(/never deleted/);
    // Practice outside the report's transaction or a revision is refused.
    await expect(g.prisma.lessonReportPractice.create({
      data: { organizationId: orgId, lessonId, position: 9, kind: 'ayah_range', surah: 1, ayahFrom: 1, ayahTo: 7 },
    })).rejects.toThrow(/with the report or with a recorded report revision/);
    // A teacher's mark for another teacher's student.
    const foreignTeacher = m.teachers.find((t) => t.id !== teacherId)!;
    await expect(g.prisma.memorizationMark.create({
      data: { organizationId: orgId, learnerId: childId, surah: 1, status: 'memorized', source: 'correction', reason: 'x', byKind: 'teacher', byId: foreignTeacher.id },
    })).rejects.toThrow(/own students/);
  });

  it('the memorization map is retired: its routes answer 410 to everyone, and its data stays', async () => {
    const before = await g.prisma.memorizationMark.count({ where: { learnerId: childId } });
    for (const who of [parent, teacher, supervisor, m.superAdmin.subject]) {
      for (const [method, path, body] of [
        ['GET', `/learners/${childId}/materials/progress`],
        ['GET', `/learners/${childId}/materials/progress/78`],
        ['POST', `/learners/${childId}/materials/progress/78/correct`, { status: 'memorized', reason: 'x' }],
      ] as const) {
        const r = await http(who, method, path, body);
        expect({ who, path, status: r.status, code: r.code }).toEqual({ who, path, status: 410, code: CommErrorCode.MATERIAL_RETIRED });
      }
    }
    expect(await g.prisma.memorizationMark.count({ where: { learnerId: childId } })).toBe(before);
    expect(before).toBeGreaterThan(0);
  });
});

describe('7. the child\'s page', () => {
  it('who may read it: the family, the child\'s teacher, staff in PD-8 scope -- not another family or another teacher', async () => {
    for (const who of [parent, teacher, supervisor, manager, m.superAdmin.subject]) {
      expect({ who, status: (await http(who, 'GET', `/learners/${childId}/materials/library`)).status }).toEqual({ who, status: 200 });
    }
    for (const who of [otherFamilyParent, otherTeacher, org2Owner]) {
      expect({ who, status: (await http(who, 'GET', `/learners/${childId}/materials/opened`)).status }).toEqual({ who, status: 404 });
    }
  });

  it('the library opens on the child\'s age band; "all" shows every age; items for no band suit everyone', async () => {
    await g.prisma.learnerEnrollment.upsert({
      where: { learnerId: childId },
      create: { learnerId: childId, organizationId: orgId, birthDate: new Date(Date.now() - 8.5 * 365.25 * 24 * HOUR), updatedBy: m.superAdmin.id },
      update: { birthDate: new Date(Date.now() - 8.5 * 365.25 * 24 * HOUR) },
    });
    const young = await linkItem(manager, { titleAr: 'صغار', ageGroups: ['4-6'] });
    const mine = await linkItem(manager, { titleAr: 'متوسط', ageGroups: ['7-9'] });
    const everyone = await linkItem(manager, { titleAr: 'للجميع', ageGroups: [] });
    const lib = await http(parent, 'GET', `/learners/${childId}/materials/library`);
    expect(lib.json).toMatchObject({ child: { id: childId, name: childName, age: 8, ageGroup: '7-9' }, ageGroup: '7-9', viewer: 'family' });
    const ids = lib.json.items.map((i: any) => i.id);
    expect(ids).toEqual(expect.arrayContaining([mine.id, everyone.id]));
    expect(ids).not.toContain(young.id);
    const all = await http(parent, 'GET', `/learners/${childId}/materials/library?ageGroup=all`);
    expect(all.json.items.map((i: any) => i.id)).toEqual(expect.arrayContaining([young.id, mine.id, everyone.id]));
    const arabic = await http(parent, 'GET', `/learners/${childId}/materials/library?subject=quran&ageGroup=all`);
    expect(arabic.json.items.every((i: any) => i.subject === 'quran')).toBe(true);
    expect(lib.json.items.every((i: any) => !('url' in i))).toBe(true);
  });

  it('recitations: only on an allowed host, only through the release gate; a track overrides the template; managers only', async () => {
    const setConfig = (key: string, value: unknown) => g.prisma.$executeRawUnsafe(
      `insert into chat.config (key, value, scope, description) values ($1, $2::jsonb, 'quran', 'pd029-materials-http.spec')
       on conflict (key) do update set value = excluded.value`, key, JSON.stringify(value),
    );
    try {
      expect((await http(parent, 'POST', '/materials/recitations/1/open')).status).toBe(404);
      expect((await http(teacher, 'POST', '/materials/admin/recitations/sources', { name: 'x' })).status).toBe(403);
      const bad = await http(manager, 'POST', '/materials/admin/recitations/sources', { name: 'Source', urlTemplate: 'http://audio.example.test/{surah}.mp3' });
      expect(bad.status).toBe(400);
      // A host not allowed in code cannot be saved at all.
      const unknown = await http(manager, 'POST', '/materials/admin/recitations/sources', { name: 'Unknown', urlTemplate: 'https://cdn.unknown.example.test/{surah}.mp3' });
      expect(unknown.status).toBe(400);
      expect(JSON.stringify(unknown.json)).toMatch(/not an allowed recitation host/);
      const source = await http(manager, 'POST', '/materials/admin/recitations/sources', { name: 'Authorized source', urlTemplate: 'https://audio.example.test/{surah3}.mp3', isDefault: true });
      expect(source.status).toBe(201);
      // The release gate is unset (none): nobody opens a recitation, whatever the source.
      expect((await http(parent, 'POST', '/materials/recitations/1/open')).status).toBe(404);
      await setConfig('quran.audio.enabled_for', 'all');
      // all + the host's licence recorded in code: a family opens it.
      expect((await http(parent, 'POST', '/materials/recitations/1/open')).json).toMatchObject({ surah: 1, url: 'https://audio.example.test/001.mp3', source: { name: 'Authorized source' } });

      const token = await upload(manager, 'mulk.mp3', 'audio/mpeg', MP3, 'recitation');
      const set = await http(manager, 'POST', `/materials/admin/recitations/sources/${source.json.id}/surahs/67`, { uploadToken: token });
      expect(set.status).toBe(201);
      // An uploaded file has no licence record: never a family, only the testers.
      expect((await http(parent, 'POST', '/materials/recitations/67/open')).status).toBe(404);
      expect((await http(manager, 'POST', '/materials/recitations/67/open')).status).toBe(404);
      await setConfig('quran.audio.test_staff_ids', [m.teachersManager.id]);
      expect((await http(manager, 'POST', '/materials/recitations/67/open')).json.url).toMatch(/^https:\/\/storage\.pd29\.example\.test\//);
      await http(manager, 'POST', `/materials/admin/recitations/sources/${source.json.id}/surahs/67`, { clear: true });
      expect((await http(parent, 'POST', '/materials/recitations/67/open')).json.url).toBe('https://audio.example.test/067.mp3');
      // Back to none: nobody again.
      await setConfig('quran.audio.enabled_for', 'none');
      expect((await http(parent, 'POST', '/materials/recitations/1/open')).status).toBe(404);
      expect((await http(manager, 'POST', '/materials/recitations/67/open')).status).toBe(404);
    } finally {
      await g.prisma.$executeRawUnsafe(`delete from chat.config where key in ('quran.audio.enabled_for', 'quran.audio.test_staff_ids')`);
    }
  });

  it('opened this week: an open FOR a child is recorded; each item once, last opened first; only those who read the child see it', async () => {
    const a = await linkItem(manager, { titleAr: 'أ' });
    const b = await linkItem(manager, { titleAr: 'ب' });
    // Opening without a child records nothing.
    await http(parent, 'POST', `/materials/items/${a.id}/open`);
    expect(await g.prisma.materialOpen.count({ where: { itemId: a.id } })).toBe(0);
    expect((await http(parent, 'POST', `/materials/items/${a.id}/open`, { learnerId: childId })).status).toBe(201);
    expect((await http(teacher, 'POST', `/materials/items/${b.id}/open`, { learnerId: childId })).status).toBe(201);
    expect((await http(parent, 'POST', `/materials/items/${a.id}/open`, { learnerId: childId })).status).toBe(201);
    const r = await http(parent, 'GET', `/learners/${childId}/materials/opened`);
    expect(r.status).toBe(200);
    expect(r.json.timeZone).toBe('Africa/Cairo');
    expect(r.json.items.map((x: any) => [x.item.id, x.times])).toEqual([[a.id, 2], [b.id, 1]]);
    expect(Date.parse(r.json.weekStartsAt)).toBeLessThanOrEqual(Date.now());
    // Opening for someone else's child is refused and records nothing.
    expect((await http(otherFamilyParent, 'POST', `/materials/items/${a.id}/open`, { learnerId: childId })).status).toBe(404);
    expect((await http(otherTeacher, 'POST', `/materials/items/${a.id}/open`, { learnerId: childId })).status).toBe(404);
    expect(await g.prisma.materialOpen.count({ where: { learnerId: childId, itemId: a.id } })).toBe(2);
    // Last week's openings are not this week's.
    await g.prisma.$executeRawUnsafe(`alter table chat.material_open disable trigger material_open_is_append_only`);
    await g.prisma.$executeRawUnsafe(`update chat.material_open set opened_at = now() - interval '8 days' where item_id = '${b.id}'::uuid`);
    await g.prisma.$executeRawUnsafe(`alter table chat.material_open enable trigger material_open_is_append_only`);
    expect((await http(parent, 'GET', `/learners/${childId}/materials/opened`)).json.items.map((x: any) => x.item.id)).toEqual([a.id]);
    // Append-only.
    await expect(g.prisma.$executeRawUnsafe(`delete from chat.material_open where item_id = '${a.id}'::uuid`)).rejects.toThrow(/never changed or removed/);
  });

  it('one order everywhere: Quran Al-Fatihah first then by surah descending; the rest in the order provided', async () => {
    const r = await http(manager, 'POST', '/materials/admin/import', {
      manifest: [
        'ref,title_ar,subject,surah,path,status',
        'ord-78,النبأ,quran,78,/lessons/quran/surah-78x,published',
        'ord-ar-2,درس عربي ٢,arabic,,/lessons/arabic/x2,published',
        'ord-114,الناس,quran,114,/lessons/quran/surah-114x,published',
        'ord-ar-1,درس عربي ١,arabic,,/lessons/arabic/x1,published',
        'ord-1,الفاتحة,quran,1,/lessons/quran/surah-1x,published',
        'ord-112,الإخلاص,quran,112,/lessons/quran/surah-112x,published',
        'ord-is-1,درس إسلامي,islamic_studies,,/lessons/islamic/x1,published',
      ].join('\r\n'),
      dryRun: false,
    });
    expect(r.json.committed).toBe(true);
    const ours = (ids: string[]) => ids.filter((x) => x.startsWith('ord-'));
    const admin = (await http(manager, 'GET', '/materials/admin/items')).json.items.map((i: any) => i.externalRef ?? '');
    expect(ours(admin)).toEqual(['ord-1', 'ord-114', 'ord-112', 'ord-78', 'ord-ar-2', 'ord-ar-1', 'ord-is-1']);
    const lib = await http(parent, 'GET', `/learners/${childId}/materials/library?subject=quran&ageGroup=all`);
    const quran = lib.json.items.map((i: any) => i.titleAr);
    expect(quran.filter((t: string) => ['الفاتحة', 'الناس', 'الإخلاص', 'النبأ'].includes(t))).toEqual(['الفاتحة', 'الناس', 'الإخلاص', 'النبأ']);
    const arabic = (await http(teacher, 'GET', '/materials/items?subject=arabic')).json.items.map((i: any) => i.titleAr);
    expect(arabic.filter((t: string) => t.startsWith('درس عربي'))).toEqual(['درس عربي ٢', 'درس عربي ١']);
    // The provided order is the row number, kept by a re-import, editable later.
    const ar2 = await g.prisma.materialItem.findFirstOrThrow({ where: { organizationId: orgId, externalRef: 'ord-ar-2' } });
    expect(ar2.sortOrder).toBe(2);
    await http(manager, 'POST', '/materials/admin/import', { manifest: 'ref,title_ar,subject,path\r\nord-ar-2,درس عربي ٢,arabic,/lessons/arabic/x2\r\n', dryRun: false });
    expect((await g.prisma.materialItem.findUniqueOrThrow({ where: { id: ar2.id } })).sortOrder).toBe(2);
    await http(manager, 'POST', `/materials/admin/items/${ar2.id}`, { sortOrder: 9 });
    expect((await g.prisma.materialItem.findUniqueOrThrow({ where: { id: ar2.id } })).sortOrder).toBe(9);
  });

  it('the surah table in the database is the one the API ships', async () => {
    const rows = await g.prisma.quranSurah.findMany({ orderBy: { number: 'asc' } });
    expect(rows.map((r) => [r.number, r.nameAr, r.nameEn, r.ayahCount, r.juz, r.juzEnd]))
      .toEqual(SURAHS.map((s) => [s.number, s.nameAr, s.nameEn, s.ayahCount, s.juz, s.juzEnd]));
    const r = await http(teacher, 'GET', '/materials/quran/surahs');
    expect(r.json.surahs).toHaveLength(114);
    await expect(g.prisma.$executeRawUnsafe(`update chat.quran_surah set ayah_count = 8 where number = 1`)).rejects.toThrow(/reference data/);
  });

  it('the teacher\'s picker lists published items only, and is not for families', async () => {
    const draft = await linkItem(manager, { status: 'draft', titleAr: 'مسودة' });
    const r = await http(teacher, 'GET', '/materials/items?subject=arabic');
    expect(r.status).toBe(200);
    expect(r.json.items.map((i: any) => i.id)).not.toContain(draft.id);
    expect(r.json.items.every((i: any) => i.subject === 'arabic')).toBe(true);
    expect((await http(parent, 'GET', '/materials/items')).status).toBe(403);
  });
});
