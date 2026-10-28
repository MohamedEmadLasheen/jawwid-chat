import { ApiError } from '@/core/api/errors'
import type { Pair } from '@/features/organization/copy'

export { useCopy, type Pair } from '@/features/organization/copy'

/**
 * Teacher File copy, Arabic and English side by side. Wording rule: a label
 * never promises more than the server does. Salary, schedule and workload are
 * named as "not here yet", never shown as zero.
 */
export const T = {
  title: { en: 'Teachers', ar: 'المعلمون' },
  subtitle: {
    en: 'Each teacher’s file: personal information, assigned students and supervision notes. Visible to administration only — never to parents or teachers.',
    ar: 'ملف كل معلم: البيانات الشخصية والطلاب المسندون وملاحظات الإشراف. للإدارة فقط، ولا يراه أولياء الأمور ولا المعلمون.',
  },
  search: { en: 'Search a teacher', ar: 'ابحث عن معلم' },
  count: { en: '{n} teachers', ar: '{n} معلمًا' },
  noTeachers: { en: 'No teachers to show.', ar: 'لا يوجد معلمون للعرض.' },
  name: { en: 'Teacher', ar: 'المعلم' },
  students: { en: 'Students', ar: 'الطلاب' },
  openComplaints: { en: 'Open complaints', ar: 'شكاوى مفتوحة' },
  status: { en: 'Status', ar: 'الحالة' },
  active: { en: 'Active', ar: 'نشط' },
  inactive: { en: 'Left', ar: 'غادر' },
  open: { en: 'Open file', ar: 'فتح الملف' },
  back: { en: 'All teachers', ar: 'كل المعلمين' },

  // Sections
  personal: { en: 'Personal information', ar: 'البيانات الشخصية' },
  fullName: { en: 'Full name', ar: 'الاسم الكامل' },
  phone: { en: 'Phone number', ar: 'رقم الهاتف' },
  email: { en: 'Email address', ar: 'البريد الإلكتروني' },
  joinedOn: { en: 'Joining date', ar: 'تاريخ الانضمام' },
  teachingMarket: { en: 'Teaching market', ar: 'سوق التدريس' },
  notRecorded: { en: 'Not recorded', ar: 'غير مسجّل' },
  lastEdit: { en: 'Last changed by {name}, {date}', ar: 'آخر تعديل: {name}، {date}' },
  edit: { en: 'Edit', ar: 'تعديل' },
  editPersonal: { en: 'Edit personal information', ar: 'تعديل البيانات الشخصية' },
  personalHint: {
    en: 'Leave a field empty to clear it. The audit trail records which fields changed, never their values.',
    ar: 'اترك الحقل فارغًا لمسحه. يسجّل سجل التدقيق الحقول التي تغيّرت دون قيمها.',
  },

  assigned: { en: 'Assigned students', ar: 'الطلاب المسندون' },
  assignedHint: {
    en: 'From the academy’s assignment of each child to a teacher.',
    ar: 'من إسناد الأكاديمية كل طالب إلى معلمه.',
  },
  noStudents: { en: 'No students are assigned to this teacher.', ar: 'لا يوجد طلاب مسندون لهذا المعلم.' },
  child: { en: 'Student', ar: 'الطالب' },
  level: { en: 'Level', ar: 'المستوى' },
  family: { en: 'Family', ar: 'الأسرة' },
  supervisor: { en: 'Supervisor', ar: 'المشرف' },
  none: { en: '—', ar: '—' },

  complaints: { en: 'Complaints', ar: 'الشكاوى' },
  noComplaints: { en: 'No complaints recorded.', ar: 'لا توجد شكاوى مسجّلة.' },
  addComplaint: { en: 'Record a complaint', ar: 'تسجيل شكوى' },
  resolve: { en: 'Resolve', ar: 'معالجة' },
  resolveTitle: { en: 'Resolve the complaint', ar: 'معالجة الشكوى' },
  resolved: { en: 'Resolved', ar: 'تمت المعالجة' },
  unresolved: { en: 'Open', ar: 'مفتوحة' },
  fromConversation: { en: 'Linked to a conversation', ar: 'مرتبطة بمحادثة' },
  // PD-26
  fromParent: { en: 'From a parent', ar: 'من ولي أمر' },
  fromManagement: { en: 'From management', ar: 'من الإدارة' },
  source: { en: 'Source', ar: 'المصدر' },
  sourceParent: { en: 'A parent', ar: 'ولي أمر' },
  sourceManagement: { en: 'Management', ar: 'الإدارة' },
  // PD-26 amendment: Operations names the family chat a parent's complaint came from.
  familyChat: { en: 'Family chat it came from', ar: 'محادثة الأسرة التي وردت منها' },
  chooseFamilyChat: { en: 'Choose the family', ar: 'اختر الأسرة' },
  handler: { en: 'Supervisor handling it', ar: 'المشرف المسؤول' },
  handlerMe: { en: 'Me', ar: 'أنا' },
  handledBy: { en: 'Handled by {name}', ar: 'يتابعها {name}' },
  statusOpen: { en: 'Open', ar: 'مفتوحة' },
  statusUpheld: { en: 'Upheld — awaiting a decision', ar: 'ثبتت — بانتظار القرار' },
  statusActioned: { en: 'Action taken', ar: 'اتُّخذ إجراء' },
  statusResolved: { en: 'Resolved', ar: 'تمت المعالجة' },
  actionTaken: { en: 'Action taken: {d}', ar: 'الإجراء: {d}' },
  uphold: { en: 'Uphold and act', ar: 'إثبات واتخاذ إجراء' },
  upholdTitle: { en: 'Uphold the complaint', ar: 'إثبات الشكوى' },
  upholdHint: {
    en: 'The complaint joins this month’s discipline ladder for the teacher, like an absence or lateness. Decide the action on it from Supervision › Absences or Complaints; it is recorded here.',
    ar: 'تُضاف الشكوى إلى سُلّم الانضباط لهذا الشهر للمعلم، مثل الغياب أو التأخير. يُتخذ القرار عليها من الإشراف › الغياب أو الشكاوى، ويُسجَّل هنا.',
  },
  decideAction: { en: 'Decide the action', ar: 'اتخاذ القرار' },
  followUp: { en: 'Add a follow-up', ar: 'إضافة متابعة' },
  followUpTitle: { en: 'Follow-up note', ar: 'ملاحظة متابعة' },
  followUps: { en: 'Follow-ups', ar: 'المتابعات' },
  chooseTeacher: { en: 'Choose a teacher', ar: 'اختر معلمًا' },
  onLeaveUntil: { en: 'On leave until {date}', ar: 'في إجازة حتى {date}' },
  suspendedUntil: { en: 'Suspended until {date}', ar: 'موقوف حتى {date}' },
  offUntil: { en: 'Day off until {date}', ar: 'يوم إجازة حتى {date}' },

  monthly: { en: 'Monthly performance', ar: 'الأداء الشهري' },
  noMonthly: { en: 'No monthly comments yet.', ar: 'لا توجد تعليقات شهرية بعد.' },
  addMonthly: { en: 'Write a monthly comment', ar: 'كتابة تعليق شهري' },
  month: { en: 'Month', ar: 'الشهر' },
  earlierVersions: { en: '{n} earlier version(s)', ar: 'نسخ سابقة: {n}' },
  monthlyHint: {
    en: 'Writing again for the same month replaces the comment shown; earlier versions are kept.',
    ar: 'الكتابة مرة أخرى للشهر نفسه تستبدل التعليق المعروض، وتُحفظ النسخ السابقة.',
  },

  daysOff: { en: 'Days off', ar: 'أيام الإجازة' },
  daysOffHint: {
    en: 'Extra days off recorded by supervision. The regular weekly day off arrives with the schedule.',
    ar: 'أيام الإجازة الإضافية التي يسجّلها الإشراف. الإجازة الأسبوعية الثابتة تأتي مع الجدول.',
  },
  noDaysOff: { en: 'No extra days off recorded.', ar: 'لا توجد أيام إجازة إضافية مسجّلة.' },
  addDayOff: { en: 'Record a day off', ar: 'تسجيل يوم إجازة' },
  cancel: { en: 'Cancel day off', ar: 'إلغاء الإجازة' },
  cancelTitle: { en: 'Cancel the day off on {date}', ar: 'إلغاء إجازة يوم {date}' },
  cancelled: { en: 'Cancelled', ar: 'ملغاة' },
  day: { en: 'Day', ar: 'اليوم' },

  // Schedule and KPIs (PD-11, read from the Schedules and Statistics routes)
  schedule: { en: 'Schedule', ar: 'الجدول' },
  editSchedule: { en: 'Edit in Schedules', ar: 'التعديل في الجداول' },
  workingHours: { en: 'Working hours', ar: 'ساعات العمل' },
  noWorkingHours: { en: 'No working hours set yet.', ar: 'لم تُحدَّد ساعات العمل بعد.' },
  timesIn: { en: 'Times in {zone}', ar: 'الأوقات بتوقيت {zone}' },
  nextLessons: { en: 'Lessons in the next {n} days', ar: 'الحصص في الأيام الـ{n} القادمة' },
  noLessons: { en: 'No lessons in the next {n} days.', ar: 'لا توجد حصص في الأيام الـ{n} القادمة.' },
  lessonWhen: { en: 'When', ar: 'الموعد' },
  lessonLength: { en: 'Length', ar: 'المدة' },
  lessonKind: { en: 'Type', ar: 'النوع' },
  regular: { en: 'Regular', ar: 'أساسية' },
  makeup: { en: 'Make-up', ar: 'تعويضية' },
  minutesShort: { en: '{m} min', ar: '{m} دقيقة' },
  hoursShort: { en: '{h} h', ar: '{h} ساعة' },
  kpis: { en: 'Key indicators', ar: 'المؤشرات الرئيسية' },
  kpiHeld: { en: 'Lessons held', ar: 'الحصص المنعقدة' },
  kpiAttendance: { en: 'Student attendance', ar: 'حضور الطلاب' },
  kpiReliability: { en: 'Teacher reliability', ar: 'التزام المعلم' },
  kpiReportsOnTime: { en: 'Reports on time', ar: 'التقارير في موعدها' },
  kpiReplies: { en: 'Family messages answered', ar: 'الرد على رسائل الأسر' },
  kpiRepliesHint: { en: 'of {n} messages', ar: 'من {n} رسالة' },
  kpiWorkload: { en: 'Scheduled hours', ar: 'الساعات المجدولة' },
  kpiWorkloadHint: { en: 'of {h} available', ar: 'من {h} متاحة' },
  kpiTrials: { en: 'Trial conversion', ar: 'تحويل الحصص التجريبية' },
  kpiTrialsHint: { en: '{n} trials', ar: '{n} حصة تجريبية' },
  fullStats: { en: 'Full statistics for this month', ar: 'الإحصائيات الكاملة لهذا الشهر' },
  comments: { en: 'Supervisor comments', ar: 'تعليقات المشرف' },


  // Forms
  details: { en: 'Details', ar: 'التفاصيل' },
  resolution: { en: 'How it was resolved', ar: 'كيف عولجت' },
  reason: { en: 'Reason for the change', ar: 'سبب التغيير' },
  required: { en: 'Required.', ar: 'مطلوب.' },
  save: { en: 'Save', ar: 'حفظ' },
  saving: { en: 'Saving…', ar: 'جارٍ الحفظ…' },
  by: { en: '{name}, {date}', ar: '{name}، {date}' },

  // Supervision timeline (PD-11's query over existing records)
  timeline: { en: 'Supervision timeline', ar: 'سجل الإشراف' },
  timelineHint: {
    en: 'Everything about this teacher in one line, newest first: notes, bonuses, complaints, monthly comments, rulings, lessons not given, transfers and days off. Nothing here is typed twice.',
    ar: 'كل ما يخص هذا المعلم في تسلسل واحد، الأحدث أولًا: الملاحظات والمكافآت والشكاوى والتعليقات الشهرية والقرارات والحصص التي لم تُعطَ والنقل وأيام الإجازة. لا يُكتب شيء هنا مرتين.',
  },
  noTimeline: { en: 'Nothing on the timeline yet.', ar: 'لا شيء في السجل بعد.' },
  addNote: { en: 'Add a note', ar: 'إضافة ملاحظة' },
  note: { en: 'Note', ar: 'ملاحظة' },
  recordBonus: { en: 'Record a bonus', ar: 'تسجيل مكافأة' },
  bonusReason: { en: 'Why the bonus', ar: 'سبب المكافأة' },
  bonusHint: {
    en: 'The teacher sees the reason in their supervision chat. The super admin sets the amount in the Bonus history, never here.',
    ar: 'يرى المعلم السبب في محادثة الإشراف. يحدّد المدير العام المبلغ في سجل المكافآت، وليس هنا.',
  },
  filterAll: { en: 'All', ar: 'الكل' },
  filterRecognition: { en: 'Notes & bonuses', ar: 'ملاحظات ومكافآت' },
  filterConcerns: { en: 'Complaints', ar: 'الشكاوى' },
  filterLessons: { en: 'Lessons', ar: 'الحصص' },
  filterMoves: { en: 'Transfers & days off', ar: 'النقل والإجازات' },
  tBonus: { en: 'Bonus', ar: 'مكافأة' },
  tComplaint: { en: 'Complaint', ar: 'شكوى' },
  tResolution: { en: 'Complaint resolved', ar: 'معالجة شكوى' },
  tFollowUp: { en: 'Complaint follow-up', ar: 'متابعة شكوى' },
  tMonthly: { en: 'Monthly comment', ar: 'تعليق شهري' },
  tNote: { en: 'Note', ar: 'ملاحظة' },
  tLateApology: { en: 'Late apology ruled', ar: 'قرار في اعتذار متأخر' },
  tMakeup: { en: 'Make-up follow-up', ar: 'متابعة حصة تعويضية' },
  tTeacherApology: { en: 'Teacher apologised', ar: 'اعتذر المعلم' },
  tTeacherNoShow: { en: 'Teacher absent', ar: 'غياب المعلم' },
  tTransferIn: { en: 'Student transferred in', ar: 'نُقل إليه طالب' },
  tTransferOut: { en: 'Student transferred out', ar: 'نُقل منه طالب' },
  tDayOff: { en: 'Day off', ar: 'يوم إجازة' },
  tOther: { en: 'Record', ar: 'سجل' },
  lessonOf: { en: '{name}, {date}', ar: '{name}، {date}' },

  // PD-43: adding a teacher
  addTeacher: { en: 'Add teacher', ar: 'إضافة معلم' },
  signInEmail: { en: 'Sign-in e-mail', ar: 'بريد الدخول' },
  signInHint: {
    en: 'The teacher signs in with this address, and the first sign-in code is e-mailed to it.',
    ar: 'يدخل المعلم بهذا العنوان، ويُرسل إليه رمز الدخول الأول.',
  },
  phoneOptional: { en: 'Phone (optional)', ar: 'الهاتف (اختياري)' },
  joinedOnOptional: { en: 'Joining date (optional)', ar: 'تاريخ الانضمام (اختياري)' },
  me: { en: 'Me', ar: 'أنا' },
  noSupervisorYet: { en: 'No supervisor yet', ar: 'بدون مشرف حاليًا' },
  unsupervisedNote: {
    en: 'Until a supervisor is set, the Teachers Manager is responsible for this teacher.',
    ar: 'إلى أن يُعيَّن مشرف، يتولى مدير قسم المعلمين مسؤولية هذا المعلم.',
  },
  selfNoneNote: {
    en: 'The Teachers Manager will cover this teacher until a supervisor is set. With strict scope on, you will no longer see this teacher once added.',
    ar: 'سيتولى مدير قسم المعلمين هذا المعلم إلى أن يُعيَّن مشرف. وعند تفعيل النطاق الصارم لن ترى هذا المعلم بعد إضافته.',
  },
  add: { en: 'Add', ar: 'إضافة' },
  adding: { en: 'Adding…', ar: 'جارٍ الإضافة…' },
  firstLoginTitle: { en: 'First sign-in code', ar: 'رمز الدخول الأول' },
  firstLoginHint: {
    en: 'Give this code to the teacher. It works once, for 72 hours, and is not shown again.',
    ar: 'سلّم هذا الرمز للمعلم. يعمل مرة واحدة لمدة 72 ساعة، ولن يُعرض مرة أخرى.',
  },
  signInLabel: { en: 'Sign-in', ar: 'اسم الدخول' },
  codeLabel: { en: 'Code', ar: 'الرمز' },
  validUntil: { en: 'Valid until {when}', ar: 'صالح حتى {when}' },
  emailedTo: { en: 'It was also e-mailed to the sign-in address.', ar: 'وأُرسل أيضًا إلى بريد الدخول.' },
  notEmailed: { en: 'It was not e-mailed: hand it to the teacher yourself.', ar: 'لم يُرسل بالبريد: سلّمه للمعلم بنفسك.' },
  done: { en: 'Done', ar: 'تم' },
  alreadyTeacher: { en: 'This person is already a teacher here.', ar: 'هذا الشخص معلم هنا بالفعل.' },
  notSignedInYet: { en: 'Not signed in yet', ar: 'لم يسجّل الدخول بعد' },
  signInSuspended: { en: 'Sign-in suspended', ar: 'الدخول موقوف' },
  noSignIn: { en: 'No sign-in', ar: 'بلا حساب دخول' },
  sendNewCode: { en: 'Send a new first sign-in code', ar: 'إرسال رمز دخول أول جديد' },
  giveSignIn: { en: 'Give sign-in', ar: 'منح حساب دخول' },
  giveSignInHint: {
    en: 'This teacher has no sign-in yet. Their students and history stay as they are.',
    ar: 'ليس لهذا المعلم حساب دخول بعد. يبقى طلابه وسجله كما هم.',
  },
  sending: { en: 'Sending…', ar: 'جارٍ الإرسال…' },
  codeEmailed: { en: 'A new code was e-mailed to the teacher.', ar: 'أُرسل رمز جديد إلى بريد المعلم.' },
  codeNotEmailedAskManager: {
    en: 'The code could not be e-mailed. Ask the Teachers Manager to send it.',
    ar: 'تعذّر إرسال الرمز بالبريد. اطلب من مدير قسم المعلمين إرساله.',
  },

  // PD-43 PR-1b: offboarding, reactivation and the set-up checklist
  offboard: { en: 'Offboard', ar: 'إنهاء العمل' },
  offboardTitle: { en: 'Offboard {name}', ar: 'إنهاء عمل {name}' },
  offboardHint: {
    en: 'The teacher and their sign-in are closed and every session ends. Nothing is deleted: the file and its history stay.',
    ar: 'يُغلق ملف المعلم وحساب دخوله وتنتهي كل جلساته. لا يُحذف شيء: يبقى الملف وسجله.',
  },
  offboarding: { en: 'Offboarding…', ar: 'جارٍ إنهاء العمل…' },
  loadingPreview: { en: 'Checking students and lessons…', ar: 'جارٍ التحقق من الطلاب والحصص…' },
  moveStudentsFirst: { en: 'Move these students to other teachers first.', ar: 'انقل هؤلاء الطلاب إلى معلمين آخرين أولًا.' },
  studentsStillAssigned: { en: 'Students still assigned', ar: 'طلاب ما زالوا مسندين' },
  lessonsAhead: { en: 'Lessons ahead', ar: 'الحصص القادمة' },
  nothingAhead: { en: 'No students and no lessons ahead.', ar: 'لا طلاب ولا حصص قادمة.' },
  lessonTrial: { en: 'Trial', ar: 'حصة تجريبية' },
  lessonMakeup: { en: 'Make-up', ar: 'حصة تعويضية' },
  lessonRegular: { en: 'Lesson', ar: 'حصة' },
  confirmCancelOne: { en: 'Cancel this lesson. The family is told in its chat.', ar: 'ألغِ هذه الحصة. تُبلَّغ الأسرة في محادثتها.' },
  confirmCancelMany: { en: 'Cancel these {n} lessons. Each family is told in its chat.', ar: 'ألغِ هذه الحصص ({n}). تُبلَّغ كل أسرة في محادثتها.' },
  reasonShort: { en: 'Reason', ar: 'السبب' },
  notCancelled: {
    en: 'Some lessons could not be cancelled, so the teacher was not offboarded.',
    ar: 'تعذّر إلغاء بعض الحصص، فلم يُنهَ عمل المعلم.',
  },
  hasOpenLessons: { en: 'This teacher has lessons ahead. Confirm their cancellation.', ar: 'لهذا المعلم حصص قادمة. أكّد إلغاءها.' },
  hasStudents: { en: 'Move this teacher’s students to other teachers first.', ar: 'انقل طلاب هذا المعلم إلى معلمين آخرين أولًا.' },
  alreadyLeft: { en: 'This teacher has already left.', ar: 'غادر هذا المعلم بالفعل.' },
  reactivate: { en: 'Reactivate', ar: 'إعادة التفعيل' },
  reactivateTitle: { en: 'Reactivate {name}', ar: 'إعادة تفعيل {name}' },
  reactivateHint: {
    en: 'The same teacher comes back, with no supervisor. A new first sign-in code is e-mailed and shown to you once; the old password does not come back.',
    ar: 'يعود المعلم نفسه بلا مشرف. يُرسل رمز دخول أول جديد بالبريد ويظهر لك مرة واحدة، ولا تعود كلمة المرور القديمة.',
  },
  reactivating: { en: 'Reactivating…', ar: 'جارٍ إعادة التفعيل…' },
  alreadyActive: { en: 'This teacher is already active.', ar: 'هذا المعلم نشط بالفعل.' },
  reactivatedNoSignIn: {
    en: 'Reactivated. This teacher has no sign-in yet: use Give sign-in.',
    ar: 'أُعيد التفعيل. ليس لهذا المعلم حساب دخول بعد: استخدم «منح حساب دخول».',
  },
  setupTitle: { en: 'Set-up checklist', ar: 'قائمة التجهيز' },
  stepsLeft: { en: '{n} steps left', ar: 'متبقٍ {n} خطوات' },
  oneStepLeft: { en: 'One step left', ar: 'متبقٍ خطوة واحدة' },
  stepNotDone: { en: 'Not done', ar: 'لم يكتمل' },
  stepSignedIn: { en: 'Signed in', ar: 'سجّل الدخول' },
  stepSupervisor: { en: 'Supervisor', ar: 'المشرف' },
  stepContact: { en: 'Contact details', ar: 'بيانات التواصل' },
  stepPayTerms: { en: 'Pay terms', ar: 'شروط الأجر' },
  stepPayoutAccount: { en: 'Payout account', ar: 'حساب الصرف' },
  stepLeaveAllowance: { en: 'Leave allowance for this year', ar: 'رصيد الإجازات لهذا العام' },
  stepShift: { en: 'Shift category', ar: 'فئة الدوام' },
  stepAvailability: { en: 'Availability', ar: 'أوقات الإتاحة' },
  stepProfile: { en: 'Profile', ar: 'الملف التعريفي' },
  payMismatch: {
    en: 'The pay type does not match the shift category (hourly pay goes with an hourly category).',
    ar: 'نوع الأجر لا يطابق فئة الدوام (الأجر بالساعة يطابق فئة الساعة).',
  },
  setupIncomplete: { en: 'Setup incomplete', ar: 'التجهيز غير مكتمل' },
  setupIncompleteOnly: { en: 'Setup incomplete only', ar: 'غير المكتمل فقط' },
} satisfies Record<string, Pair>

