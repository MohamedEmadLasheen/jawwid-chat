import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Icon } from './Icon'

/**
 * Escape closes, focus moves into the dialog and is restored on close.
 *
 * `center` (default) guards high-impact operations, so its backdrop click is
 * deliberately NOT a close: a stray click should not discard a typed reason.
 * `sheet` is a read-only details panel at the inline end; nothing can be lost,
 * so it closes from its backdrop and carries its own close button.
 * `full` covers the whole window, navigation included, for content that needs
 * the room (a lesson). It leads with a back button instead of a close button;
 * `actions` sit at the header's end.
 */
export function Dialog({
  title,
  onClose,
  children,
  footer,
  variant = 'center',
  actions,
  backLabel,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  variant?: 'center' | 'sheet' | 'full'
  /** Extra header controls (`sheet` and `full`). */
  actions?: ReactNode
  /** The back button's name (`full`); "Close" when left out. */
  backLabel?: string
}) {
  const { t } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<Element | null>(null)
  const sheet = variant === 'sheet'
  const full = variant === 'full'

  // The latest onClose, read at Escape time: callers pass inline functions, and
  // re-running the effect below on each render pulled focus back to the dialog,
  // out of whatever field was being typed in (and shut an open picker list).
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    previouslyFocused.current = document.activeElement
    ref.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (previouslyFocused.current instanceof HTMLElement) {
        previouslyFocused.current.focus()
      }
    }
  }, [])

  return (
    <div
      className={sheet ? 'dialog-backdrop dialog-backdrop--sheet' : full ? 'dialog-backdrop dialog-backdrop--full' : 'dialog-backdrop'}
      onClick={sheet ? (e) => e.target === e.currentTarget && onClose() : undefined}
    >
      <div
        className={sheet ? 'dialog dialog--sheet' : full ? 'dialog dialog--full' : 'dialog'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        {full ? (
          <div className="dialog__header">
            <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
              <Icon name="arrowBack" />
              {backLabel ?? t('common.close')}
            </button>
            <h2 className="dialog__title">{title}</h2>
            {actions}
          </div>
        ) : sheet ? (
          <div className="dialog__header">
            <h2 className="dialog__title">{title}</h2>
            {actions}
            <button
              type="button"
              className="btn btn--ghost btn--icon btn--sm"
              onClick={onClose}
              aria-label={t('common.close')}
            >
              <Icon name="close" />
            </button>
          </div>
        ) : (
          <h2 className="dialog__title">{title}</h2>
        )}
        {children}
        {footer && <div className="dialog__actions">{footer}</div>}
      </div>
    </div>
  )
}

export function DialogCancelButton({ onClick, disabled = false }: { onClick: () => void; disabled?: boolean }) {
  const { t } = useI18n()
  return (
    <button type="button" className="btn" onClick={onClick} disabled={disabled}>
      {t('common.cancel')}
    </button>
  )
}
