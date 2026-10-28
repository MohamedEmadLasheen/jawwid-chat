-- =============================================================================
-- PD-49 · the review of children's Quran content and of game mechanics
-- (docs/product/pd049-children-quran-experience-plan.md §F.2)
--
-- Every item a child may see -- a tafsir line, a word meaning, a lesson, an
-- authenticated asbab report, a quiz question -- is our own wording, derived
-- from a public-domain source and cited (owner, 2026-10-29). It reaches a child
-- only after people signed it, step by step, for EXACTLY its text:
--
--   check    a second person opened the cited place and confirmed it;
--   teacher  the Teachers department: Arabic, age fit, accuracy;
--   scholar  the qualified scholar (tafsir, lessons, stories, asbab, aqeedah).
--
-- A game mechanic (scope 'play') is signed once, by a teacher and the scholar,
-- before any child plays it (plan §C.4: the respect rules).
--
--   chat.lesson_content_review   approve | reject | withdraw of ONE step of one
--                                item, bound to the SHA-256 of the item's
--                                canonical JSON (apps/lessons quran-content.ts,
--                                itemSha256). Append-only.
--
-- Which steps an item NEEDS is decided by its kind, in code (requiredSteps in
-- apps/lessons and apps/api); the database enforces how a step may be signed:
--   * by an ACTIVE staff member holding the step's key;
--   * in order: teacher after check, scholar after teacher (no check for play);
--   * one person, one step: nobody signs two steps of the same item;
--   * a rejection or a withdrawal is final for that text. The fix is a new
--     text, hence a new hash, signed from the start.
-- A changed item is a new hash: its old signatures still exist but no longer
-- describe it ("stale" is derived, never stored).
--
-- Nothing is granted to request roles: the API reads as the owner role and
-- writes only through chat.review_lesson_content, which takes the
-- authenticated actor (chat.trusted_staff_actor) and checks the key.
-- =============================================================================

-- --- The reviews ------------------------------------------------------------------

create table chat.lesson_content_review (
  id           bigint generated always as identity primary key,
  -- A surah's content (quran-NNN, the PD-48 lesson_key form) or the games ('play').
  scope        text not null check (scope ~ '^(quran-[0-9]{3}|play)$'),
  -- PD-29's ids (<kind>-NNN) for content; a mechanic's key for play.
  item_id      text not null,
  item_sha256  text not null check (item_sha256 ~ '^[0-9a-f]{64}$'),
  step         text not null check (step in ('check', 'teacher', 'scholar')),
  action       text not null check (action in ('approve', 'reject', 'withdraw')),
  staff_id     uuid not null references chat.staff (id),
  category     text check (category in ('wrong_meaning', 'not_in_source', 'aqeedah', 'weak_report', 'too_hard_for_band', 'language', 'respect', 'other')),
  reason       text check (reason is null or length(btrim(reason)) between 1 and 500),
  at           timestamptz not null default now(),
  constraint lesson_content_review_item_id check (
    case when scope = 'play' then item_id ~ '^[a-z][a-z0-9_]{1,62}$'
         else item_id ~ '^[a-z][a-z0-9_]*-[0-9]{3}$' end),
  -- A mechanic is not "checked against a source": it has no check step.
  constraint lesson_content_review_play_steps check (scope <> 'play' or step <> 'check'),
  -- An approval carries neither; a reject or a withdraw carries both (what is wrong, and why).
  constraint lesson_content_review_reason check (
    case when action = 'approve' then category is null and reason is null
         else category is not null and reason is not null end)
);

-- One approval per step per text: the backstop of "in order, once".
create unique index lesson_content_one_approval_per_step
  on chat.lesson_content_review (scope, item_id, item_sha256, step) where action = 'approve';
create index lesson_content_review_item_idx on chat.lesson_content_review (scope, item_id, item_sha256);

comment on table chat.lesson_content_review is
  'PD-49: who signed which review step (check, teacher, scholar) of a children''s Quran content item or a game mechanic, for which exact item hash, when; or rejected or withdrew it, and why. Append-only; written only through chat.review_lesson_content.';

-- The key a step needs (the same map is in apps/api/src/platform/lesson-content-policy.ts).
create function chat.lesson_content_step_key(p_step text)
returns text
language sql
immutable
as $$
  select case p_step
           when 'check' then 'lesson_content.check'
           when 'teacher' then 'lesson_content.review_teacher'
           when 'scholar' then 'lesson_content.review_scholar'
         end
$$;

