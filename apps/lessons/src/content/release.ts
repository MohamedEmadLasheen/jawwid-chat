/**
 * What a family build may carry of each content file (PD-29, owner 2026-10-30/31:
 * unreviewed lesson text never reaches what families download).
 *
 * Every JSON file the bundle imports is inlined into the public JavaScript, so
 * hiding a pending lesson at runtime is not enough: its text could still be read
 * out of the download. The build therefore passes each JSON import through
 * releaseContent() (the lessons-release plugin in vite.config.ts) BEFORE Vite
 * turns it into a module:
 *  - an APPROVED lesson file ships exactly as written, byte for byte;
 *  - a PENDING lesson file ships only as the stub {"withheld":true} (plus its
 *    `kind`, so a reading lesson still routes to the reading screen), which the
 *    resolvers show as "under review";
 *  - an approved file that still holds a flagged item, a file whose status is
 *    neither, and any JSON that is not on RULES FAIL the build.
 * The resolvers' own checks (approved, held items) stay as a second line.
 *
 * Pure: no Node built-ins, SHA-256 through WebCrypto. The runtime imports only
 * isWithheld().
 */

/** A lesson the Teachers department reviews; or a file that carries no lesson text and ships as it is. */
export type RuleKind = 'surah' | 'arabic' | 'mechanics' | 'approvals' | 'keys' | 'pin';

export interface Rule {
  /** Matched against the path relative to apps/lessons, with forward slashes. */
  pattern: RegExp;
  kind: RuleKind;
  /** A reviewed lesson: approved ships, pending is withheld. Otherwise it ships as it is. */
  reviewed: boolean;
}

/**
 * The allowlist. A new kind of content file is a reviewed change here, with its
 * own resolver handling the stub; until then it fails the build.
 */
export const RULES: readonly Rule[] = [
  { pattern: /^src\/content\/surah-\d{3}\.json$/, kind: 'surah', reviewed: true },
  { pattern: /^src\/arabic\/lesson-\d{3}\.json$/, kind: 'arabic', reviewed: true },
  // PD-49 game records: names and respect rules, no lesson text. A mechanic plays only
  // once signed (mechanics.ts); dropping unsigned ones from the bundle is an option (below).
  { pattern: /^src\/play\/mechanics\.json$/, kind: 'mechanics', reviewed: false },
  // The API's signed approval exports and the public keys that verify them.
  { pattern: /^src\/content\/approvals\/[a-z0-9-]+\.json$/, kind: 'approvals', reviewed: false },
  { pattern: /^src\/content\/approvals-keys\.json$/, kind: 'keys', reviewed: false },
  { pattern: /^quran-pin\.json$/, kind: 'pin', reviewed: false },
];

export function ruleFor(relPath: string): Rule | null {
  return RULES.find((r) => r.pattern.test(relPath)) ?? null;
}

export type Status = 'approved' | 'withheld' | 'as-is' | 'preview';

export interface ReleaseOptions {
  /** `vite build --mode preview` (the reviewer preview build, PR #330): every file ships as written. */
  preview?: boolean;
  /** Drop mechanics no approval names with both signers. OFF until the owner decides. */
  dropUnsignedMechanics?: boolean;
}

export interface Release {
  path: string;
  kind: RuleKind;
  status: Status;
  /** What the build hands on to Vite's JSON plugin. */
  code: string;
  sourceSha256: string;
  shippedSha256: string;
  /** Mechanics left out (dropUnsignedMechanics only). */
  dropped?: string[];
}

export interface Withheld {
  withheld: true;
  kind?: string;
}

/** The stub a pending lesson ships as. The resolvers show it as "under review". */
export function isWithheld(x: unknown): x is Withheld {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  const keys = Object.keys(o);
  return o.withheld === true && keys.every((k) => k === 'withheld' || k === 'kind') && (o.kind === undefined || typeof o.kind === 'string');
}

/** The stub's exact text; scripts/lessons/check-family-bundle.py computes the same bytes. */
export function stubFor(source: Record<string, unknown>): string {
  const kind = source.kind;
  return JSON.stringify(typeof kind === 'string' && /^[a-z]+$/.test(kind) ? { withheld: true, kind } : { withheld: true });
}

