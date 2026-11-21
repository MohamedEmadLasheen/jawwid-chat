import { ApiError } from '@/core/api/errors'
import type { Tone } from '@/shared/components/Badge'
import type { Pair } from '../teachers/copy'
import type { HandOverBlocker, HandOverState, LostReason, Stage } from './api'

/** PD-59: the Sales pipeline's words, Arabic first and English beside it. */

export const P = {
  title: { en: 'Sales pipeline', ar: 'مسار المبيعات' },
  subtitle: {
    en: 'Every lead from the first call to the hand-over. Trial stages come from the trial itself.',
    ar: 'كل عميل محتمل من أول اتصال حتى التسليم. مراحل التجربة تأتي من الحصة التجريبية نفسها.',
  },
  newLead: { en: 'New lead', ar: 'عميل محتمل جديد' },
  search: { en: 'Search by name', ar: 'ابحث بالاسم' },
  filterLabel: { en: 'Stage', ar: 'المرحلة' },
  all: { en: 'All', ar: 'الكل' },
  followUpDue: { en: 'Follow-up due', ar: 'متابعة مستحقة' },
  followUpDueCount: { en: 'Follow-ups due', ar: 'متابعات مستحقة' },
  empty: { en: 'No leads yet. Add the first one.', ar: 'لا يوجد عملاء محتملون بعد. أضف أول عميل.' },
  noMatch: { en: 'No lead matches.', ar: 'لا يوجد عميل مطابق.' },
  truncated: { en: 'Showing the newest leads only.', ar: 'تظهر أحدث العملاء المحتملين فقط.' },
  lead: { en: 'Lead', ar: 'العميل المحتمل' },
  stage: { en: 'Stage', ar: 'المرحلة' },
  lastContacted: { en: 'Last contacted', ar: 'آخر تواصل' },
  nextFollowUp: { en: 'Next follow-up', ar: 'المتابعة القادمة' },
  channels: { en: 'Contact on file', ar: 'بيانات التواصل المسجلة' },
  never: { en: 'Never', ar: 'لم يحدث' },
  phone: { en: 'Phone', ar: 'الهاتف' },
  whatsapp: { en: 'WhatsApp', ar: 'واتساب' },
  email: { en: 'E-mail', ar: 'البريد الإلكتروني' },
  noChannel: { en: 'None', ar: 'لا يوجد' },
  open: { en: 'Open', ar: 'فتح' },
  previous: { en: 'Previous', ar: 'السابق' },
  next: { en: 'Next', ar: 'التالي' },
  handedOver: { en: 'Handed over', ar: 'تم التسليم' },
  // The create dialog and the drawer
  createTitle: { en: 'New lead', ar: 'عميل محتمل جديد' },
  childName: { en: 'Child or prospect name', ar: 'اسم الطفل أو العميل المحتمل' },
  level: { en: 'Level', ar: 'المستوى' },
  note: { en: 'Note', ar: 'ملاحظة' },
  parentSection: { en: 'Parent contact', ar: 'بيانات التواصل مع ولي الأمر' },
  parentHint: {
    en: 'Visible only to Sales and the super admin. Kept apart from the parent records until the lead is converted.',
    ar: 'تظهر للمبيعات والمدير العام فقط. تُحفظ منفصلة عن سجلات أولياء الأمور إلى أن يتم تحويل العميل.',
  },
  parentName: { en: 'Parent name', ar: 'اسم ولي الأمر' },
  phoneNumber: { en: 'Phone number', ar: 'رقم الهاتف' },
  whatsappNumber: { en: 'WhatsApp number', ar: 'رقم واتساب' },
  emailAddress: { en: 'E-mail address', ar: 'البريد الإلكتروني' },
  country: { en: 'Country of the number', ar: 'دولة الرقم' },
  countryHint: { en: 'Needed to read a local number when the lead is converted.', ar: 'مطلوبة لقراءة الرقم المحلي عند تحويل العميل.' },
  noCountry: { en: 'Not set', ar: 'غير محددة' },
  required: { en: 'required', ar: 'مطلوب' },
  needName: { en: 'Enter the name.', ar: 'أدخل الاسم.' },
  needParent: { en: 'Enter the parent name with at least one way to reach them.', ar: 'أدخل اسم ولي الأمر مع وسيلة تواصل واحدة على الأقل.' },
  followUpDate: { en: 'Follow up on', ar: 'المتابعة في' },
  followUpNote: { en: 'Follow-up note', ar: 'ملاحظة المتابعة' },
  create: { en: 'Create lead', ar: 'إنشاء العميل' },
  save: { en: 'Save', ar: 'حفظ' },
  saving: { en: 'Saving…', ar: 'جارٍ الحفظ…' },
  cancel: { en: 'Cancel', ar: 'إلغاء' },
  close: { en: 'Close', ar: 'إغلاق' },
  edit: { en: 'Edit', ar: 'تعديل' },
  contactSection: { en: 'Contact details', ar: 'بيانات التواصل' },
  contactLogged: { en: 'Opening these details is recorded in the audit log.', ar: 'فتح هذه البيانات يُسجَّل في سجل التدقيق.' },
  noContact: { en: 'No contact details are on file.', ar: 'لا توجد بيانات تواصل مسجلة.' },
  contactMoved: { en: 'The contact now lives in the family record.', ar: 'انتقلت بيانات التواصل إلى سجل العائلة.' },
  addContact: { en: 'Add contact details', ar: 'إضافة بيانات التواصل' },
  trial: { en: 'Trial', ar: 'الحصة التجريبية' },
  markContacted: { en: 'Mark contacted', ar: 'تسجيل تواصل' },
  contactedDone: { en: 'Contact recorded.', ar: 'تم تسجيل التواصل.' },
  markLost: { en: 'Mark lost', ar: 'تسجيل كخسارة' },
  lostReasonLabel: { en: 'Why was the lead lost?', ar: 'لماذا خسرنا العميل؟' },
  chooseReason: { en: 'Choose a reason', ar: 'اختر السبب' },
  reopen: { en: 'Reopen', ar: 'إعادة فتح' },
  convert: { en: 'Convert', ar: 'تحويل' },
  convertHint: {
    en: 'Hands the lead over to Operations through the family intake, without creating a second parent record.',
    ar: 'يسلّم العميل إلى التشغيل عبر إدخال العائلة، دون إنشاء سجل ثانٍ لولي الأمر.',
  },
  linked: { en: 'This parent is already in Chat: the lead is now linked to their family.', ar: 'ولي الأمر موجود بالفعل: تم ربط العميل بعائلته.' },
  awaitingEnrolment: {
    en: 'The trial subscribed. Convert again once Operations has enrolled the family: the contact is then linked to it.',
    ar: 'اشترك الطالب بعد التجربة. حوّل العميل مرة أخرى بعد أن يسجّل التشغيل الأسرة، فتُربط بيانات التواصل بها.',
  },
  searchHint: { en: 'Names only. Do not type phone numbers or e-mails here.', ar: 'بالاسم فقط. لا تكتب أرقام الهاتف أو البريد الإلكتروني هنا.' },
  owner: { en: 'Owner', ar: 'المسؤول' },
  unassigned: { en: 'Unassigned', ar: 'غير مُسند' },
  reassign: { en: 'Reassign to', ar: 'إعادة الإسناد إلى' },
  chooseOwner: { en: 'Choose a sales representative', ar: 'اختر مندوب مبيعات' },
  reassignDone: { en: 'The lead was reassigned.', ar: 'تمت إعادة إسناد العميل.' },
  ownerOptional: { en: 'Owner (you, unless you choose another)', ar: 'المسؤول (أنت، ما لم تختر غيرك)' },
  stageDerived: { en: 'A trial decides this stage.', ar: 'الحصة التجريبية هي التي تحدد هذه المرحلة.' },
  converted: { en: 'Converted', ar: 'تم التحويل' },
  loading: { en: 'Loading…', ar: 'جارٍ التحميل…' },
  today: { en: 'Today', ar: 'اليوم' },
} satisfies Record<string, Pair>

