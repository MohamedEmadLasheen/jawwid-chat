-- =============================================================================
-- PD-52 PR-1 · the teacher-records pages' permission keys
-- (docs/product/pd052-teacher-records-pages-plan.md §6)
--
-- The Teacher Supervision page splits into two pages: Attendance & Complaints
-- (teacher_attendance.*) and Grants & Testimonials (teacher_grants.*). This
-- migration only adds keys; nothing changes who reaches what:
--
--   1. the five keys, and the legacy bundles that hold them -- exactly the
--      bundles that hold teacher_supervision.view / .record today;
--   2. every access role that holds an old key gets its new keys too:
--        teacher_supervision.view    -> teacher_attendance.view, teacher_grants.view
--        teacher_supervision.record  -> teacher_attendance.record, teacher_attendance.decide,
--                                       teacher_grants.record
--      so a role edited after this keeps working when the old keys go (PR-9).
--
-- The routes accept the old key or the new one for one release.
-- =============================================================================

select set_config('chat.pd040_catalogue_change', 'on', true);
-- BEGIN GENERATED pd052 catalogue rows -- by test/unit/authorization/pd040-catalogue-seed.spec.ts; do not edit
insert into chat.permission (key, page, action, label_en, label_ar, risk, delegable, introduced_by) values
  ('teacher_attendance.view', 'teacher_attendance', 'view', 'View the Attendance & Complaints page', 'عرض صفحة الحضور والتأخير والأعذار والشكاوى', 'pii', false, 'PD-52'),
  ('teacher_attendance.record', 'teacher_attendance', 'record', 'Record lateness, absences, excuses and complaints', 'تسجيل التأخير والغياب والأعذار والشكاوى', 'pii', false, 'PD-52'),
  ('teacher_attendance.decide', 'teacher_attendance', 'decide', 'Decide leave, the ladder and complaints', 'البت في الإجازات والمخالفات والشكاوى', 'pii', false, 'PD-52'),
  ('teacher_grants.view', 'teacher_grants', 'view', 'View the Grants & Testimonials page', 'عرض صفحة المنح والشهادات الطيبة', 'pii', false, 'PD-52'),
  ('teacher_grants.record', 'teacher_grants', 'record', 'Record grants and testimonials', 'تسجيل المنح والشهادات الطيبة', 'pii', false, 'PD-52');

insert into chat.legacy_permission_bundle (tier, department_kind, permission_key) values
  ('manager', 'operations', 'teacher_attendance.decide'),
  ('manager', 'operations', 'teacher_attendance.record'),
  ('manager', 'operations', 'teacher_attendance.view'),
  ('manager', 'operations', 'teacher_grants.record'),
  ('manager', 'operations', 'teacher_grants.view'),
  ('manager', 'teachers', 'teacher_attendance.decide'),
  ('manager', 'teachers', 'teacher_attendance.record'),
  ('manager', 'teachers', 'teacher_attendance.view'),
  ('manager', 'teachers', 'teacher_grants.record'),
  ('manager', 'teachers', 'teacher_grants.view'),
  ('supervisor', 'operations', 'teacher_attendance.decide'),
  ('supervisor', 'operations', 'teacher_attendance.record'),
  ('supervisor', 'operations', 'teacher_attendance.view'),
  ('supervisor', 'operations', 'teacher_grants.record'),
  ('supervisor', 'operations', 'teacher_grants.view'),
  ('supervisor', 'teachers', 'teacher_attendance.decide'),
  ('supervisor', 'teachers', 'teacher_attendance.record'),
  ('supervisor', 'teachers', 'teacher_attendance.view'),
  ('supervisor', 'teachers', 'teacher_grants.record'),
  ('supervisor', 'teachers', 'teacher_grants.view');
-- END GENERATED pd052 catalogue rows
select set_config('chat.pd040_catalogue_change', 'off', true);

-- Roles: the only writers are the PD-40 functions, which set this flag; a
-- migration sets it for its own transaction, as the catalogue flag above.
select set_config('chat.pd040_access_change', 'on', true);
insert into chat.access_role_permission (role_id, permission_key)
select arp.role_id, m.new_key
  from chat.access_role_permission arp
  join (values ('teacher_supervision.view', 'teacher_attendance.view'),
               ('teacher_supervision.view', 'teacher_grants.view'),
               ('teacher_supervision.record', 'teacher_attendance.record'),
               ('teacher_supervision.record', 'teacher_attendance.decide'),
               ('teacher_supervision.record', 'teacher_grants.record')) as m (old_key, new_key)
    on m.old_key = arp.permission_key
on conflict (role_id, permission_key) do nothing;
select set_config('chat.pd040_access_change', 'off', true);
