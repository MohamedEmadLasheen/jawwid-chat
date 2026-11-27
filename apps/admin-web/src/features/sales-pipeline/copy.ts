import { ApiError } from '@/core/api/errors'
import type { Tone } from '@/shared/components/Badge'
import type { Pair } from '../teachers/copy'
import type { LostReason, Stage } from './api'

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
  // The queue and its detail panel
  kind: { en: 'Lead', ar: 'عميل محتمل' },
  panelLabel: { en: 'Lead details', ar: 'تفاصيل العميل المحتمل' },
  pick: { en: 'Open a lead', ar: 'افتح عميلًا محتملًا' },
  pickLine: {
    en: 'Its stage, its follow-up and the parent\'s contact appear here. Opening a lead is recorded in the audit log.',
    ar: 'تظهر هنا مرحلته ومتابعته وبيانات ولي الأمر. فتح العميل يُسجَّل في سجل التدقيق.',
  },
  steps: { en: 'Steps', ar: 'الخطوات' },
  about: { en: 'About', ar: 'عن العميل' },
  followUp: { en: 'Follow-up', ar: 'المتابعة' },
  created: { en: 'Added', ar: 'أُضيف' },
} satisfies Record<string, Pair>

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

export function describePipelineError(error: unknown, locale: 'ar' | 'en'): string {
  const pick = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  if (error instanceof ApiError) {
    if (error.code === 'COMM.SALES_LEAD_DENIED') {
      return pick({ en: 'The Sales pipeline is for the Sales department and the super admin.', ar: 'مسار المبيعات لقسم المبيعات والمدير العام فقط.' })
    }
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
