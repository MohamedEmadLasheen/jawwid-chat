import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge, type Tone } from '@/shared/components/Badge'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { Icon } from '@/shared/components/Icon'
import { SlotPicker } from '@/shared/components/SlotPicker'
import { PageHeader } from '@/shared/components/PageHeader'
import {
  Age,
  DetailActions,
  DetailEnd,
  DetailSection,
  FlowSteps,
  FlowStrip,
  RequestQueue,
  RowOpen,
  ageText,
  rowOpener,
  useWidePane,
  waitedOvernight,
  type FlowCell,
  type FlowStep,
} from '@/shared/components/RequestQueue'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { ActionDialog, type FieldSpec, type FieldValue } from '../teachers/ActionDialog'
import type { Pair } from '../teachers/copy'
import { describeOpsError, formatMinutes } from '../teachers/opsCopy'
import { trialsApi, type TrialDto, type TrialOutcome } from './api'
import { TRIALS_AREA_BASE, TrialsAreaTabs, useTrialsAccess } from './area'
import { ATTENDANCE, NOT_SUBSCRIBED_REASON, OUTCOME, TR, formatWhen } from './copy'
import { useTrialOp, useTrialSlots, useTrialTeachers, useTrials } from './hooks'
import { TrialCardDialog, type TrialPowers } from './TrialCardDialog'
import '../teachers/teachers.css'
import './trials.css'
import { ACADEMY_ZONE } from '@/core/time/academyTime'
import { SearchableSelect } from '@/shared/components/SearchableSelect'
import { LocationPicker, type LocationValue } from '@/shared/location/LocationPicker'

type Pending = { title: string; intro?: string; fields: FieldSpec[]; submit: (v: FieldValue) => Promise<unknown> } | null
/** `decision` is the URL's word for "needs an outcome" (PD-44: the Dashboard links to it). */
const FILTERS = ['all', 'upcoming', 'decision', 'subscribed', 'not_subscribed', 'no_show'] as const
type Filter = (typeof FILTERS)[number]
type StudentDraft = { name: string; level: string; note: string }

const MIN_LENGTH = 15
const MAX_LENGTH = 120

const OUTCOME_OF: Record<Exclude<Filter, 'all'>, TrialOutcome> = {
  upcoming: 'upcoming',
  decision: 'awaiting',
  subscribed: 'subscribed',
  not_subscribed: 'not_subscribed',
  no_show: 'no_show',
}

const OUTCOME_TONE: Record<string, Tone> = {
  upcoming: 'info',
  awaiting: 'warn',
  subscribed: 'ok',
  not_subscribed: 'neutral',
  no_show: 'neutral',
  cancelled: 'outline',
}

const RECORDED: ReadonlyArray<TrialOutcome> = ['no_show', 'subscribed', 'not_subscribed']

/** An outcome that has waited since before today is late: the page's one use of terracotta. */
const outcomeLate = (t: TrialDto) => t.outcome === 'awaiting' && waitedOvernight(t.endsAt)

/**
 * Sales' trial page (PD-11 T4), also the Teachers department's view of trials.
 * Each trial has ONE outcome -- did not attend, subscribed, did not subscribe --
 * recorded with the same card as "+ -> Trial" in the teacher's trial group
 * (TrialCardDialog), and corrected there by Sales. Chat is the only source of
 * truth: nothing waits for Core.
 *
 * Laid out as a request queue: the outcomes as a strip of counts, the trials
 * as the queue, and the open trial's steps and actions in the panel beside it.
 */
