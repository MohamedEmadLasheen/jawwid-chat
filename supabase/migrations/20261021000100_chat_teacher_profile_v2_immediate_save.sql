-- =====================================================================
-- PORTED 2026-10-20 onto integration/admin-profile-2026-10-14-rtchat.
-- Original name: 20261008090000_chat_teacher_profile_v2_immediate_save.sql
-- (feat/teacher-professional-profile, b09072b). Renamed so it orders after
-- 20261021000000 (originally 20261007120000, ported as 20261020100000) and the integration tip.
--
-- ONE CHANGE AT PORT -- THE PHOTO IS NOT HERE. The original added
-- photo_object_key / photo_mime_type / photo_byte_size / photo_updated_at to
-- the profile row. On this line chat.teacher already has avatar_object_key
-- (20261005160000), constrained to avatars/teacher/<teacher id>/<uuid>
-- (20261014130000) -- the column every surface that shows a teacher's face
-- reads. Two photo columns for one person is two photos that can disagree, so
-- the profile photo IS chat.teacher.avatar_object_key and this migration no
-- longer adds a second one. Type, size and dimensions are checked against the
-- stored bytes at commit (image-inspection.ts), as the staff photo already is;
-- the MIME the bytes are served with is the one storage recorded.
-- =====================================================================
--
-- =====================================================================
-- Teacher professional profile, V2: the teacher owns it outright.
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- 20261007120000 built a copy-on-write revision model with a review
-- workflow: the teacher edited a draft, an admin approved it, and a pointer
-- (`published_revision_id`) decided what a parent saw. That shape existed to
-- answer exactly one question -- "what does a parent see while the teacher is
-- mid-edit?" -- and the product no longer asks it. A teacher edits their own
-- professional profile and presses Save; the saved profile IS the profile.
--
-- With that question gone, every piece of machinery that answered it becomes
-- dead state: five triggers, a five-value state machine, two pointer columns,
-- a promotion transaction and a partial unique index on "the open revision".
-- Dead state machines are not free -- they are read as requirements by the next
-- person -- so they are removed rather than left unreachable.
--
-- WHY A FORWARD MIGRATION AND NOT AN AMENDMENT
-- --------------------------------------------
-- 20261007120000 is unreleased, so amending it in place would be legitimate on
-- paper. It is also already applied to the QA database that holds the only
-- Teacher Profile test data in existence, and amending it would mean recreating
-- that database. Forward-only keeps the ledger honest and the data alive, and is
-- the shape that stays safe if this series is ever promoted.
--
-- WHAT IS DELIBERATELY KEPT
-- -------------------------
-- Certificate review. A teacher uploading a credential is making a claim about
-- their qualifications, and immediate save on PROFILE TEXT is not a reason to
-- treat an uploaded Ijazah as verified. `state` stays pending/approved/rejected,
-- the teacher still cannot decide their own, and editing a claim still returns
-- it to pending.
-- =====================================================================

-- ---------------------------------------------------------------------------
-- 1. The profile row becomes the profile
-- ---------------------------------------------------------------------------

alter table chat.teacher_professional_profile
  add column if not exists bio            text,
  add column if not exists specialization text,
  add column if not exists qualifications text,
  add column if not exists experience     text,
  add column if not exists languages      text[] not null default '{}';

do $$
begin
  -- Same ceilings as the revision table they replace, so the limit does not
  -- quietly widen in the move.
  if not exists (select 1 from pg_constraint where conname = 'teacher_profile_bio_length_check') then
    alter table chat.teacher_professional_profile
      add constraint teacher_profile_bio_length_check
      check (bio is null or char_length(bio) <= 2000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'teacher_profile_specialization_length_check') then
    alter table chat.teacher_professional_profile
      add constraint teacher_profile_specialization_length_check
      check (specialization is null or char_length(specialization) <= 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'teacher_profile_qualifications_length_check') then
    alter table chat.teacher_professional_profile
      add constraint teacher_profile_qualifications_length_check
      check (qualifications is null or char_length(qualifications) <= 2000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'teacher_profile_experience_length_check') then
    alter table chat.teacher_professional_profile
      add constraint teacher_profile_experience_length_check
      check (experience is null or char_length(experience) <= 2000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'teacher_profile_languages_bounds_check') then
    alter table chat.teacher_professional_profile
      add constraint teacher_profile_languages_bounds_check
      check (array_length(languages, 1) is null or array_length(languages, 1) <= 10);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Carry the content forward