/** PD-59 O4: the manager's read-only "Needs hand-over" list. */
export const H = {
  tabPipeline: { en: 'Pipeline', ar: 'المسار' },
  tabNeeds: { en: 'Needs hand-over', ar: 'بحاجة إلى تسليم' },
  title: { en: 'Needs hand-over', ar: 'بحاجة إلى تسليم' },
  intro: {
    en: 'Leads whose trial subscribed but are not linked to a family record yet. This list only shows them: nothing here changes a lead or a family.',
    ar: 'عملاء اشترك طلابهم بعد التجربة ولم يُربطوا بسجل عائلة بعد. تعرض هذه القائمة الحالات فقط: لا يتغير هنا أي عميل أو عائلة.',
  },
  guidance: {
    en: 'For Operations: add the missing channel to the family\'s profile, then open the lead and press Convert again. The lead\'s own details are kept until then.',
    ar: 'للتشغيل: أضف وسيلة التواصل الناقصة إلى ملف العائلة، ثم افتح العميل واضغط تحويل مرة أخرى. تبقى بيانات العميل محفوظة إلى حينها.',
  },
  empty: { en: 'Nothing is waiting for a hand-over.', ar: 'لا يوجد شيء بانتظار التسليم.' },
  age: { en: 'Waiting', ar: 'مدة الانتظار' },
  status: { en: 'What is needed', ar: 'المطلوب' },
  contactCopy: { en: 'Contact copy', ar: 'نسخة بيانات التواصل' },
  enrolled: { en: 'Enrolled by Operations', ar: 'سجّله التشغيل' },
  yes: { en: 'Yes', ar: 'نعم' },
  no: { en: 'No', ar: 'لا' },
  missing: { en: 'No room in the family record for', ar: 'لا يوجد مكان في سجل العائلة لـ' },
  days: { en: 'days', ar: 'يومًا' },
  forbidden: {
    en: 'This list is for the Sales manager and the super admin.',
    ar: 'هذه القائمة لمدير المبيعات والمدير العام فقط.',
  },
} satisfies Record<string, Pair>

