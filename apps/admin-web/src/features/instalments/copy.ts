import { ApiError } from '@/core/api/errors'
import type { Pair } from '@/features/organization/copy'
import type { InstalmentStatus } from './api'

export { useCopy, type Pair } from '@/features/organization/copy'

/**
 * PD-12 S3 copy, Arabic and English side by side. Since PD-17 the instalments
 * are Jawwid Chat's own records, written on each family's Parent Profile.
 */
export const I = {
  title: { en: 'Instalment payments', ar: 'الأقساط' },
  subtitle: {
    en: 'Overdue first, then due today, then upcoming. A payment is recorded on the Parent Profile.',
    ar: 'المتأخر أولًا، ثم المستحق اليوم، ثم القادم. تُسجَّل الدفعة في ملف ولي الأمر.',
  },
  all: { en: 'All', ar: 'الكل' },
  mine: { en: 'Mine', ar: 'مسؤوليتي' },
  noSupervisor: { en: 'No billing supervisor', ar: 'بلا مشرف تحصيل' },
  showPaid: { en: 'Show paid', ar: 'إظهار المدفوع' },
  // PD-30: overdue before the payment lock started -- these never lock a group.
  beforeGoLive: { en: 'Overdue before go-live', ar: 'متأخر قبل التفعيل' },
  beforeGoLiveHint: {
    en: 'Due before {date}: these never lock a group. Follow them up by hand.',
    ar: 'مستحق قبل {date}: لا يوقف المجموعة. تابِعه يدويًا.',
  },
  beforeGoLiveBadge: { en: 'Before go-live', ar: 'قبل التفعيل' },
  account: { en: 'Payer', ar: 'الدافع' },
  planHint: {
    en: 'One mark per instalment of this plan in the list. Paid ones appear with “Show paid”.',
    ar: 'علامة لكل قسط من هذه الخطة في القائمة. يظهر المدفوع منها عند «إظهار المدفوع».',
  },
  planLabel: { en: 'Instalment {i} of {n}', ar: 'القسط {i} من {n}' },
  planOpenLabel: { en: 'Instalment {i} of the {n} still open', ar: 'القسط {i} من {n} ما زالت مفتوحة' },
  // The strip's key, and the same words in each strip's own label.
  keyPaid: { en: 'paid', ar: 'مدفوع' },
  keyLate: { en: 'late', ar: 'متأخر' },
  keyDue: { en: 'due today', ar: 'مستحق اليوم' },
  keyUpcoming: { en: 'to come', ar: 'قادم' },
  today: { en: 'Today', ar: 'اليوم' },
  filters: { en: 'Filters', ar: 'التصفية' },
  showAll: { en: 'Show all', ar: 'عرض الكل' },
  showAllN: { en: 'Show all {n}', ar: 'عرض الكل ({n})' },
  openFile: { en: 'Open file', ar: 'فتح الملف' },
  more: { en: 'More actions: {name}', ar: 'إجراءات أخرى: {name}' },
  emptyHint: {
    en: 'No open instalments for the families you follow. An instalment plan is added on a Parent Profile.',
    ar: 'لا أقساط مفتوحة للأسر التي تتابعها. تُضاف خطة الأقساط من ملف ولي الأمر.',
  },
  emptyFilteredHint: {
    en: 'No instalment fits this supervisor filter or these options.',
    ar: 'لا قسط يوافق تصفية المشرف أو هذه الخيارات.',
  },
  openParents: { en: 'Open Parents', ar: 'فتح أولياء الأمور' },
  forWhom: { en: 'For', ar: 'عن' },
  family: { en: 'The whole family', ar: 'الأسرة كلها' },
  amount: { en: 'Amount', ar: 'المبلغ' },
  dueDate: { en: 'Due', ar: 'الاستحقاق' },
  supervisor: { en: 'Responsible supervisor', ar: 'المشرف المسؤول' },
  billingBasis: { en: 'billing supervisor', ar: 'مشرف التحصيل' },
  childBasis: { en: 'child’s supervisor', ar: 'مشرف الطفل' },
  unassigned: { en: 'Not set', ar: 'غير محدد' },
  unassignedChild: { en: 'The child has no supervisor', ar: 'لا مشرف للطفل' },
  open: { en: 'Open conversation', ar: 'فتح المحادثة' },
  noConversation: { en: 'No conversation you can open', ar: 'لا توجد محادثة يمكنك فتحها' },
  setSupervisor: { en: 'Set billing supervisor', ar: 'تحديد مشرف التحصيل' },
  changeSupervisor: { en: 'Change billing supervisor', ar: 'تغيير مشرف التحصيل' },
  empty: { en: 'Nothing due.', ar: 'لا شيء مستحق.' },
  emptyFiltered: { en: 'Nothing matches this filter.', ar: 'لا شيء يطابق هذا التصفية.' },
  openProfile: { en: 'Open the Parent Profile of {name}', ar: 'فتح ملف ولي الأمر {name}' },
  counts: {
    en: '{overdue} overdue · {due} due today · {upcoming} upcoming',
    ar: '{overdue} متأخر · {due} مستحق اليوم · {upcoming} قادم',
  },
  countsUnassigned: { en: '{n} without a responsible supervisor', ar: '{n} بلا مشرف مسؤول' },
  paidOn: { en: 'Paid {date}', ar: 'دُفع {date}' },

  dialogTitle: { en: 'Billing supervisor: {family}', ar: 'مشرف التحصيل: {family}' },
  dialogHint: {
    en: 'Responsible for this family’s family instalments (an instalment for one child goes to that child’s supervisor). Choose among the supervisors of its children; if they stop supervising all of them, this is cleared and the family returns to “No billing supervisor”.',
    ar: 'مسؤول عن أقساط الأسرة العامة (أما قسط طفل بعينه فلمشرف ذلك الطفل). اختر من بين مشرفي أطفالها؛ وإذا لم يعد يشرف على أي منهم يُلغى التحديد وتعود الأسرة إلى «بلا مشرف تحصيل».',
  },
  supervises: { en: 'supervises {children}', ar: 'يشرف على {children}' },
  noCandidates: {
    en: 'None of this family’s children has a supervisor yet. Assign one in Organization first.',
    ar: 'لا يوجد مشرف لأي من أطفال هذه الأسرة بعد. عيّن مشرفًا من صفحة الهيكل التنظيمي أولًا.',
  },
  clear: { en: 'No billing supervisor', ar: 'بلا مشرف تحصيل' },
  reason: { en: 'Reason', ar: 'السبب' },
  reasonRequired: { en: 'Say why.', ar: 'اذكر السبب.' },
  save: { en: 'Save', ar: 'حفظ' },
  saving: { en: 'Saving…', ar: 'جارٍ الحفظ…' },
} satisfies Record<string, Pair>

