import type { ReactNode } from 'react'

/**
 * THE CARD.
 *
 * `design-system.md` §11. The visual definition lives in `app.css`; this is
 * here so a card's PARTS have names — a title is `.card__title` everywhere
 * rather than an `<h3>` on one page and a bold `<div>` on the next, which is
 * what made the product's cards look like several products' cards.
 *
 * `interactive` is for a card that genuinely does something when clicked. It
 * renders a real `<button>`, because a clickable `<div>` is not reachable by
 * keyboard and announces nothing.
 */
export function Card({
  title,
  meta,
  footer,
  brand = false,
  onClick,
  className,
  children,
}: {
  title?: ReactNode
  meta?: ReactNode
  footer?: ReactNode
  /** Brand elevation — for the few surfaces that are a brand moment. */
  brand?: boolean
  onClick?: () => void
  className?: string
  children?: ReactNode
}) {
  const classes = ['card', brand ? 'card--brand' : '', onClick ? 'card--interactive' : '', className ?? '']
    .filter(Boolean)
    .join(' ')

  const inner = (
    <>
      {(title || meta) && (
        <div className="card__head">
          {title && <div className="card__title">{title}</div>}
          {meta && <div className="card__meta">{meta}</div>}
        </div>
      )}
      {children}
      {footer && <div className="card__footer">{footer}</div>}
    </>
  )

  if (onClick) {
    return (
      <button type="button" className={classes} onClick={onClick}>
        {inner}
      </button>
    )
  }
  return <div className={classes}>{inner}</div>
}
