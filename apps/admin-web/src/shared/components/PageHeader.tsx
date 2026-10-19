import type { ReactNode } from 'react'

/**
 * The one page-header pattern: where the page sits (eyebrow), a short title,
 * an optional status beside it, at most one line of supporting text, and the
 * page's actions at the end.
 */
export function PageHeader({
  title,
  eyebrow,
  status,
  subtitle,
  actions,
}: {
  title: string
  eyebrow?: string
  status?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="page-header">
      <div className="page-header__text">
        {eyebrow && <span className="page-header__eyebrow">{eyebrow}</span>}
        <h1 className="page-header__title">
          {title}
          {status}
        </h1>
        {subtitle && <p className="page-header__subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  )
}
