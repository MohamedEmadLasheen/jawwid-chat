-- =============================================================================
-- PD-43 PR-1b · a teacher leaves, comes back, and the set-up checklist
--
-- Plan: docs/product/pd043-teacher-onboarding-plan.md §3.5, §3.6.
--
--   1. chat.teacher gets chat.staff's rule (staff_left_at_matches_is_active):
--      an inactive teacher has a leaving date. A writer that takes a teacher
--      out without one gets now(); a writer that brings one back has it
--      cleared. An active row with a date stays legal, as on staff: it is
--      already "not live" everywhere (identity.service, relationship.service).
--      NOT VALID first, validated once the rows that disagreed have a date.
--   2. chat.offboard_teacher: the Teachers manager or the super admin
--      (teachers.offboard), never while a student remains (the ladder's rule,
--      now in SQL), never over open lessons unless the caller confirms their
--      cancellation; the audit row names each one.
--      Closes the teacher AND the login (the discipline ladder left the login
--      active), retires any waiting code, ends the supervisor link, audits.
--      The API revokes the sessions in the same transaction and cancels the
--      lessons after it, as the ladder does.
--   3. chat.reactivate_teacher: the super admin only (owner Q6). The same
--      teacher; a closed login waits again (provisioned) for a first sign-in
--      code the API issues in the same transaction.
--   4. chat.teacher_setup_state: what the Teacher File's checklist shows,
--      read from the real rows, never stored. Done / not done only: no amount.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. is_active and left_at agree
-- ---------------------------------------------------------------------------
create function chat.normalize_teacher_left_at()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if not new.is_active and new.left_at is null then
    new.left_at := now();
  elsif new.is_active and new.left_at is not null and tg_op = 'UPDATE' and not old.is_active then
    -- Brought back without clearing the date: they are not leaving.
    new.left_at := null;
  end if;
  return new;
end;
$$;

create trigger teacher_left_at_follows_is_active
  before insert or update of is_active, left_at on chat.teacher
  for each row execute function chat.normalize_teacher_left_at();

-- The rows that disagreed: an inactive teacher left when the row last changed.
update chat.teacher set left_at = updated_at where not is_active and left_at is null;

alter table chat.teacher add constraint teacher_left_at_matches_is_active
  check (is_active or left_at is not null) not valid;

do $$
begin
  if not exists (select 1 from chat.teacher where not is_active and left_at is null) then
    alter table chat.teacher validate constraint teacher_left_at_matches_is_active;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Offboarding
-- ---------------------------------------------------------------------------
create function chat.offboard_teacher(
  p_teacher             uuid,
  p_reason              text,
  p_cancel_open_lessons boolean,
  p_actor_id            uuid default null
) returns jsonb
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_actor      chat.staff%rowtype;
  v_teacher    chat.teacher%rowtype;
  v_account    chat.account%rowtype;
  v_reason     text := btrim(coalesce(p_reason, ''));
  v_supervisor uuid;
begin
  select * into v_actor from chat.staff where id = chat.trusted_staff_actor(p_actor_id);
  if v_actor.id is null or not v_actor.is_active or v_actor.left_at is not null
     or not chat.staff_has_permission(v_actor.id, 'teachers.offboard')
     or not (v_actor.role = 'super_admin'
             or (v_actor.role = 'manager' and chat.teachers_department_role(v_actor.id) = 'manager')) then
    raise exception 'only the Teachers manager or the super admin offboards a teacher' using errcode = 'insufficient_privilege';
  end if;
  if length(v_reason) not between 1 and 500 then
    raise exception 'offboarding requires a reason' using errcode = 'check_violation';
  end if;

  select * into v_teacher from chat.teacher where id = p_teacher for update;
  if v_teacher.id is null or v_teacher.organization_id is distinct from v_actor.organization_id then
    raise exception 'no such teacher to offboard' using errcode = 'check_violation';
  end if;
  if not v_teacher.is_active then
    raise exception 'this teacher has already left' using errcode = 'check_violation';
  end if;
  if exists (select 1 from chat.learner l where l.teacher_id = v_teacher.id) then
    raise exception 'move this teacher''s students to other teachers first' using errcode = 'check_violation';
  end if;
  if not coalesce(p_cancel_open_lessons, false)
     and exists (select 1 from chat.lesson l where l.teacher_id = v_teacher.id and l.outcome is null and l.starts_at >= now()) then
    raise exception 'this teacher has open lessons; cancel them with the offboarding' using errcode = 'check_violation';
  end if;

  -- The login: closed, whatever state it was in; a waiting code dies with it.
  if v_teacher.account_id is not null then
    select * into v_account from chat.account where id = v_teacher.account_id for update;
    if v_account.status = 'active' then
      perform chat.deactivate_principal('account', v_account.id, 'offboarded: ' || v_reason, v_actor.id, 'deactivated');
    elsif v_account.status in ('provisioned', 'suspended') then
      update chat.account set status = 'deactivated', is_active = false, deactivated_at = coalesce(deactivated_at, now())
       where id = v_account.id;
    end if;
    update chat.password_reset_code set superseded_at = now()
     where account_id = v_account.id and used_at is null and superseded_at is null;
  end if;

  perform chat.deactivate_principal('teacher', v_teacher.id, 'offboarded: ' || v_reason, v_actor.id, 'deactivated');
  delete from chat.teacher_supervisor_assignment where teacher_id = v_teacher.id returning supervisor_id into v_supervisor;

  insert into chat.audit_log (actor_id, action, entity, entity_id, before, after, reason)
  values (v_actor.id, 'teacher.offboarded', 'teacher', v_teacher.id,
          jsonb_build_object('supervisorId', v_supervisor, 'accountStatus', v_account.status),
          -- What the actor confirmed: the lessons ahead, each one, cancelled after the commit.
          jsonb_build_object('cancelOpenLessons', coalesce(p_cancel_open_lessons, false),
                             'openLessons', coalesce((select jsonb_agg(l.id order by l.starts_at) from chat.lesson l
                                                       where l.teacher_id = v_teacher.id and l.outcome is null and l.starts_at >= now()),
                                                     '[]'::jsonb)),
          v_reason);
  return jsonb_build_object('accountId', v_teacher.account_id, 'supervisorId', v_supervisor);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Reactivation
