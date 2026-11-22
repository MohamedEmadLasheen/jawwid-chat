-- Access management M3: ENFORCED DENIES (owner decision 2026-11-22; isolated development and disposable databases only).
--
-- A deny is an explicit, recorded, time-limited restriction on ONE permission of ONE staff member. It removes the key whatever granted
-- it (tier default, role) and it is enforced where the key is enforced: chat.staff_access_profile (so every SQL rule that asks
-- chat.staff_has_permission, and the API through PermissionService, see it) and the API PermissionGuard (a deny is refused in EVERY
-- mode, including the legacy-tier shadow mode).
--
-- PRODUCTION STAYS UNCHANGED until the owner separately approves enforcement:
--   * chat.access_switch 'deny_enforcement' is OFF. While it is off chat.staff_denied_keys() is empty (no behaviour change anywhere)
--     AND chat.deny_permission() refuses to record a deny, so no deny can exist in a database that does not enforce it
--     (no "recorded but inert" state, no mixed state). Turning it on is an operator statement, never a console edit of chat.config:
--     the switch table is server-only and writable only inside a statement that sets chat.access_switch_change = 'on'.
--   * only keys verified end to end can be denied (permission.deniable). The first set is: materials.author, materials.review,
--     lesson_audio.view, lesson_audio.review, certificates.design. A spec holds every deniable key to a coverage record.
--
-- Authority (owner Decision 3): the super admin denies any deniable key of any non-super-admin account in the organization; a department
-- manager only for SPECIALISTS of the department they run, only keys they themselves hold and may delegate (the same triple as a role grant),
-- never themselves, never a manager, supervisor or super admin. A manager can neither revoke nor replace a deny made by the super admin.
-- Every deny has a reason and an expiry (a manager's at most 90 days; the super admin's at most 365) or, for the super admin only, is permanent with a
-- review date. Every change is audited (actor, employee, permission, reason, before, after, time). The super admin is never denied.
--
-- Additive. Rollback: db/rollback/20261125100000_chat_deny_enforcement.down.sql.

-- ---------------------------------------------------------------------------
-- 1. The switch (server-only; OFF)
-- ---------------------------------------------------------------------------
create table chat.access_switch (
  name       text primary key,
  enabled    boolean not null default false,
  changed_at timestamptz not null default now(),
  note       text
);
insert into chat.access_switch (name, enabled, note) values
  ('deny_enforcement', false, 'Access management M3: denies are recorded and enforced only while this is on. Production: off until the owner approves.');

create function chat.guard_access_switch()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('chat.access_switch_change', true), '') <> 'on' then
    raise exception 'an access switch changes only by an operator statement that sets chat.access_switch_change (access management M3)'
      using errcode = 'insufficient_privilege';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger access_switch_guarded before insert or update or delete on chat.access_switch
  for each row execute function chat.guard_access_switch();
alter table chat.access_switch enable row level security;
revoke all on chat.access_switch from public, anon, authenticated, chat_app;
revoke all on function chat.guard_access_switch() from public;

create function chat.deny_enforcement_on()
returns boolean
language sql
stable
as $$
  select coalesce((select s.enabled from chat.access_switch s where s.name = 'deny_enforcement'), false);
$$;
revoke all on function chat.deny_enforcement_on() from public;

-- ---------------------------------------------------------------------------
-- 2. Which keys can be denied: only those whose enforcement is verified end to end
-- ---------------------------------------------------------------------------
alter table chat.permission add column deniable boolean not null default false;
select set_config('chat.pd040_catalogue_change', 'on', true);
update chat.permission set deniable = true
 where key in ('materials.author', 'materials.review', 'lesson_audio.view', 'lesson_audio.review', 'certificates.design');
select set_config('chat.pd040_catalogue_change', 'off', true);

-- ---------------------------------------------------------------------------
-- 3. The denies (append-only: a row changes only to record its revocation)
-- ---------------------------------------------------------------------------
create table chat.staff_permission_deny (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references chat.organization (id),
  staff_id        uuid not null references chat.staff (id),
  permission_key  text not null references chat.permission (key),
  reason          text not null check (length(btrim(reason)) between 1 and 500),
  created_by      uuid not null references chat.staff (id),
  created_by_role text not null check (created_by_role in ('super_admin', 'manager')),
  created_at      timestamptz not null default now(),
  expires_at      timestamptz,
  permanent       boolean not null default false,
  review_by       timestamptz,
  revoked_at      timestamptz,
  revoked_by      uuid references chat.staff (id),
  revoke_reason   text check (revoke_reason is null or length(btrim(revoke_reason)) between 1 and 500),
  constraint deny_has_a_limit check (
    (permanent and expires_at is null and review_by is not null and created_by_role = 'super_admin')
    or (not permanent and expires_at is not null and expires_at > created_at)),
  constraint deny_revocation_is_whole check ((revoked_at is null) = (revoked_by is null) and (revoked_at is null) = (revoke_reason is null))
);
create index staff_permission_deny_by_staff on chat.staff_permission_deny (staff_id) where revoked_at is null;
create index staff_permission_deny_by_org on chat.staff_permission_deny (organization_id, created_at desc);

