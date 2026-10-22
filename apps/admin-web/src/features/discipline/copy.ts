import { ApiError } from '@/core/api/errors'
import type { Pair } from '@/features/organization/copy'
import type { Decision } from './api'

export { useCopy, type Pair } from '@/features/organization/copy'

/**
 * PD-12 S2 copy, Arabic and English side by side. Wording rule: the page says
 * what the server will do -- a deduction tells payroll, it never names an amount.
 */
export const D = {
  title: { en: 'Discipline', ar: 'الانضباط' },
  subtitle: {
    en: 'Lateness and cancellations, and the step each one reaches this month. The system suggests; a person decides each one, once.',
    ar: 'التأخير والاعتذارات، والخطوة التي تبلغها كل مخالفة هذا الشهر. يقترح النظام، ويقرر شخص في كل مخالفة مرة واحدة.',
  },
  needsDecision: { en: 'Needs decision', ar: 'بحاجة إلى قرار' },
  lateness: { en: 'Lateness', ar: 'التأخير' },
  cancellations: { en: 'Cancellations', ar: 'الاعتذارات والغياب' },
  month: { en: 'Month', ar: 'الشهر' },
  teacher: { en: 'Teacher', ar: 'المعلم' },
  what: { en: 'What happened', ar: 'ما حدث' },
  step: { en: 'Step this month', ar: 'خطوة هذا الشهر' },
  outcome: { en: 'Decision', ar: 'القرار' },
  empty: { en: 'Nothing here.', ar: 'لا شيء هنا.' },
  decide: { en: 'Decide', ar: 'قرار' },
  recordLateness: { en: 'Record lateness', ar: 'تسجيل تأخير' },
  kindLate: { en: '{n} min late', ar: 'تأخر {n} دقيقة' },
  kindApology: { en: 'Apologised for the lesson', ar: 'اعتذر عن الحصة' },
  kindNoShow: { en: 'Absent from the lesson', ar: 'غاب عن الحصة' },
  kindAbsence: { en: 'Absent', ar: 'غياب' },
  kindComplaint: { en: 'Complaint upheld', ar: 'شكوى ثبتت' },
  fromParent: { en: 'From a parent', ar: 'من ولي أمر' },
  fromManagement: { en: 'From management', ar: 'من الإدارة' },
  recordedBy: { en: 'Recorded by {name}', ar: 'سجّلها {name}' },
  automatic: { en: 'Recorded automatically', ar: 'سُجّلت تلقائيًا' },
  lessonType: { en: 'Lesson type', ar: 'نوع الحصة' },
  trial: { en: 'Trial', ar: 'تجريبية' },
  regular: { en: 'Regular', ar: 'عادية' },
  noHeldTrials: { en: 'No attended trials in the last two weeks.', ar: 'لا توجد حصص تجريبية حضرها الطالب في آخر أسبوعين.' },
  chooseTrial: { en: 'Choose an attended trial from the last two weeks', ar: 'اختر حصة تجريبية من آخر أسبوعين' },

  absenceTitle: { en: 'Record an absence', ar: 'تسجيل غياب' },
  absenceHint: {
    en: 'For an absence with no lesson to close (a meeting, a shift). If the teacher missed a lesson, close that lesson as the teacher’s absence from Needs action instead: the family is told and the absence is recorded here by itself.',
    ar: 'لغياب لا ترتبط به حصة (اجتماع، مناوبة). إن غاب المعلم عن حصة فأغلقها كغياب للمعلم من «بحاجة إلى إجراء»: تُبلَّغ الأسرة ويُسجَّل الغياب هنا تلقائيًا.',
  },
  day: { en: 'Day', ar: 'اليوم' },
  whatHappened: { en: 'What happened', ar: 'ما حدث' },
  stepOf: { en: 'Step {n}', ar: 'الخطوة {n}' },
  suggested: { en: 'Suggested: {d}', ar: 'المقترح: {d}' },
  suggestedTag: { en: 'suggested', ar: 'المقترح' },
  notCancelled: {
    en: 'Decided. {n} lesson(s) could not be cancelled and stay on the needs-action list.',
    ar: 'تم القرار. تعذّر إلغاء {n} حصة، وما زالت في قائمة ما يحتاج إجراءً.',
  },
  by: { en: '{name}, {date}', ar: '{name}، {date}' },

  decideTitle: { en: 'Decide: {teacher}', ar: 'قرار: {teacher}' },
  decideHint: {
    en: 'Step {n} of this month. Choosing anything but the suggestion, or excusing, needs a reason. The teacher is told in their supervision chat.',
    ar: 'الخطوة {n} لهذا الشهر. اختيار غير المقترح، أو الإعفاء، يحتاج إلى سبب. يُبلَّغ المعلم في محادثة الإشراف.',
  },
  reason: { en: 'Reason', ar: 'السبب' },
  reasonOptional: { en: 'Note (optional)', ar: 'ملاحظة (اختيارية)' },
  reasonRequired: { en: 'Say why.', ar: 'اذكر السبب.' },
  startsOn: { en: 'First day', ar: 'أول يوم' },
  endsOn: { en: 'Last day', ar: 'آخر يوم' },
  deductionHint: {
    en: 'The super admin’s default amount for this step is deducted in payroll for that month at once; the super admin can change it for this case in the teacher’s Payroll.',
    ar: 'يُخصم مبلغ الخطوة الافتراضي الذي حدده المدير العام من رواتب ذلك الشهر فورًا، ويمكن للمدير العام تعديله لهذه الحالة من قسم الرواتب في ملف المعلم.',
  },
  temporaryHint: {
    en: 'The days become days off, so no make-up is booked with this teacher; they never count against leave.',
    ar: 'تصبح الأيام أيام إجازة فلا تُحجز حصص تعويضية مع هذا المعلم، ولا تُخصم من رصيد الإجازات.',
  },
  permanentHint: {
    en: 'The teacher is deactivated and signed out everywhere. Move all their students first (Schedules › Transfer).',
    ar: 'يُعطَّل حساب المعلم ويُسجَّل خروجه من كل مكان. انقل كل طلابه أولًا (الجداول › النقل).',
  },
  collide: {
    en: 'Open lessons fall inside the suspension. They will be cancelled and each family told in its group.',
    ar: 'توجد حصص مفتوحة داخل فترة الإيقاف. ستُلغى ويُبلَّغ كل أسرة في مجموعتها.',
  },
  confirmCancel: { en: 'Cancel those lessons', ar: 'إلغاء تلك الحصص' },
  save: { en: 'Confirm', ar: 'تأكيد' },
  saving: { en: 'Saving…', ar: 'جارٍ الحفظ…' },

  latenessTitle: { en: 'Record lateness', ar: 'تسجيل تأخير' },
  latenessHint: {
    en: 'On a lesson that was held. It counts from the academy’s threshold; below it, nothing is recorded.',
    ar: 'على حصة انعقدت. يُحتسب ابتداءً من حد الأكاديمية؛ وما دونه لا يُسجَّل.',
  },
  lesson: { en: 'Lesson', ar: 'الحصة' },
  chooseTeacher: { en: 'Choose a teacher', ar: 'اختر معلمًا' },
  chooseLesson: { en: 'Choose a held lesson from the last two weeks', ar: 'اختر حصة منعقدة من آخر أسبوعين' },
  noHeld: { en: 'No held lessons in the last two weeks.', ar: 'لا توجد حصص منعقدة في آخر أسبوعين.' },
  minutes: { en: 'Minutes late', ar: 'دقائق التأخير' },
  minutesInvalid: { en: 'A whole number from 1 to 240.', ar: 'عدد صحيح من 1 إلى 240.' },
  required: { en: 'Required.', ar: 'مطلوب.' },
} satisfies Record<string, Pair>

