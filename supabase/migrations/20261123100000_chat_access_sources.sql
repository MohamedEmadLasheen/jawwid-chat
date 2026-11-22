-- Access management M1: WHERE each permission a staff member holds comes from (read-only).
--
-- chat.staff_access_profile (unchanged) answers WHAT a person holds. This function answers WHY, one row per
-- (key, source): the super admin's own power, the tier-and-department default, or a granted access role (with who
-- granted it, when and why). It follows staff_access_profile's rules exactly (a stale placement counts as no
-- department; a key barred from roles counts for nobody through one), and a spec holds the two equal for every
-- staff member, so the view of access can never disagree with the access itself.
--
-- Additive: no table, policy or existing function changes. Rollback: db/rollback/20261123100000_chat_access_sources.down.sql.

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

comment on function chat.staff_access_sources(uuid) is
  'Access management M1: why a staff member holds each permission (super admin, tier default, or a granted role with who/when/why). Read-only; equals chat.staff_access_profile''s keys.';

revoke all on function chat.staff_access_sources(uuid) from public;
