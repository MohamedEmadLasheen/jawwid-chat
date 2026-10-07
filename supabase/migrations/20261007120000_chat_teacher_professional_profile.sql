-- Jawwid Chat -- the teacher's professional profile, versioned, and the review
-- that gates what a family may read.
--
-- WHAT THIS IS NOT. Not a second teacher identity: the profile carries a foreign
-- key to chat.teacher and NO name and NO role column, so a profile cannot
-- disagree with the person it belongs to. Not an operational record either --
-- students, schedules, lessons, attendance, assignments and pay are Jawwid
-- Core's, and where Core has nothing yet they are still not this table's.
--
-- ## The shape, and why
--
-- Three tables, because a family must keep seeing the last APPROVED profile
-- while the teacher edits the next one:
--
--   profile     the container. Owns two pointers and no content:
--               published_revision_id -- what a family reads
--               draft_revision_id     -- what the teacher is editing
--   revision    an immutable-once-approved content snapshot
--   certificate a credential CLAIM belonging to exactly one revision
--
-- The alternative -- approved_bio/draft_bio column pairs on one row -- was
-- rejected: every new field doubles, every read has to remember which half it
-- means, and "which one is public?" becomes a convention instead of a join.
--
-- ## The guarantee, and where it lives
--
-- AN APPROVED REVISION IS IMMUTABLE. A trigger refuses any content UPDATE on a
-- revision in `approved` or `superseded`. Not "an edit un-approves it" -- it
-- cannot be edited at all, by a teacher, by a reviewer, or by a bug. That is
-- what makes it safe to keep showing a family, and it is a simpler invariant to
-- check than the one it replaces.
--
-- A teacher's edit after approval is copy-on-write: a NEW revision, seeded from
-- the published one. The published row is never touched again.
--
-- A REVISION CANNOT BE APPROVED WHILE ANY OF ITS CERTIFICATES IS `pending`. The
-- reviewer must approve or reject each one. Otherwise a teacher watches a
-- credential silently fail to publish and assumes it went out.
--
-- ## Where authorization lives
--
-- The API decides, as it does for stories and messaging: every route resolves
-- the caller through IdentityService and asks AuthorizationService. RLS here is
-- the second layer (docs/security/RLS-STRATEGY.md section 2) and is inert until
-- the API sets an actor context, so nothing in the service may lean on it. The
-- policies are written anyway, and written narrowly, because a second layer that
-- says `using (true)` is not a second layer.

-- ---------------------------------------------------------------------------
-- 0. Caller predicates
-- ---------------------------------------------------------------------------

-- The teacher ids the caller IS. `chat.current_actor_ids()` already answers the
-- wider "every actor id I am"; this narrows it to teachers, so a profile policy
-- cannot be satisfied by holding an unrelated staff or contact id.
create or replace function chat.current_teacher_ids()
returns setof uuid
language sql
stable
security definer
set search_path = chat, pg_temp
as $$
  select t.id
    from chat.teacher t
   where t.account_id = chat.current_account_id()
     and t.is_active
$$;

comment on function chat.current_teacher_ids() is
  'Every ACTIVE teacher id the current caller is. Empty for staff, families and '
  'unresolved callers, which policies treat as "own nothing".';

-- Who may review. The same family-facing staff set that publishes stories --
-- admin, coverage, manager -- because deciding what a family may read about a
-- teacher is the same kind of authority as deciding what a family is told.
-- Department staff (finance, technical, academic) never address families.
create or replace function chat.current_can_review_teacher_profile()
returns boolean
language sql
stable
security definer
set search_path = chat, pg_temp
as $$
  select coalesce(chat.current_staff_role() in ('admin', 'coverage', 'manager'), false)
$$;

comment on function chat.current_can_review_teacher_profile() is
  'Reviewer predicate: the family-facing staff roles. Mirrors '
  'FAMILY_FACING_STAFF_ROLES in contracts/vocab.ts, as stories does.';

