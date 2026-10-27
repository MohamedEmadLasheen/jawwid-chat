import { ayahKey, sha256Hex } from './quran-integrity';

/**
 * Tajweed marks (docs/product/quran-dataset-contract.md, "Tajweed"). The
 * owner's rule: a marking is displayed only after it has been verified and
 * officially approved. A mark is served only when ALL hold:
 *   - its state is `approved` (an authorised reviewer approved it) and it has
 *     not been withdrawn (chat.quran_tajweed_withdrawal);
 *   - it is one of the marks named by the LATEST sign-off of its surah
 *     (chat.quran_tajweed_review) for the same dataset, source and source
 *     version -- a mark approved after that sign-off waits for a new one;
 *   - that sign-off's `marksDigest` still equals the digest of the marks it
 *     names, so what is served is exactly what was signed;
 *   - its range lies inside its ayah's `verse` (the text WITHOUT the Basmala
 *     prefix): Unicode CODE POINT offsets, end exclusive, start < end.
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
  id: string;
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
  /** The exact marks this sign-off approved. */
  markIds: readonly string[];
  /** marksDigest() of those marks when signed. */
  marksDigest: string;
  reviewedAt: Date | string;
}

/**
 * The digest a sign-off records: one line per mark, `ayah|start|end|rule`,
 * sorted, joined with "\n", SHA-256 hex. The migration computes the same.
 */
export function marksDigest(marks: ReadonlyArray<Pick<TajweedMark, 'ayah' | 'start' | 'end' | 'rule'>>): string {
  const lines = marks
    .map((m) => ({ k: [m.ayah, m.start, m.end] as const, line: `${m.ayah}|${m.start}|${m.end}|${m.rule}`, rule: m.rule }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0))
    .map((x) => x.line);
  return sha256Hex(lines.join('\n'));
}

const groupKey = (x: { datasetId: string; surah: number; source: string; sourceVersion: string }) =>
  `${x.datasetId}|${x.surah}|${x.source}|${x.sourceVersion}`;

/**
 * The marks that may be shown, of those given. `marks` must include every mark
 * a sign-off names (whatever its state), so the sign-off's digest can be
 * checked; `withdrawn` holds withdrawn mark ids; `verses` the verified verse
 * per ayah key (`surah:ayah`). A mark of an ayah not in `verses` is not served.
 */
export function servableMarks(
  marks: readonly TajweedMark[],
  reviews: readonly TajweedReview[],
  withdrawn: ReadonlySet<string>,
  verses: ReadonlyMap<string, string>,
): TajweedMark[] {
  const latest = new Map<string, TajweedReview>();
  for (const r of reviews) {
    const k = groupKey(r);
    const seen = latest.get(k);
    if (!seen || new Date(r.reviewedAt).getTime() > new Date(seen.reviewedAt).getTime()) latest.set(k, r);
  }
  const byId = new Map(marks.map((m) => [m.id, m]));
  const known = new Set<string>(TAJWEED_RULES);
  const served: TajweedMark[] = [];
  for (const review of latest.values()) {
    const signed = review.markIds.map((id) => byId.get(id));
    // Fail closed: a named mark that cannot be read, or a digest that no longer matches.
    if (signed.some((m) => m === undefined)) continue;
    const set = signed as TajweedMark[];
    if (set.some((m) => groupKey(m) !== groupKey(review)) || marksDigest(set) !== review.marksDigest) continue;
    for (const m of set) {
      if (m.state !== 'approved' || withdrawn.has(m.id) || !known.has(m.rule)) continue;
      const verse = verses.get(ayahKey(m.surah, m.ayah));
      if (verse === undefined) continue;
      const length = [...verse].length;
      if (Number.isInteger(m.start) && Number.isInteger(m.end) && m.start >= 0 && m.start < m.end && m.end <= length) served.push(m);
    }
  }
  return served.sort((a, b) => a.ayah - b.ayah || a.start - b.start || a.end - b.end);
}
