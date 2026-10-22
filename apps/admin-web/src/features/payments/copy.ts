import { ApiError } from '@/core/api/errors'
import type { Pair } from '@/features/organization/copy'
import { formatMoney } from '@/features/instalments/copy'
import { minorDigits } from '@/features/profiles/copy'
import type { InvoiceStatus, PaymentMethod, PaymentRequest, ReceiptStatus, RequestPurpose, RequestStatus } from './api'

export { useCopy, type Pair } from '@/features/organization/copy'
export { formatDay, formatMoney } from '@/features/instalments/copy'
export { toMinor } from '@/features/profiles/copy'

/**
 * PD-27 copy, Arabic and English side by side. Wording rules: a payment is
 * confirmed by the server (Stripe's verified webhook, a verifier's approval,
 * or staff recording cash), never by the page; and the server sends nothing on
 * WhatsApp -- the staff member's own WhatsApp opens with the link typed in.
 */
export const PAY = {
  // The Payments area
  title: { en: 'Payments', ar: 'المدفوعات' },
  subtitle: {
    en: 'Bank-transfer receipts parents uploaded, waiting for verification, and the academy’s payment settings.',
    ar: 'إيصالات التحويل البنكي التي رفعها أولياء الأمور بانتظار التحقق، وإعدادات الدفع في الأكاديمية.',
  },
  tabs: { en: 'Payments', ar: 'المدفوعات' },
  receiptsTab: { en: 'Receipts', ar: 'الإيصالات' },
  settingsTab: { en: 'Settings', ar: 'الإعدادات' },
  status: { en: 'Status', ar: 'الحالة' },
  noReceipts: { en: 'No receipts here.', ar: 'لا توجد إيصالات هنا.' },
  family: { en: 'Family', ar: 'الأسرة' },
  forWhat: { en: 'For', ar: 'عن' },
  amountSent: { en: 'Amount sent', ar: 'المبلغ المحوَّل' },
  transferredOn: { en: 'Transferred on', ar: 'تاريخ التحويل' },
  note: { en: 'Note', ar: 'ملاحظة' },
  uploadedAt: { en: 'Uploaded', ar: 'تاريخ الرفع' },
  uploadedBy: { en: 'by {name}', ar: 'من {name}' },
  file: { en: 'Receipt', ar: 'الإيصال' },
  openFile: { en: 'Open the file', ar: 'فتح الملف' },
  openPdf: { en: 'Open the PDF', ar: 'فتح ملف PDF' },
  receiptImage: { en: 'Receipt for {label}', ar: 'إيصال {label}' },
  approve: { en: 'Approve', ar: 'اعتماد' },
  reject: { en: 'Reject', ar: 'رفض' },
  reviewedBy: { en: '{status} by {name}, {date}', ar: '{status} بواسطة {name}، {date}' },
  rejectedBecause: { en: 'Reason: {reason}', ar: 'السبب: {reason}' },
  verifyOnly: {
    en: 'Receipts are approved or rejected by the super admin and the Operations Manager.',
    ar: 'يعتمد الإيصالات أو يرفضها المدير العام ومدير العمليات.',
  },
  approveTitle: { en: 'Approve the receipt: {label}', ar: 'اعتماد الإيصال: {label}' },
  approveHint: {
    en: 'Approving records the payment and issues its invoice, exactly like a card payment. Correct the amount or date only if the transfer differs from what the parent wrote.',
    ar: 'يسجّل الاعتماد الدفعة ويصدر فاتورتها تمامًا كالدفع بالبطاقة. صحّح المبلغ أو التاريخ فقط إن اختلف التحويل عمّا كتبه ولي الأمر.',
  },
  correctedAmount: { en: 'Amount received (optional)', ar: 'المبلغ المستلم (اختياري)' },
  correctedAmountHint: { en: 'Leave empty to accept {amount}.', ar: 'اتركه فارغًا لاعتماد {amount}.' },
  paidOn: { en: 'Paid on', ar: 'تاريخ الدفع' },
  rejectTitle: { en: 'Reject the receipt: {label}', ar: 'رفض الإيصال: {label}' },
  rejectHint: { en: 'The parent sees your reason in the app.', ar: 'يرى ولي الأمر السبب في التطبيق.' },

  // Settings
  bankAccount: { en: 'Bank account', ar: 'الحساب البنكي' },
  bankHint: {
    en: 'Shown to parents who pay by bank transfer, in the app and on every payment link.',
    ar: 'يظهر لأولياء الأمور الذين يدفعون بالتحويل البنكي، في التطبيق وفي كل رابط دفع.',
  },
  bankName: { en: 'Bank name', ar: 'اسم البنك' },
  accountName: { en: 'Account name', ar: 'اسم صاحب الحساب' },
  iban: { en: 'IBAN', ar: 'رقم الآيبان' },
  accountNumber: { en: 'Account number', ar: 'رقم الحساب' },
  swift: { en: 'SWIFT / BIC', ar: 'رمز السويفت' },
  bankNote: { en: 'Note for parents', ar: 'ملاحظة لأولياء الأمور' },
  bankNoteHint: { en: 'e.g. “Write the child’s name in the transfer reference.”', ar: 'مثل: «اكتب اسم الطفل في مرجع التحويل».' },
  noBankAccount: { en: 'No bank account set. Parents are not offered a bank transfer.', ar: 'لم يُحدَّد حساب بنكي. لا يُعرض التحويل البنكي على أولياء الأمور.' },
  issuer: { en: 'Invoice issuer', ar: 'جهة إصدار الفواتير' },
  issuerHint: { en: 'Printed on every invoice issued from now on. Invoices already issued keep what they said.', ar: 'تُطبع على كل فاتورة تصدر من الآن. الفواتير الصادرة تبقى كما هي.' },
  issuerName: { en: 'Name', ar: 'الاسم' },
  address: { en: 'Address', ar: 'العنوان' },
  taxId: { en: 'Tax registration number', ar: 'الرقم الضريبي' },
  reminders: { en: 'Payment reminders', ar: 'تذكيرات الدفع' },
  remindersHint: {
    en: 'Sent to every active parent of a family with an open instalment. A full payment cancels the rest.',
    ar: 'تُرسل إلى كل ولي أمر نشط في أسرة لديها قسط مفتوح، ويلغي السداد الكامل ما تبقى منها.',
  },
  card: { en: 'Card payments', ar: 'الدفع بالبطاقة' },
  cardOn: { en: 'Stripe connected', ar: 'Stripe متصل' },
  cardOff: { en: 'Not configured: no card option anywhere.', ar: 'غير مُعَد: لا يظهر خيار البطاقة في أي مكان.' },
  webhookOn: { en: 'Webhook configured', ar: 'الـWebhook مُعَد' },
  webhookOff: {
    en: 'Webhook not configured: card payments cannot be confirmed, so none is recorded.',
    ar: 'الـWebhook غير مُعَد: لا يمكن تأكيد الدفع بالبطاقة، فلا تُسجَّل أي دفعة.',
  },
  readOnlySettings: {
    en: 'Only the super admin and the Operations Manager change these settings.',
    ar: 'لا يغيّر هذه الإعدادات إلا المدير العام ومدير العمليات.',
  },
  accountNameRequired: { en: 'The account name is required when any bank detail is filled in.', ar: 'اسم صاحب الحساب مطلوب عند تعبئة أي من بيانات البنك.' },
  issuerNameRequired: { en: 'The name is required when any issuer detail is filled in.', ar: 'الاسم مطلوب عند تعبئة أي من بيانات جهة الإصدار.' },
  saved: { en: 'Saved.', ar: 'تم الحفظ.' },

  // Payment requests and links
  requestPayment: { en: 'Request payment', ar: 'طلب دفعة' },
  requestTitle: { en: 'Request a payment', ar: 'طلب دفعة' },
  requestHint: {
    en: 'Creates a unique payment link. The parent opens it without signing in and pays by card; the payment is recorded only when Stripe confirms it.',
    ar: 'يُنشئ رابط دفع فريدًا. يفتحه ولي الأمر دون تسجيل دخول ويدفع بالبطاقة، ولا تُسجَّل الدفعة إلا بعد تأكيد Stripe.',
  },
  purpose: { en: 'For', ar: 'الغرض' },
  label: { en: 'Label', ar: 'الوصف' },
  labelHint: { en: 'What the parent sees, e.g. “3-month subscription”.', ar: 'ما يراه ولي الأمر، مثل «اشتراك 3 أشهر».' },
  amount: { en: 'Amount', ar: 'المبلغ' },
  currency: { en: 'Currency', ar: 'العملة' },
  child: { en: 'Child', ar: 'الطفل' },
  wholeFamily: { en: 'The whole family', ar: 'الأسرة كلها' },
  plan: { en: 'Package', ar: 'الباقة' },
  noPlan: { en: 'None', ar: 'بدون' },
  periodStart: { en: 'Period from', ar: 'الفترة من' },
  periodEnd: { en: 'Period to', ar: 'الفترة إلى' },
  expiresIn: { en: 'Link valid for (days)', ar: 'صلاحية الرابط (أيام)' },
  expiresInHint: { en: 'Between 1 and 90 days.', ar: 'من 1 إلى 90 يومًا.' },
  createLink: { en: 'Create link', ar: 'إنشاء الرابط' },
  creating: { en: 'Creating…', ar: 'جارٍ الإنشاء…' },
  linkReady: { en: 'The payment link is ready. Send it to the parent.', ar: 'رابط الدفع جاهز. أرسله إلى ولي الأمر.' },
  link: { en: 'Payment link', ar: 'رابط الدفع' },
  copyLink: { en: 'Copy link', ar: 'نسخ الرابط' },
  copied: { en: 'Copied.', ar: 'تم النسخ.' },
  copyFailed: { en: 'Could not copy. Select the link and copy it.', ar: 'تعذّر النسخ. حدّد الرابط وانسخه.' },
  whatsapp: { en: 'Send on WhatsApp', ar: 'إرسال عبر واتساب' },
  whatsappHint: { en: 'Opens your own WhatsApp with the message ready; nothing is sent until you send it.', ar: 'يفتح واتساب الخاص بك والرسالة جاهزة، ولا يُرسل شيء حتى ترسلها أنت.' },
  done: { en: 'Done', ar: 'تم' },
  requests: { en: 'Payment requests', ar: 'طلبات الدفع' },
  requestsHint: {
    en: 'Each request has its own link. A paid, cancelled or expired link no longer takes payments.',
    ar: 'لكل طلب رابطه الخاص. الرابط المدفوع أو الملغى أو المنتهي لا يقبل دفعات.',
  },
  noRequests: { en: 'No payment requests yet.', ar: 'لا توجد طلبات دفع بعد.' },
  amountLine: { en: 'Amount {amount} · paid {paid} · remaining {remaining}', ar: 'المبلغ {amount} · المدفوع {paid} · المتبقي {remaining}' },
  expires: { en: 'Link expires {date}', ar: 'ينتهي الرابط {date}' },
  createdBy: { en: 'Created by {name}', ar: 'أنشأه {name}' },
  cancelledBy: { en: 'Cancelled by {name}: {reason}', ar: 'ألغاه {name}: {reason}' },
  period: { en: '{from} – {to}', ar: '{from} – {to}' },
  cancelRequest: { en: 'Cancel', ar: 'إلغاء' },
  cancelRequestNamed: { en: 'Cancel the request: {label}', ar: 'إلغاء الطلب: {label}' },
  cancelHint: { en: 'The link stops working at once. The request stays in the list, marked cancelled.', ar: 'يتوقف الرابط فورًا. يبقى الطلب في القائمة مُعلَّمًا بأنه ملغى.' },
  cancelConfirm: { en: 'Cancel the request', ar: 'إلغاء الطلب' },

  // Payments received
  received: { en: 'Payments received', ar: 'الدفعات المستلمة' },
  receivedHint: {
    en: 'Every payment, however it arrived. A payment is never edited or deleted: a mistake is voided with a reason, money given back is a refund.',
    ar: 'كل دفعة أيًّا كانت طريقة وصولها. لا تُعدَّل الدفعة ولا تُحذف: يُلغى الخطأ مع السبب، ويُسجَّل المبلغ المُعاد كاسترداد.',
  },
  noPayments: { en: 'No payments yet.', ar: 'لا توجد دفعات بعد.' },
  recordCash: { en: 'Record cash', ar: 'تسجيل نقدًا' },
  recordTitle: { en: 'Record a payment', ar: 'تسجيل دفعة' },
  recordHint: {
    en: 'For money already received. Your name is on the payment and an invoice is issued.',
    ar: 'لمبلغ استُلم بالفعل. يُسجَّل اسمك على الدفعة وتصدر فاتورتها.',
  },
  method: { en: 'Method', ar: 'الطريقة' },
  towards: { en: 'Towards', ar: 'مقابل' },
  towardsNothing: { en: 'Nothing in particular', ar: 'بلا تحديد' },
  towardsRequest: { en: 'Request: {label} ({remaining} remaining)', ar: 'طلب: {label} (المتبقي {remaining})' },
  towardsInstalment: { en: 'Instalment: {label} ({remaining} remaining)', ar: 'قسط: {label} (المتبقي {remaining})' },
  reference: { en: 'Reference', ar: 'المرجع' },
  referenceHint: { en: 'Optional: a receipt book or transfer number.', ar: 'اختياري: رقم دفتر الإيصالات أو التحويل.' },
  record: { en: 'Record', ar: 'تسجيل' },
  paidOnLine: { en: 'Paid {date}', ar: 'دُفع {date}' },
  recordedByLine: { en: 'recorded by {name}', ar: 'سجّله {name}' },
  byStripe: { en: 'confirmed by Stripe', ar: 'أكّده Stripe' },
  refunded: { en: 'refunded {amount}', ar: 'مُسترد {amount}' },
  invoiceNo: { en: 'Invoice {number}', ar: 'فاتورة {number}' },
  voidedLine: { en: 'Voided by {name}: {reason}', ar: 'ألغاه {name}: {reason}' },
  refundLine: { en: 'Refund {amount}, {date} ({source}): {reason}', ar: 'استرداد {amount}، {date} ({source}): {reason}' },
  refundStripe: { en: 'through Stripe', ar: 'عبر Stripe' },
  refundStaff: { en: 'recorded by staff', ar: 'سجّله الموظفون' },
  voidPayment: { en: 'Void', ar: 'إلغاء' },
  voidTitle: { en: 'Void the payment of {amount}', ar: 'إلغاء الدفعة بمبلغ {amount}' },
  voidHint: {
    en: 'For a payment recorded by mistake. It stays in the list, marked voided, and its invoice is voided too. A card payment is refunded instead.',
    ar: 'لدفعة سُجّلت خطأً. تبقى في القائمة مُعلَّمة بأنها ملغاة، وتُلغى فاتورتها كذلك. أما الدفع بالبطاقة فيُسترد بدلًا من ذلك.',
  },
  refund: { en: 'Refund', ar: 'استرداد' },
  refundTitle: { en: 'Refund the payment of {amount}', ar: 'استرداد من الدفعة بمبلغ {amount}' },
  refundHint: {
    en: 'A card payment is refunded through Stripe; anything else records money you gave back. At most {amount}.',
    ar: 'يُسترد الدفع بالبطاقة عبر Stripe، وغيره يُسجّل مبلغًا أعدته. بحد أقصى {amount}.',
  },
  refundAmount: { en: 'Amount to refund', ar: 'المبلغ المسترد' },
  refundTooMuch: { en: 'More than can be refunded on this payment.', ar: 'أكبر مما يمكن استرداده من هذه الدفعة.' },

  // Invoices
  invoices: { en: 'Invoices', ar: 'الفواتير' },
  invoicesHint: { en: 'One per payment, numbered, frozen when issued.', ar: 'فاتورة لكل دفعة، مرقّمة، وثابتة منذ إصدارها.' },
  noInvoices: { en: 'No invoices yet.', ar: 'لا توجد فواتير بعد.' },
  issued: { en: 'Issued {date}', ar: 'صدرت {date}' },
  download: { en: 'Download', ar: 'تنزيل' },
  downloadNamed: { en: 'Download invoice {number}', ar: 'تنزيل الفاتورة {number}' },

  // Receipts on the Parent Profile
  familyReceipts: { en: 'Bank-transfer receipts', ar: 'إيصالات التحويل البنكي' },
  familyReceiptsHint: {
    en: 'Uploaded by the parents in the app. A verifier approves (which records the payment) or rejects with a reason.',
    ar: 'يرفعها أولياء الأمور من التطبيق. يعتمدها المُراجِع (فتُسجَّل الدفعة) أو يرفضها مع السبب.',
  },
  noFamilyReceipts: { en: 'No receipts uploaded.', ar: 'لم تُرفع إيصالات.' },
  reviewInPayments: { en: 'Review in Payments', ar: 'المراجعة في المدفوعات' },

  // Instalment links
  paymentLink: { en: 'Payment link', ar: 'رابط الدفع' },
  instalmentLinkTitle: { en: 'Payment link: {label}', ar: 'رابط الدفع: {label}' },
  instalmentLinkHint: {
    en: 'A link for what this instalment still owes: {amount}.',
    ar: 'رابط لما تبقى من هذا القسط: {amount}.',
  },
  partiallyPaid: { en: 'Partially paid', ar: 'مدفوع جزئيًا' },
  paidRemaining: { en: 'paid {paid} · remaining {remaining}', ar: 'المدفوع {paid} · المتبقي {remaining}' },

  // New Students (before Assign)
  trialAction: { en: 'Payment request', ar: 'طلب دفعة' },
  trialTitle: { en: 'Payments: {name}', ar: 'المدفوعات: {name}' },
  trialHint: {
    en: 'Before the family is assigned. Assign attaches every request, payment and invoice here to the new family.',
    ar: 'قبل إسناد الأسرة. عند الإسناد تُنقل كل الطلبات والدفعات والفواتير هنا إلى الأسرة الجديدة.',
  },
  newRequest: { en: 'New payment request', ar: 'طلب دفع جديد' },
  suggested: { en: 'From the subscription form: {amount}', ar: 'من نموذج الاشتراك: {amount}' },
  subscriptionLabel: { en: 'Subscription', ar: 'الاشتراك' },
  trialPayments: { en: 'Payments received', ar: 'الدفعات المستلمة' },
  trialAssigned: {
    en: 'This student has been assigned. Requests and payments now live on the family’s Parent Profile.',
    ar: 'تم إسناد هذا الطالب. الطلبات والمدفوعات أصبحت في ملف ولي الأمر للأسرة.',
  },
  openParentProfile: { en: 'Find {name} in Parents', ar: 'ابحث عن {name} في أولياء الأمور' },

  // Shared
  required: { en: 'Required.', ar: 'مطلوب.' },
  invalidAmount: { en: 'Enter an amount above zero.', ar: 'أدخل مبلغًا أكبر من صفر.' },
  invalidDays: { en: 'Between 1 and 90.', ar: 'من 1 إلى 90.' },
  periodOrder: { en: 'The period ends before it starts.', ar: 'تنتهي الفترة قبل أن تبدأ.' },
  reason: { en: 'Reason', ar: 'السبب' },
  reasonRequired: { en: 'Say why.', ar: 'اذكر السبب.' },
  save: { en: 'Save', ar: 'حفظ' },
  saving: { en: 'Saving…', ar: 'جارٍ الحفظ…' },
} satisfies Record<string, Pair>

