import { ApiError } from '@/core/api/errors'
import type { Pair } from '@/features/organization/copy'
import { formatMoney } from '@/features/instalments/copy'
import { minorDigits } from '@/features/profiles/copy'
import type {
  AttemptFilter,
  AttemptStatus,
  CardAttempt,
  InvoiceStatus,
  PaymentMethod,
  PaymentRequest,
  ReceiptStatus,
  RequestPurpose,
  RequestStatus,
  Transaction,
  TransactionStatus,
} from './api'

export { useCopy, type Pair } from '@/features/organization/copy'
export { formatDay, formatMoney } from '@/features/instalments/copy'
export { toMinor } from '@/features/profiles/copy'

/**
 * PD-27 copy, Arabic and English side by side. Wording rules: a payment is
 * confirmed by the server (Stripe's verified webhook, a recorder's approval,
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
  decideOnly: {
    en: 'Receipts are approved or rejected by the payment recorders: Operations, Sales, the Operations Manager and the super admin.',
    ar: 'يعتمد الإيصالات أو يرفضها مسجّلو المدفوعات: العمليات والمبيعات ومدير العمليات والمدير العام.',
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
  cardPausedBadge: { en: 'Card payments paused', ar: 'الدفع بالبطاقة متوقف مؤقتًا' },
  cardPausedBanner: {
    en: 'Card payments paused. Parents see bank transfer only; payments already made on Stripe are still recorded.',
    ar: 'الدفع بالبطاقة متوقف مؤقتًا. لا يرى أولياء الأمور إلا التحويل البنكي، وما دُفع على Stripe قبل ذلك ما زال يُسجَّل.',
  },
  pauseCard: { en: 'Pause card payments', ar: 'إيقاف الدفع بالبطاقة مؤقتًا' },
  resumeCard: { en: 'Resume card payments', ar: 'استئناف الدفع بالبطاقة' },
  pauseCardTitle: { en: 'Pause card payments?', ar: 'إيقاف الدفع بالبطاقة مؤقتًا؟' },
  pauseCardHint: {
    en: 'From now on no parent can start a card payment, in the app or from a payment link; they are offered bank transfer instead. Payments already made on Stripe, refunds and disputes are still recorded. This change is audited.',
    ar: 'من الآن لن يستطيع أي ولي أمر بدء دفع بالبطاقة، لا في التطبيق ولا من رابط الدفع، ويظهر له التحويل البنكي بدلًا منه. ما دُفع على Stripe قبل ذلك والاستردادات والنزاعات تظل تُسجَّل. يُسجَّل هذا التغيير في سجل التدقيق.',
  },
  resumeCardTitle: { en: 'Resume card payments?', ar: 'استئناف الدفع بالبطاقة؟' },
  resumeCardHint: {
    en: 'Parents can pay by card again, in the app and from payment links. This change is audited.',
    ar: 'سيستطيع أولياء الأمور الدفع بالبطاقة مجددًا في التطبيق ومن روابط الدفع. يُسجَّل هذا التغيير في سجل التدقيق.',
  },
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
  // Store payments policy: the app takes payment only for a verified lesson package.
  lessonPackage: { en: 'Lesson package', ar: 'باقة الدروس' },
  noLessonPackage: { en: 'None: not payable in the app', ar: 'بدون: لا يُدفع في التطبيق' },
  lessonPackagesUnavailable: {
    en: 'The child’s lesson packages could not be loaded. Without one, the family can pay this only outside the app.',
    ar: 'تعذّر تحميل باقات دروس الطفل. وبدون باقة لا يمكن للعائلة دفع هذا إلا خارج التطبيق.',
  },
  lessonPackageOption: { en: 'Lessons: {n} · from {date}', ar: 'الدروس: {n} · من {date}' },
  planInAppHint: {
    en: 'The family can pay this in the app only for a lesson package: enter its lessons, or choose the child’s package.',
    ar: 'لا يمكن للعائلة دفع هذا في التطبيق إلا إذا كان لباقة دروس: أدخل عدد الدروس، أو اختر باقة الطفل.',
  },
  balanceInAppHint: {
    en: 'Choose the child and the lesson package this balance is owed for. Without one, the family can pay it only outside the app.',
    ar: 'اختر الطفل وباقة الدروس المستحق عنها هذا الرصيد. وبدونها لا يمكن للعائلة دفعه إلا خارج التطبيق.',
  },
  packageInAppHint: {
    en: 'Name the child and the lessons. Without them, the family can pay it only outside the app.',
    ar: 'حدّد الطفل وعدد الدروس. وبدونهما لا يمكن للعائلة دفعه إلا خارج التطبيق.',
  },
  otherInAppHint: {
    en: 'Not a lesson package: the family can pay it only outside the app (the payment link or in person).',
    ar: 'ليست باقة دروس: لا يمكن للعائلة دفعها إلا خارج التطبيق (رابط الدفع أو حضوريًا).',
  },
  notPayableInApp: { en: 'Not payable in the app', ar: 'لا يُدفع في التطبيق' },
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
  recordReceived: { en: 'Record a payment', ar: 'تسجيل دفعة مستلمة' },
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
    en: 'Uploaded by the parents in the app. A payment recorder approves (which records the payment) or rejects with a reason.',
    ar: 'يرفعها أولياء الأمور من التطبيق. يعتمدها مسجّل المدفوعات (فتُسجَّل الدفعة) أو يرفضها مع السبب.',
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
    en: 'This student has been assigned. The requests below stay here for reference; new requests, cancellations and payments are made on the family’s Parent Profile.',
    ar: 'تم إسناد هذا الطالب. تبقى الطلبات أدناه هنا للاطلاع، أما الطلبات الجديدة والإلغاء والدفعات فتتم من ملف ولي الأمر للأسرة.',
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

/**
 * PD-27 completion: the transaction ledger -- Transactions, Card attempts and
 * Stripe events (docs/admin/pd027-stripe-lifecycle.md §3.6). Read only; the
 * one act is Reconcile, which asks Stripe and records only what Stripe says.
 */
