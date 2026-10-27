import { createHash } from 'node:crypto';
import { SURAHS, type Surah } from '../materials/quran-surahs';

/**
 * The shared Quran dataset's integrity checks (docs/product/quran-dataset-contract.md).
 *
 * The owner's rule: every time the text is loaded it is checked against a
 * fixed, trusted fingerprint. Two fingerprints are pinned in code for each
 * dataset (pinned.ts):
 *   fileSha256   the vendored source file, checked by the loader before a row
 *                is written (scripts/db/load-quran.py);
 *   ayahsDigest  SHA-256 of the 6,236 per-ayah SHA-256s (UTF-8 of the verbatim
 *                text), joined with "\n" in canonical order -- checked by the
 *                API against the rows it actually reads, so a row changed in
 *                the database after loading is caught too.
 * A range reference (the whiteboard's rangeSha256) uses the same digestOf.
 */
export interface PinnedDataset {
  /** e.g. `tanzil-uthmani-1.1` */
  id: string;
  fileSha256: string;
  ayahsDigest: string;
  attribution: string;
  sourceUrl: string;
}

export interface AyahRow {
  surah: number;
  ayah: number;
  /** Verbatim from the source file. */
  text: string;
  /** SHA-256 of `text`'s UTF-8 bytes, as stored. */
  sha256: string;
}

export const QURAN_AYAH_TOTAL = 6236;

export type IntegrityReason = 'count' | 'numbering' | 'empty' | 'ayah-hash' | 'digest' | 'unpinned' | 'served-hash';

export class QuranIntegrityError extends Error {
  constructor(
    readonly reason: IntegrityReason,
    detail: string,
  ) {
    super(`quran dataset refused (${reason}): ${detail}`);
  }
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** SHA-256 of the given per-ayah hashes joined with "\n", in the order given. */
export function digestOf(shas: readonly string[]): string {
  return sha256Hex(shas.join('\n'));
}

export const ayahKey = (surah: number, ayah: number): string => `${surah}:${ayah}`;

/**
 * Check a whole dataset as read: every surah complete and numbered 1..n, no
 * empty ayah, each stored hash the hash of its text, and the digest of all of
 * them the pinned one. Returns the verified hash per ayah key; throws
 * QuranIntegrityError otherwise. Rows may arrive in any order.
 */
export function verifyDataset(
  rows: readonly AyahRow[],
  pinned: PinnedDataset,
  surahs: readonly Surah[] = SURAHS,
): Map<string, string> {
  const total = surahs.reduce((n, s) => n + s.ayahCount, 0);
  if (rows.length !== total) throw new QuranIntegrityError('count', `${rows.length} ayat, expected ${total}`);

  const bySurah = new Map<number, Map<number, AyahRow>>();
  for (const r of rows) {
    let ayat = bySurah.get(r.surah);
    if (!ayat) bySurah.set(r.surah, (ayat = new Map()));
    if (ayat.has(r.ayah)) throw new QuranIntegrityError('numbering', `${r.surah}:${r.ayah} appears twice`);
    ayat.set(r.ayah, r);
  }

  const verified = new Map<string, string>();
  const ordered: string[] = [];
  for (const s of surahs) {
    const ayat = bySurah.get(s.number);
    if (!ayat || ayat.size !== s.ayahCount) {
      throw new QuranIntegrityError('count', `surah ${s.number} has ${ayat?.size ?? 0} ayat, expected ${s.ayahCount}`);
    }
    for (let a = 1; a <= s.ayahCount; a++) {
      const r = ayat.get(a);
      if (!r) throw new QuranIntegrityError('numbering', `surah ${s.number} has no ayah ${a}`);
      if (!r.text) throw new QuranIntegrityError('empty', `${s.number}:${a} is empty`);
      if (sha256Hex(r.text) !== r.sha256) throw new QuranIntegrityError('ayah-hash', `${s.number}:${a} does not match its hash`);
      verified.set(ayahKey(s.number, a), r.sha256);
      ordered.push(r.sha256);
    }
  }
  if (bySurah.size !== surahs.length) throw new QuranIntegrityError('numbering', 'a surah number outside 1..114');

  const digest = digestOf(ordered);
  if (digest !== pinned.ayahsDigest) {
    throw new QuranIntegrityError('digest', `the text's digest ${digest} is not the pinned ${pinned.ayahsDigest}`);
  }
  return verified;
}