-- ---------------------------------------------------------------------------
-- 1. The container
-- ---------------------------------------------------------------------------

create table if not exists chat.teacher_professional_profile (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default chat.default_organization_id()
                    references chat.organization (id),

  -- One profile per teacher. No name, no role: identity is joined, never copied.
  teacher_id      uuid not null unique references chat.teacher (id) on delete cascade,

  -- The two pointers. Both nullable and both set by the service inside the same
  -- transaction as the revision they name; the foreign keys are added in section
  -- 3, after the revision table exists.
  published_revision_id uuid,
  draft_revision_id     uuid,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table chat.teacher_professional_profile is
  'The container for one teacher''s professional profile. Holds no content -- '
  'only which revision a family reads (published_revision_id) and which the '
  'teacher is editing (draft_revision_id).';

comment on column chat.teacher_professional_profile.published_revision_id is
  'The ONLY parent-visible revision. NULL means never approved -- which is the '
  'only empty case, and never means "currently being edited".';

-- ---------------------------------------------------------------------------
-- 2. The revision
-- ---------------------------------------------------------------------------

create table if not exists chat.teacher_profile_revision (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null
                    references chat.teacher_professional_profile (id) on delete cascade,

  -- Monotonic per profile, so a reviewer and a teacher can name the same thing.
  revision_number integer not null,

  -- Teacher-authored content. All nullable: a profile begins empty and is filled
  -- over time, and an empty field is "not written yet", never "none".
  bio             text,
  specialization  text,
  qualifications  text,
  experience      text,

  -- A list, because "Arabic, English" in one text column is a string every
  -- consumer then has to guess the separator for.
  languages       text[] not null default '{}',

  state           text not null default 'draft',

  submitted_at    timestamptz,
  reviewed_at     timestamptz,
  reviewed_by     uuid references chat.staff (id),
  review_note     text,
  approved_at     timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint teacher_revision_number_unique unique (profile_id, revision_number),

  constraint teacher_revision_state_check
    check (state in ('draft', 'pending_review', 'changes_requested',
                     'approved', 'superseded')),

  constraint teacher_revision_submitted_stamp_check
    check (state in ('draft')
           or submitted_at is not null),

  constraint teacher_revision_reviewed_stamp_check
    check (state not in ('changes_requested', 'approved', 'superseded')
           or (reviewed_at is not null and reviewed_by is not null)),

  -- Telling a teacher to change something without saying what is not a review.
  constraint teacher_revision_changes_note_check
    check (state <> 'changes_requested'
           or coalesce(btrim(review_note), '') <> ''),

  constraint teacher_revision_approved_stamp_check
    check ((state in ('approved', 'superseded')) = (approved_at is not null)),

  constraint teacher_revision_bio_length_check
    check (bio is null or char_length(bio) <= 2000),
  constraint teacher_revision_specialization_length_check
    check (specialization is null or char_length(specialization) <= 200),
  constraint teacher_revision_qualifications_length_check
    check (qualifications is null or char_length(qualifications) <= 2000),
  constraint teacher_revision_experience_length_check
    check (experience is null or char_length(experience) <= 2000),
  constraint teacher_revision_languages_bounds_check
    check (array_length(languages, 1) is null or array_length(languages, 1) <= 10)
);

comment on table chat.teacher_profile_revision is
  'One content snapshot. Immutable once approved -- which is what makes it safe '
  'to keep showing a family while the next revision is written.';

comment on column chat.teacher_profile_revision.state is
  'draft | pending_review | changes_requested | approved | superseded. '
  'draft -> approved is not a legal transition: a profile cannot be approved '
  'without having been reviewed.';

-- ONE open revision per profile. "Two drafts at once" becomes unrepresentable
-- rather than merely unhandled.
create unique index if not exists teacher_revision_one_open_idx
  on chat.teacher_profile_revision (profile_id)
  where state in ('draft', 'pending_review', 'changes_requested');

-- The reviewer queue: a small slice, and the only hot read.
create index if not exists teacher_revision_queue_idx
  on chat.teacher_profile_revision (submitted_at)
  where state = 'pending_review';

create index if not exists teacher_revision_profile_idx
  on chat.teacher_profile_revision (profile_id);

-- ---------------------------------------------------------------------------
-- 3. The container's pointers
-- ---------------------------------------------------------------------------

alter table chat.teacher_professional_profile
  drop constraint if exists teacher_profile_published_revision_fkey;
alter table chat.teacher_professional_profile
  add constraint teacher_profile_published_revision_fkey
  foreign key (published_revision_id)
  references chat.teacher_profile_revision (id)
  deferrable initially deferred;

alter table chat.teacher_professional_profile
  drop constraint if exists teacher_profile_draft_revision_fkey;
alter table chat.teacher_professional_profile
  add constraint teacher_profile_draft_revision_fkey
  foreign key (draft_revision_id)
  references chat.teacher_profile_revision (id)
  deferrable initially deferred;

create index if not exists teacher_profile_published_idx
  on chat.teacher_professional_profile (published_revision_id);

-- A pointer must name a revision OF THIS PROFILE, in the right state. Both are
-- cross-row facts, so neither is expressible as a CHECK.
create or replace function chat.teacher_profile_pointer_guard()
returns trigger
language plpgsql
as $$
declare
  v_state text;
  v_owner uuid;
begin
  if new.published_revision_id is not null then
    select state, profile_id into v_state, v_owner
      from chat.teacher_profile_revision where id = new.published_revision_id;
    if v_owner is distinct from new.id then
      raise exception 'published_revision_id names a revision of another profile'
        using errcode = 'check_violation';
    end if;
    if v_state <> 'approved' then
      raise exception 'published_revision_id must name an APPROVED revision, not %', v_state
        using errcode = 'check_violation';
    end if;
  end if;

  if new.draft_revision_id is not null then
    select state, profile_id into v_state, v_owner
      from chat.teacher_profile_revision where id = new.draft_revision_id;
    if v_owner is distinct from new.id then
      raise exception 'draft_revision_id names a revision of another profile'
        using errcode = 'check_violation';
    end if;
    if v_state not in ('draft', 'pending_review', 'changes_requested') then
      raise exception 'draft_revision_id must name an OPEN revision, not %', v_state
        using errcode = 'check_violation';
    end if;
  end if;

  if new.published_revision_id is not null
     and new.published_revision_id = new.draft_revision_id then
    raise exception 'a revision cannot be both published and the open draft'
      using errcode = 'check_violation';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

comment on function chat.teacher_profile_pointer_guard() is
  'A pointer must name a revision of THIS profile in the right state. Stops a '
  'draft from being published by pointer, which would bypass review entirely.';

drop trigger if exists teacher_profile_pointer_guard_trg
  on chat.teacher_professional_profile;
create constraint trigger teacher_profile_pointer_guard_trg
  after insert or update on chat.teacher_professional_profile
  deferrable initially deferred
  for each row
  execute function chat.teacher_profile_pointer_guard();

-- ---------------------------------------------------------------------------
-- 4. The revision state machine
--
-- Trigger names carry an a/b/c/d prefix because PostgreSQL fires BEFORE triggers
-- in NAME order, and these must run in this order: refuse an illegal edit first,
-- then demote a material edit, then check the transition that results, then gate
-- approval on the certificates.
-- ---------------------------------------------------------------------------

-- (a) An approved revision is immutable. This is the whole feature.
create or replace function chat.teacher_revision_a_immutable()
returns trigger
language plpgsql
as $$
begin
  if old.state not in ('approved', 'superseded') then
    return new;
  end if;

  if new.bio            is distinct from old.bio
     or new.specialization is distinct from old.specialization
     or new.qualifications is distinct from old.qualifications
     or new.experience     is distinct from old.experience
     or new.languages      is distinct from old.languages
     or new.profile_id     is distinct from old.profile_id
     or new.revision_number is distinct from old.revision_number then
    raise exception
      'revision % is % and cannot be edited; create a new revision instead',
      old.id, old.state
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function chat.teacher_revision_a_immutable() is
  'An approved or superseded revision cannot have its content changed by '
  'anyone. This is what makes the published version safe to keep showing.';

drop trigger if exists teacher_revision_a_immutable_trg
  on chat.teacher_profile_revision;
create trigger teacher_revision_a_immutable_trg
  before update on chat.teacher_profile_revision
  for each row
  execute function chat.teacher_revision_a_immutable();

-- (b) A material edit to an OPEN revision returns it to draft, so a submission
-- cannot change beneath the reviewer reading it.
create or replace function chat.teacher_revision_b_material_edit()
returns trigger
language plpgsql
as $$
begin
  if new.bio            is distinct from old.bio
     or new.specialization is distinct from old.specialization
     or new.qualifications is distinct from old.qualifications
     or new.experience     is distinct from old.experience
     or new.languages      is distinct from old.languages then
    new.state        := 'draft';
    new.submitted_at := null;
    new.reviewed_at  := null;
    new.reviewed_by  := null;
    new.approved_at  := null;
    -- The note described the previous content; left in place it reads as
    -- current advice.
    new.review_note  := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

comment on function chat.teacher_revision_b_material_edit() is
  'Content changed on an open revision -> back to draft, every review stamp '
  'cleared. Runs after the immutability check, so it never applies to an '
  'approved row.';

drop trigger if exists teacher_revision_b_material_edit_trg
  on chat.teacher_profile_revision;
create trigger teacher_revision_b_material_edit_trg
  before update on chat.teacher_profile_revision
  for each row
  execute function chat.teacher_revision_b_material_edit();

-- (c) The legal transition set.
create or replace function chat.teacher_revision_c_state_transition()
returns trigger
language plpgsql
as $$
begin
  if new.state = old.state then
    return new;
  end if;

  if (old.state = 'draft'             and new.state = 'pending_review')
     or (old.state = 'pending_review'    and new.state in ('approved', 'changes_requested'))
     or (old.state = 'changes_requested' and new.state = 'pending_review')
     or (old.state = 'approved'          and new.state = 'superseded')
     or (new.state = 'draft' and old.state in ('pending_review', 'changes_requested')) then
    return new;
  end if;

  raise exception 'illegal teacher revision transition % -> %', old.state, new.state
    using errcode = 'check_violation';
end;
$$;

comment on function chat.teacher_revision_c_state_transition() is
  'Notably absent: draft -> approved, which would be a revision approved without '
  'ever having been reviewed; and superseded -> anything, which would un-retire '
  'a replaced version.';

drop trigger if exists teacher_revision_c_state_transition_trg
  on chat.teacher_profile_revision;
create trigger teacher_revision_c_state_transition_trg
  before update on chat.teacher_profile_revision
  for each row
  execute function chat.teacher_revision_c_state_transition();

-- (d) Approval requires every certificate to have been decided.
create or replace function chat.teacher_revision_d_approval_gate()
returns trigger
language plpgsql
as $$
declare
  v_pending integer;
begin
  if new.state <> 'approved' or old.state = 'approved' then
    return new;
  end if;

  select count(*) into v_pending
    from chat.teacher_profile_certificate
   where revision_id = new.id and state = 'pending';

  if v_pending > 0 then
    raise exception
      'revision % has % undecided certificate(s); approve or reject each one first',
      new.id, v_pending
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function chat.teacher_revision_d_approval_gate() is
  'A revision cannot be approved while a certificate on it is still pending. '
  'Without this a teacher watches a credential quietly fail to publish and '
  'assumes it went out.';

drop trigger if exists teacher_revision_d_approval_gate_trg
  on chat.teacher_profile_revision;
create trigger teacher_revision_d_approval_gate_trg
  before update on chat.teacher_profile_revision
  for each row
  execute function chat.teacher_revision_d_approval_gate();

-- (e) NOBODY REVIEWS THEMSELVES.
--
-- RLS cannot restrict columns, and a teacher legitimately holds UPDATE on their
-- own revision in order to edit and submit it -- so without this a teacher could
-- move their own submission straight to `approved`. The transition rules do not
-- catch it: pending_review -> approved is perfectly legal, just not BY THEM.
--
-- Written as "the caller must not be the owning teacher" rather than "the caller
-- must be a reviewer", because the predicate has to stay correct when no actor
-- context is set: the API runs that way and is itself the authorization
-- decision, and `current_teacher_ids()` is then empty, so this permits it. With
-- an actor context set -- a person at the database -- it bites.
create or replace function chat.teacher_revision_e_no_self_review()
returns trigger
language plpgsql
as $$
declare
  v_owner uuid;
begin
  if new.state is not distinct from old.state
     and new.reviewed_by is not distinct from old.reviewed_by
     and new.review_note is not distinct from old.review_note then
    return new;
  end if;

  -- Only review OUTCOMES are gated. A teacher submitting or being demoted to
  -- draft is their own business.
  if new.state not in ('approved', 'changes_requested', 'superseded') then
    return new;
  end if;

  select p.teacher_id into v_owner
    from chat.teacher_professional_profile p
   where p.id = new.profile_id;

  if v_owner in (select chat.current_teacher_ids()) then
    raise exception 'a teacher cannot review their own profile revision'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

comment on function chat.teacher_revision_e_no_self_review() is
  'A teacher may edit and submit their own revision but may never decide it. '
  'Phrased as "not the owner" so it stays permissive for the API (no actor '
  'context) and strict for anyone holding a teacher identity.';

drop trigger if exists teacher_revision_e_no_self_review_trg
  on chat.teacher_profile_revision;
create trigger teacher_revision_e_no_self_review_trg
  before update on chat.teacher_profile_revision
  for each row
  execute function chat.teacher_revision_e_no_self_review();

-- ---------------------------------------------------------------------------
-- 5. Certificates
-- ---------------------------------------------------------------------------

create table if not exists chat.teacher_profile_certificate (
  id              uuid primary key default gen_random_uuid(),
  revision_id     uuid not null
                    references chat.teacher_profile_revision (id) on delete cascade,

  title                 text not null,
  issuing_organization  text,
  issued_on             date,

  -- The stored object. An object key is a NAME, not a capability: holding it
  -- grants nothing, because every read is a fresh signing decision made by the
  -- API against the caller. It never leaves the server.
  --
  -- Unique PER REVISION, not globally: copy-on-write carries a claim forward to
  -- the next revision pointing at the SAME object, so one file is cited by one
  -- claim per revision and the bytes are stored once.
  object_key      text not null,
  mime_type       text not null,
  byte_size       bigint not null,

  -- Decided individually, so one questionable credential does not force the
  -- whole profile to be refused.
  state           text not null default 'pending',
  reviewed_at     timestamptz,
  reviewed_by     uuid references chat.staff (id),
  review_note     text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint teacher_certificate_revision_key_unique unique (revision_id, object_key),

  constraint teacher_certificate_state_check
    check (state in ('pending', 'approved', 'rejected')),

  constraint teacher_certificate_reviewed_stamp_check
    check (state = 'pending'
           or (reviewed_at is not null and reviewed_by is not null)),

  constraint teacher_certificate_title_check
    check (coalesce(btrim(title), '') <> '' and char_length(title) <= 200),

  constraint teacher_certificate_issuer_length_check
    check (issuing_organization is null or char_length(issuing_organization) <= 200),

  -- Accepted formats and a ceiling, here as well as in the service: a limit that
  -- lives only in a request handler is one refactor away from not existing.
  constraint teacher_certificate_mime_check
    check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),

  constraint teacher_certificate_size_check
    check (byte_size > 0 and byte_size <= 10485760)
);

