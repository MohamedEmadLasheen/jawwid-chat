-- =============================================================================
-- Ownership functions: the acting staff member is established, never claimed
-- =============================================================================
--
-- THE DEFECT (pre-existing since 20260905090700 / 20260905090900)
--   chat.transfer_ownership(), chat.offboard_staff() and
--   chat.assign_family_owner() authorized with
--       v_actor := coalesce(p_actor_id, chat.current_staff_id());
--       if chat.staff_role(v_actor) is distinct from 'manager' then raise ...
--   p_actor_id is a PARAMETER. All three are SECURITY INVOKER and, through the
--   default PUBLIC grant, executable by anon, authenticated and chat_app. So any
--   connection could name any manager and pass the check -- and the audit row
--   would then name that manager. Verified 2026-10-13 as chat_app with an admin
--   subject (rolled back): transfer_ownership passed the check and executed the
--   family UPDATE and the audit write; it aborted only on an unrelated bug in
--   chat.log_event (repaired by 20261014090100, AFTER this boundary exists).
--
--   The same boundary was bypassable without the function: chat.family's
--   owner_id was updatable by authenticated, and chat.guard_owner_change trusts
--   the session variable chat.transferring_ownership, which any connection can
--   set for itself. Verified as chat_app (rolled back): an admin set the
--   variable and took another supervisor's families with a plain UPDATE.
--
--   chat.write_audit() and chat.log_event() are SECURITY DEFINER, take the actor
--   as a parameter and were executable by anon/authenticated: any connection
--   could append audit or event rows naming anyone. write_audit also had no
--   fixed search_path; it gets one here.
--
-- THE IDENTITY RULE APPLIED (chat.trusted_staff_actor)
--   * Server-side callers -- a superuser, the table owner, or a member of
--     service_role (chat_service) -- are the boundary themselves: the API has
--     already authenticated the actor and passes it explicitly. p_actor_id is
--     REQUIRED on this path (no session fallback: the owner has no subject).
--   * Every other caller is a request role. Its actor is
--     chat.current_staff_id() -- the same identity every RLS policy uses
--     (RLS-STRATEGY §3). p_actor_id may be omitted or equal to it; naming
--     anyone else is refused before anything is read or written.
--   On both paths the actor must be an ACTIVE manager in the SAME organization
--   as the record acted on. The role rule itself is unchanged (manager), so no
--   authority is added or removed.
--
-- WHO MAY EXECUTE
--   Execution of the five functions is revoked from PUBLIC, anon,
--   authenticated and chat_app. No code in apps/ calls any of them; the
--   legitimate path is server-side (owner connection). The request-role branch
--   of trusted_staff_actor is defence in depth for the day a request-path grant
--   is re-added deliberately.
--
-- chat.family.owner_id is no longer updatable by the request role (column
-- privileges, like 20261013160000 for chat.staff); every other family column
-- keeps exactly the access it had. family_owner_is_guarded is unchanged.
--
-- WHAT THIS DOES NOT DO
--   No signature changes (callers keep their argument lists), no execution-mode
--   change (all three stay SECURITY INVOKER), no policy edits, no data touched.
--   chat.log_event is NOT repaired here; see 20261014090100.
--
-- ROLLBACK
--   Do not restore the PUBLIC execute grants or the owner_id column grant: that
--   restores the spoofing. A request-path caller, if ever needed, gets an
--   explicit grant on the function and keeps trusted_staff_actor.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Who is calling, and who is acting
-- ---------------------------------------------------------------------------

create or replace function chat.caller_is_server_side()
returns boolean
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select r.rolsuper
      or pg_has_role(current_user, (select c.relowner from pg_class c where c.oid = 'chat.family'::regclass), 'MEMBER')
      or pg_has_role(current_user, 'service_role', 'MEMBER')
    from pg_roles r
   where r.rolname = current_user
$$;

comment on function chat.caller_is_server_side() is
  'True for a superuser, the chat table owner, or a member of service_role. Everything else -- anon, authenticated, chat_app -- is a request role.';

create or replace function chat.trusted_staff_actor(p_actor_id uuid)
returns uuid
language plpgsql
stable
set search_path = chat, pg_temp
as $$
declare
  v_session uuid;
begin
  if chat.caller_is_server_side() then
    if p_actor_id is null then
      raise exception 'a server-side caller must name the authenticated actor'
        using errcode = 'insufficient_privilege';
    end if;
    return p_actor_id;
  end if;

  v_session := chat.current_staff_id();
  if v_session is null then
    raise exception 'no authenticated staff member in this session'
      using errcode = 'insufficient_privilege';
  end if;
  if p_actor_id is not null and p_actor_id is distinct from v_session then
    raise exception 'p_actor_id may not name another staff member'
      using errcode = 'insufficient_privilege';
  end if;
  return v_session;
end;
$$;

