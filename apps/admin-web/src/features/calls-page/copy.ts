/**
 * The Calls page's words, Arabic first (PD-13). Kept beside the feature, like
 * the chat and call copy, so it can be reviewed and merged on its own.
 *
 * Voice only: nothing here offers video. No phone number appears anywhere --
 * a member is found by name.
 */
export interface CallsPageCopy {
  title: string
  search: string
  clearSearch: string
  upcoming: string
  favorites: string
  recent: string
  noUpcoming: string
  noFavorites: string
  noRecent: string
  noMatches: string
  loadMore: string
  join: string
  joining: string
  rowMenu: (name: string) => string
  cancelCall: string
  cancelConfirmTitle: string
  cancelConfirmBody: (name: string) => string
  cancelConfirm: string
  keep: string
  stateUpcoming: string
  stateOpen: string
  stateCancelled: string
  stateOver: string
  linkBadge: string
  callTo: (name: string) => string
  incoming: string
  outgoing: string
  answered: string
  missed: string
  declined: string
  ongoing: string
  duration: (seconds: number) => string
  // tiles
  actions: string
  startCall: string
  newLink: string
  selectMember: string
  scheduleCall: string
  // picker
  pickerTitle: Record<'call' | 'select' | 'link' | 'schedule', string>
  people: string
  groups: string
  noConversations: string
  checking: string
  cannotCall: string
  voiceCall: string
  openChat: string
  back: string
  // schedule
  scheduleTitle: string
  conversation: string
  change: string
  date: string
  time: string
  titleLabel: string
  titleHint: string
  titleTooLong: string
  pickDateTime: string
  inPast: string
  schedule: string
  scheduling: string
  scheduled: (chat: string) => string
  // link
  creatingLink: string
  linkTitle: string
  linkLabel: string
  copyLink: string
  copied: string
  copyFailed: string
  joinNow: string
  linkNote: string
  // landing
  landingTitle: string
  landingNotAvailable: string
  landingBackToCalls: string
  // card
  cardScheduled: string
  cardLink: string
  cardCancelled: string
  cardWhen: (when: string) => string
  cardBy: (name: string) => string
  cardNotOpenYet: string
  cardClosed: string
  close: string
  dismiss: string
}

const pad = (n: number) => String(n).padStart(2, '0')
function duration(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}

const ar: CallsPageCopy = {
  title: 'المكالمات',
  search: 'ابحث بالاسم',
  clearSearch: 'مسح البحث',
  upcoming: 'القادمة',
  favorites: 'المفضلة',
  recent: 'الأخيرة',
  noUpcoming: 'لا توجد مكالمات مجدولة.',
  noFavorites: 'ثبّت محادثة لتظهر هنا.',
  noRecent: 'لا توجد مكالمات بعد.',
  noMatches: 'لا نتائج لهذا الاسم.',
  loadMore: 'عرض المزيد',
  join: 'انضمام',
  joining: 'جارٍ الانضمام…',
  rowMenu: (name) => `خيارات ${name}`,
  cancelCall: 'إلغاء المكالمة',
  cancelConfirmTitle: 'إلغاء المكالمة المجدولة؟',
  cancelConfirmBody: (name) => `سيظهر إشعار الإلغاء في محادثة «${name}» لكل الأعضاء.`,
  cancelConfirm: 'نعم، ألغِ المكالمة',
  keep: 'إبقاء',
  stateUpcoming: 'قادمة',
  stateOpen: 'متاحة الآن',
  stateCancelled: 'أُلغيت',
  stateOver: 'انتهت',
  linkBadge: 'رابط',
  callTo: (name) => `اتصال بـ ${name}`,
  incoming: 'واردة',
  outgoing: 'صادرة',
  answered: 'تم الرد',
  missed: 'فائتة',
  declined: 'مرفوضة',
  ongoing: 'جارية',
  duration,
  actions: 'إجراءات المكالمات',
  startCall: 'بدء مكالمة',
  newLink: 'رابط مكالمة جديد',
  selectMember: 'اختيار عضو',
  scheduleCall: 'جدولة مكالمة',
  pickerTitle: {
    call: 'بدء مكالمة صوتية',
    select: 'اختيار عضو',
    link: 'رابط مكالمة جديد',
    schedule: 'جدولة مكالمة',
  },
  people: 'الأشخاص',
  groups: 'المجموعات',
  noConversations: 'لا توجد محادثات ضمن مسؤوليتك.',
  checking: 'جارٍ التحقق…',
  cannotCall: 'لا يمكن الاتصال في هذه المحادثة الآن.',
  voiceCall: 'مكالمة صوتية',
  openChat: 'فتح المحادثة',
  back: 'رجوع',
  scheduleTitle: 'جدولة مكالمة',
  conversation: 'المحادثة',
  change: 'تغيير',
  date: 'التاريخ',
  time: 'الوقت',
  titleLabel: 'العنوان (اختياري)',
  titleHint: 'حتى 120 حرفًا.',
  titleTooLong: 'العنوان أطول من 120 حرفًا.',
  pickDateTime: 'اختر التاريخ والوقت.',
  inPast: 'هذا الموعد في الماضي.',
  schedule: 'جدولة',
  scheduling: 'جارٍ الجدولة…',
  scheduled: (chat) => `تمت الجدولة — نُشرت في «${chat}»`,
  creatingLink: 'جارٍ إنشاء الرابط…',
  linkTitle: 'رابط المكالمة',
  linkLabel: 'الرابط',
  copyLink: 'نسخ الرابط',
  copied: 'تم النسخ',
  copyFailed: 'تعذّر النسخ. انسخ الرابط يدويًا.',
  joinNow: 'انضم الآن',
  linkNote: 'يمكن لأعضاء هذه المحادثة فقط الانضمام. لن يرنّ هاتف أحد حتى ينضم شخص ما.',
  landingTitle: 'رابط مكالمة',
  landingNotAvailable: 'رابط هذه المكالمة غير متاح لحسابك.',
  landingBackToCalls: 'العودة إلى المكالمات',
  cardScheduled: 'مكالمة مجدولة',
  cardLink: 'رابط مكالمة',
  cardCancelled: 'أُلغيت المكالمة المجدولة',
  cardWhen: (when) => `الموعد: ${when}`,
  cardBy: (name) => `بواسطة: ${name}`,
  cardNotOpenYet: 'يُتاح الانضمام قبل الموعد بعشر دقائق.',
  cardClosed: 'انتهت فترة الانضمام.',
  close: 'إغلاق',
  dismiss: 'إخفاء',
}

