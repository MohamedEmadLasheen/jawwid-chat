-- =============================================================================
-- PD-48 · voice-over for the Arabic lessons (docs/product/pd048-lesson-voice-over-design.md)
--
-- Computer-voice clips for the reading strings of apps/lessons. A clip plays to
-- a child only after TWO different Teachers-department reviewers approved
-- exactly its bytes for exactly its text (owner, 2026-10-28/29):
--
--   chat.lesson_audio_clip            one generated clip of one string: its exact
--                                     text (text_sha256 GENERATED), its render
--                                     recipe, and the SHA-256 of the STORED object.
--                                     Written only by the server's ingest.
--   chat.lesson_audio_review          approve | reject | withdraw, by a reviewer,
--                                     naming the hashes they checked. Append-only.
--   chat.lesson_audio_string_decision "no audio" or "one more round" for a string
--                                     whose clips kept failing. Append-only.
--
-- Nothing here is Quran audio: Quran recitation is never TTS (chat.quran_* and
-- quran.audio.* are untouched). Nothing is granted to request roles; the API
-- reads as the owner role and writes reviews only through
-- chat.review_lesson_audio_clip / chat.decide_lesson_audio_string, which take
-- the authenticated actor (chat.trusted_staff_actor) and check the key.
--
-- A clip's state is never stored: it is derived from its reviews
-- (chat.lesson_audio_clip_state). A clip whose text no longer matches the
-- lesson is "stale" without any row changing: the API serves only clips whose
-- text_sha256 equals the text it was built with (apps/api/src/lesson-audio/texts).
-- =============================================================================

-- --- Fixed values -----------------------------------------------------------

-- The owner's rule (2026-10-28, re-confirmed 2026-10-29): two different
-- teachers approve every clip. The same constant is APPROVALS_REQUIRED in
-- apps/api/src/lesson-audio/lesson-audio-key.ts; a unit spec holds them equal.
create function chat.lesson_audio_approvals_required()
returns integer
language sql
immutable
as $$ select 2 $$;

-- After this many rejected clips of one text, a reviewer decides: no audio, or
-- one more round (design §6).
create function chat.lesson_audio_tries_per_round()
returns integer
language sql
immutable
as $$ select 3 $$;

-- --- The clips ----------------------------------------------------------------

create table chat.lesson_audio_clip (
  id             uuid primary key default gen_random_uuid(),
  lesson_key     text not null check (lesson_key ~ '^[a-z]+-[0-9]{3}$'),
  -- PD-29's string ids: <unit>-NNN, <unit>.name, <unit>.note. No '/' can appear.
  string_id      text not null check (string_id ~ '^[a-z][a-z0-9_]*(-[0-9]{3}|\.(name|note))$'),
  -- The exact text the clip was generated for, as the lesson file stores it (NFC).
  text           text not null check (length(text) between 1 and 400 and text = normalize(text, NFC)),
  text_sha256    text generated always as (chat.sha256_hex(text)) stored,
  -- The canonical render recipe (vendor, voice, input, rate, lexicon, take ...).
  render         jsonb not null check (jsonb_typeof(render) = 'object'),
  render_sha256  text not null check (render_sha256 ~ '^[0-9a-f]{64}$'),
  vendor         text not null check (vendor ~ '^[a-z][a-z0-9-]{1,31}$'),
  voice          text not null check (voice ~ '^[A-Za-z0-9-]{1,80}$'),
  -- Computed by the server from the stored object at ingest, never supplied by a person.
  audio_sha256   text not null check (audio_sha256 ~ '^[0-9a-f]{64}$'),
  byte_size      integer not null check (byte_size between 1 and 5000000),
  duration_ms    integer check (duration_ms is null or duration_ms between 1 and 60000),
  -- The same formula as apps/api/src/lesson-audio/lesson-audio-key.ts: derived, never typed.
  object_key     text generated always as (
                   'lesson-audio/' || lesson_key || '/' || string_id || '/' || audio_sha256 || '.mp3'
                 ) stored,
  attempt        smallint not null check (attempt between 1 and 100),
  created_at     timestamptz not null default now(),
  -- A regeneration must change something (voice, input, lexicon, take).
  constraint lesson_audio_clip_one_render unique (lesson_key, string_id, text_sha256, render_sha256)
);

