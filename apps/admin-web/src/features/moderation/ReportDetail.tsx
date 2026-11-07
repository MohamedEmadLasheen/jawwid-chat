import { useEffect, useId, useRef, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ApiError } from '@/core/api/errors'
import { newIdempotencyKey } from '@/core/api/client'
import { Dialog } from '@/shared/components/Dialog'
import { QueryBoundary } from '@/shared/components/States'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import { RESOLUTIONS, ANSWER_MAX, NOTE_REQUIRED, type EvidenceAttachment, type ReportDetail as Detail, type ReportSubject, type Resolution } from './api'
import { MOD, REASON, RESOLUTION, RESOLUTION_HELP, STATUS, SUBJECT_KIND, useCopy } from './copy'
import { isNotAvailable, useOpenAttachment, useReport, useResolve, useTake } from './hooks'

/**
 * One report with its evidence. Evidence is the server's (moderation.view) and
 * every open of this sheet is audited server-side, so it is fetched only here.
 * Resolving needs an answer for the reporter (§5.2: "responded" means the
 * reporter was answered). The reported person (subject) is shown; nothing
 * about who reported is (§5.5). Access is scoped on the server: a 404 on the
 * detail, take, resolve or an attachment means "not available to you", and is
 * handed to the page (`onGone`), which drops the row and closes this sheet.
 * `canAct` is the staff member's moderation.act; the detail's own `canAct`
 * (per report) must also be true. UX only: the server decides each request.
 */
export function ReportDetail({ id, canAct, onClose, onGone }: { id: string; canAct: boolean; onClose: () => void; onGone: (id: string) => void }) {
  const tx = useCopy()
  const { locale, dateTime } = useI18n()
  const q = useReport(id)
  const r = q.data
  const notAvailable = isNotAvailable(q.error)
  const goneRef = useRef(onGone)
  goneRef.current = onGone
  useEffect(() => {
    if (notAvailable) goneRef.current(id)
  }, [notAvailable, id])
  const open = r !== undefined && (r.status === 'open' || r.status === 'in_review')
  const mayAct = canAct && r?.canAct === true && open
  return (
    <Dialog title={tx(MOD.detailTitle)} onClose={onClose} variant="sheet">
      {notAvailable ? (
        <p role="status">{tx(MOD.notAvailable)}</p>
      ) : (
        <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
          {r && (
            <div>
              <p className="field__hint">{tx(MOD.detailAudited)}</p>
              <dl className="sa-fixed">
                <dt>{tx(MOD.subject)}</dt>
                <dd>
                  <SubjectView subject={r.subject} targetKind={r.targetKind} testId="report-subject" />
                </dd>
                <dt>{tx(MOD.colReason)}</dt>
                <dd>{tx(REASON[r.reason] ?? { ar: r.reason, en: r.reason })}</dd>
                <dt>{tx(MOD.colStatus)}</dt>
                <dd>{tx(STATUS[r.status] ?? { ar: r.status, en: r.status })}</dd>
                <dt>{tx(MOD.colFiled)}</dt>
                <dd>{dateTime(r.createdAt)}</dd>
              </dl>
              {r.note && (
                <section>
                  <h3>{tx(MOD.note)}</h3>
                  <p dir="auto">{r.note}</p>
                </section>
              )}
              <Evidence report={r} onGone={() => goneRef.current(id)} />
              {r.resolution && (
                <section>
                  <h3>{tx(MOD.resolutionLabel)}</h3>
                  <p>{tx(RESOLUTION[r.resolution])}</p>
                  {r.resolutionNote && <p dir="auto">{r.resolutionNote}</p>}
                  {r.answerText && (
                    <>
                      <h3>{tx(MOD.resolvedAnswer)}</h3>
                      <p dir="auto">{r.answerText}</p>
                    </>
                  )}
                </section>
              )}
              {mayAct && r.status === 'open' && <TakeButton id={r.id} onGone={() => goneRef.current(id)} />}
              {mayAct && (
                <ResolveForm id={r.id} targetKind={r.targetKind} locale={locale} onDone={onClose} onGone={() => goneRef.current(id)} />
              )}
            </div>
          )}
        </QueryBoundary>
      )}
    </Dialog>
  )
}

