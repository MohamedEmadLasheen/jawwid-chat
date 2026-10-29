/**
 * PD-45 (plan §4): a family's location is read by exactly the PD-17 matrix --
 * the administration through the Parent Profile and Sales' forms, and the
 * parent for their own family. It is never in a teacher's view, a message, a
 * card, a push or a realtime event.
 *
 * The country column is older (Stories targeting reads it). The SUBDIVISION
 * and who set the location are new, so they may be named only where the plan
 * puts them; a service anywhere else that started selecting them fails here
 * until it is added below, deliberately, with its reason.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..', '..', '..', 'src');
const MIGRATIONS = join(__dirname, '..', '..', '..', '..', '..', 'supabase', 'migrations');

/** Each migration allowed to name them (a view, a function or an outbox payload built in SQL), and why. */
const MIGRATIONS_ALLOWED: Readonly<Record<string, string>> = {
  '20261030030000_chat_pd045_parent_location.sql': 'defines the columns, their keys, the Sales scope and the grants',
};

/** Each directory (trailing slash) or file allowed to name them, and why. */
const ALLOWED: Readonly<Record<string, string>> = {
  'geo/': 'the dataset and the rule that a subdivision is its country\'s',
  'parent-profile/': 'the Parent Profile (staff) and, in PR-4, the parent\'s own /me/location',
  'new-students/': 'Sales\' subscription form and PD-16 Assign (PR-3)',
};

const NAMES =
  /\bsubdivision_code\b|\bsubdivisionCode\b|\blocation_source\b|\blocationSource\b|\blocation_updated_at\b|\blocationUpdatedAt\b|\blocation_updated_by\b|\blocationUpdatedBy\b/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const allowed = (rel: string) => Object.keys(ALLOWED).some((a) => (a.endsWith('/') ? rel.startsWith(a) : rel === a));

export function offenders(files: Array<{ rel: string; text: string }>): string[] {
  return files
    .filter((f) => !allowed(f.rel))
    .flatMap((f) =>
      f.text
        .split('\n')
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => NAMES.test(line))
        .map(({ line, i }) => `${f.rel}:${i + 1}: ${line.trim()}`),
    );
}

describe('a family\'s location is read only where PD-45 §4 puts it', () => {
  it('no other source names the subdivision or who set the location', () => {
    const files = sources(SRC).map((p) => ({ rel: relative(SRC, p), text: readFileSync(p, 'utf8') }));
    expect(offenders(files)).toEqual([]);
  });

  it('fires on the shapes it exists to catch, and not on the country Stories already reads', () => {
    for (const [rel, text] of [
      ['lessons/teacher-day.service.ts', 'select: { displayName: true, subdivisionCode: true },'],
      ['communication/outbox/payloads.ts', "SELECT f.subdivision_code FROM chat.family f"],
      ['communication/stories/story.service.ts', 'locationSource: f.locationSource,'],
    ] as const) {
      expect({ text, hit: offenders([{ rel, text }]).length }).toEqual({ text, hit: 1 });
    }
    expect(offenders([{ rel: 'communication/stories/story.service.ts', text: 'select: { countryCode: true },' }])).toEqual([]);
  });

  it('no migration names them but PD-45\'s own: no view, function or payload built in SQL exposes them', () => {
    const offending = readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith('.sql') && !(name in MIGRATIONS_ALLOWED))
      .flatMap((name) =>
        readFileSync(join(MIGRATIONS, name), 'utf8')
          .split('\n')
          .map((line, i) => ({ line, i }))
          .filter(({ line }) => NAMES.test(line))
          .map(({ line, i }) => `${name}:${i + 1}: ${line.trim()}`),
      );
    expect(offending).toEqual([]);
    for (const name of Object.keys(MIGRATIONS_ALLOWED)) expect(statSync(join(MIGRATIONS, name)).isFile()).toBe(true);
  });

  it('allows only places that exist, each with its reason', () => {
    for (const [rel, why] of Object.entries(ALLOWED)) {
      expect(statSync(join(SRC, rel)).isDirectory() || statSync(join(SRC, rel)).isFile()).toBe(true);
      expect(why).toMatch(/\S/);
    }
  });
});
