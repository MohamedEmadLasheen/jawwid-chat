-- =============================================================================
-- PD-43 · "Give sign-in": a login for a teacher who exists but has none
--
-- Teachers inserted before PD-43 (and the Core-migration intake) have a
-- chat.teacher row and no account_id, so they can never sign in. This gives
-- one a provisioned login IN PLACE: the same teacher, students and history.
-- Plan: docs/product/pd043-teacher-onboarding-plan.md §3.9.
--
--   chat.may_give_teacher_sign_in(staff, teacher)
--       who may: PD-40's teachers.create, and the same rule as adding a
--       teacher -- the super admin, the Teachers manager, or a teacher
--       supervisor who reaches the teacher (every teacher with PD-35's strict
--       scope off; their own -- self or active backup -- with it on).
--   chat.give_teacher_sign_in(teacher, email, reason, actor)
--       one login, under an advisory lock on the teacher (two calls at once
--       make one); the Teacher File's e-mail only when it has none; audited as
--       teacher.sign_in_given without the e-mail. The first sign-in code is
--       issued by the API in the same transaction, which
--       chat.may_issue_teacher_first_login admits through that audit row.
--
-- Every refusal is check_violation (Prisma drops a unique_violation's text).
-- =============================================================================

create function chat.may_give_teacher_sign_in(p_staff uuid, p_teacher uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1
      from chat.staff s
      join chat.teacher t on t.id = p_teacher and t.organization_id = s.organization_id
     where s.id = p_staff and s.is_active and s.left_at is null
       and chat.staff_has_permission(s.id, 'teachers.create')
       and (s.role = 'super_admin'
            or (s.role = 'manager' and chat.teachers_department_role(s.id) = 'manager')
            or (s.role in ('admin', 'coverage') and chat.teachers_department_role(s.id) = 'member'
                and (not chat.teacher_scope_strict() or chat.staff_teacher_scope(s.id, t.id) in ('self', 'backup'))))
  );
$$;

create function chat.give_teacher_sign_in(
  p_teacher  uuid,
  p_email    text,
  p_reason   text,
  p_actor_id uuid default null
) returns uuid
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_actor   chat.staff%rowtype;
  v_teacher chat.teacher%rowtype;
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_reason  text := coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'sign-in given to an existing teacher');
  v_account uuid;
begin
  select * into v_actor from chat.staff where id = chat.trusted_staff_actor(p_actor_id);
  if v_actor.id is null or not v_actor.is_active or v_actor.left_at is not null then
    raise exception 'only an active staff member gives a teacher a sign-in' using errcode = 'insufficient_privilege';
  end if;

  -- Two calls for one teacher at once: the second waits, then finds the login.
  perform pg_advisory_xact_lock(hashtext('pd043:teacher:' || coalesce(p_teacher::text, '')));
  select * into v_teacher from chat.teacher where id = p_teacher for update;
  -- Reach first: a teacher the caller may not give a sign-in to is not found.
  if v_teacher.id is null or v_teacher.organization_id is distinct from v_actor.organization_id
     or not chat.may_give_teacher_sign_in(v_actor.id, v_teacher.id) then
    raise exception 'no such teacher for you to give a sign-in' using errcode = 'check_violation';
  end if;
  if not v_teacher.is_active or v_teacher.left_at is not null then
    raise exception 'an inactive teacher gets no sign-in' using errcode = 'check_violation';
  end if;
  if v_teacher.account_id is not null then
    raise exception 'this teacher already has a sign-in' using errcode = 'check_violation';
  end if;

  if length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'the sign-in e-mail is an e-mail address' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext('pd043:sign-in:' || v_email));
  -- Never a name, a kind or a family: the API decides what the caller may be told.
  if exists (select 1 from chat.account a where lower(a.subject) = v_email) then
    raise exception 'this e-mail already signs in to Chat' using errcode = 'check_violation';
  end if;
  if exists (select 1 from chat.teacher_file f
              where f.organization_id = v_teacher.organization_id and f.teacher_id <> v_teacher.id
                and lower(f.email) = v_email) then
    raise exception 'this contact is already on a teacher''s file' using errcode = 'check_violation';
  end if;

  insert into chat.account (organization_id, subject, kind, status, is_active)
  values (v_teacher.organization_id, v_email, 'teacher', 'provisioned', false)
  returning id into v_account;
  update chat.teacher set account_id = v_account where id = v_teacher.id;

  -- The Teacher File's e-mail only when it has none: one already on file stays.
  if exists (select 1 from chat.teacher_file f where f.teacher_id = v_teacher.id) then
    update chat.teacher_file set email = v_email, updated_by = v_actor.id
     where teacher_id = v_teacher.id and email is null;
  else
    insert into chat.teacher_file (teacher_id, organization_id, email, updated_by)
    values (v_teacher.id, v_teacher.organization_id, v_email, v_actor.id);
  end if;

  insert into chat.audit_log (actor_id, action, entity, entity_id, before, after, reason)
  values (v_actor.id, 'teacher.sign_in_given', 'teacher', v_teacher.id,
          jsonb_build_object('accountId', null),
          jsonb_build_object('accountId', v_account),
          v_reason);
  return v_account;
end;
$$;

revoke all on function chat.may_give_teacher_sign_in(uuid, uuid) from public;
revoke all on function chat.give_teacher_sign_in(uuid, text, text, uuid) from public;
