-- =============================================================================
-- PD-43 · who may issue a teacher's first sign-in code (#195 review, P1)
--
-- Owner, 2026-10-28, "E-mail only; managers can see". A REISSUED code may be
-- issued only by the super admin, the Teachers manager or the teacher's
-- CURRENT supervisor (a live PD-35 assignment, primary or active backup). The
-- rule this replaces (20261028100000) also admitted every Teachers-department
-- supervisor while strict scope was off, and, for good, the supervisor who had
-- ADDED the teacher: a supervisor reassigned away could reissue, read the code
-- and take the account.
--
-- The person who adds a NEW teacher still issues its FIRST code, in that same
-- transaction: the teacher.created audit row chat.create_teacher wrote moments
-- before was written by THIS transaction (xmin). Later, having added it grants
-- nothing. Giving an EXISTING teacher a sign-in is not creation: it follows
-- the reissue rule (department head, #198).
--
-- chat.guard_password_reset_code calls this for every first_login code, so the
-- API cannot issue past it.
-- =============================================================================

create or replace function chat.may_issue_teacher_first_login(p_staff uuid, p_teacher uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1
      from chat.staff s
      join chat.teacher t on t.id = p_teacher and t.organization_id = s.organization_id
     where s.id = p_staff and s.is_active and s.left_at is null
       and chat.staff_has_permission(s.id, 'teachers.create')
       and (s.role = 'super_admin'
            or (s.role = 'manager' and chat.teachers_department_role(s.id) = 'manager')
            or (s.role in ('admin', 'coverage') and chat.teachers_department_role(s.id) = 'member'
                and (chat.staff_teacher_scope(s.id, t.id) in ('self', 'backup')
                     or exists (select 1 from chat.audit_log l
                                 where l.entity_id = t.id and l.actor_id = s.id
                                   and l.action = 'teacher.created'
                                   and l.xmin = (txid_current() % 4294967296)::text::xid))))
  );
$$;

revoke all on function chat.may_issue_teacher_first_login(uuid, uuid) from public;