comment on table chat.teacher_profile_certificate is
  'A credential CLAIM belonging to exactly one revision. object_key names a '
  'PRIVATE object, is unique only within its revision (copy-on-write cites the '
  'same file from the next revision), and is never sent to a client.';

create index if not exists teacher_certificate_revision_idx
  on chat.teacher_profile_certificate (revision_id);

create index if not exists teacher_certificate_pending_idx
  on chat.teacher_profile_certificate (revision_id) where state = 'pending';

-- A claim on a closed revision is as immutable as the revision, and a changed
-- credential set on an OPEN revision is a material change exactly as editing the
-- text is. A reviewer DECIDING a claim is deliberately not material, or
-- approving one would undo the review in progress.
create or replace function chat.teacher_certificate_guard()
returns trigger
language plpgsql
as $$
declare
  v_revision uuid := coalesce(new.revision_id, old.revision_id);
  v_state    text;
begin
  select state into v_state
    from chat.teacher_profile_revision where id = v_revision;

  if v_state in ('approved', 'superseded') then
    raise exception
      'revision % is %; its certificates cannot be changed', v_revision, v_state
      using errcode = 'check_violation';
  end if;

  -- A teacher may attach and remove their own credentials but may never decide
  -- one. Same phrasing as the revision guard, for the same reason.
  if tg_op = 'UPDATE' and new.state in ('approved', 'rejected')
     and new.state is distinct from old.state then
    if exists (select 1
                 from chat.teacher_profile_revision r
                 join chat.teacher_professional_profile p on p.id = r.profile_id
                where r.id = v_revision
                  and p.teacher_id in (select chat.current_teacher_ids())) then
      raise exception 'a teacher cannot decide their own certificate'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- A pure review decision: state and the reviewer stamps moved, the claim did
  -- not. Leave the revision alone.
  if tg_op = 'UPDATE'
     and new.revision_id is not distinct from old.revision_id
     and new.object_key  is not distinct from old.object_key
     and new.title       is not distinct from old.title
     and new.issuing_organization is not distinct from old.issuing_organization
     and new.issued_on   is not distinct from old.issued_on then
    new.updated_at := now();
    return new;
  end if;

  -- The credential set changed. Two consequences, and the second is the one that
  -- is easy to miss:
  --
  -- 1. the revision goes back to draft and must be resubmitted;
  -- 2. THIS CLAIM returns to `pending`.
  --
  -- Without (2), editing the title of a carried-forward APPROVED certificate
  -- would leave it approved -- so a teacher could have "Ijazah in Tajweed,
  -- Al-Azhar" approved and then retitle it to anything at all, and the new words
  -- would inherit the old decision. The approval was of a claim, not of a file.
  if tg_op = 'UPDATE' then
    new.state       := 'pending';
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.review_note := null;
  end if;

  update chat.teacher_profile_revision
     set state        = 'draft',
         submitted_at = null,
         reviewed_at  = null,
         reviewed_by  = null,
         approved_at  = null,
         review_note  = null,
         updated_at   = now()
   where id = v_revision
     and state <> 'draft';

  if tg_op = 'DELETE' then
    return old;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

