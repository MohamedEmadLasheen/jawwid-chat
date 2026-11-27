import { useCallback } from 'react'
import { ApiError } from '@/core/api/errors'
import { useI18n } from '@/core/i18n/I18nProvider'
import type { CalendarStatus, Category, LessonKind } from './api'
import type { View } from './viewState'

/**
 * PD-38 copy, Arabic and English side by side (the {en, ar} pattern of
 * features/organization). Wording rule: a label says exactly what the server
 * counted -- "booked" is time reserved for a student, whatever happened later;
 * "empty" is shift time no lesson, pause or leave holds.
 */
export interface Pair {
  en: string
  ar: string
}

export const S = {
  title: { en: 'Schedule', ar: 'الجدول' },
  subtitle: {
    en: 'Every teacher\'s shift, lessons and empty time. Every number is counted by the server from the lessons themselves.',
    ar: 'شيفت كل معلم وحصصه ووقته الفارغ. يحسب الخادم كل رقم من الحصص نفسها.',
  },
  zoneNote: { en: 'Times in {zone}', ar: 'الأوقات {zone}' },
  range: { en: 'Choose a date', ar: 'اختر تاريخًا' },
  today: { en: 'Today', ar: 'اليوم' },
  previous: { en: 'Previous', ar: 'السابق' },
  next: { en: 'Next', ar: 'التالي' },
  date: { en: 'Date', ar: 'التاريخ' },
  viewLabel: { en: 'View', ar: 'طريقة العرض' },
  teacher: { en: 'Teacher', ar: 'المعلم' },
  noTeachers: { en: 'No teacher matches these filters.', ar: 'لا يوجد معلم يطابق عوامل التصفية هذه.' },
  noTeachersHint: { en: 'Clear a filter to see the others.', ar: 'امسح أحد العوامل لرؤية الآخرين.' },
  monthHint: {
    en: 'Each cell is one teacher\'s day: shift used, and empty hours in the shift. Open a day to see its lessons.',
    ar: 'كل خانة يوم لمعلم: نسبة إشغال الشيفت والساعات الفارغة فيه. افتح اليوم لرؤية حصصه.',
  },
  openDay: { en: 'Open {teacher}, {day}', ar: 'افتح {teacher}، {day}' },

  // Filters
  filters: { en: 'Filters', ar: 'عوامل التصفية' },
  moreFilters: { en: 'More filters', ar: 'المزيد من عوامل التصفية' },
  weekStartsOn: { en: 'Week starts on', ar: 'يبدأ الأسبوع يوم' },
  clearAll: { en: 'Clear all', ar: 'مسح الكل' },
  search: { en: 'Search', ar: 'بحث' },
  noOptions: { en: 'Nothing to choose', ar: 'لا خيارات' },
  fTeacher: { en: 'Teacher', ar: 'المعلم' },
  fCategory: { en: 'Category', ar: 'الفئة' },
  fSupervisor: { en: 'Supervisor', ar: 'المشرف' },
  fStudent: { en: 'Student', ar: 'الطالب' },
  fStatus: { en: 'Status', ar: 'الحالة' },
  fKind: { en: 'Lesson type', ar: 'نوع الحصة' },
  fDays: { en: 'Days', ar: 'الأيام' },
  fHours: { en: 'Hours', ar: 'الساعات' },
  fUtilization: { en: 'Shift used', ar: 'إشغال الشيفت' },
  fEmpty: { en: 'Empty time', ar: 'الوقت الفارغ' },
  noSupervisor: { en: 'No supervisor', ar: 'بدون مشرف' },
  from: { en: 'From', ar: 'من' },
  to: { en: 'To', ar: 'إلى' },
  any: { en: 'Any', ar: 'أي' },
  emptyAtLeast: { en: 'At least {h} h empty', ar: '{h} ساعة فارغة على الأقل' },
  onlyMatching: { en: 'Only teachers with matching lessons', ar: 'المعلمون الذين لديهم حصص مطابقة فقط' },
  lt50: { en: 'Under 50%', ar: 'أقل من ٥٠٪' },
  to80: { en: '50–80%', ar: '٥٠–٨٠٪' },
  gte80: { en: '80% or more', ar: '٨٠٪ فأكثر' },
  mineDefault: { en: 'Showing your students. Clear the supervisor filter to see everyone\'s.', ar: 'تُعرض طلابك. امسح عامل المشرف لرؤية الجميع.' },

  // Stats
  statsLabel: { en: 'Figures for this view', ar: 'أرقام هذا العرض' },
  // CHATSCHED-014, decision A (department head, 2026-11-02): this is PD-38's *booked*
  // time -- any lesson reserved for a student, whatever its outcome -- so it is named so.
  // What was actually held is the hint below.
  teachingHours: { en: 'Booked hours', ar: 'الساعات المحجوزة' },
  heldSoFar: { en: '{h} held', ar: '{h} منعقدة' },
  students: { en: 'Students', ar: 'الطلاب' },
  studentsHint: { en: '+{trial} trial · {paused} paused', ar: '+{trial} تجريبي · {paused} متوقف' },
  trialCount: { en: '+{n} trial', ar: '+{n} تجريبي' },
  pausedCount: { en: '{n} paused', ar: '{n} متوقف' },
  utilization: { en: 'Shift used', ar: 'إشغال الشيفت' },
  utilizationHint: { en: '{booked} of {base} shift hours', ar: '{booked} من {base} ساعة شيفت' },
  emptyHours: { en: 'Empty in shift', ar: 'فارغ داخل الشيفت' },
  outsideHours: { en: 'Outside the shift', ar: 'خارج الشيفت' },
  leaveHours: { en: 'Leave', ar: 'إجازة' },
  pausedHours: { en: 'Paused', ar: 'متوقف' },
  freeHours: { en: 'Free (hourly)', ar: 'متاح (بالساعة)' },
  capacityNote: {
    en: 'Shift, empty and leave count every lesson of the teachers shown; booked hours and students count only the matching lessons.',
    ar: 'الشيفت والفارغ والإجازة تحتسب كل حصص المعلمين المعروضين؛ الساعات المحجوزة والطلاب تحتسب الحصص المطابقة فقط.',
  },
  byTeacher: { en: 'Figures by teacher', ar: 'أرقام كل معلم' },
  colShift: { en: 'Shift', ar: 'الشيفت' },
  colBooked: { en: 'Booked', ar: 'محجوز' },
  colUsed: { en: 'Used', ar: 'الإشغال' },
  colRemaining: { en: 'Empty', ar: 'فارغ' },
  colOutside: { en: 'Outside', ar: 'خارج' },
  colLeave: { en: 'Leave', ar: 'إجازة' },
  hours: { en: '{h} h', ar: '{h} س' },
  dash: { en: '—', ar: '—' },

  // Phone layout
  filtersButton: { en: 'Filters', ar: 'عوامل التصفية' },
  done: { en: 'Done', ar: 'تم' },
  availableSlot: { en: 'Available, no student', ar: 'متاح بدون طالب' },
  onLeave: { en: 'On leave', ar: 'في إجازة' },
  noLessonsDay: { en: 'No lessons', ar: 'لا حصص' },
  // "Label: number" -- no noun that would need a plural form after a count.
  dayTotals: { en: 'Lessons: {lessons}, empty: {empty}', ar: 'الحصص: {lessons}، الفارغ: {empty}' },
  allTeachers: { en: 'All teachers', ar: 'كل المعلمين' },

  // Legend
  legend: { en: 'Legend', ar: 'دليل الرموز' },
  legendButton: { en: 'What the shapes mean', ar: 'معنى الأشكال والألوان' },
  legendLessons: { en: 'Lessons', ar: 'الحصص' },
  legendLane: { en: 'A teacher\'s day', ar: 'يوم المعلم' },
  scheduled: { en: 'Booked', ar: 'محجوزة' },
  pastLesson: { en: 'Already over', ar: 'انتهت' },
  notHappening: { en: 'Moved away or called off', ar: 'نُقلت أو أُلغيت' },
  clash: { en: 'Two lessons at once', ar: 'حصتان في وقت واحد' },
  needsSubstitute: { en: 'Teacher on leave: needs a substitute', ar: 'المعلم في إجازة: تحتاج معلمًا بديلًا' },
  nowLine: { en: 'Now', ar: 'الآن' },
  supervisorsLegend: { en: 'Supervisors', ar: 'المشرفون' },
  supervisorsFilter: { en: 'Supervisors', ar: 'المشرفون' },
  supervisorsHint: { en: 'Choose one to show only their students.', ar: 'اختر مشرفًا لعرض طلابه فقط.' },
  offHours: { en: 'Outside working hours (no lessons expected)', ar: 'خارج ساعات العمل (لا حصص متوقعة)' },
  hourlyBooked: { en: '{h} h booked', ar: '{h} س محجوزة' },
  bookedOf: { en: '{booked} of {base} h', ar: '{booked} من {base} س' },
  statusLegend: { en: 'Status', ar: 'الحالة' },
  noColor: { en: 'No color yet', ar: 'بلا لون بعد' },
  emptySlot: { en: 'Available time without a student', ar: 'وقت متاح بدون طالب' },
  outsideShift: { en: 'Outside working hours', ar: 'خارج ساعات العمل' },
  shiftBand: { en: 'Shift', ar: 'الشيفت' },
  workBand: { en: 'Working hours', ar: 'ساعات العمل' },
  leaveBand: { en: 'Leave', ar: 'إجازة' },
  otherBooking: { en: 'Other booking', ar: 'حجز آخر' },
  booked: { en: 'Booked', ar: 'محجوز' },
  outsideMark: { en: 'outside working hours', ar: 'خارج ساعات العمل' },

  // Lesson details
  lessonTitle: { en: 'Lesson', ar: 'الحصة' },
  when: { en: 'When', ar: 'الموعد' },
  student: { en: 'Student', ar: 'الطالب' },
  status: { en: 'Status', ar: 'الحالة' },
  outcome: { en: 'Outcome', ar: 'النتيجة' },
  openStudent: { en: 'Open student profile', ar: 'افتح ملف الطالب' },
  anonymousLesson: { en: 'Another supervisor\'s student', ar: 'طالب لدى مشرف آخر' },
  movedHere: { en: 'Moved to this time', ar: 'نُقلت إلى هذا الموعد' },
  paymentHold: { en: 'Suspended until the family pays', ar: 'معلّقة حتى تدفع الأسرة' },
  close: { en: 'Close', ar: 'إغلاق' },
  openDesk: { en: 'Open Teachers\' schedules', ar: 'افتح جداول المعلمين' },
  openLesson: { en: 'Open the lesson', ar: 'افتح الحصة' },
  reviewLesson: { en: 'Review the lesson', ar: 'راجع الحصة' },
  reviewLessons: { en: 'Review the lessons', ar: 'راجع الحصص' },
  changeTeacher: { en: 'Open Teachers\' schedules', ar: 'افتح جداول المعلمين' },
  changeTeacherHint: { en: 'In the Teachers\' schedules desk, where a student\'s teacher is changed', ar: 'في مكتب جداول المعلمين، حيث يُغيَّر معلم الطالب' },
  openWeek: { en: 'Open this week', ar: 'افتح هذا الأسبوع' },
  withoutTeacher: { en: '{n} without a teacher', ar: '{n} بلا معلم' },
  outsideDays: { en: 'After hours, {n} days', ar: 'خارج الدوام {n} أيام' },
  noColorLesson: { en: 'Booked, supervisor has no colour', ar: 'محجوزة، بلا لون مشرف' },
  heatLess: { en: 'Less booked', ar: 'أقل إشغالًا' },
  heatMore: { en: 'More booked', ar: 'أكثر إشغالًا' },
  showOnGrid: { en: 'Show on the schedule', ar: 'أظهرها في الجدول' },

  // Needs your attention
  attnTitle: { en: 'Needs your attention', ar: 'يحتاج انتباهك' },
  attnNone: { en: 'Nothing needs you here', ar: 'لا شيء يحتاج انتباهك هنا' },
  attnNoneHint: {
    en: 'Two lessons at once, a teacher on leave with lessons, a lesson suspended for payment or booked outside working hours will appear here.',
    ar: 'ستظهر هنا الحصص المتداخلة، والمعلم في إجازة ولديه حصص، والحصة المعلّقة للدفع أو المحجوزة خارج ساعات العمل.',
  },
  attnFold: { en: 'Hide what needs attention', ar: 'إخفاء ما يحتاج انتباهك' },
  attnOpen: { en: 'Show what needs attention', ar: 'عرض ما يحتاج انتباهك' },
  attnConflict: { en: '{teacher} has two lessons at {time}: {a} and {b}.', ar: 'لدى {teacher} حصتان في {time}: {a} و{b}.' },
  attnConflictMany: { en: '{teacher} has {n} lessons at once from {time}.', ar: 'لدى {teacher} {n} في وقت واحد من {time}.' },
  attnAbsent: { en: '{teacher} is on leave with {n} that need a substitute, the first at {time}.', ar: 'إجازة {teacher} تشمل {n} تحتاج معلمًا بديلًا، أولها {time}.' },
  attnPayment: { en: 'The lesson of {student} with {teacher} at {time} is suspended until the family pays.', ar: 'حصة {student} مع {teacher} في {time} معلّقة حتى تدفع الأسرة.' },
  attnConflictAt: { en: '{teacher} has two lessons at {time}, one with another supervisor\'s student.', ar: 'لدى {teacher} حصتان في {time}، إحداهما لطالب لدى مشرف آخر.' },
  attnMonth: { en: 'Open a week or a day to see clashes, teachers on leave with lessons and payment holds.', ar: 'افتح أسبوعًا أو يومًا لرؤية التعارضات والمعلمين في إجازة ولديهم حصص والحصص المعلّقة للدفع.' },
  earlier: { en: 'Earlier hours', ar: 'الساعات الأبكر' },
  later: { en: 'Later hours', ar: 'الساعات الأحدث' },
  pastLessons: { en: 'Show {n} already over', ar: 'عرض {n} انتهت' },
  attnOutside: { en: '{teacher} has {n} outside working hours, the first at {time}.', ar: 'لدى {teacher} {n} خارج ساعات العمل، أولها {time}.' },
  attnOutsideOne: { en: '{teacher} has a lesson outside working hours at {time}.', ar: 'لدى {teacher} حصة خارج ساعات العمل في {time}.' },
  attnAbsentOne: { en: '{teacher} is on leave with a lesson at {time} that needs a substitute.', ar: 'إجازة {teacher} تشمل حصة في {time} تحتاج معلمًا بديلًا.' },

  // Week board
  ofHours: { en: '/ {base} h', ar: '/ {base} س' },
  noWorkingHours: { en: 'No working hours', ar: 'بلا ساعات عمل' },
  markConflict: { en: 'Clash', ar: 'تعارض' },
  markAbsent: { en: 'Leave', ar: 'إجازة' },
  markPayment: { en: 'On hold', ar: 'معلّقة' },
  markOutside: { en: 'After hours', ar: 'خارج الدوام' },
  todayMark: { en: 'Today', ar: 'اليوم' },

  // Shift (Teacher File)
  shiftTitle: { en: 'Shift', ar: 'الشيفت' },
  shiftNone: {
    en: 'No category yet: the schedule shows this teacher\'s working hours, with no red empty time.',
    ar: 'لا فئة بعد: يعرض الجدول ساعات عمل هذا المعلم دون وقت فارغ باللون الأحمر.',
  },
  shiftSince: { en: 'Since {date}', ar: 'منذ {date}' },
  shiftHourly: { en: 'Working hours are this teacher\'s availability (Schedules tab).', ar: 'ساعات العمل هي أوقات إتاحة هذا المعلم (تبويب الجداول).' },
  shiftHistory: { en: 'Earlier', ar: 'سابقًا' },
  shiftUntil: { en: '{from} to {to}', ar: 'من {from} إلى {to}' },
  changeShift: { en: 'Change shift', ar: 'تغيير الشيفت' },
  openSchedule: { en: 'Open in schedule', ar: 'افتح في الجدول' },
  validFrom: { en: 'From', ar: 'اعتبارًا من' },
  validFromHint: { en: 'Earlier days keep the shift they were worked under.', ar: 'تحتفظ الأيام السابقة بالشيفت الذي عُمل به.' },
  timezone: { en: 'Time zone', ar: 'المنطقة الزمنية' },
  windows: { en: 'Shift hours', ar: 'ساعات الشيفت' },
  addWindow: { en: 'Add hours', ar: 'إضافة ساعات' },
  removeWindow: { en: 'Remove', ar: 'إزالة' },
  dayOff: { en: 'Off', ar: 'إجازة' },
  useDefaults: { en: 'Use the default', ar: 'استخدم الافتراضي' },
  applyToAvailability: { en: 'Also make these the bookable hours', ar: 'اجعلها أيضًا أوقات الحجز' },
  applyHint: {
    en: 'Trial, make-up and move pickers offer the bookable hours. Leave on unless this teacher is booked outside the shift.',
    ar: 'تعرض أدوات حجز الحصص التجريبية والتعويضية والنقل أوقات الحجز. اتركه مفعّلًا ما لم يُحجز المعلم خارج الشيفت.',
  },
  applyLater: {
    en: 'Bookable hours change at once: set them on the first day of this shift (Schedules tab).',
    ar: 'تتغير أوقات الحجز فورًا: اضبطها في أول يوم من هذا الشيفت (تبويب الجداول).',
  },
  reason: { en: 'Reason (optional)', ar: 'السبب (اختياري)' },
  save: { en: 'Save', ar: 'حفظ' },
  cancel: { en: 'Cancel', ar: 'إلغاء' },
  needDay: { en: 'Give at least one day of hours.', ar: 'أدخل ساعات ليوم واحد على الأقل.' },
  badWindow: { en: 'Each end must be after its start.', ar: 'يجب أن تكون كل نهاية بعد بدايتها.' },
  refusedShift: { en: 'Shifts are set by the Teachers Manager.', ar: 'يحدد مدير قسم المعلمين الشيفتات.' },
  refusedEarlier: {
    en: 'A later change already exists. Choose a start on or after it.',
    ar: 'يوجد تغيير لاحق بالفعل. اختر تاريخ بداية في يومه أو بعده.',
  },

  // Supervisor colors (Organization)
  colorsTitle: { en: 'Schedule colors', ar: 'ألوان الجدول' },
  colorsHint: {
    en: 'Each supervisor\'s students\' lessons carry this color in the schedule.',
    ar: 'تحمل حصص طلاب كل مشرف هذا اللون في الجدول.',
  },
  colorFor: { en: 'Color for {name}', ar: 'لون {name}' },
  colorRefused: { en: 'Colors are set by the Operations Manager.', ar: 'يحدد مدير العمليات الألوان.' },
} satisfies Record<string, Pair>

