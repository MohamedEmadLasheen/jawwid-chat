-- Roll back 20261125100000_chat_deny_enforcement (access management M3: enforced denies).
--
-- Removes the switch, the deny table (every recorded restriction is LOST: export it first if it matters; the audit log keeps its history),
-- the deniable flag, the writers and the evaluator, and restores chat.staff_access_profile (20261029100000) and chat.staff_access_sources (M1).
-- Roll the API back with it (it asks for chat.staff_denied_keys and the denied column).
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261125100000_chat_deny_enforcement.down.sql
-- Then: delete from chat.schema_migrations where version = '20261125100000_chat_deny_enforcement';

drop function chat.deny_permission(uuid, text, text, timestamptz, boolean, timestamptz, uuid);
drop function chat.revoke_permission_deny(uuid, text, uuid);

drop function chat.staff_access_sources(uuid);
drop function chat.staff_access_sources_raw(uuid);

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

create or replace function chat.staff_access_sources(p_staff uuid)
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

drop table chat.staff_permission_deny;
drop function chat.guard_staff_permission_deny();
drop function chat.staff_denied_keys(uuid);

select set_config('chat.pd040_catalogue_change', 'on', true);
alter table chat.permission drop column deniable;
select set_config('chat.pd040_catalogue_change', 'off', true);

drop table chat.access_switch;
drop function chat.guard_access_switch();
drop function chat.deny_enforcement_on();
