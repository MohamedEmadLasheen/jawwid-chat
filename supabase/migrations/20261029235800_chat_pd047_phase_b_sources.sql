-- PD-47 (2026-10-29), PR-6a -- set-up tasks from their sources (Phase B). Slot 20261029235800.
--
-- Plan: docs/product/pd047-tasks-plan.md §3.6 (Phase B decisions, department
-- head 2026-10-29). Builds on 20261029210000 (PR-2: the helpers, the issue
-- log, the cut-offs), 20261029233000 (PR-2b: the guard, redefined here) and
-- 20261029234000 (PR-4: delivery -- these tasks are announced with the
-- generic task_assigned, whose rule row exists; no new rule key).
--
--   source_type          key                              assignee                          due
--   family_unsupervised  family_unsupervised:<family>     the Operations manager, else      the first waiting child
--                                                         the super admin                   + 48 h
--   teacher_setup        teacher_setup:<teacher>          the teacher's owner (PR-2)        created + 7 days
--   new_student_assign   new_student_assign:<trial>       the Operations manager, else      recorded + 24 h
--                                                         the super admin
--   new_student_group    new_student_group:<enrolment>    the children's live supervisor,   entered + 24 h
--                                                         else as new_student_assign
--
--   All four: operational, medium, the generic floor; reassignable by hand.
--
--   family_unsupervised  a family with a child no Operations supervisor holds
--                        (no chat.learner_supervision row; the New Students
--                        page's "waiting" families). Done when every child has
--                        one, by who placed the last (an academy import names
--                        nobody: the system). Withdrawn when the family has no
--                        children left. One task per family: a child added to
--                        it later, unsupervised, shows on the page only.
--   teacher_setup        an active teacher whose chat.teacher_setup_state has
--                        an item not done (PD-43's checklist: one task, the
--                        list inside it). Done when every item is: many people
--                        fill them in over days, so nobody is named -- the
--                        system. Withdrawn when the teacher leaves; back if
--                        reactivated with the set-up still unfinished.
--   new_student_assign   a subscribed trial's form (chat.trial_subscription)
--                        not yet assigned. Done when its enrolment exists, by
--                        who assigned it. Withdrawn when the outcome is
--                        corrected away (withdrawn_at); back if corrected back.
--   new_student_group    a new family's enrolment without its family group.
--                        Done when the group is opened or joined, by who did it.
--
--   RAISED by chat.work_task_sweep_setup() (the worker, every minute, its own
--   advisory lock and batches, as PR-2b's): each is a state that settles in
--   the same request that creates it as often as not (a family entered with
--   its supervisor, an enrolment that joins an existing group), so a raise at
--   once would announce a task already done. COMPLETED at once by triggers on
--   chat.learner_supervision, chat.student_enrolment and
--   chat.trial_subscription (one function per table), never blocking the
--   source's write; the sweep re-reads the evidence as a safety net.
--
--   Cut-offs (owner 2026-10-29, the last 14 days at switch-on): a child by
--   when it was created, a teacher by when they were added, a form by when it
--   was recorded, an enrolment by when it was entered.
--
--   Never in a task's text sent anywhere: the form's parent, phone or
--   children (CONFINED). The task names its source by id; Tasks reads the
--   prospect's display name behind sign-in.
--
-- FAIL CLOSED: RLS and revoked grants as PR-1/PR-2. Every function pins its
-- search_path.

-- ===========================================================================
-- 1. Who, and what the source says now
-- ===========================================================================

-- The live Operations manager, else the live super admin.
create or replace function chat.work_task_operations_manager(p_org uuid)
returns uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select coalesce(
    (select s.id
       from chat.department d
       join chat.staff s on s.id = d.manager_id and s.is_active and s.left_at is null
      where d.organization_id = p_org and d.kind = 'operations'
      order by d.id
      limit 1),
    chat.work_task_super_admin(p_org));
$$;

-- Who opens a new family's group: its children's live supervisor (the first
-- child's, as EnrolmentService.createGroup reads it), else as an assignment.
create or replace function chat.work_task_group_owner(p_enrolment uuid)
returns uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select coalesce(
    (select ls.supervisor_id
       from chat.student_enrolment e
       join chat.learner l on l.id = any (e.learner_ids)
       join chat.learner_supervision ls on ls.learner_id = l.id
       join chat.staff s on s.id = ls.supervisor_id and s.is_active and s.left_at is null
      where e.id = p_enrolment
      order by l.created_at, l.id
      limit 1),
    chat.work_task_operations_manager((select e.organization_id from chat.student_enrolment e where e.id = p_enrolment)));
$$;

-- Since when a family has waited for an Operations supervisor (its oldest
-- child without one), or null when none waits.
create or replace function chat.work_task_family_waiting_since(p_family uuid)
returns timestamptz
language sql
stable
set search_path = chat, pg_temp
as $$
  select min(l.created_at)
    from chat.learner l
   where l.family_id = p_family
     and not exists (select 1 from chat.learner_supervision ls where ls.learner_id = l.id);
$$;

-- How many of PD-43's set-up items a teacher still lacks.
create or replace function chat.work_task_setup_missing(p_teacher uuid)
returns integer
language sql
stable
set search_path = chat, pg_temp
as $$
  select count(*)::int from jsonb_each(chat.teacher_setup_state(p_teacher)) e where e.value = 'false'::jsonb;
$$;

-- What a source says of its work now: 'done' (with who did it, or nobody),
-- 'gone' (the work no longer exists), or 'back' (it is still owed).
create or replace function chat.work_task_setup_verdict(p_type text, p_source uuid, out verdict text, out actor uuid)
language plpgsql
stable
set search_path = chat, pg_temp
as $$
declare
  v_org uuid;
begin
  if p_type = 'family_unsupervised' then
    if not exists (select 1 from chat.learner l where l.family_id = p_source) then
      verdict := 'gone';
    elsif chat.work_task_family_waiting_since(p_source) is null then
      verdict := 'done';
      select ls.assigned_by into actor
        from chat.learner l join chat.learner_supervision ls on ls.learner_id = l.id
       where l.family_id = p_source
       order by ls.assigned_at desc, l.id
       limit 1;
    else
      verdict := 'back';
    end if;
  elsif p_type = 'teacher_setup' then
    select t.organization_id into v_org from chat.teacher t where t.id = p_source;
    if v_org is null or chat.task_principal_kind(p_source, v_org) is distinct from 'teacher' then
      verdict := 'gone';
    elsif chat.work_task_setup_missing(p_source) = 0 then
      verdict := 'done';
    else
      verdict := 'back';
    end if;
  elsif p_type = 'new_student_assign' then
    select e.assigned_by into actor from chat.student_enrolment e where e.lesson_id = p_source;
    if actor is not null then
      verdict := 'done';
    elsif exists (select 1 from chat.trial_subscription q where q.lesson_id = p_source and q.withdrawn_at is null) then
      verdict := 'back';
    else
      verdict := 'gone';
    end if;
  elsif p_type = 'new_student_group' then
    select e.group_created_by into actor from chat.student_enrolment e where e.id = p_source;
    if actor is not null then
      verdict := 'done';
    elsif exists (select 1 from chat.student_enrolment e where e.id = p_source) then
      verdict := 'back';
    else
      verdict := 'gone';
    end if;
  end if;
end;
$$;

-- ===========================================================================
-- 2. The sources: one raise function each
-- ===========================================================================

create or replace function chat.work_task_raise_family_unsupervised(p_family uuid)
returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  f       chat.family;
  v_since timestamptz;
  v_owner uuid;
begin
  select * into f from chat.family where id = p_family;
  v_since := chat.work_task_family_waiting_since(p_family);
  -- A family waiting only since before the cut-off stays on its page.
  if f.id is null or v_since is null
     or not exists (select 1 from chat.learner l
                     where l.family_id = f.id and l.created_at >= chat.work_task_since('family_unsupervised')
                       and not exists (select 1 from chat.learner_supervision ls where ls.learner_id = l.id)) then
    return null;
  end if;
  v_owner := chat.work_task_operations_manager(f.organization_id);
  if v_owner is null then
    perform chat.work_task_note_issue(f.organization_id, 'family_unsupervised:' || f.id, 'no live Operations manager or super admin');
    return null;
  end if;
  return chat.work_task_raise(f.organization_id, 'family_unsupervised', f.id, v_owner, null,
                              'medium', 'operational', 'generic', v_since + interval '48 hours');
end;
$$;

create or replace function chat.work_task_raise_teacher_setup(p_teacher uuid)
returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  t       chat.teacher;
  v_owner uuid;
begin
  select * into t from chat.teacher where id = p_teacher;
  if t.id is null or not t.is_active or t.left_at is not null
     or t.created_at < chat.work_task_since('teacher_setup') or chat.work_task_setup_missing(t.id) = 0 then
    return null;
  end if;
  v_owner := chat.work_task_teacher_owner(t.id);
  if v_owner is null then
    perform chat.work_task_note_issue(t.organization_id, 'teacher_setup:' || t.id, 'no live supervisor or Teachers manager for the teacher');
    return null;
  end if;
  return chat.work_task_raise(t.organization_id, 'teacher_setup', t.id, v_owner, null,
                              'medium', 'operational', 'generic', t.created_at + interval '7 days');
end;
$$;

-- Keyed by the trial (the form's own key). The form's contents never leave it.
create or replace function chat.work_task_raise_new_student_assign(p_trial uuid)
returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_org   uuid;
  v_at    timestamptz;
  v_owner uuid;
begin
  select q.organization_id, q.recorded_at into v_org, v_at
    from chat.trial_subscription q
   where q.lesson_id = p_trial and q.withdrawn_at is null;
  if v_org is null or v_at < chat.work_task_since('new_student_assign')
     or exists (select 1 from chat.student_enrolment e where e.lesson_id = p_trial) then
    return null;
  end if;
  v_owner := chat.work_task_operations_manager(v_org);
  if v_owner is null then
    perform chat.work_task_note_issue(v_org, 'new_student_assign:' || p_trial, 'no live Operations manager or super admin');
    return null;
  end if;
  return chat.work_task_raise(v_org, 'new_student_assign', p_trial, v_owner, null,
                              'medium', 'operational', 'generic', v_at + interval '24 hours');
end;
$$;

create or replace function chat.work_task_raise_new_student_group(p_enrolment uuid)
returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  e       chat.student_enrolment;
  v_owner uuid;
begin
  select * into e from chat.student_enrolment where id = p_enrolment;
  if e.id is null or e.kind <> 'new_family' or e.group_conversation_id is not null
     or e.assigned_at < chat.work_task_since('new_student_group') then
    return null;
  end if;
  v_owner := chat.work_task_group_owner(e.id);
  if v_owner is null then
    perform chat.work_task_note_issue(e.organization_id, 'new_student_group:' || e.id, 'no live supervisor, Operations manager or super admin');
    return null;
  end if;
  return chat.work_task_raise(e.organization_id, 'new_student_group', e.id, v_owner, null,
                              'medium', 'operational', 'generic', e.assigned_at + interval '24 hours');
end;
$$;

-- ===========================================================================
-- 3. The sweep: create what is missing, reconcile what is done
-- ===========================================================================

-- As chat.work_task_sweep_financial: at most p_batch (capped at 60) rows per
-- call, each its own subtransaction; `more` says another batch is waiting;
-- one sweep at a time (an advisory lock). Returns the counts.
create or replace function chat.work_task_sweep_setup(p_batch integer default 50)
returns jsonb
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_left      integer := least(greatest(coalesce(p_batch, 50), 1), 60);
  v_raised    integer := 0;
  v_settled   integer := 0;
  v_withdrawn integer := 0;
  v_restored  integer := 0;
  v_failed    integer := 0;
  v_declined  integer := 0;
  v_more      boolean := false;
  r           record;
  s_family    timestamptz;
  s_setup     timestamptz;
  s_assign    timestamptz;
  s_group     timestamptz;
begin
  if not pg_try_advisory_xact_lock(hashtext('chat.work_task_sweep_setup')) then
    return jsonb_build_object('skipped', true);
  end if;
  s_family := chat.work_task_since('family_unsupervised');
  s_setup := chat.work_task_since('teacher_setup');
  s_assign := chat.work_task_since('new_student_assign');
  s_group := chat.work_task_since('new_student_group');

  -- The issue log shrinks with these sources too: an occurrence whose task
  -- closed, or whose work is done or gone. Only these sources' keys.
  delete from chat.work_task_source_issue i
   where split_part(i.source_key, ':', 1) in ('family_unsupervised', 'teacher_setup', 'new_student_assign', 'new_student_group')
     and (exists (select 1 from chat.work_task t
                   where t.organization_id = i.organization_id and t.source_key = i.source_key
                     and t.state in ('completed', 'removed'))
          or (select v.verdict from chat.work_task_setup_verdict(split_part(i.source_key, ':', 1),
                                                                  split_part(i.source_key, ':', 2)::uuid) v)
             is distinct from 'back');

  -- Create.
  for r in
    select x.org, x.src, x.id, x.src || ':' || x.id as key from (
      select f.organization_id as org, 'family_unsupervised' as src, f.id, min(l.created_at) as at
        from chat.learner l join chat.family f on f.id = l.family_id
       where l.created_at >= s_family
         and not exists (select 1 from chat.learner_supervision ls where ls.learner_id = l.id)
       group by f.organization_id, f.id
      union all
      select t.organization_id, 'teacher_setup', t.id, t.created_at
        from chat.teacher t
       where t.is_active and t.left_at is null and t.created_at >= s_setup
         and not exists (select 1 from chat.work_task w where w.organization_id = t.organization_id and w.source_key = 'teacher_setup:' || t.id)
         and chat.work_task_setup_missing(t.id) > 0
      union all
      select q.organization_id, 'new_student_assign', q.lesson_id, q.recorded_at
        from chat.trial_subscription q
       where q.withdrawn_at is null and q.recorded_at >= s_assign
         and not exists (select 1 from chat.student_enrolment e where e.lesson_id = q.lesson_id)
      union all
      select e.organization_id, 'new_student_group', e.id, e.assigned_at
        from chat.student_enrolment e
       where e.kind = 'new_family' and e.group_conversation_id is null and e.assigned_at >= s_group
    ) x
     where not exists (select 1 from chat.work_task t where t.organization_id = x.org and t.source_key = x.src || ':' || x.id)
       and not exists (select 1 from chat.work_task_source_issue i
                        where i.organization_id = x.org and i.source_key = x.src || ':' || x.id and i.next_try_at > now())
     order by x.at
     limit v_left + 1
  loop
    if v_left = 0 then v_more := true; exit; end if;
    v_left := v_left - 1;
    begin
      if (case r.src
            when 'family_unsupervised' then chat.work_task_raise_family_unsupervised(r.id)
            when 'teacher_setup' then chat.work_task_raise_teacher_setup(r.id)
            when 'new_student_assign' then chat.work_task_raise_new_student_assign(r.id)
            when 'new_student_group' then chat.work_task_raise_new_student_group(r.id)
          end) is not null then
        v_raised := v_raised + 1;
      else
        v_declined := v_declined + 1;
        if not exists (select 1 from chat.work_task_source_issue i
                        where i.organization_id = r.org and i.source_key = r.key and i.next_try_at > now()) then
          perform chat.work_task_note_issue(r.org, r.key, 'not raised: its source declined it (see its raise rule)');
        end if;
      end if;
    exception when others then
      v_failed := v_failed + 1;
      perform chat.work_task_note_issue(r.org, r.key, sqlerrm);
    end;
  end loop;

  -- Reconcile: the evidence re-read now. A withdrawn task may come back, or
  -- be done.
  for r in
    select y.* from (
      select t.organization_id as org, t.source_key as key, t.source_state, v.verdict, v.actor
        from chat.work_task t
        cross join lateral chat.work_task_setup_verdict(t.source_type, t.source_id) v
       where t.kind = 'system' and t.state in ('open', 'awaiting_decision')
         and t.source_type in ('family_unsupervised', 'teacher_setup', 'new_student_assign', 'new_student_group')
    ) y
     where y.source_state = 'pending' and y.verdict in ('done', 'gone')
        or y.source_state = 'withdrawn' and y.verdict in ('back', 'done')
     limit v_left + 1
  loop
    if v_left = 0 then v_more := true; exit; end if;
    v_left := v_left - 1;
    begin
      if r.verdict = 'done' then
        v_settled := v_settled + chat.work_task_settle(r.org, r.key, r.actor);
      elsif r.verdict = 'gone' then
        v_withdrawn := v_withdrawn + chat.work_task_withdraw(r.org, r.key);
      else
        v_restored := v_restored + chat.work_task_restore(r.org, r.key);
      end if;
    exception when others then
      v_failed := v_failed + 1;
      perform chat.work_task_note_issue(r.org, r.key, sqlerrm);
    end;
  end loop;

  return jsonb_build_object('skipped', false, 'raised', v_raised, 'settled', v_settled, 'withdrawn', v_withdrawn,
                            'restored', v_restored, 'failed', v_failed, 'declined', v_declined, 'more', v_more,
                            'issues', (select count(*) from chat.work_task_source_issue));
end;
$$;

-- ===========================================================================
-- 4. The source triggers: in the source's own transaction, never blocking it
-- ===========================================================================

-- A child placed on a supervisor: the family's task is done once none waits,
-- by who placed them.
create or replace function chat.work_task_from_learner_supervision()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_family uuid;
  v_org    uuid;
begin
  select l.family_id, l.organization_id into v_family, v_org from chat.learner l where l.id = new.learner_id;
  if v_family is null then
    return null;
  end if;
  begin
    if chat.work_task_family_waiting_since(v_family) is null then
      perform chat.work_task_settle(v_org, 'family_unsupervised:' || v_family, new.assigned_by);
    end if;
  exception when others then
    perform chat.work_task_note_issue(v_org, 'family_unsupervised:' || v_family, sqlerrm);
  end;
  return null;
end;
$$;

create trigger learner_supervision_settles_its_task after insert or update of supervisor_id on chat.learner_supervision
  for each row execute function chat.work_task_from_learner_supervision();

-- A form assigned (its enrolment entered), or a new family's group opened.
create or replace function chat.work_task_from_student_enrolment()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if tg_op = 'INSERT' and new.lesson_id is not null then
    begin
      perform chat.work_task_settle(new.organization_id, 'new_student_assign:' || new.lesson_id, new.assigned_by);
    exception when others then
      perform chat.work_task_note_issue(new.organization_id, 'new_student_assign:' || new.lesson_id, sqlerrm);
    end;
  end if;
  if new.group_conversation_id is not null
     and (tg_op = 'INSERT' or old.group_conversation_id is null) then
    begin
      perform chat.work_task_settle(new.organization_id, 'new_student_group:' || new.id, new.group_created_by);
    exception when others then
      perform chat.work_task_note_issue(new.organization_id, 'new_student_group:' || new.id, sqlerrm);
    end;
  end if;
  return null;
end;
$$;

create trigger student_enrolment_settles_its_tasks after insert or update of group_conversation_id on chat.student_enrolment
  for each row execute function chat.work_task_from_student_enrolment();

-- A form's outcome corrected away from "subscribed", or back.
create or replace function chat.work_task_from_trial_subscription()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  begin
    if old.withdrawn_at is null and new.withdrawn_at is not null then
      perform chat.work_task_withdraw(new.organization_id, 'new_student_assign:' || new.lesson_id);
    elsif old.withdrawn_at is not null and new.withdrawn_at is null then
      perform chat.work_task_restore(new.organization_id, 'new_student_assign:' || new.lesson_id);
    end if;
  exception when others then
    perform chat.work_task_note_issue(new.organization_id, 'new_student_assign:' || new.lesson_id, sqlerrm);
  end;
  return null;
end;
$$;

create trigger trial_subscription_moves_its_task after update of withdrawn_at on chat.trial_subscription
  for each row
  when (old.withdrawn_at is distinct from new.withdrawn_at)
  execute function chat.work_task_from_trial_subscription();

-- ===========================================================================
-- 5. The guard: a teacher's set-up is finished by nobody in particular, and
--    an academy import places children naming nobody -- the system may
--    complete those two, as it completes money paid online (PR-2b). Every
--    other source still names its actor. Otherwise PR-2b's guard unchanged.
-- ===========================================================================

create or replace function chat.guard_work_task()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_actor    text := nullif(current_setting('chat.task_actor', true), '');
  v_note     text := nullif(btrim(coalesce(current_setting('chat.task_note', true), '')), '');
  v_org      uuid;
  v_moved    boolean;
  v_returned boolean;
  -- PD-47 PR-2: a source's own helpers (chat.work_task_raise / _settle /
  -- _withdraw / _reroute / _redate) say so; nothing else may set it.
  v_system   boolean := coalesce(current_setting('chat.task_system', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    raise exception 'a task is never deleted; it is completed, removed or reassigned' using errcode = 'check_violation';
  end if;
  if v_actor is null and not v_system then
    raise exception 'a task changes only with its actor named (chat.task_actor)' using errcode = 'insufficient_privilege';
  end if;
  v_org := case when tg_op = 'INSERT' then new.organization_id else old.organization_id end;
  -- A person acts live. A source names who did its work, who may have left since.
  if v_actor is not null and not v_system and chat.task_principal_kind(v_actor::uuid, v_org) is null then
    raise exception 'a task is changed by a live person of its organization (chat.task_actor)' using errcode = 'insufficient_privilege';
  end if;
  if v_actor is not null and v_system and chat.task_principal_any(v_actor::uuid, v_org) is null then
    raise exception 'a source names a person of the task''s organization (chat.task_actor)' using errcode = 'insufficient_privilege';
  end if;
  if num_nonnulls(new.assignee_staff_id, new.assignee_teacher_id) <> 1 then
    raise exception 'a task is assigned to exactly one person' using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' and new.kind = 'system' then
    if not v_system or new.created_by is not null then
      raise exception 'a system task is made by its source (chat.work_task_raise)' using errcode = 'insufficient_privilege';
    end if;
    if new.state <> 'open' or new.source_state is distinct from 'pending' or new.source_floor is not null then
      raise exception 'a system task is created open and pending' using errcode = 'check_violation';
    end if;
    if chat.task_principal_kind(coalesce(new.assignee_staff_id, new.assignee_teacher_id), new.organization_id) is null then
      raise exception 'a task is assigned to a live person of its organization' using errcode = 'check_violation';
    end if;
    new.outcome := null;
    new.closed_by := null;
    new.closed_at := null;
    new.close_reason := null;
    new.instructions := null;
    new.revision := 1;
    new.created_at := now();
    new.updated_at := now();
    new.activity_at := now();
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.kind <> 'manual' then
      raise exception 'a system task is made by its source' using errcode = 'check_violation';
    end if;
    if new.created_by is null or new.created_by::text is distinct from v_actor then
      raise exception 'a manual task is created by its actor' using errcode = 'insufficient_privilege';
    end if;
    if new.state <> 'open' then
      raise exception 'a task is created open' using errcode = 'check_violation';
    end if;
    -- PD-47 priority: a manual task's urgency follows its due date (the
    -- generic floor); only a source names another rule or raises a floor.
    if new.floor_rule <> 'generic' or new.source_floor is not null then
      raise exception 'a manual task has the generic floor and no source floor' using errcode = 'check_violation';
    end if;
    if chat.task_principal_kind(coalesce(new.assignee_staff_id, new.assignee_teacher_id), new.organization_id) is null then
      raise exception 'a task is assigned to a live person of its organization' using errcode = 'check_violation';
    end if;
    new.outcome := null;
    new.closed_by := null;
    new.closed_at := null;
    new.close_reason := null;
    new.revision := 1;
    new.created_at := now();
    new.updated_at := now();
    new.activity_at := now();
    return new;
  end if;

  -- UPDATE
  -- source_state and source_floor change with the sources (PR-2, PR-2b), which
  -- record source_withdrawn and source_raised. A category and a floor rule are
  -- fixed at creation (PD-47 priority amendment §1).
  if (new.id, new.organization_id, new.kind, new.source_type, new.source_id, new.source_key,
      new.category, new.floor_rule, new.title, new.body, new.created_by, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.kind, old.source_type, old.source_id, old.source_key,
      old.category, old.floor_rule, old.title, old.body, old.created_by, old.created_at) then
    raise exception 'a task''s what, source and creator never change' using errcode = 'check_violation';
  end if;
  -- The source's state and floor are the source's alone (its helpers).
  if (new.source_state, new.source_floor) is distinct from (old.source_state, old.source_floor) then
    if not v_system then
      raise exception 'a task''s source state and floor change only with its source' using errcode = 'check_violation';
    end if;
    if new.source_state is distinct from old.source_state
       and not (old.source_state = 'pending' and new.source_state = 'withdrawn'
                or old.source_state = 'withdrawn' and new.source_state = 'pending') then
      raise exception 'a source is pending or withdrawn' using errcode = 'check_violation';
    end if;
  end if;
  if old.state in ('completed', 'removed') then
    raise exception 'a closed task stays closed' using errcode = 'check_violation';
  end if;

  v_moved := (new.assignee_staff_id, new.assignee_teacher_id) is distinct from (old.assignee_staff_id, old.assignee_teacher_id);
  v_returned := old.state = 'awaiting_decision' and new.state = 'open' and not v_moved;
  -- A lesson report and a correction are the lesson's teacher's, a case's task
  -- follows the case's owner, and a financial task the family's billing
  -- supervisor or Sales owner: only their source moves them (PR-2, PR-2b).
  -- The one exception: the super admin hands on a financial task whose
  -- assignee left with nobody live to follow (the sweep records it); the
  -- sweep moves it on to its owner once there is one again.
  if v_moved and old.kind = 'system' and not v_system
     and old.source_type in ('lesson_report', 'report_correction', 'case',
                             'instalment', 'package_low', 'renewal_request', 'receipt_review', 'checkout_failed')
     and not (old.source_type in ('instalment', 'package_low', 'renewal_request', 'receipt_review', 'checkout_failed')
              and exists (select 1 from chat.staff s
                           where s.id = v_actor::uuid and s.organization_id = old.organization_id and s.role = 'super_admin'
                             and s.is_active and s.left_at is null)
              and chat.task_principal_kind(coalesce(old.assignee_staff_id, old.assignee_teacher_id), old.organization_id) is null) then
    raise exception 'this task follows its source: change the lesson''s teacher, the case''s owner, or the family''s billing supervisor or Sales owner' using errcode = 'check_violation';
  end if;
  if v_moved and chat.task_principal_kind(coalesce(new.assignee_staff_id, new.assignee_teacher_id), old.organization_id) is null then
    raise exception 'a task is reassigned to a live person of its organization' using errcode = 'check_violation';
  end if;

  if new.state is distinct from old.state then
    -- The four exits, and nothing else.
    if not (old.state = 'open' and new.state in ('awaiting_decision', 'completed', 'removed')
            or old.state = 'awaiting_decision' and new.state in ('open', 'completed', 'removed')) then
      raise exception 'a task moves only by its four exits' using errcode = 'check_violation';
    end if;
    if new.state = 'awaiting_decision' and v_note is null then
      raise exception 'out of scope needs a comment (chat.task_note)' using errcode = 'check_violation';
    end if;
    if new.state = 'removed' and v_note is null then
      raise exception 'a removal needs a reason (chat.task_note)' using errcode = 'check_violation';
    end if;
    if v_returned and v_note is null then
      raise exception 'a return needs instructions (chat.task_note)' using errcode = 'check_violation';
    end if;
    -- A system task is completed by its work (its source's helper), or
    -- acknowledged by its assignee once its source went away (plan Q4).
    if new.state = 'completed' and old.kind = 'system' and not v_system
       and not (new.outcome = 'acknowledged' and old.source_state = 'withdrawn') then
      raise exception 'a system task is completed by doing its work' using errcode = 'check_violation';
    end if;
    -- A source names who did its work. Only money paid online (PR-2b), a
    -- teacher's finished set-up and children an academy import placed
    -- (PR-6a) are nobody's: every other source's completion without its
    -- actor fails, into the issue log, rather than closing silently as the
    -- system's.
    if new.state = 'completed' and v_system and v_actor is null
       and coalesce(old.source_type, '') not in ('instalment', 'package_low', 'renewal_request', 'receipt_review', 'checkout_failed',
                                                 'teacher_setup', 'family_unsupervised') then
      raise exception 'a source''s completion names who did its work (chat.task_actor)' using errcode = 'check_violation';
    end if;
    if new.outcome = 'acknowledged' and not (old.kind = 'system' and old.source_state = 'withdrawn') then
      raise exception 'only a task whose source went away is acknowledged' using errcode = 'check_violation';
    end if;
    if new.state in ('completed', 'removed') then
      new.closed_by := v_actor::uuid;
      new.closed_at := now();
      new.close_reason := v_note;
    end if;
  elsif (new.outcome, new.closed_by, new.closed_at, new.close_reason)
        is distinct from (old.outcome, old.closed_by, old.closed_at, old.close_reason) then
    raise exception 'a task is closed only by moving to completed or removed' using errcode = 'check_violation';
  end if;

  -- Instructions come with a return or a reassignment, which record them.
  if new.instructions is distinct from old.instructions and not (v_returned or v_moved) then
    raise exception 'instructions come with a return or a reassignment' using errcode = 'check_violation';
  end if;
  -- Every change is recorded: a move, a state, a due date, a priority -- or a
  -- comment, whose event touches the task from its own trigger (activity_at only).
  if not (v_moved or new.state is distinct from old.state or new.due_at is distinct from old.due_at
          or new.priority is distinct from old.priority
          or (new.source_state, new.source_floor) is distinct from (old.source_state, old.source_floor)) then
    if not (pg_trigger_depth() > 1 and new.activity_at is distinct from old.activity_at
            and new.instructions is not distinct from old.instructions) then
      raise exception 'a task changes only with a recorded event' using errcode = 'check_violation';
    end if;
  end if;

  -- activity_at is the task's last event: a comment sets it (from its own
  -- trigger), every other recorded change here.
  if v_moved or new.state is distinct from old.state or new.due_at is distinct from old.due_at
     or new.priority is distinct from old.priority
     or (new.source_state, new.source_floor) is distinct from (old.source_state, old.source_floor) then
    new.activity_at := now();
  end if;
  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end;
$$;

-- ===========================================================================
-- 6. Fail closed
-- ===========================================================================

revoke all on function chat.work_task_operations_manager(uuid) from public;
revoke all on function chat.work_task_group_owner(uuid) from public;
revoke all on function chat.work_task_family_waiting_since(uuid) from public;
revoke all on function chat.work_task_setup_missing(uuid) from public;
revoke all on function chat.work_task_setup_verdict(text, uuid) from public;
revoke all on function chat.work_task_raise_family_unsupervised(uuid) from public;
revoke all on function chat.work_task_raise_teacher_setup(uuid) from public;
revoke all on function chat.work_task_raise_new_student_assign(uuid) from public;
revoke all on function chat.work_task_raise_new_student_group(uuid) from public;
revoke all on function chat.work_task_sweep_setup(integer) from public;
revoke all on function chat.work_task_from_learner_supervision() from public;
revoke all on function chat.work_task_from_student_enrolment() from public;
revoke all on function chat.work_task_from_trial_subscription() from public;
revoke all on function chat.guard_work_task() from public;