export const HAND_OVER_STATE: Record<HandOverState, { label: Pair; tone: Tone }> = {
  awaiting_enrolment: { label: { en: 'Waiting for enrolment', ar: 'بانتظار التسجيل' }, tone: 'waiting' },
  enrolled: { label: { en: 'Enrolled, not linked', ar: 'مسجّل، غير مربوط' }, tone: 'warn' },
  enrolled_no_contact: { label: { en: 'Enrolled, no contact copy', ar: 'مسجّل، بلا نسخة تواصل' }, tone: 'info' },
  learner_linked: { label: { en: 'Linked to a learner', ar: 'مربوط بطالب' }, tone: 'info' },
}

/** What Convert would answer now, in words for the manager and Operations. Kinds only, never a value. */
export const HAND_OVER_BLOCKER: Record<HandOverBlocker, Pair> = {
  channel_missing: {
    en: 'The family record has no room for one of the lead\'s channels. Add it to the family\'s profile, then Convert again.',
    ar: 'لا يوجد مكان في سجل العائلة لإحدى وسائل تواصل العميل. أضفها إلى ملف العائلة ثم حوّل مرة أخرى.',
  },
  ready: {
    en: 'Every channel is already in the family record. Open the lead and press Convert to link it.',
    ar: 'كل وسائل التواصل موجودة في سجل العائلة. افتح العميل واضغط تحويل لربطه.',
  },
  awaiting_enrolment: {
    en: 'Waiting for Operations to enrol the family.',
    ar: 'بانتظار أن يسجّل التشغيل العائلة.',
  },
  no_contact: {
    en: 'No contact copy, so nothing can be lost. Bookkeeping only, later.',
    ar: 'لا توجد نسخة تواصل، فلا شيء يضيع. إجراء محاسبي فقط لاحقًا.',
  },
  unavailable: {
    en: 'A family already exists under this lead\'s contact (for example entered by hand, or owned by someone else). Ask Operations or the family\'s owner to link or confirm it. The lead is kept as it is.',
    ar: 'توجد عائلة بالفعل بنفس بيانات تواصل هذا العميل (مثلًا أُدخلت يدويًا أو يملكها شخص آخر). اطلب من التشغيل أو من مسؤول العائلة ربطها أو تأكيدها. يبقى العميل كما هو.',
  },
  number_unreadable: {
    en: 'A phone number needs its country code or a correction before the hand-over.',
    ar: 'رقم هاتف يحتاج إلى رمز الدولة أو تصحيح قبل التسليم.',
  },
  not_assessed: {
    en: 'Linked to a learner by the Core confirmation. Bookkeeping only.',
    ar: 'مربوط بطالب بتأكيد النظام. إجراء محاسبي فقط.',
  },
}