-- 'withdrawn' or 'rejected' (final for this text), else 'open'.
create function chat.lesson_content_state(p_scope text, p_item text, p_sha256 text)
returns text
language sql
stable
set search_path = chat, pg_temp
as $$
  select case
           when bool_or(r.action = 'withdraw') then 'withdrawn'
           when bool_or(r.action = 'reject') then 'rejected'
           else 'open'
         end
    from chat.lesson_content_review r
   where r.scope = p_scope and r.item_id = p_item and r.item_sha256 = p_sha256;
$$;

-- The steps signed for this text, in order.
create function chat.lesson_content_steps(p_scope text, p_item text, p_sha256 text)
returns text[]
language sql
stable
set search_path = chat, pg_temp
as $$
  select coalesce(array_agg(s.step order by array_position(array['check', 'teacher', 'scholar'], s.step)), '{}')
    from (select distinct r.step
            from chat.lesson_content_review r
           where r.scope = p_scope and r.item_id = p_item and r.item_sha256 = p_sha256 and r.action = 'approve') s;
$$;

create function chat.guard_lesson_content_review()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_state text;
  v_steps text[];
  v_before text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'a content review is a record; it is never changed or removed' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from chat.staff s where s.id = new.staff_id and s.is_active and s.left_at is null)
     or not chat.staff_has_permission(new.staff_id, chat.lesson_content_step_key(new.step)) then
    raise exception 'the % step is signed only by an active reviewer holding %', new.step, chat.lesson_content_step_key(new.step)
      using errcode = 'insufficient_privilege';
  end if;
  v_state := coalesce(chat.lesson_content_state(new.scope, new.item_id, new.item_sha256), 'open');
  if v_state <> 'open' then
    raise exception 'this text of % is %: a corrected text is signed from the start', new.item_id, v_state using errcode = 'check_violation';
  end if;
  v_steps := chat.lesson_content_steps(new.scope, new.item_id, new.item_sha256);
  if new.action = 'withdraw' and cardinality(v_steps) = 0 then
    raise exception 'only a signed text is withdrawn; reject it instead' using errcode = 'check_violation';
  end if;
  if new.action = 'approve' then
    if new.step = any (v_steps) then
      raise exception 'the % step of % is already signed for this text', new.step, new.item_id using errcode = 'check_violation';
    end if;
    v_before := case new.step
                  when 'teacher' then case when new.scope = 'play' then null else 'check' end
                  when 'scholar' then 'teacher'
                end;
    if v_before is not null and not (v_before = any (v_steps)) then
      raise exception 'the % step comes after the % step', new.step, v_before using errcode = 'check_violation';
    end if;
    -- One person, one step: the steps are different people's judgements.
    if exists (select 1 from chat.lesson_content_review r
                where r.scope = new.scope and r.item_id = new.item_id and r.item_sha256 = new.item_sha256
                  and r.action = 'approve' and r.staff_id = new.staff_id) then
      raise exception 'you already signed a step of this text: the next step is someone else''s' using errcode = 'insufficient_privilege';
    end if;
  end if;
  new.at := now();
  return new;
end;
$$;

-- Never truncated, except by the integration harness's cleanup, which says so
-- in its own transaction (chat.test_truncate), as for PD-47's and PD-48's tables.
create function chat.guard_lesson_content_truncate()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if coalesce(current_setting('chat.test_truncate', true), '') = 'on' then
    return null;
  end if;
  raise exception 'content reviews are never truncated' using errcode = 'check_violation';
end;
$$;

create trigger lesson_content_review_is_append_only before insert or update or delete on chat.lesson_content_review
  for each row execute function chat.guard_lesson_content_review();
create trigger lesson_content_review_no_truncate before truncate on chat.lesson_content_review
  for each statement execute function chat.guard_lesson_content_truncate();

-- --- The one write a reviewer makes -------------------------------------------------

-- Sign, reject or withdraw one step of one item's exact text. The API passes
-- the hash of the item as it was built with it (apps/api review subjects), so
-- a signature is of THIS text or nothing is recorded. Returns the text's state
-- and its signed steps afterwards.
create function chat.review_lesson_content(
  p_scope     text,
  p_item      text,
  p_sha256    text,
  p_step      text,
  p_action    text,
  p_category  text,
  p_reason    text,
  p_actor_id  uuid default null
) returns jsonb
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_actor uuid := chat.trusted_staff_actor(p_actor_id);
  v_state text;
  v_steps text[];
