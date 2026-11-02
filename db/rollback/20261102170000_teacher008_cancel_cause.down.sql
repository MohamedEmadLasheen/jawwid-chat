-- Roll back 20261102170000_chat_teacher008_cancel_cause (TEACHER-008: a lesson
-- cancelled because of the teacher owes a make-up).
--
-- Restores chat.lesson_owes_makeup and chat.work_task_makeup_causes() to their
-- definitions of 20261030000000 (PD-47 phase B) FIRST -- the current ones read
-- cancel_cause -- then drops the CHECK and the column. Lessons cancelled for
-- the teacher in the meantime stop owing a make-up; a makeup_owed task already
-- raised for one is left to the PD-47 sweep. Roll back the API release with
-- it: LessonService writes cancel_cause and lists 'teacher_cancelled'.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261102170000_teacher008_cancel_cause.down.sql

create or replace function chat.lesson_owes_makeup(p_lesson uuid, p_causes text[])
returns boolean
language sql
stable
set search_path = chat, pg_temp
as $$
  select coalesce((
    select l.kind <> 'trial'
           and l.outcome = any (p_causes)
           and not exists (
             select 1 from chat.lesson m
              where m.makeup_for = l.id and m.kind = 'makeup'
                and (m.outcome is null or m.outcome not in ('teacher_apology', 'teacher_no_show', 'admin_cancelled', 'rescheduled', 'voided')))
           and not exists (select 1 from chat.lesson_ruling r where r.lesson_id = l.id and r.kind = 'makeup_followup')
      from chat.lesson l
     where l.id = p_lesson), false);
$$;
revoke all on function chat.lesson_owes_makeup(uuid, text[]) from public;

create or replace function chat.work_task_makeup_causes()
returns text[]
language sql
immutable
set search_path = chat, pg_temp
as $$
  select array['teacher_apology', 'teacher_no_show']::text[];
$$;
revoke all on function chat.work_task_makeup_causes() from public;

alter table chat.lesson drop constraint if exists lesson_cancel_cause;
alter table chat.lesson drop column if exists cancel_cause;

-- The ledger forgets it, so scripts/db/apply.sh applies it again on the way forward.
delete from chat.schema_migrations where version = '20261102170000_chat_teacher008_cancel_cause';
