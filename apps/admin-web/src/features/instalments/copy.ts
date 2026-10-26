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
    en: 'Open instalments: overdue first, then due today, then upcoming. Follow up in the family’s conversation; record a payment on the Parent Profile.',
    ar: 'الأقساط المفتوحة: المتأخر أولًا، ثم المستحق اليوم، ثم القادم. تابِع في محادثة الأسرة، وسجّل الدفعة في ملف ولي الأمر.',
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
  account: { en: 'Responsible account', ar: 'الحساب المسؤول' },
  forWhom: { en: 'For', ar: 'عن' },
  family: { en: 'The family', ar: 'الأسرة' },
  amount: { en: 'Amount', ar: 'المبلغ' },
  dueDate: { en: 'Due date', ar: 'تاريخ الاستحقاق' },
  supervisor: { en: 'Responsible supervisor', ar: 'المشرف المسؤول' },
  billingBasis: { en: 'billing supervisor', ar: 'مشرف التحصيل' },
  childBasis: { en: 'child’s supervisor', ar: 'مشرف الطفل' },
  unassigned: { en: 'Not set', ar: 'غير محدد' },
  unassignedChild: { en: 'The child has no supervisor', ar: 'لا مشرف للطفل' },
  open: { en: 'Open conversation', ar: 'فتح المحادثة' },
  noConversation: { en: 'No conversation you can open', ar: 'لا توجد محادثة يمكنك فتحها' },
  setSupervisor: { en: 'Set', ar: 'تحديد' },
  changeSupervisor: { en: 'Change', ar: 'تغيير' },
  empty: { en: 'Nothing due.', ar: 'لا شيء مستحق.' },
  emptyFiltered: { en: 'Nothing matches this filter.', ar: 'لا شيء يطابق هذا التصفية.' },
  openProfile: { en: 'Open the Parent Profile of {name}', ar: 'فتح ملف ولي الأمر {name}' },
  counts: {
    en: '{overdue} overdue · {due} due today · {upcoming} upcoming',
    ar: '{overdue} متأخر · {due} مستحق اليوم · {upcoming} قادم',
  },
  countsUnassigned: { en: '{n} without a responsible supervisor', ar: '{n} بلا مشرف مسؤول' },
  overdueBy: { en: '{n} days late', ar: 'متأخر {n} يوم' },
  inDays: { en: 'in {n} days', ar: 'بعد {n} يوم' },
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

/** Amounts are minor units; the currency decides how many decimals that is. */
export function formatMoney(amountMinor: number, currency: string, locale: 'ar' | 'en'): string {
  const tag = locale === 'ar' ? 'ar-EG' : 'en-GB'
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
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`),
  )
}
