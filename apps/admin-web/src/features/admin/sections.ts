/**
 * The Admin Portal's sections, and the honest state of each.
 *
 * ONE REGISTRY, so the navigation, the routes and the tests read the same list
 * and cannot disagree about what exists. Adding a section is one entry here.
 *
 * `status` is a claim about the BACKEND, not about the page:
 *
 *   read_only       a real `/admin/*` endpoint answers it, against the real
 *                   database, for super_admin only. Nothing on it writes.
 *   in_development  no endpoint exists. The page says so and shows no data --
 *                   a plausible-looking zero would be worse than an absence,
 *                   because an operator can act on a number.
 *
 * `legacy` are the pre-existing Admin Web screens related to a section. They
 * are reachable, but most call endpoints that were never built (the 2026-10-12
 * audit found 45 of 54 unrouted), so they are linked with a warning rather than
 * presented as the section. A link that is unsupported for super_admin BY
 * DESIGN says so in its own `note`.
 */

export type AdminSectionStatus = 'read_only' | 'in_development'

export type AdminSectionKey =
  | 'dashboard'
  | 'conversations'
  | 'users'
  | 'teams'
  | 'stories'
  | 'quality'
  | 'reports'
  | 'notifications'
  | 'calls'
  | 'academy'
  | 'integrations'
  | 'audit'
  | 'forms'
  | 'whatsapp'
  | 'tasks'
  | 'approvals'
  | 'settings'

export interface LegacyScreen {
  path: string
  /** Why this screen will not work for the super admin, when that is known. */
  note?: { en: string; ar: string }
}

