import { Fragment, useEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { LOCALE_TAG, useI18n } from '@/core/i18n/I18nProvider'
import { ACADEMY_ZONE } from '@/core/time/academyTime'
import { Dialog } from './Dialog'
import { Icon, type IconName } from './Icon'
import { Menu, type MenuItem } from './Menu'
import './request-queue.css'

/**
 * What every requests-and-approvals page is composed from:
 *
 *   RequestQueue   the work, and the open request's inspector beside it
 *   QueueGroup     a headed sheet of rows that belong together (a day, a wait)
 *   QueueRow       one designed row: a lead, who, why it is here, the fact, its action
 *   Board          the flow as columns of cards, first stage first; tabs when narrow
 *   BoardCard      one request on the board: who, the waiting fact, a status, one action
 *   DetailCallout  the inspector's top: where it stands, in a sentence, and its one action
 *   DetailSection  a titled part of the inspector: facts, steps, activity
 *   FlowSteps      the request's steps as a vertical list of dots
 *
 * The inspector has one anatomy on every page: the kind and the name, then the
 * state callout with the one thing to do, then the facts, the steps and the
 * activity. From 1100px it is a white sheet at the inline end; below that it is
 * the side sheet (full screen on a phone). The page owns its data, its filter
 * and its rules: these only lay them out.
 */

type Pair = { en: string; ar: string }
const WORDS = {
  close: { en: 'Close', ar: 'إغلاق' },
  all: { en: 'All', ar: 'الكل' },
  done: { en: 'done', ar: 'تم' },
  current: { en: 'now', ar: 'الآن' },
  todo: { en: 'next', ar: 'لاحقًا' },
  problem: { en: 'problem', ar: 'مشكلة' },
  skipped: { en: 'skipped', ar: 'لم يحدث' },
  more: { en: 'or more', ar: 'أو أكثر' },
} satisfies Record<string, Pair>

/* ---------------------------------------------------------------- layout */

const WIDE = '(min-width: 1100px)'
const media = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(WIDE) : null)

/** True where the inspector stays on screen beside the work, and a board has room for its columns. */
export function useWidePane(): boolean {
  const [wide, setWide] = useState(() => media()?.matches ?? false)
  useEffect(() => {
    const m = media()
    if (!m) return
    const sync = () => setWide(m.matches)
    sync()
    m.addEventListener('change', sync)
    return () => m.removeEventListener('change', sync)
  }, [])
  return wide
}

export interface RequestDetail {
  /** Changes when another request is opened, so the inspector starts from its top. */
  id: string
  title: string
  /** What kind of request this is: its icon and a word, above the title. */
  kind?: { icon: IconName; label: string }
  /** A status beside the title, for a page whose body has no `DetailCallout` to carry it. */
  status?: ReactNode
  body: ReactNode
  onClose: () => void
  /** The inspector always shows a request (the page falls back to its first), so it offers no close. */
  pinned?: boolean
}

/** What kind of request it is: its icon and a word. */
function Kind({ kind }: { kind: NonNullable<RequestDetail['kind']> }) {
  return (
    <span className="rq-kind">
      <Icon name={kind.icon} size={18} />
      {kind.label}
    </span>
  )
}

export function RequestQueue({
  label,
  detail,
  reserve = false,
  children,
}: {
  /** The inspector's accessible name. */
  label: string
  /** The open request. With none, the work has the full width; the inspector comes in when one opens. */
  detail: RequestDetail | null
  /**
   * Keep the inspector's place although nothing is open yet: for a page whose inspector
   * always shows a request, while its list is still loading, so nothing moves when it arrives.
   */
  reserve?: boolean
  children: ReactNode
}) {
  const { locale } = useI18n()
  const wide = useWidePane()

  if (!wide) {
    // The sheet names the request in its own title bar; the kind and the status lead its body.
    return (
      <div className="rq">
        <div className="rq__queue">{children}</div>
        {detail && (
          <Dialog title={detail.title} onClose={detail.onClose} variant="sheet">
            <div className="rq-detail" key={detail.id}>
              {(detail.kind || detail.status) && (
                <div className="rq-lead">
                  {detail.kind && <Kind kind={detail.kind} />}
                  {detail.status && <span className="rq-lead__status">{detail.status}</span>}
                </div>
              )}
              {detail.body}
            </div>
          </Dialog>
        )}
      </div>
    )
  }

  return (
    <div className={detail || reserve ? 'rq rq--wide rq--split' : 'rq rq--wide'}>
      <div className="rq__queue">{children}</div>
      {detail && (
        <aside className="rq__panel sheet" aria-label={label}>
          <div className="rq-detail" key={detail.id}>
            <header className="rq-panel__head">
              {(detail.kind || !detail.pinned) && (
                <div className="rq-panel__top">
                  {detail.kind && <Kind kind={detail.kind} />}
                  {!detail.pinned && (
                    <button type="button" className="btn btn--ghost btn--icon btn--sm rq-panel__close" onClick={detail.onClose} aria-label={WORDS.close[locale]}>
                      <Icon name="close" size={18} />
                    </button>
                  )}
                </div>
              )}
              {/* The name keeps its own direction; the heading keeps the page's alignment. */}
              <h2 className="rq-panel__title"><bdi>{detail.title}</bdi></h2>
              {detail.status && <div className="rq-lead__status">{detail.status}</div>}
            </header>
            {detail.body}
          </div>
        </aside>
      )}
    </div>
  )
}