export const VIEW_LABEL: Record<View, Pair> = {
  day: { en: 'Day', ar: 'يوم' },
  week: { en: 'Week', ar: 'أسبوع' },
  month: { en: 'Month', ar: 'شهر' },
}

export const CATEGORY_LABEL: Record<Category, Pair> = {
  full_shift: { en: 'Full shift', ar: 'شيفت كامل' },
  part_shift: { en: 'Part shift', ar: 'شيفت جزئي' },
  hourly: { en: 'Hourly', ar: 'بالساعة' },
  unset: { en: 'Not set', ar: 'غير محدد' },
}

export const STATUS_LABEL: Record<CalendarStatus, Pair> = {
  active: { en: 'Active', ar: 'نشط' },
  trial: { en: 'Trial', ar: 'تجريبي' },
  paused: { en: 'Temporarily paused', ar: 'متوقف مؤقتاً' },
  moved: { en: 'Moved away', ar: 'نُقلت' },
}

/**
 * CHATSCHED-014: a lesson nobody teaches -- cancelled, excused, the teacher
 * absent -- is 'active' to calendar_status, so its block read "Active" like a
 * booked one. For these the block says its outcome (OUTCOME_LABEL, as the
 * details panel does). Their time still counts as booked (PD-38 §2: booked is
 * any lesson reserved for a student, whatever its outcome).
 */