const en: CallsPageCopy = {
  title: 'Calls',
  search: 'Search name',
  clearSearch: 'Clear search',
  upcoming: 'Upcoming',
  favorites: 'Favorites',
  recent: 'Recent',
  noUpcoming: 'No scheduled calls.',
  noFavorites: 'Pin a chat to see it here.',
  noRecent: 'No calls yet.',
  noMatches: 'No matches for that name.',
  loadMore: 'Load more',
  join: 'Join',
  joining: 'Joining…',
  rowMenu: (name) => `Options for ${name}`,
  cancelCall: 'Cancel call',
  cancelConfirmTitle: 'Cancel the scheduled call?',
  cancelConfirmBody: (name) => `A cancellation notice is posted in “${name}” for every member.`,
  cancelConfirm: 'Yes, cancel it',
  keep: 'Keep',
  stateUpcoming: 'Upcoming',
  stateOpen: 'Open now',
  stateCancelled: 'Cancelled',
  stateOver: 'Over',
  linkBadge: 'Link',
  callTo: (name) => `Call ${name}`,
  incoming: 'Incoming',
  outgoing: 'Outgoing',
  answered: 'Answered',
  missed: 'Missed',
  declined: 'Declined',
  ongoing: 'Ongoing',
  duration,
  actions: 'Call actions',
  startCall: 'Start call',
  newLink: 'New call link',
  selectMember: 'Select a member',
  scheduleCall: 'Schedule call',
  pickerTitle: {
    call: 'Start a voice call',
    select: 'Select a member',
    link: 'New call link',
    schedule: 'Schedule call',
  },
  people: 'People',
  groups: 'Groups',
  noConversations: 'No chats in your charge.',
  checking: 'Checking…',
  cannotCall: 'A call can’t be made in this chat right now.',
  voiceCall: 'Voice call',
  openChat: 'Open chat',
  back: 'Back',
  scheduleTitle: 'Schedule call',
  conversation: 'Chat',
  change: 'Change',
  date: 'Date',
  time: 'Time',
  titleLabel: 'Title (optional)',
  titleHint: 'Up to 120 characters.',
  titleTooLong: 'The title is longer than 120 characters.',
  pickDateTime: 'Choose a date and a time.',
  inPast: 'That time is in the past.',
  schedule: 'Schedule',
  scheduling: 'Scheduling…',
  scheduled: (chat) => `Scheduled — posted in “${chat}”`,
  creatingLink: 'Creating the link…',
  linkTitle: 'Call link',
  linkLabel: 'Link',
  copyLink: 'Copy link',
  copied: 'Copied',
  copyFailed: 'Couldn’t copy. Copy the link by hand.',
  joinNow: 'Join now',
  linkNote: 'Only members of this chat can join. Nobody is rung until someone joins.',
  landingTitle: 'Call link',
  landingNotAvailable: 'This call link isn’t available to your account.',
  landingBackToCalls: 'Back to Calls',
  cardScheduled: 'Scheduled call',
  cardLink: 'Call link',
  cardCancelled: 'Scheduled call cancelled',
  cardWhen: (when) => `When: ${when}`,
  cardBy: (name) => `By: ${name}`,
  cardNotOpenYet: 'Join opens 10 minutes before the start.',
  cardClosed: 'The join window has closed.',
  close: 'Close',
  dismiss: 'Dismiss',
}

export function callsPageCopyFor(locale: string): CallsPageCopy {
  return locale === 'ar' ? ar : en
}
