-- Jawwid Chat -- Stories v2 (owner decisions, 2026-10-17).
--
-- Canonical design: docs/product/STORIES.md (section 12 records what changed).
--
-- The owner's rules, and what each one does to this schema:
--
--   1. STORIES DO NOT EXPIRE. New stories are published with expires_at NULL,
--      meaning "readable until deleted". The expiry machinery is NOT removed:
--      a story published before this migration with an expires_at in the past
--      stays expired, and the read predicate still honours a non-null
--      expires_at. Resurrecting an expired story would hand a publication to an
--      audience snapshot that has gone stale -- that is why only stories that
--      are STILL LIVE are made permanent below.
--   2. NO CAPTION UNDER A STORY. Words are a story's content (a text story) or
--      absent; a photo, video or voice story carries none. That is enforced in
--      StoryService and by the feed, not by a constraint here: a CHECK added
--      NOT VALID would still fire on the sweeper's next UPDATE of a legacy row
--      that had both a body and media, and wedge it. `title` stays for history;
--      nothing writes it. `internal_name` is the publisher's own label and never
--      leaves the publisher surfaces.
--   3. TEXT, PHOTO, VIDEO AND VOICE. media_kind gains 'audio'; a text or voice
--      story may carry a background from a fixed palette.
--   4. EVERY STORY MAY CARRY ONE CALL TO ACTION: open WhatsApp, message the
--      publisher, or open a link. Taps are recorded in chat.story_cta_click.
--   5. ANALYTICS read story_recipient (reach), story_view (views) and
--      story_cta_click (taps). No counter columns: a count is a query, so it
--      cannot drift from the rows it counts.
--   6. TARGETING. A new audience clause, `segment`, carries a filter over user
--      type, subscription plan length, number of children and country. Plan and
--      country are family attributes that Jawwid Core owns; they are added to
--      chat.family here so admins can set them today and the Core projection
--      writes the same columns once it lands. Number of children is DERIVED
--      (count of chat.learner), never stored, so it cannot go stale.
--   7. The super admin may publish (PD-8 gave it full write; the Admin Portal is
--      its publishing surface).
--
-- Idempotent: every statement can be re-applied.

do $pre$
begin
  if to_regclass('chat.story') is null or to_regclass('chat.family') is null then
    raise exception 'stories v2 precondition failed: chat.story / chat.family missing';
  end if;
end
$pre$;

-- ---------------------------------------------------------------------------
-- 1. Segmentation attributes on the family
-- ---------------------------------------------------------------------------
--
-- NOT granted to `authenticated` or `chat_app`: 20261014090000 replaced the
-- table-level UPDATE on chat.family with a column list read from the catalog at
-- that moment, precisely so a column added later is not silently writable by
-- the request role. These are written by StoryService (owner connection) for
-- super_admin and managers, and later by the Core projection.

alter table chat.family add column if not exists country_code text;
alter table chat.family add column if not exists subscription_plan_months smallint;
alter table chat.family add column if not exists segment_source text;
alter table chat.family add column if not exists segment_updated_at timestamptz;

do $family_checks$
begin
  if not exists (select 1 from pg_constraint where conname = 'family_country_code_format') then
    alter table chat.family add constraint family_country_code_format
      check (country_code is null or country_code ~ '^[A-Z]{2}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'family_subscription_plan_months_check') then
    alter table chat.family add constraint family_subscription_plan_months_check
      check (subscription_plan_months is null or subscription_plan_months in (1, 3, 6, 12));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'family_segment_source_check') then
    alter table chat.family add constraint family_segment_source_check
      check (segment_source is null or segment_source in ('admin', 'core'));
  end if;
end
$family_checks$;

comment on column chat.family.country_code is
  'ISO 3166-1 alpha-2 country of the family, for story targeting. Owned by Jawwid '
  'Core; set by an admin until the Core projection writes it.';
comment on column chat.family.subscription_plan_months is
  'Length of the family''s subscription PLAN in months (1, 3, 6 or 12) -- the '
  'package bought, not how long they have been subscribed. Owned by Jawwid Core.';
comment on column chat.family.segment_source is
  'Who last wrote country_code / subscription_plan_months: admin or core.';

create index if not exists family_segment_idx
  on chat.family (organization_id, country_code, subscription_plan_months);

-- ---------------------------------------------------------------------------
-- 2. The story: kinds, background, call to action, no expiry
-- ---------------------------------------------------------------------------

alter table chat.story add column if not exists internal_name     text;
alter table chat.story add column if not exists background        text;
alter table chat.story add column if not exists media_duration_ms integer;
alter table chat.story add column if not exists cta_kind          text;
alter table chat.story add column if not exists cta_label         text;
alter table chat.story add column if not exists cta_url           text;
alter table chat.story add column if not exists cta_phone         text;

comment on column chat.story.internal_name is
  'The publisher''s own label for a story. Shown on publisher surfaces only; never '
  'in a feed, a push or anything a reader receives.';
