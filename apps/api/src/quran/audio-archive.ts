import { createHash } from 'node:crypto';
import { crc32, inflateRawSync } from 'node:zlib';
import { SURAHS, surahOf } from '../materials/quran-surahs';
import { MAX_AYAH_AUDIO_BYTES } from './audio-ingest';
import type { AudioSourceSpec } from './audio-sources';

/**
 * Planning a Quran audio ingest (docs/product/quran-dataset-contract.md,
 * "Audio"). Nothing here writes anything: `planIngest` is the whole of
 * `--dry-run`, and audio-ingest-run.ts writes only what a plan accepted.
 *
 *  1. An archive is accepted only if its name is listed for the reciter in
 *     audio-sources.ts AND its SHA-256 is exactly the published value there.
 *  2. Each file is mapped by its name, `SSSAAA.mp3` at any folder depth, to one
 *     real ayah (the surah counts of materials/quran-surahs.ts, which the
 *     verified dataset is checked against). `SSS000` is a Basmala file, not an
 *     ayah, and is reported, not ingested.
 *  3. Each file must be MP3 audio by its bytes (an ID3 tag or an MPEG frame
 *     sync), not empty, at most MAX_AYAH_AUDIO_BYTES, and the only one for its
 *     ayah; its SHA-256 and size are recorded.
 *  4. The plan reports every reject and every ayah of the 6,236 still missing.
 *
 * The zip reader takes only plain archives: no zip64, no multi-part, no
 * encryption; stored or deflated entries, each checked against its CRC.
 */
export class ArchiveRefused extends Error {}

export interface ArchiveEntry {
  name: string;
  size: number;
  /** The entry's bytes, CRC-checked. */
  read(): Buffer;
}

const EOCD = 0x06054b50;
const CEN = 0x02014b50;
const LOC = 0x04034b50;

export function readAudioArchive(zip: Buffer): ArchiveEntry[] {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ArchiveRefused('not a zip file');
  const total = zip.readUInt16LE(eocd + 10);
  const cdSize = zip.readUInt32LE(eocd + 12);
  const cdOffset = zip.readUInt32LE(eocd + 16);
  if (zip.readUInt16LE(eocd + 4) !== 0 || zip.readUInt16LE(eocd + 6) !== 0 || zip.readUInt16LE(eocd + 8) !== total) {
    throw new ArchiveRefused('a multi-part zip');
  }
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new ArchiveRefused('a zip64 archive');
  if (cdOffset + cdSize > eocd) throw new ArchiveRefused('a damaged zip (directory out of place)');

  const entries: ArchiveEntry[] = [];
  let p = cdOffset;
  for (let n = 0; n < total; n++) {
    if (p + 46 > cdOffset + cdSize || zip.readUInt32LE(p) !== CEN) throw new ArchiveRefused('a damaged zip (bad directory entry)');
    const flags = zip.readUInt16LE(p + 8);
    const method = zip.readUInt16LE(p + 10);
    const crc = zip.readUInt32LE(p + 16);
    const csize = zip.readUInt32LE(p + 20);
    const usize = zip.readUInt32LE(p + 24);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localOffset = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if ((flags & 0x0001) !== 0) throw new ArchiveRefused(`an encrypted entry: ${name}`);
    if (csize === 0xffffffff || usize === 0xffffffff || localOffset === 0xffffffff) throw new ArchiveRefused('a zip64 archive');
    if (name.endsWith('/')) continue;
    if (method !== 0 && method !== 8) throw new ArchiveRefused(`an unsupported compression method: ${name}`);
    if (localOffset + 30 > cdOffset || zip.readUInt32LE(localOffset) !== LOC) throw new ArchiveRefused(`a damaged zip (bad local header): ${name}`);
    const dataOffset = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    if (dataOffset + csize > cdOffset) throw new ArchiveRefused(`a damaged zip (data out of place): ${name}`);
    entries.push({
      name,
      size: usize,
      read() {
        if (usize > MAX_AYAH_AUDIO_BYTES) throw new ArchiveRefused(`${name} is larger than ${MAX_AYAH_AUDIO_BYTES} bytes`);
        const raw = zip.subarray(dataOffset, dataOffset + csize);
        let data: Buffer;
        try {
          data = method === 0 ? raw : inflateRawSync(raw, { maxOutputLength: Math.max(1, usize) });
        } catch {
          throw new ArchiveRefused(`a damaged zip (cannot inflate): ${name}`);
        }
        if (data.length !== usize || crc32(data) >>> 0 !== crc) throw new ArchiveRefused(`a damaged zip (checksum): ${name}`);
        return data;
      },
    });
  }
  return entries;
}