/**
 * The top of the inspector: where the request stands (its status word and how
 * long it has waited), what that means in one sentence, a note that must not be
 * missed (what a reviewer asked for, a lock), and the one thing to do now, the
 * rest behind "⋯". Every request page opens its inspector with it.
 */
export function DetailCallout({
  status,
  state,
  note,
  primary,
  more,
  label,
  children,
}: {
  /** The status word and the age: a tag, never colour alone. */
  status?: ReactNode
  /** One sentence: where it stands and whose turn it is. */
  state?: ReactNode
  /** One more line that must not be missed. */
  note?: ReactNode
  primary?: ReactNode
  more?: MenuItem[]
  /** The "⋯" menu's accessible name. */
  label: string
  /** What the step needs in place: a code to read out, a confirmation. */
  children?: ReactNode
}) {
  return (
    <div className="rq-callout">
      {status && <div className="rq-callout__status">{status}</div>}
      {state && <p className="rq-callout__state">{state}</p>}
      {note && <div className="rq-callout__note">{note}</div>}
      {children}
      <DetailFoot primary={primary} more={more} label={label} />
    </div>
  )
}

/** A titled part of the inspector (facts, steps, activity), set apart by space and one soft line. */
export function DetailSection({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rq-section" aria-label={title}>
      <div className="rq-section__head">
        <h3 className="rq-section__title">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

/**
 * The ONE thing to do next, and everything else behind "⋯" (what ends the
 * request last, marked as such). Inside a `DetailCallout` it closes the callout;
 * on its own it is a foot that stays at the bottom of the inspector.
 */
export function DetailFoot({ primary, more, label }: { primary?: ReactNode; more?: MenuItem[]; label: string }) {
  const items = more ?? []
  if (!primary && items.length === 0) return null
  return (
    <div className="rq-foot">
      {primary}
      {items.length > 0 && <Menu label={label} items={items} icon="more" className="rq-foot__more" />}
    </div>
  )
}

/**
 * The inspector's foot when a decision has two stated sides (approve and
 * reject a receipt): both are shown, the first one solid.
 */
export function DetailActions({ children }: { children: ReactNode }) {
  return <div className="rq-foot rq-foot--pair">{children}</div>
}

/* ---------------------------------------------------------- groups & rows */

/**
 * Rows that belong together (a day, a wait), on their own headed sheet. An
 * urgent group's count is solid red. `note` is one quiet fact at the head's
 * end: how the rows are ordered ("longest wait first").
 */
export function QueueGroup({
  title,
  count,
  tone,
  note,
  children,
}: {
  title: string
  count?: number
  tone?: 'urgent' | 'quiet'
  note?: ReactNode
  children: ReactNode
}) {
  const { number } = useI18n()
  return (
    <section className={tone === 'urgent' ? 'sheet rq-group rq-group--urgent' : 'sheet rq-group'} aria-label={title}>
      <header className="sheet__head">
        <h2 className="sheet__title">
          {title}
          {count !== undefined && <span className={tone === 'urgent' ? 'count count--urgent rq-group__count' : 'count rq-group__count'}>{number(count)}</span>}
        </h2>
        {note && <span className="rq-group__note">{note}</span>}
      </header>
      <ul className="rq-rows">{children}</ul>
    </section>
  )
}

/**
 * A request opens from anywhere on its row or card with a pointer; its own
 * button is the keyboard path. Clicks on its controls are theirs alone.
 */
export function rowOpener(open: () => void) {
  return (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button, a, input, select, textarea, label, [role="menu"]')) return
    open()
  }
}

/**
 * One designed row: what leads it (a time, a type), who, why it is here in one
 * sentence (`sub`), the fact that matters, a tag, and its actions (one stated,
 * the rest in "⋯").
 */
export function QueueRow({
  lead,
  title,
  sub,
  fact,
  tag,
  actions,
  selected = false,
  onOpen,
}: {
  lead?: ReactNode
  title: string
  sub?: ReactNode
  fact?: ReactNode
  tag?: ReactNode
  actions?: ReactNode
  selected?: boolean
  /** Given, the name is the button that opens the request and the whole row opens it. */
  onOpen?: () => void
}) {
  return (
    <li className="rq-row" data-selected={selected || undefined} onClick={onOpen ? rowOpener(onOpen) : undefined}>
      {lead && <div className="rq-row__lead">{lead}</div>}
      <div className="rq-row__main">
        {onOpen ? (
          <button type="button" className="rq-open" onClick={onOpen} aria-current={selected ? 'true' : undefined}>
            <bdi>{title}</bdi>
          </button>
        ) : (
          <strong className="rq-row__title"><bdi>{title}</bdi></strong>
        )}
        {sub && <span className="rq-sub rq-why">{sub}</span>}
      </div>
      {fact && <div className="rq-row__fact">{fact}</div>}
      {tag && <div className="rq-row__tag">{tag}</div>}
      {actions && <div className="rq-row__actions">{actions}</div>}
    </li>
  )
}

/* ----------------------------------------------------------------- board */

export interface BoardStage<K extends string> {
  key: K
  label: string
  /** Null until its list has arrived: the head then shows its name alone, never a zero. */
  count: number | null
  /** The list holds more than were counted ("25+"). */
  more?: boolean
  /** A stage that holds a real problem: its count is solid red. */
  urgent?: boolean
  /** A stage where the work has ended (sent, converted, lost): a narrower column of quieter cards. */
  quiet?: boolean
  /** The stage's cards. */
  cards: ReactNode
  /** One line for a stage with no cards. */
  empty: string
  /** Under the cards: a way to the rest of a long stage. */
  foot?: ReactNode
}

/**
 * A flow as a board: one column per stage, in the flow's order (the first stage
 * at the inline start, so the columns read right to left in Arabic), each
 * headed by its name and count. Stages where the work has ended are narrower.
 * Cards move through the page's own actions; nothing is dragged.
 *
 * Below 1100px there is no room for columns: the stages become tabs with their
 * counts and the cards a list. `value` is the stage in view ('all' for every
 * stage); `tabs={false}` leaves the switch to the page (its masthead figures).
 */
export function Board<K extends string>({
  label,
  stages,
  value,
  onChange,
  tabs = true,
}: {
  label: string
  stages: ReadonlyArray<BoardStage<K>>
  value: K | 'all'
  onChange: (stage: K | 'all') => void
  tabs?: boolean
}) {
  const { locale, number } = useI18n()
  const wide = useWidePane()
  const boardRef = useRef<HTMLDivElement>(null)
  const edges = useScrollEdges(boardRef, wide)
  const shown = value === 'all' ? stages : stages.filter((s) => s.key === value)
  const figure = (s: BoardStage<K>) =>
    s.count === null ? null : (
      <>
        {number(s.count)}
        {s.more && (
          <>
            <span aria-hidden="true">+</span>
            <span className="sr-only"> {WORDS.more[locale]}</span>
          </>
        )}
      </>
    )
  const column = (s: BoardStage<K>) => (
    <section key={s.key} className={s.quiet ? 'rq-col rq-col--quiet' : 'rq-col'} aria-label={s.label}>
      <header className="rq-col__head">
        <h2 className="rq-col__title">{s.label}</h2>
        {s.count !== null && <span className={s.urgent ? 'count count--urgent' : 'count'}>{figure(s)}</span>}
      </header>
      <div className="rq-col__cards">{s.count === 0 ? <p className="rq-col__empty">{s.empty}</p> : s.cards}</div>
      {s.foot}
    </section>
  )

  if (wide) {
    // The stages where the work has ended share one narrower track, one above the other.
    const tracks: Array<Array<BoardStage<K>>> = []
    for (const s of shown) {
      const last = tracks.at(-1)
      if (s.quiet && last?.[0]?.quiet) last.push(s)
      else tracks.push([s])
    }
    return (
      <div
        ref={boardRef}
        className={shown.length === 1 ? 'rq-board rq-board--one' : 'rq-board'}
        role="group"
        aria-label={label}
        data-more-start={edges.start || undefined}
        data-more-end={edges.end || undefined}
        style={shown.length === 1 ? undefined : { gridTemplateColumns: tracks.map((t) => (t[0]!.quiet ? 'minmax(184px, 0.8fr)' : 'minmax(208px, 1fr)')).join(' ') }}
      >
        {tracks.map((t) => (t.length === 1 ? column(t[0]!) : <div key={t[0]!.key} className="rq-col-stack">{t.map(column)}</div>))}
      </div>
    )
  }

  const total = stages.every((s) => s.count !== null) ? stages.reduce((n, s) => n + (s.count ?? 0), 0) : null
  // In the list of every stage, a stage with nothing in it is left out: its tab already says so.
  const listed = value === 'all' ? stages.filter((s) => s.count !== 0) : shown
  return (
    <div className="rq-board rq-board--list">
      {tabs && (
        <div className="seg rq-board__tabs" role="group" aria-label={label}>
          <button type="button" className="seg__item" aria-pressed={value === 'all'} onClick={() => onChange('all')}>
            {WORDS.all[locale]}
            {total !== null && <span className="seg__count">{number(total)}</span>}
          </button>
          {stages.map((s) => (
            <button key={s.key} type="button" className="seg__item" aria-pressed={value === s.key} onClick={() => onChange(s.key)}>
              {s.label}
              {s.count !== null && <span className="seg__count">{figure(s)}</span>}
            </button>
          ))}
        </div>
      )}
      {listed.length === 0 && shown.length > 0 ? <p className="rq-col__empty">{shown[0]!.empty}</p> : listed.map(column)}
    </div>
  )
}

/**
 * Whether a board that scrolls sideways hides columns at its inline start or
 * end, so the hidden edge can fade. Direction-agnostic: in RTL, scrollLeft runs
 * from 0 to negative.
 */
function useScrollEdges(ref: RefObject<HTMLElement>, enabled: boolean) {
  const [edges, setEdges] = useState({ start: false, end: false })
  const update = () => {
    const el = ref.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    const at = Math.abs(el.scrollLeft)
    setEdges((e) => {
      const next = { start: at > 2, end: max - at > 2 }
      return next.start === e.start && next.end === e.end ? e : next
    })
  }
  // The columns change with the data, not only with the window: measure after every render.
  useEffect(update)
  useEffect(() => {
    const el = ref.current
    if (!enabled || !el) return
    el.addEventListener('scroll', update, { passive: true })
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
    observer?.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      observer?.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `update` reads only the ref and a state setter
  }, [ref, enabled])
  return edges
}

/**
 * One request on the board. Its anatomy is fixed and its parts differ by role:
 * the name (Readex, the heading) with its status word at the end of that line;
 * the waiting fact, the one emphasised line (red only when `late`); a few quiet
 * lines of what is known; then how long it has waited and its one action. A
 * `quiet` card (work that has ended) is the name and its lines, without a foot.
 */
export function BoardCard({
  title,
  onOpen,
  selected = false,
  titleOpens = true,
  status,
  fact,
  late = false,
  quiet = false,
  children,
  age,
  actions,
}: {
  title: string
  onOpen: () => void
  selected?: boolean
  /** False when the card's own primary action is "Open": the name is then plain text. */
  titleOpens?: boolean
  /** Its status word (a tag), at the end of the name's line. */
  status?: ReactNode
  /** Why the card waits in this column now ("follow-up was due on Tuesday"). */
  fact?: ReactNode
  /** The waiting fact has passed its time: drawn red. */
  late?: boolean
  quiet?: boolean
  children?: ReactNode
  age?: ReactNode
  actions?: ReactNode
}) {
  return (
    <article className={quiet ? 'rq-card rq-card--quiet' : 'rq-card'} data-selected={selected || undefined} onClick={rowOpener(onOpen)}>
      <div className="rq-card__head">
        <h3 className="rq-card__title">
          {titleOpens ? (
            <button type="button" className="rq-open" onClick={onOpen} aria-current={selected ? 'true' : undefined}>
              <bdi>{title}</bdi>
            </button>
          ) : (
            <bdi>{title}</bdi>
          )}
        </h3>
        {status && <span className="rq-card__status">{status}</span>}
      </div>
      {fact && <p className={late ? 'rq-card__fact rq-card__fact--late' : 'rq-card__fact'}>{fact}</p>}
      {children && <div className="rq-card__body">{children}</div>}
      {!quiet && (age || actions) && (
        <div className="rq-card__foot">
          <span className="rq-card__age">{age}</span>
          {actions}
        </div>
      )}
    </article>
  )
}

/* ----------------------------------------------------------------- steps */

export type StepState = 'done' | 'current' | 'todo' | 'problem' | 'skipped'

export interface FlowStep {
  key: string
  label: string
  state: StepState
  /** Who and when, in one quiet line. */
  meta?: ReactNode
  /** What this step needs now: a control, a code, a note. */
  children?: ReactNode
}

/**
 * A request's steps, top to bottom. A solid teal dot is done, a teal ring is
 * where it stands now, a soft ring is still to come, red is a problem.
 */
export function FlowSteps({ steps, label }: { steps: ReadonlyArray<FlowStep>; label: string }) {
  const { locale } = useI18n()
  return (
    <ol className="rq-steps" aria-label={label}>
      {steps.map((s) => (
        <li key={s.key} className={`rq-step rq-step--${s.state}`} aria-current={s.state === 'current' ? 'step' : undefined}>
          <span className="rq-step__dot" aria-hidden="true" />
          <div className="rq-step__text">
            <span className="rq-step__label">
              {s.label}
              <span className="sr-only"> ({WORDS[s.state][locale]})</span>
            </span>
            {s.meta && <span className="rq-step__meta">{s.meta}</span>}
            {s.children && <div className="rq-step__body">{s.children}</div>}
          </div>
        </li>
      ))}
    </ol>
  )
}

/* ------------------------------------------------------------- sentences */

/**
 * A reason line with its names isolated: each "{name}" in `text` becomes that
 * value in its own direction (a Latin name inside Arabic, or the reverse).
 */
export function sentence(text: string, vars: Record<string, ReactNode> = {}): ReactNode {
  return text.split(/\{(\w+)\}/).map((part, i) => (i % 2 === 1 ? <bdi key={i}>{vars[part] ?? ''}</bdi> : <Fragment key={i}>{part}</Fragment>))
}

/* ------------------------------------------------------------------- age */

const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: ACADEMY_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
/** The academy's calendar day of an instant, as YYYY-MM-DD. */
export const academyDayOf = (iso: string | Date): string => dayKey.format(typeof iso === 'string' ? new Date(iso) : iso)
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

/** How many academy calendar days from now to an instant: 0 today, 1 tomorrow, -1 yesterday. */
export function dayOffset(iso: string, now: Date = new Date()): number {
  return daysBetween(academyDayOf(now), academyDayOf(iso))
}

/**
 * True when something has waited since before today on the academy's calendar.
 * A display rule only (it colours an age): no deadline is recorded for these
 * requests, so "left overnight" is what the pages call late.
 */
export function waitedOvernight(iso: string, now: Date = new Date()): boolean {
  const t = new Date(iso)
  return !Number.isNaN(t.getTime()) && academyDayOf(t) < academyDayOf(now)
}

/**
 * A day by its name: "Thu 26 Nov" / "الخميس 26 نوفمبر", Western digits, the
 * month in words. Takes an instant or a calendar date (YYYY-MM-DD).
 */
export function dayName(value: string, locale: 'ar' | 'en', weekday = true): string {
  const t = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value)
  if (Number.isNaN(t.getTime())) return value
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { ...(weekday ? { weekday: locale === 'ar' ? 'long' : 'short' } : {}), day: 'numeric', month: 'long', timeZone: ACADEMY_ZONE }).format(t)
}

/** "in 2 days", "3 hours ago", "yesterday": by the academy's calendar, in the reader's language. */
export function ageText(iso: string, locale: 'ar' | 'en', now: Date = new Date()): string {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return iso
  const f = new Intl.RelativeTimeFormat(LOCALE_TAG[locale], { numeric: 'auto' })
  const days = daysBetween(academyDayOf(now), academyDayOf(t))
  if (days !== 0) return f.format(days, 'day')
  const minutes = Math.round((t.getTime() - now.getTime()) / 60_000)
  if (Math.abs(minutes) < 60) return f.format(minutes, 'minute')
  return f.format(Math.round(minutes / 60), 'hour')
}

/** An age in words; the exact time is its title. Red only when `late`. */
export function Age({ iso, late = false }: { iso: string; late?: boolean }) {
  const { locale, dateTime } = useI18n()
  return (
    <time className={late ? 'rq-age rq-age--late' : 'rq-age'} dateTime={iso} title={dateTime(iso)}>
      {ageText(iso, locale)}
    </time>
  )
}