const NOT_TAUGHT: ReadonlySet<string> = new Set(['admin_cancelled', 'student_apology', 'teacher_apology', 'teacher_no_show'])

/** Whether a block is a lesson nobody teaches (drawn muted and struck through). */
export const notTaught = (l: { anonymous?: true; outcome?: string | null }) => !l.anonymous && !!l.outcome && NOT_TAUGHT.has(l.outcome)

/** What a block says it is: the outcome for a lesson nobody teaches, else its calendar status. */
export function statusOf(l: { status: CalendarStatus; anonymous?: true; outcome?: string | null }): Pair {
  return notTaught(l) ? OUTCOME_LABEL[l.outcome as string]! : STATUS_LABEL[l.status]
}

/** Items of a list in a sentence: "A, B" / "أ، ب". */
export function joinList(parts: ReadonlyArray<string>, locale: 'ar' | 'en'): string {
  return parts.join(locale === 'ar' ? '، ' : ', ')
}

/** "1 lesson", "2 lessons" / "حصة واحدة"، "حصتان"، "3 حصص"، "11 حصة": a count with its noun, in each language's grammar. */
export function lessonsCount(n: number, locale: 'ar' | 'en'): string {
  if (locale === 'en') return n === 1 ? '1 lesson' : `${n} lessons`
  if (n === 1) return 'حصة واحدة'
  if (n === 2) return 'حصتان'
  if (n >= 3 && n <= 10) return `${n} حصص`
  return `${n} حصة`
}

