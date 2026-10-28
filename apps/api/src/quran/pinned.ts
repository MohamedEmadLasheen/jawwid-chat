import type { PinnedDataset } from './quran-integrity';

/**
 * The trusted fingerprints, one entry per vendored dataset (data/quran/<id>.txt).
 * The loader (scripts/db/load-quran.py) refuses a file whose SHA-256 is not
 * `fileSha256`; the API refuses rows whose digest is not `ayahsDigest`. The
 * guard `quran-dataset` (scripts/qa/guards.sh) checks these values against
 * data/quran/<id>.sha256 and the file itself, so the three can never disagree.
 *
 * Adding a dataset is a reviewed change to this file, never configuration.
 */
export const PINNED_QURAN_DATASETS: ReadonlyMap<string, PinnedDataset> = new Map<string, PinnedDataset>([
  // Tanzil Quran Text (Uthmani, Version 1.1), Hafs -- CC BY 3.0, verbatim. Downloaded
  // 2026-10-27 with pause marks, sajdah signs and superscript alefs (data/quran/tanzil-uthmani-1.1.json).
  [
    'tanzil-uthmani-1.1',
    {
      id: 'tanzil-uthmani-1.1',
      fileSha256: '18c719bb3ba26d32ef457f40dad77cd28c4c5a34156833e26a8e5fcfdd246fb1',
      ayahsDigest: '849113038686701d40432aea92187101671f5a646f1a0774cfdc0b55394162a8',
      attribution: 'Tanzil Project — tanzil.net',
      sourceUrl: 'https://tanzil.net/',
    },
  ],
]);
