/**
 * PD-47 PR-6c: makeup_owed reads THE rule for "a lesson owes a make-up"
 * (chat.lesson_owes_makeup, which LessonService.owedMakeups calls too), for
 * the causes chat.work_task_makeup_causes() names. Those causes are
 * LessonService's MAKEUP_CAUSES, written once more in SQL: this holds the two
 * to one list (department head, 2026-10-29: never re-implement the rule).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAKEUP_CAUSES } from '../../../src/lessons/lesson.service';

const REPO = join(__dirname, '..', '..', '..', '..', '..');
const MIGRATION = 'supabase/migrations/20261030000000_chat_pd047_phase_b_decisions.sql';

describe('PD-47 PR-6c: the causes a make-up task owes', () => {
  it('are exactly LessonService.MAKEUP_CAUSES', () => {
    const sql = readFileSync(join(REPO, MIGRATION), 'utf8');
    const body = sql.slice(sql.indexOf('create or replace function chat.work_task_makeup_causes()'));
    const list = /array\[([^\]]*)\]::text\[\]/.exec(body)?.[1] ?? '';
    const causes = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(causes).toEqual([...MAKEUP_CAUSES]);
  });

  it('owedMakeups reads the shared rule rather than its own copy', () => {
    const src = readFileSync(join(REPO, 'apps/api/src/lessons/lesson.service.ts'), 'utf8');
    const owed = src.slice(src.indexOf('async owedMakeups('), src.indexOf('async ticketsFor('));
    expect(owed).toContain('chat.lesson_owes_makeup(l.id');
    expect(owed).not.toContain('makeup_followup');
  });
});
