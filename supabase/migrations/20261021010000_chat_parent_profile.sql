-- =============================================================================
-- Parent profile: an About for a parent and for each of their children
-- =============================================================================
--
-- Ported 2026-10-20 from feat/parent-profile-v2 (42e4d54f), where it was
-- 20261008120000 and also held a photo key on each row. Main already has the
-- photos: chat.contact.avatar_object_key and chat.learner.avatar_object_key,
-- written only through /me/avatar and /me/children/:id/avatar (20261014130000
-- holds their key format). So these tables carry the About and nothing else.
--
-- NO NAME, NO PHOTO. chat.contact.name and chat.learner.name stay the only
-- names; the photo stays on the identity row where every chat surface reads it.
--
-- WHY SIBLING TABLES RATHER THAN COLUMNS ON contact/learner
--
-- A learner is an academy entity. When an ingestion from Jawwid Core upserts
-- chat.learner / chat.contact, any Chat-owned column on those rows survives only
-- if that upsert remembers to leave it alone. A sibling row cannot be erased that
-- way: Core may own the identity row outright, and the About beside it stays
-- Chat's.
--
-- TENANCY. organization_id is never taken from the caller: a trigger copies it
-- from the subject's own row on every write, so a profile always sits in its
-- person's organization.
--
-- ACCESS. Like the other per-viewer tables (labels, quick replies, message
-- revisions): written only by the API's owner connection. RLS on, no policy,
-- so the request roles reach nothing here. Who may edit which About is the
-- service's rule -- a contact reaches a learner only through its own family_id
-- (apps/api/test/integration/parent-profile-v2.spec.ts).
--
-- The audit trail records that an About changed and its LENGTH, never its text.
--
-- ROLLBACK:
--   drop table if exists chat.learner_profile;
--   drop table if exists chat.contact_profile;
--   drop function if exists chat.profile_take_subject_organization();

create table if not exists chat.contact_profile (
  organization_id uuid not null default chat.default_organization_id(),
  -- The PK *is* the contact: one profile per contact, by the key itself.
  contact_id      uuid primary key references chat.contact(id) on delete cascade,
  about           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint contact_profile_about_length check (about is null or char_length(about) <= 1000)
);

create table if not exists chat.learner_profile (
  organization_id uuid not null default chat.default_organization_id(),
  learner_id      uuid primary key references chat.learner(id) on delete cascade,
  about           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint learner_profile_about_length check (about is null or char_length(about) <= 1000)
);

comment on table chat.contact_profile is
  'Chat-owned About for a family contact. No name (chat.contact.name) and no photo (chat.contact.avatar_object_key).';
comment on table chat.learner_profile is
  'Chat-owned About for a learner, edited by a contact of the same family. A sibling of chat.learner so a Core projection cannot overwrite it. No name, no photo.';

-- The profile's organization is its subject's, whatever the writer sent.
create or replace function chat.profile_take_subject_organization()
returns trigger
language plpgsql
set search_path = chat, pg_temp
as $$
begin
  if tg_table_name = 'contact_profile' then
    new.organization_id := (select c.organization_id from chat.contact c where c.id = new.contact_id);
  else
    new.organization_id := (select l.organization_id from chat.learner l where l.id = new.learner_id);
  end if;
  return new;
end
$$;

drop trigger if exists contact_profile_take_organization on chat.contact_profile;
create trigger contact_profile_take_organization
  before insert or update on chat.contact_profile
  for each row execute function chat.profile_take_subject_organization();

drop trigger if exists learner_profile_take_organization on chat.learner_profile;
create trigger learner_profile_take_organization
  before insert or update on chat.learner_profile
  for each row execute function chat.profile_take_subject_organization();

drop trigger if exists contact_profile_set_updated_at on chat.contact_profile;
create trigger contact_profile_set_updated_at
  before update on chat.contact_profile
  for each row execute function chat.set_updated_at();

drop trigger if exists learner_profile_set_updated_at on chat.learner_profile;
create trigger learner_profile_set_updated_at
  before update on chat.learner_profile
  for each row execute function chat.set_updated_at();

alter table chat.contact_profile enable row level security;
alter table chat.learner_profile enable row level security;

grant select, insert, update, delete on chat.contact_profile, chat.learner_profile to service_role;
