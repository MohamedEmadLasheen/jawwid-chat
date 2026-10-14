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
 * `purpose` is the one sentence a placeholder shows: what the section is for.
 * `note` is what it is waiting for (or, for a built section, its limits),
 * written for an operator rather than an engineer.
 *
 * `legacy` are the pre-existing Admin Web prototype screens related to an
 * unbuilt section. Most call endpoints that were never built (the 2026-10-12
 * audit found 45 of 54 unrouted), so they are offered behind a disclosure with
 * a warning, never presented as the section.
 */
import type { IconName } from '@/shared/components/Icon'

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

export type AdminGroupKey = 'overview' | 'communication' | 'people' | 'operations' | 'administration'

type Bilingual = { en: string; ar: string }

export interface LegacyScreen {
  path: string
  /** Why this screen will not work for the super admin, when that is known. */
  note?: Bilingual
}

export interface AdminSection {
  key: AdminSectionKey
  group: AdminGroupKey
  icon: IconName
  status: AdminSectionStatus
  /** The page title. */
  label: Bilingual
  /** A shorter name for the sidebar, when the title would not fit there. */
  navLabel?: Bilingual
  purpose: Bilingual
  note: Bilingual
  legacy?: readonly LegacyScreen[]
}

export const ADMIN_GROUPS: readonly { key: AdminGroupKey; label: Bilingual }[] = [
  { key: 'overview', label: { en: 'Overview', ar: 'نظرة عامة' } },
  { key: 'communication', label: { en: 'Communication', ar: 'التواصل' } },
  { key: 'people', label: { en: 'People & teams', ar: 'الأشخاص والفرق' } },
  { key: 'operations', label: { en: 'Operations & performance', ar: 'التشغيل والأداء' } },
  { key: 'administration', label: { en: 'Administration', ar: 'الإدارة' } },
]