export const KIND_LABEL: Record<LessonKind, Pair> = {
  regular: { en: 'Regular', ar: 'أساسية' },
  makeup: { en: 'Make-up', ar: 'تعويضية' },
  trial: { en: 'Trial', ar: 'تجريبية' },
}

export const OUTCOME_LABEL: Record<string, Pair> = {
  held: { en: 'Held', ar: 'انعقدت' },
  student_apology: { en: 'Student apologised', ar: 'اعتذر الطالب' },
  teacher_apology: { en: 'Teacher apologised', ar: 'اعتذر المعلم' },
  student_no_show: { en: 'Student absent', ar: 'غاب الطالب' },
  teacher_no_show: { en: 'Teacher absent', ar: 'غاب المعلم' },
  admin_cancelled: { en: 'Cancelled', ar: 'أُلغيت' },
  rescheduled: { en: 'Moved', ar: 'نُقلت' },
  suspended: { en: 'Paused', ar: 'متوقفة' },
}

/** ISO weekday labels, Saturday first (the academy's week). */
export const WEEKDAYS: ReadonlyArray<{ iso: number; label: Pair; short: Pair }> = [
  { iso: 6, label: { en: 'Saturday', ar: 'السبت' }, short: { en: 'Sat', ar: 'سبت' } },
  { iso: 7, label: { en: 'Sunday', ar: 'الأحد' }, short: { en: 'Sun', ar: 'أحد' } },
  { iso: 1, label: { en: 'Monday', ar: 'الاثنين' }, short: { en: 'Mon', ar: 'اثنين' } },
  { iso: 2, label: { en: 'Tuesday', ar: 'الثلاثاء' }, short: { en: 'Tue', ar: 'ثلاثاء' } },
  { iso: 3, label: { en: 'Wednesday', ar: 'الأربعاء' }, short: { en: 'Wed', ar: 'أربعاء' } },
  { iso: 4, label: { en: 'Thursday', ar: 'الخميس' }, short: { en: 'Thu', ar: 'خميس' } },
  { iso: 5, label: { en: 'Friday', ar: 'الجمعة' }, short: { en: 'Fri', ar: 'جمعة' } },
]

