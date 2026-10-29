-- =============================================================================
-- PD-43 · change a teacher's sign-in e-mail (plan §3.3, §4)
--
--   chat.change_teacher_sign_in(teacher, email, reason, actor)
--       While the login waits for its first sign-in: the reissue rule
--       (chat.may_give_teacher_sign_in -- the super admin, the Teachers
--       manager, the teacher's CURRENT supervisor). Once it has been used: the
--       super admin only. The same duplicate checks as adding a teacher; every
--       live code of the login is retired; the Teacher File's e-mail follows
--       only when it was the sign-in. Audited as teacher.sign_in_changed,
--       without either address. Returns { accountId, status } (the status
--       before): the API issues a new first sign-in code to the NEW address
--       for a waiting login, or ends every session of a used one, in the same
--       transaction.
--
-- Every refusal but the super-admin rule is check_violation (Prisma drops a
-- unique_violation's text).
-- =============================================================================

create function chat.change_teacher_sign_in(
  p_teacher  uuid,
  p_email    text,
  p_reason   text,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_actor   chat.staff%rowtype;
  v_teacher chat.teacher%rowtype;
  v_account chat.account%rowtype;
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_reason  text := coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'sign-in e-mail changed');
begin
  select * into v_actor from chat.staff where id = chat.trusted_staff_actor(p_actor_id);
  if v_actor.id is null or not v_actor.is_active or v_actor.left_at is not null then
    raise exception 'only an active staff member changes a teacher''s sign-in' using errcode = 'insufficient_privilege';
  end if;

  perform pg_advisory_xact_lock(hashtext('pd043:teacher:' || coalesce(p_teacher::text, '')));
  select * into v_teacher from chat.teacher where id = p_teacher for update;
  -- Reach first: a teacher the caller may not act for is not found, whatever its state.
  if v_teacher.id is null or v_teacher.organization_id is distinct from v_actor.organization_id
     or not chat.may_give_teacher_sign_in(v_actor.id, v_teacher.id) then
    raise exception 'no such teacher for you to change the sign-in of' using errcode = 'check_violation';
  end if;
  if not v_teacher.is_active or v_teacher.left_at is not null then
    raise exception 'an inactive teacher''s sign-in is not changed' using errcode = 'check_violation';
  end if;
  if v_teacher.account_id is null then
    raise exception 'this teacher has no sign-in to change' using errcode = 'check_violation';
  end if;

  select * into v_account from chat.account where id = v_teacher.account_id for update;
  if v_account.status = 'deactivated' then
    raise exception 'this sign-in is closed' using errcode = 'check_violation';
  end if;
  if v_account.status = 'suspended' then
    raise exception 'this sign-in is suspended' using errcode = 'check_violation';
  end if;
  if v_account.status <> 'provisioned' and v_actor.role <> 'super_admin' then
    raise exception 'only the super admin changes a sign-in that has been used' using errcode = 'insufficient_privilege';
  end if;

  if length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'the sign-in e-mail is an e-mail address' using errcode = 'check_violation';
  end if;
  if v_email = lower(v_account.subject) then
    raise exception 'this is already the sign-in' using errcode = 'check_violation';
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

  update chat.account set subject = v_email where id = v_account.id;
  -- The Teacher File's e-mail follows only when it was the sign-in.
  update chat.teacher_file set email = v_email, updated_by = v_actor.id
   where teacher_id = v_teacher.id and lower(email) = lower(v_account.subject);
  -- A code sent to the old address dies with it.
  update chat.password_reset_code set superseded_at = now()
   where account_id = v_account.id and used_at is null and superseded_at is null;

  insert into chat.audit_log (actor_id, action, entity, entity_id, before, after, reason)
  values (v_actor.id, 'teacher.sign_in_changed', 'teacher', v_teacher.id,
          jsonb_build_object('accountId', v_account.id, 'accountStatus', v_account.status),
          jsonb_build_object('accountId', v_account.id),
          v_reason);
  return jsonb_build_object('accountId', v_account.id, 'status', v_account.status);
end;
$$;

revoke all on function chat.change_teacher_sign_in(uuid, text, text, uuid) from public;