create index lesson_audio_clip_string_idx on chat.lesson_audio_clip (lesson_key, string_id, text_sha256);

comment on table chat.lesson_audio_clip is
  'PD-48: one computer-voice clip of one lesson reading string. text_sha256 and object_key are generated; audio_sha256 is hashed by the server''s ingest from the stored object. Written only by the ingest (chat.ingesting_lesson_audio). Append-only. Never Quran audio.';

create function chat.guard_lesson_audio_clip()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'a lesson audio clip is a record; it is never changed or removed' using errcode = 'check_violation';
  end if;
  if coalesce(current_setting('chat.ingesting_lesson_audio', true), '') <> 'on' then
    raise exception 'a lesson audio clip is written only by the server''s ingest' using errcode = 'insufficient_privilege';
  end if;
  if new.render->>'vendor' is distinct from new.vendor or new.render->>'voice' is distinct from new.voice then
    raise exception 'the clip''s vendor and voice must be the ones in its recipe' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from chat.lesson_audio_string_decision d
     where d.lesson_key = new.lesson_key and d.string_id = new.string_id
       and d.text_sha256 = chat.sha256_hex(new.text) and d.decision = 'no_audio'
  ) then
    raise exception 'string % of % has no audio by a reviewer''s decision: no clip is generated for it', new.string_id, new.lesson_key
      using errcode = 'check_violation';
  end if;
  new.created_at := now();
  return new;
end;
$$;

-- Never truncated, except by the integration harness's cleanup, which says so
-- in its own transaction (chat.test_truncate), as for PD-47's tables.
create function chat.guard_lesson_audio_truncate()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if coalesce(current_setting('chat.test_truncate', true), '') = 'on' then
    return null;
  end if;
  raise exception 'lesson audio clips and their reviews are never truncated' using errcode = 'check_violation';
end;
$$;

-- --- The decisions on a string ----------------------------------------------------

create table chat.lesson_audio_string_decision (
  id           bigint generated always as identity primary key,
  lesson_key   text not null check (lesson_key ~ '^[a-z]+-[0-9]{3}$'),
  string_id    text not null check (string_id ~ '^[a-z][a-z0-9_]*(-[0-9]{3}|\.(name|note))$'),
  -- Bound to the text it was made for: a changed word may be tried again.
  text_sha256  text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  decision     text not null check (decision in ('no_audio', 'one_more_round')),
  staff_id     uuid not null references chat.staff (id),
  reason       text not null check (length(btrim(reason)) between 1 and 500),
  at           timestamptz not null default now()
);

create index lesson_audio_string_decision_idx on chat.lesson_audio_string_decision (lesson_key, string_id, text_sha256);

comment on table chat.lesson_audio_string_decision is
  'PD-48: a reviewer''s decision on a string whose clips kept failing: no_audio (final for that text: the string has no play button) or one_more_round. Append-only.';

create function chat.guard_lesson_audio_string_decision()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'a lesson audio decision is a record; it is never changed or removed' using errcode = 'check_violation';
  end if;
  new.at := now();
  return new;
end;
$$;

-- --- The reviews ------------------------------------------------------------------

create table chat.lesson_audio_review (
  id             bigint generated always as identity primary key,
  clip_id        uuid not null references chat.lesson_audio_clip (id),
  action         text not null check (action in ('approve', 'reject', 'withdraw')),
  staff_id       uuid not null references chat.staff (id),
  -- What the reviewer checked, copied and held equal to the clip's by the trigger.
  text_sha256    text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  render_sha256  text not null check (render_sha256 ~ '^[0-9a-f]{64}$'),
  audio_sha256   text not null check (audio_sha256 ~ '^[0-9a-f]{64}$'),
  category       text check (category in ('vowel', 'final_sukun', 'shadda', 'hamza', 'letter_sound', 'stress', 'noise', 'wrong_word', 'other')),
  reason         text check (reason is null or length(btrim(reason)) between 1 and 500),
  at             timestamptz not null default now(),
  -- An approval carries neither; a reject or a withdraw carries both (what is wrong, and why).
  constraint lesson_audio_review_reason check (
    case when action = 'approve' then category is null and reason is null
         else category is not null and reason is not null end)
);

-- One approval per reviewer per clip: two approvals are two people.
create unique index lesson_audio_one_approval_each on chat.lesson_audio_review (clip_id, staff_id) where action = 'approve';
create index lesson_audio_review_clip_idx on chat.lesson_audio_review (clip_id);

