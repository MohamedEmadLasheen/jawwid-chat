import { ApiError } from '@/core/api/errors'
import type { Pair } from '@/features/organization/copy'
import { PhotoError } from '@/features/profile/photo'
import type { PaymentMethod, TimelineStatus } from './api'
import { PhotoUploadError } from './hooks'

export { useCopy, type Pair } from '@/features/organization/copy'

/**
 * PD-17 copy, Arabic and English side by side. Wording rule: the Parent
 * Profile is the administration's; nothing on it says a teacher or the parent
 * sees it, and the internal note says it is internal.
 */
export const P = {
  // The parents list
  parentsTitle: { en: 'Parents', ar: 'أولياء الأمور' },
  parentsSubtitle: {
    en: 'Contact details, children and payments. Operations and Sales record payments here; teachers never see any of it.',
    ar: 'بيانات التواصل والأطفال والمدفوعات. يسجّل قسما العمليات والمبيعات المدفوعات هنا، ولا يرى المعلمون شيئًا منها.',
  },
  search: { en: 'Search a parent or a family', ar: 'ابحث عن ولي أمر أو أسرة' },
  parent: { en: 'Parent', ar: 'ولي الأمر' },
  family: { en: 'Family', ar: 'الأسرة' },
  children: { en: 'Children', ar: 'الأطفال' },
  noParents: { en: 'No parents to show.', ar: 'لا يوجد أولياء أمور لعرضهم.' },
  // PD-44: the subscription filter (a child's PD-30 state)
  subscriptionFilter: { en: 'Subscription', ar: 'الاشتراك' },
  allParents: { en: 'All', ar: 'الكل' },
  accessLocked: { en: 'Locked subscription', ar: 'اشتراك مقفل' },
  accessGrace: { en: 'Grace period', ar: 'فترة سماح' },
  truncated: { en: 'Showing the first 200. Search to narrow the list.', ar: 'تُعرض أول 200 نتيجة. ابحث لتضييق القائمة.' },
  open: { en: 'Open', ar: 'فتح' },
  back: { en: '← Parents', ar: '→ أولياء الأمور' },

  // The Parent Profile
  adminOnly: { en: 'Administration only', ar: 'للإدارة فقط' },
  contactInfo: { en: 'Contact information', ar: 'بيانات التواصل' },
  fullName: { en: 'Full name', ar: 'الاسم الكامل' },
  phone: { en: 'Phone number', ar: 'رقم الهاتف' },
  email: { en: 'Email address', ar: 'البريد الإلكتروني' },
  childrenCount: { en: 'Number of children', ar: 'عدد الأطفال' },
  country: { en: 'Country', ar: 'الدولة' },
  region: { en: 'Emirate or governorate', ar: 'الإمارة أو المحافظة' },
  notRecorded: { en: 'Not recorded', ar: 'غير مسجّل' },
  edit: { en: 'Edit', ar: 'تعديل' },
  editContact: { en: 'Edit contact information', ar: 'تعديل بيانات التواصل' },
  nameHint: { en: 'The name shown in every chat, everywhere.', ar: 'الاسم الظاهر في كل المحادثات.' },
  phoneHint: { en: 'With the country code, e.g. +971 50 123 4567.', ar: 'مع رمز الدولة، مثل ‎+971 50 123 4567.' },
  otherCountry: { en: 'Other (ISO code)', ar: 'دولة أخرى (رمز ISO)' },
  countryCode: { en: 'Two-letter country code, e.g. AE', ar: 'رمز الدولة من حرفين، مثل AE' },
  noCountry: { en: 'Not recorded', ar: 'غير مسجّلة' },
  about: { en: 'About this parent', ar: 'نبذة عن ولي الأمر' },
  aboutHint: {
    en: 'A short internal note for the administration. The parent never sees it, nor do teachers.',
    ar: 'ملاحظة داخلية قصيرة للإدارة. لا يراها ولي الأمر ولا المعلمون.',
  },
  noNote: { en: 'No note yet.', ar: 'لا توجد نبذة بعد.' },
  editNote: { en: 'Edit the note', ar: 'تعديل النبذة' },
  noChildren: { en: 'No children in this family.', ar: 'لا يوجد أطفال في هذه الأسرة.' },
  viewProfile: { en: 'View profile', ar: 'عرض الملف' },
  lastEdit: { en: 'Last edited {date}', ar: 'آخر تعديل {date}' },
  inactive: { en: 'Inactive', ar: 'غير نشط' },

  // Photo
  photoChoose: { en: 'Upload photo', ar: 'رفع صورة' },
  photoReplace: { en: 'Change photo', ar: 'تغيير الصورة' },
  photoUse: { en: 'Use this photo', ar: 'استخدام هذه الصورة' },
  photoUploading: { en: 'Uploading…', ar: 'جارٍ الرفع…' },
  photoRemove: { en: 'Remove', ar: 'إزالة' },
  photoPreview: { en: 'New photo preview', ar: 'معاينة الصورة الجديدة' },
  photoHint: { en: 'JPEG, PNG or WebP. It replaces the photo in every chat.', ar: 'JPEG أو PNG أو WebP. تحل محل الصورة في كل المحادثات.' },
  photoSaved: { en: 'Photo saved.', ar: 'تم حفظ الصورة.' },
  photoRemoved: { en: 'Photo removed.', ar: 'تمت إزالة الصورة.' },

  // Payments
  payments: { en: 'Payment information', ar: 'بيانات الدفع' },
  paymentsHint: {
    en: 'Recorded here in Jawwid Chat by Operations and Sales. The parent sees their own payments in the app; teachers never see any of it.',
    ar: 'يسجّلها قسما العمليات والمبيعات هنا في جوّد للمحادثات. يرى ولي الأمر مدفوعاته في التطبيق، ولا يرى المعلمون شيئًا منها.',
  },
  subscription: { en: 'Current subscription', ar: 'الاشتراك الحالي' },
  noPlan: { en: 'No plan recorded', ar: 'لا توجد باقة مسجّلة' },
  method: { en: 'Payment method', ar: 'طريقة الدفع' },
  currency: { en: 'Currency', ar: 'العملة' },
  editPayments: { en: 'Edit subscription and payment method', ar: 'تعديل الاشتراك وطريقة الدفع' },
  plan: { en: 'Plan', ar: 'الباقة' },
  none: { en: 'None', ar: 'بدون' },
  timeline: { en: 'Payment timeline', ar: 'سجل المدفوعات' },
  timelineHint: {
    en: 'Every instalment in date order. A payment is recorded once; a mistake is voided with a reason, never edited or deleted.',
    ar: 'كل الأقساط بترتيب التاريخ. تُسجَّل الدفعة مرة واحدة، ويُلغى الخطأ مع ذكر السبب دون تعديل أو حذف.',
  },
  noInstalments: { en: 'No instalments yet.', ar: 'لا توجد أقساط بعد.' },
  addInstalments: { en: 'Add instalments', ar: 'إضافة أقساط' },
  paid: { en: 'Paid', ar: 'مدفوع' },
  outstanding: { en: 'Outstanding', ar: 'متبقٍ' },
  overdue: { en: 'of which overdue', ar: 'منها متأخر' },
  dueOn: { en: 'Due {date}', ar: 'يستحق {date}' },
  paidOnBy: { en: 'Paid {date} by {method} · recorded by {name}', ar: 'دُفع {date} عبر {method} · سجّله {name}' },
  paidOnByStripe: { en: 'Paid {date} by {method} · confirmed by Stripe', ar: 'دُفع {date} عبر {method} · أكّده Stripe' },
  reference: { en: 'Reference', ar: 'المرجع' },
  voidedBy: { en: 'Voided by {name}: {reason}', ar: 'ألغاه {name}: {reason}' },
  forChild: { en: 'For {name}', ar: 'عن {name}' },
  forFamily: { en: 'For the family', ar: 'عن الأسرة' },
  recordPayment: { en: 'Record payment', ar: 'تسجيل دفعة' },
  void: { en: 'Void', ar: 'إلغاء' },

  // Dialogs
  newTitle: { en: 'Add instalments', ar: 'إضافة أقساط' },
  label: { en: 'Label', ar: 'الوصف' },
  labelHint: { en: 'What it is for, e.g. "Autumn term".', ar: 'عن ماذا، مثل «الفصل الأول».' },
  amount: { en: 'Amount of each instalment', ar: 'مبلغ كل قسط' },
  firstDue: { en: 'First due date', ar: 'تاريخ أول استحقاق' },
  count: { en: 'Number of instalments', ar: 'عدد الأقساط' },
  every: { en: 'Every (months)', ar: 'كل (أشهر)' },
  child: { en: 'For', ar: 'عن' },
  wholeFamily: { en: 'The whole family', ar: 'الأسرة كلها' },
  create: { en: 'Add', ar: 'إضافة' },
  payTitle: { en: 'Record a payment: {label}', ar: 'تسجيل دفعة: {label}' },
  paidOn: { en: 'Paid on', ar: 'تاريخ الدفع' },
  referenceHint: { en: 'Optional: a transfer or invoice number.', ar: 'اختياري: رقم التحويل أو الفاتورة.' },
  payOnce: {
    en: 'A recorded payment cannot be changed. If it is wrong, void the instalment and add it again.',
    ar: 'لا يمكن تغيير الدفعة بعد تسجيلها. إن كانت خطأ فألغِ القسط وأضفه من جديد.',
  },
  voidTitle: { en: 'Void: {label}', ar: 'إلغاء: {label}' },
  voidHint: {
    en: 'Voiding is final. The instalment stays in the timeline, marked voided, with your reason.',
    ar: 'الإلغاء نهائي. يبقى القسط في السجل مُعلَّمًا بأنه ملغى، مع السبب الذي تذكره.',
  },
  reason: { en: 'Reason', ar: 'السبب' },
  reasonRequired: { en: 'Say why.', ar: 'اذكر السبب.' },
  required: { en: 'Required.', ar: 'مطلوب.' },
  invalidAmount: { en: 'Enter an amount above zero.', ar: 'أدخل مبلغًا أكبر من صفر.' },
  save: { en: 'Save', ar: 'حفظ' },
  saving: { en: 'Saving…', ar: 'جارٍ الحفظ…' },
  cancel: { en: 'Cancel', ar: 'إلغاء الأمر' },

  // PD-27: a custom schedule, partial payments
  scheduleMode: { en: 'Schedule', ar: 'الجدول' },
  equalMode: { en: 'Equal instalments', ar: 'أقساط متساوية' },
  customMode: { en: 'Custom schedule', ar: 'جدول مخصص' },
  rowAmount: { en: 'Amount {n}', ar: 'المبلغ {n}' },
  rowDue: { en: 'Due date {n}', ar: 'تاريخ الاستحقاق {n}' },
  addRow: { en: 'Add a row', ar: 'إضافة صف' },
  removeRow: { en: 'Remove row {n}', ar: 'حذف الصف {n}' },
  scheduleTotal: { en: 'Total: {amount}', ar: 'الإجمالي: {amount}' },
  scheduleMax: { en: 'At most 24 instalments.', ar: '24 قسطًا كحد أقصى.' },
  wholeRemaining: { en: 'Records the whole remaining amount: {amount}.', ar: 'يسجّل كامل المبلغ المتبقي: {amount}.' },

  // The Student Profile
  studentEyebrow: { en: 'Student profile', ar: 'ملف الطالب' },
  studentInfo: { en: 'Student', ar: 'الطالب' },
  name: { en: 'Name', ar: 'الاسم' },
  age: { en: 'Age', ar: 'العمر' },
  years: { en: '{n} years', ar: '{n} سنة' },
  birthDate: { en: 'Date of birth', ar: 'تاريخ الميلاد' },
  course: { en: 'Enrolled course', ar: 'الدورة المسجّل بها' },
  teacher: { en: 'Assigned teacher', ar: 'المعلم المسؤول' },
  schedule: { en: 'Class schedule', ar: 'جدول الحصص' },
  noSchedule: { en: 'No regular lesson times yet', ar: 'لا توجد مواعيد ثابتة للحصص بعد' },
  minutes: { en: '{n} min', ar: '{n} دقيقة' },
  timezone: { en: 'Times in {zone}', ar: 'المواعيد بتوقيت {zone}' },
  familyLocal: { en: "family's time: {time}", ar: 'بتوقيت الأسرة: {time}' },
  notSet: { en: 'Not set', ar: 'غير محدد' },
  parents: { en: 'Parents', ar: 'أولياء الأمور' },
  parentsHint: {
    en: 'Their Parent Profile opens for the administration that looks after this family.',
    ar: 'يُفتح ملف ولي الأمر للإدارة المسؤولة عن هذه الأسرة.',
  },
} satisfies Record<string, Pair>

