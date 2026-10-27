import pin from '../../quran-pin.json';
import type { Ayah, Fetcher, Manifest } from '../quran/dataset';
import { digestOf, sha256Hex } from '../quran/sha256';

/** A stand-in snapshot (not Quran text): what CI's builder writes, for one surah of `count` ayat. */
export async function snapshot(surah: number, count: number, opts: { basmala?: boolean; texts?: string[] } = {}) {
  const ayahs: Ayah[] = [];
  for (let a = 1; a <= count; a++) {
    const text = opts.texts?.[a - 1] ?? `verse ${surah}:${a}`;
    ayahs.push({ ayah: a, basmala: a === 1 && opts.basmala ? 'BASMALA' : null, text, sha256: await sha256Hex(text) });
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
  const files: Record<string, unknown> = {
    '/data/quran/manifest.json': manifest,
    [`/data/quran/surah-${String(surah).padStart(3, '0')}.json`]: { datasetId: pin.datasetId, surah, ayahs },
  };
  const fetcher: Fetcher = async (path) => {
    if (!(path in files)) throw new Error(`404 ${path}`);
    return structuredClone(files[path]);
  };
  return { manifest, ayahs, files, fetcher };
}
