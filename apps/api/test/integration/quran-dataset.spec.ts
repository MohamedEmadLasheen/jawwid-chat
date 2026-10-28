/**
 * The shared Quran dataset against the real schema (migration 20261027170000;
 * docs/product/quran-dataset-contract.md). The owner's rules, end to end:
 *   1. the text is written only by chat.load_quran_dataset, which refuses a
 *      count mismatch, a split ayah, a wrong digest or a Basmala that is not an
 *      accepted one, derives the split and text_search itself, all or nothing;
 *   2. loaded text is never changed or removed;
 *   3. an ayah's audio is written only by the server's ingest, its key
 *      generated from the ayah itself;
 *   4. a Tajweed mark starts pending, is reviewed once by a Tajweed reviewer,
 *      and is served only when named by the latest sign-off of its surah (which
 *      records the marks' digest) and not withdrawn;
 *   5. the API serves only a dataset pinned in code, as { basmala, text }, and
 *      refuses (503) one that is configured but not pinned.
 *
 * Kind to a shared database: the synthetic datasets' ids are derived from their
 * content, so a re-run reuses them ('already loaded') instead of adding 6,236
 * rows; the reviewer fixtures (append-only Tajweed rows reference them) are
 * created once and kept; chat.config quran.dataset is restored in a finally.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import { PlatformModule } from '@platform/platform.module';
import { AuthModule } from '@platform/auth/auth.module';
import { AuthService } from '@platform/auth/auth.service';
import { hashPassword } from '@platform/auth/password';
import { CommErrorCode } from '@platform/errors';
import { CommErrorFilter } from '@communication/api/http-exception.filter';
import { REDIS_CLIENT } from '@communication/realtime/redis.provider';
import type { ObjectStorage, StoredObject } from '@communication/attachments/object-storage';
import { applyInfrastructure } from '../../src/infra/http/bootstrap';
import { QuranModule } from '../../src/quran/quran.module';
import { QURAN_AUDIO_SOURCES, QURAN_PINNED } from '../../src/quran/quran-text.service';
import { audioKey } from '../../src/quran/audio-key';
import { ingestAyahAudio, prismaAudioRowWriter } from '../../src/quran/audio-ingest';
import { digestOf, sha256Hex, type PinnedDataset } from '../../src/quran/quran-integrity';
import { marksDigest } from '../../src/quran/tajweed';
import { BASMALA, syntheticRows } from '../unit/quran/fixtures';
import { buildGraph } from './harness';

// QuranModule signs audio URLs, so it builds the object storage (local reference storage in tests).
process.env.STORAGE_SIGNING_SECRET ??= 'integration-storage-secret-32-chars-ok!';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';

jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const PASSWORD = 'quran-dataset-spec-password-1';
const DOMAIN = 'qurands.qa.jawwid.test';
const RUN = Date.now().toString(36);
/** The test recitation: its audio row is written by the ingest test, then served through the gate. */
const AUDIO_RECITER = `t${RUN}`.slice(0, 20);

type Row = { surah: number; ayah: number; text: string };
const ROWS: Row[] = syntheticRows().map((r) => ({ surah: r.surah, ayah: r.ayah, text: r.text }));
const digest = (rs: Row[]) => digestOf([...rs].sort((a, b) => a.surah - b.surah || a.ayah - b.ayah).map((r) => sha256Hex(r.text)));
const DIGEST = digest(ROWS);
// Content-derived ids: the same rows always load as the same dataset.
const DATASET = `synthetic-${DIGEST.slice(0, 12)}`;
const UNPINNED = `unpinned-${DIGEST.slice(0, 12)}`;
const FILE_SHA = 'a'.repeat(64);
const pinned: PinnedDataset = { id: DATASET, fileSha256: FILE_SHA, ayahsDigest: DIGEST, attribution: 'test', sourceUrl: 'https://example.test/quran' };

const g = buildGraph();
let app: INestApplication;
let base: string;
let token: string;
let reviewer: string; // a Teachers department manager: a Tajweed reviewer
let outsider: string; // a staff member outside the Teachers department
let originalDataset: unknown = null;

