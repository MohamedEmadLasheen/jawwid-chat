-- =============================================================================
-- Ownership policy: families.assign, family transfer, deactivation -- separately
-- =============================================================================
--
-- Depends on 20261014090000 (trusted_staff_actor), 20261014090100 (five-argument
-- log_event), 20261014100400 (offboard target rules) and 20261013120000
-- (super_admin). Forward-only; replaces three function bodies, adds two
-- functions and two authority helpers. No table DDL, no data touched.
--
-- THE POLICY (approved 2026-10-14, AUTHORIZATION-MODEL §3):
--   families.assign       -> manager or super_admin of the organization
--                            (chat.transfer_ownership, chat.assign_family_owner)
--   family transfer while offboarding
--                         -> manager or super_admin
--                            (chat.transfer_staff_families -- NEW; moves a staff
--                            member's families, never touches their account)
--   staff deactivation    -> super_admin only (users.manage)
--                            (chat.deactivate_staff -- NEW)
--   offboard_staff        -> transfer + deactivate in ONE transaction, so it
--                            needs BOTH authorities: super_admin only. A manager
--                            runs transfer_staff_families and leaves deactivation
--                            to the super admin.
--   Nobody may deactivate the super_admin (the organization owner) or
--   themselves; a manager may not move another manager's or the super admin's
--   families. Every actor is chat.trusted_staff_actor(p_actor_id): never
--   caller-named on a request role, required and explicit on the server side.
--
-- WHY offboard_staff KEEPS ITS SIGNATURE: callers that exist (none in apps/, the
-- legacy Admin Web screen) keep compiling; only who may run it narrows, which is
-- the approved policy. All functions stay SECURITY INVOKER, server-side only.
-- =============================================================================

create or replace function chat.require_family_assigner(p_actor_id uuid, p_organization_id uuid, p_action text)
returns text
language plpgsql
stable
set search_path = chat, pg_temp
as $$
declare
  v_role text;
begin
  select s.role into v_role from chat.staff s
   where s.id = p_actor_id and s.is_active and s.left_at is null
     and s.organization_id = p_organization_id
     and s.role in ('manager', 'super_admin');
  if v_role is null then
    raise exception 'only an active manager or the super admin of this organization may %', p_action
      using errcode = 'insufficient_privilege';
  end if;
  return v_role;
end;
$$;

create or replace function chat.require_super_admin(p_actor_id uuid, p_organization_id uuid, p_action text)
returns void
language plpgsql
stable
set search_path = chat, pg_temp
as $$
begin
  if not exists (select 1 from chat.staff s
                  where s.id = p_actor_id and s.is_active and s.left_at is null
                    and s.organization_id = p_organization_id and s.role = 'super_admin') then
    raise exception 'only the super admin of this organization may %', p_action
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- families.assign
-- ---------------------------------------------------------------------------

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

  perform chat.require_family_assigner(v_actor, v_org, 'transfer ownership');

  if not exists (select 1 from chat.staff
                 where id = p_to_staff_id and is_active and left_at is null
                   and role in ('admin', 'coverage') and organization_id = v_org) then
    raise exception 'the new owner must be an active admin or coverage admin of this organization'
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

create or replace function chat.assign_family_owner(
  p_core_parent_id uuid,
  p_owner_id       uuid,
  p_reason         text,
  p_actor_id       uuid default null
) returns uuid
language plpgsql
as $$
declare
  v_actor           uuid := chat.trusted_staff_actor(p_actor_id);
  v_inbox           chat.core_parent_inbox%rowtype;
  v_family_id       uuid;
  v_contact         uuid;
  v_conversation_id uuid;
  v_org             uuid;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'assigning an owner requires a reason' using errcode = 'check_violation';
  end if;
  select organization_id into v_org from chat.staff where id = p_owner_id;
  perform chat.require_family_assigner(v_actor, v_org, 'assign a family owner');
  if not exists (select 1 from chat.staff
                 where id = p_owner_id and is_active and left_at is null and role in ('admin', 'coverage')) then
    raise exception 'the owner must be an active admin or coverage admin'
      using errcode = 'check_violation';
  end if;

  select * into v_inbox from chat.core_parent_inbox where core_parent_id = p_core_parent_id;
  if not found then
    raise exception 'no waiting Jawwid Core parent with id %', p_core_parent_id
      using errcode = 'no_data_found';
  end if;

  insert into chat.family (display_name, owner_id, language, core_parent_id)
  values (coalesce(v_inbox.display_name, 'Family'), p_owner_id,
          coalesce(v_inbox.language, 'ar'), p_core_parent_id)
  returning id into v_family_id;

  insert into chat.contact (family_id, name, relationship, role_preset,
                            can_message, can_view_progress, can_manage_schedule,
                            can_manage_billing, can_manage_contacts, can_cancel)
  values (v_family_id, coalesce(v_inbox.display_name, 'Parent'), 'parent',
          'primary_guardian', true, true, true, true, true, true)
  returning id into v_contact;

  update chat.family set primary_contact_id = v_contact where id = v_family_id;

  insert into chat.conversation (type, family_id, direct_key, title)
  values ('direct', v_family_id, 'family:' || v_family_id::text, 'Jawwid')
  returning id into v_conversation_id;

  insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
  values (v_conversation_id, 'contact', v_contact, 'parent');

  insert into chat.conversation_member (conversation_id, actor_kind, actor_id, member_role)
  values (v_conversation_id, 'staff', p_owner_id, 'admin');

  delete from chat.core_parent_inbox where core_parent_id = p_core_parent_id;

  perform chat.write_audit(v_actor, 'family_owner_assigned', 'family', v_family_id, p_reason,
                           null, jsonb_build_object('owner_id', p_owner_id));
  perform chat.log_event('subscription_synced', v_family_id, 'staff', v_actor,
                         jsonb_build_object('created', true, 'core_parent_id', p_core_parent_id));
  return v_family_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Offboarding, part 1: move a staff member's families (families.assign)
-- ---------------------------------------------------------------------------

create or replace function chat.transfer_staff_families(
  p_staff_id    uuid,
  p_reason      text,
  p_to_staff_id uuid default null,
  p_actor_id    uuid default null
) returns table (family_id uuid, new_owner_id uuid)
language plpgsql
as $$
declare
  v_actor       uuid := chat.trusted_staff_actor(p_actor_id);
  v_actor_role  text;
  v_org         uuid;
  v_target_role text;
  v_targets     uuid[];
  v_family      record;
  v_index       integer := 0;
  v_new_owner   uuid;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'moving families requires a reason' using errcode = 'check_violation';
  end if;
  select organization_id, role into v_org, v_target_role from chat.staff where id = p_staff_id;
  if v_org is null then
    raise exception 'staff member % does not exist', p_staff_id using errcode = 'no_data_found';
  end if;
  v_actor_role := chat.require_family_assigner(v_actor, v_org, 'move a staff member''s families');
  -- A manager acts on the people they may manage; the super admin on anyone.
  if v_actor_role = 'manager' and v_target_role in ('manager', 'super_admin') then
    raise exception 'a manager cannot move another manager''s or the super admin''s families'
      using errcode = 'insufficient_privilege';
  end if;

  if p_to_staff_id is not null then
    v_targets := array[p_to_staff_id];
  else
    select array_agg(s.id order by owned.n, s.name)
      into v_targets
      from chat.staff s
      left join lateral (
        select count(*) as n from chat.family f where f.owner_id = s.id
      ) owned on true
     where s.is_active and s.left_at is null and s.role in ('admin', 'coverage')
       and s.id <> p_staff_id and s.organization_id = v_org;
  end if;

  for v_family in
    select f.id from chat.family f where f.owner_id = p_staff_id order by f.display_name
  loop
    if v_targets is null or cardinality(v_targets) = 0 then
      raise exception 'no active admin is available to take over these families'
        using errcode = 'restrict_violation';
    end if;
    v_new_owner := v_targets[(v_index % cardinality(v_targets)) + 1];
    perform chat.transfer_ownership(v_family.id, v_new_owner, format('offboarding: %s', p_reason), v_actor);
    v_index := v_index + 1;
    family_id := v_family.id;
    new_owner_id := v_new_owner;
    return next;
  end loop;

  perform chat.write_audit(
    v_actor, 'staff_families_transferred', 'staff', p_staff_id, p_reason,
    null, jsonb_build_object('families_transferred', v_index));
end;
$$;

-- ---------------------------------------------------------------------------
-- Offboarding, part 2: deactivate the account (users.manage, super admin)
-- ---------------------------------------------------------------------------

create or replace function chat.deactivate_staff(
  p_staff_id uuid,
  p_reason   text,
  p_actor_id uuid default null
) returns void
language plpgsql
as $$
declare
  v_actor       uuid := chat.trusted_staff_actor(p_actor_id);
  v_org         uuid;
  v_target_role text;
  v_orphaned    integer;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'deactivation requires a reason' using errcode = 'check_violation';
  end if;
  select organization_id, role into v_org, v_target_role from chat.staff where id = p_staff_id;
  if v_org is null then
    raise exception 'staff member % does not exist', p_staff_id using errcode = 'no_data_found';
  end if;
  perform chat.require_super_admin(v_actor, v_org, 'deactivate a staff account');
  if v_target_role = 'super_admin' or v_actor = p_staff_id then
    -- Never the organization owner, never oneself: no lock-out through this path.
    raise exception 'the super admin cannot be deactivated, and nobody deactivates themselves'
      using errcode = 'insufficient_privilege';
  end if;

  -- chat.guard_staff_deactivation still refuses while any family is owned.
  update chat.staff
     set is_active = false, left_at = coalesce(left_at, now()), presence = 'offline'
   where id = p_staff_id;

  select count(*) into v_orphaned
    from chat.coverage_rule r
   where r.covering_id = p_staff_id or r.covered_id = p_staff_id;

  perform chat.write_audit(
    v_actor, 'staff_deactivated', 'staff', p_staff_id, p_reason,
    jsonb_build_object('is_active', true),
    jsonb_build_object('is_active', false, 'orphaned_coverage_rules', v_orphaned));
end;
$$;

-- ---------------------------------------------------------------------------
-- offboard_staff: both parts, one transaction, super admin only
-- ---------------------------------------------------------------------------

create or replace function chat.offboard_staff(
  p_staff_id    uuid,
  p_reason      text,
  p_to_staff_id uuid default null,
  p_actor_id    uuid default null
) returns table (family_id uuid, new_owner_id uuid)
language plpgsql
as $$
declare
  v_actor uuid := chat.trusted_staff_actor(p_actor_id);
  v_org   uuid;
  v_moved integer := 0;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'offboarding requires a reason' using errcode = 'check_violation';
  end if;
  select organization_id into v_org from chat.staff where id = p_staff_id;
  if v_org is null then
    raise exception 'staff member % does not exist', p_staff_id using errcode = 'no_data_found';
  end if;
  -- Deactivation is part of offboarding, so the whole operation is the super
  -- admin's. Checked first: a manager is refused before any family moves.
  perform chat.require_super_admin(v_actor, v_org, 'offboard (deactivate) a staff account');

  for family_id, new_owner_id in
    select t.family_id, t.new_owner_id from chat.transfer_staff_families(p_staff_id, p_reason, p_to_staff_id, v_actor) t
  loop
    v_moved := v_moved + 1;
    return next;
  end loop;

  perform chat.deactivate_staff(p_staff_id, p_reason, v_actor);

  perform chat.write_audit(
    v_actor, 'staff_offboarded', 'staff', p_staff_id, p_reason,
    jsonb_build_object('is_active', true),
    jsonb_build_object('is_active', false, 'families_transferred', v_moved));

  perform chat.log_event(
    'ownership_transferred', null, 'staff', v_actor,
    jsonb_build_object('offboarded_staff_id', p_staff_id, 'families_transferred', v_moved));
end;
$$;

-- ---------------------------------------------------------------------------
-- Execution: server-side only (helpers callable for the defence-in-depth path)
-- ---------------------------------------------------------------------------

revoke execute on function chat.transfer_staff_families(uuid, text, uuid, uuid) from public, anon, authenticated, chat_app;
revoke execute on function chat.deactivate_staff(uuid, text, uuid)               from public, anon, authenticated, chat_app;
revoke execute on function chat.transfer_ownership(uuid, uuid, text, uuid)       from public, anon, authenticated, chat_app;
revoke execute on function chat.assign_family_owner(uuid, uuid, text, uuid)      from public, anon, authenticated, chat_app;
revoke execute on function chat.offboard_staff(uuid, text, uuid, uuid)           from public, anon, authenticated, chat_app;
revoke execute on function chat.require_family_assigner(uuid, uuid, text)        from public, anon;
revoke execute on function chat.require_super_admin(uuid, uuid, text)            from public, anon;
grant  execute on function chat.require_family_assigner(uuid, uuid, text)        to authenticated;
grant  execute on function chat.require_super_admin(uuid, uuid, text)            to authenticated;

do $assert$
declare
  v_role text;
  v_fn   text;
begin
  foreach v_role in array array['anon', 'authenticated', 'chat_app'] loop
    foreach v_fn in array array[
      'chat.transfer_staff_families(uuid, text, uuid, uuid)', 'chat.deactivate_staff(uuid, text, uuid)',
      'chat.transfer_ownership(uuid, uuid, text, uuid)', 'chat.assign_family_owner(uuid, uuid, text, uuid)',
      'chat.offboard_staff(uuid, text, uuid, uuid)'] loop
      if has_function_privilege(v_role, v_fn, 'EXECUTE') then
        raise exception '% can execute %', v_role, v_fn;
      end if;
    end loop;
  end loop;
end
$assert$;
