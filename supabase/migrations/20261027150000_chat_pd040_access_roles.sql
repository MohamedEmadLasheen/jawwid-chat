-- =============================================================================
-- PD-40 PR-2 · the permission data model
--
-- AUTHORIZATION-MODEL §1.5: "permissions are data, not code". This migration
-- makes them data:
--
--   chat.permission                the catalogue, one row per page.action key
--                                  (seeded from apps/api/src/platform/permissions/catalogue.ts)
--   chat.legacy_permission_bundle  what every EXISTING staff account holds, by
--                                  tier and department kind (seeded from
--                                  legacy-bundles.ts)
--   chat.access_role               a named bundle of permissions: the Designer,
--                                  later the Accountant, Marketing, ...
--   chat.access_role_permission    the keys of a role
--   chat.staff_access_role         which account holds which role
--
-- and adds the tier `specialist`: a staff account with NO implicit power, whose
-- permissions come only from the roles it is granted.
--
-- chat.staff_access_profile(staff) is the ONE answer to "what does this staff
-- member hold": the API's PermissionGuard, GET /me and every SQL rule ask it.
--
-- ONLY THE FUNCTIONS BELOW WRITE ROLES AND GRANTS. A guard trigger refuses any
-- other insert, update or delete on the three role tables, so the hierarchy
-- rules (PD-40 H1-H10) cannot be skipped by a service that writes rows itself:
--
--   chat.define_access_role / chat.update_access_role / chat.archive_access_role
--       the super admin only (H7)
--   chat.grant_access_role / chat.revoke_access_role
--       the super admin; from PD-40 PR-3, a department manager inside their own
--       department, for accounts below them, of roles whose every permission
--       they hold and may delegate (H3-H6). Never one's own account (H8), never
--       the super admin (H1), never above the role's tier.
--
-- Every change writes chat.audit_log in the same transaction, with the
-- permission keys resolved, so history stays readable after a role is edited
-- (H10).
--
-- The tables are server-only: RLS on, no grants to request roles.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The specialist tier
-- ---------------------------------------------------------------------------
alter table chat.staff drop constraint staff_role_check;
alter table chat.staff add constraint staff_role_check check (role in
  ('admin', 'coverage', 'manager', 'finance', 'technical', 'academic', 'super_admin', 'specialist'));

comment on column chat.staff.role is
  'admin and coverage have identical permissions; coverage is a label that '
  'routes covered families into a separate inbox section (brief SS2). '
  'finance/technical/academic see only their own tasks and never message families. '
  'super_admin (PD-5) is the organization owner; it is granted only through the '
  'bootstrap procedure, which opens chat.provisioning_super_admin '
  '(see chat.guard_super_admin_grant). '
  'specialist (PD-40) holds nothing by its role: only the access roles it is granted.';

-- A staff member's tier: what their role means to PD-40's hierarchy.
create function chat.staff_tier(p_role text)
returns text
language sql
immutable
as $$
  select case p_role
    when 'super_admin' then 'super_admin'
    when 'manager'     then 'manager'
    when 'admin'       then 'supervisor'
    when 'coverage'    then 'supervisor'
    when 'finance'     then 'legacy_department'
    when 'technical'   then 'legacy_department'
    when 'academic'    then 'legacy_department'
    when 'specialist'  then 'specialist'
  end;
$$;

-- Higher manages lower (H3). A role's max_tier is compared on the same scale.
create function chat.tier_rank(p_tier text)
returns int
language sql
immutable
as $$
  select case p_tier
    when 'super_admin'       then 4
    when 'manager'           then 3
    when 'supervisor'        then 2
    when 'legacy_department' then 1
    when 'specialist'        then 1
  end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The catalogue and the legacy bundles
-- ---------------------------------------------------------------------------
create table chat.permission (
  key           text primary key check (key ~ '^[a-z_]+(\.[a-z_]+)+$'),
  page          text not null check (length(page) between 1 and 60),
  action        text not null check (length(action) between 1 and 60),
  label_en      text not null check (length(btrim(label_en)) between 1 and 200),
  label_ar      text not null check (length(btrim(label_ar)) between 1 and 200),
  risk          text not null check (risk in ('none', 'pii', 'family_contact', 'finance', 'admin')),
  delegable     boolean not null default false,
  introduced_by text not null,
  constraint permission_key_is_page_dot_action check (key = page || '.' || action)
);

comment on table chat.permission is
  'PD-40: the permission catalogue. Mirrors apps/api/src/platform/permissions/catalogue.ts; '
  'test/integration/pd040-access-roles.spec.ts asserts the two are equal.';

create table chat.legacy_permission_bundle (
  tier            text not null check (tier in ('manager', 'supervisor', 'legacy_department')),
  department_kind text not null check (department_kind in ('operations', 'teachers', 'sales', 'none')),
  permission_key  text not null references chat.permission (key),
  primary key (tier, department_kind, permission_key)
);

comment on table chat.legacy_permission_bundle is
  'PD-40: what an existing staff account holds by its role and department (legacy-bundles.ts). '
  'The super admin holds every key and has no rows; a specialist has none.';

