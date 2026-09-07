-- Jawwid Chat -- Phase 3: permissions, runtime privileges and write policies.
--
-- Canonical design: docs/architecture/AUTHORIZATION-MODEL.md,
-- docs/recovery/PHASE-3-REPORT.md.
--
-- This migration runs LAST in the Phase 3 series because it grants privileges
-- on the tables 130100 and 130200 create. It introduces no table of its own.
--
-- THREE THINGS HAPPEN HERE
--   1. Six new permission keys become data, with their default role mapping.
--   2. chat_app -- the least-privileged role the API actually connects as --
--      gains exactly the DML Phase 3 performs, and no more.
--   3. Two pre-existing write policies are corrected. They have been dead
--      letters since Phase 1 and become live the moment (2) lands, so they
--      cannot be left as they are.

-- ---------------------------------------------------------------------------
-- 1. The permission vocabulary
-- ---------------------------------------------------------------------------
--
-- Verified against chat.permission before being written: none of these six keys
-- already existed, and none duplicates an existing capability. In particular
-- `families.assign` (supervisor assignment, manager-only) is REUSED rather than
-- re-invented -- creating a family names its supervisor, so it is that act.

insert into chat.permission (key, description) values
('families.manage',        'Create and edit family profiles, run family and student lifecycle, attach labels to families'),
('learners.assign_teacher','Assign or transfer the teacher of a student'),
('groups.read',            'List and read groups within scope'),
('groups.manage',          'Create and edit groups, manage members and teachers, close, archive and replace'),
('labels.read',            'List and read the label vocabulary'),
('labels.manage',          'Create, rename and delete labels themselves')
on conflict (key) do update set description = excluded.description;

-- The default mapping. `on conflict do nothing` because 20260907100100 rebuilds
-- this table wholesale and this migration must be re-runnable after it.
--
-- WHY labels.manage IS NARROWER THAN labels.read
--   A label is shared vocabulary. An admin files THEIR families under an
--   existing label all day (that is families.manage, narrowed by scope), but
--   renaming or deleting a label changes what every other supervisor sees, so
--   curating the vocabulary is a manager's act.
--
-- WHY teacher HOLDS groups.read AND NOTHING ELSE
--   A teacher must see the groups they teach. They may not create one, may not
--   change a roster, and the roster policy in 130100 narrows what they see to
--   their own groups.
insert into chat.role_permission (role, permission)
select r.role, r.permission
from (values
  ('admin', 'families.manage'), ('admin', 'learners.assign_teacher'),
  ('admin', 'groups.read'), ('admin', 'groups.manage'),
  ('admin', 'labels.read'),

  ('coverage_admin', 'families.manage'), ('coverage_admin', 'learners.assign_teacher'),
  ('coverage_admin', 'groups.read'), ('coverage_admin', 'groups.manage'),
  ('coverage_admin', 'labels.read'),

  ('manager', 'families.manage'), ('manager', 'learners.assign_teacher'),
  ('manager', 'groups.read'), ('manager', 'groups.manage'),
  ('manager', 'labels.read'), ('manager', 'labels.manage'),

  ('super_admin', 'families.manage'), ('super_admin', 'learners.assign_teacher'),
  ('super_admin', 'groups.read'), ('super_admin', 'groups.manage'),
  ('super_admin', 'labels.read'), ('super_admin', 'labels.manage'),

  ('teacher', 'groups.read')
) as r(role, permission)
on conflict (role, permission) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Runtime privileges for chat_app
-- ---------------------------------------------------------------------------
--
-- 20260907120000 grants chat_app privileges on an EXPLICIT list, so a table
-- added later is unreachable until a migration says otherwise. This is that
-- migration for the Phase 3 tables.
--
-- NOTE WHAT IS NOT GRANTED, ON PURPOSE:
--
--   * NO DELETE on chat.family, chat.learner, chat.group, chat.group_member,
--     chat.group_teacher or chat.family_assignment. Phase 3 never hard-deletes
--     a family, a student, a group or any historical relationship -- it
--     deactivates, archives and stamps. Withholding DELETE makes that a
--     PROPERTY OF THE ROLE rather than a convention the service layer is
--     trusted to keep: a bug that tried to delete history fails at the
--     database, as a privilege error, instead of succeeding quietly.
--
--   * NO DELETE on chat.label either -- deletion is soft (an UPDATE).
--
--   * DELETE on chat.family_label ONLY. Removing a family from a label is a
--     genuine un-filing, not history: the association carries no timeline and
--     re-adding it is idempotent, so a row is the right granularity to remove.

