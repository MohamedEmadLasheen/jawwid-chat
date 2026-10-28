/**
 * Long surahs, a page at a time (all 114 surahs, owner 2026-10-28). A surah of
 * up to LONG_SURAH ayat -- all of Juz' Amma -- is one page, as before. A longer
 * one (Al-Baqarah has 286) shows PAGE_SIZE ayat at a time in Listen and Verses,
 * and "Put the ayat in order" plays the current page only, so it stays a short
 * game instead of 57 rounds.
 */
export const LONG_SURAH = 50;
export const PAGE_SIZE = 20;

export function pageCount(ayahCount: number): number {
  return ayahCount > LONG_SURAH ? Math.ceil(ayahCount / PAGE_SIZE) : 1;
}

/** The ayat of page `page` (0-based), clamped to the surah. */
export function pageOf<T>(ayahs: readonly T[], page: number): T[] {
  if (pageCount(ayahs.length) === 1) return [...ayahs];
  const p = Math.min(Math.max(0, page), pageCount(ayahs.length) - 1);
  return ayahs.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE);
}

/** The page that holds `ayah` (1-based ayah number). */
export function pageOfAyah(ayahCount: number, ayah: number): number {
  return pageCount(ayahCount) === 1 ? 0 : Math.min(pageCount(ayahCount) - 1, Math.floor((ayah - 1) / PAGE_SIZE));
}
