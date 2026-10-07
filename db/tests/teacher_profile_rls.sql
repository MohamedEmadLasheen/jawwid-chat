-- Jawwid Chat -- executable RLS and lifecycle tests for the teacher
-- professional profile (V2).
--
-- These run against a real database built by the migration chain, as the
-- `authenticated` role, with the actor assumed through `chat.actor_subject` --
-- the same mechanism story_rls.sql uses. The application is entirely out of the
-- picture, which is the threat model the policies exist for.
--
-- WHAT V2 CHANGED. V1's keystone was "a parent still sees the last APPROVED
-- revision while the next one is under review" -- the published/draft split.
-- V2 deletes the split: the teacher saves and the save is the profile. So the
-- keystone here is now its opposite:
--
--   P3: WHAT A SAVE WROTE IS IMMEDIATELY WHAT A THIRD PARTY READS.
--
-- The credential assertions did NOT change, because they were never about
-- revisions: C3 (a teacher cannot decide their own) and C4 (editing a claim
-- drops the decision) are the two that keep "approved" meaning anything.
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

-- True only when the statement was rejected.
create or replace function pg_temp.refused(stmt text)
returns boolean language plpgsql as $$
begin
  execute stmt;
  return false;
exception when others then
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

-- Profile A: content and a credential, built the way the application builds one
-- -- the credential is INSERTed pending and then decided, because seeding a
-- terminal state directly would skip the very guard under test.
insert into chat.teacher_professional_profile
  (id, teacher_id, bio, specialization, qualifications, languages,
   photo_object_key, photo_mime_type, photo_byte_size, photo_updated_at)
values
  ('f0000000-0000-0000-0000-0000000000f1', 'bb000000-0000-0000-0000-0000000000b1',
   'SAVED BIO', 'Tajweed', 'Ijazah', array['Arabic','English'],
   'teacher-photos/bb000000-0000-0000-0000-0000000000b1/p.jpg', 'image/jpeg', 2048, now());

insert into chat.teacher_profile_certificate
  (id, profile_id, title, object_key, mime_type, byte_size)
values
  ('c1000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-0000000000f1',
   'Approved ijazah', 'teacher-certificates/a/ijazah.pdf', 'application/pdf', 1000),
  ('c1000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-0000000000f1',
   'Pending ijazah', 'teacher-certificates/a/pending.pdf', 'application/pdf', 1000);

update chat.teacher_profile_certificate
   set state = 'approved', reviewed_at = now(),
       reviewed_by = 'cc000000-0000-0000-0000-0000000000c1'
 where id = 'c1000000-0000-0000-0000-000000000001';

-- Profile B: another teacher, for every cross-tenant assertion.
insert into chat.teacher_professional_profile (id, teacher_id, bio) values
  ('f0000000-0000-0000-0000-0000000000f2', 'bb000000-0000-0000-0000-0000000000b2',
   'B SAVED BIO');