grant insert, update on chat.family  to chat_app;
grant insert, update on chat.learner to chat_app;

grant select, insert, update on
  chat.learner_teacher_assignment,
  chat.group, chat.group_member, chat.group_teacher,
  chat.label
  to chat_app;

grant select, insert, update, delete on chat.family_label to chat_app;

-- ---------------------------------------------------------------------------
-- 3. Write policies for the Phase 3 tables
-- ---------------------------------------------------------------------------
--
-- The second layer, mirroring the service rule. Each asks the same question the
-- service asks, so a row the actor could not read is a row they cannot write,
-- and a missing `where` in a future endpoint returns nothing rather than
-- everything.

drop policy if exists learner_teacher_assignment_written_in_scope
  on chat.learner_teacher_assignment;
create policy learner_teacher_assignment_written_in_scope
  on chat.learner_teacher_assignment
  for all to authenticated
  using (exists (select 1 from chat.learner l
                  where l.id = learner_id and chat.staff_can_see_family(l.family_id))
         and chat.current_has_permission('learners.assign_teacher'))
  with check (exists (select 1 from chat.learner l
                       where l.id = learner_id and chat.staff_can_see_family(l.family_id))
              and chat.current_has_permission('learners.assign_teacher'));

-- WHY THESE ARE `FOR INSERT` + `FOR UPDATE` AND NOT `FOR ALL`.
--
-- A `FOR ALL` policy's USING clause governs SELECT as well as UPDATE and
-- DELETE. Written as `for all using (chat.current_has_permission('groups.manage'))`
-- these were therefore PERMISSIVE READ policies granting every holder of
-- groups.manage a read of every row -- and permissive policies OR together, so
-- the broad one silently defeated the narrow, scope-aware `group_member_visible`
-- beside it.
--
-- Caught by execution: as chat_app, a supervisor whose
-- chat.staff_can_see_family() said FALSE for another family still read that
-- family's child out of a shared group's roster. That is red-team A-1/RT-011 at
-- the group level -- a directory of other people's children -- reintroduced by
-- a write policy.
--
-- Splitting the command keeps writes permissioned while leaving reads to the
-- SELECT policy alone. The UPDATE clause additionally mirrors the read scope,
-- so a row a supervisor may not see is also a row they may not modify.
--
-- No DELETE policy is written because chat_app holds no DELETE on these tables
-- (section 2): the privilege, not a policy, is what forbids it.

drop policy if exists group_written_by_manager on chat.group;
create policy group_inserted_by_manager on chat.group
  for insert to authenticated
  with check (chat.current_has_permission('groups.manage'));
create policy group_updated_by_manager on chat.group
  for update to authenticated
  using (chat.current_has_permission('groups.manage'))
  with check (chat.current_has_permission('groups.manage'));

drop policy if exists group_member_written_by_manager on chat.group_member;
create policy group_member_inserted_by_manager on chat.group_member
  for insert to authenticated
  with check (chat.current_has_permission('groups.manage'));
create policy group_member_updated_by_manager on chat.group_member
  for update to authenticated
  using (
    chat.current_has_permission('groups.manage')
    and (chat.staff_is_organization_wide(chat.current_staff_id())
         or exists (select 1 from chat.learner l
                     where l.id = learner_id and chat.staff_can_see_family(l.family_id)))
  )
  with check (chat.current_has_permission('groups.manage'));

drop policy if exists group_teacher_written_by_manager on chat.group_teacher;
create policy group_teacher_inserted_by_manager on chat.group_teacher
  for insert to authenticated
  with check (chat.current_has_permission('groups.manage'));
create policy group_teacher_updated_by_manager on chat.group_teacher
  for update to authenticated
  using (chat.current_has_permission('groups.manage'))
  with check (chat.current_has_permission('groups.manage'));

drop policy if exists label_written_by_curator on chat.label;
create policy label_inserted_by_curator on chat.label
  for insert to authenticated
  with check (chat.current_has_permission('labels.manage'));
create policy label_updated_by_curator on chat.label
  for update to authenticated
  using (chat.current_has_permission('labels.manage'))
  with check (chat.current_has_permission('labels.manage'));

-- Attaching a label to a family is a fact about THAT FAMILY, so it takes
-- families.manage and the family's own scope -- not labels.manage. This is the
-- split that lets an admin file their own families without being able to
-- rename the vocabulary for everybody.
drop policy if exists family_label_written_in_scope on chat.family_label;
create policy family_label_written_in_scope on chat.family_label
  for all to authenticated
  using (chat.staff_can_see_family(family_id)
         and chat.current_has_permission('families.manage'))
  with check (chat.staff_can_see_family(family_id)
              and chat.current_has_permission('families.manage'));

