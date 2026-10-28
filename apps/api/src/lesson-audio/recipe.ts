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
  if (typeof r.input !== 'string' || !r.input.length || r.input.length > 4000) return 'input';
  if (typeof r.lexicon !== 'string' || !(r.lexicon === '' || /^[0-9a-f]{64}$/.test(r.lexicon))) return 'lexicon';
  if (typeof r.take !== 'number' || !Number.isInteger(r.take) || r.take < 1 || r.take > 100) return 'take';
  return r as unknown as RenderRecipe;
}
