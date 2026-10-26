/**
 * PD-29 amendment (2026-10-26): ONE order for materials, everywhere a list of
 * them is shown (the child's library, Admin Web's library, the teacher's
 * picker):
 *
 *   - by subject: Quran, Arabic language, Islamic studies;
 *   - Quran by surah: Al-Fatihah (1) first, then An-Nas (114), Al-Falaq (113),
 *     Al-Ikhlas (112) ... down -- the order a child memorizes Juz' Amma in;
 *     items of one surah, and Quran items with no surah (after them), by
 *     `sortOrder`;
 *   - every other material by `sortOrder`: the order it was provided in (the
 *     bulk manifest's row order), editable later; items without one last.
 *
 * Ties fall back to the Arabic title, then creation, so the order is total.
 */
export interface Orderable {
  subject: string;
  surah: number | null;
  sortOrder: number | null;
  titleAr: string | null;
  titleEn: string | null;
  createdAt: Date;
}

const SUBJECT_ORDER = ['quran', 'arabic', 'islamic_studies'];

/** Al-Fatihah 0, An-Nas 1, Al-Falaq 2 ... Al-Baqarah 113; no surah: after all of them. */
export function surahRank(surah: number | null): number {
  if (surah === null) return 1000;
  return surah === 1 ? 0 : 115 - surah;
}

export function compareMaterials(a: Orderable, b: Orderable): number {
  const sa = SUBJECT_ORDER.indexOf(a.subject);
  const sb = SUBJECT_ORDER.indexOf(b.subject);
  if (sa !== sb) return (sa < 0 ? 99 : sa) - (sb < 0 ? 99 : sb);
  if (a.subject === 'quran') {
    const ra = surahRank(a.surah);
    const rb = surahRank(b.surah);
    if (ra !== rb) return ra - rb;
  }
  const oa = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
  const ob = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
  if (oa !== ob) return oa - ob;
  const ta = a.titleAr ?? a.titleEn ?? '';
  const tb = b.titleAr ?? b.titleEn ?? '';
  if (ta !== tb) return ta.localeCompare(tb, 'ar');
  return a.createdAt.getTime() - b.createdAt.getTime();
}

export function sortMaterials<T extends Orderable>(items: T[]): T[] {
  return [...items].sort(compareMaterials);
}
