import { ApiError } from '@/core/api/errors'
import type { Pair } from './copy'

/**
 * Copy for the supervisors' lesson operations, Arabic and English side by side.
 * Wording rule (the Organization page's): a button never promises more than the
 * server does -- "Excuse" changes one lesson's outcome; it does not refund
 * anything, and Core is told separately.
 */
export const O = {
  // Tabs
  tabNeedsAction: { en: 'Needs action', ar: 'بحاجة إلى إجراء' },
  tabSchedules: { en: 'Schedules', ar: 'الجداول' },
  tabStudents: { en: 'Students', ar: 'الطلاب' },

  // Needs action
  needsTitle: { en: 'Needs action', ar: 'بحاجة إلى إجراء' },
  needsSubtitle: {
    en: 'What the Teachers department owes a decision on today. Each action is checked by the server and recorded.',
    ar: 'ما ينتظر قرارًا من قسم المعلمين اليوم. يتحقق الخادم من كل إجراء ويسجّله.',
  },
  allClear: { en: 'Nothing is waiting. Every lesson is closed and every request answered.', ar: 'لا شيء ينتظر. كل الحصص مغلقة وكل الطلبات مُجاب عنها.' },
  overdue: { en: 'Reports overdue', ar: 'تقارير متأخرة' },
  overdueHint: { en: 'Ended more than a day ago with no outcome. Remind the teacher, or record what happened.', ar: 'انتهت منذ أكثر من يوم دون نتيجة. ذكّر المعلم أو سجّل ما حدث.' },
  awaiting: { en: 'Awaiting report', ar: 'بانتظار التقرير' },
  rulings: { en: 'Late apologies', ar: 'اعتذارات متأخرة' },
  rulingsHint: { en: 'The lesson counts for the teacher until you excuse it.', ar: 'تُحتسب الحصة للمعلم حتى تقبل الاعتذار.' },
  makeups: { en: 'Make-ups not arranged', ar: 'حصص تعويضية لم تُرتّب' },
  makeupsHint: { en: 'The teacher did not give these lessons and no make-up was booked within a week.', ar: 'لم يقدّم المعلم هذه الحصص ولم تُحجز حصة تعويضية خلال أسبوع.' },
  requests: { en: 'Regular-time requests', ar: 'طلبات تغيير المواعيد' },
  returning: { en: 'Returning soon', ar: 'يعودون قريبًا' },

  // Columns
  learner: { en: 'Student', ar: 'الطالب' },
  teacher: { en: 'Teacher', ar: 'المعلم' },
  when: { en: 'When', ar: 'الموعد' },
  reason: { en: 'Reason', ar: 'السبب' },
  note: { en: 'Note', ar: 'ملاحظة' },
  noteOptional: { en: 'Note (optional)', ar: 'ملاحظة (اختياري)' },
  requested: { en: 'Requested times', ar: 'المواعيد المطلوبة' },
  returnOn: { en: 'Returns on', ar: 'يعود في' },
  actions: { en: 'Actions', ar: 'الإجراءات' },

  // Lesson actions
  studentAbsent: { en: 'Student absent', ar: 'غياب الطالب' },
  teacherAbsent: { en: 'Teacher absent', ar: 'غياب المعلم' },
  cancel: { en: 'Cancel lesson', ar: 'إلغاء الحصة' },
  excuse: { en: 'Excuse', ar: 'قبول الاعتذار' },
  credit: { en: 'Count as absence', ar: 'احتسابها غيابًا' },
  resolve: { en: 'Record decision', ar: 'تسجيل القرار' },
  approve: { en: 'Approve', ar: 'اعتماد' },
  reject: { en: 'Reject', ar: 'رفض' },
  endPause: { en: 'End pause now', ar: 'إنهاء التوقف الآن' },
  extend: { en: 'Move return date', ar: 'تغيير تاريخ العودة' },
  action: { en: 'Action', ar: 'الإجراء' },
  makeupSubstitute: { en: 'A substitute teacher gives it', ar: 'يقدّمها معلم بديل' },
  makeupCredit: { en: 'Credit the family', ar: 'رصيد للأسرة' },
  makeupExtension: { en: 'Extend the package', ar: 'تمديد الباقة' },
  makeupWaived: { en: 'No make-up needed', ar: 'لا حاجة لحصة تعويضية' },

  // Schedules
  schedulesTitle: { en: 'Schedules', ar: 'الجداول' },
  schedulesSubtitle: {
    en: 'Working hours, days off and regular lesson times. Lessons are created from regular times four weeks ahead.',
    ar: 'ساعات العمل والإجازات والمواعيد الثابتة. تُنشأ الحصص من المواعيد الثابتة قبل أربعة أسابيع.',
  },
  chooseTeacher: { en: 'Teacher', ar: 'المعلم' },
  pickTeacher: { en: 'Choose a teacher', ar: 'اختر معلمًا' },
  workingHours: { en: 'Working hours', ar: 'ساعات العمل' },
  timezone: { en: 'Time zone', ar: 'المنطقة الزمنية' },
  addWindow: { en: 'Add hours', ar: 'إضافة ساعات' },
  remove: { en: 'Remove', ar: 'حذف' },
  saveHours: { en: 'Save working hours', ar: 'حفظ ساعات العمل' },
  daysOff: { en: 'Days off', ar: 'الإجازات' },
  addDayOff: { en: 'Add day off', ar: 'إضافة إجازة' },
  noDaysOff: { en: 'No days off ahead.', ar: 'لا توجد إجازات قادمة.' },
  students: { en: 'Students', ar: 'الطلاب' },
  noStudents: { en: 'No students with this teacher.', ar: 'لا يوجد طلاب مع هذا المعلم.' },
  regularTimes: { en: 'Regular times', ar: 'المواعيد الثابتة' },
  none: { en: 'None', ar: 'لا يوجد' },
  editTimes: { en: 'Edit times', ar: 'تعديل المواعيد' },
  addTime: { en: 'Add a time', ar: 'إضافة موعد' },
  effectiveFrom: { en: 'From (optional, default today)', ar: 'ابتداءً من (اختياري، اليوم افتراضيًا)' },
  saveTimes: { en: 'Save times', ar: 'حفظ المواعيد' },
  oneOff: { en: 'One-off lesson', ar: 'حصة منفردة' },
  startsAt: { en: 'Starts (Cairo time)', ar: 'تبدأ (بتوقيت القاهرة)' },
  minutes: { en: 'Minutes', ar: 'الدقائق' },
  transfer: { en: 'Transfer', ar: 'نقل' },
  toTeacher: { en: 'New teacher', ar: 'المعلم الجديد' },
  handover: { en: 'Handover note for the new teacher (optional)', ar: 'ملاحظات التسليم للمعلم الجديد (اختياري)' },
  internalNote: { en: 'Internal note (optional)', ar: 'ملاحظة داخلية (اختياري)' },
  suspend: { en: 'Pause or stop', ar: 'إيقاف' },
  kind: { en: 'Kind', ar: 'النوع' },
  temporary: { en: 'Pause until a date', ar: 'توقف مؤقت حتى تاريخ' },
  permanent: { en: 'Stop', ar: 'توقف نهائي' },
  paused: { en: 'Paused until {date}', ar: 'متوقف حتى {date}' },
  stopped: { en: 'Stopped', ar: 'متوقف نهائيًا' },
  noAvailabilityYet: { en: 'No working hours recorded yet: lessons cannot be given regular times.', ar: 'لم تُسجّل ساعات عمل بعد: لا يمكن تحديد مواعيد ثابتة.' },
  transferDone: { en: 'Transferred. {moved} lessons moved, {moved2} could not follow.', ar: 'تم النقل. انتقلت {moved} حصة، وتعذّر نقل {moved2}.' },
  transferTimesLost: { en: 'The new teacher is not free at the old times: set new regular times.', ar: 'المعلم الجديد غير متاح في المواعيد السابقة: حدّد مواعيد جديدة.' },

  // Students
  studentsTitle: { en: 'Paused and stopped students', ar: 'الطلاب المتوقفون' },
  studentsSubtitle: {
    en: 'Paused students come back on their return date by themselves; the family is told two days before. The package is held in Core.',
    ar: 'يعود الطلاب المتوقفون مؤقتًا في تاريخ عودتهم تلقائيًا، وتُبلّغ الأسرة قبلها بيومين. تُحفظ الباقة في النظام الأساسي.',
  },
  pausedList: { en: 'Paused', ar: 'متوقفون مؤقتًا' },
  stoppedList: { en: 'Stopped', ar: 'متوقفون نهائيًا' },
  family: { en: 'Family', ar: 'الأسرة' },
  since: { en: 'Since', ar: 'منذ' },
  package: { en: 'Package left', ar: 'المتبقي من الباقة' },
  packageUnknown: { en: 'Kept in Core', ar: 'في النظام الأساسي' },
  noneList: { en: 'Nobody here.', ar: 'لا أحد هنا.' },

  // Dialog
  save: { en: 'Save', ar: 'حفظ' },
  saving: { en: 'Saving…', ar: 'جارٍ الحفظ…' },
  required: { en: 'Required', ar: 'مطلوب' },
  done: { en: 'Done', ar: 'تم' },
} satisfies Record<string, Pair>