comment on function chat.trusted_staff_actor(uuid) is
  'The acting staff member: the explicit actor on a server-side path, the session staff member on a request role. A request role can never name somebody else.';

-- The authority check shared by the three functions: an active manager of the
-- given organization.
create or replace function chat.require_active_manager(p_actor_id uuid, p_organization_id uuid, p_action text)
returns void
language plpgsql
stable
set search_path = chat, pg_temp
as $$
begin
  if not exists (
    select 1 from chat.staff s
     where s.id = p_actor_id
       and s.role = 'manager'
       and s.is_active and s.left_at is null
       and s.organization_id = p_organization_id
  ) then
    raise exception 'only an active manager of this organization may %', p_action
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The three functions: same signatures, same bodies, trusted actor
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
    'ownership_transferred', p_family_id, null, 'staff', v_actor,
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
    'ownership_transferred', null, null, 'staff', v_actor,
    jsonb_build_object('offboarded_staff_id', p_staff_id,
                       'families_transferred', v_index,
                       'orphaned_coverage_rules', v_orphaned));
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
  -- The new family is created in the owner's organization; the actor must
  -- manage that organization.
  select organization_id into v_org from chat.staff where id = p_owner_id;
  perform chat.require_active_manager(v_actor, v_org, 'assign a family owner');
  if not exists (select 1 from chat.staff
                 where id = p_owner_id and is_active and role in ('admin', 'coverage')) then
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

  -- The family's one persistent "Jawwid" conversation. Coverage changes who
  -- answers in it; it is never replaced (PRD §5.2).
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
-- 3. Execution: server-side only
-- ---------------------------------------------------------------------------

revoke execute on function chat.transfer_ownership(uuid, uuid, text, uuid)  from public, anon, authenticated, chat_app;
revoke execute on function chat.offboard_staff(uuid, text, uuid, uuid)      from public, anon, authenticated, chat_app;
revoke execute on function chat.assign_family_owner(uuid, uuid, text, uuid) from public, anon, authenticated, chat_app;
revoke execute on function chat.write_audit(uuid, text, text, uuid, text, jsonb, jsonb) from public, anon, authenticated, chat_app;
revoke execute on function chat.log_event(text, uuid, text, uuid, jsonb)    from public, anon, authenticated, chat_app;
-- write_audit is SECURITY DEFINER and had no fixed search_path; it is fully
-- schema-qualified, but a definer function should not depend on the caller's.
alter function chat.write_audit(uuid, text, text, uuid, text, jsonb, jsonb) set search_path = chat, pg_temp;
revoke execute on function chat.require_active_manager(uuid, uuid, text)    from public, anon;
grant  execute on function chat.require_active_manager(uuid, uuid, text)    to authenticated;
grant  execute on function chat.caller_is_server_side()                     to authenticated;
grant  execute on function chat.trusted_staff_actor(uuid)                   to authenticated;

-- ---------------------------------------------------------------------------
-- 4. chat.family.owner_id: not writable by the request role
-- ---------------------------------------------------------------------------
-- Replace the table-level UPDATE with a column-level one covering every column
-- that had it, except owner_id. Columns are enumerated from the catalog so a
-- column added later is not silently granted.

do $family$
declare
  v_had_table_update boolean := has_table_privilege('authenticated', 'chat.family', 'UPDATE');
  v_cols text;
begin
  if v_had_table_update then
    revoke update on chat.family from authenticated;
    select string_agg(quote_ident(attname), ', ' order by attnum) into v_cols
      from pg_attribute
     where attrelid = 'chat.family'::regclass and attnum > 0 and not attisdropped
       and attname <> 'owner_id';
    execute format('grant update (%s) on chat.family to authenticated', v_cols);
  end if;
  revoke update (owner_id) on chat.family from authenticated, chat_app, public;
end
$family$;

-- ---------------------------------------------------------------------------
-- 5. Prove it inside the migration
-- ---------------------------------------------------------------------------

do $assert$
declare
  v_role text;
  v_fn   text;
begin
  foreach v_role in array array['anon', 'authenticated', 'chat_app'] loop
    foreach v_fn in array array[
      'chat.transfer_ownership(uuid, uuid, text, uuid)',
      'chat.offboard_staff(uuid, text, uuid, uuid)',
      'chat.assign_family_owner(uuid, uuid, text, uuid)',
      'chat.write_audit(uuid, text, text, uuid, text, jsonb, jsonb)',
      'chat.log_event(text, uuid, text, uuid, jsonb)'] loop
      if has_function_privilege(v_role, v_fn, 'EXECUTE') then
        raise exception '% can still execute %', v_role, v_fn;
      end if;
    end loop;
    if has_column_privilege(v_role, 'chat.family', 'owner_id', 'UPDATE') then
      raise exception '% can still update chat.family.owner_id', v_role;
    end if;
  end loop;
end
$assert$;
