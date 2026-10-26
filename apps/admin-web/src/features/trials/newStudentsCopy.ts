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
  wrongTries: { en: 'Wrong codes in the last 24 hours', ar: 'رموز خاطئة خلال ٢٤ ساعة' },
  lockedNote: {
    en: 'Locked: the parent entered too many wrong codes. Check with them, then reset.',
    ar: 'مقفل: أدخل ولي الأمر رموزًا خاطئة كثيرة. تحقق منه ثم أعد التعيين.',
  },
  reset: { en: 'Reset attempts', ar: 'إعادة تعيين المحاولات' },
  resetDone: { en: 'Attempts reset. The parent can ask for a new code.', ar: 'أُعيد تعيين المحاولات. يمكن لولي الأمر طلب رمز جديد.' },
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
  locked: { label: { en: 'Sign-up locked', ar: 'التسجيل مقفل' }, tone: 'danger' },
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
    return new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en', {
      style: 'currency',
      currency,
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
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm
  const n = new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en', { minimumIntegerDigits: 2, useGrouping: false })
  return `${n.format(h)}:${n.format(m)}`
}
