import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * PD-32: a parent's feedback about a teacher is never shown to the teacher, so
 * it is read and written ONLY by src/teacher-file (the Teachers department's
 * confined module, whose every route is gated to the department, the super
 * admin, the filing parent, or the children's supervisor). A second reader --
 * a teacher-facing DTO, a card, a notification -- is where "the teacher never
 * sees who filed it" would quietly stop being true.
 */
const SRC = join(__dirname, '..', '..', '..', 'src');
const OWNER = 'teacher-file/';
const NAMES = /\bparent_feedback\b|\bparentFeedback\b|\bParentFeedback\b(?!Module|Controller|Service)/;

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

describe('parent feedback is read only by src/teacher-file (PD-32)', () => {
  it('no other source names its table or model', () => {
    const files = sources(SRC).map((p) => ({ rel: relative(SRC, p), text: readFileSync(p, 'utf8') }));
    expect(files.some((f) => f.rel.startsWith(`${OWNER}parent-feedback`))).toBe(true);
    expect(offenders(files)).toEqual([]);
  });

  it('the guard fires on the shapes it exists to catch', () => {
    for (const text of [
      'await this.prisma.parentFeedback.findMany();',
      'select body from chat.parent_feedback',
      'const f: ParentFeedback = row;',
    ]) {
      expect(offenders([{ rel: 'lessons/teacher-today.service.ts', text }])).toHaveLength(1);
    }
    expect(offenders([{ rel: 'teacher-file/parent-feedback.service.ts', text: 'this.prisma.parentFeedback' }])).toEqual([]);
  });
});
