-- Roll back 20261122100000_chat_materials_author_review (educational materials: author / review roles).
--
-- Restores the library to "managed by the super admin and the Teachers manager" only:
--   * items waiting in review go back to DRAFT (nothing is deleted; their authors' work is kept);
--   * the in_review status, the two keys materials.author / materials.review (and any role that held them: the
--     rows are removed from the role), the Content author role and every grant of it are removed
--     (the audit log keeps the history of the grants);
--   * chat.guard_material_item and chat.seed_access_role_templates return to their previous bodies.
-- Roll back the API with it: it asks the database for chat.can_author_materials / can_review_materials.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261122100000_chat_materials_author_review.down.sql
--
-- Then delete the ledger row: delete from chat.schema_migrations where version = '20261122100000_chat_materials_author_review';

-- 1. Items in review return to draft (the trigger is paused for this one data fix: it is restored below).
alter table chat.material_item disable trigger material_item_is_coherent;
update chat.material_item set status = 'draft' where status = 'in_review';
alter table chat.material_item enable trigger material_item_is_coherent;
alter table chat.material_item drop constraint material_item_status_check;
alter table chat.material_item add constraint material_item_status_check check (status in ('draft', 'published', 'retired'));

-- 2. The grants, the role and the two keys.
select set_config('chat.pd040_access_change', 'on', true);
delete from chat.staff_access_role where role_id in (select id from chat.access_role where key = 'content_author' and is_template);
delete from chat.access_role_permission where role_id in (select id from chat.access_role where key = 'content_author' and is_template);
delete from chat.access_role where key = 'content_author' and is_template;
delete from chat.access_role_permission where permission_key in ('materials.author', 'materials.review');
select set_config('chat.pd040_access_change', 'off', true);
select set_config('chat.pd040_catalogue_change', 'on', true);
delete from chat.legacy_permission_bundle where permission_key in ('materials.author', 'materials.review');
delete from chat.permission where key in ('materials.author', 'materials.review');
select set_config('chat.pd040_catalogue_change', 'off', true);

-- 3. The previous functions (20261022180000's guard; 20261029235000's template seeder).
create or replace function chat.guard_material_item()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a library item is never deleted; retire it' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and (new.id, new.organization_id, new.created_by, new.created_at)
                          is distinct from (old.id, old.organization_id, old.created_by, old.created_at) then
    raise exception 'a library item''s identity never changes' using errcode = 'check_violation';
  end if;
  if not chat.can_manage_materials(new.updated_by, new.organization_id) then
    raise exception 'the library is managed by the super admin or the Teachers manager' using errcode = 'insufficient_privilege';
  end if;
  if new.object_key is not null
     and (tg_op = 'INSERT' or new.object_key is distinct from old.object_key)
     and not exists (select 1 from chat.material_upload u
                      where u.object_key = new.object_key and u.organization_id = new.organization_id
                        and u.purpose = 'item') then
    raise exception 'an item names only a file uploaded for its own organization''s library' using errcode = 'insufficient_privilege';
  end if;
  if new.source = 'package'
     and not exists (select 1 from chat.material_package_entry e
                      where e.object_key = new.object_key and e.path = new.package_entry) then
    raise exception 'a package starts at a file of its validated index' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

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
        ('designer', 'Certificate designer', 'مصمم الشهادات', 'Designs and uploads certificates. Never sends one to a family.', 'specialist', array['certificates.design', 'certificates.view']::text[]),
        ('pronunciation_reviewer', 'Pronunciation reviewer', 'مراجع النطق', 'Listens to the lessons'' computer-voice clips and approves or rejects each one. Two reviewers approve a clip before it plays.', 'specialist', array['lesson_audio.review', 'lesson_audio.view']::text[]),
        ('scholar_reviewer', 'Scholar reviewer', 'المراجع الشرعي', 'Signs the scholar''s step of children''s Quran content and of each game mechanic, after the source check and the teacher.', 'specialist', array['lesson_content.review_scholar', 'lesson_content.view']::text[])
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
      -- Said once: a re-run does not audit the same skipped role again (review of #254).
      if v_other is not null and not exists (
        select 1 from chat.audit_log a where a.action = 'access_role.template_skipped' and a.entity_id = v_other
      ) then
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

drop function chat.can_author_materials(uuid, uuid);
drop function chat.can_review_materials(uuid, uuid);