export const METHOD_LABEL: Record<PaymentMethod, Pair> = {
  invoice: { en: 'Invoice', ar: 'فاتورة' },
  bank_transfer: { en: 'Bank transfer', ar: 'تحويل بنكي' },
}

export const TIMELINE_STATUS: Record<TimelineStatus, Pair> = {
  overdue: { en: 'Overdue', ar: 'متأخر' },
  due: { en: 'Due today', ar: 'مستحق اليوم' },
  upcoming: { en: 'Upcoming', ar: 'قادم' },
  paid: { en: 'Paid', ar: 'مدفوع' },
  voided: { en: 'Voided', ar: 'ملغى' },
}

/**
 * "3-month plan" / "باقة 3 أشهر": Arabic counts months by number (شهر واحد،
 * شهرين، 3–10 أشهر، 11+ شهرًا), so the plan is worded here, not by a template.
 */
export function planLabel(n: number, locale: 'ar' | 'en'): string {
  if (locale === 'en') return `${n}-month plan`
  if (n === 1) return 'باقة شهر واحد'
  if (n === 2) return 'باقة شهرين'
  if (n >= 3 && n <= 10) return `باقة ${n} أشهر`
  return `باقة ${n} شهرًا`
}

/** The plans the server accepts (chat.family.subscription_plan_months). */
export const PLAN_MONTHS = [1, 3, 6, 12] as const

