import { useEffect, useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ApiError } from '@/core/api/errors'
import { ACADEMY_ZONE, whenIn } from '@/core/time/academyTime'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { QueryBoundary } from '@/shared/components/States'
import { LockedNotice, WeeklySlotPicker, weeklyKey, type WeeklyOption } from '@/shared/components/SlotPicker'
import type { Pair } from './copy'
import { opsApi, opsKeys, type TeacherCandidate, type TransferPreview, type TransferReason } from './opsApi'
import { O, TRANSFER_REASON, arrow, describeOpsError, fill, formatDay } from './opsCopy'
import { useOp, useScheduleOptions, useTeacherCandidates } from './opsHooks'
import { weeklyLabel } from './WeeklyChangeDialog'
import { readinessNote } from '@/features/teacher-files/readiness'
import './teachers.css'

export type ChangeTeacherTarget =
  | { kind: 'learner'; id: string; name: string; currentTeacherId?: string | null }
  | { kind: 'group'; id: string; name: string }

type PreviewLearner = TransferPreview['learners'][number]
type WeeklySet = Array<{ weekday: number; start: string }>
/** A child's resolved times: the FULL new weekly set, and each busy time's replacement (its next start). */
interface Resolved {
  slots: WeeklySet
  replaced: Record<number, string>
}
type Result = Awaited<ReturnType<typeof opsApi.transfer>> | Awaited<ReturnType<typeof opsApi.changeGroupTeacher>>

function useTx() {
  const { locale } = useI18n()
  return (p: Pair) => (locale === 'ar' ? p.ar : p.en)
}

/** A name kept whole inside a sentence of the other direction (a Latin name in Arabic): FSI ... PDI. */
const isolate = (name: string) => `\u2068${name}\u2069`

/** Why a teacher cannot be picked, or null. */
function unavailable(t: TeacherCandidate, tx: (p: Pair) => string, locale: 'ar' | 'en'): string | null {
  if (t.away) return fill(tx(t.away.kind === 'leave' ? O.onLeaveUntil : O.suspendedUntil), { date: formatDay(t.away.until, locale) })
  if (!t.isActive) return tx(O.inactiveTeacher)
  return null
}

/**
 * PD-31 (12): change a child's teacher -- or every child of a group taught by
 * one teacher -- in ONE server transaction. Pick the new teacher (on leave,
 * suspended and inactive teachers are shown greyed out), then the preview says,
 * per child, whether the new teacher is free at each weekly time. A busy time
 * must be replaced with one of the new teacher's free times before Confirm;
 * one-off lessons the new teacher cannot take are listed. The server decides
 * who may (the super admin, the Teachers department, Operations within PD-8),
 * and its refusal is shown as it is.
 */
