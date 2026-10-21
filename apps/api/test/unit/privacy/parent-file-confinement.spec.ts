/**
 * PD-17 / G-07: the parent file holds a parent's phone and e-mail, so it must
 * stay where the communication engine cannot reach it.
 *
 * no-contact-channel-columns.spec.ts allows exactly one phone declaration on
 * chat.parent_file. This guard is what makes that exception safe: only
 * src/parent-profile may name that table, its Prisma model or its contact
 * fields. A message, conversation, call, notification, realtime or story code
 * path that started reading it would restore the whole class of leak G-07
 * closes, so that fails the build here.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..', '..', '..', 'src');
const OWNER = 'parent-profile/';

/** The table name and the Prisma accessor / model / fields that reach it. Case-sensitive on purpose. */
const NAMES = /\bparent_file\b|\bparentFile\b|\badminOnlyParentPhone\b|\badminOnlyParentEmail\b|\bParentFile\b/;

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

describe('the parent file is read only by src/parent-profile (PD-17, G-07)', () => {
  it('no other source names its table, model or contact fields', () => {
    const files = sources(SRC).map((p) => ({ rel: relative(SRC, p), text: readFileSync(p, 'utf8') }));
    expect(files.some((f) => f.rel.startsWith(OWNER))).toBe(true);
    expect(offenders(files)).toEqual([]);
  });

  it('the guard fires on the shapes it exists to catch, and not on the module wiring', () => {
    const fires = [
      'const f = await this.prisma.parentFile.findUnique({ where: { contactId } });',
      'select phone from chat.parent_file',
      'const p: ParentFile = row;',
      'return { phone: file.adminOnlyParentPhone };',
      'email: row.adminOnlyParentEmail,',
    ];
    for (const text of fires) {
      expect({ text, hit: offenders([{ rel: 'communication/messages/x.ts', text }]).length }).toEqual({ text, hit: 1 });
    }
    const quiet = [
      "import { ParentRecordModule } from './parent-profile/parent-record.module';",
      "import { seedFromEnrolment } from '../parent-profile/parent-record.service';",
      'await seedFromEnrolment(tx, { contactId, phone: form.parent.phone });',
    ];
    for (const text of quiet) {
      expect(offenders([{ rel: 'new-students/enrolment.service.ts', text }])).toEqual([]);
    }
  });
});