export const LED = {
  transactionsTab: { en: 'Transactions', ar: 'المعاملات' },
  attemptsTab: { en: 'Card attempts', ar: 'محاولات البطاقة' },
  eventsTab: { en: 'Stripe events', ar: 'أحداث Stripe' },
  filters: { en: 'Filters', ar: 'عوامل التصفية' },
  anyStatus: { en: 'Any status', ar: 'كل الحالات' },
  anyMethod: { en: 'Any method', ar: 'كل الطرق' },
  anyPurpose: { en: 'Anything', ar: 'الكل' },
  anyPlan: { en: 'Any package', ar: 'كل الباقات' },
  planMonths: { en: 'Package', ar: 'الباقة' },
  from: { en: 'Paid from', ar: 'مدفوعة من' },
  to: { en: 'Paid to', ar: 'مدفوعة حتى' },
  search: { en: 'Search: family, child, invoice number or Stripe id', ar: 'بحث: الأسرة أو الطفل أو رقم الفاتورة أو معرّف Stripe' },
  clearSearch: { en: 'Clear the search', ar: 'مسح البحث' },
  clearFilters: { en: 'Clear filters', ar: 'مسح عوامل التصفية' },
  totals: { en: 'Totals', ar: 'الإجماليات' },
  totalsHint: { en: 'Every payment that matches, not only those loaded. A voided payment is counted but adds no money.', ar: 'كل الدفعات المطابقة، لا المعروضة فقط. تُعدّ الدفعة الملغاة ولا يُضاف مبلغها.' },
  count: { en: 'Payments', ar: 'الدفعات' },
  totalAmount: { en: 'Received', ar: 'المستلم' },
  totalRefunded: { en: 'Refunded', ar: 'المسترد' },
  net: { en: 'Net', ar: 'الصافي' },
  noTransactions: { en: 'No payments match.', ar: 'لا توجد دفعات مطابقة.' },
  transactions: { en: 'Transactions', ar: 'المعاملات' },
  colFamily: { en: 'Family', ar: 'الأسرة' },
  colChild: { en: 'Child', ar: 'الطفل' },
  colFor: { en: 'For', ar: 'عن' },
  colMethod: { en: 'Method', ar: 'الطريقة' },
  colAmount: { en: 'Amount', ar: 'المبلغ' },
  colRefunded: { en: 'Refunded', ar: 'المسترد' },
  colStatus: { en: 'Status', ar: 'الحالة' },
  colPaidOn: { en: 'Paid on', ar: 'تاريخ الدفع' },
  colInvoice: { en: 'Invoice', ar: 'الفاتورة' },
  beforeAssign: { en: 'New student (not assigned yet)', ar: 'طالب جديد (لم يُسنَد بعد)' },
  details: { en: 'Details', ar: 'التفاصيل' },
  detailsNamed: { en: 'Details of the payment of {amount}, {date}', ar: 'تفاصيل الدفعة بمبلغ {amount}، {date}' },
  loadMore: { en: 'Load more', ar: 'تحميل المزيد' },
  loading: { en: 'Loading…', ar: 'جارٍ التحميل…' },

  // Detail
  detailTitle: { en: 'Payment of {amount}', ar: 'دفعة بمبلغ {amount}' },
  summary: { en: 'Payment', ar: 'الدفعة' },
  recordedAt: { en: 'Recorded', ar: 'تاريخ التسجيل' },
  recordedBy: { en: 'Recorded by', ar: 'سجّلها' },
  stripe: { en: 'Stripe', ar: 'Stripe' },
  voided: { en: 'Voided', ar: 'أُلغيت' },
  stripeRefs: { en: 'Stripe references', ar: 'مراجع Stripe' },
  checkoutSession: { en: 'Checkout session', ar: 'جلسة الدفع' },
  paymentIntent: { en: 'Payment intent', ar: 'نية الدفع' },
  charge: { en: 'Charge', ar: 'عملية الخصم' },
  customer: { en: 'Customer', ar: 'العميل' },
  testMode: { en: 'Test mode', ar: 'وضع الاختبار' },
  copy: { en: 'Copy', ar: 'نسخ' },
  copyNamed: { en: 'Copy {label}', ar: 'نسخ {label}' },
  copyValueFailed: { en: 'Could not copy. Select it and copy.', ar: 'تعذّر النسخ. حدّده وانسخه.' },
  refunds: { en: 'Refunds', ar: 'الاستردادات' },
  noRefunds: { en: 'No refunds.', ar: 'لا توجد استردادات.' },
  refundBy: { en: 'recorded by {name}', ar: 'سجّله {name}' },
  request: { en: 'Payment request', ar: 'طلب الدفع' },
  noRequest: { en: 'Not paid against a request.', ar: 'لم تُدفع مقابل طلب.' },
  attempts: { en: 'Card attempts', ar: 'محاولات البطاقة' },
  noAttempts: { en: 'No card attempts.', ar: 'لا توجد محاولات بالبطاقة.' },
  attemptOpened: { en: 'Opened {date}', ar: 'فُتحت {date}' },
  declines: { en: 'Declines: {n}', ar: 'مرات الرفض: {n}' },
  lastFailed: { en: 'Last failed', ar: 'آخر إخفاق' },
  lastFailedAt: { en: 'last failed {date}', ar: 'آخر إخفاق {date}' },
  events: { en: 'Webhook events', ar: 'أحداث الـWebhook' },
  noEvents: { en: 'No webhook events.', ar: 'لا توجد أحداث Webhook.' },
  reconcile: { en: 'Reconcile with Stripe', ar: 'مطابقة مع Stripe' },
  reconciling: { en: 'Asking Stripe…', ar: 'جارٍ سؤال Stripe…' },
  reconcileHint: {
    en: 'Compares this payment with Stripe’s own numbers. A refund Stripe made that is missing here is recorded; nothing else changes.',
    ar: 'يقارن هذه الدفعة بأرقام Stripe نفسها. يُسجَّل أي استرداد أجراه Stripe ولا يظهر هنا، ولا يتغير شيء غير ذلك.',
  },
  inSync: { en: 'In sync with Stripe.', ar: 'مطابقة لـStripe.' },
  outOfSync: { en: 'Chat and Stripe differ.', ar: 'تختلف Chat عن Stripe.' },
  chatSide: { en: 'Chat', ar: 'Chat' },
  stripeSide: { en: 'Stripe', ar: 'Stripe' },
  stripeStatus: { en: 'Stripe status', ar: 'الحالة في Stripe' },
  amountReceived: { en: 'Amount', ar: 'المبلغ' },
  amountRefunded: { en: 'Refunded', ar: 'المسترد' },
  refundsRecorded: { en: 'Refunds recorded now: {n}', ar: 'استردادات سُجّلت الآن: {n}' },

  // Card attempts
  attemptsHint: {
    en: 'Each time a parent opened card payment. “Failed” covers declined cards, failed payments and links left unpaid until they expired.',
    ar: 'كل مرة فتح فيها ولي الأمر الدفع بالبطاقة. تشمل «المتعثرة» البطاقات المرفوضة والدفعات الفاشلة والروابط التي انتهت دون دفع.',
  },
  noCardAttempts: { en: 'No card attempts here.', ar: 'لا توجد محاولات بطاقة هنا.' },
  colRequest: { en: 'Request', ar: 'الطلب' },
  colTries: { en: 'Declines', ar: 'مرات الرفض' },
  colWhy: { en: 'Why', ar: 'السبب' },
  colPaid: { en: 'Paid', ar: 'مدفوعة' },
  yes: { en: 'Yes', ar: 'نعم' },
  no: { en: 'No', ar: 'لا' },
  rawCode: { en: 'Stripe code', ar: 'رمز Stripe' },

  // Stripe events
  eventsHint: {
    en: 'Every verified message Stripe sent, and what Chat did with it. The body is never kept.',
    ar: 'كل رسالة موثّقة أرسلها Stripe وما فعلته Chat بها. لا يُحفظ محتوى الرسالة أبدًا.',
  },
  outcome: { en: 'Outcome', ar: 'النتيجة' },
  anyOutcome: { en: 'Any outcome', ar: 'كل النتائج' },
  type: { en: 'Event type', ar: 'نوع الحدث' },
  anyType: { en: 'Any type', ar: 'كل الأنواع' },
  colReceived: { en: 'Received', ar: 'وقت الاستلام' },
  colType: { en: 'Type', ar: 'النوع' },
  colOutcome: { en: 'Outcome', ar: 'النتيجة' },
  colObject: { en: 'Stripe object', ar: 'كائن Stripe' },
  colMode: { en: 'Mode', ar: 'الوضع' },
  live: { en: 'Live', ar: 'حقيقي' },
  noStripeEvents: { en: 'No Stripe events here.', ar: 'لا توجد أحداث Stripe هنا.' },
  reconcileNow: { en: 'Reconcile now', ar: 'المطابقة الآن' },
  reconcileNowHint: {
    en: 'Asks Stripe about card attempts left open, and syncs refunds that arrived before their payment. It also runs by itself every few minutes.',
    ar: 'يسأل Stripe عن محاولات البطاقة التي بقيت مفتوحة، ويزامن الاستردادات التي وصلت قبل دفعتها. ويعمل تلقائيًا كل بضع دقائق أيضًا.',
  },
  sweepChecked: { en: 'Checked', ar: 'فُحصت' },
  sweepRecorded: { en: 'Payments recorded', ar: 'دفعات سُجّلت' },
  sweepExpired: { en: 'Marked expired', ar: 'عُلّمت منتهية' },
  sweepRefunds: { en: 'Refunds recorded', ar: 'استردادات سُجّلت' },
  sweepErrors: { en: 'Errors', ar: 'أخطاء' },
  sweepDone: { en: 'Reconciled with Stripe.', ar: 'تمت المطابقة مع Stripe.' },
} satisfies Record<string, Pair>

