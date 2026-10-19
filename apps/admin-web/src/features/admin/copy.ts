import { useCallback } from 'react'
import { LOCALE_TAG, useI18n } from '@/core/i18n/I18nProvider'
import type { Locale } from '@/core/i18n/messages'

/**
 * The Admin Portal's words, in both languages, in one place.
 *
 * Enum values from the API (a conversation type, a story state, an account
 * status) are NEVER rendered raw: each has a label here. A value the API adds
 * later that has no label yet falls back to the value itself, so it shows up
 * as visibly untranslated rather than silently disappearing.
 */
export type Bilingual = { en: string; ar: string }

export function useText() {
  const { locale } = useI18n()
  return useCallback((b: Bilingual) => (locale === 'ar' ? b.ar : b.en), [locale])
}

export function useLabel() {
  const tx = useText()
  return useCallback(
    (map: Record<string, Bilingual>, value: string | null | undefined) =>
      value == null ? '' : map[value] ? tx(map[value]) : value,
    [tx],
  )
}

export const TEXT = {
  // shell
  adminPortal: { en: 'Admin Portal', ar: 'بوابة الإدارة' },
  operations: { en: 'Operations', ar: 'العمليات' },
  readOnlyAccess: { en: 'Read-only access', ar: 'وصول للقراءة فقط' },
  readOnlyAccessHint: {
    en: 'This account can view the organization but cannot change anything.',
    ar: 'يمكن لهذا الحساب عرض المؤسسة دون تعديل أي شيء.',
  },
  inDevelopment: { en: 'In development', ar: 'قيد التطوير' },

  // common
  refresh: { en: 'Refresh', ar: 'تحديث' },
  updatedAt: { en: 'Updated {time}', ar: 'آخر تحديث {time}' },
  searchByName: { en: 'Search by name', ar: 'ابحث بالاسم' },
  clearSearch: { en: 'Clear search', ar: 'مسح البحث' },
  clearFilters: { en: 'Clear filters', ar: 'مسح عوامل التصفية' },
  all: { en: 'All', ar: 'الكل' },
  noMatches: { en: 'Nothing matches these filters.', ar: 'لا توجد نتائج مطابقة.' },
  truncated: {
    en: 'Showing the first 200. Narrow the list with search or filters.',
    ar: 'تُعرض أول 200 فقط. ضيّق القائمة بالبحث أو التصفية.',
  },
  notFound: { en: 'There is no such section.', ar: 'لا يوجد قسم بهذا الاسم.' },
  viewAll: { en: 'View all', ar: 'عرض الكل' },
  details: { en: 'Details', ar: 'التفاصيل' },
  dash: { en: '—', ar: '—' },
  yesterday: { en: 'Yesterday', ar: 'أمس' },

  // placeholder
  placeholderTitle: { en: 'This section is in development.', ar: 'هذا القسم قيد التطوير.' },
  availableNow: { en: 'Available now in this group', ar: 'متاح الآن في هذه المجموعة' },
  forbiddenHint: {
    en: 'Your role does not include this area. If you need it, ask an administrator.',
    ar: 'دورك لا يشمل هذا القسم. إن كنت تحتاج إليه، فاطلب ذلك من أحد المسؤولين.',
  },
  goToStart: { en: 'Go to your start page', ar: 'الانتقال إلى صفحتك الرئيسية' },
  prototypeTitle: { en: 'Earlier prototype screen', ar: 'شاشة تجريبية سابقة' },
  prototypeWarn: {
    en: 'It predates the current API and most of what it requests does not exist, so expect errors.',
    ar: 'هي أقدم من الواجهة الحالية ومعظم ما تطلبه غير موجود، لذا توقّع ظهور أخطاء.',
  },

  // dashboard
  families: { en: 'Families', ar: 'العائلات' },
  conversations: { en: 'Conversations', ar: 'المحادثات' },
  messages: { en: 'Messages', ar: 'الرسائل' },
  people: { en: 'People', ar: 'الأشخاص' },
  needsAttention: { en: 'Needs attention', ar: 'يحتاج إلى متابعة' },
  nothingNeedsAttention: { en: 'Nothing needs attention right now.', ar: 'لا شيء يحتاج إلى متابعة الآن.' },
  waitingOnUsItem: { en: 'Conversations waiting on a reply from us', ar: 'محادثات بانتظار ردّنا' },
  draftStoriesItem: { en: 'Stories still in draft', ar: 'حالات ما زالت مسودة' },
  recentConversations: { en: 'Recent conversations', ar: 'أحدث المحادثات' },
  noConversations: { en: 'No conversations yet.', ar: 'لا توجد محادثات بعد.' },
  staffByRole: { en: 'Staff by role', ar: 'الموظفون حسب الدور' },
  signIns: { en: 'Sign-in accounts', ar: 'حسابات الدخول' },
  storiesByState: { en: 'Stories', ar: 'الحالات' },
  active: { en: 'Active', ar: 'نشط' },
  inactive: { en: 'Inactive', ar: 'غير نشط' },
  none: { en: 'None yet', ar: 'لا يوجد بعد' },

  // conversations
  allTypes: { en: 'All types', ar: 'كل الأنواع' },
  filterByType: { en: 'Conversation type', ar: 'نوع المحادثة' },
  groups: { en: 'Groups', ar: 'المجموعات' },
  filterByStatus: { en: 'Conversation status', ar: 'حالة المحادثة' },
  untitled: { en: 'Untitled conversation', ar: 'محادثة بلا عنوان' },
  selectConversation: { en: 'Select a conversation', ar: 'اختر محادثة' },
  selectConversationHint: {
    en: 'Its messages appear here, read-only.',
    ar: 'تظهر رسائلها هنا للقراءة فقط.',
  },
  backToList: { en: 'Back to conversations', ar: 'العودة إلى المحادثات' },
  conversationNotLoaded: { en: 'This conversation isn’t in the loaded list.', ar: 'هذه المحادثة ليست ضمن القائمة المحمّلة.' },
  onlyRecentLoaded: {
    en: 'Only the 200 most recently active conversations are loaded.',
    ar: 'تُحمَّل أحدث 200 محادثة نشاطًا فقط.',
  },
  refreshIfNew: { en: 'If it was created recently, refresh the list.', ar: 'إن كانت حديثة الإنشاء، حدّث القائمة.' },
  showDetails: { en: 'Conversation details', ar: 'تفاصيل المحادثة' },
  noMessages: { en: 'No messages in this conversation yet.', ar: 'لا توجد رسائل في هذه المحادثة بعد.' },
  latestMessages: { en: 'Showing the latest {n} messages.', ar: 'تُعرض آخر {n} رسالة.' },
  deleted: { en: 'This message was deleted.', ar: 'تم حذف هذه الرسالة.' },
  internal: { en: 'Internal note', ar: 'ملاحظة داخلية' },
  unknownAuthor: { en: 'Unknown sender', ar: 'مرسل غير معروف' },
  readOnlyComposer: {
    en: 'This view is read-only.',
    ar: 'هذا العرض للقراءة فقط.',
  },
  replyInChat: { en: 'Reply in Chat', ar: 'الرد في الدردشة' },
  today: { en: 'Today', ar: 'اليوم' },
  status: { en: 'Status', ar: 'الحالة' },
  type: { en: 'Type', ar: 'النوع' },
  family: { en: 'Family', ar: 'العائلة' },
  membersLabel: { en: 'Members', ar: 'الأعضاء' },
  lastActivity: { en: 'Last activity', ar: 'آخر نشاط' },
  started: { en: 'Started', ar: 'بدأت' },
  archived: { en: 'Archived', ar: 'مؤرشفة' },
  reference: { en: 'Reference', ar: 'المعرّف' },

  // users
  name: { en: 'Name', ar: 'الاسم' },
  role: { en: 'Role', ar: 'الدور' },
  signIn: { en: 'Sign-in', ar: 'الدخول' },
  lastSignIn: { en: 'Last sign-in', ar: 'آخر دخول' },
  never: { en: 'Never', ar: 'لم يدخل بعد' },
  noLogin: { en: 'No login', ar: 'بلا حساب دخول' },
  allStatuses: { en: 'All statuses', ar: 'كل الحالات' },
  filterByAccountStatus: { en: 'Status', ar: 'الحالة' },
  profile: { en: 'Profile', ar: 'الملف' },
  record: { en: 'Record', ar: 'السجل' },
  added: { en: 'Added', ar: 'أُضيف' },
  familyReference: { en: 'Family reference', ar: 'معرّف العائلة' },
  noUsers: { en: 'No users yet.', ar: 'لا يوجد مستخدمون بعد.' },

  // stories
  title: { en: 'Title', ar: 'العنوان' },
  author: { en: 'Author', ar: 'الناشر' },
  audience: { en: 'Audience', ar: 'الجمهور' },
  views: { en: 'Views', ar: 'المشاهدات' },
  date: { en: 'Date', ar: 'التاريخ' },
  expires: { en: 'Expires', ar: 'تنتهي' },
  created: { en: 'Created', ar: 'أُنشئت' },
  published: { en: 'Published', ar: 'نُشرت' },
  deletedOn: { en: 'Deleted', ar: 'حُذفت' },
  untitledStory: { en: 'Untitled story', ar: 'حالة بلا عنوان' },
  noStories: { en: 'No stories yet.', ar: 'لا توجد حالات بعد.' },
  searchStories: { en: 'Search title or author', ar: 'ابحث بالعنوان أو الناشر' },
  publishingUnavailable: { en: 'Publishing isn’t available to this account.', ar: 'النشر غير متاح لهذا الحساب.' },

  // redesign: dashboard
  attentionAllClear: { en: 'All clear', ar: 'لا شيء معلّق' },
  oldestWaiting: { en: 'Oldest activity {age}', ar: 'أقدم نشاط {age}' },
  groupConversations: { en: 'Group', ar: 'جماعية' },
  openQueue: { en: 'Open queue', ar: 'افتح القائمة' },
  reviewDrafts: { en: 'Review drafts', ar: 'راجع المسودات' },
  notYetPublished: { en: 'Not yet published', ar: 'لم تُنشر بعد' },
  staleData: { en: 'Couldn’t refresh. Showing figures from {time}.', ar: 'تعذّر التحديث. تُعرض الأرقام كما كانت في {time}.' },
  conversationStatus: { en: 'Conversation status', ar: 'حالة المحادثات' },
  basedOnRecent: { en: 'Based on the {n} most recently active.', ar: 'بحسب أحدث {n} محادثة نشاطًا.' },
  teamAndAccess: { en: 'Team & access', ar: 'الفريق والوصول' },
  recentActivity: { en: 'Recent activity', ar: 'آخر النشاط' },
  conversation: { en: 'Conversation', ar: 'المحادثة' },
  familyContacts: { en: 'Family contacts', ar: 'جهات اتصال العائلات' },
  ofTotal: { en: '{part} of {total}', ar: '{part} من {total}' },

  // redesign: conversations
  sortBy: { en: 'Sort', ar: 'الترتيب' },
  sortRecent: { en: 'Most recent', ar: 'الأحدث نشاطًا' },
  sortOldest: { en: 'Oldest first', ar: 'الأقدم أولًا' },
  sortName: { en: 'Name', ar: 'الاسم' },
  sortSignIn: { en: 'Recent sign-in', ar: 'آخر دخول' },
  sortNewestAdded: { en: 'Newest added', ar: 'الأحدث إضافة' },
  groupToday: { en: 'Today', ar: 'اليوم' },
  groupYesterday: { en: 'Yesterday', ar: 'أمس' },
  groupWeek: { en: 'Earlier this week', ar: 'في وقت سابق هذا الأسبوع' },
  groupOlder: { en: 'Older', ar: 'أقدم' },
  resizeList: { en: 'Resize conversation list', ar: 'تغيير عرض قائمة المحادثات' },
  lastActive: { en: 'Active {age}', ar: 'نشطة {age}' },
  detailsConversation: { en: 'Conversation', ar: 'المحادثة' },
  detailsActivity: { en: 'Activity', ar: 'النشاط' },
  copyReference: { en: 'Copy reference', ar: 'نسخ المعرّف' },
  copied: { en: 'Copied', ar: 'تم النسخ' },
  readOnlyTitle: { en: 'Read-only', ar: 'للقراءة فقط' },

  // redesign: stories
  storiesReadOnly: { en: 'Read-only view of every story in the organization.', ar: 'عرض للقراءة فقط لكل الحالات في المؤسسة.' },
  sortNewest: { en: 'Newest first', ar: 'الأحدث أولًا' },
  sortMostViewed: { en: 'Most viewed', ar: 'الأكثر مشاهدة' },
  sortAudience: { en: 'Largest audience', ar: 'الجمهور الأكبر' },
  // Arabic uses one word for "story" and "status"; the column next to Status says "title".
  story: { en: 'Story', ar: 'العنوان' },
  reach: { en: 'Reach', ar: 'الوصول' },
  viewedOf: { en: '{views} of {recipients} viewed', ar: 'شاهدها {views} من {recipients}' },
  notPublishedYet: { en: 'Not published', ar: 'غير منشورة' },
  expiresIn: { en: 'Expires {when}', ar: 'تنتهي {when}' },
  expiredAgo: { en: 'Expired {when}', ar: 'انتهت {when}' },
  publishedAgo: { en: 'Published {when}', ar: 'نُشرت {when}' },
  createdAgo: { en: 'Created {when}', ar: 'أُنشئت {when}' },
  deletedAgo: { en: 'Deleted {when}', ar: 'حُذفت {when}' },
  noExpiry: { en: 'No expiry', ar: 'بلا انتهاء' },
  viewRate: { en: 'View rate', ar: 'نسبة المشاهدة' },
  timeline: { en: 'Timeline', ar: 'التسلسل الزمني' },
  noStoriesHint: {
    en: 'Stories are created by admin, coverage and manager roles in the publisher screen.',
    ar: 'تُنشأ الحالات من شاشة النشر بواسطة أدوار المشرف والتغطية والمدير.',
  },
  results: { en: '{n} shown', ar: 'المعروض: {n}' },
} satisfies Record<string, Bilingual>

