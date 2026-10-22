import { useId, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import type { TransferResult } from './api'
import { T, describeError, useCopy } from './copy'
import { useStructure } from './hooks'

/**
 * PD-24: move children -- a group, or a new student's family -- to another
 * Operations supervisor. Shared by the group's info panel and the New Students
 * card; `submit` is whichever route the caller owns. The server decides who may
 * (the super admin, or the Operations manager of both supervisors), moves every
 * child who shares a group with these, and reports what moved.
 */
export function ChangeSupervisorDialog({
  name,
  current,
  childNames,
  submit,
  onClose,
  onDone,
}: {
  name: string
  current: { id: string; name: string } | null
  childNames?: string[]
  submit: (body: { supervisorId: string; reason: string }) => Promise<TransferResult>
  onClose: () => void
  onDone: (result: TransferResult, supervisorName: string) => void
}) {
  const tx = useCopy()
  const { locale } = useI18n()
  const id = useId()
  const structure = useStructure()
  const supervisors = (structure.data?.departments ?? [])
    .find((d) => d.kind === 'operations')
    ?.members.filter((m) => m.position === 'supervisor' && m.isActive && m.id !== current?.id) ?? []
  const [supervisorId, setSupervisorId] = useState('')
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const save = async () => {
    setTouched(true)
    if (!supervisorId || !reason.trim() || pending) return
    setPending(true)
    setError(null)
    try {
      const result = await submit({ supervisorId, reason: reason.trim() })
      onDone(result, supervisors.find((s) => s.id === supervisorId)?.name ?? '')
    } catch (err) {
      setError(err)
      setPending(false)
    }
  }

  return (
    <Dialog
      title={tx(T.changeSupervisorTitle, { name })}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button type="button" className="btn btn--primary" disabled={pending} onClick={() => void save()}>
            {pending ? tx(T.saving) : tx(T.changeSupervisor)}
          </button>
        </>
      }
    >
      <p className="ts-muted">{tx(T.transferHint)}</p>
      {current && (
        <p>
          {tx(T.currentSupervisor)}: <strong dir="auto">{current.name}</strong>
        </p>
      )}
      {childNames && childNames.length > 0 && <p dir="auto">{tx(T.movesChildren, { names: childNames.join(' · ') })}</p>}
      <div className="field">
        <label className="field__label" htmlFor={`${id}-sup`}>{tx(T.assignTo)}</label>
        <select
          id={`${id}-sup`}
          className="select"
          value={supervisorId}
          onChange={(e) => setSupervisorId(e.target.value)}
          aria-invalid={touched && !supervisorId}
        >
          <option value="">{tx(T.choose)}</option>
          {supervisors.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.learnerCount})
            </option>
          ))}
        </select>
        {touched && !supervisorId && <span className="field__error">{tx(T.required)}</span>}
      </div>
      <div className="field">
        <label className="field__label" htmlFor={`${id}-reason`}>{tx(T.reason)}</label>
        <input
          id={`${id}-reason`}
          className="input"
          dir="auto"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-invalid={touched && !reason.trim()}
        />
        {touched && !reason.trim() && <span className="field__error">{tx(T.required)}</span>}
      </div>
      {error ? <div className="banner banner--danger" role="alert">{describeError(error, locale)}</div> : null}
    </Dialog>
  )
}

/** The sentence a caller shows after a transfer. */
export function transferNotice(tx: ReturnType<typeof useCopy>, result: TransferResult, supervisorName: string): string {
  if (!result.changed) return tx(T.transferUnchanged)
  return tx(T.transferred, { names: result.learners.map((l) => l.name).join(' · '), supervisor: supervisorName })
}
