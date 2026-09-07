-- Jawwid Chat -- Phase 5B: stories, and the audience model both stories and
-- broadcast are built on.
--
-- Canonical design: docs/recovery/PHASE-5-REPORT.md.
--
-- A story is a short-lived publication from the academy to a chosen slice of
-- its people. Nothing like it existed: no table, no service, no permission.
--
-- THE ONE DECISION THAT SHAPES EVERYTHING ELSE: THE AUDIENCE IS MATERIALISED.
--
-- An audience is authored as INTENT -- "all families carrying the Installments
-- label, plus the Thursday group, plus these three teachers". Resolving that
-- intent to people could happen at write time or at read time, and the choice
-- is not a matter of taste:
--
--   READ TIME (the tempting one) means every reader's story feed runs a
--   union-of-subqueries across chat.family_label, chat.group_member,
--   chat.learner_teacher_assignment and chat.contact, per story, per pull. It
--   is an N+1 with extra steps, it cannot be indexed usefully, and -- worse --
--   it makes "who was this published to?" unanswerable after the fact, because
--   the answer changes every time somebody is added to a label.
--
--   WRITE TIME (this design) resolves the intent ONCE, in ONE authoritative
--   server-side resolver, into chat.story_recipient. A feed is then a single
--   indexed join. "Who was this published to" is a query. Deduplication across
--   overlapping audiences is the primary key, not a code path that can be
--   forgotten. And visibility is expressible as an RLS predicate simple enough
--   to be obviously correct.
--
-- What write-time resolution costs is that the audience is a SNAPSHOT: a family
-- labelled Installments tomorrow does not retroactively receive a story
-- published today. That is the correct semantics for a publication -- a story
-- went out to the people it went out to -- and it is stated here so that it is
-- a decision rather than a surprise. The one thing a snapshot must NOT do is
-- keep serving somebody whose access has since been withdrawn, so the read
-- policy re-checks liveness (chat.story_recipient joined to a still-active
-- actor) rather than trusting the snapshot alone.

-- ---------------------------------------------------------------------------
-- 1. The story
-- ---------------------------------------------------------------------------

create table if not exists chat.story (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default chat.default_organization_id()
                     references chat.organization (id),
  title            text,
  body             text,
  -- Media reuses the Phase 2 object-storage seam exactly: a key into private
  -- storage, read through a short-lived signed URL. There is no second upload
  -- pipeline and no public bucket.
  media_object_key text,
  media_kind       text,
  media_mime       text,
  state            text not null default 'draft',
  published_at     timestamptz,
  expires_at       timestamptz,
  created_by       uuid not null,
  published_by     uuid,
  deleted_at       timestamptz,
  deleted_reason   text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint story_state_check
    check (state in ('draft', 'published', 'expired', 'deleted')),
  constraint story_media_kind_check
    check (media_kind is null or media_kind in ('image', 'video')),
  -- A story with neither words nor a picture is not a story.
  constraint story_has_content
    check (coalesce(btrim(body), '') <> '' or media_object_key is not null),
  -- A published story knows when it went out, who published it, and when it
  -- stops. All three or none: an expiring publication with no expiry is how a
  -- "story" quietly becomes a permanent notice board.
  constraint story_published_is_complete
    check (state <> 'published'
           or (published_at is not null and published_by is not null and expires_at is not null)),
  constraint story_deletion_is_stamped
    check (state <> 'deleted' or (deleted_at is not null and deleted_reason is not null))
);

comment on table chat.story is
  'A short-lived publication to a resolved audience. Publishing is restricted '
  'to stories.publish (manager, admin, super_admin) and the audience is '
  'resolved server-side into chat.story_recipient -- a client never states who '
  'may see a story, and never filters a feed.';

create index if not exists story_live_idx
  on chat.story (organization_id, published_at desc)
  where state = 'published';

-- The expiry sweep.
create index if not exists story_expiry_idx
  on chat.story (expires_at) where state = 'published';

