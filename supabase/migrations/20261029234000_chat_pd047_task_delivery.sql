-- PD-47 (2026-10-29), PR-4 -- tasks reach the people they are for. Slot 20261029234000.
--
-- Plan: docs/product/pd047-tasks-plan.md §3.10-§3.11.
--
-- task.changed was enqueued since PR-1 and delivered to no one (no
-- conversationId). The outbox worker now routes it (OutboxWorker.deliverTask):
-- a signal to every list that changed, ids only, and a PD-34 'task' entry to
-- the one who must act. These are its texts:
--
--   task_*        the push: generic. Never the task's title, an amount, a card,
--                 a family or a child -- a lock screen is not behind sign-in.
--   inbox.task_*  the Notification Center entry, behind sign-in; still
--                 generic -- the task itself is read in Tasks, which re-checks
--                 who may see it.
--
-- chat.work_task_overdue_notice: a task announced overdue, once per due date
-- (PD-35 B5's chat.supervision_case_due_notice pattern). A task re-dated and
-- overdue again is announced again.
--
-- Idempotent (G-19): the table is created if absent; each template inserts once.
-- FAIL CLOSED: RLS on, no grants -- only the worker's sweep writes it.

create table if not exists chat.work_task_overdue_notice (
  task_id      uuid not null references chat.work_task (id),
  due_at       timestamptz not null,
  announced_at timestamptz not null default now(),
  primary key (task_id, due_at)
);

comment on table chat.work_task_overdue_notice is
  'PD-47 PR-4: a task announced overdue to its assignee, once per due date (TaskService.sweepOverdue).';

alter table chat.work_task_overdue_notice enable row level security;
revoke all on chat.work_task_overdue_notice from public, anon, authenticated, chat_app;

insert into chat.notification_template (key, locale, title, body)
select v.key, v.locale, v.title, v.body
  from (values
    ('task_assigned', 'en', 'Jawwid', 'A task was given to you.'),
    ('task_assigned', 'ar', 'جَوِّد', 'أُسندت إليك مهمة.'),
    ('task_returned', 'en', 'Jawwid', 'A task came back to you with instructions.'),
    ('task_returned', 'ar', 'جَوِّد', 'أُعيدت إليك مهمة بتعليمات.'),
    ('task_out_of_scope', 'en', 'Jawwid', 'A task is waiting for your decision.'),
    ('task_out_of_scope', 'ar', 'جَوِّد', 'مهمة تنتظر قرارك.'),
    ('task_overdue', 'en', 'Jawwid', 'One of your tasks is overdue.'),
    ('task_overdue', 'ar', 'جَوِّد', 'إحدى مهامك متأخرة.'),
    ('inbox.task_assigned', 'en', 'New task', 'A task was given to you. Open it in Tasks.'),
    ('inbox.task_assigned', 'ar', 'مهمة جديدة', 'أُسندت إليك مهمة. افتحها في المهام.'),
    ('inbox.task_returned', 'en', 'Task returned to you', 'A task came back to you with instructions. Open it in Tasks.'),
    ('inbox.task_returned', 'ar', 'أُعيدت إليك مهمة', 'أُعيدت إليك مهمة بتعليمات. افتحها في المهام.'),
    ('inbox.task_out_of_scope', 'en', 'A decision is waiting', 'Someone said a task is not theirs. Decide in Tasks.'),
    ('inbox.task_out_of_scope', 'ar', 'قرار بانتظارك', 'قيل إن مهمة ليست من مسؤولية صاحبها. قرّر في المهام.'),
    ('inbox.task_overdue', 'en', 'Task overdue', 'One of your tasks is overdue. Open it in Tasks.'),
    ('inbox.task_overdue', 'ar', 'مهمة متأخرة', 'إحدى مهامك متأخرة. افتحها في المهام.')
  ) as v(key, locale, title, body)
 where not exists (select 1 from chat.notification_template t where t.key = v.key and t.locale = v.locale);
