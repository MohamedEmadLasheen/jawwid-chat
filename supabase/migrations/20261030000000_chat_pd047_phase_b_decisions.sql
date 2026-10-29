-- PD-47 (2026-10-29), PR-6c -- tasks for the Teachers department's decisions (Phase B). Slot 20261030000000.
--
-- Plan: docs/product/pd047-tasks-plan.md §3.6 (Phase B decisions and the
-- makeup_owed note, department head 2026-10-29). Builds on 20261029210000
-- (PR-2), 20261029235800 (PR-6a: the settle window) and 20261029235900
-- (PR-6b: the guard, redefined here when a source needs it). Announced with
-- the generic task_assigned, whose rule row exists; no new rule key.
--
--   source_type      key                          assignee                                    due
--   complaint        complaint:<entry>            the teacher's supervisor, else the          filed + 48 h
--                                                 Teachers manager (work_task_teacher_owner)
--   feedback         feedback:<parent_feedback>   as complaint                                filed + 48 h
--   schedule_change  schedule_change:<request>    the child's teacher's supervisor, else the  asked + 48 h
--                                                 Teachers manager
--   makeup_owed      makeup_owed:<lesson>         the lesson's teacher's supervisor, else     its end + the make-up
--                                                 the Teachers manager                        window (7 days)
--
--   Every one: operational, medium; reassignable by hand. The records that
--   already exist decide them; no new state (department head, 2026-10-29).
--
--   complaint        a PD-26 complaint on the Teacher File
--                    (chat.teacher_supervision_entry, kind complaint). Done
--                    when a complaint_resolution entry refers to it, by who
--                    wrote it. A parent's complaint (PD-32) is one of these:
--                    its feedback raises no task of its own.
--   feedback         a parent's praise or suggestion (chat.parent_feedback; PD-32
--                    confines its readers to src/teacher-file, so Tasks reads
--                    it only through the two helpers below).
--                    Done when it reaches its closed state, resolved, by who
--                    answered it. A complaint is the complaint source's.
--   schedule_change  a request for new regular times (PD-11). Done when it
--                    is approved or rejected, by who decided; withdrawn when
--                    the family withdraws it.
--   makeup_owed      a lesson that owes a make-up, by chat.lesson_owes_makeup:
--                    THE rule, which LessonService.owedMakeups now calls too
--                    (never re-implemented; a spec proves the two sets equal).
--                    The causes are MAKEUP_CAUSES: the teacher's misses and the
--                    student's apology (department head, 2026-10-29). Done at
--                    BOOKING (a live make-up), by who booked it -- the system
--                    when a family booked -- or by a makeup_followup ruling, by
--                    who decided it (the same decision completes PR-2's
--                    lesson_ruling task). Withdrawn when the outcome is
--                    corrected away. A booked make-up that dies (cancelled,
--                    moved) owes again: a FRESH episode, keyed on that make-up.
--
--   RAISED by chat.work_task_sweep_decisions() (the worker, every minute, its
--   own advisory lock and batches), past PR-6a's settle window. COMPLETED at
--   once by triggers on the sources (one function per table), never blocking
--   the source's write; the sweep re-reads the evidence. OWNERS who leave: an
--   open task moves to its source's owner now, else an `orphaned:` issue the
--   super admin may act on (PR-6b).
--
--   Cut-offs (owner 2026-10-29, the last 14 days at switch-on): each by when
--   its source was filed, asked or closed.
--
--   Never in a task: a complaint's or a feedback's words, a request's slots.
--   Tasks names its source by id and reads names behind sign-in.
--
-- FAIL CLOSED: revoked grants as PR-1/PR-2. Every function pins its
-- search_path.

-- ===========================================================================
-- 1. Who, and what the source says now
-- ===========================================================================

-- THE rule for "this lesson owes a make-up" (PD-11 T2, PD-15), for the causes
-- given. LessonService.owedMakeups calls it; so does makeup_owed.
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

-- The causes that owe a make-up task: LessonService's MAKEUP_CAUSES (a spec
-- holds the two to one list).
create or replace function chat.work_task_makeup_causes()
returns text[]
language sql
immutable
set search_path = chat, pg_temp
as $$
  select array['teacher_apology', 'teacher_no_show', 'student_apology']::text[];