-- ---------------------------------------------------------------------------
--
-- From the LATEST revision, not the published one. Under immediate save the
-- teacher's most recent edit is by definition the current profile, so taking the
-- published row would silently discard work the teacher had already typed and
-- saved. In the QA data that is the difference between keeping the draft bio and
-- throwing it away.

update chat.teacher_professional_profile p
   set bio            = r.bio,
       specialization = r.specialization,
       qualifications = r.qualifications,
       experience     = r.experience,
       languages      = r.languages
  from (
    select distinct on (profile_id)
           profile_id, bio, specialization, qualifications, experience, languages
      from chat.teacher_profile_revision
     order by profile_id, revision_number desc
  ) r
 where r.profile_id = p.id;

-- ---------------------------------------------------------------------------
-- 3. Certificates belong to the profile
-- ---------------------------------------------------------------------------

-- The V1 guard refuses ANY write to a certificate whose revision is approved,
-- which is exactly the state the QA data is in -- so it has to go before the
-- backfill touches a row, not after. Dropping it first is safe: nothing can
-- write a certificate between these two statements, because the whole migration
-- runs in one transaction.
drop trigger if exists teacher_certificate_guard_trg on chat.teacher_profile_certificate;

alter table chat.teacher_profile_certificate
  add column if not exists profile_id uuid references chat.teacher_professional_profile (id) on delete cascade;

update chat.teacher_profile_certificate c
   set profile_id = r.profile_id
  from chat.teacher_profile_revision r
 where r.id = c.revision_id
   and c.profile_id is null;

-- Copy-on-write carried one claim per revision pointing at the SAME object, so
-- collapsing revisions can collide on (profile_id, object_key). Keep the most
-- recently touched row of each collision: that is the one whose title, issuer and
-- review decision are current.
delete from chat.teacher_profile_certificate c
 where exists (
   select 1 from chat.teacher_profile_certificate k
    where k.profile_id = c.profile_id
      and k.object_key = c.object_key
      and (k.updated_at, k.id) > (c.updated_at, c.id)
 );

alter table chat.teacher_profile_certificate
  alter column profile_id set not null;

drop index if exists chat.teacher_certificate_revision_idx;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'teacher_certificate_profile_key_unique') then
    alter table chat.teacher_profile_certificate
      add constraint teacher_certificate_profile_key_unique unique (profile_id, object_key);
  end if;
end $$;

alter table chat.teacher_profile_certificate
  drop constraint if exists teacher_certificate_revision_key_unique;

create index if not exists teacher_certificate_profile_idx
  on chat.teacher_profile_certificate (profile_id);

-- The pointer FKs from 20261007120000 are DEFERRABLE INITIALLY DEFERRED, so the
-- backfill above leaves their checks queued; Postgres then refuses to ALTER a
-- table that "has pending trigger events". Forcing the deferred checks to run
-- now both clears that and proves the backfilled rows are referentially sound
-- BEFORE anything is dropped -- which is the better moment to find out.
set constraints all immediate;

-- ---------------------------------------------------------------------------
-- 4. Remove the review machinery
-- ---------------------------------------------------------------------------
--
-- Policies first: several of them reference the functions and columns below, and
-- a policy is a dependency Postgres will refuse to orphan.

drop policy if exists teacher_revision_organization_isolation on chat.teacher_profile_revision;
drop policy if exists teacher_revision_owner_all              on chat.teacher_profile_revision;
drop policy if exists teacher_revision_reviewer_reads         on chat.teacher_profile_revision;
drop policy if exists teacher_revision_reviewer_writes        on chat.teacher_profile_revision;
drop policy if exists teacher_revision_published_is_public    on chat.teacher_profile_revision;

