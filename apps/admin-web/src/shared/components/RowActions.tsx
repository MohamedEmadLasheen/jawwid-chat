import { isValidElement, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Menu, type MenuItem } from './Menu'

/**
 * A row's actions: at most one stated action, and everything else behind "⋯".
 * A row never carries a line of buttons.
 *
 * `primary` is the row's one visible control (a `.btn.btn--sm`, or a link);
 * `more` are the rest, in the order they should be read, destructive ones last
 * and marked `danger`. `label` names the menu for assistive technology
 * ("More actions: <who>").
 *
 * A primary that only opens the row's own page (a router `Link`, such as "Open file") is not
 * repeated down the list: it shows on the row's hover and keyboard focus, stays visible on touch
 * screens, and the whole row opens it (system.css, "row-actions2--reveal"). `reveal` overrides
 * the guess either way.
 */
export function RowActions({ primary, more, label, reveal }: { primary?: ReactNode; more?: MenuItem[]; label: string; reveal?: boolean }) {
  const items = more ?? []
  if (!primary && items.length === 0) return null
  const opens = reveal ?? (isValidElement(primary) && primary.type === Link)
  return (
    <div className={opens ? 'row-actions2 row-actions2--reveal' : 'row-actions2'} onClick={(e) => e.stopPropagation()}>
      {opens ? <span className="row-actions2__open">{primary}</span> : primary}
      {items.length > 0 && <Menu label={label} items={items} icon="more" className="row-actions2__more" />}
    </div>
  )
}
