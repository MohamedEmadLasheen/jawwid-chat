import { useId, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { NOTE_MAX, RESPONSIBILITY_CATEGORIES, type StaffProfile } from './api'
import { CATEGORY_LABEL, T, labelFor, useCopy } from './copy'
import { describeError } from './errors'
import { useAssignResponsibility, useEndResponsibility } from './hooks'
import { Icon } from '@/shared/components/Icon'
import { RowActions } from '@/shared/components/RowActions'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import { AttentionRow, Sheet } from '@/features/profiles/RecordParts'

/**
 * What this person supervises: a sheet of the Overview.
 *
 * Two lists, kept visibly apart:
 *   - ASSIGNED RESPONSIBILITIES: official labels a manager or the super admin
 *     assigned, a row each, with "End" as the row's one action. Descriptive
 *     only -- a label grants no access to any module.
 *   - FROM SYSTEM RECORDS: facts the database already holds (families owned,
 *     direct reports, the coverage role). Nobody types these.
 */
export function ResponsibilitiesSection({ profile, refKey }: { profile: StaffProfile; refKey: string }) {
  const tx = useCopy()
  const { date, number } = useI18n()
  const [assigning, setAssigning] = useState(false)
  const [ending, setEnding] = useState<string | null>(null)
  const active = profile.responsibilities.filter((r) => !r.endedAt)
  const ended = profile.responsibilities.filter((r) => r.endedAt)
  const canManage = profile.access.canManageResponsibilities

  return (
    <Sheet
      id="sp-resp"
      section="responsibilities"
      title={tx(T.responsibilities)}
      count={active.length > 0 ? number(active.length) : undefined}
      rule={tx(T.responsibilitiesHint)}
      action={
        canManage && (
          <button type="button" className="btn btn--sm" onClick={() => setAssigning(true)}>
            <Icon name="plus" size={15} />
            {tx(T.assign)}
          </button>
        )
      }
    >
      {/* Assigned by a manager: what it is, its scope and who gave it, and one way to end it. */}
      <h3 className="sr-only">{tx(T.officialLabels)}</h3>
      {active.length === 0 ? (
        <p className="rec-empty">{tx(T.noResponsibilities)}</p>
      ) : (
        <ul className="rec-list">
          {active.map((r) => {
            const label = tx(CATEGORY_LABEL[r.category] ?? { en: r.category, ar: r.category })
            return (
              <AttentionRow
                key={r.id}
                tone="plain"
                title={label}
                sub={
                  <>
                    {r.scopeNote && <span dir="auto">{r.scopeNote}</span>}
                    <span>{tx(T.assignedOn, { when: date(r.assignedAt) })}</span>
                    {r.assignedBy && <span>{tx(T.assignedBy, { who: r.assignedBy.displayName })}</span>}
                  </>
                }
                action={
                  canManage && (
                    <RowActions
                      label={tx(T.more, { name: label })}
                      primary={
                        <button type="button" className="btn btn--sm" onClick={() => setEnding(r.id)}>
                          {tx(T.end)}
                        </button>
                      }
                    />
                  )
                }
              />
            )
          })}
        </ul>
      )}

      {/* What the database already holds: nobody types these. */}
      {profile.derivedResponsibilities.length > 0 && (
        <>
          <h3 className="tf-subtitle">{tx(T.fromRecords)}</h3>
          <ul className="sp-derived">
            {profile.derivedResponsibilities.map((d) => (
              <li key={d.kind}>
                <Icon name="check" size={15} />
                <span>{tx(T[`derived_${d.kind}`], { n: d.count ?? 0 })}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {ended.length > 0 && (
        <details className="sp-details">
          <summary>
            {tx(T.history)} <span className="ltr">({number(ended.length)})</span>
          </summary>
          <ul className="sp-derived sp-derived--ended">
            {ended.map((r) => (
              <li key={r.id}>
                <span>
                  {tx(CATEGORY_LABEL[r.category] ?? { en: r.category, ar: r.category })} · {tx(T.ended, { when: date(r.endedAt!) })}
                  {r.endReason && <> — <span dir="auto">{r.endReason}</span></>}
                </span>
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
    </Sheet>
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
        <SearchableSelect id={ids.cat} className="select" value={category} onValueChange={(v) => setCategory(v)}>
          {options.map((c) => (
            <option key={c} value={c}>
              {tx(labelFor(CATEGORY_LABEL, c))}
            </option>
          ))}
        </SearchableSelect>
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
