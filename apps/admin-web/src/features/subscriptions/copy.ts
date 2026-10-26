import { ApiError } from '@/core/api/errors'
import type { Pair } from '@/features/organization/copy'
import type { AccessState, ExceptionKind, LedgerRow, LockReason } from './api'

export { useCopy, type Pair } from '@/features/organization/copy'

/**
 * PD-30 copy, Arabic and English side by side. Wording rule: an exception is
 * the administration's; nothing here says the parent sees it (they never do).
 */
export const S = {
  title: { en: 'Subscription', ar: 'الاشتراك' },
  hint: {
    en: 'Lessons bought and used. When they run out, two grace lessons follow, then the group is read-only for the parent and the teacher until a renewal is paid.',
    ar: 'الحصص المشتراة والمستخدمة. عند نفادها تُتاح حصتا سماح، ثم تصبح المجموعة للقراءة فقط لولي الأمر والمعلم حتى يُدفع التجديد.',
  },
  notEnforced: {
    en: 'The payment lock is switched off on this server: the state is shown, nothing is refused.',
    ar: 'قفل الدفع متوقف على هذا الخادم: تظهر الحالة ولا يُمنع شيء.',
  },
  current: { en: 'Current', ar: 'الاشتراك الحالي' },
  none: { en: 'No subscription recorded yet.', ar: 'لم يُسجَّل اشتراك بعد.' },
  included: { en: 'Lessons bought', ar: 'الحصص المشتراة' },
  used: { en: 'Used', ar: 'المستخدمة' },
  left: { en: 'Left', ar: 'المتبقية' },
  balance: { en: 'Balance', ar: 'الرصيد' },
  state: { en: 'State', ar: 'الحالة' },
  graceLeft: { en: '{n} grace lesson(s) left', ar: 'حصص السماح المتبقية: {n}' },
  heldNote: {
    en: 'Lessons that had not started are on hold ("Suspended — payment").',
    ar: 'الحصص التي لم تبدأ موقوفة ("موقوفة — الدفع").',
  },
  exceptedNote: { en: 'An exception lets this child go on.', ar: 'استثناء يسمح لهذا الطالب بالاستمرار.' },
  ledger: { en: 'Subscriptions', ar: 'الاشتراكات' },
  add: { en: 'Add subscription', ar: 'إضافة اشتراك' },
  void: { en: 'Void', ar: 'إلغاء' },
  voided: { en: 'Voided', ar: 'ملغى' },
  voidTitle: { en: 'Void this subscription', ar: 'إلغاء هذا الاشتراك' },
  lessons: { en: 'Lessons', ar: 'عدد الحصص' },
  lessonsHint: { en: 'How many lessons the package includes.', ar: 'عدد الحصص التي تشملها الباقة.' },
  plan: { en: 'Plan', ar: 'المدة' },
  noPlan: { en: '—', ar: '—' },
  startsOn: { en: 'Starts on', ar: 'يبدأ في' },
  note: { en: 'Note (optional)', ar: 'ملاحظة (اختيارية)' },
  reason: { en: 'Reason', ar: 'السبب' },
  validUntil: { en: 'Valid until', ar: 'صالح حتى' },
  validUntilHint: { en: 'At most 90 days from today.', ar: '90 يومًا من اليوم كحد أقصى.' },
  kind: { en: 'Lets the child go on past', ar: 'يسمح بالاستمرار رغم' },
  exceptions: { en: 'Exceptions', ar: 'الاستثناءات' },
  exceptionsHint: {
    en: 'Only the Super Admin, the Operations Manager and the Sales Manager grant or revoke them. The parent never sees them.',
    ar: 'لا يمنحها أو يلغيها إلا المدير العام ومدير العمليات ومدير المبيعات. لا يراها ولي الأمر.',
  },
  noExceptions: { en: 'No exceptions.', ar: 'لا توجد استثناءات.' },
  grant: { en: 'Grant exception', ar: 'منح استثناء' },
  revoke: { en: 'Revoke', ar: 'إلغاء الاستثناء' },
  revokeTitle: { en: 'Revoke this exception', ar: 'إلغاء هذا الاستثناء' },
  active: { en: 'Active', ar: 'ساري' },
  ended: { en: 'Ended', ar: 'منتهٍ' },
  revoked: { en: 'Revoked', ar: 'أُلغي' },
  by: { en: 'by {name}', ar: 'بواسطة {name}' },
  renewalAsked: { en: 'Parent asked to renew', ar: 'طلب ولي الأمر التجديد' },
  required: { en: 'Required.', ar: 'مطلوب.' },
  invalidLessons: { en: 'A whole number from 1 to 500.', ar: 'عدد صحيح من 1 إلى 500.' },
  save: { en: 'Save', ar: 'حفظ' },
  saving: { en: 'Saving…', ar: 'جارٍ الحفظ…' },
  // Renewal requests (Payments)
  renewalsTitle: { en: 'Renewal requests', ar: 'طلبات التجديد' },
  renewalsHint: {
    en: 'Parents of locked children with nothing to pay yet asked to renew (last 30 days). Send them a renewal link from the Parent Profile.',
    ar: 'طلب أولياء أمور أطفال موقوفين بلا مبلغ مستحق تجديد الاشتراك (آخر 30 يومًا). أرسل رابط التجديد من ملف ولي الأمر.',
  },
  noRenewals: { en: 'No renewal requests.', ar: 'لا توجد طلبات تجديد.' },
  renewed: { en: 'Renewed', ar: 'تم التجديد' },
  waiting: { en: 'Waiting', ar: 'بانتظار' },
  // The chat banner (staff view)
  lockedBanner: {
    en: 'Read-only for the parent and the teacher. You can still write.',
    ar: 'للقراءة فقط لولي الأمر والمعلم. يمكنك الكتابة.',
  },
}

