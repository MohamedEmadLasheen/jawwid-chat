import pin from '../../quran-pin.json';
import type { Ayah, Fetcher, Manifest, QuranAnchor } from '../quran/dataset';
import { digestOf, sha256Hex } from '../quran/sha256';

/**
 * The plain Basmala, by code point (1:1 of the vendored file). It is not trusted
 * as typed: basmala.test.ts proves it hashes to an accepted BASMALA_SHA256.
 */
export const BASMALA = String.fromCodePoint(
  0x628, 0x650, 0x633, 0x652, 0x645, 0x650, 0x20, 0x671, 0x644, 0x644, 0x651, 0x64e, 0x647, 0x650, 0x20, 0x671, 0x644, 0x631, 0x651,
  0x64e, 0x62d, 0x652, 0x645, 0x64e, 0x670, 0x646, 0x650, 0x20, 0x671, 0x644, 0x631, 0x651, 0x64e, 0x62d, 0x650, 0x64a, 0x645, 0x650,
);

/**
 * A stand-in snapshot (the verses are not Quran text): what CI's builder writes,
 * for one surah of `count` ayat, and the trust anchor a build of it would carry.
 * Tests pass `anchor` to loadSurah/SurahLesson (vitest builds no anchor).
 */
export async function snapshot(surah: number, count: number, opts: { basmala?: boolean; texts?: string[] } = {}) {
  const ayahs: Ayah[] = [];
  for (let a = 1; a <= count; a++) {
    const text = opts.texts?.[a - 1] ?? `verse ${surah}:${a}`;
    ayahs.push({ ayah: a, basmala: a === 1 && opts.basmala ? BASMALA : null, text, sha256: await sha256Hex(text) });
  }
  const rangeSha256 = await digestOf(ayahs.map((a) => a.sha256));
  const manifest: Manifest = {
    datasetId: pin.datasetId,
    fileSha256: pin.fileSha256,
    attribution: 'Tanzil Project — tanzil.net',
    sourceUrl: 'https://tanzil.net/',
    surahs: Array.from({ length: 114 }, (_, i) => ({
      number: i + 1,
      nameAr: i + 1 === surah ? 'البروج' : `s${i + 1}`,
      nameEn: `s${i + 1}`,
      ayahCount: i + 1 === surah ? count : 1,
      rangeSha256: i + 1 === surah ? rangeSha256 : '0'.repeat(64),
    })),
  };
  const anchor: QuranAnchor = { datasetId: pin.datasetId, fileSha256: pin.fileSha256, rangeSha256: manifest.surahs.map((s) => s.rangeSha256) };
  const files: Record<string, unknown> = {
    '/data/quran/manifest.json': manifest,
    [`/data/quran/surah-${String(surah).padStart(3, '0')}.json`]: { datasetId: pin.datasetId, surah, ayahs },
  };
  const fetcher: Fetcher = async (path) => {
    if (!(path in files)) throw new Error(`404 ${path}`);
    return structuredClone(files[path]);
  };
  return { manifest, ayahs, files, fetcher, anchor };
}
