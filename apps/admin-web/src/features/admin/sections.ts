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

/** `managed`: built, and its controls act (PD-8 organization structure). */
export type AdminSectionStatus = 'read_only' | 'managed' | 'in_development'

export type AdminSectionKey =
  | 'dashboard'
  | 'conversations'
  | 'users'
  | 'teams'
  | 'teachers'
  | 'instalments'
  | 'parents'
  | 'payments'
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
    navLabel: { en: 'All conversations', ar: 'كل المحادثات' },
    purpose: {
      en: 'Every conversation in the organization.',
      ar: 'كل محادثات المؤسسة.',
    },
    note: {
      en: 'A read-only view. Reply from Chat.',
      ar: 'عرض للقراءة فقط. الرد من الدردشة.',
    },
  },
  {
    key: 'stories',
    group: 'communication',
    icon: 'stories',
    // 2026-10-17: the super admin publishes. Create, target, publish, delete
    // and the analytics all act against the real /stories API.
    status: 'managed',
    label: { en: 'Stories', ar: 'الحالات' },
    purpose: {
      en: 'Publish stories to exactly the people they are for, and see how each one performs.',
      ar: 'انشر الحالات للأشخاص المقصودين بالضبط، وتابع أداء كل حالة.',
    },
    note: {
      en: 'Country and subscription plan come from Jawwid Core once it is connected; until then they are set under Audience data.',
      ar: 'تأتي الدولة وباقة الاشتراك من نظام جوّد الأساسي عند ربطه، وحتى ذلك الحين تُعيَّن من «بيانات الجمهور».',
    },
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
    // PD-13: the Calls page -- this account's voice calls, scheduled calls and
    // call links. Its controls act (start, schedule, join, cancel), each
    // decided by the server.
    status: 'managed',
    label: { en: 'Calls', ar: 'المكالمات' },
    purpose: {
      en: 'Start voice calls, schedule calls and share members-only call links.',
      ar: 'بدء المكالمات الصوتية وجدولة المكالمات ومشاركة روابط مكالمات للأعضاء فقط.',
    },
    note: {
      en: 'This account’s own calls. An organization-wide call history and shared media have no backend yet.',
      ar: 'مكالمات هذا الحساب فقط. لا واجهة خلفية بعد لسجل المكالمات على مستوى المؤسسة ولا للوسائط المشتركة.',
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
      en: 'Read-only here. Resetting and suspending accounts, staff accounts and their roles are on the Accounts page.',
      ar: 'للعرض فقط هنا. إعادة تعيين الحسابات وإيقافها، وحسابات الموظفين وأدوارها في صفحة الحسابات.',
    },
  },
  {
    key: 'teams',
    group: 'people',
    icon: 'teams',
    status: 'managed',
    label: { en: 'Organization', ar: 'الهيكل التنظيمي' },
    purpose: {
      en: 'Departments, each child’s supervisor, and backup supervisors.',
      ar: 'الأقسام، ومشرف كل طفل، والمشرفون البدلاء.',
    },
    note: {
      en: 'Changes are checked by the server and recorded with their reason. Reporting lines and responsibilities stay in My profile → Organization overview.',
      ar: 'يتحقق الخادم من التغييرات ويسجّلها مع سببها. تبقى خطوط التبعية والمسؤوليات في ملفي الشخصي ← نظرة عامة على المؤسسة.',
    },
  },
  {
    key: 'teachers',
    group: 'people',
    icon: 'users',
    // PD-10: the administration-only Teacher File, against /teacher-files.
    status: 'managed',
    label: { en: 'Teachers', ar: 'المعلمون' },
    purpose: {
      en: 'Each teacher’s file: personal information, assigned students and supervision notes.',
      ar: 'ملف كل معلم: البيانات الشخصية والطلاب المسندون وملاحظات الإشراف.',
    },
    note: {
      en: 'Schedule and workload arrive with the lesson system; salary is shown from Jawwid Core once it offers it.',
      ar: 'الجدول وعبء العمل يأتيان مع نظام الدروس، والراتب يُعرض من نظام جوّد الأساسي عند توفيره.',
    },
  },

  /* ------------------------------------------------------------ operations */
  {
    key: 'instalments',
    group: 'operations',
    icon: 'calendar',
    // PD-12 S3 / PD-17: the instalments recorded in Chat, as a queue.
    status: 'read_only',
    label: { en: 'Instalment payments', ar: 'الأقساط' },
    purpose: {
      en: 'Every family’s open instalments, overdue first, with the supervisor responsible for each.',
      ar: 'الأقساط المفتوحة لكل أسرة، المتأخر أولًا، مع المشرف المسؤول عن كل قسط.',
    },
    note: {
      en: 'Instalments and payments are recorded on each family’s Parent Profile, in Jawwid Chat.',
      ar: 'تُسجَّل الأقساط والمدفوعات في ملف ولي الأمر لكل أسرة، داخل جوّد للمحادثات.',
    },
  },
  {
    key: 'parents',
    group: 'operations',
    icon: 'users',
    // PD-17: contact information, the internal note, payments. Administration only.
    status: 'managed',
    label: { en: 'Parents', ar: 'أولياء الأمور' },
    purpose: {
      en: 'Each parent’s profile: contact information, children, subscription, payment method and payment timeline.',
      ar: 'ملف كل ولي أمر: بيانات التواصل والأطفال والاشتراك وطريقة الدفع وسجل المدفوعات.',
    },
    note: {
      en: 'Administration only. Teachers never see a parent’s profile or payments.',
      ar: 'للإدارة فقط. لا يرى المعلمون ملف ولي الأمر ولا مدفوعاته.',
    },
  },
  {
    key: 'payments',
    group: 'operations',
    icon: 'tag',
    // PD-27: bank-transfer receipts to verify, and the academy's payment settings.
    status: 'managed',
    label: { en: 'Payments', ar: 'المدفوعات' },
    purpose: {
      en: 'Bank-transfer receipts waiting for verification, the bank account parents pay into, the invoice issuer and the reminder policy.',
      ar: 'إيصالات التحويل البنكي بانتظار التحقق، والحساب البنكي الذي يدفع إليه أولياء الأمور، وجهة إصدار الفواتير وسياسة التذكير.',
    },
    note: {
      en: 'Payment requests, cash and refunds are recorded on each family’s Parent Profile. A card payment exists only once Stripe confirms it.',
      ar: 'تُسجَّل طلبات الدفع والمدفوعات النقدية والاستردادات في ملف ولي الأمر لكل أسرة. ولا توجد دفعة البطاقة إلا بعد تأكيد Stripe.',
    },
  },
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
    status: 'read_only',
    label: { en: 'Reports & analytics', ar: 'التقارير والتحليلات' },
    purpose: {
      en: 'Teacher statistics: lessons by outcome and length, reports on time, replies to families, workload.',
      ar: 'إحصائيات المعلمين: الحصص حسب النتيجة والمدة، والتقارير في موعدها، والرد على الأسر، وعبء العمل.',
    },
    note: {
      en: 'Counted by the server from the lessons themselves (PD-11). Read-only.',
      ar: 'يحسبها الخادم من الحصص نفسها (PD-11). للاطلاع فقط.',
    },
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
      en: 'Messages no longer need approval (PD-14): admins edit or delete them in the chat after sending. Administrator approvals are not wired yet.',
      ar: 'لم تعد الرسائل تحتاج موافقة: يعدّلها المشرفون أو يحذفونها في المحادثة بعد إرسالها. موافقات الإدارة غير موصولة بعد.',
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
