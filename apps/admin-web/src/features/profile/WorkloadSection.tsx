import { useI18n } from '@/core/i18n/I18nProvider'
import type { StaffWorkload } from './api'
import { METRICS, T, useCopy, type Pair } from './copy'

type Key = keyof StaffWorkload
const LABEL = Object.fromEntries(METRICS.map((m) => [m.key, m.label])) as Record<Key, Pair>

/**
 * Each large numeral with the smaller count that belongs under it: a family's
 * contacts, the students' teachers, the open chats still waiting for us.
 */
const CELLS: ReadonlyArray<{ key: Key; under?: Key }> = [
  { key: 'assignedFamilies', under: 'parentContacts' },
  { key: 'studentsInAssignedFamilies', under: 'teachersOfAssignedStudents' },
  { key: 'openConversations', under: 'awaitingReply' },
  { key: 'pendingApprovals' },
  { key: 'directReports' },
]

/**
 * Section 4: verified counts, as one ruled ledger. What each number counts is
 * one click away (the definitions, in full), and what the system does NOT track
 * is said plainly instead of being shown as a zero. A figure the server does
 * not send (capacity, overdue tasks, reply time) has no cell at all.
 */
export function WorkloadSection({
  workload,
  asOf,
  title,
  showDirectReports,
}: {
  workload: StaffWorkload
  asOf: string
  title: Pair
  showDirectReports: boolean
}) {
  const tx = useCopy()
  const { number, dateTime } = useI18n()
  const cells = CELLS.filter((c) => c.key !== 'directReports' || showDirectReports)
  const metrics = METRICS.filter((m) => m.key !== 'directReports' || showDirectReports)

  return (
    <section className="sp-workload" aria-labelledby="sp-workload">
      <div className="sp-workload__head">
        <h2 id="sp-workload" className="section-label">{tx(title)}</h2>
        <span className="sp-workload__asof">{tx(T.asOf, { when: dateTime(asOf) })}</span>
      </div>
      <div className="ledger sp-ledger">
        {cells.map((c) => (
          <div key={c.key} className="ledger__cell">
            {/* The figure comes first in the document and is drawn under its label. */}
            <span className="ledger__value">{number(workload[c.key])}</span>
            <span className="ledger__label">{tx(LABEL[c.key])}</span>
            {c.under && (
              <span className="ledger__note">
                <span className="sp-ledger__n">{number(workload[c.under])}</span>
                <span>{tx(LABEL[c.under])}</span>
              </span>
            )}
          </div>
        ))}
      </div>
      <p className="pp-rule sp-workload__rule">{tx(T.workloadHint)}</p>
      <p className="pp-rule sp-workload__rule" role="note">
        <strong>{tx(T.notTracked)}</strong>
        <span>: {tx(T.notTrackedBody)}</span>
      </p>
      <details className="sp-defs">
        <summary>{tx(T.whatCounts)}</summary>
        <ul>
          {metrics.map((m) => (
            <li key={m.key}>{tx(m.definition)}</li>
          ))}
        </ul>
      </details>
    </section>
  )
}