-- BEGIN GENERATED pd040 seed -- by test/unit/authorization/pd040-catalogue-seed.spec.ts; do not edit
insert into chat.permission (key, page, action, label_en, label_ar, risk, delegable, introduced_by) values
  ('chat.use', 'chat', 'use', 'Use chats', 'استخدام المحادثات', 'family_contact', false, 'PD-8'),
  ('chat.manage', 'chat', 'manage', 'Create groups and manage members', 'إنشاء المجموعات وإدارة الأعضاء', 'family_contact', false, 'PD-8'),
  ('chat.moderate', 'chat', 'moderate', 'Moderate held messages', 'مراجعة الرسائل المعلّقة', 'family_contact', false, 'PD-14'),
  ('chat.export', 'chat', 'export', 'Export a conversation', 'تصدير محادثة', 'family_contact', false, 'PD-37'),
  ('calls.use', 'calls', 'use', 'Make and join calls', 'إجراء المكالمات والانضمام إليها', 'family_contact', false, 'PD-19'),
  ('stories.view', 'stories', 'view', 'View stories', 'عرض القصص', 'none', false, 'Stories v2'),
  ('stories.publish', 'stories', 'publish', 'Publish stories', 'نشر القصص', 'family_contact', false, 'Stories v2'),
  ('admin.inspect', 'admin', 'inspect', 'Inspect the whole organization', 'الاطلاع على المؤسسة كاملة', 'admin', false, 'PD-5'),
  ('accounts.administer', 'accounts', 'administer', 'Reset, suspend and reactivate accounts', 'إعادة تعيين الحسابات وإيقافها وتفعيلها', 'admin', false, 'PD-21'),
  ('accounts.support_session', 'accounts', 'support_session', 'Open an account as its owner (support)', 'فتح حساب نيابةً عن صاحبه (الدعم)', 'admin', false, 'PD-21'),
  ('org.view', 'org', 'view', 'View the organization structure', 'عرض الهيكل التنظيمي', 'pii', false, 'PD-8'),
  ('org.manage', 'org', 'manage', 'Assign supervisors, backups and covers', 'تعيين المشرفين والبدلاء والتغطية', 'family_contact', false, 'PD-8'),
  ('org.covers', 'org', 'covers', 'Hand a supervisor over to a backup', 'تسليم المشرف إلى البديل', 'family_contact', false, 'PD-33'),
  ('org.departments', 'org', 'departments', 'Create departments and place staff', 'إنشاء الأقسام وتوزيع الموظفين', 'admin', false, 'PD-8'),
  ('staff_profiles.team', 'staff_profiles', 'team', 'View the team''s profiles', 'عرض ملفات الفريق', 'pii', false, 'Staff Profiles'),
  ('staff_profiles.organization', 'staff_profiles', 'organization', 'View every staff profile', 'عرض ملفات جميع الموظفين', 'pii', false, 'Staff Profiles'),
  ('staff_profiles.manage', 'staff_profiles', 'manage', 'Assign responsibilities', 'إسناد المسؤوليات', 'pii', false, 'Staff Profiles'),
  ('staff_profiles.reporting_lines', 'staff_profiles', 'reporting_lines', 'Change reporting lines', 'تغيير خطوط التبعية', 'admin', false, 'Staff Profiles'),
  ('parents.view', 'parents', 'view', 'View parent profiles', 'عرض ملفات أولياء الأمور', 'family_contact', false, 'PD-17'),
  ('parents.edit', 'parents', 'edit', 'Edit a parent''s contact record', 'تعديل بيانات تواصل ولي الأمر', 'family_contact', false, 'PD-17'),
  ('billing.view', 'billing', 'view', 'View payments and instalments', 'عرض المدفوعات والأقساط', 'finance', false, 'PD-12'),
  ('billing.record', 'billing', 'record', 'Record payments and instalments', 'تسجيل المدفوعات والأقساط', 'finance', false, 'PD-17'),
  ('billing.assign', 'billing', 'assign', 'Set a family''s billing supervisor', 'تعيين مشرف الفوترة للأسرة', 'finance', false, 'PD-17'),
  ('billing.verify', 'billing', 'verify', 'Refunds and payment settings', 'الاستردادات وإعدادات الدفع', 'finance', false, 'PD-27'),
  ('subscriptions.view', 'subscriptions', 'view', 'View subscriptions', 'عرض الاشتراكات', 'finance', false, 'PD-30'),
  ('subscriptions.manage', 'subscriptions', 'manage', 'Add free lessons and grant exceptions', 'إضافة حصص مجانية ومنح الاستثناءات', 'finance', false, 'PD-30'),
  ('schedule.view', 'schedule', 'view', 'View schedules and the calendar', 'عرض الجداول والتقويم', 'pii', false, 'PD-31'),
  ('schedule.manage', 'schedule', 'manage', 'Change schedules', 'تعديل الجداول', 'pii', false, 'PD-31'),
  ('lessons.view', 'lessons', 'view', 'View lessons and reports', 'عرض الحصص والتقارير', 'pii', false, 'PD-11'),
  ('lessons.manage', 'lessons', 'manage', 'Record lesson outcomes and corrections', 'تسجيل نتائج الحصص والتصحيحات', 'pii', false, 'PD-11'),
  ('lessons.courses', 'lessons', 'courses', 'Manage courses', 'إدارة الدورات', 'none', false, 'PD-15'),
  ('students.view', 'students', 'view', 'View student profiles', 'عرض ملفات الطلاب', 'pii', false, 'PD-17'),
  ('students.manage', 'students', 'manage', 'Enrol, transfer and suspend students', 'تسجيل الطلاب ونقلهم وإيقافهم', 'pii', false, 'PD-15'),
  ('reports.view', 'reports', 'view', 'View statistics', 'عرض الإحصاءات', 'pii', false, 'PD-15'),
  ('trials.view', 'trials', 'view', 'View trial lessons', 'عرض الحصص التجريبية', 'pii', false, 'PD-11'),
  ('trials.manage', 'trials', 'manage', 'Book and decide trial lessons', 'حجز الحصص التجريبية والبت فيها', 'pii', false, 'PD-11'),
  ('new_students.view', 'new_students', 'view', 'View new students', 'عرض الطلاب الجدد', 'family_contact', false, 'PD-16'),
  ('new_students.manage', 'new_students', 'manage', 'Assign new students', 'تعيين الطلاب الجدد', 'family_contact', false, 'PD-16'),
  ('materials.view', 'materials', 'view', 'Use materials', 'استخدام المواد', 'none', false, 'PD-29'),
  ('materials.manage', 'materials', 'manage', 'Manage the materials library', 'إدارة مكتبة المواد', 'none', false, 'PD-29'),
  ('cases.view', 'cases', 'view', 'View supervision cases', 'عرض حالات الإشراف', 'pii', false, 'PD-35'),
  ('cases.manage', 'cases', 'manage', 'Open and work supervision cases', 'فتح حالات الإشراف ومتابعتها', 'pii', false, 'PD-35'),
  ('certificates.view', 'certificates', 'view', 'View certificate requests', 'عرض طلبات الشهادات', 'pii', false, 'PD-12'),
  ('certificates.design', 'certificates', 'design', 'Design and upload certificates', 'تصميم الشهادات ورفعها', 'pii', false, 'PD-12'),
  ('certificates.deliver', 'certificates', 'deliver', 'Send certificates to the family', 'إرسال الشهادات إلى الأسرة', 'family_contact', false, 'PD-12'),
  ('leave.view', 'leave', 'view', 'View teacher leave', 'عرض إجازات المعلمين', 'pii', false, 'PD-12'),
  ('leave.decide', 'leave', 'decide', 'Decide teacher leave', 'البت في إجازات المعلمين', 'pii', false, 'PD-12'),
  ('leave.allowance', 'leave', 'allowance', 'Set leave allowances', 'تحديد رصيد الإجازات', 'pii', false, 'PD-12'),
  ('discipline.view', 'discipline', 'view', 'View absences and lateness', 'عرض الغياب والتأخر', 'pii', false, 'PD-12'),
  ('discipline.manage', 'discipline', 'manage', 'Record and decide absences and lateness', 'تسجيل الغياب والتأخر والبت فيهما', 'pii', false, 'PD-12'),
  ('supervision.chats', 'supervision', 'chats', 'Open teachers'' supervision chats', 'فتح محادثات الإشراف مع المعلمين', 'pii', false, 'PD-12'),
  ('teacher_profiles.review', 'teacher_profiles', 'review', 'Review teacher profiles', 'مراجعة ملفات المعلمين التعريفية', 'pii', false, 'Teacher Profile V2'),
  ('teacher_files.view', 'teacher_files', 'view', 'View Teacher Files', 'عرض ملفات المعلمين', 'pii', false, 'PD-10'),
  ('teacher_files.edit', 'teacher_files', 'edit', 'Edit a teacher''s personal record', 'تعديل البيانات الشخصية للمعلم', 'pii', false, 'PD-10'),
  ('teacher_files.supervise', 'teacher_files', 'supervise', 'Write the supervision timeline', 'الكتابة في سجل الإشراف', 'pii', false, 'PD-10'),
  ('teacher_files.evaluate', 'teacher_files', 'evaluate', 'Evaluate teachers', 'تقييم المعلمين', 'pii', false, 'PD-26'),
  ('teacher_files.finance', 'teacher_files', 'finance', 'Teacher payroll', 'رواتب المعلمين', 'finance', false, 'PD-18'),
  ('feedback.view', 'feedback', 'view', 'View parent feedback', 'عرض ملاحظات أولياء الأمور', 'family_contact', false, 'PD-32'),
  ('feedback.manage', 'feedback', 'manage', 'Take and answer parent feedback', 'استلام ملاحظات أولياء الأمور والرد عليها', 'family_contact', false, 'PD-32');