/** The page's sections. What is overdue is headed the way the masthead names it. */
export const GROUP_LABEL: Record<InstalmentStatus, Pair> = {
  overdue: { en: 'Late', ar: 'متأخر' },
  due: { en: 'Due today', ar: 'مستحق اليوم' },
  upcoming: { en: 'Upcoming', ar: 'قادم' },
  paid: { en: 'Paid', ar: 'مدفوع' },
}

export const STATUS_LABEL: Record<InstalmentStatus, Pair> = {
  overdue: { en: 'Overdue', ar: 'متأخر' },
  due: { en: 'Due today', ar: 'مستحق اليوم' },
  upcoming: { en: 'Upcoming', ar: 'قادم' },
  paid: { en: 'Paid', ar: 'مدفوع' },
}

const BY_CODE: Record<string, Pair> = {
  'COMM.BILLING_DENIED': {
    en: 'Instalments are for the Operations and Sales departments and the super admin.',
    ar: 'الأقساط لقسمي العمليات والمبيعات والمدير العام فقط.',
  },
  'COMM.BILLING_NOT_FOUND': { en: 'Not found.', ar: 'غير موجود.' },
}

export function describeError(error: unknown, locale: 'ar' | 'en'): string {
  const pick = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  if (error instanceof ApiError) {
    const mapped = BY_CODE[error.code]
    return mapped ? pick(mapped) : error.localized(locale)
  }
  return pick({ en: 'Something went wrong. Try again.', ar: 'حدث خطأ. حاول مرة أخرى.' })
}

