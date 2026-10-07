-- Jawwid Chat -- executable RLS, lifecycle and revision tests for the teacher
-- professional profile.
--
-- These run against a real database built by the migration chain, as the
-- `authenticated` role, with the actor assumed through `chat.actor_subject` --
-- the same mechanism story_rls.sql uses. The application is entirely out of the
-- picture, which is the threat model the policies exist for.
--
-- The assertion this whole feature turns on is V3: A PARENT STILL SEES THE LAST
-- APPROVED REVISION WHILE THE NEXT ONE IS UNDER REVIEW. If that ever fails, the
-- published/draft split has stopped working and families are seeing editing
-- activity.
--
--   psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f db/tests/teacher_profile_rls.sql
--
-- Exit code 0 and 'ALL TEACHER PROFILE TESTS PASSED' is the pass condition.
-- Do not weaken an assertion here to make a change pass.

\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.want_ok(label text, ok boolean)
returns void language plpgsql as $$
begin
  if ok then
    raise notice 'PASS  %', label;
  else
    raise exception 'FAIL  %', label;
  end if;
end;
$$;

create or replace function pg_temp.affected(stmt text)
returns integer language plpgsql as $$
declare n integer;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- True only when the statement was rejected. The pointer guard is a DEFERRABLE
-- constraint trigger, so it fires at COMMIT -- which never happens inside a
-- plpgsql subtransaction. Forcing the pending checks evaluates it here and now;
-- the setting is restored so later tests can still build a profile and its
-- revision in either order.
create or replace function pg_temp.refused(stmt text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  set constraints all immediate;
  set constraints all deferred;
  return false;
exception when others then
  set constraints all deferred;
  return true;
end;
$$;

begin;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into chat.account (id, subject, kind) values
  ('aa000000-0000-0000-0000-0000000000a1', 'tp-teacher-a', 'teacher'),
  ('aa000000-0000-0000-0000-0000000000a2', 'tp-teacher-b', 'teacher'),
  ('aa000000-0000-0000-0000-0000000000a3', 'tp-admin',     'staff'),
  ('aa000000-0000-0000-0000-0000000000a4', 'tp-parent',    'family');

insert into chat.teacher (id, account_id, name) values
  ('bb000000-0000-0000-0000-0000000000b1', 'aa000000-0000-0000-0000-0000000000a1', 'TP Teacher A'),
  ('bb000000-0000-0000-0000-0000000000b2', 'aa000000-0000-0000-0000-0000000000a2', 'TP Teacher B');

insert into chat.staff (id, account_id, name, role) values
  ('cc000000-0000-0000-0000-0000000000c1', 'aa000000-0000-0000-0000-0000000000a3', 'TP Reviewer', 'admin');

insert into chat.family (id, display_name, owner_id) values
  ('dd000000-0000-0000-0000-0000000000d1', 'TP Family', 'cc000000-0000-0000-0000-0000000000c1');
insert into chat.contact (id, family_id, account_id, name, role_preset, can_message) values
  ('ee000000-0000-0000-0000-0000000000e1', 'dd000000-0000-0000-0000-0000000000d1',
   'aa000000-0000-0000-0000-0000000000a4', 'TP Parent', 'primary_guardian', true);

-- Profile A, built the way the application builds one: R1 is drafted, given a
-- credential, reviewed and approved; then R2 is opened by copy-on-write. Seeding
-- a terminal state directly would skip the very guards under test.
insert into chat.teacher_professional_profile (id, teacher_id) values
  ('f0000000-0000-0000-0000-0000000000f1', 'bb000000-0000-0000-0000-0000000000b1');

insert into chat.teacher_profile_revision
  (id, profile_id, revision_number, bio, specialization, state)
values
  ('a1000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-0000000000f1', 1,
   'PUBLISHED BIO', 'Tajweed', 'draft');

insert into chat.teacher_profile_certificate
  (id, revision_id, title, object_key, mime_type, byte_size)
values
  ('c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001',
   'Published ijazah', 'teacher-certs/a/ijazah.pdf', 'application/pdf', 1000);

update chat.teacher_profile_certificate
   set state = 'approved', reviewed_at = now(),
       reviewed_by = 'cc000000-0000-0000-0000-0000000000c1'
 where id = 'c1000000-0000-0000-0000-000000000001';

update chat.teacher_profile_revision
   set state = 'pending_review', submitted_at = now()
 where id = 'a1000000-0000-0000-0000-000000000001';
update chat.teacher_profile_revision
   set state = 'approved', approved_at = now(), reviewed_at = now(),
       reviewed_by = 'cc000000-0000-0000-0000-0000000000c1'
 where id = 'a1000000-0000-0000-0000-000000000001';

-- Copy-on-write: R2 cites the SAME object as R1 and carries its approval.
insert into chat.teacher_profile_revision
  (id, profile_id, revision_number, bio, specialization, state)
values
  ('a1000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-0000000000f1', 2,
   'DRAFT BIO -- must never reach a parent', 'Tajweed', 'draft');

insert into chat.teacher_profile_certificate
  (id, revision_id, title, object_key, mime_type, byte_size)
values
  ('c1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002',
   'Published ijazah', 'teacher-certs/a/ijazah.pdf', 'application/pdf', 1000);
update chat.teacher_profile_certificate
   set state = 'approved', reviewed_at = now(),
       reviewed_by = 'cc000000-0000-0000-0000-0000000000c1'
 where id = 'c1000000-0000-0000-0000-000000000002';

update chat.teacher_profile_revision
   set state = 'pending_review', submitted_at = now()
 where id = 'a1000000-0000-0000-0000-000000000002';

update chat.teacher_professional_profile
   set published_revision_id = 'a1000000-0000-0000-0000-000000000001',
       draft_revision_id     = 'a1000000-0000-0000-0000-000000000002'
 where id = 'f0000000-0000-0000-0000-0000000000f1';

-- Profile B: a first draft, never approved. Parents must see nothing at all.
insert into chat.teacher_professional_profile (id, teacher_id) values
  ('f0000000-0000-0000-0000-0000000000f2', 'bb000000-0000-0000-0000-0000000000b2');
insert into chat.teacher_profile_revision
  (id, profile_id, revision_number, bio, state)
values
  ('a2000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-0000000000f2', 1,
   'B never approved', 'draft');
update chat.teacher_professional_profile
   set draft_revision_id = 'a2000000-0000-0000-0000-000000000001'
 where id = 'f0000000-0000-0000-0000-0000000000f2';

set constraints all immediate;
set constraints all deferred;

-- ---------------------------------------------------------------------------
-- V. THE VERSIONING GUARANTEE
-- ---------------------------------------------------------------------------

set local role authenticated;
set local chat.actor_subject = 'tp-parent';

select pg_temp.want_ok(
  'V1  a parent sees the PUBLISHED revision',
  (select count(*) = 1 from chat.teacher_profile_revision
    where id = 'a1000000-0000-0000-0000-000000000001'));

select pg_temp.want_ok(
  'V2  a parent CANNOT see the draft revision under review',
  (select count(*) = 0 from chat.teacher_profile_revision
    where id = 'a1000000-0000-0000-0000-000000000002'));

select pg_temp.want_ok(
  'V3  *** the parent-visible bio is the PUBLISHED one, while R2 is pending ***',
  (select r.bio = 'PUBLISHED BIO'
     from chat.teacher_professional_profile p
     join chat.teacher_profile_revision r on r.id = p.published_revision_id
    where p.teacher_id = 'bb000000-0000-0000-0000-0000000000b1'));

select pg_temp.want_ok(
  'V4  a never-approved profile shows a parent nothing',
  (select count(*) = 0
     from chat.teacher_professional_profile p
     join chat.teacher_profile_revision r on r.id = p.published_revision_id
    where p.teacher_id = 'bb000000-0000-0000-0000-0000000000b2'));

select pg_temp.want_ok(
  'V5  a parent sees the approved certificate ON the published revision only',
  (select count(*) = 1 from chat.teacher_profile_certificate)
  );

select pg_temp.want_ok(
  'V6  that certificate is R1''s, not R2''s copy',
  (select count(*) = 1 from chat.teacher_profile_certificate
    where id = 'c1000000-0000-0000-0000-000000000001'));

-- ---------------------------------------------------------------------------
-- I. IMMUTABILITY OF AN APPROVED REVISION
-- ---------------------------------------------------------------------------

set local chat.actor_subject = 'tp-teacher-a';

select pg_temp.want_ok(
  'I1  the OWNING teacher cannot edit her own approved revision',
  pg_temp.refused($$update chat.teacher_profile_revision
                       set bio = 'sneaky edit'
                     where id = 'a1000000-0000-0000-0000-000000000001'$$));

select pg_temp.want_ok(
  'I2  the published bio is unchanged',
  (select bio = 'PUBLISHED BIO' from chat.teacher_profile_revision
    where id = 'a1000000-0000-0000-0000-000000000001'));

select pg_temp.want_ok(
  'I3  a certificate on an approved revision cannot be deleted',
  pg_temp.refused($$delete from chat.teacher_profile_certificate
                     where id = 'c1000000-0000-0000-0000-000000000001'$$));

set local chat.actor_subject = 'tp-admin';

select pg_temp.want_ok(
  'I4  a REVIEWER cannot edit an approved revision either',
  pg_temp.refused($$update chat.teacher_profile_revision
                       set bio = 'reviewer rewrote history'
                     where id = 'a1000000-0000-0000-0000-000000000001'$$));

-- ---------------------------------------------------------------------------
-- T. TEACHER ISOLATION
-- ---------------------------------------------------------------------------

set local chat.actor_subject = 'tp-teacher-a';

select pg_temp.want_ok(
  'T1  teacher A reads her own OPEN revision',
  (select count(*) = 1 from chat.teacher_profile_revision
    where id = 'a1000000-0000-0000-0000-000000000002'));

select pg_temp.want_ok(
  'T2  teacher A CANNOT read teacher B''s unapproved revision',
  (select count(*) = 0 from chat.teacher_profile_revision
    where id = 'a2000000-0000-0000-0000-000000000001'));

select pg_temp.want_ok(
  'T3  teacher A CANNOT update teacher B''s revision',
  pg_temp.affected($$update chat.teacher_profile_revision
                        set bio = 'hijacked'
                      where id = 'a2000000-0000-0000-0000-000000000001'$$) = 0);

select pg_temp.want_ok(
  'T4  teacher A CANNOT approve her own open revision',
  pg_temp.refused($$update chat.teacher_profile_revision
                       set state = 'approved', approved_at = now(),
                           reviewed_at = now(),
                           reviewed_by = 'cc000000-0000-0000-0000-0000000000c1'
                     where id = 'a1000000-0000-0000-0000-000000000002'$$));

select pg_temp.want_ok(
  'T5  a material edit returns the open revision to draft',
  pg_temp.affected($$update chat.teacher_profile_revision
                        set bio = 'revised again'
                      where id = 'a1000000-0000-0000-0000-000000000002'$$) = 1);

select pg_temp.want_ok(
  'T6  ... and the parent STILL sees the published bio',
  (select r.bio = 'PUBLISHED BIO'
     from chat.teacher_professional_profile p
     join chat.teacher_profile_revision r on r.id = p.published_revision_id
    where p.teacher_id = 'bb000000-0000-0000-0000-0000000000b1'));

-- ---------------------------------------------------------------------------
-- G. THE APPROVAL GATE
-- ---------------------------------------------------------------------------

set local chat.actor_subject = 'tp-admin';

-- The TEACHER attaches a credential and resubmits. A reviewer has no INSERT
-- policy on certificates at all -- uploading one is not a reviewer's action --
-- so doing this as the admin is both wrong and refused.
select pg_temp.want_ok(
  'G0  a REVIEWER cannot attach a certificate to a teacher''s revision',
  pg_temp.refused($$insert into chat.teacher_profile_certificate
                      (revision_id, title, object_key, mime_type, byte_size)
                    values ('a1000000-0000-0000-0000-000000000002',
                            'Planted by staff', 'teacher-certs/a/planted.pdf',
                            'application/pdf', 100)$$));

set local chat.actor_subject = 'tp-teacher-a';

insert into chat.teacher_profile_certificate
  (id, revision_id, title, object_key, mime_type, byte_size)
values
  ('c1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000002',
   'Brand new, unread', 'teacher-certs/a/new.pdf', 'application/pdf', 2000);

update chat.teacher_profile_revision
   set state = 'pending_review', submitted_at = now()
 where id = 'a1000000-0000-0000-0000-000000000002';

select pg_temp.want_ok(
  'G0b a teacher cannot decide her OWN certificate',
  pg_temp.refused($$update chat.teacher_profile_certificate
                       set state = 'approved', reviewed_at = now(),
                           reviewed_by = 'cc000000-0000-0000-0000-0000000000c1'
                     where id = 'c1000000-0000-0000-0000-000000000003'$$));

set local chat.actor_subject = 'tp-admin';

select pg_temp.want_ok(
  'G1  a revision with a PENDING certificate cannot be approved',
  pg_temp.refused($$update chat.teacher_profile_revision
                       set state = 'approved', approved_at = now(),
                           reviewed_at = now(),
                           reviewed_by = 'cc000000-0000-0000-0000-0000000000c1'
                     where id = 'a1000000-0000-0000-0000-000000000002'$$));

update chat.teacher_profile_certificate
   set state = 'rejected', reviewed_at = now(),
       reviewed_by = 'cc000000-0000-0000-0000-0000000000c1',
       review_note = 'Unreadable scan.'
 where id = 'c1000000-0000-0000-0000-000000000003';

-- Deciding a certificate is not a material change, so the revision is still
-- submitted and can now be approved.
select pg_temp.want_ok(
  'G2  once every certificate is decided, approval succeeds',
  pg_temp.affected($$update chat.teacher_profile_revision
                        set state = 'approved', approved_at = now(),
                            reviewed_at = now(),
                            reviewed_by = 'cc000000-0000-0000-0000-0000000000c1'
                      where id = 'a1000000-0000-0000-0000-000000000002'$$) = 1);

-- ---------------------------------------------------------------------------
-- E. PROMOTION
-- ---------------------------------------------------------------------------

update chat.teacher_profile_revision
   set state = 'superseded'
 where id = 'a1000000-0000-0000-0000-000000000001';

update chat.teacher_professional_profile
   set published_revision_id = 'a1000000-0000-0000-0000-000000000002',
       draft_revision_id     = null
 where id = 'f0000000-0000-0000-0000-0000000000f1';

set constraints all immediate;
set constraints all deferred;

set local chat.actor_subject = 'tp-parent';

select pg_temp.want_ok(
  'E1  after promotion the parent sees the NEW revision''s bio',
  (select r.bio = 'revised again'
     from chat.teacher_professional_profile p
     join chat.teacher_profile_revision r on r.id = p.published_revision_id
    where p.teacher_id = 'bb000000-0000-0000-0000-0000000000b1'));

select pg_temp.want_ok(
  'E2  the SUPERSEDED revision is invisible to a parent',
  (select count(*) = 0 from chat.teacher_profile_revision
    where id = 'a1000000-0000-0000-0000-000000000001'));

select pg_temp.want_ok(
  'E3  the REJECTED certificate never becomes parent-visible',
  (select count(*) = 0 from chat.teacher_profile_certificate
    where id = 'c1000000-0000-0000-0000-000000000003'));

select pg_temp.want_ok(
  'E4  the carried-forward approved certificate IS parent-visible',
  (select count(*) = 1 from chat.teacher_profile_certificate
    where id = 'c1000000-0000-0000-0000-000000000002'));

-- ---------------------------------------------------------------------------
-- P. THE POINTER GUARD
-- ---------------------------------------------------------------------------

set local chat.actor_subject = 'tp-admin';

select pg_temp.want_ok(
  'P1  a DRAFT revision cannot be published by pointer',
  pg_temp.refused($$update chat.teacher_professional_profile
                       set published_revision_id = 'a2000000-0000-0000-0000-000000000001'
                     where id = 'f0000000-0000-0000-0000-0000000000f2'$$));

select pg_temp.want_ok(
  'P2  a profile cannot publish ANOTHER profile''s revision',
  pg_temp.refused($$update chat.teacher_professional_profile
                       set published_revision_id = 'a1000000-0000-0000-0000-000000000002'
                     where id = 'f0000000-0000-0000-0000-0000000000f2'$$));

rollback;

\echo ''
\echo 'ALL TEACHER PROFILE TESTS PASSED'