insert into chat.legacy_permission_bundle (tier, department_kind, permission_key) values
  ('manager', 'operations', 'accounts.administer'),
  ('manager', 'operations', 'accounts.support_session'),
  ('manager', 'operations', 'billing.assign'),
  ('manager', 'operations', 'billing.record'),
  ('manager', 'operations', 'billing.verify'),
  ('manager', 'operations', 'billing.view'),
  ('manager', 'operations', 'calls.use'),
  ('manager', 'operations', 'cases.manage'),
  ('manager', 'operations', 'cases.view'),
  ('manager', 'operations', 'chat.manage'),
  ('manager', 'operations', 'chat.moderate'),
  ('manager', 'operations', 'chat.use'),
  ('manager', 'operations', 'feedback.manage'),
  ('manager', 'operations', 'feedback.view'),
  ('manager', 'operations', 'lessons.courses'),
  ('manager', 'operations', 'lessons.manage'),
  ('manager', 'operations', 'lessons.view'),
  ('manager', 'operations', 'materials.manage'),
  ('manager', 'operations', 'materials.view'),
  ('manager', 'operations', 'new_students.manage'),
  ('manager', 'operations', 'new_students.view'),
  ('manager', 'operations', 'org.covers'),
  ('manager', 'operations', 'org.manage'),
  ('manager', 'operations', 'org.view'),
  ('manager', 'operations', 'parents.edit'),
  ('manager', 'operations', 'parents.view'),
  ('manager', 'operations', 'reports.view'),
  ('manager', 'operations', 'schedule.manage'),
  ('manager', 'operations', 'schedule.view'),
  ('manager', 'operations', 'staff_profiles.manage'),
  ('manager', 'operations', 'staff_profiles.team'),
  ('manager', 'operations', 'stories.publish'),
  ('manager', 'operations', 'stories.view'),
  ('manager', 'operations', 'students.manage'),
  ('manager', 'operations', 'students.view'),
  ('manager', 'operations', 'subscriptions.manage'),
  ('manager', 'operations', 'subscriptions.view'),
  ('manager', 'operations', 'teacher_profiles.review'),
  ('manager', 'operations', 'trials.manage'),
  ('manager', 'operations', 'trials.view'),
  ('manager', 'teachers', 'accounts.administer'),
  ('manager', 'teachers', 'accounts.support_session'),
  ('manager', 'teachers', 'calls.use'),
  ('manager', 'teachers', 'cases.manage'),
  ('manager', 'teachers', 'cases.view'),
  ('manager', 'teachers', 'certificates.deliver'),
  ('manager', 'teachers', 'certificates.design'),
  ('manager', 'teachers', 'certificates.view'),
  ('manager', 'teachers', 'chat.manage'),
  ('manager', 'teachers', 'chat.moderate'),
  ('manager', 'teachers', 'chat.use'),
  ('manager', 'teachers', 'discipline.manage'),
  ('manager', 'teachers', 'discipline.view'),
  ('manager', 'teachers', 'feedback.manage'),
  ('manager', 'teachers', 'feedback.view'),
  ('manager', 'teachers', 'leave.allowance'),
  ('manager', 'teachers', 'leave.decide'),
  ('manager', 'teachers', 'leave.view'),
  ('manager', 'teachers', 'lessons.courses'),
  ('manager', 'teachers', 'lessons.manage'),
  ('manager', 'teachers', 'lessons.view'),
  ('manager', 'teachers', 'materials.manage'),
  ('manager', 'teachers', 'materials.view'),
  ('manager', 'teachers', 'org.covers'),
  ('manager', 'teachers', 'org.manage'),
  ('manager', 'teachers', 'org.view'),
  ('manager', 'teachers', 'reports.view'),
  ('manager', 'teachers', 'schedule.manage'),
  ('manager', 'teachers', 'schedule.view'),
  ('manager', 'teachers', 'staff_profiles.manage'),
  ('manager', 'teachers', 'staff_profiles.team'),
  ('manager', 'teachers', 'stories.publish'),
  ('manager', 'teachers', 'stories.view'),
  ('manager', 'teachers', 'students.view'),
  ('manager', 'teachers', 'supervision.chats'),
  ('manager', 'teachers', 'teacher_files.edit'),
  ('manager', 'teachers', 'teacher_files.evaluate'),
  ('manager', 'teachers', 'teacher_files.supervise'),
  ('manager', 'teachers', 'teacher_files.view'),
  ('manager', 'teachers', 'teacher_profiles.review'),
  ('manager', 'teachers', 'trials.manage'),
  ('manager', 'teachers', 'trials.view'),
  ('manager', 'sales', 'accounts.administer'),
  ('manager', 'sales', 'billing.record'),
  ('manager', 'sales', 'billing.view'),
  ('manager', 'sales', 'calls.use'),
  ('manager', 'sales', 'chat.manage'),
  ('manager', 'sales', 'chat.moderate'),
  ('manager', 'sales', 'chat.use'),
  ('manager', 'sales', 'new_students.manage'),
  ('manager', 'sales', 'new_students.view'),
  ('manager', 'sales', 'org.covers'),
  ('manager', 'sales', 'org.manage'),
  ('manager', 'sales', 'org.view'),
  ('manager', 'sales', 'parents.view'),
  ('manager', 'sales', 'reports.view'),
  ('manager', 'sales', 'schedule.view'),
  ('manager', 'sales', 'staff_profiles.manage'),
  ('manager', 'sales', 'staff_profiles.team'),
  ('manager', 'sales', 'stories.publish'),
  ('manager', 'sales', 'stories.view'),
  ('manager', 'sales', 'students.view'),
  ('manager', 'sales', 'subscriptions.manage'),
  ('manager', 'sales', 'subscriptions.view'),
  ('manager', 'sales', 'teacher_profiles.review'),
  ('manager', 'sales', 'trials.manage'),
  ('manager', 'sales', 'trials.view'),
  ('manager', 'none', 'calls.use'),
  ('manager', 'none', 'chat.manage'),
  ('manager', 'none', 'chat.moderate'),
  ('manager', 'none', 'chat.use'),
  ('manager', 'none', 'org.view'),
  ('manager', 'none', 'staff_profiles.manage'),
  ('manager', 'none', 'staff_profiles.team'),
  ('manager', 'none', 'stories.publish'),
  ('manager', 'none', 'stories.view'),
  ('manager', 'none', 'teacher_profiles.review'),
  ('supervisor', 'operations', 'accounts.administer'),
  ('supervisor', 'operations', 'accounts.support_session'),
  ('supervisor', 'operations', 'billing.record'),
  ('supervisor', 'operations', 'billing.view'),
  ('supervisor', 'operations', 'calls.use'),
  ('supervisor', 'operations', 'cases.manage'),
  ('supervisor', 'operations', 'cases.view'),
  ('supervisor', 'operations', 'chat.manage'),
  ('supervisor', 'operations', 'chat.moderate'),
  ('supervisor', 'operations', 'chat.use'),
  ('supervisor', 'operations', 'feedback.manage'),
  ('supervisor', 'operations', 'feedback.view'),
  ('supervisor', 'operations', 'lessons.manage'),
  ('supervisor', 'operations', 'lessons.view'),
  ('supervisor', 'operations', 'materials.view'),
  ('supervisor', 'operations', 'new_students.manage'),
  ('supervisor', 'operations', 'new_students.view'),
  ('supervisor', 'operations', 'org.covers'),
  ('supervisor', 'operations', 'parents.edit'),
  ('supervisor', 'operations', 'parents.view'),
  ('supervisor', 'operations', 'schedule.manage'),
  ('supervisor', 'operations', 'schedule.view'),
  ('supervisor', 'operations', 'stories.publish'),
  ('supervisor', 'operations', 'stories.view'),
  ('supervisor', 'operations', 'students.manage'),
  ('supervisor', 'operations', 'students.view'),
  ('supervisor', 'operations', 'subscriptions.view'),
  ('supervisor', 'operations', 'teacher_profiles.review'),
  ('supervisor', 'operations', 'trials.manage'),
  ('supervisor', 'operations', 'trials.view'),
  ('supervisor', 'teachers', 'accounts.administer'),
  ('supervisor', 'teachers', 'accounts.support_session'),
  ('supervisor', 'teachers', 'calls.use'),
  ('supervisor', 'teachers', 'cases.manage'),
  ('supervisor', 'teachers', 'cases.view'),
  ('supervisor', 'teachers', 'certificates.deliver'),
  ('supervisor', 'teachers', 'certificates.design'),
  ('supervisor', 'teachers', 'certificates.view'),
  ('supervisor', 'teachers', 'chat.manage'),
  ('supervisor', 'teachers', 'chat.moderate'),
  ('supervisor', 'teachers', 'chat.use'),
  ('supervisor', 'teachers', 'discipline.manage'),
  ('supervisor', 'teachers', 'discipline.view'),
  ('supervisor', 'teachers', 'feedback.manage'),
  ('supervisor', 'teachers', 'feedback.view'),
  ('supervisor', 'teachers', 'leave.decide'),
  ('supervisor', 'teachers', 'leave.view'),
  ('supervisor', 'teachers', 'lessons.manage'),
  ('supervisor', 'teachers', 'lessons.view'),
  ('supervisor', 'teachers', 'materials.view'),
  ('supervisor', 'teachers', 'org.covers'),
  ('supervisor', 'teachers', 'schedule.manage'),
  ('supervisor', 'teachers', 'schedule.view'),
  ('supervisor', 'teachers', 'stories.publish'),
  ('supervisor', 'teachers', 'stories.view'),
  ('supervisor', 'teachers', 'students.view'),
  ('supervisor', 'teachers', 'supervision.chats'),
  ('supervisor', 'teachers', 'teacher_files.evaluate'),
  ('supervisor', 'teachers', 'teacher_files.supervise'),
  ('supervisor', 'teachers', 'teacher_files.view'),
  ('supervisor', 'teachers', 'teacher_profiles.review'),
  ('supervisor', 'teachers', 'trials.manage'),
  ('supervisor', 'teachers', 'trials.view'),
  ('supervisor', 'sales', 'accounts.administer'),
  ('supervisor', 'sales', 'billing.record'),
  ('supervisor', 'sales', 'billing.view'),
  ('supervisor', 'sales', 'calls.use'),
  ('supervisor', 'sales', 'chat.manage'),
  ('supervisor', 'sales', 'chat.moderate'),
  ('supervisor', 'sales', 'chat.use'),
  ('supervisor', 'sales', 'new_students.manage'),
  ('supervisor', 'sales', 'new_students.view'),
  ('supervisor', 'sales', 'org.covers'),
  ('supervisor', 'sales', 'parents.view'),
  ('supervisor', 'sales', 'schedule.view'),
  ('supervisor', 'sales', 'stories.publish'),
  ('supervisor', 'sales', 'stories.view'),
  ('supervisor', 'sales', 'students.view'),
  ('supervisor', 'sales', 'subscriptions.view'),
  ('supervisor', 'sales', 'teacher_profiles.review'),
  ('supervisor', 'sales', 'trials.manage'),
  ('supervisor', 'sales', 'trials.view'),
  ('supervisor', 'none', 'calls.use'),
  ('supervisor', 'none', 'chat.manage'),
  ('supervisor', 'none', 'chat.moderate'),
  ('supervisor', 'none', 'chat.use'),
  ('supervisor', 'none', 'stories.publish'),
  ('supervisor', 'none', 'stories.view'),
  ('supervisor', 'none', 'teacher_profiles.review');