export const DECISION_LABEL: Record<Decision, Pair> = {
  warning: { en: 'Warning', ar: 'تنبيه' },
  deduction_1: { en: 'First deduction', ar: 'الخصم الأول' },
  deduction_2: { en: 'Second deduction', ar: 'الخصم الثاني' },
  temporary_suspension: { en: 'Temporary suspension', ar: 'إيقاف مؤقت' },
  permanent_suspension: { en: 'Permanent suspension', ar: 'إيقاف نهائي' },
  excused: { en: 'Excused', ar: 'معفى' },
}

const BY_CODE: Record<string, Pair> = {
  'COMM.DISCIPLINE_DENIED': {
    en: 'Discipline is for the Teachers department and the super admin.',
    ar: 'الانضباط لقسم المعلمين والمدير العام فقط.',
  },
  'COMM.DISCIPLINE_NOT_FOUND': { en: 'Not found.', ar: 'غير موجود.' },
}

export function describeError(error: unknown, locale: 'ar' | 'en'): string {
  const pick = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  if (error instanceof ApiError) {
    const mapped = BY_CODE[error.code]
    return mapped ? pick(mapped) : error.localized(locale)
  }
  return pick({ en: 'Something went wrong. Try again.', ar: 'حدث خطأ. حاول مرة أخرى.' })
}
