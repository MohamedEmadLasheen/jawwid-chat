import { ApiError } from '@/core/api/errors'
import type { Pair } from '@/features/organization/copy'
import type { SessionDto } from './api'

export { useCopy, type Pair } from '@/features/organization/copy'

/** PD-23 copy, Arabic and English side by side. */
export const D = {
  title: { en: 'My devices & sessions', ar: 'أجهزتي وجلساتي' },
  open: { en: 'Devices & sessions', ar: 'الأجهزة والجلسات' },
  subtitle: {
    en: 'Where your account is signed in. Sign out of any device you do not recognise.',
    ar: 'الأماكن التي سُجّل فيها الدخول إلى حسابك. سجّل الخروج من أي جهاز لا تعرفه.',
  },
  back: { en: 'Back to my profile', ar: 'العودة إلى ملفي' },
  device: { en: 'Device', ar: 'الجهاز' },
  platform: { en: 'Type', ar: 'النوع' },
  signedIn: { en: 'Signed in', ar: 'تسجيل الدخول' },
  lastActive: { en: 'Last active', ar: 'آخر نشاط' },
  actions: { en: 'Actions', ar: 'الإجراءات' },
  thisBrowser: { en: 'This browser', ar: 'هذا المتصفح' },
  kept: { en: 'Kept signed in', ar: 'يبقى مسجلاً' },
  app: { en: 'App {version}', ar: 'التطبيق {version}' },
  unknownDevice: { en: 'Unknown device', ar: 'جهاز غير معروف' },
  notYet: { en: '—', ar: '—' },
  empty: { en: 'No active sessions.', ar: 'لا توجد جلسات نشطة.' },
  signOut: { en: 'Sign out', ar: 'تسجيل الخروج' },
  signOutOthers: { en: 'Sign out all other devices', ar: 'تسجيل الخروج من كل الأجهزة الأخرى' },
  confirmTitle: { en: 'Sign out of {device}?', ar: 'تسجيل الخروج من {device}؟' },
  confirmBody: {
    en: 'That device will need your password to sign in again.',
    ar: 'سيحتاج ذلك الجهاز إلى كلمة المرور لتسجيل الدخول مجددًا.',
  },
  confirmCurrentBody: {
    en: 'This is the browser you are using now. You will be signed out here.',
    ar: 'هذا هو المتصفح الذي تستخدمه الآن، وسيتم تسجيل خروجك منه.',
  },
  confirmOthersTitle: { en: 'Sign out all other devices?', ar: 'تسجيل الخروج من كل الأجهزة الأخرى؟' },
  confirmOthersBody: {
    en: 'Every device except this browser is signed out and will need your password again.',
    ar: 'سيتم تسجيل الخروج من كل الأجهزة عدا هذا المتصفح، وستحتاج إلى كلمة المرور مجددًا.',
  },
  revokedOthers: { en: 'Signed out of {n} other session(s).', ar: 'تم تسجيل الخروج من {n} جلسة أخرى.' },

  // Accounts page (administrator)
  devicesOf: { en: 'Active devices of {name}', ar: 'الأجهزة النشطة لـ {name}' },
  devicesButton: { en: 'Devices', ar: 'الأجهزة' },
  devicesExplain: {
    en: 'Signing a device out ends that session at once; {name} can sign in again with their password.',
    ar: 'تسجيل خروج جهاز يُنهي تلك الجلسة فورًا، ويمكن لـ {name} تسجيل الدخول مجددًا بكلمة المرور.',
  },
  signOutAll: { en: 'Sign out of all devices', ar: 'تسجيل الخروج من كل الأجهزة' },
  adminRevokeTitle: { en: 'Sign {name} out of {device}', ar: 'تسجيل خروج {name} من {device}' },
  adminRevokeAllTitle: { en: 'Sign {name} out of all devices', ar: 'تسجيل خروج {name} من كل الأجهزة' },
  reason: { en: 'Reason', ar: 'السبب' },
  revokedAll: { en: 'Signed out of {n} session(s).', ar: 'تم تسجيل الخروج من {n} جلسة.' },
} satisfies Record<string, Pair>

export const PLATFORM: Record<NonNullable<SessionDto['platform']> | 'unknown', Pair> = {
  ios: { en: 'iPhone / iPad app', ar: 'تطبيق iPhone / iPad' },
  android: { en: 'Android app', ar: 'تطبيق Android' },
  web: { en: 'Web browser', ar: 'متصفح ويب' },
  unknown: { en: 'Unknown', ar: 'غير معروف' },
}

export const SESSION_NOT_FOUND = 'COMM.SESSION_NOT_FOUND'

const BY_CODE: Record<string, Pair> = {
  [SESSION_NOT_FOUND]: { en: 'This session has already ended.', ar: 'هذه الجلسة انتهت بالفعل.' },
}

/** An ApiError carrying PD-23's own wording for the codes it knows. */
export function sessionError(error: unknown): unknown {
  if (error instanceof ApiError) {
    const known = BY_CODE[error.code]
    if (known) return new ApiError({ status: error.status, code: error.code, messageEn: known.en, messageAr: known.ar })
  }
  return error ?? undefined
}

export function isSessionGone(error: unknown): boolean {
  return error instanceof ApiError && error.code === SESSION_NOT_FOUND
}
