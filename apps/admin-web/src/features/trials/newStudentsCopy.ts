import type { Pair } from '../teachers/copy'
import type { NewStudentDto } from './api'

/**
 * PD-32: the New Students page's own copy (the redesigned card, its toolbar and
 * the sign-up code without a time limit). Kept apart from copy.ts, which the
 * trial booking flow shares.
 */
export const NS = {
  search: { en: 'Search by parent or child name', ar: 'ابحث باسم ولي الأمر أو الطفل' },
  filterLabel: { en: 'Setup status', ar: 'حالة التجهيز' },
  all: { en: 'All', ar: 'الكل' },
  noMatch: { en: 'No new student matches this search.', ar: 'لا يوجد طالب جديد يطابق البحث.' },
  contact: { en: 'Contact', ar: 'التواصل' },
  payment: { en: 'Payment', ar: 'الدفع' },
  setup: { en: 'Setup', ar: 'التجهيز' },
  children: { en: 'Children', ar: 'الأطفال' },
  trial: { en: 'Trial', ar: 'الحصة التجريبية' },
  recorded: { en: 'Recorded by', ar: 'سجّلها' },
  updated: { en: 'updated', ar: 'عُدِّلت' },
  years: { en: 'yrs', ar: 'سنة' },
  perLesson: { en: 'per lesson', ar: 'للحصة' },
  perPackage: { en: 'package', ar: 'الباقة' },
  codeLabel: { en: 'Sign-up code', ar: 'رمز التسجيل' },
  codeValid: { en: 'Valid until the parent uses it or it is invalidated.', ar: 'صالح حتى يستخدمه ولي الأمر أو يُلغى.' },
  codeIssued: { en: 'Requested', ar: 'طُلب' },
  invalidate: { en: 'Invalidate code', ar: 'إلغاء الرمز' },
  invalidateHint: {
    en: 'The code stops working at once. The parent asks for a new one in the app.',
    ar: 'يتوقف الرمز فورًا، ويطلب ولي الأمر رمزًا جديدًا من التطبيق.',
  },
  invalidated: { en: 'Code invalidated.', ar: 'أُلغي الرمز.' },
  wrongTries: { en: 'Wrong codes in the last 24 hours', ar: 'رموز خاطئة خلال 24 ساعة' },
  lockedNote: {
    en: 'Locked: the parent entered too many wrong codes. Check with them, then reset.',
    ar: 'مقفل: أدخل ولي الأمر رموزًا خاطئة كثيرة. تحقق منه ثم أعد التعيين.',
  },
  reset: { en: 'Reset attempts', ar: 'إعادة تعيين المحاولات' },
  resetDone: { en: 'Attempts reset. The parent can ask for a new code.', ar: 'أُعيد تعيين المحاولات. يمكن لولي الأمر طلب رمز جديد.' },
  // The queue and its detail panel
  kind: { en: 'New family', ar: 'أسرة جديدة' },
  panelLabel: { en: 'Family details', ar: 'تفاصيل الأسرة' },
  moreActions: { en: 'More actions', ar: 'إجراءات أخرى' },
  assignSupervisor: { en: 'Assign supervisor', ar: 'تعيين مشرف' },
  showCode: { en: 'Show code', ar: 'عرض الرمز' },
  createGroup: { en: 'Create group', ar: 'إنشاء المجموعة' },
  openGroup: { en: 'Open group', ar: 'فتح المجموعة' },
  open: { en: 'Open', ar: 'فتح' },
  noSupervisor: { en: 'No supervisor', ar: 'بلا مشرف' },
  codeAsked: { en: 'Asked for a code', ar: 'طلب رمزًا' },
  stageEmpty: { en: 'No family at this stage.', ar: 'لا توجد أسرة في هذه المرحلة.' },
  lockedCount: { en: '{n} locked', ar: 'مقفل: {n}' },
  oldest: { en: 'oldest {age}', ar: 'الأقدم {age}' },
  stepTrial: { en: 'Trial lesson', ar: 'الحصة التجريبية' },
  stepRecorded: { en: 'Subscription recorded', ar: 'تسجيل الاشتراك' },
  emptyHint: {
    en: 'A family appears here when Sales records "The student subscribed" on a trial, or when its supervisor enters it by hand.',
    ar: 'تظهر الأسرة هنا عندما يسجّل قسم المبيعات «الطالب اشترك» على حصة تجريبية، أو عندما يُدخلها مشرفها يدويًا.',
  },
  openTrials: { en: 'Open Trial lessons', ar: 'فتح الحصص التجريبية' },
  rule: { en: 'Contact and payment details are shown here only.', ar: 'بيانات التواصل والدفع تظهر هنا فقط.' },
  // A card's waiting fact: why the family stands in its column now
  factUnassigned: { en: 'Subscribed; needs a supervisor', ar: 'اشتركت وتحتاج مشرفًا' },
  factNoGroup: { en: 'The family group is not created yet', ar: 'لم تُنشأ مجموعة الأسرة بعد' },
  factNotStarted: { en: 'The parent has not signed up yet', ar: 'ولي الأمر لم يُنشئ حسابه بعد' },
  factCode: { en: 'Asked for a code; send it on WhatsApp', ar: 'طلب رمزًا، أرسله إليه عبر واتساب' },
  factLocked: { en: 'Locked after too many wrong codes', ar: 'قُفل بعد رموز خاطئة كثيرة' },
  factSignedUp: { en: 'Signed up; the family is set up', ar: 'أنشأ حسابه واكتمل التجهيز' },
  // The inspector's state, in one sentence
  stateUnassigned: { en: 'Assign the supervisor who will look after this family.', ar: 'عيّن المشرف الذي سيتابع هذه الأسرة.' },
  stateUnassignedOther: { en: 'The Operations manager assigns its supervisor.', ar: 'يعيّن مدير التشغيل مشرفها.' },
  stateNoGroup: { en: '{supervisor} looks after it. Create the family group next.', ar: 'يتابعها {supervisor}. الخطوة التالية: إنشاء مجموعة الأسرة.' },
  stateNotStarted: { en: '{supervisor} looks after it. The parent has not signed up in the app yet.', ar: 'يتابعها {supervisor}. ولي الأمر لم يُنشئ حسابه في التطبيق بعد.' },
  stateCode: { en: 'The parent asked for a sign-up code. Send it to them on WhatsApp.', ar: 'طلب ولي الأمر رمز التسجيل. أرسله إليه عبر واتساب.' },
  stateLocked: { en: 'Sign-up is locked after too many wrong codes. Check with the parent, then reset the attempts.', ar: 'قُفل التسجيل بعد رموز خاطئة كثيرة. تحقق من ولي الأمر ثم أعد تعيين المحاولات.' },
  stateSignedUp: { en: 'The parent signed up. The family is set up.', ar: 'أنشأ ولي الأمر حسابه، واكتمل تجهيز الأسرة.' },
  itsSupervisor: { en: 'Its supervisor', ar: 'مشرفها' },
  none: { en: 'None given', ar: 'لم يُذكر' },
} satisfies Record<string, Pair>

