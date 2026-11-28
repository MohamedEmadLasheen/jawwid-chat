import { ADMIN_SECTIONS } from './sections'
import { Link } from 'react-router-dom'
import { Icon } from '@/shared/components/Icon'
import { PageHeader } from '@/shared/components/PageHeader'
import { StatusBadge, useEyebrow } from './common'
import { TEXT, fill, useText } from './copy'
import { adminSectionPath, sectionsInGroup, type AdminSection } from './sections'
import './admin.css'

/**
 * An unbuilt section: its name, its own line saying what it will do, and what
 * stands in for it meanwhile. No table, no zero, no button -- nothing here could be mistaken for data
 * or for an action that works. The only links lead to sections in the same
 * group that do work today.
 */
export function DevelopmentPlaceholder({ section }: { section: AdminSection }) {
  const tx = useText()
  const eyebrow = useEyebrow(section)
  const available = sectionsInGroup(section.group).filter((s) => s.status !== 'in_development' && s.key !== section.key)

  return (
    <div className="page">
      <div className="page__inner">
        <PageHeader eyebrow={eyebrow} title={tx(section.label)} status={<StatusBadge status={section.status} />} />
        <div className={available.length ? 'split split--wide-aside' : undefined}>
          {/* One sheet: what the section will hold, and what stands in for it meanwhile. */}
          {/* What the section will hold is its headline; "in development" is said once, by the
              tag beside the title (and in words for assistive technology). */}
          <section className="sheet adm-soon" role="note" data-testid="development-placeholder" aria-label={tx(TEXT.willHold)}>
            <div className="sheet__body">
              <h2 className="adm-soon__line">{tx(section.purpose)}</h2>
              <p className="adm-soon__note">
                <span className="sr-only">{tx(TEXT.placeholderTitle)} </span>
                {tx(section.note)}
              </p>
              {section.meanwhile && (
                <Link className="btn btn--primary adm-soon__go" to={adminSectionPath(section.meanwhile)}>
                  {fill(tx(TEXT.openSection), {
                    name: tx(ADMIN_SECTIONS.find((s) => s.key === section.meanwhile)?.label ?? section.label),
                  })}
                </Link>
              )}
              {section.legacy && (
                <details className="disclosure adm-soon__legacy">
                  <summary>{tx(TEXT.prototypeTitle)}</summary>
                  <p>{tx(TEXT.prototypeWarn)}</p>
                  <ul>
                    {section.legacy.map((screen) => (
                      <li key={screen.path}>
                        <Link to={screen.path} className="mono">
                          {screen.path}
                        </Link>
                        {screen.note && <> — {tx(screen.note)}</>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </section>
          {available.length > 0 && (
            <aside className="aside-group adm-soon__aside" aria-labelledby="available-now">
              <h2 className="aside-group__title" id="available-now">
                {tx(TEXT.availableNow)}
              </h2>
              <ul className="adm-soon__list">
                {available.map((s) => (
                  <li key={s.key}>
                    <Link to={adminSectionPath(s.key)} className="adm-soon__link">
                      <Icon name={s.icon} size={18} />
                      <span className="adm-soon__name">{tx(s.label)}</span>
                      <Icon name="chevronForward" size={14} />
                    </Link>
                  </li>
                ))}
              </ul>
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}
