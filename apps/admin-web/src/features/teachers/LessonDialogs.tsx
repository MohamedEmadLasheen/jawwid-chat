import { useId, useState, type ReactNode } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ApiError } from '@/core/api/errors'
import { ACADEMY_ZONE, whenIn } from '@/core/time/academyTime'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { QueryBoundary } from '@/shared/components/States'
import { SlotPicker, type LockReason } from '@/shared/components/SlotPicker'
import type { Pair } from './copy'
import { opsApi, type BlockedOccurrence, type LessonDto, type MoveRefusal } from './opsApi'
import { O, describeOpsError, fill, formatMinutes } from './opsCopy'
import { useBlockedSlots, useFreeSlots, useMoveSlots, useOp, useUpcomingLessons } from './opsHooks'
import './teachers.css'

function useTx() {
  const { locale } = useI18n()
  return (p: Pair) => (locale === 'ar' ? p.ar : p.en)
}

/** "Mon 27 Oct 17:00" on the academy's clock. */
function when(iso: string, locale: 'ar' | 'en'): string {
  return whenIn(iso, ACADEMY_ZONE, locale)
}

/** A 409 on a pick means the time was taken in between: say so, and offer fresh times. */
function isTaken(e: unknown): boolean {
  return e instanceof ApiError && (e.code === 'COMM.LESSON_TEACHER_BUSY' || (e.isConflict && e.messageEn !== 'locked'))
}

/**
 * One free time, picked from what the server offered, then confirmed against
 * its summary ("Mon 27 Oct 17:00 → Wed 29 Oct 18:30"). The server re-checks;
 * if the time was just taken, the times are reloaded and that is said.
 */