$$;

-- The lesson a makeup_owed key names, and the original lesson it is about:
-- the original itself, or a make-up of it that died (a fresh episode).
create or replace function chat.work_task_makeup_original(p_source uuid)
returns uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select case when s.kind = 'makeup' then s.makeup_for else s.id end from chat.lesson s where s.id = p_source;
$$;

-- An original lesson's current episode: its latest make-up that died, else itself.
create or replace function chat.work_task_makeup_episode(p_original uuid)
returns uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select coalesce(
    (select m.id from chat.lesson m
      where m.makeup_for = p_original and m.kind = 'makeup'
        and m.outcome in ('teacher_apology', 'teacher_no_show', 'admin_cancelled', 'rescheduled', 'voided')
      order by m.outcome_at desc nulls last, m.created_at desc, m.id
      limit 1),
    p_original);
$$;

-- Who a lesson's own act names: staff or a teacher; a family (a contact) is
-- nobody the task log can name -- the system.
create or replace function chat.work_task_lesson_actor(p_kind text, p_id uuid)
returns uuid
language sql
immutable
set search_path = chat, pg_temp
as $$
  select case when p_kind in ('staff', 'teacher') then p_id end;
$$;

-- Who a decision task belongs to now, by its source (as its raise names it).
create or replace function chat.work_task_decision_owner(p_type text, p_source uuid)
returns uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select case p_type
    when 'complaint' then (select chat.work_task_teacher_owner(e.teacher_id) from chat.teacher_supervision_entry e where e.id = p_source)
    when 'feedback' then (select chat.work_task_teacher_owner(f.teacher_id) from chat.parent_feedback f where f.id = p_source)
    when 'schedule_change' then (select chat.work_task_teacher_owner(ln.teacher_id)
                                   from chat.schedule_change_request q join chat.learner ln on ln.id = q.learner_id
                                  where q.id = p_source)
    when 'makeup_owed' then (select chat.work_task_teacher_owner(l.teacher_id) from chat.lesson l
                              where l.id = chat.work_task_makeup_original(p_source))
  end;
$$;

-- PD-32: a parent's feedback is read in src/ only by teacher-file. Tasks
-- reads what it needs of one -- the teacher it is about, and the names its
-- title shows -- through these, never its words or who filed it.
create or replace function chat.work_task_feedback_teacher(p_feedback uuid)
returns uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select f.teacher_id from chat.parent_feedback f where f.id = p_feedback;
$$;

create or replace function chat.work_task_feedback_title(p_feedback uuid)
returns jsonb
language sql
stable
set search_path = chat, pg_temp
as $$
  select jsonb_build_object('teacherName', te.name, 'learnerName', ln.name, 'category', f.category)
    from chat.parent_feedback f
    join chat.teacher te on te.id = f.teacher_id
    join chat.learner ln on ln.id = f.learner_id
   where f.id = p_feedback;
$$;

-- What a source says of its work now: 'done' (with who did it, or nobody),
-- 'gone' (the work no longer exists), or 'back' (it is still owed).
create or replace function chat.work_task_decision_verdict(p_type text, p_source uuid, out verdict text, out actor uuid)
language plpgsql
stable
set search_path = chat, pg_temp
as $$
declare
  v_original uuid;
  v_since    timestamptz;
