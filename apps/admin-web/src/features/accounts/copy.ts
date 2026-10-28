import { ApiError } from '@/core/api/errors'
import type { Pair } from '@/features/organization/copy'
import type { AccountKind, AccountStatus } from './api'

export { useCopy, type Pair } from '@/features/organization/copy'

/**
 * PD-21 copy, Arabic and English side by side. Wording rule: nothing here
 * suggests the administrator can see or choose anyone's password -- they hand
 * over a one-time code, and the person chooses.
 */
export const A = {
  title: { en: 'Accounts', ar: 'الحسابات' },
  subtitle: {
    en: 'Reset a password or set an account inactive. Every action needs a reason and is recorded.',
    ar: 'أعد تعيين كلمة المرور أو أوقف حسابًا. يتطلب كل إجراء سببًا ويُسجَّل.',
  },
  search: { en: 'Search a person, a family or a student', ar: 'ابحث عن شخص أو أسرة أو طالب' },
  show: { en: 'Show', ar: 'عرض' },
  all: { en: 'All', ar: 'الكل' },
  person: { en: 'Account', ar: 'الحساب' },
  status: { en: 'Status', ar: 'الحالة' },
  lastLogin: { en: 'Last sign-in', ar: 'آخر تسجيل دخول' },
  actions: { en: 'Actions', ar: 'الإجراءات' },
  never: { en: 'Never', ar: 'لم يسجّل الدخول' },
  noLogin: { en: 'No password yet', ar: 'لا توجد كلمة مرور بعد' },
  locked: { en: 'Locked', ar: 'مقفل مؤقتًا' },
  children: { en: 'Children: {names}', ar: 'الأطفال: {names}' },
  empty: { en: 'No accounts to show.', ar: 'لا توجد حسابات لعرضها.' },
  noneAdministered: {
    en: 'Your department does not administer accounts. Ask the Operations or Teachers department.',
    ar: 'قسمك لا يدير الحسابات. تواصل مع قسم العمليات أو قسم المعلمين.',
  },
  truncated: { en: 'Showing the first 100. Search to narrow the list.', ar: 'تُعرض أول 100 نتيجة. ابحث لتضييق القائمة.' },

  resetPassword: { en: 'Reset password', ar: 'إعادة تعيين كلمة المرور' },
  suspend: { en: 'Set inactive', ar: 'إيقاف الحساب' },
  reactivate: { en: 'Reactivate', ar: 'إعادة التفعيل' },
  reason: { en: 'Reason', ar: 'السبب' },

  resetTitle: { en: 'Reset the password of {name}', ar: 'إعادة تعيين كلمة مرور {name}' },
  resetExplain: {
    en: 'You will get a one-time code to give to {name}. They type it in the app with a new password of their own. You never see a password.',
    ar: 'ستحصل على رمز لمرة واحدة لتعطيه إلى {name}، فيكتبه في التطبيق مع كلمة مرور جديدة يختارها بنفسه. لن ترى أي كلمة مرور.',
  },
  signOutEverywhere: {
    en: 'Also sign them out on every device now (use this if the account may be compromised)',
    ar: 'تسجيل الخروج من كل الأجهزة الآن أيضًا (استخدمه إذا كان الحساب قد يكون مخترقًا)',
  },
  issue: { en: 'Get the code', ar: 'احصل على الرمز' },
  codeTitle: { en: 'One-time code for {name}', ar: 'رمز لمرة واحدة لـ {name}' },
  codeExplain: {
    en: 'Give this code to {name} now. It works once, for {minutes} minutes. It will not be shown again.',
    ar: 'أعطِ هذا الرمز إلى {name} الآن. يعمل مرة واحدة ولمدة {minutes} دقائق، ولن يظهر مرة أخرى.',
  },
  codeHow: {
    en: 'In the app: "Forgot password? I have a code", then the login, this code and a new password.',
    ar: 'في التطبيق: «نسيت كلمة المرور؟ لديّ رمز»، ثم بيانات الدخول وهذا الرمز وكلمة مرور جديدة.',
  },
  signedOut: { en: 'Signed out of {n} session(s).', ar: 'تم تسجيل الخروج من {n} جلسة.' },
  copy: { en: 'Copy code', ar: 'نسخ الرمز' },
  copied: { en: 'Copied', ar: 'تم النسخ' },
  done: { en: 'Done', ar: 'تم' },

  suspendTitle: { en: 'Set {name} inactive', ar: 'إيقاف حساب {name}' },
  suspendExplain: {
    en: '{name} is signed out everywhere at once and cannot sign in until the account is reactivated.',
    ar: 'سيُسجَّل خروج {name} من كل الأجهزة فورًا، ولن يتمكن من تسجيل الدخول حتى يُعاد تفعيل الحساب.',
  },
  reactivateTitle: { en: 'Reactivate {name}', ar: 'إعادة تفعيل حساب {name}' },
  reactivateExplain: {
    en: '{name} can sign in again. Earlier sessions stay ended: they sign in afresh.',
    ar: 'سيتمكن {name} من تسجيل الدخول مجددًا. تبقى الجلسات السابقة منتهية، فيسجّل الدخول من جديد.',
  },
} satisfies Record<string, Pair>

export const KIND: Record<AccountKind, Pair> = {
  family: { en: 'Parent', ar: 'ولي أمر' },
  teacher: { en: 'Teacher', ar: 'معلم' },
  staff: { en: 'Staff', ar: 'موظف' },
}

export const STATUS: Record<AccountStatus, Pair> = {
  provisioned: { en: 'Not set up', ar: 'غير مُعَدّ' },
  active: { en: 'Active', ar: 'نشط' },
  suspended: { en: 'Inactive', ar: 'موقوف' },
  deactivated: { en: 'Deactivated', ar: 'معطّل نهائيًا' },
}

const BY_CODE: Record<string, Pair> = {
  'COMM.ACCOUNT_ADMIN_DENIED': {
    en: 'You may not do this to this account.',
    ar: 'لا يمكنك تنفيذ هذا الإجراء على هذا الحساب.',
  },
  'COMM.ACCOUNT_ADMIN_NOT_FOUND': { en: 'This account no longer exists.', ar: 'هذا الحساب لم يعد موجودًا.' },
  'COMM.ACCOUNT_ADMIN_STATE': {
    en: 'The account changed meanwhile. The list has been refreshed.',
    ar: 'تغيّر الحساب في هذه الأثناء. تم تحديث القائمة.',
  },
  // PD-23: ending a session that has already ended (or is not this account's).
  'COMM.SESSION_NOT_FOUND': { en: 'This session has already ended.', ar: 'هذه الجلسة انتهت بالفعل.' },
  'COMMON.RATE_LIMITED': {
    en: 'Too many codes for this account in the last hour. Try again later.',
    ar: 'رموز كثيرة لهذا الحساب خلال الساعة الأخيرة. حاول لاحقًا.',
  },
}

export function describeError(error: unknown, locale: 'ar' | 'en'): string {
  const pick = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  if (error instanceof ApiError) {
    const known = BY_CODE[error.code]
    return known ? pick(known) : error.localized(locale)
  }
  return pick({ en: 'Something went wrong. Try again.', ar: 'حدث خطأ. حاول مرة أخرى.' })
}