export const TRANSACTION_STATUS: Record<TransactionStatus, Pair> = {
  standing: { en: 'Paid', ar: 'مدفوعة' },
  partially_refunded: { en: 'Partially refunded', ar: 'مستردة جزئيًا' },
  refunded: { en: 'Refunded', ar: 'مستردة' },
  voided: { en: 'Voided', ar: 'ملغاة' },
}

export const ATTEMPT_FILTER: Record<AttemptFilter, Pair> = {
  failed: { en: 'Failed', ar: 'متعثرة' },
  open: { en: 'Open', ar: 'مفتوحة' },
  expired: { en: 'Expired', ar: 'منتهية' },
  complete: { en: 'Complete', ar: 'مكتملة' },
  all: { en: 'All', ar: 'الكل' },
}

export const ATTEMPT_STATUS: Record<AttemptStatus, Pair> = {
  open: { en: 'Open', ar: 'مفتوحة' },
  complete: { en: 'Complete', ar: 'مكتملة' },
  expired: { en: 'Expired', ar: 'منتهية' },
  failed: { en: 'Failed', ar: 'فشلت' },
}

/** apps/api/src/billing/checkout.service.ts WebhookOutcome; an unknown one shows as sent. */
export const EVENT_OUTCOME: Record<string, Pair> = {
  recorded: { en: 'Payment recorded', ar: 'سُجّلت الدفعة' },
  duplicate: { en: 'Duplicate delivery', ar: 'تسليم مكرر' },
  already_recorded: { en: 'Already recorded', ar: 'مسجّلة من قبل' },
  awaiting_payment: { en: 'Awaiting payment', ar: 'بانتظار الدفع' },
  unknown_session: { en: 'Unknown session', ar: 'جلسة غير معروفة' },
  mismatch: { en: 'Amount mismatch', ar: 'المبلغ غير مطابق' },
  checkout_expired: { en: 'Attempt expired', ar: 'انتهت المحاولة' },
  checkout_failed: { en: 'Attempt failed', ar: 'فشلت المحاولة' },
  refund_recorded: { en: 'Refund recorded', ar: 'سُجّل الاسترداد' },
  refund_deferred: { en: 'Refund waiting for its payment', ar: 'استرداد بانتظار دفعته' },
  refund_not_final: { en: 'Refund not final', ar: 'استرداد غير نهائي' },
  payment_failed: { en: 'Card declined', ar: 'رُفضت البطاقة' },
  ignored_not_chat: { en: 'Ignored: not from Chat', ar: 'تُجوهل: ليس من Chat' },
  ignored: { en: 'Ignored', ar: 'تُجوهل' },
}

