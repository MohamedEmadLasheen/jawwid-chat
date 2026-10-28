import type { Pair } from '@/features/organization/copy'

/**
 * PD-42 PR-3 copy, Arabic and English side by side: the families entered by
 * hand on New Students, their Operations supervisor and Sales owner, the
 * sign-in e-mail, and the package carried over from Jawwid Core.
 */
export const OP = {
  enteredTitle: { en: 'Families entered by hand', ar: 'الأسر المُدخلة يدويًا' },
  enteredHint: {
    en: 'Families entered from Jawwid Core by their supervisors, without a trial.',
    ar: 'أسر أدخلها مشرفوها من جوِّد كور، دون حصة تجريبية.',
  },
  filterLabel: { en: 'Show', ar: 'عرض' },
  all: { en: 'All', ar: 'الكل' },
  needs: { en: 'Needs an Operations supervisor', ar: 'بحاجة إلى مشرف عمليات' },
  waiting: { en: 'Waiting for sign-up', ar: 'بانتظار التسجيل' },
  signedUp: { en: 'Signed up', ar: 'أنشأ حسابه' },
  recent: { en: 'Recently entered', ar: 'أُدخلت مؤخرًا' },
  noneHere: { en: 'No family matches this filter.', ar: 'لا توجد أسرة تطابق هذا الفلتر.' },
  enteredBy: { en: 'Entered by', ar: 'أدخلها' },
  childAdded: { en: 'Child added', ar: 'أُضيف طفل' },
  children: { en: 'Children', ar: 'الأطفال' },
  supervisor: { en: 'Operations supervisor', ar: 'مشرف العمليات' },
  suggested: { en: 'Suggested:', ar: 'مقترح:' },
  salesOwner: { en: 'Sales owner', ar: 'مسؤول المبيعات' },
  none: { en: 'None', ar: 'لا يوجد' },
  signIn: { en: 'Sign-in', ar: 'تسجيل الدخول' },
  noEmail: { en: 'No sign-in e-mail', ar: 'لا يوجد بريد لتسجيل الدخول' },
  notStarted: { en: 'Not signed up yet', ar: 'لم يُنشئ حسابه بعد' },
  codeWaiting: { en: 'The parent asked for a code. Send it on WhatsApp:', ar: 'طلب ولي الأمر رمزًا. أرسله عبر واتساب:' },
  openParent: { en: 'Open the parent', ar: 'فتح ملف ولي الأمر' },
  choose: { en: 'Choose the supervisor', ar: 'اختيار المشرف' },
  chooseTitle: { en: 'Choose the Operations supervisor', ar: 'اختيار مشرف العمليات' },
  chooseHint: {
    en: "The family's children are placed on this supervisor, and the family moves to them. Changing it later is a transfer.",
    ar: 'يُعيَّن أطفال الأسرة لهذا المشرف، وتنتقل الأسرة إليه. تغييره لاحقًا يكون بالنقل.',
  },
  suggest: { en: 'Suggest a supervisor', ar: 'اقتراح مشرف' },
  suggestTitle: { en: 'Suggest a supervisor', ar: 'اقتراح مشرف' },
  suggestHint: {
    en: 'The Operations manager sees your suggestion and decides.',
    ar: 'يرى مدير العمليات اقتراحك ويقرر.',
  },
  suggestSave: { en: 'Suggest', ar: 'اقتراح' },
  pick: { en: 'Choose…', ar: 'اختر…' },
  required: { en: 'Required', ar: 'مطلوب' },
  save: { en: 'Save', ar: 'حفظ' },
  saving: { en: 'Saving…', ar: 'جارٍ الحفظ…' },
  placedJoined: { en: 'Placed. The children joined the family group.', ar: 'تم التعيين. انضم الأطفال إلى مجموعة الأسرة.' },
  placed: { en: 'Placed.', ar: 'تم التعيين.' },
  suggestedDone: { en: 'Suggestion sent.', ar: 'أُرسل الاقتراح.' },
  // Parent Profile
  ownershipTitle: { en: 'Ownership and sign-in', ar: 'المسؤولية وتسجيل الدخول' },
  setEmail: { en: 'Set sign-in e-mail', ar: 'تعيين بريد تسجيل الدخول' },
  setEmailHint: {
    en: 'The parent creates their account in the app with this e-mail.',
    ar: 'ينشئ ولي الأمر حسابه في التطبيق بهذا البريد.',
  },
  email: { en: 'E-mail', ar: 'البريد الإلكتروني' },
  hasEmail: { en: 'Has a sign-in e-mail', ar: 'لديه بريد لتسجيل الدخول' },
  emailSaved: { en: 'Sign-in e-mail saved.', ar: 'حُفظ بريد تسجيل الدخول.' },
  changeOwner: { en: 'Change the Sales owner', ar: 'تغيير مسؤول المبيعات' },
  reason: { en: 'Reason (required)', ar: 'السبب (مطلوب)' },
  ownerChanged: { en: 'Sales owner changed.', ar: 'تغيّر مسؤول المبيعات.' },
  // Trial sibling
  parentExists: { en: 'This parent is already in Chat.', ar: 'ولي الأمر هذا موجود بالفعل في الدردشة.' },
  parentExistsHint: {
    en: "The children are added to their family, with the family's supervisor. Nothing new is created for the parent.",
    ar: 'يُضاف الأطفال إلى أسرته مع مشرفها، ولا يُنشأ لولي الأمر شيء جديد.',
  },
  addToFamily: { en: "Add to {name}'s family", ar: 'إضافة إلى أسرة {name}' },
  attachedJoined: { en: "The children were added to {name}'s family and joined its group.", ar: 'أُضيف الأطفال إلى أسرة {name} وانضموا إلى مجموعتها.' },
  attached: { en: "The children were added to {name}'s family.", ar: 'أُضيف الأطفال إلى أسرة {name}.' },
  // Student Profile
  packageTitle: { en: 'Current package', ar: 'الباقة الحالية' },
  packageHint: {
    en: 'Carried over from Jawwid Core as it was entered. Lessons in Chat count against it.',
    ar: 'مُرحَّلة من جوِّد كور كما أُدخلت. تُحتسب الحصص في الدردشة منها.',
  },
  total: { en: 'Total lessons', ar: 'إجمالي الحصص' },
  completed: { en: 'Completed lessons', ar: 'الحصص المكتملة' },
  remaining: { en: 'Remaining', ar: 'المتبقي' },
  plan: { en: 'Plan', ar: 'المدة' },
  months: { en: '{n} months', ar: '{n} أشهر' },
  planMonths: { en: 'Plan length (months)', ar: 'مدة الباقة (بالأشهر)' },
  active: { en: 'Active', ar: 'نشطة' },
  usedUp: { en: 'Used up', ar: 'مستنفدة' },
  enteredByOn: { en: 'Entered by {name} · {date}', ar: 'أدخلها {name} · {date}' },
  noPackage: { en: 'No package entered', ar: 'لم تُدخل باقة' },
  enterPackage: { en: 'Enter the package', ar: 'إدخال الباقة' },
  correct: { en: 'Correct', ar: 'تصحيح' },
  correctTitle: { en: 'Correct the package', ar: 'تصحيح الباقة' },
  correctHint: {
    en: 'The package is removed, with your reason; then enter it again with the right numbers.',
    ar: 'تُزال الباقة مع ذكر السبب، ثم أدخلها مجددًا بالأرقام الصحيحة.',
  },
  remove: { en: 'Remove the package', ar: 'إزالة الباقة' },
  overManagers: {
    en: 'More completed than the package: only the Operations Manager, the Sales Manager or the super admin can enter this.',
    ar: 'المكتمل أكثر من الباقة: لا يُدخله إلا مدير العمليات أو مدير المبيعات أو المدير العام.',
  },
} satisfies Record<string, Pair>
