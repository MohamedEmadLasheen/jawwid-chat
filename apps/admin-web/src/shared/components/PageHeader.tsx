import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from './Icon'

/** One key number in a page's masthead. `tone` marks the one that needs attention. */
export interface MastFigure {
  key: string
  label: string
  value: ReactNode
  /** A short unit or count after the value ("EGP", "of 24"). */
  unit?: ReactNode
  /** One quiet line under it. */
  note?: ReactNode
  tone?: 'urgent' | 'key' | 'quiet'
  /** Where the figure leads; it is then a link. */
  to?: string
  onClick?: () => void
  pressed?: boolean
}

/**
 * The masthead: the white band every page opens with. Where the page sits
 * (eyebrow or a way back), its title in the display face, one line of what it
 * is for, the page's key numbers, its actions (one primary, the rest quiet),
 * and its tabs on the band's lower edge. The page's body sits below, on the canvas.
 */
export function PageHeader({
  title,
  eyebrow,
  back,
  status,
  subtitle,
  actions,
  figures,
  tabs,
  lead,
}: {
  title: string
  eyebrow?: string
  /** A way back to the list this page belongs to; replaces the eyebrow. */
  back?: { to: string; label: string }
  status?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  figures?: MastFigure[]
  /** Tabs or view switches, set on the band's lower edge. */
  tabs?: ReactNode
  /** What stands before the title: a monogram or a photo on a record's page. */
  lead?: ReactNode
}) {
  return (
    <header className={tabs ? 'page-header mast mast--tabs' : 'page-header mast'}>
      <div className="mast__row">
        {lead && <div className="mast__lead">{lead}</div>}
        <div className="page-header__text">
          {back ? (
            <Link to={back.to} className="mast__back">
              <Icon name="arrowBack" size={15} />
              {back.label}
            </Link>
          ) : (
            eyebrow && <span className="page-header__eyebrow">{eyebrow}</span>
          )}
          <h1 className="page-header__title">
            {title}
            {status}
          </h1>
          {subtitle && <p className="page-header__subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="page-header__actions">{actions}</div>}
      </div>
      {figures && figures.length > 0 && <MastFigures figures={figures} />}
      {tabs && <div className="mast__tabs">{tabs}</div>}
    </header>
  )
}

/** The key numbers alone, for a page that composes its own masthead. */
export function MastFigures({ figures }: { figures: MastFigure[] }) {
  return (
    <dl className="figures">
      {figures.map((f) => {
        const cls = `figure${f.tone ? ` figure--${f.tone}` : ''}`
        const body = (
          <>
            <dt className="figure__label">{f.label}</dt>
            <dd className="figure__value">
              <span className="figure__n">{f.value}</span>
              {f.unit && <span className="figure__unit">{f.unit}</span>}
            </dd>
            {f.note && <dd className="figure__note">{f.note}</dd>}
          </>
        )
        if (f.to) {
          return (
            <Link key={f.key} to={f.to} className={`${cls} figure--link`}>
              {body}
            </Link>
          )
        }
        if (f.onClick) {
          return (
            <button key={f.key} type="button" className={`${cls} figure--link`} onClick={f.onClick} aria-pressed={f.pressed}>
              {body}
            </button>
          )
        }
        return (
          <div key={f.key} className={cls}>
            {body}
          </div>
        )
      })}
    </dl>
  )
}
