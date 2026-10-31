import { ApiError } from '@/core/api/errors'
import type { Pair } from './copy'
import { describeError } from './copy'
import type { FamilyAccessStatus, GRANT_HOURS } from './familyAccessApi'

/**
 * ADMIN-002 copy, Arabic and English side by side. Wording rule: this is an
 * exception, granted for a reason and for a time -- never "share" or "assign";
 * the family is not told, so nothing here promises them a notice.
 */
export const F = {
  grantButton: { en: 'Temporary access', ar: 'وصول مؤقت' },
  grantTitle: { en: 'Temporary access to {name}', ar: 'وصول مؤقت إلى {name}' },
  grantExplain: {
    en: "Opens this family's parent accounts -- password reset, inactive, sign-out, support session -- to one Operations staff member, for the time you choose. Nothing else opens. It ends by itself, and every use is recorded.",
    ar: 'يفتح حسابات أولياء الأمور في هذه الأسرة -- إعادة تعيين كلمة المرور والإيقاف وتسجيل الخروج وجلسة الدعم -- لموظف واحد من العمليات، للمدة التي تختارها. لا يُفتح شيء غير ذلك. ينتهي تلقائيًا، ويُسجَّل كل استخدام.',
  },
  grant: { en: 'Grant access', ar: 'منح الوصول' },
  grantee: { en: 'Staff member', ar: 'الموظف' },
  granteePlaceholder: { en: 'Choose an Operations staff member', ar: 'اختر موظفًا من العمليات' },
  duration: { en: 'For', ar: 'المدة' },
  hours: {
    4: { en: '4 hours', ar: '4 ساعات' },
    24: { en: '1 day', ar: 'يوم واحد' },
    72: { en: '3 days', ar: '3 أيام' },
    168: { en: '7 days', ar: '7 أيام' },
  } satisfies Record<(typeof GRANT_HOURS)[number], Pair>,
  purpose: { en: 'Purpose', ar: 'الغرض' },
  purposeHint: {
    en: 'Required. Say what the access is for; it is recorded with every use.',
    ar: 'مطلوب. اذكر سبب الوصول؛ يُسجَّل مع كل استخدام.',
  },
  recordTitle: { en: 'Exceptional access', ar: 'الوصول الاستثنائي' },
  recordHint: {
    en: 'Temporary access to one family outside a staff member\'s own families. Live and from the last 30 days.',
    ar: 'وصول مؤقت إلى أسرة واحدة خارج أسر الموظف. الساري منها وما انتهى خلال آخر 30 يومًا.',
  },
  mineTitle: { en: 'Your temporary access', ar: 'وصولك المؤقت' },
  noRecord: { en: 'No exceptional access in the last 30 days.', ar: 'لا يوجد وصول استثنائي خلال آخر 30 يومًا.' },
  family: { en: 'Family', ar: 'الأسرة' },
  grantedBy: { en: 'Granted by', ar: 'منحه' },
  until: { en: 'Until', ar: 'حتى' },
  status: {
    active: { en: 'Active', ar: 'ساري' },
    ended: { en: 'Ended', ar: 'انتهى' },
    revoked: { en: 'Revoked', ar: 'أُلغي' },
  } as Record<FamilyAccessStatus, Pair>,
  revoke: { en: 'Revoke', ar: 'إلغاء الوصول' },
  revokeTitle: { en: "End {name}'s access to {family}", ar: 'إنهاء وصول {name} إلى {family}' },
  revokeExplain: {
    en: 'The access ends now. A support session opened under it ends on its next request.',
    ar: 'ينتهي الوصول الآن. وتنتهي أي جلسة دعم فُتحت به عند طلبها التالي.',
  },
}

const BY_CODE: Record<string, Pair> = {
  'COMM.ACCOUNT_ADMIN_DENIED': {
    en: 'Only the Operations Manager or the super admin grants or revokes this access.',
    ar: 'يمنح هذا الوصول أو يلغيه مدير العمليات أو المدير العام فقط.',
  },
  'COMM.ACCOUNT_ADMIN_NOT_FOUND': { en: 'This access no longer exists.', ar: 'هذا الوصول لم يعد موجودًا.' },
  'COMM.ACCOUNT_ADMIN_STATE': { en: 'This access has already ended.', ar: 'هذا الوصول انتهى بالفعل.' },
}

/** A grant's own wording first; anything else as the Accounts page says it. */
export function describeAccessError(error: unknown): ApiError {
  const known = error instanceof ApiError ? BY_CODE[error.code] : undefined
  return new ApiError({
    status: error instanceof ApiError ? error.status : 0,
    code: error instanceof ApiError ? error.code : 'CLIENT',
    messageEn: known?.en ?? describeError(error, 'en'),
    messageAr: known?.ar ?? describeError(error, 'ar'),
  })
}
