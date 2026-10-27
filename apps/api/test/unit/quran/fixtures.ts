import { SURAHS } from '../../../src/materials/quran-surahs';
import { digestOf, sha256Hex, type AyahRow, type PinnedDataset } from '../../../src/quran/quran-integrity';

/** A stand-in for the real text: one distinct line per ayah, the real ayah counts. */
export function syntheticRows(): AyahRow[] {
  const rows: AyahRow[] = [];
  for (const s of SURAHS) {
    for (let a = 1; a <= s.ayahCount; a++) {
      const text = `نص ${s.number}:${a}`;
      rows.push({ surah: s.number, ayah: a, text, sha256: sha256Hex(text) });
    }
  }
  return rows;
}

export function pinnedFor(rows: readonly AyahRow[]): PinnedDataset {
  return {
    id: 'synthetic-1',
    fileSha256: 'f'.repeat(64),
    ayahsDigest: digestOf(rows.map((r) => r.sha256)),
    attribution: 'test',
    sourceUrl: 'https://example.test/quran',
  };
}