const BY_CODE: Record<string, Pair> = {
  'COMM.LESSON_DENIED': {
    en: 'Notes and bonuses are recorded by the Teachers department and the super admin.',
    ar: 'تسجّل الملاحظات والمكافآت من قسم المعلمين والمدير العام فقط.',
  },
  'COMM.SUPERVISION_NOT_FOUND': {
    en: 'This teacher is no longer active, so they have no supervision chat to receive a bonus in.',
    ar: 'هذا المعلم لم يعد نشطًا، فلا توجد له محادثة إشراف لاستلام المكافأة.',
  },
  'COMM.TEACHER_FILE_DENIED': {
    en: 'Teacher Files are for the Teachers department and the super admin.',
    ar: 'ملفات المعلمين لقسم المعلمين والمدير العام فقط.',
  },
  'COMM.TEACHER_FILE_NOT_FOUND': { en: 'This teacher was not found.', ar: 'لم يُعثر على هذا المعلم.' },
  'COMM.TEACHER_ONBOARDING_DENIED': {
    en: 'Teachers are added by the Teachers department and the super admin; a supervisor names only themselves.',
    ar: 'يضيف المعلمين قسمُ المعلمين والمدير العام، ولا يسمّي المشرف إلا نفسه.',
  },
  'COMM.TEACHER_EMAIL_UNAVAILABLE': {
    en: 'These details can’t be used for a new teacher. Use another e-mail or phone, or ask the Teachers Manager.',
    ar: 'لا يمكن استخدام هذه البيانات لمعلم جديد. استخدم بريدًا أو هاتفًا آخر، أو اسأل مدير قسم المعلمين.',
  },
  'COMM.TEACHER_ALREADY_SIGNED_IN': {
    en: 'This teacher has already signed in. Reset their password instead.',
    ar: 'سجّل هذا المعلم الدخول من قبل. أعد تعيين كلمة مروره بدلًا من ذلك.',
  },
  'COMM.TEACHER_HAS_SIGN_IN': {
    en: 'This teacher already has a sign-in. Send a new first sign-in code, or reset their password.',
    ar: 'لهذا المعلم حساب دخول بالفعل. أرسل رمز دخول أول جديدًا أو أعد تعيين كلمة المرور.',
  },
  'COMM.TEACHER_SIGN_IN_SUSPENDED': {
    en: 'This teacher’s sign-in is suspended. Reactivate it first.',
    ar: 'دخول هذا المعلم موقوف. أعد تفعيله أولًا.',
  },
  'COMM.TEACHER_ONBOARDING_BUSY': { en: 'The system was busy and nothing was saved. Try again.', ar: 'كان النظام مشغولًا ولم يُحفظ شيء. حاول مرة أخرى.' },
  'COMM.TEACHER_ALREADY_ADDED': { en: 'This person is already a teacher here.', ar: 'هذا الشخص معلم هنا بالفعل.' },
  'COMM.TEACHER_CONTACT_TAKEN': {
    en: 'This phone or e-mail is already on a teacher’s file.',
    ar: 'هذا الهاتف أو البريد مسجّل في ملف معلم آخر.',
  },
  'COMM.TEACHER_FILE_CONFLICT': {
    en: 'Already recorded: this entry has a resolution or cancellation, or that day off exists.',
    ar: 'مسجّل مسبقًا: لهذا البند معالجة أو إلغاء، أو يوم الإجازة موجود.',
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
