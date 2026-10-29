import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { describeError } from '@/features/teacher-files/copy'
import { casesApi, type CaseSubjectKind, type CaseTarget, type NewCase } from './api'
import { C, TARGET_LABEL, useCopy } from './copy'
import { SearchableSelect } from '@/shared/components/SearchableSelect'

/**
 * PD-35 B5: "Escalate" -- open a case about this teacher, lesson, child,
 * complaint or parent's feedback. Whether the caller may (their scope on the
 * subject) is the server's: a refusal is shown as it comes.
 */
export function OpenCaseButton({
  subject,
  target,
  className = 'btn',
}: {
  subject: { kind: CaseSubjectKind; id: string }
  target: CaseTarget
  className?: string
}) {
  const tx = useCopy()
  const [open, setOpen] = useState(false)
  const [sent, setSent] = useState(false)
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {tx(C.escalate)}
      </button>
      {sent && <span className="field__hint" role="status"> {tx(C.sent)}</span>}
      {open && (
        <OpenCaseDialog
          subject={subject}
          target={target}
          onClose={() => setOpen(false)}
          onSent={() => {
            setOpen(false)
            setSent(true)
          }}
        />
      )}
    </>
  )
}

function OpenCaseDialog({
  subject,
  target: initialTarget,
  onClose,
  onSent,
}: {
  subject: { kind: CaseSubjectKind; id: string }
  target: CaseTarget
  onClose: () => void
  onSent: () => void
}) {
  const tx = useCopy()
  const { locale } = useI18n()
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [target, setTarget] = useState<CaseTarget>(initialTarget)
  const [dueOn, setDueOn] = useState('')
  const send = useMutation({
    mutationFn: (c: NewCase) => casesApi.open(c),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cases', 'list'] })
      onSent()
    },
  })
  const submit = () => {
    const c: NewCase = { subject, target, title: title.trim() }
    if (body.trim()) c.body = body.trim()
    if (dueOn) c.dueOn = dueOn
    send.mutate(c)
  }
  return (
    <Dialog
      title={tx(C.escalate)}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button type="button" className="btn btn--primary" disabled={!title.trim() || send.isPending} onClick={submit}>
            {tx(C.send)}
          </button>
        </>
      }
    >
      {send.error && <p className="field__error" role="alert">{describeError(send.error, locale)}</p>}
      <label className="field">
        <span className="field__label">{tx(C.caseTitle)}</span>
        <input className="input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span className="field__label">{tx(C.details)}</span>
        <textarea className="input" rows={4} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <label className="field">
        <span className="field__label">{tx(C.sendTo)}</span>
        <SearchableSelect className="select" value={target} onValueChange={(v) => setTarget(v as CaseTarget)}>
          {(['teachers', 'operations'] as const).map((t) => (
            <option key={t} value={t}>{tx(TARGET_LABEL[t])}</option>
          ))}
        </SearchableSelect>
      </label>
      <label className="field">
        <span className="field__label">{tx(C.due)}</span>
        <input className="input" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
      </label>
    </Dialog>
  )
}