comment on table chat.staff_permission_deny is
  'Access management M3: an explicit restriction on one permission of one staff member. Written only by chat.deny_permission / revoke_permission_deny; changes only to record a revocation.';

create function chat.guard_staff_permission_deny()
returns trigger
language plpgsql
as $$
declare
  v_target chat.staff%rowtype;
  v_deniable boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'a deny is a record: it is revoked, never deleted' using errcode = 'check_violation';
  end if;
  if coalesce(current_setting('chat.deny_change', true), '') <> 'on' then
    raise exception 'denies are written only through chat.deny_permission and chat.revoke_permission_deny' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' then
    if (new.id, new.organization_id, new.staff_id, new.permission_key, new.reason, new.created_by, new.created_by_role, new.created_at, new.expires_at, new.permanent, new.review_by)
       is distinct from
       (old.id, old.organization_id, old.staff_id, old.permission_key, old.reason, old.created_by, old.created_by_role, old.created_at, old.expires_at, old.permanent, old.review_by) then
      raise exception 'a deny is not edited; revoke it and record a new one' using errcode = 'check_violation';
    end if;
    if old.revoked_at is not null then
      raise exception 'a revoked deny is final' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  select * into v_target from chat.staff where id = new.staff_id;
  if v_target.id is null or v_target.organization_id is distinct from new.organization_id then
    raise exception 'a deny is on an account of its own organization' using errcode = 'insufficient_privilege';
  end if;
  -- The super admin's protected authority: never denied, by anyone, at the table itself.
  if v_target.role = 'super_admin' then
    raise exception 'the super admin''s authority is never denied' using errcode = 'insufficient_privilege';
  end if;
  select p.deniable into v_deniable from chat.permission p where p.key = new.permission_key;
  if not coalesce(v_deniable, false) then
    raise exception 'permission % cannot be denied yet: its enforcement is not complete', new.permission_key using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger staff_permission_deny_guarded before insert or update or delete on chat.staff_permission_deny
  for each row execute function chat.guard_staff_permission_deny();
alter table chat.staff_permission_deny enable row level security;
revoke all on chat.staff_permission_deny from public, anon, authenticated, chat_app;
revoke all on function chat.guard_staff_permission_deny() from public;

-- ---------------------------------------------------------------------------
-- 4. The evaluator: the denied keys of a staff member, now
-- ---------------------------------------------------------------------------
create function chat.staff_denied_keys(p_staff uuid)
returns text[]
language sql
stable
set search_path = chat, pg_temp
as $$
  select case
    when not chat.deny_enforcement_on() then array[]::text[]
    when exists (select 1 from chat.staff s where s.id = p_staff and s.role = 'super_admin') then array[]::text[]
    else coalesce((select array_agg(distinct d.permission_key order by d.permission_key)
                     from chat.staff_permission_deny d
                    where d.staff_id = p_staff and d.revoked_at is null
                      and (d.permanent or d.expires_at > now())), array[]::text[])
  end;
$$;
revoke all on function chat.staff_denied_keys(uuid) from public;

-- chat.staff_access_profile: 20261029100000's function with ONE added clause (the deny).
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
      ) held
      -- M3: an active deny removes the key whatever granted it (empty unless enforcement is on; never for the super admin).
      where not (k = any (chat.staff_denied_keys(p_staff)));
  end if;

  return query select v_tier, v_kind, v_position, coalesce(v_keys, array[]::text[]);
end;
$$;

