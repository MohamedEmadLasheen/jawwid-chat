import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Badge, type Tone } from '@/shared/components/Badge'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { TrialBadge } from '@/shared/components/TrialBadge'
import { Icon } from '@/shared/components/Icon'
import type { MenuItem } from '@/shared/components/Menu'
import { SlotPicker } from '@/shared/components/SlotPicker'
import { PageHeader } from '@/shared/components/PageHeader'
import {
  Age,
  DetailCallout,
  DetailSection,
  FlowSteps,
  QueueGroup,
  QueueRow,
  RequestQueue,
  ageText,
  dayOffset,
  useWidePane,
  waitedOvernight,
  type FlowStep,
  sentence,
  type QueueFilter,
  QueueFilters,
} from '@/shared/components/RequestQueue'
import { RowActions } from '@/shared/components/RowActions'
import { EmptyState, QueryBoundary } from '@/shared/components/States'
import { ActionDialog, type FieldSpec, type FieldValue } from '../teachers/ActionDialog'
import type { Pair } from '../teachers/copy'
import { describeOpsError, formatMinutes } from '../teachers/opsCopy'
import { trialsApi, type TrialDto, type TrialOutcome } from './api'
import { TRIALS_AREA_BASE, TRIALS_TABS, TrialsAreaTabs, useTrialsAccess } from './area'
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
const FILTERS = ['all', 'decision', 'upcoming', 'recorded'] as const
type Filter = (typeof FILTERS)[number]
type StudentDraft = { name: string; level: string; note: string }

const MIN_LENGTH = 15
const MAX_LENGTH = 120

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

