-- AMB-9 (release gate G-43), 2026-11-02 -- a group left without a live admin
-- becomes a Needs-action task. Slot 20261102220000 (department head).
--
-- BR-1 / C-4: a teacher and a parent may talk in a group only with a live
-- Jawwid admin present. The API refuses their sends with
-- BR1_ADMIN_PRESENCE_REQUIRED when none is (AuthorizationService
-- .requireAdminPresence), and until now nobody was told: the group simply
-- went silent. The database keeps an admin MEMBER row in such a group
-- (chat.assert_conversation_br1), but a member row survives its staff member
-- being deactivated or offboarded, so a group still enters the state:
--   * its admin leaves the academy or is deactivated (chat.staff), or
--   * one of two admins is removed while the other is no longer live, or a
--     teacher or parent joins a group whose admins are all gone.
--
-- Decided by the department head under the owner's Phase 1 delegation
-- (2026-11-02): raise a Needs-action task, route it to the group's
-- supervisor (else the Operations manager), settle it when an admin rejoins.
-- PD-47's system-task pattern, as PR-6b's teacher_unsupervised:
--
--   source_type         key                               assignee                            due
--   group_admin_absent  group_admin_absent:<spell>        the group's child's live Operations  absent since
--                                                         supervisor, else the Operations      + 24 h
--                                                         manager, else the super admin
--
--   operational, HIGH (teachers and parents are refused while it is open),
--   the generic floor; reassignable by hand. Announced with the generic
--   task_assigned, whose rule row exists; no new rule key.
--
--   THE STATE is the API's rule, read the same way (chat.group_admin_absent):
--   a student, class or family group, not archived, with a live teacher
--   member and a live parent (contact) member, and no live admin member whose
--   staff record is active and has not left. One SPELL
--   (chat.work_task_group_admin_spell) per stretch in that state; a later
--   stretch is a fresh spell and a fresh task.
--   DONE when an admin is present again, by who did it: the staff member who
--   added the admin member, else that admin themself (an admin reactivated,
--   or added by the system). WITHDRAWN when the group no longer pairs a
--   teacher with a parent, or is archived; back if it does again.
--
--   RAISED by chat.work_task_sweep_group_admin() (the worker, every minute,
--   its own advisory lock and batches), past PR-6a's settle window: an
--   offboarding that hands the group to another admin in the same request
--   must not announce a task already done. The triggers open the spell at
--   the moment the group enters the state, so the due time is exact.
--   COMPLETED at once by triggers on chat.conversation_member and chat.staff
--   (one function per table), never blocking the source's write; the sweep
--   re-reads the evidence. OWNERS who leave: an open task moves to the
--   group's owner now, else an `orphaned:` issue.
--
--   Cut-off (as every source): tasks.since.group_admin_absent, the last 14
--   days at switch-on.
--
--   Never in a task: a message. Tasks names the group by id and reads its
--   title behind sign-in.
--
-- FAIL CLOSED: the spell table has RLS and no grants; every function is
-- revoked from public and pins its search_path.

-- ===========================================================================
-- 1. The state, and who it belongs to
-- ===========================================================================

-- A group that pairs a live teacher member with a live parent member.
create or replace function chat.group_pairs_teacher_and_parent(p_conversation uuid)
returns boolean
language sql
stable
set search_path = chat, pg_temp
as $$
  select exists (
    select 1 from chat.conversation c
     where c.id = p_conversation
       and c.type in ('student_group', 'class_group', 'family_group')
       and c.archived_at is null
       and exists (select 1 from chat.conversation_member m
                    where m.conversation_id = c.id and m.left_at is null and m.actor_kind = 'teacher')
       and exists (select 1 from chat.conversation_member m
                    where m.conversation_id = c.id and m.left_at is null and m.actor_kind = 'contact'));
$$;

-- A live admin: an admin member row whose staff record is active and has not
-- left (IdentityService: isActive = is_active and left_at is null).
create or replace function chat.group_admin_present(p_conversation uuid)
returns boolean
language sql
stable
set search_path = chat, pg_temp
as $$
  select exists (
    select 1 from chat.conversation_member m
      join chat.staff s on s.id = m.actor_id
     where m.conversation_id = p_conversation and m.left_at is null
       and m.actor_kind = 'staff' and m.member_role = 'admin'
       and s.is_active and s.left_at is null);
