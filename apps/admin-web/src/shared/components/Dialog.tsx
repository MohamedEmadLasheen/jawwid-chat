import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'

/**
 * Escape closes, focus moves into the dialog and is restored on close, and the
 * backdrop click is deliberately NOT a close: these dialogs guard high-impact
 * operations and a stray click should not discard a typed reason.
 */
export function Dialog({
  title,
  onClose,
  children,
  footer,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<Element | null>(null)

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
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <h2 className="dialog__title">{title}</h2>
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
