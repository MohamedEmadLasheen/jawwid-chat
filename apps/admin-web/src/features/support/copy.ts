import { ApiError } from '@/core/api/errors'
import type { Pair } from '@/features/organization/copy'

export { useCopy, type Pair } from '@/features/organization/copy'

/**
 * PD-20 support-session copy, Arabic and English side by side. Wording rule:
 * the administrator is never told they ARE the person -- they act as them,
 * on the record, and what they send says so.
 */
export const S = {
  open: { en: 'Open as {name}', ar: 'الدخول بحساب {name}' },
  startTitle: { en: 'Open {name}\'s account', ar: 'فتح حساب {name}' },
  startExplain: {
    en: 'You will see the app as {name} sees it, for up to an hour. Everything you do is recorded with your name and this reason. Messages you send are labelled "Sent by support" to everyone who reads them.',
    ar: 'سترى التطبيق كما يراه {name} لمدة أقصاها ساعة. يُسجَّل كل ما تفعله باسمك ومع هذا السبب. الرسائل التي ترسلها تظهر لكل من يقرؤها بعلامة «أرسلها الدعم».',
  },
  start: { en: 'Open the account', ar: 'فتح الحساب' },
  reason: { en: 'Reason', ar: 'السبب' },

  banner: { en: 'Support session: acting as {name} ({kind})', ar: 'جلسة دعم: تتصرف بحساب {name} ({kind})' },
  until: { en: 'Until {time}', ar: 'حتى {time}' },
  extend: { en: 'Keep working', ar: 'متابعة العمل' },
  exit: { en: 'Exit', ar: 'خروج' },
  ended: { en: 'This support session has ended.', ar: 'انتهت جلسة الدعم هذه.' },
  backToAccounts: { en: 'Back to Accounts', ar: 'العودة إلى الحسابات' },

  tabChats: { en: 'Chats', ar: 'المحادثات' },
  tabProfile: { en: 'Profile', ar: 'الملف الشخصي' },
  noChats: { en: 'No chats.', ar: 'لا توجد محادثات.' },
  pickChat: { en: 'Choose a chat.', ar: 'اختر محادثة.' },
  noMessages: { en: 'No messages yet.', ar: 'لا توجد رسائل بعد.' },
  untitled: { en: 'Chat', ar: 'محادثة' },
  write: { en: 'Write a message', ar: 'اكتب رسالة' },
  send: { en: 'Send', ar: 'إرسال' },
  labelNote: {
    en: 'Sent as {name}, labelled "Sent by support" for everyone.',
    ar: 'تُرسل باسم {name} مع علامة «أرسلها الدعم» للجميع.',
  },
  sentBySupport: { en: 'Sent by support', ar: 'أرسلها الدعم' },
  readOnlyHint: {
    en: 'Reading here sends no read receipt and does not mark anything as read for {name}.',
    ar: 'القراءة هنا لا ترسل إشعار قراءة ولا تعلّم أي شيء كمقروء لدى {name}.',
  },

  name: { en: 'Name', ar: 'الاسم' },
  about: { en: 'About', ar: 'نبذة' },
  children: { en: 'Children', ar: 'الأطفال' },
  save: { en: 'Save', ar: 'حفظ' },
  saved: { en: 'Saved.', ar: 'تم الحفظ.' },
  teacherProfileHint: {
    en: 'A teacher\'s professional profile is edited from the Teacher File.',
    ar: 'يُعدَّل الملف المهني للمعلم من ملف المعلم.',
  },

  recordTitle: { en: 'Support sessions', ar: 'جلسات الدعم' },
  recordBy: { en: 'By', ar: 'بواسطة' },
  recordStarted: { en: 'Started', ar: 'البداية' },
  recordEnded: { en: 'Ended', ar: 'النهاية' },
  recordActions: { en: 'Requests', ar: 'الطلبات' },
  recordLive: { en: 'Live', ar: 'جارية' },
  noRecord: { en: 'No support sessions yet.', ar: 'لا توجد جلسات دعم بعد.' },
} satisfies Record<string, Pair>

export const KIND_LABEL: Record<'family' | 'teacher', Pair> = {
  family: { en: 'parent', ar: 'ولي أمر' },
  teacher: { en: 'teacher', ar: 'معلم' },
}

const BY_CODE: Record<string, Pair> = {
  'COMM.SUPPORT_SESSION_FORBIDDEN': {
    en: 'Not allowed in a support session: it would act in their name where others see it.',
    ar: 'غير مسموح في جلسة الدعم: سيظهر للآخرين كأنه منه.',
  },
  'COMM.IMPERSONATION_ENDED': { en: 'This support session has ended.', ar: 'انتهت جلسة الدعم هذه.' },
  'COMM.IMPERSONATION_NOT_FOUND': { en: 'This support session is not yours or no longer exists.', ar: 'جلسة الدعم هذه ليست لك أو لم تعد موجودة.' },
  'COMM.ACCOUNT_ADMIN_DENIED': { en: 'You may not open this account.', ar: 'لا يمكنك فتح هذا الحساب.' },
  'COMM.ACCOUNT_ADMIN_STATE': { en: 'This account cannot sign in, so it cannot be opened.', ar: 'هذا الحساب لا يمكنه تسجيل الدخول، لذا لا يمكن فتحه.' },
}

export function describeError(error: unknown, locale: 'ar' | 'en'): string {
  const pick = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  if (error instanceof ApiError) {
    const known = BY_CODE[error.code]
    if (known) return pick(known)
    if (error.isUnauthenticated) return pick(S.ended)
    return error.localized(locale)
  }
  return pick({ en: 'Something went wrong. Try again.', ar: 'حدث خطأ. حاول مرة أخرى.' })
}

/** A support session is over when the server says so -- ended, expired, or its token refused. */
export function isEnded(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'COMM.IMPERSONATION_ENDED' || error.code === 'COMM.IMPERSONATION_NOT_FOUND' || error.isUnauthenticated)
}
