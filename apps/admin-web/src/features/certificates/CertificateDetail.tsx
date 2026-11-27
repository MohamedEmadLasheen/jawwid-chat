import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { Icon, type IconName } from '@/shared/components/Icon'
import type { MenuItem } from '@/shared/components/Menu'
import { ReasonDialog } from '@/shared/components/ReasonDialog'
import { Age, DetailCallout, DetailSection, FlowSteps, ageText, dayName, sentence, type FlowStep, type StepState } from '@/shared/components/RequestQueue'
import { QueryBoundary } from '@/shared/components/States'
import {
  CERTIFICATE_ACCEPT,
  MAX_CERTIFICATE_BYTES,
  certificatesApi,
  type Certificate,
  type CertificateAct,
  type CertificateState,
  type ConsentContact,
  type HistoryEntry,
} from './api'
import { C, actLabel, describeError, isCode, stateLabel, stateTone, useCopy, type Pair } from './copy'
import { useCertificate, useCertificateAct, useConsent, useDeliveryTarget, useUploadDesign } from './hooks'
import { RequestDialog } from './RequestDialog'
import { SearchableSelect } from '@/shared/components/SearchableSelect'

/** Acts that must say why (owner safeguard 2), and the route each one posts to. */
const WITH_REASON: Partial<Record<CertificateAct, { path: string; field: 'reason' | 'message' }>> = {
  return: { path: 'return', field: 'message' },
  redesign: { path: 'redesign', field: 'message' },
  withdraw_approval: { path: 'withdraw-approval', field: 'message' },
  cancel: { path: 'cancel', field: 'reason' },
  decline: { path: 'decline', field: 'reason' },
}
const DIRECT: Partial<Record<CertificateAct, string>> = { start: 'start', resubmit: 'resubmit', release: 'release' }
const PRIMARY: ReadonlySet<CertificateAct> = new Set<CertificateAct>(['approve', 'send', 'start', 'upload', 'accept'])
/** The acts that end a request: last behind "⋯", and marked as such. */
const ENDS: ReadonlySet<CertificateAct> = new Set<CertificateAct>(['cancel', 'decline'])
const rank = (a: CertificateAct) => (PRIMARY.has(a) ? 0 : ENDS.has(a) ? 2 : 1)
/**
 * The server's allowed acts in the order they are offered: the one that moves
 * the request on first (it is the card's and the inspector's one stated
 * action), what ends it last. Nothing is added to them and nothing left out.
 */
export const orderedActs = (actions: readonly CertificateAct[]): CertificateAct[] => [...actions].sort((a, b) => rank(a) - rank(b))
export const actEnds = (a: CertificateAct) => ENDS.has(a)
const ACT_ICON: Record<CertificateAct, IconName> = {
  edit: 'pencil',
  resubmit: 'send',
  cancel: 'xCircle',
  accept: 'checkCircle',
  decline: 'xCircle',
  start: 'play',
  return: 'undo',
  release: 'undo',
  upload: 'upload',
  approve: 'checkCircle',
  redesign: 'refresh',
  withdraw_approval: 'undo',
  send: 'send',
  consent: 'userCheck',
  story: 'stories',
}
export const actIcon = (a: CertificateAct): IconName => ACT_ICON[a]

/** How far along the flow each state stands: request, design, review, send. */
const STAGE: Record<CertificateState, number> = {
  proposed: -1,
  requested: 1,
  in_design: 1,
  changes_requested: 1,
  uploaded: 2,
  approved: 3,
  sent: 4,
  cancelled: 0,
  declined: 0,
}

/** Who asked for a certificate (or suggested it), as the reader may see it. */
const askerOf = (c: Certificate): string | null => (c.projection === 'full' ? (c.requestedBy?.name ?? c.suggestedBy?.name ?? null) : c.requesterName)

/** Why a certificate waits where it is, in one line: the board card's waiting fact. */
export function certificateWhy(c: Certificate, tx: ReturnType<typeof useCopy>, locale: 'ar' | 'en'): ReactNode {
  const designer = c.assignedDesigner?.name
  switch (c.state) {
    case 'proposed':
      return sentence(tx(C.whyProposed), { who: (c.projection === 'full' ? c.suggestedBy?.name : null) ?? askerOf(c) ?? tx(C.someone) })
    case 'requested': {
      const asker = askerOf(c)
      return asker ? sentence(tx(C.whyAsked), { who: asker }) : tx(C.whyRequested)
    }
    case 'in_design':
      return designer ? sentence(tx(C.whyDesigning), { who: designer }) : tx(C.whyDesigningNobody)
    case 'changes_requested':
      return tx(C.whyChanges)
    case 'uploaded':
      return tx(C.whyUploaded)
    case 'approved':
      return tx(C.whyApproved)
    case 'sent': {
      const at = c.projection === 'full' ? c.sent?.at : null
      return at ? tx(C.whySent).replace('{age}', ageText(at, locale)) : tx(stateLabel(c.state))
    }
    case 'cancelled':
      return tx(C.whyCancelled)
    case 'declined':
      return tx(C.whyDeclined)
  }
}

