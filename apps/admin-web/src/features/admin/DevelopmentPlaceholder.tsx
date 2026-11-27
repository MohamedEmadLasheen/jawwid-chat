import { Link } from 'react-router-dom'
import { Icon } from '@/shared/components/Icon'
import { PageHeader } from '@/shared/components/PageHeader'
import { StatusBadge, useEyebrow } from './common'
import { TEXT, useText } from './copy'
import { adminSectionPath, sectionsInGroup, type AdminSection } from './sections'
import './admin.css'

/**
 * An unbuilt section: its name, one line saying what it will be for, and what
 * it is waiting on. No table, no zero, no button -- nothing here could be mistaken for data
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
        {/* One calm line: that it is not built, and what it will be for. */}
        <div className="adm-soon" role="note" data-testid="development-placeholder">
          <p className="adm-soon__line">
            <strong>{tx(TEXT.placeholderTitle)}</strong> {tx(section.purpose)}
          </p>
          <p className="adm-soon__note">{tx(section.note)}</p>
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
        {available.length > 0 && (
          <aside className="adm-soon__aside" aria-labelledby="available-now">
            <h2 className="section-label" id="available-now">
              {tx(TEXT.availableNow)}
            </h2>
            <ul className="ruled adm-soon__list">
              {available.map((s) => (
                <li key={s.key}>
                  <Link to={adminSectionPath(s.key)} className="adm-soon__link">
                    <Icon name={s.icon} size={18} />
                    <span className="adm-soon__name">{tx(s.label)}</span>
                    <span className="adm-soon__purpose">{tx(s.purpose)}</span>
                    <Icon name="chevronForward" size={14} />
                  </Link>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </div>
  )
}
