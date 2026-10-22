import type { Pair } from '@/features/organization/copy'

export { useCopy, type Pair } from '@/features/organization/copy'

/**
 * PD-24 Teacher Supervision copy, Arabic and English side by side. Wording
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

  teacher: { en: 'Teacher', ar: 'المعلم' },
  month: { en: 'Month', ar: 'الشهر' },
  empty: { en: 'Nothing here.', ar: 'لا شيء هنا.' },
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
  balanceOf: { en: '{left} of {allowance} days left', ar: 'متبقٍ {left} من {allowance} يومًا' },
  notTracked: { en: 'Not tracked ({used} days taken)', ar: 'غير محدد ({used} يومًا مأخوذة)' },
  status: { en: 'Status', ar: 'الحالة' },
  available: { en: 'Available', ar: 'متاح' },
  pending: { en: '{n} waiting', ar: '{n} بانتظار القرار' },
  requests: { en: 'Requests', ar: 'الطلبات' },
  leaveHint: {
    en: 'A teacher on leave is shown as such to families in their chat, and is not given new students, transfers or trials until they are back. Messages still reach them.',
    ar: 'يظهر المعلم في إجازة لأولياء الأمور في المحادثة، ولا يُسند إليه طلاب جدد أو نقل أو حصص تجريبية حتى يعود. وتظل الرسائل تصله.',
  },
  leaveRequests: { en: 'Leave requests', ar: 'طلبات الإجازة' },

  // Absences
  absencesHint: {
    en: 'An apology the teacher sends in the chat, or a lesson closed as their absence, is recorded here by itself. Record an absence yourself only when there is no lesson to close.',
    ar: 'اعتذار المعلم في المحادثة، أو حصة أُغلقت كغياب له، يُسجَّل هنا تلقائيًا. سجّل الغياب بنفسك فقط عندما لا توجد حصة لإغلاقها.',
  },
  recordAbsence: { en: 'Record an absence', ar: 'تسجيل غياب' },

  // Lateness
  latenessHint: {
    en: 'How late the teacher was, and the action taken. Each one takes its step on the teacher’s monthly ladder.',
    ar: 'مقدار تأخر المعلم والإجراء المتخذ. كل حالة تأخذ خطوتها في سُلّم المعلم الشهري.',
  },
  recordLateness: { en: 'Record lateness', ar: 'تسجيل تأخير' },
  delay: { en: 'Delay', ar: 'مدة التأخير' },
  minutes: { en: '{n} min', ar: '{n} دقيقة' },

  // Rewards
  rewardsHint: {
    en: 'Each reward is told to the teacher in their supervision chat and appears on their file. Its amount is added to that month’s pay.',
    ar: 'تُبلَّغ كل مكافأة للمعلم في محادثة الإشراف وتظهر في ملفه. ويُضاف مبلغها إلى راتب ذلك الشهر.',
  },
  recordReward: { en: 'Record a reward', ar: 'تسجيل مكافأة' },
  reason: { en: 'Reason', ar: 'السبب' },
  amount: { en: 'Amount', ar: 'المبلغ' },
  amountOptional: { en: 'Amount (in the teacher’s pay currency)', ar: 'المبلغ (بعملة راتب المعلم)' },
  amountHint: {
    en: 'Leave it empty to price it later from the teacher’s Payroll.',
    ar: 'اتركه فارغًا لتحديده لاحقًا من قسم الرواتب في ملف المعلم.',
  },
  amountInvalid: { en: 'An amount with at most two decimals.', ar: 'مبلغ بحد أقصى منزلتين عشريتين.' },
  awaitingAmount: { en: 'Amount not set yet', ar: 'لم يُحدَّد المبلغ بعد' },
  date: { en: 'Date', ar: 'التاريخ' },
  recordedBy: { en: 'Recorded by', ar: 'سجّلها' },
  rewardSavedNoAmount: {
    en: 'The reward is recorded, but its amount was not saved: {why} Set it from the teacher’s Payroll.',
    ar: 'سُجّلت المكافأة، لكن لم يُحفظ مبلغها: {why} حدده من قسم الرواتب في ملف المعلم.',
  },

  // Deduction defaults
  defaultsTitle: { en: 'Default deduction amounts', ar: 'مبالغ الخصم الافتراضية' },
  defaultsHint: {
    en: 'Deciding a first or second deduction deducts this amount from that month’s pay at once, in the teacher’s pay currency. Change one case from the teacher’s Payroll. 0 stops it.',
    ar: 'عند تقرير الخصم الأول أو الثاني يُخصم هذا المبلغ من راتب ذلك الشهر فورًا، بعملة راتب المعلم. عدّل حالة واحدة من قسم الرواتب في ملف المعلم. القيمة 0 توقفه.',
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
    en: 'Complaints from management and from parents. Uphold one to put it on the teacher’s monthly ladder and decide the action; follow-ups and the resolution stay with it.',
    ar: 'شكاوى الإدارة وأولياء الأمور. أثبت الشكوى لتُضاف إلى سُلّم المعلم الشهري ويُتخذ الإجراء؛ وتبقى المتابعات والمعالجة معها.',
  },
  fromManagement: { en: 'From management', ar: 'من الإدارة' },
  fromParents: { en: 'From parents', ar: 'من أولياء الأمور' },
  all: { en: 'All', ar: 'الكل' },
  recordComplaint: { en: 'Record a complaint', ar: 'تسجيل شكوى' },
} satisfies Record<string, Pair>
