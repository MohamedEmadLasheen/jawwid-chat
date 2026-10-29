import { useI18n } from '@/core/i18n/I18nProvider'
import { ACADEMY_ZONE, zoneLabel } from '@/core/time/academyTime'

export interface Pair {
  en: string
  ar: string
}

export function useJourneyCopy() {
  const { locale } = useI18n()
  // A label table may not know a code: an unknown one reads as empty, never crashes.
  return { locale, tx: (p: Pair | undefined) => (p ? (locale === 'ar' ? p.ar : p.en) : '') }
}

/** PD-15 copy. Arabic is the academy's first language; English mirrors it. */
export const J = {
  // The chat's "+" cards (supervisors).
  menuStudentExcuse: { en: 'Student excuse', ar: 'عذر الطالب' },
  menuTeacherExcuse: { en: 'Teacher excuse', ar: 'عذر المعلم' },
  menuMakeup: { en: 'Reschedule a make-up class', ar: 'جدولة حصة تعويضية' },
  lesson: { en: 'Lesson', ar: 'الحصة' },
  choose: { en: 'Choose…', ar: 'اختر…' },
  excuseBefore: { en: 'Excuse before the lesson starts', ar: 'عذر قبل بداية الحصة' },
  excuseBeforeHint: {
    en: 'The group is told the student has an excuse and will not attend. A reason is optional; it stays with staff and is never shown in the group.',
    ar: 'سيُبلَّغ أعضاء المجموعة بأن لدى الطالب عذرًا ولن يحضر الحصة. ذكر السبب اختياري، ويبقى لدى الإدارة ولا يظهر في المجموعة.',
  },
  excuseAfter: { en: 'Excuse after the lesson started', ar: 'عذر بعد بداية الحصة' },
  excuseAfterHint: {
    en: 'The lesson is recorded as excused at once. The reason stays with staff and is never shown in the group.',
    ar: 'تُسجَّل الحصة معذورة فورًا. يبقى السبب لدى الإدارة ولا يظهر في المجموعة.',
  },
  notAvailable: { en: 'Not available for this lesson now', ar: 'غير متاح لهذه الحصة الآن' },
  reason: { en: 'Reason', ar: 'السبب' },
  reasonInternal: { en: 'Reason (staff only)', ar: 'السبب (للإدارة فقط)' },
  reasonInternalOptional: { en: 'Reason (staff only, optional)', ar: 'السبب (للإدارة فقط، اختياري)' },
  teacherExcuseHint: {
    en: 'The group is told the teacher has an excuse and a make-up follows. The reason is kept for staff. Schedules are not changed.',
    ar: 'سيُبلَّغ أعضاء المجموعة بأن لدى المعلم عذرًا وأن حصة تعويضية ستُرتَّب. يبقى السبب لدى الإدارة، ولا تتغيّر المواعيد.',
  },
  makeupHint: {
    en: 'Record the make-up once the family and the teacher have agreed on a time. The teacher\'s free times are suggested below.',
    ar: 'سجّل الحصة التعويضية بعد اتفاق الأسرة والمعلم على الموعد. أوقات المعلم المتاحة مقترحة أدناه.',
  },
  makeupDate: { en: 'Date', ar: 'التاريخ' },
  makeupTime: { en: 'Time (Cairo time)', ar: 'الوقت (بتوقيت القاهرة)' },
  suggested: { en: 'Free times', ar: 'أوقات متاحة' },
  send: { en: 'Send', ar: 'إرسال' },
  sending: { en: 'Sending…', ar: 'جارٍ الإرسال…' },
  save: { en: 'Save', ar: 'حفظ' },
  saving: { en: 'Saving…', ar: 'جارٍ الحفظ…' },
  required: { en: 'Required', ar: 'مطلوب' },
  nothingToRecord: { en: 'No lesson in this group can take this card right now.', ar: 'لا توجد حصة في هذه المجموعة يمكن تسجيل هذه البطاقة لها الآن.' },

  // The lesson record (from a lesson card's menu).
  openRecord: { en: 'Lesson record', ar: 'سجل الحصة' },
  recordTitle: { en: 'Lesson record', ar: 'سجل الحصة' },
  recordUnavailable: { en: 'You cannot open this lesson\'s record.', ar: 'لا يمكنك فتح سجل هذه الحصة.' },
  outcome: { en: 'Outcome', ar: 'النتيجة' },
  noOutcome: { en: 'No outcome yet', ar: 'لم تُسجَّل نتيجة بعد' },
  correct: { en: 'Correct outcome', ar: 'تصحيح النتيجة' },
  correctTo: { en: 'Correct to', ar: 'تصحيح إلى' },
  correctHint: {
    en: 'The previous outcome, the new one, your reason and the time are kept. The statistics follow automatically.',
    ar: 'تُحفظ النتيجة السابقة والجديدة وسببك والوقت. تتحدّث الإحصائيات تلقائيًا.',
  },
  timing: { en: 'When was the student excused?', ar: 'متى قُدِّم عذر الطالب؟' },
  editReport: { en: 'Edit report', ar: 'تعديل التقرير' },
  // PD-35: the teacher corrects (or files) the report; a supervisor asks, with a reason.
  requestCorrection: { en: 'Request correction', ar: 'طلب تصحيح' },
  requestReport: { en: 'Ask for the report', ar: 'طلب التقرير' },
  requestHint: {
    en: 'The teacher gets your reason in their supervision chat and edits the report themselves. Every version is kept.',
    ar: 'يصل سببك إلى المعلم في محادثة الإشراف ويعدّل التقرير بنفسه. تُحفظ كل النسخ.',
  },
  requestReason: { en: 'What needs correcting', ar: 'ما الذي يحتاج إلى تصحيح' },
  requested: { en: 'Request sent to the teacher.', ar: 'أُرسل الطلب إلى المعلم.' },
  deleteReport: { en: 'Delete report', ar: 'حذف التقرير' },
  deleteHow: { en: 'After deleting', ar: 'بعد الحذف' },
  resend: { en: 'Resend a corrected version', ar: 'إرسال نسخة مصحّحة' },
  resendHint: { en: 'The old card leaves the chat and the corrected one is posted. The lesson is still counted once.', ar: 'تُحذف البطاقة القديمة من المحادثة وتُنشر المصحّحة. تبقى الحصة محسوبة مرة واحدة.' },
  leaveUnsent: { en: 'Leave it unsent', ar: 'عدم الإرسال' },
  leaveUnsentHint: {
    en: 'The card leaves the chat and this lesson is removed from every statistic. This cannot be undone.',
    ar: 'تُحذف البطاقة من المحادثة وتُزال هذه الحصة من كل الإحصائيات. لا يمكن التراجع عن ذلك.',
  },
  history: { en: 'History', ar: 'السجل' },
  noHistory: { en: 'No changes recorded.', ar: 'لا توجد تغييرات مسجلة.' },
  back: { en: 'Back', ar: 'رجوع' },
  version: { en: 'Version', ar: 'النسخة' },
  deletedReport: { en: 'This report was deleted.', ar: 'حُذف هذا التقرير.' },

  // The report form.
  lessonNumber: { en: 'Lesson number', ar: 'رقم الحصة' },
  covered: { en: 'What did the student learn?', ar: 'ماذا تعلّم الطالب؟' },
  coveredDetails: { en: 'Details (optional, short)', ar: 'تفاصيل (اختياري، باختصار)' },
  performance: { en: 'Performance in this lesson', ar: 'مستوى الأداء في هذه الحصة' },
  nextLesson: { en: 'For the next lesson', ar: 'المطلوب للحصة القادمة' },
  homework: { en: 'Homework details (optional)', ar: 'تفاصيل الواجب (اختياري)' },
  note: { en: 'Private note (staff only)', ar: 'ملاحظة خاصة (للإدارة فقط)' },
  coveredRequired: { en: 'Choose at least one topic or write a short line.', ar: 'اختر موضوعًا واحدًا على الأقل أو اكتب سطرًا قصيرًا.' },

  // The group's children.
  children: { en: 'Children', ar: 'الأطفال' },
  age: { en: 'Age', ar: 'العمر' },
  years: { en: (n: number) => `${n} years`, ar: (n: number) => `${n} سنة` },
  course: { en: 'Course', ar: 'الدورة' },
  schedule: { en: 'Lesson days and times', ar: 'أيام ومواعيد الحصص' },
  packageLessons: { en: 'Package', ar: 'الباقة' },
  lessonsCount: { en: (n: number) => `${n} lessons`, ar: (n: number) => `${n} حصة` },
  teacher: { en: 'Teacher', ar: 'المعلم' },
  notSet: { en: 'Not set', ar: 'غير محدد' },
  noSchedule: { en: 'No regular times yet', ar: 'لا توجد مواعيد ثابتة بعد' },
  editDetails: { en: 'Edit details', ar: 'تعديل البيانات' },
  viewProfile: { en: 'View profile', ar: 'عرض الملف' },
  detailsTitle: { en: (name: string) => `${name}: enrolment details`, ar: (name: string) => `بيانات تسجيل ${name}` },
  birthDate: { en: 'Date of birth', ar: 'تاريخ الميلاد' },
  noCourse: { en: 'No course', ar: 'بدون دورة' },
  addCourse: { en: 'Add a course', ar: 'إضافة دورة' },
  newCourse: { en: 'New course name', ar: 'اسم الدورة الجديدة' },
  add: { en: 'Add', ar: 'إضافة' },
  minutes: { en: (n: number) => `${n} min`, ar: (n: number) => `${n} دقيقة` },

  // New Students.
  supervisor: { en: 'Supervisor', ar: 'المشرف' },
  assign: { en: 'Assign', ar: 'تعيين' },
  group: { en: 'Group', ar: 'المجموعة' },
  createGroup: { en: 'Create group', ar: 'إنشاء المجموعة' },
  details: { en: 'Details', ar: 'البيانات' },
  needsSupervisorFirst: { en: 'Assign a supervisor first', ar: 'عيّن مشرفًا أولًا' },
  done: { en: 'Done', ar: 'تم' },
  setUp: { en: 'Set up', ar: 'تجهيز' },
} as const