/** The event types Chat acts on (§3.2), offered as the type filter; the server matches a prefix. */
export const EVENT_TYPES: readonly string[] = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'refund.created',
  'refund.updated',
  'charge.refunded',
  'invoice.',
  'customer.subscription.',
]

/**
 * apps/api/src/billing/card-failure.ts, the same kinds, worded for staff. Codes
 * that would alarm or accuse (lost_card, stolen_card, fraudulent, ...) read as
 * the generic decline; staff see the raw code beside it.
 */
export type CardFailureKind = 'insufficient_funds' | 'expired_card' | 'incorrect_cvc' | 'incorrect_number' | 'authentication' | 'processing_error' | 'declined'

export function cardFailureKind(code: string | null | undefined): CardFailureKind {
  switch (code) {
    case 'insufficient_funds':
      return 'insufficient_funds'
    case 'expired_card':
      return 'expired_card'
    case 'incorrect_cvc':
    case 'invalid_cvc':
      return 'incorrect_cvc'
    case 'incorrect_number':
    case 'invalid_number':
      return 'incorrect_number'
    case 'authentication_required':
    case 'payment_intent_authentication_failure':
      return 'authentication'
    case 'processing_error':
      return 'processing_error'
    default:
      return 'declined'
  }
}

export const CARD_FAILURE: Record<CardFailureKind, Pair> = {
  insufficient_funds: { en: 'The bank declined it for insufficient funds.', ar: 'رفض البنك الدفع لعدم كفاية الرصيد.' },
  expired_card: { en: 'The card has expired.', ar: 'البطاقة منتهية الصلاحية.' },
  incorrect_cvc: { en: 'The security code (CVC) was incorrect.', ar: 'رمز التحقق (CVC) غير صحيح.' },
  incorrect_number: { en: 'The card number was incorrect.', ar: 'رقم البطاقة غير صحيح.' },
  authentication: { en: 'The bank’s verification (3D Secure) was not completed.', ar: 'لم يكتمل تحقق البنك (3D Secure).' },
  processing_error: { en: 'There was an error processing the card.', ar: 'حدث خطأ أثناء معالجة البطاقة.' },
  declined: { en: 'The bank declined the card.', ar: 'رفض البنك الدفع بالبطاقة.' },
}

