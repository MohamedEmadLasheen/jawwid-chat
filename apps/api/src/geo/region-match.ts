import dataset from './dataset.json';

/**
 * PD-45 PR-5 (docs/product/pd045-parent-location-plan.md §6.3, §3.1.2): read
 * the old free-text region of a parent file as a first-level subdivision of the
 * family's country. Pure.
 *
 * A region matches only when, after the same normalisation as the pickers'
 * search (tatweel and diacritics gone; أ/إ/آ -> ا; ى -> ي; ة -> ه; case and
 * punctuation folded), with the type word dropped ("محافظة الجيزة", "Giza
 * Governorate") and a leading definite article optional, it equals the Arabic
 * or the English name of EXACTLY ONE subdivision of that country. "Contains"
 * and "close to" never match: a wrong state on a family is worse than a gap.
 *
 * The reviewed alias list the plan mentions ("Dubayy", "6th of October") lives
 * in the overlay, which is under release gate R-45a and is not changed here; it
 * would be one more key per subdivision in `keysOf` below.
 */
export type RegionMatch =
  | { outcome: 'matched'; code: string }
  /** The text equals more than one subdivision of the country. */
  | { outcome: 'ambiguous' }
  | { outcome: 'unmatched' };

/** Words that say what kind of place it is; the field's label already says so. Normalised form. */
const TYPE_WORDS: ReadonlySet<string> = new Set([
  'محافظه', 'منطقه', 'اماره', 'بلديه', 'ولايه', 'اقليم', 'مقاطعه',
  'governorate', 'province', 'emirate', 'state', 'region', 'municipality', 'territory', 'of', 'the',
]);

/** Lower-case, no diacritics, Arabic letter variants folded, punctuation as single spaces. */
export function normaliseRegionText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/ـ/g, '')
    .toLowerCase()
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const stripArticle = (word: string) => (word.startsWith('ال') && word.length > 3 ? word.slice(2) : word);

/** A name read two ways: whole, and with the type words dropped. The leading article is optional on every word. */
export function formsOf(text: string): { whole: string; bare: string } | null {
  const whole = normaliseRegionText(text).split(' ').filter(Boolean);
  if (whole.length === 0) return null;
  const bare = whole.filter((w) => !TYPE_WORDS.has(w));
  const join = (ws: string[]) => ws.map(stripArticle).join(' ');
  return { whole: join(whole), bare: join(bare.length > 0 ? bare : whole) };
}

type DatasetCountry = (typeof dataset.countries)[number];
const BY_CODE: ReadonlyMap<string, DatasetCountry> = new Map(dataset.countries.map((c) => [c.code, c]));
interface Index { whole: Map<string, Set<string>>; bare: Map<string, Set<string>> }
const INDEXES = new Map<string, Index>();

function indexOf(country: string): Index | undefined {
  const cached = INDEXES.get(country);
  if (cached) return cached;
  const c = BY_CODE.get(country);
  if (!c) return undefined;
  const index: Index = { whole: new Map(), bare: new Map() };
  const add = (m: Map<string, Set<string>>, key: string, code: string) => {
    let codes = m.get(key);
    if (!codes) m.set(key, (codes = new Set()));
    codes.add(code);
  };
  for (const s of c.subdivisions) {
    for (const name of [s.en, s.ar]) {
      const f = formsOf(name);
      if (!f) continue;
      add(index.whole, f.whole, s.code);
      add(index.bare, f.bare, s.code);
    }
  }
  INDEXES.set(country, index);
  return index;
}

/**
 * `country` is a listed ISO 3166-1 code; one that is not, or that has no
 * subdivisions, never matches. The whole text is tried first ("Buenos Aires
 * Province" is one subdivision's own name although "Buenos Aires" alone is
 * another's); only without a hit are the type words dropped on both sides.
 */
export function matchRegion(country: string, region: string): RegionMatch {
  const index = indexOf(country);
  const f = formsOf(region);
  if (!index || !f) return { outcome: 'unmatched' };
  const codes = index.whole.get(f.whole) ?? index.bare.get(f.bare);
  if (!codes) return { outcome: 'unmatched' };
  return codes.size === 1 ? { outcome: 'matched', code: [...codes][0]! } : { outcome: 'ambiguous' };
}