/** The reported person: name and a localized kind. Tolerates a row without `subject`. */
export function SubjectView({ subject, targetKind, testId }: { subject?: ReportSubject | null; targetKind: Detail['targetKind']; testId: string }) {
  const tx = useCopy()
  return (
    <span data-testid={testId}>
      {subject?.name && <span dir="auto">{subject.name}</span>}
      {subject?.kind && SUBJECT_KIND[subject.kind] && <> ({tx(SUBJECT_KIND[subject.kind])})</>}
      {' · '}
      <span>{tx(targetKind === 'message' ? MOD.targetMessage : MOD.targetPerson)}</span>
    </span>
  )
}

function TakeButton({ id, onGone }: { id: string; onGone: () => void }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const take = useTake()
  const error = take.error instanceof ApiError && !take.error.isNotFound ? take.error : null
  return (
    <div>
      <button type="button" className="btn btn--sm" disabled={take.isPending} onClick={() => take.mutate(id, { onError: (e) => isNotAvailable(e) && onGone() })}>
        {tx(MOD.take)}
      </button>
      {error && (
        <div className="field__error" role="alert">
          {error.code === 'COMM.REPORT_ALREADY_TAKEN' ? tx(MOD.alreadyTaken) : error.localized(locale)}
        </div>
      )}
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function Evidence({ report, onGone }: { report: Detail; onGone: () => void }) {
  const tx = useCopy()
  const { locale, dateTime } = useI18n()
  const ev = report.evidence
  const attachment = useOpenAttachment(report.id, onGone)
  // Child-safety evidence is opened only after a warning (closure plan §3, D-4).
  const [confirming, setConfirming] = useState<EvidenceAttachment | null>(null)
  const warnId = useId()
  const childSafety = report.reason === 'child_safety'
  const attachments = ev?.attachments ?? []
  const error = attachment.error instanceof ApiError ? attachment.error.localized(locale) : null

  function view(a: EvidenceAttachment) {
    if (childSafety) setConfirming(a)
    else void attachment.open(a.index)
  }

  return (
    <section>
      <h3>{tx(MOD.evidence)}</h3>
      {ev ? (
        <div data-testid="evidence">
          {ev.deletedAt && <p>{tx(MOD.evidenceDeleted)}</p>}
          {ev.author?.name && (
            <p>
              {tx(MOD.evidenceAuthor)}: <span dir="auto">{ev.author.name}</span>
            </p>
          )}
          {ev.sentAt && (
            <p>
              {tx(MOD.evidenceSent)}: {dateTime(ev.sentAt)}
            </p>
          )}
          {ev.body && (
            <p dir="auto">
              <strong>{tx(MOD.evidenceBody)}:</strong> {ev.body}
            </p>
          )}
          {attachments.length > 0 && (
            <>
              <p>{tx(MOD.evidenceAttachments, { n: attachments.length })}</p>
              <ul className="mod-attachments">
                {attachments.map((a) => (
                  <li key={a.index}>
                    <span dir="auto">{a.name}</span> <span className="field__hint">({a.mime}, {formatSize(a.size)})</span>{' '}
                    <button
                      type="button"
                      className="btn btn--sm"
                      aria-label={tx(MOD.viewAttachment, { name: a.name })}
                      disabled={attachment.pending !== null}
                      onClick={() => view(a)}
                    >
                      {tx(MOD.view)}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {confirming && (
            <div role="alertdialog" aria-labelledby={`${warnId}-t`} aria-describedby={`${warnId}-b`} className="mod-warn">
              <strong id={`${warnId}-t`}>{tx(MOD.childSafetyWarnTitle)}</strong>
              <p id={`${warnId}-b`}>{tx(MOD.childSafetyWarnBody)}</p>
              <div className="mod-actions">
                <button
                  type="button"
                  className="btn btn--sm btn--danger"
                  onClick={() => {
                    const a = confirming
                    setConfirming(null)
                    void attachment.open(a.index)
                  }}
                >
                  {tx(MOD.childSafetyContinue)}
                </button>
                <button type="button" className="btn btn--sm" onClick={() => setConfirming(null)}>
                  {tx(MOD.cancel)}
                </button>
              </div>
            </div>
          )}
          {error && (
            <div className="field__error" role="alert">
              {error}
            </div>
          )}
        </div>
      ) : (
        <p>{tx(MOD.noEvidence)}</p>
      )}
    </section>
  )
}

function ResolveForm({
  id,
  targetKind,
  locale,
  onDone,
  onGone,
}: {
  id: string
  targetKind: Detail['targetKind']
  locale: 'ar' | 'en'
  onDone: () => void
  onGone: () => void
}) {
  const tx = useCopy()
  const fid = useId()
  const resolve = useResolve(id)
  const [resolution, setResolution] = useState<Resolution>('no_action')
  const [note, setNote] = useState('')
  const [answer, setAnswer] = useState('')
  const [missing, setMissing] = useState<'answer' | 'note' | null>(null)
  // One key per opened form: a retry after a timeout is the same submit.
  const key = useRef(newIdempotencyKey())
  // Removing a message only applies to a message report (the server answers 400 otherwise).
  const options = RESOLUTIONS.filter((v) => v !== 'message_removed' || targetKind === 'message').map((v) => ({ value: v, label: tx(RESOLUTION[v]) }))
  const noteRequired = NOTE_REQUIRED.includes(resolution)
  const error = resolve.error instanceof ApiError && !resolve.error.isNotFound ? resolve.error : null
  const errorText = error
    ? error.code === 'COMM.REPORT_CLOSED'
      ? tx(MOD.closedAlready)
      : error.isForbidden && resolve.variables?.resolution === 'account_suspended'
        ? tx(MOD.noSuspendPermission)
        : error.localized(locale)
    : null

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const text = answer.trim()
    const noteText = note.trim()
    if (text === '') {
      setMissing('answer')
      return
    }
    if (noteRequired && noteText === '') {
      setMissing('note')
      return
    }
    setMissing(null)
    resolve.mutate(
      { resolution, note: noteText === '' ? undefined : noteText, answer: text, key: key.current },
      { onSuccess: onDone, onError: (err) => isNotAvailable(err) && onGone() },
    )
  }

  return (
    <form onSubmit={submit} aria-label={tx(MOD.resolve)}>
      <label className="field" htmlFor={`${fid}-res`}>
        <span className="field__label">{tx(MOD.resolutionLabel)}</span>
        <SearchableSelect id={`${fid}-res`} value={resolution} onValueChange={(v) => setResolution(v as Resolution)} options={options} clearable={false} />
        <span className="field__hint" data-testid="resolution-help">
          {tx(RESOLUTION_HELP[resolution])}
        </span>
      </label>
      <label className="field">
        <span className="field__label">{tx(noteRequired ? MOD.resolutionNoteRequired : MOD.resolutionNote)}</span>
        <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} dir="auto" aria-required={noteRequired} />
      </label>
      {missing === 'note' && (
        <div className="field__error" role="alert">
          {tx(MOD.noteRequired)}
        </div>
      )}
      <label className="field">
        <span className="field__label">{tx(MOD.answerLabel)}</span>
        <textarea className="textarea" value={answer} maxLength={ANSWER_MAX} onChange={(e) => setAnswer(e.target.value)} dir="auto" aria-required="true" />
        <span className="field__hint">{tx(MOD.answerHint)}</span>
      </label>
      {missing === 'answer' && (
        <div className="field__error" role="alert">
          {tx(MOD.answerRequired)}
        </div>
      )}
      {errorText && (
        <div className="field__error" role="alert">
          {errorText}
        </div>
      )}
      <button type="submit" className="btn btn--primary" disabled={resolve.isPending}>
        {tx(MOD.submitResolve)}
      </button>
    </form>
  )
}