drop policy if exists teacher_certificate_organization_isolation on chat.teacher_profile_certificate;
drop policy if exists teacher_certificate_owner_all             on chat.teacher_profile_certificate;
drop policy if exists teacher_certificate_reviewer_reads        on chat.teacher_profile_certificate;
drop policy if exists teacher_certificate_reviewer_writes       on chat.teacher_profile_certificate;
drop policy if exists teacher_certificate_published_is_public   on chat.teacher_profile_certificate;

drop policy if exists teacher_profile_published_is_public on chat.teacher_professional_profile;
drop policy if exists teacher_profile_owner_all           on chat.teacher_professional_profile;
drop policy if exists teacher_profile_reviewer_reads      on chat.teacher_professional_profile;
-- No profile-level decision survives, so no reviewer writes one.
drop policy if exists teacher_profile_reviewer_writes     on chat.teacher_professional_profile;

drop trigger if exists teacher_revision_a_immutable_trg        on chat.teacher_profile_revision;
drop trigger if exists teacher_revision_b_material_edit_trg    on chat.teacher_profile_revision;
drop trigger if exists teacher_revision_c_state_transition_trg on chat.teacher_profile_revision;
drop trigger if exists teacher_revision_d_approval_gate_trg    on chat.teacher_profile_revision;
drop trigger if exists teacher_revision_e_no_self_review_trg   on chat.teacher_profile_revision;
drop trigger if exists teacher_profile_pointer_guard_trg       on chat.teacher_professional_profile;

alter table chat.teacher_professional_profile
  drop constraint if exists teacher_profile_published_revision_fkey,
  drop constraint if exists teacher_profile_draft_revision_fkey;

drop index if exists chat.teacher_profile_published_revision_idx;

alter table chat.teacher_professional_profile
  drop column if exists published_revision_id,
  drop column if exists draft_revision_id;

alter table chat.teacher_profile_certificate
  drop column if exists revision_id;

drop table if exists chat.teacher_profile_revision;

drop function if exists chat.teacher_revision_a_immutable();
drop function if exists chat.teacher_revision_b_material_edit();
drop function if exists chat.teacher_revision_c_state_transition();
drop function if exists chat.teacher_revision_d_approval_gate();
drop function if exists chat.teacher_revision_e_no_self_review();
drop function if exists chat.teacher_profile_pointer_guard();
drop function if exists chat.teacher_revision_organization_id(uuid);

comment on table chat.teacher_professional_profile is
  'One teacher''s professional profile, owned and edited by that teacher. '
  'Saved content is immediately the current content: there is no draft, no '
  'review state and no publication pointer. Name and role are NOT here -- they '
  'stay on chat.teacher, which is the only teacher identity.';

-- ---------------------------------------------------------------------------
-- 5. Keep the profile's updated_at honest
-- ---------------------------------------------------------------------------

drop trigger if exists teacher_profile_set_updated_at on chat.teacher_professional_profile;
create trigger teacher_profile_set_updated_at
  before update on chat.teacher_professional_profile
  for each row execute function chat.set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. The certificate guard, re-aimed at the profile
-- ---------------------------------------------------------------------------
--
-- Two of its three jobs survive the revision model unchanged, because neither
-- was ever about revisions:
--
--   * a teacher may attach and remove their own credentials but may NEVER decide
--     one, and
--   * editing a claim returns it to `pending` -- the approval was of a claim, not
--     of a file, so retitling an approved "Ijazah in Tajweed, Al-Azhar" to
--     anything at all must not inherit the old decision.
--
-- The third job -- returning the revision to draft -- has nothing left to do.

create or replace function chat.teacher_certificate_guard()
returns trigger
language plpgsql
as $$
declare
  v_profile uuid := coalesce(new.profile_id, old.profile_id);