export const PURPOSE_LABEL: Record<RequestPurpose, Pair> = {
  subscription: { en: 'Subscription', ar: 'اشتراك' },
  renewal: { en: 'Renewal', ar: 'تجديد' },
  instalment: { en: 'Instalment', ar: 'قسط' },
  balance: { en: 'Balance', ar: 'رصيد مستحق' },
  other: { en: 'Other', ar: 'أخرى' },
}

export const REQUEST_STATUS: Record<RequestStatus, Pair> = {
  open: { en: 'Open', ar: 'مفتوح' },
  paid: { en: 'Paid', ar: 'مدفوع' },
  cancelled: { en: 'Cancelled', ar: 'ملغى' },
  expired: { en: 'Expired', ar: 'منتهي' },
}

export const METHOD: Record<PaymentMethod, Pair> = {
  card: { en: 'Card', ar: 'بطاقة' },
  bank_transfer: { en: 'Bank transfer', ar: 'تحويل بنكي' },
  cash: { en: 'Cash', ar: 'نقدًا' },
  invoice: { en: 'Invoice', ar: 'فاتورة' },
}

export const RECEIPT_STATUS: Record<ReceiptStatus, Pair> = {
  pending: { en: 'Pending verification', ar: 'بانتظار التحقق' },
  approved: { en: 'Approved', ar: 'معتمد' },
  rejected: { en: 'Rejected', ar: 'مرفوض' },
}

