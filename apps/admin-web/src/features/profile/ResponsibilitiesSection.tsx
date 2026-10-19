import { useId, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { NOTE_MAX, RESPONSIBILITY_CATEGORIES, type StaffProfile } from './api'
import { CATEGORY_LABEL, T, labelFor, useCopy } from './copy'
import { describeError } from './errors'
import { useAssignResponsibility, useEndResponsibility } from './hooks'

/**
 * Section 3: what this person supervises.
 *
 * Two lists, kept visibly apart:
 *   - FROM SYSTEM RECORDS: facts the database already holds (families owned,
 *     direct reports, the coverage role). Nobody types these.
 *   - ASSIGNED RESPONSIBILITIES: official labels a manager or the super admin
 *     assigned. Descriptive only -- a label grants no access to any module.
 */
export function ResponsibilitiesSection({ profile, refKey }: { profile: StaffProfile; refKey: string }) {
  const tx = useCopy()
  const { date } = useI18n()
  const [assigning, setAssigning] = useState(false)
  const [ending, setEnding] = useState<string | null>(null)
  const active = profile.responsibilities.filter((r) => !r.endedAt)
  const ended = profile.responsibilities.filter((r) => r.endedAt)
  const canManage = profile.access.canManageResponsibilities

  return (
    <section className="card sp-card" aria-labelledby="sp-resp">
      <div className="sp-card__head">
        <h2 id="sp-resp" className="sp-card__title">{tx(T.responsibilities)}</h2>
        {canManage && (
          <button type="button" className="btn btn--sm" onClick={() => setAssigning(true)}>
            {tx(T.assign)}
          </button>
        )}
      </div>
      <p className="sp-footnote">{tx(T.responsibilitiesHint)}</p>

      {profile.derivedResponsibilities.length > 0 && (
        <>
          <h3 className="sp-subtitle">{tx(T.fromRecords)}</h3>
          <ul className="sp-list">
            {profile.derivedResponsibilities.map((d) => (
              <li key={d.kind} className="sp-list__item">
                {tx(T[`derived_${d.kind}`], { n: d.count ?? 0 })}
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="sp-subtitle">{tx(T.officialLabels)}</h3>
      {active.length === 0 ? (
        <p className="sp-muted">{tx(T.noResponsibilities)}</p>
      ) : (
        <ul className="sp-list">
          {active.map((r) => (
            <li key={r.id} className="sp-list__item sp-resp">
              <div className="sp-resp__body">
                <strong>{tx(CATEGORY_LABEL[r.category] ?? { en: r.category, ar: r.category })}</strong>
                {r.scopeNote && <div dir="auto">{r.scopeNote}</div>}
                <div className="sp-muted sp-small">
                  {tx(T.assignedOn, { when: date(r.assignedAt) })}
                  {r.assignedBy && <> · {tx(T.assignedBy, { who: r.assignedBy.displayName })}</>}
                </div>
              </div>
              {canManage && (
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => setEnding(r.id)}>
                  {tx(T.end)}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {ended.length > 0 && (
        <details className="sp-details">
          <summary>{tx(T.history)} ({ended.length})</summary>
          <ul className="sp-list">
            {ended.map((r) => (
              <li key={r.id} className="sp-list__item sp-muted">
                {tx(CATEGORY_LABEL[r.category] ?? { en: r.category, ar: r.category })} · {tx(T.ended, { when: date(r.endedAt!) })}
                {r.endReason && <> — <span dir="auto">{r.endReason}</span></>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {assigning && (
        <AssignDialog
          refKey={refKey}
          taken={new Set(active.map((r) => r.category))}
          onClose={() => setAssigning(false)}
        />
      )}
      {ending && <EndDialog refKey={refKey} responsibilityId={ending} onClose={() => setEnding(null)} />}
    </section>
  )
}

function AssignDialog({ refKey, taken, onClose }: { refKey: string; taken: Set<string>; onClose: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const ids = { cat: useId(), note: useId() }
  const assign = useAssignResponsibility(refKey)
  const options = RESPONSIBILITY_CATEGORIES.filter((c) => !taken.has(c))
  const [category, setCategory] = useState<string>(options[0] ?? '')
  const [note, setNote] = useState('')
  const [touched, setTouched] = useState(false)
  const noteLen = Array.from(note.trim()).length
  const error =
    category === 'other' && noteLen === 0 ? tx(T.scopeRequired)
    : noteLen > NOTE_MAX ? tx(T.tooLong, { max: NOTE_MAX })
    : null

  const submit = () => {
    setTouched(true)
    if (error || !category) return
    assign.mutate({ category, scopeNote: note.trim() || null }, { onSuccess: onClose })
  }

  return (
    <Dialog
      title={tx(T.assign)}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button type="button" className="btn btn--primary" onClick={submit} disabled={assign.isPending || !category}>
            {assign.isPending ? tx(T.saving) : tx(T.save)}
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field__label" htmlFor={ids.cat}>{tx(T.category)}</label>
        <select id={ids.cat} className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
          {options.map((c) => (
            <option key={c} value={c}>
              {tx(labelFor(CATEGORY_LABEL, c))}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field__label" htmlFor={ids.note}>{tx(T.scopeNote)}</label>
        <input
          id={ids.note}
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-invalid={touched && Boolean(error)}
          aria-describedby={`${ids.note}-hint`}
          dir="auto"
        />
        <span id={`${ids.note}-hint`} className={touched && error ? 'field__error' : 'field__hint'}>
          {(touched && error) || tx(T.scopeNoteHint)}
        </span>
      </div>
      <p className="field__hint">{tx(T.responsibilitiesHint)}</p>
      {assign.error && (
        <div className="banner banner--danger" role="alert">
          {describeError(assign.error, locale)}
        </div>
      )}
    </Dialog>
  )
}

function EndDialog({ refKey, responsibilityId, onClose }: { refKey: string; responsibilityId: string; onClose: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const id = useId()
  const end = useEndResponsibility(refKey)
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const error = reason.trim().length === 0 ? tx(T.required) : null

  return (
    <Dialog
      title={tx(T.endTitle)}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button
            type="button"
            className="btn btn--danger"
            disabled={end.isPending}
            onClick={() => {
              setTouched(true)
              if (!error) end.mutate({ id: responsibilityId, reason }, { onSuccess: onClose })
            }}
          >
            {end.isPending ? tx(T.saving) : tx(T.end)}
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field__label" htmlFor={id}>{tx(T.endReason)}</label>
        <textarea
          id={id}
          className="textarea"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-invalid={touched && Boolean(error)}
          aria-describedby={`${id}-err`}
          dir="auto"
        />
        {touched && error && <span id={`${id}-err`} className="field__error">{error}</span>}
      </div>
      {end.error && (
        <div className="banner banner--danger" role="alert">
          {describeError(end.error, locale)}
        </div>
      )}
    </Dialog>
  )
}
