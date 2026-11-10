-- Roll back 20261109170000_chat_deletion_request_staff_role.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261109170000_chat_deletion_request_staff_role.down.sql
--
-- Restores chat.complete_account_deletion_request exactly as 20261107140000
-- defined it: the staff member only live and of the request's organization,
-- the role checked by the API alone (TeacherDeletionRequestController). No data
-- is touched. EXECUTE stays revoked from every request role: never re-grant it.

create or replace function chat.complete_account_deletion_request(p_request uuid, p_staff uuid, p_via text)
returns jsonb
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_req     chat.account_deletion_request;
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
  if p_via = 'staff' and not exists (select 1 from chat.staff s where s.id = p_staff and s.organization_id = v_req.organization_id
                                                                   and s.is_active and s.left_at is null) then
    raise exception 'a deletion request is completed by live staff of its organization' using errcode = 'insufficient_privilege';
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

comment on function chat.complete_account_deletion_request(uuid, uuid, text) is null;

revoke all on function chat.complete_account_deletion_request(uuid, uuid, text) from public;