export type NewStudentStatus = 'unassigned' | 'waiting' | 'locked' | 'signed_up'

/** One status per card: how far the family's setup got, for the badge and the filter. */
export function newStudentStatus(s: NewStudentDto): NewStudentStatus {
  const e = s.enrolment
  if (!e) return 'unassigned'
  if (e.parentSignup.state === 'signed_up') return 'signed_up'
  if (e.parentSignup.attempts?.locked) return 'locked'
  return 'waiting'
}

export const STATUS: Record<NewStudentStatus, { label: Pair; tone: 'waiting' | 'info' | 'danger' | 'ok' }> = {
  unassigned: { label: { en: 'Not assigned', ar: 'لم يُعيَّن' }, tone: 'waiting' },
  waiting: { label: { en: 'Waiting for the parent', ar: 'بانتظار ولي الأمر' }, tone: 'info' },
  locked: { label: { en: 'Sign-up locked', ar: 'التسجيل مقفل' }, tone: 'waiting' },
  signed_up: { label: { en: 'Parent signed up', ar: 'أنشأ ولي الأمر حسابه' }, tone: 'ok' },
}

/** The filter groups a locked sign-up with the others still waiting for the parent. */
export type StatusFilter = 'all' | 'unassigned' | 'waiting' | 'signed_up'

export function matchesFilter(status: NewStudentStatus, filter: StatusFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'waiting') return status === 'waiting' || status === 'locked'
  return status === filter
}

/** Case- and diacritic-insensitive, on the parent's, the trial student's and each child's name. */
export function matchesSearch(s: NewStudentDto, query: string): boolean {
  const q = fold(query)
  if (!q) return true
  return [s.parent.name, s.prospectName, ...s.children.map((c) => c.name)].some((n) => fold(n).includes(q))
}

function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ًͯ-ٰٟ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase()
    .trim()
}

/** Money without noise: whole amounts carry no ".00" (1,300 EGP; ١٬٣٠٠ ج.م.). */
export function formatAmount(amount: number, currency: string, locale: 'ar' | 'en'): string {
  try {
    return new Intl.NumberFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en', {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    }).format(amount)
  } catch {
    return `${amount} ${currency}`
  }
}

/** The currency's name in the reader's language, with its code: "Egyptian Pound (EGP)". */
export function currencyName(code: string, locale: 'ar' | 'en'): string {
  try {
    const name = new Intl.DisplayNames([locale === 'ar' ? 'ar' : 'en'], { type: 'currency' }).of(code)
    return name && name !== code ? `${name} (${code})` : code
  } catch {
    return code
  }
}

/** "18:30" in the reader's digits. */
export function formatClock(hhmm: string, locale: 'ar' | 'en'): string {
  const [h, m] = hhmm.split(':').map(Number)
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return hhmm
  // The same 12-hour clock as every other time on these pages ("05:00 PM", "05:00 م").
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'UTC' }).format(new Date(Date.UTC(2000, 0, 1, h, m)))
}

/** An age's unit with Arabic's number agreement: 1 سنة, 2 سنتان, 3 to 10 سنوات, 11 and up سنة. */
export function yearsWord(n: number, locale: 'ar' | 'en'): string {
  if (locale === 'en') return n === 1 ? 'yr' : 'yrs'
  return n === 2 ? 'سنتان' : n >= 3 && n <= 10 ? 'سنوات' : 'سنة'
}
