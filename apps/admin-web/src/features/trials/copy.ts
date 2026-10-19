import type { Pair } from '../teachers/copy'

/**
 * Trial and New Students copy, Arabic and English side by side. Wording rule:
 * "Subscribed" is what Sales recorded; only "Confirmed by Core" credits the
 * teacher -- the page never lets the first read as the second.
 */
export const TR = {
  areaLabel: { en: 'Trials', ar: 'الحصص التجريبية' },
  trialsTitle: { en: 'Trial lessons', ar: 'الحصص التجريبية' },
  trialsSubtitle: {
    en: 'Book a prospect into a teacher\'s real free time. The teacher reports the trial from the app; Sales records whether the family subscribed.',
    ar: 'احجز للمهتم في وقت فارغ فعلي لدى المعلم. يكتب المعلم تقرير الحصة من التطبيق، ويسجّل قسم المبيعات هل اشتركت الأسرة.',
  },
  newProspect: { en: 'Record a prospect', ar: 'تسجيل مهتم' },
  bookTrial: { en: 'Book a trial', ar: 'حجز حصة تجريبية' },
  prospect: { en: 'Prospect', ar: 'المهتم' },
  displayName: { en: 'Name to show', ar: 'الاسم الظاهر' },
  level: { en: 'Level (optional)', ar: 'المستوى (اختياري)' },
  noteOptional: { en: 'Note (optional)', ar: 'ملاحظة (اختيارية)' },
  note: { en: 'Note', ar: 'ملاحظة' },
  teacher: { en: 'Teacher', ar: 'المعلم' },
  duration: { en: 'Length', ar: 'المدة' },
  day: { en: 'Day', ar: 'اليوم' },
  time: { en: 'Free time', ar: 'الوقت المتاح' },
  noSlots: {
    en: 'This teacher has no free time in the coming weeks (or no working hours recorded).',
    ar: 'لا يوجد وقت فارغ لدى هذا المعلم في الأسابيع القادمة (أو لم تُسجّل ساعات عمله).',
  },
  loadingSlots: { en: 'Loading free times…', ar: 'جارٍ تحميل الأوقات المتاحة…' },
  noProspects: { en: 'Record a prospect first.', ar: 'سجّل المهتم أولًا.' },
  book: { en: 'Book', ar: 'احجز' },
  save: { en: 'Save', ar: 'حفظ' },
  when: { en: 'When', ar: 'الموعد' },
  attendance: { en: 'Attendance', ar: 'الحضور' },
  decision: { en: 'Subscription', ar: 'الاشتراك' },
  actions: { en: 'Actions', ar: 'الإجراءات' },
  none: { en: 'No trial lessons in this period.', ar: 'لا توجد حصص تجريبية في هذه الفترة.' },
  filterAll: { en: 'All', ar: 'الكل' },
  filterDecision: { en: 'Needs a decision', ar: 'بانتظار قرار' },
  filterUpcoming: { en: 'Upcoming', ar: 'القادمة' },
  recordDecision: { en: 'Record decision', ar: 'تسجيل القرار' },
  result: { en: 'Result', ar: 'النتيجة' },
  subscribed: { en: 'Subscribed', ar: 'اشترك' },
  notSubscribed: { en: 'Did not subscribe', ar: 'لم يشترك' },
  reason: { en: 'Reason (if not subscribed)', ar: 'السبب (إن لم يشترك)' },
  cancel: { en: 'Cancel trial', ar: 'إلغاء الحصة' },
  cancelReason: { en: 'Reason', ar: 'السبب' },
  absence: { en: 'Prospect absent', ar: 'غياب المهتم' },
  report: { en: 'Teacher\'s report', ar: 'تقرير المعلم' },
  openGroup: { en: 'Trial group', ar: 'مجموعة التجريبية' },

  newTitle: { en: 'New students', ar: 'الطلاب الجدد' },
  newSubtitle: {
    en: 'Families who subscribed after a trial. Core confirms the subscription; then Operations assigns a supervisor and opens the family\'s group.',
    ar: 'أسر اشتركت بعد حصة تجريبية. يؤكد Core الاشتراك، ثم يعيّن قسم العمليات مشرفًا ويفتح مجموعة الأسرة.',
  },
  ready: { en: 'Ready to set up', ar: 'جاهزون للتجهيز' },
  readyHint: {
    en: 'Confirmed by Core, with no group yet. Set up the group from Families.',
    ar: 'أكّدها Core ولا توجد لهم مجموعة بعد. جهّز المجموعة من صفحة الأسر.',
  },
  awaitingCore: { en: 'Awaiting Core', ar: 'بانتظار Core' },
  awaitingCoreHint: {
    en: 'Sales recorded a subscription that Core has not confirmed yet. Nothing to do here until it does.',
    ar: 'سجّل قسم المبيعات اشتراكًا لم يؤكده Core بعد. لا إجراء هنا حتى يؤكده.',
  },
  trialOn: { en: 'Trial', ar: 'الحصة التجريبية' },
  recordedOn: { en: 'Recorded', ar: 'تاريخ التسجيل' },
  confirmedOn: { en: 'Confirmed', ar: 'تاريخ التأكيد' },
  nothingReady: { en: 'No one is waiting to be set up.', ar: 'لا يوجد من ينتظر التجهيز.' },
  nothingAwaiting: { en: 'Nothing is awaiting Core.', ar: 'لا شيء بانتظار Core.' },
} satisfies Record<string, Pair>

export const ATTENDANCE: Record<string, Pair> = {
  upcoming: { en: 'Upcoming', ar: 'قادمة' },
  awaiting: { en: 'Awaiting the teacher', ar: 'بانتظار المعلم' },
  attended: { en: 'Attended', ar: 'حضر' },
  no_show: { en: 'Did not attend', ar: 'لم يحضر' },
  admin_cancelled: { en: 'Cancelled', ar: 'ملغاة' },
}

export const CONVERSION: Record<string, Pair> = {
  pending: { en: 'Needs a decision', ar: 'بانتظار قرار' },
  awaiting_core: { en: 'Subscribed — awaiting Core', ar: 'اشترك — بانتظار Core' },
  confirmed: { en: 'Confirmed by Core', ar: 'أكّده Core' },
  not_subscribed: { en: 'Did not subscribe', ar: 'لم يشترك' },
}

export const NOT_SUBSCRIBED_REASON: Record<string, Pair> = {
  price: { en: 'Price', ar: 'السعر' },
  schedule: { en: 'Schedule', ar: 'المواعيد' },
  not_ready: { en: 'Not ready yet', ar: 'غير جاهز بعد' },
  chose_other: { en: 'Chose another academy', ar: 'اختار جهة أخرى' },
  no_response: { en: 'No response', ar: 'لم يرد' },
  other: { en: 'Other', ar: 'أخرى' },
}

/** An instant in the reader's language and zone: "Mon 21 Oct, 17:30". */
export function formatWhen(iso: string, locale: 'ar' | 'en'): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d)
}

/** The local calendar day of an instant, as a grouping key. */
export function localDay(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
