/**
 * The Quran audio ingest, planned before anything is written (--dry-run is the
 * same plan, with nothing stored). An archive is accepted only when its SHA-256
 * is the official published value listed in code; each file is mapped by its
 * name to one real ayah, checked to be MP3 audio and hashed; the plan reports
 * every reject and every ayah of the 6,236 still missing. Rows are then written
 * only through ingestAyahAudio, which hashes what storage actually holds.
 */
import { createHash } from 'node:crypto';
import { crc32, deflateRawSync } from 'node:zlib';
import { ArchiveRefused, planIngest, readAudioArchive } from '../../../src/quran/audio-archive';
import { runIngest, type IngestDeps } from '../../../src/quran/audio-ingest-run';
import { audioKey } from '../../../src/quran/audio-key';
import type { AudioSourceSpec } from '../../../src/quran/audio-sources';
import { SURAHS } from '../../../src/materials/quran-surahs';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
/** Synthetic audio: an ID3 tag, then bytes. Never a real recitation. */
const mp3 = (tag: string) => Buffer.concat([Buffer.from('ID3'), Buffer.from(tag), Buffer.alloc(64, 1)]);
const frameSync = (tag: string) => Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.from(tag)]);

/** A minimal zip: stored or deflated entries, UTF-8 names. */
function zip(files: Array<[string, Buffer, ('store' | 'deflate')?]>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, data, how = 'store'] of files) {
    const n = Buffer.from(name, 'utf8');
    const body = how === 'deflate' ? deflateRawSync(data) : data;
    const method = how === 'deflate' ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(0x0314, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(method, 10);
    cen.writeUInt32LE(crc32(data), 16); cen.writeUInt32LE(body.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(n.length, 28);
    cen.writeUInt32LE((0o100644 << 16) >>> 0, 38); cen.writeUInt32LE(offset, 42);
    locals.push(local, n, body);
    central.push(cen, n);
    offset += 30 + n.length + body.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const RECITER = 'test-reciter';
function spec(archives: Array<{ file: string; bytes: Buffer }>): AudioSourceSpec {
  return { reciter: RECITER, name: 'Test', attribution: 'test', licence: null,
    archives: archives.map((a) => ({ file: a.file, sha256: sha(a.bytes), bytes: a.bytes.length })) };
}

describe('reading an audio archive', () => {
  it('lists stored and deflated entries, checking each one\'s CRC', () => {
    const z = zip([['a/085001.mp3', mp3('x')], ['a/085002.mp3', mp3('y'), 'deflate']]);
    const entries = readAudioArchive(z);
    expect(entries.map((e) => e.name)).toEqual(['a/085001.mp3', 'a/085002.mp3']);
    expect(entries[1]!.read()).toEqual(mp3('y'));
  });

  it('refuses what is not a plain zip', () => {
    expect(() => readAudioArchive(Buffer.from('not a zip at all, just text'))).toThrow(ArchiveRefused);
    const z = zip([['085001.mp3', mp3('x')]]);
    const bad = Buffer.from(z);
    bad.writeUInt32LE(0xdeadbeef, 14); // the local header's CRC
    bad.writeUInt32LE(0xdeadbeef, z.length - 22 - 46 - 10 + 16); // and the directory's
    expect(() => readAudioArchive(bad)[0]!.read()).toThrow(/checksum/);
  });
});

describe('planning an ingest', () => {
  it('accepts only an archive whose SHA-256 is the official value listed in code', () => {
    const z = zip([['085001.mp3', mp3('x')]]);
    const plan = planIngest([{ name: 'hudhaify-085.zip', bytes: z }], spec([]));
    expect(plan.archives).toEqual([expect.objectContaining({ name: 'hudhaify-085.zip', official: false })]);
    expect(plan.archives[0]!.refused).toMatch(/not listed/);
    expect(plan.accepted).toEqual([]);
    const tampered = planIngest([{ name: 'hudhaify-085.zip', bytes: z }], spec([{ file: 'hudhaify-085.zip', bytes: zip([['085001.mp3', mp3('other')]]) }]));
    expect(tampered.archives[0]!.refused).toMatch(/SHA-256/);
    expect(tampered.accepted).toEqual([]);
  });

  it('maps each file by name to one real ayah, hashes it, and reports every reject', () => {
    const files: Array<[string, Buffer]> = [
      ['Hudhaify/085001.mp3', mp3('1')],
      ['Hudhaify/085002.mp3', frameSync('2')],
      ['Hudhaify/085000.mp3', mp3('basmala')],
      ['Hudhaify/085023.mp3', mp3('23')],
      ['Hudhaify/115001.mp3', mp3('115')],
      ['Hudhaify/readme.txt', Buffer.from('hello')],
      ['Hudhaify/085003.mp3', Buffer.from('<html>not audio</html>')],
      ['Hudhaify/085004.mp3', Buffer.alloc(0)],
      ['Other/085001.mp3', mp3('again')],
    ];
    const z = zip(files);
    const plan = planIngest([{ name: 'h.zip', bytes: z }], spec([{ file: 'h.zip', bytes: z }]));
    expect(plan.archives[0]).toMatchObject({ official: true, sha256: sha(z) });
    expect(plan.accepted.map((f) => [f.surah, f.ayah, f.sha256, f.bytes])).toEqual([
      [85, 1, sha(mp3('1')), mp3('1').length],
      [85, 2, sha(frameSync('2')), frameSync('2').length],
    ]);
    const reasons = Object.fromEntries(plan.rejected.map((r) => [r.name, r.reason]));
    expect(reasons['Hudhaify/085000.mp3']).toMatch(/Basmala/);
    expect(reasons['Hudhaify/085023.mp3']).toMatch(/no ayah 85:23/);
    expect(reasons['Hudhaify/115001.mp3']).toMatch(/no ayah 115:1/);
    expect(reasons['Hudhaify/readme.txt']).toMatch(/not an ayah file/);
    expect(reasons['Hudhaify/085003.mp3']).toMatch(/not MP3 audio/);
    expect(reasons['Hudhaify/085004.mp3']).toMatch(/empty/);
    expect(reasons['Other/085001.mp3']).toMatch(/second file for 85:1/);
    // Coverage is against the verified counts: all 6,236 ayat, of which 2 are here.
    const total = SURAHS.reduce((n, s) => n + s.ayahCount, 0);
    expect(total).toBe(6236);
    expect(plan.expected).toBe(6236);
    expect(plan.missing).toHaveLength(6234);
    expect(plan.missing).toContain('85:3');
    expect(plan.complete).toBe(false);
  });
});

describe('running an ingest', () => {
  function deps() {
    const stored = new Map<string, { mimeType: string; body: Buffer }>();
    const rows: Array<Record<string, unknown>> = [];
    const calls: string[] = [];
    let n = 0;
    const d: IngestDeps = {
      storage: {
        async authorizeUpload({ prefix, mimeType }: { prefix: string; mimeType: string }) {
          calls.push('authorize');
          const objectKey = `${prefix}tmp-${++n}`;
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
      writer: { insert: async (row) => { calls.push('insert'); rows.push(row); } },
    };
    return { d, stored, rows, calls };
  }
  const planOf = (files: Array<[string, Buffer]>) => {
    const z = zip(files);
    return planIngest([{ name: 'h.zip', bytes: z }], spec([{ file: 'h.zip', bytes: z }]));
  };

  it('--dry-run touches neither storage nor the database', async () => {
    const { d, calls } = deps();
    const report = await runIngest(planOf([['085001.mp3', mp3('1')]]), d, { dryRun: true });
    expect(calls).toEqual([]);
    expect(report).toMatchObject({ dryRun: true, written: 0, wouldWrite: 1 });
  });

  it('stores each file under its ayah\'s own key, and writes the row only through ingestAyahAudio', async () => {
    const { d, stored, rows } = deps();
    const report = await runIngest(planOf([['085001.mp3', mp3('1')], ['085002.mp3', mp3('2')]]), d, { dryRun: false });
    expect(report).toMatchObject({ dryRun: false, written: 2, failed: [] });
    expect(stored.get(audioKey(RECITER, 85, 1))!.body).toEqual(mp3('1'));
    expect([...stored.keys()].some((k) => k.includes('tmp-'))).toBe(false); // the upload's temporary key is gone
    expect(rows).toEqual([
      { reciter: RECITER, surah: 85, ayah: 1, sha256: sha(mp3('1')), byteSize: mp3('1').length, durationMs: null },
      { reciter: RECITER, surah: 85, ayah: 2, sha256: sha(mp3('2')), byteSize: mp3('2').length, durationMs: null },
    ]);
  });

  it('writes no row when what storage holds is not what the archive held', async () => {
    const { d, rows } = deps();
    const upload = d.upload;
    d.upload = (grant, bytes) => upload(grant, Buffer.concat([bytes, Buffer.from('tampered')]));
    const report = await runIngest(planOf([['085001.mp3', mp3('1')]]), d, { dryRun: false });
    expect(rows).toEqual([]);
    expect(report.failed).toEqual([expect.objectContaining({ ayah: '85:1', reason: expect.stringMatching(/differs from the archive/) })]);
  });

  it('refuses to write from a plan with a refused archive', async () => {
    const { d, calls } = deps();
    const z = zip([['085001.mp3', mp3('1')]]);
    const plan = planIngest([{ name: 'h.zip', bytes: z }], spec([]));
    await expect(runIngest(plan, d, { dryRun: false })).rejects.toThrow(/refused archive/);
    expect(calls).toEqual([]);
  });
});

describe('the ingest command line', () => {
  // Imported lazily: the CLI module pulls in Prisma and storage selection.
  const { parseIngestArgs, UsageError } = jest.requireActual('../../../src/cli/ingest-quran-audio') as typeof import('../../../src/cli/ingest-quran-audio');

  it('is a dry run unless --write is given', () => {
    expect(parseIngestArgs(['--archive', 'a.zip'])).toMatchObject({ write: false, reciter: 'kfgqpc-hudhaify', archives: ['a.zip'] });
    expect(parseIngestArgs(['--archive', 'a.zip', '--write', '--dry-run']).write).toBe(false);
    expect(parseIngestArgs(['--archive', 'a.zip', '--archive', 'b.zip', '--write', '--target', 'h:5432/db'])).toMatchObject({ write: true, archives: ['a.zip', 'b.zip'] });
  });

  it('refuses unknown options, a missing archive and a reciter not pinned in code', () => {
    expect(() => parseIngestArgs([])).toThrow(UsageError);
    expect(() => parseIngestArgs(['--archive'])).toThrow(/needs a value/);
    expect(() => parseIngestArgs(['--archive', 'a.zip', '--expect-sha256', 'x'])).toThrow(/unknown option/);
    expect(() => parseIngestArgs(['--archive', 'a.zip', '--reciter', 'alafasy-128'])).toThrow(/not a reciter/);
  });
});
