import { useI18n } from '@/core/i18n/I18nProvider'
import type { StaffWorkload } from './api'
import { METRICS, T, useCopy, type Pair } from './copy'

/**
 * Section 4: verified counts. Every tile states what it counts (the definition
 * is visible, not a tooltip), and what the system does NOT track is said
 * plainly instead of being shown as a zero.
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
  const metrics = METRICS.filter((m) => m.key !== 'directReports' || showDirectReports)

  return (
    <section className="card sp-card" aria-labelledby="sp-workload">
      <div className="sp-card__head">
        <h2 id="sp-workload" className="sp-card__title">{tx(title)}</h2>
        <span className="sp-muted sp-small">{tx(T.asOf, { when: dateTime(asOf) })}</span>
      </div>
      <p className="sp-footnote">{tx(T.workloadHint)}</p>
      <div className="sp-metrics">
        {metrics.map((m) => (
          <div key={m.key} className="sp-metric">
            <div className="sp-metric__value">{number(workload[m.key])}</div>
            <div className="sp-metric__label">{tx(m.label)}</div>
            <div className="sp-metric__def">{tx(m.definition)}</div>
          </div>
        ))}
      </div>
      <div className="sp-untracked" role="note">
        <strong>{tx(T.notTracked)}</strong>
        <div>{tx(T.notTrackedBody)}</div>
      </div>
    </section>
  )
}