export const STATE_LABEL: Record<AccessState, Pair> = {
  open: { en: 'Open', ar: 'نشط' },
  grace: { en: 'Grace lessons', ar: 'حصص سماح' },
  locked: { en: 'Locked', ar: 'موقوف' },
}

export const REASON_LABEL: Record<LockReason, Pair> = {
  balance: { en: 'lessons used up', ar: 'انتهت الحصص' },
  overdue: { en: 'instalment overdue', ar: 'قسط متأخر' },
}

export const KIND_LABEL: Record<ExceptionKind, Pair> = {
  balance: { en: 'Lessons used up', ar: 'انتهاء الحصص' },
  overdue: { en: 'An overdue instalment', ar: 'قسط متأخر' },
  both: { en: 'Both', ar: 'كلاهما' },
}

export const SOURCE_LABEL: Record<LedgerRow['source'], Pair> = {
  payment_request: { en: 'Paid link', ar: 'رابط مدفوع' },
  instalment_plan: { en: 'Instalment plan', ar: 'خطة أقساط' },
  staff: { en: 'Added by staff', ar: 'أضافه الموظف' },
  backfill: { en: 'Carried over (package)', ar: 'منقول (الباقة)' },
}

/** "3 months" / "٣ أشهر" -- PD-30 (3) shows it beside the lessons. */
export function monthsLabel(n: number, locale: 'ar' | 'en'): string {
  if (locale === 'en') return n === 1 ? '1 month' : `${n} months`
  if (n === 1) return 'شهر واحد'
  if (n === 2) return 'شهران'
  if (n >= 3 && n <= 10) return `${n} أشهر`
  return `${n} شهرًا`
}

export function lessonsLabel(n: number, locale: 'ar' | 'en'): string {
  if (locale === 'en') return n === 1 ? '1 lesson' : `${n} lessons`
  if (n === 1) return 'حصة واحدة'
  if (n === 2) return 'حصتان'
  if (n >= 3 && n <= 10) return `${n} حصص`
  return `${n} حصة`
}

/** PD-30 (3): "3 months — 24 lessons"; either half alone when the other is unknown. */
export function packageLabel(planMonths: number | null | undefined, lessons: number | null | undefined, locale: 'ar' | 'en'): string | null {
  const parts = [planMonths ? monthsLabel(planMonths, locale) : null, lessons ? lessonsLabel(lessons, locale) : null].filter(
    (x): x is string => x !== null,
  )
  return parts.length ? parts.join(' — ') : null
}

const BY_CODE: Record<string, Pair> = {
  'COMM.SUBSCRIPTION_DENIED': {
    en: 'Only the Super Admin, the Operations Manager and the Sales Manager grant or revoke exceptions.',
    ar: 'لا يمنح الاستثناءات أو يلغيها إلا المدير العام ومدير العمليات ومدير المبيعات.',
  },
  'COMM.SUBSCRIPTION_STATE': { en: 'This was already voided or revoked. Reload to see it.', ar: 'تم إلغاء هذا بالفعل. أعد التحميل لرؤيته.' },
  'COMM.BILLING_DENIED': { en: 'You may not see this child’s subscription.', ar: 'لا يمكنك رؤية اشتراك هذا الطالب.' },
}

export function describeError(error: unknown, locale: 'ar' | 'en'): string {
  const pick = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  if (error instanceof ApiError) {
    const known = error.code ? BY_CODE[error.code] : undefined
    if (known) return pick(known)
    return error.localized(locale)
  }
  return pick({ en: 'Something went wrong. Try again.', ar: 'حدث خطأ. حاول مرة أخرى.' })
}

/** A reader the server refuses (not a billing reader, or out of scope): the section is simply not shown. */
export function isRefusal(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 403 || error.status === 404)
}