/** What scripts/db/load-quran.py does in psql: stage the VERBATIM rows, call the load function, one transaction. */
async function load(id: string, rs: Row[], ayahsDigest = digest(rs), fileSha = FILE_SHA): Promise<string> {
  return g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`create temp table quran_load (surah smallint, ayah smallint, text_uthmani text) on commit drop`);
    await tx.$executeRawUnsafe(
      `insert into quran_load select * from unnest($1::smallint[], $2::smallint[], $3::text[])`,
      rs.map((r) => r.surah), rs.map((r) => r.ayah), rs.map((r) => r.text),
    );
    const out = await tx.$queryRawUnsafe<Array<{ r: string }>>(
      `select chat.load_quran_dataset($1, $2, $3, 'test', 'https://example.test/quran') as r`, id, fileSha, ayahsDigest,
    );
    return out[0]!.r;
  }, { timeout: 120_000 });
}

async function refused(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return String((e as Error).message);
  }
  throw new Error('expected a refusal');
}

async function http(path: string) {
  const r = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
  const json = (await r.json().catch(() => ({}))) as { error?: { code?: string } } & Record<string, any>;
  return { status: r.status, code: json.error?.code, json };
}

async function setDataset(id: string) {
  await g.prisma.$executeRawUnsafe(
    `insert into chat.config (key, value, scope, description) values ('quran.dataset', to_jsonb($1::text), 'quran', 'quran-dataset.spec')
     on conflict (key) do update set value = excluded.value`, id,
  );
}

/**
 * One organization, created once and kept: a super admin (who signs in for the HTTP
 * checks), a manager-role staff member who manages its Teachers department (the
 * Tajweed reviewer; chat.guard_department requires the manager role), and an outsider.
 */
async function fixtures(): Promise<void> {
  const slug = 'qurands-fixture';
  let org = (await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(`select id::text from chat.organization where slug = $1`, slug))[0]?.id;
  if (!org) {
    org = randomUUID();
    await g.prisma.$executeRawUnsafe(`insert into chat.organization (id, slug, display_name) values ($1::uuid, $2, 'Quran dataset QA')`, org, slug);
  }
  // Other suites truncate chat.staff (not chat.account), so a kept account may have lost its staff row.
  const staffFor = async (subject: string, role: string, name: string): Promise<string> => {
    const existing = await g.prisma.staff.findFirst({ where: { organizationId: org, account: { subject } } });
    if (existing) return existing.id;
    return g.prisma.$transaction(async (tx) => {
      if (role === 'super_admin') await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
      let account = await tx.account.findFirst({ where: { subject } });
      if (account && account.organizationId !== org) throw new Error(`${subject} belongs to another organization; clear it first`);
      if (!account) {
        account = await tx.account.create({ data: { organizationId: org!, subject, kind: 'staff', status: 'active', isActive: true } });
        await tx.accountCredential.create({ data: { accountId: account.id, passwordHash: await hashPassword(PASSWORD) } });
      }
      return (await tx.staff.create({ data: { organizationId: org!, name, role, isActive: true, accountId: account.id } })).id;
    });
  };
  await staffFor(`owner@${DOMAIN}`, 'super_admin', 'QA Owner');
  reviewer = await staffFor(`reviewer@${DOMAIN}`, 'manager', 'QA Tajweed reviewer');
  outsider = await staffFor(`outsider@${DOMAIN}`, 'admin', 'QA outsider');
  await g.prisma.$executeRawUnsafe(
    `insert into chat.department (organization_id, kind, display_name, manager_id) values ($1::uuid, 'teachers', 'Teachers', $2::uuid)
     on conflict (organization_id, kind) do update set manager_id = excluded.manager_id`, org, reviewer,
  );
}