-- END GENERATED pd040 seed

-- ---------------------------------------------------------------------------
-- 3. Access roles and grants
-- ---------------------------------------------------------------------------
create table chat.access_role (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references chat.organization (id),
  key             text not null check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  name_en         text not null check (length(btrim(name_en)) between 1 and 120),
  name_ar         text not null check (length(btrim(name_ar)) between 1 and 120),
  description     text check (description is null or length(description) <= 1000),
  -- The highest tier the role may be granted to (H3: never above the role).
  max_tier        text not null default 'specialist' check (max_tier in ('specialist', 'supervisor', 'manager')),
  is_template     boolean not null default false,
  created_by      uuid references chat.staff (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Archived: never granted again; existing grants keep working until removed.
  archived_at     timestamptz,
  constraint access_role_key_per_organization unique (organization_id, key)
);

create table chat.access_role_permission (
  role_id        uuid not null references chat.access_role (id),
  permission_key text not null references chat.permission (key),
  primary key (role_id, permission_key)
);

create table chat.staff_access_role (
  staff_id   uuid not null references chat.staff (id),
  role_id    uuid not null references chat.access_role (id),
  granted_by uuid references chat.staff (id),
  granted_at timestamptz not null default now(),
  reason     text not null check (length(btrim(reason)) between 1 and 500),
  primary key (staff_id, role_id)
);

create index staff_access_role_by_role on chat.staff_access_role (role_id);

comment on table chat.access_role is
  'PD-40: a named bundle of permissions. Written only by chat.define_access_role / update / archive.';
comment on table chat.staff_access_role is
  'PD-40: which staff account holds which access role. Written only by chat.grant_access_role / revoke.';

-- Only the functions write the role tables: they set this transaction-local
-- flag around their own writes, and nothing else can.
create function chat.guard_access_role_writes()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('chat.pd040_access_change', true), '') <> 'on' then
    raise exception 'access roles and grants are changed only through chat.define_access_role, chat.grant_access_role and their siblings (PD-40)'
      using errcode = 'insufficient_privilege';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger access_role_written_by_functions before insert or update or delete on chat.access_role
  for each row execute function chat.guard_access_role_writes();
