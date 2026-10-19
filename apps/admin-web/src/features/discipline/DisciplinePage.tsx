import { useId, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge, type Tone } from '@/shared/components/Badge'
import { FilterChips } from '@/shared/components/FilterChips'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { TeachersTabs } from '@/features/supervision/TeachersTabs'
import type { Violation, ViolationQuery } from './api'
import { D, DECISION_LABEL, describeError, useCopy } from './copy'
import { useViolations } from './hooks'
import { DecideDialog, LatenessDialog } from './DisciplineDialogs'
import './discipline.css'

type Section = 'needs' | 'lateness' | 'cancellations'

const STEP_TONE: Record<number, Tone> = { 1: 'info', 2: 'warn', 3: 'warn', 4: 'danger', 5: 'danger' }

/** This month in the viewer's calendar, YYYY-MM -- only a default for the filter; the server counts in the academy's. */
function thisMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

/**
 * PD-12 S2: the Teachers department's discipline page. Three views of the same
 * records -- what waits for a decision (oldest first), the month's lateness,
 * the month's apologies and absences -- each showing the step the violation
 * reaches in its teacher's month. Deciding is one dialog; recording lateness
 * is another.
 */
export function DisciplinePage({ basePath, eyebrow }: { basePath: string; eyebrow?: string }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const monthId = useId()
  const [section, setSection] = useState<Section>('needs')
  const [month, setMonth] = useState(thisMonth())
  const [deciding, setDeciding] = useState<Violation | null>(null)
  const [recording, setRecording] = useState(false)

  const query: ViolationQuery =
    section === 'needs'
      ? { state: 'open' }
      : { state: 'all', month, kind: section === 'lateness' ? 'late' : 'cancellations' }
  const list = useViolations(query)
  const rows = list.data?.violations ?? []

  return (
    <div className="page">
      <div className="page__inner">
        <PageHeader
          eyebrow={eyebrow}
          title={tx(D.title)}
          subtitle={tx(D.subtitle)}
          actions={
            <button type="button" className="btn btn--sm" onClick={() => setRecording(true)}>
              {tx(D.recordLateness)}
            </button>
          }
        />
        <TeachersTabs basePath={basePath} />
        <div className="toolbar dc-toolbar">
          <FilterChips<Section>
            label={tx(D.title)}
            value={section}
            onChange={setSection}
            options={[
              { value: 'needs', label: tx(D.needsDecision) },
              { value: 'lateness', label: tx(D.lateness) },
              { value: 'cancellations', label: tx(D.cancellations) },
            ]}
          />
          {section !== 'needs' && (
            <label className="dc-month" htmlFor={monthId}>
              <span className="field__label">{tx(D.month)}</span>
              <input id={monthId} className="input" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
            </label>
          )}
        </div>
        {list.error ? (
          <EmptyState icon="lock" title={describeError(list.error, locale)} />
        ) : (
          <QueryBoundary isLoading={list.isLoading} error={null} onRetry={() => void list.refetch()}>
            {rows.length === 0 ? (
              <EmptyState title={tx(D.empty)} />
            ) : (
              <div className="table-wrap dc-table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">{tx(D.teacher)}</th>
                      <th scope="col">{tx(D.what)}</th>
                      <th scope="col">{tx(D.step)}</th>
                      <th scope="col">{tx(D.outcome)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((v) => (
                      <ViolationRow key={v.id} v={v} onDecide={() => setDeciding(v)} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </QueryBoundary>
        )}
        {deciding && <DecideDialog violation={deciding} onClose={() => setDeciding(null)} />}
        {recording && <LatenessDialog onClose={() => setRecording(false)} />}
      </div>
    </div>
  )
}

function ViolationRow({ v, onDecide }: { v: Violation; onDecide: () => void }) {
  const tx = useCopy()
  const { dateTime } = useI18n()
  const what =
    v.kind === 'late' ? tx(D.kindLate, { n: v.lateMinutes ?? 0 }) : v.kind === 'teacher_no_show' ? tx(D.kindNoShow) : tx(D.kindApology)
  return (
    <tr>
      <td dir="auto">{v.teacher.name}</td>
      <td>
        <div className="dc-cell">
          <strong>{what}</strong>
          <span className="dc-muted" dir="auto">
            {[v.lesson.learnerName, v.lesson.startsAt ? dateTime(v.lesson.startsAt) : null].filter(Boolean).join(' — ')}
          </span>
          {(v.note ?? v.lesson.note) && (
            <span className="dc-muted" dir="auto">
              {v.note ?? v.lesson.note}
            </span>
          )}
        </div>
      </td>
      <td>
        <Badge tone={STEP_TONE[v.step] ?? 'neutral'} dot>
          {tx(D.stepOf, { n: v.step })}
        </Badge>
      </td>
      <td>
        {v.decision ? (
          <div className="dc-cell">
            <span>{tx(DECISION_LABEL[v.decision])}</span>
            {v.decidedBy && v.decidedAt && (
              <span className="dc-muted">{tx(D.by, { name: v.decidedBy.name ?? '', date: dateTime(v.decidedAt) })}</span>
            )}
            {v.decisionNote && (
              <span className="dc-muted" dir="auto">
                {v.decisionNote}
              </span>
            )}
          </div>
        ) : (
          <div className="dc-cell">
            <span className="dc-muted">{tx(D.suggested, { d: tx(DECISION_LABEL[v.suggestedDecision]) })}</span>
            <button type="button" className="btn btn--primary btn--sm" onClick={onDecide}>
              {tx(D.decide)}
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}