-- chat.staff_access_sources (M1) keeps its rows and gains `denied`: the M1 function becomes the raw source list and a wrapper flags denied keys.
drop function chat.staff_access_sources(uuid);
create or replace function chat.staff_access_sources_raw(p_staff uuid)
returns table (
  permission_key text,
  source         text,
  role_id        uuid,
  role_key       text,
  name_en        text,
  name_ar        text,
  granted_by     uuid,
  granted_by_name text,
  granted_at     timestamptz,
  reason         text
)
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
begin
  select * into v_staff from chat.staff s where s.id = p_staff;
  if not found or not v_staff.is_active or v_staff.left_at is not null then
    return;
  end if;
  v_tier := chat.staff_tier(v_staff.role);

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
  v_fitted := case
    when (v_tier = 'manager' and v_position = 'manager') or (v_tier = 'supervisor' and v_position = 'member') then v_kind
    else 'none'
  end;

  if v_tier = 'super_admin' then
    return query
      select p.key, 'super_admin'::text, null::uuid, null::text, null::text, null::text, null::uuid, null::text, null::timestamptz, null::text
        from chat.permission p order by p.key;
    return;
  end if;

  return query
    select b.permission_key, 'tier_default'::text, null::uuid, null::text, null::text, null::text, null::uuid, null::text, null::timestamptz, null::text
      from chat.legacy_permission_bundle b
     where b.tier = v_tier and b.department_kind = v_fitted
    union all
    select arp.permission_key, 'role'::text, r.id, r.key, r.name_en, r.name_ar, sar.granted_by, g.name, sar.granted_at, sar.reason
      from chat.staff_access_role sar
      join chat.access_role r on r.id = sar.role_id and r.organization_id = v_staff.organization_id
      join chat.access_role_permission arp on arp.role_id = sar.role_id
      join chat.permission p on p.key = arp.permission_key and p.in_roles
      left join chat.staff g on g.id = sar.granted_by
     where sar.staff_id = p_staff
    order by 1, 2, 4;
end;
$$;

create function chat.staff_access_sources(p_staff uuid)
returns table (
  permission_key text,
  source         text,
  role_id        uuid,
  role_key       text,
  name_en        text,
  name_ar        text,
  granted_by     uuid,
  granted_by_name text,
  granted_at     timestamptz,
  reason         text,
  denied         boolean
)
language sql
stable
set search_path = chat, pg_temp
as $$
  select r.*, (r.permission_key = any (chat.staff_denied_keys(p_staff))) as denied
    from chat.staff_access_sources_raw(p_staff) r;
$$;
comment on function chat.staff_access_sources(uuid) is
  'Access management M1+M3: why a staff member holds each permission (super admin, tier default, or a granted role), and whether an active deny now removes it. Read-only.';
revoke all on function chat.staff_access_sources(uuid) from public;
revoke all on function chat.staff_access_sources_raw(uuid) from public;

-- ---------------------------------------------------------------------------
-- 5. The writers (the only way a deny is recorded or lifted)
-- ---------------------------------------------------------------------------
create function chat.deny_permission(
  p_staff       uuid,
  p_key         text,
  p_reason      text,
  p_expires_at  timestamptz default null,
  p_permanent   boolean default false,
  p_review_by   timestamptz default null,
  p_actor_id    uuid default null
) returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_actor    chat.staff := chat.require_live_staff(chat.trusted_staff_actor(p_actor_id));
  v_reason   text := chat.require_reason(p_reason);
  v_target   chat.staff%rowtype;
  v_perm     chat.permission%rowtype;
  v_by_role  text;
  v_held     text[];
  v_max      interval;
  v_id       uuid;