/* ---------------------------------------------------------------- plurals */

/**
 * A count with its noun, by the locale's plural rules. Arabic has six forms
 * (zero, one, two, few, many, other); "1 members" and "٣ عضو" are both wrong.
 */
export type Plural = {
  en: { one: string; other: string }
  ar: { zero?: string; one: string; two: string; few: string; many: string; other: string }
}

export const PLURAL = {
  members: {
    en: { one: '{n} member', other: '{n} members' },
    ar: { one: 'عضو واحد', two: 'عضوان', few: '{n} أعضاء', many: '{n} عضوًا', other: '{n} عضو' },
  },
  people: {
    en: { one: '{n} person', other: '{n} people' },
    ar: { one: 'شخص واحد', two: 'شخصان', few: '{n} أشخاص', many: '{n} شخصًا', other: '{n} شخص' },
  },
  stories: {
    en: { one: '{n} story', other: '{n} stories' },
    ar: { one: 'حالة واحدة', two: 'حالتان', few: '{n} حالات', many: '{n} حالة', other: '{n} حالة' },
  },
  contacts: {
    en: { one: '{n} family contact', other: '{n} family contacts' },
    ar: { one: 'جهة اتصال واحدة', two: 'جهتا اتصال', few: '{n} جهات اتصال', many: '{n} جهة اتصال', other: '{n} جهة اتصال' },
  },
  staff: {
    en: { one: '{n} staff member', other: '{n} staff' },
    ar: { one: 'موظف واحد', two: 'موظفان', few: '{n} موظفين', many: '{n} موظفًا', other: '{n} موظف' },
  },
  teachers: {
    en: { one: '{n} teacher', other: '{n} teachers' },
    ar: { one: 'معلم واحد', two: 'معلمان', few: '{n} معلمين', many: '{n} معلمًا', other: '{n} معلم' },
  },
  attachments: {
    en: { one: '{n} attachment', other: '{n} attachments' },
    ar: { one: 'مرفق واحد', two: 'مرفقان', few: '{n} مرفقات', many: '{n} مرفقًا', other: '{n} مرفق' },
  },
} satisfies Record<string, Plural>