-- ---------------------------------------------------------------------------
-- P. THE PUBLISH GUARANTEE (V2's keystone)
-- ---------------------------------------------------------------------------

set local role authenticated;
set local chat.actor_subject = 'tp-parent';

select pg_temp.want_ok(
  'P1  a parent sees a teacher''s saved profile',
  (select count(*) = 1 from chat.teacher_professional_profile
    where id = 'f0000000-0000-0000-0000-0000000000f1'));

select pg_temp.want_ok(
  'P2  there is no second version of it anywhere',
  (select count(*) = 0 from information_schema.tables
    where table_schema = 'chat' and table_name = 'teacher_profile_revision'));

select pg_temp.want_ok(
  'P3  *** what a save wrote is immediately what a third party reads ***',
  (select p.bio = 'SAVED BIO'
     from chat.teacher_professional_profile p
    where p.teacher_id = 'bb000000-0000-0000-0000-0000000000b1'));

select pg_temp.want_ok(
  'P4  no draft or review state survives on the profile',
  (select count(*) = 0 from information_schema.columns
    where table_schema = 'chat' and table_name = 'teacher_professional_profile'
      and column_name in ('state', 'published_revision_id', 'draft_revision_id',
                          'submitted_at', 'approved_at', 'review_note')));

select pg_temp.want_ok(
  'P5  a parent CANNOT write a teacher''s profile',
  pg_temp.refused($$update chat.teacher_professional_profile
                       set bio = 'parent wrote this'
                     where id = 'f0000000-0000-0000-0000-0000000000f1'$$)
  or (select bio = 'SAVED BIO' from chat.teacher_professional_profile
       where id = 'f0000000-0000-0000-0000-0000000000f1'));

-- ---------------------------------------------------------------------------
-- N. THE NAME IS NOT HERE
-- ---------------------------------------------------------------------------

select pg_temp.want_ok(
  'N1  no profile table carries a name column',
  (select count(*) = 0 from information_schema.columns
    where table_schema = 'chat' and table_name like 'teacher_prof%'
      and column_name like '%name%'));

select pg_temp.want_ok(
  'N2  chat.teacher.name is still the only teacher name in the schema',
  (select count(*) = 1 from information_schema.columns c
     join information_schema.tables t
       on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'chat' and c.column_name = 'name'
      and t.table_type = 'BASE TABLE' and c.table_name = 'teacher'));

-- ---------------------------------------------------------------------------
-- O. OWNERSHIP
-- ---------------------------------------------------------------------------

set local chat.actor_subject = 'tp-teacher-a';

select pg_temp.want_ok(
  'O1  a teacher may edit their own profile',
  pg_temp.affected($$update chat.teacher_professional_profile
                        set bio = 'SAVED BIO'
                      where teacher_id = 'bb000000-0000-0000-0000-0000000000b1'$$) = 1);

select pg_temp.want_ok(
  'O2  *** teacher A CANNOT edit teacher B''s profile ***',
  pg_temp.affected($$update chat.teacher_professional_profile
                        set bio = 'A wrote into B'
                      where teacher_id = 'bb000000-0000-0000-0000-0000000000b2'$$) = 0);

select pg_temp.want_ok(
  'O3  teacher A CANNOT remove teacher B''s photo',
  pg_temp.affected($$update chat.teacher_professional_profile
                        set photo_object_key = null, photo_mime_type = null,
                            photo_byte_size = null, photo_updated_at = null
                      where teacher_id = 'bb000000-0000-0000-0000-0000000000b2'$$) = 0);

select pg_temp.want_ok(
  'O4  teacher A CANNOT attach a credential to teacher B''s profile',
  pg_temp.refused($$insert into chat.teacher_profile_certificate
                      (profile_id, title, object_key, mime_type, byte_size)
                    values ('f0000000-0000-0000-0000-0000000000f2', 'planted',
                            'teacher-certificates/a/planted.pdf', 'application/pdf', 10)$$));

select pg_temp.want_ok(
  'O5  teacher A CANNOT delete teacher B''s credential',
  pg_temp.affected($$delete from chat.teacher_profile_certificate
                      where profile_id = 'f0000000-0000-0000-0000-0000000000f2'$$) = 0);

-- ---------------------------------------------------------------------------
-- H. THE PHOTO
-- ---------------------------------------------------------------------------

select pg_temp.want_ok(
  'H1  a photo must be complete or absent, never half-set',
  pg_temp.refused($$update chat.teacher_professional_profile
                       set photo_object_key = 'x', photo_mime_type = null,
                           photo_byte_size = null, photo_updated_at = null
                     where teacher_id = 'bb000000-0000-0000-0000-0000000000b1'$$));

select pg_temp.want_ok(
  'H2  a photo type that cannot be displayed is refused',
  pg_temp.refused($$update chat.teacher_professional_profile
                       set photo_mime_type = 'image/svg+xml'
                     where teacher_id = 'bb000000-0000-0000-0000-0000000000b1'$$));

select pg_temp.want_ok(
  'H3  a photo over 5MB is refused',
  pg_temp.refused($$update chat.teacher_professional_profile
                       set photo_byte_size = 5242881
                     where teacher_id = 'bb000000-0000-0000-0000-0000000000b1'$$));

select pg_temp.want_ok(
  'H4  clearing all four photo columns together is allowed',
  pg_temp.affected($$update chat.teacher_professional_profile
                        set photo_object_key = null, photo_mime_type = null,
                            photo_byte_size = null, photo_updated_at = null
                      where teacher_id = 'bb000000-0000-0000-0000-0000000000b1'$$) = 1);

-- ---------------------------------------------------------------------------
-- L. CONTENT LIMITS
-- ---------------------------------------------------------------------------

select pg_temp.want_ok(
  'L1  a bio over 2000 characters is refused',
  pg_temp.refused($$update chat.teacher_professional_profile
                       set bio = repeat('x', 2001)
                     where teacher_id = 'bb000000-0000-0000-0000-0000000000b1'$$));

select pg_temp.want_ok(
  'L2  a specialization over 200 characters is refused',
  pg_temp.refused($$update chat.teacher_professional_profile
                       set specialization = repeat('x', 201)
                     where teacher_id = 'bb000000-0000-0000-0000-0000000000b1'$$));

select pg_temp.want_ok(
  'L3  more than 10 languages is refused',
  pg_temp.refused($$update chat.teacher_professional_profile
                       set languages = array['1','2','3','4','5','6','7','8','9','10','11']
                     where teacher_id = 'bb000000-0000-0000-0000-0000000000b1'$$));

-- ---------------------------------------------------------------------------
-- C. CREDENTIALS -- unchanged by immediate save, and this is why
-- ---------------------------------------------------------------------------

select pg_temp.want_ok(
  'C1  a new credential starts pending, whatever the client asked for',
  (select state = 'pending' from chat.teacher_profile_certificate
    where id = 'c1000000-0000-0000-0000-000000000002'));

select pg_temp.want_ok(
  'C2  a teacher may attach their own credential',
  pg_temp.affected($$insert into chat.teacher_profile_certificate
                       (profile_id, title, object_key, mime_type, byte_size)
                     values ('f0000000-0000-0000-0000-0000000000f1', 'another',
                             'teacher-certificates/a/another.pdf', 'application/pdf', 10)$$) = 1);

select pg_temp.want_ok(
  'C3  *** a teacher CANNOT approve their own credential ***',
  pg_temp.refused($$update chat.teacher_profile_certificate
                       set state = 'approved', reviewed_at = now(),
                           reviewed_by = 'cc000000-0000-0000-0000-0000000000c1'
                     where id = 'c1000000-0000-0000-0000-000000000002'$$));

select pg_temp.want_ok(
  'C3b a teacher CANNOT reject their own credential either',
  pg_temp.refused($$update chat.teacher_profile_certificate
                       set state = 'rejected', reviewed_at = now(), review_note = 'self',
                           reviewed_by = 'cc000000-0000-0000-0000-0000000000c1'
                     where id = 'c1000000-0000-0000-0000-000000000002'$$));

-- The retitle is its OWN statement. Folding it into the assertion's FROM clause
-- reads the row under the outer query's snapshot, which was taken before the
-- function ran -- so the test would report the old state and fail a working
-- guard. (It did, once.)
update chat.teacher_profile_certificate
   set title = 'Anything At All'
 where id = 'c1000000-0000-0000-0000-000000000001';

select pg_temp.want_ok(
  'C4  *** retitling an APPROVED credential returns it to pending ***',
  (select state = 'pending' from chat.teacher_profile_certificate
    where id = 'c1000000-0000-0000-0000-000000000001'));

select pg_temp.want_ok(
  'C4b and it forgets who decided the old claim',
  (select reviewed_by is null and reviewed_at is null and review_note is null
     from chat.teacher_profile_certificate
    where id = 'c1000000-0000-0000-0000-000000000001'));

select pg_temp.want_ok(
  'C5  an unsupported credential type is refused',
  pg_temp.refused($$insert into chat.teacher_profile_certificate
                      (profile_id, title, object_key, mime_type, byte_size)
                    values ('f0000000-0000-0000-0000-0000000000f1', 'html',
                            'teacher-certificates/a/x.html', 'text/html', 10)$$));

select pg_temp.want_ok(
  'C6  a credential over 10MB is refused',
  pg_temp.refused($$insert into chat.teacher_profile_certificate
                      (profile_id, title, object_key, mime_type, byte_size)
                    values ('f0000000-0000-0000-0000-0000000000f1', 'huge',
                            'teacher-certificates/a/huge.pdf', 'application/pdf', 10485761)$$));

select pg_temp.want_ok(
  'C7  the same object cannot be claimed twice on one profile',
  pg_temp.refused($$insert into chat.teacher_profile_certificate
                      (profile_id, title, object_key, mime_type, byte_size)
                    values ('f0000000-0000-0000-0000-0000000000f1', 'duplicate',
                            'teacher-certificates/a/pending.pdf', 'application/pdf', 10)$$));

select pg_temp.want_ok(
  'C8  a credential cannot be titled with whitespace',
  pg_temp.refused($$insert into chat.teacher_profile_certificate
                      (profile_id, title, object_key, mime_type, byte_size)
                    values ('f0000000-0000-0000-0000-0000000000f1', '   ',
                            'teacher-certificates/a/blank.pdf', 'application/pdf', 10)$$));

-- ---------------------------------------------------------------------------
-- R. THE REVIEWER
-- ---------------------------------------------------------------------------

set local chat.actor_subject = 'tp-admin';

-- Scoped to the fixtures, not a count of the whole table: this file runs
-- against a shared verification database that other suites leave rows in, and
-- `count(*) = 2` would fail for a reason that has nothing to do with RLS.
select pg_temp.want_ok(
  'R1  a reviewer reads both fixture profiles, including one they do not own',
  (select count(*) = 2 from chat.teacher_professional_profile
    where id in ('f0000000-0000-0000-0000-0000000000f1',
                 'f0000000-0000-0000-0000-0000000000f2')));

select pg_temp.want_ok(
  'R2  a reviewer reads a PENDING credential -- that is the job',
  (select count(*) = 1 from chat.teacher_profile_certificate
    where id = 'c1000000-0000-0000-0000-000000000002'));

select pg_temp.want_ok(
  'R3  a reviewer may decide a credential they do not own',
  pg_temp.affected($$update chat.teacher_profile_certificate
                        set state = 'approved', reviewed_at = now(),
                            reviewed_by = 'cc000000-0000-0000-0000-0000000000c1'
                      where id = 'c1000000-0000-0000-0000-000000000002'$$) = 1);

select pg_temp.want_ok(
  'R4  *** a reviewer CANNOT edit profile CONTENT -- there is nothing to approve ***',
  pg_temp.affected($$update chat.teacher_professional_profile
                        set bio = 'reviewer rewrote this'
                      where id = 'f0000000-0000-0000-0000-0000000000f1'$$) = 0);

select pg_temp.want_ok(
  'R5  a reviewer CANNOT delete a credential',
  pg_temp.affected($$delete from chat.teacher_profile_certificate
                      where id = 'c1000000-0000-0000-0000-000000000002'$$) = 0);

-- ---------------------------------------------------------------------------
-- T. THE THIRD PARTY
-- ---------------------------------------------------------------------------

set local chat.actor_subject = 'tp-parent';

select pg_temp.want_ok(
  'T1  a parent sees an APPROVED credential',
  (select count(*) = 1 from chat.teacher_profile_certificate
    where id = 'c1000000-0000-0000-0000-000000000002'));

select pg_temp.want_ok(
  'T2  *** a parent CANNOT see a PENDING credential ***',
  (select count(*) = 0 from chat.teacher_profile_certificate
    where id = 'c1000000-0000-0000-0000-000000000001'));

select pg_temp.want_ok(
  'T3  a parent CANNOT decide a credential',
  pg_temp.affected($$update chat.teacher_profile_certificate
                        set state = 'approved', reviewed_at = now(),
                            reviewed_by = 'cc000000-0000-0000-0000-0000000000c1'
                      where id = 'c1000000-0000-0000-0000-000000000001'$$) = 0);

select pg_temp.want_ok(
  'T4  a parent CANNOT delete a credential',
  pg_temp.affected($$delete from chat.teacher_profile_certificate
                      where id = 'c1000000-0000-0000-0000-000000000002'$$) = 0);

rollback;

\echo 'ALL TEACHER PROFILE TESTS PASSED'
