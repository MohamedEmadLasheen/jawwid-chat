import { useId, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { academyWallClockToIso, isoToAcademyWallClock } from '@/core/time/academyTime'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { LoadingState } from '@/shared/components/States'
import type { Cover, EligibleBackup } from './api'
import { T, describeError, useCopy } from './copy'
import { useCoverPreview, useStartCover } from './hooks'

const DAY = 86_400_000

/** The last minute of a calendar day in the academy's zone: "until 3 Nov" means through 3 Nov. */
function endOfAcademyDay(date: string): string | null {
  return academyWallClockToIso(date, '23:59')
}

function academyDatePlus(days: number): string {
  return isoToAcademyWallClock(new Date(Date.now() + days * DAY).toISOString()).date
}

/**
 * PD-33 "Hand over to backup": one form, one confirm screen, done.
 *
 * The backup is pre-filled with the supervisor's linked backup and can only be
 * changed to another backup supervisor of the same department; one who cannot
 * cover now (inactive, away, already at the limit) is listed but disabled, with
 * the reason. The confirm screen states what moves ("12 families, 9 groups, 4
 * open items move to Amira until 3 Nov"). The server decides every request
 * again (SupervisorCoverService, and the database trigger behind it).
 */
export function HandOverDialog({
  supervisor,
  onClose,
  onDone,
}: {
  supervisor: { id: string; name: string }
  onClose: () => void
  onDone?: (cover: Cover) => void
}) {
  const tx = useCopy()
  const { locale, date } = useI18n()
  const id = useId()
  const [backupId, setBackupId] = useState('')
  const preview = useCoverPreview(supervisor.id, backupId)
  const start = useStartCover()
  const [step, setStep] = useState<'form' | 'confirm' | 'done'>('form')
  const [later, setLater] = useState(false)
  const [from, setFrom] = useState(academyDatePlus(1))
  const [until, setUntil] = useState(academyDatePlus(7))
  const [note, setNote] = useState('')
  const [touched, setTouched] = useState(false)
  const [result, setResult] = useState<Cover | null>(null)

  const data = preview.data
  const chosen: EligibleBackup | undefined =
    data?.eligibleBackups.find((b) => b.id === (backupId || data.backup?.id)) ?? undefined
  const maxDays = data?.maxDays ?? 30
  const fromIso = later ? academyWallClockToIso(from, '00:00') : null
  const untilIso = endOfAcademyDay(until)
  const startMs = fromIso ? new Date(fromIso).getTime() : Date.now()
  const untilOk = !!untilIso && new Date(untilIso).getTime() > startMs && new Date(untilIso).getTime() - startMs <= maxDays * DAY
  const blockedText = (b: EligibleBackup) =>
    b.blocked === 'inactive'
      ? tx(T.blockedInactive)
      : b.blocked === 'away'
        ? tx(T.blockedAway)
        : b.blocked === 'at_limit'
          ? tx(T.blockedAtLimit, { n: b.covering })
          : b.blocked === 'not_linked'
            ? tx(T.blockedNotLinked)
            : ''

  const review = () => {
    setTouched(true)
    if (!chosen || chosen.blocked || !untilOk) return
    setStep('confirm')
  }

  const submit = async () => {
    if (!chosen || !untilIso) return
    try {
      const cover = await start.mutateAsync({
        supervisorId: supervisor.id,
        backupId: chosen.id,
        until: untilIso,
        ...(fromIso ? { from: fromIso } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      })
      setResult(cover)
      setStep('done')
      onDone?.(cover)
    } catch {
      /* shown below from start.error */
    }
  }

  const title = step === 'confirm' ? tx(T.confirmTitle) : tx(T.handOverTitle, { name: supervisor.name })
  const footer =
    step === 'form' ? (
      <>
        <DialogCancelButton onClick={onClose} />
        <button type="button" className="btn btn--primary" disabled={!data || !!data.openCover} onClick={review}>
          {tx(T.review)}
        </button>
      </>
    ) : step === 'confirm' ? (
      <>
        <button type="button" className="btn" onClick={() => setStep('form')} disabled={start.isPending}>
          {tx(T.back)}
        </button>
        <button type="button" className="btn btn--primary" onClick={() => void submit()} disabled={start.isPending}>
          {start.isPending ? tx(T.saving) : tx(T.confirm)}
        </button>
      </>
    ) : (
      <button type="button" className="btn btn--primary" onClick={onClose}>
        OK
      </button>
    )

  return (
    <Dialog title={title} onClose={onClose} footer={footer}>
      {!data ? (
        preview.error ? (
          <div className="banner banner--danger" role="alert">{describeError(preview.error, locale)}</div>
        ) : (
          <LoadingState />
        )
      ) : step === 'form' ? (
        <div className="handover">
          <p className="ts-muted">{tx(T.handOverHint, { name: supervisor.name })}</p>
          {data.openCover ? (
            <div className="banner banner--warn" role="status">
              {tx(T.alreadyAway, { name: supervisor.name, backup: data.openCover.backup.name, date: date(data.openCover.endsAt) })}
            </div>
          ) : data.eligibleBackups.every((b) => b.blocked) ? (
            <div className="banner banner--warn" role="status">{tx(T.noBackup)}</div>
          ) : null}
          <div className="field">
            <label className="field__label" htmlFor={`${id}-backup`}>{tx(T.backupField)}</label>
            <select
              id={`${id}-backup`}
              className="select"
              value={chosen?.id ?? ''}
              onChange={(e) => setBackupId(e.target.value)}
              aria-invalid={touched && (!chosen || !!chosen.blocked)}
            >
              {data.eligibleBackups.map((b) => (
                <option key={b.id} value={b.id} disabled={!!b.blocked}>
                  {b.name}
                  {b.linked ? ` · ${tx(T.linkedBackup)}` : ''}
                  {b.blocked ? ` — ${blockedText(b)}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <span className="field__label" id={`${id}-from-l`}>{tx(T.fromField)}</span>
            <div className="handover__choices" role="radiogroup" aria-labelledby={`${id}-from-l`}>
              <label className="handover__choice">
                <input type="radio" name={`${id}-from`} checked={!later} onChange={() => setLater(false)} /> {tx(T.fromNow)}
              </label>
              <label className="handover__choice">
                <input type="radio" name={`${id}-from`} checked={later} onChange={() => setLater(true)} /> {tx(T.fromLater)}
              </label>
              {later && (
                <input
                  type="date"
                  className="input handover__date"
                  aria-label={tx(T.fromField)}
                  value={from}
                  min={academyDatePlus(0)}
                  onChange={(e) => setFrom(e.target.value)}
                />
              )}
            </div>
          </div>
          <div className="field">
            <label className="field__label" htmlFor={`${id}-until`}>{tx(T.untilField, { n: maxDays })}</label>
            <div className="handover__choices">
              <input
                id={`${id}-until`}
                type="date"
                className="input handover__date"
                value={until}
                min={academyDatePlus(0)}
                onChange={(e) => setUntil(e.target.value)}
                aria-invalid={touched && !untilOk}
              />
              {[
                [3, T.quick3],
                [7, T.quick7],
                [14, T.quick14],
              ].map(([n, label]) => (
                <button key={String(n)} type="button" className="btn btn--sm btn--ghost" onClick={() => setUntil(academyDatePlus(n as number))}>
                  {tx(label as typeof T.quick3)}
                </button>
              ))}
            </div>
            {touched && !untilOk && <span className="field__error">{tx(T.untilInvalid, { n: maxDays })}</span>}
          </div>
          <div className="field">
            <label className="field__label" htmlFor={`${id}-note`}>{tx(T.noteField)}</label>
            <input id={`${id}-note`} className="input" dir="auto" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
      ) : step === 'confirm' ? (
        <div className="handover" data-testid="handover-summary">
          <p className="handover__summary" dir="auto">
            {tx(T.summary, {
              families: data.counts.families,
              groups: data.counts.groups,
              items: data.counts.openItems.total,
              backup: chosen?.name ?? '',
              date: untilIso ? date(untilIso) : '',
            })}
          </p>
          <p className="ts-muted" dir="auto">
            {tx(T.summaryDetail, {
              directs: data.counts.directs,
              approvals: data.counts.openItems.approvals,
              instalments: data.counts.openItems.instalments,
              newStudents: data.counts.openItems.newStudents,
            })}
          </p>
          <p className="ts-muted" dir="auto">{tx(T.summaryKeep, { name: supervisor.name, backup: chosen?.name ?? '' })}</p>
          {note.trim() && <p dir="auto">“{note.trim()}”</p>}
          {start.error ? <div className="banner banner--danger" role="alert">{describeError(start.error, locale)}</div> : null}
        </div>
      ) : (
        <div className="banner banner--ok" role="status">
          {tx(T.handedOver, { backup: result?.backup.name ?? '', date: result ? date(result.endsAt) : '' })}
        </div>
      )}
    </Dialog>
  )
}
