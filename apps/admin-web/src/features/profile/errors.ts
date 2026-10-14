import { ApiError } from '@/core/api/errors'
import { UploadError } from './api'
import { PhotoError } from './photo'
import { T, type Pair } from './copy'

/**
 * The server's refusal in the reader's language. Server messages are English
 * only, so the stable codes this feature can raise are mapped to bilingual
 * copy; anything else falls back to the server's own message.
 */
const BY_CODE: Record<string, Pair> = {
  'COMM.STAFF_PROFILE_CONFLICT': T.conflict,
  'COMM.STAFF_PROFILE_NOT_FOUND': T.notFound,
  'COMM.STAFF_PROFILE_EDIT_DENIED': { en: 'You cannot change this part of the profile.', ar: 'لا يمكنك تعديل هذا الجزء من الملف.' },
  'COMM.STAFF_ASSIGNMENT_DENIED': { en: 'You are not allowed to make this assignment.', ar: 'غير مسموح لك بهذا التكليف.' },
  'COMM.STAFF_DIRECTORY_DENIED': { en: 'The organization overview is available to the super admin only.', ar: 'النظرة العامة على المؤسسة متاحة للمدير العام فقط.' },
}

export function describeError(error: unknown, locale: 'ar' | 'en'): string {
  const pick = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  if (error instanceof PhotoError) {
    return pick(
      error.problem === 'type' ? T.photoBadType
      : error.problem === 'too_big' ? T.photoTooBig
      : error.problem === 'too_small' ? T.photoTooSmall
      : T.photoUnreadable,
    )
  }
  if (error instanceof UploadError) return pick(T.photoUploadFailed)
  if (error instanceof ApiError) {
    const mapped = BY_CODE[error.code]
    return mapped ? pick(mapped) : error.localized(locale)
  }
  return pick(T.photoUploadFailed)
}

export function isConflict(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'COMM.STAFF_PROFILE_CONFLICT'
}
