/**
 * PD-10 / G-07: the Teacher File holds a teacher's phone, so it must stay
 * where the communication engine cannot reach it.
 *
 * no-contact-channel-columns.spec.ts allows exactly one phone declaration, on
 * chat.teacher_file. This guard is what makes that exception safe: only
 * src/teacher-file may name that table, its Prisma model or the phone field.
 *
 * The supervision timeline (chat.teacher_supervision_entry) used to be guarded
 * here too. Since the PD-10/PD-11 reconciliation (2026-10-19) it is PD-11's
 * table, shared with src/lessons, and carries no contact channel -- so it is not
 * part of the phone's confinement.
 * A message, conversation, call, notification, realtime or story code path that
 * started reading it would restore the whole class of leak G-07 closes, so
 * that fails the build here.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..', '..', '..', 'src');
const OWNER = 'teacher-file/';

/** The table names and the Prisma accessors / fields that reach them. Case-sensitive on purpose. */
const NAMES = /\bteacher_file\b|\bteacherFile\b|\badminOnlyPhone\b|\bTeacherFile\b(?!Module|Controller|Service|Access|EntryKind)/;

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

describe('the Teacher File is read only by src/teacher-file (PD-10, G-07)', () => {
  it('no other source names its tables, models or phone field', () => {
    const files = sources(SRC).map((p) => ({ rel: relative(SRC, p), text: readFileSync(p, 'utf8') }));
    expect(files.some((f) => f.rel.startsWith(OWNER))).toBe(true);
    expect(offenders(files)).toEqual([]);
  });

  it('the guard fires on the shapes it exists to catch, and not on the module wiring', () => {
    const fires = [
      'const f = await this.prisma.teacherFile.findUnique({ where: { teacherId } });',
      'select phone from chat.teacher_file',
      'const p: TeacherFile = row;',
      'return { phone: file.adminOnlyPhone };',
    ];
    for (const text of fires) {
      expect({ text, hit: offenders([{ rel: 'communication/messages/x.ts', text }]).length }).toEqual({ text, hit: 1 });
    }
    const quiet = [
      "import { TeacherFileModule } from './teacher-file/teacher-file.module';",
      'teacherFileAccess(actor, target)',
    ];
    for (const text of quiet) {
      expect(offenders([{ rel: 'app.module.ts', text }])).toEqual([]);
    }
  });
});
