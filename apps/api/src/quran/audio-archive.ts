import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { SURAHS, surahOf } from '../materials/quran-surahs';
import { MAX_AYAH_AUDIO_BYTES } from './audio-ingest';
import type { AudioArchive, AudioSourceSpec } from './audio-sources';

/**
 * Planning a Quran audio ingest (docs/legal/kfgqpc-hudhaify-licence.md,
 * section 5; docs/product/quran-dataset-contract.md, "Audio"). Nothing here
 * writes anything: a plan is the whole of `--dry-run`, and
 * audio-ingest-run.ts writes only what a complete plan accepted.
 *
 *  1. THE ARCHIVE: its SHA-256 and size, hashed as a STREAM (it is hundreds of
 *     megabytes), must be exactly the published values in audio-sources.ts.
 *  2. THE EXTRACTED FOLDER (the operator extracts the archive with the system
 *     bsdtar into its own empty folder; nothing in it is ever run): every entry
 *     must be a regular file -- no symlink, device or other special file --
 *     under the size cap, and its manifest (each file's path, size and
 *     SHA-256) must hash to the value pinned for the archive. Until that value
 *     is pinned, the plan is never complete, so nothing can be written.
 *  3. Each file is mapped by its name, with the source's reviewed naming rule
 *     (audio-sources.ts), to one real ayah (the surah counts of
 *     materials/quran-surahs.ts, which the verified dataset is checked against);
 *     a folder named for a surah (`085 Al-Buruj`) must hold only that surah's
 *     files. A file the reviewer named in advance as an extra (a Basmala file,
 *     the Isti'adha) is reported, not ingested. Anything else is a reject.
 *  4. Each mapped file must be MP3 by its bytes (an ID3 tag or an MPEG frame
 *     sync), not empty, and the only one for its ayah.
 *  5. The plan lists every reject, every extra and every ayah of the 6,236
 *     still missing.
 */
export const MAX_EXTRACTED_BYTES = 4 * 1024 ** 3;

export interface ArchiveCheck {
  name: string;
  sha256: string;
  bytes: number;
  listed: AudioArchive | null;
  refused: string | null;
}

export interface ExtractedFile {
  /** Path inside the extracted folder, with `/` separators. */
  name: string;
  path: string;
  bytes: number;
  sha256: string;
}

/** SHA-256 and size of a file, streamed. */
export async function hashFile(path: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += (chunk as Buffer).length;
    hash.update(chunk as Buffer);
  }
  return { sha256: hash.digest('hex'), bytes };
}

export async function verifyArchive(path: string, name: string, spec: AudioSourceSpec): Promise<ArchiveCheck> {
  const { sha256, bytes } = await hashFile(path);
  const listed = spec.archives.find((a) => a.file === name) ?? null;
  const refused = !listed
    ? `${name} is not listed as an official ${spec.reciter} archive (audio-sources.ts)`
    : listed.sha256 !== sha256.toLowerCase()
      ? `${name}: its SHA-256 ${sha256} is not the published ${listed.sha256}`
      : listed.bytes !== bytes
        ? `${name}: ${bytes} bytes, not the published ${listed.bytes}`
        : null;
  return { name, sha256, bytes, listed, refused };
}

/** Every file of an extracted folder, hashed; refuses anything that is not a plain file. */
export async function listExtracted(dir: string): Promise<ExtractedFile[]> {
  const out: ExtractedFile[] = [];
  let total = 0;
  const walk = async (d: string): Promise<void> => {
    for (const entry of (await readdir(d)).sort()) {
      const path = join(d, entry);
      const st = await lstat(path);
      const name = relative(dir, path).split(sep).join('/').normalize('NFC');
      if (st.isDirectory()) {
        await walk(path);
        continue;
      }
      if (!st.isFile()) throw new Error(`${name}: not a regular file (a link or a special file): the extraction is refused`);
      if (st.size > MAX_AYAH_AUDIO_BYTES) throw new Error(`${name}: larger than ${MAX_AYAH_AUDIO_BYTES} bytes`);
      total += st.size;
      if (total > MAX_EXTRACTED_BYTES) throw new Error(`more than ${MAX_EXTRACTED_BYTES} bytes extracted`);
      out.push({ name, path, ...(await hashFile(path)) });
    }
  };
  await walk(dir);
  return out;
}

