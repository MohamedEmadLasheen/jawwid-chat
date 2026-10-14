import type { ReactNode } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ApiError } from '@/core/api/errors'
import { Icon, type IconName } from './Icon'

export function LoadingState({ label, compact }: { label?: string; compact?: boolean }) {
  const { t } = useI18n()
  return (
    <div className={compact ? 'state state--compact' : 'state'} role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label ?? t('common.loading')}</span>
    </div>
  )
}

/**
 * Every failure gets a human message and a way forward. A 403 deliberately
 * offers no retry: the backend said no, and the UI does not attempt a fallback
 * route to the same data (role brief §63).
 */
export function ErrorState({
  error,
  onRetry,
  compact,
}: {
  error: unknown
  onRetry?: () => void
  compact?: boolean
}) {
  const { t, locale } = useI18n()

  const message =
    error instanceof ApiError ? error.localized(locale) : t('common.offline')
  const forbidden = error instanceof ApiError && error.isForbidden

  return (
    <div className={compact ? 'state state--compact' : 'state'} role="alert">
      <span className="state__icon" aria-hidden="true">
        <Icon name={forbidden ? 'lock' : 'alert'} size={22} />
      </span>
      <div className="state__title">{forbidden ? t('common.forbidden') : message}</div>
      {!forbidden && onRetry && (
        <button type="button" className="btn btn--sm" onClick={onRetry}>
          <Icon name="refresh" size={16} />
          {t('common.retry')}
        </button>
      )}
    </div>
  )
}

/** Empty states reassure rather than look broken (role brief §80). */
export function EmptyState({
  title,
  hint,
  icon,
  action,
  compact,
}: {
  title: string
  hint?: ReactNode
  icon?: IconName
  action?: ReactNode
  compact?: boolean
}) {
  return (
    <div className={compact ? 'state state--compact' : 'state'}>
      {icon && (
        <span className="state__icon" aria-hidden="true">
          <Icon name={icon} size={22} />
        </span>
      )}
      <div className="state__title">{title}</div>
      {hint && <div className="state__body">{hint}</div>}
      {action}
    </div>
  )
}

/** Renders the right state for a query without repeating the branching. */
export function QueryBoundary({
  isLoading,
  error,
  isEmpty,
  emptyTitle,
  emptyHint,
  emptyIcon,
  onRetry,
  compact,
  children,
}: {
  isLoading: boolean
  error: unknown
  isEmpty?: boolean
  emptyTitle?: string
  emptyHint?: ReactNode
  emptyIcon?: IconName
  onRetry?: () => void
  compact?: boolean
  children: ReactNode
}) {
  if (isLoading) return <LoadingState compact={compact} />
  if (error) return <ErrorState error={error} onRetry={onRetry} compact={compact} />
  if (isEmpty && emptyTitle) {
    return <EmptyState title={emptyTitle} hint={emptyHint} icon={emptyIcon} compact={compact} />
  }
  return <>{children}</>
}
