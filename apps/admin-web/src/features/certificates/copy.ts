import { ApiError } from '@/core/api/errors'
import type { Tone } from '@/shared/components/Badge'
import type { Pair } from '@/features/organization/copy'
import type { CertificateAct, CertificateState, StateGroup } from './api'

export { useCopy, type Pair } from '@/features/organization/copy'

/**
 * PD-41 copy, Arabic and English side by side. Wording rule: a button never
 * promises more than the server does -- "Send to group" names the group first,
 * "Publish as a Story" says who will see it, and consent is its own step.
 */
export const C = {
  title: { en: 'Certificates', ar: 'الشهادات' },
  subtitle: {
    en: 'Appreciation certificates for students and teachers: requested, designed, approved by the requester, then sent to the right group — and, only if asked for, shared as a Story.',
    ar: 'شهادات تقدير للطلاب والمعلمين: تُطلب ثم تُصمَّم ثم يعتمدها صاحب الطلب، ثم تُرسل إلى المجموعة الصحيحة — وتُنشر في القصص فقط عند طلب ذلك.',
  },
  students: { en: 'Students', ar: 'الطلاب' },
  teachers: { en: 'Teachers', ar: 'المعلمون' },
  types: { en: 'Types', ar: 'الأنواع' },
  newRequest: { en: 'New request', ar: 'طلب جديد' },
  search: { en: 'Search by name or title', ar: 'ابحث بالاسم أو العنوان' },
  empty: { en: 'Nothing here.', ar: 'لا يوجد شيء هنا.' },
  more: { en: 'Show more', ar: 'عرض المزيد' },
  denied: { en: 'This account does not open certificates.', ar: 'هذا الحساب لا يفتح الشهادات.' },

  // Lists
  g_suggested: { en: 'Suggested', ar: 'مقترحة' },
  g_pending: { en: 'Pending', ar: 'بانتظار التصميم' },
  g_in_progress: { en: 'In progress', ar: 'قيد التنفيذ' },
  g_completed: { en: 'Completed', ar: 'مكتملة' },
  g_sent: { en: 'Sent', ar: 'أُرسلت' },
  g_closed: { en: 'Closed', ar: 'مغلقة' },

  // States
  s_proposed: { en: 'Suggested by teacher', ar: 'اقتراح من المعلم' },
  s_requested: { en: 'Pending', ar: 'بانتظار التصميم' },
  s_in_design: { en: 'In design', ar: 'قيد التصميم' },
  s_changes_requested: { en: 'Needs changes', ar: 'تحتاج تعديلًا' },
  s_uploaded: { en: 'Awaiting your review', ar: 'بانتظار المراجعة' },
  s_approved: { en: 'Approved · ready to send', ar: 'معتمدة · جاهزة للإرسال' },
  s_sent: { en: 'Sent', ar: 'أُرسلت' },
  s_cancelled: { en: 'Cancelled', ar: 'أُلغيت' },
  s_declined: { en: 'Declined', ar: 'مرفوضة' },
  storyPublished: { en: 'Story published', ar: 'نُشرت في القصص' },
  storyOptedIn: { en: 'Story requested', ar: 'مطلوب نشرها في القصص' },

  // Columns and fields
  printedName: { en: 'Name on the certificate', ar: 'الاسم على الشهادة' },
  type: { en: 'Type', ar: 'النوع' },
  juz: { en: 'Juz’', ar: 'الجزء' },
  period: { en: 'Period', ar: 'الفترة' },
  requestedBy: { en: 'Requested by', ar: 'صاحب الطلب' },
  requested: { en: 'Requested', ar: 'تاريخ الطلب' },
  status: { en: 'Status', ar: 'الحالة' },
  student: { en: 'Student', ar: 'الطالب' },
  teacher: { en: 'Teacher', ar: 'المعلم' },
  signatory: { en: 'Teacher on the certificate', ar: 'المعلم على الشهادة' },
  titleField: { en: 'Title', ar: 'العنوان' },
  achievement: { en: 'Achievement', ar: 'الإنجاز' },
  achievedOn: { en: 'Achieved on', ar: 'تاريخ الإنجاز' },
  grade: { en: 'Grade', ar: 'التقدير' },
  designerNote: { en: 'Notes for the designer', ar: 'ملاحظات للمصمم' },
  internalNote: { en: 'Internal note (never shown to the designer)', ar: 'ملاحظة داخلية (لا يراها المصمم)' },
  publishStory: { en: 'Publish as a Story when it is ready (never automatic)', ar: 'نشرها في القصص عند جاهزيتها (لا يحدث تلقائيًا)' },
  designer: { en: 'Designer', ar: 'المصمم' },
  returnMessage: { en: 'What to change', ar: 'المطلوب تعديله' },
  files: { en: 'Design files', ar: 'ملفات التصميم' },
  revision: { en: 'Revision {n}', ar: 'النسخة {n}' },
  open: { en: 'Open', ar: 'فتح' },
  history: { en: 'History', ar: 'السجل' },
  deliveredYes: { en: 'Sent ✓', ar: 'أُرسلت ✓' },

  // Acts
  a_edit: { en: 'Edit request', ar: 'تعديل الطلب' },
  a_resubmit: { en: 'Resubmit to the designer', ar: 'إعادة الإرسال للمصمم' },
  a_cancel: { en: 'Cancel request', ar: 'إلغاء الطلب' },
  a_accept: { en: 'Accept suggestion', ar: 'قبول الاقتراح' },
  a_decline: { en: 'Decline suggestion', ar: 'رفض الاقتراح' },
  a_start: { en: 'Start designing', ar: 'بدء التصميم' },
  a_return: { en: 'Return for changes', ar: 'إعادة للتعديل' },
  a_release: { en: 'Release', ar: 'إرجاع إلى الانتظار' },
  a_upload: { en: 'Upload design', ar: 'رفع التصميم' },
  a_approve: { en: 'Approve this design', ar: 'اعتماد هذا التصميم' },
  a_redesign: { en: 'Ask for a redesign', ar: 'طلب إعادة التصميم' },
  a_withdraw_approval: { en: 'Withdraw approval', ar: 'سحب الاعتماد' },
  a_send: { en: 'Send to group', ar: 'إرسال إلى المجموعة' },
  a_consent: { en: 'Family consent…', ar: 'موافقة الأسرة…' },
  a_story: { en: 'Publish as a Story', ar: 'نشر في القصص' },

  // Dialogs
  reasonLabel: { en: 'Reason (at least 10 characters)', ar: 'السبب (10 أحرف على الأقل)' },
  messageLabel: { en: 'What should change? (at least 10 characters)', ar: 'ما المطلوب تعديله؟ (10 أحرف على الأقل)' },
  sendTitle: { en: 'Send the certificate', ar: 'إرسال الشهادة' },
  sendTo: { en: 'It will be posted once to: {name}', ar: 'ستُنشر مرة واحدة في: {name}' },
  sendToNew: { en: 'It will be posted once to the teacher’s supervision chat (opened now).', ar: 'ستُنشر مرة واحدة في محادثة الإشراف الخاصة بالمعلم (تُفتح الآن).' },
  members: { en: '{n} members', ar: '{n} عضوًا' },
  noGroup: { en: 'No group to send into — open the student’s group first.', ar: 'لا توجد مجموعة للإرسال — افتح مجموعة الطالب أولًا.' },
  targetChanged: { en: 'The group changed since it was shown. Check it and send again.', ar: 'تغيّرت المجموعة منذ عرضها. تحقّق منها ثم أرسل مرة أخرى.' },
  storyTitle: { en: 'Publish as a Story', ar: 'النشر في القصص' },
  storyAudienceStudents: { en: 'Every family of the academy will see it.', ar: 'ستراها جميع أسر الأكاديمية.' },
  storyAudienceTeachers: { en: 'Every teacher of the academy will see it.', ar: 'سيراها جميع معلمي الأكاديمية.' },
  consentTitle: { en: 'Family consent', ar: 'موافقة الأسرة' },
  consentHint: {
    en: 'A student’s certificate is shared as a Story only with the family’s explicit consent. Record who agreed, how, and the evidence.',
    ar: 'لا تُنشر شهادة الطالب في القصص إلا بموافقة صريحة من الأسرة. سجّل من وافق، وكيف، والدليل.',
  },
  consentNone: { en: 'Not recorded', ar: 'لم تُسجَّل' },
  consentGranted: { en: 'Granted', ar: 'موافَق عليها' },
  consentWithdrawn: { en: 'Withdrawn', ar: 'مسحوبة' },
  consentParent: { en: 'Which parent agreed', ar: 'وليّ الأمر الذي وافق' },
  consentMethod: { en: 'How', ar: 'الطريقة' },
  m_in_chat: { en: 'In the chat', ar: 'في المحادثة' },
  m_phone: { en: 'By phone', ar: 'بالهاتف' },
  m_in_person: { en: 'In person', ar: 'حضوريًا' },
  m_written: { en: 'Signed form', ar: 'نموذج موقّع' },
  consentEvidence: { en: 'The parent’s message id (in the chat)', ar: 'معرّف رسالة وليّ الأمر (في المحادثة)' },
  consentNote: { en: 'Note: when and how, or where the signed form is kept', ar: 'ملاحظة: متى وكيف، أو أين يُحفظ النموذج الموقّع' },
  grant: { en: 'Record consent', ar: 'تسجيل الموافقة' },
  withdraw: { en: 'Withdraw consent (takes the Story down)', ar: 'سحب الموافقة (يحذف القصة)' },
  uploadHint: { en: 'PDF or image, up to 20 MB. The requester reviews it before anything is sent.', ar: 'PDF أو صورة، حتى 20 ميغابايت. يراجعها صاحب الطلب قبل أي إرسال.' },
  fileTooLarge: { en: 'The file is larger than 20 MB.', ar: 'حجم الملف أكبر من 20 ميغابايت.' },
  fileWrongType: { en: 'Choose a PDF, JPEG, PNG or WebP file.', ar: 'اختر ملف PDF أو JPEG أو PNG أو WebP.' },
  confirm: { en: 'Confirm', ar: 'تأكيد' },
  save: { en: 'Save', ar: 'حفظ' },
  submit: { en: 'Submit request', ar: 'إرسال الطلب' },
  duplicate: { en: 'This certificate is already requested.', ar: 'هذه الشهادة مطلوبة بالفعل.' },
  suspected: { en: 'A similar certificate was requested in the last 30 days. Submit anyway?', ar: 'طُلبت شهادة مشابهة خلال آخر 30 يومًا. هل تريد الإرسال على أي حال؟' },
  submitAnyway: { en: 'Submit anyway', ar: 'إرسال على أي حال' },
  recipient: { en: 'For', ar: 'لِـ' },
  pickRecipient: { en: 'Search a name…', ar: 'ابحث عن اسم…' },
  periodStart: { en: 'Period from', ar: 'الفترة من' },
  periodEnd: { en: 'to', ar: 'إلى' },

  // Types
  typesTitle: { en: 'Certificate types', ar: 'أنواع الشهادات' },
  typesHint: { en: 'A disabled type takes no new request. Old certificates keep their type; nothing is deleted.', ar: 'النوع المعطَّل لا يقبل طلبات جديدة. تحتفظ الشهادات السابقة بنوعها؛ لا يُحذف شيء.' },
  key: { en: 'Key', ar: 'المفتاح' },
  labelEn: { en: 'English label', ar: 'الاسم بالإنجليزية' },
  labelAr: { en: 'Arabic label', ar: 'الاسم بالعربية' },
  needsJuz: { en: 'Needs the Juz’', ar: 'يتطلب الجزء' },
  needsMonth: { en: 'Needs a month', ar: 'يتطلب شهرًا' },
  enabled: { en: 'Enabled', ar: 'مفعّل' },
  addType: { en: 'Add type', ar: 'إضافة نوع' },
} satisfies Record<string, Pair>

export const GROUPS: readonly StateGroup[] = ['suggested', 'pending', 'in_progress', 'completed', 'sent', 'closed']

export const groupLabel = (g: StateGroup): Pair => C[`g_${g}` as const]
export const stateLabel = (s: CertificateState): Pair => C[`s_${s}` as const]
export const actLabel = (a: CertificateAct): Pair => C[`a_${a}` as const]

export function stateTone(s: CertificateState): Tone {
  if (s === 'sent' || s === 'approved') return 'ok'
  if (s === 'uploaded' || s === 'changes_requested' || s === 'proposed') return 'warn'
  if (s === 'cancelled' || s === 'declined') return 'waiting'
  return 'info'
}

export function describeError(error: unknown, locale: 'ar' | 'en'): string {
  return error instanceof ApiError ? error.localized(locale) : locale === 'ar' ? 'تعذّر الاتصال. حاول مرة أخرى.' : 'Could not reach the server. Try again.'
}

export const isCode = (error: unknown, code: string) => error instanceof ApiError && error.code === code