comment on function chat.teacher_certificate_guard() is
  'Certificates on a closed revision are frozen. On an open one, a changed claim '
  'returns the revision to draft; a reviewer''s decision does not.';

drop trigger if exists teacher_certificate_guard_trg
  on chat.teacher_profile_certificate;
create trigger teacher_certificate_guard_trg
  before insert or update or delete on chat.teacher_profile_certificate
  for each row
  execute function chat.teacher_certificate_guard();

-- ---------------------------------------------------------------------------
-- 6. Row level security
-- ---------------------------------------------------------------------------

alter table chat.teacher_professional_profile enable row level security;
alter table chat.teacher_profile_revision     enable row level security;
alter table chat.teacher_profile_certificate  enable row level security;

create or replace function chat.teacher_profile_organization_id(p_profile uuid)
returns uuid
language sql
stable
security definer
set search_path = chat, pg_temp
as $$
  select organization_id from chat.teacher_professional_profile where id = p_profile
$$;

create or replace function chat.teacher_revision_organization_id(p_revision uuid)
returns uuid
language sql
stable
security definer
set search_path = chat, pg_temp
as $$
  select p.organization_id
    from chat.teacher_profile_revision r
    join chat.teacher_professional_profile p on p.id = r.profile_id
   where r.id = p_revision
