/**
 * PD-45 (owner 2026-10-29, "At booking too"): a trial booking may carry the
 * family's country and subdivision, in chat.trial_prospect_location, BESIDE
 * the prospect and never on it -- a prospect is a display name only (BR-2),
 * and every booking change is posted as a card into the TEACHER's trial group.
 *
 * So the booking's location may be named only where the plan allows it
 * (docs/product/pd045-parent-location-plan.md §5.5): the booking's write and
 * the pre-fill of Sales' subscription form. A trial card, the trial group, a
 * trial event or a teacher-facing read that started selecting it fails here.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..', '..', '..', 'src');

/** Each source file allowed to name it, and why. PR-3 adds the booking write and the pre-fill read. */
const ALLOWED: Readonly<Record<string, string>> = {};

const NAMES = /\btrial_prospect_location\b|\btrialProspectLocation\b|\bTrialProspectLocation\b/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.ts') ? [p] : [];
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
  it('no other source names its table or its Prisma model', () => {
    const files = sources(SRC).map((p) => ({ rel: relative(SRC, p), text: readFileSync(p, 'utf8') }));
    expect(offenders(files)).toEqual([]);
  });

  it('fires on the shapes it exists to catch', () => {
    for (const text of [
      'const loc = await tx.trialProspectLocation.findUnique({ where: { prospectId } });',
      'left join chat.trial_prospect_location l on l.prospect_id = p.id',
      'const row: TrialProspectLocation = x;',
    ]) {
      expect({ text, hit: offenders([{ rel: 'lessons/trial-group.service.ts', text }]).length }).toEqual({ text, hit: 1 });
    }
    expect(offenders([{ rel: 'lessons/trial.service.ts', text: 'const prospect = await tx.trialProspect.create({ data });' }])).toEqual([]);
  });

  it('allows only files that exist, each with its reason', () => {
    for (const [rel, why] of Object.entries(ALLOWED)) {
      expect(statSync(join(SRC, rel)).isFile()).toBe(true);
      expect(why).toMatch(/\S/);
    }
  });
});