export const TOPIC_LABELS: Record<string, Pair> = {
  new_memorization: { en: 'New memorization', ar: 'حفظ جديد' },
  revision: { en: 'Revision', ar: 'مراجعة' },
  recitation: { en: 'Recitation', ar: 'تلاوة' },
  tajweed: { en: 'Tajweed rules', ar: 'أحكام التجويد' },
  reading: { en: 'Reading', ar: 'قراءة' },
  writing: { en: 'Writing', ar: 'كتابة' },
  grammar: { en: 'Grammar', ar: 'قواعد' },
  vocabulary: { en: 'Vocabulary', ar: 'مفردات' },
  islamic_studies: { en: 'Islamic studies', ar: 'تربية إسلامية' },
  assessment: { en: 'Test / assessment', ar: 'اختبار وتقييم' },
}

export const TASK_LABELS: Record<string, Pair> = {
  memorize_new: { en: 'Memorize the new part', ar: 'حفظ المقطع الجديد' },
  revise_previous: { en: 'Revise previous lessons', ar: 'مراجعة ما سبق' },
  practise_recitation: { en: 'Practise recitation', ar: 'التدرّب على التلاوة' },
  practise_reading: { en: 'Practise reading', ar: 'التدرّب على القراءة' },
  written_homework: { en: 'Written homework', ar: 'واجب كتابي' },
  prepare_next: { en: 'Prepare the next lesson', ar: 'التحضير للدرس القادم' },
  nothing: { en: 'Nothing this time', ar: 'لا يوجد واجب' },
}

