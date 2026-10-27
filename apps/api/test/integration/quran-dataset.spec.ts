/**
 * The shared Quran dataset against the real schema (migration 20261027170000;
 * docs/product/quran-dataset-contract.md). The owner's rules, end to end:
 *   1. the text is written only by chat.load_quran_dataset, which refuses a
 *      count mismatch, a split ayah or a wrong digest, and writes all or nothing;
 *   2. loaded text is never changed or removed;
 *   3. an ayah's audio key is generated from the ayah itself;
 *   4. a Tajweed mark starts pending, is reviewed once, and is served only when
 *      approved AND its surah is signed off for the same source version;
 *   5. the API serves only a dataset pinned in code, and refuses (503) one that
 *      is configured but not pinned.
 * A synthetic dataset with the real ayah counts stands in for the text (the
 * real file is vendored separately); each run uses a fresh dataset id because
 * loaded text cannot be deleted.
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
import { CommErrorFilter } from '@communication/api/http-exception.filter';
import { REDIS_CLIENT } from '@communication/realtime/redis.provider';
import { applyInfrastructure } from '../../src/infra/http/bootstrap';
import { SURAHS } from '../../src/materials/quran-surahs';
import { QuranModule } from '../../src/quran/quran.module';
import { QURAN_PINNED } from '../../src/quran/quran-text.service';
import { audioKey } from '../../src/quran/audio-key';
import { digestOf, sha256Hex, type PinnedDataset } from '../../src/quran/quran-integrity';
import { buildGraph } from './harness';

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-chars-min!';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-chars-min!';

jest.setTimeout(300_000);

const REDIS_URL = process.env.AUTH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6410';
const inheritedRedisUrl = process.env.REDIS_URL;
const PASSWORD = 'quran-dataset-spec-password-1';
const DOMAIN = 'qurands.qa.jawwid.test';
const RUN = Date.now().toString(36);
const DATASET = `synthetic-${RUN}`;
const UNPINNED = `unpinned-${RUN}`;

const g = buildGraph();
let app: INestApplication;
let base: string;
let token: string;
let originalDataset: unknown = null;

type Row = { surah: number; ayah: number; text: string };
function rows(): Row[] {
  const out: Row[] = [];
  for (const s of SURAHS) for (let a = 1; a <= s.ayahCount; a++) out.push({ surah: s.number, ayah: a, text: `نص ${s.number}:${a}` });
  return out;
}
const digest = (rs: Row[]) => digestOf(rs.map((r) => sha256Hex(r.text)));
const FILE_SHA = 'a'.repeat(64);
const pinned: PinnedDataset = { id: DATASET, fileSha256: FILE_SHA, ayahsDigest: digest(rows()), attribution: 'test', sourceUrl: 'https://example.test/quran' };

/** What scripts/db/load-quran.py does in psql: stage the rows, call the load function, one transaction. */
async function load(id: string, rs: Row[], ayahsDigest = digest(rs), fileSha = FILE_SHA): Promise<string> {
  return g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`create temp table quran_load (surah smallint, ayah smallint, text_uthmani text, text_search text) on commit drop`);
    await tx.$executeRawUnsafe(
      `insert into quran_load select * from unnest($1::smallint[], $2::smallint[], $3::text[], $4::text[])`,
      rs.map((r) => r.surah), rs.map((r) => r.ayah), rs.map((r) => r.text), rs.map((r) => r.text),
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

beforeAll(async () => {
  await g.prisma.$connect();
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'qurands-%'`);
  const orgId = randomUUID();
  await g.prisma.$executeRawUnsafe(`insert into chat.organization (id, slug, display_name) values ('${orgId}'::uuid, 'qurands-${RUN}', 'Quran dataset QA')`);
  await g.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`);
    const account = await tx.account.create({ data: { organizationId: orgId, subject: `owner@${DOMAIN}`, kind: 'staff', status: 'active', isActive: true } });
    await tx.accountCredential.create({ data: { accountId: account.id, passwordHash: await hashPassword(PASSWORD) } });
    await tx.staff.create({ data: { organizationId: orgId, name: 'QA Owner', role: 'super_admin', isActive: true, accountId: account.id } });
  });
  expect(await load(DATASET, rows())).toBe('loaded');
  const original = await g.prisma.config.findUnique({ where: { key: 'quran.dataset' } });
  originalDataset = original?.value ?? null;
  await g.prisma.$executeRawUnsafe(
    `insert into chat.config (key, value, scope, description) values ('quran.dataset', to_jsonb($1::text), 'quran', 'quran-dataset.spec')
     on conflict (key) do update set value = excluded.value`, DATASET,
  );

  process.env.REDIS_URL = REDIS_URL;
  const moduleRef = await Test.createTestingModule({ imports: [PlatformModule, AuthModule, QuranModule] })
    .overrideProvider(QURAN_PINNED).useValue(new Map([[DATASET, pinned]]))
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
  if (originalDataset === null) await g.prisma.$executeRawUnsafe(`delete from chat.config where key = 'quran.dataset'`);
  else await g.prisma.$executeRawUnsafe(`update chat.config set value = $1::jsonb where key = 'quran.dataset'`, JSON.stringify(originalDataset));
  await g.prisma.$executeRawUnsafe(`delete from chat.config where key = 'quran.audio'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.account where subject like '%@${DOMAIN}'`);
  await g.prisma.$executeRawUnsafe(`delete from chat.organization where slug like 'qurands-%'`);
  await g.prisma.$disconnect();
  if (inheritedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = inheritedRedisUrl;
});

