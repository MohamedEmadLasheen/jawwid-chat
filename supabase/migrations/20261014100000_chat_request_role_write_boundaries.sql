-- =============================================================================
-- Request-role write boundaries: assignment, gates and profile fields
-- =============================================================================
--
-- Depends on 20261014090000 (chat.caller_is_server_side) and 20261013150000
-- (the staff-profile tables). Forward-only; privileges, trigger functions and one
-- policy; no table DDL, no data touched.
--
-- 1. chat.learner.teacher_id (PD-6 input) -- NOT a Jawwid Core table
--    chat.learner is created by 20260905090300 in Chat's own database and owned
--    by Chat's owner role. Core reaches Chat only through the API/webhook
--    boundary (core-integration-contract.md: "no SQL path between the two
--    products"). teacher_id is Chat's READ MODEL of the academy's assignment
--    (20260923130000); its only legitimate writer is assignment ingestion, a
--    server-side path. No API code writes it.
--    Defect: authenticated held INSERT and UPDATE on every learner column, and
--    chat.guard_learner_assignment_change honoured chat.syncing_assignment, a
--    setting any connection can set for itself. Verified 2026-10-14 as chat_app
--    (rolled back): an admin re-pointed a learner to another teacher.
--    Fix: INSERT(teacher_id) and UPDATE(teacher_id) are no longer granted to the
--    request role (every other column keeps exactly its access), and the guard
--    honours the gate only for a server-side caller. 20260923130000 announced
--    this column-level revoke for "once the API connects as chat_app".
--
-- 2. The three gate settings honour only server-side callers
--    chat.transferring_ownership (family.owner_id), chat.syncing_assignment
--    (learner.teacher_id) and chat.provisioning_super_admin (staff.role
--    super_admin) are switches, not identities. Each guard now requires
--    `setting = 'on' AND chat.caller_is_server_side()`, so a request-role
--    connection that sets one gains nothing even if a column grant is ever
--    re-added. The owner (API, bootstrap CLI, transfer_ownership on the owner
--    path, ingestion) is unaffected.
--
-- 3. chat.staff profile fields for the request role
--    The profile API writes chat.staff.name (super admin only) and
--    chat.staff.avatar_object_key (the person, or the super admin). For the day
--    the API connects as chat_app those two columns are granted -- and a
--    BEFORE UPDATE guard applies the API's own rules to request-role writes:
--      name              -> only the super admin;
--      avatar_object_key -> only the person or the super admin, and only NULL or
--                           a key under avatars/staff/<that staff id>/<uuid>.
--    A permissive UPDATE policy admits the super admin's rows (organization
--    isolation still restricts it to their tenant). role, is_active, left_at,
--    account_id, organization_id stay ungranted (20261013160000).
--
-- 4. The staff-profile tables (20261013150000) get column-level UPDATE grants
--    for the columns their workflows change, instead of table-level UPDATE: a
--    request role can no longer re-point a profile, responsibility or reporting
--    line at another staff member or tenant.
--
-- ROLLBACK: never restore the table-level grants or the bare-setting gates; that
-- restores the bypasses. Revert a single guard by re-running its previous body
-- only together with the matching column revoke still in place.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper: replace a table-level privilege with a column-level one on every
-- column but the excluded ones. Columns are read from the catalog, so a column
-- added later is never granted by accident.
-- ---------------------------------------------------------------------------
create or replace function chat.narrow_column_grant(
  p_table regclass, p_privilege text, p_grantee text, p_keep text[]
) returns void
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_cols text;
begin
  execute format('revoke %s on %s from %I', p_privilege, p_table, p_grantee);
  execute format('revoke %s on %s from public', p_privilege, p_table);
  select string_agg(quote_ident(attname), ', ' order by attnum) into v_cols
    from pg_attribute
   where attrelid = p_table and attnum > 0 and not attisdropped and attname = any (p_keep);
  if v_cols is not null then
    execute format('grant %s (%s) on %s to %I', p_privilege, v_cols, p_table, p_grantee);
  end if;
