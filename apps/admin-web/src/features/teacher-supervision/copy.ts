import { ApiError } from '@/core/api/errors'
import type { Pair } from '@/features/organization/copy'
import { describeError as describeTeacherFileError } from '@/features/teacher-files/copy'

export { useCopy, type Pair } from '@/features/organization/copy'

/**
 * PD-26 Teacher Supervision copy, Arabic and English side by side. Wording
 * rule: say what the server will do; an amount is named only where the super
 * admin sees it.
 */
export const H = {
  title: { en: 'Teacher supervision', ar: 'الإشراف على المعلمين' },
  subtitle: {
    en: 'Leave, absences, lateness, rewards and complaints in one place. Every record is on the teacher’s file, and every deduction and reward reaches payroll.',
    ar: 'الإجازات والغياب والتأخير والمكافآت والشكاوى في مكان واحد. كل سجل يظهر في ملف المعلم، وكل خصم ومكافأة تصل إلى الرواتب.',
  },
  sections: { en: 'Sections', ar: 'الأقسام' },
  leave: { en: 'Leave', ar: 'الإجازات' },
  absences: { en: 'Apologies & absences', ar: 'الاعتذارات والغياب' },
  lateness: { en: 'Lateness', ar: 'التأخير' },
  rewards: { en: 'Grants & rewards', ar: 'المنح والمكافآت' },
  complaints: { en: 'Complaints', ar: 'الشكاوى' },
  feedback: { en: 'Parent feedback', ar: 'آراء أولياء الأمور' },

  teacher: { en: 'Teacher', ar: 'المعلم' },
  month: { en: 'Month', ar: 'الشهر' },
  empty: { en: 'Nothing here.', ar: 'لا شيء هنا.' },
  emptyLeave: { en: 'No teachers to show.', ar: 'لا معلمين للعرض.' },
  emptyLeaveHint: { en: 'Each teacher appears here with their leave balance.', ar: 'يظهر كل معلم هنا مع رصيد إجازاته.' },
  emptyOpen: { en: 'Nothing is waiting for a decision.', ar: 'لا شيء بانتظار قرار.' },
  emptyOpenHint: { en: 'A new record appears here by itself.', ar: 'يظهر كل سجل جديد هنا تلقائيًا.' },
  emptyMonth: { en: 'Nothing was recorded in this month.', ar: 'لم يُسجَّل شيء في هذا الشهر.' },
  emptyMonthHint: { en: 'Choose another month, or go back to what needs a decision.', ar: 'اختر شهرًا آخر، أو عد إلى ما يحتاج قرارًا.' },
  emptyRewards: { en: 'No rewards yet.', ar: 'لا مكافآت بعد.' },
  emptyRewardsHint: { en: 'Record one and the teacher is told in the supervision chat.', ar: 'سجّل واحدة فيُبلَّغ المعلم في محادثة الإشراف.' },
  emptyComplaints: { en: 'No complaints.', ar: 'لا شكاوى.' },
  emptyComplaintsHint: { en: 'A parent’s complaint from the app appears here by itself.', ar: 'تظهر شكوى ولي الأمر من التطبيق هنا تلقائيًا.' },
  addCurrencyAction: { en: 'Add', ar: 'إضافة' },
  addCurrencyHint: { en: 'A three-letter code. Its row is added to the list above.', ar: 'رمز من ثلاثة أحرف. يُضاف صفّه إلى القائمة أعلاه.' },
  needsDecision: { en: 'Needs decision', ar: 'بحاجة إلى قرار' },
  thisMonth: { en: 'Month', ar: 'الشهر' },
  what: { en: 'What happened', ar: 'ما حدث' },
  step: { en: 'Step this month', ar: 'خطوة هذا الشهر' },
  action: { en: 'Action taken', ar: 'الإجراء المتخذ' },
  lessonType: { en: 'Lesson', ar: 'الحصة' },
  trial: { en: 'Trial', ar: 'تجريبية' },
  regular: { en: 'Regular', ar: 'عادية' },
  trialLessons: { en: 'Trial lessons', ar: 'الحصص التجريبية' },
  regularLessons: { en: 'Regular lessons', ar: 'الحصص العادية' },

  // Leave
  balance: { en: 'Leave balance', ar: 'رصيد الإجازات' },
  // {days} is a counted noun (core/i18n/counts): "21 days", "5 أيام", "21 يومًا".
  balanceOf: { en: '{left} of {days} left', ar: 'متبقٍ {left} من {days}' },
  notTracked: { en: 'Not tracked ({days} taken)', ar: 'غير محدد (المأخوذ: {days})' },
  notTrackedNone: { en: 'Not tracked (0 days taken)', ar: 'غير محدد (لم تُؤخذ إجازة)' },
  status: { en: 'Status', ar: 'الحالة' },
  available: { en: 'Available', ar: 'متاح' },
  pending: { en: '{n} waiting', ar: '{n} بانتظار القرار' },
  requests: { en: 'Requests', ar: 'الطلبات' },
  leaveHint: {
    en: 'On leave: families see it in chat, and no new students, transfers or trials are given; messages still arrive.',
    ar: 'في الإجازة: يراها أولياء الأمور في المحادثة، ولا يُسند طلاب جدد أو نقل أو تجريبية، وتظل الرسائل تصل.',
  },
  leaveRequests: { en: 'Leave requests', ar: 'طلبات الإجازة' },

  // Absences
  absencesHint: {
    en: 'An apology in chat or a lesson closed as absent is recorded by itself; record one only when there is no lesson to close.',
    ar: 'اعتذار المعلم في المحادثة أو حصة أُغلقت كغياب يُسجَّل تلقائيًا؛ سجّل الغياب بنفسك فقط إن لم توجد حصة لإغلاقها.',
  },
  recordAbsence: { en: 'Record an absence', ar: 'تسجيل غياب' },
  // PD-52: PD-50's reason, staff only.
  excuseCategory: { en: 'Reason', ar: 'السبب' },

  // Lateness
  latenessHint: {
    en: 'Each lateness takes its step on the teacher’s monthly ladder.',
    ar: 'كل تأخير يأخذ خطوته في سُلّم المعلم الشهري.',
  },
  recordLateness: { en: 'Record lateness', ar: 'تسجيل تأخير' },
  delay: { en: 'Delay', ar: 'مدة التأخير' },
  minutes: { en: '{n} min', ar: '{n} دقيقة' },

  // Rewards
  rewardsHint: {
    en: 'Told to the teacher in the supervision chat, shown on their file, and added to that month’s pay.',
    ar: 'تُبلَّغ للمعلم في محادثة الإشراف، وتظهر في ملفه، ويُضاف مبلغها إلى راتب ذلك الشهر.',
  },
  recordReward: { en: 'Record a reward', ar: 'تسجيل مكافأة' },
  reason: { en: 'Reason', ar: 'السبب' },
  amount: { en: 'Amount', ar: 'المبلغ' },
  amountOptional: { en: 'Amount (in the teacher’s pay currency)', ar: 'المبلغ (بعملة راتب المعلم)' },
  amountHint: {
    en: 'Leave it empty to price it later from the teacher’s Payroll.',
    ar: 'اتركه فارغًا لتحديده لاحقًا من قسم الرواتب في ملف المعلم.',
  },
  rewardNoTerms: {
    en: 'This teacher has no pay terms for this month, so the reward was not recorded. Set the pay terms in the teacher’s Payroll, then record it again.',
    ar: 'لا توجد شروط راتب لهذا المعلم في هذا الشهر، لذلك لم تُسجَّل المكافأة. حدّد شروط الراتب من قسم الرواتب في ملف المعلم ثم سجّلها مجددًا.',
  },
  amountInvalid: { en: 'An amount with at most two decimals.', ar: 'مبلغ بحد أقصى منزلتين عشريتين.' },
  awaitingAmount: { en: 'Amount not set yet', ar: 'لم يُحدَّد المبلغ بعد' },
  date: { en: 'Date', ar: 'التاريخ' },
  recordedBy: { en: 'Recorded by', ar: 'سجّلها' },

  // Deduction defaults
  defaultsTitle: { en: 'Default deduction amounts', ar: 'مبالغ الخصم الافتراضية' },
  defaultsHint: {
    en: 'Taken from that month’s pay as soon as a first or second deduction is decided. 0 stops it; one case is changed from the teacher’s Payroll.',
    ar: 'يُخصم من راتب الشهر فور تقرير الخصم الأول أو الثاني. القيمة 0 توقفه، وتُعدَّل حالة واحدة من الرواتب في ملف المعلم.',
  },
  currency: { en: 'Currency', ar: 'العملة' },
  first: { en: 'First deduction', ar: 'الخصم الأول' },
  second: { en: 'Second deduction', ar: 'الخصم الثاني' },
  notSet: { en: 'Not set', ar: 'غير محدد' },
  set: { en: 'Set', ar: 'تعيين' },
  addCurrency: { en: 'Another currency (e.g. USD)', ar: 'عملة أخرى (مثل USD)' },
  noCurrencies: {
    en: 'No teacher has pay terms yet. Add a currency to set its defaults.',
    ar: 'لا يوجد معلم بشروط راتب بعد. أضف عملة لتعيين مبالغها.',
  },

  // Complaints
  complaintsHint: {
    en: 'Uphold a complaint to put it on the teacher’s monthly ladder and decide the action; follow-ups stay with it.',
    ar: 'أثبت الشكوى لتُضاف إلى سُلّم المعلم الشهري ويُتخذ الإجراء؛ وتبقى المتابعات معها.'
  },
  fromManagement: { en: 'From management', ar: 'من الإدارة' },
  fromParents: { en: 'From parents', ar: 'من أولياء الأمور' },
  fromParentApp: { en: 'Parent app', ar: 'تطبيق ولي الأمر' },
  all: { en: 'All', ar: 'الكل' },
  recordComplaint: { en: 'Record a complaint', ar: 'تسجيل شكوى' },
} satisfies Record<string, Pair>

