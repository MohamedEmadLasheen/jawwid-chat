-- Roll back 20261102140000_chat_teacher_profile_reviewer_mirror (ADMIN-006 follow-up).
--
-- Restores chat.current_can_review_teacher_profile() to its 20261021000000 body:
-- every family-facing staff role (admin, coverage, manager) and the super admin.
-- `create or replace` keeps the function's grants. Roll back with the API release
-- only if #375 is rolled back too; on its own this re-opens the SQL second line
-- to Operations and Sales, while the API (#375) still refuses them.
--
--   psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261102140000_chat_teacher_profile_reviewer_mirror.down.sql

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

delete from chat.schema_migrations where version = '20261102140000_chat_teacher_profile_reviewer_mirror';