create trigger access_role_permission_written_by_functions before insert or update or delete on chat.access_role_permission
  for each row execute function chat.guard_access_role_writes();
create trigger staff_access_role_written_by_functions before insert or update or delete on chat.staff_access_role
  for each row execute function chat.guard_access_role_writes();

-- The catalogue changes only by migration: a migration that adds keys sets the
-- same kind of flag for its own transaction.
create function chat.guard_permission_catalogue_writes()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('chat.pd040_catalogue_change', true), '') <> 'on' then
    raise exception 'the permission catalogue changes only by migration (PD-40)'
      using errcode = 'insufficient_privilege';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger permission_changed_by_migration before insert or update or delete on chat.permission
  for each row execute function chat.guard_permission_catalogue_writes();
create trigger legacy_permission_bundle_changed_by_migration before insert or update or delete on chat.legacy_permission_bundle
  for each row execute function chat.guard_permission_catalogue_writes();

-- ---------------------------------------------------------------------------
-- 4. What a staff member holds
-- ---------------------------------------------------------------------------
create function chat.staff_access_profile(p_staff uuid)
returns table (tier text, department_kind text, placement text, permissions text[])
language plpgsql
stable
set search_path = chat, pg_temp
as $$
declare
  v_staff    chat.staff%rowtype;
  v_tier     text;
  v_kind     text;
  v_position text;
  v_fitted   text;
  v_keys     text[];