/** The extracted folder's fingerprint: SHA-256 of `path<TAB>size<TAB>sha256` lines (paths in NFC), sorted by path. */
export function manifestOf(files: readonly ExtractedFile[]): string {
  const lines = files
    .map((f) => ({ ...f, name: f.name.normalize('NFC') }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((f) => `${f.name}\t${f.bytes}\t${f.sha256}\n`);
  return createHash('sha256').update(lines.join('')).digest('hex');
}

export interface PlannedFile extends ExtractedFile {
  surah: number;
  ayah: number;
}

export interface IngestPlan {
  reciter: string;
  archive: ArchiveCheck;
  extractedManifestSha256: string;
  /** Whether the extracted folder is the one pinned for the archive. */
  manifest: 'match' | 'mismatch' | 'unpinned';
  accepted: PlannedFile[];
  extras: Array<{ name: string; reason: string }>;
  rejected: Array<{ name: string; reason: string }>;
  /** "surah:ayah" of every ayah no accepted file covers. */
  missing: string[];
  expected: number;
  complete: boolean;
}

function isMp3(head: Buffer): boolean {
  if (head.length >= 3 && head.toString('latin1', 0, 3) === 'ID3') return true;
  return head.length >= 2 && head[0] === 0xff && (head[1]! & 0xe0) === 0xe0;
}

async function headOf(path: string): Promise<Buffer> {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(16);
    const { bytesRead } = await fh.read(buf, 0, 16, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

export async function planIngest(archive: ArchiveCheck, files: readonly ExtractedFile[], spec: AudioSourceSpec): Promise<IngestPlan> {
  const extractedManifestSha256 = manifestOf(files);
  const pinned = archive.listed?.extractedManifestSha256 ?? null;
  const plan: IngestPlan = {
    reciter: spec.reciter,
    archive,
    extractedManifestSha256,
    manifest: pinned === null ? 'unpinned' : pinned === extractedManifestSha256 ? 'match' : 'mismatch',
    accepted: [],
    extras: [],
    rejected: [],
    missing: [],
    expected: 0,
    complete: false,
  };
  const covered = new Set<string>();
  for (const f of files) {
    const reject = (reason: string) => plan.rejected.push({ name: f.name, reason });
    const parts = f.name.split('/');
    const base = parts.pop()!;
    const extra = spec.naming.extras.find((x) => x.pattern.test(base));
    if (extra) {
      plan.extras.push({ name: f.name, reason: extra.reason });
      continue;
    }
    const m = spec.naming.ayah.exec(base);
    if (!m) {
      reject(`not an ayah file (unparsed-name: not ${spec.naming.ayah.source})`);
      continue;
    }
    const surah = Number(m[1]);
    const ayah = Number(m[2]);
    const s = surahOf(surah);
    if (!s) {
      reject(`surah-out-of-range: no surah ${surah}`);
      continue;
    }
    const folder = /^(\d{3}) /.exec(parts[parts.length - 1] ?? '');
    if (folder && Number(folder[1]) !== surah) {
      reject(`folder-mismatch: a surah ${surah} file in the folder of surah ${Number(folder[1])}`);
      continue;
    }
    if (ayah === 0) {
      reject(`ayah-out-of-range: no ayah ${surah}:0`);
      continue;
    }
    if (ayah > s.ayahCount) {
      reject(`ayah-out-of-range: no ayah ${surah}:${ayah} in the verified counts`);
      continue;
    }
    if (covered.has(`${surah}:${ayah}`)) {
      reject(`duplicate-ayah: a second file for ${surah}:${ayah}`);
      continue;
    }
    if (f.bytes === 0) {
      reject('empty');
      continue;
    }
    if (!isMp3(await headOf(f.path))) {
      reject('not-audio: not MP3 (no ID3 tag or MPEG frame)');
      continue;
    }
    covered.add(`${surah}:${ayah}`);
    plan.accepted.push({ ...f, surah, ayah });
  }
  for (const s of SURAHS) {
    for (let a = 1; a <= s.ayahCount; a++) {
      plan.expected++;
      if (!covered.has(`${s.number}:${a}`)) plan.missing.push(`${s.number}:${a}`);
    }
  }
  plan.accepted.sort((x, y) => x.surah - y.surah || x.ayah - y.ayah);
  plan.complete = !archive.refused && plan.manifest === 'match' && plan.rejected.length === 0 && plan.missing.length === 0;
  return plan;
}
