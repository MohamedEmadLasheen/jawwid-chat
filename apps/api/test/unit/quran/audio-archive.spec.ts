/**
 * The Quran audio ingest, planned before anything is written (--dry-run is the
 * plan, with nothing stored). The archive is checked by its STREAMED SHA-256
 * and size against the published values; the folder it was extracted into
 * must be plain files whose manifest hash is the pinned one; each file is
 * mapped by its name to one real ayah and checked to be MP3; the plan reports
 * every reject, extra and missing ayah of the 6,236. Rows are then written
 * only through ingestAyahAudio, and only from a complete plan.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashFile, listExtracted, manifestOf, planIngest, verifyArchive, type IngestPlan } from '../../../src/quran/audio-archive';
import { runIngest, type IngestDeps } from '../../../src/quran/audio-ingest-run';
import { audioKey } from '../../../src/quran/audio-key';
import { KFGQPC_HUDHAIFY, type AudioSourceSpec } from '../../../src/quran/audio-sources';
import { buildObjectKey } from '../../../src/communication/attachments/object-key';
import { SURAHS } from '../../../src/materials/quran-surahs';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
/** Synthetic audio: an ID3 tag, then bytes. Never a real recitation. */
const mp3 = (tag: string) => Buffer.concat([Buffer.from('ID3'), Buffer.from(tag), Buffer.alloc(64, 1)]);
const frameSync = (tag: string) => Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.from(tag)]);
const RECITER = 'test-reciter';

let scratch: string;
beforeEach(() => { scratch = mkdtempSync(join(tmpdir(), 'quran-audio-')); });
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

function folder(files: Record<string, Buffer>): string {
  const dir = join(scratch, `x-${Math.random().toString(36).slice(2)}`);
  for (const [name, bytes] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), bytes);
  }
  return dir;
}

function archiveFile(bytes: Buffer): string {
  const p = join(scratch, 'h.rar');
  writeFileSync(p, bytes);
  return p;
}

function spec(archive: Buffer, extractedManifestSha256: string | null = null): AudioSourceSpec {
  return { reciter: RECITER, name: 'Test', attribution: 'test', licence: null,
    archives: [{ file: 'h.rar', url: 'https://example.test/h.rar', sha256: sha(archive), bytes: archive.length, extractedManifestSha256 }],
    naming: { ayah: /^(\d{3})(\d{3})\.mp3$/, extras: [{ pattern: /^\d{3}000\.mp3$/, reason: 'a Basmala file' }] } };
}

async function plan(files: Record<string, Buffer>, pin: 'pin' | 'unpinned' | 'other' = 'pin'): Promise<IngestPlan> {
  const archive = Buffer.from('RAR stand-in');
  const listed = await listExtracted(folder(files));
  const s = spec(archive, pin === 'pin' ? manifestOf(listed) : pin === 'other' ? 'e'.repeat(64) : null);
  return planIngest(await verifyArchive(archiveFile(archive), 'h.rar', s), listed, s);
}

describe('the archive', () => {
  it('is hashed as a stream, and accepted only with exactly the published SHA-256 and size', async () => {
    const bytes = Buffer.alloc(3 * 1024 * 1024 + 17, 5);
    const path = archiveFile(bytes);
    expect(await hashFile(path)).toEqual({ sha256: sha(bytes), bytes: bytes.length });
    expect((await verifyArchive(path, 'h.rar', spec(bytes))).refused).toBeNull();
    expect((await verifyArchive(path, 'other.rar', spec(bytes))).refused).toMatch(/not listed/);
    expect((await verifyArchive(path, 'h.rar', spec(Buffer.from('another file')))).refused).toMatch(/SHA-256/);
    const sized = spec(bytes);
    sized.archives[0]!.bytes += 1;
    expect((await verifyArchive(path, 'h.rar', sized)).refused).toMatch(/bytes/);
  });
});