/** Why an attempt failed, or null when it did not: a decline's kind, else its status. */
export function attemptFailure(a: Pick<CardAttempt, 'failureCode' | 'failureCount' | 'status'>): Pair | null {
  if (a.failureCode || a.failureCount > 0) return CARD_FAILURE[cardFailureKind(a.failureCode)]
  if (a.status === 'failed') return { en: 'The payment failed.', ar: 'فشل الدفع.' }
  if (a.status === 'expired') return { en: 'Left unpaid until it expired.', ar: 'انتهت دون دفع.' }
  return null
}

const BRAND: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  diners: 'Diners Club',
  jcb: 'JCB',
  unionpay: 'UnionPay',
}
const WALLET: Record<string, string> = { apple_pay: 'Apple Pay', google_pay: 'Google Pay', link: 'Link' }

/** "Visa •••• 4242 (Apple Pay)"; null when Stripe told us nothing about the card. */
export function cardLabel(card: Transaction['card']): string | null {
  if (!card || (!card.brand && !card.last4)) return null
  const brand = card.brand ? (BRAND[card.brand] ?? card.brand.charAt(0).toUpperCase() + card.brand.slice(1)) : ''
  const last4 = card.last4 ? `•••• ${card.last4}` : ''
  const wallet = card.wallet ? ` (${WALLET[card.wallet] ?? card.wallet})` : ''
  return `${[brand, last4].filter(Boolean).join(' ')}${wallet}`
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
    en: 'You may not do this. Payments are for Operations, Sales and the super admin; refunds and payment settings for the super admin and the Operations Manager.',
    ar: 'لا يمكنك تنفيذ هذا. المدفوعات للعمليات والمبيعات والمدير العام، والاسترداد وإعدادات الدفع للمدير العام ومدير العمليات.',
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
