import type { StatCategory } from './api'

/**
 * Teacher-statistics copy, Arabic and English side by side (the {en, ar}
 * pattern of features/organization). Wording rule: a label says exactly what
 * the server counted -- "held" is a lesson closed with a report, not "a lesson
 * that was on the calendar".
 */
export interface Pair {
  en: string
  ar: string
}

export const T = {
  title: { en: 'Teacher statistics', ar: 'إحصائيات المعلمين' },
  subtitle: {
    en: 'Every number is counted by the server from the lessons themselves: nothing is typed in, and nothing can drift.',
    ar: 'يحسب الخادم كل رقم من الحصص نفسها: لا شيء يُدخل يدويًا، ولا شيء ينحرف.',
  },
  month: { en: 'Month', ar: 'الشهر' },
  search: { en: 'Search a teacher', ar: 'ابحث عن معلم' },
  colTeacher: { en: 'Teacher', ar: 'المعلم' },
  colHeld: { en: 'Held', ar: 'المنعقدة' },
  colScheduled: { en: 'Counted', ar: 'المحتسبة' },
  colNotHeld: { en: 'Not held', ar: 'لم تُعقد' },
  colUnreported: { en: 'Needs report', ar: 'بانتظار التقرير' },
  colAttendance: { en: 'Attendance', ar: 'الحضور' },
  colOnTime: { en: 'Reports on time', ar: 'التقارير في موعدها' },
  inactive: { en: 'Inactive', ar: 'غير نشط' },
  noTeachers: { en: 'No teachers in this organization yet.', ar: 'لا يوجد معلمون في هذه المؤسسة بعد.' },
  back: { en: 'All teachers', ar: 'كل المعلمين' },
  detailSubtitle: { en: 'Teaching statistics — {month}', ar: 'إحصائيات التدريس — {month}' },
  total: { en: 'Total', ar: 'الإجمالي' },
  lessons: { en: '{n} lessons', ar: '{n} حصة' },
  lessonOne: { en: '1 lesson', ar: 'حصة واحدة' },
  hours: { en: '{h} h', ar: '{h} ساعة' },
  minutesLong: { en: '{m} min', ar: '{m} دقيقة' },
  lessonsHours: { en: '{n} lessons · {h} h', ar: '{n} حصة · {h} ساعة' },
  lessonOneHours: { en: '1 lesson · {h} h', ar: 'حصة واحدة · {h} ساعة' },
  noData: { en: 'No lessons', ar: 'لا توجد حصص' },
  notCounted: { en: 'Shown for information; not counted for or against anyone.', ar: 'للاطلاع فقط؛ لا تُحتسب لأحد ولا عليه.' },
  previous: { en: '{h} h held in {month}', ar: '{h} ساعة منعقدة في {month}' },

  rates: { en: 'Rates', ar: 'النسب' },
  attendance: { en: 'Attendance', ar: 'الحضور' },
  attendanceHint: { en: 'Held ÷ (held + student absent)', ar: 'المنعقدة ÷ (المنعقدة + غياب الطالب)' },
  completion: { en: 'Completion', ar: 'الإتمام' },
  completionHint: { en: 'Held ÷ every lesson closed and counted', ar: 'المنعقدة ÷ كل الحصص المغلقة والمحتسبة' },
  reliability: { en: 'Teacher reliability', ar: 'التزام المعلم' },
  reliabilityHint: { en: 'Lessons not lost through the teacher', ar: 'الحصص التي لم تضع بسبب المعلم' },

  reports: { en: 'Lesson reports', ar: 'تقارير الحصص' },
  onTime: { en: 'On time (within 24 h)', ar: 'في موعدها (خلال ٢٤ ساعة)' },
  medianDelay: { en: 'Median delay', ar: 'متوسط التأخير' },

  replies: { en: 'Replies to families', ar: 'الرد على الأسر' },
  answered: { en: 'Answered within 24 h', ar: 'تم الرد خلال ٢٤ ساعة' },
  medianReply: { en: 'Median reply time', ar: 'متوسط زمن الرد' },
  familyMessages: { en: '{n} family messages', ar: '{n} رسالة من الأسر' },

  workload: { en: 'Workload', ar: 'عبء العمل' },
  available: { en: 'Available', ar: 'المتاح' },
  scheduled: { en: 'Scheduled', ar: 'المجدول' },
  free: { en: 'Free', ar: 'الفارغ' },
  noAvailability: { en: 'No working hours recorded yet.', ar: 'لم تُسجّل ساعات عمل بعد.' },

  movements: { en: 'Students', ar: 'الطلاب' },
  transfersIn: { en: 'Transferred in', ar: 'منقولون إليه' },
  transfersOut: { en: 'Transferred out', ar: 'منقولون منه' },
  paused: { en: 'Paused', ar: 'متوقفون مؤقتًا' },
  stopped: { en: 'Stopped', ar: 'متوقفون نهائيًا' },

  makeups: { en: 'Make-up lessons', ar: 'الحصص التعويضية' },
  makeupsHeld: { en: '{held} of {n} held', ar: '{held} من {n} منعقدة' },
  trials: { en: 'Trial lessons', ar: 'الحصص التجريبية' },
  trialsPending: { en: 'Recorded once trial lessons are built (PD-11 T4).', ar: 'تُسجّل بعد بناء الحصص التجريبية (PD-11 T4).' },
  none: { en: '—', ar: '—' },
} satisfies Record<string, Pair>

export const CATEGORY_LABEL: Record<StatCategory, Pair> = {
  held: { en: 'Completed lessons', ar: 'الحصص المنعقدة' },
  upcoming: { en: 'Scheduled lessons', ar: 'الحصص المجدولة' },
  unreported: { en: 'Awaiting report', ar: 'بانتظار التقرير' },
  student_apology: { en: 'Student apology', ar: 'اعتذار الطالب' },
  teacher_apology: { en: 'Teacher apology', ar: 'اعتذار المعلم' },
  student_no_show: { en: 'Student absent', ar: 'غياب الطالب' },
  teacher_no_show: { en: 'Teacher absent', ar: 'غياب المعلم' },
  admin_cancelled: { en: 'Cancelled', ar: 'ملغاة' },
  rescheduled: { en: 'Moved', ar: 'منقولة' },
  suspended: { en: 'Paused', ar: 'موقوفة' },
}

/** The colour of each card's rule, in the screenshot's spirit: green done, blue ahead, red lost. */
export const CATEGORY_TONE: Record<StatCategory, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  held: 'success',
  upcoming: 'info',
  unreported: 'warning',
  student_apology: 'warning',
  teacher_apology: 'danger',
  student_no_show: 'warning',
  teacher_no_show: 'danger',
  admin_cancelled: 'danger',
  rescheduled: 'neutral',
  suspended: 'neutral',
}