comment on table chat.lesson_audio_review is
  'PD-48: who approved, rejected or withdrew a lesson audio clip, when, and the exact text, recipe and audio hashes they checked. Append-only; written only through chat.review_lesson_audio_clip.';

-- pending (fewer approvals than required) -> approved; any reject -> rejected;
-- a withdraw (only of an approved clip) -> withdrawn. Rejected and withdrawn are final.
create function chat.lesson_audio_clip_state(p_clip uuid)
returns text
language sql
stable
set search_path = chat, pg_temp
as $$
  select case
           when bool_or(r.action = 'withdraw') then 'withdrawn'
           when bool_or(r.action = 'reject') then 'rejected'
           when count(distinct r.staff_id) filter (where r.action = 'approve') >= chat.lesson_audio_approvals_required() then 'approved'
           else 'pending'
         end
    from chat.lesson_audio_clip c
    left join chat.lesson_audio_review r on r.clip_id = c.id
   where c.id = p_clip;
$$;

create function chat.guard_lesson_audio_review()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_clip  chat.lesson_audio_clip%rowtype;
  v_state text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'a lesson audio review is a record; it is never changed or removed' using errcode = 'check_violation';
  end if;
  select * into v_clip from chat.lesson_audio_clip where id = new.clip_id;
  if new.text_sha256 <> v_clip.text_sha256 or new.render_sha256 <> v_clip.render_sha256 or new.audio_sha256 <> v_clip.audio_sha256 then
    raise exception 'the hashes reviewed are not this clip''s: nothing is recorded' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from chat.staff s where s.id = new.staff_id and s.is_active and s.left_at is null)
     or not chat.staff_has_permission(new.staff_id, 'lesson_audio.review') then
    raise exception 'only an active reviewer holding lesson_audio.review reviews lesson audio' using errcode = 'insufficient_privilege';
  end if;
  v_state := chat.lesson_audio_clip_state(new.clip_id);
  if new.action = 'withdraw' and v_state <> 'approved' then
    raise exception 'only an approved clip is withdrawn (this one is %)', v_state using errcode = 'check_violation';
  end if;
  if new.action in ('approve', 'reject') and v_state <> 'pending' then
    raise exception 'this clip is %: a new clip is generated instead', v_state using errcode = 'check_violation';
  end if;
  new.at := now();
  return new;
end;
$$;

create trigger lesson_audio_clip_is_append_only before insert or update or delete on chat.lesson_audio_clip
  for each row execute function chat.guard_lesson_audio_clip();
create trigger lesson_audio_clip_no_truncate before truncate on chat.lesson_audio_clip
  for each statement execute function chat.guard_lesson_audio_truncate();
create trigger lesson_audio_review_is_append_only before insert or update or delete on chat.lesson_audio_review
  for each row execute function chat.guard_lesson_audio_review();
create trigger lesson_audio_review_no_truncate before truncate on chat.lesson_audio_review
  for each statement execute function chat.guard_lesson_audio_truncate();
create trigger lesson_audio_string_decision_is_append_only before insert or update or delete on chat.lesson_audio_string_decision
  for each row execute function chat.guard_lesson_audio_string_decision();
create trigger lesson_audio_string_decision_no_truncate before truncate on chat.lesson_audio_string_decision
  for each statement execute function chat.guard_lesson_audio_truncate();

-- --- The two writes a reviewer makes ------------------------------------------------

-- Approve, reject or withdraw one clip. p_text_sha256 and p_audio_sha256 are
-- what the reviewer's browser hashed: an approval is of THESE bytes for THIS
-- text, or nothing is recorded. Returns the clip's state afterwards.
create function chat.review_lesson_audio_clip(
  p_clip         uuid,
  p_action       text,
  p_text_sha256  text,
  p_audio_sha256 text,
  p_category     text,
  p_reason       text,
  p_actor_id     uuid default null
) returns text
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_actor uuid := chat.trusted_staff_actor(p_actor_id);
  v_clip  chat.lesson_audio_clip%rowtype;
  v_state text;
