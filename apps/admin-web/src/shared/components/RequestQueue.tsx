import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { LOCALE_TAG, useI18n } from '@/core/i18n/I18nProvider'
import { ACADEMY_ZONE } from '@/core/time/academyTime'
import { Dialog } from './Dialog'
import { Icon, type IconName } from './Icon'
import './request-queue.css'

/**
 * The one pattern every requests-and-approvals page shares:
 *
 *   FlowStrip      the page's states as a ruled row of counts; a click filters
 *   RequestQueue   the queue beside a detail panel that stays on screen
 *   FlowSteps      the request's steps as a vertical list of dots
 *
 * From 1100px the detail is a panel at the inline end; below that it is the
 * side sheet (one pane on a phone). The page owns its data, its filter and its
 * rules: these components only lay them out.
 */

type Pair = { en: string; ar: string }
const WORDS = {
  close: { en: 'Close', ar: 'إغلاق' },
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

/** True where the detail panel stays on screen beside the queue. */
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
  /** Changes when another row is opened, so the panel starts from its top. */
  id: string
  title: string
  /** What kind of request this is: its icon and a word, above the title. */
  kind?: { icon: IconName; label: string }
  status?: ReactNode
  body: ReactNode
  onClose: () => void
  /** The panel always shows a row (the page falls back to its first), so it offers no close. */
  pinned?: boolean
  /** The body brings its own heading (a record the page also shows outside the panel). */
  bare?: boolean
}

/** The head of a detail: its kind, its name in display type, its status. For a body that is `bare`. */
export function DetailHead({ id, title, kind, status, children }: { id?: string; title: string; kind?: RequestDetail['kind']; status?: ReactNode; children?: ReactNode }) {
  return (
    <header className="rq-panel__head">
      {kind && (
        <div className="rq-panel__top">
          <span className="rq-kind">
            <Icon name={kind.icon} size={18} />
            {kind.label}
          </span>
        </div>
      )}
      <h2 className="rq-panel__title" id={id}><bdi>{title}</bdi></h2>
      {status && <div className="rq-lead__status">{status}</div>}
      {children}
    </header>
  )
}