$$;

-- BR-1's refused state: AuthorizationService.requireAdminPresence denies the
-- teacher's and the parent's sends in exactly these groups.
create or replace function chat.group_admin_absent(p_conversation uuid)
returns boolean
language sql
stable
set search_path = chat, pg_temp
as $$
  select chat.group_pairs_teacher_and_parent(p_conversation) and not chat.group_admin_present(p_conversation);
$$;

-- Since when a group has been in the state, as well as the records tell it
-- (a spell a trigger opened knows exactly): the last admin to go, the last
-- admin member removed, or the last member to join. Null when not absent.
create or replace function chat.group_admin_absent_since(p_conversation uuid)
returns timestamptz
language sql
stable
set search_path = chat, pg_temp
as $$
  select case when chat.group_admin_absent(p_conversation) then
    (select max(x.at) from (
       select coalesce(s.left_at, s.updated_at) as at
         from chat.conversation_member m join chat.staff s on s.id = m.actor_id
        where m.conversation_id = p_conversation and m.left_at is null
          and m.actor_kind = 'staff' and m.member_role = 'admin'
       union all
       select m.left_at from chat.conversation_member m
        where m.conversation_id = p_conversation and m.left_at is not null
          and m.actor_kind = 'staff' and m.member_role = 'admin'
       union all
       select m.joined_at from chat.conversation_member m
        where m.conversation_id = p_conversation and m.left_at is null) x)
  end;
$$;

-- The group's owner: its child's live Operations supervisor (a student
-- group's own child; a family group's first child, as
-- work_task_group_owner reads it), else the Operations manager, else the
-- super admin.
create or replace function chat.work_task_group_admin_owner(p_conversation uuid)
returns uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select coalesce(
    (select ls.supervisor_id
       from chat.conversation c
       join chat.learner l on l.id = c.learner_id or (c.learner_id is null and l.family_id = c.family_id)
       join chat.learner_supervision ls on ls.learner_id = l.id
       join chat.staff s on s.id = ls.supervisor_id and s.is_active and s.left_at is null
      where c.id = p_conversation
      order by l.created_at, l.id
      limit 1),
    chat.work_task_operations_manager((select c.organization_id from chat.conversation c where c.id = p_conversation)));
$$;

-- One stretch of a group without a live admin: the task's source.
create table chat.work_task_group_admin_spell (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references chat.organization (id),
  conversation_id uuid not null references chat.conversation (id) on delete cascade,
  opened_at       timestamptz not null default clock_timestamp(),
  closed_at       timestamptz
);

comment on table chat.work_task_group_admin_spell is
  'AMB-9: one stretch of a group pairing a teacher with a parent and no live admin -- the source of a group_admin_absent task. Closed when an admin is present again.';

create unique index work_task_group_admin_spell_one_open on chat.work_task_group_admin_spell (conversation_id) where closed_at is null;

-- A group that has just entered the state: its spell opens now. Nothing if
-- it is not absent, or already in a spell.
create or replace function chat.work_task_open_group_admin_spell(p_conversation uuid)
returns void
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  insert into chat.work_task_group_admin_spell (organization_id, conversation_id, opened_at)
  select c.organization_id, c.id, clock_timestamp()
    from chat.conversation c
   where c.id = p_conversation and chat.group_admin_absent(c.id)
  on conflict (conversation_id) where closed_at is null do nothing;
end;
$$;

-- Who the task belongs to now (its source is the spell).
create or replace function chat.work_task_group_admin_spell_owner(p_spell uuid)
returns uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select chat.work_task_group_admin_owner(sp.conversation_id) from chat.work_task_group_admin_spell sp where sp.id = p_spell;
$$;

-- Who brought an admin back: the staff member who added the newest live
-- admin member, else that admin themself.
create or replace function chat.group_admin_returned_by(p_conversation uuid)
returns uuid
language sql
stable
set search_path = chat, pg_temp
as $$
  select coalesce(m.added_by, m.actor_id)
    from chat.conversation_member m
    join chat.staff s on s.id = m.actor_id and s.is_active and s.left_at is null
   where m.conversation_id = p_conversation and m.left_at is null
     and m.actor_kind = 'staff' and m.member_role = 'admin'
   order by m.joined_at desc, m.id
   limit 1;
$$;