export function ChangeTeacherDialog({
  target,
  onClose,
  onDone,
}: {
  target: ChangeTeacherTarget
  onClose: () => void
  onDone: (notice: string) => void
}) {
  const tx = useTx()
  const { locale } = useI18n()
  const base = useId()
  const candidates = useTeacherCandidates()
  const [toTeacherId, setToTeacherId] = useState('')
  const [fromTeacherId, setFromTeacherId] = useState('')
  const [reason, setReason] = useState<TransferReason>('family_request')
  const [handoverNote, setHandoverNote] = useState('')
  const [note, setNote] = useState('')
  /** Per learner with a busy time: its resolved times once every busy time has a replacement; null while not. */
  const [sets, setSets] = useState<Record<string, Resolved | null>>({})
  const [tried, setTried] = useState(false)

  const preview = useQuery({
    queryKey: opsKeys.preview(target.kind, target.id, toTeacherId, fromTeacherId),
    queryFn: () =>
      target.kind === 'learner'
        ? opsApi.transferPreview(target.id, toTeacherId)
        : opsApi.groupTeacherPreview(target.id, toTeacherId, fromTeacherId || undefined),
    enabled: toTeacherId !== '',
  })
  const op = useOp(() => {
    const common = {
      toTeacherId,
      reason,
      ...(handoverNote.trim() ? { handoverNote: handoverNote.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    }
    const chosen: Record<string, WeeklySet> = {}
    for (const [id, r] of Object.entries(sets)) if (r) chosen[id] = r.slots
    return target.kind === 'learner'
      ? opsApi.transfer(target.id, { ...common, ...(chosen[target.id] ? { slots: chosen[target.id] } : {}) })
      : opsApi.changeGroupTeacher(target.id, {
          ...common,
          ...(fromTeacherId ? { fromTeacherId } : {}),
          ...(Object.keys(chosen).length ? { slots: chosen } : {}),
        })
  })

  // Every change of teacher starts the times again from that teacher's preview.
  useEffect(() => setSets({}), [toTeacherId, fromTeacherId])

  const p = preview.data
  const groupTeachers = p?.groupTeachers ?? []
  const needsFrom = target.kind === 'group' && groupTeachers.length > 1 && fromTeacherId === ''
  const learners = needsFrom ? [] : p?.learners ?? []
  const busyLearners = learners.filter((l) => !l.allFree || l.slots.some((s) => !s.free))
  const resolved = busyLearners.every((l) => !!sets[l.id])
  const missing: Pair | null = toTeacherId === '' ? O.chooseNewTeacher
    : needsFrom ? O.chooseReplaced
    : !p ? null
    : !resolved ? O.resolveBusy
    : null
  const ready = missing === null && !!p && !p.locked && learners.length > 0

  const submit = async () => {
    setTried(true)
    if (!ready || op.isPending) return
    try {
      const r = (await op.mutateAsync(undefined)) as Result
      if ('learners' in r) {
        const moved = r.learners.reduce((n, x) => n + x.lessonsMoved, 0)
        const rescheduled = r.learners.reduce((n, x) => n + x.lessonsRescheduled, 0)
        onDone(`${fill(tx(O.groupChanged), { n: r.learners.length })} ${fill(tx(O.transferDone), { moved, moved2: rescheduled })}`)
      } else {
        onDone(fill(tx(O.transferDone), { moved: r.lessonsMoved, moved2: r.lessonsRescheduled }))
      }
    } catch (e) {
      // A time taken since the preview: show it again, fresh.
      if (e instanceof ApiError && e.messageEn === 'times_not_free') {
        setSets({})
        void preview.refetch()
      }
    }
  }

  const fromName = (l: PreviewLearner) => l.fromTeacher?.name ?? tx(O.noTeacher)
  const toName = p?.toTeacher.name ?? ''

  return (
    <Dialog
      title={fill(tx(O.changeTeacherTitle), { name: target.name })}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button type="button" className="btn btn--primary" disabled={!ready || op.isPending} onClick={() => void submit()}>
            {op.isPending ? tx(O.saving) : tx(O.confirmChange)}
          </button>
        </>
      }
    >
      <p className="ts-muted">{tx(O.changeTeacherHint)}</p>
      <QueryBoundary isLoading={candidates.isLoading} error={candidates.error} onRetry={() => void candidates.refetch()}>
        <fieldset className="ts-fieldset">
          <legend className="field__label">{tx(O.toTeacher)}</legend>
          <div className="ts-teacher-list">
            {(candidates.data?.teachers ?? []).map((t) => {
              const current = target.kind === 'learner' && t.id === target.currentTeacherId
              const why = current ? tx(O.isCurrent) : unavailable(t, tx, locale)
              // PD-43: said beside the name; the teacher stays pickable.
              const note = why ? null : readinessNote(t.readiness, locale)
              return (
                <label key={t.id} className={`ts-teacher${why ? ' ts-teacher--off' : ''}`}>
                  <input
                    type="radio"
                    name={`${base}-to`}
                    value={t.id}
                    checked={toTeacherId === t.id}
                    disabled={why !== null}
                    onChange={() => { setToTeacherId(t.id); setFromTeacherId('') }}
                  />
                  <span dir="auto">{t.name}</span>
                  {why && <span className="ts-teacher__why">· {why}</span>}
                  {note && <span className="ts-teacher__why">· {note}</span>}
                </label>
              )
            })}
          </div>
        </fieldset>
      </QueryBoundary>

      {toTeacherId !== '' && (
        <QueryBoundary isLoading={preview.isLoading} error={preview.error} onRetry={() => void preview.refetch()}>
          {p && (
            <>
              {p.locked && <LockedNotice />}
              {target.kind === 'group' && groupTeachers.length > 1 && (
                <fieldset className="ts-fieldset">
                  <legend className="field__label">{tx(O.whichReplaced)}</legend>
                  <p className="ts-muted">{tx(O.whichReplacedHint)}</p>
                  {groupTeachers.map((g) => (
                    <label key={g.id} className="ts-teacher">
                      <input type="radio" name={`${base}-from`} value={g.id} checked={fromTeacherId === g.id} onChange={() => setFromTeacherId(g.id)} />
                      <span dir="auto">{g.name}</span>
                    </label>
                  ))}
                </fieldset>
              )}
              {!needsFrom && !p.locked && (
                <section className="ts-preview" aria-label={tx(O.previewTitle)}>
                  <h3 className="ts-subtitle">{tx(O.previewTitle)}</h3>
                  {learners.map((l) => (
                    <LearnerPreview
                      key={l.id}
                      learner={l}
                      toTeacherId={toTeacherId}
                      fromName={fromName(l)}
                      toName={toName}
                      onSet={(set) => setSets((s) => ({ ...s, [l.id]: set }))}
                    />
                  ))}
                </section>
              )}
            </>
          )}
        </QueryBoundary>
      )}

      <div className="field">
        <label className="field__label" htmlFor={`${base}-reason`}>{tx(O.reason)}</label>
        <select id={`${base}-reason`} className="select" value={reason} onChange={(e) => setReason(e.target.value as TransferReason)}>
          {Object.entries(TRANSFER_REASON).map(([value, label]) => (
            <option key={value} value={value}>{tx(label)}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field__label" htmlFor={`${base}-handover`}>{tx(O.handover)}</label>
        <textarea id={`${base}-handover`} className="input" rows={2} dir="auto" value={handoverNote} onChange={(e) => setHandoverNote(e.target.value)} />
      </div>
      <div className="field">
        <label className="field__label" htmlFor={`${base}-note`}>{tx(O.internalNote)}</label>
        <textarea id={`${base}-note`} className="input" rows={2} dir="auto" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      {ready && (
        <section className="ts-summary" aria-label={tx(O.summary)}>
          <h3 className="ts-subtitle">{tx(O.summary)}</h3>
          {learners.map((l) => (
            <p key={l.id} data-testid="teacher-summary">
              <strong>{fill(tx(O.sumTeacher), { name: isolate(l.name), from: isolate(fromName(l)), to: isolate(toName) })}</strong>
              {' — '}
              {summaryTimes(l, sets[l.id] ?? null, tx, locale)}
              {' · '}
              {fill(tx(O.futureLessons), { n: l.futureLessons })}
            </p>
          ))}
        </section>
      )}
      {tried && missing && <p className="field__error" role="alert">{tx(missing)}</p>}
      {op.error && <div className="banner banner--danger" role="alert">{describeOpsError(op.error, locale)}</div>}
    </Dialog>
  )
}

/** "Mon 17:00 kept; Thu 17:00 → Fri 18:00", from the preview and the replacements. */
function summaryTimes(l: PreviewLearner, resolved: Resolved | null, tx: (p: Pair) => string, locale: 'ar' | 'en'): string {
  return l.slots
    .map((s, i) => {
      const label = weeklyLabel(s.nextStartsAt, locale)
      if (s.free) return fill(tx(O.sumKept), { time: label })
      const to = resolved?.replaced[i]
      return to ? fill(tx(O.summaryMove), { from: label, to: weeklyLabel(to, locale) }) : label
    })
    .join(locale === 'ar' ? '؛ ' : '; ')
}

/**
 * One child in the preview: each weekly time free or busy with the new
 * teacher. Busy ones open the new teacher's free weekly times (GET
 * /learners/:id/schedule-options?teacherId=). Reports the child's FULL new
 * set -- kept times first, then the replacements -- once every busy time has one.
 */
function LearnerPreview({
  learner: l,
  toTeacherId,
  fromName,
  toName,
  onSet,
}: {
  learner: PreviewLearner
  toTeacherId: string
  fromName: string
  toName: string
  onSet: (resolved: Resolved | null) => void
}) {
  const tx = useTx()
  const { locale } = useI18n()
  const busy = l.slots.filter((s) => !s.free)
  const options = useScheduleOptions(busy.length ? l.id : null, toTeacherId)
  const [picked, setPicked] = useState<Record<number, WeeklyOption>>({})
  const [editing, setEditing] = useState<number | null>(busy.length ? l.slots.indexOf(busy[0]!) : null)

  // A kept time is sent in the NEW teacher's terms (their zone's weekday and
  // clock): the server's exact conversion, else matched by its next start.
  const keptAs = (s: PreviewLearner['slots'][number]) => {
    if (s.keptAs) return s.keptAs
    const o = options.data?.options.find((x) => x.nextStartsAt === s.nextStartsAt)
    return o ? { weekday: o.weekday, start: o.start } : { weekday: s.weekday, start: s.start }
  }
  /** Slot i's time in the new set: kept, or its replacement once picked. */
  const newTime = (i: number) => {
    const s = l.slots[i]!
    const p = picked[i]
    return s.free ? keptAs(s) : p ? { weekday: p.weekday, start: p.start } : null
  }
  const complete = !!options.data && busy.every((s) => picked[l.slots.indexOf(s)])
  const resolved: Resolved | null = complete
    ? {
        slots: l.slots.map((_, i) => newTime(i)!),
        replaced: Object.fromEntries(Object.entries(picked).map(([i, o]) => [Number(i), o.nextStartsAt])),
      }
    : null
  const resolvedKey = JSON.stringify(resolved)
  useEffect(() => {
    if (busy.length > 0) onSet(resolved)
  }, [resolvedKey]) // keyed by content: `resolved` is rebuilt on every render

  const usedBy = (i: number) =>
    new Set(
      l.slots
        .map((_, j) => (j === i ? null : newTime(j)))
        .filter((x): x is { weekday: number; start: string } => !!x)
        .map(weeklyKey),
    )

  return (
    <div className="ts-preview__learner" role="group" aria-label={l.name}>
      <p>
        <strong dir="auto">{l.name}</strong> <span className="ts-muted">· <bdi>{fromName}</bdi>{arrow(locale)}<bdi>{toName}</bdi> · {fill(tx(O.futureLessons), { n: l.futureLessons })}</span>
      </p>
      <ul className="ts-preview__slots">
        {l.slots.map((s, i) => {
          const label = weeklyLabel(s.nextStartsAt, locale)
          const choice = picked[i]
          return (
            <li key={i} className={s.free ? 'ts-slot--free' : 'ts-slot--busy'}>
              <span>
                {label} — {s.free ? tx(O.slotFree) : s.zoneShift ? tx(O.slotZoneShift) : tx(O.slotBusy)}
                {choice && (
                  <>
                    {arrow(locale)}
                    <strong>{weeklyLabel(choice.nextStartsAt, locale)}</strong>
                  </>
                )}
              </span>
              {!s.free && (
                <button type="button" className="btn btn--sm" aria-expanded={editing === i} onClick={() => setEditing(editing === i ? null : i)}>
                  {tx(O.change)} {label}
                </button>
              )}
              {!s.free && editing === i && (
                <QueryBoundary isLoading={options.isLoading} error={options.error} onRetry={() => void options.refetch()} compact>
                  <WeeklySlotPicker
                    options={(options.data?.options ?? []).filter((o) => !usedBy(i).has(weeklyKey(o)))}
                    value={choice ?? null}
                    locked={options.data?.locked ?? null}
                    onChange={(o) => {
                      setPicked((p) => ({ ...p, [i]: o }))
                      const nextBusy = l.slots.findIndex((x, j) => j !== i && !x.free && !picked[j])
                      setEditing(nextBusy >= 0 ? nextBusy : null)
                    }}
                    label={`${tx(O.pickReplacement)}: ${label}`}
                  />
                </QueryBoundary>
              )}
            </li>
          )
        })}
      </ul>
      {l.unmovable.length > 0 && (
        <div className="banner banner--warn" role="note">
          <p className="ts-card__note">{tx(O.unmovableTitle)}</p>
          <ul className="ts-preview__unmovable">
            {l.unmovable.map((u) => (
              <li key={u.lessonId}>
                {whenIn(u.startsAt, ACADEMY_ZONE, locale)} · {tx(u.kind === 'makeup' ? O.makeup : u.kind === 'trial' ? O.trial : O.regular)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
