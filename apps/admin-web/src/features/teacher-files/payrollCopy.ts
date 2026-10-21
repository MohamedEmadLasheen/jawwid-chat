import { ApiError } from '@/core/api/errors'
import type { Pair } from './copy'
import { describeError } from './copy'

/**
 * PD-18 payroll copy, Arabic and English side by side. Wording rule: an
 * amount the server has not computed is "—", never 0; the page never adds
 * anything up itself.
 */
export const P = {
  employment: { en: 'Employment', ar: 'بيانات التوظيف' },
  teachingMarket: { en: 'Teaching market', ar: 'سوق التدريس' },
  currentStudents: { en: 'Current students', ar: 'عدد الطلاب الحاليين' },
  salaryType: { en: 'Salary type', ar: 'نوع الراتب' },
  shift: { en: 'Shift-based', ar: 'بنظام الورديات' },
  hourly: { en: 'Per hour', ar: 'بالساعة' },
  currency: { en: 'Salary currency', ar: 'عملة الراتب' },
  monthlySalary: { en: 'Monthly salary', ar: 'الراتب الشهري' },
  hourlyRate: { en: 'Hourly rate', ar: 'أجر الساعة' },
  hourlyMonthly: { en: 'Rate × hours of lessons held — see the financial summary', ar: 'الأجر × ساعات الحصص المنعقدة — انظر الملخص المالي' },
  effectiveFrom: { en: 'From {month}', ar: 'اعتبارًا من {month}' },
  noTerms: { en: 'No salary terms recorded yet.', ar: 'لم تُسجَّل شروط الراتب بعد.' },
  setTerms: { en: 'Change salary terms', ar: 'تغيير شروط الراتب' },
  termsHint: {
    en: 'Terms are kept as versions: a change applies from the month you choose, and earlier months keep the terms they had.',
    ar: 'تُحفَظ الشروط كنسخ: يسري التغيير من الشهر الذي تختاره، وتحتفظ الأشهر السابقة بشروطها.',
  },
  financeOnly: { en: 'Visible to the super admin only.', ar: 'يظهر للمدير العام فقط.' },

  payout: { en: 'Salary payment method', ar: 'طريقة صرف الراتب' },
  e_wallet: { en: 'E-wallet', ar: 'محفظة إلكترونية' },
  instapay: { en: 'InstaPay', ar: 'إنستاباي' },
  bank_transfer: { en: 'Bank transfer', ar: 'تحويل بنكي' },
  endingIn: { en: 'ending in {last4}', ar: 'ينتهي بـ {last4}' },
  noPayout: { en: 'No payment method recorded yet.', ar: 'لم تُسجَّل طريقة الصرف بعد.' },
  setPayout: { en: 'Set payment method', ar: 'تحديد طريقة الصرف' },
  reveal: { en: 'Show account details', ar: 'عرض بيانات الحساب' },
  revealHint: {
    en: 'The details are stored encrypted. Showing them is recorded with your name and reason.',
    ar: 'تُحفَظ البيانات مشفّرة. يُسجَّل عرضها باسمك وسببك.',
  },
  revealReason: { en: 'Why you need them', ar: 'سبب الحاجة إليها' },
  show: { en: 'Show', ar: 'عرض' },
  close: { en: 'Close', ar: 'إغلاق' },
  payoutHint: {
    en: 'Saved encrypted. Afterwards the file shows only the method and the last four characters.',
    ar: 'تُحفَظ مشفّرة. بعدها يعرض الملف طريقة الصرف وآخر أربعة أحرف فقط.',
  },
  noKey: {
    en: 'Payment accounts are switched off on this server (no encryption key). Ask the technical team to set TEACHER_PAYOUT_KEYS.',
    ar: 'حسابات الصرف معطّلة على هذا الخادم (لا يوجد مفتاح تشفير). اطلب من الفريق التقني ضبط TEACHER_PAYOUT_KEYS.',
  },
  method: { en: 'Method', ar: 'الطريقة' },
  provider: { en: 'Wallet provider', ar: 'مزوّد المحفظة' },
  walletNumber: { en: 'Wallet number', ar: 'رقم المحفظة' },
  address: { en: 'InstaPay address', ar: 'عنوان إنستاباي' },
  bankName: { en: 'Bank', ar: 'البنك' },
  accountHolder: { en: 'Account holder', ar: 'اسم صاحب الحساب' },
  accountNumber: { en: 'Account number', ar: 'رقم الحساب' },
  iban: { en: 'IBAN (optional)', ar: 'رقم IBAN (اختياري)' },
  swift: { en: 'SWIFT (optional)', ar: 'رمز SWIFT (اختياري)' },

  summary: { en: 'Financial summary', ar: 'الملخص المالي' },
  summaryHint: {
    en: 'Computed from the salary terms, the amounts below and, for an hourly salary, the lessons the teacher held or the student missed.',
    ar: 'محسوب من شروط الراتب والمبالغ أدناه، وللراتب بالساعة من الحصص التي عقدها المعلم أو غاب عنها الطالب.',
  },
  month: { en: 'Month', ar: 'الشهر' },
  base: { en: 'Salary', ar: 'الراتب' },
  bonuses: { en: 'Bonuses', ar: 'المكافآت' },
  deductions: { en: 'Deductions', ar: 'الخصومات' },
  net: { en: 'Net', ar: 'الصافي' },
  paidHours: { en: '{h} paid hours', ar: '{h} ساعة مدفوعة' },
  none: { en: '—', ar: '—' },

  bonusHistory: { en: 'Bonus history', ar: 'سجل المكافآت' },
  deductionHistory: { en: 'Deduction history', ar: 'سجل الخصومات' },
  bonusHistoryHint: {
    en: 'Bonuses the Teachers department recorded. The super admin sets each amount.',
    ar: 'المكافآت التي سجّلها قسم المعلمين. يحدّد المدير العام مبلغ كل منها.',
  },
  deductionHistoryHint: {
    en: 'Deductions decided on the discipline ladder. The super admin sets each amount.',
    ar: 'الخصومات المقرّرة في سلّم الانضباط. يحدّد المدير العام مبلغ كل منها.',
  },
  noBonuses: { en: 'No bonuses recorded.', ar: 'لا توجد مكافآت مسجّلة.' },
  noDeductions: { en: 'No deductions recorded.', ar: 'لا توجد خصومات مسجّلة.' },
  date: { en: 'Date', ar: 'التاريخ' },
  reason: { en: 'Reason', ar: 'السبب' },
  amount: { en: 'Amount', ar: 'المبلغ' },
  by: { en: 'Recorded by', ar: 'سجّله' },
  notPriced: { en: 'Amount not set', ar: 'لم يُحدَّد المبلغ' },
  cancelled: { en: 'Cancelled', ar: 'ملغى' },
  setAmount: { en: 'Set amount', ar: 'تحديد المبلغ' },
  correct: { en: 'Correct', ar: 'تصحيح' },
  addBonus: { en: 'Add a bonus', ar: 'إضافة مكافأة' },
  addDeduction: { en: 'Add a deduction', ar: 'إضافة خصم' },
  standalone: { en: 'Added by the super admin', ar: 'أضافه المدير العام' },
  deduction_1: { en: 'First deduction', ar: 'الخصم الأول' },
  deduction_2: { en: 'Second deduction', ar: 'الخصم الثاني' },
  amountHint: {
    en: 'In the currency of that month’s salary terms. A correction replaces the amount; 0 cancels it.',
    ar: 'بعملة شروط الراتب لذلك الشهر. التصحيح يستبدل المبلغ، و0 يلغيه.',
  },
  noteFor: { en: 'Reason for this amount', ar: 'سبب هذا المبلغ' },
  changeReason: { en: 'Reason for the change', ar: 'سبب التغيير' },
  required: { en: 'Required.', ar: 'مطلوب.' },
  save: { en: 'Save', ar: 'حفظ' },
  saving: { en: 'Saving…', ar: 'جارٍ الحفظ…' },
} satisfies Record<string, Pair>

/** Payroll refusals: the server's own reason for a conflict, which names what to do. */
export function describePayrollError(error: unknown, locale: 'ar' | 'en'): string {
  if (error instanceof ApiError) {
    if (error.code === 'COMM.TEACHER_PAYROLL_UNAVAILABLE') return locale === 'ar' ? P.noKey.ar : P.noKey.en
    if (error.code === 'COMM.TEACHER_FILE_CONFLICT' || error.code === 'COMMON.VALIDATION') return error.localized(locale)
  }
  return describeError(error, locale)
}