drop trigger if exists story_set_updated_at on chat.story;
create trigger story_set_updated_at
  before update on chat.story
  for each row execute function chat.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. The audience, as authored
-- ---------------------------------------------------------------------------
--
-- Kept alongside the resolved recipients rather than discarded, because "this
-- went to 412 people" is not an answer to "who did you send this to?". The
-- intent is what an operator reviews, reuses and explains.

create table if not exists chat.story_audience (
  id         uuid primary key default gen_random_uuid(),
  story_id   uuid not null references chat.story (id) on delete cascade,
  kind       text not null,
  -- Null exactly when the kind names no particular record ('all_families',
  -- 'all_teachers'). Not a foreign key: it points into four different tables
  -- depending on kind, and the resolver validates it against the right one
  -- under the author's scope -- a forged id resolves to nothing rather than to
  -- somebody else's family.
  ref_id     uuid,
  created_at timestamptz not null default now(),

  constraint story_audience_kind_check
    check (kind in ('all_families', 'all_teachers', 'assigned_families',
                    'family', 'group', 'label', 'teacher', 'user')),
  constraint story_audience_ref_matches_kind
    check ((kind in ('all_families', 'all_teachers', 'assigned_families') and ref_id is null)
        or (kind not in ('all_families', 'all_teachers', 'assigned_families') and ref_id is not null))
);

