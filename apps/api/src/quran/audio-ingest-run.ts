import { createHash } from 'node:crypto';
import type { ObjectStorage, UploadAuthorization } from '../communication/attachments/object-storage';
import type { IngestPlan } from './audio-archive';
import { audioKey } from './audio-key';
import { ingestAyahAudio, type AudioRowWriter } from './audio-ingest';

export interface IngestDeps {
  storage: Pick<ObjectStorage, 'authorizeUpload' | 'copy' | 'delete' | 'read'>;
  /** PUT the bytes to a signed upload grant (fetch in the CLI; a fake in tests). */
  upload(grant: UploadAuthorization, bytes: Buffer): Promise<void>;
  writer: AudioRowWriter;
  readFile(path: string): Promise<Buffer>;
}

export interface IngestReport {
  dryRun: boolean;
  wouldWrite: number;
  written: number;
  failed: Array<{ ayah: string; reason: string }>;
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

async function bytesOf(storage: IngestDeps['storage'], key: string): Promise<Buffer | null> {
  const o = await storage.read(key);
  if (!o || o === 'unsatisfiable') return null;
  if (Buffer.isBuffer(o.body)) return o.body;
  const chunks: Buffer[] = [];
  for await (const c of o.body) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

/**
 * Carry out a COMPLETE plan (audio-archive.ts); `dryRun` writes nothing at all.
 * For each ayah:
 *   - an ayah that already has a row is refused: served bytes are never
 *     silently replaced (a replacement would be a new, reviewed version);
 *   - the file is read again and must still hash to the plan's value;
 *   - it is uploaded to a temporary key, and what storage holds THERE is hashed
 *     before anything reaches the ayah's own key;
 *   - it is moved to the ayah's key and recorded ONLY through ingestAyahAudio,
 *     which hashes what the live key holds and refuses anything but the
 *     expected SHA-256.
 */
export async function runIngest(plan: IngestPlan, deps: IngestDeps, opts: { dryRun: boolean }): Promise<IngestReport> {
  const report: IngestReport = { dryRun: opts.dryRun, wouldWrite: plan.accepted.length, written: 0, failed: [] };
  if (opts.dryRun) return report;
  if (!plan.complete) throw new Error('the plan is not complete (refused archive, unpinned or different folder, rejects or missing ayat): nothing is written');
  const copy = deps.storage.copy?.bind(deps.storage);
  if (!copy) throw new Error('this storage cannot place an object under an exact key (no copy)');
  for (const f of plan.accepted) {
    const ayah = `${f.surah}:${f.ayah}`;
    const key = audioKey(plan.reciter, f.surah, f.ayah);
    let temp: string | null = null;
    try {
      if (await deps.writer.exists(plan.reciter, f.surah, f.ayah)) throw new Error('already ingested: served audio is never replaced in place');
      const bytes = await deps.readFile(f.path);
      if (sha(bytes) !== f.sha256) throw new Error('the file changed since the plan');
      const grant = await deps.storage.authorizeUpload({ prefix: `quran/audio-incoming/${plan.reciter}`, mimeType: 'audio/mpeg', byteSize: bytes.length });
      temp = grant.objectKey;
      await deps.upload(grant, bytes);
      const uploaded = await bytesOf(deps.storage, temp);
      if (!uploaded || sha(uploaded) !== f.sha256) throw new Error('what storage holds differs from the archive: not moved to the ayah');
      if (!(await copy(temp, key))) throw new Error('the upload is not in storage');
      await ingestAyahAudio(deps.storage as ObjectStorage, deps.writer, plan.reciter, f.surah, f.ayah, f.sha256);
      report.written++;
    } catch (e) {
      report.failed.push({ ayah, reason: (e as Error).message });
    } finally {
      if (temp) await deps.storage.delete(temp).catch(() => undefined);
    }
  }
  return report;
}
