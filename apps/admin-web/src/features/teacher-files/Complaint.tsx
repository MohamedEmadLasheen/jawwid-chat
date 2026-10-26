import { useId, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge, type Tone } from '@/shared/components/Badge'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { DECISION_LABEL } from '@/features/discipline/copy'
import type { Decision } from '@/features/discipline/api'
import { useUpholdComplaint } from '@/features/discipline/hooks'
import { F, describeFeedbackError } from '@/features/teacher-supervision/copy'
import { FeedbackStatusBadge, ReplyDialog } from '@/features/teacher-supervision/FeedbackParts'
import { useTakeFeedback } from '@/features/teacher-supervision/hooks'
import type { Away, Complaint, ComplaintStatus, EntryBrief } from './api'
import { T, describeError, useCopy } from './copy'
import { useCalendarDate } from './calendar'

const STATUS: Record<ComplaintStatus, { label: keyof typeof T; tone: Tone }> = {
  open: { label: 'statusOpen', tone: 'warn' },
  upheld: { label: 'statusUpheld', tone: 'danger' },
  actioned: { label: 'statusActioned', tone: 'info' },
  resolved: { label: 'statusResolved', tone: 'ok' },
}

/** "On leave until 3 Nov", "Suspended until ...": the badge a teacher on a day off carries (PD-26). */
export function AwayBadge({ away }: { away: Away | null | undefined }) {
  const tx = useCopy()
  const cal = useCalendarDate()
  if (!away) return null
  const date = cal.day(away.until)
  const label = away.kind === 'leave' ? T.onLeaveUntil : away.kind === 'suspended' ? T.suspendedUntil : T.offUntil
  return (
    <Badge tone={away.kind === 'suspended' ? 'danger' : 'warn'} dot>
      {tx(label, { date })}
    </Badge>
  )
}

function Byline({ entry }: { entry: Omit<EntryBrief, 'author'> & { author: EntryBrief['author'] | null } }) {
  const tx = useCopy()
  const { dateTime } = useI18n()
  // A PD-32 app complaint has no staff author: the parent filed it (named in its head).
  if (!entry.author) return <span className="tf-byline">{dateTime(entry.createdAt)}</span>
  return <span className="tf-byline">{tx(T.by, { name: entry.author.name, date: dateTime(entry.createdAt) })}</span>
}

/** Where a complaint came from. An app complaint names the parent and the child (PD-32). */
function ComplaintOrigin({ complaint: c }: { complaint: Complaint }) {
  const tx = useCopy()
  if (c.from === 'parent_app') {
    const pf = c.parentFeedback
    return (
      <span className="tf-muted" dir="auto">
        {pf ? tx(F.fromApp, { parent: pf.parent.name, child: pf.child.name }) : tx(F.fromAppPlain)}
      </span>
    )
  }
  if (!c.from) return null
  return <span className="tf-muted">{tx(c.from === 'parent' ? T.fromParent : T.fromManagement)}</span>
}

/**
 * One complaint, the same on the Teacher File and on the Supervision page
 * (PD-26): where it came from, who handles it, its status, the action taken
 * (the decision on its violation, once upheld), its follow-ups and resolution.
 */
