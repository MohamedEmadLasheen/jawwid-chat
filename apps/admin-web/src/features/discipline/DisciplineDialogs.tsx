import { useId, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ApiError } from '@/core/api/errors'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { opsApi } from '@/features/teachers/opsApi'
import { useRoster } from '@/features/teachers/opsHooks'
import { LADDER, type Decision, type Violation } from './api'
import { D, DECISION_LABEL, describeError, useCopy } from './copy'
import { useDecide, useRecordLateness } from './hooks'

const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function ServerError({ error }: { error: unknown }) {
  const { locale } = useI18n()
  if (!error) return null
  return (
    <div className="banner banner--danger" role="alert">
      {describeError(error, locale)}
    </div>
  )
}

/**
 * One decision on one violation. The suggestion is preselected; anything else
 * (or excusing) asks for a reason, as the server will. A suspension asks for
 * its dates, and -- when the server answers that open lessons fall inside --
 * for an explicit confirmation before it sends again.
 */
export function DecideDialog({ violation, onClose }: { violation: Violation; onClose: () => void }) {
  const tx = useCopy()
  const decide = useDecide()
  const noteId = useId()
  const [decision, setDecision] = useState<Decision>(violation.suggestedDecision)
  const [note, setNote] = useState('')
  const [startsOn, setStartsOn] = useState(() => localDay(new Date()))
  const [endsOn, setEndsOn] = useState(() => localDay(new Date(Date.now() + 6 * 86_400_000)))
  const [collides, setCollides] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [touched, setTouched] = useState(false)
  const [leftOpen, setLeftOpen] = useState<number | null>(null)
  const reasonNeeded = decision === 'excused' || decision !== violation.suggestedDecision
  const missingReason = reasonNeeded && !note.trim()

  const submit = () => {
    if (leftOpen !== null) return onClose()
    setTouched(true)
    if (missingReason || (collides && !confirmed)) return
    decide.mutate(
      {
        violationId: violation.id,
        body: {
          decision,
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(decision === 'temporary_suspension' ? { startsOn, endsOn } : {}),
          ...(collides && confirmed ? { cancelCollidingLessons: true } : {}),
        },
      },
      {
        onSuccess: (res) => (res.notCancelled.length > 0 ? setLeftOpen(res.notCancelled.length) : onClose()),
        onError: (e) => {
          if (e instanceof ApiError && e.code === 'COMM.DISCIPLINE_LESSONS_COLLIDE') setCollides(true)
        },
      },
    )
  }

  return (
    <Dialog
      title={tx(D.decideTitle, { teacher: violation.teacher.name ?? '' })}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button
            type="button"
            className={decision.endsWith('suspension') ? 'btn btn--danger' : 'btn btn--primary'}
            disabled={decide.isPending}
            onClick={submit}
          >
            {decide.isPending ? tx(D.saving) : tx(D.save)}
          </button>
        </>
      }
    >
      {leftOpen !== null && (
        <div className="banner banner--warn" role="status">
          {tx(D.notCancelled, { n: leftOpen })}
        </div>
      )}
      <p className="field__hint">{tx(D.decideHint, { n: violation.step })}</p>
      <fieldset className="dc-options">
        <legend className="field__label">{tx(D.outcome)}</legend>
        {[...LADDER, 'excused' as const].map((d) => (
          <label key={d} className="dc-option">
            <input
              type="radio"
              name="decision"
              checked={decision === d}
              onChange={() => {
                setDecision(d)
                setCollides(false)
                setConfirmed(false)
              }}
            />
            {tx(DECISION_LABEL[d])}
            {d === violation.suggestedDecision && <span className="dc-muted">({tx(D.suggestedTag)})</span>}
          </label>
        ))}
      </fieldset>
      {(decision === 'deduction_1' || decision === 'deduction_2') && <p className="field__hint">{tx(D.deductionHint)}</p>}
      {decision === 'temporary_suspension' && (
        <>
          <p className="field__hint">{tx(D.temporaryHint)}</p>
          <div className="dc-dates">
            <label className="field">
              <span className="field__label">{tx(D.startsOn)}</span>
              <input className="input" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
            </label>
            <label className="field">
              <span className="field__label">{tx(D.endsOn)}</span>
              <input className="input" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
            </label>
          </div>
        </>
      )}
      {decision === 'permanent_suspension' && <p className="field__hint">{tx(D.permanentHint)}</p>}
      {collides && (
        <div className="field">
          <p className="field__hint">{tx(D.collide)}</p>
          <label className="dc-check">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            {tx(D.confirmCancel)}
          </label>
        </div>
      )}
      <div className="field">
        <label className="field__label" htmlFor={noteId}>
          {tx(reasonNeeded ? D.reason : D.reasonOptional)}
        </label>
        <textarea
          id={noteId}
          className="input dc-textarea"
          value={note}
          dir="auto"
          rows={3}
          maxLength={1000}
          onChange={(e) => setNote(e.target.value)}
          aria-invalid={touched && missingReason}
        />
        {touched && missingReason && <span className="field__error">{tx(D.reasonRequired)}</span>}
      </div>
      {!(decide.error instanceof ApiError && decide.error.code === 'COMM.DISCIPLINE_LESSONS_COLLIDE') && <ServerError error={decide.error} />}
    </Dialog>
  )
}

