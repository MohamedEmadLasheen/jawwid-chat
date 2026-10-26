import { useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge, type Tone } from '@/shared/components/Badge'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import type { FeedbackCategory, FeedbackStatus, StaffFeedback } from './api'
import { F, describeFeedbackError, useCopy } from './copy'
import { useReplyFeedback } from './hooks'

/**
 * PD-32 parent feedback, the pieces shared by the Supervision page, the
 * complaints (PD-26) and the family's Parent File (PD-17). Nothing here
 * imports a page, so any of them may import it.
 */

const CATEGORY_TONE: Record<FeedbackCategory, Tone> = { praise: 'ok', suggestion: 'info', complaint: 'warn' }
const STATUS_TONE: Record<FeedbackStatus, Tone> = { received: 'today', in_review: 'info', resolved: 'ok' }

export function FeedbackCategoryBadge({ category }: { category: FeedbackCategory }) {
  const tx = useCopy()
  return <Badge tone={CATEGORY_TONE[category]}>{tx(F[category])}</Badge>
}

export function FeedbackStatusBadge({ status }: { status: FeedbackStatus }) {
  const tx = useCopy()
  return (
    <Badge tone={STATUS_TONE[status]} dot>
      {tx(F[status])}
    </Badge>
  )
}

/**
 * One piece of parent feedback, the same on the Supervision page and on the
 * family's Parent File: what the parent wrote, about whom, its status, the
 * reply they read, and -- for a complaint -- who handles it. `actions` is
 * left out where it is read only.
 */
export function FeedbackItem({ feedback: f, teacherHref, actions }: { feedback: StaffFeedback; teacherHref?: string; actions?: ReactNode }) {
  const tx = useCopy()
  const { dateTime } = useI18n()
  return (
    <li className="tf-entry">
      <div className="tf-entry__head">
        <FeedbackCategoryBadge category={f.category} />
        <FeedbackStatusBadge status={f.status} />
        <span className="tf-byline">{tx(F.sentOn, { date: dateTime(f.createdAt) })}</span>
      </div>
      <div className="tf-entry__head">
        <span dir="auto">{tx(F.child, { name: f.child.name })}</span>
        <span dir="auto">{tx(F.parent, { name: f.parent.name })}</span>
        {teacherHref ? (
          <Link to={teacherHref} dir="auto">
            {tx(F.teacher, { name: f.teacher.name })}
          </Link>
        ) : (
          <span dir="auto">{tx(F.teacher, { name: f.teacher.name })}</span>
        )}
        {f.category === 'complaint' && (
          <span className="tf-muted">{f.complaint?.handledBy ? tx(F.handledBy, { name: f.complaint.handledBy.name }) : tx(F.notTaken)}</span>
        )}
      </div>
      <p className="tf-entry__body" dir="auto">
        {f.body}
      </p>
      {f.response ? (
        <div className="tf-followup" aria-label={tx(F.theReply)}>
          <span className="tf-byline">{tx(F.theReply)}</span>
          <p className="tf-entry__body" dir="auto">
            {f.response}
          </p>
          {f.respondedBy && f.respondedAt && (
            <span className="tf-byline">{tx(F.repliedBy, { name: f.respondedBy.name, date: dateTime(f.respondedAt) })}</span>
          )}
        </div>
      ) : (
        <span className="tf-muted">{tx(F.noReply)}</span>
      )}
      {actions && <div className="tf-entry__actions">{actions}</div>}
    </li>
  )
}

/**
 * The reply the parent reads (replacing an earlier one). Praise and a
 * suggestion may be resolved with it; a complaint is resolved only on the
 * Teacher File, so the dialog says where instead of offering the box.
 */
export function ReplyDialog({
  feedbackId,
  category,
  parentName,
  current,
  links,
  onClose,
}: {
  feedbackId: string
  category: FeedbackCategory
  parentName: string
  current: string | null
  /** Where a complaint is resolved, when the dialog is opened away from it. */
  links?: ReactNode
  onClose: () => void
}) {
  const tx = useCopy()
  const { locale } = useI18n()
  const reply = useReplyFeedback()
  const textId = useId()
  const hintId = useId()
  const [text, setText] = useState(current ?? '')
  const [resolve, setResolve] = useState(false)
  const [touched, setTouched] = useState(false)
  const empty = text.trim() === ''
  return (
    <Dialog
      title={tx(F.replyTitle, { name: parentName })}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button
            type="button"
            className="btn btn--primary"
            disabled={reply.isPending}
            onClick={() => {
              setTouched(true)
              if (empty) return
              reply.mutate(
                { id: feedbackId, response: text.trim(), ...(category !== 'complaint' && resolve ? { resolve: true } : {}) },
                { onSuccess: onClose },
              )
            }}
          >
            {reply.isPending ? tx(F.sending) : tx(F.send)}
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field__label" htmlFor={textId}>
          {tx(F.replyLabel)}
        </label>
        <textarea
          id={textId}
          className="input tf-textarea"
          rows={4}
          dir="auto"
          maxLength={2000}
          aria-describedby={hintId}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <span id={hintId} className="field__hint">
          {tx(F.replyHint)}
          {current ? ` ${tx(F.replaces)}` : ''}
        </span>
        {touched && empty && <span className="field__error">{tx(F.required)}</span>}
      </div>
      {category === 'complaint' ? (
        <div className="th-reply-note">
          <p className="field__hint">{tx(F.complaintResolves)}</p>
          {links}
        </div>
      ) : (
        <label className="th-check">
          <input type="checkbox" checked={resolve} onChange={(e) => setResolve(e.target.checked)} />
          <span>
            {tx(F.markResolved)}
            <span className="field__hint"> {tx(F.markResolvedHint)}</span>
          </span>
        </label>
      )}
      {reply.error ? (
        <div className="banner banner--danger" role="alert">
          {describeFeedbackError(reply.error, locale)}
        </div>
      ) : null}
    </Dialog>
  )
}
