-- Parent Profile V2: an About and a photo, for a parent and for each of their children.
--
-- WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT
--
-- Two sibling tables holding exactly two facts each: a short free-text About and a private
-- object key for a photo. NO NAME. The name a parent and a learner already have lives in
-- `chat.contact.name` and `chat.learner.name`, those stay the single source of truth, and
-- copying them here would create the second identity this feature exists to avoid.
--
-- WHY SIBLING TABLES RATHER THAN COLUMNS ON contact/learner
--
-- The repository's habit is a column on the row (`chat.story` keeps its media key that way,
-- and `chat.learner.level` is a plain column), and for a photo alone that habit would be
-- right. The deciding factor here is OWNERSHIP OVER TIME.
--
-- A learner is an academy entity. `chat.teacher` already shows where that leads: it carries
-- `core_teacher_id` and `synced_at` because it PROJECTS a Jawwid Core teacher. No ingestion
-- writes `chat.learner` today, but when one is built it will upsert these rows from Core --
-- and any Chat-owned column sitting on them survives only if that upsert remembers to
-- enumerate its columns. That is a convention, not a guarantee, and a blanket upsert would
-- silently erase every parent's About and photo on the first sync.
--
-- A sibling table cannot be erased that way. Core may own `chat.learner` outright; the
-- profile beside it stays Chat's, and the boundary is structural instead of remembered:
--
--     Core-owned projection row   +   Chat-owned profile row
--       = one learner, two owners, no collision possible
--
-- It also leaves `contact` and `learner` policies untouched: the new tables carry their own
-- tenant boundary rather than widening the identity tables' own.
--
-- AUTHORIZATION IS NOT IN THIS FILE, AND SAYING SO MATTERS
--
-- Every RLS policy in this schema is written for STAFF under a per-request actor context
-- (`chat.current_staff_id()`), and nothing in the runtime sets a CONTACT context -- see
-- RLS-STRATEGY §7 item 1, still unmet. So the org-isolation policy below is the tenant
-- boundary and nothing more: it does NOT make one parent invisible to another.
--
-- Parent-to-parent and parent-to-child isolation is enforced in the application, by the
-- same predicate the rest of the parent surface already uses -- a contact reaches a learner
-- only through its own `family_id`. That is where the tests for it live
-- (`apps/api/test/integration/parent-profile-v2.spec.ts`). This comment exists so nobody
-- later reads "RLS enabled" and believes the database is doing work it is not.
--
-- THE PHOTO IS A KEY, NEVER A URL
--
-- `avatar_object_key` names an object in the private bucket attachments and stories already
-- use. Holding the key reads nothing: a read is a short-lived signed URL minted per request
-- for a caller already proven entitled (see 961184f -- possession of a key grants nothing).
-- No public object, no permanent URL, and the key is never serialised to a client.
--
-- COMPATIBILITY: two new tables. Nothing existing is altered, nothing is backfilled, and a
-- parent or learner with no profile row simply has no About and no photo -- which is what
-- every one of them is today. Dropping both tables returns the schema exactly to 8e36546.
--
-- JAWWID CORE IS NOT TOUCHED. Core is a separate system and is not in this repository.
--
-- ROLLBACK:
--   drop table if exists chat.learner_profile;
--   drop table if exists chat.contact_profile;

-- ---------------------------------------------------------------- 1. the tables

create table if not exists chat.contact_profile (
  -- PRD 2.3: organization_id on every root entity.
  organization_id uuid not null default chat.default_organization_id(),
  -- The PK *is* the contact: one profile per contact, enforced by the key itself rather
  -- than by a unique index somebody could forget. `on delete cascade` because a profile
  -- without its person is not a thing worth keeping.
  contact_id        uuid primary key references chat.contact(id) on delete cascade,
  about             text,
  avatar_object_key text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- Bounded here as well as in the service: a limit enforced in one place only is a limit
  -- the next writer does not have.
  constraint contact_profile_about_length check (about is null or char_length(about) <= 1000)
);

create table if not exists chat.learner_profile (
  organization_id uuid not null default chat.default_organization_id(),
  learner_id        uuid primary key references chat.learner(id) on delete cascade,
  about             text,
  avatar_object_key text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint learner_profile_about_length check (about is null or char_length(about) <= 1000)
);

comment on table chat.contact_profile is
  'Chat-owned profile for a family contact: an About and a private photo key. The contact''s NAME is not here -- chat.contact.name remains the only source of truth for it.';
comment on table chat.learner_profile is
  'Chat-owned profile for a learner: an About and a private photo key. Deliberately a sibling of chat.learner rather than columns on it, so a future Jawwid Core projection of the learner cannot overwrite Chat-owned profile state. The learner''s NAME stays in chat.learner.name.';
comment on column chat.contact_profile.avatar_object_key is
  'Private object-storage key. Read only through a short-lived signed URL minted per request; never served as a public URL and never returned to a client.';
comment on column chat.learner_profile.avatar_object_key is
  'Private object-storage key, managed by an authorized contact of the same family. Same signed-read rule as the contact''s.';

-- ------------------------------------------------- 2. keep updated_at honest

drop trigger if exists contact_profile_set_updated_at on chat.contact_profile;
create trigger contact_profile_set_updated_at
  before update on chat.contact_profile
  for each row execute function chat.set_updated_at();

drop trigger if exists learner_profile_set_updated_at on chat.learner_profile;
create trigger learner_profile_set_updated_at
  before update on chat.learner_profile
  for each row execute function chat.set_updated_at();

-- ------------------------------------------------- 3. the tenant boundary

alter table chat.contact_profile enable row level security;
alter table chat.learner_profile enable row level security;

-- RESTRICTIVE, so it ANDs with everything else instead of widening anything, and `for all`
-- so reads and writes are covered alike. A null organization context yields NULL, the
-- comparison is NULL, and the row is denied -- the "NULL means see nothing" convention
-- chat.current_organization_id() documents.
drop policy if exists contact_profile_organization_isolation on chat.contact_profile;
create policy contact_profile_organization_isolation on chat.contact_profile
  as restrictive
  for all
  using (organization_id = chat.current_organization_id())
  with check (organization_id = chat.current_organization_id());

drop policy if exists learner_profile_organization_isolation on chat.learner_profile;
create policy learner_profile_organization_isolation on chat.learner_profile
  as restrictive
  for all
  using (organization_id = chat.current_organization_id())
  with check (organization_id = chat.current_organization_id());

-- ------------------------------------------------- 4. grants

-- Enumerated, never `for all to chat_app using (true)`. That form reads as a grant but
-- behaves as a permissive policy that cancels the table's other read policies -- the trap
-- the stories migration calls out in its section 6.
grant select, insert, update, delete on chat.contact_profile, chat.learner_profile
  to authenticated, service_role;
grant select, insert, update, delete on chat.contact_profile, chat.learner_profile
  to chat_app;
