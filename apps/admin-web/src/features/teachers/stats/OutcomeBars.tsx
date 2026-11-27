import type { CategoryStats, StatCategory } from '../api'
import { CATEGORY_LABEL, TS } from '../copy'
import { useCopy, useFormat } from './format'

/** The two outcomes that ask for someone: a lesson the teacher missed, a lesson still without a report. */
const ALARM: ReadonlySet<StatCategory> = new Set(['teacher_no_show', 'unreported'])

/**
 * A teacher's month by outcome: one short bar a category, in neutral ink, red
 * only where a lesson was lost through the teacher or is still unreported.
 * Lessons still to come are not an outcome and are left out. The bars run
 * with the page (from the right in Arabic).
 */
export function OutcomeBars({ categories }: { categories: CategoryStats[] }) {
  const tx = useCopy()
  const fmt = useFormat()
  const shown = categories.filter((c) => c.key !== 'upcoming' && c.lessons > 0)
  if (shown.length === 0) return <p className="tsx-quiet tsx-bars__none">{tx(TS.outcomesNone)}</p>
  // Each outcome as a share of all the month's lessons that have one, so the bars read as parts of one whole.
  const total = shown.reduce((n, c) => n + c.lessons, 0)
  return (
    <ul className="tsx-bars">
      {shown.map((c) => {
        const alarm = ALARM.has(c.key)
        return (
          <li key={c.key} className={alarm ? 'tsx-bar tsx-bar--alarm' : 'tsx-bar'}>
            <span className="tsx-bar__label">{tx(CATEGORY_LABEL[c.key])}</span>
            <span className="tsx-bar__track" aria-hidden="true">
              <span className="tsx-bar__fill" style={{ inlineSize: `${Math.max(2, (c.lessons / total) * 100)}%` }} />
            </span>
            <span className="tsx-bar__n">{fmt.number(c.lessons)}</span>
          </li>
        )
      })}
    </ul>
  )
}