export const WEEKDAY: Record<number, Pair> = {
  1: { en: 'Monday', ar: 'الإثنين' },
  2: { en: 'Tuesday', ar: 'الثلاثاء' },
  3: { en: 'Wednesday', ar: 'الأربعاء' },
  4: { en: 'Thursday', ar: 'الخميس' },
  5: { en: 'Friday', ar: 'الجمعة' },
  6: { en: 'Saturday', ar: 'السبت' },
  7: { en: 'Sunday', ar: 'الأحد' },
}

export const TRANSFER_REASON: Record<string, Pair> = {
  family_request: { en: 'The family asked', ar: 'طلب الأسرة' },
  teacher_request: { en: 'The teacher asked', ar: 'طلب المعلم' },
  schedule_fit: { en: 'Better times', ar: 'مواعيد أنسب' },
  level_fit: { en: 'Better level fit', ar: 'مستوى أنسب' },
  quality: { en: 'Quality', ar: 'الجودة' },
  teacher_leaving: { en: 'The teacher is leaving', ar: 'مغادرة المعلم' },
  other: { en: 'Other', ar: 'أخرى' },
}

export const SUSPENSION_REASON: Record<string, Pair> = {
  travel: { en: 'Travel', ar: 'سفر' },
  exams: { en: 'Exams', ar: 'امتحانات' },
  health: { en: 'Health', ar: 'صحة' },
  holiday: { en: 'Holiday', ar: 'إجازة' },
  financial: { en: 'Financial', ar: 'مادي' },
  schedule: { en: 'No suitable times', ar: 'لا مواعيد مناسبة' },
  quality: { en: 'Quality', ar: 'الجودة' },
  finished: { en: 'Finished their goal', ar: 'أنهى هدفه' },
  moved_elsewhere: { en: 'Moved elsewhere', ar: 'انتقل إلى جهة أخرى' },
  other: { en: 'Other', ar: 'أخرى' },
}