/** Where a certificate stands, in one sentence: the inspector's callout. */
function certificateState(c: Certificate, tx: ReturnType<typeof useCopy>, locale: 'ar' | 'en'): ReactNode {
  const designer = c.assignedDesigner?.name
  switch (c.state) {
    case 'proposed':
      return sentence(tx(C.stateProposed), { who: (c.projection === 'full' ? c.suggestedBy?.name : null) ?? askerOf(c) ?? tx(C.someone) })
    case 'requested':
      return tx(C.stateRequested).replace('{age}', ageText(c.requestedAt, locale))
    case 'in_design':
      return designer ? sentence(tx(C.stateDesigning), { who: designer }) : tx(C.whyDesigningNobody)
    case 'changes_requested':
      return tx(C.stateChanges)
    case 'uploaded':
      return tx(C.stateUploaded)
    case 'approved':
      return tx(C.stateApproved)
    case 'sent': {
      const at = c.projection === 'full' ? c.sent?.at : null
      return at ? tx(C.stateSent).replace('{age}', ageText(at, locale)) : tx(stateLabel(c.state))
    }
    default:
      return tx(C.stateClosed)
  }
}

/** A certificate's state and what goes with it: the Story, the delivery. */
export function CertificateStatus({ certificate: c }: { certificate: Certificate }) {
  const tx = useCopy()
  return (
    <>
      <Badge tone={stateTone(c.state)} dot>{tx(stateLabel(c.state))}</Badge>
      {c.projection === 'full' && c.publishStory && (
        <Badge tone={c.story && !c.story.withdrawnAt ? 'info' : 'waiting'}>{tx(c.story && !c.story.withdrawnAt ? C.storyPublished : C.storyOptedIn)}</Badge>
      )}
      {c.projection === 'design' && c.delivered && <Badge tone="ok">{tx(C.deliveredYes)}</Badge>}
    </>
  )
}

/** The request's steps, from what the server recorded: who, when, and where it stands now. */
export function certificateSteps(c: Certificate, tx: ReturnType<typeof useCopy>, when: (iso: string) => string, sep = ', '): FlowStep[] {
  const full = c.projection === 'full' ? c : null
  const closed = c.state === 'cancelled' || c.state === 'declined'
  // A closed request got as far as its own record shows.
  const reached = closed ? (full?.sent ? 4 : full?.approval ? 3 : c.currentFile ? 2 : c.designStartedAt ? 1 : 0) : STAGE[c.state]
  const at = (stage: number): StepState => (reached > stage ? 'done' : reached === stage && !closed ? 'current' : closed ? 'skipped' : 'todo')
  const who = (name: string | null | undefined, iso?: string | null) =>
    name || iso ? (
      <>
        {name && <bdi>{name}</bdi>}
        {name && iso && sep}
        {iso && <time dateTime={iso}>{when(iso)}</time>}
      </>
    ) : undefined

  const steps: FlowStep[] = []
  const suggester = full?.suggestedBy
  if (c.state === 'proposed' || suggester) {
    steps.push({ key: 'suggested', label: tx(C.st_suggested), state: c.state === 'proposed' ? 'current' : 'done', meta: who(suggester?.name) })
  }
  if (c.state !== 'declined') {
    steps.push({
      key: 'requested',
      label: tx(C.st_requested),
      state: c.state === 'proposed' ? 'todo' : 'done',
      meta: c.state === 'proposed' ? undefined : who(full ? full.requestedBy?.name : c.projection === 'design' ? c.requesterName : null, c.requestedAt),
    })
    steps.push({
      key: 'design',
      label: tx(C.st_design),
      state: at(1),
      meta:
        c.state === 'requested' ? tx(C.waitingDesigner) : c.state === 'changes_requested' ? tx(C.s_changes_requested) : who(c.assignedDesigner?.name, c.designStartedAt),
    })
    steps.push({
      key: 'review',
      label: tx(C.st_review),
      state: at(2),
      meta:
        c.state === 'uploaded' ? tx(C.s_uploaded) : full?.approval ? who(full.approval.by?.name, full.approval.at) : c.currentFile && reached >= 2 ? tx(C.revision, { n: c.currentFile.revision }) : undefined,
    })
    steps.push({
      key: 'send',
      label: tx(C.st_send),
      state: reached >= 4 || (c.projection === 'design' && c.delivered) ? 'done' : at(3),
      meta: c.state === 'approved' ? tx(C.readyToSend) : full?.sent ? who(full.sent.by?.name, full.sent.at) : undefined,
    })
    if (full?.publishStory) {
      const live = !!full.story && !full.story.withdrawnAt
      steps.push({
        key: 'story',
        label: tx(C.st_story),
        state: live ? 'done' : closed ? 'skipped' : 'todo',
        meta: live ? who(null, full.story!.publishedAt) ?? tx(C.storyPublished) : tx(C.storyOptedIn),
      })
    }
  }
  if (closed) {
    const end = full?.cancelled
    const decided = full?.suggestion
    steps.push({
      key: 'closed',
      label: tx(stateLabel(c.state)),
      state: 'done',
      meta: c.state === 'cancelled' ? who(end?.by?.name, end?.at) : who(decided?.decidedBy?.name, decided?.decidedAt),
      children: (end?.reason ?? decided?.declineReason) ? <p className="rq-quote"><bdi>{end?.reason ?? decided?.declineReason}</bdi></p> : undefined,
    })
  }
  return steps
}

