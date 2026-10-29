import { useI18n } from '@/core/i18n/I18nProvider'
import { formatWhen } from '@/features/trials/copy'
import { I, useCopy } from './copy'
import { H, HISTORY } from './historyCopy'
import { useFamilyHistory } from './hooks'
import type { FamilyHistoryEntry } from './api'

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

function HistoryLine({ e }: { e: FamilyHistoryEntry }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const label = HISTORY[e.action] ? tx(HISTORY[e.action]!) : e.action
  const d = e.details
  const facts: string[] = []
  if (e.subject.kind !== 'family' && e.subject.name) facts.push(e.subject.name)
  if (d.supervisor?.name) facts.push(d.supervisor.name)
  if (d.from !== undefined || d.to !== undefined) {
    facts.push(d.from?.name ? `${d.from.name} → ${d.to?.name ?? '—'}` : d.to?.name ?? '—')
  }
  if (d.total != null && d.completed != null) {
    facts.push([
      `${tx(I.total)} ${d.total}`,
      `${tx(I.completed)} ${d.completed}`,
      ...(d.planMonths != null ? [`${d.planMonths} ${tx(I.months)}`] : []),
    ].join(' · '))
  }
  if (d.children != null && e.action === 'family.children_added') facts.push(`${d.children} ${tx(H.children)}`)
  return (
    <li>
      <strong>{label}</strong>
      {facts.length > 0 && <span dir="auto"> · {facts.join(' · ')}</span>}
      <br />
      <span className="tf-muted">
        <bdi>{e.actor?.name ?? tx(H.system)}</bdi> · <time dateTime={e.at}>{formatWhen(e.at, locale)}</time>
      </span>
      {e.reason && <p className="tf-muted" dir="auto">{e.reason}</p>}
    </li>
  )
}