describe('the load function', () => {
  it('loaded every ayah with its hash, and skips a reload of the same fingerprints', async () => {
    const n = await g.prisma.$queryRawUnsafe<Array<{ n: number; bad: number }>>(
      `select count(*)::int as n,
              count(*) filter (where sha256 <> encode(sha256(convert_to(text_uthmani, 'UTF8')), 'hex'))::int as bad
         from chat.quran_ayah where dataset_id = $1`, DATASET,
    );
    expect(n[0]).toEqual({ n: 6236, bad: 0 });
    expect(await load(DATASET, rows())).toBe('already loaded');
    expect(await refused(load(DATASET, rows(), digest(rows()), 'b'.repeat(64)))).toMatch(/different fingerprint/);
  });

  it('refuses a count mismatch, a split ayah, an empty ayah and a wrong digest, writing nothing', async () => {
    const id = `refused-${RUN}`;
    const all = rows();
    expect(await refused(load(id, all.filter((r) => !(r.surah === 89 && r.ayah === 23))))).toMatch(/6235 ayat, expected 6236/);
    const split = all.map((r) => (r.surah === 89 && r.ayah === 30 ? { ...r, ayah: 31 } : r));
    expect(await refused(load(id, split))).toMatch(/do not match chat\.quran_surah: 89/);
    expect(await refused(load(id, all.map((r) => (r.surah === 108 && r.ayah === 1 ? { ...r, text: '' } : r))))).toMatch(/empty ayah/);
    expect(await refused(load(id, all, 'c'.repeat(64)))).toMatch(/digest/);
    const written = await g.prisma.$queryRawUnsafe<Array<{ n: number }>>(`select count(*)::int as n from chat.quran_dataset where id = $1`, id);
    expect(written[0]!.n).toBe(0);
  });

  it('accepts no text written any other way, and never changes or removes loaded text', async () => {
    expect(await refused(g.prisma.$executeRawUnsafe(
      `insert into chat.quran_ayah (dataset_id, surah, ayah, text_uthmani, text_search, sha256) values ($1, 1, 1, 'x', 'x', $2)`, DATASET, sha256Hex('x'),
    ))).toMatch(/only by chat\.load_quran_dataset|duplicate key/);
    expect(await refused(g.prisma.$executeRawUnsafe(`update chat.quran_ayah set text_uthmani = 'x' where dataset_id = $1 and surah = 1 and ayah = 1`, DATASET)))
      .toMatch(/never changed or removed/);
    expect(await refused(g.prisma.$executeRawUnsafe(`delete from chat.quran_ayah where dataset_id = $1 and surah = 1`, DATASET)))
      .toMatch(/never changed or removed/);
    expect(await refused(g.prisma.$executeRawUnsafe(`update chat.quran_dataset set sha256 = $2 where id = $1`, DATASET, 'd'.repeat(64))))
      .toMatch(/never changed or removed/);
  });
});