export function usePlural() {
  const { locale, number } = useI18n()
  return useCallback(
    (p: Plural, n: number) => {
      const category = pluralRules(locale).select(n)
      const forms: Record<string, string | undefined> = locale === 'ar' ? p.ar : p.en
      const template = forms[category] ?? forms.other ?? ''
      return fill(template, { n: number(n) })
    },
    [locale, number],
  )
}

/** `{name}` interpolation for TEXT entries. */
export function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m))
}

/* ------------------------------------------------------------- enum labels */

export const CONVERSATION_TYPE: Record<string, Bilingual> = {
  direct: { en: 'Direct', ar: 'مباشرة' },
  student_group: { en: 'Student group', ar: 'مجموعة طالب' },
  class_group: { en: 'Class group', ar: 'مجموعة صف' },
  family_group: { en: 'Family group', ar: 'مجموعة عائلة' },
  official: { en: 'Official', ar: 'رسمية' },
}

export const CONVERSATION_STATE: Record<string, Bilingual> = {
  open: { en: 'Open', ar: 'مفتوحة' },
  waiting_on_jawwid: { en: 'Waiting on us', ar: 'بانتظار ردّنا' },
  waiting_on_customer: { en: 'Waiting on family', ar: 'بانتظار العائلة' },
  resolved: { en: 'Resolved', ar: 'محلولة' },
}