export function TrialsPage() {
  const { locale } = useI18n()
  const tx = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  const access = useTrialsAccess()
  const q = useTrials()
  const wide = useWidePane()
  // PD-44: the tab lives in the URL, so a Dashboard tile opens the tab it
  // counted (/trials?filter=decision|upcoming) and a later link moves it too.
  const [params, setParams] = useSearchParams()
  const asked = params.get('filter')
  const filter: Filter = FILTERS.find((f) => f === asked) ?? 'all'
  const setFilter = (next: Filter) =>
    setParams((current) => {
      const p = new URLSearchParams(current)
      if (next === 'all') p.delete('filter')
      else p.set('filter', next)
      return p
    }, { replace: true })
  const [booking, setBooking] = useState(false)
  const [dialog, setDialog] = useState<Pending>(null)
  const [card, setCard] = useState<TrialDto | null>(null)
  const [editing, setEditing] = useState<TrialDto | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const op = useTrialOp((f: () => Promise<unknown>) => f())
  const navigate = useNavigate()
  const [groupError, setGroupError] = useState<unknown>(null)
  const openGroup = async (teacherId: string) => {
    setGroupError(null)
    try {
      const { conversationId } = await trialsApi.openGroup(teacherId)
      navigate(`/chat/${encodeURIComponent(conversationId)}`)
    } catch (e) {
      setGroupError(e)
    }
  }
  const run = (title: string, fields: FieldSpec[], submit: (v: FieldValue) => Promise<unknown>, intro?: string) =>
    setDialog({ title, intro, fields, submit: (v) => op.mutateAsync(() => submit(v)) })

  const all = q.data?.trials ?? []
  const rows = filter === 'all' ? all : all.filter((t) => t.outcome === OUTCOME_OF[filter])

  // The trial desk: Sales and Operations work trials alike (owner, 2026-10-21).
  const desk = access.sales || access.operations
  const mayBook = desk || access.lessonManager
  const powers: TrialPowers = { noShow: desk || access.lessonManager, decide: desk, correct: desk }

  // Until the list has arrived a cell shows its name alone, never a zero.
  const countOf = (f: Exclude<Filter, 'all'>) => (q.data ? all.filter((t) => t.outcome === OUTCOME_OF[f]).length : null)
  const waiting = all.filter((t) => t.outcome === 'awaiting')
  const oldest = waiting.reduce<TrialDto | null>((a, t) => (a === null || t.endsAt < a.endsAt ? t : a), null)
  const cells: Array<FlowCell<Filter>> = [
    { key: 'all', label: tx(TR.filterAll), count: q.data ? all.length : null, apart: true },
    { key: 'upcoming', label: tx(TR.filterUpcoming), count: countOf('upcoming') },
    {
      key: 'decision',
      label: tx(TR.filterOutcome),
      count: countOf('decision'),
      note: oldest ? tx(TR.oldest).replace('{age}', ageText(oldest.endsAt, locale)) : undefined,
      late: waiting.some(outcomeLate),
    },
    { key: 'subscribed', label: tx(TR.subscribed), count: countOf('subscribed') },
    { key: 'not_subscribed', label: tx(TR.notSubscribed), count: countOf('not_subscribed'), apart: true },
    { key: 'no_show', label: tx(TR.didNotAttend), count: countOf('no_show'), apart: true },
  ]

  const cancel = (t: TrialDto) =>
    run(tx(TR.cancel), [{ key: 'reason', label: TR.cancelReason, type: 'textarea', required: true }], (v) => trialsApi.cancel(t.id, v('reason')))
  const acts = (t: TrialDto) => ({
    record: t.outcome === 'awaiting' && powers.noShow,
    correct: RECORDED.includes(t.outcome) && powers.correct,
    edit: t.outcome === 'upcoming' && mayBook,
    cancel: (t.outcome === 'upcoming' || (t.outcome === 'awaiting' && t.attendance === 'awaiting')) && mayBook,
  })

  // Beside the queue the panel always shows a trial: the one picked, else the first in the list.
  const open = rows.find((t) => t.id === openId) ?? (wide ? rows[0] ?? null : null)

  return (
    <div className="page rq-page">
      <div className="page__inner">
        <TrialsAreaTabs />
        <PageHeader
          title={tx(TR.trialsTitle)}
          subtitle={tx(TR.trialsSubtitle)}
          actions={
            <>
              {mayBook && (
                <button type="button" className="btn btn--primary" onClick={() => setBooking(true)}>{tx(TR.bookTrial)}</button>
              )}
            </>
          }
        />
        <FlowStrip tabs label={tx(TR.flowLabel)} cells={cells} value={filter} onChange={setFilter} />
        <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
          <RequestQueue
            label={tx(TR.panelLabel)}
            detail={
              open && {
                id: open.id,
                title: open.prospect.displayName,
                kind: { icon: 'trials', label: tx(TR.kind) },
                status: (
                  <>
                    <TrialStatus trial={open} />
                    <Age iso={open.outcome === 'upcoming' ? open.startsAt : open.endsAt} late={outcomeLate(open)} />
                  </>
                ),
                pinned: true,
                onClose: () => setOpenId(null),
                body: (
                  <TrialDetail
                    trial={open}
                    acts={acts(open)}
                    newStudents={open.outcome === 'subscribed' && desk}
                    onRecord={() => setCard(open)}
                    onEdit={() => setEditing(open)}
                    onCancel={() => cancel(open)}
                    onGroup={() => void openGroup(open.teacher.id)}
                  />
                ),
              }
            }
          >
            {rows.length === 0 ? (
              <EmptyState title={tx(all.length === 0 ? TR.none : TR.noneForFilter)} hint={all.length === 0 ? tx(TR.noneHint) : undefined} />
            ) : (
              <div className="table-wrap">
                <table className="table rq-table">
                  <thead>
                    <tr>
                      <th scope="col">{tx(TR.prospect)}</th>
                      <th scope="col" className="rq-c--more">{tx(TR.teacher)}</th>
                      <th scope="col">{tx(TR.when)}</th>
                      <th scope="col">{tx(TR.status)}</th>
                      <th scope="col"><span className="sr-only">{tx(TR.actions)}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((t) => {
                      const a = acts(t)
                      return (
                        <tr key={t.id} data-selected={open?.id === t.id || undefined} onClick={rowOpener(() => setOpenId(t.id))}>
                          <th scope="row" className="rq-c-who">
                            <RowOpen selected={open?.id === t.id} onOpen={() => setOpenId(t.id)}>{t.prospect.displayName}</RowOpen>
                            {t.prospect.level && <span className="rq-sub"><bdi>{t.prospect.level}</bdi></span>}
                          </th>
                          <td className="rq-c-meta rq-c--more"><bdi>{t.teacher.name}</bdi></td>
                          <td className="rq-c-when">
                            <span className="rq-nowrap">{formatWhen(t.startsAt, locale)}</span>
                            <span className="rq-sub">
                              <Age iso={t.outcome === 'upcoming' ? t.startsAt : t.endsAt} late={outcomeLate(t)} /> · {formatMinutes(t.durationMinutes, locale)}
                            </span>
                          </td>
                          <td className="rq-c-status"><TrialStatus trial={t} detail /></td>
                          <td className="rq-c-act">
                            <div className="rq-row-actions row-actions">
                              {/* Quiet in the row: the open trial's panel carries the primary button. */}
                              {a.record && (
                                <button type="button" className="btn btn--sm" onClick={() => setCard(t)}>{tx(TR.recordOutcome)}</button>
                              )}
                              {a.correct && (
                                <button type="button" className="btn btn--sm" onClick={() => setCard(t)}>{tx(TR.correctOutcome)}</button>
                              )}
                              {a.edit && (
                                <button type="button" className="btn btn--sm" onClick={() => setEditing(t)}>{tx(TR.editTrial)}</button>
                              )}
                              <button
                                type="button"
                                className="btn btn--sm btn--icon btn--ghost"
                                onClick={() => void openGroup(t.teacher.id)}
                                aria-label={tx(TR.openGroup)}
                                title={tx(TR.openGroup)}
                              >
                                <Icon name="conversations" size={18} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {groupError !== null && (
              <div className="banner banner--danger" role="alert">{describeOpsError(groupError, locale)}</div>
            )}
          </RequestQueue>
        </QueryBoundary>
        {dialog && (
          <ActionDialog title={dialog.title} intro={dialog.intro} fields={dialog.fields} onSubmit={dialog.submit} onClose={() => setDialog(null)} />
        )}
        {booking && <BookTrialDialog onClose={() => setBooking(false)} />}
        {editing && <BookTrialDialog editing={editing} onClose={() => setEditing(null)} />}
        {card && <TrialCardDialog trial={card} powers={powers} onClose={() => setCard(null)} />}
      </div>
    </div>
  )
}

/** A trial's one status: a dot and a word. In the queue it adds what the lesson itself recorded. */
function TrialStatus({ trial: t, detail = false }: { trial: TrialDto; detail?: boolean }) {
  const { locale } = useI18n()
  const tx = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  const reason = t.outcomeDetail?.reason
  // The attendance repeats the outcome for a trial that is upcoming, missed or called off.
  const attendance = t.attendance === t.outcome || t.outcome === 'cancelled' ? null : ATTENDANCE[t.attendance] ?? { en: t.attendance, ar: t.attendance }
  return (
    <>
      <Badge tone={OUTCOME_TONE[t.outcome] ?? 'neutral'} dot>{tx(OUTCOME[t.outcome] ?? { en: t.outcome, ar: t.outcome })}</Badge>
      {detail && attendance && <span className="rq-sub">{tx(attendance)}</span>}
      {detail && reason && <span className="rq-sub">{tx(NOT_SUBSCRIBED_REASON[reason] ?? { en: reason, ar: reason })}</span>}
    </>
  )
}

/** The open trial: its steps from booking to hand-over, what was recorded, and what can be done now. */
function TrialDetail({
  trial: t,
  acts,
  newStudents,
  onRecord,
  onEdit,
  onCancel,
  onGroup,
}: {
  trial: TrialDto
  acts: { record: boolean; correct: boolean; edit: boolean; cancel: boolean }
  /** Whether this reader has the New students page to follow a subscription to. */
  newStudents: boolean
  onRecord: () => void
  onEdit: () => void
  onCancel: () => void
  onGroup: () => void
}) {
  const { locale, number } = useI18n()
  const tx = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  const label = (map: Record<string, Pair>, key: string) => tx(map[key] ?? { en: key, ar: key })
  const called = t.outcome === 'cancelled'
  const held = t.attendance === 'attended'
  const missed = t.attendance === 'no_show' || t.outcome === 'no_show'
  const d = t.outcomeDetail

  const steps: FlowStep[] = [
    { key: 'booked', label: tx(TR.stepBooked), state: 'done', meta: <bdi>{t.teacher.name}</bdi> },
    {
      key: 'lesson',
      label: tx(TR.stepLesson),
      // A lesson nobody came to did not happen: that is not an error to fix, so it carries no terracotta.
      state: called || missed ? 'skipped' : held ? 'done' : 'current',
      meta: (
        <>
          {formatWhen(t.startsAt, locale)} · {label(ATTENDANCE, t.attendance)}
        </>
      ),
    },
  ]
  if (!called && !missed) {
    steps.push({
      key: 'report',
      label: tx(TR.stepReport),
      state: t.report ? 'done' : 'todo',
      meta: t.report ? (
        <>
          <bdi>{t.report.covered}</bdi>
          {t.report.rating !== null && <> · {tx(TR.rating).replace('{n}', number(t.report.rating))}</>}
        </>
      ) : t.outcome === 'upcoming' ? undefined : (
        tx(TR.noReportYet)
      ),
      children: t.report?.note ? <p className="rq-quote"><bdi>{t.report.note}</bdi></p> : undefined,
    })
  }
  steps.push({
    key: 'outcome',
    label: tx(TR.stepOutcome),
    state: called ? 'skipped' : t.outcome === 'awaiting' ? 'current' : t.outcome === 'upcoming' ? 'todo' : 'done',
    meta:
      t.outcome === 'upcoming' ? undefined : (
        <>
          {label(OUTCOME, t.outcome)}
          {d?.reason && <> · {label(NOT_SUBSCRIBED_REASON, d.reason)}</>}
          {d && <> · {tx(TR.recordedOn).replace('{when}', formatWhen(d.recordedAt, locale))}</>}
          {d?.correctedAt && <> · {tx(TR.correctedOn).replace('{when}', formatWhen(d.correctedAt, locale))}</>}
        </>
      ),
    children: d?.note ? <p className="rq-quote"><bdi>{d.note}</bdi></p> : undefined,
  })
  if (t.outcome === 'subscribed') {
    steps.push({
      key: 'handover',
      label: tx(TR.stepHandover),
      state: 'done',
      meta: tx(TR.handedOver),
      children: newStudents ? (
        <Link className="card__link" to={`${TRIALS_AREA_BASE}/new-students`}>{tx(TR.openNewStudents)}</Link>
      ) : undefined,
    })
  }

  const students = t.students?.length ? t.students : [{ name: t.prospect.displayName, level: t.prospect.level, note: null }]
  return (
    <>
      <DetailSection title={tx(TR.steps)}>
        <FlowSteps steps={steps} label={tx(TR.steps)} />
      </DetailSection>
      <DetailSection title={tx(TR.students)}>
        <dl className="rq-fields">
          {students.map((x, i) => (
            <div className="rq-field" key={i}>
              <dt><bdi>{x.name}</bdi></dt>
              <dd>
                <bdi>{x.level ?? '—'}</bdi>
                {x.note && <span className="rq-sub"><bdi>{x.note}</bdi></span>}
              </dd>
            </div>
          ))}
          <div className="rq-field">
            <dt>{tx(TR.length)}</dt>
            <dd>{formatMinutes(t.durationMinutes, locale)}</dd>
          </div>
        </dl>
      </DetailSection>
      {acts.cancel && (
        <DetailEnd>
          <button type="button" className="btn btn--sm rq-danger" onClick={onCancel}>{tx(TR.cancel)}</button>
        </DetailEnd>
      )}
      <DetailActions>
        {acts.record && <button type="button" className="btn btn--primary" onClick={onRecord}>{tx(TR.recordOutcome)}</button>}
        {acts.correct && <button type="button" className="btn" onClick={onRecord}>{tx(TR.correctOutcome)}</button>}
        {acts.edit && <button type="button" className="btn" onClick={onEdit}>{tx(TR.editTrial)}</button>}
        <button type="button" className="btn" onClick={onGroup}>
          <Icon name="conversations" size={18} />
          {tx(TR.openGroup)}
        </button>
      </DetailActions>
    </>
  )
}

/**
 * Booking: the students are typed here (one or more -- siblings or a small
 * group share one trial and one outcome), then the teacher and one of the
 * times the server says are free for that teacher and length (GET
 * /trials/slots). The server checks again, and the database's
 * no-double-booking rule has the last word.
 */
function BookTrialDialog({ onClose, editing }: { onClose: () => void; editing?: TrialDto }) {
  const { locale } = useI18n()
  const tx = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  const teachers = useTrialTeachers(true)
  const [students, setStudents] = useState<StudentDraft[]>([{ name: '', level: '', note: '' }])
  // Editing moves an existing trial: same students, a new teacher / length / time.
  const [teacherId, setTeacherId] = useState(editing?.teacher.id ?? '')
  // The length is typed, in minutes (15 to 120, the server's range).
  const [lengthText, setLengthText] = useState(String(editing?.durationMinutes ?? 30))
  const typed = Number(lengthText)
  const lengthOk = lengthText.trim() !== '' && Number.isInteger(typed) && typed >= MIN_LENGTH && typed <= MAX_LENGTH
  const duration = lengthOk ? typed : 0
  const [slot, setSlot] = useState('')
  // PD-45: optional at booking; it only pre-fills Sales' subscription form later.
  const [location, setLocation] = useState<LocationValue>({ countryCode: null, subdivisionCode: null })
  const [error, setError] = useState<unknown>(null)
  const slots = useTrialSlots(teacherId, duration)
  const book = useTrialOp((f: () => Promise<unknown>) => f())

  // PD-31: day and time are chosen as chips (SlotPicker), from the same free times.
  const offered = slots.data?.slots ?? []
  const chosenSlot = slot && offered.includes(slot) ? slot : ''
  // What still stops the booking, in the order the form asks for it. The Book
  // button stays clickable and says this, rather than greying out silently.
  const unnamed = editing ? [] : students.map((x, i) => (x.name.trim() === '' ? i : -1)).filter((i) => i >= 0)
  const missing: Pair | null = unnamed.length > 0 ? TR.missingStudentName
    : teacherId === '' ? TR.missingTeacher
    : !lengthOk ? TR.missingLength
    : chosenSlot === '' ? TR.missingTime
    : null
  const [tried, setTried] = useState(false)
  const setStudent = (i: number, patch: Partial<StudentDraft>) =>
    setStudents(students.map((x, k) => (k === i ? { ...x, ...patch } : x)))

  const submit = async () => {
    setTried(true)
    if (missing || book.isPending) return
    setError(null)
    try {
      await book.mutateAsync(() =>
        editing
          ? trialsApi.reschedule(editing.id, { teacherId, startsAt: chosenSlot, durationMinutes: duration })
          : trialsApi.book({
              students: students.map((x) => ({
                name: x.name.trim(),
                ...(x.level.trim() ? { level: x.level.trim() } : {}),
                ...(x.note.trim() ? { note: x.note.trim() } : {}),
              })),
              teacherId,
              startsAt: chosenSlot,
              durationMinutes: duration,
              ...(location.countryCode ? { location: { countryCode: location.countryCode, subdivisionCode: location.subdivisionCode } } : {}),
            }),
      )
      onClose()
    } catch (e) {
      setError(e)
    }
  }

  const timeLabel = (iso: string) =>
    new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en', { hour: '2-digit', minute: '2-digit', timeZone: ACADEMY_ZONE }).format(new Date(iso))

  return (
    <Dialog
      title={editing ? `${tx(TR.editTrial)} — ${editing.prospect.displayName}` : tx(TR.bookTrial)}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button type="button" className="btn btn--primary" disabled={book.isPending} onClick={() => void submit()}>
            {tx(editing ? TR.save : TR.book)}
          </button>
        </>
      }
    >
      {editing ? (
        <p className="tj-trial-head">
          <span className="ts-muted">{tx(TR.currentTime)}:</span>
          <strong>{formatWhen(editing.startsAt, locale)}</strong>
          <span className="ts-muted">· {editing.teacher.name}</span>
        </p>
      ) : (
        <fieldset className="tj-fieldset">
          <legend className="tj-legend">{tx(TR.students)}</legend>
          <p className="ts-muted">{tx(TR.studentsHint)}</p>
          {students.map((x, i) => (
            <div className="tj-child" key={i} role="group" aria-label={`${tx(TR.student)} ${i + 1}`}>
              {students.length > 1 && (
                <div className="tj-child__head">
                  <span className="tj-child__title">{tx(TR.student)} {i + 1}</span>
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => setStudents(students.filter((_, k) => k !== i))}>
                    {tx(TR.removeStudent)}
                  </button>
                </div>
              )}
              <div className="tj-row">
                <div className="field">
                  <label className="field__label" htmlFor={`bt-name-${i}`}>{tx(TR.studentName)}</label>
                  <input
                    id={`bt-name-${i}`}
                    className="input"
                    dir="auto"
                    value={x.name}
                    aria-invalid={tried && unnamed.includes(i)}
                    onChange={(e) => setStudent(i, { name: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label className="field__label" htmlFor={`bt-level-${i}`}>{tx(TR.studentLevel)}</label>
                  <input id={`bt-level-${i}`} className="input" dir="auto" value={x.level} onChange={(e) => setStudent(i, { level: e.target.value })} />
                </div>
              </div>
              <div className="field">
                <label className="field__label" htmlFor={`bt-note-${i}`}>{tx(TR.noteOptional)}</label>
                <textarea id={`bt-note-${i}`} className="input" rows={2} dir="auto" value={x.note} onChange={(e) => setStudent(i, { note: e.target.value })} />
              </div>
            </div>
          ))}
          {students.length < 10 && (
            <button type="button" className="btn btn--sm" onClick={() => setStudents([...students, { name: '', level: students.at(-1)?.level ?? '', note: '' }])}>
              {tx(TR.addStudent)}
            </button>
          )}
        </fieldset>
      )}
      {!editing && (
        <fieldset className="tj-fieldset">
          <legend className="tj-legend">{tx(TR.bookingLocation)}</legend>
          <p className="ts-muted">{tx(TR.bookingLocationHint)}</p>
          <LocationPicker value={location} onChange={setLocation} />
        </fieldset>
      )}
      <div className="field">
        <label className="field__label" htmlFor="bt-teacher">{tx(TR.teacher)}</label>
        <SearchableSelect id="bt-teacher" className="select" value={teacherId} onValueChange={(v) => { setTeacherId(v); setSlot('') }}>
          <option value="">—</option>
          {(teachers.data?.teachers ?? []).map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </SearchableSelect>
      </div>
      <div className="field">
        <label className="field__label" htmlFor="bt-duration">{tx(TR.duration)}</label>
        <input
          id="bt-duration"
          className="input"
          type="number"
          inputMode="numeric"
          min={MIN_LENGTH}
          max={MAX_LENGTH}
          dir="ltr"
          value={lengthText}
          aria-invalid={tried && !lengthOk}
          aria-describedby="bt-duration-hint"
          onChange={(e) => { setLengthText(e.target.value); setSlot('') }}
        />
        <span id="bt-duration-hint" className="ts-muted">{tx(TR.lengthHint)}</span>
      </div>
      {/* The time block is always shown, so the form reads the same from the
          start; until times can be chosen it says what comes first. */}
      {(() => {
        const waiting: Pair | null = teacherId === '' ? TR.chooseTeacherFirst
          : !lengthOk ? TR.enterLengthFirst
          : null
        return (
          <div className="field">
            <span className="field__label">{tx(TR.time)}</span>
            {waiting ? (
              <p className="ts-muted">{tx(waiting)}</p>
            ) : (
              <SlotPicker
                slots={offered}
                value={chosenSlot || null}
                onChange={setSlot}
                label={tx(TR.time)}
                loading={slots.isLoading}
                emptyText={tx(TR.noSlots)}
                formatTime={timeLabel}
              />
            )}
          </div>
        )
      })()}
      {tried && missing && <p className="field__error" role="alert">{tx(missing)}</p>}
      {error !== null && (
        <div className="banner banner--danger" role="alert">{describeOpsError(error, locale)}</div>
      )}
    </Dialog>
  )
}
