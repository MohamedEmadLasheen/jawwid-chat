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
    en: 'Counted from the recorded lessons; not editable here.',
    ar: 'تُحسب من الحصص المسجّلة، ولا تُعدَّل من هنا.',
  },
  month: { en: 'Month', ar: 'الشهر' },
  // The ledger's heads say what a paired figure is.
  keyHeld: { en: 'lessons · hours', ar: 'حصص · ساعات' },
  keyExcuses: { en: 'student: before + after the start', ar: 'الطالب: قبل البداية + بعدها' },
  keyTrials: { en: 'subscribed / all', ar: 'اشتركوا / الكل' },
  colExcuses: { en: 'Excuses', ar: 'الأعذار' },
  open: { en: 'Open', ar: 'فتح' },
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
  totalCounted: { en: 'Counted lessons', ar: 'الحصص المحتسبة' },
  heldOf: { en: '{n} held', ar: 'المنعقدة: {n}' },
  byOutcome: { en: 'By outcome and length', ar: 'حسب النتيجة والمدة' },
  minutesLong: { en: '{m} min', ar: '{m} دقيقة' },
  noData: { en: 'No lessons', ar: 'لا توجد حصص' },
  notCounted: { en: 'Shown for information; not counted for or against anyone.', ar: 'للاطلاع فقط؛ لا تُحتسب لأحد ولا عليه.' },
  previous: { en: '{hours} held in {month}', ar: '{hours} منعقدة في {month}' },

  rates: { en: 'Rates', ar: 'النسب' },
  attendance: { en: 'Attendance', ar: 'الحضور' },
  attendanceHint: { en: 'Held ÷ (held + student absent)', ar: 'المنعقدة ÷ (المنعقدة + غياب الطالب)' },
  completion: { en: 'Completion', ar: 'الإتمام' },
  completionHint: { en: 'Held ÷ every lesson closed and counted', ar: 'المنعقدة ÷ كل الحصص المغلقة والمحتسبة' },
  reliability: { en: 'Teacher reliability', ar: 'التزام المعلم' },
  reliabilityHint: { en: 'Lessons not lost through the teacher', ar: 'الحصص التي لم تضع بسبب المعلم' },

  reports: { en: 'Lesson reports', ar: 'تقارير الحصص' },
  onTime: { en: 'On time (within 24 h)', ar: 'في موعدها (خلال 24 ساعة)' },
  medianDelay: { en: 'Median delay', ar: 'وسيط التأخير' },

  replies: { en: 'Replies to families', ar: 'الرد على الأسر' },
  answered: { en: 'Answered within 24 h', ar: 'تم الرد خلال 24 ساعة' },
  medianReply: { en: 'Median reply time', ar: 'وسيط زمن الرد' },
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
  makeupsClosed: { en: 'Closed make-ups', ar: 'الحصص التعويضية المغلقة' },
  trials: { en: 'Trial lessons', ar: 'الحصص التجريبية' },
  trialsTotal: { en: 'Total trials', ar: 'إجمالي الحصص التجريبية' },
  trialsConducted: { en: 'Conducted', ar: 'المنعقدة' },
  trialsSubscribed: { en: 'Subscribed', ar: 'اشتركوا' },
  trialsNotSubscribed: { en: 'Did not subscribe', ar: 'لم يشتركوا' },
  trialsNoShow: { en: 'Did not attend', ar: 'لم يحضروا' },
  trialsAwaiting: { en: 'Awaiting an outcome', ar: 'بانتظار النتيجة' },
  trialsConversion: { en: 'Conversion', ar: 'نسبة الاشتراك' },
  trialsConversionHint: { en: 'Subscribed, of the trials with a decision.', ar: 'نسبة من اشتركوا من الحصص التي سُجّل قرارها.' },
  trialsOutside: { en: '{u} upcoming and {c} cancelled are not counted.', ar: 'لا تُحتسب {u} قادمة و{c} ملغاة.' },
  colTrials: { en: 'Trials', ar: 'التجريبية' },
  colTrialsSubscribed: { en: 'Trials subscribed', ar: 'اشتركوا بعد التجريبية' },
  // PD-31: moving a lesson is information, never a violation.
  colMoves: { en: 'Moved by teacher', ar: 'نقلها المعلم' },
  moves: { en: 'Lessons moved by teacher', ar: 'حصص نقلها المعلم' },
  movesHint: { en: 'Information only: moving a lesson is not a violation.', ar: 'للاطلاع فقط: نقل الحصة ليس مخالفة.' },
  none: { en: '—', ar: '—' },
} satisfies Record<string, Pair>

