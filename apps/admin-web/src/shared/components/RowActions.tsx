import type { ReactNode } from 'react'
import { Menu, type MenuItem } from './Menu'

/**
 * A row's actions: at most one stated action, and everything else behind "⋯".
 * A row never carries a line of buttons.
 *
 * `primary` is the row's one visible control (a `.btn.btn--sm`, or a link);
 * `more` are the rest, in the order they should be read, destructive ones last
 * and marked `danger`. `label` names the menu for assistive technology
 * ("More actions: <who>").
 */
export function RowActions({ primary, more, label }: { primary?: ReactNode; more?: MenuItem[]; label: string }) {
  const items = more ?? []
  if (!primary && items.length === 0) return null
  return (
    <div className="row-actions2" onClick={(e) => e.stopPropagation()}>
      {primary}
      {items.length > 0 && <Menu label={label} items={items} icon="more" className="row-actions2__more" />}
    </div>
  )
}