describe('the extracted folder', () => {
  it('is plain files only: a link is refused', async () => {
    const dir = folder({ 'a/085001.mp3': mp3('1') });
    symlinkSync('/etc/hosts', join(dir, 'a', '085002.mp3'));
    await expect(listExtracted(dir)).rejects.toThrow(/not a regular file/);
  });

  it('is pinned by its manifest hash: an unpinned or different folder is never a complete plan', async () => {
    const files = { '085001.mp3': mp3('1') };
    expect((await plan(files, 'unpinned')).manifest).toBe('unpinned');
    expect((await plan(files, 'other')).manifest).toBe('mismatch');
    expect((await plan(files, 'pin')).manifest).toBe('match');
    // Names are compared in NFC, so the same folder hashes the same whatever the filesystem's Unicode form.
    const nfd = manifestOf([{ name: 'a\u0301.mp3', path: '', bytes: 1, sha256: 'x' }]);
    expect(nfd).toBe(manifestOf([{ name: '\u00e1.mp3', path: '', bytes: 1, sha256: 'x' }]));
    // The manifest covers every file's name, size and hash: changing one byte changes it.
    const a = manifestOf(await listExtracted(folder(files)));
    const b = manifestOf(await listExtracted(folder({ '085001.mp3': mp3('2') })));
    expect(a).not.toBe(b);
  });
});

describe('planning', () => {
  it('KFGQPC\'s own naming, from the real listing: 10-SSSAAA-A01 (and -001 in Al-Baqarah); C00 Basmala, B00 Isti\'adha and the editor\'s .sfk are extras', async () => {
    const p = await planIngest(
      { name: 'huthify-ayat.rar', sha256: 'x', bytes: 1, listed: null, refused: null },
      await listExtracted(folder({
        'H/085 Al-Buruj/10-085001-A01.mp3': mp3('1'),
        'H/002 Al-Baqarah/10-002282-001.mp3': mp3('282'),
        'H/085 Al-Buruj/10-085C00-A01.mp3': mp3('b'),
        'H/00B Al-Istiazah/10-000B00-A01.mp3': mp3('i'),
        'H/00B Al-Istiazah/10-000B00-A01.mp3.sfk': Buffer.from('peaks'),
        'H/085 Al-Buruj/10-085002-B01.mp3': mp3('2'),
        'H/086 At-Tariq/10-085003-A01.mp3': mp3('3'),
      })),
      KFGQPC_HUDHAIFY,
    );
    expect(p.accepted.map((f) => `${f.surah}:${f.ayah}`)).toEqual(['2:282', '85:1']);
    expect(p.extras.map((e) => e.name.split('/').pop())).toEqual(['10-000B00-A01.mp3', '10-000B00-A01.mp3.sfk', '10-085C00-A01.mp3']);
    expect(Object.fromEntries(p.rejected.map((r) => [r.name.split('/').pop(), r.reason]))).toEqual({
      '10-085002-B01.mp3': expect.stringMatching(/not an ayah file/),
      '10-085003-A01.mp3': expect.stringMatching(/folder-mismatch/),
    });
  });

  it('maps each file by name to one real ayah, hashes it, and reports every reject and extra', async () => {
    const p = await plan({
      'Hudhaify/085001.mp3': mp3('1'),
      'Hudhaify/085002.mp3': frameSync('2'),
      'Hudhaify/085000.mp3': mp3('basmala'),
      'Hudhaify/085023.mp3': mp3('23'),
      'Hudhaify/115001.mp3': mp3('115'),
      'Hudhaify/readme.txt': Buffer.from('hello'),
      'Hudhaify/085003.mp3': Buffer.from('<html>not audio</html>'),
      'Hudhaify/085004.mp3': Buffer.alloc(0),
      'Other/085001.mp3': mp3('again'),
    });
    expect(p.accepted.map((f) => [f.surah, f.ayah, f.sha256, f.bytes])).toEqual([
      [85, 1, sha(mp3('1')), mp3('1').length],
      [85, 2, sha(frameSync('2')), frameSync('2').length],
    ]);
    expect(p.extras).toEqual([expect.objectContaining({ name: 'Hudhaify/085000.mp3', reason: expect.stringMatching(/Basmala/) })]);
    const reasons = Object.fromEntries(p.rejected.map((r) => [r.name, r.reason]));
    expect(reasons['Hudhaify/085023.mp3']).toMatch(/ayah-out-of-range/);
    expect(reasons['Hudhaify/115001.mp3']).toMatch(/surah-out-of-range/);
    expect(reasons['Hudhaify/readme.txt']).toMatch(/not an ayah file/);
    expect(reasons['Hudhaify/085003.mp3']).toMatch(/not-audio/);
    expect(reasons['Hudhaify/085004.mp3']).toMatch(/empty/);
    expect(reasons['Other/085001.mp3']).toMatch(/duplicate-ayah/);
    // Coverage is against the verified counts: all 6,236 ayat, of which 2 are here.
    expect(SURAHS.reduce((n, s) => n + s.ayahCount, 0)).toBe(6236);
    expect(p.expected).toBe(6236);
    expect(p.missing).toHaveLength(6234);
    expect(p.missing).toContain('85:3');
    expect(p.complete).toBe(false);
  });
});

