import type { Pair } from '@/features/organization/copy'
import type { ReportReasonOrBlocked, ReportStatus, Resolution, SubjectKind } from './api'

export { useCopy, type Pair } from '@/features/organization/copy'

/**
 * WP-1C copy, Arabic first (primary), then English. The five reason labels are
 * the DRAFT wording of roadmap §5.1, PENDING OWNER APPROVAL (N-4): do not treat
 * them as final, and change them here only.
 */
export const REASON_LABELS_PENDING_OWNER_APPROVAL = true

export const REASON: Record<ReportReasonOrBlocked, Pair> = {
  harassment: { ar: 'تحرّش أو تنمّر', en: 'Harassment or bullying' },
  inappropriate: { ar: 'محتوى غير لائق أو جنسي', en: 'Inappropriate or sexual content' },
  spam: { ar: 'رسائل مزعجة أو احتيال', en: 'Spam or scam' },
  child_safety: { ar: 'سلامة طفل', en: "A child's safety" },
  other: { ar: 'سبب آخر (مع ملاحظة)', en: 'Something else (a note is required)' },
  blocked: { ar: 'حظر', en: 'Block' },
}

export const STATUS: Record<ReportStatus, Pair> = {
  open: { ar: 'مفتوح', en: 'Open' },
  in_review: { ar: 'قيد المراجعة', en: 'In review' },
  actioned: { ar: 'تم اتخاذ إجراء', en: 'Actioned' },
  dismissed: { ar: 'مرفوض', en: 'Dismissed' },
}

export const RESOLUTION: Record<Resolution, Pair> = {
  no_action: { ar: 'لا إجراء', en: 'No action' },
  message_removed: { ar: 'حذف الرسالة للجميع', en: 'Remove the message for everyone' },
  warned: { ar: 'تحذير', en: 'Warn' },
  account_suspended: { ar: 'إيقاف الحساب', en: 'Suspend the account' },
  reassigned: { ar: 'إعادة إسناد (تتم في الأدوات الحالية)', en: 'Reassign (done in the existing tools)' },
}

/** What each resolution does on the server (closure plan §4). */
export const RESOLUTION_HELP: Record<Resolution, Pair> = {
  no_action: { ar: 'يُرفض البلاغ ولا يُتخذ أي إجراء آخر.', en: 'The report is dismissed; nothing else happens.' },
  message_removed: { ar: 'تُحذف الرسالة للجميع (لبلاغات الرسائل فقط).', en: 'The message is deleted for everyone (message reports only).' },
  warned: {
    ar: 'يتلقى الشخص المُبلَّغ عنه تذكيرًا بمدونة السلوك، دون ذكر أي بلاغ أو مُبلِّغ.',
    en: 'The reported person gets a Code of Conduct reminder that never mentions a report or a reporter.',
  },
  account_suspended: {
    ar: 'يُوقف حساب الشخص المُبلَّغ عنه. يتطلب صلاحية إدارة الحسابات، والملاحظة مطلوبة.',
    en: "The reported person's account is suspended. Needs the account administration permission; a note is required.",
  },
  reassigned: {
    ar: 'تُنشأ مهمة إعادة إسناد لمديري الأقسام المعنية، وتتم الإعادة في أدوات الإشراف الحالية. الملاحظة مطلوبة.',
    en: "A reassignment task is raised for the departments' managers; the change itself is made in the supervision tools. A note is required.",
  },
}

/** The reported person's kind (closure plan §4 `subject.kind`). */
export const SUBJECT_KIND: Record<SubjectKind, Pair> = {
  contact: { ar: 'ولي أمر', en: 'Parent' },
  teacher: { ar: 'معلّم', en: 'Teacher' },
  staff: { ar: 'موظف', en: 'Staff' },
}