export const STORY_STATE: Record<string, Bilingual> = {
  published: { en: 'Published', ar: 'منشورة' },
  draft: { en: 'Draft', ar: 'مسودة' },
  expired: { en: 'Expired', ar: 'منتهية' },
  deleted: { en: 'Deleted', ar: 'محذوفة' },
}

export const PRINCIPAL_KIND: Record<string, Bilingual> = {
  staff: { en: 'Staff', ar: 'موظف' },
  teacher: { en: 'Teacher', ar: 'معلم' },
  contact: { en: 'Family contact', ar: 'جهة اتصال عائلة' },
}

export const PRINCIPAL_KIND_PLURAL: Record<string, Bilingual> = {
  staff: { en: 'Staff', ar: 'الموظفون' },
  teacher: { en: 'Teachers', ar: 'المعلمون' },
  contact: { en: 'Family contacts', ar: 'جهات الاتصال' },
}

/** `chat.account.kind` (the overview's sign-in accounts). */
export const ACCOUNT_KIND: Record<string, Bilingual> = {
  staff: { en: 'Staff', ar: 'الموظفون' },
  teacher: { en: 'Teachers', ar: 'المعلمون' },
  family: { en: 'Families', ar: 'العائلات' },
}

export const ACCOUNT_STATUS: Record<string, Bilingual> = {
  provisioned: { en: 'Not activated', ar: 'لم يُفعَّل' },
  active: { en: 'Active', ar: 'نشط' },
  suspended: { en: 'Suspended', ar: 'موقوف' },
  deactivated: { en: 'Deactivated', ar: 'معطّل' },
}

