import type { ReactNode } from 'react'
import { Badge } from './Badge'

/**
 * THE ONE PLACE CURRENT AND HISTORICAL STATE ARE RENDERED DIFFERENTLY.
 *
 * Phase 3's whole point is that a past relationship stays visible without ever
 * being mistaken for a present one. Every screen that shows a teacher, a
 * supervisor, a group member or a group teacher renders through these two
 * components, so the distinction is made once and cannot be forgotten on one
 * screen and remembered on another.
 *
 * The difference is carried by STRUCTURE and WORDS -- separate sections, an
 * explicit "Former" heading, an end date on every historical row -- and only
 * additionally by colour. A reader who cannot distinguish the tones still sees
 * two labelled sections.
 */
export function CurrentSection({
  title,
  empty,
  children,
}: {
  title: string
  empty: string
  children: ReactNode
}) {
  const isEmpty = Array.isArray(children) ? children.length === 0 : !children
  return (
    <section className="panel">
      <h3 className="panel__title">
        {title} <Badge tone="ok">Current</Badge>
      </h3>
      {isEmpty ? <p className="muted">{empty}</p> : <ul className="list">{children}</ul>}
    </section>
  )
}

export function HistorySection({
  title,
  empty,
  children,
}: {
  title: string
  empty: string
  children: ReactNode
}) {
  const isEmpty = Array.isArray(children) ? children.length === 0 : !children
  return (
    <section className="panel panel--muted">
      <h3 className="panel__title">
        {title} <Badge tone="neutral">History</Badge>
      </h3>
      {isEmpty ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul className="list list--history">{children}</ul>
      )}
    </section>
  )
}

/** A historical row. It always states when the relationship ENDED. */
export function HistoryRow({
  who,
  started,
  ended,
  reason,
  note,
}: {
  who: string
  started?: string | null
  ended?: string | null
  reason?: string | null
  note?: string | null
}) {
  return (
    <li className="list__row list__row--history">
      <span className="list__primary">{who}</span>
      <span className="muted">
        {started ? formatDate(started) : '—'} → {ended ? formatDate(ended) : '—'}
      </span>
      {reason ? <span className="muted">{reason}</span> : null}
      {note ? <em className="muted">{note}</em> : null}
    </li>
  )
}

export function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10)
}
