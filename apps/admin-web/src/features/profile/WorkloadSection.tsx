import { useI18n } from '@/core/i18n/I18nProvider'
import type { MastFigure } from '@/shared/components/PageHeader'
import { Fact } from '@/features/profiles/RecordParts'
import type { StaffWorkload } from './api'
import { METRICS, T, useCopy, type Pair } from './copy'

type Key = keyof StaffWorkload
const LABEL = Object.fromEntries(METRICS.map((m) => [m.key, m.label])) as Record<Key, Pair>
export const WORKLOAD_LABEL = LABEL

/**
 * The verified counts the server sends, set in two places and never twice:
 * the four that matter most are the masthead's figures, the rest are facts in
 * the Overview's margin. Someone others report to leads with their direct
 * reports; anyone else with their families and students. The conversations
 * still waiting for us are the note under the open ones, and make that figure
 * the key one. A figure the server does not send (capacity, overdue tasks,
 * reply time) has no place at all.
 */
const AWAITING: Key = 'awaitingReply'
function split(showDirectReports: boolean): { mast: Key[]; rest: Key[] } {
  return showDirectReports
    ? {
        mast: ['directReports', 'assignedFamilies', 'openConversations', 'pendingApprovals'],
        rest: ['parentContacts', 'teachersOfAssignedStudents', 'pendingApprovals'],
      }
    : {
        mast: ['assignedFamilies', 'studentsInAssignedFamilies', 'openConversations', 'pendingApprovals'],
        rest: ['parentContacts', 'teachersOfAssignedStudents', 'pendingApprovals'],
      }
}

/** The masthead's four figures. A nought is drawn quietly; it is a count, not a call. */
export function useWorkloadFigures(workload: StaffWorkload, showDirectReports: boolean): MastFigure[] {
  const tx = useCopy()
  const { number } = useI18n()
  return split(showDirectReports).mast.map((key) => {
    const value = workload[key]
    const awaiting = key === 'openConversations' ? workload[AWAITING] : 0
    return {
      key,
      label: tx(LABEL[key]),
      value: number(value),
      // With nothing open and nothing waiting, the note would only repeat the nought.
      note: key === 'openConversations' && (value > 0 || awaiting > 0) ? tx(T.awaitingNote, { n: number(awaiting) }) : undefined,
      tone: awaiting > 0 ? 'key' : value === 0 ? 'quiet' : undefined,
    }
  })
}

/**
 * On the canvas beside the work: the counts the masthead does not carry, when
 * they were counted and from what, what the system does NOT track (said
 * plainly instead of shown as a zero), and what each number counts, in full.
 */
export function NumbersGroup({
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
  const metrics = METRICS.filter((m) => m.key !== 'directReports' || showDirectReports)

  return (
    <section className="aside-group rec-group" aria-labelledby="sp-workload" data-section="numbers">
      <div className="rec-group__head">
        <h2 id="sp-workload" className="aside-group__title">{tx(title)}</h2>
      </div>
      <dl className="rec-facts sp-numbers">
        {split(showDirectReports).rest.map((key) => (
          <Fact key={key} label={tx(LABEL[key])}>
            <span className="sp-numbers__n">{number(workload[key])}</span>
          </Fact>
        ))}
      </dl>
      <p className="rec-rule">
        {tx(T.asOf, { when: dateTime(asOf) })}. {tx(T.workloadHint)}
      </p>
      <p className="rec-rule" role="note">
        <strong>{tx(T.notTracked)}</strong>
        <span>: {tx(T.notTrackedBody)}</span>
      </p>
      <details className="sp-defs">
        <summary>{tx(T.whatCounts)}</summary>
        <ul>
          {metrics.map((m) => (
            <li key={m.key}>
              <strong>{tx(m.label)}</strong>
              <span>: {tx(m.definition)}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  )
}
