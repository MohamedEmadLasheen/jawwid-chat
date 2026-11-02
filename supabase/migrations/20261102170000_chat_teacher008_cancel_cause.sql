-- TEACHER-008 (QA 2026-10-31; design approved by the department head) -- a
-- lesson the academy cancels BECAUSE OF THE TEACHER owes the family a make-up.
--
-- Approved leave, a suspension and the teacher leaving cancel the teacher's
-- open lessons through the academy's own cancellation (outcome
-- 'admin_cancelled'), which owes nothing: the family silently lost a paid
-- lesson. The cancellation now carries WHY:
--
--   cancel_cause   teacher_leave | teacher_suspended | teacher_deactivated,
--                  written only by those three callers (never from a request
--                  body), and only on an admin_cancelled lesson; a manual
--                  administrator's cancellation keeps it null and stays
--                  make-up-free
--   'teacher_cancelled'   a make-up CAUSE token: chat.lesson_owes_makeup counts
--                  an admin_cancelled lesson with a cause when the caller's
--                  causes include it. The API's MAKEUP_CAUSES and
--                  TEACHER_MAKEUP_CAUSES carry it, and so does
--                  chat.work_task_makeup_causes(), so PD-47's makeup_owed task
--                  follows the one rule (never re-implemented).
--
-- No backfill: earlier cancellations carry no cause (owner rule: no data
-- backfill without the owner).

alter table chat.lesson
  add column if not exists cancel_cause text;

alter table chat.lesson drop constraint if exists lesson_cancel_cause;
alter table chat.lesson add constraint lesson_cancel_cause check (
  cancel_cause is null
  -- coalesce: a NULL outcome must fail the check, not pass it as unknown.
  or (cancel_cause in ('teacher_leave', 'teacher_suspended', 'teacher_deactivated') and coalesce(outcome, '') = 'admin_cancelled')
);

comment on column chat.lesson.cancel_cause is
  'TEACHER-008: why the academy cancelled a lesson, when the teacher is the reason (leave, suspension, leaving). Such a lesson owes a make-up (the teacher_cancelled cause token).';

create or replace function chat.lesson_owes_makeup(p_lesson uuid, p_causes text[])
returns boolean
language sql
stable
set search_path = chat, pg_temp
as $$
  select coalesce((
    select l.kind <> 'trial'
           and (l.outcome = any (p_causes)
                or ('teacher_cancelled' = any (p_causes) and l.outcome = 'admin_cancelled' and l.cancel_cause is not null))
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
  select array['teacher_apology', 'teacher_no_show', 'teacher_cancelled']::text[];
$$;
revoke all on function chat.work_task_makeup_causes() from public;
