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
 * grants are the security boundary). The hash must also be `expectedSha256`,
 * the value the verified archive held (the ingest manifest): anything else is
 * refused before a row is written. Only the ingest CLI calls this; who may
 * HEAR the audio is the release gate's decision (audio-gate.ts).
 */
export interface AudioRowWriter {
  insert(row: { reciter: string; surah: number; ayah: number; sha256: string; byteSize: number; durationMs: number | null }): Promise<void>;
  /** Whether this ayah already has audio for this reciter. */
  exists(reciter: string, surah: number, ayah: number): Promise<boolean>;
}

export const MAX_AYAH_AUDIO_BYTES = 50_000_000;

export async function ingestAyahAudio(
  storage: ObjectStorage,
  writer: AudioRowWriter,
  reciter: string,
  surah: number,
  ayah: number,
  expectedSha256: string,
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
  const sha256 = hash.digest('hex');
  if (sha256 !== expectedSha256.toLowerCase()) throw new Error(`${key} holds ${sha256}, not the expected ${expectedSha256}`);
  const row = { reciter, surah, ayah, sha256, byteSize, durationMs };
  await writer.insert(row);
  return { ...row, key };
}

/** The database side of the ingest: one row, through the ingest-only path. */
export function prismaAudioRowWriter(prisma: PrismaService): AudioRowWriter {
  return {
    async exists(reciter, surah, ayah) {
      const rows = await prisma.$queryRaw<Array<{ one: number }>>`
        SELECT 1 AS one FROM chat.quran_ayah_audio WHERE reciter_code = ${reciter} AND surah = ${surah} AND ayah = ${ayah}`;
      return rows.length > 0;
    },
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
