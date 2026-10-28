import { ApiError } from '@/core/api/errors'
import type { Pair } from '@/features/organization/copy'

export { useCopy, type Pair } from '@/features/organization/copy'

/**
 * PD-42 copy, Arabic and English side by side. Wording rule: this is the
 * administration entering the families it already handles in Jawwid Core; it
 * never says a payment is due, and the package numbers are Core's, as typed.
 */
export const I = {
  addFamily: { en: 'Add family', ar: 'إضافة أسرة' },
  addChild: { en: 'Add child', ar: 'إضافة طفل' },
  newTitle: { en: 'Add a family', ar: 'إضافة أسرة' },
  addTitle: { en: 'Add a child to', ar: 'إضافة طفل إلى' },
  intro: {
    en: 'Enter a family you already handle in Jawwid Core. Only the parent\'s name, a phone or an e-mail, and each child\'s name are required; the rest can be completed later.',
    ar: 'أدخل أسرة تتابعها بالفعل في جوِّد كور. المطلوب فقط اسم ولي الأمر، ورقم هاتف أو بريد إلكتروني، واسم كل طفل؛ ويمكن استكمال الباقي لاحقًا.',
  },
  required: { en: 'Required', ar: 'مطلوب' },
  parentSection: { en: 'Parent', ar: 'ولي الأمر' },
  parentName: { en: 'Parent\'s full name', ar: 'الاسم الكامل لولي الأمر' },
  phone: { en: 'Phone number', ar: 'رقم الهاتف' },
  phoneHint: { en: 'With the country code, or choose the country.', ar: 'مع رمز الدولة، أو اختر الدولة.' },
  email: { en: 'E-mail (to sign in to the app)', ar: 'البريد الإلكتروني (لتسجيل الدخول إلى التطبيق)' },
  country: { en: 'Country of the number', ar: 'دولة الرقم' },
  oneChannel: { en: 'Enter a phone number or an e-mail.', ar: 'أدخل رقم هاتف أو بريدًا إلكترونيًا.' },
  onBehalf: { en: 'Entered for', ar: 'إدخال نيابةً عن' },
  onBehalfHint: { en: 'The supervisor the family belongs to.', ar: 'المشرف الذي تتبعه الأسرة.' },
  choose: { en: 'Choose…', ar: 'اختر…' },
  childrenSection: { en: 'Children', ar: 'الأطفال' },
  child: { en: 'Child', ar: 'الطفل' },
  childName: { en: 'Child\'s name', ar: 'اسم الطفل' },
  teacher: { en: 'Teacher', ar: 'المعلم' },
  noTeacher: { en: 'Not known yet', ar: 'غير معروف بعد' },
  course: { en: 'Course', ar: 'المسار' },
  age: { en: 'Age', ar: 'العمر' },
  birthDate: { en: 'Date of birth', ar: 'تاريخ الميلاد' },
  times: { en: 'Weekly lesson times', ar: 'مواعيد الحصص الأسبوعية' },
  addTime: { en: '+ Time', ar: '+ موعد' },
  remove: { en: 'Remove', ar: 'إزالة' },
  duration: { en: 'Lesson length (minutes)', ar: 'مدة الحصة (بالدقائق)' },
  timesNeedTeacher: { en: 'Weekly times need the child\'s teacher.', ar: 'تحتاج المواعيد الأسبوعية إلى معلم الطفل.' },
  addAnotherChild: { en: '+ Another child', ar: '+ طفل آخر' },
  packageSection: { en: 'Current package (from Jawwid Core)', ar: 'الباقة الحالية (من جوِّد كور)' },
  packageHint: {
    en: 'Only for a child already enrolled in Core. Lessons used in Chat from today count against it; no payment is asked for.',
    ar: 'فقط لطفل مسجّل بالفعل في كور. تُحتسب الحصص المستخدمة في الدردشة من اليوم؛ ولا يُطلب أي دفع.',
  },
  total: { en: 'Total lessons', ar: 'إجمالي الحصص' },
  completed: { en: 'Completed lessons', ar: 'الحصص المكتملة' },
  remaining: { en: 'Remaining', ar: 'المتبقي' },
  planMonths: { en: 'Plan length (months)', ar: 'مدة الباقة (بالأشهر)' },
  active: { en: 'Active', ar: 'نشطة' },
  usedUp: { en: 'Used up', ar: 'مستنفدة' },
  overBy: { en: 'Over by', ar: 'تجاوز بمقدار' },
  overManagers: {
    en: 'More completed than the package: only the Operations Manager, the Sales Manager or the super admin can enter this, and confirm it.',
    ar: 'المكتمل أكثر من الباقة: لا يُدخله ويؤكده إلا مدير العمليات أو مدير المبيعات أو المدير العام.',
  },
  confirmOver: { en: 'I confirm these numbers as Core shows them.', ar: 'أؤكد هذه الأرقام كما تظهر في كور.' },
  review: { en: 'Review', ar: 'مراجعة' },
  reviewTitle: { en: 'Check before saving', ar: 'راجع قبل الحفظ' },
  back: { en: 'Back', ar: 'رجوع' },
  save: { en: 'Save', ar: 'حفظ' },
  saving: { en: 'Saving…', ar: 'جارٍ الحفظ…' },
  noPackage: { en: 'No package entered', ar: 'لم تُدخل باقة' },
  months: { en: 'months', ar: 'أشهر' },
  done: { en: 'The family was entered.', ar: 'تمت إضافة الأسرة.' },
  doneChild: { en: 'The child was added.', ar: 'تمت إضافة الطفل.' },
  needsSupervisor: {
    en: 'It waits for the Operations Manager to choose its Operations supervisor.',
    ar: 'بانتظار أن يختار مدير العمليات مشرف العمليات لها.',
  },
  timesNotSet: { en: 'Weekly times not set for', ar: 'لم تُضبط المواعيد الأسبوعية لـ' },
  openParent: { en: 'Open the parent', ar: 'فتح ملف ولي الأمر' },
  close: { en: 'Close', ar: 'إغلاق' },
  parentExists: { en: 'This parent is already in Chat.', ar: 'ولي الأمر هذا موجود بالفعل في الدردشة.' },
  parentExistsAsk: { en: 'Ask your manager: the family is not one of yours.', ar: 'تواصل مع مديرك: هذه الأسرة ليست من أسرك.' },
  addToFamily: { en: 'Add the children to this family', ar: 'إضافة الأطفال إلى هذه الأسرة' },
  childExists: { en: 'A child with this name is already in the family.', ar: 'يوجد طفل بهذا الاسم في الأسرة بالفعل.' },
  confirmTwin: { en: 'It is another child (for example a twin).', ar: 'إنه طفل آخر (توأم مثلًا).' },
} satisfies Record<string, Pair>

/** The server's refusal, in the reader's language. */
export function describeIntakeError(error: unknown, locale: 'ar' | 'en'): string {
  const pick = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  if (error instanceof ApiError) {
    if (error.code === 'COMM.PARENT_EXISTS') return pick(I.parentExists)
    if (error.code === 'COMM.CHILD_EXISTS') return pick(I.childExists)
    return error.localized(locale)
  }
  return pick({ en: 'Something went wrong. Try again.', ar: 'حدث خطأ. حاول مرة أخرى.' })
}
