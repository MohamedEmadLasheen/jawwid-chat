import type { Pair } from '../teachers/copy'
import { ACADEMY_ZONE, isoToAcademyWallClock } from '@/core/time/academyTime'

/**
 * Trial and New Students copy, Arabic and English side by side. Jawwid Chat is
 * the only source of truth for a trial's outcome: "Subscribed" is final when
 * Sales records it, and no wording waits for Core.
 */
export const TR = {
  areaLabel: { en: 'Trials', ar: 'الحصص التجريبية' },
  trialsTitle: { en: 'Trial lessons', ar: 'الحصص التجريبية' },
  trialsSubtitle: {
    en: 'Book one or more students into a teacher\'s real free time. Each trial gets one outcome, recorded from the teacher\'s trial group with "+ → Trial" or here.',
    ar: 'احجز لطالب أو أكثر في وقت فارغ فعلي لدى المعلم. لكل حصة تجريبية نتيجة واحدة تُسجَّل من مجموعة المعلم التجريبية عبر «+ ← تجريبية» أو من هنا.',
  },
  newProspect: { en: 'Record a prospect', ar: 'تسجيل مهتم' },
  bookTrial: { en: 'Book a trial', ar: 'حجز حصة تجريبية' },
  prospect: { en: 'Students', ar: 'الطلاب' },
  displayName: { en: 'Name to show', ar: 'الاسم الظاهر' },
  level: { en: 'Level (optional)', ar: 'المستوى (اختياري)' },
  noteOptional: { en: 'Note (optional)', ar: 'ملاحظة (اختيارية)' },
  note: { en: 'Note', ar: 'ملاحظة' },
  teacher: { en: 'Teacher', ar: 'المعلم' },
  duration: { en: 'Length (minutes)', ar: 'المدة (بالدقائق)' },
  lengthHint: { en: 'From 15 to 120 minutes.', ar: 'من ١٥ إلى ١٢٠ دقيقة.' },
  missingLength: { en: 'Enter a length from 15 to 120 minutes.', ar: 'اكتب مدة من ١٥ إلى ١٢٠ دقيقة.' },
  time: { en: 'Free time', ar: 'الوقت المتاح' },
  noSlots: {
    en: 'This teacher has no free time in the coming weeks (or no working hours recorded).',
    ar: 'لا يوجد وقت فارغ لدى هذا المعلم في الأسابيع القادمة (أو لم تُسجّل ساعات عمله).',
  },
  chooseTeacherFirst: { en: 'Choose the teacher first', ar: 'اختر المعلم أولًا' },
  enterLengthFirst: { en: 'Enter the length first', ar: 'اكتب المدة أولًا' },
  students: { en: 'Students', ar: 'الطلاب' },
  student: { en: 'Student', ar: 'الطالب' },
  studentName: { en: 'Student name', ar: 'اسم الطالب' },
  studentLevel: { en: 'Level (optional)', ar: 'المستوى (اختياري)' },
  addStudent: { en: 'Add another student', ar: 'إضافة طالب آخر' },
  missingStudentName: {
    en: 'Enter a name for every student, or remove the empty one.',
    ar: 'اكتب اسم كل طالب، أو احذف الطالب الفارغ.',
  },
  missingTeacher: { en: 'Choose the teacher.', ar: 'اختر المعلم.' },
  missingTime: { en: 'Choose a free time.', ar: 'اختر وقتًا متاحًا.' },
  removeStudent: { en: 'Remove this student', ar: 'حذف هذا الطالب' },
  studentsHint: {
    en: 'Siblings or a small group can share one trial. The trial gets one outcome for all of them.',
    ar: 'يمكن للإخوة أو لمجموعة صغيرة حضور حصة تجريبية واحدة، ولها نتيجة واحدة للجميع.',
  },
  book: { en: 'Book', ar: 'احجز' },
  save: { en: 'Save', ar: 'حفظ' },
  when: { en: 'When', ar: 'الموعد' },
  attendance: { en: 'Attendance', ar: 'الحضور' },
  decision: { en: 'Subscription', ar: 'الاشتراك' },
  actions: { en: 'Actions', ar: 'الإجراءات' },
  none: { en: 'No trial lessons in this period.', ar: 'لا توجد حصص تجريبية في هذه الفترة.' },
  filterAll: { en: 'All', ar: 'الكل' },
  filterDecision: { en: 'Needs a decision', ar: 'بانتظار قرار' },
  filterUpcoming: { en: 'Upcoming', ar: 'القادمة' },
  recordDecision: { en: 'Record decision', ar: 'تسجيل القرار' },
  result: { en: 'Result', ar: 'النتيجة' },
  subscribed: { en: 'Subscribed', ar: 'اشترك' },
  notSubscribed: { en: 'Did not subscribe', ar: 'لم يشترك' },
  reason: { en: 'Reason (if not subscribed)', ar: 'السبب (إن لم يشترك)' },
  cancel: { en: 'Cancel trial', ar: 'إلغاء الحصة' },
  editTrial: { en: 'Edit', ar: 'تعديل' },
  currentTime: { en: 'Now booked for', ar: 'الموعد الحالي' },
  cancelReason: { en: 'Reason', ar: 'السبب' },
  absence: { en: 'Prospect absent', ar: 'غياب المهتم' },
  report: { en: 'Teacher\'s report', ar: 'تقرير المعلم' },
  openGroup: { en: 'Trial group', ar: 'مجموعة التجريبية' },

  outcome: { en: 'Outcome', ar: 'النتيجة' },
  recordOutcome: { en: 'Record outcome', ar: 'تسجيل النتيجة' },
  correctOutcome: { en: 'Correct outcome', ar: 'تصحيح النتيجة' },
  filterOutcome: { en: 'Needs an outcome', ar: 'بانتظار النتيجة' },

  // The "+ -> Trial" card
  cardLabel: { en: 'Trial', ar: 'تجريبية' },
  cardTitle: { en: 'Trial', ar: 'الحصة التجريبية' },
  pickTrial: { en: 'Which trial?', ar: 'أي حصة تجريبية؟' },
  pickTrialHint: {
    en: 'This group holds every trial of this teacher. Pick the student and time.',
    ar: 'تضم هذه المجموعة كل الحصص التجريبية لهذا المعلم. اختر الطالب والموعد.',
  },
  noTrials: { en: 'This teacher has no trials to record yet.', ar: 'لا توجد حصص تجريبية لهذا المعلم بعد.' },
  needsOutcome: { en: 'Needs an outcome', ar: 'بحاجة إلى نتيجة' },
  upcomingHint: {
    en: 'Not started yet: its outcome can be recorded once the trial starts.',
    ar: 'لم تبدأ بعد: يمكن تسجيل نتيجتها بعد بدء الحصة.',
  },
  recorded: { en: 'Recorded', ar: 'مسجّلة' },
  optionNoShow: { en: 'The student did not attend the trial', ar: 'الطالب لم يحضر الحصة التجريبية' },
  optionSubscribed: { en: 'The student subscribed', ar: 'الطالب اشترك' },
  optionNotSubscribed: { en: 'Why didn\'t the student subscribe?', ar: 'لماذا لم يشترك الطالب؟' },
  salesOnly: { en: 'Recorded by Sales', ar: 'يسجّلها قسم المبيعات' },
  groupWillRead: { en: 'The group will read only:', ar: 'ستقرأ المجموعة فقط:' },
  privateNote: {
    en: 'The details stay private: they are saved for the New Students page and never posted in the group.',
    ar: 'تبقى التفاصيل خاصة: تُحفظ لصفحة الطلاب الجدد ولا تُنشر في المجموعة أبدًا.',
  },
  reasonPrivate: {
    en: 'The reason is saved with Sales and never posted in the group.',
    ar: 'يُحفظ السبب لدى قسم المبيعات ولا يُنشر في المجموعة أبدًا.',
  },
  confirm: { en: 'Confirm', ar: 'تأكيد' },
  submit: { en: 'Submit', ar: 'إرسال' },
  back: { en: 'Back', ar: 'رجوع' },
  why: { en: 'Why are you correcting it?', ar: 'لماذا تصحّح النتيجة؟' },
  current: { en: 'Current outcome', ar: 'النتيجة الحالية' },
  reasonRequired: { en: 'Reason', ar: 'السبب' },
  details: { en: 'Details', ar: 'التفاصيل' },
  detailsOptional: { en: 'Details (required for "Other")', ar: 'التفاصيل (مطلوبة عند «أخرى»)' },
  sentenceNoShow: { en: 'The student did not attend the trial lesson.', ar: 'لم يحضر الطالب الحصة التجريبية.' },
  sentenceSubscribed: { en: 'The student has subscribed.', ar: 'اشترك الطالب.' },
  sentenceNotSubscribed: { en: 'The student did not subscribe.', ar: 'لم يشترك الطالب.' },

  // The subscription form
  formTitle: { en: 'The student subscribed', ar: 'الطالب اشترك' },
  editForm: { en: 'Edit subscription', ar: 'تعديل الاشتراك' },
  parentSection: { en: 'Parent', ar: 'ولي الأمر' },
  parentName: { en: 'Parent\'s name', ar: 'اسم ولي الأمر' },
  parentEmail: { en: 'E-mail (optional)', ar: 'البريد الإلكتروني (اختياري)' },
  email: { en: 'E-mail', ar: 'البريد الإلكتروني' },
  parentPhone: { en: 'Phone number', ar: 'رقم الهاتف' },
  childrenSection: { en: 'Children', ar: 'الأبناء' },
  child: { en: 'Child', ar: 'الابن' },
  addChild: { en: 'Add a child', ar: 'إضافة ابن' },
  removeChild: { en: 'Remove this child', ar: 'حذف هذا الابن' },
  childName: { en: 'Name', ar: 'الاسم' },
  childAge: { en: 'Age', ar: 'العمر' },
  course: { en: 'Course', ar: 'الدورة' },
  assignedTeacher: { en: 'Assigned teacher', ar: 'المعلم المسؤول' },
  // PD-43: the chosen teacher is still being set up -- a warning, never a block.
  teacherNotReady: {
    en: 'This teacher’s set-up is not finished. Students are allowed; this is a warning.',
    ar: 'تجهيز هذا المعلم لم يكتمل. إسناد الطلاب مسموح؛ هذا تنبيه فقط.',
  },
  teacherManagerCovers: {
    en: 'The Teachers Manager covers this teacher until a supervisor is set.',
    ar: 'مدير قسم المعلمين مسؤول عن هذا المعلم حتى يُعيَّن له مشرف.',
  },
  packagePrice: { en: 'Package price', ar: 'سعر الباقة' },
  lessonPrice: { en: 'Price per lesson', ar: 'سعر الحصة' },
  schedule: { en: 'Schedule', ar: 'المواعيد' },
  addTime: { en: 'Add a day', ar: 'إضافة يوم' },
  removeTime: { en: 'Remove', ar: 'حذف' },
  weekday: { en: 'Day', ar: 'اليوم' },
  lessonTime: { en: 'Time', ar: 'الساعة' },
  paymentSection: { en: 'Payment', ar: 'الدفع' },
  currency: { en: 'Currency', ar: 'العملة' },
  paymentMethod: { en: 'Paid by', ar: 'طريقة الدفع' },
  bankTransfer: { en: 'Bank account transfer', ar: 'تحويل بنكي' },
  invoice: { en: 'Invoice', ar: 'فاتورة' },
  fillRequired: { en: 'Fill in every required field.', ar: 'املأ كل الحقول المطلوبة.' },

  // Trial group membership
  memberBarPermanent: { en: 'You are a permanent member of this trial group.', ar: 'أنت عضو دائم في هذه المجموعة التجريبية.' },
  memberBarIn: { en: 'You are in this trial group.', ar: 'أنت عضو في هذه المجموعة التجريبية.' },
  memberBarOut: {
    en: 'You are not in this trial group. Join to be notified of its trials.',
    ar: 'لست عضوًا في هذه المجموعة التجريبية. انضم لتصلك تنبيهات حصصها.',
  },
  join: { en: 'Join group', ar: 'انضمام' },
  leave: { en: 'Leave group', ar: 'مغادرة' },

  newTitle: { en: 'New students', ar: 'الطلاب الجدد' },
  newSubtitle: {
    en: 'Families who subscribed after a trial, as Sales recorded them. Contact and payment details are visible here only.',
    ar: 'الأسر التي اشتركت بعد حصة تجريبية كما سجّلها قسم المبيعات. بيانات التواصل والدفع تظهر هنا فقط.',
  },
  nothingNew: { en: 'No subscriptions recorded yet.', ar: 'لا توجد اشتراكات مسجّلة بعد.' },
  trialOn: { en: 'Trial', ar: 'الحصة التجريبية' },
  recordedBy: { en: 'Recorded by', ar: 'سجّلها' },
  updated: { en: 'Updated', ar: 'عُدّلت' },
} satisfies Record<string, Pair>