begin
  if p_action not in ('approve', 'reject', 'withdraw') then
    raise exception 'unknown review action %', p_action using errcode = 'invalid_parameter_value';
  end if;
  -- One review at a time per text, so two people cannot both sign "the next step".
  perform pg_advisory_xact_lock(hashtext('pd049:' || p_scope || ':' || p_item || ':' || p_sha256));
  insert into chat.lesson_content_review (scope, item_id, item_sha256, step, action, staff_id, category, reason)
  values (p_scope, p_item, p_sha256, p_step, p_action, v_actor,
          case when p_action = 'approve' then null else p_category end,
          case when p_action = 'approve' then null else nullif(btrim(p_reason), '') end);
  v_state := chat.lesson_content_state(p_scope, p_item, p_sha256);
  v_steps := chat.lesson_content_steps(p_scope, p_item, p_sha256);
  insert into chat.audit_log (actor_id, action, entity, entity_id, before, after, reason)
  values (v_actor,
          case p_action when 'approve' then 'lesson_content.signed' when 'reject' then 'lesson_content.rejected' else 'lesson_content.withdrawn' end,
          'lesson_content_item', null, null,
          jsonb_build_object('scope', p_scope, 'itemId', p_item, 'itemSha256', p_sha256, 'step', p_step,
                             'state', v_state, 'steps', to_jsonb(v_steps),
                             'category', case when p_action = 'approve' then null else p_category end),
          -- audit_log needs a reason; a signature's is the step it signs.
          case when p_action = 'approve' then 'PD-49: signed the ' || p_step || ' step of this exact text'
               else coalesce(nullif(btrim(p_reason), ''), 'PD-49: no reason given') end);
  return jsonb_build_object('state', v_state, 'steps', to_jsonb(v_steps));
end;
$$;

-- --- PD-40: the four keys and their bundles -------------------------------------------

select set_config('chat.pd040_catalogue_change', 'on', true);
-- BEGIN GENERATED pd049 catalogue rows -- by test/unit/authorization/pd040-catalogue-seed.spec.ts; do not edit
insert into chat.permission (key, page, action, label_en, label_ar, risk, delegable, introduced_by) values
  ('lesson_content.view', 'lesson_content', 'view', 'See lesson content under review', 'الاطلاع على محتوى الدروس قيد المراجعة', 'none', true, 'PD-49'),
  ('lesson_content.check', 'lesson_content', 'check', 'Check lesson content against its source', 'مطابقة محتوى الدروس بمصدره', 'none', true, 'PD-49'),
  ('lesson_content.review_teacher', 'lesson_content', 'review_teacher', 'Approve lesson content as a teacher', 'اعتماد محتوى الدروس تربويًّا', 'none', true, 'PD-49'),
  ('lesson_content.review_scholar', 'lesson_content', 'review_scholar', 'Approve lesson content as the scholar', 'اعتماد محتوى الدروس شرعيًّا', 'none', false, 'PD-49');

insert into chat.legacy_permission_bundle (tier, department_kind, permission_key) values
  ('manager', 'teachers', 'lesson_content.check'),
  ('manager', 'teachers', 'lesson_content.review_teacher'),
  ('manager', 'teachers', 'lesson_content.view'),
  ('supervisor', 'teachers', 'lesson_content.view');

update chat.permission set delegable = true where key in ('lesson_content.check', 'lesson_content.review_teacher', 'lesson_content.view');
-- END GENERATED pd049 catalogue rows
select set_config('chat.pd040_catalogue_change', 'off', true);

-- --- PD-40: the Scholar reviewer template ------------------------------------------
-- 20261029220000's function with only the template list (the generated block)
-- grown; every organization that exists today gets the new template. Its key
-- (lesson_content.review_scholar) is not delegable: only the super admin grants
-- this role (owner, 2026-10-29; plan §F.2).

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

-- Every organization there is today.
select chat.seed_access_role_templates(o.id) from chat.organization o;

-- --- Grants: none to request roles ---------------------------------------------------

alter table chat.lesson_content_review enable row level security;
revoke all on chat.lesson_content_review from public, anon, authenticated, chat_app;
revoke all on function chat.lesson_content_step_key(text) from public;
revoke all on function chat.lesson_content_state(text, text, text) from public;
revoke all on function chat.lesson_content_steps(text, text, text) from public;
revoke all on function chat.guard_lesson_content_review() from public;
revoke all on function chat.guard_lesson_content_truncate() from public;
revoke all on function chat.review_lesson_content(text, text, text, text, text, text, text, uuid) from public;
revoke all on function chat.seed_access_role_templates(uuid) from public;