const tag = (locale: 'ar' | 'en') => (locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en')
/** "05:30 PM" on the academy's clock. */
const clock = (iso: string, locale: 'ar' | 'en') =>
  new Intl.DateTimeFormat(tag(locale), { hour: '2-digit', minute: '2-digit', timeZone: ACADEMY_ZONE }).format(new Date(iso))
/** "Tue 24 Nov" on the academy's calendar. */
const shortDay = (iso: string, locale: 'ar' | 'en') =>
  new Intl.DateTimeFormat(tag(locale), { weekday: 'short', day: 'numeric', month: 'short', timeZone: ACADEMY_ZONE }).format(new Date(iso))
/** "Sunday 29 November": a day's heading. */
const longDay = (iso: string, locale: 'ar' | 'en') =>
  new Intl.DateTimeFormat(tag(locale), { weekday: 'long', day: 'numeric', month: 'long', timeZone: ACADEMY_ZONE }).format(new Date(iso))

interface Acts {
  record: boolean
  correct: boolean
  edit: boolean
  cancel: boolean
}

/**
 * Sales' trial page (PD-11 T4), also the Teachers department's view of trials.
 * Each trial has ONE outcome -- did not attend, subscribed, did not subscribe --
 * recorded with the same card as "+ -> Trial" in the teacher's trial group
 * (TrialCardDialog), and corrected there by Sales. Chat is the only source of
 * truth: nothing waits for Core.
 *
 * Composed as an agenda on the academy's clock: what needs an outcome comes
 * first, then today, tomorrow and the days after, each a headed sheet; the
 * trials already recorded close the page. A row leads with its time; the open
 * trial's steps and its one action are in the inspector beside it.
 */
export function TrialsPage() {
  const { locale } = useI18n()
  const tx = (p: Pair) => (locale === 'ar' ? p.ar : p.en)
  const access = useTrialsAccess()
  const q = useTrials()
  const wide = useWidePane()
  // PD-44: the filter lives in the URL, so a Dashboard tile opens the view it
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
  // The Requests page links here with the trial to open (?open=<id>).
  const [openId, setOpenId] = useState<string | null>(params.get('open'))
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
  // The agenda's parts, each in the order it is worked: the longest wait first, the soonest lesson first, the latest record first.
  const waiting = all.filter((t) => t.outcome === 'awaiting').sort((a, b) => a.endsAt.localeCompare(b.endsAt))
  const upcoming = all.filter((t) => t.outcome === 'upcoming').sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  const recorded = all.filter((t) => t.outcome !== 'awaiting' && t.outcome !== 'upcoming').sort((a, b) => b.startsAt.localeCompare(a.startsAt))
  const days: Array<{ key: string; title: string; trials: TrialDto[] }> = []
  for (const t of upcoming) {
    const offset = dayOffset(t.startsAt)
    const key = offset <= 0 ? 'today' : offset === 1 ? 'tomorrow' : `day-${offset}`
    const title = offset <= 0 ? tx(TR.today) : offset === 1 ? tx(TR.tomorrow) : longDay(t.startsAt, locale)
    const last = days.at(-1)
    if (last?.key === key) last.trials.push(t)
    else days.push({ key, title, trials: [t] })
  }
  const show = { waiting: filter === 'all' || filter === 'decision', upcoming: filter === 'all' || filter === 'upcoming', recorded: filter === 'all' || filter === 'recorded' }
  // In the order the page lists them: what the inspector falls back to, and what a filter leaves.
  const rows = [...(show.waiting ? waiting : []), ...(show.upcoming ? upcoming : []), ...(show.recorded ? recorded : [])]

  // The trial desk: Sales and Operations work trials alike (owner, 2026-10-21).
  const desk = access.sales || access.operations
  const mayBook = desk || access.lessonManager
  const powers: TrialPowers = { noShow: desk || access.lessonManager, decide: desk, correct: desk }

  const late = waiting.some(outcomeLate)
  // Until the list has arrived a filter shows its name alone, never a zero.
  const n = (count: number) => (q.data ? count : null)
  const filters: Array<QueueFilter<Filter>> = [
    { key: 'all', label: tx(TR.filterAll), count: n(all.length) },
    // The red count is the group's, beside the work; the filter's count stays quiet.
    { key: 'decision', label: tx(TR.filterOutcome), count: n(waiting.length) },
    { key: 'upcoming', label: tx(TR.filterUpcoming), count: n(upcoming.length) },
    { key: 'recorded', label: tx(TR.filterRecorded), count: n(recorded.length) },
  ]

  const cancel = (t: TrialDto) =>
    run(tx(TR.cancel), [{ key: 'reason', label: TR.cancelReason, type: 'textarea', required: true }], (v) => trialsApi.cancel(t.id, v('reason')))
  const acts = (t: TrialDto): Acts => ({
    record: t.outcome === 'awaiting' && powers.noShow,
    correct: RECORDED.includes(t.outcome) && powers.correct,
    edit: t.outcome === 'upcoming' && mayBook,
    cancel: (t.outcome === 'upcoming' || (t.outcome === 'awaiting' && t.attendance === 'awaiting')) && mayBook,
  })

  // Beside the agenda the inspector always shows a trial: the one picked, else the first listed.
  const open = rows.find((t) => t.id === openId) ?? (wide ? rows[0] ?? null : null)

  /** Why a trial is on the agenda, in one sentence that names the teacher. */
  const why = (t: TrialDto): ReactNode => {
    const teacher = t.teacher.name
    const reason = t.outcomeDetail?.reason
    switch (t.outcome) {
      case 'awaiting':
        return sentence(tx(TR.whyAwaiting), { teacher })
      case 'upcoming':
        return sentence(tx(TR.whyUpcoming), { teacher })
      case 'subscribed':
        return sentence(tx(TR.whySubscribed), { teacher })
      case 'not_subscribed':
        return reason
          ? sentence(tx(TR.whyNotSubscribedBecause), { reason: tx(NOT_SUBSCRIBED_REASON[reason] ?? { en: reason, ar: reason }) })
          : sentence(tx(TR.whyNotSubscribed), { teacher })
      case 'no_show':
        return sentence(tx(TR.whyNoShow), { teacher })
      case 'cancelled':
        return tx(TR.whyCancelled)
      default:
        return <bdi>{teacher}</bdi>
    }
  }

  /** One trial as a row: its time leads, then who and why it is here, the one fact set apart, and its one action. */
  const row = (t: TrialDto, dated: boolean) => {
    const a = acts(t)
    const more: MenuItem[] = [
      { key: 'group', label: tx(TR.openGroup), icon: 'conversations', onSelect: () => void openGroup(t.teacher.id) },
      ...(a.cancel ? [{ key: 'cancel', label: tx(TR.cancel), icon: 'calendarX' as const, danger: true, onSelect: () => cancel(t) }] : []),
    ]
    return (
      <QueueRow
        key={t.id}
        selected={open?.id === t.id}
        onOpen={() => setOpenId(t.id)}
        lead={
          <span className="rq-time">
            <time className="rq-time__clock" dateTime={t.startsAt}>{clock(t.startsAt, locale)}</time>
            <span className="rq-time__day">{dated ? shortDay(t.startsAt, locale) : formatMinutes(t.durationMinutes, locale)}</span>
          </span>
        }
        title={t.prospect.displayName}
        sub={why(t)}
        tag={
          // The one fact set apart: how long an outcome has waited, when the lesson starts, or what was recorded.
          t.outcome === 'awaiting' ? (
            <Age iso={t.endsAt} late={outcomeLate(t)} />
          ) : t.outcome === 'upcoming' ? (
            // A day's heading already says the day: only today's lessons count down.
            dayOffset(t.startsAt) <= 0 ? <Age iso={t.startsAt} /> : undefined
          ) : (
            <Badge tone={OUTCOME_TONE[t.outcome] ?? 'neutral'} dot>{tx(OUTCOME[t.outcome] ?? { en: t.outcome, ar: t.outcome })}</Badge>
          )
        }
        actions={
          <RowActions
            label={`${tx(TR.moreActions)}: ${t.prospect.displayName}`}
            primary={
              a.record ? (
                <button type="button" className="btn btn--sm" onClick={() => setCard(t)}>{tx(TR.recordOutcome)}</button>
              ) : a.correct ? (
                <button type="button" className="btn btn--sm" onClick={() => setCard(t)}>{tx(TR.correctOutcome)}</button>
              ) : a.edit ? (
                <button type="button" className="btn btn--sm" onClick={() => setEditing(t)}>{tx(TR.editTrial)}</button>
              ) : undefined
            }
            more={more}
          />
        }
      />
    )
  }

  const offered = TRIALS_TABS.filter((t) => t.offered(access)).length > 1
  return (
    <div className="page rq-page">
      <div className="page__inner">
        <PageHeader
          title={tx(TR.trialsTitle)}
          tabs={offered ? <TrialsAreaTabs /> : undefined}
          actions={
            mayBook ? (
              <button type="button" className="btn" onClick={() => setBooking(true)}>
                <Icon name="plus" size={16} />
                {tx(TR.bookTrial)}
              </button>
            ) : undefined
          }
        />
        <RequestQueue
          label={tx(TR.panelLabel)}
          reserve={wide && q.isLoading}
          detail={
            open && {
              id: open.id,
              title: open.prospect.displayName,
              kind: { icon: 'trials', label: tx(TR.kind) },
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
          <div className="rq-bar">
            <QueueFilters label={tx(TR.filterLabel)} filters={filters} value={filter} onChange={setFilter} />
          </div>
          <QueryBoundary isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
            {rows.length === 0 ? (
              <div className="sheet rq-blank">
                <EmptyState
                  title={tx(all.length === 0 ? TR.none : TR.noneForFilter)}
                  hint={all.length === 0 ? tx(TR.noneHint) : undefined}
                  action={
                    all.length === 0 && mayBook ? (
                      <button type="button" className="btn btn--sm" onClick={() => setBooking(true)}>{tx(TR.bookTrial)}</button>
                    ) : undefined
                  }
                />
              </div>
            ) : (
              <>
                {show.waiting && waiting.length > 0 && (
                  <QueueGroup title={tx(TR.filterOutcome)} count={waiting.length} tone={late ? 'urgent' : undefined}>
                    {waiting.map((t) => row(t, true))}
                  </QueueGroup>
                )}
                {show.upcoming && days.map((d) => (
                  <QueueGroup key={d.key} title={d.title} count={d.trials.length} tone="quiet">
                    {d.trials.map((t) => row(t, false))}
                  </QueueGroup>
                ))}
                {show.recorded && recorded.length > 0 && (
                  <QueueGroup title={tx(TR.filterRecorded)} count={recorded.length} tone="quiet">
                    {recorded.map((t) => row(t, true))}
                  </QueueGroup>
                )}
              </>
            )}
            {groupError !== null && (
              <div className="banner banner--danger" role="alert">{describeOpsError(groupError, locale)}</div>
            )}
          </QueryBoundary>
        </RequestQueue>
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

/** The open trial: its steps from booking to hand-over, what was recorded, and the one thing to do now. */
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
  acts: Acts
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
  const sep = locale === 'ar' ? '، ' : ', '
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
          {formatWhen(t.startsAt, locale)}{sep}{label(ATTENDANCE, t.attendance)}
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
          {t.report.rating !== null && <>{sep}{tx(TR.rating).replace('{n}', number(t.report.rating))}</>}
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
          {d?.reason && <>{sep}{label(NOT_SUBSCRIBED_REASON, d.reason)}</>}
          {d && <>{sep}{tx(TR.recordedOn).replace('{when}', formatWhen(d.recordedAt, locale))}</>}
          {d?.correctedAt && <>{sep}{tx(TR.correctedOn).replace('{when}', formatWhen(d.correctedAt, locale))}</>}
        </>
      ),
  })
  if (t.outcome === 'subscribed') {
    steps.push({
      key: 'handover',
      label: tx(TR.stepHandover),
      state: 'done',
      meta: tx(TR.handedOver),
    })
  }

  const students = t.students?.length ? t.students : [{ name: t.prospect.displayName, level: t.prospect.level, note: null }]
  const reason = d?.reason ? label(NOT_SUBSCRIBED_REASON, d.reason) : null
  const state =
    t.outcome === 'awaiting'
      ? tx(TR.stateAwaiting).replace('{age}', ageText(t.endsAt, locale))
      : t.outcome === 'upcoming'
        ? sentence(tx(TR.stateUpcoming), { teacher: t.teacher.name, when: formatWhen(t.startsAt, locale) })
        : t.outcome === 'subscribed'
          ? tx(TR.stateSubscribed)
          : t.outcome === 'not_subscribed'
            ? reason ? tx(TR.stateNotSubscribedBecause).replace('{reason}', reason) : tx(TR.stateNotSubscribed)
            : t.outcome === 'no_show'
              ? tx(TR.stateNoShow)
              : tx(TR.stateCancelled)
  // The callout carries the one thing this trial needs now; the rest is behind "⋯", what ends it last.
  const primary = acts.record ? (
    <button type="button" className="btn btn--primary" onClick={onRecord}>{tx(TR.recordOutcome)}</button>
  ) : acts.correct ? (
    <button type="button" className="btn" onClick={onRecord}>{tx(TR.correctOutcome)}</button>
  ) : acts.edit ? (
    <button type="button" className="btn" onClick={onEdit}>{tx(TR.editTrial)}</button>
  ) : undefined
  const more: MenuItem[] = acts.cancel ? [{ key: 'cancel', label: tx(TR.cancel), icon: 'calendarX', danger: true, onSelect: onCancel }] : []
  return (
    <>
      <DetailCallout
        status={
          <>
            <Badge tone={OUTCOME_TONE[t.outcome] ?? 'neutral'} dot>{label(OUTCOME, t.outcome)}</Badge>
            {(t.outcome === 'awaiting' || t.outcome === 'upcoming') && (
              <Age iso={t.outcome === 'upcoming' ? t.startsAt : t.endsAt} late={outcomeLate(t)} />
            )}
          </>
        }
        state={state}
        note={d?.note ? <bdi>{d.note}</bdi> : undefined}
        primary={primary}
        more={more}
        label={`${tx(TR.moreActions)}: ${t.prospect.displayName}`}
      >
        {newStudents && t.outcome === 'subscribed' && (
          <Link className="card__link" to={`${TRIALS_AREA_BASE}/new-students`}>{tx(TR.openNewStudents)}</Link>
        )}
      </DetailCallout>
      <DetailSection title={tx(TR.details)}>
        <dl className="rq-fields">
          <div className="rq-field">
            <dt>{tx(TR.when)}</dt>
            <dd><time dateTime={t.startsAt}>{formatWhen(t.startsAt, locale)}</time></dd>
          </div>
          <div className="rq-field">
            <dt>{tx(TR.teacher)}</dt>
            <dd><bdi>{t.teacher.name}</bdi></dd>
          </div>
          <div className="rq-field">
            <dt>{tx(TR.length)}</dt>
            <dd>{formatMinutes(t.durationMinutes, locale)}</dd>
          </div>
        </dl>
      </DetailSection>
      <DetailSection title={tx(TR.students)}>
        <dl className="rq-fields">
          {students.map((x, i) => (
            <div className="rq-field" key={i}>
              <dt>{students.length > 1 ? `${tx(TR.student)} ${number(i + 1)}` : tx(TR.student)}</dt>
              <dd>
                <bdi>{x.name}</bdi>
                <span className="rq-sub"><bdi>{x.level ?? tx(TR.noLevel)}</bdi></span>
                {x.note && <span className="rq-sub"><bdi>{x.note}</bdi></span>}
              </dd>
            </div>
          ))}
        </dl>
      </DetailSection>
      <DetailSection title={tx(TR.chat)}>
        <div className="tj-group-line">
          {/* PD-32: a trial group carries its Trial label wherever it is opened. */}
          <TrialBadge />
          <bdi className="tj-group-line__who">{t.teacher.name}</bdi>
          <button type="button" className="btn btn--sm" onClick={onGroup}>
            <Icon name="conversations" size={16} />
            {tx(TR.openGroup)}
          </button>
        </div>
      </DetailSection>
      <DetailSection title={tx(TR.steps)}>
        <FlowSteps steps={steps} label={tx(TR.steps)} />
      </DetailSection>
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
          <span className="ts-muted">{editing.teacher.name}</span>
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
