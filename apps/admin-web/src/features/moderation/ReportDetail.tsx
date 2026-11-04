import { useId, useRef, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ApiError } from '@/core/api/errors'
import { newIdempotencyKey } from '@/core/api/client'
import { Dialog } from '@/shared/components/Dialog'
import { QueryBoundary } from '@/shared/components/States'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import { RESOLUTIONS, ANSWER_MAX, type Resolution } from './api'
import { MOD, REASON, RESOLUTION, STATUS, useCopy } from './copy'
import { useReport, useResolve } from './hooks'

/**
 * One report with its evidence. Evidence is the server's (moderation.view) and
 * every open of this sheet is audited server-side, so it is fetched only here.
 * Resolving needs an answer for the reporter (§5.2: "responded" means the
 * reporter was answered). Nothing about who reported is shown (§5.5).
 */
export function ReportDetail({ id, canAct, onClose }: { id: string; canAct: boolean; onClose: () => void }) {
  const tx = useCopy()
  const { locale, dateTime } = useI18n()
  const q = useReport(id)
  const r = q.data
  const open = r !== undefined && (r.status === 'open' || r.status === 'in_review')
  return (
    <Dialog title={tx(MOD.detailTitle)} onClose={onClose} variant="sheet">
      <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
        {r && (
          <div>
            <p className="field__hint">{tx(MOD.detailAudited)}</p>
            <dl className="sa-fixed">
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
            <section>
              <h3>{tx(MOD.evidence)}</h3>
              {r.evidence ? (
                <div data-testid="evidence">
                  {r.evidence.deletedAt && <p>{tx(MOD.evidenceDeleted)}</p>}
                  {r.evidence.author?.name && (
                    <p>
                      {tx(MOD.evidenceAuthor)}: <span dir="auto">{r.evidence.author.name}</span>
                    </p>
                  )}
                  {r.evidence.sentAt && (
                    <p>
                      {tx(MOD.evidenceSent)}: {dateTime(r.evidence.sentAt)}
                    </p>
                  )}
                  {r.evidence.body && (
                    <p dir="auto">
                      <strong>{tx(MOD.evidenceBody)}:</strong> {r.evidence.body}
                    </p>
                  )}
                  {r.evidence.attachments && r.evidence.attachments.length > 0 && <p>{tx(MOD.evidenceAttachments, { n: r.evidence.attachments.length })}</p>}
                </div>
              ) : (
                <p>{tx(MOD.noEvidence)}</p>
              )}
            </section>
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
            {canAct && open && <ResolveForm id={r.id} locale={locale} onDone={onClose} />}
          </div>
        )}
      </QueryBoundary>
    </Dialog>
  )
}

function ResolveForm({ id, locale, onDone }: { id: string; locale: 'ar' | 'en'; onDone: () => void }) {
  const tx = useCopy()
  const fid = useId()
  const resolve = useResolve(id)
  const [resolution, setResolution] = useState<Resolution>('no_action')
  const [note, setNote] = useState('')
  const [answer, setAnswer] = useState('')
  const [missing, setMissing] = useState(false)
  // One key per opened form: a retry after a timeout is the same submit.
  const key = useRef(newIdempotencyKey())
  const options = RESOLUTIONS.map((v) => ({ value: v, label: tx(RESOLUTION[v]) }))
  const error = resolve.error instanceof ApiError ? resolve.error : null
  const errorText = error
    ? error.code === 'COMM.REPORT_CLOSED'
      ? tx(MOD.closedAlready)
      : error.localized(locale)
    : null

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const text = answer.trim()
    if (text === '') {
      setMissing(true)
      return
    }
    setMissing(false)
    resolve.mutate(
      { resolution, note: note.trim() === '' ? undefined : note.trim(), answer: text, key: key.current },
      { onSuccess: onDone },
    )
  }

  return (
    <form onSubmit={submit} aria-label={tx(MOD.resolve)}>
      <label className="field" htmlFor={`${fid}-res`}>
        <span className="field__label">{tx(MOD.resolutionLabel)}</span>
        <SearchableSelect id={`${fid}-res`} value={resolution} onValueChange={(v) => setResolution(v as Resolution)} options={options} clearable={false} />
      </label>
      <label className="field">
        <span className="field__label">{tx(MOD.resolutionNote)}</span>
        <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <label className="field">
        <span className="field__label">{tx(MOD.answerLabel)}</span>
        <textarea className="textarea" value={answer} maxLength={ANSWER_MAX} onChange={(e) => setAnswer(e.target.value)} dir="auto" aria-required="true" />
        <span className="field__hint">{tx(MOD.answerHint)}</span>
      </label>
      {missing && (
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
