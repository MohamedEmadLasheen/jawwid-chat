-- =============================================================================
-- Ownership functions: repair the event write, AFTER the actor boundary
-- =============================================================================
--
-- Depends on 20261014090000_chat_ownership_actor_boundary.sql, which must be
-- applied first: until the acting staff member is established rather than
-- claimed, these functions failing outright was the only thing stopping a
-- spoofed actor from completing a transfer. This migration makes them work.
--
-- TWO DEFECTS, both pre-existing, both fatal on every path (the owner's too):
--   1. chat.log_event(p_type, p_family_id, p_actor_type, p_actor_id, p_payload)
--      declared RETURNS uuid and did `returning id into v_id uuid`, but
--      chat.event_log.id is a bigint identity: every call raised
--      "invalid input syntax for type uuid". It now returns the bigint id.
--      Every caller uses PERFORM (the value is discarded) except
--      chat.dispute_attention_order, which is frozen attention machinery and was
--      already broken by its own call -- left as it is.
--      Changing a return type needs DROP + CREATE; the arguments, SECURITY
--      DEFINER and search_path are unchanged, and execution is re-revoked from
--      the request roles below (CREATE FUNCTION grants PUBLIC by default).
--   2. chat.transfer_ownership and chat.offboard_staff called log_event with the
--      pre-OD-01 six-argument form (with a case_id). They now use the current
--      five-argument form. Event semantics are unchanged: type
--      'ownership_transferred', actor type 'staff', the TRUSTED actor, the same
--      payload. Bodies are otherwise identical to 20261014090000.
--
-- ROLLBACK: none that restores a broken function is useful; to undo, re-run
-- 20261014090000's bodies (they fail closed at log_event).
-- =============================================================================

drop function chat.log_event(text, uuid, text, uuid, jsonb);

create function chat.log_event(
  p_type       text,
  p_family_id  uuid  default null,
  p_actor_type text  default 'system',
  p_actor_id   uuid  default null,
  p_payload    jsonb default '{}'::jsonb
) returns bigint
language plpgsql
security definer
set search_path = chat, pg_temp
as $$
declare
  v_id bigint;
begin
  insert into chat.event_log (family_id, actor_type, actor_id, type, payload)
  values (p_family_id, p_actor_type, p_actor_id, p_type, coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function chat.log_event(text, uuid, text, uuid, jsonb) from public, anon, authenticated, chat_app;

create or replace function chat.transfer_ownership(
  p_family_id    uuid,
  p_to_staff_id  uuid,
  p_reason       text,
  p_actor_id     uuid default null
) returns void
language plpgsql
as $$
declare
  v_actor uuid := chat.trusted_staff_actor(p_actor_id);
  v_from  uuid;
  v_name  text;
  v_org   uuid;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'ownership transfer requires a reason'
      using errcode = 'check_violation';
  end if;

  select organization_id into v_org from chat.family where id = p_family_id;
  if v_org is null then
    raise exception 'family % does not exist', p_family_id using errcode = 'no_data_found';
  end if;

  -- Brief SS2: transferring ownership is a manager action -- of THIS tenant.
  perform chat.require_active_manager(v_actor, v_org, 'transfer ownership');

  if not exists (select 1 from chat.staff
                 where id = p_to_staff_id and is_active and role in ('admin', 'coverage')) then
    raise exception 'the new owner must be an active admin or coverage admin'
      using errcode = 'check_violation';
  end if;

  select owner_id, display_name into v_from, v_name
  from chat.family where id = p_family_id for update;

  if v_from = p_to_staff_id then
    return;  -- already owned by the target; nothing to record
  end if;

  perform set_config('chat.transferring_ownership', 'on', true);
  update chat.family set owner_id = p_to_staff_id where id = p_family_id;
  perform set_config('chat.transferring_ownership', 'off', true);

  -- Same transaction as the change itself (brief SS3).
  perform chat.write_audit(
    v_actor, 'ownership_transferred', 'family', p_family_id, p_reason,
    jsonb_build_object('owner_id', v_from),
    jsonb_build_object('owner_id', p_to_staff_id));

  perform chat.log_event(
    'ownership_transferred', p_family_id, 'staff', v_actor,
    jsonb_build_object('from_staff_id', v_from, 'to_staff_id', p_to_staff_id,
                       'reason', p_reason, 'family_name', v_name));
end;
$$;

create or replace function chat.offboard_staff(
  p_staff_id    uuid,
  p_reason      text,
  p_to_staff_id uuid default null,
  p_actor_id    uuid default null
) returns table (family_id uuid, new_owner_id uuid)
language plpgsql
as $$
declare
  v_actor      uuid := chat.trusted_staff_actor(p_actor_id);
  v_org        uuid;
  v_targets    uuid[];
  v_family     record;
  v_index      integer := 0;
  v_new_owner  uuid;
  v_orphaned   integer;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'offboarding requires a reason' using errcode = 'check_violation';
  end if;

  select organization_id into v_org from chat.staff where id = p_staff_id;
  if v_org is null then
    raise exception 'staff member % does not exist', p_staff_id using errcode = 'no_data_found';
  end if;
  perform chat.require_active_manager(v_actor, v_org, 'offboard staff');
  if v_actor = p_staff_id then
    raise exception 'a manager cannot offboard themselves' using errcode = 'insufficient_privilege';
  end if;

  if p_to_staff_id is not null then
    v_targets := array[p_to_staff_id];
  else
    -- Brief SS8: "transfer families evenly or to a named admin". This is a
    -- one-off manager action on a fixed set of families, NOT the runtime
    -- routing that brief SS12 forbids -- no message and no live family is ever
    -- assigned this way.
    select array_agg(s.id order by owned.n, s.name)
      into v_targets
      from chat.staff s
      left join lateral (
        select count(*) as n from chat.family f where f.owner_id = s.id
      ) owned on true
     where s.is_active and s.role in ('admin', 'coverage') and s.id <> p_staff_id
       and s.organization_id = v_org;
  end if;

  if v_targets is null or cardinality(v_targets) = 0 then
    raise exception 'no active admin is available to take over these families'
      using errcode = 'restrict_violation';
  end if;

  for v_family in
    select id from chat.family where owner_id = p_staff_id order by display_name
  loop
    v_new_owner := v_targets[(v_index % cardinality(v_targets)) + 1];
    perform chat.transfer_ownership(
      v_family.id, v_new_owner,
      format('offboarding: %s', p_reason), v_actor);
    v_index := v_index + 1;
    family_id := v_family.id;
    new_owner_id := v_new_owner;
    return next;
  end loop;

  update chat.staff
     set is_active = false, left_at = coalesce(left_at, now()), presence = 'offline'
   where id = p_staff_id;

  -- Coverage rules pointing at, or covering, someone who has left are not
  -- deleted: the manager is shown them and decides (brief SS8).
  select count(*) into v_orphaned
    from chat.coverage_rule r
   where r.covering_id = p_staff_id or r.covered_id = p_staff_id;

  perform chat.write_audit(
    v_actor, 'staff_offboarded', 'staff', p_staff_id, p_reason,
    jsonb_build_object('is_active', true),
    jsonb_build_object('is_active', false,
                       'families_transferred', v_index,
                       'orphaned_coverage_rules', v_orphaned));

  perform chat.log_event(
    'ownership_transferred', null, 'staff', v_actor,
    jsonb_build_object('offboarded_staff_id', p_staff_id,
                       'families_transferred', v_index,
                       'orphaned_coverage_rules', v_orphaned));
end;
$$;

do $assert$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'chat_app'] loop
    if has_function_privilege(v_role, 'chat.log_event(text, uuid, text, uuid, jsonb)', 'EXECUTE')
       or has_function_privilege(v_role, 'chat.transfer_ownership(uuid, uuid, text, uuid)', 'EXECUTE')
       or has_function_privilege(v_role, 'chat.offboard_staff(uuid, text, uuid, uuid)', 'EXECUTE') then
      raise exception '% can execute an ownership function after the repair', v_role;
    end if;
  end loop;
end
$assert$;