begin
  if p_action not in ('approve', 'reject', 'withdraw') then
    raise exception 'unknown review action %', p_action using errcode = 'invalid_parameter_value';
  end if;
  -- One review at a time per clip, so two approvals cannot both see "pending, 1 of 2".
  select * into v_clip from chat.lesson_audio_clip where id = p_clip for update;
  if not found then
    raise exception 'no such lesson audio clip' using errcode = 'no_data_found';
  end if;
  if p_text_sha256 is distinct from v_clip.text_sha256 or p_audio_sha256 is distinct from v_clip.audio_sha256 then
    raise exception 'what was heard is not this clip (the hashes differ): nothing is recorded' using errcode = 'check_violation';
  end if;
  -- Said in words; the unique index lesson_audio_one_approval_each is the backstop.
  if p_action = 'approve' and exists (
    select 1 from chat.lesson_audio_review r where r.clip_id = p_clip and r.staff_id = v_actor and r.action = 'approve'
  ) then
    raise exception 'you have already approved this clip: the second approval is someone else''s' using errcode = 'insufficient_privilege';
  end if;
  insert into chat.lesson_audio_review (clip_id, action, staff_id, text_sha256, render_sha256, audio_sha256, category, reason)
  values (p_clip, p_action, v_actor, v_clip.text_sha256, v_clip.render_sha256, v_clip.audio_sha256,
          case when p_action = 'approve' then null else p_category end,
          case when p_action = 'approve' then null else nullif(btrim(p_reason), '') end);
  v_state := chat.lesson_audio_clip_state(p_clip);
  insert into chat.audit_log (actor_id, action, entity, entity_id, before, after, reason)
  values (v_actor,
          case p_action when 'approve' then 'lesson_audio.approved' when 'reject' then 'lesson_audio.rejected' else 'lesson_audio.withdrawn' end,
          'lesson_audio_clip', p_clip, null,
          jsonb_build_object('lessonKey', v_clip.lesson_key, 'stringId', v_clip.string_id, 'state', v_state,
                             'textSha256', v_clip.text_sha256, 'renderSha256', v_clip.render_sha256, 'audioSha256', v_clip.audio_sha256,
                             'category', case when p_action = 'approve' then null else p_category end),
          -- audit_log needs a reason; an approval's is that the clip was heard and matched.
          case when p_action = 'approve' then 'PD-48: heard and approved; the hashes matched'
               else coalesce(nullif(btrim(p_reason), ''), 'PD-48: no reason given') end);
  return v_state;
end;
$$;

-- "no_audio" or "one_more_round" for a string's CURRENT text (the API passes
-- the hash from the text it was built with). Allowed once every round of
-- chat.lesson_audio_tries_per_round() clips of that text was rejected or
-- withdrawn; "no_audio" is final for that text.
create function chat.decide_lesson_audio_string(
  p_lesson      text,
  p_string_id   text,
  p_text_sha256 text,
  p_decision    text,
  p_reason      text,
  p_actor_id    uuid default null
) returns void
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_actor  uuid := chat.trusted_staff_actor(p_actor_id);
  v_failed integer;
  v_rounds integer;
begin
  if not exists (select 1 from chat.staff s where s.id = v_actor and s.is_active and s.left_at is null)
     or not chat.staff_has_permission(v_actor, 'lesson_audio.review') then
    raise exception 'only an active reviewer holding lesson_audio.review decides on lesson audio' using errcode = 'insufficient_privilege';
  end if;
  -- Serialize decisions on one string.
  perform pg_advisory_xact_lock(hashtext('pd048:' || p_lesson || ':' || p_string_id));
  if exists (select 1 from chat.lesson_audio_string_decision d
              where d.lesson_key = p_lesson and d.string_id = p_string_id and d.text_sha256 = p_text_sha256 and d.decision = 'no_audio') then
    raise exception 'this string already has no audio for this text' using errcode = 'check_violation';
  end if;
  select count(*) into v_failed from chat.lesson_audio_clip c
   where c.lesson_key = p_lesson and c.string_id = p_string_id and c.text_sha256 = p_text_sha256
     and chat.lesson_audio_clip_state(c.id) in ('rejected', 'withdrawn');
  select count(*) into v_rounds from chat.lesson_audio_string_decision d
   where d.lesson_key = p_lesson and d.string_id = p_string_id and d.text_sha256 = p_text_sha256 and d.decision = 'one_more_round';
  if v_failed < chat.lesson_audio_tries_per_round() * (v_rounds + 1) then
    raise exception 'a decision is made after % failed clips of this text (% so far)', chat.lesson_audio_tries_per_round() * (v_rounds + 1), v_failed
      using errcode = 'check_violation';
  end if;
  insert into chat.lesson_audio_string_decision (lesson_key, string_id, text_sha256, decision, staff_id, reason)
  values (p_lesson, p_string_id, p_text_sha256, p_decision, v_actor, p_reason);
  insert into chat.audit_log (actor_id, action, entity, entity_id, before, after, reason)
  values (v_actor, case p_decision when 'no_audio' then 'lesson_audio.no_audio' else 'lesson_audio.one_more_round' end,
          'lesson_audio_string', null, null,
          jsonb_build_object('lessonKey', p_lesson, 'stringId', p_string_id, 'textSha256', p_text_sha256, 'failedClips', v_failed),
          p_reason);
