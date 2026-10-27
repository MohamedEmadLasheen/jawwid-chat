import { createHash } from 'node:crypto';
import type { ObjectStorage } from '../communication/attachments/object-storage';
import type { PrismaService } from '../platform/prisma.service';
import { audioKey } from './audio-key';

/**
 * Audio is never served unverified (docs/product/quran-dataset-contract.md,
 * "Audio"). An ayah's audio row is written ONLY here: the server reads the
 * object already stored under the ayah's own key, computes its SHA-256 and
 * size, and records those -- no caller ever supplies a hash. The database
 * accepts the row only through this path (chat.ingesting_quran_audio; the
 * grants are the security boundary). Audio is off: there is no route that
 * calls this until the owner confirms the reciter and the right to self-host.
 */
export interface AudioRowWriter {
  insert(row: { reciter: string; surah: number; ayah: number; sha256: string; byteSize: number; durationMs: number | null }): Promise<void>;
}

export const MAX_AYAH_AUDIO_BYTES = 50_000_000;

export async function ingestAyahAudio(
  storage: ObjectStorage,
  writer: AudioRowWriter,
  reciter: string,
  surah: number,
  ayah: number,
  durationMs: number | null = null,
) {
  const key = audioKey(reciter, surah, ayah); // throws for an ayah that does not exist
  const object = await storage.read(key);
  if (!object || object === 'unsatisfiable') throw new Error(`${key} is not in storage`);
  if (!/^audio\//.test(object.mimeType)) throw new Error(`${key} is not audio (${object.mimeType})`);
  const hash = createHash('sha256');
  let byteSize = 0;
  const add = (chunk: Uint8Array) => {
    byteSize += chunk.length;
    if (byteSize > MAX_AYAH_AUDIO_BYTES) throw new Error(`${key} is larger than ${MAX_AYAH_AUDIO_BYTES} bytes`);
    hash.update(chunk);
  };
  if (Buffer.isBuffer(object.body)) add(object.body);
  else for await (const chunk of object.body) add(chunk);
  if (byteSize === 0) throw new Error(`${key} is empty`);
  const row = { reciter, surah, ayah, sha256: hash.digest('hex'), byteSize, durationMs };
  await writer.insert(row);
  return { ...row, key };
}

/** The database side of the ingest: one row, through the ingest-only path. */
export function prismaAudioRowWriter(prisma: PrismaService): AudioRowWriter {
  return {
    async insert(row) {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('chat.ingesting_quran_audio', 'on', true)`;
        await tx.$executeRaw`
          INSERT INTO chat.quran_ayah_audio (reciter_code, surah, ayah, sha256, byte_size, duration_ms)
          VALUES (${row.reciter}, ${row.surah}, ${row.ayah}, ${row.sha256}, ${row.byteSize}, ${row.durationMs})`;
      });
    },
  };
}
