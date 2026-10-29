-- =============================================================================
-- PD-40 PR-3 · staff accounts and their lifecycle
--
-- Owner decision 2026-10-28 (plan §13): approve the recommendations, with six
-- safeguards. This migration is their database half:
--
--   S1/C1  a department manager creates and manages SPECIALISTS of the
--          department they run, and grants them only specialist roles; only
--          the super admin creates supervisors and managers or grants anything
--          above a specialist -- chat.create_staff_account,
--          chat.may_administer_staff_account, chat.require_access_grantor
--   S2     every rule here too, so a service that skips the API's check is
--          still refused; a grant holds only keys the grantor holds and may
--          delegate (H5), now with a minimal delegable set (C3); a manager
--          administers a specialist only while the specialist holds nothing
--          beyond that (review of #212, P1), a role edit never widens a
--          manager's grant past it (P2), and suspending, reactivating or
--          signing out a staff account is refused here too (P2)
--   S3/C4  a staff account's first sign-in or reset code is issued by the super
--          admin, or by the manager of the specialist's department --
--          chat.guard_password_reset_code (PD-43's, with that one branch widened)
--   S4/C2  a role never holds a super-admin-only key -- chat.permission.in_roles,
--          chat.set_access_role_permissions
--   S5     creation is audited here (staff.account_created); grants, codes and
--          status changes already are (PD-40 PR-2, PD-43, PD-21)
--   C5     chat.department_account: where a specialist belongs. PD-8's scope
--          functions never read it, so belonging to a department grants no
--          family, conversation or teacher.
-- =============================================================================

select set_config('chat.pd040_catalogue_change', 'on', true);

-- ---------------------------------------------------------------------------
-- 1. The catalogue: in_roles, the new keys, the delegable set
-- ---------------------------------------------------------------------------
alter table chat.permission add column in_roles boolean not null default true;
comment on column chat.permission.in_roles is
  'PD-40 S4: false = never part of an access role (the super admin''s powers, account administration). Mirrors catalogue.ts inRoles.';

-- BEGIN GENERATED pd040staff catalogue rows -- by test/unit/authorization/pd040-catalogue-seed.spec.ts; do not edit
insert into chat.permission (key, page, action, label_en, label_ar, risk, delegable, introduced_by) values
  ('staff_accounts.view', 'staff_accounts', 'view', 'View staff accounts', 'عرض حسابات الموظفين', 'admin', false, 'PD-40'),
  ('staff_accounts.create', 'staff_accounts', 'create', 'Create staff accounts', 'إنشاء حسابات الموظفين', 'admin', false, 'PD-40'),
  ('staff_accounts.manage', 'staff_accounts', 'manage', 'Manage staff accounts and their roles', 'إدارة حسابات الموظفين وأدوارهم', 'admin', false, 'PD-40'),
  ('access_roles.manage', 'access_roles', 'manage', 'Define access roles', 'تعريف أدوار الصلاحيات', 'admin', false, 'PD-40');

insert into chat.legacy_permission_bundle (tier, department_kind, permission_key) values
  ('manager', 'operations', 'staff_accounts.create'),
  ('manager', 'operations', 'staff_accounts.manage'),
  ('manager', 'operations', 'staff_accounts.view'),
  ('manager', 'teachers', 'staff_accounts.create'),
  ('manager', 'teachers', 'staff_accounts.manage'),
  ('manager', 'teachers', 'staff_accounts.view'),
  ('manager', 'sales', 'staff_accounts.create'),
  ('manager', 'sales', 'staff_accounts.manage'),
  ('manager', 'sales', 'staff_accounts.view');

update chat.permission set delegable = true where key in ('billing.view', 'certificates.design', 'certificates.view', 'subscriptions.view');

update chat.permission set in_roles = false where key in ('access_roles.manage', 'accounts.administer', 'accounts.support_session', 'admin.inspect', 'chat.export', 'org.departments', 'staff_accounts.create', 'staff_accounts.manage', 'staff_accounts.view', 'staff_profiles.organization', 'staff_profiles.reporting_lines');
-- END GENERATED pd040staff catalogue rows

select set_config('chat.pd040_catalogue_change', 'off', true);

-- S4 in depth: no role already holds a key barred above. None can -- only the
-- super admin defines roles, and nothing before this PR offered it -- but if
-- one did, stop here rather than leave it in force.
do $$
begin
  if exists (select 1 from chat.access_role_permission arp
               join chat.permission p on p.key = arp.permission_key
              where not p.in_roles) then
    raise exception 'PD-40 S4: an access role holds a key that never goes in a role; remove it before this migration';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Where a specialist belongs (C5)
-- ---------------------------------------------------------------------------
create table chat.department_account (
  staff_id        uuid primary key references chat.staff (id),
  organization_id uuid not null references chat.organization (id),
  department_id   uuid not null references chat.department (id),
  assigned_by     uuid references chat.staff (id),
  assigned_at     timestamptz not null default now()
);
create index department_account_by_department on chat.department_account (department_id);

comment on table chat.department_account is
  'PD-40: the department a specialist (staff.role specialist) belongs to. Written only by chat.create_staff_account. '
  'Grants no PD-8 scope: chat.staff_conversation_access and its siblings never read it.';

create function chat.guard_department_account()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_role text;
  v_org  uuid;
begin
  if coalesce(current_setting('chat.pd040_access_change', true), '') <> 'on' then
    raise exception 'a specialist''s department is set only through chat.create_staff_account (PD-40)'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  select s.role into v_role from chat.staff s where s.id = new.staff_id and s.organization_id = new.organization_id;
  select d.organization_id into v_org from chat.department d where d.id = new.department_id;
  if v_role is distinct from 'specialist' then
    raise exception 'only a specialist belongs to a department this way; supervisors are department members (PD-8)'
      using errcode = 'check_violation';
  end if;
  if v_org is distinct from new.organization_id then
    raise exception 'a specialist belongs to a department of their own organization' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger department_account_written_by_functions before insert or update or delete on chat.department_account
  for each row execute function chat.guard_department_account();

-- The manager of the department a staff member belongs to. Since C1 a manager
-- acts only on specialists, so the relation is department_account alone.
create or replace function chat.staff_in_managed_department(p_manager uuid, p_staff uuid)
returns boolean
language sql
stable
set search_path = chat, pg_temp
as $$
  select exists (
    select 1
      from chat.department d
      join chat.department_account da on da.department_id = d.id
     where d.manager_id = p_manager and da.staff_id = p_staff
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. Who administers a staff account (S1): the API's decideStaffAccountManage
-- ---------------------------------------------------------------------------
-- A manager administers a specialist of their department only while EVERY key
-- the specialist holds is one the manager holds and may delegate (review of
-- #212, P1). Otherwise a reset code is a way in: the manager signs in as the
-- specialist and gains, say, the billing.verify the super admin granted them.
-- Such an account is the super admin's alone. The keys are read from the
-- grants, not from chat.staff_access_profile, so a suspended specialist is
-- judged by what reactivating them would restore. A specialist holds no legacy
-- bundle: the grants are everything they hold.
create function chat.may_administer_staff_account(p_actor uuid, p_target uuid)
returns boolean
language plpgsql
stable
set search_path = chat, pg_temp
as $$
declare
  a      chat.staff%rowtype;
  t      chat.staff%rowtype;
  v_held text[];
begin
  select * into a from chat.staff where id = p_actor;
  select * into t from chat.staff where id = p_target;
  if a.id is null or t.id is null or not a.is_active or a.left_at is not null then return false; end if;
  if a.organization_id <> t.organization_id or a.id = t.id or t.role = 'super_admin' then return false; end if;
  if a.role = 'super_admin' then return true; end if;
  if a.role <> 'manager' or t.role <> 'specialist' or not chat.staff_in_managed_department(a.id, t.id) then
    return false;
  end if;
  select p.permissions into v_held from chat.staff_access_profile(a.id) p;
  if not ('staff_accounts.manage' = any (coalesce(v_held, array[]::text[]))) then return false; end if;
  return not exists (
    select 1
      from chat.staff_access_role sar
      join chat.access_role_permission arp on arp.role_id = sar.role_id
      join chat.permission p on p.key = arp.permission_key
     where sar.staff_id = t.id
       and (not p.delegable or not p.in_roles or not (p.key = any (v_held)))
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Creating a staff account (S1, S5)
-- ---------------------------------------------------------------------------
create function chat.create_staff_account(
  p_name       text,
  p_email      text,
  p_tier       text,
  p_department uuid,
  p_reason     text,
  p_actor_id   uuid default null
) returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_actor   chat.staff := chat.require_live_staff(chat.trusted_staff_actor(p_actor_id));
  v_reason  text := chat.require_reason(p_reason);
  v_name    text := btrim(coalesce(p_name, ''));
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_account uuid;
  v_staff   uuid;
begin
  if p_tier is null or p_tier not in ('specialist', 'admin', 'coverage', 'manager') then
    raise exception 'a staff account is a specialist, a supervisor or a manager; the super admin is never created here'
      using errcode = 'check_violation';
  end if;
  if v_actor.role = 'super_admin' then
    if p_tier <> 'specialist' and p_department is not null then
      raise exception 'a supervisor''s or manager''s department is set in the organization structure' using errcode = 'check_violation';
    end if;
  else
    if v_actor.role <> 'manager' or not chat.staff_has_permission(v_actor.id, 'staff_accounts.create') then
      raise exception 'only the super admin and department managers create staff accounts' using errcode = 'insufficient_privilege';
    end if;
    if p_tier <> 'specialist' then
      raise exception 'only the super admin creates supervisors and managers (PD-40 S1)' using errcode = 'insufficient_privilege';
    end if;
    if p_department is null or not exists (
         select 1 from chat.department d
          where d.id = p_department and d.manager_id = v_actor.id and d.organization_id = v_actor.organization_id) then
      raise exception 'a manager creates accounts in the department they run only (PD-40 S1)' using errcode = 'insufficient_privilege';
    end if;
  end if;
  if p_department is not null and not exists (
       select 1 from chat.department d where d.id = p_department and d.organization_id = v_actor.organization_id) then
    raise exception 'no such department in this organization' using errcode = 'check_violation';
  end if;

  if length(v_name) not between 1 and 120 then
    raise exception 'a staff account has a name (1 to 120 characters)' using errcode = 'check_violation';
  end if;
  if length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'the sign-in e-mail is an e-mail address' using errcode = 'check_violation';
  end if;

  -- Two creators at once: the second waits, then is refused.
  perform pg_advisory_xact_lock(hashtext('pd043:sign-in:' || v_email));
  if exists (select 1 from chat.account a where lower(a.subject) = v_email) then
    raise exception 'this e-mail already signs in to Chat' using errcode = 'check_violation';
  end if;

  insert into chat.account (organization_id, subject, kind, status, is_active)
  values (v_actor.organization_id, v_email, 'staff', 'provisioned', false)
  returning id into v_account;
  insert into chat.staff (organization_id, account_id, name, role, is_active)
  values (v_actor.organization_id, v_account, v_name, p_tier, true)
  returning id into v_staff;
  if p_department is not null then
    perform set_config('chat.pd040_access_change', 'on', true);
    insert into chat.department_account (staff_id, organization_id, department_id, assigned_by)
    values (v_staff, v_actor.organization_id, p_department, v_actor.id);
    perform set_config('chat.pd040_access_change', 'off', true);
  end if;

  -- The audit trail is read more widely than the account: no e-mail.
  insert into chat.audit_log (actor_id, action, entity, entity_id, before, after, reason)
  values (v_actor.id, 'staff.account_created', 'staff', v_staff, null,
          jsonb_build_object('accountId', v_account, 'tier', p_tier, 'departmentId', p_department), v_reason);
  return v_staff;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Roles never hold a super-admin-only key (S4/C2)
-- ---------------------------------------------------------------------------
create or replace function chat.set_access_role_permissions(p_role uuid, p_permissions text[])
returns text[]
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_unknown text[];
  v_barred  text[];
  v_keys    text[];
begin
  select array_agg(distinct k order by k) into v_keys from unnest(coalesce(p_permissions, array[]::text[])) k;
  if v_keys is null then
    raise exception 'a role holds at least one permission' using errcode = 'check_violation';
  end if;
  select array_agg(k) into v_unknown from unnest(v_keys) k where not exists (select 1 from chat.permission p where p.key = k);
  if v_unknown is not null then
    raise exception 'unknown permission(s): %', array_to_string(v_unknown, ', ') using errcode = 'check_violation';
  end if;
  select array_agg(p.key order by p.key) into v_barred from chat.permission p where p.key = any (v_keys) and not p.in_roles;
  if v_barred is not null then
    raise exception 'a role never holds the super admin''s own powers: % (PD-40 S4)', array_to_string(v_barred, ', ')
      using errcode = 'check_violation';
  end if;
  delete from chat.access_role_permission where role_id = p_role;
  insert into chat.access_role_permission (role_id, permission_key) select p_role, k from unnest(v_keys) k;
  return v_keys;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants (C1): a non-super-admin grants only specialist roles, to specialists
-- ---------------------------------------------------------------------------
create or replace function chat.require_access_grantor(p_actor chat.staff, p_target chat.staff, p_role chat.access_role, p_granting boolean)
returns void
language plpgsql
stable
set search_path = chat, pg_temp
as $$
declare
  v_withheld text[];
begin
  if p_target.organization_id <> p_actor.organization_id or p_role.organization_id <> p_actor.organization_id then
    raise exception 'no such staff member or role in this organization' using errcode = 'no_data_found';
  end if;
  if p_target.id = p_actor.id then
    raise exception 'nobody changes their own access (PD-40 H8)' using errcode = 'insufficient_privilege';
  end if;
  if p_target.role = 'super_admin' then
    raise exception 'the super admin holds every permission and is never granted a role (PD-40 H1)' using errcode = 'insufficient_privilege';
  end if;
  if p_granting then
    if p_role.archived_at is not null then
      raise exception 'an archived role is never granted' using errcode = 'check_violation';
    end if;
    if chat.tier_rank(chat.staff_tier(p_target.role)) > chat.tier_rank(p_role.max_tier) then
      raise exception 'this role may be granted up to a %, not to a %', p_role.max_tier, chat.staff_tier(p_target.role)
        using errcode = 'check_violation';
    end if;
  end if;
  if p_actor.role = 'super_admin' then
    return;
  end if;

  -- A department manager (PD-40 S1, C1): a specialist of the department they
  -- run, a role that goes no higher than a specialist.
  if p_actor.role <> 'manager' or not chat.staff_has_permission(p_actor.id, 'staff_accounts.manage') then
    raise exception 'only the super admin changes another staff member''s access (PD-40)' using errcode = 'insufficient_privilege';
  end if;
  -- The specialist of their department, holding nothing the manager may not
  -- grant (chat.may_administer_staff_account: the reset and status rules too).
  if not chat.may_administer_staff_account(p_actor.id, p_target.id) then
    raise exception 'a manager changes the access of the specialists of their own department only, while they hold nothing the manager may not grant (PD-40 S1, H5)'
      using errcode = 'insufficient_privilege';
  end if;
  if p_granting and p_role.max_tier <> 'specialist' then
    raise exception 'only the super admin grants a role above a specialist (PD-40 S1)' using errcode = 'insufficient_privilege';
  end if;
  -- H5: grant only what one holds and may delegate.
  if p_granting then
    select array_agg(arp.permission_key order by arp.permission_key) into v_withheld
      from chat.access_role_permission arp
      join chat.permission p on p.key = arp.permission_key
     where arp.role_id = p_role.id
       and (not p.delegable or not p.in_roles or not chat.staff_has_permission(p_actor.id, arp.permission_key));
    if v_withheld is not null then
      raise exception 'this role holds permissions you may not grant: % (PD-40 H5)', array_to_string(v_withheld, ', ')
        using errcode = 'insufficient_privilege';
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6b. What a staff member holds: PR-2's chat.staff_access_profile, a role's
--     barred keys left out (review of #212, P2 -- defence in depth for S4)
-- ---------------------------------------------------------------------------
create or replace function chat.staff_access_profile(p_staff uuid)
returns table (tier text, department_kind text, placement text, permissions text[])
language plpgsql
stable
set search_path = chat, pg_temp
as $$
declare
  v_staff    chat.staff%rowtype;
  v_tier     text;
  v_kind     text;
  v_position text;
  v_fitted   text;
  v_keys     text[];
begin
  select * into v_staff from chat.staff s where s.id = p_staff;
  if not found or not v_staff.is_active or v_staff.left_at is not null then
    return query select null::text, null::text, null::text, array[]::text[];
    return;
  end if;
  v_tier := chat.staff_tier(v_staff.role);

  -- The department the staff member runs, else the one they belong to (PD-8:
  -- one of either per person).
  select d.kind, 'manager' into v_kind, v_position
    from chat.department d
   where d.manager_id = p_staff and d.organization_id = v_staff.organization_id
   limit 1;
  if v_kind is null then
    select d.kind, 'member' into v_kind, v_position
      from chat.department_member m
      join chat.department d on d.id = m.department_id
     where m.staff_id = p_staff and d.organization_id = v_staff.organization_id
     limit 1;
  end if;

  -- A placement that does not fit the tier -- a manager listed as a member, a
  -- supervisor as a manager -- counts as no department: a stale row widens
  -- nothing (legacyBundle() in legacy-bundles.ts).
  v_fitted := case
    when (v_tier = 'manager' and v_position = 'manager') or (v_tier = 'supervisor' and v_position = 'member') then v_kind
    else 'none'
  end;

  if v_tier = 'super_admin' then
    select array_agg(p.key order by p.key) into v_keys from chat.permission p;
  else
    select array_agg(k order by k) into v_keys
      from (
        select b.permission_key as k
          from chat.legacy_permission_bundle b
         where b.tier = v_tier and b.department_kind = v_fitted
        union
        select arp.permission_key
          from chat.staff_access_role sar
          join chat.access_role r on r.id = sar.role_id and r.organization_id = v_staff.organization_id
          join chat.access_role_permission arp on arp.role_id = sar.role_id
          -- S4 in depth: a key barred from roles counts for nobody through one.
          join chat.permission p on p.key = arp.permission_key and p.in_roles
         where sar.staff_id = p_staff
      ) held;
  end if;

  return query select v_tier, v_kind, v_position, coalesce(v_keys, array[]::text[]);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6c. Grants and role edits never interleave; an edit never widens a
--     manager's grant past H5 (review of #212, P2). PR-2's functions, with
--     only the marked lines added.
-- ---------------------------------------------------------------------------
create or replace function chat.grant_access_role(p_staff uuid, p_role uuid, p_reason text, p_actor_id uuid default null)
returns boolean
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_actor  chat.staff := chat.require_live_staff(chat.trusted_staff_actor(p_actor_id));
  v_reason text := chat.require_reason(p_reason);
  v_target chat.staff%rowtype;
  v_role   chat.access_role%rowtype;
  v_keys   text[];
  v_added  boolean;
begin
  select * into v_target from chat.staff where id = p_staff for update;
  -- FOR SHARE: chat.update_access_role locks the role FOR UPDATE, so a grant
  -- and an edit of the same role never interleave (its H5 recheck sees this grant).
  select * into v_role from chat.access_role where id = p_role for share;
  if v_target.id is null or v_role.id is null then
    raise exception 'no such staff member or role in this organization' using errcode = 'no_data_found';
  end if;
  perform chat.require_access_grantor(v_actor, v_target, v_role, true);

  perform set_config('chat.pd040_access_change', 'on', true);
  insert into chat.staff_access_role (staff_id, role_id, granted_by, reason)
  values (p_staff, p_role, v_actor.id, v_reason)
  on conflict do nothing;
  v_added := found;
  if v_added then
    select array_agg(permission_key order by permission_key) into v_keys from chat.access_role_permission where role_id = p_role;
    insert into chat.audit_log (actor_id, action, entity, entity_id, before, after, reason)
    values (v_actor.id, 'staff.access_role_granted', 'staff', p_staff, null,
            jsonb_build_object('roleId', p_role, 'roleKey', v_role.key, 'permissions', to_jsonb(v_keys)), v_reason);
  end if;
  perform set_config('chat.pd040_access_change', 'off', true);
  return v_added;
end;
$$;

create or replace function chat.update_access_role(
  p_role        uuid,
  p_name_en     text,
  p_name_ar     text,
  p_description text,
  p_permissions text[],
  p_reason      text,
  p_actor_id    uuid default null
) returns void
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_actor  chat.staff := chat.require_live_staff(chat.trusted_staff_actor(p_actor_id));
  v_reason text := chat.require_reason(p_reason);
  v_role   chat.access_role%rowtype;
  v_before  text[];
  v_keys    text[];
  v_blocked text[];
begin
  perform chat.require_super_admin_for_roles(v_actor);
  select * into v_role from chat.access_role where id = p_role for update;
  if not found or v_role.organization_id <> v_actor.organization_id then
    raise exception 'no such role in this organization' using errcode = 'no_data_found';
  end if;
  select array_agg(permission_key order by permission_key) into v_before from chat.access_role_permission where role_id = p_role;
  perform set_config('chat.pd040_access_change', 'on', true);
  update chat.access_role
     set name_en = coalesce(btrim(p_name_en), name_en),
         name_ar = coalesce(btrim(p_name_ar), name_ar),
         description = coalesce(p_description, description),
         updated_at = now()
   where id = p_role;
  v_keys := case when p_permissions is null then v_before else chat.set_access_role_permissions(p_role, p_permissions) end;
  -- H5 after the fact (review of #212, P2): a key this edit ADDS must be one
  -- every manager who granted the role holds and may delegate. Otherwise the
  -- edit is refused, naming those grants: the super admin revokes them first
  -- (or grants the role themself). Removing keys never widens anyone.
  if p_permissions is not null then
    select array_agg(sar.staff_id::text || ' (granted by ' || sar.granted_by::text || ')' order by sar.staff_id) into v_blocked
      from chat.staff_access_role sar
      join chat.staff g on g.id = sar.granted_by
     where sar.role_id = p_role
       and g.role <> 'super_admin'
       and exists (
         select 1
           from unnest(v_keys) k
           join chat.permission p on p.key = k
          where not (k = any (coalesce(v_before, array[]::text[])))
            and (not p.delegable or not p.in_roles or not chat.staff_has_permission(g.id, k)));
    if v_blocked is not null then
      raise exception 'this edit gives keys their granting manager may not grant to: %; revoke those grants first (PD-40 H5)',
        array_to_string(v_blocked, ', ')
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  insert into chat.audit_log (actor_id, action, entity, entity_id, before, after, reason)
  values (v_actor.id, 'access_role.updated', 'access_role', p_role,
          jsonb_build_object('nameEn', v_role.name_en, 'nameAr', v_role.name_ar, 'permissions', to_jsonb(v_before)),
          jsonb_build_object('nameEn', coalesce(btrim(p_name_en), v_role.name_en), 'nameAr', coalesce(btrim(p_name_ar), v_role.name_ar),
                             'permissions', to_jsonb(v_keys)),
          v_reason);
  perform set_config('chat.pd040_access_change', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. A staff account's code (C4): PD-43's guard, the staff branch widened
-- ---------------------------------------------------------------------------
create or replace function chat.guard_password_reset_code()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_target_kind   text;
  v_target_org    uuid;
  v_target_status text;
  v_target_role   text;
  v_issuer_role   text;
  v_issuer_acct   uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'a password reset code is never deleted' using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    select a.kind, a.organization_id, a.status into v_target_kind, v_target_org, v_target_status
      from chat.account a where a.id = new.account_id;
    if v_target_org is distinct from new.organization_id then
      raise exception 'a password reset code is for an account of its own organization' using errcode = 'check_violation';
    end if;

    if new.channel = 'admin' then
      select s.role, s.account_id into v_issuer_role, v_issuer_acct
        from chat.staff s
       where s.id = new.issued_by and s.organization_id = new.organization_id
         and s.is_active and s.left_at is null;
      if v_issuer_role is null then
        raise exception 'a password reset code is issued by active staff of the same organization' using errcode = 'check_violation';
      end if;
      if v_issuer_acct = new.account_id then
        raise exception 'nobody resets their own password this way' using errcode = 'check_violation';
      end if;

      if v_target_kind = 'staff' then
        select s.role into v_target_role from chat.staff s where s.account_id = new.account_id;
        if v_target_role = 'super_admin' then
          raise exception 'the super admin''s password is never reset by an administrator' using errcode = 'check_violation';
        end if;
        -- PD-40 PR-3 (plan §13 C4, owner S1): the super admin, or the manager of
        -- the department a SPECIALIST belongs to -- chat.may_administer_staff_account,
        -- the same rule the API decides with. Never a supervisor's or manager's code.
        if v_issuer_role <> 'super_admin'
           and not chat.may_administer_staff_account(new.issued_by,
                     (select s.id from chat.staff s where s.account_id = new.account_id)) then
          raise exception 'only the super admin, or a manager for a specialist of their department, issues a staff member''s code'
            using errcode = 'check_violation';
        end if;
      end if;
    elsif new.purpose = 'first_login' then
      raise exception 'a first sign-in code is issued by an administrator' using errcode = 'check_violation';
    elsif v_target_kind is distinct from 'family' then
      -- PD-25 is the parents' recovery: staff and teachers go through an administrator.
      raise exception 'only a parent account recovers itself' using errcode = 'check_violation';
    end if;

    if new.purpose = 'first_login' then
      if v_target_status is distinct from 'provisioned' then
        raise exception 'a first sign-in code is for an account that has not signed in yet' using errcode = 'check_violation';
      end if;
      if v_target_kind = 'teacher' then
        if not chat.may_issue_teacher_first_login(new.issued_by,
                 (select t.id from chat.teacher t where t.account_id = new.account_id)) then
          raise exception 'a first sign-in code is issued by someone who may add this teacher' using errcode = 'check_violation';
        end if;
      elsif v_target_kind is distinct from 'staff' then
        -- A parent's first password is PD-16's sign-up code.
        raise exception 'a first sign-in code is for a teacher or a staff account' using errcode = 'check_violation';
      end if;
    end if;

    new.created_at := now();
    new.attempts := 0;
    new.used_at := null;
    new.superseded_at := null;
    new.verified_at := null;
    if new.purpose = 'first_login' then
      if new.expires_at > now() + interval '72 hours 5 minutes' then
        raise exception 'a first sign-in code lives at most 72 hours' using errcode = 'check_violation';
      end if;
    elsif new.expires_at > now() + interval '1 day' then
      raise exception 'a password reset code lives at most a day' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if (new.id, new.organization_id, new.account_id, new.issued_by, new.channel, new.purpose, new.code_hash, new.reason, new.created_at, new.expires_at)
     is distinct from
     (old.id, old.organization_id, old.account_id, old.issued_by, old.channel, old.purpose, old.code_hash, old.reason, old.created_at, old.expires_at) then
    raise exception 'a password reset code''s identity never changes' using errcode = 'check_violation';
  end if;
  if new.attempts < old.attempts
     or (old.used_at is not null and new.used_at is distinct from old.used_at)
     or (old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at)
     or (old.verified_at is not null and new.verified_at is distinct from old.verified_at) then
    raise exception 'a password reset code only moves forward' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Suspending, reactivating, signing out a staff account (S2; review of
--    #212, P2): the database refuses what chat.may_administer_staff_account
--    refuses, so the rule is not the API's alone
-- ---------------------------------------------------------------------------
-- The actor is the administrator the writer names: chat.account_admin_actor,
-- which the PD-21 service sets for its transaction, else the requester
-- chat.deactivate_principal records (chat.revocation_requested_by). A
-- suspension that names nobody is an operator's (the deactivate-principal
-- CLI); a reactivation always names someone.
create function chat.guard_staff_account_status()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_actor  uuid;
  v_target uuid;
begin
  v_actor := nullif(coalesce(nullif(current_setting('chat.account_admin_actor', true), ''),
                             current_setting('chat.revocation_requested_by', true)), '')::uuid;
  select s.id into v_target from chat.staff s where s.account_id = new.id;
  if v_actor is null then
    if new.status = 'active' then
      raise exception 'a staff account is reactivated by a named administrator (PD-40)' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;
  if v_target is null or not chat.may_administer_staff_account(v_actor, v_target) then
    raise exception 'only the super admin, or a manager for a specialist of their department, suspends or reactivates a staff account (PD-40 S1)'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger staff_account_status_by_administrator before update of status on chat.account
  for each row
  when (new.kind = 'staff'
        and ((new.status = 'suspended' and old.status <> 'suspended') or (old.status = 'suspended' and new.status = 'active')))
  execute function chat.guard_staff_account_status();

-- A session ended by ANOTHER account (chat.session.revoked_by): for a staff
-- account's session, that account's staff member must administer it. Signing
-- oneself out (revoked_by = the account, or null) is untouched.
create function chat.guard_staff_session_revocation()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_kind   text;
  v_target uuid;
  v_actor  uuid;
begin
  select a.kind into v_kind from chat.account a where a.id = new.account_id;
  if v_kind is distinct from 'staff' then return new; end if;
  select s.id into v_target from chat.staff s where s.account_id = new.account_id;
  select s.id into v_actor from chat.staff s where s.account_id = new.revoked_by;
  if v_actor is null or v_target is null or not chat.may_administer_staff_account(v_actor, v_target) then
    raise exception 'only the super admin, or a manager for a specialist of their department, signs a staff account out (PD-40 S1)'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger staff_session_revoked_by_administrator before update of revoked_at on chat.session
  for each row
  when (old.revoked_at is null and new.revoked_at is not null
        and new.revoked_by is not null and new.revoked_by is distinct from new.account_id)
  execute function chat.guard_staff_session_revocation();

-- ---------------------------------------------------------------------------
-- 9. Server-only
-- ---------------------------------------------------------------------------
alter table chat.department_account enable row level security;
revoke all on chat.department_account from public, anon, authenticated, chat_app;
revoke all on function chat.guard_department_account() from public;
revoke all on function chat.may_administer_staff_account(uuid, uuid) from public;
revoke all on function chat.create_staff_account(text, text, text, uuid, text, uuid) from public;
revoke all on function chat.set_access_role_permissions(uuid, text[]) from public;
revoke all on function chat.require_access_grantor(chat.staff, chat.staff, chat.access_role, boolean) from public;
revoke all on function chat.staff_in_managed_department(uuid, uuid) from public;
revoke all on function chat.guard_password_reset_code() from public;
revoke all on function chat.staff_access_profile(uuid) from public;
revoke all on function chat.grant_access_role(uuid, uuid, text, uuid) from public;
revoke all on function chat.update_access_role(uuid, text, text, text, text[], text, uuid) from public;
revoke all on function chat.guard_staff_account_status() from public;
revoke all on function chat.guard_staff_session_revocation() from public;
