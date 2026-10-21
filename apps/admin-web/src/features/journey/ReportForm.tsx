import { useId } from 'react'
import { COVERED_TOPICS, NEXT_TASKS, PERFORMANCE_LEVELS, reportComplete, type ReportInput } from './api'
import { J, LEVEL_LABELS, TASK_LABELS, TOPIC_LABELS, useJourneyCopy } from './copy'

/**
 * A lesson report as taps (PD-15): the lesson number, what was covered and
 * what is needed next as choices, the performance as one of five levels, and
 * short optional text only where it is needed. The private note is staff-only
 * and never reaches the family's card.
 */
export function ReportForm({
  value,
  onChange,
  touched,
}: {
  value: ReportInput
  onChange: (v: ReportInput) => void
  touched: boolean
}) {
  const { tx } = useJourneyCopy()
  const id = useId()
  const set = (patch: Partial<ReportInput>) => onChange({ ...value, ...patch })
  const toggle = (list: string[], code: string) => (list.includes(code) ? list.filter((c) => c !== code) : [...list, code])
  const missing = touched && !reportComplete(value)

  return (
    <div className="jr-report">
      <div className="field">
        <label className="field__label" htmlFor={`${id}-n`}>{tx(J.lessonNumber)}</label>
        <input
          id={`${id}-n`}
          className="input jr-number"
          type="number"
          min={1}
          max={9999}
          inputMode="numeric"
          value={value.lessonNumber ?? ''}
          onChange={(e) => set({ lessonNumber: e.target.value === '' ? null : Math.max(1, Math.min(9999, Math.trunc(Number(e.target.value)))) })}
        />
      </div>

      <fieldset className="field jr-fieldset" aria-describedby={missing ? `${id}-c-err` : undefined}>
        <legend className="field__label">{tx(J.covered)}</legend>
        <div className="jr-chips">
          {COVERED_TOPICS.map((code) => (
            <button
              key={code}
              type="button"
              className="jr-chip"
              aria-pressed={value.coveredTopics.includes(code)}
              onClick={() => set({ coveredTopics: toggle(value.coveredTopics, code) })}
            >
              {tx(TOPIC_LABELS[code])}
            </button>
          ))}
        </div>
        <input
          className="input"
          dir="auto"
          maxLength={1000}
          placeholder={tx(J.coveredDetails)}
          aria-label={tx(J.coveredDetails)}
          value={value.covered ?? ''}
          onChange={(e) => set({ covered: e.target.value || null })}
        />
        {missing && <span id={`${id}-c-err`} className="field__error">{tx(J.coveredRequired)}</span>}
      </fieldset>

      <fieldset className="field jr-fieldset">
        <legend className="field__label">{tx(J.performance)}</legend>
        <div className="jr-chips" role="radiogroup" aria-label={tx(J.performance)}>
          {PERFORMANCE_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              role="radio"
              className="jr-chip"
              aria-checked={value.rating === level}
              onClick={() => set({ rating: value.rating === level ? null : level })}
            >
              {tx(LEVEL_LABELS[level])}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="field jr-fieldset">
        <legend className="field__label">{tx(J.nextLesson)}</legend>
        <div className="jr-chips">
          {NEXT_TASKS.map((code) => (
            <button
              key={code}
              type="button"
              className="jr-chip"
              aria-pressed={value.nextTasks.includes(code)}
              onClick={() => set({ nextTasks: toggle(value.nextTasks, code) })}
            >
              {tx(TASK_LABELS[code])}
            </button>
          ))}
        </div>
        <input
          className="input"
          dir="auto"
          maxLength={500}
          placeholder={tx(J.homework)}
          aria-label={tx(J.homework)}
          value={value.homework ?? ''}
          onChange={(e) => set({ homework: e.target.value || null })}
        />
      </fieldset>

      <div className="field">
        <label className="field__label" htmlFor={`${id}-note`}>{tx(J.note)}</label>
        <textarea
          id={`${id}-note`}
          className="input"
          dir="auto"
          rows={2}
          maxLength={2000}
          value={value.note ?? ''}
          onChange={(e) => set({ note: e.target.value || null })}
        />
      </div>
    </div>
  )
}

/** The report as the API takes it: blank text is absent, not empty. */
export function reportBody(r: ReportInput): ReportInput {
  return {
    lessonNumber: r.lessonNumber,
    coveredTopics: r.coveredTopics,
    covered: r.covered?.trim() || null,
    rating: r.rating,
    nextTasks: r.nextTasks,
    homework: r.homework?.trim() || null,
    note: r.note?.trim() || null,
  }
}
