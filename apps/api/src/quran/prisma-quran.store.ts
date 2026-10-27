import { Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { isReciterCode } from './audio-key';
import type { AyahRow } from './quran-integrity';
import type { QuranStore, StoredDataset } from './quran-text.service';
import type { TajweedMark, TajweedReview } from './tajweed';

/** QuranStore over chat.quran_* (migration 20261027170000) and chat.config. Read-only. */
@Injectable()
export class PrismaQuranStore implements QuranStore {
  constructor(private readonly prisma: PrismaService) {}

  async configuredDatasetId(): Promise<string | null> {
    const row = await this.prisma.config.findUnique({ where: { key: 'quran.dataset' } });
    return typeof row?.value === 'string' && row.value ? row.value : null;
  }

  async dataset(id: string): Promise<StoredDataset | null> {
    const rows = await this.prisma.$queryRaw<StoredDataset[]>`
      SELECT id, sha256, ayahs_digest AS "ayahsDigest", attribution, source_url AS "sourceUrl"
        FROM chat.quran_dataset WHERE id = ${id}`;
    return rows[0] ?? null;
  }

  allAyahs(id: string): Promise<AyahRow[]> {
    return this.prisma.$queryRaw<AyahRow[]>`
      SELECT surah::int AS surah, ayah::int AS ayah, text_uthmani AS text, sha256
        FROM chat.quran_ayah WHERE dataset_id = ${id}`;
  }

  ayahs(id: string, surah: number, from: number, to: number): Promise<AyahRow[]> {
    return this.prisma.$queryRaw<AyahRow[]>`
      SELECT surah::int AS surah, ayah::int AS ayah, text_uthmani AS text, sha256
        FROM chat.quran_ayah
       WHERE dataset_id = ${id} AND surah = ${surah} AND ayah BETWEEN ${from} AND ${to}
       ORDER BY ayah`;
  }

  async audioSource(): Promise<{ reciter: string; baseUrl: string } | null> {
    const row = await this.prisma.config.findUnique({ where: { key: 'quran.audio' } });
    const v = row?.value as { reciter?: unknown; baseUrl?: unknown } | null | undefined;
    if (!v || typeof v !== 'object' || typeof v.reciter !== 'string' || typeof v.baseUrl !== 'string') return null;
    if (!isReciterCode(v.reciter) || !/^https:\/\/[^\s/?#]+(\/[^\s?#]*)?$/.test(v.baseUrl)) return null;
    return { reciter: v.reciter, baseUrl: v.baseUrl };
  }

  audio(reciter: string, surah: number, from: number, to: number) {
    return this.prisma.$queryRaw<Array<{ surah: number; ayah: number; objectKey: string; sha256: string }>>`
      SELECT surah::int AS surah, ayah::int AS ayah, object_key AS "objectKey", sha256
        FROM chat.quran_ayah_audio
       WHERE reciter_code = ${reciter} AND surah = ${surah} AND ayah BETWEEN ${from} AND ${to}`;
  }

  async tajweed(id: string, surah: number, from: number, to: number): Promise<{ marks: TajweedMark[]; reviews: TajweedReview[] }> {
    const marks = await this.prisma.$queryRaw<TajweedMark[]>`
      SELECT dataset_id AS "datasetId", surah::int AS surah, ayah::int AS ayah, start_cp AS start, end_cp AS "end",
             rule, source, source_version AS "sourceVersion", state
        FROM chat.quran_tajweed_mark
       WHERE dataset_id = ${id} AND surah = ${surah} AND ayah BETWEEN ${from} AND ${to} AND state = 'approved'`;
    const reviews = await this.prisma.$queryRaw<TajweedReview[]>`
      SELECT dataset_id AS "datasetId", surah::int AS surah, source, source_version AS "sourceVersion"
        FROM chat.quran_tajweed_review WHERE dataset_id = ${id} AND surah = ${surah}`;
    return { marks, reviews };
  }
}