export const LEVEL_LABELS: Record<number, Pair> = {
  5: { en: 'Excellent', ar: 'ممتاز' },
  4: { en: 'Very good', ar: 'جيد جدًا' },
  3: { en: 'Good', ar: 'جيد' },
  2: { en: 'Fair', ar: 'مقبول' },
  1: { en: 'Needs more work', ar: 'يحتاج إلى متابعة' },
}

export const OUTCOME_LABELS: Record<string, Pair> = {
  held: { en: 'Student attended', ar: 'حضر الطالب' },
  student_no_show: { en: 'Student did not attend', ar: 'لم يحضر الطالب' },
  student_apology: { en: 'Student excuse', ar: 'عذر الطالب' },
  teacher_apology: { en: 'Teacher excuse', ar: 'عذر المعلم' },
  teacher_no_show: { en: 'Teacher absent', ar: 'غياب المعلم' },
  admin_cancelled: { en: 'Cancelled', ar: 'ملغاة' },
  rescheduled: { en: 'Moved', ar: 'نُقلت' },
  suspended: { en: 'Paused', ar: 'موقوفة' },
  voided: { en: 'Removed from the record', ar: 'محذوفة من السجل' },
}

export const TIMING_LABELS: Record<string, Pair> = {
  before_start: { en: 'Before the lesson started', ar: 'قبل بداية الحصة' },
  after_start: { en: 'After the lesson started', ar: 'بعد بداية الحصة' },
}

export const REVISION_LABELS: Record<string, Pair> = {
  edit: { en: 'Report edited', ar: 'عُدّل التقرير' },
  delete: { en: 'Report deleted', ar: 'حُذف التقرير' },
  resend: { en: 'Report deleted and resent', ar: 'حُذف التقرير وأُعيد إرساله' },
  restore: { en: 'Report restored', ar: 'استُعيد التقرير' },
}

/** ISO weekday 1 (Monday) .. 7 (Sunday). */
export const WEEKDAYS: Record<number, Pair> = {
  1: { en: 'Monday', ar: 'الاثنين' },
  2: { en: 'Tuesday', ar: 'الثلاثاء' },
  3: { en: 'Wednesday', ar: 'الأربعاء' },
  4: { en: 'Thursday', ar: 'الخميس' },
  5: { en: 'Friday', ar: 'الجمعة' },
  6: { en: 'Saturday', ar: 'السبت' },
  7: { en: 'Sunday', ar: 'الأحد' },
}

/** PD-22: "Mon 21 Oct, 17:00 (Cairo time)" -- the academy's clock, named. */
export function formatLessonWhen(iso: string, locale: 'ar' | 'en'): string {
  const when = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: ACADEMY_ZONE,
  }).format(new Date(iso))
  return `${when} (${zoneLabel(ACADEMY_ZONE, locale)})`
}
