import { ApiError } from '@/core/api/errors'
import type { Pair } from '@/features/organization/copy'

export { useCopy, type Pair } from '@/features/organization/copy'

/**
 * PD-12 S1 copy, Arabic and English side by side. Wording rule: a label never
 * promises more than the server does -- "Issue" delivers the file to the
 * learner's group, and the page says where it goes before it is clicked.
 */
export const S = {
  // Tabs of the Teachers area
  tabTeachers: { en: 'Teachers', ar: 'المعلمون' },
  tabCertificates: { en: 'Certificates', ar: 'الشهادات' },
  tabLeave: { en: 'Leave requests', ar: 'طلبات الإجازة' },
  tabDiscipline: { en: 'Discipline', ar: 'الانضباط' },
  sections: { en: 'Teachers department', ar: 'قسم المعلمين' },

  // Certificates
  certTitle: { en: 'Student certificates', ar: 'شهادات الطلاب' },
  certSubtitle: {
    en: 'Requested by teachers from their private supervision chat. Issuing uploads the certificate and delivers it to the student’s group, where the teacher and the parents receive it.',
    ar: 'يطلبها المعلمون من محادثة الإشراف الخاصة بهم. الإصدار يرفع الشهادة ويرسلها إلى مجموعة الطالب، حيث يستلمها المعلم وأولياء الأمر.',
  },
  stateRequested: { en: 'Waiting', ar: 'بانتظار الإصدار' },
  stateIssued: { en: 'Issued', ar: 'صدرت' },
  stateDeclined: { en: 'Declined', ar: 'مرفوضة' },
  stateAll: { en: 'All', ar: 'الكل' },
  certificate: { en: 'Certificate', ar: 'الشهادة' },
  student: { en: 'Student', ar: 'الطالب' },
  teacher: { en: 'Teacher', ar: 'المعلم' },
  achievedOn: { en: 'Achieved on', ar: 'تاريخ الإنجاز' },
  requested: { en: 'Requested', ar: 'تاريخ الطلب' },
  grade: { en: 'Grade', ar: 'التقدير' },
  printedName: { en: 'Name on the certificate', ar: 'الاسم على الشهادة' },
  teacherNote: { en: 'Teacher’s note', ar: 'ملاحظة المعلم' },
  noCertificates: { en: 'No certificates here.', ar: 'لا توجد شهادات هنا.' },
  issue: { en: 'Issue', ar: 'إصدار' },
  issueTitle: { en: 'Issue the certificate for {name}', ar: 'إصدار شهادة {name}' },
  issueHint: {
    en: 'Upload the finished certificate (PDF or image, up to 20 MB). It is posted once to the student’s group; it cannot be withdrawn afterwards.',
    ar: 'ارفع الشهادة النهائية (PDF أو صورة، حتى 20 ميغابايت). تُنشر مرة واحدة في مجموعة الطالب، ولا يمكن سحبها بعد ذلك.',
  },
  file: { en: 'Certificate file', ar: 'ملف الشهادة' },
  fileTooLarge: { en: 'The file is larger than 20 MB.', ar: 'حجم الملف أكبر من 20 ميغابايت.' },
  fileWrongType: { en: 'Choose a PDF, JPEG, PNG or WebP file.', ar: 'اختر ملف PDF أو JPEG أو PNG أو WebP.' },
  uploading: { en: 'Uploading…', ar: 'جارٍ الرفع…' },
  decline: { en: 'Decline', ar: 'رفض' },
  declineTitle: { en: 'Decline the request for {name}', ar: 'رفض طلب شهادة {name}' },
  declineHint: {
    en: 'The teacher sees your reason in their supervision chat. The family is not told.',
    ar: 'يرى المعلم السبب في محادثة الإشراف. لا تُبلَّغ الأسرة.',
  },
  noGroup: {
    en: 'No group to deliver into — open the student’s group first.',
    ar: 'لا توجد مجموعة للإرسال إليها — افتح مجموعة الطالب أولًا.',
  },
  declinedBecause: { en: 'Declined: {reason}', ar: 'سبب الرفض: {reason}' },

  // Leave
  leaveTitle: { en: 'Leave requests', ar: 'طلبات الإجازة' },
  leaveSubtitle: {
    en: 'Requested by teachers from their supervision chat. Approved days are deducted from the teacher’s balance; cancelling returns the days that have not passed.',
    ar: 'يطلبها المعلمون من محادثة الإشراف. تُخصم الأيام المعتمدة من رصيد المعلم، والإلغاء يعيد الأيام التي لم تمضِ.',
  },
  leaveRequested: { en: 'Waiting', ar: 'بانتظار القرار' },
  leaveApproved: { en: 'Approved', ar: 'معتمدة' },
  leaveDeclined: { en: 'Declined', ar: 'مرفوضة' },
  leaveWithdrawn: { en: 'Withdrawn', ar: 'مسحوبة' },
  leaveCancelled: { en: 'Cancelled', ar: 'ملغاة' },
  dates: { en: 'Dates', ar: 'التاريخ' },
  days: { en: 'Days', ar: 'الأيام' },
  reason: { en: 'Reason', ar: 'السبب' },
  balanceNow: { en: 'Balance now', ar: 'الرصيد الحالي' },
  noAllowance: { en: 'No allowance set', ar: 'لم يُحدَّد رصيد' },
  lessonsInside: { en: '{n} lesson(s) inside', ar: 'حصص داخل الإجازة: {n}' },
  noLeave: { en: 'No leave requests here.', ar: 'لا توجد طلبات إجازة هنا.' },
  approve: { en: 'Approve', ar: 'اعتماد' },
  approveTitle: { en: 'Approve leave for {name}', ar: 'اعتماد إجازة {name}' },
  approveDaysHint: {
    en: 'Untick a day that is not leave — the teacher’s regular day off, for example. Only ticked days are deducted.',
    ar: 'ألغِ تحديد اليوم الذي ليس إجازة، كيوم الإجازة الأسبوعية للمعلم. تُخصم الأيام المحددة فقط.',
  },
  deducted: { en: '{n} day(s) will be deducted; balance after: {b}', ar: 'سيُخصم {n} يوم؛ الرصيد بعد الاعتماد: {b}' },
  collisions: { en: 'Lessons inside this leave', ar: 'حصص داخل هذه الإجازة' },
  collisionsHint: {
    en: 'These lessons will be cancelled and each family is told in its student group. A make-up is owed.',
    ar: 'ستُلغى هذه الحصص وتُبلَّغ كل أسرة في مجموعة الطالب. تُستحق حصة تعويضية.',
  },
  confirmCancelLessons: { en: 'Cancel these lessons', ar: 'إلغاء هذه الحصص' },
  confirmRequired: { en: 'Confirm the lessons first.', ar: 'أكّد إلغاء الحصص أولًا.' },
  pickADay: { en: 'Tick at least one day.', ar: 'حدّد يومًا واحدًا على الأقل.' },
  note: { en: 'Note (optional)', ar: 'ملاحظة (اختيارية)' },
  declineLeaveTitle: { en: 'Decline leave for {name}', ar: 'رفض إجازة {name}' },
  cancelLeave: { en: 'Cancel leave', ar: 'إلغاء الإجازة' },
  cancelLeaveTitle: { en: 'Cancel the approved leave of {name}', ar: 'إلغاء الإجازة المعتمدة لـ {name}' },
  cancelLeaveHint: {
    en: 'Days that have not passed return to the balance. Lessons already cancelled for this leave are not re-created.',
    ar: 'تعود الأيام التي لم تمضِ إلى الرصيد. الحصص التي أُلغيت لهذه الإجازة لا تُعاد تلقائيًا.',
  },
  notCancelled: {
    en: '{n} lesson(s) could not be cancelled and remain on the needs-action list.',
    ar: 'تعذّر إلغاء {n} حصة، وما زالت في قائمة ما يحتاج إجراءً.',
  },
  whyRequired: { en: 'Reason (the teacher sees it)', ar: 'السبب (يراه المعلم)' },

  // Teacher File section
  leaveSection: { en: 'Leave', ar: 'الإجازات' },
  allowance: { en: 'Allowance {year}', ar: 'رصيد {year}' },
  used: { en: 'Used', ar: 'المستخدم' },
  balance: { en: 'Balance', ar: 'المتبقي' },
  setAllowance: { en: 'Set allowance', ar: 'تحديد الرصيد' },
  setAllowanceTitle: { en: 'Leave allowance for {year}', ar: 'رصيد الإجازات لعام {year}' },
  allowanceDays: { en: 'Days', ar: 'عدد الأيام' },
  allowanceHint: {
    en: 'The balance is always the allowance minus the days off recorded this year. Changing the allowance keeps the earlier value in the history.',
    ar: 'الرصيد دائمًا هو الرصيد السنوي ناقص أيام الإجازة المسجلة هذا العام. تغيير الرصيد يحفظ القيمة السابقة في السجل.',
  },
  daysInvalid: { en: 'A whole number from 0 to 366.', ar: 'عدد صحيح من 0 إلى 366.' },
  history: { en: 'Earlier allowances', ar: 'أرصدة سابقة' },
  noRequestsYear: { en: 'No leave requests this year.', ar: 'لا توجد طلبات إجازة هذا العام.' },
  openChat: { en: 'Supervision chat', ar: 'محادثة الإشراف' },
  openingChat: { en: 'Opening…', ar: 'جارٍ الفتح…' },

  // Shared
  required: { en: 'Required.', ar: 'مطلوب.' },
  save: { en: 'Save', ar: 'حفظ' },
  saving: { en: 'Saving…', ar: 'جارٍ الحفظ…' },
  by: { en: '{name}, {date}', ar: '{name}، {date}' },
  none: { en: '—', ar: '—' },
} satisfies Record<string, Pair>