-- ---------------------------------------------------------------------------
-- 4. Correcting two policies that were dead letters
-- ---------------------------------------------------------------------------
--
-- family_edited_by_admins and learner_edited_by_admins (20260905091200) both
-- test:
--
--   chat.current_staff_role() in ('admin', 'coverage', 'manager')
--
-- Two defects, verified against the live catalogue before this was written:
--
--   1. `coverage` HAS NOT EXISTED since PD-5 renamed it `coverage_admin`
--      (20260907100100). A coverage admin matched nothing.
--   2. `super_admin` was never listed. The organization owner matched nothing
--      either.
--
-- Both were invisible because chat_app held no UPDATE on either table, so the
-- policies were never evaluated. Section 2 above grants exactly that, which
-- turns two dead letters into live controls -- wrong in both directions. They
-- are corrected here, in the same migration that makes them reachable.
--
-- The rewrite also moves from ROLE NAMES to a PERMISSION KEY. A role list in a
-- policy is a second authorization model that has to be kept in step with
-- chat.role_permission by hand -- which is exactly how it fell out of step. The
-- permission is resolved by chat.current_has_permission(), so a per-account
-- DENY applies here too, and a future role never has to be added to this line.

drop policy if exists family_edited_by_admins on chat.family;
create policy family_edited_by_admins on chat.family
  for update to authenticated
  using (chat.current_has_permission('families.manage') and chat.staff_can_see_family(id))
  with check (chat.current_has_permission('families.manage') and chat.staff_can_see_family(id));

drop policy if exists learner_edited_by_admins on chat.learner;
create policy learner_edited_by_admins on chat.learner
  for all to authenticated
  using (chat.current_has_permission('families.manage')
         and chat.staff_can_see_family(family_id))
  with check (chat.current_has_permission('families.manage')
              and chat.staff_can_see_family(family_id));

-- Creating a family names its supervisor, so it stays the manager-only act it
-- already was -- but expressed as the permission rather than as chat.is_manager(),
-- which hard-codes `role = 'manager'` and therefore excludes super_admin.
drop policy if exists family_created_by_manager on chat.family;
create policy family_created_by_manager on chat.family
  for insert to authenticated
  with check (chat.current_has_permission('families.assign'));

-- ---------------------------------------------------------------------------
-- 5. The SELECT policy has to be able to see a row being created
-- ---------------------------------------------------------------------------
--
-- FOUND BY EXECUTION, not by reading. With the INSERT grant of section 2 in
-- place, `insert into chat.family ... returning id` failed as chat_app with
--
--     new row violates row-level security policy for table "family"
--
-- ...while the identical INSERT *without* RETURNING succeeded.
--
-- WHY. PostgreSQL applies the SELECT policy to INSERT ... RETURNING. The SELECT
-- policy is chat.staff_can_see_family(id), which resolves scope through
-- chat.staff_family_ids() -- a STABLE function, so it reads the snapshot taken
-- at STATEMENT START. The row being inserted is not in that snapshot, and the
-- primary-assignment row that would put it in scope is opened by an AFTER
-- trigger that has not run yet. The predicate therefore cannot be satisfied by
-- any newly created family, for anybody.
--
-- Every ORM issues INSERT ... RETURNING, so this made family creation through
-- the least-privileged role impossible. It was invisible until now only because
-- chat_app held no INSERT on chat.family before this migration -- the grant and
-- the policy disagreed, and section 2 is what makes them meet.
--
-- THE FIX is to state the organization-wide case DIRECTLY instead of deriving
-- it from a lookup into the table being written. It carries the same meaning:
-- chat.staff_family_ids() already returns every family in the organization for
-- an organization-wide staff member, so this adds no visibility that the
-- previous predicate did not intend -- it simply no longer depends on the new
-- row being visible to a snapshot that predates it.
--
-- The assignment-scoped clause is preserved unchanged for everyone else, so a
-- plain admin's visibility is exactly what it was.

drop policy if exists family_visible_to_staff on chat.family;
create policy family_visible_to_staff on chat.family
  for select to authenticated
  using (
    (chat.staff_is_organization_wide(chat.current_staff_id())
     and organization_id = (select s.organization_id from chat.staff s
                             where s.id = chat.current_staff_id()))
    or chat.staff_can_see_family(id)
  );
