import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ACADEMY_ZONE, clock12In } from '@/core/time/academyTime'
import { Icon } from '@/shared/components/Icon'
import { studentPath } from '@/features/profiles/api'
import type { CalendarLesson } from './api'
import { S, dayLabel, lessonsCount, useScheduleText, type Pair } from './copy'
import type { Issue } from './issues'
import { lessonName } from './Timeline'

/**
 * "Needs your attention": what the loaded days hold that a person must act on,
 * each as one sentence and one action. Pointing at an item (or focusing it)
 * lights its teacher's row and its lessons on the grid; choosing the sentence
 * scrolls the grid to them. Nothing else lives here: the legend is a "?" in the
 * header. The panel folds to a narrow strip, and stays as it was left.
 */

export interface Highlight {
  teacherId: string
  lessonIds: string[]
}

/** A sentence with {placeholders} filled by nodes, so a name stays isolated (<bdi>) inside the text. */
function sentence(template: string, vars: Record<string, ReactNode>): ReactNode {
  const parts = template.split(/(\{[a-z]+\})/g)
  return parts.map((p, i) => {
    const m = /^\{([a-z]+)\}$/.exec(p)
    return <Fragment key={i}>{m && m[1]! in vars ? vars[m[1]!] : p}</Fragment>
  })
}

const URGENT = new Set(['conflict', 'absent', 'payment'])

export function AttentionPanel({
  issues,
  teacherName,
  showDay,
  folded,
  onFold,
  onHighlight,
  onReveal,
  onOpenLesson,
  deskAccess,
  inline = false,
}: {
  issues: Issue[]
  teacherName: (id: string) => string
  /** The week: each item says its day. */
  showDay: boolean
  folded: boolean
  onFold: (folded: boolean) => void
  onHighlight: (h: Highlight | null) => void
  onReveal: (h: Highlight) => void
  onOpenLesson: (l: CalendarLesson) => void
  /** The account opens the Teachers' schedules desk, where a student's teacher is changed. */
  deskAccess: boolean
  /** On a phone: a block above the agenda instead of a side panel. */
  inline?: boolean
}) {
  const tx = useScheduleText()
  const { locale, number } = useI18n()
  const urgent = issues.filter((i) => URGENT.has(i.kind)).length
  const count = (
    <span className={urgent > 0 ? 'count count--urgent' : 'count'}>{number(issues.length)}</span>
  )

  if (folded) {
    return (
      <aside className={`sc-attn sc-attn--folded${inline ? ' sc-attn--inline' : ''}`} aria-label={tx(S.attnTitle)}>
        <button type="button" className="sc-attn__unfold" aria-expanded="false" title={tx(S.attnOpen)} onClick={() => onFold(false)}>
          <Icon name="panel" size={18} />
          <span className={inline ? 'sc-attn__unfold-label' : 'sr-only'}>{tx(S.attnTitle)}</span>
          {issues.length > 0 && count}
        </button>
      </aside>
    )
  }

  const name = (s: string) => (
    <bdi className="sc-attn__name">{s}</bdi>
  )
  const time = (l: CalendarLesson) => <bdi className="sc-attn__time">{clock12In(l.startsAt, ACADEMY_ZONE, locale)}</bdi>
  const line = (p: Pair, vars: Record<string, ReactNode>) => sentence(tx(p), vars)

  return (
    <aside className={`sc-attn${inline ? ' sc-attn--inline' : ''}`} aria-labelledby="sc-attn-title">
      <header className="sc-attn__head">
        <h2 id="sc-attn-title" className="sc-attn__title">
          {tx(S.attnTitle)}
          {issues.length > 0 && count}
        </h2>
        <button type="button" className="btn btn--icon btn--ghost btn--sm sc-attn__fold" aria-expanded="true" aria-label={tx(S.attnFold)} title={tx(S.attnFold)} onClick={() => onFold(true)}>
          <Icon name="panel" size={18} />
        </button>
      </header>
      {issues.length === 0 ? (
        <div className="sc-attn__none">
          <p className="sc-attn__none-title">{tx(S.attnNone)}</p>
          <p className="sc-attn__none-hint">{tx(S.attnNoneHint)}</p>
        </div>
      ) : (
        <ul className="sc-attn__list">
          {issues.map((issue) => {
            const [first, second] = issue.lessons as [CalendarLesson, CalendarLesson | undefined]
            const teacher = name(teacherName(issue.teacherId))
            const h: Highlight = { teacherId: issue.teacherId, lessonIds: issue.lessons.map((l) => l.id) }
            let text: ReactNode
            let action: ReactNode
            const openFirst = (
              <button type="button" className="btn btn--sm" onClick={() => onOpenLesson(first)}>
                {tx(S.openLesson)}
              </button>
            )
            if (issue.kind === 'conflict') {
              text =
                issue.lessons.length === 2 && second
                  ? line(S.attnConflict, { teacher, time: time(first), a: name(lessonName(first, tx)), b: name(lessonName(second, tx)) })
                  : line(S.attnConflictMany, { teacher, time: time(first), n: lessonsCount(issue.lessons.length, locale) })
              action = openFirst
            } else if (issue.kind === 'absent') {
              text =
                issue.lessons.length === 1
                  ? line(S.attnAbsentOne, { teacher, time: time(first) })
                  : line(S.attnAbsent, { teacher, time: time(first), n: lessonsCount(issue.lessons.length, locale) })
              action = deskAccess ? (
                <Link className="btn btn--sm" to={`/teachers/schedules?teacher=${encodeURIComponent(issue.teacherId)}`}>
                  {tx(S.openDesk)}
                </Link>
              ) : (
                <button type="button" className="btn btn--sm" onClick={() => onReveal(h)}>
                  {tx(S.showOnGrid)}
                </button>
              )
            } else if (issue.kind === 'payment') {
              text = line(S.attnPayment, { student: name(lessonName(first, tx)), time: time(first), teacher })
              action =
                !first.anonymous && first.learner ? (
                  <Link className="btn btn--sm" to={studentPath(first.learner.id)}>
                    {tx(S.openStudent)}
                  </Link>
                ) : (
                  openFirst
                )
            } else {
              text =
                issue.lessons.length === 1
                  ? line(S.attnOutsideOne, { teacher, time: time(first) })
                  : line(S.attnOutside, { teacher, time: time(first), n: lessonsCount(issue.lessons.length, locale) })
              action = openFirst
            }
            return (
              <li
                key={issue.key}
                className={`sc-attn__item sc-attn__item--${issue.kind}`}
                onMouseEnter={() => onHighlight(h)}
                onMouseLeave={() => onHighlight(null)}
                onFocus={() => onHighlight(h)}
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onHighlight(null)
                }}
              >
                <button type="button" className="sc-attn__text" title={tx(S.showOnGrid)} onClick={() => onReveal(h)}>
                  {showDay && (
                    <span className="sc-attn__day">{dayLabel(issue.day, locale, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                  )}
                  <span className="sc-attn__sentence">{text}</span>
                </button>
                <div className="sc-attn__act">{action}</div>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}