export class ReleaseRefused extends Error {}

/**
 * Where a lesson file still holds something back: every `review` note below the
 * file's own review, and every `was` (an old spelling kept until a teacher clears
 * it). CI refuses an approved file with any (check-lesson-content.py,
 * check-arabic-lesson.py); the build refuses it again here.
 */
export function flaggedPaths(source: Record<string, unknown>): string[] {
  const out: string[] = [];
  const walk = (x: unknown, at: string): void => {
    if (Array.isArray(x)) {
      x.forEach((v, i) => walk(v, `${at}[${i}]`));
      return;
    }
    if (!x || typeof x !== 'object') return;
    for (const [k, v] of Object.entries(x)) {
      const here = at ? `${at}.${k}` : k;
      if ((k === 'review' || k === 'was') && at !== '' && v !== null) out.push(here);
      else if (!(k === 'review' && at === '')) walk(v, here);
    }
  };
  walk(source, '');
  return out;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function parse(path: string, code: string): Record<string, unknown> {
  let source: unknown;
  try {
    source = JSON.parse(code);
  } catch {
    throw new ReleaseRefused(`${path}: not valid JSON`);
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new ReleaseRefused(`${path}: not a JSON object`);
  return source as Record<string, unknown>;
}

/** The mechanic ids an approvals export names with both a teacher and the scholar (unverified: the runtime verifies). */
function signedIds(approvals: unknown): Set<string> {
  const list = (approvals as { payload?: { approvals?: unknown } } | null)?.payload?.approvals;
  const out = new Set<string>();
  if (!Array.isArray(list)) return out;
  for (const a of list as { id?: unknown; steps?: unknown }[]) {
    if (typeof a?.id === 'string' && Array.isArray(a.steps) && a.steps.includes('teacher') && a.steps.includes('scholar')) out.add(a.id);
  }
  return out;
}

/**
 * What the family build ships for one JSON import. Throws ReleaseRefused for a
 * file that is not on RULES, or that cannot be released.
 */
export async function releaseContent(path: string, code: string, options: ReleaseOptions & { playApprovals?: unknown } = {}): Promise<Release> {
  const rule = ruleFor(path);
  if (!rule) throw new ReleaseRefused(`${path}: a JSON import that is not on the release allowlist (src/content/release.ts RULES)`);
  const sourceSha256 = await sha256(code);
  const ship = async (status: Status, out: string, dropped?: string[]): Promise<Release> => ({
    path,
    kind: rule.kind,
    status,
    code: out,
    sourceSha256,
    shippedSha256: out === code ? sourceSha256 : await sha256(out),
    ...(dropped ? { dropped } : {}),
  });
  if (options.preview) return ship('preview', code);

  if (!rule.reviewed) {
    if (rule.kind === 'mechanics' && options.dropUnsignedMechanics) {
      const source = parse(path, code);
      const list = Array.isArray(source.mechanics) ? (source.mechanics as { id?: unknown }[]) : [];
      const signed = signedIds(options.playApprovals);
      const dropped = list.filter((m) => !signed.has(String(m?.id))).map((m) => String(m?.id));
      if (dropped.length === 0) return ship('as-is', code);
      return ship('as-is', JSON.stringify({ ...source, mechanics: list.filter((m) => signed.has(String(m?.id))) }), dropped);
    }
    return ship('as-is', code);
  }

  const source = parse(path, code);
  const review = source.review as { status?: unknown } | undefined;
  if (source.schema !== undefined && source.schema !== 1) {
    // Schema 2 is approved item by item (quran-content.ts); its per-item release filter is PR-3.
    throw new ReleaseRefused(`${path}: schema ${JSON.stringify(source.schema)} has no release rule yet`);
  }
  const status = review && typeof review === 'object' ? review.status : undefined;
  if (status === 'approved') {
    const flagged = flaggedPaths(source);
    if (flagged.length) {
      throw new ReleaseRefused(`${path}: approved while ${flagged.length} item(s) are still held (${flagged.slice(0, 3).join(', ')})`);
    }
    return ship('approved', code);
  }
  if (status === 'pending') return ship('withheld', stubFor(source));
  throw new ReleaseRefused(`${path}: review.status is ${JSON.stringify(status)}, neither pending nor approved`);
}
