/**
 * The chat workspace's words, Arabic first. Kept beside the feature rather than
 * in core/i18n/messages.ts so the workspace can be reviewed and merged on its
 * own; the shared dictionary carries only the nav label.
 */
export const chatCopy = {
  ar: {
    title: 'المحادثات',
    empty: 'لا توجد محادثات ضمن مسؤوليتك حالياً.',
    pick: 'اختر محادثة لعرضها.',
    loadOlder: 'عرض الرسائل الأقدم',
    noMessages: 'لا توجد رسائل بعد.',
    placeholder: 'اكتب رسالة… (Enter للإرسال)',
    internalPlaceholder: 'ملاحظة داخلية — لا يراها ولي الأمر ولا المعلم',
    customer: 'رسالة',
    internal: 'ملاحظة داخلية',
    send: 'إرسال',
    sending: 'جارٍ الإرسال…',
    failed: 'لم تُرسل',
    retry: 'إعادة المحاولة',
    discard: 'تجاهل',
    pending: 'بانتظار الموافقة',
    approve: 'موافقة ونشر',
    reject: 'رفض',
    rejectReason: 'سبب الرفض (يراه المرسل)',
    decisionFailed: 'تعذّر تنفيذ القرار',
    rejected: 'مرفوضة',
    deleted: 'حُذفت هذه الرسالة',
    attachment: 'مرفق',
    unread: (n: number) => `${n} غير مقروءة`,
    needsReply: 'بانتظار الرد',
    members: 'المشاركون',
    offline: 'غير متصل بالتحديثات الفورية — تُعرض آخر نسخة محفوظة.',
    kind: {
      direct: 'محادثة مباشرة',
      student_group: 'مجموعة الطالب',
      class_group: 'مجموعة الفصل',
      family_group: 'مجموعة العائلة',
    } as Record<string, string>,
    role: { contact: 'ولي أمر', teacher: 'معلم', staff: 'جوّد', system: 'النظام' } as Record<string, string>,
    system: {
      'group.created': (p: Record<string, unknown>) => `أُنشئت مجموعة الطالب${p.learner ? ` لـ ${String(p.learner)}` : ''}`,
      'group.membership_changed': (p: Record<string, unknown>) =>
        `تحدّث أعضاء المجموعة (+${Number(p.added ?? 0)} / −${Number(p.removed ?? 0)})`,
      'group.archived': () => 'أُرشفت المجموعة',
      fallback: () => 'تحديث من النظام',
    } as Record<string, (p: Record<string, unknown>) => string>,
  },
  en: {
    title: 'Conversations',
    empty: 'No conversations in your charge right now.',
    pick: 'Choose a conversation to open it.',
    loadOlder: 'Show older messages',
    noMessages: 'No messages yet.',
    placeholder: 'Write a message… (Enter to send)',
    internalPlaceholder: 'Internal note — parents and teachers never see it',
    customer: 'Message',
    internal: 'Internal note',
    send: 'Send',
    sending: 'Sending…',
    failed: 'Not sent',
    retry: 'Retry',
    discard: 'Discard',
    pending: 'Awaiting approval',
    approve: 'Approve & publish',
    reject: 'Reject',
    rejectReason: 'Reason for rejecting (the sender sees it)',
    decisionFailed: 'The decision was not applied',
    rejected: 'Rejected',
    deleted: 'This message was deleted',
    attachment: 'Attachment',
    unread: (n: number) => `${n} unread`,
    needsReply: 'Needs reply',
    members: 'Members',
    offline: 'Live updates are disconnected — showing the last loaded state.',
    kind: {
      direct: 'Direct conversation',
      student_group: 'Student Group',
      class_group: 'Class Group',
      family_group: 'Family group',
    } as Record<string, string>,
    role: { contact: 'Parent', teacher: 'Teacher', staff: 'Jawwid', system: 'System' } as Record<string, string>,
    system: {
      'group.created': (p: Record<string, unknown>) => `Student Group created${p.learner ? ` for ${String(p.learner)}` : ''}`,
      'group.membership_changed': (p: Record<string, unknown>) =>
        `Group members updated (+${Number(p.added ?? 0)} / −${Number(p.removed ?? 0)})`,
      'group.archived': () => 'Group archived',
      fallback: () => 'System update',
    } as Record<string, (p: Record<string, unknown>) => string>,
  },
}

export type ChatCopy = (typeof chatCopy)['en']

/** The chat copy for a locale. */
export function chatCopyFor(locale: string): ChatCopy {
  return locale === 'ar' ? (chatCopy.ar as unknown as ChatCopy) : chatCopy.en
}

/**
 * A system message's body is `{ kind, ...facts }` written by the backend; it is
 * rendered, never shown raw. Shared by the chat workspace and the Admin Portal.
 */
export function systemText(body: string | null, copy: ChatCopy): string {
  let parsed: Record<string, unknown> = {}
  try {
    parsed = body ? (JSON.parse(body) as Record<string, unknown>) : {}
  } catch {
    return copy.system.fallback!({})
  }
  const render = copy.system[String(parsed.kind)] ?? copy.system.fallback!
  return render(parsed)
}