-- Naming the same audience twice is the same audience.
create unique index if not exists story_audience_unique
  on chat.story_audience (story_id, kind, coalesce(ref_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ---------------------------------------------------------------------------
-- 3. The audience, as resolved
-- ---------------------------------------------------------------------------

create table if not exists chat.story_recipient (
  story_id   uuid not null references chat.story (id) on delete cascade,
  actor_id   uuid not null,
  -- Which audience clause first matched this person. Diagnostics and reporting
  -- ("the label reached 300, the group added 12"); never an authorization input.
  matched_kind text not null,
  created_at timestamptz not null default now(),

  -- DEDUPLICATION IS THE PRIMARY KEY. A family that matches the label AND the
  -- group AND was named individually is one row, because it cannot be two.
  -- No application-level distinct to forget.
  primary key (story_id, actor_id)
);

comment on table chat.story_recipient is
  'The audience resolved to people, once, server-side. The composite primary '
  'key IS the deduplication guarantee for overlapping audiences.';

-- The feed query: "the live stories for this person, newest first".
create index if not exists story_recipient_actor_idx
  on chat.story_recipient (actor_id, story_id);

-- ---------------------------------------------------------------------------
-- 4. Views
-- ---------------------------------------------------------------------------

create table if not exists chat.story_view (
  story_id  uuid not null references chat.story (id) on delete cascade,
  actor_id  uuid not null,
  viewed_at timestamptz not null default clock_timestamp(),
  -- Idempotent by construction: viewing twice is viewing.
  primary key (story_id, actor_id)
);

create index if not exists story_view_story_idx on chat.story_view (story_id, viewed_at desc);

-- A view is only recordable by somebody the story was published to. Without
-- this, "mark viewed" is an oracle: post ids until one succeeds and you have
-- enumerated the stories that exist.
create or replace function chat.enforce_story_view_audience()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from chat.story_recipient r
     where r.story_id = new.story_id and r.actor_id = new.actor_id
  ) then
    raise exception 'actor % is not in the audience of story %', new.actor_id, new.story_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists story_view_audience_guard on chat.story_view;
create trigger story_view_audience_guard
  before insert on chat.story_view
  for each row execute function chat.enforce_story_view_audience();

-- ---------------------------------------------------------------------------
-- 5. Publishing permission
-- ---------------------------------------------------------------------------

insert into chat.permission (key, description) values
  ('stories.read',    'See the stories published to you.'),
  ('stories.publish', 'Create and publish a story to a resolved audience.'),
  ('recordings.read', 'Play back and manage recordings of follow-up calls.'),
  ('calls.record',    'Start a follow-up call, which is a call that may be recorded.')
on conflict (key) do nothing;

-- WHO MAY PUBLISH. The brief says Manager / Admin, and this repository's
-- canonical staff roles are super_admin, manager, admin and coverage_admin --
-- all four of which are admin roles in that sense. Teachers and parents hold
-- `stories.read` and nothing more.
--
-- COVERAGE_ADMIN GETS THE SAME KEYS AS ADMIN. The first draft of this migration
-- withheld `stories.publish` from coverage_admin, reasoning that publishing to
-- the academy should not start and stop with a shift. That reasoning is wrong,
-- and the RBAC mirror test caught it: this model's stated invariant is that
-- `admin` and `coverage_admin` hold EXACTLY the same permission keys and differ
-- only in SCOPE (AUTHORIZATION-MODEL.md §2). Breaking that invariant for one
-- feature would make the difference between the two roles a per-feature
-- judgement instead of one sentence.
--
-- And the reasoning was unnecessary as well as wrong: holding stories.publish
-- is NECESSARY and not SUFFICIENT. The audience resolver independently refuses
-- every clause outside the author's LIVE scope, so a coverage admin publishes
-- to the families they are covering right now and to nobody else -- which is
-- exactly the reach they already have to MESSAGE those families. When the
-- cover ends, so does the reach, with no permission change at all.
insert into chat.role_permission (role, permission) values
  ('parent',         'stories.read'),
  ('teacher',        'stories.read'),
  ('admin',          'stories.read'),
  ('admin',          'stories.publish'),
  ('coverage_admin', 'stories.read'),
  ('coverage_admin', 'stories.publish'),
  ('manager',        'stories.read'),
  ('manager',        'stories.publish'),
  ('super_admin',    'stories.read'),
  ('super_admin',    'stories.publish')
on conflict (role, permission) do nothing;

-- Recording. calls.record decides who may START a recordable (follow-up) call;
-- recordings.read decides who may HEAR one. Deliberately not granted to parent
-- or teacher: everyone on a call heard it, but the right to have been present
-- is not the right to keep a copy of somebody else's voice.
insert into chat.role_permission (role, permission) values
  ('admin',          'calls.record'),
  ('admin',          'recordings.read'),
  ('coverage_admin', 'calls.record'),
  ('coverage_admin', 'recordings.read'),
  ('manager',        'calls.record'),
  ('manager',        'recordings.read'),
  ('super_admin',    'calls.record'),
  ('super_admin',    'recordings.read')
on conflict (role, permission) do nothing;

-- ---------------------------------------------------------------------------
-- 6. RLS -- deny by default
-- ---------------------------------------------------------------------------

alter table chat.story           enable row level security;
alter table chat.story_audience  enable row level security;
alter table chat.story_recipient enable row level security;
alter table chat.story_view      enable row level security;

drop policy if exists story_organization_isolation on chat.story;
create policy story_organization_isolation on chat.story
  as restrictive for all
  using (organization_id = chat.current_organization_id())
  with check (organization_id = chat.current_organization_id());

-- A reader sees a story ONLY through the resolved audience. There is no
-- "fetch all stories and filter in the client" shape available, because the
-- rows are not readable in the first place.
drop policy if exists story_visible_to_audience on chat.story;
create policy story_visible_to_audience on chat.story
  for select to authenticated
  using (
    (state = 'published'
     and exists (select 1 from chat.story_recipient r
                  where r.story_id = id
                    and r.actor_id in (select chat.current_actor_ids())))
    -- A publisher sees their own drafts, and anyone who may publish sees the
    -- organization's stories, which is what the compose and report surfaces
    -- need.
    or chat.current_has_permission('stories.publish')
  );

-- The authored intent is an operator surface, not a reader one: it names
-- labels, groups and families, and a parent who could read it would learn how
-- the academy segments its customers.
drop policy if exists story_audience_visible_to_publishers on chat.story_audience;
create policy story_audience_visible_to_publishers on chat.story_audience
  for select to authenticated
  using (chat.current_has_permission('stories.publish'));

-- A recipient may confirm they are one; a publisher sees the whole list. What
-- nobody gets is the ability to read somebody else's row and learn who else
-- received it.
drop policy if exists story_recipient_visible on chat.story_recipient;
create policy story_recipient_visible on chat.story_recipient
  for select to authenticated
  using (actor_id in (select chat.current_actor_ids())
         or chat.current_has_permission('stories.publish'));

drop policy if exists story_view_visible on chat.story_view;
create policy story_view_visible on chat.story_view
  for select to authenticated
  using (actor_id in (select chat.current_actor_ids())
         or chat.current_has_permission('stories.publish'));

grant select on chat.story, chat.story_audience, chat.story_recipient, chat.story_view
  to authenticated;
grant select, insert, update on
  chat.story, chat.story_audience, chat.story_recipient, chat.story_view to chat_app;
grant select, insert, update, delete on
  chat.story, chat.story_audience, chat.story_recipient, chat.story_view to service_role;

-- WRITES mirror the service rule, addressed `to authenticated`.
--
-- NOT `for all to chat_app using (true)`. That form reads as "let the
-- application work" and is in fact a PERMISSIVE policy that ORs with the read
-- policies above -- it would give every authenticated session unrestricted read
-- of every story and silently cancel the audience rule. The blanket form is
-- reserved for the five identity tables (20260907120000), which carry no
-- `authenticated` policy at all. The background worker is unaffected: it
-- connects as `chat_service`, which bypasses RLS by design.

drop policy if exists story_written_by_publisher on chat.story;
create policy story_written_by_publisher on chat.story
  for insert to authenticated
  with check (chat.current_has_permission('stories.publish'));

drop policy if exists story_updated_by_publisher on chat.story;
create policy story_updated_by_publisher on chat.story
  for update to authenticated
  using (chat.current_has_permission('stories.publish'))
  with check (chat.current_has_permission('stories.publish'));

drop policy if exists story_audience_written_by_publisher on chat.story_audience;
create policy story_audience_written_by_publisher on chat.story_audience
  for insert to authenticated
  with check (chat.current_has_permission('stories.publish'));

drop policy if exists story_recipient_written_by_publisher on chat.story_recipient;
create policy story_recipient_written_by_publisher on chat.story_recipient
  for insert to authenticated
  with check (chat.current_has_permission('stories.publish'));

-- A view is written by the VIEWER, about themselves. Without the actor_id
-- clause a reader could record views on behalf of other people, and by seeing
-- which inserts succeeded, enumerate somebody else's audience membership. The
-- story_view_audience_guard trigger enforces the audience half.
drop policy if exists story_view_written_by_viewer on chat.story_view;
create policy story_view_written_by_viewer on chat.story_view
  for insert to authenticated
  with check (actor_id in (select chat.current_actor_ids()));

-- ---------------------------------------------------------------------------
-- 7. Configuration and content
-- ---------------------------------------------------------------------------

insert into chat.config (key, value, scope, description) values
  ('story.default_lifetime_hours', '24'::jsonb, 'communication',
   'How long a published story stays live when the publisher names no expiry.'),
  ('story.max_body_length', '2000'::jsonb, 'communication',
   'Longest story body accepted.'),
  ('story.feed_page_size', '50'::jsonb, 'communication',
   'Stories returned in one feed page.')
on conflict (key) do nothing;

insert into chat.notification_template (key, locale, version, title, body) values
  ('story_published', 'ar', 1, 'جديد من {organization_name}', '{story_title}'),
  ('story_published', 'en', 1, 'New from {organization_name}', '{story_title}')
on conflict (key, locale, version) do nothing;