comment on column chat.story.cta_phone is
  'The ACADEMY''s WhatsApp number for a whatsapp call to action (E.164 digits, no '
  '+). A property of the publication, never a family''s contact details.';

alter table chat.story drop constraint if exists story_media_kind_check;
alter table chat.story add constraint story_media_kind_check
  check (media_kind is null or media_kind in ('image', 'video', 'audio'));

do $story_checks$
begin
  if not exists (select 1 from pg_constraint where conname = 'story_background_check') then
    alter table chat.story add constraint story_background_check
      check (background is null
             or background in ('teal', 'gold', 'plum', 'ink', 'rose', 'sky', 'forest', 'sunset'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'story_media_duration_check') then
    alter table chat.story add constraint story_media_duration_check
      check (media_duration_ms is null or media_duration_ms between 1 and 3600000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'story_internal_name_length') then
    alter table chat.story add constraint story_internal_name_length
      check (internal_name is null or char_length(internal_name) <= 120);
  end if;
  -- The call to action is one of three shapes, or absent. Each shape carries
  -- exactly the field it needs: a link its https URL, WhatsApp its number, and
  -- "message the publisher" nothing -- the publisher is published_by.
  if not exists (select 1 from pg_constraint where conname = 'story_cta_shape') then
    alter table chat.story add constraint story_cta_shape
      check (
        (cta_kind is null and cta_label is null and cta_url is null and cta_phone is null)
        or (cta_kind = 'link' and cta_url ~ '^https://[^\s]+$' and char_length(cta_url) <= 2000
            and cta_phone is null)
        or (cta_kind = 'whatsapp' and cta_phone ~ '^[1-9][0-9]{6,14}$' and cta_url is null)
        or (cta_kind = 'message_publisher' and cta_url is null and cta_phone is null)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'story_cta_label_length') then
    alter table chat.story add constraint story_cta_label_length
      check (cta_label is null or char_length(btrim(cta_label)) between 1 and 40);
  end if;
end
$story_checks$;

-- A published story no longer needs an expiry. It still needs to know when it
-- went out and who published it.
alter table chat.story drop constraint if exists story_published_is_complete;
alter table chat.story add constraint story_published_is_complete
  check (state <> 'published' or (published_at is not null and published_by is not null));

-- Rule 1, for the stories that are live right now. Only those: an expired one
-- stays expired (see the header).
update chat.story
   set expires_at = null
 where state = 'published'
   and expires_at is not null
   and expires_at > now()
   and deleted_at is null;

update chat.config
   set description = 'UNUSED since 2026-10-17: stories never expire (owner decision). '
                     'Kept so an older API build that still reads it gets a value.'
 where key = 'story.default_lifetime_hours';

-- ---------------------------------------------------------------------------
-- 3. Who may publish: the family-facing roles and the super admin
-- ---------------------------------------------------------------------------

create or replace function chat.current_can_publish_story()
returns boolean
language sql
stable
security definer
set search_path = chat, pg_temp
as $$
  select coalesce(chat.current_staff_role() in ('admin', 'coverage', 'manager', 'super_admin'), false)
$$;

comment on function chat.current_can_publish_story() is
  'Publisher predicate for stories: the family-facing staff roles (admin, coverage, '
  'manager) and super_admin (2026-10-17). Mirrors STORY_PUBLISHER_ROLES in '
  'contracts/vocab.ts.';

-- ---------------------------------------------------------------------------
-- 4. The read predicate: a NULL expiry means "until deleted"
-- ---------------------------------------------------------------------------

drop policy if exists story_visible_to_audience on chat.story;
create policy story_visible_to_audience on chat.story
  for select to authenticated
  using (
    (state = 'published'
     and (expires_at is null or expires_at > now())
     and deleted_at is null
     and exists (select 1 from chat.story_recipient r
                  where r.story_id = id
                    and r.actor_id in (select chat.current_actor_ids())))
    or chat.current_can_publish_story()
  );

-- The feed index no longer needs the expiry column; story_live_idx already
-- serves "published, newest first".

-- ---------------------------------------------------------------------------
-- 5. The `segment` audience clause
-- ---------------------------------------------------------------------------

alter table chat.story_audience add column if not exists filter jsonb;

alter table chat.story_audience drop constraint if exists story_audience_kind_check;
alter table chat.story_audience add constraint story_audience_kind_check
  check (kind in ('all_families', 'all_teachers', 'assigned_families',
                  'family', 'teacher', 'contact', 'conversation', 'segment'));

alter table chat.story_audience drop constraint if exists story_audience_ref_matches_kind;
alter table chat.story_audience add constraint story_audience_ref_matches_kind
  check ((kind in ('all_families', 'all_teachers', 'assigned_families', 'segment') and ref_id is null)
      or (kind not in ('all_families', 'all_teachers', 'assigned_families', 'segment') and ref_id is not null));

do $segment_check$
begin
  if not exists (select 1 from pg_constraint where conname = 'story_audience_filter_matches_kind') then
    alter table chat.story_audience add constraint story_audience_filter_matches_kind
      check ((kind = 'segment' and filter is not null and jsonb_typeof(filter) = 'object')
          or (kind <> 'segment' and filter is null));
  end if;
end
$segment_check$;

comment on column chat.story_audience.filter is
  'For kind = segment: {"who": "everyone"|"families"|"teachers", "planMonths": [..], '
  '"children": [1,2,3,4], "countries": ["AE",..]}. Validated by StoryAudienceResolver; '
  'empty or absent dimensions match everyone. children 4 means four or more.';

-- ---------------------------------------------------------------------------
-- 6. Call-to-action taps
-- ---------------------------------------------------------------------------
--
-- Every tap is a row, so "taps" and "people who tapped" are both queries. Unlike
-- a view, a tap is not idempotent: tapping twice is two taps, and the analytics
-- report both numbers.

create table if not exists chat.story_cta_click (
  id         bigserial primary key,
  story_id   uuid not null references chat.story (id) on delete cascade,
  actor_id   uuid not null,
  clicked_at timestamptz not null default clock_timestamp()
);

comment on table chat.story_cta_click is
  'One row per call-to-action tap. Only an actor the story was published to can '
  'tap (chat.enforce_story_view_audience, reused).';

create index if not exists story_cta_click_story_idx
  on chat.story_cta_click (story_id, clicked_at);

-- The same audience guard a view uses: without it the tap route would be an
-- existence oracle. The function reads only NEW.story_id and NEW.actor_id.
drop trigger if exists story_cta_click_audience_guard on chat.story_cta_click;
create trigger story_cta_click_audience_guard
  before insert on chat.story_cta_click
  for each row execute function chat.enforce_story_view_audience();

alter table chat.story_cta_click enable row level security;

drop policy if exists story_cta_click_organization_isolation on chat.story_cta_click;
create policy story_cta_click_organization_isolation on chat.story_cta_click
  as restrictive for all
  using (chat.story_organization_id(story_id) = chat.current_organization_id())
  with check (chat.story_organization_id(story_id) = chat.current_organization_id());

drop policy if exists story_cta_click_visible on chat.story_cta_click;
create policy story_cta_click_visible on chat.story_cta_click
  for select to authenticated
  using (actor_id in (select chat.current_actor_ids())
         or chat.current_can_publish_story());

drop policy if exists story_cta_click_written_by_clicker on chat.story_cta_click;
create policy story_cta_click_written_by_clicker on chat.story_cta_click
  for insert to authenticated
  with check (actor_id in (select chat.current_actor_ids()));

grant select, insert on chat.story_cta_click to authenticated;
grant select, insert on chat.story_cta_click to chat_app;
grant select, insert, update, delete on chat.story_cta_click to service_role;
grant usage on sequence chat.story_cta_click_id_seq to authenticated, chat_app, service_role;

-- ---------------------------------------------------------------------------
-- 7. The push no longer carries a title
-- ---------------------------------------------------------------------------
--
-- New stories have no title (rule 2), so a template that rendered {story_title}
-- would push an empty body. A new version, same convention as 20261014160000:
-- TemplateService renders the highest active version; earlier ones stay.

insert into chat.notification_template (key, locale, version, title, body)
select v.key, v.locale,
       coalesce((select max(t.version) from chat.notification_template t
                  where t.key = v.key and t.locale = v.locale), 0) + 1,
       v.title, v.body
  from (values
    ('story_published', 'en', 'New from {organization_name}', 'A new story is waiting for you.'),
    ('story_published', 'ar', 'جديد من {organization_name}',  'لديك حالة جديدة بانتظارك.')
  ) as v(key, locale, title, body)
 where not exists (
   select 1 from chat.notification_template t
    where t.key = v.key and t.locale = v.locale and t.title = v.title and t.body = v.body and t.is_active);

-- ---------------------------------------------------------------------------
-- 8. Prove it
-- ---------------------------------------------------------------------------

do $assert$
begin
  if exists (select 1 from chat.story
              where state = 'published' and deleted_at is null
                and expires_at is not null and expires_at > now()) then
    raise exception 'stories v2: a live story still carries an expiry';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'story_cta_click_audience_guard') then
    raise exception 'stories v2: the tap audience guard is missing';
  end if;
  if exists (select 1 from information_schema.column_privileges
              where table_schema = 'chat' and table_name = 'family'
                and column_name in ('country_code', 'subscription_plan_months', 'segment_source')
                and grantee in ('authenticated', 'chat_app', 'PUBLIC')
                and privilege_type = 'UPDATE') then
    raise exception 'stories v2: a segmentation column is writable by a request role';
  end if;
end
$assert$;
