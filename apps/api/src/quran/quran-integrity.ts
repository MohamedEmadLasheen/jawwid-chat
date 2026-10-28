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
 * A range reference (the whiteboard's rangeSha256) uses the same digestOf, over
 * the per-ayah hashes of `verse` (below).
 *
 * THE BASMALA (contract, "The Basmala"). Tanzil writes the Basmala in front of
 * ayah 1 of every surah except Al-Fatihah (where 1:1 IS the Basmala) and
 * At-Tawbah (which has none). The file and the pinned hashes stay verbatim,
 * but each ayah is also split into { basmala, verse }: the prefix is accepted
 * ONLY when its SHA-256 is one of BASMALA_SHA256 (the plain spelling, and
 * "bi-shadda" in 95 and 97), otherwise the load is refused. Tajweed offsets,
 * audio and range references are all defined against `verse`.
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
  /** Verbatim from the source file (the Basmala prefix included where the file has it). */
  text: string;
  /** SHA-256 of `text`'s UTF-8 bytes, as stored. */
  sha256: string;
  /** As stored: the Basmala prefix of ayah 1, or null. Checked against the split. */
  basmala?: string | null;
  /** As stored: the ayah without the prefix. Checked against the split. */
  verse?: string;
}

/**
 * The accepted Basmala prefixes, by the SHA-256 of their UTF-8 (never typed:
 * identical-looking Arabic can differ in code points). Computed from the pinned
 * Tanzil 1.1 file: the 1:1 text (prefixed to 110 surahs), and the bi-shadda
 * spelling prefixed to 95 and 97. The same list is in the migration and the loader.
 */
export const BASMALA_SHA256: ReadonlySet<string> = new Set([
  'ac1e6f8f64c2e83d0b5087625a5e1eb0067b99d4a8962d3ad30528709dcf3dd6',
  '5c88aa6a96b7e5db4565abcd6694de3a379dc4233bcd4abbe65952559c3d544a',
]);

/** One ayah as served: the Basmala prefix (or null) and the verse. */
export interface VerifiedAyah {
  verbatimSha256: string;
  basmala: string | null;
  verse: string;
  verseSha256: string;
}

/** The Basmala's four words, and the rest after the single separating space. */
function firstFourWords(text: string): { prefix: string; rest: string } | null {
  let at = -1;
  for (let i = 0; i < 4; i++) {
    at = text.indexOf(' ', at + 1);
    if (at < 0) return null;
  }
  return { prefix: text.slice(0, at), rest: text.slice(at + 1) };
}

/**
 * Split one verbatim ayah. Ayah 1 of every surah but 1 and 9 must start with an
 * accepted Basmala and a single space; 9:1 must not; 1:1 is itself the verse.
 */
export function splitBasmala(surah: number, ayah: number, text: string): { basmala: string | null; verse: string } {
  const head = firstFourWords(text);
  const isBasmala = head !== null && BASMALA_SHA256.has(sha256Hex(head.prefix));
  if (ayah === 1 && surah !== 1 && surah !== 9) {
    if (!head || !isBasmala || !head.rest || head.rest.startsWith(' ')) {
      throw new QuranIntegrityError('basmala', `${surah}:1 does not start with an accepted Basmala`);
    }
    return { basmala: head.prefix, verse: head.rest };
  }
  if (ayah === 1 && surah === 9 && isBasmala) {
    throw new QuranIntegrityError('basmala', '9:1 must not carry a Basmala');
  }
  return { basmala: null, verse: text };
}

export const QURAN_AYAH_TOTAL = 6236;

export type IntegrityReason = 'count' | 'numbering' | 'empty' | 'ayah-hash' | 'digest' | 'basmala' | 'unpinned' | 'served-hash';

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
 * empty ayah, each stored hash the hash of its text, every ayah split into
 * { basmala, verse } as the rule requires (and, when the row carries its stored
 * split, equal to it), and the digest of all verbatim hashes the pinned one.
 * Returns the verified ayah per key; throws QuranIntegrityError otherwise. Rows
 * may arrive in any order.
 */
export function verifyDataset(
  rows: readonly AyahRow[],
  pinned: PinnedDataset,
  surahs: readonly Surah[] = SURAHS,
): Map<string, VerifiedAyah> {
  const total = surahs.reduce((n, s) => n + s.ayahCount, 0);
  if (rows.length !== total) throw new QuranIntegrityError('count', `${rows.length} ayat, expected ${total}`);

  const bySurah = new Map<number, Map<number, AyahRow>>();
  for (const r of rows) {
    let ayat = bySurah.get(r.surah);
    if (!ayat) bySurah.set(r.surah, (ayat = new Map()));
    if (ayat.has(r.ayah)) throw new QuranIntegrityError('numbering', `${r.surah}:${r.ayah} appears twice`);
    ayat.set(r.ayah, r);
  }

  const verified = new Map<string, VerifiedAyah>();
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
      const split = splitBasmala(s.number, a, r.text);
      if ((r.basmala !== undefined && r.basmala !== split.basmala) || (r.verse !== undefined && r.verse !== split.verse)) {
        throw new QuranIntegrityError('basmala', `${s.number}:${a}: the stored Basmala split is not the text's`);
      }
      verified.set(ayahKey(s.number, a), { verbatimSha256: r.sha256, ...split, verseSha256: sha256Hex(split.verse) });
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