-- What the spell says of its work now: 'done' (with who did it), 'gone' (the
-- group no longer pairs a teacher with a parent), or 'back' (still absent).
create or replace function chat.work_task_group_admin_verdict(p_spell uuid, out verdict text, out actor uuid)
language plpgsql
stable
set search_path = chat, pg_temp
as $$
declare
  v_conversation uuid;
begin
  select sp.conversation_id into v_conversation from chat.work_task_group_admin_spell sp where sp.id = p_spell;
  if v_conversation is null or not chat.group_pairs_teacher_and_parent(v_conversation) then
    verdict := 'gone';
  elsif chat.group_admin_present(v_conversation) then
    verdict := 'done';
    actor := chat.group_admin_returned_by(v_conversation);
  else
    verdict := 'back';
  end if;
end;
$$;

-- ===========================================================================
-- 2. The raise
-- ===========================================================================

-- The group's open spell, or a fresh one; its task raised once.
create or replace function chat.work_task_raise_group_admin_absent(p_conversation uuid)
returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  c        chat.conversation;
  v_since  timestamptz;
  v_opened timestamptz;
  v_spell  uuid;
  v_owner  uuid;
begin
  -- One writer per group, without waiting: a busy group is the next sweep's.
  if not pg_try_advisory_xact_lock(hashtextextended('chat.work_task_group_admin_spell:' || p_conversation, 0)) then
    return null;
  end if;
  select * into c from chat.conversation where id = p_conversation;
  v_since := chat.group_admin_absent_since(p_conversation);
  if c.id is null or v_since is null then
    return null;
  end if;
  select sp.id, sp.opened_at into v_spell, v_opened
    from chat.work_task_group_admin_spell sp where sp.conversation_id = c.id and sp.closed_at is null;
  v_since := coalesce(v_opened, v_since);
  if v_since < chat.work_task_since('group_admin_absent') then
    return null;
  end if;
  if v_spell is null then
    insert into chat.work_task_group_admin_spell (organization_id, conversation_id, opened_at)
    values (c.organization_id, c.id, v_since)
    on conflict (conversation_id) where closed_at is null do nothing
    returning id into v_spell;
    if v_spell is null then
      select sp.id into v_spell from chat.work_task_group_admin_spell sp where sp.conversation_id = c.id and sp.closed_at is null;
    end if;
  end if;
  v_owner := chat.work_task_group_admin_owner(c.id);
  if v_owner is null then
    perform chat.work_task_note_issue(c.organization_id, 'group_admin_absent:' || v_spell, 'no live supervisor, Operations manager or super admin');
    return null;
  end if;
  return chat.work_task_raise(c.organization_id, 'group_admin_absent', v_spell, v_owner, null,
                              'high', 'operational', 'generic', v_since + interval '24 hours');
end;
$$;

-- ===========================================================================
-- 3. The sweep: create what is missing, reconcile what is done
-- ===========================================================================

-- As chat.work_task_sweep_handover: at most p_batch (capped at 60) rows per
-- call, each its own subtransaction; `more` says another batch is waiting;
-- one sweep at a time (an advisory lock). Returns the counts.
create or replace function chat.work_task_sweep_group_admin(p_batch integer default 50)
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
  v_rerouted  integer := 0;
  v_orphaned  integer := 0;
  v_more      boolean := false;
  r           record;
  v_settle    interval := chat.work_task_settle_window();
  s_group     timestamptz;