describe('running an ingest', () => {
  /** Storage that names uploads with the REAL buildObjectKey, as the S3 and local stores do. */
  function deps(rows: Array<{ surah: number; ayah: number }> = []) {
    const stored = new Map<string, { mimeType: string; body: Buffer }>();
    const written: Array<Record<string, unknown>> = [];
    const calls: string[] = [];
    const d: IngestDeps = {
      storage: {
        async authorizeUpload({ prefix, mimeType }: { prefix: string; mimeType: string }) {
          calls.push('authorize');
          const objectKey = buildObjectKey(prefix);
          return { objectKey, uploadUrl: `https://store.test/${objectKey}`, method: 'PUT' as const, headers: { 'content-type': mimeType }, expiresAt: '' };
        },
        async copy(from: string, to: string) { calls.push('copy'); stored.set(to, stored.get(from)!); return true; },
        async delete(key: string) { calls.push('delete'); stored.delete(key); },
        async read(key: string) {
          const o = stored.get(key);
          return o ? { mimeType: o.mimeType, size: o.body.length, range: null, body: o.body } : null;
        },
      } as unknown as IngestDeps['storage'],
      upload: async (grant, bytes) => { calls.push('put'); stored.set(grant.objectKey, { mimeType: grant.headers['content-type']!, body: bytes }); },
      writer: {
        insert: async (row) => { calls.push('insert'); written.push(row); },
        exists: async (_r, surah, ayah) => rows.some((x) => x.surah === surah && x.ayah === ayah),
      },
      readFile: (p) => readFile(p),
    };
    return { d, stored, written, calls };
  }
  /** A complete plan over a two-surah stand-in (the plan's coverage check is exercised above). */
  async function completePlan(files: Record<string, Buffer>): Promise<IngestPlan> {
    const p = await plan(files);
    return { ...p, missing: [], rejected: [], complete: true };
  }

  it('--dry-run touches neither storage nor the database', async () => {
    const { d, calls } = deps();
    const report = await runIngest(await completePlan({ '085001.mp3': mp3('1') }), d, { dryRun: true });
    expect(calls).toEqual([]);
    expect(report).toMatchObject({ dryRun: true, written: 0, wouldWrite: 1 });
  });

  it('refuses to write from an incomplete plan: unpinned folder, rejects or missing ayat', async () => {
    const { d, calls } = deps();
    await expect(runIngest(await plan({ '085001.mp3': mp3('1') }, 'unpinned'), d, { dryRun: false })).rejects.toThrow(/not complete/);
    await expect(runIngest(await plan({ '085001.mp3': mp3('1') }), d, { dryRun: false })).rejects.toThrow(/not complete/);
    expect(calls).toEqual([]);
  });

  it('uploads under a key the real storage accepts, checks it there, then records the ayah only through ingestAyahAudio', async () => {
    const { d, stored, written } = deps();
    const report = await runIngest(await completePlan({ '085001.mp3': mp3('1'), '085002.mp3': mp3('2') }), d, { dryRun: false });
    expect(report).toMatchObject({ dryRun: false, written: 2, failed: [] });
    expect(stored.get(audioKey(RECITER, 85, 1))!.body).toEqual(mp3('1'));
    expect([...stored.keys()].filter((k) => k.startsWith('quran/audio-incoming/'))).toEqual([]); // temporary keys are gone
    expect(written).toEqual([
      { reciter: RECITER, surah: 85, ayah: 1, sha256: sha(mp3('1')), byteSize: mp3('1').length, durationMs: null },
      { reciter: RECITER, surah: 85, ayah: 2, sha256: sha(mp3('2')), byteSize: mp3('2').length, durationMs: null },
    ]);
  });

  it('never moves bytes to the ayah\'s key when what storage holds is not what the archive held', async () => {
    const { d, stored, written } = deps();
    const upload = d.upload;
    d.upload = (grant, bytes) => upload(grant, Buffer.concat([bytes, Buffer.from('tampered')]));
    const report = await runIngest(await completePlan({ '085001.mp3': mp3('1') }), d, { dryRun: false });
    expect(written).toEqual([]);
    expect(stored.has(audioKey(RECITER, 85, 1))).toBe(false);
    expect(report.failed).toEqual([{ ayah: '85:1', reason: expect.stringMatching(/differs from the archive/) }]);
  });

  it('never replaces an ayah that already has audio', async () => {
    const { d, written, calls } = deps([{ surah: 85, ayah: 1 }]);
    const report = await runIngest(await completePlan({ '085001.mp3': mp3('1') }), d, { dryRun: false });
    expect(report.failed).toEqual([{ ayah: '85:1', reason: expect.stringMatching(/already ingested/) }]);
    expect(written).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe('the ingest command line', () => {
  // Required lazily: the CLI module pulls in Prisma and storage selection.
  const { parseIngestArgs, UsageError } = jest.requireActual('../../../src/cli/ingest-quran-audio') as typeof import('../../../src/cli/ingest-quran-audio');

  it('is a dry run unless --write is given, and needs the archive AND its extracted folder', () => {
    expect(parseIngestArgs(['--archive', 'a.rar', '--extracted', 'dir'])).toMatchObject({ write: false, reciter: 'kfgqpc-huthify-hafs', archive: 'a.rar', extracted: 'dir' });
    expect(parseIngestArgs(['--archive', 'a.rar', '--extracted', 'dir', '--write', '--dry-run']).write).toBe(false);
    expect(parseIngestArgs(['--archive', 'a.rar', '--extracted', 'dir', '--write', '--target', 'h:5432/db'])).toMatchObject({ write: true, target: 'h:5432/db' });
  });

  it('refuses unknown options, a missing archive or folder, and a reciter not pinned in code', () => {
    expect(() => parseIngestArgs([])).toThrow(UsageError);
    expect(() => parseIngestArgs(['--archive', 'a.rar'])).toThrow(/--extracted/);
    expect(() => parseIngestArgs(['--archive'])).toThrow(/needs a value/);
    expect(() => parseIngestArgs(['--archive', 'a.rar', '--extracted', 'd', '--expect-sha256', 'x'])).toThrow(/unknown option/);
    expect(() => parseIngestArgs(['--archive', 'a.rar', '--extracted', 'd', '--reciter', 'alafasy-128'])).toThrow(/not a reciter/);
  });

  it('writes only where APP_ENV is EXPLICITLY local, test or ci (unset is not local)', () => {
    const { mayWriteHere } = jest.requireActual('../../../src/cli/ingest-quran-audio') as typeof import('../../../src/cli/ingest-quran-audio');
    expect(mayWriteHere('local', false)).toBe(true);
    expect(mayWriteHere('ci', false)).toBe(true);
    expect(mayWriteHere('', false)).toBe(false);
    expect(mayWriteHere('production', false)).toBe(false);
    expect(mayWriteHere('production', true)).toBe(true);
  });
});
