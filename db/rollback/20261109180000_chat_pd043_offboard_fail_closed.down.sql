-- Roll back 20261109180000_chat_pd043_offboard_fail_closed (PD-43, review of #566).
--
-- Restores chat.offboard_teacher exactly as 20261028200000 defined it (its
-- NULL-permissive authorization check included). No data is touched.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261109180000_chat_pd043_offboard_fail_closed.down.sql

create or replace function chat.offboard_teacher(
  p_teacher           uuid,
  p_reason            text,
  p_cancelled_lessons uuid[],
  p_actor_id          uuid default null
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
  if exists (select 1 from chat.lesson l where l.teacher_id = v_teacher.id and l.outcome is null and l.starts_at >= now()) then
    raise exception 'this teacher has open lessons; cancel them first' using errcode = 'check_violation';
  end if;
  -- What the API says it cancelled for this offboarding: this teacher's, and closed.
  if exists (select 1 from unnest(coalesce(p_cancelled_lessons, '{}'::uuid[])) c(id)
              where not exists (select 1 from chat.lesson l
                                 where l.id = c.id and l.teacher_id = v_teacher.id and l.outcome is not null)) then
    raise exception 'a cancelled lesson named for this offboarding is not this teacher''s, or is still open' using errcode = 'check_violation';
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
          jsonb_build_object('cancelledLessons', to_jsonb(coalesce(p_cancelled_lessons, '{}'::uuid[]))),
          v_reason);
  return jsonb_build_object('accountId', v_teacher.account_id, 'supervisorId', v_supervisor);
end;
$$;

revoke all on function chat.offboard_teacher(uuid, text, uuid[], uuid) from public;