begin
  if tg_op = 'UPDATE' and new.state in ('approved', 'rejected')
     and new.state is distinct from old.state then
    if exists (select 1
                 from chat.teacher_professional_profile p
                where p.id = v_profile
                  and p.teacher_id in (select chat.current_teacher_ids())) then
      raise exception 'a teacher cannot decide their own certificate'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- A pure review decision: the state and reviewer stamps moved, the claim did
  -- not. Leave the decision standing.
  if tg_op = 'UPDATE'
     and new.profile_id  is not distinct from old.profile_id
     and new.object_key  is not distinct from old.object_key
     and new.title       is not distinct from old.title
     and new.issuing_organization is not distinct from old.issuing_organization
     and new.issued_on   is not distinct from old.issued_on then
    new.updated_at := now();
    return new;
  end if;

  -- The claim itself changed, so the decision no longer applies to it.
  if tg_op = 'UPDATE' then
    new.state       := 'pending';
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.review_note := null;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

comment on function chat.teacher_certificate_guard() is
  'A teacher may attach and remove credentials but never decide one; a changed '
  'claim returns to pending, while a reviewer''s decision stands.';

create trigger teacher_certificate_guard_trg
  before insert or update or delete on chat.teacher_profile_certificate
  for each row
  execute function chat.teacher_certificate_guard();

-- ---------------------------------------------------------------------------
-- 7. Row level security, rebuilt for two tables
-- ---------------------------------------------------------------------------

alter table chat.teacher_professional_profile enable row level security;
alter table chat.teacher_profile_certificate  enable row level security;

-- The tenant boundary. RESTRICTIVE, so it intersects every permissive policy
-- below rather than offering an alternative to them.
create policy teacher_certificate_organization_isolation
  on chat.teacher_profile_certificate
  as restrictive
  for all
  using (chat.teacher_profile_organization_id(profile_id) = chat.current_organization_id())
  with check (chat.teacher_profile_organization_id(profile_id) = chat.current_organization_id());

-- --- the profile ------------------------------------------------------------

create policy teacher_profile_owner_all on chat.teacher_professional_profile
  for all to authenticated
  using (teacher_id in (select chat.current_teacher_ids()))
  with check (teacher_id in (select chat.current_teacher_ids()));

-- Reviewers read profiles because a certificate is reviewed in the context of
-- the teacher claiming it. They no longer WRITE one: there is no profile-level
-- decision left to record.
create policy teacher_profile_reviewer_reads on chat.teacher_professional_profile
  for select to authenticated
  using (chat.current_can_review_teacher_profile());

-- The professional profile is the teacher's public-facing credential page, and
-- saved content is current content, so any authenticated actor inside the
-- organization may read it. Scoped, not blanket: the RESTRICTIVE tenant policy
-- on this table still applies, and `for select` cannot widen any write.
create policy teacher_profile_is_readable on chat.teacher_professional_profile
  for select to authenticated
  using (true);

-- --- certificates -----------------------------------------------------------

create policy teacher_certificate_owner_all on chat.teacher_profile_certificate
  for all to authenticated
  using (exists (select 1 from chat.teacher_professional_profile p
                  where p.id = profile_id
                    and p.teacher_id in (select chat.current_teacher_ids())))
  with check (exists (select 1 from chat.teacher_professional_profile p
                       where p.id = profile_id
                         and p.teacher_id in (select chat.current_teacher_ids())));

create policy teacher_certificate_reviewer_reads on chat.teacher_profile_certificate
  for select to authenticated
  using (chat.current_can_review_teacher_profile());

create policy teacher_certificate_reviewer_writes on chat.teacher_profile_certificate
  for update to authenticated
  using (chat.current_can_review_teacher_profile())
  with check (chat.current_can_review_teacher_profile());

-- A third party sees an APPROVED claim and nothing else. A pending or rejected
-- credential is never their business: the first is unverified and the second was
-- refused, and publishing either would make the review decision meaningless.
create policy teacher_certificate_approved_is_readable on chat.teacher_profile_certificate
  for select to authenticated
  using (state = 'approved');