export function RequestQueue({
  label,
  detail,
  placeholder,
  children,
}: {
  /** The detail panel's accessible name. */
  label: string
  detail: RequestDetail | null
  /** What the panel says while no row is open. Left out, the queue takes the full width. */
  placeholder?: ReactNode
  children: ReactNode
}) {
  const { locale } = useI18n()
  const wide = useWidePane()
  const lead = detail && (detail.kind || detail.status) ? (
    <div className="rq-lead">
      {detail.kind && (
        <span className="rq-kind">
          <Icon name={detail.kind.icon} size={18} />
          {detail.kind.label}
        </span>
      )}
      {detail.status && <span className="rq-lead__status">{detail.status}</span>}
    </div>
  ) : null

  if (!wide) {
    return (
      <div className="rq">
        <div className="rq__queue">{children}</div>
        {detail && (
          <Dialog title={detail.title} onClose={detail.onClose} variant="sheet">
            <div className="rq-detail" key={detail.id}>
              {lead}
              {detail.body}
            </div>
          </Dialog>
        )}
      </div>
    )
  }

  const panel = detail?.bare ? (
    <div className="rq-detail" key={detail.id}>
      {detail.body}
    </div>
  ) : detail ? (
    <div className="rq-detail" key={detail.id}>
      <header className="rq-panel__head">
        {(detail.kind || !detail.pinned) && (
          <div className="rq-panel__top">
            {detail.kind && (
              <span className="rq-kind">
                <Icon name={detail.kind.icon} size={18} />
                {detail.kind.label}
              </span>
            )}
            {!detail.pinned && (
              <button type="button" className="btn btn--ghost btn--icon btn--sm rq-panel__close" onClick={detail.onClose} aria-label={WORDS.close[locale]}>
                <Icon name="close" size={16} />
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
  ) : (
    placeholder
  )

  return (
    <div className={panel ? 'rq rq--split' : 'rq'}>
      <div className="rq__queue">{children}</div>
      {panel && (
        <aside className="rq__panel" aria-label={label}>
          {panel}
        </aside>
      )}
    </div>
  )
}

/** What the panel says before a row is opened: one line, and what a row will show. */
export function PanelHint({ children }: { children: ReactNode }) {
  return <div className="rq-hint">{children}</div>
}

/** A titled part of the detail: a quiet label over a hairline. */
export function DetailSection({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rq-section" aria-label={title}>
      <div className="rq-section__head">
        <h3 className="section-label rq-section__title">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** The detail's actions: they stay at the foot of the panel while it scrolls. */
export function DetailActions({ children }: { children: ReactNode }) {
  return <div className="rq-actions">{children}</div>
}

/**
 * The act that ends a request (cancel, decline, lost). It waits at the end of
 * the detail, below everything else, so it is found on purpose and never by a
 * slip beside the primary action.
 */
export function DetailEnd({ children }: { children: ReactNode }) {
  return <div className="rq-end">{children}</div>
}

/* ----------------------------------------------------------------- strip */

export interface FlowCell<K extends string> {
  key: K
  label: string
  /** Null when the count is not known: the cell then shows its name alone, never a zero. */
  count: number | null
  /** The list holds more than were counted ("25+"). */
  more?: boolean
  note?: string
  /** A real problem: the numeral and the note turn terracotta. */
  late?: boolean
  /** A total or a side list, set apart from the steps of the flow. */
  apart?: boolean
}

/**
 * The states of a page as a ruled row of counts. The cells that are steps of
 * the flow are joined by a small notch on the rule between them; a total or a
 * closed list stands apart. `tabs` keeps tab semantics where a page had tabs.
 */
export function FlowStrip<K extends string>({
  label,
  cells,
  value,
  onChange,
  tabs = false,
  children,
}: {
  label: string
  cells: ReadonlyArray<FlowCell<K>>
  value: K
  onChange: (key: K) => void
  tabs?: boolean
  /** Further cells the page draws itself (a toggle that is not one of the states). */
  children?: ReactNode
}) {
  return (
    <div className="ledger rq-strip" role={tabs ? 'tablist' : 'group'} aria-label={label}>
      {cells.map((c) => (
        <FlowStripCell
          key={c.key}
          cell={c}
          active={c.key === value}
          tab={tabs}
          onClick={() => onChange(c.key)}
        />
      ))}
      {children}
    </div>
  )
}

export function FlowStripCell({
  cell,
  active,
  onClick,
  tab = false,
}: {
  cell: Omit<FlowCell<string>, 'key'>
  active: boolean
  onClick: () => void
  tab?: boolean
}) {
  const { locale, number } = useI18n()
  const cls = [
    'ledger__cell',
    'rq-strip__cell',
    cell.apart ? 'rq-strip__cell--apart' : 'rq-strip__cell--step',
    cell.late ? 'ledger__cell--late' : '',
    cell.count === 0 ? 'rq-strip__cell--zero' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const state = tab ? { role: 'tab' as const, 'aria-selected': active } : { 'aria-pressed': active }
  return (
    <button type="button" className={cls} onClick={onClick} {...state}>
      <span className="ledger__label">{cell.label}</span>
      {(cell.count !== null || cell.note) && (
        <span className="rq-strip__figure">
          {cell.count !== null && (
            <span className="ledger__value">
              {number(cell.count)}
              {cell.more && (
                <>
                  <span className="rq-strip__more" aria-hidden="true">+</span>
                  <span className="sr-only"> {WORDS.more[locale]}</span>
                </>
              )}
            </span>
          )}
          {cell.note && <span className="ledger__note">{cell.note}</span>}
        </span>
      )}
    </button>
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
 * A request's steps, top to bottom. A filled teal dot is done, the gold ring is
 * where it stands now, a hairline ring is still to come, terracotta is a problem.
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

/* ------------------------------------------------------------------ rows */

/**
 * A queue row opens its detail from anywhere on it with a pointer; its own
 * button is the keyboard path. Clicks on the row's controls are theirs alone.
 */
export function rowOpener(open: () => void) {
  return (event: MouseEvent<HTMLTableRowElement>) => {
    if ((event.target as HTMLElement).closest('button, a, input, select, textarea, label')) return
    open()
  }
}

/** The row's name, as the button that opens it. */
export function RowOpen({
  selected,
  onOpen,
  children,
  label,
}: {
  selected: boolean
  onOpen: () => void
  children: ReactNode
  /** An accessible name other than the visible text. */
  label?: string
}) {
  return (
    <button type="button" className="rq-open" onClick={onOpen} aria-current={selected ? 'true' : undefined} aria-label={label}>
      <bdi>{children}</bdi>
    </button>
  )
}

/* ------------------------------------------------------------------- age */

const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: ACADEMY_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
/** The academy's calendar day of an instant, as YYYY-MM-DD. */
const academyDay = (d: Date) => dayKey.format(d)
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

/**
 * True when something has waited since before today on the academy's calendar.
 * A display rule only (it colours an age): no deadline is recorded for these
 * requests, so "left overnight" is what the pages call late.
 */
export function waitedOvernight(iso: string, now: Date = new Date()): boolean {
  const t = new Date(iso)
  return !Number.isNaN(t.getTime()) && academyDay(t) < academyDay(now)
}

/** "in 2 days", "3 hours ago", "yesterday": by the academy's calendar, in the reader's language. */
export function ageText(iso: string, locale: 'ar' | 'en', now: Date = new Date()): string {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return iso
  const f = new Intl.RelativeTimeFormat(LOCALE_TAG[locale], { numeric: 'auto' })
  const days = daysBetween(academyDay(now), academyDay(t))
  if (days !== 0) return f.format(days, 'day')
  const minutes = Math.round((t.getTime() - now.getTime()) / 60_000)
  if (Math.abs(minutes) < 60) return f.format(minutes, 'minute')
  return f.format(Math.round(minutes / 60), 'hour')
}

/** An age in words; the exact time is its title. Terracotta only when `late`. */
export function Age({ iso, late = false }: { iso: string; late?: boolean }) {
  const { locale, dateTime } = useI18n()
  return (
    <time className={late ? 'rq-age rq-age--late' : 'rq-age'} dateTime={iso} title={dateTime(iso)}>
      {ageText(iso, locale)}
    </time>
  )
}