describe('audio: one key per ayah, generated from the ayah', () => {
  it('generates the same key as the API and refuses an ayah that does not exist', async () => {
    const reciter = `t${RUN}`.slice(0, 20);
    await g.prisma.$executeRawUnsafe(`insert into chat.quran_ayah_audio (reciter_code, surah, ayah, sha256) values ($1, 85, 3, $2)`, reciter, 'e'.repeat(64));
    const row = await g.prisma.$queryRawUnsafe<Array<{ object_key: string }>>(
      `select object_key from chat.quran_ayah_audio where reciter_code = $1 and surah = 85 and ayah = 3`, reciter,
    );
    expect(row[0]!.object_key).toBe(audioKey(reciter, 85, 3));
    expect(await refused(g.prisma.$executeRawUnsafe(`insert into chat.quran_ayah_audio (reciter_code, surah, ayah, sha256) values ($1, 89, 31, $2)`, reciter, 'e'.repeat(64))))
      .toMatch(/no ayah 31/);
    expect(await refused(g.prisma.$executeRawUnsafe(`insert into chat.quran_ayah_audio (reciter_code, surah, ayah, object_key, sha256) values ($1, 85, 4, 'quran/audio/x/078005.mp3', $2)`, reciter, 'e'.repeat(64))))
      .toMatch(/generated|object_key/i);
    expect(await refused(g.prisma.$executeRawUnsafe(`update chat.quran_ayah_audio set surah = 78 where reciter_code = $1`, reciter)))
      .toMatch(/never changed or removed/);
  });
});

describe('Tajweed marks', () => {
  const reviewer = randomUUID();

  async function insertMark(ayah: number, start: number, end: number, extra = ''): Promise<string> {
    const r = await g.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `insert into chat.quran_tajweed_mark (dataset_id, surah, ayah, start_cp, end_cp, rule, source, source_version${extra ? ', state, reviewed_by, reviewed_at' : ''})
       values ($1, 101, $2, $3, $4, 'ikhfa', 'qul', 'v1'${extra}) returning id::text`, DATASET, ayah, start, end,
    );
    return r[0]!.id;
  }

  it('start pending, are reviewed once, and cannot be removed or reach past their ayah', async () => {
    expect(await refused(insertMark(6, 0, 2, `, 'approved', '${reviewer}'::uuid, now()`))).toMatch(/starts pending/);
    expect(await refused(insertMark(6, 0, 999))).toMatch(/past the end/);
    const id = await insertMark(6, 0, 2);
    await g.prisma.$executeRawUnsafe(`update chat.quran_tajweed_mark set state = 'approved', reviewed_by = $2::uuid, reviewed_at = now() where id = $1::uuid`, id, reviewer);
    expect(await refused(g.prisma.$executeRawUnsafe(`update chat.quran_tajweed_mark set state = 'rejected' where id = $1::uuid`, id))).toMatch(/reviewed once/);
    expect(await refused(g.prisma.$executeRawUnsafe(`update chat.quran_tajweed_mark set end_cp = 3 where id = $1::uuid`, id))).toMatch(/reviewed once/);
    expect(await refused(g.prisma.$executeRawUnsafe(`delete from chat.quran_tajweed_mark where id = $1::uuid`, id))).toMatch(/reject it instead/);
  });

  it('are served only when approved and their surah is signed off for the same source version', async () => {
    const before = await http('/quran/tajweed?surah=101&from=1&to=11');
    expect(before.status).toBe(200);
    expect(before.json.marks).toEqual([]); // approved, but the surah is not signed off yet
    await insertMark(7, 0, 2); // stays pending
    await g.prisma.$executeRawUnsafe(
      `insert into chat.quran_tajweed_review (dataset_id, surah, source, source_version, reviewed_by) values ($1, 101, 'qul', 'v1', $2::uuid)`, DATASET, reviewer,
    );
    const after = await http('/quran/tajweed?surah=101&from=1&to=11');
    expect(after.json.marks).toEqual([{ ayah: 6, start: 0, end: 2, rule: 'ikhfa', source: 'qul', sourceVersion: 'v1' }]);
    expect(await refused(g.prisma.$executeRawUnsafe(`delete from chat.quran_tajweed_review where dataset_id = $1`, DATASET))).toMatch(/never changed or removed/);
  });
});

