import type { ReactNode } from 'react'

/**
 * THE PAGE HEADER.
 *
 * Every product page opened with a bare `<h1 class="page__title">` and, if it
 * had controls, its own improvised row for them — which is why no two pages
 * put their actions in the same place or left the same gap under the title.
 * This is that row, defined once.
 *
 * The subtitle is capped at 68ch in CSS. A page description that runs the full
 * width of a 1920px monitor is a line the eye cannot track back from, in
 * either script.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="page__header">
      <div className="page__headings">
        <h1 className="page__title">{title}</h1>
        {subtitle && <p className="page__subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page__actions">{actions}</div>}
    </header>
  )
}
