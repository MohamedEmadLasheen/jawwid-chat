import { createHash } from 'node:crypto';

/**
 * PD-48: the render recipe -- everything that shapes a clip's sound
 * (design §5). It is canonical JSON (keys sorted at every depth, no
 * whitespace), and its SHA-256 is `render_sha256`. Any change to the voice,
 * rate, input, lexicon or take is a new recipe, hence a new clip that needs
 * its own two approvals.
 *
 * The same canonical form is written by scripts/lessons/tts/generate.py
 * (json.dumps(sort_keys=True, separators=(',', ':'), ensure_ascii=False)); the
 * ingest recomputes the hash here and refuses a manifest that disagrees.
 */
export interface RenderRecipe {
  /** The recipe format. */
  v: 1;
  /** How the text was normalized before hashing: `exact-v1` = not at all (the lesson's NFC string). */
  norm: 'exact-v1';
  vendor: string;
  voice: string;
  locale: string;
  format: string;
  rate: string;
  /** What was SENT to the vendor (SSML), which may differ from the text after a pronunciation fix. */
  input: string;
  /** SHA-256 of the lexicon entries applied to this string ('' when none). */
  lexicon: string;
  take: number;
}

const VENDOR = /^[a-z][a-z0-9-]{1,31}$/;

/** Owner Q6: about 10% slower for children -- never faster than normal, never slower than 0.85. */
export const RATE_RANGE = { min: 0.85, max: 1 } as const;

/** A recipe's speaking rate as a factor of normal: Azure writes `-10%`, Polly `90%`. Anything else is null. */
export function rateFactor(rate: string): number | null {
  const relative = /^-(\d{1,2})%$/.exec(rate);
  if (relative) return 1 - Number(relative[1]) / 100;
  if (rate === '0%') return 1;
  const absolute = /^(\d{2,3})%$/.exec(rate);
  return absolute ? Number(absolute[1]) / 100 : null;
}
const VOICE = /^[A-Za-z0-9-]{1,80}$/;

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(',')}}`;
}

export function renderSha256(recipe: RenderRecipe): string {
  return createHash('sha256').update(canonicalJson(recipe), 'utf8').digest('hex');
}

/** The recipe, if `raw` is exactly one (no other field); otherwise the reason it is not. */
export function parseRecipe(raw: unknown): RenderRecipe | string {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return 'the recipe is not an object';
  const keys = ['v', 'norm', 'vendor', 'voice', 'locale', 'format', 'rate', 'input', 'lexicon', 'take'];
  if (Object.keys(r).some((k) => !keys.includes(k)) || keys.some((k) => !(k in r))) return `the recipe has exactly the fields ${keys.join(', ')}`;
  if (r.v !== 1 || r.norm !== 'exact-v1') return 'an unknown recipe version or normalization';
  if (typeof r.vendor !== 'string' || !VENDOR.test(r.vendor)) return 'vendor';
  if (typeof r.voice !== 'string' || !VOICE.test(r.voice)) return 'voice';
  for (const k of ['locale', 'format', 'rate'] as const) if (typeof r[k] !== 'string' || !(r[k] as string).length || (r[k] as string).length > 80) return k;
  const factor = rateFactor(r.rate as string);
  if (factor === null || factor < RATE_RANGE.min || factor > RATE_RANGE.max) return `rate: between ${RATE_RANGE.min} and ${RATE_RANGE.max} of normal`;
  if (typeof r.input !== 'string' || !r.input.length || r.input.length > 4000) return 'input';
  // The rate the vendor is SENT is the recipe's rate: no <prosody rate> in the input says otherwise.
  if ([...r.input.matchAll(/\brate\s*=\s*["']([^"']*)["']/g)].some((m) => m[1] !== r.rate)) return 'input: a prosody rate other than the recipe\'s rate';
  if (typeof r.lexicon !== 'string' || !(r.lexicon === '' || /^[0-9a-f]{64}$/.test(r.lexicon))) return 'lexicon';
  if (typeof r.take !== 'number' || !Number.isInteger(r.take) || r.take < 1 || r.take > 100) return 'take';
  return r as unknown as RenderRecipe;
}