const NO_BACKEND: Bilingual = {
  en: 'Its backend has not been built yet.',
  ar: 'لم تُبنَ واجهته الخلفية بعد.',
}

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  /* -------------------------------------------------------------- overview */
  {
    key: 'dashboard',
    group: 'overview',
    icon: 'dashboard',
    status: 'read_only',
    label: { en: 'Dashboard', ar: 'لوحة المتابعة' },
    purpose: {
      en: 'What is happening across the organization, and what needs attention.',
      ar: 'ما يجري في المؤسسة وما يحتاج إلى متابعة.',
    },
    note: {
      en: 'Response times and workload metrics are not built yet.',
      ar: 'مؤشرات أزمنة الرد وعبء العمل لم تُبنَ بعد.',
    },
  },

  /* --------------------------------------------------------- communication */
  {
    key: 'conversations',
    group: 'communication',
    icon: 'conversations',
    status: 'read_only',
    label: { en: 'Conversations', ar: 'المحادثات' },
    purpose: {
      en: 'Every conversation in the organization.',
      ar: 'كل محادثات المؤسسة.',
    },
    note: {
      en: 'Replying is not available to this account.',
      ar: 'الرد غير متاح لهذا الحساب.',
    },
  },
  {
    key: 'stories',
    group: 'communication',
    icon: 'stories',
    status: 'read_only',
    label: { en: 'Stories', ar: 'الحالات' },
    purpose: {
      en: 'Every story in the organization, with its audience and reach.',
      ar: 'كل الحالات في المؤسسة، مع جمهورها ومدى وصولها.',
    },
    note: {
      en: 'Creating, publishing and deleting stories are not available to this account.',
      ar: 'إنشاء الحالات ونشرها وحذفها غير متاح لهذا الحساب.',
    },
    legacy: [
      {
        path: '/stories',
        // GET /stories is the PUBLISHER's list (canPublishStory: admin,
        // coverage, manager). super_admin is refused there with
        // COMM.STORY_CANNOT_PUBLISH on purpose -- it is not family-facing yet.
        note: {
          en: 'The publisher screen is for admin, coverage and manager roles. It is unsupported for Super Admin by design, and the server refuses it.',
          ar: 'شاشة النشر مخصّصة لأدوار المشرف والتغطية والمدير، وهي غير مدعومة لمدير النظام عن قصد ويرفضها الخادم.',
        },
      },
    ],
  },
  {
    key: 'notifications',
    group: 'communication',
    icon: 'notifications',
    status: 'in_development',
    label: { en: 'Notifications & announcements', ar: 'الإشعارات والإعلانات' },
    navLabel: { en: 'Notifications', ar: 'الإشعارات والإعلانات' },
    purpose: {
      en: 'Send announcements to families, teachers and staff.',
      ar: 'إرسال الإعلانات إلى العائلات والمعلمين والموظفين.',
    },
    note: {
      en: 'Push delivery works for messages and calls; announcements have no backend yet.',
      ar: 'الإشعارات تعمل للرسائل والمكالمات؛ الإعلانات لا واجهة خلفية لها بعد.',
    },
  },
  {
    key: 'calls',
    group: 'communication',
    icon: 'calls',
    status: 'in_development',
    label: { en: 'Calls & media', ar: 'المكالمات والوسائط' },
    purpose: {
      en: 'Call history and shared media across the organization.',
      ar: 'سجل المكالمات والوسائط المشتركة في المؤسسة.',
    },
    note: {
      en: 'Calls work in the apps; an organization-wide history has no backend yet.',
      ar: 'المكالمات تعمل في التطبيقات؛ السجل على مستوى المؤسسة لا واجهة خلفية له بعد.',
    },
  },
  {
    key: 'whatsapp',
    group: 'communication',
    icon: 'whatsapp',
    status: 'in_development',
    label: { en: 'WhatsApp Business Center', ar: 'مركز واتساب للأعمال' },
    navLabel: { en: 'WhatsApp Business', ar: 'مركز واتساب للأعمال' },
    purpose: {
      en: 'Manage the organization’s WhatsApp Business channel.',
      ar: 'إدارة قناة واتساب للأعمال الخاصة بالمؤسسة.',
    },
    note: {
      en: 'It needs a product decision before its backend can be built.',
      ar: 'يحتاج قرار منتج قبل بناء واجهته الخلفية.',
    },
  },

  /* ---------------------------------------------------------------- people */
  {
    key: 'users',
    group: 'people',
    icon: 'users',
    status: 'read_only',
    label: { en: 'Users', ar: 'المستخدمون' },
    purpose: {
      en: 'Staff, teachers and family contacts.',
      ar: 'الموظفون والمعلمون وجهات اتصال العائلات.',
    },
    note: {
      en: 'Creating, suspending and resetting accounts is not built yet.',
      ar: 'إنشاء الحسابات وإيقافها وإعادة تعيينها لم يُبنَ بعد.',
    },
  },
  {
    key: 'teams',
    group: 'people',
    icon: 'teams',
    status: 'in_development',
    label: { en: 'Team management', ar: 'إدارة الفرق' },
    purpose: {
      en: 'Organize staff into teams and assign supervisors.',
      ar: 'تنظيم الموظفين في فرق وتعيين المشرفين.',
    },
    note: {
      en: 'There is no team model yet; supervisor assignment comes first.',
      ar: 'لا يوجد نموذج للفرق بعد؛ تعيين المشرفين يأتي أولًا.',
    },
    legacy: [{ path: '/coverage' }],
  },

  /* ------------------------------------------------------------ operations */
  {
    key: 'quality',
    group: 'operations',
    icon: 'quality',
    status: 'in_development',
    label: { en: 'Quality & supervision', ar: 'الجودة والإشراف' },
    purpose: {
      en: 'Review conversation quality and supervise response standards.',
      ar: 'مراجعة جودة المحادثات والإشراف على معايير الرد.',
    },
    note: NO_BACKEND,
  },
  {
    key: 'academy',
    group: 'operations',
    icon: 'academy',
    status: 'in_development',
    label: { en: 'Academy operations', ar: 'عمليات الأكاديمية' },
    purpose: {
      en: 'Day-to-day academy operations that touch communication.',
      ar: 'العمليات اليومية للأكاديمية المرتبطة بالتواصل.',
    },
    note: {
      en: 'Schedules, attendance and subscriptions belong to Jawwid Core and are not shown here.',
      ar: 'الجداول والحضور والاشتراكات تخص جوّد كور ولا تُعرض هنا.',
    },
  },
  {
    key: 'tasks',
    group: 'operations',
    icon: 'tasks',
    status: 'in_development',
    label: { en: 'Tasks & follow-ups', ar: 'المهام والمتابعات' },
    purpose: {
      en: 'Track follow-ups and tasks across teams.',
      ar: 'متابعة المهام والمتابعات عبر الفرق.',
    },
    note: {
      en: 'A prototype screen exists, but its backend was never built.',
      ar: 'توجد شاشة تجريبية، لكن واجهتها الخلفية لم تُبنَ.',
    },
    legacy: [{ path: '/tasks' }],
  },
  {
    key: 'forms',
    group: 'operations',
    icon: 'forms',
    status: 'in_development',
    label: { en: 'Forms & surveys', ar: 'النماذج والاستبيانات' },
    purpose: {
      en: 'Collect structured feedback from families and staff.',
      ar: 'جمع ملاحظات منظمة من العائلات والموظفين.',
    },
    note: NO_BACKEND,
  },
  {
    key: 'reports',
    group: 'operations',
    icon: 'reports',
    status: 'in_development',
    label: { en: 'Reports & analytics', ar: 'التقارير والتحليلات' },
    purpose: {
      en: 'Trends in communication volume and response performance.',
      ar: 'اتجاهات حجم التواصل وأداء الرد.',
    },
    note: NO_BACKEND,
  },

  /* -------------------------------------------------------- administration */
  {
    key: 'integrations',
    group: 'administration',
    icon: 'integrations',
    status: 'in_development',
    label: { en: 'Integrations', ar: 'التكاملات' },
    purpose: {
      en: 'Connect Jawwid Chat with external services.',
      ar: 'ربط جوّد للمحادثات بالخدمات الخارجية.',
    },
    note: NO_BACKEND,
  },
  {
    key: 'approvals',
    group: 'administration',
    icon: 'approvals',
    status: 'in_development',
    label: { en: 'Approvals', ar: 'الموافقات' },
    purpose: {
      en: 'Review requests that need an administrator’s approval.',
      ar: 'مراجعة الطلبات التي تحتاج موافقة الإدارة.',
    },
    note: {
      en: 'Message moderation exists for family-facing staff; administrator approvals are not wired yet.',
      ar: 'مراجعة الرسائل موجودة لموظفي العائلات؛ موافقات الإدارة غير موصولة بعد.',
    },
  },
  {
    key: 'audit',
    group: 'administration',
    icon: 'audit',
    status: 'in_development',
    label: { en: 'Audit log', ar: 'سجل التدقيق' },
    purpose: {
      en: 'A record of sensitive actions: who did what, and when.',
      ar: 'سجل للإجراءات الحساسة: من فعل ماذا ومتى.',
    },
    note: {
      en: 'Actions are already being recorded; a screen to read them is not built yet.',
      ar: 'الإجراءات تُسجَّل بالفعل؛ لم تُبنَ شاشة لقراءتها بعد.',
    },
  },
  {
    key: 'settings',
    group: 'administration',
    icon: 'settings',
    status: 'in_development',
    label: { en: 'System settings', ar: 'إعدادات النظام' },
    purpose: {
      en: 'Organization-wide configuration.',
      ar: 'إعدادات المؤسسة العامة.',
    },
    note: NO_BACKEND,
  },
]

export function adminSectionPath(key: AdminSectionKey): string {
  return `/admin/${key}`
}

export function findAdminSection(key: string | undefined): AdminSection | undefined {
  return ADMIN_SECTIONS.find((s) => s.key === key)
}

export function sectionsInGroup(group: AdminGroupKey): AdminSection[] {
  return ADMIN_SECTIONS.filter((s) => s.group === group)
}
