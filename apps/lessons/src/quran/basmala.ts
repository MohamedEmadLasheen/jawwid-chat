/**
 * The two accepted spellings of the Basmala, by SHA-256 -- the same set as the
 * API's (apps/api/src/quran/quran-integrity.ts); the lessons-supply-chain guard
 * fails if they ever differ. The plain spelling is 1:1 itself and prefixes 110
 * surahs; the "bi-shadda" spelling prefixes 95 and 97. Contract:
 * docs/product/quran-dataset-contract.md, "The Basmala".
 */
export const BASMALA_SHA256: ReadonlySet<string> = new Set([
  'ac1e6f8f64c2e83d0b5087625a5e1eb0067b99d4a8962d3ad30528709dcf3dd6',
  '5c88aa6a96b7e5db4565abcd6694de3a379dc4233bcd4abbe65952559c3d544a',
]);
