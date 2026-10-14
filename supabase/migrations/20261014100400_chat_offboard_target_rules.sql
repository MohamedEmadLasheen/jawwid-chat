-- =============================================================================
-- offboard_staff: the TARGET must be within a manager's authority
-- =============================================================================
--
-- Depends on 20261014090100 (whose body this repeats with one added rule).
--
-- 20261014090000 established WHO may offboard (an active manager of the same
-- organization, never a caller-named one). It did not restrict WHOM: on the
-- server-side path a manager could deactivate another manager or the super
-- admin -- locking the organization owner out. The canonical rules (Admin
-- Profile task 7A: a manager must not modify another manager's account or the
-- super admin) and the reporting-line hierarchy (20261013150000) both say the
-- target must be below the manager. Now: a target whose role is manager or
-- super_admin is refused before anything is read or written. Everything else in
-- the body is identical to 20261014090100.
-- =============================================================================

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
  v_target_role text;
  v_targets    uuid[];
  v_family     record;
  v_index      integer := 0;
  v_new_owner  uuid;
  v_orphaned   integer;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'offboarding requires a reason' using errcode = 'check_violation';
  end if;

  select organization_id, role into v_org, v_target_role from chat.staff where id = p_staff_id;
  if v_org is null then
    raise exception 'staff member % does not exist', p_staff_id using errcode = 'no_data_found';
  end if;
  -- A manager offboards the people they may manage. Another manager and the
  -- super admin are outside that authority (7A rules 4-5; the super admin's
  -- own lifecycle belongs to the bootstrap procedure).
  if v_target_role in ('manager', 'super_admin') then
    raise exception 'a manager cannot offboard another manager or the super admin'
      using errcode = 'insufficient_privilege';
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

revoke execute on function chat.offboard_staff(uuid, text, uuid, uuid) from public, anon, authenticated, chat_app;