$$;

-- The tenant boundary. RESTRICTIVE, so it intersects with every permissive
-- policy below rather than being an alternative to them.
drop policy if exists teacher_profile_organization_isolation
  on chat.teacher_professional_profile;
create policy teacher_profile_organization_isolation
  on chat.teacher_professional_profile
  as restrictive for all
  using (organization_id = chat.current_organization_id())
  with check (organization_id = chat.current_organization_id());

drop policy if exists teacher_revision_organization_isolation
  on chat.teacher_profile_revision;
create policy teacher_revision_organization_isolation
  on chat.teacher_profile_revision
  as restrictive for all
  using (chat.teacher_profile_organization_id(profile_id) = chat.current_organization_id())
  with check (chat.teacher_profile_organization_id(profile_id) = chat.current_organization_id());

drop policy if exists teacher_certificate_organization_isolation
  on chat.teacher_profile_certificate;
create policy teacher_certificate_organization_isolation
  on chat.teacher_profile_certificate
  as restrictive for all
  using (chat.teacher_revision_organization_id(revision_id) = chat.current_organization_id())
  with check (chat.teacher_revision_organization_id(revision_id) = chat.current_organization_id());

-- --- the container -----------------------------------------------------------

drop policy if exists teacher_profile_owner_all on chat.teacher_professional_profile;
create policy teacher_profile_owner_all on chat.teacher_professional_profile
  for all to authenticated
  using (teacher_id in (select chat.current_teacher_ids()))
  with check (teacher_id in (select chat.current_teacher_ids()));

