import type { Pair } from './copy'

/**
 * PD-42 S4: the intake's audited actions, in words -- as a family's history
 * says them ("Sales One · Entered the family") and as a staff member's Action
 * log does ("Entered a family"). Arabic and English side by side.
 */
export const HISTORY: Record<string, Pair> = {
  'new_student.enrolled': { en: 'Enrolled from a trial', ar: 'سُجّلت من حصة تجريبية' },
  'family.entered': { en: 'Entered the family', ar: 'أدخل الأسرة' },
  'family.children_added': { en: 'Added children', ar: 'أضاف أطفالًا' },
  'family.sales_owner_set': { en: 'Set the Sales owner', ar: 'عيّن مسؤول المبيعات' },
  'family.sales_owner_changed': { en: 'Changed the Sales owner', ar: 'غيّر مسؤول المبيعات' },
  'family.supervisor_suggested': { en: 'Suggested an Operations supervisor', ar: 'اقترح مشرف عمليات' },
  'family.operations_supervisor_set': { en: 'Chose the Operations supervisor', ar: 'اختار مشرف العمليات' },
  'learner.supervisor_assigned': { en: 'Placed a child on a supervisor', ar: 'أسند طفلًا إلى مشرف' },
  'learner.supervision_imported': { en: 'Supervisor brought in by an import', ar: 'أُدخل المشرف عبر استيراد' },
  'subscription.carried_over': { en: 'Carried over the package from Jawwid Core', ar: 'رحّل الباقة من جوِّد كور' },
  'subscription.voided': { en: 'Removed a package', ar: 'أزال باقة' },
  'parent.sign_in_email_set': { en: 'Set the sign-in e-mail', ar: 'عيّن بريد تسجيل الدخول' },
}

export const ACTION_LOG: Record<string, Pair> = {
  'new_student.enrolled': { en: 'Enrolled a new student', ar: 'سجّل طالبًا جديدًا' },
  'family.entered': { en: 'Entered a family', ar: 'أدخل أسرة' },
  'family.children_added': { en: 'Added children to a family', ar: 'أضاف أطفالًا إلى أسرة' },
  'family.sales_owner_set': { en: "Set a family's Sales owner", ar: 'عيّن مسؤول المبيعات لأسرة' },
  'family.sales_owner_changed': { en: "Changed a family's Sales owner", ar: 'غيّر مسؤول المبيعات لأسرة' },
  'family.supervisor_suggested': { en: "Suggested a family's Operations supervisor", ar: 'اقترح مشرف عمليات لأسرة' },
  'family.operations_supervisor_set': { en: "Chose a family's Operations supervisor", ar: 'اختار مشرف العمليات لأسرة' },
  'family_group.learners_added': { en: 'Added children to a family group', ar: 'أضاف أطفالًا إلى مجموعة أسرة' },
  'subscription.carried_over': { en: 'Carried over a package from Jawwid Core', ar: 'رحّل باقة من جوِّد كور' },
  'subscription.voided': { en: 'Removed a package', ar: 'أزال باقة' },
  'parent.sign_in_email_set': { en: "Set a parent's sign-in e-mail", ar: 'عيّن بريد تسجيل الدخول لولي أمر' },
}

export const H = {
  title: { en: 'Family history', ar: 'سجل الأسرة' },
  hint: {
    en: 'Who entered this family and its children, who owns it, who chose its Operations supervisor, and its packages -- oldest first.',
    ar: 'من أدخل هذه الأسرة وأطفالها، ومن يتولاها، ومن اختار مشرف العمليات لها، وباقاتها -- الأقدم أولًا.',
  },
  empty: { en: 'Nothing recorded yet.', ar: 'لا شيء مسجّل بعد.' },
  system: { en: 'The system', ar: 'النظام' },
  children: { en: 'children', ar: 'أطفال' },
} satisfies Record<string, Pair>
