-- Roll back 20261102140000_chat_teacher_profile_reviewer_mirror (ADMIN-006
-- follow-up: the SQL reviewer predicate follows the API).
--
-- Restores chat.current_can_review_teacher_profile() to its definition of
-- 20261021000000 (Teacher Profile V2): the family-facing staff roles and the
-- super admin. The RLS policies that read it then admit Sales and Operations
-- again at the database level; the API keeps refusing them (#375) unless it is
-- rolled back too. Same signature, so its grants stay.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261102140000_teacher_profile_reviewer_mirror.down.sql

create or replace function chat.current_can_review_teacher_profile()
returns boolean
language sql
stable
security definer
set search_path = chat, pg_temp
as $$
  select coalesce(chat.current_staff_role() in ('admin', 'coverage', 'manager', 'super_admin'), false)
$$;

comment on function chat.current_can_review_teacher_profile() is
  'Reviewer predicate: the family-facing staff roles and the super admin. '
  'Mirrors AuthorizationService.canReviewTeacherProfile.';

-- The ledger forgets it, so scripts/db/apply.sh applies it again on the way forward.
delete from chat.schema_migrations where version = '20261102140000_chat_teacher_profile_reviewer_mirror';