export interface AdminSection {
  key: AdminSectionKey
  status: AdminSectionStatus
  label: { en: string; ar: string }
  /** What backs it today, or what it is waiting for. Shown on the page. */
  note: { en: string; ar: string }
  legacy?: readonly LegacyScreen[]
}

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  {
    key: 'dashboard',
    status: 'read_only',
    label: { en: 'Dashboard', ar: 'لوحة المتابعة' },
    note: {
      en: 'Live counts from GET /admin/overview. Operational metrics (response times, workload) are not built yet.',
      ar: 'أرقام حية من GET /admin/overview. مؤشرات التشغيل (أزمنة الرد، عبء العمل) لم تُبنَ بعد.',
    },
    legacy: [{ path: '/dashboard' }],
  },
  {
    key: 'conversations',
    status: 'read_only',
    label: { en: 'Inbox / Conversations', ar: 'الوارد والمحادثات' },
    note: {
      en: 'Every conversation in the organization, read-only. Replying is not available to super_admin yet.',
      ar: 'كل محادثات المؤسسة، للقراءة فقط. الرد غير متاح لمدير النظام بعد.',
    },
    legacy: [{ path: '/inbox' }, { path: '/families' }],
  },
  {
    key: 'users',
    status: 'read_only',
    label: { en: 'Users', ar: 'المستخدمون' },
    note: {
      en: 'Staff, teachers and contacts, read-only. Creating, suspending and resetting accounts is not built yet.',
      ar: 'الموظفون والمعلمون وجهات الاتصال، للقراءة فقط. إنشاء الحسابات وإيقافها وإعادة تعيينها لم يُبنَ بعد.',
    },
  },
  {
    key: 'teams',
    status: 'in_development',
    label: { en: 'Team Management', ar: 'إدارة الفرق' },
    note: {
      en: 'There is no team model in the database yet. Supervisor assignment (Phase 1) comes first.',
      ar: 'لا يوجد نموذج للفرق في قاعدة البيانات بعد. تعيين المشرفين (المرحلة 1) يأتي أولًا.',
    },
    legacy: [{ path: '/coverage' }],
  },
  {
    key: 'stories',
    status: 'read_only',
    label: { en: 'Stories', ar: 'الحالات' },
    note: {
      en: 'Every story in the organization, read-only, from GET /admin/stories. Creating, publishing and deleting stories are not available to super_admin.',
      ar: 'كل الحالات في المؤسسة، للقراءة فقط، من GET /admin/stories. إنشاء الحالات ونشرها وحذفها غير متاح لمدير النظام.',
    },
    legacy: [
      {
        path: '/stories',
        // GET /stories is the PUBLISHER's list (canPublishStory: admin,
        // coverage, manager). super_admin is refused there with
        // COMM.STORY_CANNOT_PUBLISH on purpose -- it is not family-facing yet.
        note: {
          en: 'Publisher screen (admin, coverage, manager). Unsupported for super_admin by design: the server refuses it.',
          ar: 'شاشة النشر (المشرف والتغطية والمدير). غير مدعومة لمدير النظام عن قصد: الخادم يرفضها.',
        },
      },
    ],
  },
  {
    key: 'quality',
    status: 'in_development',
    label: { en: 'Quality & Supervision', ar: 'الجودة والإشراف' },
    note: { en: 'No backend yet.', ar: 'لا توجد واجهة خلفية بعد.' },
  },
  {
    key: 'reports',
    status: 'in_development',
    label: { en: 'Reports & Analytics', ar: 'التقارير والتحليلات' },
    note: { en: 'No backend yet.', ar: 'لا توجد واجهة خلفية بعد.' },
  },
  {
    key: 'notifications',
    status: 'in_development',
    label: { en: 'Notifications & Announcements', ar: 'الإشعارات والإعلانات' },
    note: {
      en: 'Push delivery exists for messages and calls; there is no admin announcement endpoint yet.',
      ar: 'إرسال الإشعارات موجود للرسائل والمكالمات؛ لا توجد واجهة إعلانات للإدارة بعد.',
    },
  },
  {
    key: 'calls',
    status: 'in_development',
    label: { en: 'Calls & Media', ar: 'المكالمات والوسائط' },
    note: {
      en: 'Calls work for parents, teachers and staff; there is no admin call history endpoint yet.',
      ar: 'المكالمات تعمل لأولياء الأمور والمعلمين والموظفين؛ لا توجد واجهة لسجل المكالمات للإدارة بعد.',
    },
  },
  {
    key: 'academy',
    status: 'in_development',
    label: { en: 'Academy Operations', ar: 'عمليات الأكاديمية' },
    note: {
      en: 'Schedules, attendance and subscriptions belong to Jawwid Core and are not shown here.',
      ar: 'الجداول والحضور والاشتراكات تخص جوّد كور ولا تُعرض هنا.',
    },
  },
  {
    key: 'integrations',
    status: 'in_development',
    label: { en: 'Integrations', ar: 'التكاملات' },
    note: { en: 'No backend yet.', ar: 'لا توجد واجهة خلفية بعد.' },
  },
  {
    key: 'audit',
    status: 'in_development',
    label: { en: 'Audit Log', ar: 'سجل التدقيق' },
    note: {
      en: 'chat.audit_log is written (including this account’s bootstrap); a read endpoint is not built yet.',
      ar: 'يُكتب سجل التدقيق (بما في ذلك تهيئة هذا الحساب)؛ لم تُبنَ واجهة لقراءته بعد.',
    },
  },
  {
    key: 'forms',
    status: 'in_development',
    label: { en: 'Forms & Surveys', ar: 'النماذج والاستبيانات' },
    note: { en: 'No backend yet.', ar: 'لا توجد واجهة خلفية بعد.' },
  },
  {
    key: 'whatsapp',
    status: 'in_development',
    label: { en: 'WhatsApp Business Center', ar: 'مركز واتساب للأعمال' },
    note: {
      en: 'No backend yet, and it needs a product decision record first.',
      ar: 'لا توجد واجهة خلفية بعد، ويحتاج قرار منتج أولًا.',
    },
  },
  {
    key: 'tasks',
    status: 'in_development',
    label: { en: 'Tasks & Follow-ups', ar: 'المهام والمتابعات' },
    note: {
      en: 'A prototype screen exists, but its endpoints were never built.',
      ar: 'توجد شاشة تجريبية، لكن واجهاتها الخلفية لم تُبنَ.',
    },
    legacy: [{ path: '/tasks' }],
  },
  {
    key: 'approvals',
    status: 'in_development',
    label: { en: 'Approvals', ar: 'الموافقات' },
    note: {
      en: 'Message moderation exists for family-facing staff; super_admin approval is not wired yet.',
      ar: 'مراجعة الرسائل موجودة لموظفي العائلات؛ موافقات مدير النظام غير موصولة بعد.',
    },
  },
  {
    key: 'settings',
    status: 'in_development',
    label: { en: 'System Settings', ar: 'إعدادات النظام' },
    note: { en: 'No backend yet.', ar: 'لا توجد واجهة خلفية بعد.' },
  },
]

export function adminSectionPath(key: AdminSectionKey): string {
  return `/admin/${key}`
}

export function findAdminSection(key: string | undefined): AdminSection | undefined {
  return ADMIN_SECTIONS.find((s) => s.key === key)
}
