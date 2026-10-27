import { ayahKey } from './quran-integrity';

/**
 * Tajweed marks (docs/product/quran-dataset-contract.md, "Tajweed"). The
 * owner's rule: a marking is displayed only after it has been verified and
 * officially approved. A mark is served only when ALL hold:
 *   - its state is `approved` (an academy Quran teacher approved it);
 *   - its surah has a sign-off (chat.quran_tajweed_review) for the same
 *     dataset, source and source version -- the teacher signs a sheet per surah;
 *   - its range lies inside its ayah's verbatim text: Unicode CODE POINT
 *     offsets, end exclusive, start < end.
 * Marks come from a published annotation, never from hand or model
 * classification. None are shipped yet.
 */
export const TAJWEED_RULES = [
  'izhar', 'idgham_ghunnah', 'idgham_no_ghunnah', 'iqlab', 'ikhfa',
  'izhar_shafawi', 'idgham_shafawi', 'ikhfa_shafawi', 'ghunnah', 'qalqalah',
  'madd_tabii', 'madd_muttasil', 'madd_munfasil', 'madd_lazim', 'madd_arid',
  'madd_lin', 'madd_badal', 'madd_iwad', 'madd_silah',
  'lam_shamsiyyah', 'lam_qamariyyah', 'hamzat_wasl', 'silent', 'tafkhim', 'tarqiq',
] as const;
export type TajweedRule = (typeof TAJWEED_RULES)[number];

export interface TajweedMark {
  datasetId: string;
  surah: number;
  ayah: number;
  start: number;
  end: number;
  rule: string;
  source: string;
  sourceVersion: string;
  state: 'pending' | 'approved' | 'rejected';
}

export interface TajweedReview {
  datasetId: string;
  surah: number;
  source: string;
  sourceVersion: string;
}

/**
 * The marks that may be shown, of those given. `texts` holds the verified text
 * per ayah key (`surah:ayah`); a mark of an ayah not in it is not served.
 */
export function servableMarks(
  marks: readonly TajweedMark[],
  reviews: readonly TajweedReview[],
  texts: ReadonlyMap<string, string>,
): TajweedMark[] {
  const signed = new Set(reviews.map((r) => `${r.datasetId}|${r.surah}|${r.source}|${r.sourceVersion}`));
  const known = new Set<string>(TAJWEED_RULES);
  return marks.filter((m) => {
    if (m.state !== 'approved') return false;
    if (!signed.has(`${m.datasetId}|${m.surah}|${m.source}|${m.sourceVersion}`)) return false;
    if (!known.has(m.rule)) return false;
    const text = texts.get(ayahKey(m.surah, m.ayah));
    if (text === undefined) return false;
    const length = [...text].length;
    return Number.isInteger(m.start) && Number.isInteger(m.end) && m.start >= 0 && m.start < m.end && m.end <= length;
  });
}
