/**
 * PD-45 (owner 2026-10-29, "At booking too"): a trial booking may carry the
 * family's country and subdivision, in chat.trial_prospect_location, BESIDE
 * the prospect and never on it -- a prospect is a display name only (BR-2),
 * and every booking change is posted as a card into the TEACHER's trial group.
 *
 * So the booking's location may be named only where the plan allows it
 * (docs/product/pd045-parent-location-plan.md §5.5): its own migration, the
 * booking's write and the pre-fill of Sales' subscription form. The scan
 * covers the API, the Admin Web and every migration (a view, a function or an
 * outbox payload built in SQL), so a trial card, the trial group, a trial
 * event or a teacher-facing read that started selecting it fails here.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO = join(__dirname, '..', '..', '..', '..', '..');
const ROOTS: ReadonlyArray<{ dir: string; ext: RegExp }> = [
  { dir: 'apps/api/src', ext: /\.ts$/ },
  { dir: 'apps/admin-web/src', ext: /\.(ts|tsx)$/ },
  { dir: 'supabase/migrations', ext: /\.sql$/ },
];
const SKIP = new Set(['node_modules', 'dist', 'build', 'coverage']);

/** Each file allowed to name it, and why. */
const ALLOWED: Readonly<Record<string, string>> = {
  'supabase/migrations/20261030030000_chat_pd045_parent_location.sql': 'defines the table, its guard and its retention purge',
  'apps/api/src/new-students/booking-location.ts': 'its one writer (the booking) and its one reader (the pre-fill of Sales\' form)',
};

const NAMES = /\btrial_prospect_location\b|\btrialProspectLocation\b|\bTrialProspectLocation\b/;

function sources(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sources(p, ext) : ext.test(name) ? [p] : [];
  });
}

export function offenders(files: Array<{ rel: string; text: string }>): string[] {
  return files
    .filter((f) => !(f.rel in ALLOWED))
    .flatMap((f) =>
      f.text
        .split('\n')
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => NAMES.test(line))
        .map(({ line, i }) => `${f.rel}:${i + 1}: ${line.trim()}`),
    );
}

describe('the booking\'s location is read only where PD-45 §5.5 allows (BR-2, G-07)', () => {
  const files = ROOTS.flatMap(({ dir, ext }) =>
    sources(join(REPO, dir), ext).map((p) => ({ rel: relative(REPO, p), text: readFileSync(p, 'utf8') })),
  );

  it('scans the API, the Admin Web and every migration', () => {
    for (const { dir } of ROOTS) expect(files.some((f) => f.rel.startsWith(`${dir}/`))).toBe(true);
  });

  it('no other file names its table or its Prisma model', () => {
    expect(offenders(files)).toEqual([]);
  });

  it('fires on the shapes it exists to catch', () => {
    for (const [rel, text] of [
      ['apps/api/src/lessons/trial-group.service.ts', 'const loc = await tx.trialProspectLocation.findUnique({ where: { prospectId } });'],
      ['supabase/migrations/20991231000000_chat_x.sql', 'create view chat.trial_card as select p.*, l.country_code from chat.trial_prospect p join chat.trial_prospect_location l on true;'],
      ['supabase/migrations/20991231000000_chat_x.sql', "  jsonb_build_object('country', (select country_code from chat.trial_prospect_location where prospect_id = p.id))"],
      ['apps/admin-web/src/features/trials/api.ts', 'type Row = TrialProspectLocation;'],
    ] as const) {
      expect({ text, hit: offenders([{ rel, text }]).length }).toEqual({ text, hit: 1 });
    }
    expect(offenders([{ rel: 'apps/api/src/worker.ts', text: 'await prisma.$queryRaw`SELECT chat.purge_trial_prospect_locations()`;' }])).toEqual([]);
  });

  it('allows only files that exist, each with its reason', () => {
    for (const [rel, why] of Object.entries(ALLOWED)) {
      expect(statSync(join(REPO, rel)).isFile()).toBe(true);
      expect(why).toMatch(/\S/);
    }
  });
});