/** The server's refusal in the operator's language: the lesson codes named, anything else as the server said it. */
export function describeOpsError(error: unknown, locale: 'ar' | 'en'): string {
  const pick = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'COMM.LESSON_TEACHER_BUSY':
        return pick({ en: 'The teacher already has a lesson at that time.', ar: 'لدى المعلم حصة في هذا الوقت.' })
      case 'COMM.LESSON_DENIED':
        return pick({ en: 'This belongs to the Teachers department.', ar: 'هذا من صلاحيات قسم المعلمين.' })
      case 'COMM.LESSON_NOT_FOUND':
        return pick({ en: 'Not found — it may have been changed. Refresh.', ar: 'غير موجود — ربما تغيّر. حدّث الصفحة.' })
      default:
        // LESSON_STATE and validation carry the server's own precise reason.
        return error.localized(locale)
    }
  }
  return pick({ en: 'Something went wrong. Try again.', ar: 'حدث خطأ. حاول مرة أخرى.' })
}

/**
 * A calendar day the server sends as YYYY-MM-DD, in the reader's language. Read
 * as UTC so no reader's time zone can move it to the day before.
 */
export function formatDay(day: string, locale: 'ar' | 'en'): string {
  const d = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return day
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en', { dateStyle: 'medium', timeZone: 'UTC' }).format(d)
}

/** A lesson length, "30 min" / "٣٠ دقيقة". */
export function formatMinutes(n: number, locale: 'ar' | 'en'): string {
  return locale === 'ar' ? `${new Intl.NumberFormat('ar-EG').format(n)} دقيقة` : `${n} min`
}
