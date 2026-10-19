import { useId, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { QueryBoundary } from '@/shared/components/States'
import { I, describeError, useCopy } from './copy'
import { useBillingSupervisor, useSetBillingSupervisor } from './hooks'

const NONE = ''

/**
 * The family's billing supervisor, chosen among the supervisors of its
 * children (the server and the database refuse anyone else), with a reason.
 */
export function BillingSupervisorDialog({
  familyId,
  familyName,
  onClose,
}: {
  familyId: string
  familyName: string
  onClose: () => void
}) {
  const tx = useCopy()
  const { locale } = useI18n()
  const reasonId = useId()
  const view = useBillingSupervisor(familyId)
  const save = useSetBillingSupervisor()
  const [choice, setChoice] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const current = view.data?.current?.id ?? NONE
  const selected = choice ?? current
  const unchanged = selected === current
  const missingReason = !reason.trim()

  const submit = () => {
    setTouched(true)
    if (unchanged) return onClose()
    if (missingReason) return
    save.mutate(
      { familyId, supervisorId: selected === NONE ? null : selected, reason: reason.trim() },
      { onSuccess: onClose },
    )
  }

  return (
    <Dialog
      title={tx(I.dialogTitle, { family: familyName })}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button type="button" className="btn btn--primary" disabled={save.isPending || view.isLoading} onClick={submit}>
            {save.isPending ? tx(I.saving) : tx(I.save)}
          </button>
        </>
      }
    >
      {save.error && (
        <div className="banner banner--danger" role="alert">
          {describeError(save.error, locale)}
        </div>
      )}
      <p className="field__hint">{tx(I.dialogHint)}</p>
      <QueryBoundary isLoading={view.isLoading} error={view.error} onRetry={() => void view.refetch()}>
        {view.data && view.data.candidates.length === 0 ? (
          <p className="field__hint">{tx(I.noCandidates)}</p>
        ) : (
          <fieldset className="in-options">
            <legend className="field__label">{tx(I.supervisor)}</legend>
            {view.data?.candidates.map((c) => (
              <label key={c.id} className="in-option">
                <input type="radio" name="billing-supervisor" checked={selected === c.id} onChange={() => setChoice(c.id)} />
                <span dir="auto">{c.name}</span>
                <span className="in-muted" dir="auto">
                  {tx(I.supervises, { children: c.children.join(locale === 'ar' ? '، ' : ', ') })}
                </span>
              </label>
            ))}
            <label className="in-option">
              <input type="radio" name="billing-supervisor" checked={selected === NONE} onChange={() => setChoice(NONE)} />
              <span>{tx(I.clear)}</span>
            </label>
          </fieldset>
        )}
      </QueryBoundary>
      <div className="field">
        <label className="field__label" htmlFor={reasonId}>
          {tx(I.reason)}
        </label>
        <textarea
          id={reasonId}
          className="input in-textarea"
          value={reason}
          dir="auto"
          rows={2}
          maxLength={500}
          aria-invalid={touched && !unchanged && missingReason}
          onChange={(e) => setReason(e.target.value)}
        />
        {touched && !unchanged && missingReason && <p className="field__error">{tx(I.reasonRequired)}</p>}
      </div>
    </Dialog>
  )
}