end;
$$;

-- --- PD-40: the two keys and their bundles -------------------------------------------

select set_config('chat.pd040_catalogue_change', 'on', true);
-- BEGIN GENERATED pd048 catalogue rows -- by test/unit/authorization/pd040-catalogue-seed.spec.ts; do not edit
insert into chat.permission (key, page, action, label_en, label_ar, risk, delegable, introduced_by) values
  ('lesson_audio.view', 'lesson_audio', 'view', 'Listen to lesson voice-over clips', 'الاستماع إلى تسجيلات نطق الدروس', 'none', true, 'PD-48'),
  ('lesson_audio.review', 'lesson_audio', 'review', 'Approve or reject lesson voice-over clips', 'اعتماد تسجيلات نطق الدروس أو رفضها', 'none', true, 'PD-48');

insert into chat.legacy_permission_bundle (tier, department_kind, permission_key) values
  ('manager', 'teachers', 'lesson_audio.review'),
  ('manager', 'teachers', 'lesson_audio.view'),
  ('supervisor', 'teachers', 'lesson_audio.view');

update chat.permission set delegable = true where key in ('lesson_audio.review', 'lesson_audio.view');
-- END GENERATED pd048 catalogue rows
select set_config('chat.pd040_catalogue_change', 'off', true);

-- --- PD-40: the Pronunciation reviewer template ---------------------------------------
-- 20261029220000's function with only the template list (the generated block)
-- grown by one; every organization that exists today gets the new template.

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
        ('pronunciation_reviewer', 'Pronunciation reviewer', 'مراجع النطق', 'Listens to the lessons'' computer-voice clips and approves or rejects each one. Two reviewers approve a clip before it plays.', 'specialist', array['lesson_audio.review', 'lesson_audio.view']::text[])
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

-- --- The learner's list is rate limited (docs/security/ABUSE-LIMITS.md) ----------------

insert into chat.config (key, value, scope, description) values
('abuse.throttle.lesson_audio_read_actor', '60'::jsonb, 'abuse',
 '[hypothesis] PD-48: lesson voice-over lists (GET /lesson-audio/:lesson) one actor may ask for per window. A lesson asks once when it opens.')
on conflict (key) do nothing;

-- The release gate (lesson_audio.enabled_for, lesson_audio.test_staff_ids) is
-- deliberately NOT inserted: unset is `none`, nobody hears anything.

-- --- Grants: none to request roles ---------------------------------------------------

alter table chat.lesson_audio_clip enable row level security;
alter table chat.lesson_audio_review enable row level security;
alter table chat.lesson_audio_string_decision enable row level security;
revoke all on chat.lesson_audio_clip, chat.lesson_audio_review, chat.lesson_audio_string_decision
  from public, anon, authenticated, chat_app;
revoke all on function chat.lesson_audio_approvals_required() from public;
revoke all on function chat.lesson_audio_tries_per_round() from public;
revoke all on function chat.lesson_audio_clip_state(uuid) from public;
revoke all on function chat.guard_lesson_audio_clip() from public;
revoke all on function chat.guard_lesson_audio_truncate() from public;
revoke all on function chat.guard_lesson_audio_string_decision() from public;
revoke all on function chat.guard_lesson_audio_review() from public;
revoke all on function chat.review_lesson_audio_clip(uuid, text, text, text, text, text, uuid) from public;
revoke all on function chat.decide_lesson_audio_string(text, text, text, text, text, uuid) from public;
revoke all on function chat.seed_access_role_templates(uuid) from public;