drop policy if exists teacher_profile_reviewer_reads on chat.teacher_professional_profile;
create policy teacher_profile_reviewer_reads on chat.teacher_professional_profile
  for select to authenticated
  using (chat.current_can_review_teacher_profile());

drop policy if exists teacher_profile_reviewer_writes on chat.teacher_professional_profile;
create policy teacher_profile_reviewer_writes on chat.teacher_professional_profile
  for update to authenticated
  using (chat.current_can_review_teacher_profile())
  with check (chat.current_can_review_teacher_profile());

-- The container row itself carries no content, so everyone may see that a
-- teacher HAS a profile; what it says is gated on the revision below.
drop policy if exists teacher_profile_published_is_public on chat.teacher_professional_profile;
create policy teacher_profile_published_is_public on chat.teacher_professional_profile
  for select to authenticated
  using (published_revision_id is not null);

-- --- revisions ---------------------------------------------------------------

drop policy if exists teacher_revision_owner_all on chat.teacher_profile_revision;
create policy teacher_revision_owner_all on chat.teacher_profile_revision
  for all to authenticated
  using (exists (select 1 from chat.teacher_professional_profile p
                  where p.id = profile_id
                    and p.teacher_id in (select chat.current_teacher_ids())))
  with check (exists (select 1 from chat.teacher_professional_profile p
                       where p.id = profile_id
                         and p.teacher_id in (select chat.current_teacher_ids())));