end;
$$;
revoke execute on function chat.narrow_column_grant(regclass, text, text, text[]) from public;

-- ---------------------------------------------------------------------------
-- 1. chat.learner.teacher_id
-- ---------------------------------------------------------------------------
do $learner$
declare
  v_keep text[];
begin
  select array_agg(attname::text) into v_keep from pg_attribute
   where attrelid = 'chat.learner'::regclass and attnum > 0 and not attisdropped and attname <> 'teacher_id';
  if has_table_privilege('authenticated', 'chat.learner', 'UPDATE') then
    perform chat.narrow_column_grant('chat.learner', 'update', 'authenticated', v_keep);
  end if;
  if has_table_privilege('authenticated', 'chat.learner', 'INSERT') then
    perform chat.narrow_column_grant('chat.learner', 'insert', 'authenticated', v_keep);
  end if;
  revoke update (teacher_id), insert (teacher_id) on chat.learner from authenticated, chat_app, public;
end
$learner$;

create or replace function chat.guard_learner_assignment_change()
returns trigger
language plpgsql
as $$
declare
  -- The gate is honoured only for a server-side caller (ingestion on the owner
  -- or service connection). A request role that sets it gains nothing.
  v_open boolean := coalesce(current_setting('chat.syncing_assignment', true), '') = 'on'
                    and chat.caller_is_server_side();
begin
  if tg_op = 'INSERT' then
    if new.teacher_id is not null and not v_open then
      raise exception
        'chat.learner.teacher_id is owned by the academy assignment system (PD-6/OD-04); '
        'a learner cannot be created with an assignment from inside Chat'
        using errcode = 'restrict_violation',
              hint = 'Insert the learner, then let assignment ingestion set teacher_id.';
    end if;
    return new;
  end if;

  if new.teacher_id is distinct from old.teacher_id and not v_open then
    raise exception
      'chat.learner.teacher_id is owned by the academy assignment system (PD-6/OD-04); '
      'it changes only through assignment ingestion, never a Chat-side edit'
      using errcode = 'restrict_violation',
            hint = 'Ingestion opens the gate with '
                   'set_config(''chat.syncing_assignment'', ''on'', true) on a server-side connection.';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The other two gates
-- ---------------------------------------------------------------------------
create or replace function chat.guard_owner_change()
returns trigger
language plpgsql
as $$
begin
  if new.owner_id is distinct from old.owner_id
     and not (coalesce(current_setting('chat.transferring_ownership', true), '') = 'on'
              and chat.caller_is_server_side()) then
    raise exception
      'family.owner_id changes only through chat.transfer_ownership() (brief SS12)'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

-- guard_super_admin_grant belongs to 20261013120000 (bootstrap). Re-defined
-- only if that migration is present, with the same rules plus the server-side
-- requirement; without it there is no super_admin role to guard.
do $super$
begin
  if to_regprocedure('chat.guard_super_admin_grant()') is null then
    return;
  end if;
  execute $fn$
    create or replace function chat.guard_super_admin_grant()
    returns trigger
    language plpgsql
    as $body$
    declare
      v_open boolean := coalesce(current_setting('chat.provisioning_super_admin', true), '') = 'on'
                        and chat.caller_is_server_side();
      v_touches boolean;
    begin
      if tg_op = 'INSERT' then
        v_touches := new.role = 'super_admin';
      elsif tg_op = 'DELETE' then
        v_touches := old.role = 'super_admin';
      else
        v_touches :=
             (new.role = 'super_admin' or old.role = 'super_admin')
         and (new.role is distinct from old.role
              or new.account_id is distinct from old.account_id);
      end if;

      if v_touches and not v_open then
        raise exception
          'the super_admin role is granted, revoked and re-bound only by the bootstrap procedure'
          using errcode = 'insufficient_privilege',
                hint = 'Run apps/api dist/cli/bootstrap-super-admin.js; it opens '
                       'chat.provisioning_super_admin for its own transaction.';
      end if;

      if tg_op = 'DELETE' then
        return old;
      end if;
      return new;
    end;
    $body$
  $fn$;
