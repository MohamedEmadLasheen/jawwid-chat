-- =============================================================================
-- PD-40 PR-4 · the Designer template role
--
-- Plan §7 and §11.1 (scope cut 2026-10-27): PD-41 owns the certificates
-- workflow, its routes and its keys. PD-40 seeds only the `designer` template
-- role -- tier specialist, certificates.view + certificates.design -- into
-- every organization, so the super admin (or the Teachers manager, who holds
-- and may delegate both keys) can hand it out without building it first.
--
-- A template is ordinary data once seeded (chat.access_role.is_template says
-- only where it came from): the super admin edits or archives it like any
-- role, and every grant goes through chat.grant_access_role's rules. Nothing
-- here changes the catalogue, the legacy bundles or an earlier seed block.
--
-- chat.seed_access_role_templates(org) is idempotent and skips a key the
-- organization already uses, so it may run again for an organization created
-- later. The template list is the generated block below, rendered from
-- apps/api/src/platform/permissions/role-templates.ts by
-- test/unit/authorization/pd040-role-templates.spec.ts.
-- =============================================================================

create function chat.seed_access_role_templates(p_org uuid)
returns integer
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  t       record;
  v_id    uuid;
  v_keys  text[];
  v_added integer := 0;
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
    end if;
  end loop;
  perform set_config('chat.pd040_access_change', 'off', true);
  return v_added;
end;
$$;

comment on function chat.seed_access_role_templates(uuid) is
  'PD-40 PR-4: adds the template access roles (role-templates.ts) an organization lacks; returns how many. Idempotent.';

-- Every organization there is today.
select chat.seed_access_role_templates(o.id) from chat.organization o;

revoke all on function chat.seed_access_role_templates(uuid) from public;