begin
  verdict := 'gone';
  if p_type = 'complaint' then
    select r.created_by into actor from chat.teacher_supervision_entry r
     where r.refers_to = p_source and r.kind = 'complaint_resolution';
    if actor is not null then
      verdict := 'done';
    elsif exists (select 1 from chat.teacher_supervision_entry e where e.id = p_source and e.kind = 'complaint') then
      verdict := 'back';
    end if;
  end if;
  if p_type = 'feedback' then
    select case when f.status = 'resolved' then 'done' else 'back' end,
           case when f.status = 'resolved' then f.responded_by end
      into verdict, actor
      from chat.parent_feedback f where f.id = p_source and f.category <> 'complaint';
    verdict := coalesce(verdict, 'gone');
  end if;
  if p_type = 'schedule_change' then
    select case q.status when 'pending' then 'back' when 'withdrawn' then 'gone' else 'done' end,
           case when q.status in ('approved', 'rejected') then q.decided_by end
      into verdict, actor
      from chat.schedule_change_request q where q.id = p_source;
    verdict := coalesce(verdict, 'gone');
  end if;
  if p_type = 'makeup_owed' then
    v_original := chat.work_task_makeup_original(p_source);
    if v_original is null then
      return;
    end if;
    -- Still owed, and this episode is the current one.
    if chat.lesson_owes_makeup(v_original, chat.work_task_makeup_causes())
       and chat.work_task_makeup_episode(v_original) = p_source then
      verdict := 'back';
      return;
    end if;
    -- Booked: the first make-up booked after this episode began.
    select coalesce(s.outcome_at, s.created_at) into v_since from chat.lesson s where s.id = p_source and s.kind = 'makeup';
    select 'done', chat.work_task_lesson_actor(m.created_by_kind, m.created_by) into verdict, actor
      from chat.lesson m
     where m.makeup_for = v_original and m.kind = 'makeup' and (v_since is null or m.created_at > v_since)
     order by m.created_at, m.id
     limit 1;
    if verdict = 'done' then
      return;
    end if;
    -- Ruled on instead (a substitute, a credit, an extension, waived).
    select 'done', r.decided_by into verdict, actor
      from chat.lesson_ruling r
     where r.lesson_id = v_original and r.kind = 'makeup_followup' and r.decision is not null
     limit 1;
    verdict := coalesce(verdict, 'gone');
  end if;
end;
$$;

-- ===========================================================================
-- 2. The sources: one raise function each
-- ===========================================================================

create or replace function chat.work_task_raise_complaint(p_entry uuid)
returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  e       chat.teacher_supervision_entry;
  v_owner uuid;
begin
  select * into e from chat.teacher_supervision_entry where id = p_entry;
  if e.id is null or e.kind <> 'complaint' or e.created_at < chat.work_task_since('complaint')
     or exists (select 1 from chat.teacher_supervision_entry r where r.refers_to = e.id and r.kind = 'complaint_resolution') then
    return null;
  end if;
  v_owner := chat.work_task_teacher_owner(e.teacher_id);
  if v_owner is null then
    perform chat.work_task_note_issue(e.organization_id, 'complaint:' || e.id, 'no live supervisor or Teachers manager for the teacher');
    return null;
  end if;
  return chat.work_task_raise(e.organization_id, 'complaint', e.id, v_owner, null,
                              'medium', 'operational', 'generic', e.created_at + interval '48 hours');
end;
$$;

create or replace function chat.work_task_raise_feedback(p_feedback uuid)
returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  f       chat.parent_feedback;
  v_owner uuid;
begin
  select * into f from chat.parent_feedback where id = p_feedback;
  if f.id is null or f.category = 'complaint' or f.status = 'resolved' or f.created_at < chat.work_task_since('feedback') then
    return null;
  end if;
  v_owner := chat.work_task_teacher_owner(f.teacher_id);
  if v_owner is null then
    perform chat.work_task_note_issue(f.organization_id, 'feedback:' || f.id, 'no live supervisor or Teachers manager for the teacher');
    return null;
  end if;
  return chat.work_task_raise(f.organization_id, 'feedback', f.id, v_owner, null,
                              'medium', 'operational', 'generic', f.created_at + interval '48 hours');
end;
$$;

create or replace function chat.work_task_raise_schedule_change(p_request uuid)
returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  q       chat.schedule_change_request;
  v_owner uuid;
begin
  select * into q from chat.schedule_change_request where id = p_request;
  if q.id is null or q.status <> 'pending' or q.created_at < chat.work_task_since('schedule_change') then
    return null;
  end if;
  v_owner := chat.work_task_teacher_owner((select ln.teacher_id from chat.learner ln where ln.id = q.learner_id));
  if v_owner is null then
    perform chat.work_task_note_issue(q.organization_id, 'schedule_change:' || q.id, 'no live supervisor or Teachers manager for the child''s teacher');
    return null;
  end if;
  return chat.work_task_raise(q.organization_id, 'schedule_change', q.id, v_owner, null,
                              'medium', 'operational', 'generic', q.created_at + interval '48 hours');