drop policy if exists teacher_revision_reviewer_reads on chat.teacher_profile_revision;
create policy teacher_revision_reviewer_reads on chat.teacher_profile_revision
  for select to authenticated
  using (chat.current_can_review_teacher_profile());

drop policy if exists teacher_revision_reviewer_writes on chat.teacher_profile_revision;
create policy teacher_revision_reviewer_writes on chat.teacher_profile_revision
  for update to authenticated
  using (chat.current_can_review_teacher_profile())
  with check (chat.current_can_review_teacher_profile());

-- Everybody else sees EXACTLY the revision a profile points at. A pointer check,
-- not `state = 'approved'`: a superseded row is still historically approved, and
-- a state-based policy would publish every past version of every profile.
drop policy if exists teacher_revision_published_is_public on chat.teacher_profile_revision;
create policy teacher_revision_published_is_public on chat.teacher_profile_revision
  for select to authenticated
  using (exists (select 1 from chat.teacher_professional_profile p
                  where p.published_revision_id = teacher_profile_revision.id));

-- --- certificates ------------------------------------------------------------

drop policy if exists teacher_certificate_owner_all on chat.teacher_profile_certificate;
create policy teacher_certificate_owner_all on chat.teacher_profile_certificate
  for all to authenticated
  using (exists (select 1 from chat.teacher_profile_revision r
                   join chat.teacher_professional_profile p on p.id = r.profile_id
                  where r.id = revision_id
                    and p.teacher_id in (select chat.current_teacher_ids())))
  with check (exists (select 1 from chat.teacher_profile_revision r
                        join chat.teacher_professional_profile p on p.id = r.profile_id
                       where r.id = revision_id
                         and p.teacher_id in (select chat.current_teacher_ids())));