const BY_CODE: Record<string, Pair> = {
  'COMM.CERTIFICATE_DENIED': {
    en: 'Certificates are for the Teachers department and the super admin.',
    ar: 'الشهادات لقسم المعلمين والمدير العام فقط.',
  },
  'COMM.CERTIFICATE_NOT_FOUND': { en: 'This certificate was not found.', ar: 'لم يُعثر على هذه الشهادة.' },
  'COMM.CERTIFICATE_STATE': {
    en: 'This certificate cannot be changed now: it was already decided, or the student has no group yet.',
    ar: 'لا يمكن تعديل هذه الشهادة الآن: سبق البت فيها، أو لا توجد مجموعة للطالب بعد.',
  },
  'COMM.ATTACHMENT_TYPE_NOT_ALLOWED': {
    en: 'The file is not the PDF or image it claims to be.',
    ar: 'الملف ليس ملف PDF أو صورة كما يدّعي.',
  },
  'COMM.ATTACHMENT_TOO_LARGE': { en: 'The file is larger than 20 MB.', ar: 'حجم الملف أكبر من 20 ميغابايت.' },
  'COMM.LEAVE_DENIED': {
    en: 'Leave is decided by the Teachers department; the allowance is set by its manager.',
    ar: 'يبت قسم المعلمين في الإجازات، ويحدد مديره الرصيد.',
  },
  'COMM.LEAVE_NOT_FOUND': { en: 'This leave request was not found.', ar: 'لم يُعثر على طلب الإجازة.' },
  'COMM.LEAVE_STATE': {
    en: 'This leave cannot be changed now: it was already decided or withdrawn.',
    ar: 'لا يمكن تعديل هذه الإجازة الآن: سبق البت فيها أو سُحبت.',
  },
  'COMM.LEAVE_LESSONS_COLLIDE': {
    en: 'Lessons fall inside this leave. Confirm that they will be cancelled.',
    ar: 'توجد حصص داخل هذه الإجازة. أكّد إلغاءها.',
  },
  'COMM.SUPERVISION_DENIED': {
    en: 'Supervision chats are for the Teachers department.',
    ar: 'محادثات الإشراف لقسم المعلمين فقط.',
  },
}

export function describeError(error: unknown, locale: 'ar' | 'en'): string {
  const pick = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  if (error instanceof ApiError) {
    const mapped = BY_CODE[error.code]
    return mapped ? pick(mapped) : error.localized(locale)
  }
  return pick({ en: 'Something went wrong. Try again.', ar: 'حدث خطأ. حاول مرة أخرى.' })
}

/** A refusal the page explains instead of the generic "forbidden". */
export function isSupervisionRefusal(error: unknown): boolean {
  return error instanceof ApiError && ['COMM.CERTIFICATE_DENIED', 'COMM.LEAVE_DENIED'].includes(error.code)
}
