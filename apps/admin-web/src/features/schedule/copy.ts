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
  today: { en: 'Today', ar: 'اليوم' },
  previous: { en: 'Previous', ar: 'السابق' },
  next: { en: 'Next', ar: 'التالي' },
  date: { en: 'Date', ar: 'التاريخ' },
  viewLabel: { en: 'View', ar: 'طريقة العرض' },
  teacher: { en: 'Teacher', ar: 'المعلم' },
  noTeachers: { en: 'No teacher matches these filters.', ar: 'لا يوجد معلم يطابق عوامل التصفية هذه.' },
  monthHint: {
    en: 'Each cell is one teacher\'s day: shift used, and empty hours in the shift. Open a day to see its lessons.',
    ar: 'كل خانة يوم لمعلم: نسبة إشغال الشيفت والساعات الفارغة فيه. افتح اليوم لرؤية حصصه.',
  },
  openDay: { en: 'Open {teacher}, {day}', ar: 'افتح {teacher}، {day}' },

  // Filters
  filters: { en: 'Filters', ar: 'عوامل التصفية' },
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
  teachingHours: { en: 'Teaching hours', ar: 'ساعات التدريس' },
  heldSoFar: { en: '{h} held', ar: '{h} منعقدة' },
  students: { en: 'Students', ar: 'الطلاب' },
  studentsHint: { en: '+{trial} trial · {paused} paused', ar: '+{trial} تجريبي · {paused} متوقف' },
  utilization: { en: 'Shift used', ar: 'إشغال الشيفت' },
  utilizationHint: { en: '{booked} of {base} shift hours', ar: '{booked} من {base} ساعة شيفت' },
  emptyHours: { en: 'Empty in shift', ar: 'فارغ داخل الشيفت' },
  outsideHours: { en: 'Outside the shift', ar: 'خارج الشيفت' },
  leaveHours: { en: 'Leave', ar: 'إجازة' },
  pausedHours: { en: 'Paused', ar: 'متوقف' },
  freeHours: { en: 'Free (hourly)', ar: 'متاح (بالساعة)' },
  capacityNote: {
    en: 'Shift, empty and leave count every lesson of the teachers shown; teaching hours and students count only the matching lessons.',
    ar: 'الشيفت والفارغ والإجازة تحتسب كل حصص المعلمين المعروضين؛ ساعات التدريس والطلاب تحتسب الحصص المطابقة فقط.',
  },
  byTeacher: { en: 'By teacher', ar: 'حسب المعلم' },
  colShift: { en: 'Shift', ar: 'الشيفت' },
  colBooked: { en: 'Booked', ar: 'محجوز' },
  colUsed: { en: 'Used', ar: 'الإشغال' },
  colRemaining: { en: 'Empty', ar: 'فارغ' },
  colOutside: { en: 'Outside', ar: 'خارج' },
  colLeave: { en: 'Leave', ar: 'إجازة' },
  hours: { en: '{h} h', ar: '{h} س' },
  dash: { en: '—', ar: '—' },

  // Legend
  legend: { en: 'Legend', ar: 'دليل الألوان' },
  supervisorsLegend: { en: 'Supervisors', ar: 'المشرفون' },
  statusLegend: { en: 'Status', ar: 'الحالة' },
  noColor: { en: 'No color yet', ar: 'بلا لون بعد' },
  emptySlot: { en: 'Available time without a student', ar: 'وقت متاح بدون طالب' },
  outsideShift: { en: 'Outside the shift', ar: 'خارج الشيفت' },
  shiftBand: { en: 'Shift', ar: 'الشيفت' },
  workBand: { en: 'Working hours (hourly)', ar: 'ساعات العمل (بالساعة)' },
  leaveBand: { en: 'Leave', ar: 'إجازة' },
  otherBooking: { en: 'Other booking', ar: 'حجز آخر' },
  booked: { en: 'Booked', ar: 'محجوز' },
  outsideMark: { en: 'outside the shift', ar: 'خارج الشيفت' },

  // Lesson details
  lessonTitle: { en: 'Lesson', ar: 'الحصة' },
  when: { en: 'When', ar: 'الموعد' },
  student: { en: 'Student', ar: 'الطالب' },
  status: { en: 'Status', ar: 'الحالة' },
  outcome: { en: 'Outcome', ar: 'النتيجة' },
  openStudent: { en: 'Open student profile', ar: 'افتح ملف الطالب' },
  anonymousLesson: { en: 'Another supervisor\'s student', ar: 'طالب لدى مشرف آخر' },
  movedHere: { en: 'Moved to this time', ar: 'نُقلت إلى هذا الموعد' },
  paymentHold: { en: 'Suspended — payment', ar: 'معلّقة — الدفع' },
  close: { en: 'Close', ar: 'إغلاق' },

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
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { ...opts, timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`))
}

/** Minutes as hours with one decimal: 90 -> "1.5". */
export function hoursOf(minutes: number, locale: 'ar' | 'en'): string {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { maximumFractionDigits: 1 }).format(minutes / 60)
}

export function percentOf(ratio: number | null, locale: 'ar' | 'en'): string {
  if (ratio === null) return '—'
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { style: 'percent', maximumFractionDigits: 0 }).format(ratio)
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