export const MOD = {
  navLabel: { ar: 'البلاغات', en: 'Reports' },
  title: { ar: 'قائمة البلاغات', en: 'Moderation queue' },
  subtitle: {
    ar: 'الحالات العاجلة أولًا، ثم الأقرب موعدًا. الرد على المُبلِّغ خلال ٢٤ ساعة.',
    en: 'Urgent first, then by time left. The reporter is answered within 24 hours.',
  },
  draftNote: { ar: 'تسميات الأسباب مسودّة بانتظار اعتماد المالك.', en: 'Reason labels are drafts pending owner approval.' },
  filterStatus: { ar: 'تصفية حسب الحالة', en: 'Filter by status' },
  filterReason: { ar: 'تصفية حسب السبب', en: 'Filter by reason' },
  anyStatus: { ar: 'كل الحالات', en: 'Any status' },
  anyReason: { ar: 'كل الأسباب', en: 'Any reason' },
  childSafetyOnly: { ar: 'سلامة الطفل فقط', en: 'Child safety only' },
  overdueOnly: { ar: 'المتأخرة فقط', en: 'Overdue only' },
  empty: { ar: 'لا توجد بلاغات مطابقة.', en: 'No matching reports.' },
  colReason: { ar: 'السبب', en: 'Reason' },
  colTarget: { ar: 'المُبلَّغ عنه', en: 'Reported' },
  colStatus: { ar: 'الحالة', en: 'Status' },
  colDue: { ar: 'الموعد', en: 'Due' },
  colFiled: { ar: 'وقت البلاغ', en: 'Filed' },
  colActions: { ar: 'إجراءات', en: 'Actions' },
  targetMessage: { ar: 'رسالة', en: 'Message' },
  targetPerson: { ar: 'شخص', en: 'Person' },
  childSafetyBadge: { ar: 'سلامة طفل: عاجل', en: 'Child safety: urgent' },
  overdueBadge: { ar: 'متأخر', en: 'Overdue' },
  left: { ar: 'متبقّي {h} س {m} د', en: '{h} h {m} min left' },
  past: { ar: 'متأخر {h} س {m} د', en: '{h} h {m} min overdue' },
  closed: { ar: 'مغلق', en: 'Closed' },
  answered: { ar: 'تم الرد على المُبلِّغ', en: 'Reporter answered' },
  notAnswered: { ar: 'لم يُرَدّ بعد', en: 'Not answered yet' },
  view: { ar: 'عرض', en: 'View' },
  take: { ar: 'استلام (إسناد لي)', en: 'Take (assign to me)' },
  takenBy: { ar: 'استلمه {name}', en: 'Taken by {name}' },
  resolve: { ar: 'إغلاق والرد', en: 'Resolve and answer' },
  alreadyTaken: { ar: 'استلمه موظف آخر للتو.', en: 'Someone else has just taken this report.' },
  closedAlready: { ar: 'هذا البلاغ مغلق بالفعل.', en: 'This report is already closed.' },
  detailTitle: { ar: 'تفاصيل البلاغ', en: 'Report details' },
  detailAudited: { ar: 'فتح هذا البلاغ يُسجَّل في سجل التدقيق.', en: 'Opening this report is recorded in the audit log.' },
  note: { ar: 'ملاحظة المُبلِّغ', en: "Reporter's note" },
  evidence: { ar: 'الدليل (لقطة وقت البلاغ)', en: 'Evidence (snapshot at report time)' },
  evidenceBody: { ar: 'النص', en: 'Text' },
  evidenceAuthor: { ar: 'كاتب الرسالة', en: 'Author' },
  evidenceSent: { ar: 'أُرسلت', en: 'Sent' },
  evidenceDeleted: { ar: 'حُذفت من قبل صاحبها، ولا تزال محفوظة هنا.', en: 'Deleted by its author, still kept here.' },
  evidenceAttachments: { ar: 'مرفقات: {n}', en: 'Attachments: {n}' },
  noEvidence: { ar: 'لا يوجد دليل.', en: 'No evidence.' },
  resolutionLabel: { ar: 'القرار', en: 'Resolution' },
  resolutionNote: { ar: 'ملاحظة داخلية (اختياري)', en: 'Internal note (optional)' },
  resolutionNoteRequired: { ar: 'ملاحظة داخلية (مطلوبة)', en: 'Internal note (required)' },
  noteRequired: { ar: 'الملاحظة الداخلية مطلوبة لهذا القرار.', en: 'An internal note is required for this resolution.' },
  noSuspendPermission: { ar: 'ليس لديك صلاحية إيقاف الحسابات.', en: "You don't have permission to suspend accounts." },
  notAvailable: { ar: 'هذا البلاغ غير متاح لك، أو لم يعد موجودًا.', en: 'This report is not available to you, or no longer exists.' },
  subject: { ar: 'الشخص المُبلَّغ عنه', en: 'Reported person' },
  viewAttachment: { ar: 'عرض المرفق {name}', en: 'View attachment {name}' },
  childSafetyWarnTitle: { ar: 'تنبيه: محتوى يخص سلامة طفل', en: "Warning: child-safety content" },
  childSafetyWarnBody: {
    ar: 'قد يحتوي هذا المرفق على مواد مؤذية. سيُفتح في علامة تبويب جديدة ويُسجَّل فتحه في سجل التدقيق. لا تنزّله ولا تشاركه.',
    en: 'This attachment may contain harmful material. It opens in a new tab and the view is recorded in the audit log. Do not download or share it.',
  },
  childSafetyContinue: { ar: 'متابعة وفتح المرفق', en: 'Continue and open' },
  answerLabel: { ar: 'الرد على المُبلِّغ', en: 'Answer to the reporter' },
  answerHint: {
    ar: 'مطلوب. سيراه المُبلِّغ وحده، ولن يعرف الشخص المُبلَّغ عنه بوجود بلاغ. حتى ١٠٠٠ حرف.',
    en: 'Required. Only the reporter sees it; the reported person is never told. Up to 1000 characters.',
  },
  answerRequired: { ar: 'الرد على المُبلِّغ مطلوب لإغلاق البلاغ.', en: 'An answer to the reporter is required to close the report.' },
  submitResolve: { ar: 'إغلاق البلاغ وإرسال الرد', en: 'Close the report and send the answer' },
  cancel: { ar: 'إلغاء', en: 'Cancel' },
  close: { ar: 'إغلاق النافذة', en: 'Close' },
  resolvedAnswer: { ar: 'الرد المُرسَل', en: 'Answer sent' },
} satisfies Record<string, Pair>
