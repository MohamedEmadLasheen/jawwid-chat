-- =============================================================================
-- PD-56 · O-3 · LR-46 P3-5 (defence in depth): the database decides who closes
-- and deletes a teacher's account, as the API does.
--
-- chat.complete_account_deletion_request (20261107140000) checked that the
-- staff member was live and of the request's organization, but not their role:
-- the rule lived only in TeacherDeletionRequestController (route permission
-- teachers.offboard, and PD-43's decideTeacherOnboarding().canOffboard: the
-- super admin, or a manager who runs the Teachers department). Any server-side
-- caller naming a Teachers supervisor, the Operations manager or the Sales
-- manager would have erased the teacher.
--
-- The permission has a SQL representation (PD-40 chat.staff_has_permission,
-- PD-12 chat.teachers_department_role), so the check is now inside the
-- function, exactly the predicate chat.offboard_teacher (20261028200000) uses:
--
--   live staff of the request's organization
--   AND chat.staff_has_permission(staff, 'teachers.offboard')
--   AND (role = 'super_admin'
--        OR (role = 'manager' AND chat.teachers_department_role(staff) = 'manager'))
--
-- Fail closed: anything else raises insufficient_privilege before anything is
-- written. The deadline path (via 'deadline', no staff) is unchanged.
--
-- EXECUTE stays revoked from every request role (public, anon, authenticated,
-- chat_app): only the API's server-side connection calls it, and
-- chat.caller_is_server_side() still refuses anything else. Asserted below.
--
-- Nothing else changes: the body is 20261107140000's but for the staff check.
-- Idempotent (create or replace; revokes; a read-only assertion).
-- Rollback: db/rollback/20261109170000_chat_deletion_request_staff_role.down.sql.
-- =============================================================================

create or replace function chat.complete_account_deletion_request(p_request uuid, p_staff uuid, p_via text)
returns jsonb
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_req     chat.account_deletion_request;
  v_staff   chat.staff;
  v_left    jsonb;
  v_erasure jsonb;
begin
  if not chat.caller_is_server_side() then
    raise exception 'only the server completes a deletion request' using errcode = 'insufficient_privilege';
  end if;
  if p_via not in ('staff', 'deadline') or (p_via = 'staff') <> (p_staff is not null) then
    raise exception 'a deletion request is completed by staff or at its deadline' using errcode = 'check_violation';
  end if;
  -- The account first, then the request: the order chat.erase_account (the
  -- holder's own deletion) and chat.request_account_deletion take them in.
  perform 1 from chat.account a
   where a.id = (select q.account_id from chat.account_deletion_request q where q.id = p_request)
     for update;
  select * into v_req from chat.account_deletion_request where id = p_request for update;
  if v_req.id is null then
    raise exception 'no such deletion request' using errcode = 'no_data_found';
  end if;
  if v_req.state <> 'pending' then
    raise exception 'this deletion request is %', v_req.state using errcode = 'check_violation';
  end if;
  if p_via = 'deadline' and v_req.deadline_at > now() then
    raise exception 'this deletion request is not due yet' using errcode = 'check_violation';
  end if;
  if p_via = 'staff' then
    -- LR-46 P3-5: PD-43's offboarding rule, as chat.offboard_teacher and the
    -- controller apply it -- the super admin, or the Teachers manager --,
    -- holding teachers.offboard (PD-40), live, of the request's organization.
    select * into v_staff from chat.staff s where s.id = p_staff;
    if v_staff.id is null or v_staff.organization_id is distinct from v_req.organization_id
       or not v_staff.is_active or v_staff.left_at is not null
       -- coalesce: a NULL anywhere must refuse, never skip the refusal (an IF on NULL is false).
       or not coalesce(chat.staff_has_permission(v_staff.id, 'teachers.offboard'), false)
       or not coalesce(v_staff.role = 'super_admin'
               or (v_staff.role = 'manager'
                   and coalesce(chat.teachers_department_role(v_staff.id), '') = 'manager'), false) then
      raise exception 'only the Teachers manager or the super admin closes and deletes a teacher''s account'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  v_left := chat.teacher_deletion_left_open(v_req.account_id);
  perform chat.account_deletion_request_close(v_req.id, p_via, p_staff, v_left);
  perform set_config('chat.erasing_on_request', v_req.account_id::text, true);
  v_erasure := chat.erase_account(v_req.account_id,
                                  case p_via when 'staff' then 'deletion request closed by staff'
                                             else 'deletion request reached its 30-day deadline' end,
                                  '{}'::text[]);
  perform set_config('chat.erasing_on_request', '', true);
  return v_erasure || jsonb_build_object('requestId', v_req.id, 'leftOpen', v_left);
end;
$$;

comment on function chat.complete_account_deletion_request(uuid, uuid, text) is
  'PD-56 O-3: completes a pending teacher deletion request and runs the erasure past its gate. Via staff: the super '
  'admin or the Teachers manager holding teachers.offboard, live, of the request''s organization (LR-46 P3-5, as '
  'chat.offboard_teacher). Via deadline: no staff, only once deadline_at passed. Server-side callers only.';

revoke all on function chat.complete_account_deletion_request(uuid, uuid, text) from public, anon, authenticated, chat_app;

-- ---------------------------------------------------------------------------
-- Prove it inside the migration: no request role may execute it.
-- ---------------------------------------------------------------------------
do $assert$
declare
  v_role text;
begin
  foreach v_role in array array['chat_app', 'authenticated', 'anon'] loop
    if exists (select 1 from pg_roles where rolname = v_role)
       and has_function_privilege(v_role, 'chat.complete_account_deletion_request(uuid, uuid, text)', 'EXECUTE') then
      raise exception 'LR-46: % can execute chat.complete_account_deletion_request', v_role;
    end if;
  end loop;
end
$assert$;
