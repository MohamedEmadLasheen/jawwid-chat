-- Educational materials: who writes, who approves, who manages (owner decision, 2026-11-22).
--
--   materials.manage   library administration and oversight: the super admin and the Teachers manager
--                      (chat.can_manage_materials, unchanged). Everything below, plus retire, import,
--                      recitations and editing a published item.
--   materials.review   approves (in_review -> published) or returns (in_review -> draft) an item.
--                      The Teachers supervisors. Never the item's own author (four eyes), and never
--                      changes what the item says: only its status.
--   materials.author   creates items as drafts, edits its OWN drafts, and submits them for review
--                      (draft -> in_review). A designated Content author: granted, never assumed.
--
-- A teacher keeps materials.view: approved items to teach with, no writing. An item nobody has
-- approved is never served to a family: the reader answers published items only (unchanged) and
-- chat.material_item refuses a family-facing status change by anyone but a reviewer or a manager.
--
-- Nothing is deleted or rewritten: the existing items and their statuses stay as they are, and the
-- Teachers manager and the super admin keep every right they had.

-- --- the new status ---------------------------------------------------------------------
alter table chat.material_item drop constraint material_item_status_check;
alter table chat.material_item add constraint material_item_status_check
  check (status in ('draft', 'in_review', 'published', 'retired'));

-- --- who may do what --------------------------------------------------------------------
create or replace function chat.can_author_materials(p_staff uuid, p_org uuid)
returns boolean
language sql
stable
set search_path = chat, pg_temp
as $$
  select exists (select 1 from chat.staff s
                  where s.id = p_staff and s.organization_id = p_org and s.is_active and s.left_at is null)
         and chat.staff_has_permission(p_staff, 'materials.author');
$$;

create or replace function chat.can_review_materials(p_staff uuid, p_org uuid)
returns boolean
language sql
stable
set search_path = chat, pg_temp
as $$
  select exists (select 1 from chat.staff s
                  where s.id = p_staff and s.organization_id = p_org and s.is_active and s.left_at is null)
         and chat.staff_has_permission(p_staff, 'materials.review');
$$;

-- The item's rows: a manager writes anything (as before); an author starts a draft and edits only
-- their own draft, which they may hand to review; a reviewer moves an item in review to published
-- or back to draft, never the person who wrote it, and changes nothing but its status.
create or replace function chat.guard_material_item()
returns trigger
language plpgsql
as $$
declare
  v_manager boolean;
  v_same    boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'a library item is never deleted; retire it' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and (new.id, new.organization_id, new.created_by, new.created_at)
                          is distinct from (old.id, old.organization_id, old.created_by, old.created_at) then
    raise exception 'a library item''s identity never changes' using errcode = 'check_violation';
  end if;
  v_manager := chat.can_manage_materials(new.updated_by, new.organization_id);
  if not v_manager then
    if tg_op = 'INSERT' then
      if not chat.can_author_materials(new.updated_by, new.organization_id) then
        raise exception 'the library is managed by the super admin or the Teachers manager; authors write drafts and reviewers approve them' using errcode = 'insufficient_privilege';
      end if;
      if new.created_by <> new.updated_by or new.status <> 'draft' then
        raise exception 'an author starts an item as a draft; a reviewer publishes it' using errcode = 'insufficient_privilege';
      end if;
    elsif old.status = 'draft' and new.status in ('draft', 'in_review')
          and old.created_by = new.updated_by and chat.can_author_materials(new.updated_by, new.organization_id) then
      null; -- an author's own draft
    elsif old.status = 'in_review' and new.status in ('published', 'draft')
          and chat.can_review_materials(new.updated_by, new.organization_id)
          and new.updated_by is distinct from old.created_by and new.updated_by is distinct from old.updated_by then
      v_same := (to_jsonb(new) - 'status' - 'updated_by' - 'updated_at') = (to_jsonb(old) - 'status' - 'updated_by' - 'updated_at');
      if not v_same then
        raise exception 'a reviewer approves or returns an item; the author changes what it says' using errcode = 'insufficient_privilege';
      end if;
    else
      raise exception 'the library is managed by the super admin or the Teachers manager; authors write drafts and reviewers approve them' using errcode = 'insufficient_privilege';
    end if;
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

revoke all on function chat.can_author_materials(uuid, uuid) from public;
revoke all on function chat.can_review_materials(uuid, uuid) from public;
revoke all on function chat.guard_material_item() from public;

-- --- PD-40: the two keys, their bundles and the Content author role --------------------------

select set_config('chat.pd040_catalogue_change', 'on', true);
-- BEGIN GENERATED matroles catalogue rows -- by test/unit/authorization/pd040-catalogue-seed.spec.ts; do not edit
insert into chat.permission (key, page, action, label_en, label_ar, risk, delegable, introduced_by) values
  ('materials.author', 'materials', 'author', 'Write educational materials (drafts)', 'كتابة المواد التعليمية (مسودات)', 'none', true, 'MAT-1'),
  ('materials.review', 'materials', 'review', 'Approve educational materials', 'اعتماد المواد التعليمية', 'none', true, 'MAT-1');

insert into chat.legacy_permission_bundle (tier, department_kind, permission_key) values
  ('manager', 'teachers', 'materials.author'),
  ('manager', 'teachers', 'materials.review'),
  ('supervisor', 'teachers', 'materials.review');

update chat.permission set delegable = true where key in ('materials.author', 'materials.review');
-- END GENERATED matroles catalogue rows
select set_config('chat.pd040_catalogue_change', 'off', true);

-- 20261029235000's (PD-49) function, word for word, with only the template list (the generated block)
-- grown by the Content author; every organization that exists today gets the new template.
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
        ('scholar_reviewer', 'Scholar reviewer', 'المراجع الشرعي', 'Signs the scholar''s step of children''s Quran content and of each game mechanic, after the source check and the teacher.', 'specialist', array['lesson_content.review_scholar', 'lesson_content.view']::text[]),
        ('content_author', 'Content author', 'كاتب المحتوى التعليمي', 'Writes educational materials as drafts and submits them for review. Never publishes or manages the library.', 'specialist', array['materials.author']::text[])
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

-- Every organization there is today.
select chat.seed_access_role_templates(o.id) from chat.organization o;

revoke all on function chat.seed_access_role_templates(uuid) from public;
