import { useId, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge } from '@/shared/components/Badge'
import { Dialog } from '@/shared/components/Dialog'
import { MARK_STATUSES, type MarkStatus, type ProgressSurah } from './api'
import { M, MARK_LABEL, SOURCE_LABEL, describeError, useCopy } from './copy'
import { useCorrectSurah, useProgress, useSurahHistory } from './hooks'
import './materials.css'

/**
 * PD-29: a child's memorization map on the Student Profile -- the 114 surahs
 * grouped by the juz' each starts in, coloured by status, filled from lesson
 * reports. Clicking a surah shows its history; staff in the child's PD-8 scope
 * (the server's `canCorrect`) add a correction with a reason. Nothing is
 * overwritten: a correction is one more entry in the history.
 *
 * A viewer the server refuses sees nothing: the panel hides itself.
 */
export function ProgressMapPanel({ learnerId }: { learnerId: string }) {
  const tx = useCopy()
  const { locale } = useI18n()
  const map = useProgress(learnerId)
  const [open, setOpen] = useState<ProgressSurah | null>(null)
  const headingId = useId()
  if (map.error || !map.data) return null
  const name = (s: { nameAr: string; nameEn: string }) => (locale === 'ar' ? s.nameAr : s.nameEn)
  const { counts } = map.data
  return (
    <section className="card panel tf-section mt-map" aria-labelledby={headingId}>
      <div className="tf-section__head">
        <h2 id={headingId} className="tf-section__title">
          {tx(M.progressTitle)}
        </h2>
      </div>
      <p className="field__hint">{tx(M.progressHint)}</p>
      <div className="mt-counts">
        {(['memorized', 'in_progress', 'needs_revision', 'not_started'] as const).map((s) => (
          <Badge key={s} tone={s === 'memorized' ? 'ok' : s === 'needs_revision' ? 'warn' : s === 'in_progress' ? 'info' : 'outline'}>
            {tx(MARK_LABEL[s])}: {counts[s]}
          </Badge>
        ))}
      </div>
      <div className="mt-juz-grid">
      {/* Juz' 30 first: memorization usually starts from Juz' Amma and works back. */}
      {[...map.data.juz].reverse().map((j) => (
        <div key={j.juz} className="mt-juz">
          <h4>{tx(M.juz, { n: j.juz })}</h4>
          <ul className="mt-surahs">
            {j.surahs.map((s) => (
              <li key={s.number}>
                <button
                  type="button"
                  className={`mt-surah mt-surah--${s.status}`}
                  aria-label={`${s.number}. ${name(s)} — ${tx(MARK_LABEL[s.status])}`}
                  onClick={() => setOpen(s)}
                >
                  {s.number}. {name(s)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      </div>
      {open && <SurahDialog learnerId={learnerId} surah={open} canCorrect={map.data.canCorrect} onClose={() => setOpen(null)} />}
    </section>
  )
}

function SurahDialog({ learnerId, surah, canCorrect, onClose }: { learnerId: string; surah: ProgressSurah; canCorrect: boolean; onClose: () => void }) {
  const tx = useCopy()
  const { locale, dateTime } = useI18n()
  const history = useSurahHistory(learnerId, surah.number)
  const correct = useCorrectSurah(learnerId)
  const [status, setStatus] = useState<MarkStatus>(surah.status)
  const [reason, setReason] = useState('')
  const statusId = useId()
  const reasonId = useId()
  const title = `${surah.number}. ${locale === 'ar' ? surah.nameAr : surah.nameEn}`
  return (
    <Dialog title={title} onClose={onClose} variant="sheet">
      <h3 className="mt-subhead">{tx(M.history)}</h3>
      {history.data && history.data.marks.length === 0 && <p className="field__hint">{tx(M.noHistory)}</p>}
      <ul className="mt-history">
        {history.data?.marks.map((m) => (
          <li key={m.id}>
            <Badge tone={m.status === 'memorized' ? 'ok' : m.status === 'needs_revision' ? 'warn' : 'outline'}>{tx(MARK_LABEL[m.status])}</Badge>{' '}
            <span>{tx(SOURCE_LABEL[m.source])}</span> · <span>{m.by.name ?? tx(m.by.kind === 'teacher' ? M.byTeacher : M.byStaff)}</span> ·{' '}
            <time dateTime={m.at}>{dateTime(m.at)}</time>
            {m.reason && (
              <div className="field__hint" dir="auto">
                {m.reason}
              </div>
            )}
          </li>
        ))}
      </ul>
      {canCorrect && (
        <form
          className="mt-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (!reason.trim()) return
            correct.mutate({ surah: surah.number, status, reason: reason.trim() }, { onSuccess: () => setReason('') })
          }}
        >
          <h3 className="mt-subhead">{tx(M.correct)}</h3>
          <div className="field">
            <label className="field__label" htmlFor={statusId}>
              {tx(M.newStatus)}
            </label>
            <select id={statusId} className="select" value={status} onChange={(e) => setStatus(e.target.value as MarkStatus)}>
              {MARK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {tx(MARK_LABEL[s])}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor={reasonId}>
              {tx(M.reason)}
            </label>
            <textarea id={reasonId} className="input mt-textarea" dir="auto" value={reason} onChange={(e) => setReason(e.target.value)} required />
            <span className="field__hint">{tx(M.reasonHint)}</span>
          </div>
          {correct.error ? (
            <div className="banner banner--danger" role="alert">
              {describeError(correct.error, locale)}
            </div>
          ) : null}
          <div>
            <button type="submit" className="btn btn--primary" disabled={!reason.trim() || correct.isPending}>
              {tx(M.correct)}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  )
}
