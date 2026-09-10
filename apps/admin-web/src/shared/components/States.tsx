import type { ReactNode } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ApiError } from '@/core/api/errors'
import { Icon, type IconName } from './Icon'

/**
 * EMPTY, LOADING AND ERROR — one shape, three meanings.
 *
 * `design-system.md` §22. These used to be three unrelated scraps of markup,
 * which is why a loading list and an empty one looked like two different
 * products. They are now one layout — a brand mark, a title, a line of help,
 * an optional action — so the only thing that changes between them is the
 * words, and the operator learns the shape once.
 *
 * The mark is `aria-hidden`: it is a brand cue, and the title beside it is the
 * message. Nothing here conveys meaning by colour or glyph alone (§20).
 */

export function LoadingState({ label }: { label?: string }) {
  const { t } = useI18n()
  return (
    <div className="state" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span className="state__hint">{label ?? t('common.loading')}</span>
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
    <div className="state state--danger" role="alert">
      <span className="state__mark" aria-hidden="true">
        <Icon name={forbidden ? 'lock' : 'attention'} size={22} />
      </span>
      <div className="state__title">{forbidden ? t('common.forbidden') : message}</div>
      {!forbidden && onRetry && (
        <div className="state__actions">
          <button type="button" className="btn" onClick={onRetry}>
            {t('common.retry')}
          </button>
        </div>
      )}
    </div>
  )
}

/** Empty states reassure rather than look broken (role brief §80). */
export function EmptyState({
  title,
  hint,
  icon = 'info',
  action,
}: {
  title: string
  hint?: ReactNode
  /** The area's own glyph, so an empty console and an empty directory differ. */
  icon?: IconName
  action?: ReactNode
}) {
  return (
    <div className="state">
      <span className="state__mark" aria-hidden="true">
        <Icon name={icon} size={22} />
      </span>
      <div className="state__title">{title}</div>
      {hint && <div className="state__hint">{hint}</div>}
      {action && <div className="state__actions">{action}</div>}
    </div>
  )
}

/**
 * A shape where the content will be, rather than a spinner where it is not.
 * Used by lists that know their own row height, so the layout does not jump
 * when the rows arrive.
 */
export function SkeletonList({ rows = 5 }: { rows?: number }) {
  const { t } = useI18n()
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{t('common.loading')}</span>
      {Array.from({ length: rows }, (_, i) => (
        /* `.skeleton-row` and `.skeleton-line` are the console's own shapes
           (`console.css` §7.10). Reused rather than re-invented so a loading
           list looks the same everywhere in the product. */
        <div key={i} className="skeleton-row" aria-hidden="true">
          <div className="skeleton skeleton-row__avatar" />
          <div className="skeleton-row__lines">
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line" style={{ inlineSize: '60%' }} />
          </div>
        </div>
      ))}
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
  children,
}: {
  isLoading: boolean
  error: unknown
  isEmpty?: boolean
  emptyTitle?: string
  emptyHint?: ReactNode
  emptyIcon?: IconName
  onRetry?: () => void
  children: ReactNode
}) {
  if (isLoading) return <LoadingState />
  if (error) return <ErrorState error={error} onRetry={onRetry} />
  if (isEmpty && emptyTitle)
    return <EmptyState title={emptyTitle} hint={emptyHint} icon={emptyIcon} />
  return <>{children}</>
}