function PickOne({
  slots,
  locked,
  loading,
  from,
  minutes,
  saveLabel,
  onSave,
  onDone,
  onRefresh,
  footerStart,
}: {
  slots: string[]
  locked: LockReason
  loading: boolean
  /** The current start, for a move's "previous → new". */
  from?: string
  minutes: number
  saveLabel: string
  onSave: (startsAt: string) => Promise<unknown>
  onDone: () => void
  onRefresh: () => void
  footerStart: ReactNode
}) {
  const tx = useTx()
  const { locale } = useI18n()
  const [pick, setPick] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [taken, setTaken] = useState(false)
  const [tried, setTried] = useState(false)
  const chosen = pick && slots.includes(pick) ? pick : null

  const submit = async () => {
    setTried(true)
    if (!chosen || pending || locked) return
    setPending(true)
    setError(null)
    setTaken(false)
    try {
      await onSave(chosen)
      onDone()
    } catch (e) {
      if (isTaken(e)) {
        setTaken(true)
        setPick(null)
        onRefresh()
      } else setError(e)
      setPending(false)
    }
  }

  return (
    <>
      <SlotPicker slots={slots} value={chosen} onChange={(iso) => { setPick(iso); setTaken(false) }} label={tx(O.freeTime)} locked={locked} loading={loading} />
      {chosen && (
        <p className="ts-summary" data-testid="pick-summary">
          <strong>
            {from
              ? fill(tx(O.summaryMove), { from: when(from, locale), to: when(chosen, locale) })
              : `${when(chosen, locale)} · ${formatMinutes(minutes, locale)}`}
          </strong>
        </p>
      )}
      {taken && <div className="banner banner--warn" role="alert">{tx(O.justTaken)}</div>}
      {tried && !chosen && !taken && !locked && <p className="field__error" role="alert">{tx(O.chooseTimeFirst)}</p>}
      {error !== null && <div className="banner banner--danger" role="alert">{describeOpsError(error, locale)}</div>}
      <div className="dialog__actions">
        {footerStart}
        <button type="button" className="btn btn--primary" disabled={pending || !!locked} onClick={() => void submit()}>
          {pending ? tx(O.saving) : saveLabel}
        </button>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Add a lesson (one-off)
// ---------------------------------------------------------------------------

/** PD-31: one extra lesson at one of the teacher's free times (GET /learners/:id/free-slots). */
export function AddLessonDialog({
  learner,
  defaultMinutes,
  onClose,
}: {
  learner: { id: string; name: string }
  defaultMinutes: number
  onClose: () => void
}) {
  const tx = useTx()
  const base = useId()
  const [minutesText, setMinutesText] = useState(String(defaultMinutes))
  const minutes = Number(minutesText)
  const minutesOk = Number.isInteger(minutes) && minutes >= 15 && minutes <= 240
  const q = useFreeSlots(learner.id, minutesOk ? minutes : 0)
  const op = useOp((startsAt: string) =>
    opsApi.schedule({
      learnerId: learner.id,
      startsAt,
      endsAt: new Date(new Date(startsAt).getTime() + minutes * 60_000).toISOString(),
    }),
  )
  return (
    <Dialog title={fill(tx(O.addLessonTitle), { name: learner.name })} onClose={onClose}>
      <p className="ts-muted">{tx(O.addLessonHint)}</p>
      <div className="field ts-inline">
        <label className="field__label" htmlFor={`${base}-min`}>{tx(O.minutes)}</label>
        <input
          id={`${base}-min`}
          className="input ts-narrow"
          type="number"
          min={15}
          max={240}
          step={5}
          dir="ltr"
          value={minutesText}
          aria-invalid={!minutesOk}
          onChange={(e) => setMinutesText(e.target.value)}
        />
      </div>
      <QueryBoundary isLoading={false} error={q.error} onRetry={() => void q.refetch()}>
        <PickOne
          slots={q.data?.slots ?? []}
          locked={q.data?.locked ?? null}
          loading={minutesOk && q.isLoading}
          minutes={minutes}
          saveLabel={tx(O.addLessonSave)}
          onSave={(startsAt) => op.mutateAsync(startsAt)}
          onDone={onClose}
          onRefresh={() => void q.refetch()}
          footerStart={<DialogCancelButton onClick={onClose} />}
        />
      </QueryBoundary>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// A learner's lessons, and moving one
// ---------------------------------------------------------------------------

const REFUSAL: Record<MoveRefusal, Pair> = {
  started: O.refusalStarted,
  not_movable: O.refusalNotMovable,
  family_already_moved: O.refusalFamilyMoved,
  family_monthly_limit: O.refusalFamilyLimit,
  too_late: O.refusalTooLate,
}

const KIND: Record<string, Pair> = { regular: O.regular, makeup: O.makeup, trial: O.trial }

/** A lesson that has not started and was not moved away may be offered "Move"; the server decides. */
function movable(l: LessonDto, now: number): boolean {
  return l.phase === 'upcoming' && !l.outcome && !l.movedTo && new Date(l.startsAt).getTime() > now
}

/**
 * PD-31: the next four weeks of a learner's lessons (GET /lessons?learnerId=),
 * each open future one with "Move": its free times (GET /lessons/:id/move-slots),
 * the summary, then POST /lessons/:id/move. Only that lesson moves.
 */
export function LessonsDialog({ learner, onClose }: { learner: { id: string; name: string }; onClose: () => void }) {
  const tx = useTx()
  const { locale } = useI18n()
  const q = useUpcomingLessons(learner.id)
  const [moving, setMoving] = useState<LessonDto | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const now = Date.now()
  const lessons = [...(q.data?.lessons ?? [])].sort((a, b) => a.startsAt.localeCompare(b.startsAt))

  if (moving) {
    return (
      <Dialog title={fill(tx(O.moveTitle), { name: learner.name })} onClose={onClose}>
        <MoveLesson
          lesson={moving}
          onBack={() => setMoving(null)}
          onDone={(to) => {
            setMoving(null)
            setNotice(fill(tx(O.movedToAt), { when: when(to, locale) }))
          }}
        />
      </Dialog>
    )
  }

  return (
    <Dialog title={fill(tx(O.lessonsTitle), { name: learner.name })} onClose={onClose} footer={<DialogCancelButton onClick={onClose} />}>
      <p className="ts-muted">{tx(O.lessonsHint)}</p>
      {notice && <div className="banner banner--info" role="status">{notice}</div>}
      <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} isEmpty={lessons.length === 0} emptyTitle={tx(O.noLessons)}>
        <ul className="ts-rows ts-lessons" aria-label={tx(O.lessons)}>
          {lessons.map((l) => (
            <li key={l.id} className="ts-row" data-lesson={l.id}>
              <div className="ts-row__main">
                <strong className={l.movedTo ? 'ts-weekly__old' : undefined}>{when(l.startsAt, locale)}</strong>
                <span className="ts-muted">
                  {tx(KIND[l.kind] ?? O.regular)} · {l.teacher.name} · {formatMinutes(l.durationMinutes, locale)} · {tx(phaseLabel(l))}
                </span>
                {l.movedTo && <span className="ts-muted">{fill(tx(O.movedToAt), { when: when(l.movedTo, locale) })}</span>}
                {l.movedFrom && !l.movedTo && <span className="badge">{tx(O.movedHere)}</span>}
              </div>
              {movable(l, now) && (
                <div className="ts-row__actions">
                  <button type="button" className="btn btn--sm" onClick={() => { setNotice(null); setMoving(l) }} aria-label={`${tx(O.move)} ${when(l.startsAt, locale)}`}>
                    {tx(O.move)}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </QueryBoundary>
    </Dialog>
  )
}

function phaseLabel(l: LessonDto): Pair {
  if (l.phase === 'upcoming') return O.statusUpcoming
  if (l.phase === 'in_progress') return O.statusInProgress
  return O.statusClosed
}

function MoveLesson({ lesson, onBack, onDone }: { lesson: LessonDto; onBack: () => void; onDone: (startsAt: string) => void }) {
  const tx = useTx()
  const q = useMoveSlots(lesson.id)
  const op = useOp((startsAt: string) => opsApi.move(lesson.id, startsAt))
  const back = (
    <button type="button" className="btn" onClick={onBack}>
      {tx(O.backToLessons)}
    </button>
  )
  return (
    <>
      <p className="ts-muted">{tx(O.moveHint)}</p>
      <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
        {q.data &&
          (q.data.refusal ? (
            <>
              <div className="banner banner--warn" role="status">{tx(REFUSAL[q.data.refusal] ?? O.refusalNotMovable)}</div>
              <div className="dialog__actions">{back}</div>
            </>
          ) : (
            <PickOne
              slots={q.data.slots}
              locked={q.data.locked}
              loading={false}
              from={q.data.startsAt}
              minutes={q.data.durationMinutes}
              saveLabel={tx(O.moveSave)}
              onSave={async (startsAt) => {
                await op.mutateAsync(startsAt)
                onDone(startsAt)
              }}
              onDone={() => undefined}
              onRefresh={() => void q.refetch()}
              footerStart={back}
            />
          ))}
      </QueryBoundary>
    </>
  )
}

// ---------------------------------------------------------------------------
// A weekly occurrence that could not be created
// ---------------------------------------------------------------------------

/** PD-31: schedule a blocked weekly occurrence at another free time (GET/POST /lessons/blocked/:id/...). */
export function BlockedScheduleDialog({ item, onClose }: { item: BlockedOccurrence; onClose: () => void }) {
  const tx = useTx()
  const q = useBlockedSlots(item.id)
  const op = useOp((startsAt: string) => opsApi.scheduleBlocked(item.id, startsAt))
  const minutes = q.data?.durationMinutes ?? Math.round((new Date(item.endsAt).getTime() - new Date(item.startsAt).getTime()) / 60_000)
  return (
    <Dialog title={fill(tx(O.scheduleElsewhereTitle), { name: item.learner.name })} onClose={onClose}>
      <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
        {q.data && (
          <PickOne
            slots={q.data.slots}
            locked={q.data.locked ?? null}
            loading={false}
            from={item.startsAt}
            minutes={minutes}
            saveLabel={tx(O.scheduleSave)}
            onSave={(startsAt) => op.mutateAsync(startsAt)}
            onDone={onClose}
            onRefresh={() => void q.refetch()}
            footerStart={<DialogCancelButton onClick={onClose} />}
          />
        )}
      </QueryBoundary>
    </Dialog>
  )
}
