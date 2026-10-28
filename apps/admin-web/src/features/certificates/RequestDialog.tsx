import { useMemo, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { newIdempotencyKey } from '@/core/api/client'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import type { CertificateCategory, FullCertificate, RequestBody } from './api'
import { C, describeError, isCode, useCopy } from './copy'
import { useCertificateAct, useCertificateTypes, useCreateCertificate, useRecipients } from './hooks'

/**
 * A new request (Ops supervisor: a student; Teacher Supervision: a teacher),
 * an edit of one that is still pending or returned, or the acceptance of a
 * teacher's suggestion (where the supervisor picks its type).
 *
 * The request key is made ONCE, when the form opens, so a double click files
 * one request (design §8). "Publish as a Story" is only a wish: nothing is ever
 * published until the requester presses Publish on an approved certificate.
 */
export function RequestDialog({
  category,
  editing,
  mode,
  onClose,
  onCreated,
}: {
  category: CertificateCategory
  editing?: FullCertificate
  mode?: 'edit' | 'accept'
  onClose: () => void
  onCreated?: (id: string) => void
}) {
  const tx = useCopy()
  const { locale } = useI18n()
  const requestKey = useMemo(() => newIdempotencyKey(), [])
  const types = useCertificateTypes(category)
  const create = useCreateCertificate()
  const act = useCertificateAct()
  const [search, setSearch] = useState('')
  const recipients = useRecipients(category, search.trim(), !editing)
  const [recipientId, setRecipientId] = useState('')
  const [typeId, setTypeId] = useState(editing?.type?.id ?? '')
  const [printedName, setPrintedName] = useState(editing?.printedName ?? '')
  const [juz, setJuz] = useState(editing?.juz ? String(editing.juz) : '')
  const [periodStart, setPeriodStart] = useState(editing?.periodStart ?? '')
  const [periodEnd, setPeriodEnd] = useState(editing?.periodEnd ?? '')
  const [achievedOn, setAchievedOn] = useState(editing?.achievedOn ?? '')
  const [designerNote, setDesignerNote] = useState(editing?.designerNote ?? '')
  const [internalNote, setInternalNote] = useState(editing?.internalNote ?? '')
  const [publishStory, setPublishStory] = useState(editing?.publishStory ?? false)
  const [confirmDuplicate, setConfirmDuplicate] = useState(false)

  const type = types.data?.types.find((t) => t.id === typeId)
  const error = create.error ?? act.error
  const suspected = isCode(error, 'COMM.CERTIFICATE_DUPLICATE_SUSPECTED')
  const pending = create.isPending || act.isPending

  const fields = () => ({
    typeId,
    printedName: printedName.trim(),
    ...(juz ? { juz: Number(juz) } : {}),
    ...(periodStart ? { periodStart } : {}),
    ...(periodEnd ? { periodEnd } : {}),
    ...(achievedOn ? { achievedOn } : {}),
    ...(designerNote.trim() ? { designerNote: designerNote.trim() } : {}),
    ...(internalNote.trim() ? { internalNote: internalNote.trim() } : {}),
    publishStory,
  })

  const submit = () => {
    if (editing) {
      act.mutate({ certificateId: editing.id, path: mode === 'accept' ? 'accept' : 'edit', body: fields() }, { onSuccess: onClose })
      return
    }
    const body: RequestBody = {
      category,
      ...(category === 'student' ? { learnerId: recipientId } : { teacherId: recipientId }),
      ...fields(),
      requestKey,
      ...(confirmDuplicate || suspected ? { confirmDuplicate: true } : {}),
    }
    if (suspected) setConfirmDuplicate(true)
    create.mutate(body, {
      onSuccess: (out) => {
        onCreated?.(out.certificate.id)
        onClose()
      },
    })
  }

  const ready = !!typeId && (!!editing || !!recipientId) && (mode === 'accept' || printedName.trim().length > 0) && (!type?.needsJuz || !!juz) && (!type?.needsPeriod || !!periodStart)

  return (
    <Dialog
      title={tx(editing ? (mode === 'accept' ? C.a_accept : C.a_edit) : C.newRequest)}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button type="button" className="btn btn--primary" disabled={!ready || pending} onClick={submit}>
            {tx(suspected ? C.submitAnyway : editing ? C.save : C.submit)}
          </button>
        </>
      }
    >
      {!editing && (
        <>
          <label className="field">
            <span className="field__label">{tx(C.recipient)} — {tx(category === 'student' ? C.student : C.teacher)}</span>
            <input className="input" value={search} placeholder={tx(C.pickRecipient)} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <div className="cert-recipients" role="listbox" aria-label={tx(C.recipient)}>
            {(recipients.data?.recipients ?? []).map((r) => (
              <button
                key={r.id}
                type="button"
                role="option"
                aria-selected={r.id === recipientId}
                className={r.id === recipientId ? 'chip chip--active' : 'chip'}
                onClick={() => {
                  setRecipientId(r.id)
                  if (!printedName) setPrintedName(r.name)
                }}
              >
                <span dir="auto">{r.name}</span>
                {r.teacher ? <span className="cert-muted"> · {r.teacher.name}</span> : null}
              </button>
            ))}
          </div>
        </>
      )}
      <label className="field">
        <span className="field__label">{tx(C.type)}</span>
        <select className="select" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
          <option value="" />
          {(types.data?.types ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {tx({ en: t.labelEn, ar: t.labelAr })}
            </option>
          ))}
        </select>
      </label>
      {mode !== 'accept' && (
        <label className="field">
          <span className="field__label">{tx(C.printedName)}</span>
          <input className="input" dir="auto" value={printedName} onChange={(e) => setPrintedName(e.target.value)} />
        </label>
      )}
      {(type?.needsJuz || category === 'student') && (
        <label className="field">
          <span className="field__label">{tx(C.juz)}</span>
          <input className="input" type="number" min={1} max={30} value={juz} onChange={(e) => setJuz(e.target.value)} />
        </label>
      )}
      {(type?.needsPeriod || category === 'teacher') && (
        <div className="cert-row">
          <label className="field">
            <span className="field__label">{tx(C.periodStart)}</span>
            <input className="input" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">{tx(C.periodEnd)}</span>
            <input className="input" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </label>
        </div>
      )}
      {category === 'student' && (
        <label className="field">
          <span className="field__label">{tx(C.achievedOn)}</span>
          <input className="input" type="date" value={achievedOn} onChange={(e) => setAchievedOn(e.target.value)} />
        </label>
      )}
      <label className="field">
        <span className="field__label">{tx(C.designerNote)}</span>
        <textarea className="textarea" rows={2} dir="auto" value={designerNote} onChange={(e) => setDesignerNote(e.target.value)} />
      </label>
      <label className="field">
        <span className="field__label">{tx(C.internalNote)}</span>
        <textarea className="textarea" rows={2} dir="auto" value={internalNote} onChange={(e) => setInternalNote(e.target.value)} />
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={publishStory} onChange={(e) => setPublishStory(e.target.checked)} /> {tx(C.publishStory)}
      </label>
      {error != null && (
        <div className="field__error" role="alert">
          {suspected ? tx(C.suspected) : isCode(error, 'COMM.CERTIFICATE_DUPLICATE') ? tx(C.duplicate) : describeError(error, locale)}
        </div>
      )}
    </Dialog>
  )
}