begin
  select * into v_staff from chat.staff s where s.id = p_staff;
  if not found or not v_staff.is_active or v_staff.left_at is not null then
    return query select null::text, null::text, null::text, array[]::text[];
    return;
  end if;
  v_tier := chat.staff_tier(v_staff.role);

  -- The department the staff member runs, else the one they belong to (PD-8:
  -- one of either per person).
  select d.kind, 'manager' into v_kind, v_position
    from chat.department d
   where d.manager_id = p_staff and d.organization_id = v_staff.organization_id
   limit 1;
  if v_kind is null then
    select d.kind, 'member' into v_kind, v_position
      from chat.department_member m
      join chat.department d on d.id = m.department_id
     where m.staff_id = p_staff and d.organization_id = v_staff.organization_id
     limit 1;
  end if;

  -- A placement that does not fit the tier -- a manager listed as a member, a
  -- supervisor as a manager -- counts as no department: a stale row widens
  -- nothing (legacyBundle() in legacy-bundles.ts).
  v_fitted := case
    when (v_tier = 'manager' and v_position = 'manager') or (v_tier = 'supervisor' and v_position = 'member') then v_kind
    else 'none'
  end;

  if v_tier = 'super_admin' then
    select array_agg(p.key order by p.key) into v_keys from chat.permission p;
  else
    select array_agg(k order by k) into v_keys
      from (
        select b.permission_key as k
          from chat.legacy_permission_bundle b
         where b.tier = v_tier and b.department_kind = v_fitted
        union
        select arp.permission_key
          from chat.staff_access_role sar
          join chat.access_role r on r.id = sar.role_id and r.organization_id = v_staff.organization_id
          join chat.access_role_permission arp on arp.role_id = sar.role_id
         where sar.staff_id = p_staff
      ) held;
  end if;

  return query select v_tier, v_kind, v_position, coalesce(v_keys, array[]::text[]);
end;
$$;

comment on function chat.staff_access_profile(uuid) is
  'PD-40: a staff member''s tier, department and effective permissions -- the legacy bundle of '
  '(tier, department) plus every granted role; every key for the super admin; nothing when inactive.';

create function chat.staff_has_permission(p_staff uuid, p_key text)
returns boolean
language sql
stable
set search_path = chat, pg_temp
as $$
  select coalesce(p_key = any (p.permissions), false) from chat.staff_access_profile(p_staff) p;
$$;

-- Does the manager run the department this staff member belongs to? PD-40
-- PR-3 extends it to department accounts (specialists).
create function chat.staff_in_managed_department(p_manager uuid, p_staff uuid)
returns boolean
language sql
stable
set search_path = chat, pg_temp
as $$
  select exists (
    select 1
      from chat.department d
      join chat.department_member m on m.department_id = d.id
     where d.manager_id = p_manager and m.staff_id = p_staff
  );
$$;

-- ---------------------------------------------------------------------------
-- 5. The writers
-- ---------------------------------------------------------------------------
create function chat.require_live_staff(p_actor uuid)
returns chat.staff
language plpgsql
stable
set search_path = chat, pg_temp
as $$
declare
  v chat.staff%rowtype;
begin
  select * into v from chat.staff where id = p_actor;
  if not found or not v.is_active or v.left_at is not null then
    raise exception 'only an active staff member may change access' using errcode = 'insufficient_privilege';
  end if;
  return v;
end;
$$;

create function chat.require_super_admin_for_roles(p_actor chat.staff)
returns void
language plpgsql
immutable
as $$
begin
  if p_actor.role <> 'super_admin' then
    raise exception 'only the super admin defines and changes access roles (PD-40 H7)' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

create function chat.require_reason(p_reason text)
returns text
language plpgsql
immutable
as $$
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'a reason is required' using errcode = 'check_violation';
  end if;
  return btrim(p_reason);
end;
$$;

create function chat.set_access_role_permissions(p_role uuid, p_permissions text[])
returns text[]
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_unknown text[];
  v_keys    text[];
begin
  select array_agg(distinct k order by k) into v_keys from unnest(coalesce(p_permissions, array[]::text[])) k;
  if v_keys is null then
    raise exception 'a role holds at least one permission' using errcode = 'check_violation';
  end if;
  select array_agg(k) into v_unknown from unnest(v_keys) k where not exists (select 1 from chat.permission p where p.key = k);
  if v_unknown is not null then
    raise exception 'unknown permission(s): %', array_to_string(v_unknown, ', ') using errcode = 'check_violation';
  end if;
  delete from chat.access_role_permission where role_id = p_role;
  insert into chat.access_role_permission (role_id, permission_key) select p_role, k from unnest(v_keys) k;
  return v_keys;
end;
$$;

create function chat.define_access_role(
  p_key         text,
  p_name_en     text,
  p_name_ar     text,
  p_description text,
  p_max_tier    text,
  p_permissions text[],
  p_reason      text,
  p_actor_id    uuid default null
) returns uuid
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_actor  chat.staff := chat.require_live_staff(chat.trusted_staff_actor(p_actor_id));
  v_reason text := chat.require_reason(p_reason);
  v_id     uuid;
  v_keys   text[];
