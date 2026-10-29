import { useId, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { QueryBoundary } from '@/shared/components/States'
import { describeError } from '@/features/organization/copy'
import { chatKeys } from '@/features/chat/chatApi'
import {
  CORRECTABLE_OUTCOMES,
  emptyReport,
  journeyApi,
  journeyKeys,
  reportComplete,
  reportOf,
  type LessonRecord,
  type ReportInput,
} from './api'
import {
  J,
  LEVEL_LABELS,
  OUTCOME_LABELS,
  REVISION_LABELS,
  TASK_LABELS,
  TIMING_LABELS,
  TOPIC_LABELS,
  excuseCategoryLabel,
  formatLessonWhen,
  useJourneyCopy,
} from './copy'
import { ReportForm, reportBody } from './ReportForm'
import './journey.css'

type Mode = 'view' | 'correct' | 'edit' | 'delete' | 'history' | 'request'

/**
 * PD-15: one lesson's record, from a lesson card in the chat. Staff with the
 * standing (the Teachers department, the child's Operations supervisor and
 * manager, the super admin) correct its outcome and edit, delete or resend its
 * report here -- and only here, so the chat and the statistics never disagree.
 * The server decides every action; a refusal is shown in its own words.
 */
export function LessonRecordDialog({
  lessonId,
  conversationId,
  onClose,
  initialMode = 'view',
}: {
  lessonId: string
  conversationId: string
  onClose: () => void
  /** PD-35: open straight on the history (a correction's before and after). */
  initialMode?: Mode
}) {
  const { tx } = useJourneyCopy()
  const qc = useQueryClient()
  const [mode, setMode] = useState<Mode>(initialMode)
  const q = useQuery({ queryKey: journeyKeys.lesson(lessonId), queryFn: () => journeyApi.lesson(lessonId), retry: false })
  const done = () => {
    void qc.invalidateQueries({ queryKey: journeyKeys.lesson(lessonId) })
    void qc.invalidateQueries({ queryKey: journeyKeys.history(lessonId) })
    void qc.invalidateQueries({ queryKey: chatKeys.messages(conversationId) })
    void qc.invalidateQueries({ queryKey: journeyKeys.tickets(conversationId) })
    setMode('view')
  }

  if (q.error) {
    return (
      <Dialog title={tx(J.recordTitle)} onClose={onClose} footer={<DialogCancelButton onClick={onClose} />}>
        <p className="ts-muted">{tx(J.recordUnavailable)}</p>
      </Dialog>
    )
  }
  const l = q.data
  if (!l) {
    return (
      <Dialog title={tx(J.recordTitle)} onClose={onClose} footer={<DialogCancelButton onClick={onClose} />}>
        <QueryBoundary isLoading error={null} onRetry={() => void q.refetch()}>
          {null}
        </QueryBoundary>
      </Dialog>
    )
  }
  if (mode === 'correct') return <CorrectForm l={l} onBack={() => setMode('view')} onDone={done} />
  if (mode === 'edit') return <EditForm l={l} onBack={() => setMode('view')} onDone={done} />
  if (mode === 'delete') return <DeleteForm l={l} onBack={() => setMode('view')} onDone={done} />
  if (mode === 'history') return <HistoryView l={l} onBack={() => setMode('view')} />
  if (mode === 'request') return <RequestForm l={l} onBack={() => setMode('view')} onDone={done} />
  return <RecordView l={l} onClose={onClose} onMode={setMode} />
}

function outcomeText(l: LessonRecord, tx: (p: { en: string; ar: string } | undefined) => string): string {
  if (!l.outcome) return tx(J.noOutcome)
  const base = tx(OUTCOME_LABELS[l.outcome] ?? { en: l.outcome, ar: l.outcome })
  return l.apologyTiming ? `${base} — ${tx(TIMING_LABELS[l.apologyTiming])}` : base
}

function RecordView({ l, onClose, onMode }: { l: LessonRecord; onClose: () => void; onMode: (m: Mode) => void }) {
  const { tx, locale } = useJourneyCopy()
  const r = l.report
  const liveReport = l.outcome === 'held' && r && !r.deletedAt
  const correctable = l.outcome !== null && !['voided', 'rescheduled', 'suspended'].includes(l.outcome)
  // PD-35: a report the teacher should file -- the lesson started and has none yet.
  const reportOwed = (l.outcome === null || l.outcome === 'held') && !liveReport && Date.parse(l.startsAt) <= Date.now()
  return (
    <Dialog
      title={`${tx(J.recordTitle)} — ${l.learner.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={() => onMode('history')}>{tx(J.history)}</button>
          {correctable && <button type="button" className="btn" onClick={() => onMode('correct')}>{tx(J.correct)}</button>}
          {(liveReport || reportOwed) && (
            <button type="button" className="btn" onClick={() => onMode('request')}>{tx(liveReport ? J.requestCorrection : J.requestReport)}</button>
          )}
          {liveReport && <button type="button" className="btn" onClick={() => onMode('edit')}>{tx(J.editReport)}</button>}
          {liveReport && <button type="button" className="btn btn--danger" onClick={() => onMode('delete')}>{tx(J.deleteReport)}</button>}
          <DialogCancelButton onClick={onClose} />
        </>
      }
    >
      <dl className="jr-facts">
        <dt>{tx(J.lesson)}</dt>
        <dd>{formatLessonWhen(l.startsAt, locale)} · {l.teacher.name}</dd>
        <dt>{tx(J.outcome)}</dt>
        <dd>{outcomeText(l, tx)}</dd>
        {excuseCategoryLabel(l.excuseCategory) && (
          <>
            <dt>{tx(J.reason)}</dt>
            <dd>{tx(excuseCategoryLabel(l.excuseCategory)!)}</dd>
          </>
        )}
        {l.outcomeNote && (
          <>
            <dt>{tx(l.excuseCategory ? J.noteStaffTeacher : J.reasonStaffTeacher)}</dt>
            <dd dir="auto">{l.outcomeNote}</dd>
          </>
        )}
      </dl>
      {r && (
        <section className="jr-report-view" aria-label={tx(J.editReport)}>
          {r.deletedAt && <p className="banner banner--warning">{tx(J.deletedReport)}</p>}
          <dl className="jr-facts">
            {r.lessonNumber !== null && (<><dt>{tx(J.lessonNumber)}</dt><dd>{r.lessonNumber}</dd></>)}
            <dt>{tx(J.covered)}</dt>
            <dd dir="auto">
              {[...r.coveredTopics.map((c) => tx(TOPIC_LABELS[c] ?? { en: c, ar: c })), r.covered].filter(Boolean).join(' · ')}
            </dd>
            {r.rating !== null && (<><dt>{tx(J.performance)}</dt><dd>{tx(LEVEL_LABELS[r.rating] ?? { en: String(r.rating), ar: String(r.rating) })}</dd></>)}
            {(r.nextTasks.length > 0 || r.homework) && (
              <>
                <dt>{tx(J.nextLesson)}</dt>
                <dd dir="auto">{[...r.nextTasks.map((c) => tx(TASK_LABELS[c] ?? { en: c, ar: c })), r.homework].filter(Boolean).join(' · ')}</dd>
              </>
            )}
            {r.note && (<><dt>{tx(J.note)}</dt><dd dir="auto">{r.note}</dd></>)}
            <dt>{tx(J.version)}</dt>
            <dd>{r.version}</dd>
          </dl>
        </section>
      )}
    </Dialog>
  )
}

function useSubmit(onDone: () => void) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const run = async (fn: () => Promise<unknown>) => {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await fn()
      onDone()
    } catch (e) {
      setError(e)
      setPending(false)
    }
  }
  return { pending, error, run }
}

function Footer({ onBack, onSave, pending, danger = false }: { onBack: () => void; onSave: () => void; pending: boolean; danger?: boolean }) {
  const { tx } = useJourneyCopy()
  return (
    <>
      <button type="button" className="btn" onClick={onBack}>{tx(J.back)}</button>
      <button type="button" className={danger ? 'btn btn--danger' : 'btn btn--primary'} disabled={pending} onClick={onSave}>
        {pending ? tx(J.saving) : tx(J.save)}
      </button>
    </>
  )
}

function ServerError({ error }: { error: unknown }) {
  const { locale } = useJourneyCopy()
  if (!error) return null
  return <div className="banner banner--danger" role="alert">{describeError(error, locale)}</div>
}

/** PD-35: ask the teacher to correct (or file) the report, with a reason. */
function RequestForm({ l, onBack, onDone }: { l: LessonRecord; onBack: () => void; onDone: () => void }) {
  const { tx } = useJourneyCopy()
  const id = useId()
  const s = useSubmit(onDone)
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const live = !!(l.report && !l.report.deletedAt)
  return (
    <Dialog
      title={`${tx(live ? J.requestCorrection : J.requestReport)} — ${l.learner.name}`}
      onClose={onBack}
      footer={
        <Footer
          onBack={onBack}
          pending={s.pending}
          onSave={() => {
            setTouched(true)
            if (!reason.trim()) return
            void s.run(() => journeyApi.requestCorrection(l.id, { reason: reason.trim(), kind: live ? 'correction' : 'missing' }))
          }}
        />
      }
    >
      <p className="ts-muted">{tx(J.requestHint)}</p>
      <div className="field">
        <label className="field__label" htmlFor={id}>{tx(J.requestReason)}</label>
        <textarea id={id} className="input" dir="auto" rows={3} maxLength={500} value={reason} aria-invalid={touched && !reason.trim()} onChange={(e) => setReason(e.target.value)} />
        {touched && !reason.trim() && <span className="field__error">{tx(J.required)}</span>}
      </div>
      <ServerError error={s.error} />
    </Dialog>
  )
}

function ReasonField({ value, onChange, touched }: { value: string; onChange: (v: string) => void; touched: boolean }) {
  const { tx } = useJourneyCopy()
  const id = useId()
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{tx(J.reasonInternal)}</label>
      <textarea id={id} className="input" dir="auto" rows={2} maxLength={1000} value={value} aria-invalid={touched && !value.trim()} onChange={(e) => onChange(e.target.value)} />
      {touched && !value.trim() && <span className="field__error">{tx(J.required)}</span>}
    </div>
  )
}

function CorrectForm({ l, onBack, onDone }: { l: LessonRecord; onBack: () => void; onDone: () => void }) {
  const { tx } = useJourneyCopy()
  const id = useId()
  const s = useSubmit(onDone)
  const [to, setTo] = useState('')
  const [timing, setTiming] = useState('')
  const [reason, setReason] = useState('')
  const [report, setReport] = useState<ReportInput>(reportOf(l.report))
  const [touched, setTouched] = useState(false)
  // A held lesson stands on a report: its previous one comes back, or one is written here.
  const needsReport = to === 'held' && !l.report
  const options = CORRECTABLE_OUTCOMES.filter((o) => o !== l.outcome)
  const invalid = !to || !reason.trim() || (to === 'student_apology' && !timing) || (needsReport && !reportComplete(report))
  return (
    <Dialog
      title={`${tx(J.correct)} — ${l.learner.name}`}
      onClose={onBack}
      footer={
        <Footer
          onBack={onBack}
          pending={s.pending}
          onSave={() => {
            setTouched(true)
            if (invalid) return
            void s.run(() =>
              journeyApi.correct(l.id, {
                outcome: to,
                reason: reason.trim(),
                ...(to === 'student_apology' ? { apologyTiming: timing } : {}),
                ...(needsReport ? { report: reportBody(report) } : {}),
              }),
            )
          }}
        />
      }
    >
      <p className="ts-muted">{tx(J.correctHint)}</p>
      <div className="field">
        <label className="field__label" htmlFor={`${id}-to`}>{tx(J.correctTo)}</label>
        <select id={`${id}-to`} className="select" value={to} onChange={(e) => setTo(e.target.value)} aria-invalid={touched && !to}>
          <option value="">{tx(J.choose)}</option>
          {options.map((o) => (
            <option key={o} value={o}>{tx(OUTCOME_LABELS[o])}</option>
          ))}
        </select>
        {touched && !to && <span className="field__error">{tx(J.required)}</span>}
        {to === 'voided' && <span className="field__hint">{tx(J.leaveUnsentHint)}</span>}
      </div>
      {to === 'student_apology' && (
        <div className="field">
          <label className="field__label" htmlFor={`${id}-t`}>{tx(J.timing)}</label>
          <select id={`${id}-t`} className="select" value={timing} onChange={(e) => setTiming(e.target.value)} aria-invalid={touched && !timing}>
            <option value="">{tx(J.choose)}</option>
            <option value="before_start">{tx(TIMING_LABELS.before_start)}</option>
            <option value="after_start">{tx(TIMING_LABELS.after_start)}</option>
          </select>
        </div>
      )}
      {needsReport && <ReportForm value={report} onChange={setReport} touched={touched} />}
      <ReasonField value={reason} onChange={setReason} touched={touched} />
      <ServerError error={s.error} />
    </Dialog>
  )
}

function EditForm({ l, onBack, onDone }: { l: LessonRecord; onBack: () => void; onDone: () => void }) {
  const { tx } = useJourneyCopy()
  const s = useSubmit(onDone)
  const [report, setReport] = useState<ReportInput>(reportOf(l.report))
  const [touched, setTouched] = useState(false)
  return (
    <Dialog
      title={`${tx(J.editReport)} — ${l.learner.name}`}
      onClose={onBack}
      footer={
        <Footer
          onBack={onBack}
          pending={s.pending}
          onSave={() => {
            setTouched(true)
            if (!reportComplete(report)) return
            void s.run(() => journeyApi.editReport(l.id, reportBody(report)))
          }}
        />
      }
    >
      <ReportForm value={report} onChange={setReport} touched={touched} />
      <ServerError error={s.error} />
    </Dialog>
  )
}

function DeleteForm({ l, onBack, onDone }: { l: LessonRecord; onBack: () => void; onDone: () => void }) {
  const { tx } = useJourneyCopy()
  const name = useId()
  const s = useSubmit(onDone)
  const [resend, setResend] = useState<boolean | null>(null)
  const [reason, setReason] = useState('')
  const [report, setReport] = useState<ReportInput>(l.report ? reportOf(l.report) : emptyReport())
  const [touched, setTouched] = useState(false)
  const invalid = resend === null || !reason.trim() || (resend && !reportComplete(report))
  return (
    <Dialog
      title={`${tx(J.deleteReport)} — ${l.learner.name}`}
      onClose={onBack}
      footer={
        <Footer
          danger
          onBack={onBack}
          pending={s.pending}
          onSave={() => {
            setTouched(true)
            if (invalid) return
            void s.run(() =>
              journeyApi.deleteReport(l.id, { reason: reason.trim(), resend: resend as boolean, ...(resend ? { report: reportBody(report) } : {}) }),
            )
          }}
        />
      }
    >
      <fieldset className="field jr-fieldset">
        <legend className="field__label">{tx(J.deleteHow)}</legend>
        <div className="jr-options">
          <label className="jr-option">
            <input type="radio" name={name} checked={resend === true} onChange={() => setResend(true)} />
            <span><strong>{tx(J.resend)}</strong><span className="ts-muted">{tx(J.resendHint)}</span></span>
          </label>
          <label className="jr-option">
            <input type="radio" name={name} checked={resend === false} onChange={() => setResend(false)} />
            <span><strong>{tx(J.leaveUnsent)}</strong><span className="ts-muted">{tx(J.leaveUnsentHint)}</span></span>
          </label>
        </div>
        {touched && resend === null && <span className="field__error">{tx(J.required)}</span>}
      </fieldset>
      {resend && <ReportForm value={report} onChange={setReport} touched={touched} />}
      <ReasonField value={reason} onChange={setReason} touched={touched} />
      <ServerError error={s.error} />
    </Dialog>
  )
}

function HistoryView({ l, onBack }: { l: LessonRecord; onBack: () => void }) {
  const { tx, locale } = useJourneyCopy()
  const q = useQuery({ queryKey: journeyKeys.history(l.id), queryFn: () => journeyApi.history(l.id), retry: false })
  const rows = [
    ...(q.data?.corrections ?? []).map((c) => ({
      at: c.at,
      text: `${tx(OUTCOME_LABELS[c.from] ?? { en: c.from, ar: c.from })} → ${tx(OUTCOME_LABELS[c.to] ?? { en: c.to, ar: c.to })}`,
      reason: c.reason,
    })),
    ...(q.data?.reportRevisions ?? []).map((r) => ({
      at: r.at,
      text: tx(REVISION_LABELS[r.action] ?? { en: r.action, ar: r.action }),
      reason: r.reason,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at))
  return (
    <Dialog title={`${tx(J.history)} — ${l.learner.name}`} onClose={onBack} footer={<button type="button" className="btn" onClick={onBack}>{tx(J.back)}</button>}>
      <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
        {rows.length === 0 ? (
          <p className="ts-muted">{tx(J.noHistory)}</p>
        ) : (
          <ol className="jr-history">
            {rows.map((r, i) => (
              <li key={i}>
                <time dateTime={r.at}>{formatLessonWhen(r.at, locale)}</time>
                <span>{r.text}</span>
                {r.reason && <span className="ts-muted" dir="auto">{r.reason}</span>}
              </li>
            ))}
          </ol>
        )}
      </QueryBoundary>
    </Dialog>
  )
}
