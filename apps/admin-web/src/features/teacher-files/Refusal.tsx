import { ApiError } from '@/core/api/errors'
import { useI18n } from '@/core/i18n/I18nProvider'
import { EmptyState } from '@/shared/components/States'
import { describeError } from './copy'

/**
 * A Teacher File refusal says WHY (administration only, Teachers department)
 * instead of the generic "forbidden" the shared error state shows. Any other
 * error falls through to the shared handling.
 */
export function isTeacherFileRefusal(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'COMM.TEACHER_FILE_DENIED'
}

export function Refusal({ error }: { error: unknown }) {
  const { locale } = useI18n()
  return <EmptyState icon="lock" title={describeError(error, locale)} />
}
