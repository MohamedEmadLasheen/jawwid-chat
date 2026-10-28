-- =============================================================================
-- PD-40 PR-4b · the department head's review of #231
--
--   - chat.seed_access_role_templates no longer skips in silence: when an
--     organization already has a NON-template role with a template's key, it
--     raises a notice and audits access_role.template_skipped (key, the
--     existing role's id). A template already seeded is skipped quietly, as
--     before -- that is the idempotence.
--   - chat.update_access_role clears is_template when the super admin changes a
--     template's permissions: is_template says where a role came from, so an
--     edited "designer" is never shown as the template.
--
-- Both are 20261029190000's and 20261029100000's functions with only the
-- marked lines added. The template list (the generated block) is unchanged.
-- New organizations: the super-admin bootstrap (cli/super-admin-bootstrap.ts)
-- now runs chat.seed_access_role_templates for its organization.
-- =============================================================================

create or replace function chat.seed_access_role_templates(p_org uuid)
returns integer
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  t       record;
  v_id    uuid;
  v_keys  text[];
  v_added integer := 0;
  v_other uuid;
begin
  if not exists (select 1 from chat.organization o where o.id = p_org) then
    raise exception 'no such organization' using errcode = 'no_data_found';
  end if;
  perform set_config('chat.pd040_access_change', 'on', true);
  for t in
    select *
      from (values
-- BEGIN GENERATED pd040 role templates -- by test/unit/authorization/pd040-role-templates.spec.ts; do not edit
        ('designer', 'Certificate designer', 'مصمم الشهادات', 'Designs and uploads certificates. Never sends one to a family.', 'specialist', array['certificates.design', 'certificates.view']::text[])
-- END GENERATED pd040 role templates
      ) as v (key, name_en, name_ar, description, max_tier, permissions)
  loop
    v_id := null;
    insert into chat.access_role (organization_id, key, name_en, name_ar, description, max_tier, is_template)
    values (p_org, t.key, t.name_en, t.name_ar, t.description, t.max_tier, true)
    on conflict (organization_id, key) do nothing
    returning id into v_id;
    if v_id is not null then
      v_keys := chat.set_access_role_permissions(v_id, t.permissions);
      insert into chat.audit_log (actor_id, action, entity, entity_id, before, after, reason)
      values (null, 'access_role.created', 'access_role', v_id, null,
              jsonb_build_object('key', t.key, 'maxTier', t.max_tier, 'permissions', to_jsonb(v_keys), 'template', true),
              'PD-40: a template role every organization starts with');
      v_added := v_added + 1;
    else
      -- Already seeded (a template), or the key taken by a role the super admin
      -- made. The second is said aloud and audited: a manager's later H5 refusal
      -- of "designer" then has a trail (review of #231).
      select r.id into v_other from chat.access_role r
       where r.organization_id = p_org and r.key = t.key and not r.is_template;
      if v_other is not null then
        raise notice 'PD-40: organization % already has a role keyed % (%) that is not a template; the template is not seeded',
          p_org, t.key, v_other;
        insert into chat.audit_log (actor_id, action, entity, entity_id, before, after, reason)
        values (null, 'access_role.template_skipped', 'access_role', v_other, null,
                jsonb_build_object('key', t.key, 'existingRoleId', v_other),
                'PD-40: the template''s key is already an organization role');
      end if;
    end if;
  end loop;
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
  -- is_template is provenance (review of #231): a template whose keys the super
  -- admin changed is the organization's own role from then on.
  if v_role.is_template and v_keys is distinct from v_before then
    update chat.access_role set is_template = false where id = p_role;
  end if;
  insert into chat.audit_log (actor_id, action, entity, entity_id, before, after, reason)
  values (v_actor.id, 'access_role.updated', 'access_role', p_role,
          jsonb_build_object('nameEn', v_role.name_en, 'nameAr', v_role.name_ar, 'permissions', to_jsonb(v_before)),
          jsonb_build_object('nameEn', coalesce(btrim(p_name_en), v_role.name_en), 'nameAr', coalesce(btrim(p_name_ar), v_role.name_ar),
                             'permissions', to_jsonb(v_keys),
                             'template', v_role.is_template and v_keys is not distinct from v_before),
          v_reason);
  perform set_config('chat.pd040_access_change', 'off', true);
end;
$$;

revoke all on function chat.seed_access_role_templates(uuid) from public;
revoke all on function chat.update_access_role(uuid, text, text, text, text[], text, uuid) from public;