/**
 * The ranked statistics list and its side sheet (features/teachers/stats).
 * `{name}` slots are filled with numbers already formatted, or with nodes.
 */
export const TS = {
  // Figures that filter the list.
  figUrgent: { en: 'Needs intervention', ar: 'بحاجة إلى تدخّل' },
  figUrgentNote: { en: 'of {teachers}', ar: 'من أصل {teachers}' },
  figLate: { en: 'Late reports', ar: 'تقارير متأخرة' },
  figLateNote: { en: 'across {teachers}', ar: 'عند {teachers}' },
  figLateNone: { en: 'every lesson reported', ar: 'كل الحصص بتقاريرها' },
  figAttendance: { en: 'Low student attendance', ar: 'حضور طلاب منخفض' },
  figAttendanceNote: { en: 'teachers below {p}', ar: 'معلمون دون {p}' },
  figNoShow: { en: 'Teacher no-shows', ar: 'غياب المعلمين' },
  figNoShowNote: { en: 'lessons, across {teachers}', ar: 'حصص، عند {teachers}' },
  figNoShowNone: { en: 'none this month', ar: 'لا غياب هذا الشهر' },

  // The list.
  colTeacher: { en: 'Teacher, by priority', ar: 'المعلم، حسب الأولوية' },
  colLate: { en: 'Late reports', ar: 'تقارير متأخرة' },
  colAttendance: { en: 'Student attendance', ar: 'حضور الطلاب' },
  colLessons: { en: 'Lessons held', ar: 'الحصص المنعقدة' },
  colLessonsKey: { en: 'of counted', ar: 'من المحتسبة' },
  onTime: { en: 'on time', ar: 'في موعدها' },
  onTimeOf: { en: '{p} on time', ar: '{p} في موعدها' },
  shortLate: { en: 'Late reports', ar: 'تقارير متأخرة' },
  shortAttendance: { en: 'Attendance', ar: 'الحضور' },
  shortLessons: { en: 'Held', ar: 'المنعقدة' },
  urgent: { en: 'Urgent', ar: 'عاجل' },
  watch: { en: 'Watch', ar: 'للمتابعة' },
  ok: { en: 'On track', ar: 'منتظم' },
  showMore: { en: 'Show {more}', ar: 'عرض {more}' },
  showFewer: { en: 'Show fewer', ar: 'عرض أقل' },
  showAll: { en: 'Show every teacher', ar: 'عرض كل المعلمين' },
  noMatch: { en: 'No teacher in this view this month.', ar: 'لا يوجد معلم ضمن هذا العرض هذا الشهر.' },
  noName: { en: 'No teacher by that name.', ar: 'لا يوجد معلم بهذا الاسم.' },
  askReports: { en: 'Ask for {reports} in Needs action', ar: 'اطلب {reports} من «بحاجة إلى إجراء»' },
  thresholdsUrgent: { en: 'Urgent: {late} or more without a report, or any teacher no-show.', ar: 'عاجل: {late} أو أكثر دون تقرير، أو أي غياب للمعلم دون إشعار.' },
  thresholdsWatch: { en: 'Watch: student attendance below {att}, or fewer than {ot} of reports on time.', ar: 'للمتابعة: حضور الطلاب دون {att}، أو أقل من {ot} من التقارير في موعدها.' },

  // Each row's reason, as a sentence.
  rNoShow: { en: 'missed {lessons} without notice', ar: 'غياب عن {lessons} دون إشعار' },
  rLateRecent: { en: 'a recent report backlog, unusual here', ar: 'تأخر حديث في التقارير على غير العادة' },
  rLateHabit: { en: 'reports late all month', ar: 'التقارير متأخرة طوال الشهر' },
  rLateNone: { en: 'no report written this month', ar: 'لم يُكتب أي تقرير هذا الشهر' },
  rAbsences: { en: 'students missed {absent}, excused {excused}', ar: 'غاب الطلاب عن {absent} واعتذروا عن {excused}' },
  rAbsencesOnly: { en: 'students missed {absent}', ar: 'غاب الطلاب عن {absent}' },
  rAbsencesUnknown: { en: 'students often miss their lessons', ar: 'الطلاب يتغيّبون كثيرًا' },
  rReportsLate: { en: 'reports often come in after a day', ar: 'كثيرًا ما يُكتب التقرير بعد مرور يوم' },
  rTeacherExcuses: { en: 'excused from {lessons}', ar: 'اعتذار عن {lessons}' },
  rNoLessons: { en: 'no lessons this month', ar: 'لا حصص هذا الشهر' },

  // Actions.
  messageTeacher: { en: 'Message teacher', ar: 'مراسلة المعلم' },
  opening: { en: 'Opening…', ar: 'جارٍ الفتح…' },
  openFile: { en: 'Open teacher file', ar: 'فتح ملف المعلم' },
  fullStats: { en: 'Full month statistics', ar: 'إحصائيات الشهر كاملة' },
  exportList: { en: 'Export', ar: 'تصدير' },
  exportCsv: { en: 'Download as CSV', ar: 'تنزيل ملف CSV' },
  print: { en: 'Print the list', ar: 'طباعة القائمة' },
  csvPriority: { en: 'Priority', ar: 'الأولوية' },
  csvReason: { en: 'Reason', ar: 'السبب' },

  // The side sheet.
  rateRows: { en: 'Reliability and replies', ar: 'الالتزام والردود' },
  medianDelay: { en: 'Median report delay', ar: 'وسيط تأخر التقرير' },
  replies: { en: 'Family messages answered within 24 h', ar: 'رسائل الأسر المُجاب عنها خلال 24 ساعة' },
  medianReply: { en: 'median reply {d}', ar: 'وسيط زمن الرد {d}' },
  outcomes: { en: 'Lessons by outcome', ar: 'الحصص حسب النتيجة' },
  outcomesNone: { en: 'No lessons have an outcome yet this month.', ar: 'لا نتائج للحصص بعد هذا الشهر.' },
  more: { en: 'Trials, excuses and moves', ar: 'التجريبية والأعذار والنقل' },
  trialsSubscribed: { en: 'Trial students who subscribed', ar: 'اشتركوا بعد الحصة التجريبية' },
  ofN: { en: '{a} of {b}', ar: '{a} من {b}' },
  noTrials: { en: 'no trials this month', ar: 'لا حصص تجريبية هذا الشهر' },
  deniedHint: { en: 'Only the staff who run the teachers’ lessons, and the super admin, can open this page. Ask your manager if you need it.', ar: 'هذه الصفحة لفريق متابعة حصص المعلمين ولمدير النظام. اطلبها من مديرك إن احتجت إليها.' },
  sheetExpand: { en: 'Open as a full page', ar: 'فتح في صفحة كاملة' },
  moreActions: { en: 'More actions', ar: 'إجراءات أخرى' },
  studentExcuses: { en: 'Student excuses', ar: 'أعذار الطلاب' },
  studentExcusesSplit: { en: '{b} before the start, {a} after', ar: '{b} قبل البداية، {a} بعدها' },
  teacherExcuses: { en: 'Teacher excuses', ar: 'أعذار المعلم' },
  makeupsDone: { en: 'Make-ups completed', ar: 'الحصص التعويضية المنفّذة' },
  movesInfo: { en: 'information only', ar: 'للاطلاع فقط' },
  lessonsHeldOf: { en: 'Lessons held of counted', ar: 'المنعقدة من المحتسبة' },
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