/** Arabic counts by number: one, two, 3 to 10, 11 and up. English: one or many. */
export interface CountForms {
  en: [one: string, many: string]
  ar: [one: string, two: string, few: string, many: string]
}

/** "1 instalment" / "5 instalments"; «قسط واحد» / «قسطان» / «5 أقساط» / «12 قسطًا». `{n}` is the number. */
export function countWords(n: number, forms: CountForms, locale: 'ar' | 'en'): string {
  const fill = (t: string) => t.replace('{n}', String(n))
  if (locale === 'en') return fill(n === 1 ? forms.en[0] : forms.en[1])
  if (n === 1) return fill(forms.ar[0])
  if (n === 2) return fill(forms.ar[1])
  const tail = n % 100
  return fill(tail >= 3 && tail <= 10 ? forms.ar[2] : forms.ar[3])
}

export const DAYS: CountForms = { en: ['{n} day', '{n} days'], ar: ['يوم واحد', 'يومين', '{n} أيام', '{n} يومًا'] }
export const OPEN_ONES: CountForms = { en: ['{n} open', '{n} open'], ar: ['واحد مفتوح', 'اثنان مفتوحان', '{n} مفتوحة', '{n} مفتوحًا'] }
export const INSTALMENTS: CountForms = {
  en: ['{n} instalment', '{n} instalments'],
  ar: ['قسط واحد', 'قسطان', '{n} أقساط', '{n} قسطًا'],
}

/** A due date in words: "9 days late", "in 5 days". Today has its own word. */
export function lateWords(days: number, locale: 'ar' | 'en'): string {
  const d = countWords(days, DAYS, locale)
  return locale === 'ar' ? `متأخر ${d}` : `${d} late`
}
export function inDaysWords(days: number, locale: 'ar' | 'en'): string {
  if (days === 1) return locale === 'ar' ? 'غدًا' : 'Tomorrow'
  const d = countWords(days, DAYS, locale)
  return locale === 'ar' ? `بعد ${d}` : `in ${d}`
}

/**
 * An amount as its number and its currency label, for a column that sets the
 * numeral large and the currency small beside it. English labels with the ISO
 * code, Arabic with the currency's Arabic short name.
 */
export function moneyParts(amountMinor: number, currency: string, locale: 'ar' | 'en'): { number: string; unit: string } {
  const tag = locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB'
  try {
    const fmt = new Intl.NumberFormat(tag, { style: 'currency', currency, currencyDisplay: locale === 'ar' ? 'symbol' : 'code' })
    const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2
    const parts = fmt.formatToParts(amountMinor / 10 ** digits)
    const number = parts
      .filter((p) => p.type !== 'currency' && p.type !== 'literal')
      .map((p) => p.value)
      .join('')
    // The Arabic label carries direction marks of its own; the caller sets direction.
    const unit = (parts.find((p) => p.type === 'currency')?.value ?? currency).replace(/[\u200e\u200f\u061c]/g, '')
    return { number, unit }
  } catch {
    return { number: (amountMinor / 100).toFixed(2), unit: currency }
  }
}

/** Amounts are minor units; the currency decides how many decimals that is. */
export function formatMoney(amountMinor: number, currency: string, locale: 'ar' | 'en'): string {
  const tag = locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB'
  try {
    const fmt = new Intl.NumberFormat(tag, { style: 'currency', currency })
    const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2
    return fmt.format(amountMinor / 10 ** digits)
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency}`
  }
}

/** A calendar day (YYYY-MM-DD) as written, never shifted by the viewer's time zone. */
export function formatDay(day: string, locale: 'ar' | 'en'): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`),
  )
}
