/**
 * PD-40: the permission catalogue -- every page and action a STAFF account may
 * be granted, by key. AUTHORIZATION-MODEL §1.5: "permissions are data, not
 * code". This constant is what the code compiles against; the PD-40 data model
 * (PR-2) seeds `chat.permission` from it and a protected spec asserts the two
 * are equal.
 *
 * A key names a page and an action, `<page>.<action>`; the action may have
 * parts of its own (`certificates.request.student`). Every HTTP route
 * declares the keys it needs (route-access.ts), and PermissionGuard checks the
 * actor holds one of them. A key is NECESSARY, NEVER SUFFICIENT: the service
 * behind the route still decides department, scope and state exactly as
 * before, so the guard can only narrow what an actor reaches.
 *
 * WHAT THE COLUMNS MEAN
 *   page       the Admin Web page (or app surface) the key belongs to
 *   risk       what the key exposes, shown in the role editor:
 *                none            nothing about a person
 *                pii             a child's, a teacher's or a staff member's details
 *                family_contact  a family's conversations or contact record
 *                finance         money
 *                admin           accounts, structure, the whole organization
 *   delegable  false = only the super admin grants it (PD-40 H5/H8). Every key
 *              starts non-delegable; a key becomes delegable only once its
 *              legacy bundles are verified against the service rules
 *              (legacy-bundles.ts, pd040-legacy-bundles.spec.ts).
 *
 * Adding a page later is one entry here, `@Requires` on its routes (the route
 * spec fails until they have it) and one Admin Web page-registry entry.
 */
export type PermissionRisk = 'none' | 'pii' | 'family_contact' | 'finance' | 'admin';

export interface PermissionDefinition {
  key: string;
  page: string;
  action: string;
  label: { en: string; ar: string };
  risk: PermissionRisk;
  delegable: boolean;
  /** The decision that introduced the surface. */
  introducedBy: string;
}

type Entry = Omit<PermissionDefinition, 'key' | 'page' | 'action' | 'delegable'> & { delegable?: boolean };