/** Countries offered first; any ISO 3166-1 alpha-2 code is accepted. */
export const COUNTRIES = ['AE', 'SA', 'EG', 'KW', 'QA', 'BH', 'OM', 'JO', 'GB', 'US'] as const

/** The seven emirates, offered as suggestions when the country is the UAE. */
export const EMIRATES: readonly Pair[] = [
  { en: 'Abu Dhabi', ar: 'أبوظبي' },
  { en: 'Dubai', ar: 'دبي' },
  { en: 'Sharjah', ar: 'الشارقة' },
  { en: 'Ajman', ar: 'عجمان' },
  { en: 'Umm Al Quwain', ar: 'أم القيوين' },
  { en: 'Ras Al Khaimah', ar: 'رأس الخيمة' },
  { en: 'Fujairah', ar: 'الفجيرة' },
]

/** A country's name in the reader's language, or its code when the browser has no name for it. */
export function countryName(code: string, locale: 'ar' | 'en'): string {
  try {
    return new Intl.DisplayNames([locale === 'ar' ? 'ar' : 'en'], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

/** How many decimals a currency's minor unit has (AED 2, KWD 3, JPY 0). */
export function minorDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}

/** "1,250.50" in a currency -> minor units, or null when it is not a positive amount. */
export function toMinor(input: string, currency: string): number | null {
  const v = Number(input.replace(/[\s,٬]/g, '').replace('٫', '.'))
  if (!Number.isFinite(v) || v <= 0) return null
  return Math.round(v * 10 ** minorDigits(currency))
}

const BY_CODE: Record<string, Pair> = {
  'COMM.PARENT_PROFILE_DENIED': {
    en: 'Parent profiles are for the Operations and Sales departments and the super admin; contact details are edited by Operations.',
    ar: 'ملفات أولياء الأمور لقسمي العمليات والمبيعات والمدير العام، وتعدّل بيانات التواصل من قسم العمليات.',
  },
  'COMM.PARENT_PROFILE_NOT_FOUND': { en: 'This parent was not found, or is not one you look after.', ar: 'ولي الأمر غير موجود، أو ليس ممن تتابعهم.' },
  'COMM.BILLING_DENIED': {
    en: 'Payments are for the Operations and Sales departments and the super admin.',
    ar: 'المدفوعات لقسمي العمليات والمبيعات والمدير العام فقط.',
  },
  'COMM.BILLING_NOT_FOUND': { en: 'Not found.', ar: 'غير موجود.' },
  'COMM.BILLING_STATE': {
    en: 'This was already paid, voided, cancelled or expired. Reload to see it.',
    ar: 'تم دفع هذا أو إلغاؤه أو انتهى بالفعل. أعد التحميل لرؤيته.',
  },
  'COMM.LESSON_NOT_FOUND': {
    en: 'This student was not found, or is not one you may open.',
    ar: 'الطالب غير موجود، أو ليس ممن يمكنك فتح ملفهم.',
  },
  'COMM.LESSON_DENIED': { en: 'You may not open this student’s profile.', ar: 'لا يمكنك فتح ملف هذا الطالب.' },
  'COMM.PROFILE_PHOTO_INVALID': {
    en: 'That image was not accepted. Use a JPEG, PNG or WebP photo.',
    ar: 'لم تُقبل الصورة. استخدم صورة JPEG أو PNG أو WebP.',
  },
}

const PHOTO_PROBLEM: Record<string, Pair> = {
  type: { en: 'Choose a JPEG, PNG or WebP image.', ar: 'اختر صورة JPEG أو PNG أو WebP.' },
  too_big: { en: 'That image is too large (10 MB at most).', ar: 'الصورة كبيرة جدًا (10 ميغابايت كحد أقصى).' },
  too_small: { en: 'That image is too small.', ar: 'الصورة صغيرة جدًا.' },
  unreadable: { en: 'That file could not be read as an image.', ar: 'تعذّرت قراءة الملف كصورة.' },
}

export function describeError(error: unknown, locale: 'ar' | 'en'): string {
  const pick = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  if (error instanceof PhotoError) return pick(PHOTO_PROBLEM[error.problem] ?? PHOTO_PROBLEM.unreadable!)
  if (error instanceof PhotoUploadError) {
    return pick({ en: 'The photo could not be uploaded. Try again.', ar: 'تعذّر رفع الصورة. حاول مرة أخرى.' })
  }
  if (error instanceof ApiError) {
    const known = error.code ? BY_CODE[error.code] : undefined
    if (known) return pick(known)
    return error.localized(locale)
  }
  return pick({ en: 'Something went wrong. Try again.', ar: 'حدث خطأ. حاول مرة أخرى.' })
}

export function isProfileRefusal(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 403 || error.status === 404)
}