/** Lateness on a held lesson: pick the teacher, then one of their held lessons of the last two weeks. */
export function LatenessDialog({ onClose }: { onClose: () => void }) {
  const tx = useCopy()
  const { dateTime } = useI18n()
  const record = useRecordLateness()
  const roster = useRoster()
  const teacherId = useId()
  const lessonId = useId()
  const minutesId = useId()
  const noteId = useId()
  const [teacher, setTeacher] = useState('')
  const [lesson, setLesson] = useState('')
  const [minutes, setMinutes] = useState('')
  const [note, setNote] = useState('')
  const [touched, setTouched] = useState(false)
  const window = useMemo(() => ({ from: new Date(Date.now() - 14 * 86_400_000).toISOString(), to: new Date().toISOString() }), [])
  const lessons = useQuery({
    queryKey: ['lessons', 'held', teacher, window.from],
    queryFn: () => opsApi.lessons({ teacherId: teacher, ...window }),
    enabled: teacher !== '',
  })
  const held = (lessons.data?.lessons ?? []).filter((l) => l.outcome === 'held').reverse()
  const parsed = /^\d{1,3}$/.test(minutes.trim()) ? Number(minutes.trim()) : NaN
  const minutesInvalid = !Number.isInteger(parsed) || parsed < 1 || parsed > 240

  return (
    <Dialog
      title={tx(D.latenessTitle)}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button
            type="button"
            className="btn btn--primary"
            disabled={record.isPending}
            onClick={() => {
              setTouched(true)
              if (!lesson || minutesInvalid) return
              record.mutate({ lessonId: lesson, minutes: parsed, ...(note.trim() ? { note: note.trim() } : {}) }, { onSuccess: onClose })
            }}
          >
            {record.isPending ? tx(D.saving) : tx(D.save)}
          </button>
        </>
      }
    >
      <p className="field__hint">{tx(D.latenessHint)}</p>
      <div className="field">
        <label className="field__label" htmlFor={teacherId}>
          {tx(D.teacher)}
        </label>
        <select
          id={teacherId}
          className="input"
          value={teacher}
          onChange={(e) => {
            setTeacher(e.target.value)
            setLesson('')
          }}
        >
          <option value="">{tx(D.chooseTeacher)}</option>
          {(roster.data?.teachers ?? [])
            .filter((t) => t.isActive)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </select>
      </div>
      {teacher && (
        <div className="field">
          <label className="field__label" htmlFor={lessonId}>
            {tx(D.lesson)}
          </label>
          {held.length === 0 && !lessons.isLoading ? (
            <p className="dc-muted">{tx(D.noHeld)}</p>
          ) : (
            <select id={lessonId} className="input" value={lesson} onChange={(e) => setLesson(e.target.value)}>
              <option value="">{tx(D.chooseLesson)}</option>
              {held.map((l) => (
                <option key={l.id} value={l.id}>
                  {`${l.learner.name} — ${dateTime(l.startsAt)}`}
                </option>
              ))}
            </select>
          )}
          {touched && !lesson && <span className="field__error">{tx(D.required)}</span>}
        </div>
      )}
      <div className="field">
        <label className="field__label" htmlFor={minutesId}>
          {tx(D.minutes)}
        </label>
        <input id={minutesId} className="input" inputMode="numeric" dir="ltr" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        {touched && minutesInvalid && <span className="field__error">{tx(D.minutesInvalid)}</span>}
      </div>
      <div className="field">
        <label className="field__label" htmlFor={noteId}>
          {tx(D.reasonOptional)}
        </label>
        <textarea id={noteId} className="input dc-textarea" value={note} dir="auto" rows={2} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
      </div>
      <ServerError error={record.error} />
    </Dialog>
  )
}
