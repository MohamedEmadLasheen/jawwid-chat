/**
 * Trial journey / G-07: Sales' subscription form holds a parent's phone and
 * e-mail, so it must stay where the communication engine cannot reach it.
 *
 * no-contact-channel-columns.spec.ts allows exactly one phone declaration on
 * chat.trial_subscription. This guard is what makes that exception safe: only
 * src/new-students may name that table, its Prisma model or its contact fields.
 * A message, card, conversation, notification, realtime, search or export code
 * path that started reading it would restore the whole class of leak G-07
 * closes, so that fails the build here.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..', '..', '..', 'src');
const OWNER = 'new-students/';

/** The table name and the Prisma accessors / fields that reach it. Case-sensitive on purpose. */
const NAMES = /\btrial_subscription\b|\btrialSubscription\b|\bTrialSubscription\b|\bconfinedParentPhone\b|\bconfinedEmail\b/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.ts') ? [p] : [];
  });
}

export function offenders(files: Array<{ rel: string; text: string }>): string[] {
  return files
    .filter((f) => !f.rel.startsWith(OWNER))
    .flatMap((f) =>
      f.text
        .split('\n')
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => NAMES.test(line))
        .map(({ line, i }) => `${f.rel}:${i + 1}: ${line.trim()}`),
    );
}

describe('the subscription form is read only by src/new-students (trial journey, G-07)', () => {
  it('no other source names its table, model or contact fields', () => {
    const files = sources(SRC).map((p) => ({ rel: relative(SRC, p), text: readFileSync(p, 'utf8') }));
    expect(files.some((f) => f.rel.startsWith(OWNER))).toBe(true);
    expect(offenders(files)).toEqual([]);
  });

  it('the guard fires on the shapes it exists to catch, and not on the module wiring', () => {
    const fires = [
      'const f = await this.prisma.trialSubscription.findUnique({ where: { lessonId } });',
      'select phone from chat.trial_subscription',
      'const p: TrialSubscription = row;',
      'return { phone: form.confinedParentPhone };',
      'return { email: form.confinedEmail };',
    ];
    for (const text of fires) {
      expect({ text, hit: offenders([{ rel: 'communication/messages/x.ts', text }]).length }).toEqual({ text, hit: 1 });
    }
    const quiet = [
      "import { NewStudentsModule } from '../new-students/new-students.module';",
      'await this.forms.recordInTx(tx, { lessonId, organizationId, form, by });',
    ];
    for (const text of quiet) {
      expect(offenders([{ rel: 'lessons/trial.service.ts', text }])).toEqual([]);
    }
  });
});
