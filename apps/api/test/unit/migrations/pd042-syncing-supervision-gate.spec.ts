/**
 * PD-42 (review of #194): who may open chat.syncing_supervision.
 *
 * The GUC lets a write to chat.learner_supervision through without a named
 * Operations-manager assigner. It is an academy-import convenience, not a
 * security boundary (the grants are): any server-side session could set it.
 * So the places that may open it are pinned here, and a new one fails the
 * build until it is added below, deliberately, with its reason. Every use is
 * also audited by the database ('learner.supervision_imported').
 *
 * Pure: reads files, no database.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO = join(__dirname, '..', '..', '..', '..', '..');
const ROOTS = ['apps', 'scripts', 'supabase'];
const SKIP = new Set(['node_modules', 'dist', 'build', 'coverage', '.dart_tool', '.next', '.turbo']);
const CODE = /\.(ts|tsx|js|mjs|cjs|sql|sh|py)$/;
const GATE = /syncing_supervision/;

/** Each file allowed to name the gate, and why. */
const ALLOWED: Readonly<Record<string, string>> = {
  'supabase/migrations/20261028110000_chat_pd042_direct_enrolment.sql': 'defines the gate and its audit',
  'apps/api/test/integration/harness.ts': 'supervise() stands in for the Operations Manager\'s assignment in suites that never name one',
  'apps/api/test/integration/pd042-intake-data.spec.ts': 'proves the gate\'s rules: a named source, an audit row, one statement only',
  'apps/api/test/unit/migrations/pd042-syncing-supervision-gate.spec.ts': 'this guard',
};

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) files(path, out);
    else if (CODE.test(name)) out.push(path);
  }
  return out;
}

/** The repository-relative files that name the gate. */
export function openers(paths: readonly string[], read: (p: string) => string): string[] {
  return paths.filter((p) => GATE.test(read(p))).map((p) => relative(REPO, p).split('\\').join('/')).sort();
}

describe('PD-42: only the allowlisted places open chat.syncing_supervision', () => {
  const all = ROOTS.flatMap((r) => files(join(REPO, r)));

  it('no file outside the allowlist names the gate', () => {
    const found = openers(all, (p) => readFileSync(p, 'utf8'));
    expect(found.filter((f) => !(f in ALLOWED))).toEqual([]);
  });

  it('the harness opens it inside supervise() only', () => {
    const harness = readFileSync(join(REPO, 'apps/api/test/integration/harness.ts'), 'utf8');
    const start = harness.indexOf('export async function supervise(');
    const end = harness.indexOf('\nexport ', start + 1);
    expect(start).toBeGreaterThan(-1);
    const inside = harness.slice(start, end);
    const outside = harness.slice(0, start) + harness.slice(end);
    expect(GATE.test(inside)).toBe(true);
    expect(GATE.test(outside)).toBe(false);
  });

  it('the guard itself sees a new opener (it can fail)', () => {
    const planted = join(REPO, 'apps/api/src/somewhere/new-import.ts');
    const read = (p: string) => (p === planted ? "select set_config('chat.syncing_supervision', 'on', true)" : '');
    expect(openers([planted], read)).toEqual(['apps/api/src/somewhere/new-import.ts']);
  });
});
