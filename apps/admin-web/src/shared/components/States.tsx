import type { ReactNode } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ApiError } from '@/core/api/errors'

export function LoadingState({ label }: { label?: string }) {
  const { t } = useI18n()
  return (
    <div className="state" role="status" aria-live="polite">
      {label ?? t('common.loading')}
    </div>
  )
}

/**
 * Every failure gets a human message and a way forward. A 403 deliberately
 * offers no retry: the backend said no, and the UI does not attempt a fallback
 * route to the same data (role brief §63).
 */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t, locale } = useI18n()

  const message =
    error instanceof ApiError ? error.localized(locale) : t('common.offline')
  const forbidden = error instanceof ApiError && error.isForbidden

  return (
    <div className="state" role="alert">
      <div className="state__title">{forbidden ? t('common.forbidden') : message}</div>
      {!forbidden && onRetry && (
        <button type="button" className="btn" onClick={onRetry} style={{ marginBlockStart: 12 }}>
          {t('common.retry')}
        </button>
      )}
    </div>
  )
}

/** Empty states reassure rather than look broken (role brief §80). */
export function EmptyState({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div className="state">
      <div className="state__title">{title}</div>
      {hint && <div>{hint}</div>}
    </div>
  )
}

/** Renders the right state for a query without repeating the branching. */
export function QueryBoundary({
  isLoading,
  error,
  isEmpty,
  emptyTitle,
  onRetry,
  children,
}: {
  isLoading: boolean
  error: unknown
  isEmpty?: boolean
  emptyTitle?: string
  onRetry?: () => void
  children: ReactNode
}) {
  if (isLoading) return <LoadingState />
  if (error) return <ErrorState error={error} onRetry={onRetry} />
  if (isEmpty && emptyTitle) return <EmptyState title={emptyTitle} />
  return <>{children}</>
}
