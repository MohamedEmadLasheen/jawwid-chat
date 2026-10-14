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
 */
export function Dialog({
  title,
  onClose,
  children,
  footer,
  variant = 'center',
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  variant?: 'center' | 'sheet'
}) {
  const { t } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<Element | null>(null)
  const sheet = variant === 'sheet'

  useEffect(() => {
    previouslyFocused.current = document.activeElement
    ref.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (previouslyFocused.current instanceof HTMLElement) {
        previouslyFocused.current.focus()
      }
    }
  }, [onClose])

  return (
    <div
      className={sheet ? 'dialog-backdrop dialog-backdrop--sheet' : 'dialog-backdrop'}
      onClick={sheet ? (e) => e.target === e.currentTarget && onClose() : undefined}
    >
      <div
        className={sheet ? 'dialog dialog--sheet' : 'dialog'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        {sheet ? (
          <div className="dialog__header">
            <h2 className="dialog__title">{title}</h2>
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

export function DialogCancelButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n()
  return (
    <button type="button" className="btn" onClick={onClick}>
      {t('common.cancel')}
    </button>
  )
}
