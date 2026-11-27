import type { Pair } from '@/features/organization/copy'
import type { InboxTab } from './api'

export { useCopy, type Pair } from '@/features/organization/copy'

/** PD-34 copy, Arabic and English side by side. */
export const N = {
  title: { en: 'Notifications', ar: 'الإشعارات' },
  asks: { en: 'Requires action', ar: 'تتطلب إجراءً' },
  saving: { en: 'Saving…', ar: 'جارٍ الحفظ…' },
  dueBy: { en: 'Due {when}', ar: 'موعده {when}' },
  wasDue: { en: 'Was due {when}', ar: 'تجاوز موعده {when}' },
  bell: { en: 'Notifications, {n} unread', ar: 'الإشعارات، {n} غير مقروءة' },
  empty: { en: 'No notifications yet', ar: 'لا إشعارات بعد' },
  emptyHint: {
    en: 'Messages, missed calls, tasks and payments that need you are listed here as they arrive, each with the way to its page.',
    ar: 'تظهر هنا الرسائل والمكالمات الفائتة والمهام والمدفوعات التي تحتاج إليك فور وصولها، ومع كلٍّ منها طريقه إلى صفحته.',
  },
  emptyTab: { en: 'No notifications of this kind', ar: 'لا إشعارات من هذا النوع' },
  emptyTabHint: { en: 'They are listed here as they arrive. The other tabs may hold more.', ar: 'تظهر هنا فور وصولها. قد تجد المزيد في التبويبات الأخرى.' },
  showAll: { en: 'Show all', ar: 'عرض الكل' },
  markAllRead: { en: 'Mark all as read', ar: 'تحديد الكل كمقروء' },
  loadOlder: { en: 'Show older', ar: 'عرض الأقدم' },
  open: { en: 'Open', ar: 'فتح' },
  settings: { en: 'Notification settings', ar: 'إعدادات الإشعارات' },
  settingsTab: { en: 'Settings', ar: 'الإعدادات' },
  today: { en: 'Today', ar: 'اليوم' },
  yesterday: { en: 'Yesterday', ar: 'أمس' },
  quietHours: { en: 'Quiet hours', ar: 'ساعات الهدوء' },
  quietHint: {
    en: 'Pushes to your phone wait until quiet hours end. Calls always come through.',
    ar: 'تنتظر الإشعارات على هاتفك حتى نهاية ساعات الهدوء. المكالمات تصل دائمًا.',
  },
  from: { en: 'From', ar: 'من' },
  until: { en: 'Until', ar: 'حتى' },
  useDefault: { en: "Use the academy's default", ar: 'استخدام الإعداد الافتراضي للأكاديمية' },
  save: { en: 'Save', ar: 'حفظ' },
  pushHeading: { en: 'Push notifications', ar: 'الإشعارات الفورية' },
  pushHint: {
    en: 'Switched off, they still appear here, without an alert.',
    ar: 'عند إيقافها تظهر هنا دون تنبيه.',
  },
  alwaysOn: { en: 'Always on', ar: 'مفعّلة دائمًا' },
} satisfies Record<string, Pair>

export const TABS: Record<InboxTab, Pair> = {
  all: { en: 'All', ar: 'الكل' },
  unread: { en: 'Unread', ar: 'غير مقروءة' },
  action: { en: 'Requires action', ar: 'تتطلب إجراءً' },
  lessons: { en: 'Lessons', ar: 'الحصص' },
  payments: { en: 'Payments', ar: 'المدفوعات' },
  conversations: { en: 'Conversations', ar: 'المحادثات' },
  announcements: { en: 'Announcements', ar: 'الإعلانات' },
}

export const SYSTEM: Pair = { en: 'System', ar: 'النظام' }

export const CATEGORIES: Record<string, Pair> = {
  lesson: { en: 'Lessons', ar: 'الحصص' },
  payment: { en: 'Payments', ar: 'المدفوعات' },
  conversation: { en: 'Messages', ar: 'الرسائل' },
  call: { en: 'Calls', ar: 'المكالمات' },
  task: { en: 'Tasks', ar: 'المهام' },
  announcement: { en: 'Announcements and stories', ar: 'الإعلانات والحالات' },
  system: { en: 'System', ar: 'النظام' },
}
