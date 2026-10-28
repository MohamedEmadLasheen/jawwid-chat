import { useRef, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { ReasonDialog } from '@/shared/components/ReasonDialog'
import { QueryBoundary } from '@/shared/components/States'
import { CERTIFICATE_ACCEPT, MAX_CERTIFICATE_BYTES, certificatesApi, type Certificate, type CertificateAct, type ConsentContact } from './api'
import { C, actLabel, describeError, isCode, stateLabel, stateTone, useCopy, type Pair } from './copy'
import { useCertificate, useCertificateAct, useConsent, useDeliveryTarget, useUploadDesign } from './hooks'
import { RequestDialog } from './RequestDialog'

/** Acts that must say why (owner safeguard 2), and the route each one posts to. */
const WITH_REASON: Partial<Record<CertificateAct, { path: string; field: 'reason' | 'message' }>> = {
  return: { path: 'return', field: 'message' },
  redesign: { path: 'redesign', field: 'message' },
  withdraw_approval: { path: 'withdraw-approval', field: 'message' },
  cancel: { path: 'cancel', field: 'reason' },
  decline: { path: 'decline', field: 'reason' },
}
const DIRECT: Partial<Record<CertificateAct, string>> = { start: 'start', resubmit: 'resubmit', release: 'release' }

/**
 * One certificate: what it says, its design, the review, the delivery and the
 * history. The buttons are the server's `actions` -- the Designer never sees
 * approve, send or Story, because the server never offers them.
 */
export function CertificateDrawer({ certificateId, onClose }: { certificateId: string; onClose: () => void }) {
  const tx = useCopy()
  const { locale, dateTime } = useI18n()
  const one = useCertificate(certificateId)
  const act = useCertificateAct()
  const upload = useUploadDesign()
  const [reasonFor, setReasonFor] = useState<CertificateAct | null>(null)
  const [dialog, setDialog] = useState<'send' | 'story' | 'consent' | 'edit' | 'accept' | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const c = one.data?.certificate

  const run = (path: string, body?: Record<string, unknown>) => act.mutate({ certificateId, path, body })

  const onFile = (file: File | undefined) => {
    setFileError(null)
    if (!file) return
    if (!CERTIFICATE_ACCEPT.split(',').includes(file.type)) return setFileError(tx(C.fileWrongType))
    if (file.size > MAX_CERTIFICATE_BYTES) return setFileError(tx(C.fileTooLarge))
    upload.mutate({ certificateId, file })
  }

  const openFile = async (fileId: string) => {
    const { url } = await certificatesApi.fileUrl(certificateId, fileId)
    window.open(url, '_blank', 'noopener')
  }

  const button = (a: CertificateAct) => {
    const label = tx(actLabel(a))
    const primary = a === 'approve' || a === 'send' || a === 'start' || a === 'upload' || a === 'accept'
    const cls = primary ? 'btn btn--primary' : 'btn'
    if (WITH_REASON[a]) return <button key={a} type="button" className={cls} onClick={() => setReasonFor(a)}>{label}</button>
    if (DIRECT[a]) return <button key={a} type="button" className={cls} disabled={act.isPending} onClick={() => run(DIRECT[a]!)}>{label}</button>
    if (a === 'approve') {
      return (
        <button key={a} type="button" className={cls} disabled={act.isPending || !c?.currentFile} onClick={() => run('approve', { fileId: c!.currentFile!.id })}>
          {label}
        </button>
      )
    }
    if (a === 'upload') {
      return (
        <button key={a} type="button" className={cls} disabled={upload.isPending} onClick={() => fileInput.current?.click()}>
          {upload.isPending ? '…' : label}
        </button>
      )
    }
    if (a === 'send' || a === 'story' || a === 'consent' || a === 'edit' || a === 'accept') {
      return <button key={a} type="button" className={cls} onClick={() => setDialog(a)}>{label}</button>
    }
    return null
  }

  return (
    <Dialog title={c ? c.printedName : tx(C.title)} onClose={onClose} variant="sheet">
      <QueryBoundary isLoading={one.isLoading} error={one.error} onRetry={() => void one.refetch()}>
        {c && (
          <div className="cert-drawer">
            <div className="cert-drawer__status">
              <Badge tone={stateTone(c.state)}>{tx(stateLabel(c.state))}</Badge>
              {c.projection === 'full' && c.publishStory && <Badge tone={c.story && !c.story.withdrawnAt ? 'info' : 'waiting'}>{tx(c.story && !c.story.withdrawnAt ? C.storyPublished : C.storyOptedIn)}</Badge>}
              {c.projection === 'design' && c.delivered && <Badge tone="ok">{tx(C.deliveredYes)}</Badge>}
            </div>

            <dl className="cert-facts">
              <Fact label={C.type} value={c.type ? tx({ en: c.type.labelEn, ar: c.type.labelAr }) : c.title} />
              <Fact label={C.titleField} value={c.title} />
              <Fact label={C.achievement} value={c.achievement} />
              <Fact label={C.juz} value={c.juz} />
              <Fact label={C.period} value={c.periodStart ? `${c.periodStart}${c.periodEnd ? ` → ${c.periodEnd}` : ''}` : null} />
              <Fact label={C.achievedOn} value={c.achievedOn} />
              <Fact label={C.grade} value={c.grade} />
              {c.projection === 'full' ? (
                <>
                  <Fact label={C.student} value={c.learner?.name} />
                  <Fact label={C.teacher} value={c.teacher?.name} />
                  <Fact label={C.signatory} value={c.signatoryTeacher?.name} />
                  <Fact label={C.requestedBy} value={c.requestedBy?.name ?? c.suggestedBy?.name} />
                  <Fact label={C.internalNote} value={c.internalNote} />
                </>
              ) : (
                <>
                  <Fact label={C.signatory} value={c.signatoryName} />
                  <Fact label={C.requestedBy} value={c.requesterName} />
                </>
              )}
              <Fact label={C.designerNote} value={c.designerNote} />
              <Fact label={C.designer} value={c.assignedDesigner?.name} />
              <Fact label={C.requested} value={dateTime(c.requestedAt)} />
            </dl>

            {c.returnMessage && (c.state === 'changes_requested' || c.state === 'in_design') && (
              <div className="cert-callout" role="note">
                <strong>{tx(C.returnMessage)}:</strong> <span dir="auto">{c.returnMessage}</span>
              </div>
            )}

            {c.files.length > 0 && (
              <section aria-label={tx(C.files)}>
                <h3 className="cert-h">{tx(C.files)}</h3>
                <ul className="cert-files">
                  {c.files.map((f) => (
                    <li key={f.id}>
                      <span>{tx(C.revision, { n: f.revision })} · <span dir="auto">{f.fileName}</span></span>
                      {f.id === c.currentFile?.id && <Badge tone="info">✓</Badge>}
                      <button type="button" className="btn btn--small" onClick={() => void openFile(f.id)}>{tx(C.open)}</button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {c.projection === 'full' && c.category === 'student' && c.publishStory && (
              <p className="cert-consent">
                {tx(C.consentTitle)}: <strong>{tx(c.consent ? (c.consent.kind === 'granted' ? C.consentGranted : C.consentWithdrawn) : C.consentNone)}</strong>
              </p>
            )}

            <input ref={fileInput} type="file" accept={CERTIFICATE_ACCEPT} hidden onChange={(e) => onFile(e.target.files?.[0])} aria-label={tx(C.a_upload)} />
            {c.actions.length > 0 && <div className="cert-actions">{c.actions.map(button)}</div>}
            {(fileError || upload.error || act.error) && (
              <div className="field__error" role="alert">
                {fileError ?? describeError(upload.error ?? act.error, locale)}
              </div>
            )}
            {c.actions.includes('upload') && <p className="field__hint">{tx(C.uploadHint)}</p>}

            {c.history && c.history.length > 0 && (
              <section aria-label={tx(C.history)}>
                <h3 className="cert-h">{tx(C.history)}</h3>
                <ol className="cert-history">
                  {c.history.map((h) => (
                    <li key={h.seq}>
                      <span className="cert-history__when">{dateTime(h.at)}</span> <strong>{h.kind.replace(/_/g, ' ')}</strong>
                      {h.actor?.name ? <> · <span dir="auto">{h.actor.name}</span></> : null}
                      {h.note ? <div className="cert-history__note" dir="auto">{h.note}</div> : null}
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </div>
        )}
      </QueryBoundary>

      {c && reasonFor && WITH_REASON[reasonFor] && (
        <ReasonDialog
          title={tx(actLabel(reasonFor))}
          label={tx(WITH_REASON[reasonFor]!.field === 'message' ? C.messageLabel : C.reasonLabel)}
          confirmLabel={tx(actLabel(reasonFor))}
          isPending={act.isPending}
          error={act.error}
          onClose={() => setReasonFor(null)}
          onConfirm={(text) =>
            act.mutate(
              { certificateId, path: WITH_REASON[reasonFor]!.path, body: { [WITH_REASON[reasonFor]!.field]: text } },
              { onSuccess: () => setReasonFor(null) },
            )
          }
        />
      )}
      {c && dialog === 'send' && <SendDialog certificate={c} onClose={() => setDialog(null)} />}
      {c && dialog === 'story' && <StoryDialog certificate={c} onClose={() => setDialog(null)} />}
      {c && dialog === 'consent' && <ConsentDialog certificate={c} contacts={one.data?.consentContacts ?? []} onClose={() => setDialog(null)} />}
      {c && (dialog === 'edit' || dialog === 'accept') && c.projection === 'full' && (
        <RequestDialog category={c.category} editing={c} mode={dialog} onClose={() => setDialog(null)} />
      )}
    </Dialog>
  )
}

function Fact({ label, value }: { label: Pair; value: string | number | null | undefined }) {
  const tx = useCopy()
  if (value === null || value === undefined || value === '') return null
  return (
    <>
      <dt>{tx(label)}</dt>
      <dd dir="auto">{value}</dd>
    </>
  )
}

/**
 * Send: the server names the group first, and the send must echo it -- if the
 * group changed in between, nothing is sent and the new one is shown.
 */
function SendDialog({ certificate, onClose }: { certificate: Certificate; onClose: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const target = useDeliveryTarget(certificate.id, true)
  const act = useCertificateAct()
  const t = target.data?.target
  const changed = isCode(act.error, 'COMM.CERTIFICATE_TARGET_CHANGED')
  return (
    <Dialog
      title={tx(C.sendTitle)}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button
            type="button"
            className="btn btn--primary"
            disabled={!target.data || !t || act.isPending}
            onClick={() =>
              act.mutate(
                { certificateId: certificate.id, path: 'send', body: { conversationId: t?.conversationId ?? null } },
                { onSuccess: onClose, onError: () => void target.refetch() },
              )
            }
          >
            {tx(C.a_send)}
          </button>
        </>
      }
    >
      <QueryBoundary isLoading={target.isLoading} error={target.error} onRetry={() => void target.refetch()}>
        {t ? (
          <p>
            {t.conversationId ? tx(C.sendTo, { name: t.title ?? '' }) : tx(C.sendToNew)}
            {t.members != null && <> · {tx(C.members, { n: t.members })}</>}
          </p>
        ) : (
          <p role="alert">{tx(C.noGroup)}</p>
        )}
      </QueryBoundary>
      {act.error != null && <div className="field__error" role="alert">{changed ? tx(C.targetChanged) : describeError(act.error, locale)}</div>}
    </Dialog>
  )
}

/** Owner safeguards 3 and 4: an explicit act that names its audience. */
function StoryDialog({ certificate, onClose }: { certificate: Certificate; onClose: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const act = useCertificateAct()
  return (
    <Dialog
      title={tx(C.storyTitle)}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button type="button" className="btn btn--primary" disabled={act.isPending} onClick={() => act.mutate({ certificateId: certificate.id, path: 'story' }, { onSuccess: onClose })}>
            {tx(C.a_story)}
          </button>
        </>
      }
    >
      <p>{tx(certificate.category === 'student' ? C.storyAudienceStudents : C.storyAudienceTeachers)}</p>
      {act.error != null && <div className="field__error" role="alert">{describeError(act.error, locale)}</div>}
    </Dialog>
  )
}

/** Owner safeguard 4: who agreed, how, and the evidence -- or a withdrawal, which takes the Story down. */
function ConsentDialog({ certificate, contacts, onClose }: { certificate: Certificate; contacts: ConsentContact[]; onClose: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const consent = useConsent()
  const [contactId, setContactId] = useState('')
  const [method, setMethod] = useState<'in_chat' | 'phone' | 'in_person' | 'written'>('in_chat')
  const [evidence, setEvidence] = useState('')
  const [note, setNote] = useState('')
  const granted = certificate.projection === 'full' && certificate.consent?.kind === 'granted'
  const grant = () =>
    consent.mutate(
      {
        certificateId: certificate.id,
        body: { kind: 'granted', contactId: contactId.trim(), method, ...(evidence.trim() ? { evidenceMessageId: evidence.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}) },
      },
      { onSuccess: onClose },
    )
  const withdraw = () => consent.mutate({ certificateId: certificate.id, body: { kind: 'withdrawn', note: note.trim() } }, { onSuccess: onClose })
  return (
    <Dialog
      title={tx(C.consentTitle)}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          {granted ? (
            <button type="button" className="btn btn--danger" disabled={consent.isPending || note.trim().length < 10} onClick={withdraw}>
              {tx(C.withdraw)}
            </button>
          ) : (
            <button type="button" className="btn btn--primary" disabled={consent.isPending || !contactId.trim()} onClick={grant}>
              {tx(C.grant)}
            </button>
          )}
        </>
      }
    >
      <p className="field__hint">{tx(C.consentHint)}</p>
      {!granted && (
        <>
          <label className="field">
            <span className="field__label">{tx(C.consentParent)}</span>
            <select className="select" value={contactId} onChange={(e) => setContactId(e.target.value)}>
              <option value="" />
              {contacts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.relationship ? ` (${p.relationship})` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">{tx(C.consentMethod)}</span>
            <select className="select" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
              <option value="in_chat">{tx(C.m_in_chat)}</option>
              <option value="phone">{tx(C.m_phone)}</option>
              <option value="in_person">{tx(C.m_in_person)}</option>
              <option value="written">{tx(C.m_written)}</option>
            </select>
          </label>
          {method === 'in_chat' && (
            <label className="field">
              <span className="field__label">{tx(C.consentEvidence)}</span>
              <input className="input" value={evidence} onChange={(e) => setEvidence(e.target.value)} />
            </label>
          )}
        </>
      )}
      <label className="field">
        <span className="field__label">{tx(granted ? C.reasonLabel : C.consentNote)}</span>
        <textarea className="textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {consent.error != null && <div className="field__error" role="alert">{describeError(consent.error, locale)}</div>}
    </Dialog>
  )
}
