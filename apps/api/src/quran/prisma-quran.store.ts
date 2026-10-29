import { Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { isReciterCode } from './audio-key';
import { readAudioGate, type AudioGate } from './audio-gate';
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
      SELECT surah::int AS surah, ayah::int AS ayah, text_uthmani AS text, sha256, basmala, verse
        FROM chat.quran_ayah WHERE dataset_id = ${id}`;
  }

  ayahs(id: string, surah: number, from: number, to: number): Promise<AyahRow[]> {
    return this.prisma.$queryRaw<AyahRow[]>`
      SELECT surah::int AS surah, ayah::int AS ayah, text_uthmani AS text, sha256, basmala, verse
        FROM chat.quran_ayah
       WHERE dataset_id = ${id} AND surah = ${surah} AND ayah BETWEEN ${from} AND ${to}
       ORDER BY ayah`;
  }

  async audioSource(): Promise<{ reciter: string } | null> {
    const row = await this.prisma.config.findUnique({ where: { key: 'quran.audio' } });
    const v = row?.value as { reciter?: unknown } | null | undefined;
    if (!v || typeof v !== 'object' || typeof v.reciter !== 'string' || !isReciterCode(v.reciter)) return null;
    return { reciter: v.reciter };
  }

  audioGate(): Promise<AudioGate> {
    return readAudioGate(this.prisma);
  }

  audio(reciter: string, surah: number, from: number, to: number) {
    return this.prisma.$queryRaw<Array<{ surah: number; ayah: number; objectKey: string; sha256: string }>>`
      SELECT surah::int AS surah, ayah::int AS ayah, object_key AS "objectKey", sha256
        FROM chat.quran_ayah_audio
       WHERE reciter_code = ${reciter} AND surah = ${surah} AND ayah BETWEEN ${from} AND ${to}`;
  }

  async tajweed(id: string, surah: number): Promise<{ marks: TajweedMark[]; reviews: TajweedReview[]; withdrawn: string[] }> {
    const reviews = await this.prisma.$queryRaw<TajweedReview[]>`
      SELECT dataset_id AS "datasetId", surah::int AS surah, source, source_version AS "sourceVersion",
             mark_ids::text[] AS "markIds", marks_digest AS "marksDigest", reviewed_at AS "reviewedAt"
        FROM chat.quran_tajweed_review WHERE dataset_id = ${id} AND surah = ${surah}`;
    // Every mark a sign-off names, whatever its state, so the sign-off's digest can be checked.
    const marks = await this.prisma.$queryRaw<TajweedMark[]>`
      SELECT m.id::text AS id, m.dataset_id AS "datasetId", m.surah::int AS surah, m.ayah::int AS ayah,
             m.start_cp AS start, m.end_cp AS "end", m.rule, m.source, m.source_version AS "sourceVersion", m.state
        FROM chat.quran_tajweed_mark m
       WHERE m.dataset_id = ${id} AND m.surah = ${surah}
         AND m.id IN (SELECT unnest(r.mark_ids) FROM chat.quran_tajweed_review r WHERE r.dataset_id = ${id} AND r.surah = ${surah})`;
    const withdrawn = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT w.mark_id::text AS id
        FROM chat.quran_tajweed_withdrawal w JOIN chat.quran_tajweed_mark m ON m.id = w.mark_id
       WHERE m.dataset_id = ${id} AND m.surah = ${surah}`;
    return { marks, reviews, withdrawn: withdrawn.map((w) => w.id) };
  }
}