export const ATTENDANCE: Record<string, Pair> = {
  upcoming: { en: 'Upcoming', ar: 'قادمة' },
  awaiting: { en: 'Not recorded yet', ar: 'لم تُسجَّل بعد' },
  attended: { en: 'Attended', ar: 'حضر' },
  no_show: { en: 'Did not attend', ar: 'لم يحضر' },
  admin_cancelled: { en: 'Cancelled', ar: 'ملغاة' },
}

export const OUTCOME: Record<string, Pair> = {
  upcoming: { en: 'Upcoming', ar: 'قادمة' },
  awaiting: { en: 'Needs an outcome', ar: 'بانتظار النتيجة' },
  no_show: { en: 'Did not attend', ar: 'لم يحضر' },
  subscribed: { en: 'Subscribed', ar: 'اشترك' },
  not_subscribed: { en: 'Did not subscribe', ar: 'لم يشترك' },
  cancelled: { en: 'Did not take place', ar: 'لم تُعقد' },
}

export const PAYMENT_METHOD: Record<string, Pair> = {
  bank_transfer: TR.bankTransfer,
  invoice: TR.invoice,
}

/** ISO weekday 1..7. */
export const WEEKDAY: Record<number, Pair> = {
  1: { en: 'Monday', ar: 'الاثنين' },
  2: { en: 'Tuesday', ar: 'الثلاثاء' },
  3: { en: 'Wednesday', ar: 'الأربعاء' },
  4: { en: 'Thursday', ar: 'الخميس' },
  5: { en: 'Friday', ar: 'الجمعة' },
  6: { en: 'Saturday', ar: 'السبت' },
  7: { en: 'Sunday', ar: 'الأحد' },
}

