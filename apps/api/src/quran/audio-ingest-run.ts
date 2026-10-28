import type { ObjectStorage, UploadAuthorization } from '../communication/attachments/object-storage';
import type { IngestPlan } from './audio-archive';
import { audioKey } from './audio-key';
import { ingestAyahAudio, type AudioRowWriter } from './audio-ingest';

export interface IngestDeps {
  storage: Pick<ObjectStorage, 'authorizeUpload' | 'copy' | 'delete' | 'read'>;
  /** PUT the bytes to a signed upload grant (fetch in the CLI; a fake in tests). */
  upload(grant: UploadAuthorization, bytes: Buffer): Promise<void>;
  writer: AudioRowWriter;
}

export interface IngestReport {
  dryRun: boolean;
  wouldWrite: number;
  written: number;
  failed: Array<{ ayah: string; reason: string }>;
}

/**
 * Carry out a plan (audio-archive.ts). `dryRun` writes nothing at all. Otherwise
 * each accepted file is uploaded, moved to its ayah's own key, and recorded ONLY
 * through ingestAyahAudio, which hashes what storage actually holds -- and the row
 * is written only if that hash is the one the archive held.
 */
export async function runIngest(plan: IngestPlan, deps: IngestDeps, opts: { dryRun: boolean }): Promise<IngestReport> {
  const report: IngestReport = { dryRun: opts.dryRun, wouldWrite: plan.accepted.length, written: 0, failed: [] };
  if (opts.dryRun) return report;
  if (plan.archives.some((a) => a.refused)) throw new Error('the plan has a refused archive: nothing is written');
  const copy = deps.storage.copy?.bind(deps.storage);
  if (!copy) throw new Error('this storage cannot place an object under an exact key (no copy)');
  for (const f of plan.accepted) {
    const ayah = `${f.surah}:${f.ayah}`;
    const key = audioKey(plan.reciter, f.surah, f.ayah);
    try {
      const grant = await deps.storage.authorizeUpload({ prefix: `quran/audio-incoming/${plan.reciter}/`, mimeType: 'audio/mpeg', byteSize: f.bytes });
      await deps.upload(grant, f.data);
      const moved = await copy(grant.objectKey, key);
      await deps.storage.delete(grant.objectKey);
      if (!moved) throw new Error('the upload is not in storage');
      const checked: AudioRowWriter = {
        insert: async (row) => {
          if (row.sha256 !== f.sha256 || row.byteSize !== f.bytes) throw new Error(`what storage holds (${row.sha256}) differs from the archive (${f.sha256})`);
          await deps.writer.insert(row);
        },
      };
      await ingestAyahAudio(deps.storage as ObjectStorage, checked, plan.reciter, f.surah, f.ayah);
      report.written++;
    } catch (e) {
      report.failed.push({ ayah, reason: (e as Error).message });
    }
  }
  return report;
}