export const STAGE: Record<Stage, { label: Pair; tone: Tone }> = {
  new_lead: { label: { en: 'New lead', ar: 'عميل جديد' }, tone: 'info' },
  contacted: { label: { en: 'Contacted', ar: 'تم التواصل' }, tone: 'waiting' },
  trial_booked: { label: { en: 'Trial booked', ar: 'تم حجز تجربة' }, tone: 'today' },
  trial_completed: { label: { en: 'Trial completed', ar: 'اكتملت التجربة' }, tone: 'gold' },
  converted: { label: { en: 'Converted', ar: 'تم التحويل' }, tone: 'ok' },
  lost: { label: { en: 'Lost', ar: 'خسارة' }, tone: 'danger' },
}

export const LOST: Record<LostReason | 'no_show', Pair> = {
  price: { en: 'Price', ar: 'السعر' },
  schedule: { en: 'Schedule', ar: 'المواعيد' },
  not_ready: { en: 'Not ready', ar: 'غير جاهز' },
  chose_other: { en: 'Chose another academy', ar: 'اختار جهة أخرى' },
  no_response: { en: 'No response', ar: 'لا يوجد رد' },
  other: { en: 'Other', ar: 'أخرى' },
  no_show: { en: 'Missed the trial', ar: 'لم يحضر التجربة' },
}

export function lostText(reason: string | null, locale: 'ar' | 'en'): string {
  if (!reason) return ''
  const p = (LOST as Record<string, Pair | undefined>)[reason]
  return p ? (locale === 'ar' ? p.ar : p.en) : reason
}

/** Why Convert was refused (the server's `detail.reason`, the audited outcome), in both languages. Never a value. */
export const CONVERT_REFUSAL: Record<string, Pair> = {
  channel_missing: {
    en: 'The family record has no room for one of this lead\'s contact channels (a second phone or WhatsApp number, or another e-mail). Add it to the family\'s profile first, then convert again.',
    ar: 'لا يوجد مكان في سجل العائلة لإحدى وسائل تواصل هذا العميل (رقم هاتف أو واتساب ثانٍ، أو بريد إلكتروني آخر). أضفها إلى ملف العائلة أولًا ثم حوّل مرة أخرى.',
  },
  no_contact: { en: 'This lead has no contact details to hand over.', ar: 'لا توجد بيانات تواصل لدى هذا العميل لتسليمها.' },
  number_unreadable: {
    en: 'A phone or WhatsApp number needs its country code or a correction before the hand-over.',
    ar: 'رقم الهاتف أو واتساب يحتاج إلى رمز الدولة أو تصحيح قبل التسليم.',
  },
  unavailable: {
    en: 'This parent is already in Chat under a family that is not yours. Ask your manager.',
    ar: 'ولي الأمر موجود بالفعل في عائلة ليست عائلتك. اسأل مديرك.',
  },
  lost: { en: 'A lost lead is reopened before it is converted.', ar: 'يُعاد فتح العميل المفقود قبل تحويله.' },
  already_converted: { en: 'This lead is already converted.', ar: 'تم تحويل هذا العميل بالفعل.' },
}

export function describePipelineError(error: unknown, locale: 'ar' | 'en'): string {
  const pick = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  if (error instanceof ApiError) {
    if (error.code === 'COMM.SALES_LEAD_DENIED') {
      return pick({ en: 'The Sales pipeline is for the Sales department and the super admin.', ar: 'مسار المبيعات لقسم المبيعات والمدير العام فقط.' })
    }
    const reason = (error.detail as { reason?: unknown } | null | undefined)?.reason
    if (error.code === 'COMM.SALES_LEAD_STATE' && typeof reason === 'string' && CONVERT_REFUSAL[reason]) return pick(CONVERT_REFUSAL[reason])
    if (error.code === 'COMM.PARENT_EXISTS') {
      return pick({
        en: 'This parent is already in Chat under a family that is not yours. Ask your manager.',
        ar: 'ولي الأمر موجود بالفعل في عائلة ليست عائلتك. اسأل مديرك.',
      })
    }
    return error.localized(locale)
  }
  return pick({ en: 'Something went wrong. Try again.', ar: 'حدث خطأ. حاول مرة أخرى.' })
}