const ENTRIES = {
  // Chats and calls (PD-8 scope decides WHICH conversations).
  'chat.use': { label: { en: 'Use chats', ar: 'استخدام المحادثات' }, risk: 'family_contact', introducedBy: 'PD-8' },
  'chat.manage': { label: { en: 'Create groups and manage members', ar: 'إنشاء المجموعات وإدارة الأعضاء' }, risk: 'family_contact', introducedBy: 'PD-8' },
  'chat.moderate': { label: { en: 'Moderate held messages', ar: 'مراجعة الرسائل المعلّقة' }, risk: 'family_contact', introducedBy: 'PD-14' },
  'chat.export': { label: { en: 'Export a conversation', ar: 'تصدير محادثة' }, risk: 'family_contact', introducedBy: 'PD-37' },
  'calls.use': { label: { en: 'Make and join calls', ar: 'إجراء المكالمات والانضمام إليها' }, risk: 'family_contact', introducedBy: 'PD-19' },

  'stories.view': { label: { en: 'View stories', ar: 'عرض القصص' }, risk: 'none', introducedBy: 'Stories v2' },
  'stories.publish': { label: { en: 'Publish stories', ar: 'نشر القصص' }, risk: 'family_contact', introducedBy: 'Stories v2' },

  'admin.inspect': { label: { en: 'Inspect the whole organization', ar: 'الاطلاع على المؤسسة كاملة' }, risk: 'admin', introducedBy: 'PD-5' },

  'accounts.administer': { label: { en: 'Reset, suspend and reactivate accounts', ar: 'إعادة تعيين الحسابات وإيقافها وتفعيلها' }, risk: 'admin', introducedBy: 'PD-21' },
  'accounts.support_session': { label: { en: 'Open an account as its owner (support)', ar: 'فتح حساب نيابةً عن صاحبه (الدعم)' }, risk: 'admin', introducedBy: 'PD-21' },

  'org.view': { label: { en: 'View the organization structure', ar: 'عرض الهيكل التنظيمي' }, risk: 'pii', introducedBy: 'PD-8' },
  'org.manage': { label: { en: 'Assign supervisors, backups and covers', ar: 'تعيين المشرفين والبدلاء والتغطية' }, risk: 'family_contact', introducedBy: 'PD-8' },
  'org.covers': { label: { en: 'Hand a supervisor over to a backup', ar: 'تسليم المشرف إلى البديل' }, risk: 'family_contact', introducedBy: 'PD-33' },
  'org.departments': { label: { en: 'Create departments and place staff', ar: 'إنشاء الأقسام وتوزيع الموظفين' }, risk: 'admin', introducedBy: 'PD-8' },

  'staff_profiles.team': { label: { en: "View the team's profiles", ar: 'عرض ملفات الفريق' }, risk: 'pii', introducedBy: 'Staff Profiles' },
  'staff_profiles.organization': { label: { en: 'View every staff profile', ar: 'عرض ملفات جميع الموظفين' }, risk: 'pii', introducedBy: 'Staff Profiles' },
  'staff_profiles.manage': { label: { en: 'Assign responsibilities', ar: 'إسناد المسؤوليات' }, risk: 'pii', introducedBy: 'Staff Profiles' },
  'staff_profiles.reporting_lines': { label: { en: 'Change reporting lines', ar: 'تغيير خطوط التبعية' }, risk: 'admin', introducedBy: 'Staff Profiles' },

  'parents.view': { label: { en: 'View parent profiles', ar: 'عرض ملفات أولياء الأمور' }, risk: 'family_contact', introducedBy: 'PD-17' },
  'parents.edit': { label: { en: "Edit a parent's contact record", ar: 'تعديل بيانات تواصل ولي الأمر' }, risk: 'family_contact', introducedBy: 'PD-17' },

  'billing.view': { label: { en: 'View payments and instalments', ar: 'عرض المدفوعات والأقساط' }, risk: 'finance', introducedBy: 'PD-12' },
  'billing.record': { label: { en: 'Record payments and instalments', ar: 'تسجيل المدفوعات والأقساط' }, risk: 'finance', introducedBy: 'PD-17' },
  'billing.assign': { label: { en: "Set a family's billing supervisor", ar: 'تعيين مشرف الفوترة للأسرة' }, risk: 'finance', introducedBy: 'PD-17' },
  'billing.verify': { label: { en: 'Refunds and payment settings', ar: 'الاستردادات وإعدادات الدفع' }, risk: 'finance', introducedBy: 'PD-27' },

  'subscriptions.view': { label: { en: 'View subscriptions', ar: 'عرض الاشتراكات' }, risk: 'finance', introducedBy: 'PD-30' },
  'subscriptions.manage': { label: { en: 'Add free lessons and grant exceptions', ar: 'إضافة حصص مجانية ومنح الاستثناءات' }, risk: 'finance', introducedBy: 'PD-30' },
  // PD-30-amendment-carried-over: only for a child the holder entered, within
  // 14 days, for their own family, with no other package (the database decides).
  'subscriptions.carry_over': { label: { en: 'Carry over a package from Jawwid Core', ar: 'ترحيل باقة الطالب من جوِّد كور' }, risk: 'finance', introducedBy: 'PD-42' },

  'schedule.view': { label: { en: 'View schedules and the calendar', ar: 'عرض الجداول والتقويم' }, risk: 'pii', introducedBy: 'PD-31' },
  'schedule.manage': { label: { en: 'Change schedules', ar: 'تعديل الجداول' }, risk: 'pii', introducedBy: 'PD-31' },

  'lessons.view': { label: { en: 'View lessons and reports', ar: 'عرض الحصص والتقارير' }, risk: 'pii', introducedBy: 'PD-11' },
  'lessons.manage': { label: { en: 'Record lesson outcomes and corrections', ar: 'تسجيل نتائج الحصص والتصحيحات' }, risk: 'pii', introducedBy: 'PD-11' },
  'lessons.courses': { label: { en: 'Manage courses', ar: 'إدارة الدورات' }, risk: 'none', introducedBy: 'PD-15' },
  'students.view': { label: { en: 'View student profiles', ar: 'عرض ملفات الطلاب' }, risk: 'pii', introducedBy: 'PD-17' },
  'students.manage': { label: { en: 'Enrol, transfer and suspend students', ar: 'تسجيل الطلاب ونقلهم وإيقافهم' }, risk: 'pii', introducedBy: 'PD-15' },
  'reports.view': { label: { en: 'View statistics', ar: 'عرض الإحصاءات' }, risk: 'pii', introducedBy: 'PD-15' },

  'trials.view': { label: { en: 'View trial lessons', ar: 'عرض الحصص التجريبية' }, risk: 'pii', introducedBy: 'PD-11' },
  'trials.manage': { label: { en: 'Book and decide trial lessons', ar: 'حجز الحصص التجريبية والبت فيها' }, risk: 'pii', introducedBy: 'PD-11' },
  'new_students.view': { label: { en: 'View new students', ar: 'عرض الطلاب الجدد' }, risk: 'family_contact', introducedBy: 'PD-16' },
  'new_students.manage': { label: { en: 'Assign new students', ar: 'تعيين الطلاب الجدد' }, risk: 'family_contact', introducedBy: 'PD-16' },

  'materials.view': { label: { en: 'Use materials', ar: 'استخدام المواد' }, risk: 'none', introducedBy: 'PD-29' },
  'materials.manage': { label: { en: 'Manage the materials library', ar: 'إدارة مكتبة المواد' }, risk: 'none', introducedBy: 'PD-29' },

  'cases.view': { label: { en: 'View supervision cases', ar: 'عرض حالات الإشراف' }, risk: 'pii', introducedBy: 'PD-35' },
  'cases.manage': { label: { en: 'Open and work supervision cases', ar: 'فتح حالات الإشراف ومتابعتها' }, risk: 'pii', introducedBy: 'PD-35' },

  // Names agreed with PD-41, which owns the certificates workflow and adds the
  // rest of its keys (request.student, request.teacher, story, oversee).
  'certificates.view': { label: { en: 'View certificate requests', ar: 'عرض طلبات الشهادات' }, risk: 'pii', introducedBy: 'PD-12' },
  'certificates.design': { label: { en: 'Design and upload certificates', ar: 'تصميم الشهادات ورفعها' }, risk: 'pii', introducedBy: 'PD-12' },
  'certificates.deliver': { label: { en: 'Send certificates to the family', ar: 'إرسال الشهادات إلى الأسرة' }, risk: 'family_contact', introducedBy: 'PD-12' },
  // PD-41 (owner 2026-10-28): the rest of the Certificates page's keys.
  'certificates.request.student': { label: { en: 'Request student certificates', ar: 'طلب شهادات الطلاب' }, risk: 'pii', introducedBy: 'PD-41' },
  'certificates.request.teacher': { label: { en: 'Request teacher certificates', ar: 'طلب شهادات المعلمين' }, risk: 'pii', introducedBy: 'PD-41' },
  'certificates.story': { label: { en: 'Record consent and publish certificate Stories', ar: 'تسجيل الموافقة ونشر الشهادات في القصص' }, risk: 'family_contact', introducedBy: 'PD-41' },
  'certificates.oversee': { label: { en: 'Oversee every certificate request of the department', ar: 'الإشراف على جميع طلبات شهادات القسم' }, risk: 'pii', introducedBy: 'PD-41' },
  'certificates.types': { label: { en: 'Manage certificate types', ar: 'إدارة أنواع الشهادات' }, risk: 'admin', introducedBy: 'PD-41' },

  'leave.allowance': { label: { en: 'Set leave allowances', ar: 'تحديد رصيد الإجازات' }, risk: 'pii', introducedBy: 'PD-12' },
  // PD-26 amendment (owner 2026-10-27): the Teacher Supervision page -- leave,
  // absences and lateness, complaints, rewards, parent feedback -- for the
  // Teachers department and, for the teachers of their families, Operations.
  // Nothing of the Teacher File itself (teacher_files.*).
  'teacher_supervision.view': { label: { en: 'View the Teacher Supervision page', ar: 'عرض صفحة الإشراف على المعلمين' }, risk: 'pii', introducedBy: 'PD-26' },
  'teacher_supervision.record': { label: { en: 'Record on the Teacher Supervision page', ar: 'التسجيل في صفحة الإشراف على المعلمين' }, risk: 'pii', introducedBy: 'PD-26' },
  'supervision.chats': { label: { en: "Open teachers' supervision chats", ar: 'فتح محادثات الإشراف مع المعلمين' }, risk: 'pii', introducedBy: 'PD-12' },

  'teacher_profiles.review': { label: { en: 'Review teacher profiles', ar: 'مراجعة ملفات المعلمين التعريفية' }, risk: 'pii', introducedBy: 'Teacher Profile V2' },
  'teacher_files.view': { label: { en: 'View Teacher Files', ar: 'عرض ملفات المعلمين' }, risk: 'pii', introducedBy: 'PD-10' },
  'teacher_files.edit': { label: { en: "Edit a teacher's personal record", ar: 'تعديل البيانات الشخصية للمعلم' }, risk: 'pii', introducedBy: 'PD-10' },
  'teacher_files.supervise': { label: { en: 'Write the supervision timeline', ar: 'الكتابة في سجل الإشراف' }, risk: 'pii', introducedBy: 'PD-10' },
  'teacher_files.evaluate': { label: { en: 'Evaluate teachers', ar: 'تقييم المعلمين' }, risk: 'pii', introducedBy: 'PD-26' },
  'teacher_files.finance': { label: { en: 'Teacher payroll', ar: 'رواتب المعلمين' }, risk: 'finance', introducedBy: 'PD-18' },

  // PD-43: adding a teacher (their login, Teacher File and supervisor) and offboarding one.
  'teachers.create': { label: { en: 'Add teachers and give them a sign-in', ar: 'إضافة المعلمين ومنحهم حساب الدخول' }, risk: 'admin', introducedBy: 'PD-43' },
  // Reactivating a former teacher is the super admin's alone (decideTeacherOnboarding), so the label says offboard only.
  'teachers.offboard': { label: { en: 'Offboard teachers', ar: 'إنهاء عمل المعلمين' }, risk: 'admin', introducedBy: 'PD-43' },

  'feedback.view': { label: { en: 'View parent feedback', ar: 'عرض ملاحظات أولياء الأمور' }, risk: 'family_contact', introducedBy: 'PD-32' },
} as const satisfies Record<string, Entry>;

export type PermissionKey = keyof typeof ENTRIES;

export const PERMISSIONS: readonly PermissionDefinition[] = Object.freeze(
  (Object.entries(ENTRIES) as Array<[PermissionKey, Entry]>).map(([key, entry]) => {
    const dot = key.indexOf('.');
    return Object.freeze({
      key,
      page: key.slice(0, dot),
      action: key.slice(dot + 1),
      label: entry.label,
      risk: entry.risk,
      delegable: entry.delegable ?? false,
      introducedBy: entry.introducedBy,
    });
  }),
);

export const PERMISSION_KEYS: ReadonlySet<string> = new Set(PERMISSIONS.map((p) => p.key));

export function isPermissionKey(key: string): key is PermissionKey {
  return PERMISSION_KEYS.has(key);
}
