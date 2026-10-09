-- Chat-owned profile for staff and teachers: a private photo key.
--
-- WHY SIBLING TABLES AND NOT COLUMNS, FOR THESE TWO AS WELL
--
-- `chat.teacher` projects a Jawwid Core teacher -- it carries `core_teacher_id` and
-- `synced_at`. A Chat-owned column on that row is one enumeration away from being wiped by
-- a future ingestion path, and the only thing protecting it would be a comment asking the
-- next author not to touch it. The earlier design did exactly that and documented the
-- hazard rather than removing it.
--
-- `chat.staff` has no Core columns today, so a column there would be safe. It still gets a
-- sibling table, because "profile data never sits on an identity row" is worth having as a
-- structural invariant with no exceptions: one rule, one code path for all four subject
-- kinds, and nothing to re-derive when somebody adds a fifth.
--
-- NOT TO BE CONFUSED WITH chat.teacher_professional_profile
--
-- That is a different feature (Teacher Profile V2: biography, certificates, a reviewed
-- professional photo). This table holds the ACCOUNT avatar -- the face shown beside a
-- message, in Group Info and in Settings. The two are deliberately uncoupled: neither reads
-- the other, and a teacher may have one without the other.
--
-- NO NAMES HERE. `chat.staff.name` and `chat.teacher.name` remain the only source of truth,
-- exactly as `chat.contact.name` does for a contact.

-- ------------------------------------------------- 1. the tables

create table if not exists chat.staff_profile (
  organization_id uuid not null default chat.default_organization_id(),
  staff_id          uuid primary key references chat.staff(id) on delete cascade,
  avatar_object_key text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists chat.teacher_profile (
  organization_id uuid not null default chat.default_organization_id(),
  teacher_id        uuid primary key references chat.teacher(id) on delete cascade,
  avatar_object_key text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table chat.staff_profile is
  'Chat-owned account profile for a staff member: a private photo key. A sibling of chat.staff rather than columns on it, so identity rows stay identity rows.';
comment on table chat.teacher_profile is
  'Chat-owned ACCOUNT profile for a teacher: a private photo key. A sibling of chat.teacher because that row projects Jawwid Core and a sync must not be able to overwrite Chat-owned state. Distinct from chat.teacher_professional_profile, which is the separate Teacher Profile V2 feature; neither reads the other.';
comment on column chat.staff_profile.avatar_object_key is
  'Private object-storage key. Read only through a short-lived signed URL minted per request; never served as a public URL and never returned to a client.';
comment on column chat.teacher_profile.avatar_object_key is
  'Private object-storage key. Same signed-read rule as every other avatar. NOT the professional photo, which lives in chat.teacher_professional_profile and is reviewed.';

-- ------------------------------------------------- 2. keep updated_at honest

drop trigger if exists staff_profile_set_updated_at on chat.staff_profile;
create trigger staff_profile_set_updated_at
  before update on chat.staff_profile
  for each row execute function chat.set_updated_at();

drop trigger if exists teacher_profile_set_updated_at on chat.teacher_profile;
create trigger teacher_profile_set_updated_at
  before update on chat.teacher_profile
  for each row execute function chat.set_updated_at();

-- ------------------------------------------------- 3. the tenant boundary

alter table chat.staff_profile enable row level security;
alter table chat.teacher_profile enable row level security;

-- RESTRICTIVE, so it ANDs with everything else instead of widening anything, and `for all`
-- so reads and writes are covered alike. A null organization context yields NULL, the
-- comparison is NULL, and the row is denied.
--
-- This is the TENANT boundary and nothing more. Whether a given caller may read or write a
-- given subject's photo is an application decision, taken from the token; no contact or
-- staff actor context is set on the connection at runtime, so RLS cannot and does not
-- express it.
drop policy if exists staff_profile_organization_isolation on chat.staff_profile;
create policy staff_profile_organization_isolation on chat.staff_profile
  as restrictive
  for all
  using (organization_id = chat.current_organization_id())
  with check (organization_id = chat.current_organization_id());

drop policy if exists teacher_profile_organization_isolation on chat.teacher_profile;
create policy teacher_profile_organization_isolation on chat.teacher_profile
  as restrictive
  for all
  using (organization_id = chat.current_organization_id())
  with check (organization_id = chat.current_organization_id());

-- ------------------------------------------------- 4. grants

-- Enumerated, never `for all to chat_app using (true)`. That form reads as a grant but
-- behaves as a permissive policy that cancels the table's other read policies.
grant select, insert, update, delete on chat.staff_profile, chat.teacher_profile
  to chat_app;