describe('GET /quran/ayahs', () => {
  it('serves the verified text of the pinned dataset, with the range fingerprint', async () => {
    const r = await http('/quran/ayahs?surah=85&from=1&to=22');
    expect(r.status).toBe(200);
    expect(r.json.dataset).toEqual({ id: DATASET, sha256: FILE_SHA, attribution: 'test', sourceUrl: 'https://example.test/quran' });
    expect(r.json.ayahs).toHaveLength(22);
    expect(r.json.ayahs[21]).toMatchObject({ ayah: 22, text: 'نص 85:22', sha256: sha256Hex('نص 85:22'), audio: null });
    expect(r.json.rangeSha256).toBe(digestOf(r.json.ayahs.map((a: { sha256: string }) => a.sha256)));
  });

  it('refuses a bad range (422) and needs a signed-in account', async () => {
    expect((await http('/quran/ayahs?surah=89&from=1&to=31')).code).toBe(CommErrorCode.QURAN_INVALID);
    expect((await fetch(`${base}/quran/ayahs?surah=1`)).status).toBe(401);
  });

  it('attaches audio only when a source is configured, through the ayah\'s own key', async () => {
    await g.prisma.$executeRawUnsafe(
      `insert into chat.config (key, value, scope, description) values ('quran.audio', $1::jsonb, 'quran', 'quran-dataset.spec')
       on conflict (key) do update set value = excluded.value`,
      JSON.stringify({ reciter: `t${RUN}`.slice(0, 20), baseUrl: 'https://media.example.test' }),
    );
    const r = await http('/quran/ayahs?surah=85&from=2&to=4');
    const reciter = `t${RUN}`.slice(0, 20);
    expect(r.json.ayahs.map((a: { audio: unknown }) => a.audio)).toEqual([
      null,
      { reciter, key: audioKey(reciter, 85, 3), url: `https://media.example.test/${audioKey(reciter, 85, 3)}`, sha256: 'e'.repeat(64) },
      null,
    ]);
  });

  it('refuses everything (503) once the configured dataset is not one pinned in code', async () => {
    expect(await load(UNPINNED, rows())).toBe('loaded');
    await g.prisma.$executeRawUnsafe(`update chat.config set value = to_jsonb($1::text) where key = 'quran.dataset'`, UNPINNED);
    const r = await http('/quran/ayahs?surah=1&from=1&to=7');
    expect(r.status).toBe(503);
    expect(r.code).toBe(CommErrorCode.QURAN_UNAVAILABLE);
    await g.prisma.$executeRawUnsafe(`update chat.config set value = to_jsonb($1::text) where key = 'quran.dataset'`, DATASET);
    expect((await http('/quran/ayahs?surah=1&from=1&to=7')).status).toBe(200);
  });
});
