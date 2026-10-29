-- PD-47 (2026-10-29), PR-6b -- tasks for work handed between people (Phase B). Slot 20261029235900.
--
-- Plan: docs/product/pd047-tasks-plan.md §3.6 (the owner's answers of
-- 2026-10-29 and the PR-6b design note). Builds on 20261029210000 (PR-2: the
-- helpers, the issue log, the cut-offs), 20261029233000 (PR-2b) and
-- 20261029235800 (PR-6a: the guard, redefined here). Announced with the
-- generic task_assigned, whose rule row exists; no new rule key.
--
--   source_type           key                                  assignee                         due
--   teacher_unsupervised  teacher_unsupervised:<spell>         the Teachers manager, else the   unsupervised since
--                                                              super admin                      + 48 h
--   trial_attendance      trial_attendance:<lesson>            the trial's teacher              the trial's end + 24 h
--   trial_outcome         trial_outcome:<lesson>               the prospect's Sales owner       attendance + 48 h
--   certificate_<step>    certificate_<step>:<event>           the person the step waits on     the step's start + 48 h
--
--   teacher_unsupervised  an active teacher with no live PD-35 supervisor of
--                         the Teachers department. One SPELL
--                         (chat.work_task_teacher_spell) per stretch without
--                         one: a teacher added unsupervised, or whose
--                         supervisor left or moved. Done when a supervisor is
--                         assigned, by who assigned them (the CLI names
--                         nobody: the system). Withdrawn when the teacher
--                         leaves; back if reactivated still unsupervised. A
--                         later stretch is a fresh spell and a fresh task.
--                         REPLACES PD-43's two notices to the Teachers manager
--                         (owner 2026-10-29, "Replace it"): the API stops
--                         sending teacher_added_unsupervised, and the
--                         chat.staff trigger that sent teacher_supervisor_left
--                         is dropped here. Their text rows stay, for history.
--   trial_attendance      a trial whose time is over with no attendance (the
--                         teacher's fact). Done when it is recorded (held or
--                         student_no_show), by who recorded it -- the teacher,
--                         or Sales' no-show. Withdrawn when the trial is
--                         rescheduled or cancelled. Follows the trial's
--                         teacher, as a lesson report does.
--   trial_outcome         an attended trial (held) with no outcome yet. Raised
--                         only once attendance is held: two tasks, each person
--                         seeing only their own step (owner 2026-10-29, "Two
--                         tasks"). Done when chat.trial_outcome is written, by
--                         who recorded it. Withdrawn if Sales corrects the
--                         attendance to a no-show; back if corrected back.
--                         Its owner: the prospect's creator (always Sales)
--                         while live, else the Sales manager, else the super
--                         admin -- a prospect has no family, so no
--                         family_sales_owner, until it subscribes.
--                         Neither carries the prospect's or the form's data:
--                         ids only (G-07).
--   certificate_<step>    a PD-41 certificate waiting on a person (owner
--                         2026-10-29, "Yes, replace them"): one task per step,
--                         keyed on the chat.appreciation_certificate_event
--                         that opened it, so a certificate that loops back
--                         gets a fresh task each round.
--                           proposed           accept    the learner's Operations supervisor,
--                                                        else the Operations manager
--                           requested          design    the category's overseer (until claimed)
--                           in_design          design    the assigned Designer
--                           changes_requested  resubmit  the requester of record
--                           uploaded           review    the requester of record
--                           approved           send      the requester of record
--                         The next state change completes it, by whoever made
--                         it; a cancel withdraws it. RAISED AT ONCE by a
--                         trigger on the event (each event is a hand-over to
--                         someone else; the sweep is the backstop). The four
--                         notifications PD-41 sent stop (the API no longer
--                         emits them); PD-41's state machine is unchanged.
--                         Follows its source: the requester of record alone
--                         approves and sends (PD-41 safeguard 1), so a hand-on
--                         by hand would give someone work they may not do.
--
--   RAISED by chat.work_task_sweep_handover() (the worker, every minute, its
--   own advisory lock and batches, as PR-6a's): a teacher is often added and
--   given a supervisor in one sitting. COMPLETED at once by triggers on the
--   sources, never blocking the source's write; the sweep re-reads the
--   evidence as a safety net.
--
--   Cut-offs (owner 2026-10-29, the last 14 days at switch-on): a stretch by
--   when it began, as the records show it; a trial by its end (attendance)
--   or by when its attendance was recorded (outcome).
--
-- FAIL CLOSED: RLS and revoked grants as PR-1/PR-2. Every function pins its
-- search_path.

-- ===========================================================================
-- 1. Who, and what the source says now
-- ===========================================================================

-- A teacher's live PD-35 supervisor of the Teachers department, if any (the
-- first branch of chat.work_task_teacher_owner).
create or replace function chat.work_task_teacher_supervisor(p_teacher uuid)
returns uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select a.supervisor_id
    from chat.teacher_supervisor_assignment a
    join chat.staff s on s.id = a.supervisor_id and s.is_active and s.left_at is null
   where a.teacher_id = p_teacher
     and exists (select 1 from chat.department_member m
                   join chat.department d on d.id = m.department_id
                  where m.staff_id = a.supervisor_id and m.position = 'supervisor' and d.kind = 'teachers');
$$;

-- When an unsupervised teacher's stretch began, as the records show it: when
-- their last supervisor left (or was deactivated: their row's last change),
-- else when that supervisor was assigned, else when the teacher was added.
-- Null while they are supervised.
create or replace function chat.work_task_unsupervised_since(p_teacher uuid)
returns timestamptz
language sql
stable
set search_path = chat, pg_temp
as $$
  select case when chat.work_task_teacher_supervisor(t.id) is null
              then greatest(t.created_at,
                            coalesce(s.left_at, case when not s.is_active then s.updated_at end, a.assigned_at, t.created_at)) end
    from chat.teacher t
    left join chat.teacher_supervisor_assignment a on a.teacher_id = t.id
    left join chat.staff s on s.id = a.supervisor_id
   where t.id = p_teacher;
$$;

-- The Teachers manager while live, else the live super admin.
create or replace function chat.work_task_teachers_manager(p_org uuid)
returns uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select coalesce(
    (select s.id
       from chat.department d
       join chat.staff s on s.id = d.manager_id and s.is_active and s.left_at is null
      where d.organization_id = p_org and d.kind = 'teachers'
      order by d.id
      limit 1),
    chat.work_task_super_admin(p_org));
$$;

-- Who records a trial's outcome: the prospect's creator while live and still
-- in Sales, else the live Sales manager, else the live super admin.
create or replace function chat.work_task_trial_sales_owner(p_lesson uuid)
returns uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select coalesce(
    (select p.created_by
       from chat.lesson l
       join chat.trial_prospect p on p.id = l.prospect_id
       join chat.staff s on s.id = p.created_by and s.is_active and s.left_at is null
      where l.id = p_lesson
        and (exists (select 1 from chat.department_member m join chat.department d on d.id = m.department_id
                      where m.staff_id = p.created_by and d.kind = 'sales')
             or exists (select 1 from chat.department d where d.manager_id = p.created_by and d.kind = 'sales'))),
    (select s.id
       from chat.lesson l
       join chat.department d on d.organization_id = l.organization_id and d.kind = 'sales'
       join chat.staff s on s.id = d.manager_id and s.is_active and s.left_at is null
      where l.id = p_lesson
      order by d.id
      limit 1),
    (select chat.work_task_super_admin(l.organization_id) from chat.lesson l where l.id = p_lesson));
$$;

-- The step a certificate in p_state waits on, if it waits on a person.
create or replace function chat.work_task_certificate_step(p_state text)
returns text
language sql
immutable
set search_path = chat, pg_temp
as $$
  select case p_state
    when 'proposed' then 'certificate_accept'
    when 'requested' then 'certificate_design'
    when 'in_design' then 'certificate_design'
    when 'changes_requested' then 'certificate_resubmit'
    when 'uploaded' then 'certificate_review'
    when 'approved' then 'certificate_send'
  end;
$$;

-- The event that opened a certificate's current state: its latest state change.
create or replace function chat.work_task_certificate_entry(p_certificate uuid)
returns uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select e.id from chat.appreciation_certificate_event e
   where e.certificate_id = p_certificate and (e.from_state is null or e.from_state <> e.to_state)
   order by e.seq desc
   limit 1;
$$;

-- Who a certificate waits on now. The overseer (PD-41 §6: the Operations
-- manager for a student's, the Teachers manager for a teacher's, else the
-- super admin) holds what has nobody of its own.
create or replace function chat.work_task_certificate_assignee(p_certificate uuid)
returns uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  with c as (
    select c.*, ls.supervisor_id,
           case when c.category = 'student' then chat.work_task_operations_manager(c.organization_id)
                else chat.work_task_teachers_manager(c.organization_id) end as overseer
      from chat.appreciation_certificate c
      left join chat.learner_supervision ls on ls.learner_id = c.learner_id
     where c.id = p_certificate)
  select case
    when c.state = 'proposed' then
      coalesce(case when chat.task_principal_kind(c.supervisor_id, c.organization_id) = 'staff' then c.supervisor_id end, c.overseer)
    when c.state = 'requested' then c.overseer
    when c.state = 'in_design' then
      coalesce(case when chat.task_principal_kind(c.assigned_designer_id, c.organization_id) = 'staff' then c.assigned_designer_id end, c.overseer)
    when c.state in ('changes_requested', 'uploaded', 'approved') then
      coalesce(case when c.category = 'student' and chat.task_principal_kind(c.supervisor_id, c.organization_id) = 'staff' then c.supervisor_id end,
               case when chat.task_principal_kind(c.requested_by_staff, c.organization_id) = 'staff' then c.requested_by_staff end,
               c.overseer)
  end
  from c;
$$;

-- One stretch of a teacher without a supervisor: the task's source.
create table chat.work_task_teacher_spell (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references chat.organization (id),
  teacher_id      uuid not null references chat.teacher (id) on delete cascade,
  opened_at       timestamptz not null default clock_timestamp(),
  closed_at       timestamptz
);

comment on table chat.work_task_teacher_spell is
  'PD-47 PR-6b: one stretch of a teacher without a supervisor -- the source of a teacher_unsupervised task. Closed when a supervisor is assigned.';

create unique index work_task_teacher_spell_one_open on chat.work_task_teacher_spell (teacher_id) where closed_at is null;

-- What a source says of its work now: 'done' (with who did it, or nobody),
-- 'gone' (the work no longer exists), or 'back' (it is still owed).
create or replace function chat.work_task_handover_verdict(p_type text, p_source uuid, out verdict text, out actor uuid)
language plpgsql
stable
set search_path = chat, pg_temp
as $$
declare
  v_teacher uuid;
  v_org     uuid;
begin
  if p_type = 'teacher_unsupervised' then
    select sp.teacher_id, sp.organization_id into v_teacher, v_org from chat.work_task_teacher_spell sp where sp.id = p_source;
    if v_teacher is null or chat.task_principal_kind(v_teacher, v_org) is distinct from 'teacher' then
      verdict := 'gone';
    elsif chat.work_task_teacher_supervisor(v_teacher) is not null then
      verdict := 'done';
      select a.assigned_by into actor from chat.teacher_supervisor_assignment a where a.teacher_id = v_teacher;
    else
      verdict := 'back';
    end if;
  elsif p_type = 'trial_attendance' then
    select case when l.id is null then 'gone'
                when l.outcome is null then 'back'
                when l.outcome in ('held', 'student_no_show') then 'done'
                else 'gone' end,
           case when l.outcome in ('held', 'student_no_show') then l.outcome_by end
      into verdict, actor
      from (select 1) one left join chat.lesson l on l.id = p_source and l.kind = 'trial';
  elsif p_type like 'certificate\_%' then
    -- The step ends at the certificate's next state change: done by whoever
    -- made it, gone when it was a cancel.
    declare
      e    chat.appreciation_certificate_event;
      nxt  chat.appreciation_certificate_event;
    begin
      select * into e from chat.appreciation_certificate_event where id = p_source;
      if e.id is null then
        verdict := 'gone';
        return;
      end if;
      select * into nxt from chat.appreciation_certificate_event x
       where x.certificate_id = e.certificate_id and x.seq > e.seq and x.from_state is distinct from x.to_state
       order by x.seq
       limit 1;
      if nxt.id is null then
        verdict := case when exists (select 1 from chat.appreciation_certificate c where c.id = e.certificate_id and c.state = e.to_state)
                        then 'back' else 'gone' end;
      elsif nxt.to_state = 'cancelled' then
        verdict := 'gone';
      else
        verdict := 'done';
        actor := coalesce(nxt.actor_staff_id, nxt.actor_teacher_id);
      end if;
    end;
  elsif p_type = 'trial_outcome' then
    select o.recorded_by into actor from chat.trial_outcome o where o.lesson_id = p_source;
    if actor is not null then
      verdict := 'done';
    elsif exists (select 1 from chat.lesson l where l.id = p_source and l.kind = 'trial' and l.outcome = 'held') then
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

-- The teacher's open spell, or a fresh one; its task raised once.
create or replace function chat.work_task_raise_teacher_unsupervised(p_teacher uuid)
returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  t       chat.teacher;
  v_since timestamptz;
  v_spell uuid;
  v_owner uuid;
begin
  -- One writer per teacher, without waiting: a busy teacher is the next sweep's.
  if not pg_try_advisory_xact_lock(hashtextextended('chat.work_task_teacher_spell:' || p_teacher, 0)) then
    return null;
  end if;
  select * into t from chat.teacher where id = p_teacher;
  v_since := chat.work_task_unsupervised_since(p_teacher);
  if t.id is null or not t.is_active or t.left_at is not null or v_since is null
     or v_since < chat.work_task_since('teacher_unsupervised') then
    return null;
  end if;
  select sp.id into v_spell from chat.work_task_teacher_spell sp where sp.teacher_id = t.id and sp.closed_at is null;
  if v_spell is null then
    insert into chat.work_task_teacher_spell (organization_id, teacher_id, opened_at)
    values (t.organization_id, t.id, v_since)
    returning id into v_spell;
  end if;
  v_owner := chat.work_task_teachers_manager(t.organization_id);
  if v_owner is null then
    perform chat.work_task_note_issue(t.organization_id, 'teacher_unsupervised:' || v_spell, 'no live Teachers manager or super admin');
    return null;
  end if;
  return chat.work_task_raise(t.organization_id, 'teacher_unsupervised', v_spell, v_owner, null,
                              'medium', 'operational', 'generic', v_since + interval '48 hours');
end;
$$;

-- The teacher's fact. Its key is the trial.
create or replace function chat.work_task_raise_trial_attendance(p_lesson uuid)
returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  l chat.lesson;
begin
  select * into l from chat.lesson where id = p_lesson;
  if l.id is null or l.kind <> 'trial' or l.outcome is not null or l.ends_at > now()
     or l.ends_at < chat.work_task_since('trial_attendance') then
    return null;
  end if;
  if chat.task_principal_kind(l.teacher_id, l.organization_id) is distinct from 'teacher' then
    perform chat.work_task_note_issue(l.organization_id, 'trial_attendance:' || l.id, 'the trial''s teacher is not active');
    return null;
  end if;
  return chat.work_task_raise(l.organization_id, 'trial_attendance', l.id, null, l.teacher_id,
                              'medium', 'operational', 'overdue_only', l.ends_at + interval '24 hours');
end;
$$;

-- Sales' step, only once the teacher's is done and the prospect attended.
create or replace function chat.work_task_raise_trial_outcome(p_lesson uuid)
returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  l       chat.lesson;
  v_owner uuid;
begin
  select * into l from chat.lesson where id = p_lesson;
  if l.id is null or l.kind <> 'trial' or l.outcome is distinct from 'held'
     or exists (select 1 from chat.trial_outcome o where o.lesson_id = l.id)
     or coalesce(l.outcome_at, l.ends_at) < chat.work_task_since('trial_outcome') then
    return null;
  end if;
  v_owner := chat.work_task_trial_sales_owner(l.id);
  if v_owner is null then
    perform chat.work_task_note_issue(l.organization_id, 'trial_outcome:' || l.id, 'no live Sales owner, Sales manager or super admin');
    return null;
  end if;
  return chat.work_task_raise(l.organization_id, 'trial_outcome', l.id, v_owner, null,
                              'medium', 'operational', 'generic', coalesce(l.outcome_at, l.ends_at) + interval '48 hours');
end;
$$;

-- The step a certificate event opened, if it is still the current one and
-- waits on a person.
create or replace function chat.work_task_raise_certificate_step(p_event uuid)
returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  e       chat.appreciation_certificate_event;
  c       chat.appreciation_certificate;
  v_type  text;
  v_owner uuid;
begin
  select * into e from chat.appreciation_certificate_event where id = p_event;
  select * into c from chat.appreciation_certificate where id = e.certificate_id;
  v_type := chat.work_task_certificate_step(c.state);
  if e.id is null or c.id is null or v_type is null or c.state <> e.to_state
     or chat.work_task_certificate_entry(c.id) is distinct from e.id
     or e.at < chat.work_task_since(v_type) then
    return null;
  end if;
  v_owner := chat.work_task_certificate_assignee(c.id);
  if v_owner is null then
    perform chat.work_task_note_issue(c.organization_id, v_type || ':' || e.id, 'nobody live to hold this certificate step');
    return null;
  end if;
  return chat.work_task_raise(c.organization_id, v_type, e.id, v_owner, null,
                              'medium', 'operational', 'generic', e.at + interval '48 hours');
end;
$$;

-- ===========================================================================
-- 3. The sweep: create what is missing, reconcile what is done
-- ===========================================================================

-- As chat.work_task_sweep_setup: at most p_batch (capped at 60) rows per
-- call, each its own subtransaction; `more` says another batch is waiting;
-- one sweep at a time (an advisory lock). Returns the counts.
create or replace function chat.work_task_sweep_handover(p_batch integer default 50)
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
  v_rerouted  integer := 0;
  v_failed    integer := 0;
  v_declined  integer := 0;
  v_more      boolean := false;
  r           record;
  s_teacher   timestamptz;
  s_attend    timestamptz;
  s_outcome   timestamptz;
  s_cert      timestamptz;
begin
  if not pg_try_advisory_xact_lock(hashtext('chat.work_task_sweep_handover')) then
    return jsonb_build_object('skipped', true);
  end if;
  s_teacher := chat.work_task_since('teacher_unsupervised');
  s_attend := chat.work_task_since('trial_attendance');
  s_outcome := chat.work_task_since('trial_outcome');
  -- One cut-off for every certificate step: the earliest of theirs.
  s_cert := least(chat.work_task_since('certificate_accept'), chat.work_task_since('certificate_design'),
                  chat.work_task_since('certificate_resubmit'), chat.work_task_since('certificate_review'),
                  chat.work_task_since('certificate_send'));

  -- The issue log shrinks with these sources too: an occurrence whose task
  -- closed, or whose work is done or gone. Only these sources' keys; a key
  -- names its spell (or step), so a teacher's issue goes with its spell.
  delete from chat.work_task_source_issue i
   where split_part(i.source_key, ':', 1) in ('teacher_unsupervised', 'trial_attendance', 'trial_outcome',
                                              'certificate_accept', 'certificate_design', 'certificate_resubmit', 'certificate_review', 'certificate_send')
     and (exists (select 1 from chat.work_task t
                   where t.organization_id = i.organization_id and t.source_key = i.source_key
                     and t.state in ('completed', 'removed'))
          or (select v.verdict from chat.work_task_handover_verdict(split_part(i.source_key, ':', 1),
                                                                     split_part(i.source_key, ':', 2)::uuid) v)
             is distinct from 'back');
  -- A spell whose teacher is supervised again, its task never raised, closes.
  update chat.work_task_teacher_spell sp set closed_at = clock_timestamp()
   where sp.closed_at is null and chat.work_task_teacher_supervisor(sp.teacher_id) is not null
     and not exists (select 1 from chat.work_task t where t.organization_id = sp.organization_id
                       and t.source_key = 'teacher_unsupervised:' || sp.id and t.state in ('open', 'awaiting_decision'));

  -- Create. A candidate is the SOURCE the raise is called with (a teacher);
  -- its key is the open spell's, when there is one.
  for r in
    select x.org, x.src, x.id, x.key from (
      select t.organization_id as org, 'teacher_unsupervised' as src, t.id,
             'teacher_unsupervised:' || coalesce(sp.id::text, '') as key, u.since as at, sp.id as spell
        from chat.teacher t
        cross join lateral (select chat.work_task_unsupervised_since(t.id) as since) u
        left join chat.work_task_teacher_spell sp on sp.teacher_id = t.id and sp.closed_at is null
       where t.is_active and t.left_at is null and u.since is not null and u.since >= s_teacher
      union all
      select l.organization_id, 'trial_attendance', l.id, 'trial_attendance:' || l.id, l.ends_at, null
        from chat.lesson l
       where l.kind = 'trial' and l.outcome is null and l.ends_at <= now() and l.ends_at >= s_attend
      union all
      select l.organization_id, 'trial_outcome', l.id, 'trial_outcome:' || l.id, coalesce(l.outcome_at, l.ends_at), null
        from chat.lesson l
       where l.kind = 'trial' and l.outcome = 'held' and coalesce(l.outcome_at, l.ends_at) >= s_outcome
         and not exists (select 1 from chat.trial_outcome o where o.lesson_id = l.id)
      union all
      select c.organization_id, chat.work_task_certificate_step(c.state), e.id,
             chat.work_task_certificate_step(c.state) || ':' || e.id, e.at, null
        from chat.appreciation_certificate c
        cross join lateral (select x.id, x.at from chat.appreciation_certificate_event x
                             where x.id = chat.work_task_certificate_entry(c.id)) e
       where c.state in ('proposed', 'requested', 'in_design', 'changes_requested', 'uploaded', 'approved')
         and e.at >= s_cert
    ) x
     where not exists (select 1 from chat.work_task t where t.organization_id = x.org and t.source_key = x.key)
       and not exists (select 1 from chat.work_task_source_issue i
                        where i.organization_id = x.org and i.source_key = x.key and i.next_try_at > now())
     order by x.at
     limit v_left + 1
  loop
    if v_left = 0 then v_more := true; exit; end if;
    v_left := v_left - 1;
    begin
      if (case r.src
            when 'teacher_unsupervised' then chat.work_task_raise_teacher_unsupervised(r.id)
            when 'trial_attendance' then chat.work_task_raise_trial_attendance(r.id)
            when 'trial_outcome' then chat.work_task_raise_trial_outcome(r.id)
            else case when r.src like 'certificate\_%' then chat.work_task_raise_certificate_step(r.id) end
          end) is not null then
        v_raised := v_raised + 1;
      else
        v_declined := v_declined + 1;
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
      select t.organization_id as org, t.source_key as key, t.source_type as src, t.source_id as id,
             t.source_state, v.verdict, v.actor
        from chat.work_task t
        cross join lateral chat.work_task_handover_verdict(t.source_type, t.source_id) v
       where t.kind = 'system' and t.state in ('open', 'awaiting_decision')
         and t.source_type in ('teacher_unsupervised', 'trial_attendance', 'trial_outcome',
                               'certificate_accept', 'certificate_design', 'certificate_resubmit', 'certificate_review', 'certificate_send')
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
        if r.src = 'teacher_unsupervised' then
          update chat.work_task_teacher_spell set closed_at = clock_timestamp() where id = r.id and closed_at is null;
        end if;
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

  -- A certificate step follows its person: a learner's new supervisor, a
  -- Designer who left. Only a step still current and pending.
  for r in
    select y.* from (
      select t.organization_id as org, t.source_key as key, t.assignee_staff_id as now_on,
             chat.work_task_certificate_assignee(e.certificate_id) as owner
        from chat.work_task t
        join chat.appreciation_certificate_event e on e.id = t.source_id
       where t.kind = 'system' and t.state in ('open', 'awaiting_decision') and t.source_state = 'pending'
         and t.source_type in ('certificate_accept', 'certificate_design', 'certificate_resubmit', 'certificate_review', 'certificate_send')
    ) y
     where y.owner is not null and y.owner is distinct from y.now_on
     limit v_left + 1
  loop
    if v_left = 0 then v_more := true; exit; end if;
    v_left := v_left - 1;
    begin
      v_rerouted := v_rerouted + chat.work_task_reroute(r.org, r.key, r.owner, null, null);
    exception when others then
      v_failed := v_failed + 1;
      perform chat.work_task_note_issue(r.org, r.key, sqlerrm);
    end;
  end loop;

  return jsonb_build_object('skipped', false, 'raised', v_raised, 'settled', v_settled, 'withdrawn', v_withdrawn,
                            'restored', v_restored, 'rerouted', v_rerouted, 'failed', v_failed, 'declined', v_declined,
                            'more', v_more, 'issues', (select count(*) from chat.work_task_source_issue));
end;
$$;

-- ===========================================================================
-- 4. The source triggers: in the source's own transaction, never blocking it
-- ===========================================================================

-- A supervisor assigned: the teacher's open spell closes, its task done by
-- who assigned them.
create or replace function chat.work_task_from_teacher_supervisor_assignment()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_spell uuid;
begin
  begin
    if chat.work_task_teacher_supervisor(new.teacher_id) is not null then
      update chat.work_task_teacher_spell set closed_at = clock_timestamp()
       where teacher_id = new.teacher_id and closed_at is null
       returning id into v_spell;
      if v_spell is not null then
        perform chat.work_task_settle(new.organization_id, 'teacher_unsupervised:' || v_spell, new.assigned_by);
      end if;
    end if;
  exception when others then
    perform chat.work_task_note_issue(new.organization_id, 'teacher_unsupervised:' || coalesce(v_spell::text, new.teacher_id::text), sqlerrm);
  end;
  return null;
end;
$$;

create trigger teacher_supervisor_assignment_settles_its_task
  after insert or update of supervisor_id on chat.teacher_supervisor_assignment
  for each row execute function chat.work_task_from_teacher_supervisor_assignment();

-- A trial's attendance recorded, the trial moved or cancelled, its teacher
-- changed, or its attendance corrected by Sales. One function per table
-- (chat.work_task_from_lesson keeps the lessons' own).
create or replace function chat.work_task_from_trial_lesson()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  begin
    if old.outcome is null and new.outcome in ('held', 'student_no_show') then
      perform chat.work_task_settle(new.organization_id, 'trial_attendance:' || new.id, new.outcome_by);
    elsif old.outcome is null and new.outcome is not null then
      perform chat.work_task_withdraw(new.organization_id, 'trial_attendance:' || new.id);
    end if;
    if new.teacher_id is distinct from old.teacher_id then
      perform chat.work_task_reroute(new.organization_id, 'trial_attendance:' || new.id, null, new.teacher_id, null);
    end if;
  exception when others then
    perform chat.work_task_note_issue(new.organization_id, 'trial_attendance:' || new.id, sqlerrm);
  end;
  -- Sales corrects attendance: no outcome is owed for a no-show.
  begin
    if old.outcome = 'held' and new.outcome is distinct from 'held' then
      perform chat.work_task_withdraw(new.organization_id, 'trial_outcome:' || new.id);
    elsif old.outcome is distinct from 'held' and new.outcome = 'held'
          and not exists (select 1 from chat.trial_outcome o where o.lesson_id = new.id) then
      perform chat.work_task_restore(new.organization_id, 'trial_outcome:' || new.id);
    end if;
  exception when others then
    perform chat.work_task_note_issue(new.organization_id, 'trial_outcome:' || new.id, sqlerrm);
  end;
  return null;
end;
$$;

create trigger trial_lesson_moves_its_tasks after update of outcome, teacher_id on chat.lesson
  for each row
  when (new.kind = 'trial' and (old.outcome is distinct from new.outcome or old.teacher_id is distinct from new.teacher_id))
  execute function chat.work_task_from_trial_lesson();

-- Sales' outcome written: the outcome task is done, by who recorded it.
create or replace function chat.work_task_from_trial_outcome()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  begin
    perform chat.work_task_settle(new.organization_id, 'trial_outcome:' || new.lesson_id, new.recorded_by);
  exception when others then
    perform chat.work_task_note_issue(new.organization_id, 'trial_outcome:' || new.lesson_id, sqlerrm);
  end;
  return null;
end;
$$;

create trigger trial_outcome_settles_its_task after insert on chat.trial_outcome
  for each row execute function chat.work_task_from_trial_outcome();

-- A certificate's state changed: the step it ended is done by whoever moved
-- it (gone, if it was a cancel), and the step it opened is its person's task.
-- In PD-41's own transaction, never blocking it.
create or replace function chat.work_task_from_certificate_event()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_org uuid;
  r     record;
begin
  if new.from_state is not distinct from new.to_state then
    return null;
  end if;
  select c.organization_id into v_org from chat.appreciation_certificate c where c.id = new.certificate_id;
  for r in
    select t.source_key as key
      from chat.work_task t join chat.appreciation_certificate_event e on e.id = t.source_id
     where e.certificate_id = new.certificate_id and e.id <> new.id
       and t.organization_id = v_org and t.state in ('open', 'awaiting_decision')
       and t.source_type in ('certificate_accept', 'certificate_design', 'certificate_resubmit', 'certificate_review', 'certificate_send')
  loop
    begin
      if new.to_state = 'cancelled' then
        perform chat.work_task_withdraw(v_org, r.key);
      else
        perform chat.work_task_settle(v_org, r.key, coalesce(new.actor_staff_id, new.actor_teacher_id));
      end if;
    exception when others then
      perform chat.work_task_note_issue(v_org, r.key, sqlerrm);
    end;
  end loop;
  begin
    perform chat.work_task_raise_certificate_step(new.id);
  exception when others then
    perform chat.work_task_note_issue(v_org, coalesce(chat.work_task_certificate_step(new.to_state), 'certificate_design') || ':' || new.id, sqlerrm);
  end;
  return null;
end;
$$;

create trigger certificate_event_moves_its_tasks after insert on chat.appreciation_certificate_event
  for each row execute function chat.work_task_from_certificate_event();

-- PD-43's notice is replaced by the task (owner 2026-10-29, "Replace it").
drop trigger teacher_supervisor_left_tells_the_manager on chat.staff;
drop function chat.notify_teacher_supervisor_left();

-- ===========================================================================
-- 5. The guard: a teacher's supervisor placed by the CLI names nobody -- the
--    system may complete that task, as PR-6a's set-up -- and a trial's
--    attendance follows its teacher, as a lesson report does, and a
--    certificate's step its person (PD-41 safeguard 1). Otherwise PR-6a's
--    guard unchanged.
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
  -- A lesson report, a correction and a trial's attendance (PR-6b) are the lesson's teacher's, a case's task
  -- follows the case's owner, and a financial task the family's billing
  -- supervisor or Sales owner: only their source moves them (PR-2, PR-2b).
  -- The one exception: the super admin hands on a financial task whose
  -- assignee left with nobody live to follow (the sweep records it); the
  -- sweep moves it on to its owner once there is one again.
  if v_moved and old.kind = 'system' and not v_system
     and old.source_type in ('lesson_report', 'report_correction', 'case', 'trial_attendance',
                             'certificate_accept', 'certificate_design', 'certificate_resubmit', 'certificate_review', 'certificate_send',
                             'instalment', 'package_low', 'renewal_request', 'receipt_review', 'checkout_failed')
     and not (old.source_type in ('instalment', 'package_low', 'renewal_request', 'receipt_review', 'checkout_failed')
              and exists (select 1 from chat.staff s
                           where s.id = v_actor::uuid and s.organization_id = old.organization_id and s.role = 'super_admin'
                             and s.is_active and s.left_at is null)
              and chat.task_principal_kind(coalesce(old.assignee_staff_id, old.assignee_teacher_id), old.organization_id) is null) then
    raise exception 'this task follows its source: change the lesson''s teacher, the case''s owner, the certificate''s Designer or requester, or the family''s billing supervisor or Sales owner' using errcode = 'check_violation';
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
    -- (PR-6a), and a teacher's supervisor placed by the CLI (PR-6b) are
    -- nobody's: every other source's completion without its actor fails,
    -- into the issue log, rather than closing silently as the system's.
    if new.state = 'completed' and v_system and v_actor is null
       and coalesce(old.source_type, '') not in ('instalment', 'package_low', 'renewal_request', 'receipt_review', 'checkout_failed',
                                                 'teacher_setup', 'family_unsupervised', 'teacher_unsupervised') then
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

alter table chat.work_task_teacher_spell enable row level security;
revoke all on chat.work_task_teacher_spell from public, anon, authenticated, chat_app;

revoke all on function chat.work_task_teacher_supervisor(uuid) from public;
revoke all on function chat.work_task_unsupervised_since(uuid) from public;
revoke all on function chat.work_task_teachers_manager(uuid) from public;
revoke all on function chat.work_task_handover_verdict(text, uuid) from public;
revoke all on function chat.work_task_raise_teacher_unsupervised(uuid) from public;
revoke all on function chat.work_task_trial_sales_owner(uuid) from public;
revoke all on function chat.work_task_raise_trial_attendance(uuid) from public;
revoke all on function chat.work_task_raise_trial_outcome(uuid) from public;
revoke all on function chat.work_task_from_trial_lesson() from public;
revoke all on function chat.work_task_from_trial_outcome() from public;
revoke all on function chat.work_task_certificate_step(text) from public;
revoke all on function chat.work_task_certificate_entry(uuid) from public;
revoke all on function chat.work_task_certificate_assignee(uuid) from public;
revoke all on function chat.work_task_raise_certificate_step(uuid) from public;
revoke all on function chat.work_task_from_certificate_event() from public;
revoke all on function chat.work_task_sweep_handover(integer) from public;
revoke all on function chat.work_task_from_teacher_supervisor_assignment() from public;
revoke all on function chat.guard_work_task() from public;
