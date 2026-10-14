import { Link } from 'react-router-dom'
import { Icon } from '@/shared/components/Icon'
import { PageHeader } from '@/shared/components/PageHeader'
import { StatusBadge, useEyebrow } from './common'
import { TEXT, useText } from './copy'
import { adminSectionPath, sectionsInGroup, type AdminSection } from './sections'

/**
 * An unbuilt section: its name, what it will be for, and what it is waiting
 * on. No table, no zero, no button -- nothing here could be mistaken for data
 * or for an action that works. The only links lead to sections in the same
 * group that do work today.
 */
export function DevelopmentPlaceholder({ section }: { section: AdminSection }) {
  const tx = useText()
  const eyebrow = useEyebrow(section)
  const available = sectionsInGroup(section.group).filter((s) => s.status === 'read_only' && s.key !== section.key)

  return (
    <div className="page">
      <div className="page__inner">
        <PageHeader eyebrow={eyebrow} title={tx(section.label)} status={<StatusBadge status={section.status} />} />
        <div className={available.length ? 'placeholder-layout' : 'placeholder-layout placeholder-layout--single'}>
          <div className="placeholder" role="note" data-testid="development-placeholder">
            <span className="placeholder__icon" aria-hidden="true">
              <Icon name={section.icon} size={28} />
            </span>
            <h2 className="placeholder__title">{tx(TEXT.placeholderTitle)}</h2>
            <p className="placeholder__purpose">{tx(section.purpose)}</p>
            <p className="placeholder__note">
              <Icon name="hammer" size={14} />
              {tx(section.note)}
            </p>
            {section.legacy && (
              <details className="disclosure">
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
            <aside className="placeholder-aside" aria-labelledby="available-now">
              <h2 className="placeholder-aside__title" id="available-now">
                {tx(TEXT.availableNow)}
              </h2>
              <ul className="placeholder-aside__list">
                {available.map((s) => (
                  <li key={s.key}>
                    <Link to={adminSectionPath(s.key)} className="placeholder-aside__link">
                      <span className="placeholder-aside__icon" aria-hidden="true">
                        <Icon name={s.icon} size={18} />
                      </span>
                      <span className="placeholder-aside__text">
                        <span className="placeholder-aside__name">{tx(s.label)}</span>
                        <span className="placeholder-aside__purpose">{tx(s.purpose)}</span>
                      </span>
                      <Icon name="chevronForward" size={16} />
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