begin
  if not pg_try_advisory_xact_lock(hashtext('chat.work_task_sweep_group_admin')) then
    return jsonb_build_object('skipped', true);
  end if;
  s_group := chat.work_task_since('group_admin_absent');

  -- The issue log shrinks with this source too: an occurrence whose task
  -- closed, or whose work is done or gone.
  delete from chat.work_task_source_issue i
   where split_part(i.source_key, ':', 1) = 'group_admin_absent'
     and (exists (select 1 from chat.work_task t
                   where t.organization_id = i.organization_id and t.source_key = i.source_key
                     and t.state in ('completed', 'removed'))
          or (select v.verdict from chat.work_task_group_admin_verdict(split_part(i.source_key, ':', 2)::uuid) v)
             is distinct from 'back'
          -- An orphan given an owner again, or whose assignee is live after all.
          or i.reason like 'orphaned:%'
             and exists (select 1 from chat.work_task t
                          where t.organization_id = i.organization_id and t.source_key = i.source_key
                            and (chat.task_principal_kind(coalesce(t.assignee_staff_id, t.assignee_teacher_id), t.organization_id) is not null
                                 or chat.work_task_group_admin_spell_owner(t.source_id) is not null)));
  -- A spell whose group has an admin again (or no longer pairs a teacher with
  -- a parent), its task never raised or already closed, closes.
  update chat.work_task_group_admin_spell sp set closed_at = clock_timestamp()
   where sp.closed_at is null and not chat.group_admin_absent(sp.conversation_id)
     and not exists (select 1 from chat.work_task t where t.organization_id = sp.organization_id
                       and t.source_key = 'group_admin_absent:' || sp.id and t.state in ('open', 'awaiting_decision'));

  -- Create. A candidate is the group (the raise's argument); its key is the
  -- open spell's, else one named by the group (never an empty id: the issue
  -- log reads every key's id as a uuid).
  for r in
    select x.org, x.id, x.key from (
      select c.organization_id as org, c.id, 'group_admin_absent:' || coalesce(sp.id, c.id) as key,
             coalesce(sp.opened_at, chat.group_admin_absent_since(c.id)) as at
        from chat.conversation c
        left join chat.work_task_group_admin_spell sp on sp.conversation_id = c.id and sp.closed_at is null
       where c.type in ('student_group', 'class_group', 'family_group') and c.archived_at is null
         and chat.group_admin_absent(c.id)
    ) x
     where x.at >= s_group and x.at <= now() - v_settle
       and not exists (select 1 from chat.work_task t where t.organization_id = x.org and t.source_key = x.key)
       and not exists (select 1 from chat.work_task_source_issue i
                        where i.organization_id = x.org and i.source_key = x.key and i.next_try_at > now())
     order by x.at
     limit v_left + 1
  loop
    if v_left = 0 then v_more := true; exit; end if;
    v_left := v_left - 1;
    begin
      if chat.work_task_raise_group_admin_absent(r.id) is not null then
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
      select t.organization_id as org, t.source_key as key, t.source_id as spell, t.source_state, v.verdict, v.actor
        from chat.work_task t
        cross join lateral chat.work_task_group_admin_verdict(t.source_id) v
       where t.kind = 'system' and t.state in ('open', 'awaiting_decision') and t.source_type = 'group_admin_absent'
    ) y
     where y.source_state = 'pending' and y.verdict in ('done', 'gone')
        or y.source_state = 'withdrawn' and y.verdict in ('back', 'done')
     limit v_left + 1
  loop
    if v_left = 0 then v_more := true; exit; end if;
    v_left := v_left - 1;
    begin
      if r.verdict = 'done' then
        update chat.work_task_group_admin_spell set closed_at = clock_timestamp() where id = r.spell and closed_at is null;
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

  -- Owners: an open task whose assignee left moves to the group's owner now.
  -- A live assignee keeps it (a person's hand-on stands).
  for r in
    select t.organization_id as org, t.source_key as key, chat.work_task_group_admin_spell_owner(t.source_id) as owner
      from chat.work_task t
     where t.kind = 'system' and t.state in ('open', 'awaiting_decision') and t.source_type = 'group_admin_absent'
       and chat.task_principal_kind(coalesce(t.assignee_staff_id, t.assignee_teacher_id), t.organization_id) is null
       and chat.work_task_group_admin_spell_owner(t.source_id) is not null
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

  -- An assignee who left with nobody live to follow: recorded (with its
  -- back-off) for whoever may reassign it.
  for r in
    select t.organization_id as org, t.source_key as key
      from chat.work_task t
     where t.kind = 'system' and t.state in ('open', 'awaiting_decision') and t.source_type = 'group_admin_absent'
       and chat.task_principal_kind(coalesce(t.assignee_staff_id, t.assignee_teacher_id), t.organization_id) is null
       and chat.work_task_group_admin_spell_owner(t.source_id) is null
       and not exists (select 1 from chat.work_task_source_issue i
                        where i.organization_id = t.organization_id and i.source_key = t.source_key and i.next_try_at > now())
     limit v_left + 1
  loop
    if v_left = 0 then v_more := true; exit; end if;
    v_left := v_left - 1;
    perform chat.work_task_note_issue(r.org, r.key,
      'orphaned: its assignee left and nobody live follows (the group''s supervisor, the Operations manager, the super admin): reassign it');
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

-- An admin present again settles the group's task (spell closed), by who
-- added them, else the admin themself. Any other membership change may put
-- the group into the state: its spell opens now.
create or replace function chat.work_task_group_admin_from_member()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_org   uuid;
  v_spell uuid;
begin
  select c.organization_id into v_org from chat.conversation c
   where c.id = new.conversation_id and c.type in ('student_group', 'class_group', 'family_group');
  if v_org is null then
    return null;
  end if;
  begin
    if new.left_at is null and new.actor_kind = 'staff' and new.member_role = 'admin'
       and chat.group_admin_present(new.conversation_id) then
      update chat.work_task_group_admin_spell set closed_at = clock_timestamp()
       where conversation_id = new.conversation_id and closed_at is null
      returning id into v_spell;
      if v_spell is not null then
        perform chat.work_task_settle(v_org, 'group_admin_absent:' || v_spell, coalesce(new.added_by, new.actor_id));
      end if;
    else
      perform chat.work_task_open_group_admin_spell(new.conversation_id);
    end if;
  exception when others then
    perform chat.work_task_note_issue(v_org, 'group_admin_absent:' || coalesce(v_spell, new.conversation_id), sqlerrm);
  end;
  return null;
end;
$$;

create trigger conversation_member_moves_group_admin_task after insert or update of left_at, member_role on chat.conversation_member
  for each row execute function chat.work_task_group_admin_from_member();

-- A staff member who stops being live opens a spell in each group they were
-- the admin of that is left with none; one live again settles each group
-- they are an admin member of, by themself.
create or replace function chat.work_task_group_admin_from_staff()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  r       record;
  v_spell uuid;
begin
  for r in
    select m.conversation_id, c.organization_id as org
      from chat.conversation_member m
      join chat.conversation c on c.id = m.conversation_id and c.type in ('student_group', 'class_group', 'family_group')
     where m.actor_id = new.id and m.left_at is null and m.actor_kind = 'staff' and m.member_role = 'admin'
  loop
    v_spell := null;
    begin
      if new.is_active and new.left_at is null then
        if chat.group_admin_present(r.conversation_id) then
          update chat.work_task_group_admin_spell set closed_at = clock_timestamp()
           where conversation_id = r.conversation_id and closed_at is null
          returning id into v_spell;
          if v_spell is not null then
            perform chat.work_task_settle(r.org, 'group_admin_absent:' || v_spell, new.id);
          end if;
        end if;
      else
        perform chat.work_task_open_group_admin_spell(r.conversation_id);
      end if;
    exception when others then
      perform chat.work_task_note_issue(r.org, 'group_admin_absent:' || coalesce(v_spell, r.conversation_id), sqlerrm);
    end;
  end loop;
  return null;
end;
$$;

create trigger staff_liveness_moves_group_admin_tasks after update of is_active, left_at on chat.staff
  for each row
  when ((old.is_active and old.left_at is null) is distinct from (new.is_active and new.left_at is null))
  execute function chat.work_task_group_admin_from_staff();

-- ===========================================================================
-- 5. Fail closed
-- ===========================================================================

alter table chat.work_task_group_admin_spell enable row level security;
revoke all on chat.work_task_group_admin_spell from public, anon, authenticated, chat_app;

revoke all on function chat.group_pairs_teacher_and_parent(uuid) from public;
revoke all on function chat.group_admin_present(uuid) from public;
revoke all on function chat.group_admin_absent(uuid) from public;
revoke all on function chat.group_admin_absent_since(uuid) from public;
revoke all on function chat.group_admin_returned_by(uuid) from public;
revoke all on function chat.work_task_group_admin_owner(uuid) from public;
revoke all on function chat.work_task_open_group_admin_spell(uuid) from public;
revoke all on function chat.work_task_group_admin_spell_owner(uuid) from public;
revoke all on function chat.work_task_group_admin_verdict(uuid) from public;
revoke all on function chat.work_task_raise_group_admin_absent(uuid) from public;
revoke all on function chat.work_task_sweep_group_admin(integer) from public;
revoke all on function chat.work_task_group_admin_from_member() from public;
revoke all on function chat.work_task_group_admin_from_staff() from public;