-- ---------------------------------------------------------------------------
create function chat.reactivate_teacher(
  p_teacher  uuid,
  p_reason   text,
  p_actor_id uuid default null
) returns uuid
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_actor   chat.staff%rowtype;
  v_teacher chat.teacher%rowtype;
  v_reason  text := btrim(coalesce(p_reason, ''));
begin
  select * into v_actor from chat.staff where id = chat.trusted_staff_actor(p_actor_id);
  if v_actor.id is null or not v_actor.is_active or v_actor.left_at is not null
     or v_actor.role <> 'super_admin' or not chat.staff_has_permission(v_actor.id, 'teachers.offboard') then
    raise exception 'only the super admin reactivates a former teacher' using errcode = 'insufficient_privilege';
  end if;
  if length(v_reason) not between 1 and 500 then
    raise exception 'reactivation requires a reason' using errcode = 'check_violation';
  end if;
  select * into v_teacher from chat.teacher where id = p_teacher for update;
  if v_teacher.id is null or v_teacher.organization_id is distinct from v_actor.organization_id then
    raise exception 'no such teacher to reactivate' using errcode = 'check_violation';
  end if;
  if v_teacher.is_active then
    raise exception 'this teacher is active' using errcode = 'check_violation';
  end if;

  update chat.teacher set is_active = true, left_at = null where id = v_teacher.id;
  -- The login waits again for a first sign-in code: no old password comes back.
  if v_teacher.account_id is not null then
    update chat.account set status = 'provisioned', is_active = false, deactivated_at = null, deactivated_by = null
     where id = v_teacher.account_id;
  end if;

  insert into chat.audit_log (actor_id, action, entity, entity_id, before, after, reason)
  values (v_actor.id, 'teacher.reactivated', 'teacher', v_teacher.id, null,
          jsonb_build_object('accountId', v_teacher.account_id), v_reason);
  return v_teacher.account_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The set-up checklist
-- ---------------------------------------------------------------------------
create function chat.teacher_setup_state(p_teacher uuid)
returns jsonb
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  with t as (select * from chat.teacher where id = p_teacher),
       pattern as (
         select w.category from chat.teacher_work_pattern w, t
          where w.teacher_id = t.id and w.valid_from <= chat.academy_today()
            and (w.valid_to is null or w.valid_to > chat.academy_today())
       ),
       terms as (
         select p.salary_type from chat.teacher_pay_terms p, t
          where p.teacher_id = t.id and p.effective_month <= chat.academy_month(now())
          order by p.effective_month desc, p.created_at desc
          limit 1
       )
  select jsonb_build_object(
    'signedIn', coalesce((select a.status = 'active' from chat.account a where a.id = t.account_id), false),
    'supervisor', exists (
      select 1 from chat.teacher_supervisor_assignment a
        join chat.staff s on s.id = a.supervisor_id and s.is_active and s.left_at is null
        join chat.department_member m on m.staff_id = s.id and m.position = 'supervisor'
        join chat.department d on d.id = m.department_id and d.kind = 'teachers'
       where a.teacher_id = t.id),
    'contact', exists (select 1 from chat.teacher_file f where f.teacher_id = t.id and num_nonnulls(f.phone, f.email) > 0),
    'payTerms', exists (select 1 from terms),
    'payoutAccount', exists (select 1 from chat.teacher_payout_account o where o.teacher_id = t.id),
    'leaveAllowance', exists (
      select 1 from chat.teacher_leave_allowance l
       where l.teacher_id = t.id and l.leave_year = extract(year from chat.academy_today())::int),
    'shift', exists (select 1 from pattern),
    'availability', exists (select 1 from chat.teacher_availability v where v.teacher_id = t.id)
                    or exists (select 1 from pattern where category = 'hourly'),
    'profile', exists (select 1 from chat.teacher_professional_profile pp where pp.teacher_id = t.id),
    -- PD-38's category and PD-18's salary type say the same thing: hourly is hourly.
    'payMatchesShift', not exists (
      select 1 from pattern, terms where (pattern.category = 'hourly') <> (terms.salary_type = 'hourly'))
  )
  from t;
$$;

-- ---------------------------------------------------------------------------
-- Server-only
-- ---------------------------------------------------------------------------
revoke all on function chat.normalize_teacher_left_at() from public;
revoke all on function chat.offboard_teacher(uuid, text, boolean, uuid) from public;
revoke all on function chat.reactivate_teacher(uuid, text, uuid) from public;
revoke all on function chat.teacher_setup_state(uuid) from public;