end;
$$;

-- Keyed by the original lesson's current episode.
create or replace function chat.work_task_raise_makeup_owed(p_original uuid)
returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  o        chat.lesson;
  s        chat.lesson;
  v_owner  uuid;
  v_window integer := coalesce((select (c.value #>> '{}')::int from chat.config c where c.key = 'lesson.makeup_window_days'), 7);
begin
  select * into o from chat.lesson where id = p_original;
  if o.id is null or not chat.lesson_owes_makeup(o.id, chat.work_task_makeup_causes()) then
    return null;
  end if;
  select * into s from chat.lesson where id = chat.work_task_makeup_episode(o.id);
  if coalesce(s.outcome_at, s.ends_at) < chat.work_task_since('makeup_owed') then
    return null;
  end if;
  v_owner := chat.work_task_teacher_owner(o.teacher_id);
  if v_owner is null then
    perform chat.work_task_note_issue(o.organization_id, 'makeup_owed:' || s.id, 'no live supervisor or Teachers manager for the teacher');
    return null;
  end if;
  return chat.work_task_raise(o.organization_id, 'makeup_owed', s.id, v_owner, null,
                              'medium', 'operational', 'overdue_only', s.ends_at + make_interval(days => v_window));
end;
$$;

-- ===========================================================================
-- 3. The sweep: create what is missing, reconcile what is done, follow owners
-- ===========================================================================

-- As PR-6b's chat.work_task_sweep_handover: at most p_batch (capped at 60)
-- rows per call, each its own subtransaction; one sweep at a time.
create or replace function chat.work_task_sweep_decisions(p_batch integer default 50)
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
  v_orphaned  integer := 0;
  v_failed    integer := 0;
  v_declined  integer := 0;
  v_more      boolean := false;
  r           record;
  v_settle    interval := chat.work_task_settle_window();
  s_complaint  timestamptz;
  s_feedback  timestamptz;
  s_schedule  timestamptz;
  s_makeup  timestamptz;
begin
  if not pg_try_advisory_xact_lock(hashtext('chat.work_task_sweep_decisions')) then
    return jsonb_build_object('skipped', true);
  end if;
  s_complaint := chat.work_task_since('complaint');
  s_feedback := chat.work_task_since('feedback');
  s_schedule := chat.work_task_since('schedule_change');
  s_makeup := chat.work_task_since('makeup_owed');

  -- The issue log shrinks with these sources too: an occurrence whose task
  -- closed, whose work is done or gone, or an orphan given an owner again.
  -- Only these sources' keys.
  delete from chat.work_task_source_issue i
   where split_part(i.source_key, ':', 1) in ('complaint', 'feedback', 'schedule_change', 'makeup_owed')
     and (exists (select 1 from chat.work_task t
                   where t.organization_id = i.organization_id and t.source_key = i.source_key
                     and t.state in ('completed', 'removed'))
          or (select v.verdict from chat.work_task_decision_verdict(split_part(i.source_key, ':', 1),
                                                                     split_part(i.source_key, ':', 2)::uuid) v)
             is distinct from 'back'
          or i.reason like 'orphaned:%'
             and exists (select 1 from chat.work_task t
                          where t.organization_id = i.organization_id and t.source_key = i.source_key
                            and (chat.task_principal_kind(coalesce(t.assignee_staff_id, t.assignee_teacher_id), t.organization_id) is not null
                                 or chat.work_task_decision_owner(t.source_type, t.source_id) is not null)));

  -- Create.
  for r in
    select x.org, x.src, x.id, x.key from (
      select e.organization_id as org, 'complaint' as src, e.id, 'complaint:' || e.id as key, e.created_at as at
        from chat.teacher_supervision_entry e
       where e.kind = 'complaint' and e.created_at >= s_complaint
         and not exists (select 1 from chat.teacher_supervision_entry r where r.refers_to = e.id and r.kind = 'complaint_resolution')
      union all
      select f.organization_id, 'feedback', f.id, 'feedback:' || f.id, f.created_at
        from chat.parent_feedback f
       where f.category <> 'complaint' and f.status <> 'resolved' and f.created_at >= s_feedback
      union all
      select q.organization_id, 'schedule_change', q.id, 'schedule_change:' || q.id, q.created_at
        from chat.schedule_change_request q
       where q.status = 'pending' and q.created_at >= s_schedule
      union all
      select l.organization_id, 'makeup_owed', l.id, 'makeup_owed:' || ep.id, coalesce(ep.outcome_at, ep.ends_at)
        from chat.lesson l
        cross join lateral (select x.id, x.outcome_at, x.ends_at from chat.lesson x where x.id = chat.work_task_makeup_episode(l.id)) ep
       where l.kind <> 'trial' and l.outcome = any (chat.work_task_makeup_causes())
         and chat.lesson_owes_makeup(l.id, chat.work_task_makeup_causes())
         and coalesce(ep.outcome_at, ep.ends_at) >= s_makeup
    ) x
     where x.at <= now() - v_settle
       and not exists (select 1 from chat.work_task t where t.organization_id = x.org and t.source_key = x.key)
       and not exists (select 1 from chat.work_task_source_issue i
                        where i.organization_id = x.org and i.source_key = x.key and i.next_try_at > now())
     order by x.at
     limit v_left + 1
  loop
    if v_left = 0 then v_more := true; exit; end if;
    v_left := v_left - 1;
    begin
      if (case r.src
            when 'complaint' then chat.work_task_raise_complaint(r.id)
            when 'feedback' then chat.work_task_raise_feedback(r.id)
            when 'schedule_change' then chat.work_task_raise_schedule_change(r.id)
            when 'makeup_owed' then chat.work_task_raise_makeup_owed(r.id)
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

  -- Reconcile: the evidence re-read now. A withdrawn task may come back, or be done.
  for r in
    select y.* from (
      select t.organization_id as org, t.source_key as key, t.source_state, v.verdict, v.actor
        from chat.work_task t
        cross join lateral chat.work_task_decision_verdict(t.source_type, t.source_id) v
       where t.kind = 'system' and t.state in ('open', 'awaiting_decision')
         and t.source_type in ('complaint', 'feedback', 'schedule_change', 'makeup_owed')
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

  -- Owners: an open task whose assignee left moves to its source's owner now.
  for r in
    select t.organization_id as org, t.source_key as key, chat.work_task_decision_owner(t.source_type, t.source_id) as owner
      from chat.work_task t
     where t.kind = 'system' and t.state in ('open', 'awaiting_decision')
       and t.source_type in ('complaint', 'feedback', 'schedule_change', 'makeup_owed')
       and chat.task_principal_kind(coalesce(t.assignee_staff_id, t.assignee_teacher_id), t.organization_id) is null
       and chat.work_task_decision_owner(t.source_type, t.source_id) is not null
       and not exists (select 1 from chat.work_task_source_issue i
                        where i.organization_id = t.organization_id and i.source_key = t.source_key and i.next_try_at > now())
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

  -- An assignee who left with nobody live to follow: recorded for the super admin.
  for r in
    select t.organization_id as org, t.source_key as key
      from chat.work_task t
     where t.kind = 'system' and t.state in ('open', 'awaiting_decision')
       and t.source_type in ('complaint', 'feedback', 'schedule_change', 'makeup_owed')
       and chat.task_principal_kind(coalesce(t.assignee_staff_id, t.assignee_teacher_id), t.organization_id) is null
       and chat.work_task_decision_owner(t.source_type, t.source_id) is null
       and not exists (select 1 from chat.work_task_source_issue i
                        where i.organization_id = t.organization_id and i.source_key = t.source_key and i.next_try_at > now())
     limit v_left + 1
  loop
    if v_left = 0 then v_more := true; exit; end if;
    v_left := v_left - 1;
    perform chat.work_task_note_issue(r.org, r.key,
      'orphaned: its assignee left and nobody live follows (the teacher''s supervisor or the Teachers manager): the super admin may reassign it');
    v_orphaned := v_orphaned + 1;
  end loop;

  return jsonb_build_object('skipped', false, 'raised', v_raised, 'settled', v_settled, 'withdrawn', v_withdrawn,
                            'restored', v_restored, 'rerouted', v_rerouted, 'orphaned', v_orphaned,
                            'failed', v_failed, 'declined', v_declined, 'more', v_more,
                            'issues', (select count(*) from chat.work_task_source_issue));
end;
$$;

-- ===========================================================================
-- 4. The source triggers: in the source's own transaction, never blocking it
-- ===========================================================================

-- A complaint resolved on the Teacher File: its task is done, by who resolved it.
create or replace function chat.work_task_from_supervision_entry()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  begin
    perform chat.work_task_settle(new.organization_id, 'complaint:' || new.refers_to, new.created_by);
  exception when others then
    perform chat.work_task_note_issue(new.organization_id, 'complaint:' || new.refers_to, sqlerrm);
  end;
  return null;
end;
$$;

create trigger supervision_entry_settles_its_complaint after insert on chat.teacher_supervision_entry
  for each row when (new.kind = 'complaint_resolution' and new.refers_to is not null)
  execute function chat.work_task_from_supervision_entry();

-- A parent's praise or suggestion answered and closed: done, by who answered.
create or replace function chat.work_task_from_parent_feedback()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  begin
    perform chat.work_task_settle(new.organization_id, 'feedback:' || new.id, new.responded_by);
  exception when others then
    perform chat.work_task_note_issue(new.organization_id, 'feedback:' || new.id, sqlerrm);
  end;
  return null;
end;
$$;

create trigger parent_feedback_settles_its_task after update of status on chat.parent_feedback
  for each row when (old.status is distinct from 'resolved' and new.status = 'resolved')
  execute function chat.work_task_from_parent_feedback();

-- A schedule request decided (done, by who decided) or withdrawn by the family.
create or replace function chat.work_task_from_schedule_change()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  begin
    if new.status in ('approved', 'rejected') then
      perform chat.work_task_settle(new.organization_id, 'schedule_change:' || new.id, new.decided_by);
    elsif new.status = 'withdrawn' then
      perform chat.work_task_withdraw(new.organization_id, 'schedule_change:' || new.id);
    end if;
  exception when others then
    perform chat.work_task_note_issue(new.organization_id, 'schedule_change:' || new.id, sqlerrm);
  end;
  return null;
end;
$$;

create trigger schedule_change_moves_its_task after update of status on chat.schedule_change_request
  for each row when (old.status = 'pending' and new.status <> 'pending')
  execute function chat.work_task_from_schedule_change();

-- An original lesson's open make-up tasks, moved to what the evidence says now.
create or replace function chat.work_task_makeup_follow(p_original uuid)
returns void
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  r record;
begin
  for r in
    select t.organization_id as org, t.source_key as key, t.source_state, v.verdict, v.actor
      from chat.work_task t
      join chat.lesson s on s.id = t.source_id
      cross join lateral chat.work_task_decision_verdict('makeup_owed', t.source_id) v
     where t.source_type = 'makeup_owed' and t.state in ('open', 'awaiting_decision')
       and (s.id = p_original or s.makeup_for = p_original)
  loop
    begin
      if r.verdict = 'done' then
        perform chat.work_task_settle(r.org, r.key, r.actor);
      elsif r.verdict = 'gone' and r.source_state = 'pending' then
        perform chat.work_task_withdraw(r.org, r.key);
      elsif r.verdict = 'back' and r.source_state = 'withdrawn' then
        perform chat.work_task_restore(r.org, r.key);
      end if;
    exception when others then
      perform chat.work_task_note_issue(r.org, r.key, sqlerrm);
    end;
  end loop;
end;
$$;

-- A make-up booked, or a lesson's outcome changed (a correction, a booked
-- make-up dying): its original's make-up tasks follow.
create or replace function chat.work_task_from_makeup_lesson()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  begin
    perform chat.work_task_makeup_follow(case when new.kind = 'makeup' then new.makeup_for else new.id end);
  exception when others then
    perform chat.work_task_note_issue(new.organization_id, 'makeup_owed:' || new.id, sqlerrm);
  end;
  return null;
end;
$$;

-- Two triggers, one function: a make-up booked (never every materialized
-- lesson), and an outcome changed.
create trigger makeup_booked_settles_owed_tasks after insert on chat.lesson
  for each row when (new.kind = 'makeup' and new.makeup_for is not null)
  execute function chat.work_task_from_makeup_lesson();
create trigger lesson_outcome_moves_owed_tasks after update of outcome on chat.lesson
  for each row when (new.kind <> 'trial' and old.outcome is distinct from new.outcome
                     and (new.kind <> 'makeup' or new.makeup_for is not null))
  execute function chat.work_task_from_makeup_lesson();

-- A makeup_followup ruling decided: the lesson is made good, by who decided
-- (the same decision completes PR-2's lesson_ruling task).
create or replace function chat.work_task_from_makeup_ruling()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  begin
    perform chat.work_task_makeup_follow(new.lesson_id);
  exception when others then
    perform chat.work_task_note_issue(new.organization_id, 'makeup_owed:' || new.lesson_id, sqlerrm);
  end;
  return null;
end;
$$;

create trigger makeup_ruling_settles_owed_tasks after update of decision on chat.lesson_ruling
  for each row when (new.kind = 'makeup_followup' and old.decision is null and new.decision is not null)
  execute function chat.work_task_from_makeup_ruling();

-- ===========================================================================
-- 5. The guard: a make-up a family booked names nobody the task log can --
--    the system completes it. Otherwise PR-6b's guard unchanged.
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
              and chat.task_principal_kind(coalesce(old.assignee_staff_id, old.assignee_teacher_id), old.organization_id) is null)
     -- PR-6b: an unclaimed certificate request, handed by its overseer or the
     -- super admin to a live Designer.
     and not (chat.work_task_certificate_hand_on(old.id, v_actor::uuid)
              and new.assignee_staff_id is not null
              and chat.staff_has_permission(new.assignee_staff_id, 'certificates.design'))
     -- PR-6b: an orphan (the sweep found nobody live to follow), handed on by
     -- the super admin.
     and not (exists (select 1 from chat.work_task_source_issue i
                       where i.organization_id = old.organization_id and i.source_key = old.source_key
                         and i.reason like 'orphaned:%')
              and exists (select 1 from chat.staff s
                           where s.id = v_actor::uuid and s.organization_id = old.organization_id and s.role = 'super_admin'
                             and s.is_active and s.left_at is null)) then
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
    -- (PR-6a), a teacher's supervisor placed by the CLI (PR-6b), and a
    -- make-up a family booked (PR-6c) are nobody's: every other source's
    -- completion without its actor fails, into the issue log, rather than
    -- closing silently as the system's.
    if new.state = 'completed' and v_system and v_actor is null
       and coalesce(old.source_type, '') not in ('instalment', 'package_low', 'renewal_request', 'receipt_review', 'checkout_failed',
                                                 'teacher_setup', 'family_unsupervised', 'teacher_unsupervised', 'makeup_owed') then
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

revoke all on function chat.lesson_owes_makeup(uuid, text[]) from public;
revoke all on function chat.work_task_makeup_causes() from public;
revoke all on function chat.work_task_makeup_original(uuid) from public;
revoke all on function chat.work_task_makeup_episode(uuid) from public;
revoke all on function chat.work_task_lesson_actor(text, uuid) from public;
revoke all on function chat.work_task_decision_owner(text, uuid) from public;
revoke all on function chat.work_task_feedback_teacher(uuid) from public;
revoke all on function chat.work_task_feedback_title(uuid) from public;
revoke all on function chat.work_task_decision_verdict(text, uuid) from public;
revoke all on function chat.work_task_sweep_decisions(integer) from public;
revoke all on function chat.work_task_raise_complaint(uuid) from public;
revoke all on function chat.work_task_from_supervision_entry() from public;
revoke all on function chat.work_task_raise_feedback(uuid) from public;
revoke all on function chat.work_task_from_parent_feedback() from public;
revoke all on function chat.work_task_raise_schedule_change(uuid) from public;
revoke all on function chat.work_task_from_schedule_change() from public;
revoke all on function chat.work_task_raise_makeup_owed(uuid) from public;
revoke all on function chat.work_task_makeup_follow(uuid) from public;
revoke all on function chat.work_task_from_makeup_lesson() from public;
revoke all on function chat.work_task_from_makeup_ruling() from public;
revoke all on function chat.guard_work_task() from public;