end
$super$;

-- ---------------------------------------------------------------------------
-- 3. chat.staff profile fields for the request role
-- ---------------------------------------------------------------------------
grant update (name) on chat.staff to authenticated;
do $avatar$
begin
  if exists (select 1 from pg_attribute where attrelid = 'chat.staff'::regclass and attname = 'avatar_object_key' and not attisdropped) then
    grant update (avatar_object_key) on chat.staff to authenticated;
  end if;
end
$avatar$;

create or replace function chat.guard_staff_request_writes()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_me   uuid;
  v_role text;
  v_new_key text;
  v_old_key text;
begin
  if chat.caller_is_server_side() then
    return new;  -- the API and the CLI decide on the owner connection
  end if;
  v_me := chat.current_staff_id();
  v_role := chat.current_staff_role();

  if new.name is distinct from old.name and v_role is distinct from 'super_admin' then
    raise exception 'only the super admin may change a staff member''s name'
      using errcode = 'insufficient_privilege';
  end if;

  v_new_key := to_jsonb(new) ->> 'avatar_object_key';
  v_old_key := to_jsonb(old) ->> 'avatar_object_key';
  if v_new_key is distinct from v_old_key then
    if new.id is distinct from v_me and v_role is distinct from 'super_admin' then
      raise exception 'only the staff member or the super admin may change this photo'
        using errcode = 'insufficient_privilege';
    end if;
    if v_new_key is not null and v_new_key !~ ('^avatars/staff/' || new.id::text
         || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
      raise exception 'a profile photo key must be under this staff member''s own prefix'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists staff_request_writes_are_scoped on chat.staff;
create trigger staff_request_writes_are_scoped
  before update on chat.staff
  for each row execute function chat.guard_staff_request_writes();

drop policy if exists staff_profile_fields_by_super_admin on chat.staff;
create policy staff_profile_fields_by_super_admin on chat.staff for update to authenticated
  using (chat.current_staff_role() = 'super_admin')
  with check (chat.current_staff_role() = 'super_admin');

-- ---------------------------------------------------------------------------
-- 4. Staff-profile tables: column-level UPDATE only
-- ---------------------------------------------------------------------------
select chat.narrow_column_grant('chat.staff_profile', 'update', 'authenticated',
  array['job_title', 'about', 'updated_at', 'updated_by']);
select chat.narrow_column_grant('chat.staff_responsibility', 'update', 'authenticated',
  array['ended_at', 'ended_by', 'end_reason']);
select chat.narrow_column_grant('chat.staff_reporting_line', 'update', 'authenticated',
  array['manager_id', 'assigned_by', 'assigned_at']);

-- ---------------------------------------------------------------------------
-- Prove it
-- ---------------------------------------------------------------------------
do $assert$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'chat_app'] loop
    if has_column_privilege(v_role, 'chat.learner', 'teacher_id', 'UPDATE')
       or has_column_privilege(v_role, 'chat.learner', 'teacher_id', 'INSERT') then
      raise exception '% can still write chat.learner.teacher_id', v_role;
    end if;
    if has_column_privilege(v_role, 'chat.staff', 'role', 'UPDATE')
       or has_column_privilege(v_role, 'chat.staff', 'is_active', 'UPDATE')
       or has_column_privilege(v_role, 'chat.staff', 'account_id', 'UPDATE')
       or has_column_privilege(v_role, 'chat.staff', 'organization_id', 'UPDATE') then
      raise exception '% can update a protected chat.staff column', v_role;
    end if;
    if has_column_privilege(v_role, 'chat.staff_profile', 'staff_id', 'UPDATE')
       or has_column_privilege(v_role, 'chat.staff_responsibility', 'staff_id', 'UPDATE')
       or has_column_privilege(v_role, 'chat.staff_reporting_line', 'staff_id', 'UPDATE') then
      raise exception '% can re-point a staff-profile row', v_role;
    end if;
  end loop;
end
$assert$;
