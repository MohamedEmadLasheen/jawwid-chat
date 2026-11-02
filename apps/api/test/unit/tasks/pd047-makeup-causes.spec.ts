/**
 * PD-47 PR-6c: makeup_owed reads THE rule for "a lesson owes a make-up"
 * (chat.lesson_owes_makeup, which LessonService.owedMakeups calls too), for
 * the causes chat.work_task_makeup_causes() names. It is a supervisor task, so
 * those are the supervisor follow-up's: LessonService's TEACHER_MAKEUP_CAUSES,
 * written once more in SQL. This holds the two to one list (department head,
 * 2026-10-29: never re-implement the rule; a family's apology is never escalated).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TEACHER_MAKEUP_CAUSES } from '../../../src/lessons/lesson.service';

const REPO = join(__dirname, '..', '..', '..', '..', '..');
const DEFINITION = 'create or replace function chat.work_task_makeup_causes()';
/** The migration that defines the function LAST is the one the database runs (TEACHER-008 redefined it). */
function latestDefinition(): string {
  const dir = join(REPO, 'supabase/migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const sql = files.map((f) => readFileSync(join(dir, f), 'utf8')).filter((s) => s.includes(DEFINITION)).pop() ?? '';
  return sql.slice(sql.indexOf(DEFINITION));
}

describe('PD-47 PR-6c: the causes a make-up task owes', () => {
  it('are exactly LessonService.TEACHER_MAKEUP_CAUSES', () => {
    const body = latestDefinition();
    const list = /array\[([^\]]*)\]::text\[\]/.exec(body)?.[1] ?? '';
    const causes = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(causes).toEqual([...TEACHER_MAKEUP_CAUSES]);
  });

  it('owedMakeups reads the shared rule rather than its own copy', () => {
    const src = readFileSync(join(REPO, 'apps/api/src/lessons/lesson.service.ts'), 'utf8');
    const owed = src.slice(src.indexOf('async owedMakeups('), src.indexOf('async ticketsFor('));
    expect(owed).toContain('chat.lesson_owes_makeup(l.id');
    expect(owed).not.toContain('makeup_followup');
  });
});