/** `tx(pair, { name: value })` -- the locale's text with {placeholders} filled. */
export function useScheduleText() {
  const { locale } = useI18n()
  return useCallback(
    (p: Pair, vars?: Record<string, string | number>) => {
      let s = locale === 'ar' ? p.ar : p.en
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v))
      return s
    },
    [locale],
  )
}

/** A calendar day ("2026-10-26") as words. A day, not an instant: no zone can move it. */
export function dayLabel(day: string, locale: 'ar' | 'en', opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { ...opts, timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`))
}

/** Minutes as hours with one decimal: 90 -> "1.5". */
export function hoursOf(minutes: number, locale: 'ar' | 'en'): string {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { maximumFractionDigits: 1 }).format(minutes / 60)
}

export function percentOf(ratio: number | null, locale: 'ar' | 'en'): string {
  if (ratio === null) return '—'
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { style: 'percent', maximumFractionDigits: 0 }).format(ratio)
}

/** A server refusal as a sentence; codes we know get our own words. */
export function describeScheduleError(error: unknown, locale: 'ar' | 'en'): string {
  const pick = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  if (error instanceof ApiError) {
    if (error.code === 'COMM.LESSON_STATE' && /begins on/.test(error.messageEn)) return pick(S.refusedEarlier)
    return locale === 'ar' && error.messageAr ? error.messageAr : error.messageEn
  }
  return error instanceof Error ? error.message : String(error)
}
