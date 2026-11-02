-- ADMIN-006 / TEACHER-API-001 follow-up (QA 2026-10-31; department head,
-- 2026-11-02) -- the database's second line agrees with the API.
--
-- chat.current_can_review_teacher_profile() is the predicate the RLS policies
-- on chat.teacher_professional_profile and chat.teacher_profile_certificate
-- read for a reviewer (20261021000100). It admitted every family-facing staff
-- role (admin, coverage, manager) and the super admin, so a Sales member or an
-- Operations supervisor passed it -- the gap the API closed in #375, where a
-- reviewer is the super admin or the Teachers department
-- (TeacherProfileService.reviewDecision; TeacherScopeService.decidePageBases):
--
--   super admin        always
--   Teachers manager   role 'manager' and chat.teachers_department_role() = 'manager'
--   Teachers member    role 'admin' or 'coverage' and the role = 'member'
--
-- The role is re-checked against the department relation, as the API does,
-- so a stale row grants nothing; the caller must be live staff. The PD-35
-- per-teacher narrowing stays in the API: these policies are row-agnostic
-- reviewer gates, and the API decides which teachers are the reviewer's.
--
-- Same signature, SECURITY DEFINER and search_path as before; `create or
-- replace` keeps its grants (authenticated, service_role).

create or replace function chat.current_can_review_teacher_profile()
returns boolean
language sql
stable
security definer
set search_path = chat, pg_temp
as $$
  select coalesce((
    select s.role = 'super_admin'
        or (s.role = 'manager' and chat.teachers_department_role(s.id) = 'manager')
        or (s.role in ('admin', 'coverage') and chat.teachers_department_role(s.id) = 'member')
      from chat.staff s
     where s.id = chat.current_staff_id()
       and s.is_active
       and s.left_at is null
  ), false)
$$;

comment on function chat.current_can_review_teacher_profile() is
  'Reviewer predicate: the super admin and the Teachers department (its manager; its admin/coverage members). '
  'Mirrors TeacherProfileService.reviewDecision (ADMIN-006); the PD-35 narrowing stays in the API.';