export const INVOICE_STATUS: Record<InvoiceStatus, Pair> = {
  paid: { en: 'Paid', ar: 'مدفوعة' },
  partially_refunded: { en: 'Partially refunded', ar: 'مستردة جزئيًا' },
  refunded: { en: 'Refunded', ar: 'مستردة' },
  void: { en: 'Void', ar: 'ملغاة' },
}

/** Arabic counts days by number: يوم واحد، يومان، 3–10 أيام، 11+ يومًا. */
function arabicDays(n: number): string {
  if (n === 1) return 'بيوم واحد'
  if (n === 2) return 'بيومين'
  if (n >= 3 && n <= 10) return `بـ${n} أيام`
  return `بـ${n} يومًا`
}

/** A reminder rule's offset: "7 days before" / "on the due date" / "3 days after". */
export function reminderLabel(offsetDays: number, locale: 'ar' | 'en'): string {
  const n = Math.abs(offsetDays)
  if (offsetDays === 0) return locale === 'ar' ? 'في يوم الاستحقاق' : 'On the due date'
  if (locale === 'en') return `${n} ${n === 1 ? 'day' : 'days'} ${offsetDays < 0 ? 'before' : 'after'}`
  return `${offsetDays < 0 ? 'قبل الاستحقاق' : 'بعد الاستحقاق'} ${arabicDays(n)}`
}

