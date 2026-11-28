import { Fragment, type ReactNode } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { formatWhen } from '@/features/trials/copy'
import { I, useCopy } from './copy'
import { H, HISTORY } from './historyCopy'
import { useFamilyHistory } from './hooks'
import type { FamilyHistoryEntry } from './api'
import './family-history.css'

/**
 * PD-42 S4 on the Parent Profile: the family's history -- who entered it and
 * its children, who owns it, who chose its Operations supervisor, its packages
 * -- oldest first, each with who did it and when. Read by whoever owns the
 * family (the server decides); a refusal shows nothing.
 */
export function FamilyHistorySection({ familyId }: { familyId: string }) {
  const tx = useCopy()
  const q = useFamilyHistory(familyId)
  if (!q.data) return null
  return (
    <section className="card panel tf-section" aria-labelledby="pf-history">
      <div className="tf-section__head">
        <h2 id="pf-history" className="tf-section__title">{tx(H.title)}</h2>
      </div>
      <p className="field__hint">{tx(H.hint)}</p>
      {q.data.entries.length === 0 ? (
        <p className="tf-muted">{tx(H.empty)}</p>
      ) : (
        <ul className="pf-people">
          {q.data.entries.map((e) => <HistoryLine key={e.id} e={e} />)}
        </ul>
      )}
    </section>
  )
}

/**
 * A separator that belongs to what came before it: a no-break space holds the
 * dot to the previous word, and the line may only break after it. So a dot
 * never leads a line, in either direction.
 */
const DOT = ' · '

function HistoryLine({ e }: { e: FamilyHistoryEntry }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const label = HISTORY[e.action] ? tx(HISTORY[e.action]!) : e.action
  const d = e.details
  // Each name and each figure is its own isolated run: a Latin name inside the
  // Arabic line (or the reverse) keeps its place and its spaces.
  const facts: ReactNode[] = []
  if (e.subject.kind !== 'family' && e.subject.name) facts.push(<bdi className="fh-run">{e.subject.name}</bdi>)
  if (d.supervisor?.name) facts.push(<bdi className="fh-run">{d.supervisor.name}</bdi>)
  if (d.from !== undefined || d.to !== undefined) {
    const to = <bdi className="fh-run">{d.to?.name ?? '—'}</bdi>
    facts.push(
      d.from?.name ? (
        <>
          {/* The arrow follows the reading direction: from, then to. */}
          <bdi className="fh-run">{d.from.name}</bdi> {locale === 'ar' ? '←' : '→'} {to}
        </>
      ) : (
        to
      ),
    )
  }
  if (d.total != null && d.completed != null) {
    facts.push(<bdi className="fh-run">{tx(I.total)} {d.total}</bdi>, <bdi className="fh-run">{tx(I.completed)} {d.completed}</bdi>)
    if (d.planMonths != null) facts.push(<bdi className="fh-run">{d.planMonths} {tx(I.months)}</bdi>)
  }
  if (d.children != null && e.action === 'family.children_added') facts.push(<bdi className="fh-run">{d.children} {tx(H.children)}</bdi>)
  return (
    <li>
      <strong>{label}</strong>
      {facts.map((fact, i) => (
        <Fragment key={i}>
          {DOT}
          {fact}
        </Fragment>
      ))}
      <br />
      <span className="tf-muted">
        <bdi className="fh-run">{e.actor?.name ?? tx(H.system)}</bdi>
        {DOT}
        <time dateTime={e.at}>{formatWhen(e.at, locale)}</time>
      </span>
      {e.reason && <p className="tf-muted"><bdi>{e.reason}</bdi></p>}
    </li>
  )
}
