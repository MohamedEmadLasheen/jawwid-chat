import type { ReactNode } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge, type Tone } from '@/shared/components/Badge'
import type { Violation } from './api'
import { D, DECISION_LABEL, useCopy } from './copy'

const STEP_TONE: Record<number, Tone> = { 1: 'info', 2: 'warn', 3: 'warn', 4: 'danger', 5: 'danger' }

export function violationWhat(v: Violation, tx: ReturnType<typeof useCopy>): string {
  switch (v.kind) {
    case 'late':
      return tx(D.kindLate, { n: v.lateMinutes ?? 0 })
    case 'teacher_no_show':
      return tx(D.kindNoShow)
    case 'absence':
      return tx(D.kindAbsence)
    case 'complaint':
      return tx(D.kindComplaint)
    default:
      return tx(D.kindApology)
  }
}

/** One violation: what happened (and whose lesson, when), its step this month, and the decision or the Decide button. */
export function ViolationRow({ v, onDecide, extra }: { v: Violation; onDecide: () => void; extra?: ReactNode }) {
  const tx = useCopy()
  const { dateTime, date } = useI18n()
  // A lesson has a time; an absence with no lesson is a day (PD-26).
  const when = v.lesson ? (v.lesson.startsAt ? dateTime(v.lesson.startsAt) : null) : date(v.occurredAt)
  const context = v.complaint
    ? [tx(v.complaint.from === 'parent' ? D.fromParent : D.fromManagement), v.complaint.body]
    : [v.lesson?.learnerName ?? null, when]
  // A person recorded lateness, an absence with no lesson, an upheld complaint; the database recorded the rest.
  const source = v.recordedBy ? tx(D.recordedBy, { name: v.recordedBy.name ?? '' }) : tx(D.automatic)
  const note = v.note ?? v.lesson?.note ?? null
  return (
    <tr>
      <td dir="auto">{v.teacher.name}</td>
      {extra}
      <td>
        <div className="dc-cell">
          <strong>{violationWhat(v, tx)}</strong>
          <span className="dc-muted" dir="auto">
            {context.filter(Boolean).join(' — ')}
          </span>
          {note && (
            <span className="dc-muted" dir="auto">
              {note}
            </span>
          )}
          <span className="dc-muted">{source}</span>
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