begin
  perform chat.require_super_admin_for_roles(v_actor);
  perform set_config('chat.pd040_access_change', 'on', true);
  insert into chat.access_role (organization_id, key, name_en, name_ar, description, max_tier, created_by)
  values (v_actor.organization_id, p_key, btrim(p_name_en), btrim(p_name_ar), p_description, coalesce(p_max_tier, 'specialist'), v_actor.id)
  returning id into v_id;
  v_keys := chat.set_access_role_permissions(v_id, p_permissions);
  insert into chat.audit_log (actor_id, action, entity, entity_id, before, after, reason)
  values (v_actor.id, 'access_role.created', 'access_role', v_id, null,
          jsonb_build_object('key', p_key, 'maxTier', coalesce(p_max_tier, 'specialist'), 'permissions', to_jsonb(v_keys)), v_reason);
  perform set_config('chat.pd040_access_change', 'off', true);
  return v_id;
end;
$$;

create function chat.update_access_role(
  p_role        uuid,
  p_name_en     text,
  p_name_ar     text,
  p_description text,
  p_permissions text[],
  p_reason      text,
  p_actor_id    uuid default null
) returns void
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_actor  chat.staff := chat.require_live_staff(chat.trusted_staff_actor(p_actor_id));
  v_reason text := chat.require_reason(p_reason);
  v_role   chat.access_role%rowtype;
  v_before text[];
  v_keys   text[];
begin
  perform chat.require_super_admin_for_roles(v_actor);
  select * into v_role from chat.access_role where id = p_role for update;
  if not found or v_role.organization_id <> v_actor.organization_id then
    raise exception 'no such role in this organization' using errcode = 'no_data_found';
  end if;
  select array_agg(permission_key order by permission_key) into v_before from chat.access_role_permission where role_id = p_role;
  perform set_config('chat.pd040_access_change', 'on', true);
  update chat.access_role
     set name_en = coalesce(btrim(p_name_en), name_en),
         name_ar = coalesce(btrim(p_name_ar), name_ar),
         description = coalesce(p_description, description),
         updated_at = now()
   where id = p_role;
  v_keys := case when p_permissions is null then v_before else chat.set_access_role_permissions(p_role, p_permissions) end;
  insert into chat.audit_log (actor_id, action, entity, entity_id, before, after, reason)
  values (v_actor.id, 'access_role.updated', 'access_role', p_role,
          jsonb_build_object('nameEn', v_role.name_en, 'nameAr', v_role.name_ar, 'permissions', to_jsonb(v_before)),
          jsonb_build_object('nameEn', coalesce(btrim(p_name_en), v_role.name_en), 'nameAr', coalesce(btrim(p_name_ar), v_role.name_ar),
                             'permissions', to_jsonb(v_keys)),
          v_reason);
  perform set_config('chat.pd040_access_change', 'off', true);
end;
$$;

create function chat.archive_access_role(p_role uuid, p_reason text, p_actor_id uuid default null)
returns void
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_actor  chat.staff := chat.require_live_staff(chat.trusted_staff_actor(p_actor_id));
  v_reason text := chat.require_reason(p_reason);
  v_role   chat.access_role%rowtype;
begin
  perform chat.require_super_admin_for_roles(v_actor);
  select * into v_role from chat.access_role where id = p_role for update;
  if not found or v_role.organization_id <> v_actor.organization_id then
    raise exception 'no such role in this organization' using errcode = 'no_data_found';
  end if;
  if v_role.archived_at is not null then return; end if;
  perform set_config('chat.pd040_access_change', 'on', true);
  update chat.access_role set archived_at = now(), updated_at = now() where id = p_role;
  insert into chat.audit_log (actor_id, action, entity, entity_id, before, after, reason)
  values (v_actor.id, 'access_role.archived', 'access_role', p_role, null, null, v_reason);
  perform set_config('chat.pd040_access_change', 'off', true);
end;
$$;

-- H1-H8 for one grant or revocation. Raises; returns nothing.
create function chat.require_access_grantor(p_actor chat.staff, p_target chat.staff, p_role chat.access_role, p_granting boolean)
returns void
language plpgsql
stable
set search_path = chat, pg_temp
as $$
declare
  v_withheld text[];
begin
  if p_target.organization_id <> p_actor.organization_id or p_role.organization_id <> p_actor.organization_id then
    raise exception 'no such staff member or role in this organization' using errcode = 'no_data_found';
  end if;
  if p_target.id = p_actor.id then
    raise exception 'nobody changes their own access (PD-40 H8)' using errcode = 'insufficient_privilege';
  end if;
  if p_target.role = 'super_admin' then
    raise exception 'the super admin holds every permission and is never granted a role (PD-40 H1)' using errcode = 'insufficient_privilege';
  end if;
  if p_granting then
    if p_role.archived_at is not null then
      raise exception 'an archived role is never granted' using errcode = 'check_violation';
    end if;
    if chat.tier_rank(chat.staff_tier(p_target.role)) > chat.tier_rank(p_role.max_tier) then
      raise exception 'this role may be granted up to a %, not to a %', p_role.max_tier, chat.staff_tier(p_target.role)
        using errcode = 'check_violation';
    end if;
  end if;
  if p_actor.role = 'super_admin' then
    return;
  end if;

  -- From here: a delegator other than the super admin (PD-40 PR-3 hands out
  -- staff_accounts.manage; until then nobody but the super admin passes).
  if not chat.staff_has_permission(p_actor.id, 'staff_accounts.manage') then
    raise exception 'only the super admin changes another staff member''s access (PD-40)' using errcode = 'insufficient_privilege';
  end if;
  -- H3: a department manager, for accounts below them, in their own department.
  if p_actor.role <> 'manager'
     or chat.tier_rank(chat.staff_tier(p_target.role)) >= chat.tier_rank('manager')
     or not chat.staff_in_managed_department(p_actor.id, p_target.id) then
    raise exception 'a manager changes the access of accounts below them in their own department only (PD-40 H3)'
      using errcode = 'insufficient_privilege';
  end if;
  -- H5: grant only what one holds and may delegate.
  if p_granting then
    select array_agg(arp.permission_key order by arp.permission_key) into v_withheld
      from chat.access_role_permission arp
      join chat.permission p on p.key = arp.permission_key
     where arp.role_id = p_role.id
       and (not p.delegable or not chat.staff_has_permission(p_actor.id, arp.permission_key));
    if v_withheld is not null then
      raise exception 'this role holds permissions you may not grant: % (PD-40 H5)', array_to_string(v_withheld, ', ')
        using errcode = 'insufficient_privilege';
    end if;
  end if;
