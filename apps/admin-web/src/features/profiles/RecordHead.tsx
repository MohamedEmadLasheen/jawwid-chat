import { Fragment, useEffect, useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Icon, type IconName } from '@/shared/components/Icon'
import { useCopy } from './copy'

/**
 * One anatomy for every record (a parent's file, a student's file, a staff
 * member's profile), so a manager reads any of them the same way:
 *
 *   the way back, and arrows that walk the list the record was opened from
 *   who: photo or initials, the name, a status word, one sentence that says
 *        their role and who they answer to; the actions at the end
 *   highlights: at most six facts chosen for this kind of record
 *   one callout, with one action, only when something needs a person now
 *   the tabs, with their counts
 */

export interface Highlight {
  key: string
  icon: IconName
  label: string
  value: ReactNode
  /** One quiet line under the value. */
  note?: ReactNode
  /** Only the value carries the colour; the tile does not. */
  tone?: 'urgent' | 'waiting' | 'quiet'
  /** Where the highlight leads (a tab, a section). */
  to?: string
}

export interface Callout {
  tone: 'urgent' | 'waiting'
  /** One sentence: what needs a person. */
  title: ReactNode
  /** At most one further sentence. */
  body?: ReactNode
  /** The one thing to do about it. */
  action?: ReactNode
}

export interface Walk {
  prev: { to: string; label: string } | null
  next: { to: string; label: string } | null
  /** 1-based. */
  at: number
  of: number
}

const C = {
  walk: { en: 'Walk the list', ar: 'التنقل في القائمة' },
  prev: { en: 'Previous: {name}', ar: 'السابق: {name}' },
  next: { en: 'Next: {name}', ar: 'التالي: {name}' },
  position: { en: '{at} of {of}', ar: '{at} من {of}' },
  highlights: { en: 'At a glance', ar: 'لمحة' },
} as const

export function RecordHead({
  back,
  walk,
  lead,
  name,
  status,
  line,
  actions,
  highlights,
  callout,
  tabs,
}: {
  back?: { to: string; label: string }
  walk?: Walk | null
  lead: ReactNode
  name: string
  status?: ReactNode
  /** The record's one sentence: role and reporting line. */
  line?: ReactNode
  actions?: ReactNode
  highlights?: Highlight[]
  callout?: Callout | null
  tabs?: ReactNode
}) {
  const tx = useCopy()
  const { number } = useI18n()
  const shown = (highlights ?? []).slice(0, 6)
  return (
    <header className="rec-head">
      {(back || walk) && (
        <div className="rec-head__bar">
          {back ? (
            <Link to={back.to} className="mast__back rec-head__back">
              <Icon name="arrowBack" size={16} />
              {back.label}
            </Link>
          ) : (
            <span />
          )}
          {walk && (
            <nav className="rec-walk" aria-label={tx(C.walk)}>
              <span className="rec-walk__at">
                {tx(C.position, { at: number(walk.at), of: number(walk.of) })}
              </span>
              <WalkLink to={walk.prev} icon="caretLeft" kind="prev" />
              <WalkLink to={walk.next} icon="chevronForward" kind="next" />
            </nav>
          )}
        </div>
      )}
      <div className="rec-head__row">
        <div className="rec-head__lead">{lead}</div>
        <div className="rec-head__who">
          <div className="rec-head__title">
            <h1 className="rec-head__name" dir="auto">
              {name}
            </h1>
            {status}
          </div>
          {line && <p className="rec-head__line">{line}</p>}
        </div>
        {actions && <div className="page-header__actions rec-head__actions">{actions}</div>}
      </div>
      {shown.length > 0 && <Highlights items={shown} />}
      {callout && <RecordCallout callout={callout} />}
      {tabs && <div className="rec-head__tabs">{tabs}</div>}
    </header>
  )
}

function WalkLink({ to, icon, kind }: { to: Walk['prev']; icon: IconName; kind: 'prev' | 'next' }) {
  const tx = useCopy()
  // "Previous" points back along the reading direction; the icon mirrors with the page.
  const glyph = <Icon name={icon} size={18} />
  if (!to) {
    return (
      <span className={`btn btn--icon btn--sm btn--ghost rec-walk__btn rec-walk__btn--${kind}`} aria-disabled="true">
        {glyph}
      </span>
    )
  }
  return (
    <Link
      to={to.to}
      className={`btn btn--icon btn--sm btn--ghost rec-walk__btn rec-walk__btn--${kind}`}
      aria-label={tx(kind === 'prev' ? C.prev : C.next, { name: to.label })}
      title={to.label}
    >
      {glyph}
    </Link>
  )
}