/**
 * PD-32 parent feedback copy. Wording rule: the reply is the ONE text the
 * parent reads; every label that could be mistaken for something the parent
 * sees says so, and a complaint is never "resolved" from here.
 */
export const F = {
  hint: {
    en: 'What parents send from the app about their child’s teacher: praise, suggestions and complaints. Take one so the parent sees it is in review, then reply. A complaint is also listed under Complaints, and is resolved there.',
    ar: 'ما يرسله أولياء الأمور من التطبيق عن معلم طفلهم: شكر وثناء واقتراحات وشكاوى. تولَّ المتابعة ليرى ولي الأمر أنها قيد المراجعة، ثم اكتب الرد. وتظهر الشكوى أيضًا في قسم الشكاوى، وتُعالَج من هناك.',
  },
  category: { en: 'Type', ar: 'النوع' },
  allCategories: { en: 'All types', ar: 'كل الأنواع' },
  praise: { en: 'Praise', ar: 'شكر وثناء' },
  suggestion: { en: 'Suggestion', ar: 'اقتراح' },
  complaint: { en: 'Complaint', ar: 'شكوى' },
  status: { en: 'Status', ar: 'الحالة' },
  allStatuses: { en: 'Any status', ar: 'كل الحالات' },
  received: { en: 'Received', ar: 'مستلمة' },
  in_review: { en: 'In review', ar: 'قيد المراجعة' },
  resolved: { en: 'Resolved', ar: 'تمت المعالجة' },
  empty: { en: 'No feedback here.', ar: 'لا توجد آراء هنا.' },

  child: { en: 'Student: {name}', ar: 'الطالب: {name}' },
  parent: { en: 'Parent: {name}', ar: 'ولي الأمر: {name}' },
  teacher: { en: 'Teacher: {name}', ar: 'المعلم: {name}' },
  sentOn: { en: 'Sent {date}', ar: 'أُرسلت {date}' },
  handledBy: { en: 'Handled by {name}', ar: 'يتابعها {name}' },
  notTaken: { en: 'No one has taken it yet', ar: 'لم يتولَّها أحد بعد' },
  theReply: { en: 'Reply the parent reads', ar: 'الرد الذي يقرؤه ولي الأمر' },
  repliedBy: { en: '{name}, {date}', ar: '{name}، {date}' },
  noReply: { en: 'No reply yet.', ar: 'لا يوجد رد بعد.' },

  // On a complaint (PD-26) that came from the app
  fromApp: { en: 'From the parent app · {parent} about {child}', ar: 'من تطبيق ولي الأمر · {parent} عن {child}' },
  fromAppPlain: { en: 'From the parent app', ar: 'من تطبيق ولي الأمر' },
  parentSees: { en: 'The parent sees:', ar: 'يرى ولي الأمر:' },

  // Actions
  take: { en: 'Take it', ar: 'تولَّ المتابعة' },
  reply: { en: 'Reply to parent', ar: 'الرد على ولي الأمر' },
  changeReply: { en: 'Change the reply', ar: 'تعديل الرد' },
  replyTitle: { en: 'Reply to {name}', ar: 'الرد على {name}' },
  replyLabel: { en: 'Your reply', ar: 'ردّك' },
  replyHint: {
    en: 'This is the only text the parent sees. Follow-ups and the resolution stay internal.',
    ar: 'هذا هو النص الوحيد الذي يراه ولي الأمر. أما المتابعات والمعالجة فتبقى داخلية.',
  },
  replaces: {
    en: 'Sending replaces the reply the parent sees now.',
    ar: 'الإرسال يستبدل الرد الذي يراه ولي الأمر الآن.',
  },
  markResolved: { en: 'Mark resolved', ar: 'تحديدها كمُعالَجة' },
  markResolvedHint: { en: 'The parent then sees it as resolved.', ar: 'وعندها يراها ولي الأمر مُعالَجة.' },
  complaintResolves: {
    en: 'A complaint is resolved on the Teacher File, by recording its resolution. The parent then sees it as resolved; the resolution itself stays internal.',
    ar: 'تُعالَج الشكوى من ملف المعلم بتسجيل معالجتها، وعندها يراها ولي الأمر مُعالَجة، وتبقى تفاصيل المعالجة داخلية.',
  },
  openTeacherFile: { en: 'Open the teacher’s file', ar: 'فتح ملف المعلم' },
  openComplaints: { en: 'Go to Complaints', ar: 'الانتقال إلى الشكاوى' },
  send: { en: 'Send reply', ar: 'إرسال الرد' },
  sending: { en: 'Sending…', ar: 'جارٍ الإرسال…' },
  required: { en: 'Write the reply first.', ar: 'اكتب الرد أولًا.' },

  // The Parent File (PD-17)
  familyTitle: { en: 'Feedback about teachers', ar: 'آراء حول المعلمين' },
  familyHint: {
    en: 'What this family sent from the app about their children’s teachers, and the reply they read. The Teachers department handles it.',
    ar: 'ما أرسلته هذه الأسرة من التطبيق عن معلمي أطفالها، والرد الذي قرأته. ويتابعها قسم المعلمين.',
  },
  familyEmpty: { en: 'This family has sent no feedback about a teacher.', ar: 'لم ترسل هذه الأسرة أي رأي عن معلم.' },
} satisfies Record<string, Pair>

const FEEDBACK_ERRORS: Record<string, Pair> = {
  'COMM.FEEDBACK_STATE': {
    en: 'A complaint is resolved on the Teacher File, by recording its resolution.',
    ar: 'تُعالَج الشكوى من ملف المعلم بتسجيل معالجتها.',
  },
  'COMM.FEEDBACK_NOT_FOUND': { en: 'This feedback was not found.', ar: 'لم يُعثر على هذا الرأي.' },
  'COMM.FEEDBACK_DENIED': {
    en: 'Parent feedback is read by the Teachers department, the super admin and the children’s supervisor.',
    ar: 'يطّلع على آراء أولياء الأمور قسم المعلمين والمدير العام ومشرف الأطفال فقط.',
  },
}

export function describeFeedbackError(error: unknown, locale: 'ar' | 'en'): string {
  const mapped = error instanceof ApiError ? FEEDBACK_ERRORS[error.code] : undefined
  if (mapped) return locale === 'ar' ? mapped.ar : mapped.en
  return describeTeacherFileError(error, locale)
}