export interface PlannedFile {
  name: string;
  archive: string;
  surah: number;
  ayah: number;
  sha256: string;
  bytes: number;
  data: Buffer;
}

export interface IngestPlan {
  reciter: string;
  archives: Array<{ name: string; sha256: string; bytes: number; official: boolean; refused: string | null }>;
  accepted: PlannedFile[];
  rejected: Array<{ name: string; archive: string; reason: string }>;
  /** "surah:ayah" of every ayah no accepted file covers. */
  missing: string[];
  expected: number;
  complete: boolean;
}

const FILE = /(?:^|\/)(\d{3})(\d{3})\.mp3$/i;

function isMp3(b: Buffer): boolean {
  if (b.length >= 3 && b.toString('latin1', 0, 3) === 'ID3') return true;
  return b.length >= 2 && b[0] === 0xff && (b[1]! & 0xe0) === 0xe0;
}

export function planIngest(archives: Array<{ name: string; bytes: Buffer }>, spec: AudioSourceSpec): IngestPlan {
  const plan: IngestPlan = { reciter: spec.reciter, archives: [], accepted: [], rejected: [], missing: [], expected: 0, complete: false };
  const covered = new Set<string>();
  for (const archive of archives) {
    const sha256 = createHash('sha256').update(archive.bytes).digest('hex');
    const listed = spec.archives.find((a) => a.file === archive.name);
    const refused = !listed
      ? `${archive.name} is not listed as an official ${spec.reciter} archive (audio-sources.ts)`
      : listed.sha256 !== sha256
        ? `${archive.name}: its SHA-256 ${sha256} is not the published ${listed.sha256}`
        : null;
    plan.archives.push({ name: archive.name, sha256, bytes: archive.bytes.length, official: !!listed, refused });
    if (refused) continue;
    let entries: ArchiveEntry[];
    try {
      entries = readAudioArchive(archive.bytes);
    } catch (e) {
      plan.archives[plan.archives.length - 1]!.refused = `${archive.name}: ${(e as Error).message}`;
      continue;
    }
    for (const entry of entries) {
      const reject = (reason: string) => plan.rejected.push({ name: entry.name, archive: archive.name, reason });
      const m = FILE.exec(entry.name);
      if (!m) {
        reject('not an ayah file (expected SSSAAA.mp3)');
        continue;
      }
      const surah = Number(m[1]);
      const ayah = Number(m[2]);
      if (ayah === 0) {
        reject(`a Basmala file for surah ${surah}, not an ayah (audio is the verse alone)`);
        continue;
      }
      const s = surahOf(surah);
      if (!s || ayah > s.ayahCount) {
        reject(`no ayah ${surah}:${ayah} in the verified counts`);
        continue;
      }
      if (covered.has(`${surah}:${ayah}`)) {
        reject(`a second file for ${surah}:${ayah}`);
        continue;
      }
      let data: Buffer;
      try {
        data = entry.read();
      } catch (e) {
        reject((e as Error).message);
        continue;
      }
      if (data.length === 0) {
        reject('empty');
        continue;
      }
      if (!isMp3(data)) {
        reject('not MP3 audio (no ID3 tag or MPEG frame)');
        continue;
      }
      covered.add(`${surah}:${ayah}`);
      plan.accepted.push({ name: entry.name, archive: archive.name, surah, ayah, sha256: createHash('sha256').update(data).digest('hex'), bytes: data.length, data });
    }
  }
  for (const s of SURAHS) {
    for (let a = 1; a <= s.ayahCount; a++) {
      plan.expected++;
      if (!covered.has(`${s.number}:${a}`)) plan.missing.push(`${s.number}:${a}`);
    }
  }
  plan.accepted.sort((x, y) => x.surah - y.surah || x.ayah - y.ayah);
  plan.complete = plan.missing.length === 0 && plan.archives.every((a) => !a.refused);
  return plan;
}