end;
$$;

create function chat.grant_access_role(p_staff uuid, p_role uuid, p_reason text, p_actor_id uuid default null)
returns boolean
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_actor  chat.staff := chat.require_live_staff(chat.trusted_staff_actor(p_actor_id));
  v_reason text := chat.require_reason(p_reason);
  v_target chat.staff%rowtype;
  v_role   chat.access_role%rowtype;
  v_keys   text[];
  v_added  boolean;
begin
  select * into v_target from chat.staff where id = p_staff for update;
  select * into v_role from chat.access_role where id = p_role;
  if v_target.id is null or v_role.id is null then
    raise exception 'no such staff member or role in this organization' using errcode = 'no_data_found';
  end if;
  perform chat.require_access_grantor(v_actor, v_target, v_role, true);

  perform set_config('chat.pd040_access_change', 'on', true);
  insert into chat.staff_access_role (staff_id, role_id, granted_by, reason)
  values (p_staff, p_role, v_actor.id, v_reason)
  on conflict do nothing;
  v_added := found;
  if v_added then
    select array_agg(permission_key order by permission_key) into v_keys from chat.access_role_permission where role_id = p_role;
    insert into chat.audit_log (actor_id, action, entity, entity_id, before, after, reason)
    values (v_actor.id, 'staff.access_role_granted', 'staff', p_staff, null,
            jsonb_build_object('roleId', p_role, 'roleKey', v_role.key, 'permissions', to_jsonb(v_keys)), v_reason);
  end if;
  perform set_config('chat.pd040_access_change', 'off', true);
  return v_added;
end;
$$;

create function chat.revoke_access_role(p_staff uuid, p_role uuid, p_reason text, p_actor_id uuid default null)
returns boolean
language plpgsql
set search_path = chat, pg_temp
as $$
declare
  v_actor   chat.staff := chat.require_live_staff(chat.trusted_staff_actor(p_actor_id));
  v_reason  text := chat.require_reason(p_reason);
  v_target  chat.staff%rowtype;
  v_role    chat.access_role%rowtype;
  v_keys    text[];
  v_removed boolean;
begin
  select * into v_target from chat.staff where id = p_staff for update;
  select * into v_role from chat.access_role where id = p_role;
  if v_target.id is null or v_role.id is null then
    raise exception 'no such staff member or role in this organization' using errcode = 'no_data_found';
  end if;
  perform chat.require_access_grantor(v_actor, v_target, v_role, false);

  select array_agg(permission_key order by permission_key) into v_keys from chat.access_role_permission where role_id = p_role;
  perform set_config('chat.pd040_access_change', 'on', true);
  delete from chat.staff_access_role where staff_id = p_staff and role_id = p_role;
  v_removed := found;
  if v_removed then
    insert into chat.audit_log (actor_id, action, entity, entity_id, before, after, reason)
    values (v_actor.id, 'staff.access_role_revoked', 'staff', p_staff,
            jsonb_build_object('roleId', p_role, 'roleKey', v_role.key, 'permissions', to_jsonb(v_keys)), null, v_reason);
  end if;
  perform set_config('chat.pd040_access_change', 'off', true);
  return v_removed;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Server-only
-- ---------------------------------------------------------------------------
alter table chat.permission enable row level security;
alter table chat.legacy_permission_bundle enable row level security;
alter table chat.access_role enable row level security;
alter table chat.access_role_permission enable row level security;
alter table chat.staff_access_role enable row level security;
revoke all on chat.permission, chat.legacy_permission_bundle, chat.access_role,
              chat.access_role_permission, chat.staff_access_role
  from public, anon, authenticated, chat_app;

revoke all on function chat.staff_tier(text) from public;
revoke all on function chat.tier_rank(text) from public;
revoke all on function chat.guard_access_role_writes() from public;
revoke all on function chat.guard_permission_catalogue_writes() from public;
revoke all on function chat.staff_access_profile(uuid) from public;
revoke all on function chat.staff_has_permission(uuid, text) from public;
revoke all on function chat.staff_in_managed_department(uuid, uuid) from public;
revoke all on function chat.require_live_staff(uuid) from public;
revoke all on function chat.require_super_admin_for_roles(chat.staff) from public;
revoke all on function chat.require_reason(text) from public;
revoke all on function chat.set_access_role_permissions(uuid, text[]) from public;
revoke all on function chat.define_access_role(text, text, text, text, text, text[], text, uuid) from public;
revoke all on function chat.update_access_role(uuid, text, text, text, text[], text, uuid) from public;
revoke all on function chat.archive_access_role(uuid, text, uuid) from public;
revoke all on function chat.require_access_grantor(chat.staff, chat.staff, chat.access_role, boolean) from public;
revoke all on function chat.grant_access_role(uuid, uuid, text, uuid) from public;
revoke all on function chat.revoke_access_role(uuid, uuid, text, uuid) from public;
