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
-- Also: the signal now carries who did the change and, for a hand-on, whom it
-- left and reached (chat.work_task_signal_with; work_task_raise and
-- work_task_reroute redefined to pass them), and a renewal with no Sales owner
-- or manager reaches the super admin.
--
-- Idempotent (G-19): the table is created if absent; functions are replaced;
-- each template inserts once.
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

-- ===========================================================================
-- The signal names who did the change, and whom a hand-on left and reached,
-- as of the change (OutboxWorker.deliverTask reads it from the payload, never
-- from the task's newest event, which may be a later one).
-- ===========================================================================

create or replace function chat.work_task_signal_with(p_task uuid, p_revision integer, p_change text, p_extra jsonb)
returns void
language sql
set search_path = chat, pg_temp
as $$
  insert into chat.outbox_event (type, payload)
  values ('task.changed', jsonb_strip_nulls(jsonb_build_object('taskId', p_task, 'revision', p_revision, 'change', p_change)
                                             || coalesce(p_extra, '{}'::jsonb)));
$$;

-- The organization's live super admin: the last one to reach (a renewal with
-- no Sales owner or manager).
create or replace function chat.work_task_super_admin(p_org uuid)
returns uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select s.id from chat.staff s
   where s.organization_id = p_org and s.role = 'super_admin' and s.is_active and s.left_at is null
   order by s.id
   limit 1;
$$;

create or replace function chat.work_task_raise(
  p_org uuid, p_source_type text, p_source_id uuid, p_staff uuid, p_teacher uuid,
  p_priority text, p_category text, p_floor_rule text, p_due_at timestamptz)
returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_saved text[] := chat.work_task_begin_system(null);
  v_id    uuid;
  v_rev   integer;
begin
  insert into chat.work_task (organization_id, kind, source_type, source_id, source_key, source_state,
                              assignee_staff_id, assignee_teacher_id, priority, category, floor_rule, due_at)
  values (p_org, 'system', p_source_type, p_source_id, p_source_type || ':' || p_source_id, 'pending',
          p_staff, p_teacher, p_priority, p_category, p_floor_rule, p_due_at)
  on conflict (organization_id, source_key) do nothing
  returning id, revision into v_id, v_rev;
  if v_id is not null then
    -- PR-4: whom it reached, as of now (the worker tells them only if it still is).
    perform chat.work_task_signal_with(v_id, v_rev, 'created',
      jsonb_build_object('actorId', null, 'toAssignee', coalesce(p_staff, p_teacher)));
    delete from chat.work_task_source_issue where organization_id = p_org and source_key = p_source_type || ':' || p_source_id;
  end if;
  perform chat.work_task_end_system(v_saved);
  return v_id;
end;
$$;

create or replace function chat.work_task_reroute(p_org uuid, p_key text, p_staff uuid, p_teacher uuid, p_actor uuid)
returns integer
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_saved text[] := chat.work_task_begin_system(p_actor);
  v_n     integer := 0;
  r record;
begin
  for r in
    with was as (
      select t.id, coalesce(t.assignee_staff_id, t.assignee_teacher_id) as prev
        from chat.work_task t
       where t.organization_id = p_org and t.source_key = p_key and t.state in ('open', 'awaiting_decision')
         and (t.assignee_staff_id, t.assignee_teacher_id) is distinct from (p_staff, p_teacher)
       for update
    )
    update chat.work_task t set assignee_staff_id = p_staff, assignee_teacher_id = p_teacher, state = 'open'
      from was
     where t.id = was.id
     returning t.id, t.revision, was.prev
  loop
    -- PR-4: whom it left and reached, as of this change.
    perform chat.work_task_signal_with(r.id, r.revision, 'reassigned',
      jsonb_build_object('actorId', p_actor, 'fromAssignee', r.prev, 'toAssignee', coalesce(p_staff, p_teacher)));
    v_n := v_n + 1;
  end loop;
  delete from chat.work_task_source_issue where organization_id = p_org and source_key = p_key;
  perform chat.work_task_end_system(v_saved);
  return v_n;
end;
$$;

-- A renewal always reaches someone (Q-F6 removed the push to every Sales member).
create or replace function chat.work_task_raise_renewal(p_episode uuid)
returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  e       chat.work_task_package_episode;
  v_at    timestamptz;
  v_owner uuid;
begin
  select * into e from chat.work_task_package_episode where id = p_episode and source_type = 'renewal_request';
  if e.id is null or chat.work_task_newest_package(e.learner_id) is distinct from e.subscription_id then
    return null;
  end if;
  -- The latest request still waiting: no live package entered after it.
  select max(q.requested_at) into v_at from chat.renewal_request q
   where q.learner_id = e.learner_id and q.requested_at >= chat.work_task_since('renewal_request')
     and not exists (select 1 from chat.learner_subscription s
                      where s.learner_id = q.learner_id and s.voided_at is null and s.created_at > q.requested_at);
  if v_at is null then
    return null; -- nothing asked for, or already renewed
  end if;
  -- PR-4: the family's Sales owner, else the Sales manager, else the super admin
  -- -- the renewal push to every Sales member is gone (Q-F6), so a renewal
  -- must always reach someone.
  v_owner := coalesce(chat.work_task_sales_owner(e.family_id), chat.work_task_super_admin(e.organization_id));
  if v_owner is null then
    perform chat.work_task_note_issue(e.organization_id, 'renewal_request:' || e.id, 'no live Sales owner, Sales manager or super admin');
    return null;
  end if;
  return chat.work_task_raise(e.organization_id, 'renewal_request', e.id, v_owner, null, 'high', 'financial', 'none',
                              v_at + interval '24 hours');
end;
$$;

create or replace function chat.work_task_financial_owner(p_type text, p_source uuid)
returns uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select case p_type
    when 'instalment' then (select chat.work_task_billing_owner(i.family_id, i.learner_id)
                              from chat.family_instalment i where i.id = p_source)
    when 'package_low' then (select chat.work_task_sales_owner(e.family_id) from chat.work_task_package_episode e where e.id = p_source)
    when 'renewal_request' then (select coalesce(chat.work_task_sales_owner(e.family_id), chat.work_task_super_admin(e.organization_id))
                                   from chat.work_task_package_episode e where e.id = p_source)
    when 'receipt_review' then (select chat.work_task_billing_owner(r.family_id,
                                         (select i.learner_id from chat.payment_request q join chat.family_instalment i on i.id = q.instalment_id
                                           where q.id = r.request_id))
                                  from chat.payment_receipt r where r.id = p_source)
    when 'checkout_failed' then (select chat.work_task_billing_owner(q.family_id,
                                          coalesce(q.learner_id, (select i.learner_id from chat.family_instalment i where i.id = q.instalment_id)))
                                   from chat.payment_request q where q.id = p_source)
  end;
$$;

revoke all on function chat.work_task_signal_with(uuid, integer, text, jsonb) from public;
revoke all on function chat.work_task_super_admin(uuid) from public;
revoke all on function chat.work_task_raise(uuid, text, uuid, uuid, uuid, text, text, text, timestamptz) from public;
revoke all on function chat.work_task_reroute(uuid, text, uuid, uuid, uuid) from public;
revoke all on function chat.work_task_raise_renewal(uuid) from public;
revoke all on function chat.work_task_financial_owner(text, uuid) from public;

-- ===========================================================================
-- The texts
-- ===========================================================================

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
