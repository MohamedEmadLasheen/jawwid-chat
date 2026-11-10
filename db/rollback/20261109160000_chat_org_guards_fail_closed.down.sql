-- Roll back 20261109160000_chat_org_guards_fail_closed.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261109160000_chat_org_guards_fail_closed.down.sql
--
-- No data is involved either way.
--
-- P2-4: puts learner_teacher_same_organization back on the shared
-- chat.enforce_same_organization('teacher', 'teacher_id'), exactly as
-- 20261109130000 created it, and drops the dedicated definer function. This
-- REOPENS the fail-open case: a writer that cannot see the teacher (row-level
-- security) passes a cross-organization teacher_id, and a missing teacher is
-- left to the learner_teacher_fk foreign key.
--
-- P2-5: drops the four immutability triggers and their functions. This
-- REOPENS organization moves of chat.learner, chat.contact, chat.staff and
-- chat.account. The family/conversation/teacher guards of 20261109150000 are
-- not touched.

set local lock_timeout = '5s';

drop trigger if exists learner_teacher_same_organization on chat.learner;
create trigger learner_teacher_same_organization
  before insert or update of organization_id, teacher_id on chat.learner
  for each row execute function chat.enforce_same_organization('teacher', 'teacher_id');

comment on trigger learner_teacher_same_organization on chat.learner is
  'RT-029: chat.learner.teacher_id names a teacher in the learner''s own organization. '
  'Fires after learner_assignment_is_guarded (name order), so authority is checked before tenancy.';

drop function if exists chat.enforce_learner_teacher_organization();

drop trigger if exists learner_org_immutable on chat.learner;
drop trigger if exists contact_org_immutable on chat.contact;
drop trigger if exists staff_org_immutable on chat.staff;
drop trigger if exists account_org_immutable on chat.account;

drop function if exists chat.learner_organization_immutable();
drop function if exists chat.contact_organization_immutable();
drop function if exists chat.staff_organization_immutable();
drop function if exists chat.account_organization_immutable();