begin
  if not chat.deny_enforcement_on() then
    raise exception 'denies are not enforced in this environment, so none is recorded (access management M3)' using errcode = 'feature_not_supported';
  end if;
  select * into v_target from chat.staff where id = p_staff for update;
  select * into v_perm from chat.permission where key = p_key;
  if v_target.id is null or v_perm.key is null then
    raise exception 'no such staff member or permission' using errcode = 'no_data_found';
  end if;
  if v_target.organization_id is distinct from v_actor.organization_id then
    raise exception 'no such staff member or permission' using errcode = 'no_data_found';
  end if;
  if v_target.id = v_actor.id then
    raise exception 'nobody denies their own permissions' using errcode = 'insufficient_privilege';
  end if;
  if v_target.role = 'super_admin' then
    raise exception 'the super admin''s authority is never denied' using errcode = 'insufficient_privilege';
  end if;
  if not v_perm.deniable then
    raise exception 'permission % cannot be denied yet: its enforcement is not complete', p_key using errcode = 'check_violation';
  end if;

  if v_actor.role = 'super_admin' then
    v_by_role := 'super_admin';
    v_max := interval '365 days';
  else
    v_by_role := 'manager';
    v_max := interval '90 days';
    if v_actor.role <> 'manager' or not chat.staff_has_permission(v_actor.id, 'staff_accounts.manage') then
      raise exception 'only the super admin or a department manager records a deny (Decision 3)' using errcode = 'insufficient_privilege';
    end if;
    if v_target.role <> 'specialist' then
      raise exception 'a manager restricts specialists only, never a manager, supervisor or higher account (Decision 3)' using errcode = 'insufficient_privilege';
    end if;
    if not chat.staff_in_managed_department(v_actor.id, v_target.id) then
      raise exception 'a manager restricts specialists of their own department only (Decision 3)' using errcode = 'insufficient_privilege';
    end if;
    -- Only within delegated authority: a key the manager holds and may delegate (the same triple as granting a role).
    if not (v_perm.delegable and v_perm.in_roles and chat.staff_has_permission(v_actor.id, p_key)) then
      raise exception 'a manager restricts only permissions they hold and may delegate (Decision 3)' using errcode = 'insufficient_privilege';
    end if;
    if p_permanent then
      raise exception 'a permanent restriction needs the super admin (Decision 3)' using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- The target must hold the key now, and not already be denied it.
  select p.permissions into v_held from chat.staff_access_profile(p_staff) p;
  if exists (select 1 from chat.staff_permission_deny d where d.staff_id = p_staff and d.permission_key = p_key and d.revoked_at is null and (d.permanent or d.expires_at > now())) then
    raise exception 'this permission is already denied to this account' using errcode = 'check_violation';
  end if;
  if v_held is null or not (p_key = any (v_held)) then
    raise exception 'this account does not hold permission %, so there is nothing to deny', p_key using errcode = 'check_violation';
  end if;

  if p_permanent then
    if p_expires_at is not null or p_review_by is null or p_review_by <= now() or p_review_by > now() + interval '365 days' then
      raise exception 'a permanent restriction has a review date within a year and no expiry' using errcode = 'check_violation';
    end if;
  else
    if p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + v_max then
      raise exception 'a restriction expires within % days' , extract(day from v_max)::int using errcode = 'check_violation';
    end if;
  end if;

  perform set_config('chat.deny_change', 'on', true);
  insert into chat.staff_permission_deny (organization_id, staff_id, permission_key, reason, created_by, created_by_role, expires_at, permanent, review_by)
  values (v_actor.organization_id, p_staff, p_key, v_reason, v_actor.id, v_by_role, case when p_permanent then null else p_expires_at end, p_permanent, case when p_permanent then p_review_by else null end)
  returning id into v_id;
  insert into chat.audit_log (actor_id, action, entity, entity_id, before, after, reason)
  values (v_actor.id, 'staff.permission_denied', 'staff', p_staff, null,
          jsonb_build_object('denyId', v_id, 'permission', p_key, 'by', v_by_role, 'expiresAt', p_expires_at, 'permanent', p_permanent, 'reviewBy', p_review_by), v_reason);
  perform set_config('chat.deny_change', 'off', true);
  return v_id;
end;
$$;

create function chat.revoke_permission_deny(p_deny uuid, p_reason text, p_actor_id uuid default null)
returns boolean
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_actor  chat.staff := chat.require_live_staff(chat.trusted_staff_actor(p_actor_id));
  v_reason text := chat.require_reason(p_reason);
  v_deny   chat.staff_permission_deny%rowtype;
  v_target chat.staff%rowtype;
begin
  select * into v_deny from chat.staff_permission_deny where id = p_deny for update;
  if v_deny.id is null or v_deny.organization_id is distinct from v_actor.organization_id then
    raise exception 'no such restriction' using errcode = 'no_data_found';
  end if;
  if v_deny.revoked_at is not null then
    raise exception 'this restriction was already lifted' using errcode = 'check_violation';
  end if;
  if v_actor.role <> 'super_admin' then
    if v_deny.created_by_role = 'super_admin' then
      raise exception 'only the super admin lifts a restriction the super admin made (Decision 3)' using errcode = 'insufficient_privilege';
    end if;
    select * into v_target from chat.staff where id = v_deny.staff_id;
    if v_actor.role <> 'manager' or v_deny.created_by <> v_actor.id
       or not chat.staff_in_managed_department(v_actor.id, v_deny.staff_id) or v_target.role <> 'specialist' then
      raise exception 'a manager lifts only the restrictions they made, on specialists of their own department (Decision 3)' using errcode = 'insufficient_privilege';
    end if;
  end if;
  perform set_config('chat.deny_change', 'on', true);
  update chat.staff_permission_deny set revoked_at = now(), revoked_by = v_actor.id, revoke_reason = v_reason where id = p_deny;
  insert into chat.audit_log (actor_id, action, entity, entity_id, before, after, reason)
  values (v_actor.id, 'staff.permission_deny_lifted', 'staff', v_deny.staff_id,
          jsonb_build_object('denyId', p_deny, 'permission', v_deny.permission_key, 'by', v_deny.created_by_role, 'expiresAt', v_deny.expires_at, 'permanent', v_deny.permanent), null, v_reason);
  perform set_config('chat.deny_change', 'off', true);
  return true;
end;
$$;

revoke all on function chat.deny_permission(uuid, text, text, timestamptz, boolean, timestamptz, uuid) from public;
revoke all on function chat.revoke_permission_deny(uuid, text, uuid) from public;
