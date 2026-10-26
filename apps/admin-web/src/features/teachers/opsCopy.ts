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

  // PD-31: weekly times
  weeklyTitle: { en: 'Weekly times — {name}', ar: 'المواعيد الأسبوعية — {name}' },
  weeklyHint: {
    en: 'Change one time, add or remove one; the others stay as they are. Only free times are offered.',
    ar: 'غيّر موعدًا أو أضف موعدًا أو احذفه؛ تبقى المواعيد الأخرى كما هي. لا تُعرض إلا الأوقات المتاحة.',
  },
  currentTimes: { en: 'Current weekly times', ar: 'المواعيد الأسبوعية الحالية' },
  noWeeklyTimes: { en: 'No weekly times yet.', ar: 'لا توجد مواعيد أسبوعية بعد.' },
  change: { en: 'Change', ar: 'تغيير' },
  undo: { en: 'Undo', ar: 'تراجع' },
  newTime: { en: 'New time', ar: 'الموعد الجديد' },
  pickReplacement: { en: 'Pick its new time', ar: 'اختر موعده الجديد' },
  pickNewTime: { en: 'Pick the new time', ar: 'اختر الموعد الجديد' },
  addedTime: { en: 'New weekly time', ar: 'موعد أسبوعي جديد' },
  removed: { en: 'Removed', ar: 'محذوف' },
  fromDate: { en: 'From', ar: 'ابتداءً من' },
  summary: { en: 'Summary', ar: 'الملخص' },
  noChange: { en: 'Nothing changed yet.', ar: 'لم يتغيّر شيء بعد.' },
  sumChanged: { en: '{from} → {to} from {date}', ar: '{from} ← {to} ابتداءً من {date}' },
  sumAdded: { en: '{to} added from {date}', ar: 'إضافة {to} ابتداءً من {date}' },
  sumRemoved: { en: '{from} removed from {date}', ar: 'حذف {from} ابتداءً من {date}' },
  sumUnchanged: { en: '{from} unchanged', ar: '{from} بلا تغيير' },
  sumSkipped: {
    en: 'No lesson at {time} on {dates}: the teacher already has another lesson then.',
    ar: 'لا حصة في {time} يوم {dates}: لدى المعلم حصة أخرى في ذلك الوقت.',
  },
  pickPending: { en: 'Pick a time for every changed or added row, or remove it.', ar: 'اختر وقتًا لكل موعد مُغيَّر أو مُضاف، أو احذفه.' },

  // PD-31: one-off lessons and moving lessons
  addLesson: { en: 'Add a lesson', ar: 'إضافة حصة' },
  addLessonTitle: { en: 'Add a lesson — {name}', ar: 'إضافة حصة — {name}' },
  addLessonHint: { en: "One extra lesson at one of the teacher's free times. Weekly times are not changed.", ar: 'حصة إضافية واحدة في أحد أوقات المعلم المتاحة. لا تتغيّر المواعيد الأسبوعية.' },
  freeTime: { en: 'Free time', ar: 'الوقت المتاح' },
  addLessonSave: { en: 'Add the lesson', ar: 'إضافة الحصة' },
  lessons: { en: 'Lessons', ar: 'الحصص' },
  lessonsTitle: { en: 'Lessons — {name}', ar: 'الحصص — {name}' },
  lessonsHint: { en: 'The next four weeks. A lesson that has not started can be moved to a free time.', ar: 'الأسابيع الأربعة القادمة. يمكن نقل الحصة التي لم تبدأ إلى وقت متاح.' },
  noLessons: { en: 'No lessons in the next four weeks.', ar: 'لا توجد حصص في الأسابيع الأربعة القادمة.' },
  move: { en: 'Move', ar: 'نقل' },
  moveTitle: { en: 'Move the lesson — {name}', ar: 'نقل الحصة — {name}' },
  moveHint: { en: 'Only this lesson moves; weekly times stay. It is not an apology and counts against nobody.', ar: 'تنتقل هذه الحصة وحدها وتبقى المواعيد الأسبوعية. ليس اعتذارًا ولا يُحتسب على أحد.' },
  moveSave: { en: 'Move the lesson', ar: 'نقل الحصة' },
  backToLessons: { en: 'Back to the lessons', ar: 'العودة إلى الحصص' },
  movedToAt: { en: 'Moved to {when}', ar: 'نُقلت إلى {when}' },
  movedHere: { en: 'Moved here', ar: 'منقولة' },
  makeup: { en: 'Make-up', ar: 'تعويضية' },
  regular: { en: 'Regular', ar: 'أساسية' },
  trial: { en: 'Trial', ar: 'تجريبية' },
  statusUpcoming: { en: 'Upcoming', ar: 'قادمة' },
  statusClosed: { en: 'Closed', ar: 'مغلقة' },
  statusInProgress: { en: 'In progress', ar: 'جارية' },
  summaryMove: { en: '{from} → {to}', ar: '{from} ← {to}' },
  chooseTimeFirst: { en: 'Choose a free time.', ar: 'اختر وقتًا متاحًا.' },
  justTaken: { en: 'That time was just taken. The free times were refreshed: pick another.', ar: 'حُجز هذا الوقت للتو. حُدّثت الأوقات المتاحة: اختر وقتًا آخر.' },
  refusalStarted: { en: 'This lesson has started; it can no longer be moved.', ar: 'بدأت هذه الحصة؛ لا يمكن نقلها الآن.' },
  refusalNotMovable: { en: 'This lesson cannot be moved (it is closed, cancelled or already moved).', ar: 'لا يمكن نقل هذه الحصة (مغلقة أو ملغاة أو نُقلت من قبل).' },
  refusalFamilyMoved: { en: 'The family has already moved this lesson once.', ar: 'نقلت الأسرة هذه الحصة مرة من قبل.' },
  refusalFamilyLimit: { en: "The family has used this month's moves.", ar: 'استنفدت الأسرة مرات النقل لهذا الشهر.' },
  refusalTooLate: { en: 'Too close to the start to move.', ar: 'الوقت قريب جدًا من بداية الحصة للنقل.' },

  // PD-31: Needs action
  requestedByFamily: { en: 'Asked by the family ({name})', ar: 'بطلب من الأسرة ({name})' },
  requestedByTeacher: { en: 'Asked by the teacher ({name})', ar: 'بطلب من المعلم ({name})' },
  before: { en: 'Now', ar: 'الحالي' },
  after: { en: 'Requested', ar: 'المطلوب' },
  free: { en: 'free', ar: 'متاح' },
  notFree: { en: 'no longer free', ar: 'لم يعد متاحًا' },
  noLongerFree: {
    en: 'No longer free: a requested time was taken after the request was sent. Approving would fail; reject it, or agree other times with the family.',
    ar: 'لم يعد متاحًا: حُجز أحد المواعيد المطلوبة بعد إرسال الطلب. لا يمكن اعتماده؛ ارفضه أو اتفق على مواعيد أخرى.',
  },
  blocked: { en: 'Weekly lessons not scheduled', ar: 'حصص أسبوعية لم تُجدول' },
  blockedHint: {
    en: 'The teacher already had another lesson at these weekly times, so these lessons were not created. Schedule each at another time, or dismiss it.',
    ar: 'كان لدى المعلم حصة أخرى في هذه المواعيد الأسبوعية، فلم تُنشأ هذه الحصص. جدول كلًّا منها في وقت آخر أو تجاهله.',
  },
  blockedBy: { en: 'Blocked by a {kind} lesson at {time}', ar: 'تعارضت مع حصة {kind} في {time}' },
  scheduleElsewhere: { en: 'Schedule at another time', ar: 'جدولة في وقت آخر' },
  scheduleElsewhereTitle: { en: 'Schedule — {name}', ar: 'جدولة — {name}' },
  dismiss: { en: 'Dismiss', ar: 'تجاهل' },
  scheduleSave: { en: 'Schedule the lesson', ar: 'جدولة الحصة' },

  // PD-31: changing the teacher
  changeTeacher: { en: 'Change teacher', ar: 'تغيير المعلم' },
  changeTeacherTitle: { en: 'Change teacher — {name}', ar: 'تغيير المعلم — {name}' },
  changeTeacherHint: {
    en: 'Past lessons and reports stay with the current teacher. Future lessons and weekly times move to the new one, in one step.',
    ar: 'تبقى الحصص السابقة وتقاريرها مع المعلم الحالي. تنتقل الحصص القادمة والمواعيد الأسبوعية إلى المعلم الجديد دفعة واحدة.',
  },
  currentTeacher: { en: 'Current teacher', ar: 'المعلم الحالي' },
  onLeaveUntil: { en: 'on leave until {date}', ar: 'في إجازة حتى {date}' },
  suspendedUntil: { en: 'suspended until {date}', ar: 'موقوف حتى {date}' },
  inactiveTeacher: { en: 'inactive', ar: 'غير نشط' },
  isCurrent: { en: 'current teacher', ar: 'المعلم الحالي' },
  whichReplaced: { en: 'Which teacher is being replaced?', ar: 'أي معلم سيُستبدل؟' },
  whichReplacedHint: { en: 'This group has children with more than one teacher. Only the children of the teacher you pick move.', ar: 'في هذه المجموعة أطفال لدى أكثر من معلم. ينتقل أطفال المعلم الذي تختاره فقط.' },
  previewTitle: { en: 'The new teacher at these times', ar: 'المعلم الجديد في هذه المواعيد' },
  slotFree: { en: 'free', ar: 'متاح' },
  slotBusy: { en: 'busy — pick another time', ar: 'مشغول — اختر وقتًا آخر' },
  futureLessons: { en: '{n} future lessons follow', ar: 'تنتقل {n} حصة قادمة' },
  unmovableTitle: { en: 'These lessons cannot follow (the new teacher is busy then):', ar: 'لا يمكن نقل هذه الحصص (المعلم الجديد مشغول وقتها):' },
  resolveBusy: { en: 'Pick a free time for every busy weekly time first.', ar: 'اختر وقتًا متاحًا لكل موعد أسبوعي مشغول أولًا.' },
  chooseNewTeacher: { en: 'Choose the new teacher.', ar: 'اختر المعلم الجديد.' },
  chooseReplaced: { en: 'Choose which teacher is being replaced.', ar: 'اختر المعلم الذي سيُستبدل.' },
  confirmChange: { en: 'Change teacher', ar: 'تغيير المعلم' },
  sumTeacher: { en: '{name}: {from} → {to}', ar: '{name}: {from} ← {to}' },
  sumKept: { en: '{time} kept', ar: '{time} كما هو' },
  noTeacher: { en: 'no teacher', ar: 'بلا معلم' },
  groupChanged: { en: 'Teacher changed for {n} children.', ar: 'تم تغيير المعلم لـ {n} من الأطفال.' },
  timesNotFree: {
    en: 'The new teacher is no longer free at one of these times. The preview was refreshed: check it again.',
    ar: 'لم يعد المعلم الجديد متاحًا في أحد هذه المواعيد. حُدّثت المعاينة: راجعها مرة أخرى.',
  },
  lockedRefusal: { en: 'Lessons are paused for payment; nothing can be changed until it is settled.', ar: 'الحصص متوقفة بسبب الدفع؛ لا يمكن تغيير شيء حتى تتم التسوية.' },

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
        // PD-31 / PD-30: two refusals carry a code word, not a sentence.
        if (error.messageEn === 'locked') return pick(O.lockedRefusal)
        if (error.messageEn === 'times_not_free') return pick(O.timesNotFree)
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

/** "from → to" in the reading direction: in Arabic the arrow points left, to the new value. */
export function arrow(locale: 'ar' | 'en'): string {
  return locale === 'ar' ? ' ← ' : ' → '
}

/** "{name}" placeholders filled in. */
export function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m))
}

/** A lesson length, "30 min" / "٣٠ دقيقة". */
export function formatMinutes(n: number, locale: 'ar' | 'en'): string {
  return locale === 'ar' ? `${new Intl.NumberFormat('ar-EG').format(n)} دقيقة` : `${n} min`
}