export const AUTHOR_KIND: Record<string, Bilingual> = {
  contact: { en: 'Family', ar: 'العائلة' },
  staff: { en: 'Staff', ar: 'موظف' },
  teacher: { en: 'Teacher', ar: 'معلم' },
  system: { en: 'System', ar: 'النظام' },
}

export const MESSAGE_TYPE: Record<string, Bilingual> = {
  image: { en: 'Photo', ar: 'صورة' },
  video: { en: 'Video', ar: 'فيديو' },
  voice: { en: 'Voice message', ar: 'رسالة صوتية' },
  file: { en: 'File', ar: 'ملف' },
}

export const MODERATION: Record<string, Bilingual> = {
  pending: { en: 'Awaiting approval', ar: 'بانتظار الموافقة' },
  rejected: { en: 'Rejected', ar: 'مرفوضة' },
}

/* ------------------------------------------------------------ formatters */

/*
 * Intl objects are cached per locale and style. Constructing one costs about
 * 36µs (DateTimeFormat) or 10µs (PluralRules) against about 1µs to reuse it,
 * and list views format a value per row on every render: measured on 600
 * users, that construction was most of a search keystroke's render time.
 */
const dateFormats = new Map<string, Intl.DateTimeFormat>()
const pluralRulesByLocale = new Map<Locale, Intl.PluralRules>()