/** What the link still asks for: the remaining amount, or the whole when nothing is paid. */
export function owed(request: Pick<PaymentRequest, 'amountMinor' | 'remainingMinor' | 'paidMinor'>): number {
  return request.paidMinor > 0 ? request.remainingMinor : request.amountMinor
}

/**
 * `https://wa.me/?text=...`: the staff member picks the chat in their own
 * WhatsApp. One short message in both languages, then the link on its own line
 * so WhatsApp makes it tappable.
 */
export function whatsappUrl(request: PaymentRequest): string {
  const ar = `السلام عليكم، هذا رابط دفع «${request.label}» بمبلغ ${formatMoney(owed(request), request.currency, 'ar')}:`
  const en = `Hello, here is the payment link for “${request.label}” (${formatMoney(owed(request), request.currency, 'en')}):`
  return `https://wa.me/?text=${encodeURIComponent(`${ar}\n${en}\n${request.link ?? ''}`)}`
}

const BY_CODE: Record<string, Pair> = {
  'COMM.BILLING_DENIED': {
    en: 'You may not do this. Payments are for Operations, Sales and the super admin; verifying for the super admin and the Operations Manager.',
    ar: 'لا يمكنك تنفيذ هذا. المدفوعات للعمليات والمبيعات والمدير العام، والتحقق للمدير العام ومدير العمليات.',
  },
  'COMM.BILLING_NOT_FOUND': { en: 'Not found, or not one you look after.', ar: 'غير موجود، أو ليس مما تتابعه.' },
  'COMM.BILLING_STATE': {
    en: 'This was already paid, cancelled, expired or decided. Reload to see it.',
    ar: 'تم دفع هذا أو إلغاؤه أو انتهى أو بُتّ فيه بالفعل. أعد التحميل لرؤيته.',
  },
  'COMM.PAYMENTS_UNAVAILABLE': {
    en: 'Card payments are not configured on this deployment.',
    ar: 'الدفع بالبطاقة غير مُعَد في هذه النسخة.',
  },
}

export function describeError(error: unknown, locale: 'ar' | 'en'): string {
  const pick = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  if (error instanceof ApiError) {
    const known = error.code ? BY_CODE[error.code] : undefined
    if (known) return pick(known)
    return error.localized(locale)
  }
  return pick({ en: 'Something went wrong. Try again.', ar: 'حدث خطأ. حاول مرة أخرى.' })
}

/** Minor units back to what an amount field shows: 125050 AED -> "1250.50". */
export function fromMinor(amountMinor: number, currency: string): string {
  const digits = minorDigits(currency)
  return (amountMinor / 10 ** digits).toFixed(digits)
}