/** A history line in the reader's words: the state it moved to, or the event's own name when the state stayed. */
function historyLabel(h: HistoryEntry, tx: ReturnType<typeof useCopy>): string {
  return h.fromState !== h.toState ? tx(stateLabel(h.toState)) : h.kind.replace(/_/g, ' ')
}

/**
 * One certificate: its steps, what it says, its design, the review, the
 * delivery and the history. The buttons are the server's `actions` -- the
 * Designer never sees approve, send or Story, because the server never offers
 * them. The page shows it in the inspector beside the board, or in the side sheet.
 *
 * `intent` is the act a card asked for. It is taken once the certificate has
 * arrived and only if the server still offers it: an act with a dialog or a
 * reason opens there, one that needs neither is sent. Approve and upload are
 * never taken from a card -- the design is approved where it can be seen, and
 * a file is chosen by hand -- so for those the inspector simply opens.
 */
export function CertificateDetail({
  certificateId,
  intent = null,
  onIntentDone,
}: {
  certificateId: string
  intent?: CertificateAct | null
  onIntentDone?: () => void
}) {
  const tx = useCopy()
  const navigate = useNavigate()
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

  /** One act, as the page performs it: a reason first where one is owed, a dialog where there is something to confirm. */
  const perform = (a: CertificateAct) => {
    if (WITH_REASON[a]) setReasonFor(a)
    else if (DIRECT[a]) run(DIRECT[a]!)
    else if (a === 'approve') {
      if (c?.currentFile) run('approve', { fileId: c.currentFile.id })
    } else if (a === 'upload') fileInput.current?.click()
    else if (a === 'send' || a === 'story' || a === 'consent' || a === 'edit' || a === 'accept') setDialog(a)
  }

  // The act a card asked for, taken once the certificate is here and the server still offers it.
  const state = c?.state
  useEffect(() => {
    if (!intent || !c) return
    if (c.actions.includes(intent) && intent !== 'approve' && intent !== 'upload') perform(intent)
    onIntentDone?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per request from the card
  }, [intent, c?.id, state])

  const chat = c?.projection === 'full' ? c.sent?.conversationId ?? null : null
  const acts = c ? orderedActs(c.actions) : []
  const first = acts[0]
  // The foot: the first act stated, the rest behind "⋯" (what ends the request last).
  const primary = first ? (
    <button
      type="button"
      className={PRIMARY.has(first) ? 'btn btn--primary' : 'btn'}
      disabled={first === 'approve' ? act.isPending || !c?.currentFile : first === 'upload' ? upload.isPending : DIRECT[first] ? act.isPending : false}
      onClick={() => perform(first)}
    >
      {first === 'upload' && upload.isPending ? '…' : tx(actLabel(first))}
    </button>
  ) : chat ? (
    <Link className="btn" to={`/chat/${encodeURIComponent(chat)}`}>
      <Icon name="conversations" size={18} />
      {tx(C.openChat)}
    </Link>
  ) : undefined
  const more: MenuItem[] = [
    ...acts.slice(1).map((a) => ({ key: a, label: tx(actLabel(a)), icon: ACT_ICON[a], danger: ENDS.has(a), onSelect: () => perform(a) })),
    ...(first && chat ? [{ key: 'chat', label: tx(C.openChat), icon: 'conversations' as const, onSelect: () => navigate(`/chat/${encodeURIComponent(chat)}`) }] : []),
  ]

  return (
    <>
      <QueryBoundary isLoading={one.isLoading} error={one.error} onRetry={() => void one.refetch()}>
        {c && (
          <>
            <DetailCallout
              status={
                <>
                  <CertificateStatus certificate={c} />
                  <Age iso={c.requestedAt} />
                </>
              }
              state={certificateState(c, tx, locale)}
              note={
                c.returnMessage && (c.state === 'changes_requested' || c.state === 'in_design') ? (
                  <span role="note">
                    <strong>{tx(C.returnMessage)}:</strong> <span dir="auto">{c.returnMessage}</span>
                  </span>
                ) : c.actions.includes('upload') ? (
                  tx(C.uploadHint)
                ) : undefined
              }
              primary={primary}
              more={more}
              label={`${tx(C.moreActions)}: ${c.printedName}`}
            >
              {(fileError || upload.error || act.error) && (
                <div className="field__error" role="alert">
                  {fileError ?? describeError(upload.error ?? act.error, locale)}
                </div>
              )}
            </DetailCallout>

            <DetailSection title={tx(C.theRequest)}>
              <dl className="rq-fields">
                <Fact label={C.type} value={c.type ? tx({ en: c.type.labelEn, ar: c.type.labelAr }) : c.title} />
                <Fact label={C.titleField} value={c.title} />
                <Fact label={C.achievement} value={c.achievement} />
                <Fact label={C.juz} value={c.juz} />
                <Fact label={C.period} value={c.periodStart ? `${dayName(c.periodStart, locale, false)}${c.periodEnd ? ` ${tx(C.periodEnd)} ${dayName(c.periodEnd, locale, false)}` : ''}` : null} />
                <Fact label={C.achievedOn} value={c.achievedOn ? dayName(c.achievedOn, locale, false) : null} />
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
            </DetailSection>

            {c.files.length > 0 && (
              <DetailSection title={tx(C.files)}>
                <ul className="cert-files">
                  {c.files.map((f) => (
                    <li key={f.id}>
                      <span className="cert-files__name">
                        {tx(C.revision, { n: f.revision })}{locale === 'ar' ? '، ' : ', '}<bdi>{f.fileName}</bdi>
                        {f.id === c.currentFile?.id && <span className="cert-files__current">{tx(C.current)}</span>}
                      </span>
                      <button type="button" className="btn btn--sm" onClick={() => void openFile(f.id)}>{tx(C.open)}</button>
                    </li>
                  ))}
                </ul>
              </DetailSection>
            )}

            {c.projection === 'full' && c.category === 'student' && c.publishStory && (
              <p className="cert-consent">
                {tx(C.consentTitle)}: <strong>{tx(c.consent ? (c.consent.kind === 'granted' ? C.consentGranted : C.consentWithdrawn) : C.consentNone)}</strong>
              </p>
            )}

            <DetailSection title={tx(C.steps)}>
              <FlowSteps steps={certificateSteps(c, tx, dateTime, locale === 'ar' ? '، ' : ', ')} label={tx(C.steps)} />
            </DetailSection>

            {c.history && c.history.length > 0 && (
              <DetailSection title={tx(C.history)}>
                <ol className="cert-history">
                  {c.history.map((h) => (
                    <li key={h.seq}>
                      <strong title={h.kind}>{historyLabel(h, tx)}</strong>
                      {h.actor?.name ? <>{locale === 'ar' ? '، ' : ', '}<bdi>{h.actor.name}</bdi></> : null}
                      <span className="cert-history__when">{dateTime(h.at)}</span>
                      {h.note ? <div className="cert-history__note"><bdi>{h.note}</bdi></div> : null}
                    </li>
                  ))}
                </ol>
              </DetailSection>
            )}

            <input ref={fileInput} type="file" accept={CERTIFICATE_ACCEPT} hidden onChange={(e) => onFile(e.target.files?.[0])} aria-label={tx(C.a_upload)} />
          </>
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
    </>
  )
}

function Fact({ label, value }: { label: Pair; value: string | number | null | undefined }) {
  const tx = useCopy()
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="rq-field">
      <dt>{tx(label)}</dt>
      <dd><bdi>{value}</bdi></dd>
    </div>
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
            {t.members != null && <>{locale === 'ar' ? '، ' : ', '}{tx(C.members, { n: t.members })}</>}
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
            <SearchableSelect className="select" value={contactId} onValueChange={(v) => setContactId(v)}>
              <option value="" />
              {contacts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.relationship ? ` (${p.relationship})` : ''}
                </option>
              ))}
            </SearchableSelect>
          </label>
          <label className="field">
            <span className="field__label">{tx(C.consentMethod)}</span>
            <SearchableSelect className="select" value={method} onValueChange={(v) => setMethod(v as typeof method)}>
              <option value="in_chat">{tx(C.m_in_chat)}</option>
              <option value="phone">{tx(C.m_phone)}</option>
              <option value="in_person">{tx(C.m_in_person)}</option>
              <option value="written">{tx(C.m_written)}</option>
            </SearchableSelect>
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