type DateStyle = 'time' | 'weekday' | 'dayMonth' | 'dayMonthYear' | 'day' | 'month'
const DATE_STYLE: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  time: { timeStyle: 'short' },
  weekday: { weekday: 'long' },
  dayMonth: { day: 'numeric', month: 'short' },
  dayMonthYear: { day: 'numeric', month: 'short', year: 'numeric' },
  day: { day: 'numeric' },
  month: { month: 'short' },
}

function dateFormat(locale: Locale, style: DateStyle): Intl.DateTimeFormat {
  const key = `${locale}:${style}`
  let f = dateFormats.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALE_TAG[locale], DATE_STYLE[style])
    dateFormats.set(key, f)
  }
  return f
}

function pluralRules(locale: Locale): Intl.PluralRules {
  let r = pluralRulesByLocale.get(locale)
  if (!r) {
    r = new Intl.PluralRules(LOCALE_TAG[locale])
    pluralRulesByLocale.set(locale, r)
  }
  return r
}

/* --------------------------------------------------------------- dates */

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/**
 * A list timestamp, the way a messaging app shows one: the time for today,
 * "Yesterday", the weekday within a week, otherwise a short date.
 */
export function listTime(iso: string, locale: Locale, now: Date = new Date()): string {
  const d = new Date(iso)
  if (sameDay(d, now)) return dateFormat(locale, 'time').format(d)
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(d, yesterday)) return locale === 'ar' ? TEXT.yesterday.ar : TEXT.yesterday.en
  const days = (now.getTime() - d.getTime()) / 86_400_000
  if (days > 0 && days < 7) return dateFormat(locale, 'weekday').format(d)
  return dateFormat(locale, d.getFullYear() === now.getFullYear() ? 'dayMonth' : 'dayMonthYear').format(d)
}

/**
 * "in 5 hours" / "3 days ago", rounded to the largest whole unit. Cached per
 * locale like the other formatters.
 */
const relativeFormats = new Map<Locale, Intl.RelativeTimeFormat>()
export function relativeTime(iso: string, locale: Locale, now: Date = new Date()): string {
  let f = relativeFormats.get(locale)
  if (!f) {
    f = new Intl.RelativeTimeFormat(LOCALE_TAG[locale], { numeric: 'auto' })
    relativeFormats.set(locale, f)
  }
  const diff = new Date(iso).getTime() - now.getTime()
  const abs = Math.abs(diff)
  const sign = diff < 0 ? -1 : 1
  if (abs < 60_000) return f.format(0, 'minute')
  if (abs < 3_600_000) return f.format(sign * Math.round(abs / 60_000), 'minute')
  if (abs < 86_400_000) return f.format(sign * Math.round(abs / 3_600_000), 'hour')
  return f.format(sign * Math.round(abs / 86_400_000), 'day')
}

/** The two halves of a calendar tile: "13" and "Oct". */
export function dayMonth(iso: string, locale: Locale): { day: string; month: string } {
  const d = new Date(iso)
  return { day: dateFormat(locale, 'day').format(d), month: dateFormat(locale, 'month').format(d) }
}

export type DayGroup = 'today' | 'yesterday' | 'week' | 'older'

/** Which section of a time-ordered list a timestamp belongs to. */
export function dayGroup(iso: string, now: Date = new Date()): DayGroup {
  const d = new Date(iso)
  if (sameDay(d, now)) return 'today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(d, yesterday)) return 'yesterday'
  return (now.getTime() - d.getTime()) / 86_400_000 < 7 ? 'week' : 'older'
}

/** A day heading inside a thread. */
export function dayLabel(iso: string, locale: Locale, now: Date = new Date()): string {
  const d = new Date(iso)
  if (sameDay(d, now)) return locale === 'ar' ? TEXT.today.ar : TEXT.today.en
  return listTime(iso, locale, now)
}