drop policy if exists teacher_certificate_reviewer_reads on chat.teacher_profile_certificate;
create policy teacher_certificate_reviewer_reads on chat.teacher_profile_certificate
  for select to authenticated
  using (chat.current_can_review_teacher_profile());

drop policy if exists teacher_certificate_reviewer_writes on chat.teacher_profile_certificate;
create policy teacher_certificate_reviewer_writes on chat.teacher_profile_certificate
  for update to authenticated
  using (chat.current_can_review_teacher_profile())
  with check (chat.current_can_review_teacher_profile());

-- Approved claim, on the published revision. Both halves required: a pending or
-- rejected credential is never a third party's business, and an approved claim
-- on a superseded revision is last year's profile.
drop policy if exists teacher_certificate_published_is_public
  on chat.teacher_profile_certificate;
create policy teacher_certificate_published_is_public
  on chat.teacher_profile_certificate
  for select to authenticated
  using (state = 'approved'
         and exists (select 1 from chat.teacher_professional_profile p
                      where p.published_revision_id = revision_id));

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
--
-- NOT `for all to chat_app using (true)`: that form reads as "let the
-- application through" and in practice cancels the policies above for the one
-- role that matters. chat_app gets table grants and remains subject to every
-- policy.

grant select on chat.teacher_professional_profile, chat.teacher_profile_revision,
                chat.teacher_profile_certificate to authenticated;
grant insert, update on chat.teacher_professional_profile to authenticated;
grant insert, update on chat.teacher_profile_revision to authenticated;
grant insert, update, delete on chat.teacher_profile_certificate to authenticated;

grant select, insert, update on
  chat.teacher_professional_profile, chat.teacher_profile_revision to chat_app;
grant select, insert, update, delete on chat.teacher_profile_certificate to chat_app;

grant execute on function chat.current_teacher_ids() to authenticated, service_role;
grant execute on function chat.current_can_review_teacher_profile()
  to authenticated, service_role;
grant execute on function chat.teacher_profile_organization_id(uuid)
  to authenticated, service_role;
grant execute on function chat.teacher_revision_organization_id(uuid)
  to authenticated, service_role;
