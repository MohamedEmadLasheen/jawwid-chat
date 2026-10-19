import { useId, useMemo, useState, type ReactNode } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { useCalendarDate } from '@/features/teacher-files/calendar'
import { CERTIFICATE_ACCEPT, MAX_CERTIFICATE_BYTES, type Certificate, type LeaveRequest } from './api'
import { S, describeError, useCopy } from './copy'
import {
  useApproveLeave,
  useCancelLeave,
  useDeclineCertificate,
  useDeclineLeave,
  useIssueCertificate,
  useSetAllowance,
} from './hooks'

function Footer({
  onCancel,
  onSave,
  pending,
  label,
  danger = false,
}: {
  onCancel: () => void
  onSave: () => void
  pending: boolean
  label: string
  danger?: boolean
}) {
  const tx = useCopy()
  return (
    <>
      <DialogCancelButton onClick={onCancel} />
      <button type="button" className={danger ? 'btn btn--danger' : 'btn btn--primary'} disabled={pending} onClick={onSave}>
        {pending ? tx(S.saving) : label}
      </button>
    </>
  )
}

function ServerError({ error }: { error: unknown }) {
  const { locale } = useI18n()
  if (!error) return null
  return (
    <div className="banner banner--danger" role="alert">
      {describeError(error, locale)}
    </div>
  )
}