/**
 * The highlights: a handful of facts on one white surface, each a small label
 * with its icon over a value. They keep the shared figure classes, so a
 * highlight that leads somewhere behaves as every figure does.
 */
function Highlights({ items }: { items: Highlight[] }) {
  const tx = useCopy()
  return (
    <dl className="figures rec-hl" aria-label={tx(C.highlights)} data-count={items.length}>
      {items.map((h) => {
        const cls = `figure rec-hl__item${h.tone === 'urgent' ? ' figure--urgent' : h.tone === 'quiet' ? ' figure--quiet' : h.tone === 'waiting' ? ' rec-hl__item--waiting' : ''}`
        const body = (
          <>
            <dt className="figure__label">
              <Icon name={h.icon} size={15} />
              {h.label}
            </dt>
            <dd className="figure__value">
              <span className="figure__n">{h.value}</span>
            </dd>
            {h.note && <dd className="figure__note">{h.note}</dd>}
          </>
        )
        return h.to ? (
          <Link key={h.key} to={h.to} className={`${cls} figure--link`}>
            {body}
          </Link>
        ) : (
          <div key={h.key} className={cls}>
            {body}
          </div>
        )
      })}
    </dl>
  )
}

function RecordCallout({ callout }: { callout: Callout }) {
  return (
    <div className={`rec-callout rec-callout--${callout.tone}`} role="status">
      <span className="rec-callout__icon" aria-hidden="true">
        <Icon name={callout.tone === 'urgent' ? 'alert' : 'clock'} size={18} />
      </span>
      <p className="rec-callout__text">
        <strong>{callout.title}</strong>
        {callout.body && <span>{callout.body}</span>}
      </p>
      {callout.action && <div className="rec-callout__act">{callout.action}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ walking */

const WALK_KEY = 'jawwid.walk.'

interface WalkList {
  ids: string[]
  names: string[]
}

/**
 * A directory remembers the order it last showed, so a record opened from it
 * can step to the one before and after. Kept for this tab only; when there is
 * no list (a record opened from a link or a search), no arrows are drawn.
 */
export function useRememberWalk(kind: string, rows: ReadonlyArray<{ id: string; name: string }> | undefined) {
  const ids = rows?.map((r) => r.id).join('|')
  useEffect(() => {
    if (!rows || rows.length === 0) return
    try {
      const list: WalkList = { ids: rows.map((r) => r.id), names: rows.map((r) => r.name) }
      sessionStorage.setItem(WALK_KEY + kind, JSON.stringify(list))
    } catch {
      // Walking is a convenience; without storage there are simply no arrows.
    }
    // `ids` stands for the rows' order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, ids])
}

export function useWalk(kind: string, id: string, path: (id: string) => string): Walk | null {
  return useMemo(() => {
    let list: WalkList | null = null
    try {
      const raw = sessionStorage.getItem(WALK_KEY + kind)
      list = raw ? (JSON.parse(raw) as WalkList) : null
    } catch {
      list = null
    }
    if (!list || !Array.isArray(list.ids)) return null
    const at = list.ids.indexOf(id)
    if (at < 0 || list.ids.length < 2) return null
    const step = (i: number) => (i >= 0 && i < list!.ids.length ? { to: path(list!.ids[i]!), label: list!.names[i] ?? '' } : null)
    return { prev: step(at - 1), next: step(at + 1), at: at + 1, of: list.ids.length }
    // `path` is a plain builder; the id and the kind decide the answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id])
}

/**
 * A sentence from a copy template whose `{name}` slots are filled with
 * elements (an amount in its own isolate, a name as a link), so numbers and
 * Latin names never reorder the Arabic around them.
 */
export function fill(template: string, parts: Record<string, ReactNode>): ReactNode {
  const out: ReactNode[] = []
  let last = 0
  template.replace(/\{(\w+)\}/g, (m: string, k: string, at: number) => {
    out.push(template.slice(last, at))
    out.push(k in parts ? <Fragment key={`${k}-${at}`}>{parts[k]}</Fragment> : m)
    last = at + m.length
    return m
  })
  out.push(template.slice(last))
  return <>{out}</>
}