/** The currencies offered first; any three-letter code is accepted by the server. */
export const CURRENCIES = ['EGP', 'SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR', 'JOD', 'USD', 'EUR', 'GBP', 'CAD', 'AUD'] as const

/** "1,234.50 EGP", in the reader's language. */
export function formatMoney(amount: number, currency: string, locale: 'ar' | 'en'): string {
  try {
    return new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en', { style: 'currency', currency }).format(amount)
  } catch {
    return `${amount} ${currency}`
  }
}

export const NOT_SUBSCRIBED_REASON: Record<string, Pair> = {
  price: { en: 'Price', ar: 'السعر' },
  schedule: { en: 'Schedule', ar: 'المواعيد' },
  not_ready: { en: 'Not ready yet', ar: 'غير جاهز بعد' },
  chose_other: { en: 'Chose another academy', ar: 'اختار جهة أخرى' },
  no_response: { en: 'No response', ar: 'لم يرد' },
  other: { en: 'Other', ar: 'أخرى' },
}

/** PD-22: an instant on the academy's clock, in the reader's language: "Mon 21 Oct, 05:30 PM". */
export function formatWhen(iso: string, locale: 'ar' | 'en'): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: ACADEMY_ZONE }).format(d)
}

/** The academy's calendar day of an instant, as a grouping key (PD-22: not the browser's). */
export function localDay(iso: string): string {
  return isoToAcademyWallClock(iso).date
}