function TextArea({ label, value, onChange, error }: { label: string; value: string; onChange: (v: string) => void; error?: string | null }) {
  const id = useId()
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className="input sv-textarea"
        value={value}
        dir="auto"
        rows={3}
        maxLength={1000}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-err` : undefined}
      />
      {error && (
        <span id={`${id}-err`} className="field__error">
          {error}
        </span>
      )}
    </div>
  )
}

function Summary({ children }: { children: ReactNode }) {
  return <dl className="tf-kv">{children}</dl>
}

// ---------------------------------------------------------------------------
// Certificates
// ---------------------------------------------------------------------------

/** Pick the finished file, upload it on its signed URL, issue. */
export function IssueCertificateDialog({ certificate, onClose }: { certificate: Certificate; onClose: () => void }) {
  const tx = useCopy()
  const cal = useCalendarDate()
  const issue = useIssueCertificate()
  const fileId = useId()
  const [file, setFile] = useState<File | null>(null)
  const [touched, setTouched] = useState(false)
  const problem = !file
    ? tx(S.required)
    : !CERTIFICATE_ACCEPT.split(',').includes(file.type)
      ? tx(S.fileWrongType)
      : file.size > MAX_CERTIFICATE_BYTES
        ? tx(S.fileTooLarge)
        : null

  return (
    <Dialog
      title={tx(S.issueTitle, { name: certificate.learner.name })}
      onClose={onClose}
      footer={
        <Footer
          onCancel={onClose}
          pending={issue.isPending}
          label={tx(S.issue)}
          onSave={() => {
            setTouched(true)
            if (problem || !file) return
            issue.mutate({ certificateId: certificate.id, file }, { onSuccess: onClose })
          }}
        />
      }
    >
      <Summary>
        <dt>{tx(S.certificate)}</dt>
        <dd dir="auto">{certificate.title}</dd>
        <dt>{tx(S.printedName)}</dt>
        <dd dir="auto">{certificate.printedName}</dd>
        <dt>{tx(S.achievedOn)}</dt>
        <dd>{cal.day(certificate.achievedOn)}</dd>
        {certificate.grade && (
          <>
            <dt>{tx(S.grade)}</dt>
            <dd dir="auto">{certificate.grade}</dd>
          </>
        )}
      </Summary>
      <p className="field__hint">{tx(S.issueHint)}</p>
      <div className="field">
        <label className="field__label" htmlFor={fileId}>
          {tx(S.file)}
        </label>
        <input
          id={fileId}
          className="input"
          type="file"
          accept={CERTIFICATE_ACCEPT}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          aria-invalid={touched && Boolean(problem)}
          aria-describedby={touched && problem ? `${fileId}-err` : undefined}
        />
        {touched && problem && (
          <span id={`${fileId}-err`} className="field__error">
            {problem}
          </span>
        )}
      </div>
      {issue.isPending && <p className="sv-muted">{tx(S.uploading)}</p>}
      <ServerError error={issue.error} />
    </Dialog>
  )
}

export function DeclineCertificateDialog({ certificate, onClose }: { certificate: Certificate; onClose: () => void }) {
  const tx = useCopy()
  const decline = useDeclineCertificate()
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  return (
    <Dialog
      title={tx(S.declineTitle, { name: certificate.learner.name })}
      onClose={onClose}
      footer={
        <Footer
          onCancel={onClose}
          pending={decline.isPending}
          label={tx(S.decline)}
          danger
          onSave={() => {
            setTouched(true)
            if (!reason.trim()) return
            decline.mutate({ certificateId: certificate.id, reason: reason.trim() }, { onSuccess: onClose })
          }}
        />
      }
    >
      <p className="field__hint">{tx(S.declineHint)}</p>
      <TextArea label={tx(S.whyRequired)} value={reason} onChange={setReason} error={touched && !reason.trim() ? tx(S.required) : null} />
      <ServerError error={decline.error} />
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------

function daysOf(first: string, last: string): string[] {
  const out: string[] = []
  for (let t = Date.parse(`${first}T00:00:00Z`); t <= Date.parse(`${last}T00:00:00Z`) && out.length < 400; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}

/**
 * Approve: which days are leave (all by default), and -- when lessons fall
 * inside -- an explicit confirmation that they will be cancelled. The server
 * refuses the approval without it, so the page asks first.
 */
export function ApproveLeaveDialog({ request, onClose }: { request: LeaveRequest; onClose: () => void }) {
  const tx = useCopy()
  const cal = useCalendarDate()
  const { dateTime, number } = useI18n()
  const approve = useApproveLeave()
  const all = useMemo(() => daysOf(request.firstDay, request.lastDay), [request.firstDay, request.lastDay])
  const [days, setDays] = useState<Set<string>>(() => new Set(all))
  const [note, setNote] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [touched, setTouched] = useState(false)
  /** Lessons the server could not cancel: the leave is approved, but say so before closing. */
  const [leftOpen, setLeftOpen] = useState<number | null>(null)
  const lessons = request.collidingLessons ?? []
  const missingConfirm = lessons.length > 0 && !confirmed
  const after = request.balance === null || request.balance === undefined ? null : request.balance - days.size

  return (
    <Dialog
      title={tx(S.approveTitle, { name: request.teacher.name ?? '' })}
      onClose={onClose}
      footer={
        <Footer
          onCancel={onClose}
          pending={approve.isPending}
          label={tx(S.approve)}
          onSave={() => {
            setTouched(true)
            if (leftOpen !== null) return onClose()
            if (days.size === 0 || missingConfirm) return
            approve.mutate(
              {
                requestId: request.id,
                body: {
                  ...(days.size === all.length ? {} : { days: all.filter((d) => days.has(d)) }),
                  ...(note.trim() ? { note: note.trim() } : {}),
                  ...(lessons.length > 0 ? { cancelCollidingLessons: true } : {}),
                },
              },
              { onSuccess: (res) => (res.notCancelled.length > 0 ? setLeftOpen(res.notCancelled.length) : onClose()) },
            )
          }}
        />
      }
    >
      {leftOpen !== null && (
        <div className="banner banner--warn" role="status">
          {tx(S.notCancelled, { n: number(leftOpen) })}
        </div>
      )}
      <p className="field__hint">{tx(S.approveDaysHint)}</p>
      <fieldset className="sv-days">
        <legend className="field__label">{tx(S.days)}</legend>
        {all.map((d) => (
          <label key={d} className="sv-day">
            <input
              type="checkbox"
              checked={days.has(d)}
              onChange={(e) =>
                setDays((prev) => {
                  const next = new Set(prev)
                  if (e.target.checked) next.add(d)
                  else next.delete(d)
                  return next
                })
              }
            />
            {cal.day(d)}
          </label>
        ))}
      </fieldset>
      {touched && days.size === 0 && <p className="field__error">{tx(S.pickADay)}</p>}
      <p className="sv-muted" aria-live="polite">
        {tx(S.deducted, { n: number(days.size), b: after === null ? tx(S.noAllowance) : number(after) })}
      </p>
      {lessons.length > 0 && (
        <div className="field">
          <span className="field__label">{tx(S.collisions)}</span>
          <ul className="sv-collisions">
            {lessons.map((l) => (
              <li key={l.id}>
                <bdi>{l.learnerName}</bdi> — {dateTime(l.startsAt)}
              </li>
            ))}
          </ul>
          <p className="field__hint">{tx(S.collisionsHint)}</p>
          <label className="sv-check">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            {tx(S.confirmCancelLessons)}
          </label>
          {touched && missingConfirm && <p className="field__error">{tx(S.confirmRequired)}</p>}
        </div>
      )}
      <TextArea label={tx(S.note)} value={note} onChange={setNote} />
      <ServerError error={approve.error} />
    </Dialog>
  )
}

export function DeclineLeaveDialog({ request, onClose }: { request: LeaveRequest; onClose: () => void }) {
  const tx = useCopy()
  const decline = useDeclineLeave()
  const [note, setNote] = useState('')
  const [touched, setTouched] = useState(false)
  return (
    <Dialog
      title={tx(S.declineLeaveTitle, { name: request.teacher.name ?? '' })}
      onClose={onClose}
      footer={
        <Footer
          onCancel={onClose}
          pending={decline.isPending}
          label={tx(S.decline)}
          danger
          onSave={() => {
            setTouched(true)
            if (!note.trim()) return
            decline.mutate({ requestId: request.id, note: note.trim() }, { onSuccess: onClose })
          }}
        />
      }
    >
      <TextArea label={tx(S.whyRequired)} value={note} onChange={setNote} error={touched && !note.trim() ? tx(S.required) : null} />
      <ServerError error={decline.error} />
    </Dialog>
  )
}

export function CancelLeaveDialog({ request, onClose }: { request: LeaveRequest; onClose: () => void }) {
  const tx = useCopy()
  const cancel = useCancelLeave()
  const [note, setNote] = useState('')
  const [touched, setTouched] = useState(false)
  return (
    <Dialog
      title={tx(S.cancelLeaveTitle, { name: request.teacher.name ?? '' })}
      onClose={onClose}
      footer={
        <Footer
          onCancel={onClose}
          pending={cancel.isPending}
          label={tx(S.cancelLeave)}
          danger
          onSave={() => {
            setTouched(true)
            if (!note.trim()) return
            cancel.mutate({ requestId: request.id, note: note.trim() }, { onSuccess: onClose })
          }}
        />
      }
    >
      <p className="field__hint">{tx(S.cancelLeaveHint)}</p>
      <TextArea label={tx(S.whyRequired)} value={note} onChange={setNote} error={touched && !note.trim() ? tx(S.required) : null} />
      <ServerError error={cancel.error} />
    </Dialog>
  )
}

export function SetAllowanceDialog({
  teacherId,
  year,
  current,
  onClose,
}: {
  teacherId: string
  year: number
  current: number | null
  onClose: () => void
}) {
  const tx = useCopy()
  const set = useSetAllowance(teacherId)
  const daysId = useId()
  const [days, setDays] = useState(current === null ? '' : String(current))
  const [note, setNote] = useState('')
  const [touched, setTouched] = useState(false)
  const parsed = /^\d{1,3}$/.test(days.trim()) ? Number(days.trim()) : NaN
  const invalid = !Number.isInteger(parsed) || parsed < 0 || parsed > 366
  return (
    <Dialog
      title={tx(S.setAllowanceTitle, { year })}
      onClose={onClose}
      footer={
        <Footer
          onCancel={onClose}
          pending={set.isPending}
          label={tx(S.save)}
          onSave={() => {
            setTouched(true)
            if (invalid) return
            set.mutate({ year, days: parsed, ...(note.trim() ? { note: note.trim() } : {}) }, { onSuccess: onClose })
          }}
        />
      }
    >
      <p className="field__hint">{tx(S.allowanceHint)}</p>
      <div className="field">
        <label className="field__label" htmlFor={daysId}>
          {tx(S.allowanceDays)}
        </label>
        <input
          id={daysId}
          className="input"
          inputMode="numeric"
          dir="ltr"
          value={days}
          onChange={(e) => setDays(e.target.value)}
          aria-invalid={touched && invalid}
          aria-describedby={touched && invalid ? `${daysId}-err` : undefined}
        />
        {touched && invalid && (
          <span id={`${daysId}-err`} className="field__error">
            {tx(S.daysInvalid)}
          </span>
        )}
      </div>
      <TextArea label={tx(S.note)} value={note} onChange={setNote} />
      <ServerError error={set.error} />
    </Dialog>
  )
}