export function ComplaintItem({
  complaint: c,
  teacherName,
  canWrite,
  onFollowUp,
  onResolve,
  onUphold,
  onDecide,
}: {
  complaint: Complaint
  /** Shown when the list spans teachers. */
  teacherName?: string
  canWrite: boolean
  onFollowUp: () => void
  onResolve: () => void
  onUphold: () => void
  /** When given, an upheld complaint offers its decision right here. */
  onDecide?: () => void
}) {
  const tx = useCopy()
  const { locale } = useI18n()
  const take = useTakeFeedback()
  const [replying, setReplying] = useState(false)
  const status: ComplaintStatus = c.status ?? (c.resolution ? 'resolved' : 'open')
  const decision = c.action?.decision as Decision | null | undefined
  // PD-32: an app complaint is also the parent's feedback, with its own status and the one reply they read.
  const feedback = c.from === 'parent_app' ? (c.parentFeedback ?? null) : null
  return (
    <li className="tf-entry">
      <div className="tf-entry__head">
        <Badge tone={STATUS[status].tone} dot>
          {tx(T[STATUS[status].label])}
        </Badge>
        {teacherName && <strong dir="auto">{teacherName}</strong>}
        <ComplaintOrigin complaint={c} />
        <Byline entry={c} />
        {c.handledBy && <span className="tf-muted">{tx(T.handledBy, { name: c.handledBy.name })}</span>}
        {c.source && <span className="tf-muted">{tx(T.fromConversation)}</span>}
      </div>
      <p className="tf-entry__body" dir="auto">
        {c.body}
      </p>
      {feedback && (
        <div className="tf-entry__head">
          <span className="tf-muted">{tx(F.parentSees)}</span>
          <FeedbackStatusBadge status={feedback.status} />
        </div>
      )}
      {feedback?.response && (
        <div className="tf-followup" aria-label={tx(F.theReply)}>
          <span className="tf-byline">{tx(F.theReply)}</span>
          <p className="tf-entry__body" dir="auto">
            {feedback.response}
          </p>
        </div>
      )}
      {decision && <p className="tf-entry__body">{tx(T.actionTaken, { d: tx(DECISION_LABEL[decision]) })}</p>}
      {(c.followUps ?? []).length > 0 && (
        <div className="tf-followup" aria-label={tx(T.followUps)}>
          {(c.followUps ?? []).map((f) => (
            <div key={f.id}>
              <p className="tf-entry__body" dir="auto">
                {f.body}
              </p>
              <Byline entry={f} />
            </div>
          ))}
        </div>
      )}
      {c.resolution && (
        <div className="tf-followup">
          <p className="tf-entry__body" dir="auto">
            {c.resolution.body}
          </p>
          <Byline entry={c.resolution} />
        </div>
      )}
      {canWrite && (
        <div className="tf-entry__actions">
          {feedback && !c.handledBy && (
            <button type="button" className="btn btn--primary btn--sm" disabled={take.isPending} onClick={() => take.mutate(feedback.id)}>
              {tx(F.take)}
            </button>
          )}
          {feedback && (
            <button type="button" className="btn btn--sm" onClick={() => setReplying(true)}>
              {feedback.response ? tx(F.changeReply) : tx(F.reply)}
            </button>
          )}
          {status === 'open' && (
            <button type="button" className="btn btn--sm" onClick={onUphold}>
              {tx(T.uphold)}
            </button>
          )}
          {status === 'upheld' && onDecide && (
            <button type="button" className="btn btn--primary btn--sm" onClick={onDecide}>
              {tx(T.decideAction)}
            </button>
          )}
          {status !== 'resolved' && (
            <>
              <button type="button" className="btn btn--ghost btn--sm" onClick={onFollowUp}>
                {tx(T.followUp)}
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={onResolve}>
                {tx(T.resolve)}
              </button>
            </>
          )}
        </div>
      )}
      {take.error ? (
        <div className="banner banner--danger" role="alert">
          {describeFeedbackError(take.error, locale)}
        </div>
      ) : null}
      {replying && feedback && (
        <ReplyDialog
          feedbackId={feedback.id}
          category="complaint"
          parentName={feedback.parent.name}
          current={feedback.response}
          onClose={() => setReplying(false)}
        />
      )}
    </li>
  )
}

/** Upholding puts the complaint on the teacher's monthly ladder (PD-26); the decision is a second, separate act. */
export function UpholdDialog({ complaint, onClose }: { complaint: Complaint; onClose: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const uphold = useUpholdComplaint()
  const noteId = useId()
  const [note, setNote] = useState('')
  return (
    <Dialog
      title={tx(T.upholdTitle)}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button
            type="button"
            className="btn btn--primary"
            disabled={uphold.isPending}
            onClick={() => uphold.mutate({ complaintId: complaint.id, ...(note.trim() ? { note: note.trim() } : {}) }, { onSuccess: onClose })}
          >
            {uphold.isPending ? tx(T.saving) : tx(T.uphold)}
          </button>
        </>
      }
    >
      <p className="field__hint">{tx(T.upholdHint)}</p>
      <p className="tf-entry__body" dir="auto">
        {complaint.body}
      </p>
      <div className="field">
        <label className="field__label" htmlFor={noteId}>
          {tx(T.details)}
        </label>
        <textarea id={noteId} className="input tf-textarea" value={note} dir="auto" rows={3} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
      </div>
      {uphold.error ? (
        <div className="banner banner--danger" role="alert">
          {describeError(uphold.error, locale)}
        </div>
      ) : null}
    </Dialog>
  )
}