beforeAll(async () => {
  await g.prisma.$connect();
  await fixtures();
  expect(['loaded', 'already loaded']).toContain(await load(DATASET, ROWS));
  const original = await g.prisma.config.findUnique({ where: { key: 'quran.dataset' } });
  originalDataset = original?.value ?? null;
  await setDataset(DATASET);

  process.env.REDIS_URL = REDIS_URL;
  const moduleRef = await Test.createTestingModule({ imports: [PlatformModule, AuthModule, QuranModule] })
    .overrideProvider(QURAN_PINNED).useValue(new Map([[DATASET, pinned]]))
    // A test recitation pinned like a real one, with NO licence recorded (so staff only).
    .overrideProvider(QURAN_AUDIO_SOURCES).useValue(new Map([[AUDIO_RECITER, { reciter: AUDIO_RECITER, name: 'test', attribution: 'test', licence: null, archives: [] }]]))
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] });
  app.useGlobalFilters(new CommErrorFilter());
  applyInfrastructure(app);
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/api/v1`;
  token = (await app.get(AuthService).login(`owner@${DOMAIN}`, PASSWORD)).accessToken;
});

afterAll(async () => {
  let redis: Redis | undefined;
  try {
    redis = app?.get<Redis>(REDIS_CLIENT, { strict: false });
  } catch {
    redis = undefined; // this module set may not provide a Redis client
  }
  await app?.close();
  for (let i = 0; i < 40 && redis && redis.status !== 'end'; i++) await new Promise((r) => setTimeout(r, 50));
  try {
    if (originalDataset === null) await g.prisma.$executeRawUnsafe(`delete from chat.config where key = 'quran.dataset'`);
    else await g.prisma.$executeRawUnsafe(`update chat.config set value = $1::jsonb where key = 'quran.dataset'`, JSON.stringify(originalDataset));
    await g.prisma.$executeRawUnsafe(`delete from chat.config where key in ('quran.audio', 'quran.audio.enabled_for')`);
  } finally {
    await g.prisma.$disconnect();
    if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = inheritedRedisUrl;
  }
});

describe('the load function', () => {
  it('loaded every ayah with its hash, split the Basmala and derived text_search, and skips a reload', async () => {
    const n = await g.prisma.$queryRawUnsafe<Array<{ n: number; bad: number; basmalas: number }>>(
      `select count(*)::int as n,
              count(*) filter (where sha256 <> chat.sha256_hex(text_uthmani) or verse_sha256 <> chat.sha256_hex(verse)
                                  or text_search <> chat.quran_fold(verse))::int as bad,
              count(basmala)::int as basmalas
         from chat.quran_ayah where dataset_id = $1`, DATASET,
    );
    expect(n[0]).toEqual({ n: 6236, bad: 0, basmalas: 112 });
    const two = await g.prisma.$queryRawUnsafe<Array<{ basmala: string | null; verse: string }>>(
      `select basmala, verse from chat.quran_ayah where dataset_id = $1 and surah = 2 and ayah = 1`, DATASET,
    );
    expect(two[0]).toEqual({ basmala: BASMALA, verse: 'نص 2:1' });
    expect(await load(DATASET, ROWS)).toBe('already loaded');
    expect(await refused(load(DATASET, ROWS, DIGEST, 'b'.repeat(64)))).toMatch(/different fingerprint/);
  });

  it('refuses a count mismatch, a split ayah, an empty ayah, a wrong digest and a bad Basmala, writing nothing', async () => {
    const id = `refused-${DIGEST.slice(0, 12)}`;
    expect(await refused(load(id, ROWS.filter((r) => !(r.surah === 89 && r.ayah === 23))))).toMatch(/6235 ayat, expected 6236/);
    const split = ROWS.map((r) => (r.surah === 89 && r.ayah === 30 ? { ...r, ayah: 31 } : r));
    expect(await refused(load(id, split))).toMatch(/do not match chat\.quran_surah: 89/);
    expect(await refused(load(id, ROWS.map((r) => (r.surah === 108 && r.ayah === 2 ? { ...r, text: '' } : r))))).toMatch(/empty ayah/);
    expect(await refused(load(id, ROWS, 'c'.repeat(64)))).toMatch(/digest/);
    const corrupted = ROWS.map((r) => (r.surah === 2 && r.ayah === 1 ? { ...r, text: r.text.slice(0, 2) + r.text.slice(3) } : r));
    expect(await refused(load(id, corrupted))).toMatch(/Basmala is not an accepted one.*2:1/);
    const nine = ROWS.map((r) => (r.surah === 9 && r.ayah === 1 ? { ...r, text: `${BASMALA} ${r.text}` } : r));
    expect(await refused(load(id, nine))).toMatch(/9:1/);
    const written = await g.prisma.$queryRawUnsafe<Array<{ n: number }>>(`select count(*)::int as n from chat.quran_dataset where id = $1`, id);
    expect(written[0]!.n).toBe(0);
  });

  it('accepts no text written any other way, and never changes, removes or truncates loaded text', async () => {
    expect(await refused(g.prisma.$executeRawUnsafe(
      `insert into chat.quran_ayah (dataset_id, surah, ayah, text_uthmani, sha256, verse, verse_sha256, text_search) values ($1, 1, 1, 'x', $2, 'x', $2, 'x')`, DATASET, sha256Hex('x'),
    ))).toMatch(/only by chat\.load_quran_dataset/);
    expect(await refused(g.prisma.$executeRawUnsafe(`update chat.quran_ayah set text_uthmani = 'x' where dataset_id = $1 and surah = 1 and ayah = 1`, DATASET)))
      .toMatch(/never changed or removed/);
    expect(await refused(g.prisma.$executeRawUnsafe(`delete from chat.quran_ayah where dataset_id = $1 and surah = 1`, DATASET)))
      .toMatch(/never changed or removed/);
    expect(await refused(g.prisma.$executeRawUnsafe(`update chat.quran_dataset set sha256 = $2 where id = $1`, DATASET, 'd'.repeat(64))))
      .toMatch(/never changed or removed/);
    // The text and the audio cannot be truncated either. (The Tajweed tables reference
    // chat.staff, which the harness truncates with CASCADE, so they carry no such guard.)
    for (const t of ['quran_ayah', 'quran_dataset', 'quran_ayah_audio']) {
      expect(await refused(g.prisma.$executeRawUnsafe(`truncate chat.${t} cascade`))).toMatch(/never changed or removed/);
    }
  });

  it('folds text_search exactly as the app does (the shared vectors)', async () => {
    const file = join(__dirname, '../../../../data/quran/search-normalisation.vectors.json');
    const vectors = (JSON.parse(readFileSync(file, 'utf8')) as { vectors: Array<{ input: string; folded: string; note: string }> }).vectors;
    for (const v of vectors) {
      const r = await g.prisma.$queryRawUnsafe<Array<{ f: string }>>(`select chat.quran_fold($1) as f`, v.input);
      expect({ note: v.note, folded: r[0]!.f }).toEqual({ note: v.note, folded: v.folded });
    }
  });
});

describe('audio: written only by the server\'s ingest, one key per ayah', () => {
  const reciter = AUDIO_RECITER;
  const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(300, 9)]);
  const storage = {
    async read(key: string): Promise<StoredObject | null> {
      return key === audioKey(reciter, 85, 3) ? { mimeType: 'audio/mpeg', size: MP3.length, range: null, body: MP3 } : null;
    },
  } as unknown as ObjectStorage;

  it('refuses a row written any other way; the ingest hashes the object and the key is generated', async () => {
    expect(await refused(g.prisma.$executeRawUnsafe(
      `insert into chat.quran_ayah_audio (reciter_code, surah, ayah, sha256, byte_size) values ($1, 85, 3, $2, 10)`, reciter, 'e'.repeat(64),
    ))).toMatch(/only by the server's ingest/);
    await ingestAyahAudio(storage, prismaAudioRowWriter(g.prisma), reciter, 85, 3);
    const stored = await g.prisma.$queryRawUnsafe<Array<{ object_key: string; sha256: string; byte_size: number }>>(
      `select object_key, sha256, byte_size from chat.quran_ayah_audio where reciter_code = $1 and surah = 85 and ayah = 3`, reciter,
    );
    expect(stored[0]).toEqual({ object_key: audioKey(reciter, 85, 3), sha256: createHash('sha256').update(MP3).digest('hex'), byte_size: MP3.length });
    expect(await refused(g.prisma.$executeRawUnsafe(`update chat.quran_ayah_audio set surah = 78 where reciter_code = $1`, reciter)))
      .toMatch(/never changed or removed/);
  });
});

describe('Tajweed', () => {
  async function insertMark(ayah: number, start: number, end: number, rule = 'ikhfa'): Promise<string> {
    const r = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `insert into chat.quran_tajweed_mark (dataset_id, surah, ayah, start_cp, end_cp, rule, source, source_version)
       values ($1, 101, $2, $3, $4, $5, 'qul', $6) returning id::text`, DATASET, ayah, start, end, rule, `run-${RUN}`,
    );
    return r[0]!.id;
  }
  const approve = (id: string, by: string) =>
    g.prisma.$executeRawUnsafe(`update chat.quran_tajweed_mark set state = 'approved', reviewed_by = $2::uuid, reviewed_at = now() where id = $1::uuid`, id, by);
  const signOff = (ids: string[], digestOverride?: string, by = reviewer) =>
    g.prisma.$executeRawUnsafe(
      `insert into chat.quran_tajweed_review (dataset_id, surah, source, source_version, mark_ids, marks_digest, reviewed_by)
       values ($1, 101, 'qul', $2, $3::uuid[], coalesce($4, chat.quran_tajweed_marks_digest($3::uuid[])), $5::uuid)`,
      DATASET, `run-${RUN}`, ids, digestOverride ?? null, by,
    );
  const mine = async () =>
    ((await http('/quran/tajweed?surah=101&from=1&to=11')).json.marks as Array<{ ayah: number; sourceVersion: string }>)
      .filter((m) => m.sourceVersion === `run-${RUN}`);

  let a: string;
  let b: string;

  it('a mark starts pending, is reviewed once by a Tajweed reviewer, and cannot be removed or reach past its verse', async () => {
    expect(await refused(g.prisma.$executeRawUnsafe(
      `insert into chat.quran_tajweed_mark (dataset_id, surah, ayah, start_cp, end_cp, rule, source, source_version, state, reviewed_by, reviewed_at)
       values ($1, 101, 6, 0, 2, 'ikhfa', 'qul', 'v', 'approved', $2::uuid, now())`, DATASET, reviewer,
    ))).toMatch(/starts pending/);
    // Offsets are into the VERSE: 101:1's verse is 'نص 101:1' (8 code points), never the Basmala before it.
    expect(await refused(insertMark(1, 0, 9))).toMatch(/past the end of verse/);
    a = await insertMark(6, 0, 2);
    expect(await refused(approve(a, outsider))).toMatch(/only a Tajweed reviewer/);
    await approve(a, reviewer);
    expect(await refused(g.prisma.$executeRawUnsafe(`update chat.quran_tajweed_mark set state = 'rejected' where id = $1::uuid`, a))).toMatch(/reviewed once/);
    expect(await refused(g.prisma.$executeRawUnsafe(`update chat.quran_tajweed_mark set end_cp = 3 where id = $1::uuid`, a))).toMatch(/reviewed once/);
    expect(await refused(g.prisma.$executeRawUnsafe(`delete from chat.quran_tajweed_mark where id = $1::uuid`, a))).toMatch(/reject or withdraw/);
  });

  it('is served only once a sign-off names it; a mark approved later waits for a new sign-off', async () => {
    expect(await mine()).toEqual([]); // approved, but no sign-off yet
    expect(await refused(signOff([a], 'f'.repeat(64)))).toMatch(/digest/);
    expect(await refused(signOff([a], undefined, outsider))).toMatch(/only a Tajweed reviewer/);
    await signOff([a]);
    expect((await mine()).map((m) => m.ayah)).toEqual([6]);
    b = await insertMark(7, 0, 2);
    await approve(b, reviewer);
    expect((await mine()).map((m) => m.ayah)).toEqual([6]); // b is approved but not signed
    expect(await refused(signOff([a, b, b]))).toMatch(/each once/);
    await signOff([a, b]);
    expect((await mine()).map((m) => m.ayah)).toEqual([6, 7]);
    const review = await g.prisma.$queryRawUnsafe<Array<{ d: string }>>(
      `select marks_digest as d from chat.quran_tajweed_review where source_version = $1 order by reviewed_at desc limit 1`, `run-${RUN}`,
    );
    expect(review[0]!.d).toBe(marksDigest([{ ayah: 6, start: 0, end: 2, rule: 'ikhfa' }, { ayah: 7, start: 0, end: 2, rule: 'ikhfa' }]));
  });

  it('a withdrawn mark is no longer served; the withdrawal is a record, and a sign-off cannot name it', async () => {
    expect(await refused(g.prisma.$executeRawUnsafe(
      `insert into chat.quran_tajweed_withdrawal (mark_id, withdrawn_by, reason) values ($1::uuid, $2::uuid, 'x')`, a, outsider,
    ))).toMatch(/only a Tajweed reviewer/);
    await g.prisma.$executeRawUnsafe(`insert into chat.quran_tajweed_withdrawal (mark_id, withdrawn_by, reason) values ($1::uuid, $2::uuid, 'source corrected')`, a, reviewer);
    expect((await mine()).map((m) => m.ayah)).toEqual([7]);
    expect(await refused(signOff([a, b]))).toMatch(/unwithdrawn/);
    expect(await refused(g.prisma.$executeRawUnsafe(`delete from chat.quran_tajweed_withdrawal where mark_id = $1::uuid`, a))).toMatch(/never changed or removed/);
    expect(await refused(g.prisma.$executeRawUnsafe(`delete from chat.quran_tajweed_review where source_version = $1`, `run-${RUN}`))).toMatch(/never changed or removed/);
  });
});

describe('GET /quran/ayahs', () => {
  it('serves the verified text as { basmala, text }, the range fingerprint over the verses', async () => {
    const r = await http('/quran/ayahs?surah=85&from=1&to=22');
    expect(r.status).toBe(200);
    expect(r.json.dataset).toEqual({ id: DATASET, sha256: FILE_SHA, attribution: 'test', sourceUrl: 'https://example.test/quran' });
    expect(r.json.ayahs).toHaveLength(22);
    expect(r.json.ayahs[0]).toMatchObject({ ayah: 1, basmala: BASMALA, text: 'نص 85:1', sha256: sha256Hex('نص 85:1') });
    expect(r.json.ayahs[21]).toMatchObject({ ayah: 22, basmala: null, text: 'نص 85:22', sha256: sha256Hex('نص 85:22'), audio: null });
    expect(r.json.rangeSha256).toBe(digestOf(r.json.ayahs.map((a: { sha256: string }) => a.sha256)));
  });

  it('refuses a bad range (422) and needs a signed-in account', async () => {
    expect((await http('/quran/ayahs?surah=89&from=1&to=31')).code).toBe(CommErrorCode.QURAN_INVALID);
    expect((await fetch(`${base}/quran/ayahs?surah=1`)).status).toBe(401);
  });

  it('attaches audio only through the release gate, the ayah\'s own key and its ingested hash, as a signed URL', async () => {
    const reciter = AUDIO_RECITER;
    const setConfig = (key: string, value: unknown) => g.prisma.$executeRawUnsafe(
      `insert into chat.config (key, value, scope, description) values ($1, $2::jsonb, 'quran', 'quran-dataset.spec')
       on conflict (key) do update set value = excluded.value`, key, JSON.stringify(value),
    );
    await setConfig('quran.audio', { reciter });
    try {
      // The gate is unset, so it is `none`: nobody gets audio, staff included.
      expect((await http('/quran/ayahs?surah=85&from=2&to=4')).json.ayahs.map((a: { audio: unknown }) => a.audio)).toEqual([null, null, null]);
      await setConfig('quran.audio.enabled_for', 'staff_test');
      const r = await http('/quran/ayahs?surah=85&from=2&to=4'); // the owner: a staff account
      const stored = await g.prisma.$queryRawUnsafe<Array<{ sha256: string }>>(`select sha256 from chat.quran_ayah_audio where reciter_code = $1`, reciter);
      const key = audioKey(reciter, 85, 3);
      expect(r.json.ayahs.map((a: { audio: unknown }) => a.audio)).toEqual([
        null,
        { reciter, key, url: expect.stringContaining(`${encodeURIComponent(key)}?expires=`), sha256: stored[0]!.sha256 },
        null,
      ]);
      expect(r.json.ayahs[1].audio.url).toMatch(/&sig=/);
    } finally {
      await g.prisma.$executeRawUnsafe(`delete from chat.config where key in ('quran.audio', 'quran.audio.enabled_for')`);
    }
  });

  it('refuses everything (503) once the configured dataset is not one pinned in code', async () => {
    expect(['loaded', 'already loaded']).toContain(await load(UNPINNED, ROWS));
    try {
      await setDataset(UNPINNED);
      const r = await http('/quran/ayahs?surah=1&from=1&to=7');
      expect(r.status).toBe(503);
      expect(r.code).toBe(CommErrorCode.QURAN_UNAVAILABLE);
    } finally {
      await setDataset(DATASET);
    }
    expect((await http('/quran/ayahs?surah=1&from=1&to=7')).status).toBe(200);
  });
});
